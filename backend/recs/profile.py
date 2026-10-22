"""
The listener profile: decayed song and channel affinity, skips, recency, hour habits,
variant taste, hidden items and the live session.

`build_profile` is pure (raw rows in, Profile out). `fetch_raw` does the DB reads;
tests and the evaluator replace it or call `build_profile` directly.
"""
from __future__ import annotations

import asyncio
import logging
import math
import time
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Dict, List, Optional, Set, Tuple

from .text import channel_key, variants

logger = logging.getLogger(__name__)

HALF_LIFE_DAYS = 30.0
SESSION_SECONDS = 45 * 60
CACHE_TTL = 120.0
LIKED_WEIGHT = 2.0
PLAYLIST_WEIGHT = 1.5
HISTORY_WEIGHT = 0.5          # play_history rows (older users with no events yet)
LONG_TRACK_SECONDS = 20 * 60
EVENT_PAGE = 1000
EVENT_PAGES = 3

EVENT_WEIGHTS = {"complete": 1.0, "like": 3.0, "unlike": -2.0, "save": 2.5, "queue": 1.5}
PLAY_EVENTS = {"start", "complete", "skip"}


@dataclass
class SongMeta:
    youtube_id: str
    title: str
    channel: str
    duration: int = 0
    thumbnail: str = ""


@dataclass
class SessionEvent:
    youtube_id: str
    event: str
    ts: float
    channel: str = ""
    listened_sec: Optional[float] = None


@dataclass
class RawData:
    """Rows as read from the DB (or fixtures). Timestamps are ISO strings or epoch floats."""
    events: List[Dict[str, Any]] = field(default_factory=list)       # listening_events
    liked: List[Dict[str, Any]] = field(default_factory=list)        # {at, song: {...songs row}}
    playlist: List[Dict[str, Any]] = field(default_factory=list)     # {at, song: {...songs row}}
    history: List[Dict[str, Any]] = field(default_factory=list)      # {at, song: {...songs row}}
    feedback: List[Dict[str, Any]] = field(default_factory=list)     # song_feedback
    songs: List[Dict[str, Any]] = field(default_factory=list)        # songs rows for event youtube_ids


@dataclass
class Profile:
    user_id: str = ""
    now: float = 0.0
    song_aff: Dict[str, float] = field(default_factory=dict)
    channel_aff: Dict[str, float] = field(default_factory=dict)        # key: channel_key(channel)
    skips: Dict[str, int] = field(default_factory=dict)
    last_played: Dict[str, float] = field(default_factory=dict)
    liked: Set[str] = field(default_factory=set)
    playlist: Set[str] = field(default_factory=set)
    hidden_songs: Set[str] = field(default_factory=set)
    hidden_channels: Set[str] = field(default_factory=set)             # channel_key values
    hour_hist: Dict[str, List[float]] = field(default_factory=dict)    # channel_key -> 24 counts
    song_hours: Dict[str, List[float]] = field(default_factory=dict)   # youtube_id -> 24 counts
    variant_taste: Dict[str, float] = field(default_factory=dict)      # variant -> raw affinity
    plain_taste: float = 0.0                                           # affinity on songs with no variant
    session: List[SessionEvent] = field(default_factory=list)          # newest first
    session_channels: Dict[str, float] = field(default_factory=dict)   # channel_key -> -1..1
    session_completed: List[str] = field(default_factory=list)         # newest first
    meta: Dict[str, SongMeta] = field(default_factory=dict)
    long_ok: bool = False
    recent_hour: Optional[int] = None
    event_count: int = 0

    @property
    def has_signal(self) -> bool:
        return bool(self.song_aff or self.liked or self.playlist)

    def channel_of(self, youtube_id: str) -> str:
        m = self.meta.get(youtube_id)
        return m.channel if m else ""

    def top_songs(self, n: int, min_aff: float = 0.0) -> List[str]:
        ranked = sorted(((a, y) for y, a in self.song_aff.items() if a > min_aff and y not in self.hidden_songs),
                        reverse=True)
        return [y for _, y in ranked[:n]]

    def top_channels(self, n: int) -> List[str]:
        """channel_key values, strongest first (positive affinity only)."""
        ranked = sorted(((a, c) for c, a in self.channel_aff.items() if a > 0 and c not in self.hidden_channels),
                        reverse=True)
        return [c for _, c in ranked[:n]]

    def rediscover_pool(self, min_days: float = 30.0) -> List[Tuple[str, float]]:
        """Songs the listener loves but hasn't played for `min_days`: (youtube_id, score), best first."""
        out: List[Tuple[str, float]] = []
        for yt in set(self.liked) | {y for y, a in self.song_aff.items() if a >= LIKED_WEIGHT * 0.75}:
            if yt in self.hidden_songs or yt not in self.meta:
                continue
            last = self.last_played.get(yt)
            gap = (self.now - last) / 86400.0 if last else 365.0
            if gap >= min_days:
                out.append((yt, self.song_aff.get(yt, 1.0) * (1.0 + math.log1p(gap / 30.0))))
        out.sort(key=lambda p: -p[1])
        return out


