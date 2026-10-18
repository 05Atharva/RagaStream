"""
Playlists router with CRUD and ordered playlist-song management.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import List

from fastapi import APIRouter, Depends, HTTPException, Query

from auth import get_current_user
from db import get_supabase
from schemas import (
    AddSongToPlaylistRequest,
    BulkAddSongsRequest,
    BulkAddSongsResponse,
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
        .select("position, added_at, songs(*)")
        .eq("playlist_id", playlist_id)
        .order("position")
        .execute()
    )

    songs = []
    for row in playlist_song_rows.data or []:
        song = row.get("songs")
        if song:
            songs.append({**song, "added_at": row.get("added_at")})

    covers = [song["thumbnail_url"] for song in songs if song.get("thumbnail_url")][:4]
    return {**playlist, "songs": songs, "song_count": len(songs), "cover_thumbnails": covers}


@router.post("", response_model=PlaylistResponse, status_code=201)
async def create_playlist(
    body: PlaylistCreateRequest,
    user: dict = Depends(get_current_user),
):
    supabase = get_supabase()
    payload = {
        "user_id": user["user_id"],
        "name": body.name,
        "description": body.description or "",
    }
    result = supabase.table("playlists").insert(payload).execute()

    if not result.data:
        raise HTTPException(status_code=500, detail="Failed to create playlist.")

    return {**result.data[0], "songs": []}


@router.get("", response_model=List[PlaylistResponse])
async def list_playlists(user: dict = Depends(get_current_user)):
    """
    The user's playlists with song_count and cover_thumbnails, fetched in two
    queries total (instead of one detail request per playlist).
    """
    supabase = get_supabase()
    result = (
        supabase.table("playlists")
        .select("*")
        .eq("user_id", user["user_id"])
        .order("updated_at", desc=True)
        .execute()
    )
    playlists = result.data or []
    if not playlists:
        return []

    rows = (
        supabase.table("playlist_songs")
        .select("playlist_id, position, songs(thumbnail_url)")
        .in_("playlist_id", [p["id"] for p in playlists])
        .order("position")
        .execute()
    )
    counts: dict[str, int] = {}
    covers: dict[str, List[str]] = {}
    for row in rows.data or []:
        pid = row["playlist_id"]
        counts[pid] = counts.get(pid, 0) + 1
        thumb = (row.get("songs") or {}).get("thumbnail_url")
        if thumb and len(covers.setdefault(pid, [])) < 4:
            covers[pid].append(thumb)

    return [
        {**p, "song_count": counts.get(p["id"], 0), "cover_thumbnails": covers.get(p["id"], [])}
        for p in playlists
    ]


@router.get("/containing", response_model=List[str])
async def playlists_containing(
    youtube_id: str = Query(..., min_length=1),
    user: dict = Depends(get_current_user),
):
    """IDs of the user's playlists that already contain this YouTube video."""
    supabase = get_supabase()
    song = supabase.table("songs").select("id").eq("youtube_id", youtube_id).limit(1).execute()
    if not song.data:
        return []
    owned = supabase.table("playlists").select("id").eq("user_id", user["user_id"]).execute()
    owned_ids = [p["id"] for p in (owned.data or [])]
    if not owned_ids:
        return []
    rows = (
        supabase.table("playlist_songs")
        .select("playlist_id")
        .eq("song_id", song.data[0]["id"])
        .in_("playlist_id", owned_ids)
        .execute()
    )
    return [row["playlist_id"] for row in (rows.data or [])]


@router.get("/{playlist_id}", response_model=PlaylistResponse)
async def get_playlist(playlist_id: str, user: dict = Depends(get_current_user)):
    return _fetch_playlist_with_songs(playlist_id, user["user_id"])


@router.put("/{playlist_id}", response_model=PlaylistResponse)
async def update_playlist(
    playlist_id: str,
    body: PlaylistUpdateRequest,
    user: dict = Depends(get_current_user),
):
    _get_owned_playlist_or_404(playlist_id, user["user_id"])

    payload = body.model_dump(exclude_none=True)
    if not payload:
        raise HTTPException(status_code=400, detail="No playlist fields provided.")

    supabase = get_supabase()
    payload["updated_at"] = _utc_now_iso()
    result = (
        supabase.table("playlists")
        .update(payload)
        .eq("id", playlist_id)
        .eq("user_id", user["user_id"])
        .execute()
    )

    if not result.data:
        raise HTTPException(status_code=500, detail="Failed to update playlist.")

    return _fetch_playlist_with_songs(playlist_id, user["user_id"])


@router.delete("/{playlist_id}", response_model=MessageResponse)
async def delete_playlist(playlist_id: str, user: dict = Depends(get_current_user)):
    _get_owned_playlist_or_404(playlist_id, user["user_id"])
    supabase = get_supabase()
    supabase.table("playlists").delete().eq("id", playlist_id).eq("user_id", user["user_id"]).execute()
    return {"message": "Playlist deleted."}


@router.post("/{playlist_id}/songs", response_model=MessageResponse, status_code=201)
async def add_song_to_playlist(
    playlist_id: str,
    body: AddSongToPlaylistRequest,
    user: dict = Depends(get_current_user),
):
    _get_owned_playlist_or_404(playlist_id, user["user_id"])
    supabase = get_supabase()

    # Check if the song already exists in this playlist
    existing = (
        supabase.table("playlist_songs")
        .select("song_id")
        .eq("playlist_id", playlist_id)
        .eq("song_id", body.song_id)
        .execute()
    )
    if existing.data:
        raise HTTPException(
            status_code=409,
            detail="This song is already in the playlist.",
        )

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


@router.post("/{playlist_id}/songs/bulk", response_model=BulkAddSongsResponse, status_code=201)
async def bulk_add_songs_to_playlist(
    playlist_id: str,
    body: BulkAddSongsRequest,
    user: dict = Depends(get_current_user),
):
    """Append many songs in order, skipping any already in the playlist."""
    _get_owned_playlist_or_404(playlist_id, user["user_id"])
    supabase = get_supabase()

    existing = (
        supabase.table("playlist_songs")
        .select("song_id, position")
        .eq("playlist_id", playlist_id)
        .execute()
    )
    existing_rows = existing.data or []
    present = {row["song_id"] for row in existing_rows}
    next_position = max((row["position"] for row in existing_rows), default=-1) + 1

    to_add = []
    for song_id in dict.fromkeys(body.song_ids):   # dedupe, keep order
        if song_id not in present:
            to_add.append({"playlist_id": playlist_id, "song_id": song_id, "position": next_position})
            next_position += 1

    if to_add:
        supabase.table("playlist_songs").insert(to_add).execute()
        supabase.table("playlists").update({"updated_at": _utc_now_iso()}).eq("id", playlist_id).execute()

    return {"added": len(to_add), "skipped": len(body.song_ids) - len(to_add)}


@router.delete("/{playlist_id}/songs/{song_id}", response_model=MessageResponse)
async def remove_song_from_playlist(
    playlist_id: str,
    song_id: str,
    user: dict = Depends(get_current_user),
):
    _get_owned_playlist_or_404(playlist_id, user["user_id"])
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
    _get_owned_playlist_or_404(playlist_id, user["user_id"])
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
