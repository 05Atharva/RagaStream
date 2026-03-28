"""
YouTube router — search and stream via yt-dlp.

Endpoints:
  GET /youtube/search?q={query}&limit=8
  GET /youtube/stream?id={youtube_id}
"""
from __future__ import annotations

import asyncio
import logging
import time
from typing import Any, Dict, List, Optional

import yt_dlp
from fastapi import APIRouter, BackgroundTasks, HTTPException, Query

from schemas import YouTubeSearchResult, YouTubeStreamResponse

logger = logging.getLogger(__name__)
router = APIRouter()

# ---------------------------------------------------------------------------
# In-memory stream-URL cache
# { youtube_id: { "data": {...}, "expires_at": float } }
# ---------------------------------------------------------------------------
CACHE_TTL_SECONDS = 30 * 60          # 30 minutes
CACHE_CLEANUP_INTERVAL = 10 * 60     # 10 minutes

_stream_cache: Dict[str, Dict[str, Any]] = {}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _ydl_opts_base() -> dict:
    return {
        "quiet": True,
        "no_warnings": True,
        "extract_flat": False,
        "skip_download": True,
    }


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
        if expired:
            logger.info("YouTube cache: evicted %d expired entries.", len(expired))


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/search", response_model=List[YouTubeSearchResult])
async def search_youtube(
    q: str = Query(..., min_length=1, description="Search query"),
    limit: int = Query(8, ge=1, le=20, description="Max results (1-20)"),
):
    """
    Search YouTube via yt-dlp's ytsearch extractor.
    Returns up to `limit` results with id, title, channel, duration, thumbnail.
    """
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
                        thumbnail=entry.get("thumbnail", ""),
                    )
                )
            return results

    try:
        # yt-dlp is synchronous; run in thread pool to avoid blocking the event loop
        results = await asyncio.get_event_loop().run_in_executor(None, _run_search)
        return results
    except yt_dlp.utils.DownloadError as exc:
        logger.error("yt-dlp search error: %s", exc)
        raise HTTPException(status_code=502, detail="YouTube search failed. Please try again.")
    except Exception as exc:
        logger.exception("Unexpected search error: %s", exc)
        raise HTTPException(status_code=500, detail="Internal server error during search.")


@router.get("/stream", response_model=YouTubeStreamResponse)
async def get_stream_url(
    id: str = Query(..., min_length=1, description="YouTube video ID"),
):
    """
    Extract the best audio-only stream URL for a given YouTube video ID.
    Results are cached for 30 minutes.
    """
    now = time.time()

    # Return cached entry if still valid
    cached = _stream_cache.get(id)
    if cached and cached["expires_at"] > now:
        data = cached["data"]
        return YouTubeStreamResponse(
            **data,
            expires_in=int(cached["expires_at"] - now),
        )

    ydl_opts = {
        **_ydl_opts_base(),
        # Best audio-only; fall back to best combined if no audio-only available
        "format": "bestaudio[ext=m4a]/bestaudio/best",
    }

    def _extract() -> dict:
        url = f"https://www.youtube.com/watch?v={id}"
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            if info is None:
                raise ValueError("No info returned by yt-dlp.")

            stream_url = info.get("url")
            if not stream_url:
                # Some formats nest URL inside formats list
                formats = info.get("formats", [])
                if formats:
                    stream_url = formats[-1].get("url", "")

            if not stream_url:
                raise ValueError("Could not extract stream URL.")

            return {
                "stream_url": stream_url,
                "title": info.get("title", "Unknown"),
                "duration": _duration_int(info.get("duration")),
                "thumbnail": _safe_thumb(info.get("thumbnails"))
                             or info.get("thumbnail", ""),
            }

    try:
        data = await asyncio.get_event_loop().run_in_executor(None, _extract)
    except yt_dlp.utils.DownloadError as exc:
        msg = str(exc).lower()
        if "age" in msg or "sign in" in msg:
            raise HTTPException(status_code=451, detail="Video is age-gated.")
        if "geo" in msg or "not available in your country" in msg:
            raise HTTPException(status_code=451, detail="Video is geo-restricted.")
        if "private" in msg or "unavailable" in msg or "removed" in msg:
            raise HTTPException(status_code=404, detail="Video is unavailable.")
        logger.error("yt-dlp stream error for %s: %s", id, exc)
        raise HTTPException(status_code=502, detail="Could not fetch stream URL.")
    except Exception as exc:
        logger.exception("Unexpected stream error for %s: %s", id, exc)
        raise HTTPException(status_code=500, detail="Internal server error.")

    # Store in cache
    expires_at = now + CACHE_TTL_SECONDS
    _stream_cache[id] = {"data": data, "expires_at": expires_at}

    return YouTubeStreamResponse(
        **data,
        expires_in=CACHE_TTL_SECONDS,
    )
