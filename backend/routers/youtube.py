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
import json
import logging
import os
import re
import secrets
import shutil
import tempfile
import time
from typing import Any, Awaitable, Callable, Dict, List, Optional
from urllib.parse import parse_qs, urlparse

import httpx
import yt_dlp
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request
from fastapi.responses import Response, StreamingResponse

from auth import get_current_user
from schemas import YouTubeSearchResult, YouTubeStreamResponse
from ytguard import YouTubeBusy, YtdlpLog, gate, parse_retry_after, wait_phrase

logger = logging.getLogger(__name__)
router = APIRouter()

# Optional: pull cookies from a local browser (e.g. "chrome", "edge", "firefox")
# to satisfy YouTube's bot-check wall. Set in backend/.env.
# YTDLP_COOKIES_FILE takes precedence — a Netscape-format cookies.txt export,
# needed when live browser decryption fails (e.g. Chrome App-Bound Encryption / DPAPI).
YTDLP_COOKIES_FROM_BROWSER = os.environ.get("YTDLP_COOKIES_FROM_BROWSER")


def _usable_cookie_file(path: Optional[str]) -> Optional[str]:
    """The cookies file yt-dlp should use, or None.

    yt-dlp writes refreshed cookies back to this file when it finishes. Render
    mounts secret files read-only (/etc/secrets), and that write used to crash
    every stream request, so a read-only file is copied somewhere writable.
    """
    log = logging.getLogger(__name__)
    if not path:
        return None
    if not os.path.isfile(path):
        # e.g. Render's secret file not uploaded yet: run without cookies rather than fail every request.
        log.warning("YTDLP_COOKIES_FILE %s not found; continuing without cookies.", path)
        return None
    if os.access(path, os.W_OK):
        return path
    copy = os.path.join(tempfile.gettempdir(), "ragastream-yt-cookies.txt")
    shutil.copyfile(path, copy)
    return copy


YTDLP_COOKIES_FILE = _usable_cookie_file(os.environ.get("YTDLP_COOKIES_FILE"))

# Optional JSON for yt-dlp's extractor_args, e.g. '{"youtube": {"player_client": ["tv", "web_safari"]}}',
# to try other YouTube clients from a server without a code change.
try:
    YTDLP_EXTRACTOR_ARGS = json.loads(os.environ.get("YTDLP_EXTRACTOR_ARGS") or "null")
except ValueError:
    logging.getLogger(__name__).warning("YTDLP_EXTRACTOR_ARGS is not valid JSON; ignoring it.")
    YTDLP_EXTRACTOR_ARGS = None


def _read_proxy(raw: Optional[str]) -> Optional[str]:
    """YTDLP_PROXY, e.g. "http://user:pass@host:8080" or "socks5://user:pass@host:1080"."""
    value = (raw or "").strip()
    if not value:
        return None
    if urlparse(value).scheme not in ("http", "https", "socks5", "socks5h"):
        logging.getLogger(__name__).warning("YTDLP_PROXY must start with http://, https://, socks5:// or socks5h://; ignoring it.")
        return None
    return value


# Optional: send every request to YouTube (yt-dlp and the audio relay) through a
# proxy, for hosts whose IP YouTube throttles. YouTube locks each audio URL to the
# IP that extracted it, so extraction and relay must leave from the same IP: use a
# sticky (non-rotating) proxy session. Never logged: the URL may hold a password.
YTDLP_PROXY = _read_proxy(os.environ.get("YTDLP_PROXY"))


def _httpx_proxy(proxy: Optional[str]) -> Optional[str]:
    """The same proxy for httpx, which spells remote-DNS SOCKS as plain socks5."""
    if proxy and proxy.startswith("socks5h://"):
        return "socks5://" + proxy[len("socks5h://"):]
    return proxy


RELAY_PROXY = _httpx_proxy(YTDLP_PROXY)


def _count_youtube_cookies(path: Optional[str]) -> int:
    if not path:
        return 0
    try:
        with open(path, encoding="utf-8", errors="ignore") as f:
            return sum(1 for line in f if "youtube.com" in line and not line.startswith("#"))
    except OSError:
        return 0


logging.getLogger(__name__).info(
    "yt-dlp %s | node: %s | youtube cookies loaded: %d | proxy: %s",
    getattr(getattr(yt_dlp, "version", None), "__version__", "?"),
    "yes" if shutil.which("node") else "NOT FOUND (streams will fail)",
    _count_youtube_cookies(YTDLP_COOKIES_FILE),
    urlparse(YTDLP_PROXY).scheme if YTDLP_PROXY else "none",
)


