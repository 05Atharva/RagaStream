"""
YouTube router — search and stream via yt-dlp.

Endpoints:
  GET /youtube/search?q={query}&limit=8
  GET /youtube/stream?id={youtube_id}
"""
from __future__ import annotations

import asyncio
import hashlib
import hmac
import logging
import os
import re
import secrets
import time
from typing import Any, Dict, List, Optional

import httpx
import yt_dlp
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request
from fastapi.responses import Response, StreamingResponse

from auth import get_current_user
from schemas import YouTubeSearchResult, YouTubeStreamResponse

logger = logging.getLogger(__name__)
router = APIRouter()

# Optional: pull cookies from a local browser (e.g. "chrome", "edge", "firefox")
# to satisfy YouTube's bot-check wall. Set in backend/.env.
# YTDLP_COOKIES_FILE takes precedence — a Netscape-format cookies.txt export,
# needed when live browser decryption fails (e.g. Chrome App-Bound Encryption / DPAPI).
YTDLP_COOKIES_FROM_BROWSER = os.environ.get("YTDLP_COOKIES_FROM_BROWSER")
YTDLP_COOKIES_FILE = os.environ.get("YTDLP_COOKIES_FILE")
if YTDLP_COOKIES_FILE and not os.path.isfile(YTDLP_COOKIES_FILE):
    # e.g. Render's secret file not uploaded yet: run without cookies rather than fail every request.
    logging.getLogger(__name__).warning("YTDLP_COOKIES_FILE %s not found; continuing without cookies.", YTDLP_COOKIES_FILE)
    YTDLP_COOKIES_FILE = None

# ---------------------------------------------------------------------------
# In-memory stream-URL cache
# { youtube_id: { "data": {...}, "expires_at": float } }
# ---------------------------------------------------------------------------
CACHE_TTL_SECONDS = 30 * 60          # 30 minutes
CACHE_CLEANUP_INTERVAL = 10 * 60     # 10 minutes

_stream_cache: Dict[str, Dict[str, Any]] = {}

# ---------------------------------------------------------------------------
# Signed audio links
# ---------------------------------------------------------------------------
# Players can't reliably send an Authorization header, so /youtube/stream (which
# needs a signed-in user) hands out a relay link signed with a server secret.
# The relay checks the signature locally: no auth round-trip per Range request,
# and nobody can use this server as a free YouTube audio proxy.
AUDIO_LINK_TTL_SECONDS = 12 * 60 * 60   # outlives a long pause; the app re-resolves hourly


def _relay_secret() -> bytes:
    explicit = os.environ.get("AUDIO_LINK_SECRET")
    if explicit:
        return explicit.encode()
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if service_key:
        # Derived, so links survive restarts without another env var; rotating
        # the service key (or setting AUDIO_LINK_SECRET) invalidates every link.
        return hmac.new(service_key.encode(), b"ragastream-audio-link", hashlib.sha256).digest()
    logger.warning("No AUDIO_LINK_SECRET or service key: audio links reset on every restart.")
    return secrets.token_bytes(32)


_RELAY_SECRET = _relay_secret()


def _audio_signature(video_id: str, exp: int) -> str:
    return hmac.new(_RELAY_SECRET, f"{video_id}:{exp}".encode(), hashlib.sha256).hexdigest()[:32]


def signed_audio_path(video_id: str, now: Optional[float] = None) -> str:
    exp = int((now or time.time()) + AUDIO_LINK_TTL_SECONDS)
    return f"/youtube/audio/{video_id}?exp={exp}&sig={_audio_signature(video_id, exp)}"


def audio_link_valid(video_id: str, exp: int, sig: str, now: Optional[float] = None) -> bool:
    if exp < (now or time.time()):
        return False
    return hmac.compare_digest(_audio_signature(video_id, exp), sig)

