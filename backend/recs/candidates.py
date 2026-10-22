"""
Candidate generation. Each source tags what it finds:

  seed        Mix of the seed song(s)
  session     Mixes of songs completed in the last 45 minutes
  taste       Mixes of the listener's top-affinity songs (liked and playlist songs count)
  walk        2-hop: Mixes of the seed Mix's first neighbours (stored graph only), discounted
  channel     catalogue songs from the listener's top channels
  rediscover  loved songs not played for 30+ days
  catalogue   most-played songs across users (cold start and thin results)

`assemble` is pure; `gather` does the I/O (graph, catalogue) and calls it.
"""
from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from typing import Any, Dict, Iterable, List, Optional, Sequence, Set

from . import graph
from .graph import Related
from .profile import Profile, SongMeta, meta_from_row

logger = logging.getLogger(__name__)

SOURCES = ("seed", "session", "taste", "walk", "channel", "rediscover", "catalogue")
LINK_WEIGHT = {"seed": 1.0, "session": 0.8, "taste": 0.6, "walk": 0.35}
WALK_WIDTH = 6               # first-hop neighbours expanded per seed
WALK_WIDTH_OTHER = 3         # ... per session/taste seed
PER_CHANNEL = 12
POPULAR = 60


@dataclass
class Candidate:
    youtube_id: str
    title: str
    channel: str
    duration: int = 0
    thumbnail: str = ""
    sources: Set[str] = field(default_factory=set)
    seeds: Dict[str, int] = field(default_factory=dict)         # seed id -> best rank in its Mix
    seed_source: Dict[str, str] = field(default_factory=dict)   # seed id -> source that linked it
    best_rank: Optional[int] = None
    link_weight: float = 0.0
    seed_sim: float = 0.0
    direct: bool = False                                        # linked by a Mix itself, not only a walk


@dataclass
class Plan:
    """Where to look. `seed`, `session`, `taste` are song ids whose Mixes are read."""
    seed: List[str] = field(default_factory=list)
    session: List[str] = field(default_factory=list)
    taste: List[str] = field(default_factory=list)
    walk: bool = True
    channel: bool = False
    rediscover: bool = False
    catalogue: bool = False
    max_live: int = 3
    timeout: float = graph.FETCH_TIMEOUT       # how long to wait for the seed's own Mix
    other_timeout: float = 3.5                 # ... for session/taste Mixes, which are only a bonus


@dataclass
class CandidateSet:
    by_id: Dict[str, Candidate] = field(default_factory=dict)
    titles: Dict[str, str] = field(default_factory=dict)        # seed id -> title (for reasons)
    graphs: Dict[str, List[Related]] = field(default_factory=dict)

    def values(self) -> List[Candidate]:
        return list(self.by_id.values())


# ---------------------------------------------------------------------------
# Catalogue access (replace `catalogue` in tests)
# ---------------------------------------------------------------------------

class CatalogueStore:
    async def by_channel(self, name: str, n: int) -> List[Dict[str, Any]]:
        return await asyncio.to_thread(self._by_channel, name, n)

    async def popular(self, n: int) -> List[Dict[str, Any]]:
        return await asyncio.to_thread(self._popular, n)

    async def lookup(self, ids: Sequence[str]) -> List[Dict[str, Any]]:
        return await asyncio.to_thread(self._lookup, list(ids)) if ids else []

    @staticmethod
    def _select():
        from db import get_supabase
        return get_supabase().table("songs").select("youtube_id,title,channel_name,thumbnail_url,duration_sec")

    def _by_channel(self, name: str, n: int) -> List[Dict[str, Any]]:
        try:
            return self._select().eq("channel_name", name).order("play_count", desc=True).limit(n).execute().data or []
        except Exception as exc:
            logger.warning("Channel songs read failed: %s", exc)
            return []

    def _popular(self, n: int) -> List[Dict[str, Any]]:
        try:
            return self._select().order("play_count", desc=True).limit(n).execute().data or []
        except Exception as exc:
            logger.warning("Popular songs read failed: %s", exc)
            return []

    def _lookup(self, ids: List[str]) -> List[Dict[str, Any]]:
        try:
            return self._select().in_("youtube_id", ids[:100]).execute().data or []
        except Exception as exc:
            logger.warning("Song lookup failed: %s", exc)
            return []


catalogue: CatalogueStore = CatalogueStore()


# ---------------------------------------------------------------------------
# Pure assembly
# ---------------------------------------------------------------------------

def _get(cands: Dict[str, Candidate], yt: str, title: str, channel: str, duration: int, thumb: str = "") -> Candidate:
    c = cands.get(yt)
    if c is None:
        c = cands[yt] = Candidate(yt, title, channel, duration, thumb)
    return c


def _from_meta(cands: Dict[str, Candidate], m: SongMeta, source: str) -> Candidate:
    c = _get(cands, m.youtube_id, m.title, m.channel, m.duration, m.thumbnail)
    c.sources.add(source)
    return c


def _link(c: Candidate, source: str, seed: str, rank: int, weight: float) -> None:
    c.sources.add(source)
    if seed not in c.seeds or rank < c.seeds[seed]:
        c.seeds[seed] = rank
        c.seed_source[seed] = source
    c.best_rank = rank if c.best_rank is None else min(c.best_rank, rank)
    c.link_weight += weight
    if source != "walk":
        c.direct = True