# ---------------------------------------------------------------------------
# In-memory stream-URL cache
# { youtube_id: { "data": {...}, "fetched_at", "expires_at", "usable_until": float } }
# ---------------------------------------------------------------------------
# Every extraction is a request YouTube counts against this server's IP, so a
# result (stream URL plus title, channel, duration, thumbnail) is reused until
# shortly before YouTube's own URL expiry (`expire=` in the URL, ~6h), up to 4h.
# Past that it's still served while YouTube is rate-limiting us.
CACHE_TTL_SECONDS = 30 * 60          # when the URL has no expiry we can read
STREAM_CACHE_MAX_TTL = 4 * 60 * 60
STREAM_EXPIRY_MARGIN = 30 * 60       # re-extract this long before YouTube's expiry
STREAM_MIN_TTL = 5 * 60
STREAM_FRESH_FLOOR = 30              # a "fresh" request reuses an extraction this young
STREAM_CACHE_MAX_ENTRIES = 1000
CACHE_CLEANUP_INTERVAL = 10 * 60     # 10 minutes
# Expired search and radio results are kept this long, to serve during a rate limit.
STALE_GRACE_SECONDS = 6 * 60 * 60

_stream_cache: Dict[str, Dict[str, Any]] = {}
_stream_inflight: Dict[str, "asyncio.Future[Dict[str, Any]]"] = {}

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

def _ydl_opts_base(log: Optional[YtdlpLog] = None) -> dict:
    opts: dict = {
        "quiet": True,
        "logger": log or YtdlpLog(),
        "extract_flat": False,
        "skip_download": True,
        # Node.js solves YouTube's signature/nsig challenges (yt-dlp-ejs).
        "js_runtimes": {"node": {}},
    }
    if YTDLP_EXTRACTOR_ARGS:
        opts["extractor_args"] = YTDLP_EXTRACTOR_ARGS
    if YTDLP_PROXY:
        opts["proxy"] = YTDLP_PROXY
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
    """Runs forever, removing dead cache entries every 10 min. Expired entries are
    kept a while first, so they can stand in while YouTube is rate-limiting us."""
    while True:
        await asyncio.sleep(CACHE_CLEANUP_INTERVAL)
        evicted = _evict_dead_entries(time.time())
        if evicted:
            logger.info("YouTube cache: evicted %d expired entries.", evicted)


def _evict_dead_entries(now: float) -> int:
    stale_before = now - STALE_GRACE_SECONDS
    dead = [k for k, v in _stream_cache.items() if v["usable_until"] < now]
    for key in dead:
        _stream_cache.pop(key, None)
    count = len(dead)
    for cache in (_radio_cache, _search_cache):
        old = [k for k, v in cache.items() if v["expires_at"] < stale_before]
        for key in old:
            cache.pop(key, None)
        count += len(old)
    return count


def _busy_http(busy: YouTubeBusy) -> HTTPException:
    """HTTP 429 for the app: YouTube is rate-limiting the server, so wait instead of retrying."""
    return HTTPException(
        status_code=429,
        detail=f"YouTube is limiting requests from the server. Try again in {wait_phrase(busy.retry_after)}.",
        headers={"Retry-After": str(busy.retry_after)},
    )


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
    Raises HTTPException: 429 while YouTube is rate-limiting us (older results
    for the same query are served instead when we have them), 502/500 on other
    failures. Shared with the playlist importer."""
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

    def _run_search(log: YtdlpLog) -> list:
        ydl_opts = {
            **_ydl_opts_base(log),
            "extract_flat": "in_playlist",
            "playlist_items": f"1:{limit}",
        }
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
        # yt-dlp is synchronous: the gate runs it in the thread pool, a few at a time
        results = await gate.run(_run_search)
        future.set_result(results)
    except YouTubeBusy as busy:
        if cached and cached["data"]:
            logger.info("YouTube rate limit: serving older search results for %r.", key[:60])
            future.set_result(cached["data"])
            return cached["data"][:limit]
        error = _busy_http(busy)
        future.set_exception(error)
        future.exception()  # mark retrieved so asyncio doesn't warn when nobody else waited
        raise error
    except yt_dlp.utils.DownloadError as exc:
        logger.error("yt-dlp search error: %s", exc)
        error = HTTPException(status_code=502, detail="YouTube search failed. Please try again.")
        future.set_exception(error)
        future.exception()
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


def _shared(inflight: Dict[str, "asyncio.Task[Any]"], key: str, make: Callable[[], Awaitable[Any]]) -> "asyncio.Task[Any]":
    """One task per key at a time: simultaneous requests for the same video share
    one extraction. Await it through asyncio.shield, so a caller that hangs up
    doesn't cancel it for the others (and the result still lands in the cache)."""
    loop = asyncio.get_running_loop()
    task = inflight.get(key)
    if task is None or task.done() or task.get_loop() is not loop:
        task = asyncio.ensure_future(make())
        inflight[key] = task

        def _done(t: "asyncio.Task[Any]", k: str = key) -> None:
            if inflight.get(k) is t:
                inflight.pop(k, None)
            if not t.cancelled():
                t.exception()  # retrieved: no asyncio warning if every caller left early

        task.add_done_callback(_done)
    return task


