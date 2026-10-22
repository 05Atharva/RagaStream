"""
Deterministic synthetic listening world for `recs.evaluate`, `recs.train` and the tests.

    from recs.fixtures.synthetic import build_world
    world = build_world(seed=7)

Shape: ~200 songs in 8 taste clusters (3 channels each), a Mix per song (about three
quarters same-cluster neighbours, the rest cross-cluster noise that favours the global hits),
~24 users with 1-3 preferred clusters and a time-ordered event stream over 60 days.

Realism knobs: songs follow a Zipf-like popularity curve inside their cluster; each user
jitters song and channel preference; a handful of global hits are played by everyone and
only sometimes liked outside the listener's taste; out-of-taste plays are mostly early
skips; a few songs get hidden. The same seed always gives the same world.
"""
from __future__ import annotations

import math
import random
from dataclasses import dataclass, field
from typing import Any, Dict, List

from ..graph import Related
from ..profile import RawData

NOW = 1_800_000_000.0
DAY = 86400.0
CHANNELS_PER_CLUSTER = 3


@dataclass
class EvalWorld:
    """Everything the evaluator needs: catalogue, stored graph and each user's full history."""
    name: str
    songs: List[Dict[str, Any]]                      # songs rows (youtube_id, title, channel_name, duration_sec)
    graphs: Dict[str, List[Related]]                 # seed -> Mix rows in rank order
    users: Dict[str, RawData]                        # user_id -> all rows (train/test split happens later)
    preferred: Dict[str, List[int]] = field(default_factory=dict)   # synthetic only: user -> cluster ids
    cluster_of: Dict[str, int] = field(default_factory=dict)        # synthetic only: song -> cluster id
    hits: List[str] = field(default_factory=list)                   # synthetic only: global hit songs


def _song_row(yt: str, title: str, channel: str, dur: int) -> Dict[str, Any]:
    return {"youtube_id": yt, "title": title, "channel_name": channel, "duration_sec": dur, "thumbnail_url": ""}


def _sample_weighted(rng: random.Random, items: List[str], weights: List[float], n: int) -> List[str]:
    """n distinct items, probability proportional to weight."""
    items, weights = list(items), list(weights)
    out: List[str] = []
    for _ in range(min(n, len(items))):
        i = rng.choices(range(len(items)), weights=weights, k=1)[0]
        out.append(items.pop(i))
        weights.pop(i)
    return out