# Search results: { normalised query: { "data": [...], "limit": int, "expires_at": float } }
# yt-dlp search is the slowest call we make (seconds, and it counts against
# YouTube's rate limits), and the same queries repeat: retyped searches and the
# Home genre chips. Results for a query barely change within half an hour.
SEARCH_CACHE_TTL_SECONDS = 30 * 60
SEARCH_EMPTY_TTL_SECONDS = 5 * 60    # an empty result may be a blip; retry sooner
SEARCH_CACHE_MAX_ENTRIES = 500
_search_cache: Dict[str, Dict[str, Any]] = {}
_search_inflight: Dict[str, "asyncio.Future[list]"] = {}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _ydl_opts_base() -> dict:
    opts: dict = {
        "quiet": True,
        "no_warnings": True,
        "extract_flat": False,
        "skip_download": True,
        # Node.js solves YouTube's signature/nsig challenges (yt-dlp-ejs).
        "js_runtimes": {"node": {}},
    }
    if YTDLP_COOKIES_FILE:
        opts["cookiefile"] = YTDLP_COOKIES_FILE
    elif YTDLP_COOKIES_FROM_BROWSER:
        opts["cookiesfrombrowser"] = (YTDLP_COOKIES_FROM_BROWSER,)
    return opts


def _safe_thumb(thumbnails: Optional[list]) -> str:
    """Pick the highest-quality thumbnail or return empty string."""
    if not thumbnails:
        return ""
    best = max(thumbnails, key=lambda t: t.get("width", 0) if t.get("width") else 0)
    return best.get("url", "")


def _duration_int(raw: Any) -> int:
    try:
        return int(raw or 0)
    except (TypeError, ValueError):
        return 0


# ---------------------------------------------------------------------------
# Background cache-cleanup loop (started by main.py lifespan)
# ---------------------------------------------------------------------------

async def cache_cleanup_loop() -> None:
    """Runs forever, removing expired stream-URL cache entries every 10 min."""
    while True:
        await asyncio.sleep(CACHE_CLEANUP_INTERVAL)
        now = time.time()
        expired = [k for k, v in _stream_cache.items() if v["expires_at"] < now]
        for key in expired:
            _stream_cache.pop(key, None)
        for key in [k for k, v in _radio_cache.items() if v["expires_at"] < now]:
            _radio_cache.pop(key, None)
        for key in [k for k, v in _search_cache.items() if v["expires_at"] < now]:
            _search_cache.pop(key, None)
        if expired:
            logger.info("YouTube cache: evicted %d expired entries.", len(expired))


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/search", response_model=List[YouTubeSearchResult])
async def search_youtube(
    q: str = Query(..., min_length=1, description="Search query"),
    limit: int = Query(8, ge=1, le=20, description="Max results (1-20)"),
    _user: dict = Depends(get_current_user),
):
    """
    Search YouTube via yt-dlp's ytsearch extractor.
    Returns up to `limit` results with id, title, channel, duration, thumbnail.
    Cached per query for 30 minutes; identical concurrent searches share one call.
    """
    return await search_videos(q, limit)


