"""Pydantic models for /import/*. Shapes are a contract with the frontend: change them together."""
from __future__ import annotations

from typing import List, Literal, Optional

from pydantic import BaseModel, Field, model_validator

from schemas import SongResponse

MAX_TRACKS = 500
MAX_URL_CHARS = 2048
MAX_TEXT_CHARS = 100_000

SourceName = Literal["spotify", "youtube", "apple_music", "jsonld", "text"]
JobStatus = Literal["queued", "matching", "creating", "done", "failed"]
ItemStatus = Literal["pending", "matched", "not_found"]


class _UrlOrText(BaseModel):
    url: Optional[str] = Field(default=None, max_length=MAX_URL_CHARS)
    text: Optional[str] = Field(default=None, max_length=MAX_TEXT_CHARS)

    @model_validator(mode="after")
    def _exactly_one(self):
        has_url = bool(self.url and self.url.strip())
        has_text = bool(self.text and self.text.strip())
        if has_url == has_text:
            raise ValueError("Send either a link or a pasted song list, not both and not neither.")
        return self


class ImportPreviewRequest(_UrlOrText):
    pass


class ImportJobRequest(_UrlOrText):
    name: Optional[str] = Field(default=None, max_length=100)
    description: Optional[str] = Field(default=None, max_length=500)


class ImportTrack(BaseModel):
    index: int
    title: str
    artists: List[str] = []
    album: Optional[str] = None
    duration_sec: Optional[int] = None
    youtube_id: Optional[str] = None      # set only when the source is YouTube itself


class ImportPreview(BaseModel):
    source: SourceName
    name: str
    description: Optional[str] = None
    cover_url: Optional[str] = None
    owner: Optional[str] = None
    track_count: int
    partial: bool = False
    note: Optional[str] = None
    tracks: List[ImportTrack]


class ImportJobItem(BaseModel):
    index: int
    title: str
    artists: List[str] = []
    status: ItemStatus = "pending"
    song: Optional[SongResponse] = None
    confidence: Optional[float] = None


class ImportJob(BaseModel):
    job_id: str
    status: JobStatus
    name: str
    source: SourceName
    total: int
    matched: int
    not_found: int
    playlist_id: Optional[str] = None
    error: Optional[str] = None
    items: List[ImportJobItem]


class JobCreated(BaseModel):
    job_id: str