# ---------------------------------------------------------------------------
# Pure math
# ---------------------------------------------------------------------------

def to_ts(value: Any) -> float:
    if isinstance(value, (int, float)):
        return float(value)
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).timestamp()
    except ValueError:
        return 0.0


def decay(age_seconds: float) -> float:
    return 0.5 ** (max(0.0, age_seconds) / 86400.0 / HALF_LIFE_DAYS)


def event_weight(event: str, listened_sec: Optional[float] = None, duration_sec: Optional[float] = None) -> float:
    """Affinity weight of one event (docs/RECOMMENDATIONS.md, Signals)."""
    if event in EVENT_WEIGHTS:
        return EVENT_WEIGHTS[event]
    if event != "skip":
        return 0.0
    if listened_sec is not None and listened_sec < 30:
        return -1.0
    ratio = listened_sec / duration_sec if (listened_sec is not None and duration_sec) else None
    if ratio is None:
        return -0.4 if listened_sec is None or listened_sec >= 30 else -1.0
    if ratio < 0.5:
        return -0.4
    return 0.0


def meta_from_row(row: Dict[str, Any]) -> Optional[SongMeta]:
    yt = row.get("youtube_id")
    if not yt:
        return None
    return SongMeta(
        yt, row.get("title") or "", row.get("channel_name") or row.get("channel") or "",
        int(row.get("duration_sec") or row.get("duration") or 0),
        row.get("thumbnail_url") or row.get("thumbnail") or "",
    )


def _bump(hist: Dict[str, List[float]], key: str, hour: int) -> None:
    arr = hist.get(key)
    if arr is None:
        arr = hist[key] = [0.0] * 24
    arr[hour] += 1.0