async def search_videos(q: str, limit: int = 8) -> List[YouTubeSearchResult]:
    """The search behind /youtube/search (30-minute cache, in-flight sharing).
    Raises HTTPException (502/500) when YouTube fails. Shared with the playlist importer."""
    key = " ".join(q.lower().split())
    cached = _search_cache.get(key)
    if cached and cached["expires_at"] > time.time() and cached["limit"] >= limit:
        return cached["data"][:limit]

    # Someone is already running this search (e.g. a double-fired debounce): wait for it.
    pending = _search_inflight.get(key)
    if pending is not None:
        try:
            shared = await asyncio.shield(pending)
        except asyncio.CancelledError:
            if not pending.cancelled():
                raise  # this request itself was cancelled
            shared = None  # the other request went away; run our own search
        if shared is not None and len(shared) >= limit:
            return shared[:limit]

    ydl_opts = {
        **_ydl_opts_base(),
        "extract_flat": "in_playlist",
        "playlist_items": f"1:{limit}",
    }

    def _run_search() -> list:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(f"ytsearch{limit}:{q}", download=False)
            entries = info.get("entries", []) if info else []
            results = []
            for entry in entries:
                if entry is None:
                    continue
                results.append(
                    YouTubeSearchResult(
                        youtube_id=entry.get("id", ""),
                        title=entry.get("title", "Unknown"),
                        channel=entry.get("channel", entry.get("uploader", "Unknown")),
                        duration=_duration_int(entry.get("duration")),
                        # extract_flat rarely returns thumbnail; build it from the ID
                        thumbnail=(
                            entry.get("thumbnail")
                            or f"https://i.ytimg.com/vi/{entry.get('id', '')}/hqdefault.jpg"
                        ),
                    )
                )
            return results

    loop = asyncio.get_running_loop()
    future: "asyncio.Future[list]" = loop.create_future()
    _search_inflight[key] = future
    try:
        # yt-dlp is synchronous; run in thread pool to avoid blocking the event loop
        results = await loop.run_in_executor(None, _run_search)
        future.set_result(results)
    except yt_dlp.utils.DownloadError as exc:
        logger.error("yt-dlp search error: %s", exc)
        error = HTTPException(status_code=502, detail="YouTube search failed. Please try again.")
        future.set_exception(error)
        future.exception()  # mark retrieved so asyncio doesn't warn when nobody else waited
        raise error
    except Exception as exc:
        logger.exception("Unexpected search error: %s", exc)
        error = HTTPException(status_code=500, detail="Internal server error during search.")
        future.set_exception(error)
        future.exception()
        raise error
    finally:
        _search_inflight.pop(key, None)
        if not future.done():
            future.cancel()  # request cancelled mid-search: release anyone waiting

    if len(_search_cache) >= SEARCH_CACHE_MAX_ENTRIES:
        _search_cache.pop(next(iter(_search_cache)))  # oldest insertion first
    ttl = SEARCH_CACHE_TTL_SECONDS if results else SEARCH_EMPTY_TTL_SECONDS
    _search_cache[key] = {"data": results, "limit": limit, "expires_at": time.time() + ttl}
    return results


RADIO_CACHE_TTL_SECONDS = 60 * 60   # 1 hour — mixes change slowly
_radio_cache: Dict[str, Dict[str, Any]] = {}


async def fetch_mix(youtube_id: str, limit: int = 50) -> List[YouTubeSearchResult]:
    """
    YouTube's auto-generated Mix (list=RD<id>) for a seed video, seed excluded.
    Cached for an hour. Raises yt_dlp.utils.DownloadError when YouTube refuses.
    Shared by /youtube/radio and the recommendation graph (recs/graph.py).
    """
    now = time.time()
    cached = _radio_cache.get(youtube_id)
    if cached and cached["expires_at"] > now:
        return cached["data"][:limit]

    ydl_opts = {
        **_ydl_opts_base(),
        "extract_flat": "in_playlist",
        "playlistend": 50,
    }

    def _run_radio() -> list:
        url = f"https://www.youtube.com/watch?v={youtube_id}&list=RD{youtube_id}"
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            entries = info.get("entries", []) if info else []
            results = []
            seen = {youtube_id}
            for entry in entries:
                if not entry or not entry.get("id") or entry["id"] in seen:
                    continue
                seen.add(entry["id"])
                results.append(
                    YouTubeSearchResult(
                        youtube_id=entry["id"],
                        title=entry.get("title", "Unknown"),
                        channel=entry.get("channel", entry.get("uploader", "Unknown")),
                        duration=_duration_int(entry.get("duration")),
                        thumbnail=f"https://i.ytimg.com/vi/{entry['id']}/hqdefault.jpg",
                    )
                )
            return results

    results = await asyncio.get_event_loop().run_in_executor(None, _run_radio)
    _radio_cache[youtube_id] = {"data": results, "expires_at": now + RADIO_CACHE_TTL_SECONDS}
    return results[:limit]


@router.get("/radio", response_model=List[YouTubeSearchResult])
async def get_radio(
    id: str = Query(..., min_length=1, description="Seed YouTube video ID"),
    limit: int = Query(25, ge=1, le=50, description="Max tracks (1-50)"),
    _user: dict = Depends(get_current_user),
):
    """
    Song radio: tracks related to a seed video, taken from YouTube's
    auto-generated "Mix" playlist (list=RD<id>). The seed itself is excluded.
    Powers Start radio, Autoplay and Smart Shuffle recommendations.
    """
    try:
        return await fetch_mix(id, limit)
    except yt_dlp.utils.DownloadError as exc:
        logger.error("yt-dlp radio error for %s: %s", id, exc)
        raise HTTPException(status_code=502, detail="Could not build radio for this song.")
    except Exception as exc:
        logger.exception("Unexpected radio error for %s: %s", id, exc)
        raise HTTPException(status_code=500, detail="Internal server error.")


