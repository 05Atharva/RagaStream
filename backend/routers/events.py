"""
Recommendation signals: listening events, explicit feedback (hide) and metrics.

Mounted at the app root (no prefix). See docs/RECOMMENDATIONS.md.
"""
from __future__ import annotations

import logging
import time
import uuid
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Literal, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field, field_validator

from auth import get_current_user
from db import get_supabase

logger = logging.getLogger(__name__)
router = APIRouter()

MAX_EVENTS_PER_USER = 5000
TRIM_INTERVAL_SECONDS = 10 * 60
MAX_BACKDATE = timedelta(days=7)
METRICS_ROW_LIMIT = 5000
METRICS_WINDOWS = (7, 28)
SKIP_EARLY_SECONDS = 30
REC_SURFACES = {"autoplay", "radio", "smart_shuffle", "home", "playlist_recs"}

EventKind = Literal["start", "skip", "complete", "like", "unlike", "save", "queue", "hide"]
Surface = Literal[
    "autoplay", "radio", "smart_shuffle", "home", "playlist_recs", "search",
    "library", "playlist", "liked", "channel", "queue", "other",
]
TargetType = Literal["song", "channel"]


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class Event(BaseModel):
    youtube_id: str = Field(min_length=1, max_length=32, pattern=r"^[A-Za-z0-9_-]+$")
    event: EventKind
    surface: Surface = "other"
    context_id: Optional[str] = Field(default=None, max_length=128)
    rec_id: Optional[str] = Field(default=None, max_length=128)
    song_id: Optional[str] = None
    listened_sec: Optional[float] = Field(default=None, ge=0)
    duration_sec: Optional[float] = Field(default=None, ge=0)
    local_hour: Optional[int] = Field(default=None, ge=0, le=23)
    at: Optional[datetime] = None

    @field_validator("song_id", mode="before")
    @classmethod
    def _drop_bad_song_id(cls, value: Any) -> Optional[str]:
        """A song_id that isn't a UUID is dropped, not rejected."""
        try:
            return str(uuid.UUID(str(value))) if value else None
        except ValueError:
            return None


class EventsRequest(BaseModel):
    events: List[Event] = Field(min_length=1, max_length=50)


class EventsAccepted(BaseModel):
    accepted: int


class FeedbackRequest(BaseModel):
    target_type: TargetType
    target_id: str = Field(min_length=1, max_length=200)
    kind: Literal["hide"] = "hide"
    label: Optional[str] = Field(default=None, max_length=200)


class FeedbackResponse(BaseModel):
    target_type: TargetType
    target_id: str
    kind: str
    label: Optional[str] = None
    created_at: Optional[str] = None


class SurfaceMetrics(BaseModel):
    surface: str
    starts: int
    skip_rate_30s: Optional[float] = None    # skips under 30 s / starts
    completion_rate: Optional[float] = None  # completes / starts
    saves_per_100: Optional[float] = None    # (saves + likes) per 100 starts


class WindowMetrics(BaseModel):
    days: int
    starts: int
    rec_share: Optional[float] = None        # share of starts from recommendation surfaces
    surfaces: List[SurfaceMetrics]


class MetricsResponse(BaseModel):
    windows: List[WindowMetrics]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _invalidate(user_id: str, home: bool = True) -> None:
    """Clear the engine's cached profile (and Home, unless home=False) for this user."""
    try:
        from recs import invalidate_user
        invalidate_user(user_id, home=home)
    except ImportError:
        pass
    except Exception:
        logger.warning("Could not invalidate recs cache", exc_info=True)


def _features_for(rec_id: str, youtube_id: str) -> Optional[dict]:
    try:
        from recs import features_for
        return features_for(rec_id, youtube_id)
    except ImportError:
        return None
    except Exception:
        logger.warning("Could not look up slate features", exc_info=True)
        return None


def _clamp_time(at: Optional[datetime], now: datetime) -> datetime:
    if at is None:
        return now
    if at.tzinfo is None:
        at = at.replace(tzinfo=timezone.utc)
    return min(max(at, now - MAX_BACKDATE), now)


