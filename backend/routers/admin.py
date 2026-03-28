"""
Admin router — privileged operations (admin only).
"""
from __future__ import annotations
from typing import List

from fastapi import APIRouter, Depends, HTTPException

from auth import get_current_admin
from db import get_supabase
from schemas import MessageResponse, SongResponse

router = APIRouter()


@router.get("/songs", response_model=List[SongResponse])
async def admin_list_songs(
    limit: int = 100,
    offset: int = 0,
    admin: dict = Depends(get_current_admin),
):
    """List all songs (admin only)."""
    supabase = get_supabase()
    result = supabase.table("songs").select("*").range(offset, offset + limit - 1).execute()
    return result.data or []


@router.delete("/songs/{song_id}", response_model=MessageResponse)
async def admin_delete_song(song_id: str, admin: dict = Depends(get_current_admin)):
    """Delete any song regardless of owner (admin only)."""
    supabase = get_supabase()
    supabase.table("songs").delete().eq("id", song_id).execute()
    return {"message": f"Song {song_id} deleted by admin."}


@router.get("/users", response_model=List[dict])
async def admin_list_users(admin: dict = Depends(get_current_admin)):
    """List user profiles (admin only)."""
    supabase = get_supabase()
    result = supabase.table("user_profiles").select("*").execute()
    return result.data or []


@router.post("/users/{user_id}/promote", response_model=MessageResponse)
async def promote_user(user_id: str, admin: dict = Depends(get_current_admin)):
    """Grant admin role to a user."""
    supabase = get_supabase()
    supabase.table("user_profiles").update({"is_admin": True}).eq("id", user_id).execute()
    return {"message": f"User {user_id} promoted to admin."}