def _ydl_error_to_http(video_id: str, exc: Exception) -> HTTPException:
    msg = str(exc).lower()
    if "sign in" in msg and "bot" in msg:
        return HTTPException(
            status_code=403,
            detail="YouTube requires sign-in verification. Configure YTDLP_COOKIES_FILE in backend/.env.",
        )
    if "age" in msg:
        return HTTPException(status_code=451, detail="Video is age-gated.")
    if "geo" in msg or "not available in your country" in msg:
        return HTTPException(status_code=451, detail="Video is geo-restricted.")
    if "private" in msg or "unavailable" in msg or "removed" in msg:
        return HTTPException(status_code=404, detail="Video is unavailable.")
    logger.error("yt-dlp stream error for %s: %s", video_id, exc)
    return HTTPException(status_code=502, detail="Could not fetch stream URL.")


async def _resolve_stream(video_id: str, fresh: bool = False) -> Dict[str, Any]:
    """
    Extract (or reuse from the 30-minute cache) the best audio-only stream for
    a video: URL, the request headers YouTube expects, size and container.
    """
    now = time.time()
    cached = None if fresh else _stream_cache.get(video_id)
    if cached and cached["expires_at"] > now:
        return {**cached["data"], "expires_in": int(cached["expires_at"] - now)}

    ydl_opts = {
        **_ydl_opts_base(),
        # Best audio-only; fall back to best combined if no audio-only available
        "format": "bestaudio[ext=m4a]/bestaudio/best",
    }

    def _extract() -> dict:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(f"https://www.youtube.com/watch?v={video_id}", download=False)
            if info is None:
                raise ValueError("No info returned by yt-dlp.")
            stream_url = info.get("url")
            if not stream_url:
                formats = info.get("formats", [])
                if formats:
                    stream_url = formats[-1].get("url", "")
            if not stream_url:
                raise ValueError("Could not extract stream URL.")
            return {
                "stream_url": stream_url,
                "title": info.get("title", "Unknown"),
                "channel": info.get("channel") or info.get("uploader") or "Unknown",
                "duration": _duration_int(info.get("duration")),
                "thumbnail": _safe_thumb(info.get("thumbnails")) or info.get("thumbnail", ""),
                "filesize": info.get("filesize") or info.get("filesize_approx"),
                "ext": info.get("ext") or "m4a",
                "http_headers": info.get("http_headers") or {},
            }

    try:
        data = await asyncio.get_event_loop().run_in_executor(None, _extract)
    except yt_dlp.utils.DownloadError as exc:
        raise _ydl_error_to_http(video_id, exc)
    except Exception as exc:
        logger.exception("Unexpected stream error for %s: %s", video_id, exc)
        raise HTTPException(status_code=500, detail="Internal server error.")

    _stream_cache[video_id] = {"data": data, "expires_at": now + CACHE_TTL_SECONDS}
    return {**data, "expires_in": CACHE_TTL_SECONDS}


@router.get("/stream", response_model=YouTubeStreamResponse)
async def get_stream_url(
    id: str = Query(..., min_length=1, description="YouTube video ID"),
    fresh: bool = Query(False, description="Skip the cache (the cached URL was rejected)"),
    _user: dict = Depends(get_current_user),
):
    """
    Check a song is playable (warming the extraction cache) and return a signed
    relay link for it. Extraction is cached for 30 minutes; `fresh=true` forces
    a new one. The raw YouTube URL never leaves the server: it only works from
    this server's IP anyway.
    """
    data = await _resolve_stream(id, fresh)
    return YouTubeStreamResponse(
        audio_path=signed_audio_path(id),
        title=data["title"],
        channel=data["channel"],
        duration=data["duration"],
        thumbnail=data["thumbnail"],
        expires_in=AUDIO_LINK_TTL_SECONDS,
    )


# ---------------------------------------------------------------------------
# Audio relay
# ---------------------------------------------------------------------------

