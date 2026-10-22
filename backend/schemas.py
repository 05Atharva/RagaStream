"""
Pydantic schemas for API request/response serialisation.
"""
from __future__ import annotations
from typing import Optional, List
from pydantic import BaseModel, Field


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
    audio_path: str        # signed relay path: /youtube/audio/{id}?exp=…&sig=…
    title: str
    channel: str
    duration: int
    thumbnail: str
    expires_in: int        # seconds until the audio link expires


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
    added_at: Optional[str] = None   # when it was added to the playlist / liked


class SongCreateRequest(BaseModel):
    # Shared catalogue: bound every field so one account can't store junk for everyone.
    youtube_id: str = Field(min_length=1, max_length=32, pattern=r"^[A-Za-z0-9_-]+$")
    title: str = Field(min_length=1, max_length=300)
    channel_name: str = Field(min_length=1, max_length=200)
    thumbnail_url: Optional[str] = Field(default=None, max_length=500)
    duration_sec: Optional[int] = Field(default=None, ge=0, le=86_400)
    language: Optional[str] = Field(default=None, max_length=50)
    genre: Optional[str] = Field(default=None, max_length=50)


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
    song_count: Optional[int] = None
    cover_thumbnails: Optional[List[str]] = None   # first 4 song thumbnails, for mosaics
    updated_at: Optional[str] = None
    created_at: Optional[str] = None


class PlaylistCreateRequest(BaseModel):
    name: str
    description: Optional[str] = None


class PlaylistUpdateRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None


class AddSongToPlaylistRequest(BaseModel):
    song_id: str


class ReorderPlaylistSongsRequest(BaseModel):
    song_ids: List[str]


class BulkAddSongsRequest(BaseModel):
    song_ids: List[str]


class BulkAddSongsResponse(BaseModel):
    added: int
    skipped: int


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


class TopSongResponse(SongResponse):
    plays: int


class TopChannelResponse(BaseModel):
    channel_name: str
    plays: int
    thumbnail_url: Optional[str] = None
    top_song: SongResponse


class ListeningStatsResponse(BaseModel):
    total_plays: int
    top_songs: List[TopSongResponse]
    top_channels: List[TopChannelResponse]


# ---------------------------------------------------------------------------
# Media (lyrics, artwork colour)
# ---------------------------------------------------------------------------

class LyricLine(BaseModel):
    time: float     # seconds
    text: str


class LyricsResponse(BaseModel):
    synced: bool
    lines: List[LyricLine]
    plain: Optional[str] = None
    track_name: str
    artist_name: str
    source: str


class ArtworkColorResponse(BaseModel):
    accent: str        # vivid, for highlights
    background: str    # dark tint, for gradients behind content
    muted: str         # near-black tint, for mini player / deep surfaces


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
