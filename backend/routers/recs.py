"""
Recommendation routes: /recs/next, /recs/radio, /recs/shuffle, /recs/playlist, /recs/home.

Mounted at the app root (no prefix). See docs/RECOMMENDATIONS.md.
"""
from __future__ import annotations

import logging
import re
from typing import List

from fastapi import APIRouter, Depends, HTTPException, Query

from auth import get_current_user
from recs import surfaces
from recs.models import HomeRecs, PlaylistRequest, ShuffleRequest, Slate, YT_ID_PATTERN

logger = logging.getLogger(__name__)
router = APIRouter()

_YT_ID = re.compile(YT_ID_PATTERN)
MAX_EXCLUDE = 200


def _parse_exclude(raw: str) -> List[str]:
    ids = [p.strip() for p in raw.split(",") if p.strip()]
    if len(ids) > MAX_EXCLUDE:
        raise HTTPException(status_code=422, detail=f"Send at most {MAX_EXCLUDE} ids in exclude.")
    if any(not _YT_ID.match(i) for i in ids):
        raise HTTPException(status_code=422, detail="exclude must be comma-separated YouTube ids.")
    return ids


def _unavailable(exc: Exception) -> HTTPException:
    logger.exception("Recommendation failed: %s", exc)
    return HTTPException(status_code=502, detail="Could not build recommendations right now. Try again in a moment.")


@router.get("/recs/next", response_model=Slate)
async def recs_next(
    seed: str = Query(..., pattern=YT_ID_PATTERN, description="YouTube id of the song that just played"),
    exclude: str = Query("", description="Comma-separated YouTube ids already queued or played"),
    limit: int = Query(15, ge=1, le=30),
    user: dict = Depends(get_current_user),
):
    """Autoplay picks to follow a song."""
    skip = _parse_exclude(exclude)
    try:
        return await surfaces.next_slate(user["user_id"], seed, skip, limit)
    except Exception as exc:
        raise _unavailable(exc)


@router.get("/recs/radio", response_model=Slate)
async def recs_radio(
    seed: str = Query(..., pattern=YT_ID_PATTERN),
    limit: int = Query(30, ge=1, le=50),
    user: dict = Depends(get_current_user),
):
    """Radio from a song, in flow order, seed not included."""
    try:
        slate = await surfaces.radio_slate(user["user_id"], seed, limit)
    except Exception as exc:
        raise _unavailable(exc)
    if not slate.items:  # an error lets the app fall back to /youtube/radio
        raise HTTPException(status_code=502, detail="Could not build radio for this song.")
    return slate


@router.post("/recs/shuffle", response_model=Slate)
async def recs_shuffle(body: ShuffleRequest, user: dict = Depends(get_current_user)):
    """Smart Shuffle: songs to mix into the current list."""
    try:
        return await surfaces.shuffle_slate(user["user_id"], body.current, body.context, body.exclude, body.limit)
    except Exception as exc:
        raise _unavailable(exc)


@router.post("/recs/playlist", response_model=Slate)
async def recs_playlist(body: PlaylistRequest, user: dict = Depends(get_current_user)):
    """Songs that fit a playlist."""
    try:
        return await surfaces.playlist_slate(user["user_id"], body.youtube_ids, body.exclude, body.limit)
    except Exception as exc:
        raise _unavailable(exc)


@router.get("/recs/home", response_model=HomeRecs)
async def recs_home(
    hour: int = Query(12, ge=0, le=23, description="The phone's local hour"),
    user: dict = Depends(get_current_user),
):
    """Home sections: mixes, New to you, Back on rotation, Because you played, the hour set."""
    try:
        return await surfaces.home_recs(user["user_id"], hour)
    except Exception as exc:
        raise _unavailable(exc)
