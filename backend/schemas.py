"""
Pydantic schemas for API request/response serialisation.
"""
from __future__ import annotations
from typing import Optional, List
from pydantic import BaseModel


# ---------------------------------------------------------------------------
# YouTube
# ---------------------------------------------------------------------------

class YouTubeSearchResult(BaseModel):
    youtube_id: str
    title: str
    channel: str
    duration: int          # seconds
    thumbnail: str


class YouTubeStreamResponse(BaseModel):
    stream_url: str
    title: str
    duration: int
    thumbnail: str
    expires_in: int        # seconds until cache expiry


# ---------------------------------------------------------------------------
# Songs (YouTube metadata stored in Supabase)
# ---------------------------------------------------------------------------

class SongResponse(BaseModel):
    id: str
    youtube_id: str
    title: str
    channel_name: str
    thumbnail_url: Optional[str] = None
    duration_sec: Optional[int] = None
    language: Optional[str] = None
    genre: Optional[str] = None
    play_count: int = 0


class SongCreateRequest(BaseModel):
    youtube_id: str
    title: str
    channel_name: str
    thumbnail_url: Optional[str] = None
    duration_sec: Optional[int] = None
    language: Optional[str] = None
    genre: Optional[str] = None


class GenreCountResponse(BaseModel):
    genre: str
    count: int


# ---------------------------------------------------------------------------
# Playlists
# ---------------------------------------------------------------------------

class PlaylistResponse(BaseModel):
    id: str
    name: str
    description: Optional[str] = None
    user_id: str
    songs: Optional[List[SongResponse]] = None


class PlaylistCreateRequest(BaseModel):
    name: str
    description: Optional[str] = None


class AddSongToPlaylistRequest(BaseModel):
    song_id: str


# ---------------------------------------------------------------------------
# Liked Songs
# ---------------------------------------------------------------------------

class LikeRequest(BaseModel):
    song_id: str


# ---------------------------------------------------------------------------
# Play History
# ---------------------------------------------------------------------------

class HistoryRequest(BaseModel):
    song_id: str


# ---------------------------------------------------------------------------
# Search
# ---------------------------------------------------------------------------

class SearchResponse(BaseModel):
    songs: List[SongResponse]


# ---------------------------------------------------------------------------
# Generic
# ---------------------------------------------------------------------------

class MessageResponse(BaseModel):
    message: str
