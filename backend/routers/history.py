"""
Play history router with capped per-user history and play_count updates.
"""
from __future__ import annotations

from collections import Counter
from datetime import datetime, timedelta, timezone
from typing import List, Literal, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query

from auth import get_current_user
from db import get_supabase
from schemas import (
    HistoryRequest,
    ListeningStatsResponse,
    MessageResponse,
    SongResponse,
    TopChannelResponse,
    TopSongResponse,
)

router = APIRouter()

MAX_HISTORY_ROWS = 200
RECENT_HISTORY_LIMIT = 50


def _trim_history(user_id: str) -> None:
    supabase = get_supabase()
    count_result = (
        supabase.table("play_history")
        .select("id", count="exact")
        .eq("user_id", user_id)
        .execute()
    )
    total_rows = count_result.count or 0
    excess = total_rows - MAX_HISTORY_ROWS

    if excess <= 0:
        return

    oldest_rows = (
        supabase.table("play_history")
        .select("id")
        .eq("user_id", user_id)
        .order("played_at")
        .range(0, excess - 1)
        .execute()
    )
    oldest_ids = [row["id"] for row in (oldest_rows.data or [])]
    if oldest_ids:
        supabase.table("play_history").delete().in_("id", oldest_ids).execute()


@router.post("", response_model=MessageResponse, status_code=201)
async def record_history(
    body: HistoryRequest,
    background_tasks: BackgroundTasks,
    user: dict = Depends(get_current_user),
):
    supabase = get_supabase()

    insert_result = (
        supabase.table("play_history")
        .insert({"user_id": user["user_id"], "song_id": body.song_id})
        .execute()
    )
    if not insert_result.data:
        raise HTTPException(status_code=500, detail="Failed to record play history.")

    song_result = supabase.table("songs").select("play_count").eq("id", body.song_id).single().execute()
    if song_result.data:
        next_play_count = int(song_result.data.get("play_count") or 0) + 1
        supabase.table("songs").update({"play_count": next_play_count}).eq("id", body.song_id).execute()

    background_tasks.add_task(_trim_history, user["user_id"])
    return {"message": "Play history recorded."}


@router.get("", response_model=List[SongResponse])
async def list_history(user: dict = Depends(get_current_user)):
    supabase = get_supabase()
    result = (
        supabase.table("play_history")
        .select("played_at, songs(*)")
        .eq("user_id", user["user_id"])
        .order("played_at", desc=True)
        .limit(RECENT_HISTORY_LIMIT)
        .execute()
    )

    songs = []
    for row in result.data or []:
        song = row.get("songs")
        if song:
            songs.append(song)

    return songs


STATS_RANGE_DAYS = {"short": 28, "medium": 180, "long": None}


def _history_songs_since(user_id: str, days: Optional[int]) -> List[dict]:
    """All history rows (with joined song) for a user, optionally within N days."""
    supabase = get_supabase()
    query = (
        supabase.table("play_history")
        .select("played_at, songs(*)")
        .eq("user_id", user_id)
        .order("played_at", desc=True)
    )
    if days is not None:
        cutoff = datetime.now(timezone.utc) - timedelta(days=days)
        query = query.gte("played_at", cutoff.isoformat())
    result = query.limit(MAX_HISTORY_ROWS).execute()
    return [row["songs"] for row in (result.data or []) if row.get("songs")]


def _top_songs(songs: List[dict], limit: int) -> List[dict]:
    counts = Counter(song["id"] for song in songs)
    by_id = {song["id"]: song for song in songs}
    return [{**by_id[song_id], "plays": plays} for song_id, plays in counts.most_common(limit)]


@router.get("/top", response_model=List[TopSongResponse])
async def top_songs(
    days: int = Query(30, ge=1, le=365),
    limit: int = Query(20, ge=1, le=50),
    min_plays: int = Query(2, ge=1),
    user: dict = Depends(get_current_user),
):
    """Most-played songs in the last N days ("On Repeat")."""
    songs = _history_songs_since(user["user_id"], days)
    return [song for song in _top_songs(songs, limit) if song["plays"] >= min_plays]


@router.get("/stats", response_model=ListeningStatsResponse)
async def listening_stats(
    range: Literal["short", "medium", "long"] = Query("short"),
    limit: int = Query(10, ge=1, le=50),
    user: dict = Depends(get_current_user),
):
    """Top songs and channels for the last 4 weeks / 6 months / all time."""
    songs = _history_songs_since(user["user_id"], STATS_RANGE_DAYS[range])

    channel_songs: dict[str, List[dict]] = {}
    for song in songs:
        channel_songs.setdefault(song.get("channel_name") or "Unknown", []).append(song)

    top_channels = []
    for channel, plays in Counter({c: len(s) for c, s in channel_songs.items()}).most_common(limit):
        top_song = _top_songs(channel_songs[channel], 1)[0]
        top_channels.append(
            TopChannelResponse(
                channel_name=channel,
                plays=plays,
                thumbnail_url=top_song.get("thumbnail_url"),
                top_song=top_song,
            )
        )

    return ListeningStatsResponse(
        total_plays=len(songs),
        top_songs=_top_songs(songs, limit),
        top_channels=top_channels,
    )