RADIO_CACHE_TTL_SECONDS = 60 * 60   # 1 hour — mixes change slowly
_radio_cache: Dict[str, Dict[str, Any]] = {}
_radio_inflight: Dict[str, "asyncio.Task[Any]"] = {}


async def fetch_mix(youtube_id: str, limit: int = 50) -> List[YouTubeSearchResult]:
    """
    YouTube's auto-generated Mix (list=RD<id>) for a seed video, seed excluded.
    Cached for an hour; one fetch per seed at a time. While YouTube is
    rate-limiting us an older Mix for the seed is served, else YouTubeBusy is
    raised. Raises yt_dlp.utils.DownloadError when YouTube refuses.
    Shared by /youtube/radio and the recommendation graph (recs/graph.py).
    """
    cached = _radio_cache.get(youtube_id)
    if cached and cached["expires_at"] > time.time():
        return cached["data"][:limit]
    task = _shared(_radio_inflight, youtube_id, lambda: _fetch_mix_live(youtube_id))
    return (await asyncio.shield(task))[:limit]


async def _fetch_mix_live(youtube_id: str) -> List[YouTubeSearchResult]:
    def _run_radio(log: YtdlpLog) -> list:
        ydl_opts = {
            **_ydl_opts_base(log),
            "extract_flat": "in_playlist",
            "playlistend": 50,
        }
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

    try:
        results = await gate.run(_run_radio)
    except YouTubeBusy:
        stale = _radio_cache.get(youtube_id)
        if stale and stale["data"]:
            return stale["data"]
        raise
    _radio_cache[youtube_id] = {"data": results, "expires_at": time.time() + RADIO_CACHE_TTL_SECONDS}
    return results


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
    except YouTubeBusy as busy:
        raise _busy_http(busy)
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


def _url_expiry(url: str) -> Optional[float]:
    """YouTube's own expiry for a stream URL (unix seconds, the `expire` param)."""
    try:
        return float(parse_qs(urlparse(url).query)["expire"][0])
    except (KeyError, IndexError, ValueError):
        return None


def _cache_stream(video_id: str, data: Dict[str, Any], now: float) -> Dict[str, Any]:
    expiry = _url_expiry(data.get("stream_url", ""))
    if expiry:
        usable_until = expiry - 60
        ttl = min(STREAM_CACHE_MAX_TTL, expiry - now - STREAM_EXPIRY_MARGIN)
        ttl = max(ttl, min(STREAM_MIN_TTL, usable_until - now))  # short-lived URL: use what's left
    else:
        ttl = CACHE_TTL_SECONDS
        usable_until = now + ttl
    if video_id not in _stream_cache and len(_stream_cache) >= STREAM_CACHE_MAX_ENTRIES:
        _stream_cache.pop(next(iter(_stream_cache)))  # oldest insertion first
    entry = {"data": data, "fetched_at": now, "expires_at": now + ttl, "usable_until": max(usable_until, now + ttl)}
    _stream_cache[video_id] = entry
    return entry