def build_profile(raw: RawData, user_id: str = "", now: Optional[float] = None) -> Profile:
    now = time.time() if now is None else now
    p = Profile(user_id=user_id, now=now)

    def learn_meta(row: Optional[Dict[str, Any]]) -> None:
        m = meta_from_row(row or {})
        if m and m.youtube_id not in p.meta:
            p.meta[m.youtube_id] = m

    for row in raw.songs:
        learn_meta(row)
    for group in (raw.liked, raw.playlist, raw.history):
        for item in group:
            learn_meta(item.get("song"))

    def add(yt: str, w: float, ts: float) -> None:
        if not w:
            return
        d = w * decay(now - ts)
        p.song_aff[yt] = p.song_aff.get(yt, 0.0) + d
        m = p.meta.get(yt)
        if m and m.channel:
            ck = channel_key(m.channel)
            p.channel_aff[ck] = p.channel_aff.get(ck, 0.0) + d
            vs = variants(m.title)
            if vs:
                for v in vs:
                    p.variant_taste[v] = p.variant_taste.get(v, 0.0) + d
            else:
                p.plain_taste += d

    def played(yt: str, ts: float) -> None:
        if ts > p.last_played.get(yt, 0.0):
            p.last_played[yt] = ts

    for item in raw.liked:
        m = meta_from_row(item.get("song") or {})
        if m:
            p.liked.add(m.youtube_id)
            add(m.youtube_id, LIKED_WEIGHT, to_ts(item.get("at")))
    for item in raw.playlist:
        m = meta_from_row(item.get("song") or {})
        if m:
            p.playlist.add(m.youtube_id)
            add(m.youtube_id, PLAYLIST_WEIGHT, to_ts(item.get("at")))
    for item in raw.history:
        m = meta_from_row(item.get("song") or {})
        if m:
            ts = to_ts(item.get("at"))
            played(m.youtube_id, ts)
            add(m.youtube_id, HISTORY_WEIGHT, ts)

    session_floor = now - SESSION_SECONDS
    session_score: Dict[str, float] = defaultdict(float)
    ordered = sorted(raw.events, key=lambda e: to_ts(e.get("created_at")), reverse=True)  # newest first
    p.event_count = len(ordered)
    for e in ordered:
        yt, ev = e.get("youtube_id"), e.get("event")
        if not yt or not ev:
            continue
        ts = to_ts(e.get("created_at"))
        listened, dur = e.get("listened_sec"), e.get("duration_sec")
        w = event_weight(ev, listened, dur)
        add(yt, w, ts)
        if ev in PLAY_EVENTS:
            played(yt, ts)
        if ev == "skip" and w < 0 and now - ts < 60 * 86400:
            p.skips[yt] = p.skips.get(yt, 0) + 1
        hour = e.get("local_hour")
        if p.recent_hour is None and isinstance(hour, int):
            p.recent_hour = hour
        ch = p.channel_of(yt)
        if ev in ("start", "complete") and isinstance(hour, int) and 0 <= hour < 24:
            _bump(p.song_hours, yt, hour)
            if ch:
                _bump(p.hour_hist, channel_key(ch), hour)
        if ev == "complete" and (dur or 0) > LONG_TRACK_SECONDS:
            p.long_ok = True
        if ts >= session_floor:
            p.session.append(SessionEvent(yt, ev, ts, ch, listened))
            if ev in ("complete", "like") and yt not in p.session_completed:
                p.session_completed.append(yt)
            if ch:
                ck = channel_key(ch)
                if ev == "complete":
                    session_score[ck] += 0.5
                elif ev == "like":
                    session_score[ck] += 0.8
                elif ev in ("save", "queue"):
                    session_score[ck] += 0.5
                elif ev == "skip" and w < 0:
                    session_score[ck] -= 0.7 if w <= -1.0 else 0.4
    p.session_channels = {c: math.tanh(s) for c, s in session_score.items() if s}

    for fb in raw.feedback:
        if fb.get("kind", "hide") != "hide":
            continue
        if fb.get("target_type") == "song":
            p.hidden_songs.add(str(fb.get("target_id")))
        elif fb.get("target_type") == "channel":
            p.hidden_channels.add(channel_key(str(fb.get("target_id"))))
    return p


# ---------------------------------------------------------------------------
# DB access
# ---------------------------------------------------------------------------

def _safe(fn, label: str, default):
    try:
        return fn()
    except Exception as exc:  # missing tables (schema not run yet) degrade to a cold profile
        logger.warning("Profile read '%s' failed: %s", label, exc)
        return default


def _read_events(user_id: str) -> List[Dict[str, Any]]:
    from db import get_supabase
    rows: List[Dict[str, Any]] = []
    for page in range(EVENT_PAGES):
        res = (
            get_supabase().table("listening_events")
            .select("youtube_id,event,surface,listened_sec,duration_sec,local_hour,created_at")
            .eq("user_id", user_id)
            .order("created_at", desc=True)
            .range(page * EVENT_PAGE, (page + 1) * EVENT_PAGE - 1)
            .execute()
        )
        rows.extend(res.data or [])
        if len(res.data or []) < EVENT_PAGE:
            break
    return rows


def _read_liked(user_id: str) -> List[Dict[str, Any]]:
    from db import get_supabase
    res = get_supabase().table("liked_songs").select("liked_at, songs(*)").eq("user_id", user_id).execute()
    return [{"at": r.get("liked_at"), "song": r.get("songs")} for r in (res.data or []) if r.get("songs")]


