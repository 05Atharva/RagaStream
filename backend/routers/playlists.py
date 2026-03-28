"""
Playlists router — create, read, update, delete playlists and manage songs within them.
"""
from __future__ import annotations
from typing import List

from fastapi import APIRouter, Depends, HTTPException

from auth import get_current_user
from db import get_supabase
from schemas import (
    AddSongToPlaylistRequest,
    MessageResponse,
    PlaylistCreateRequest,
    PlaylistResponse,
)

router = APIRouter()


@router.get("/", response_model=List[PlaylistResponse])
async def list_playlists(user: dict = Depends(get_current_user)):
    supabase = get_supabase()
    result = (
        supabase.table("playlists")
        .select("*")
        .eq("owner_id", user["id"])
        .execute()
    )
    return result.data or []


@router.get("/{playlist_id}", response_model=PlaylistResponse)
async def get_playlist(playlist_id: str, user: dict = Depends(get_current_user)):
    supabase = get_supabase()
    result = supabase.table("playlists").select("*, songs(*)").eq("id", playlist_id).single().execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Playlist not found.")
    return result.data


@router.post("/", response_model=PlaylistResponse, status_code=201)
async def create_playlist(body: PlaylistCreateRequest, user: dict = Depends(get_current_user)):
    supabase = get_supabase()
    payload = {**body.model_dump(), "owner_id": user["id"]}
    result = supabase.table("playlists").insert(payload).execute()
    if not result.data:
        raise HTTPException(status_code=500, detail="Failed to create playlist.")
    return result.data[0]


@router.post("/{playlist_id}/songs", response_model=MessageResponse, status_code=201)
async def add_song_to_playlist(
    playlist_id: str,
    body: AddSongToPlaylistRequest,
    user: dict = Depends(get_current_user),
):
    supabase = get_supabase()
    # Get current max position
    pos_result = (
        supabase.table("playlist_songs")
        .select("position")
        .eq("playlist_id", playlist_id)
        .order("position", desc=True)
        .limit(1)
        .execute()
    )
    next_pos = (pos_result.data[0]["position"] + 1) if pos_result.data else 0
    supabase.table("playlist_songs").insert(
        {"playlist_id": playlist_id, "song_id": body.song_id, "position": next_pos}
    ).execute()
    return {"message": "Song added to playlist."}


@router.delete("/{playlist_id}/songs/{song_id}", response_model=MessageResponse)
async def remove_song_from_playlist(
    playlist_id: str,
    song_id: str,
    user: dict = Depends(get_current_user),
):
    supabase = get_supabase()
    supabase.table("playlist_songs").delete().eq("playlist_id", playlist_id).eq("song_id", song_id).execute()
    return {"message": "Song removed from playlist."}


@router.delete("/{playlist_id}", response_model=MessageResponse)
async def delete_playlist(playlist_id: str, user: dict = Depends(get_current_user)):
    supabase = get_supabase()
    supabase.table("playlists").delete().eq("id", playlist_id).eq("owner_id", user["id"]).execute()
    return {"message": "Playlist deleted."}
