"""
Songs router — CRUD operations against Supabase `songs` table.
Songs are YouTube metadata — no file storage involved.
"""
from __future__ import annotations
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from auth import get_current_user
from db import get_supabase
from schemas import SongCreateRequest, SongResponse, MessageResponse

router = APIRouter()


@router.get("/", response_model=List[SongResponse])
async def list_songs(
    limit: int = Query(50, ge=1, le=100),
    offset: int = 0,
    genre: Optional[str] = None,
    language: Optional[str] = None,
):
    """List songs in catalogue. Optionally filter by genre or language."""
    supabase = get_supabase()
    query = supabase.table("songs").select("*")
    if genre:
        query = query.eq("genre", genre)
    if language:
        query = query.eq("language", language)
    result = query.range(offset, offset + limit - 1).execute()
    return result.data or []


@router.get("/{song_id}", response_model=SongResponse)
async def get_song(song_id: str):
    supabase = get_supabase()
    result = supabase.table("songs").select("*").eq("id", song_id).single().execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Song not found.")
    return result.data


@router.post("/", response_model=SongResponse, status_code=201)
async def create_song(
    body: SongCreateRequest,
    user: dict = Depends(get_current_user),
):
    """
    Save YouTube video metadata to the catalogue.
    Uses upsert on youtube_id to avoid duplicates.
    """
    supabase = get_supabase()
    payload = body.model_dump()
    result = (
        supabase.table("songs")
        .upsert(payload, on_conflict="youtube_id")
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=500, detail="Failed to save song.")
    return result.data[0]