def _event_row(user_id: str, event: Event, now: datetime) -> dict:
    features = _features_for(event.rec_id, event.youtube_id) if event.rec_id else None
    return {
        "user_id": user_id,
        "youtube_id": event.youtube_id,
        "song_id": event.song_id,
        "event": event.event,
        "surface": event.surface,
        "context_id": event.context_id,
        "rec_id": event.rec_id,
        "listened_sec": event.listened_sec,
        "duration_sec": event.duration_sec,
        "local_hour": event.local_hour,
        "features": features,
        "created_at": _clamp_time(event.at, now).isoformat(),
    }


_last_trim: Dict[str, float] = {}


def _trim_events(user_id: str) -> None:
    """Keep the newest MAX_EVENTS_PER_USER events; checked at most every 10 minutes per user."""
    now = time.monotonic()
    last = _last_trim.get(user_id)
    if last is not None and now - last < TRIM_INTERVAL_SECONDS:
        return
    _last_trim[user_id] = now
    try:
        supabase = get_supabase()
        count = (
            supabase.table("listening_events")
            .select("id", count="exact")
            .eq("user_id", user_id)
            .limit(1)
            .execute()
        ).count or 0
        excess = count - MAX_EVENTS_PER_USER
        if excess <= 0:
            return
        oldest = (
            supabase.table("listening_events")
            .select("id")
            .eq("user_id", user_id)
            .order("created_at")
            .range(0, excess - 1)
            .execute()
        )
        ids = [row["id"] for row in (oldest.data or [])]
        for i in range(0, len(ids), 200):
            (
                supabase.table("listening_events")
                .delete()
                .eq("user_id", user_id)
                .in_("id", ids[i:i + 200])
                .execute()
            )
    except Exception:
        logger.warning("Could not trim listening events", exc_info=True)


# ---------------------------------------------------------------------------
# Events
# ---------------------------------------------------------------------------

@router.post("/events", response_model=EventsAccepted, status_code=202)
async def record_events(
    body: EventsRequest,
    background_tasks: BackgroundTasks,
    user: dict = Depends(get_current_user),
):
    user_id = user["user_id"]
    now = datetime.now(timezone.utc)
    rows = [_event_row(user_id, event, now) for event in body.events]
    table = get_supabase().table("listening_events")
    try:
        table.insert(rows).execute()
    except Exception as exc:
        # One song_id missing from the catalogue fails the whole batch (FK), and the
        # app would retry it forever. song_id is optional, so retry without it.
        logger.warning("Could not store listening events, retrying without song ids: %s", exc)
        try:
            get_supabase().table("listening_events").insert([{**r, "song_id": None} for r in rows]).execute()
        except Exception as retry_exc:
            logger.warning("Could not store listening events: %s", retry_exc)
            raise HTTPException(
                status_code=500,
                detail="Could not save listening events. Check that recs_schema.sql has been run, then retry.",
            ) from retry_exc

    # New listening events refresh the profile (so the session steers the next
    # slate) but not Home, which would otherwise rebuild after every batch.
    _invalidate(user_id, home=False)
    background_tasks.add_task(_trim_events, user_id)
    return {"accepted": len(rows)}


# ---------------------------------------------------------------------------
# Feedback
# ---------------------------------------------------------------------------

FEEDBACK_COLUMNS = "target_type, target_id, kind, label, created_at"


@router.get("/feedback", response_model=List[FeedbackResponse])
async def list_feedback(user: dict = Depends(get_current_user)):
    result = (
        get_supabase()
        .table("song_feedback")
        .select(FEEDBACK_COLUMNS)
        .eq("user_id", user["user_id"])
        .order("created_at", desc=True)
        .execute()
    )
    return result.data or []


@router.post("/feedback", response_model=FeedbackResponse, status_code=201)
async def add_feedback(body: FeedbackRequest, user: dict = Depends(get_current_user)):
    user_id = user["user_id"]
    row = {
        "user_id": user_id,
        "target_type": body.target_type,
        "target_id": body.target_id,
        "kind": body.kind,
        "label": body.label,
    }
    try:
        result = (
            get_supabase()
            .table("song_feedback")
            .upsert(row, on_conflict="user_id,target_type,target_id")
            .execute()
        )
    except Exception as exc:
        logger.warning("Could not save feedback: %s", exc)
        raise HTTPException(
            status_code=500,
            detail="Could not save your choice. Check that recs_schema.sql has been run, then retry.",
        ) from exc
    _invalidate(user_id)
    saved = (result.data or [row])[0]
    return {k: saved.get(k) for k in ("target_type", "target_id", "kind", "label", "created_at")}


