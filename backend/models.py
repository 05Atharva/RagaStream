"""
Pydantic models representing the shapes of Supabase database tables.
These are used internally to type-check data returned from Supabase.
"""
from __future__ import annotations
from typing import Optional
from pydantic import BaseModel
from datetime import datetime


class SongModel(BaseModel):
    id: str
    youtube_id: str
    title: str
    channel_name: str
    thumbnail_url: Optional[str] = None
    duration_sec: Optional[int] = None
    language: Optional[str] = None
    genre: Optional[str] = None
    play_count: int = 0
    added_at: Optional[datetime] = None


class PlaylistModel(BaseModel):
    id: str
    name: str
    description: Optional[str] = None
    user_id: str
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class PlaylistSongModel(BaseModel):
    id: str
    playlist_id: str
    song_id: str
    position: int
    added_at: Optional[datetime] = None


class LikedSongModel(BaseModel):
    id: str
    user_id: str
    song_id: str
    liked_at: Optional[datetime] = None


class PlayHistoryModel(BaseModel):
    id: str
    user_id: str
    song_id: str
    played_at: Optional[datetime] = None


class UserProfileModel(BaseModel):
    id: str
    email: Optional[str] = None
    display_name: Optional[str] = None
    avatar_url: Optional[str] = None
    is_admin: bool = False
    created_at: Optional[datetime] = None
