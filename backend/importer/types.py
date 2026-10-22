"""Internal shapes shared by the source adapters, the matcher and the job runner."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import List, Optional


@dataclass
class SourceTrack:
    title: str
    artists: List[str] = field(default_factory=list)
    album: Optional[str] = None
    duration_sec: Optional[int] = None
    youtube_id: Optional[str] = None       # set only when the source is YouTube itself
    channel: Optional[str] = None          # YouTube sources: uploader, kept for the catalogue
    thumbnail: Optional[str] = None
    alt_title: Optional[str] = None        # pasted "A - B": the other reading (B is the song)
    alt_artists: List[str] = field(default_factory=list)


@dataclass
class SourceData:
    source: str                            # spotify | youtube | apple_music | jsonld | text
    name: str
    tracks: List[SourceTrack]
    description: Optional[str] = None
    cover_url: Optional[str] = None
    owner: Optional[str] = None
    partial: bool = False
    note: Optional[str] = None