async def _resolve_stream(video_id: str, fresh: bool = False) -> Dict[str, Any]:
    """
    Extract (or reuse from cache) the best audio-only stream for a video: URL,
    the request headers YouTube expects, size, container, title and artwork.
    Cached until shortly before YouTube's URL expiry; `fresh` skips the cache
    unless the cached extraction is only seconds old. Simultaneous calls for
    one video share one extraction. While YouTube is rate-limiting us, a cached
    URL that hasn't expired yet is served; otherwise HTTP 429.
    """
    now = time.time()
    cached = _stream_cache.get(video_id)
    if cached and now - cached["fetched_at"] < STREAM_FRESH_FLOOR:
        fresh = False  # just extracted: as fresh as it gets, don't ask YouTube again
    if cached and not fresh and cached["expires_at"] > now:
        return {**cached["data"], "expires_in": int(cached["expires_at"] - now)}

    task = _shared(_stream_inflight, video_id, lambda: _extract_stream(video_id))
    try:
        return await asyncio.shield(task)
    except YouTubeBusy as busy:
        now = time.time()
        if cached and not fresh and cached["usable_until"] > now:
            logger.info("YouTube rate limit: reusing an older stream URL for %s.", video_id)
            return {**cached["data"], "expires_in": int(cached["usable_until"] - now)}
        raise _busy_http(busy)
    except yt_dlp.utils.DownloadError as exc:
        raise _ydl_error_to_http(video_id, exc)
    except Exception as exc:
        logger.exception("Unexpected stream error for %s: %s", video_id, exc)
        raise HTTPException(status_code=500, detail="Internal server error.")


async def _extract_stream(video_id: str) -> Dict[str, Any]:
    def _extract(log: YtdlpLog) -> dict:
        ydl_opts = {
            **_ydl_opts_base(log),
            # Best audio-only; fall back to best combined if no audio-only available
            "format": "bestaudio[ext=m4a]/bestaudio/best",
        }
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

    data = await gate.run(_extract)
    now = time.time()
    entry = _cache_stream(video_id, data, now)
    return {**data, "expires_in": int(entry["expires_at"] - now)}


@router.get("/stream", response_model=YouTubeStreamResponse)
async def get_stream_url(
    id: str = Query(..., min_length=1, description="YouTube video ID"),
    fresh: bool = Query(False, description="Skip the cache (the cached URL was rejected)"),
    _user: dict = Depends(get_current_user),
):
    """
    Check a song is playable (warming the extraction cache) and return a signed
    relay link for it. Extraction is cached until shortly before YouTube's URL
    expiry (up to 4h); `fresh=true` forces a new one. HTTP 429 + Retry-After
    while YouTube is rate-limiting the server: wait, don't retry straight away.
    The raw YouTube URL never leaves the server: it only works from this
    server's IP anyway.
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
RELAY_MAX_WAITS = 3            # 429/5xx on a chunk: retries before giving up
RELAY_MAX_WAIT_SECONDS = 8     # never hold a chunk longer than this per retry
_RANGE_RE = re.compile(r"bytes=(\d*)-(\d*)")
_MIME = {"m4a": "audio/mp4", "mp4": "audio/mp4", "webm": "audio/webm", "opus": "audio/ogg"}


async def _probe_size(url: str, headers: dict) -> Optional[int]:
    """Total size from a 1-byte ranged read when yt-dlp didn't report it."""
    async with httpx.AsyncClient(headers=headers, timeout=15, follow_redirects=True, proxy=RELAY_PROXY) as client:
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
        waits = 0
        # Same exit IP as the extraction: YouTube rejects the URL from anywhere else.
        async with httpx.AsyncClient(headers=source["http_headers"], timeout=20, follow_redirects=True,
                                     proxy=RELAY_PROXY) as client:
            while position <= end:
                if await request.is_disconnected():
                    return
                chunk_end = min(position + RELAY_CHUNK - 1, end)
                try:
                    resp = await client.get(source["stream_url"], headers={"Range": f"bytes={position}-{chunk_end}"})
                except httpx.HTTPError as exc:
                    logger.warning("Relay read failed for %s at %d: %s", video_id, position, exc)
                    resp = None
                if resp is not None and (resp.status_code == 429 or resp.status_code >= 500):
                    # YouTube is busy, not refusing this URL: wait a moment and read
                    # the same range again. A new extraction would only add load.
                    if waits >= RELAY_MAX_WAITS:
                        logger.error("Relay giving up on %s at byte %d: YouTube answered %d",
                                     video_id, position, resp.status_code)
                        return
                    waits += 1
                    delay = parse_retry_after(resp.headers.get("retry-after")) or float(2 ** waits)
                    await asyncio.sleep(min(delay, RELAY_MAX_WAIT_SECONDS))
                    continue
                if resp is None or resp.status_code not in (200, 206) or not resp.content:
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
                waits = 0
                yield resp.content
                position += len(resp.content)

    return StreamingResponse(body(), status_code=status, headers=headers, media_type=mime)
