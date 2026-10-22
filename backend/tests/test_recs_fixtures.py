"""Shared fakes for the recs tests (no network, no DB, no .env). Contains no tests itself."""
from __future__ import annotations

import os
import sys
import time
from contextlib import ExitStack
from typing import Dict, List, Optional, Tuple
from unittest import mock

os.environ.setdefault("SUPABASE_URL", "http://localhost")
os.environ.setdefault("SUPABASE_KEY", "dummy")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from recs import candidates, graph, profile, slates  # noqa: E402
from recs.graph import Related  # noqa: E402
from recs.profile import RawData  # noqa: E402

NOW = 1_800_000_000.0
DAY = 86400.0


def song_row(yt: str, title: Optional[str] = None, channel: str = "Chan", dur: int = 200) -> dict:
    return {"youtube_id": yt, "title": title or f"Song {yt}", "channel_name": channel,
            "duration_sec": dur, "thumbnail_url": ""}


def rel(yt: str, rank: int, channel: str = "Chan", title: Optional[str] = None, dur: int = 200) -> Related:
    return Related(yt, rank, title or f"Song {yt}", channel, dur)


def mix(seed: str, ids: List[str], channels: Optional[Dict[str, str]] = None) -> List[Related]:
    channels = channels or {}
    return [rel(y, i + 1, channels.get(y, f"Chan {i % 5}")) for i, y in enumerate(ids) if y != seed]


def event(yt: str, ev: str, ago_s: float = 60.0, **kw) -> dict:
    return {"youtube_id": yt, "event": ev, "created_at": NOW - ago_s, **kw}


class FakeStore:
    """Stands in for graph.GraphStore: `stored` is the DB, `live` what yt-dlp would return."""

    def __init__(self, stored=None, live=None, fail=()):
        self.stored: Dict[str, Tuple[float, List[Related]]] = {
            s: (time.time(), rows) for s, rows in (stored or {}).items()}
        self.live: Dict[str, List[Related]] = live or {}
        self.fail = set(fail)
        self.fetches: List[str] = []
        self.saved: Dict[str, List[Related]] = {}
        self.active = 0
        self.peak = 0
        self.delay = 0.0

    async def load(self, seed_ids):
        return {s: self.stored[s] for s in seed_ids if s in self.stored}

    async def save(self, seed_id, rows):
        self.saved[seed_id] = rows
        self.stored[seed_id] = (time.time(), rows)

    async def fetch(self, seed_id):
        import asyncio
        self.fetches.append(seed_id)
        self.active += 1
        self.peak = max(self.peak, self.active)
        try:
            if self.delay:
                await asyncio.sleep(self.delay)
            if seed_id in self.fail:
                raise RuntimeError("yt-dlp down")
            return self.live.get(seed_id, [])
        finally:
            self.active -= 1


class FakeCatalogue:
    def __init__(self, songs: Optional[List[dict]] = None):
        self.songs = songs or []

    async def by_channel(self, name, n):
        return [s for s in self.songs if s["channel_name"] == name][:n]

    async def popular(self, n):
        return self.songs[:n]

    async def lookup(self, ids):
        return [s for s in self.songs if s["youtube_id"] in ids]


class World:
    """Installs fakes for the graph store, catalogue and profile loader; clears every cache."""

    def __init__(self, store: Optional[FakeStore] = None, raw: Optional[RawData] = None,
                 catalogue: Optional[FakeCatalogue] = None):
        self.store = store or FakeStore()
        self.raw = raw or RawData()
        self.catalogue = catalogue or FakeCatalogue()
        self._stack = ExitStack()

    async def _fetch_raw(self, user_id):
        return self.raw

    def __enter__(self):
        graph.clear_memory()
        profile.clear_cache()
        slates.clear_all()
        self._stack.enter_context(mock.patch.object(graph, "store", self.store))
        self._stack.enter_context(mock.patch.object(candidates, "catalogue", self.catalogue))
        self._stack.enter_context(mock.patch.object(profile, "fetch_raw", self._fetch_raw))
        return self

    def __exit__(self, *exc):
        self._stack.close()
        graph.clear_memory()
        profile.clear_cache()
        slates.clear_all()
        return False


def build(raw: RawData, now: float = NOW):
    return profile.build_profile(raw, "u1", now)
