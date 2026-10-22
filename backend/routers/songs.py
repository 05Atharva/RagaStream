"""
Songs router for Supabase-backed catalogue operations.
"""
from __future__ import annotations

from typing import List, Optional
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException, Query

from auth import get_current_user
from db import get_supabase
from schemas import GenreCountResponse, SongCreateRequest, SongResponse

router = APIRouter()
genres_router = APIRouter()


@router.get("", response_model=List[SongResponse])
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


@genres_router.get("", response_model=List[GenreCountResponse])
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


_ALLOWED_THUMB_HOSTS = (".ytimg.com", ".ggpht.com", ".googleusercontent.com")


def _safe_thumbnail(url: Optional[str]) -> Optional[str]:
    """Only YouTube image hosts: the catalogue is shared, so a thumbnail must not point anywhere else."""
    if not url:
        return None
    parsed = urlparse(url)
    host = (parsed.hostname or "").lower()
    ok = parsed.scheme == "https" and any(host == s.lstrip(".") or host.endswith(s) for s in _ALLOWED_THUMB_HOSTS)
    return url if ok else None


@router.post("", response_model=SongResponse, status_code=201)
async def create_song(body: SongCreateRequest, user: dict = Depends(get_current_user)):
    """Add a YouTube song to the shared catalogue, or return it if it's already there.

    The catalogue is shared by every account, so an existing row is never changed here:
    otherwise any signed-in user could rename or re-thumbnail songs in everyone's library."""
    supabase = get_supabase()
    existing = supabase.table("songs").select("*").eq("youtube_id", body.youtube_id).limit(1).execute()
    if existing.data:
        return existing.data[0]

    payload = body.model_dump(exclude_none=True)
    payload["thumbnail_url"] = _safe_thumbnail(body.thumbnail_url)
    try:
        result = supabase.table("songs").insert(payload).execute()
    except Exception:
        # Someone else catalogued it between our read and insert: return their row.
        result = supabase.table("songs").select("*").eq("youtube_id", body.youtube_id).limit(1).execute()

    if not result.data:
        raise HTTPException(status_code=500, detail="Failed to save song.")

    return result.data[0]
