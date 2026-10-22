"""
Related-songs graph built from YouTube Mixes.

get_related(seed): memory (1 h) -> related_songs rows (<= 7 days) -> live Mix fetch -> persist.
A failed fetch degrades to stored (even stale) rows, else [].
"""
from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Dict, Iterable, List, Optional, Sequence, Set, Tuple

logger = logging.getLogger(__name__)

MEMORY_TTL = 60 * 60
DB_TTL = 7 * 24 * 60 * 60
MEMORY_MAX = 3000
MAX_CONCURRENT_FETCHES = 3
FETCH_TIMEOUT = 8.0          # a request stops waiting after this; the fetch carries on and is saved
DB_CHUNK = 15                # PostgREST returns <= 1000 rows; a Mix has <= 50


@dataclass(frozen=True)
class Related:
    youtube_id: str
    rank: int
    title: str
    channel: str
    duration: int = 0


# ---------------------------------------------------------------------------
# Storage (replace `store` in tests)
# ---------------------------------------------------------------------------

def _parse_ts(value: object) -> float:
    if isinstance(value, (int, float)):
        return float(value)
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).timestamp()
    except ValueError:
        return 0.0


class GraphStore:
    """DB and yt-dlp access. All methods are async; the sync client runs in a thread."""

    async def load(self, seed_ids: Sequence[str]) -> Dict[str, Tuple[float, List[Related]]]:
        """seed -> (fetched_at epoch, rows ordered by rank). Missing seeds are absent."""
        ids = list(dict.fromkeys(seed_ids))
        if not ids:
            return {}
        chunks = [ids[i:i + DB_CHUNK] for i in range(0, len(ids), DB_CHUNK)]
        results = await asyncio.gather(*(asyncio.to_thread(self._load_sync, c) for c in chunks))
        out: Dict[str, Tuple[float, List[Related]]] = {}
        for part in results:
            out.update(part)
        return out

    @staticmethod
    def _load_sync(ids: List[str]) -> Dict[str, Tuple[float, List[Related]]]:
        from db import get_supabase
        res = None
        for attempt in range(2):  # one retry: concurrent reads share one HTTP/2 connection, which can reset
            try:
                res = (
                    get_supabase().table("related_songs")
                    .select("seed_id,youtube_id,rank,title,channel,duration,fetched_at")
                    .in_("seed_id", ids)
                    .order("rank")
                    .execute()
                )
                break
            except Exception as exc:
                if attempt == 1:
                    logger.warning("related_songs read failed: %s", exc)
                    return {}
        grouped: Dict[str, List[Related]] = {}
        fetched: Dict[str, float] = {}
        for row in res.data or []:
            seed = row["seed_id"]
            grouped.setdefault(seed, []).append(Related(
                row["youtube_id"], int(row.get("rank") or 0), row.get("title") or "",
                row.get("channel") or "", int(row.get("duration") or 0),
            ))
            ts = _parse_ts(row.get("fetched_at"))
            fetched[seed] = min(ts, fetched.get(seed, ts))
        return {s: (fetched[s], sorted(rows, key=lambda r: r.rank)) for s, rows in grouped.items()}

    async def save(self, seed_id: str, rows: List[Related]) -> None:
        await asyncio.to_thread(self._save_sync, seed_id, rows)

    @staticmethod
    def _save_sync(seed_id: str, rows: List[Related]) -> None:
        from db import get_supabase
        try:
            table = get_supabase().table("related_songs")
            table.delete().eq("seed_id", seed_id).execute()
            if rows:
                now = datetime.now(timezone.utc).isoformat()
                table.insert([
                    {"seed_id": seed_id, "youtube_id": r.youtube_id, "rank": min(r.rank, 32000),
                     "title": r.title, "channel": r.channel, "duration": r.duration, "fetched_at": now}
                    for r in rows
                ]).execute()
        except Exception as exc:
            logger.warning("related_songs write failed for %s: %s", seed_id, exc)

    async def fetch(self, seed_id: str) -> List[Related]:
        """Live Mix, in order, seed excluded. Raises on failure."""
        from routers import youtube  # heavy import (yt-dlp): only when a fetch is needed
        mix = await youtube.fetch_mix(seed_id, 50)
        return [Related(m.youtube_id, i + 1, m.title, m.channel, m.duration) for i, m in enumerate(mix)]


store: GraphStore = GraphStore()


# ---------------------------------------------------------------------------
# Caches
# ---------------------------------------------------------------------------

_memory: Dict[str, Tuple[float, List[Related]]] = {}      # seed -> (loaded_at, rows)
_inflight: Dict[str, "asyncio.Future[List[Related]]"] = {}
_sem: Optional[asyncio.Semaphore] = None
_sem_loop: Optional[asyncio.AbstractEventLoop] = None


def clear_memory() -> None:
    _memory.clear()
    _inflight.clear()