def _read_playlist_songs(user_id: str) -> List[Dict[str, Any]]:
    from db import get_supabase
    db = get_supabase()
    owned = db.table("playlists").select("id").eq("user_id", user_id).execute()
    ids = [r["id"] for r in (owned.data or [])]
    if not ids:
        return []
    res = db.table("playlist_songs").select("added_at, songs(*)").in_("playlist_id", ids).execute()
    return [{"at": r.get("added_at"), "song": r.get("songs")} for r in (res.data or []) if r.get("songs")]


def _read_history(user_id: str) -> List[Dict[str, Any]]:
    from db import get_supabase
    res = (
        get_supabase().table("play_history").select("played_at, songs(*)")
        .eq("user_id", user_id).order("played_at", desc=True).limit(200).execute()
    )
    return [{"at": r.get("played_at"), "song": r.get("songs")} for r in (res.data or []) if r.get("songs")]


def _read_feedback(user_id: str) -> List[Dict[str, Any]]:
    from db import get_supabase
    res = get_supabase().table("song_feedback").select("target_type,target_id,kind").eq("user_id", user_id).execute()
    return res.data or []


def _read_songs(ids: List[str]) -> List[Dict[str, Any]]:
    from db import get_supabase
    res = (
        get_supabase().table("songs")
        .select("youtube_id,title,channel_name,thumbnail_url,duration_sec")
        .in_("youtube_id", ids).execute()
    )
    return res.data or []


async def fetch_raw(user_id: str) -> RawData:
    """All reads for one user, concurrently. Every query filters by user_id."""
    events, liked, playlist, history, feedback = await asyncio.gather(
        asyncio.to_thread(_safe, lambda: _read_events(user_id), "events", []),
        asyncio.to_thread(_safe, lambda: _read_liked(user_id), "liked", []),
        asyncio.to_thread(_safe, lambda: _read_playlist_songs(user_id), "playlists", []),
        asyncio.to_thread(_safe, lambda: _read_history(user_id), "history", []),
        asyncio.to_thread(_safe, lambda: _read_feedback(user_id), "feedback", []),
    )
    known = {(r.get("song") or {}).get("youtube_id") for g in (liked, playlist, history) for r in g}
    wanted: List[str] = []
    for e in events:  # newest first
        yt = e.get("youtube_id")
        if yt and yt not in known and yt not in wanted:
            wanted.append(yt)
    wanted = wanted[:600]
    songs: List[Dict[str, Any]] = []
    if wanted:
        chunks = [wanted[i:i + 100] for i in range(0, len(wanted), 100)]
        parts = await asyncio.gather(*(asyncio.to_thread(_safe, lambda c=c: _read_songs(c), "songs", []) for c in chunks))
        songs = [row for part in parts for row in part]
    return RawData(events=events, liked=liked, playlist=playlist, history=history, feedback=feedback, songs=songs)


# ---------------------------------------------------------------------------
# Cached loader
# ---------------------------------------------------------------------------

_cache: Dict[str, Tuple[float, Profile]] = {}
_inflight: Dict[str, "asyncio.Future[Profile]"] = {}
CACHE_MAX = 500


def invalidate(user_id: str) -> None:
    _cache.pop(user_id, None)


def clear_cache() -> None:
    _cache.clear()


async def load_profile(user_id: str) -> Profile:
    """Profile for a user, cached for 2 minutes; concurrent callers share one load."""
    hit = _cache.get(user_id)
    if hit and time.time() - hit[0] < CACHE_TTL:
        return hit[1]
    pending = _inflight.get(user_id)
    if pending is not None:
        return await asyncio.shield(pending)
    fut: "asyncio.Future[Profile]" = asyncio.ensure_future(_load(user_id))
    _inflight[user_id] = fut
    return await asyncio.shield(fut)


async def _load(user_id: str) -> Profile:
    started = time.time()
    try:
        raw = await fetch_raw(user_id)
    finally:
        _inflight.pop(user_id, None)
    profile = build_profile(raw, user_id)
    if len(_cache) >= CACHE_MAX:
        for key in list(_cache)[: CACHE_MAX // 10]:
            _cache.pop(key, None)
    # A profile built from reads that began before an invalidate() would be stale; the 2-minute TTL bounds that.
    _cache[user_id] = (started, profile)
    return profile
