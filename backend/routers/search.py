"""
Search router — full-text search across Supabase songs + YouTube.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from auth import get_current_user
from db import get_supabase
from routers.youtube import search_youtube
from schemas import SearchResponse, SongResponse

router = APIRouter()


@router.get("/", response_model=SearchResponse)
async def search(
    q: str = Query(..., min_length=1, description="Search query"),
    limit: int = Query(8, ge=1, le=20),
    user: dict = Depends(get_current_user),
):
    """
    Simultaneously searches:
    - Supabase `songs` table (title/artist full-text)
    - YouTube via yt-dlp
    """
    import asyncio

    supabase = get_supabase()

    async def _db_search():
        result = (
            supabase.table("songs")
            .select("*")
            .or_(f"title.ilike.%{q}%,artist.ilike.%{q}%")
            .limit(limit)
            .execute()
        )
        return [SongResponse(**row) for row in (result.data or [])]

    db_results, yt_results = await asyncio.gather(
        _db_search(),
        search_youtube(q=q, limit=limit),
    )

    return SearchResponse(songs=db_results, youtube_results=yt_results)