def _remember(seed: str, rows: List[Related]) -> None:
    if len(_memory) >= MEMORY_MAX:
        for key in list(_memory)[: MEMORY_MAX // 10]:
            _memory.pop(key, None)
    _memory[seed] = (time.time(), rows)


def _semaphore() -> asyncio.Semaphore:
    global _sem, _sem_loop
    loop = asyncio.get_running_loop()
    if _sem is None or _sem_loop is not loop:
        _sem, _sem_loop = asyncio.Semaphore(MAX_CONCURRENT_FETCHES), loop
    return _sem


def _fresh_memory(seed: str) -> Optional[List[Related]]:
    hit = _memory.get(seed)
    return hit[1] if hit and time.time() - hit[0] < MEMORY_TTL else None


async def _refresh(seed: str, stale: List[Related]) -> List[Related]:
    """Live fetch + persist. On failure returns the stale rows (or [])."""
    async with _semaphore():
        try:
            rows = await store.fetch(seed)
        except Exception as exc:
            logger.warning("Mix fetch failed for %s: %s", seed, exc)
            return stale
    if rows:
        _remember(seed, rows)
        await store.save(seed, rows)
        return rows
    return stale


async def _fetch_shared(seed: str, stale: List[Related], timeout: float) -> List[Related]:
    """One fetch per seed at a time; callers beyond `timeout` get the stale rows while it finishes."""
    task = _inflight.get(seed)
    if task is None or task.done():
        task = asyncio.ensure_future(_refresh(seed, stale))
        _inflight[seed] = task

        def _done(t: "asyncio.Future[List[Related]]", s: str = seed) -> None:
            if _inflight.get(s) is t:
                _inflight.pop(s, None)

        task.add_done_callback(_done)
    try:
        return await asyncio.wait_for(asyncio.shield(task), timeout)
    except asyncio.TimeoutError:
        return stale


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

async def related_many(
    seed_ids: Iterable[str], max_live: int = 3, timeout: float = FETCH_TIMEOUT,
) -> Dict[str, List[Related]]:
    """
    Mixes for many seeds with one batched DB read. Seeds needing a live fetch (absent or
    older than 7 days) are fetched concurrently, but only the first `max_live` of them;
    the rest keep whatever is stored. Never raises.
    """
    ids = list(dict.fromkeys(s for s in seed_ids if s))
    out: Dict[str, List[Related]] = {}
    need_db: List[str] = []
    for s in ids:
        rows = _fresh_memory(s)
        if rows is not None:
            out[s] = rows
        else:
            need_db.append(s)

    stored: Dict[str, Tuple[float, List[Related]]] = {}
    if need_db:
        try:
            stored = await store.load(need_db)
        except Exception as exc:
            logger.warning("Graph read failed: %s", exc)

    now = time.time()
    to_fetch: List[str] = []
    for s in need_db:
        hit = stored.get(s)
        if hit and now - hit[0] <= DB_TTL:
            out[s] = hit[1]
            _remember(s, hit[1])
        else:
            out[s] = hit[1] if hit else []
            if len(to_fetch) < max_live:
                to_fetch.append(s)

    if to_fetch:
        fetched = await asyncio.gather(*(_fetch_shared(s, out[s], timeout) for s in to_fetch))
        for s, rows in zip(to_fetch, fetched):
            out[s] = rows
    return out


async def get_related(youtube_id: str) -> List[Related]:
    return (await related_many([youtube_id], max_live=1)).get(youtube_id, [])


async def neighbours(ids: Iterable[str], depth: int = 1, max_live: int = 0) -> Dict[str, Set[str]]:
    """seed -> ids reachable within `depth` hops (stored graph; live fetches only for hop 1 if max_live)."""
    ids = list(dict.fromkeys(ids))
    first = await related_many(ids, max_live=max_live)
    result = {s: {r.youtube_id for r in rows} for s, rows in first.items()}
    if depth >= 2:
        hop_ids = sorted({n for ns in result.values() for n in ns} - set(ids))[:60]
        second = await related_many(hop_ids, max_live=0)
        for s, ns in list(result.items()):
            extra: Set[str] = set()
            for n in ns:
                extra.update(r.youtube_id for r in second.get(n, []))
            result[s] = ns | (extra - {s})
    return result


def similarity_sets(a: str, a_set: Set[str], b: str, b_set: Set[str]) -> float:
    """Jaccard of two Mixes' neighbour sets, plus 1 if either contains the other song. Range 0..2."""
    union = a_set | b_set
    jac = len(a_set & b_set) / len(union) if union else 0.0
    return jac + (1.0 if (b in a_set or a in b_set) else 0.0)


async def similarity(a: str, b: str) -> float:
    rel = await related_many([a, b], max_live=0)
    return similarity_sets(a, {r.youtube_id for r in rel.get(a, [])}, b, {r.youtube_id for r in rel.get(b, [])})
