"""
Re-ranking with constraints. Pure, no I/O.

Input is a list already in preference order (best first). Steps: hard filters, duplicate
versions, optional per-channel cap (Home rows), exploration picks, channel spacing.
"""
from __future__ import annotations

import random
from dataclasses import dataclass
from typing import Callable, Iterable, List, Sequence, Set, TypeVar

from .profile import Profile
from .ranker import Scored
from .text import channel_key, title_key

MIN_SECONDS = 60
MAX_SECONDS = 20 * 60
EXPLORE_POOL_FACTOR = 3
NOVEL = 0.5

T = TypeVar("T")


@dataclass
class Picked:
    scored: Scored
    explored: bool = False


def passes_filters(s: Scored, profile: Profile, exclude: Set[str]) -> bool:
    c = s.cand
    if c.youtube_id in exclude or c.youtube_id in profile.hidden_songs:
        return False
    if c.channel and channel_key(c.channel) in profile.hidden_channels:
        return False
    if c.duration and (c.duration < MIN_SECONDS or (c.duration > MAX_SECONDS and not profile.long_ok)):
        return False
    return True


def space_channels(items: Sequence[T], channel_of: Callable[[T], str], window: int = 3,
                   reserve: Sequence[T] = ()) -> List[T]:
    """Greedy: the same channel never twice within `window` consecutive slots when avoidable.

    Reordering alone can't space a list where one channel holds most slots (Indian label
    channels often do), so when no chosen item fits, the best `reserve` item from another
    channel takes the slot and the lowest-ranked chosen item drops out. Length is kept."""
    remaining = list(items)
    spare = list(reserve)
    out: List[T] = []
    fits = lambda x, recent: not channel_of(x) or channel_of(x) not in recent  # noqa: E731
    while remaining:
        recent = {channel_of(x) for x in out[-(window - 1):]} if window > 1 else set()
        pick = next((i for i, x in enumerate(remaining) if fits(x, recent)), None)
        if pick is not None:
            out.append(remaining.pop(pick))
            continue
        alt = next((i for i, x in enumerate(spare) if fits(x, recent)), None)
        if alt is not None:
            out.append(spare.pop(alt))
            remaining.pop()  # the reserve item replaces the weakest chosen one
            continue
        out.append(remaining.pop(0))  # unavoidable
    return out


def rerank(
    items: Sequence[Scored],
    profile: Profile,
    *,
    limit: int,
    exclude: Iterable[str] = (),
    exclude_keys: Iterable[str] = (),
    exploration: float = 0.0,
    rng_seed: str = "",
    row_cap: int = 0,
    window: int = 3,
) -> List[Picked]:
    """Up to `limit` picks. `rng_seed` (the slate's rec_id) makes exploration reproducible."""
    excl = set(exclude)
    seen_keys: Set[str] = set(exclude_keys)
    kept: List[Scored] = []
    per_channel: dict = {}
    for s in items:
        if not passes_filters(s, profile, excl):
            continue
        key = title_key(s.cand.title, s.cand.channel)
        if key in seen_keys:
            continue
        ck = channel_key(s.cand.channel)
        if row_cap and ck and per_channel.get(ck, 0) >= row_cap:
            continue
        seen_keys.add(key)
        per_channel[ck] = per_channel.get(ck, 0) + 1
        kept.append(s)

    # Nothing to learn from yet: keep today's behaviour (Mix order, lightly de-duplicated).
    if not profile.has_signal:
        exploration = 0.0

    n_explore = int(round(limit * exploration)) if len(kept) > limit else 0
    picks: List[Picked] = []
    if n_explore:
        base_n = limit - n_explore
        base = kept[:base_n]
        base_ids = {s.cand.youtube_id for s in base}
        pool = [s for s in kept[: EXPLORE_POOL_FACTOR * limit]
                if s.cand.youtube_id not in base_ids and s.features.get("novelty", 0.0) >= NOVEL]
        explore = random.Random(rng_seed).sample(pool, min(n_explore, len(pool)))
        explore.sort(key=lambda s: -s.score)
        taken = {id(s) for s in explore}
        rest = [s for s in kept[base_n:] if id(s) not in taken]
        base = base + rest[: n_explore - len(explore)]       # pool too small: fill from the top
        step = max(1, (len(base) + 1) // (len(explore) + 1)) if explore else 1
        merged: List[Picked] = [Picked(s) for s in base]
        for k, s in enumerate(explore):
            merged.insert(min(len(merged), 1 + (k + 1) * step - 1), Picked(s, True))
        picks = merged[:limit]
    else:
        picks = [Picked(s) for s in kept[:limit]]

    chosen = {id(p.scored) for p in picks}
    reserve = [Picked(s) for s in kept if id(s) not in chosen]
    return space_channels(picks, lambda p: channel_key(p.scored.cand.channel), window, reserve)
