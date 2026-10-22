"""
Offline evaluation of the recommendation engine.

Run from backend/:

    venv\\Scripts\\python -m recs.evaluate                 # synthetic world, home + autoplay
    venv\\Scripts\\python -m recs.evaluate --surface radio --k 10
    venv\\Scripts\\python -m recs.evaluate --json          # machine-readable
    venv\\Scripts\\python -m recs.evaluate --live          # the real DB, read-only

Protocol (per user): split the event stream at its 80th-percentile timestamp. The profile is
built from events/library rows before the split only (`build_profile(now=split)`); candidates
come from the real `candidates.assemble` using seeds taken from that profile; they are scored
with `ranker.score_candidates` and re-ranked with `rerank.rerank` (same exploration share and
channel caps as the app). The top K is compared with the held-out positives: songs the user
completed, liked or saved after the split that they had NOT already played positively before it
(everything the user already loved is excluded from every method, so this measures discovery).

Surfaces: `home` builds one section per taste cluster (like `build_home`) and interleaves them;
every other surface uses the seeded protocol (seed = last song completed before the split, plus
session and taste seeds, as autoplay does) with that surface's weights.

Baselines: `popularity` (most-started songs in the training periods) and `mix` (the YouTube
Mixes of the same seeds, interleaved by rank and de-duplicated; for seeded surfaces that is the
seed's own Mix, i.e. plain YouTube autoplay).

Metrics: Recall@K (hits / held-out positives), NDCG@K (binary relevance), catalogue coverage,
intra-list channel diversity (unique channels / list length) and novelty share (items the
listener never started before the split). `--live` reads only; it never writes and never calls
yt-dlp (the stored `related_songs` graph is the only graph).
"""
from __future__ import annotations

import argparse
import asyncio
import json
import math
import os
import sys
from collections import Counter
from dataclasses import dataclass, field
from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence, Set, Union

if __package__ in (None, ""):  # allow `python recs/evaluate.py`
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    __package__ = "recs"

from . import candidates as cand_mod, surfaces
from .candidates import CandidateSet, Plan, assemble, walk_ids
from .fixtures.synthetic import EvalWorld, build_world
from .graph import Related
from .profile import Profile, RawData, build_profile, meta_from_row, to_ts
from .ranker import score_candidates
from .rerank import rerank
from .text import channel_key
from .weights import SURFACES, exploration_share, get_weights, key_for

SPLIT_QUANTILE = 0.8
POSITIVE = ("complete", "like", "save")           # held-out relevance
PRIOR_POSITIVE = ("complete", "like", "save", "queue")
HOME_LIMIT = 16
POPULAR_POOL = 60
METHODS = ("engine", "popularity", "mix")


# ---------------------------------------------------------------------------
# Metrics (pure)
# ---------------------------------------------------------------------------

def recall_at_k(ranked: Sequence[str], positives: Set[str], k: int) -> float:
    if not positives:
        return 0.0
    return len(set(ranked[:k]) & positives) / len(positives)


def ndcg_at_k(ranked: Sequence[str], positives: Set[str], k: int) -> float:
    """Binary-relevance NDCG: DCG of the list over the DCG of an ideal list."""
    if not positives:
        return 0.0
    dcg = sum(1.0 / math.log2(i + 2) for i, y in enumerate(ranked[:k]) if y in positives)
    ideal = sum(1.0 / math.log2(i + 2) for i in range(min(len(positives), k)))
    return dcg / ideal if ideal else 0.0


def channel_diversity(channels: Sequence[str]) -> float:
    """Unique channels / list length (1.0 = every item from a different channel)."""
    keys = [channel_key(c) for c in channels]
    return len(set(keys)) / len(keys) if keys else 0.0


# ---------------------------------------------------------------------------
# Split
# ---------------------------------------------------------------------------

def split_time(raw: RawData) -> Optional[float]:
    """Timestamp at the 80th percentile of the user's events (train = strictly before)."""
    ts = sorted(to_ts(e.get("created_at")) for e in raw.events)
    return ts[min(len(ts) - 1, int(SPLIT_QUANTILE * len(ts)))] if ts else None


def split_raw(raw: RawData, split: float) -> RawData:
    """Everything the engine may see at `split`: rows strictly before it. Feedback has no
    timestamp in the live schema, so it is kept whole unless the row carries an `at`."""
    def before(rows: Iterable[Dict[str, Any]], key: str) -> List[Dict[str, Any]]:
        return [r for r in rows if to_ts(r.get(key)) < split]

    events = before(raw.events, "created_at")
    liked, playlist, history = before(raw.liked, "at"), before(raw.playlist, "at"), before(raw.history, "at")
    feedback = [f for f in raw.feedback if "at" not in f or to_ts(f["at"]) < split]
    seen = {e.get("youtube_id") for e in events}
    for group in (liked, playlist, history):
        seen.update((r.get("song") or {}).get("youtube_id") for r in group)
    songs = [s for s in raw.songs if s.get("youtube_id") in seen]
    return RawData(events=events, liked=liked, playlist=playlist, history=history, feedback=feedback, songs=songs)