RELAY_CHUNK = 1024 * 1024  # YouTube serves 1 MB ranged reads reliably
_RANGE_RE = re.compile(r"bytes=(\d*)-(\d*)")
_MIME = {"m4a": "audio/mp4", "mp4": "audio/mp4", "webm": "audio/webm", "opus": "audio/ogg"}


async def _probe_size(url: str, headers: dict) -> Optional[int]:
    """Total size from a 1-byte ranged read when yt-dlp didn't report it."""
    async with httpx.AsyncClient(headers=headers, timeout=15, follow_redirects=True) as client:
        resp = await client.get(url, headers={"Range": "bytes=0-0"})
    match = re.search(r"/(\d+)$", resp.headers.get("content-range", ""))
    return int(match.group(1)) if match else None


@router.api_route("/audio/{video_id}", methods=["GET", "HEAD"])
async def relay_audio(
    video_id: str,
    request: Request,
    exp: int = Query(..., description="Link expiry (unix seconds), from /youtube/stream"),
    sig: str = Query(..., min_length=32, max_length=32, description="Link signature, from /youtube/stream"),
):
    """
    Stream a song's audio through this server.

    YouTube locks each stream URL to the IP that extracted it and only serves
    small ranged reads. Phones that hop between Wi-Fi and mobile data (or any
    client on another network) get 403s mid-song when they fetch the URL
    directly. Relaying keeps every request on this server's IP, reads in 1 MB
    ranges, and re-extracts a fresh URL if YouTube rejects one partway through.
    Supports HTTP Range so players can seek. Only signed links from
    /youtube/stream are served.
    """
    if not audio_link_valid(video_id, exp, sig):
        raise HTTPException(status_code=403, detail="This audio link has expired or isn't valid. Play the song again.")
    data = await _resolve_stream(video_id)
    size = data.get("filesize") or await _probe_size(data["stream_url"], data["http_headers"])
    if not size:
        raise HTTPException(status_code=502, detail="Could not determine the audio size.")
    size = int(size)

    start, end, partial = 0, size - 1, False
    match = _RANGE_RE.match(request.headers.get("range", ""))
    if match and (match.group(1) or match.group(2)):
        partial = True
        if match.group(1):
            start = int(match.group(1))
            end = min(int(match.group(2)), size - 1) if match.group(2) else size - 1
        else:  # suffix range: last N bytes
            start = max(size - int(match.group(2)), 0)
    if start >= size or start > end:
        raise HTTPException(status_code=416, detail="Requested range not satisfiable.", headers={"Content-Range": f"bytes */{size}"})

    mime = _MIME.get(data.get("ext", ""), "audio/mp4")
    headers = {
        "Accept-Ranges": "bytes",
        "Content-Length": str(end - start + 1),
        "Content-Type": mime,
        "Cache-Control": "no-store",
    }
    if partial:
        headers["Content-Range"] = f"bytes {start}-{end}/{size}"
    status = 206 if partial else 200
    if request.method == "HEAD":
        return Response(status_code=status, headers=headers)

    async def body():
        source = data
        position = start
        retried = False
        async with httpx.AsyncClient(headers=source["http_headers"], timeout=20, follow_redirects=True) as client:
            while position <= end:
                if await request.is_disconnected():
                    return
                chunk_end = min(position + RELAY_CHUNK - 1, end)
                try:
                    resp = await client.get(source["stream_url"], headers={"Range": f"bytes={position}-{chunk_end}"})
                except httpx.HTTPError as exc:
                    logger.warning("Relay read failed for %s at %d: %s", video_id, position, exc)
                    resp = None
                if resp is None or resp.status_code in (403, 404, 410) or not resp.content:
                    if retried:
                        logger.error("Relay giving up on %s at byte %d", video_id, position)
                        return
                    # URL expired or was rejected: extract a fresh one and resume.
                    retried = True
                    try:
                        source = await _resolve_stream(video_id, fresh=True)
                    except HTTPException:
                        return
                    client.headers.update(source["http_headers"])
                    continue
                retried = False
                yield resp.content
                position += len(resp.content)

    return StreamingResponse(body(), status_code=status, headers=headers, media_type=mime)
