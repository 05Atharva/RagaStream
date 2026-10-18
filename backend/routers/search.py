"""
Search router for songs catalogue queries.
"""
from __future__ import annotations

import re

from fastapi import APIRouter, Query

from db import get_supabase
from schemas import SearchResponse

router = APIRouter()


@router.get("/", response_model=SearchResponse)
async def search_songs(
    q: str = Query(..., min_length=1, description="Search query"),
    limit: int = Query(20, ge=1, le=100, description="Max results"),
):
    """
    Search songs by title or channel_name using ilike matching.
    """
    # Commas, parentheses and dots are PostgREST filter syntax inside or_();
    # strip them (and ilike wildcards) so user input can't break the filter.
    term = re.sub(r"[,()%*.:\\\"]", " ", q).strip()
    if not term:
        return SearchResponse(songs=[])

    supabase = get_supabase()
    result = (
        supabase.table("songs")
        .select("*")
        .or_(f"title.ilike.*{term}*,channel_name.ilike.*{term}*")
        .limit(limit)
        .execute()
    )

    return SearchResponse(songs=result.data or [])