@dataclass
class Case:
    user_id: str
    split: float
    profile: Profile
    train_pos: Set[str]               # songs already played positively before the split
    train_started: Set[str]
    test_pos: Set[str]
    test_events: List[Dict[str, Any]]  # raw events at/after the split, oldest first
    seed: Optional[str]               # last song completed before the split


@dataclass
class Pool:
    sections: List[CandidateSet]
    mix_seeds: List[str]
    exclude: Set[str]


@dataclass
class Prepared:
    world: EvalWorld
    cases: Dict[str, Case]
    popularity: List[str]
    pools: Dict[Any, Optional[Pool]] = field(default_factory=dict)


def prepare(world: EvalWorld) -> Prepared:
    """Split every user, build train profiles and the held-out positives. Users without a
    usable split (too few events, no held-out positive, no seed with a stored Mix) are dropped."""
    cases: Dict[str, Case] = {}
    pop: Counter = Counter()
    for uid, raw in world.users.items():
        split = split_time(raw)
        if split is None or len(raw.events) < 20:
            continue
        train = split_raw(raw, split)
        prof = build_profile(train, uid, split)
        events = sorted(raw.events, key=lambda e: to_ts(e.get("created_at")))
        test_events = [e for e in events if to_ts(e.get("created_at")) >= split]
        train_events = [e for e in events if to_ts(e.get("created_at")) < split]
        train_pos = {e["youtube_id"] for e in train_events if e.get("event") in PRIOR_POSITIVE}
        train_pos |= prof.liked | prof.playlist
        test_pos = {e["youtube_id"] for e in test_events if e.get("event") in POSITIVE}
        test_pos |= {(r.get("song") or {}).get("youtube_id") for g in (raw.liked, raw.playlist)
                     for r in g if to_ts(r.get("at")) >= split}
        test_pos -= train_pos | {None}
        started = {e["youtube_id"] for e in train_events if e.get("event") == "start"}
        for e in train_events:
            if e.get("event") == "start":
                pop[e["youtube_id"]] += 1
        completes = [e["youtube_id"] for e in reversed(train_events)
                     if e.get("event") == "complete" and e["youtube_id"] in world.graphs]
        if not test_pos or not prof.has_signal:
            continue
        cases[uid] = Case(uid, split, prof, train_pos, started, test_pos, test_events,
                          completes[0] if completes else None)
    popularity = [y for y, _ in sorted(pop.items(), key=lambda p: (-p[1], p[0]))]
    return Prepared(world, cases, popularity)


# ---------------------------------------------------------------------------
# Candidate pools (weight-independent, cached)
# ---------------------------------------------------------------------------

def _row_of(prep: Prepared) -> Dict[str, Dict[str, Any]]:
    cache = getattr(prep, "_rows", None)
    if cache is None:
        cache = {s["youtube_id"]: s for s in prep.world.songs}
        setattr(prep, "_rows", cache)
    return cache


def popular_metas(prep: Prepared, n: int = POPULAR_POOL) -> list:
    rows = _row_of(prep)
    return [m for m in (meta_from_row(rows[y]) for y in prep.popularity[:n] if y in rows) if m]


def _assemble_plan(prep: Prepared, case: Case, plan: Plan, top_up: bool = False, need: int = 0) -> CandidateSet:
    ids = list(dict.fromkeys([*plan.seed, *plan.session, *plan.taste]))
    graphs = {s: prep.world.graphs[s] for s in ids if s in prep.world.graphs}
    walk = {s: prep.world.graphs[s] for s in walk_ids(plan, graphs) if s in prep.world.graphs} if plan.walk else {}
    cs = assemble(plan, graphs, walk, case.profile)
    if top_up and len(cs.by_id) < need:  # thin result: the catalogue's most-played songs, as `_top_up` does
        cs = assemble(plan, graphs, walk, case.profile, catalogue_songs=popular_metas(prep))
    return cs


