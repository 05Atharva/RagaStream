"""
Songs router for Supabase-backed catalogue operations.
"""
from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, HTTPException, Query

from db import get_supabase
from schemas import GenreCountResponse, SongCreateRequest, SongResponse

router = APIRouter()
genres_router = APIRouter()


@router.get("/", response_model=List[SongResponse])
async def list_songs(
    limit: int = Query(20, ge=1, le=100, description="Page size"),
    offset: int = Query(0, ge=0, description="Pagination offset"),
    genre: Optional[str] = Query(None, description="Filter by genre"),
    language: Optional[str] = Query(None, description="Filter by language"),
):
    """Return a paginated songs catalogue with optional genre/language filters."""
    supabase = get_supabase()
    query = supabase.table("songs").select("*").order("added_at", desc=True)

    if genre:
        query = query.eq("genre", genre)
    if language:
        query = query.eq("language", language)

    result = query.range(offset, offset + limit - 1).execute()
    return result.data or []


@genres_router.get("/genres", response_model=List[GenreCountResponse])
async def list_genres():
    """Return each genre and its song count."""
    supabase = get_supabase()
    result = supabase.table("songs").select("genre").execute()
    rows = result.data or []

    genre_counts: dict[str, int] = {}
    for row in rows:
        genre = row.get("genre") or "Unknown"
        genre_counts[genre] = genre_counts.get(genre, 0) + 1

    return [
        GenreCountResponse(genre=genre, count=count)
        for genre, count in sorted(genre_counts.items(), key=lambda item: (-item[1], item[0]))
    ]


@router.get("/{song_id}", response_model=SongResponse)
async def get_song(song_id: str):
    """Return a single song by UUID."""
    supabase = get_supabase()
    result = supabase.table("songs").select("*").eq("id", song_id).single().execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Song not found.")
    return result.data


@router.post("/", response_model=SongResponse, status_code=201)
async def create_song(body: SongCreateRequest):
    """Save or update YouTube metadata in the songs catalogue."""
    supabase = get_supabase()
    payload = body.model_dump(exclude_none=True)
    result = supabase.table("songs").upsert(payload, on_conflict="youtube_id").execute()

    if not result.data:
        raise HTTPException(status_code=500, detail="Failed to save song.")

    return result.data[0]
