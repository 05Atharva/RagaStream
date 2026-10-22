"""API models for /recs/* (docs/RECOMMENDATIONS.md, API)."""
from __future__ import annotations

from typing import Annotated, List, Literal, Optional

from pydantic import BaseModel, Field, StringConstraints

YT_ID_PATTERN = r"^[A-Za-z0-9_-]{1,32}$"
YouTubeId = Annotated[str, StringConstraints(pattern=YT_ID_PATTERN)]

ReasonCode = Literal["seed", "session", "taste", "walk", "channel", "rediscover", "catalogue", "discover"]
SectionKind = Literal["mix", "discover", "rediscover", "because", "hour"]


class RecItem(BaseModel):
    youtube_id: str
    title: str
    channel: str
    duration: int
    thumbnail: str
    reason: str
    reason_code: ReasonCode


class Slate(BaseModel):
    rec_id: str
    surface: str
    items: List[RecItem]


class HomeSection(BaseModel):
    id: str
    kind: SectionKind
    title: str
    subtitle: str = ""
    seed: Optional[RecItem] = None
    rec_id: str
    items: List[RecItem]


class HomeRecs(BaseModel):
    generated_at: str
    sections: List[HomeSection]


class ShuffleRequest(BaseModel):
    current: Optional[YouTubeId] = None
    context: List[YouTubeId] = Field(default_factory=list, max_length=200)
    exclude: List[YouTubeId] = Field(default_factory=list, max_length=200)
    limit: int = Field(default=15, ge=1, le=30)


class PlaylistRequest(BaseModel):
    youtube_ids: List[YouTubeId] = Field(max_length=200)
    exclude: List[YouTubeId] = Field(default_factory=list, max_length=200)
    limit: int = Field(default=15, ge=1, le=30)