def pool_for(prep: Prepared, uid: str, family: str) -> Optional[Pool]:
    """Candidate sets for a user: family 'home' (one per taste cluster) or 'seed' (autoplay-style)."""
    key = (uid, family)
    if key in prep.pools:
        return prep.pools[key]
    case = prep.cases[uid]
    prof, pool = case.profile, None
    if family == "home":
        clusters = surfaces.cluster_taste(prof)
        graphs = {c.seed: prep.world.graphs.get(c.seed, []) for c in clusters}
        clusters = surfaces.merge_clusters(clusters, graphs)[:3]
        if clusters:
            plans = [Plan(seed=[c.seed], taste=[s for s in c.songs if s != c.seed][:2], walk=True) for c in clusters]
            pool = Pool([_assemble_plan(prep, case, p) for p in plans], [c.seed for c in clusters],
                        set(case.train_pos) | {c.seed for c in clusters})
    elif case.seed:
        session = surfaces._session_seeds(prof, 2, [case.seed])
        taste = surfaces._taste_seeds(prof, 2, [case.seed, *session])
        plan = Plan(seed=[case.seed], session=session, taste=taste, walk=True)
        pool = Pool([_assemble_plan(prep, case, plan, top_up=True, need=30)], [case.seed],
                    set(case.train_pos) | {case.seed})
    prep.pools[key] = pool
    return pool


def family_of(surface: str) -> str:
    return "home" if key_for(surface) == "home" else "seed"


# ---------------------------------------------------------------------------
# Rankers
# ---------------------------------------------------------------------------

def engine_list(prep: Prepared, uid: str, surface: str, weights: Mapping[str, float], k: int) -> List[str]:
    surface = key_for(surface)
    pool = pool_for(prep, uid, family_of(surface))
    if pool is None:
        return []
    prof = prep.cases[uid].profile
    share = exploration_share(surface)
    sections: List[List[str]] = []
    for n, cs in enumerate(pool.sections):
        scored = score_candidates(cs.values(), prof, surface, weights)
        if surface == "home":
            for cap in (surfaces.HOME_ROW_CAP, 4, 0):  # the app relaxes the channel cap when a row is short
                picks = rerank(scored, prof, limit=HOME_LIMIT, exclude=pool.exclude, exploration=share,
                               rng_seed=f"{uid}:{n}", row_cap=cap)
                if len(picks) >= surfaces.HOME_MIN_ITEMS + 4 or cap == 0:
                    break
        else:
            picks = rerank(scored, prof, limit=k, exclude=pool.exclude, exploration=share, rng_seed=uid)
        sections.append([p.scored.cand.youtube_id for p in picks])
    out: List[str] = []
    for i in range(max((len(s) for s in sections), default=0)):  # interleave sections
        for s in sections:
            if i < len(s) and s[i] not in out:
                out.append(s[i])
    return out[:k]


def mix_list(prep: Prepared, uid: str, surface: str, k: int) -> List[str]:
    pool = pool_for(prep, uid, family_of(surface))
    if pool is None:
        return []
    rows = [(r.rank, i, r.youtube_id) for i, s in enumerate(pool.mix_seeds) for r in prep.world.graphs.get(s, [])]
    out: List[str] = []
    for _, _, yt in sorted(rows):
        if yt not in pool.exclude and yt not in out:
            out.append(yt)
    return out[:k]


def popularity_list(prep: Prepared, uid: str, k: int) -> List[str]:
    case = prep.cases[uid]
    skip = case.train_pos | case.profile.hidden_songs
    return [y for y in prep.popularity if y not in skip][:k]


# ---------------------------------------------------------------------------
# Evaluate
# ---------------------------------------------------------------------------

def _summarise(lists: Mapping[str, List[str]], prep: Prepared, k: int) -> Dict[str, float]:
    chan = {s["youtube_id"]: s["channel_name"] for s in prep.world.songs}
    n = max(1, len(lists))
    recs, ndcgs, divs, novs = [], [], [], []
    unique: Set[str] = set()
    for uid, ranked in lists.items():
        case = prep.cases[uid]
        recs.append(recall_at_k(ranked, case.test_pos, k))
        ndcgs.append(ndcg_at_k(ranked, case.test_pos, k))
        if ranked:
            divs.append(channel_diversity([chan.get(y, y) for y in ranked]))
            novs.append(sum(1 for y in ranked if y not in case.train_started) / len(ranked))
        unique.update(ranked)
    avg = lambda xs: sum(xs) / len(xs) if xs else 0.0  # noqa: E731
    return {"recall": avg(recs), "ndcg": sum(ndcgs) / n, "coverage": len(unique) / max(1, len(prep.world.songs)),
            "diversity": avg(divs), "novelty": avg(novs)}


def evaluate(world_or_data: Union[EvalWorld, Prepared], weights: Optional[Mapping[str, float]] = None,
             surface: str = "home", k: int = 10, users: Optional[Sequence[str]] = None) -> Dict[str, Any]:
    """Metrics for the engine (with `weights`, default: the current ones), the popularity baseline
    and raw Mix order. `users` restricts the evaluation to some user ids. Returns
    {"surface", "k", "users", "engine": {...}, "popularity": {...}, "mix": {...}}."""
    prep = world_or_data if isinstance(world_or_data, Prepared) else prepare(world_or_data)
    surface = key_for(surface)
    w = weights if weights is not None else get_weights(surface)
    uids = [u for u in prep.cases if (users is None or u in users) and pool_for(prep, u, family_of(surface))]
    lists = {
        "engine": {u: engine_list(prep, u, surface, w, k) for u in uids},
        "popularity": {u: popularity_list(prep, u, k) for u in uids},
        "mix": {u: mix_list(prep, u, surface, k) for u in uids},
    }
    out: Dict[str, Any] = {"surface": surface, "k": k, "users": len(uids)}
    for name in METHODS:
        out[name] = _summarise(lists[name], prep, k)
    return out


