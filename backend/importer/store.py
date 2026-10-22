"""Database side of an import: catalogue songs (insert-only, like POST /songs) and the playlist."""
from __future__ import annotations

import logging
from typing import List, Optional

from db import get_supabase

logger = logging.getLogger(__name__)

CHUNK = 200


class SupabaseStore:
    def ensure_song(self, meta: dict) -> dict:
        """The catalogue row for this YouTube video. An existing row is never changed
        (the catalogue is shared by every account); a missing one is inserted."""
        from routers.songs import _safe_thumbnail

        supabase = get_supabase()
        existing = supabase.table("songs").select("*").eq("youtube_id", meta["youtube_id"]).limit(1).execute()
        if existing.data:
            return existing.data[0]
        payload = {
            "youtube_id": meta["youtube_id"][:32],
            "title": (meta.get("title") or "Unknown")[:300],
            "channel_name": (meta.get("channel_name") or "Unknown")[:200],
            "thumbnail_url": _safe_thumbnail(meta.get("thumbnail_url")),
            "duration_sec": meta.get("duration_sec") or None,
        }
        payload = {k: v for k, v in payload.items() if v is not None}
        try:
            result = supabase.table("songs").insert(payload).execute()
        except Exception:
            # Someone catalogued it between our read and insert: use their row.
            result = supabase.table("songs").select("*").eq("youtube_id", meta["youtube_id"]).limit(1).execute()
        if not result.data:
            raise RuntimeError("Could not save song")
        return result.data[0]

    def create_playlist(self, user_id: str, name: str, description: Optional[str], song_ids: List[str]) -> str:
        supabase = get_supabase()
        created = supabase.table("playlists").insert(
            {"user_id": user_id, "name": name, "description": description or ""}
        ).execute()
        if not created.data:
            raise RuntimeError("Could not create playlist")
        playlist_id = created.data[0]["id"]
        rows = [{"playlist_id": playlist_id, "song_id": sid, "position": i} for i, sid in enumerate(song_ids)]
        try:
            for start in range(0, len(rows), CHUNK):
                supabase.table("playlist_songs").insert(rows[start:start + CHUNK]).execute()
        except Exception:
            # Do not leave a half-filled playlist behind.
            try:
                supabase.table("playlists").delete().eq("id", playlist_id).eq("user_id", user_id).execute()
            except Exception:
                logger.warning("Import: could not clean up playlist after a failed insert")
            raise
        return playlist_id