def walk_ids(plan: Plan, graphs: Dict[str, List[Related]]) -> List[str]:
    """First-hop neighbours whose own Mixes the walk reads."""
    out: List[str] = []
    seen = set(plan.seed) | set(plan.session) | set(plan.taste)
    for group, width in ((plan.seed, WALK_WIDTH), (plan.session, WALK_WIDTH_OTHER), (plan.taste, WALK_WIDTH_OTHER)):
        for s in group:
            for r in graphs.get(s, [])[:width]:
                if r.youtube_id not in seen:
                    seen.add(r.youtube_id)
                    out.append(r.youtube_id)
    return out[:40]


def assemble(
    plan: Plan,
    graphs: Dict[str, List[Related]],
    walk_graphs: Optional[Dict[str, List[Related]]],
    profile: Profile,
    channel_songs: Iterable[SongMeta] = (),
    catalogue_songs: Iterable[SongMeta] = (),
    now_days_gap: float = 30.0,
) -> CandidateSet:
    walk_graphs = walk_graphs or {}
    cands: Dict[str, Candidate] = {}
    titles: Dict[str, str] = {y: m.title for y, m in profile.meta.items()}
    claimed: Set[str] = set()

    for source in ("seed", "session", "taste"):
        for seed in getattr(plan, source):
            if seed in claimed:
                continue
            claimed.add(seed)
            for r in graphs.get(seed, []):
                if r.youtube_id == seed:
                    continue
                c = _get(cands, r.youtube_id, r.title, r.channel, r.duration)
                _link(c, source, seed, r.rank, LINK_WEIGHT[source])
                titles.setdefault(r.youtube_id, r.title)

    if plan.walk:
        for source, width in (("seed", WALK_WIDTH), ("session", WALK_WIDTH_OTHER), ("taste", WALK_WIDTH_OTHER)):
            for seed in getattr(plan, source):
                if plan.walk and seed not in graphs:
                    continue
                for first in graphs.get(seed, [])[:width]:
                    for r in walk_graphs.get(first.youtube_id, []):
                        if r.youtube_id == seed or r.youtube_id in claimed:
                            continue
                        c = _get(cands, r.youtube_id, r.title, r.channel, r.duration)
                        _link(c, "walk", seed, r.rank, LINK_WEIGHT["walk"])
                        titles.setdefault(r.youtube_id, r.title)

    for m in channel_songs:
        _from_meta(cands, m, "channel")
    if plan.rediscover:
        for yt, _score in profile.rediscover_pool(now_days_gap):
            _from_meta(cands, profile.meta[yt], "rediscover")
    for m in catalogue_songs:
        _from_meta(cands, m, "catalogue")

    all_graphs = {**walk_graphs, **graphs}
    sets = {s: {r.youtube_id for r in rows} for s, rows in all_graphs.items()}
    for c in cands.values():
        best = 0.0
        for seed in c.seeds:
            if not c.direct:
                best = max(best, 0.3)
            elif c.youtube_id in sets and seed in sets:
                sim = graph.similarity_sets(seed, sets[seed], c.youtube_id, sets[c.youtube_id])
                best = max(best, min(1.0, sim / 1.6))
            else:
                best = max(best, 0.6)
        c.seed_sim = best
    return CandidateSet(cands, titles, graphs)


# ---------------------------------------------------------------------------
# I/O
# ---------------------------------------------------------------------------

def _metas(rows: Iterable[Dict[str, Any]]) -> List[SongMeta]:
    return [m for m in (meta_from_row(r) for r in rows) if m]


async def gather(plan: Plan, profile: Profile) -> CandidateSet:
    """Fetch Mixes (live ones capped by plan.max_live) and catalogue lists, then assemble."""
    seed_ids = list(dict.fromkeys([*plan.seed, *plan.session, *plan.taste]))

    channel_names: List[str] = []
    if plan.channel:
        display = {}
        for m in profile.meta.values():
            display.setdefault(_ck(m.channel), m.channel)
        channel_names = [display[k] for k in profile.top_channels(3) if k in display]

    missing_titles = [s for s in seed_ids if s not in profile.meta]
    want_popular = plan.catalogue

    graphs_task = _mixes(plan)
    chan_task = asyncio.gather(*(catalogue.by_channel(n, PER_CHANNEL) for n in channel_names))
    pop_task = catalogue.popular(POPULAR) if want_popular else _empty_list()
    look_task = catalogue.lookup(missing_titles) if missing_titles else _empty_list()
    graphs, chan_rows, pop_rows, look_rows = await asyncio.gather(graphs_task, chan_task, pop_task, look_task)

    walk_graphs: Dict[str, List[Related]] = {}
    if plan.walk and graphs:
        ids = walk_ids(plan, graphs)
        if ids:
            walk_graphs = await graph.related_many(ids, max_live=0)

    cs = assemble(
        plan, graphs, walk_graphs, profile,
        channel_songs=[m for rows in chan_rows for m in _metas(rows)],
        catalogue_songs=_metas(pop_rows),
    )
    for m in _metas(look_rows):
        cs.titles.setdefault(m.youtube_id, m.title)
    return cs


async def _mixes(plan: Plan) -> Dict[str, List[Related]]:
    """Seed Mixes first (they get the live-fetch allowance first), session/taste Mixes alongside."""
    primary = list(dict.fromkeys(plan.seed))
    others = [s for s in dict.fromkeys([*plan.session, *plan.taste]) if s not in primary]
    live_left = max(0, plan.max_live - len(primary))
    a, b = await asyncio.gather(
        graph.related_many(primary, plan.max_live, plan.timeout) if primary else _empty(),
        graph.related_many(others, live_left, plan.other_timeout) if others else _empty(),
    )
    return {**b, **a}


def _ck(channel: str) -> str:
    from .text import channel_key
    return channel_key(channel)


async def _empty() -> Dict[str, List[Related]]:
    return {}


async def _empty_list() -> List[Dict[str, Any]]:
    return []