def build_world(seed: int = 7, n_clusters: int = 8, per_cluster: int = 25, n_users: int = 24,
                days: int = 60, plays_per_user: int = 170, now: float = NOW,
                n_same: int = 18, n_cross: int = 6, shared_channels: bool = False) -> EvalWorld:
    rng = random.Random(seed)

    # --- catalogue ---------------------------------------------------------------
    songs: List[Dict[str, Any]] = []
    cluster_of: Dict[str, int] = {}
    chan_idx: Dict[str, int] = {}
    by_cluster: Dict[int, List[str]] = {c: [] for c in range(n_clusters)}
    pop: Dict[str, float] = {}
    for c in range(n_clusters):
        order = list(range(per_cluster))
        rng.shuffle(order)
        for i in range(per_cluster):
            yt = f"s{c}_{i:02d}"
            j = i % CHANNELS_PER_CLUSTER
            songs.append(_song_row(yt, f"Tune {c}-{i}", (f"Label {'abc'[j]}" if shared_channels else f"Artist {c}{'abc'[j]}"), 180 + (i * 7) % 90))
            cluster_of[yt] = c
            chan_idx[yt] = j
            by_cluster[c].append(yt)
            pop[yt] = 1.0 / (order[i] + 1) ** 0.9
    hits = [max(by_cluster[c], key=lambda y: pop[y]) for c in range(n_clusters)]
    for h in hits:
        pop[h] *= 2.0
    all_ids = [s["youtube_id"] for s in songs]
    row_of = {s["youtube_id"]: s for s in songs}

    # --- stored Mix graph ----------------------------------------------------------
    graphs: Dict[str, List[Related]] = {}
    for yt in all_ids:
        c = cluster_of[yt]
        same = [y for y in by_cluster[c] if y != yt]
        cross = [y for y in all_ids if cluster_of[y] != c]
        picked = _sample_weighted(rng, same, [pop[y] + 0.15 for y in same], n_same)
        picked += _sample_weighted(rng, cross, [(3.0 if y in hits else 0.3) * pop[y] + 0.02 for y in cross], n_cross)
        keyed = sorted(picked, key=lambda y: rng.random() - 0.35 * pop[y] - (0.3 if cluster_of[y] == c else 0.0))
        graphs[yt] = [
            Related(y, r + 1, row_of[y]["title"], row_of[y]["channel_name"], row_of[y]["duration_sec"])
            for r, y in enumerate(keyed)
        ]

    # --- users and their event streams ------------------------------------------------
    users: Dict[str, RawData] = {}
    preferred: Dict[str, List[int]] = {}
    t0 = now - days * DAY
    for u in range(n_users):
        uid = f"u{u:02d}"
        clusters = rng.sample(range(n_clusters), 1 + u % 3)
        preferred[uid] = clusters
        cw = [rng.uniform(0.6, 1.4) for _ in clusters]
        base_hour = {c: rng.choice([8, 13, 18, 22]) for c in clusters}
        fav_channel = {c: rng.randrange(CHANNELS_PER_CLUSTER) for c in clusters}
        jitter = {y: math.exp(rng.gauss(0.0, 0.7)) for y in all_ids}

        heard: Dict[str, int] = {}                  # listeners seek new songs: repeats get less likely

        def song_weight(y: str) -> float:
            fav = fav_channel.get(cluster_of[y]) == chan_idx[y]
            return pop[y] * jitter[y] * (2.0 if fav else 1.0) * 0.35 ** heard.get(y, 0)

        raw = RawData()
        hidden: set = set()
        starts = sorted(t0 + rng.uniform(0, days) * DAY for _ in range(max(1, plays_per_user // 4)))
        for st in starts:
            sc = rng.choices(clusters, weights=cw, k=1)[0]
            hour = (base_hour[sc] + rng.choice([-1, 0, 0, 1])) % 24
            ts = math.floor(st / DAY) * DAY + hour * 3600 + rng.uniform(0, 1800)
            for _ in range(rng.randint(3, 5)):
                r = rng.random()
                if r < 0.75:
                    pool = by_cluster[sc]
                elif r < 0.87:
                    pool = hits
                else:
                    pool = by_cluster[rng.randrange(n_clusters)]
                yt = rng.choices(pool, weights=[song_weight(y) for y in pool], k=1)[0]
                dur = row_of[yt]["duration_sec"]
                in_taste = cluster_of[yt] in clusters
                p_complete = 0.82 if in_taste else (0.35 if yt in hits else 0.08)
                _play(rng, raw, row_of[yt], yt, ts, dur, hour, in_taste, p_complete, hidden)
                heard[yt] = heard.get(yt, 0) + 1
                ts += dur + rng.uniform(0, 30)
        raw.events.sort(key=lambda e: e["created_at"])
        raw.songs = [row_of[y] for y in dict.fromkeys(e["youtube_id"] for e in raw.events)]
        users[uid] = raw
    return EvalWorld("synthetic", songs, graphs, users, preferred, cluster_of, hits)


def _play(rng: random.Random, raw: RawData, row: Dict[str, Any], yt: str, ts: float, dur: int, hour: int,
          in_taste: bool, p_complete: float, hidden: set) -> None:
    """Append the events (and library rows) of one play."""
    def ev(kind: str, at: float, listened: float) -> None:
        raw.events.append({"youtube_id": yt, "event": kind, "surface": "other", "listened_sec": round(listened, 1),
                           "duration_sec": dur, "local_hour": hour, "created_at": at})

    ev("start", ts, 0.0)
    if rng.random() < p_complete:
        done = ts + dur
        ev("complete", done, dur)
        if in_taste and rng.random() < 0.07:
            ev("like", done + 1, dur)
            raw.liked.append({"at": done + 1, "song": row})
        if in_taste and rng.random() < 0.04:
            ev("save", done + 2, dur)
            raw.playlist.append({"at": done + 2, "song": row})
        return
    if in_taste:
        listened = rng.uniform(35.0, dur * 0.45)         # drifted off mid-song
    else:
        listened = rng.uniform(4.0, 25.0)                # early skip
        if rng.random() < 0.03 and yt not in hidden:
            hidden.add(yt)
            raw.feedback.append({"target_type": "song", "target_id": yt, "kind": "hide", "at": ts + listened})
    ev("skip", ts + listened, listened)


def build_noisy_world(seed: int = 7, n_users: int = 24) -> EvalWorld:
    """The deliberately different world used to guard against tuning to one generator: ~40% of each
    Mix is cross-cluster, channels are record labels shared by every cluster (a channel says little
    about taste) and users have fewer events."""
    return build_world(seed=seed, n_users=n_users, plays_per_user=110, n_same=14, n_cross=10,
                       shared_channels=True)
