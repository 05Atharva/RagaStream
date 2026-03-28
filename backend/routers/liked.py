"""
Liked songs router for authenticated users.
"""
from __future__ import annotations

from typing import List

from fastapi import APIRouter, Depends, HTTPException

from auth import get_current_user
from db import get_supabase
from schemas import LikeRequest, MessageResponse, SongResponse

router = APIRouter()


@router.post("/", response_model=MessageResponse, status_code=201)
async def like_song(
    body: LikeRequest,
    user: dict = Depends(get_current_user),
):
    supabase = get_supabase()
    result = (
        supabase.table("liked_songs")
        .upsert(
            {"user_id": user["user_id"], "song_id": body.song_id},
            on_conflict="user_id,song_id",
        )
        .execute()
    )
    if result.data is None:
        raise HTTPException(status_code=500, detail="Failed to like song.")
    return {"message": "Song liked."}


@router.delete("/{song_id}", response_model=MessageResponse)
async def unlike_song(
    song_id: str,
    user: dict = Depends(get_current_user),
):
    supabase = get_supabase()
    supabase.table("liked_songs").delete().eq("user_id", user["user_id"]).eq("song_id", song_id).execute()
    return {"message": "Song unliked."}


@router.get("/", response_model=List[SongResponse])
async def list_liked_songs(user: dict = Depends(get_current_user)):
    supabase = get_supabase()
    result = (
        supabase.table("liked_songs")
        .select("liked_at, songs(*)")
        .eq("user_id", user["user_id"])
        .order("liked_at", desc=True)
        .execute()
    )

    songs = []
    for row in result.data or []:
        song = row.get("songs")
        if song:
            songs.append(song)

    return songs