@router.delete("/feedback/{target_type}/{target_id:path}", status_code=204)
async def remove_feedback(target_type: TargetType, target_id: str, user: dict = Depends(get_current_user)):
    user_id = user["user_id"]
    (
        get_supabase()
        .table("song_feedback")
        .delete()
        .eq("user_id", user_id)
        .eq("target_type", target_type)
        .eq("target_id", target_id)
        .execute()
    )
    _invalidate(user_id)
    return Response(status_code=204)


@router.delete("/feedback", status_code=204)
async def clear_feedback(
    target_type: Optional[TargetType] = Query(None),
    user: dict = Depends(get_current_user),
):
    user_id = user["user_id"]
    query = get_supabase().table("song_feedback").delete().eq("user_id", user_id)
    if target_type:
        query = query.eq("target_type", target_type)
    query.execute()
    _invalidate(user_id)
    return Response(status_code=204)


# ---------------------------------------------------------------------------
# Metrics
# ---------------------------------------------------------------------------

def _parse_time(value: Any) -> Optional[datetime]:
    if isinstance(value, datetime):
        parsed = value
    else:
        try:
            text = str(value)
            parsed = datetime.fromisoformat(text[:-1] + "+00:00" if text.endswith("Z") else text)
        except ValueError:
            return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _ratio(num: float, den: int, scale: float = 1.0) -> Optional[float]:
    return round(num * scale / den, 4) if den else None


def compute_window(rows: List[dict], days: int, now: datetime) -> WindowMetrics:
    """Metrics over events newer than `days` days."""
    cutoff = now - timedelta(days=days)
    counts: Dict[str, Dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for row in rows:
        created = _parse_time(row.get("created_at"))
        if created is None or created < cutoff:
            continue
        bucket = counts[row.get("surface") or "other"]
        kind = row.get("event")
        if kind == "start":
            bucket["starts"] += 1
        elif kind == "skip":
            listened = row.get("listened_sec")
            if listened is not None and listened < SKIP_EARLY_SECONDS:
                bucket["early_skips"] += 1
        elif kind == "complete":
            bucket["completes"] += 1
        elif kind in ("save", "like"):
            bucket["saves"] += 1

    surfaces = []
    for name in sorted(counts, key=lambda s: (-counts[s]["starts"], s)):
        c = counts[name]
        starts = c["starts"]
        surfaces.append(SurfaceMetrics(
            surface=name,
            starts=starts,
            skip_rate_30s=_ratio(c["early_skips"], starts),
            completion_rate=_ratio(c["completes"], starts),
            saves_per_100=_ratio(c["saves"], starts, 100),
        ))
    total = sum(s.starts for s in surfaces)
    from_recs = sum(s.starts for s in surfaces if s.surface in REC_SURFACES)
    return WindowMetrics(days=days, starts=total, rec_share=_ratio(from_recs, total), surfaces=surfaces)


@router.get("/recs/metrics", response_model=MetricsResponse)
async def recs_metrics(user: dict = Depends(get_current_user)):
    """Skip rate, completion and saves per surface from the user's own events (7 and 28 days)."""
    now = datetime.now(timezone.utc)
    since = now - timedelta(days=max(METRICS_WINDOWS))
    try:
        result = (
            get_supabase()
            .table("listening_events")
            .select("event, surface, listened_sec, created_at")
            .eq("user_id", user["user_id"])
            .gte("created_at", since.isoformat())
            .order("created_at", desc=True)
            .limit(METRICS_ROW_LIMIT)
            .execute()
        )
    except Exception as exc:
        logger.warning("Could not read listening events: %s", exc)
        raise HTTPException(
            status_code=500,
            detail="Could not read listening events. Check that recs_schema.sql has been run, then retry.",
        ) from exc
    rows = result.data or []
    return MetricsResponse(windows=[compute_window(rows, d, now) for d in METRICS_WINDOWS])
