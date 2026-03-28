"""
Play history router with capped per-user history and play_count updates.
"""
from __future__ import annotations

from typing import List

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException

from auth import get_current_user
from db import get_supabase
from schemas import HistoryRequest, MessageResponse, SongResponse

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


@router.post("/", response_model=MessageResponse, status_code=201)
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


@router.get("/", response_model=List[SongResponse])
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