# ---------------------------------------------------------------------------
# Live data (read-only)
# ---------------------------------------------------------------------------

async def _load_live_world() -> EvalWorld:
    from db import get_supabase
    from . import profile as profile_mod
    from .graph import GraphStore

    def user_ids() -> List[str]:
        ids: List[str] = []
        for page in range(10):
            res = (get_supabase().table("listening_events").select("user_id")
                   .range(page * 1000, page * 1000 + 999).execute())
            ids.extend(r["user_id"] for r in (res.data or []))
            if len(res.data or []) < 1000:
                break
        return list(dict.fromkeys(ids))

    uids = await asyncio.to_thread(user_ids)
    users: Dict[str, RawData] = {}
    for uid in uids:
        users[uid] = await profile_mod.fetch_raw(uid)
    seeds = list(dict.fromkeys(
        e["youtube_id"] for raw in users.values() for e in raw.events if e.get("youtube_id")))
    graphs: Dict[str, List[Related]] = {}
    store = GraphStore()
    for i in range(0, len(seeds), 15):
        loaded = await asyncio.to_thread(store._load_sync, seeds[i:i + 15])  # stored rows only, any age
        graphs.update({s: rows for s, (_, rows) in loaded.items()})
    songs: Dict[str, Dict[str, Any]] = {}
    for raw in users.values():
        for s in raw.songs:
            songs.setdefault(s["youtube_id"], s)
        for g in (raw.liked, raw.playlist, raw.history):
            for r in g:
                s = r.get("song") or {}
                if s.get("youtube_id"):
                    songs.setdefault(s["youtube_id"], s)
    for rows in graphs.values():
        for r in rows:
            songs.setdefault(r.youtube_id, {"youtube_id": r.youtube_id, "title": r.title,
                                            "channel_name": r.channel, "duration_sec": r.duration, "thumbnail_url": ""})
    return EvalWorld("live", list(songs.values()), graphs, users)


def load_world(live: bool, seed: int = 7, users: int = 24, plays: int = 170) -> EvalWorld:
    if live:
        return asyncio.run(_load_live_world())
    return build_world(seed=seed, n_users=users, plays_per_user=plays)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def format_table(res: Mapping[str, Any]) -> str:
    k = res["k"]
    lines = [f"surface={res['surface']}  users={res['users']}  K={k}",
             f"{'method':<12}{'Recall@' + str(k):>10}{'NDCG@' + str(k):>10}{'Coverage':>10}{'Diversity':>11}{'Novelty':>9}"]
    for name in METHODS:
        m = res[name]
        lines.append(f"{name:<12}{m['recall']:>10.3f}{m['ndcg']:>10.3f}{m['coverage']:>10.3f}"
                     f"{m['diversity']:>11.3f}{m['novelty']:>9.3f}")
    return "\n".join(lines)


def main(argv: Optional[Sequence[str]] = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m recs.evaluate", description=__doc__.split("\n\n")[0])
    ap.add_argument("--live", action="store_true", help="read the real DB (read-only) instead of the synthetic world")
    ap.add_argument("--surface", choices=[*SURFACES, "both", "all"], default="both",
                    help="both = home + autoplay (default)")
    ap.add_argument("--k", type=int, default=10)
    ap.add_argument("--seed", type=int, default=7, help="synthetic world seed")
    ap.add_argument("--users", type=int, default=24, help="synthetic users")
    ap.add_argument("--json", action="store_true", help="print JSON instead of a table")
    args = ap.parse_args(argv)
    surf = ["home", "autoplay"] if args.surface == "both" else list(SURFACES) if args.surface == "all" else [args.surface]
    try:
        world = load_world(args.live, args.seed, args.users)
    except Exception as exc:  # --live without a reachable DB
        print(f"Could not load data: {exc}", file=sys.stderr)
        return 2
    prep = prepare(world)
    results = {s: evaluate(prep, None, s, args.k) for s in surf}
    if args.json:
        print(json.dumps({"data": world.name, "results": results}, indent=2))
    else:
        print(f"data: {world.name}  songs={len(world.songs)}  users with a usable split={len(prep.cases)}")
        for s in surf:
            print()
            print(format_table(results[s]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
