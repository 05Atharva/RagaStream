"""
Playlists router with CRUD and ordered playlist-song management.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import List

from fastapi import APIRouter, Depends, HTTPException

from auth import get_current_user
from db import get_supabase
from schemas import (
    AddSongToPlaylistRequest,
    MessageResponse,
    PlaylistCreateRequest,
    PlaylistResponse,
    PlaylistUpdateRequest,
    ReorderPlaylistSongsRequest,
)

router = APIRouter()


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _get_owned_playlist_or_404(playlist_id: str, user_id: str) -> dict:
    supabase = get_supabase()
    result = (
        supabase.table("playlists")
        .select("*")
        .eq("id", playlist_id)
        .eq("user_id", user_id)
        .single()
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Playlist not found.")
    return result.data


def _fetch_playlist_with_songs(playlist_id: str, user_id: str) -> dict:
    playlist = _get_owned_playlist_or_404(playlist_id, user_id)
    supabase = get_supabase()
    playlist_song_rows = (
        supabase.table("playlist_songs")
        .select("position, songs(*)")
        .eq("playlist_id", playlist_id)
        .order("position")
        .execute()
    )

    songs = []
    for row in playlist_song_rows.data or []:
        song = row.get("songs")
        if song:
            songs.append(song)

    return {**playlist, "songs": songs}


@router.post("/", response_model=PlaylistResponse, status_code=201)
async def create_playlist(
    body: PlaylistCreateRequest,
    user: dict = Depends(get_current_user),
):
    supabase = get_supabase()
    payload = {
        "user_id": user["id"],
        "name": body.name,
        "description": body.description or "",
    }
    result = supabase.table("playlists").insert(payload).execute()

    if not result.data:
        raise HTTPException(status_code=500, detail="Failed to create playlist.")

    return {**result.data[0], "songs": []}


@router.get("/", response_model=List[PlaylistResponse])
async def list_playlists(user: dict = Depends(get_current_user)):
    supabase = get_supabase()
    result = (
        supabase.table("playlists")
        .select("*")
        .eq("user_id", user["id"])
        .order("updated_at", desc=True)
        .execute()
    )
    return result.data or []


@router.get("/{playlist_id}", response_model=PlaylistResponse)
async def get_playlist(playlist_id: str, user: dict = Depends(get_current_user)):
    return _fetch_playlist_with_songs(playlist_id, user["id"])


@router.put("/{playlist_id}", response_model=PlaylistResponse)
async def update_playlist(
    playlist_id: str,
    body: PlaylistUpdateRequest,
    user: dict = Depends(get_current_user),
):
    _get_owned_playlist_or_404(playlist_id, user["id"])

    payload = body.model_dump(exclude_none=True)
    if not payload:
        raise HTTPException(status_code=400, detail="No playlist fields provided.")

    supabase = get_supabase()
    payload["updated_at"] = _utc_now_iso()
    result = (
        supabase.table("playlists")
        .update(payload)
        .eq("id", playlist_id)
        .eq("user_id", user["id"])
        .execute()
    )

    if not result.data:
        raise HTTPException(status_code=500, detail="Failed to update playlist.")

    return _fetch_playlist_with_songs(playlist_id, user["id"])


@router.delete("/{playlist_id}", response_model=MessageResponse)
async def delete_playlist(playlist_id: str, user: dict = Depends(get_current_user)):
    _get_owned_playlist_or_404(playlist_id, user["id"])
    supabase = get_supabase()
    supabase.table("playlists").delete().eq("id", playlist_id).eq("user_id", user["id"]).execute()
    return {"message": "Playlist deleted."}


@router.post("/{playlist_id}/songs", response_model=MessageResponse, status_code=201)
async def add_song_to_playlist(
    playlist_id: str,
    body: AddSongToPlaylistRequest,
    user: dict = Depends(get_current_user),
):
    _get_owned_playlist_or_404(playlist_id, user["id"])
    supabase = get_supabase()

    pos_result = (
        supabase.table("playlist_songs")
        .select("position")
        .eq("playlist_id", playlist_id)
        .order("position", desc=True)
        .limit(1)
        .execute()
    )
    next_position = (pos_result.data[0]["position"] + 1) if pos_result.data else 0

    result = (
        supabase.table("playlist_songs")
        .insert(
            {
                "playlist_id": playlist_id,
                "song_id": body.song_id,
                "position": next_position,
            }
        )
        .execute()
    )

    if not result.data:
        raise HTTPException(status_code=500, detail="Failed to add song to playlist.")

    supabase.table("playlists").update({"updated_at": _utc_now_iso()}).eq("id", playlist_id).execute()
    return {"message": "Song added to playlist."}


@router.delete("/{playlist_id}/songs/{song_id}", response_model=MessageResponse)
async def remove_song_from_playlist(
    playlist_id: str,
    song_id: str,
    user: dict = Depends(get_current_user),
):
    _get_owned_playlist_or_404(playlist_id, user["id"])
    supabase = get_supabase()
    supabase.table("playlist_songs").delete().eq("playlist_id", playlist_id).eq("song_id", song_id).execute()
    supabase.table("playlists").update({"updated_at": _utc_now_iso()}).eq("id", playlist_id).execute()
    return {"message": "Song removed from playlist."}


@router.put("/{playlist_id}/songs/reorder", response_model=MessageResponse)
async def reorder_playlist_songs(
    playlist_id: str,
    body: ReorderPlaylistSongsRequest,
    user: dict = Depends(get_current_user),
):
    _get_owned_playlist_or_404(playlist_id, user["id"])
    supabase = get_supabase()

    existing_rows = (
        supabase.table("playlist_songs")
        .select("song_id")
        .eq("playlist_id", playlist_id)
        .execute()
    )
    existing_song_ids = {row["song_id"] for row in (existing_rows.data or [])}
    requested_song_ids = body.song_ids

    if set(requested_song_ids) != existing_song_ids or len(requested_song_ids) != len(existing_song_ids):
        raise HTTPException(
            status_code=400,
            detail="song_ids must contain every playlist song exactly once.",
        )

    for index, song_id in enumerate(requested_song_ids):
        supabase.table("playlist_songs").update({"position": index}).eq("playlist_id", playlist_id).eq(
            "song_id", song_id
        ).execute()

    supabase.table("playlists").update({"updated_at": _utc_now_iso()}).eq("id", playlist_id).execute()
    return {"message": "Playlist songs reordered."}
