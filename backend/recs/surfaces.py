"""
One function per surface, each composing candidates -> features -> rank -> rerank -> reasons -> slate.

  next_slate      autoplay after a song           (surface "autoplay")
  radio_slate     radio from a seed, flow order   (surface "radio")
  shuffle_slate   Smart Shuffle fills             (surface "smart_shuffle")
  playlist_slate  recommendations for a playlist  (surface "playlist_recs")
  home_recs       the Home sections               (surface "home")

Every function degrades: a failed Mix fetch falls back to stored graph rows and the catalogue.
"""
from __future__ import annotations

import asyncio
import hashlib
import logging
import random
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Dict, Iterable, List, Optional, Sequence, Set, Tuple

from . import candidates as cand_mod
from . import graph, profile as profile_mod, ranker, reasons, slates
from .candidates import Candidate, CandidateSet, Plan
from .graph import Related
from .models import HomeRecs, HomeSection, RecItem, Slate
from .profile import Profile, SongMeta
from .rerank import Picked, rerank
from .text import channel_key, clean_channel, is_label, label_artists, short_title
from .weights import exploration_share

logger = logging.getLogger(__name__)

HOME_BUDGET_SECONDS = 12.0
HOME_SECTION_LIMIT = 16
HOME_MIN_ITEMS = 4
HOME_ROW_CAP = 2
FLOW_LIFT = 6.0              # radio: how many places a top-scored song may climb in Mix order
PLAYLIST_SEEDS = 6


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

def _thumb(youtube_id: str, given: str = "") -> str:
    return given or f"https://i.ytimg.com/vi/{youtube_id}/hqdefault.jpg"


def _item(p: Picked, profile: Profile, titles: Dict[str, str], hour: Optional[int],
          forced: Optional[Tuple[str, str]] = None) -> RecItem:
    c = p.scored.cand
    text, code = forced if (forced and not p.explored) else reasons.reason_for(
        c, p.scored.features, profile, titles, explored=p.explored, hour=hour)
    return RecItem(
        youtube_id=c.youtube_id, title=c.title or "Unknown", channel=c.channel or "Unknown",
        duration=int(c.duration or 0), thumbnail=_thumb(c.youtube_id, c.thumbnail),
        reason=text, reason_code=code,  # type: ignore[arg-type]
    )


def _meta_item(m: SongMeta, reason: str, code: str) -> RecItem:
    return RecItem(
        youtube_id=m.youtube_id, title=m.title or "Unknown", channel=m.channel or "Unknown",
        duration=int(m.duration or 0), thumbnail=_thumb(m.youtube_id, m.thumbnail),
        reason=reason, reason_code=code,  # type: ignore[arg-type]
    )


def _make_slate(surface: str, rec_id: str, picks: Sequence[Picked], profile: Profile,
                titles: Dict[str, str], hour: Optional[int],
                forced: Optional[Tuple[str, str]] = None) -> Slate:
    items = [_item(p, profile, titles, hour, forced) for p in picks]
    slates.remember(rec_id, surface, {p.scored.cand.youtube_id: p.scored.features for p in picks})
    return Slate(rec_id=rec_id, surface=surface, items=items)


def _rank_and_pick(
    cs: CandidateSet, profile: Profile, surface: str, *, limit: int, exclude: Iterable[str],
    rec_id: str, hour: Optional[int] = None, flow: bool = False, row_cap: int = 0, window: int = 3,
    exploration: Optional[float] = None,
) -> List[Picked]:
    scored = ranker.score_candidates(cs.values(), profile, surface, hour=hour)
    if flow and scored:
        scored = _flow_order(scored)
    share = exploration_share(surface) if exploration is None else exploration
    return rerank(scored, profile, limit=limit, exclude=exclude, exploration=share,
                  rng_seed=rec_id, row_cap=row_cap, window=window)


def _flow_order(scored: List[ranker.Scored]) -> List[ranker.Scored]:
    """Radio keeps the Mix's flow: its order, nudged by score (a song climbs at most ~FLOW_LIFT places)."""
    hi, lo = scored[0].score, scored[-1].score
    span = (hi - lo) or 1.0

    def key(s: ranker.Scored) -> float:
        pos = float((s.cand.best_rank or 60) - 1) if s.cand.direct else 60.0 + (s.cand.best_rank or 0)
        return pos - FLOW_LIFT * (s.score - lo) / span

    return sorted(scored, key=key)


async def _top_up(cs: CandidateSet, profile: Profile, need: int) -> None:
    """Thin result (no Mix, or a tiny one): add the catalogue's most-played songs."""
    if len(cs.by_id) >= need:
        return
    extra = await cand_mod.gather(Plan(walk=False, catalogue=True), profile)
    for yt, c in extra.by_id.items():
        cs.by_id.setdefault(yt, c)


def _rng(*parts: str) -> random.Random:
    return random.Random(hashlib.sha1("|".join(parts).encode()).hexdigest())


def _taste_seeds(profile: Profile, n: int, avoid: Iterable[str]) -> List[str]:
    skip = set(avoid)
    return [y for y in profile.top_songs(n + len(skip)) if y not in skip][:n]


def _session_seeds(profile: Profile, n: int, avoid: Iterable[str]) -> List[str]:
    skip = set(avoid)
    return [y for y in profile.session_completed if y not in skip][:n]


async def _warm(seed: str) -> "asyncio.Task":
    """Start the seed's Mix fetch while the profile loads."""
    return asyncio.ensure_future(graph.related_many([seed], max_live=1))


# ---------------------------------------------------------------------------
# Autoplay / radio / shuffle / playlist
# ---------------------------------------------------------------------------

async def next_slate(user_id: str, seed: str, exclude: Sequence[str] = (), limit: int = 15) -> Slate:
    warm = await _warm(seed)
    profile = await profile_mod.load_profile(user_id)
    session = _session_seeds(profile, 2, [seed])
    taste = _taste_seeds(profile, 2, [seed, *session])
    plan = Plan(seed=[seed], session=session, taste=taste, walk=True, max_live=3, timeout=8.0)
    cs = await cand_mod.gather(plan, profile)
    await warm
    await _top_up(cs, profile, limit * 2)
    rec_id = slates.new_rec_id()
    picks = _rank_and_pick(cs, profile, "autoplay", limit=limit, exclude={seed, *exclude}, rec_id=rec_id)
    return _make_slate("autoplay", rec_id, picks, profile, cs.titles, profile.recent_hour)


async def radio_slate(user_id: str, seed: str, limit: int = 30) -> Slate:
    warm = await _warm(seed)
    profile = await profile_mod.load_profile(user_id)
    cs = await cand_mod.gather(Plan(seed=[seed], walk=True, max_live=1, timeout=10.0), profile)
    await warm
    if not cs.by_id:  # Mix unavailable: radio from taste and the catalogue instead of nothing
        fallback = Plan(taste=_taste_seeds(profile, 3, [seed]), walk=False, max_live=0, catalogue=True)
        cs = await cand_mod.gather(fallback, profile)
    rec_id = slates.new_rec_id()
    picks = _rank_and_pick(cs, profile, "radio", limit=limit, exclude={seed}, rec_id=rec_id,
                           hour=profile.recent_hour, flow=True, window=2)
    return _make_slate("radio", rec_id, picks, profile, cs.titles, profile.recent_hour)


async def shuffle_slate(
    user_id: str, current: Optional[str], context: Sequence[str] = (), exclude: Sequence[str] = (), limit: int = 15,
) -> Slate:
    profile = await profile_mod.load_profile(user_id)
    rng = _rng(current or "", *context[:5])
    pool = [y for y in dict.fromkeys(context) if y != current]
    sampled = rng.sample(pool, min(3, len(pool)))
    seeds = [s for s in [current, *sampled] if s]
    session = _session_seeds(profile, 1, seeds)
    taste = _taste_seeds(profile, 2, [*seeds, *session])
    plan = Plan(seed=seeds, session=session, taste=taste, walk=True, max_live=3, timeout=4.0)
    cs = await cand_mod.gather(plan, profile)
    await _top_up(cs, profile, limit * 2)
    skip = {*context, *exclude, *([current] if current else [])}
    rec_id = slates.new_rec_id()
    picks = _rank_and_pick(cs, profile, "smart_shuffle", limit=limit, exclude=skip, rec_id=rec_id)
    return _make_slate("smart_shuffle", rec_id, picks, profile, cs.titles, profile.recent_hour)


async def playlist_slate(user_id: str, youtube_ids: Sequence[str], exclude: Sequence[str] = (), limit: int = 15) -> Slate:
    profile = await profile_mod.load_profile(user_id)
    ids = list(dict.fromkeys(youtube_ids))
    recent, older = ids[-2:], ids[:-2]
    rng = _rng(*ids[:10], str(len(ids)))
    seeds = list(dict.fromkeys([*recent, *rng.sample(older, min(PLAYLIST_SEEDS - len(recent), len(older)))]))
    taste = _taste_seeds(profile, 1, seeds)
    plan = Plan(seed=seeds, taste=taste, walk=True, max_live=3, timeout=4.0)
    cs = await cand_mod.gather(plan, profile)
    await _top_up(cs, profile, limit * 2)
    rec_id = slates.new_rec_id()
    picks = _rank_and_pick(cs, profile, "playlist_recs", limit=limit, exclude={*ids, *exclude}, rec_id=rec_id)
    return _make_slate("playlist_recs", rec_id, picks, profile, cs.titles, profile.recent_hour)


# ---------------------------------------------------------------------------
# Home
# ---------------------------------------------------------------------------

@dataclass
class Cluster:
    key: str
    name: str
    seed: str
    songs: List[str]
    weight: float
    channels: List[str] = field(default_factory=list)   # artist names folded into this cluster


def display_name(channel: str) -> str:
    return clean_channel(channel)


def plural_songs(n: int) -> str:
    return f"Built from {n} song{'' if n == 1 else 's'} you love"


def artist_map(profile: Profile, ids: Iterable[str]) -> Dict[str, str]:
    """{youtube_id: artist} for songs with a credible artist. Non-label channels are their own
    artist; label uploads (T-Series, Zee Music...) get the credit that recurs across the listener's songs."""
    ids = list(dict.fromkeys(ids))
    out: Dict[str, str] = {}
    labelled: List[Tuple[str, str]] = []
    for yt in ids:
        m = profile.meta.get(yt)
        if not m:
            continue
        if is_label(m.channel):
            labelled.append((yt, m.title))
        else:
            out[yt] = clean_channel(m.channel)
    out.update(label_artists(labelled))
    return out


def _song_name(profile: Profile, yt: str) -> str:
    m = profile.meta.get(yt)
    return short_title(m.title) if m else ""


def cluster_taste(profile: Profile, max_clusters: int = 5) -> List[Cluster]:
    """Group the listener's top songs by artist (a song with no credible artist stands alone)."""
    top = profile.top_songs(60)
    artists = artist_map(profile, top)
    groups: Dict[str, Cluster] = {}
    for yt in top:
        if yt not in profile.meta:
            continue
        artist = artists.get(yt)
        if artist and is_label(artist):
            artist = None
        k = channel_key(artist) if artist else f"song:{yt}"
        name = artist or _song_name(profile, yt)
        if not name:
            continue
        g = groups.get(k)
        if g is None:
            g = groups[k] = Cluster(k, name, yt, [], 0.0, [name])
        g.songs.append(yt)
        g.weight += profile.song_aff.get(yt, 0.0)
    return sorted(groups.values(), key=lambda g: -g.weight)[:max_clusters]


def merge_clusters(clusters: List[Cluster], graphs: Dict[str, List[Related]]) -> List[Cluster]:
    """Fold a cluster into a heavier one when their seeds sit in each other's Mix."""
    out: List[Cluster] = []
    for c in clusters:
        host = next((o for o in out
                     if c.seed in {r.youtube_id for r in graphs.get(o.seed, [])}
                     or o.seed in {r.youtube_id for r in graphs.get(c.seed, [])}), None)
        if host is None:
            out.append(Cluster(c.key, c.name, c.seed, list(c.songs), c.weight, list(c.channels)))
        else:
            host.songs.extend(c.songs)
            host.weight += c.weight
            host.channels.extend(c.channels)
    return out


def unique_names(clusters: List[Cluster], profile: Profile) -> List[Cluster]:
    """No two mixes share a name: a clash falls back to the seed song's title, then is dropped."""
    used: Set[str] = set()
    out: List[Cluster] = []
    for c in clusters:
        for name in (c.name, _song_name(profile, c.seed)):
            if name and is_label(name) and name == c.name:
                continue
            if name and name.casefold() not in used:
                c.name = name
                used.add(name.casefold())
                out.append(c)
                break
    return out


def mix_subtitle(cl: Cluster, profile: Profile, picks: Sequence[Picked]) -> str:
    names = [n for n in dict.fromkeys(_song_name(profile, y) for y in cl.songs) if n and n.casefold() != cl.name.casefold()]
    if len(names) < 2:
        names += [n for n in dict.fromkeys(short_title(p.scored.cand.title) for p in picks)
                  if n and n not in names and n.casefold() != cl.name.casefold()]
    if len(names) >= 2:
        return f"{names[0]}, {names[1]} and more"
    return plural_songs(len(cl.songs))


def _section_picks(cs: CandidateSet, profile: Profile, rec_id: str, hour: int, exclude: Iterable[str],
                   limit: int = HOME_SECTION_LIMIT, exploration: Optional[float] = None,
                   order: Optional[List[Candidate]] = None) -> List[Picked]:
    """Home row: channel cap of 2, relaxed (4, then none) when the row would be too short."""
    excl = set(exclude)
    for cap in (HOME_ROW_CAP, 4, 0):
        if order is None:
            picks = _rank_and_pick(cs, profile, "home", limit=limit, exclude=excl, rec_id=rec_id,
                                   hour=hour, row_cap=cap, exploration=exploration)
        else:
            scored = ranker.score_candidates(order, profile, "home", hour=hour)
            picks = rerank(scored, profile, limit=limit, exclude=excl, exploration=0.0, rng_seed=rec_id, row_cap=cap)
        if len(picks) >= HOME_MIN_ITEMS + 4 or cap == 0:
            return picks
    return picks


def _build_section(kind: str, sid: str, title: str, subtitle: str, picks: List[Picked], profile: Profile,
                   titles: Dict[str, str], hour: int, rec_id: str, seed: Optional[RecItem] = None,
                   forced: Optional[Tuple[str, str]] = None) -> Optional[HomeSection]:
    if len(picks) < HOME_MIN_ITEMS:
        return None
    slate = _make_slate("home", rec_id, picks, profile, titles, hour, forced)
    return HomeSection(id=sid, kind=kind, title=title, subtitle=subtitle, seed=seed,  # type: ignore[arg-type]
                       rec_id=rec_id, items=slate.items)


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.casefold()).strip("-") or "mix"


async def _mix_section(cl: Cluster, profile: Profile, hour: int, used: Set[str]) -> Tuple[Optional[HomeSection], Optional[CandidateSet]]:
    seed_meta = profile.meta.get(cl.seed)
    plan = Plan(seed=[cl.seed], taste=[s for s in cl.songs if s != cl.seed][:2], walk=True, max_live=2, timeout=7.0)
    cs = await cand_mod.gather(plan, profile)
    rec_id = slates.new_rec_id()
    picks = _section_picks(cs, profile, rec_id, hour, exclude={cl.seed})
    subtitle = mix_subtitle(cl, profile, picks)
    seed_item = _meta_item(seed_meta, "Starts from a song you love", "taste") if seed_meta else None
    sec = _build_section("mix", f"mix-{_slug(cl.name)}", f"{cl.name} Mix", subtitle, picks, profile,
                         cs.titles, hour, rec_id, seed_item)
    return sec, cs


def because_subtitle(profile: Profile, seed: str) -> str:
    m = profile.meta.get(seed)
    pool = [seed, *profile.top_songs(60)] if m else []
    artist = artist_map(profile, pool).get(seed)
    return f"More from {artist}" if artist else "More like this"


def _titled(meta: SongMeta) -> bool:
    """A usable "Because you played …" seed: a real song title, not a label name or blank
    (old catalogue rows can carry a channel name as the title)."""
    title = short_title(meta.title or "")
    return bool(title) and title.casefold() != "unknown" and not is_label(title)


async def _because_section(seed: str, profile: Profile, hour: int) -> Tuple[Optional[HomeSection], Optional[CandidateSet]]:
    meta = profile.meta.get(seed)
    if meta is None:
        return None, None
    cs = await cand_mod.gather(Plan(seed=[seed], walk=False, max_live=1, timeout=7.0), profile)
    rec_id = slates.new_rec_id()
    picks = _section_picks(cs, profile, rec_id, hour, exclude={seed})
    title = short_title(meta.title)
    sec = _build_section("because", f"because-{seed}", f"Because you played {title}", because_subtitle(profile, seed), picks,
                         profile, cs.titles, hour, rec_id, _meta_item(meta, "You played this recently", "seed"))
    return sec, cs


def _rediscover_section(profile: Profile, hour: int) -> Optional[HomeSection]:
    pool = profile.rediscover_pool(30)
    if not pool:
        return None
    cands = []
    for yt, _ in pool[:60]:
        m = profile.meta[yt]
        cands.append(Candidate(yt, m.title, m.channel, m.duration, m.thumbnail, sources={"rediscover"}))
    cs = CandidateSet({c.youtube_id: c for c in cands})
    rec_id = slates.new_rec_id()
    picks = _section_picks(cs, profile, rec_id, hour, exclude=(), exploration=0.0, order=cands)
    return _build_section("rediscover", "rediscover", "Back on rotation",
                          "Songs you love, not played in a while", picks, profile, cs.titles, hour, rec_id)


async def _hour_section(profile: Profile, hour: int) -> Optional[HomeSection]:
    def near(yt: str) -> float:
        h = profile.song_hours.get(yt)
        return h[(hour - 1) % 24] + h[hour % 24] + h[(hour + 1) % 24] if h else 0.0

    hour_songs = sorted((y for y in profile.song_hours if near(y) > 0 and y in profile.meta
                         and y not in profile.hidden_songs), key=lambda y: -near(y))
    if not hour_songs:
        return None
    cs = await cand_mod.gather(Plan(taste=hour_songs[:2], walk=False, max_live=0), profile)
    for y in hour_songs[:30]:
        m = profile.meta[y]
        c = cs.by_id.setdefault(y, Candidate(y, m.title, m.channel, m.duration, m.thumbnail))
        c.sources.add("taste")
    rec_id = slates.new_rec_id()
    picks = _section_picks(cs, profile, rec_id, hour, exclude=())
    label = reasons.hour_label(hour)
    return _build_section("hour", "hour", f"Your {label} set", "Built from what you play around this time",
                          picks, profile, cs.titles, hour, rec_id, forced=reasons.hour_reason(hour))


async def _discover_section(pools: List[CandidateSet], profile: Profile, hour: int, used: Set[str]) -> Optional[HomeSection]:
    merged: Dict[str, Candidate] = {}
    titles: Dict[str, str] = {}
    for cs in pools:
        titles.update(cs.titles)
        for yt, c in cs.by_id.items():
            merged.setdefault(yt, c)
    if len(merged) < HOME_MIN_ITEMS * 3:
        extra = await cand_mod.gather(Plan(walk=False, catalogue=True), profile)
        for yt, c in extra.by_id.items():
            merged.setdefault(yt, c)
        titles.update(extra.titles)
    cs = CandidateSet(merged, titles)
    rec_id = slates.new_rec_id()
    scored = [s for s in ranker.score_candidates(cs.values(), profile, "home", hour=hour)
              if s.features["novelty"] >= 0.5 and s.cand.youtube_id not in used]
    picks: List[Picked] = []
    for cap in (HOME_ROW_CAP, 4, 0):
        picks = rerank(scored, profile, limit=HOME_SECTION_LIMIT, exploration=0.0, rng_seed=rec_id, row_cap=cap)
        if len(picks) >= HOME_MIN_ITEMS + 4:
            break
    return _build_section("discover", "discover", "New to you", "Songs you haven't played yet", picks, profile,
                          cs.titles, hour, rec_id)


async def build_home(profile: Profile, hour: int) -> List[HomeSection]:
    """Sections in display order. Empty sections are left out; slow ones are dropped after the budget."""
    clusters = cluster_taste(profile)
    if clusters:  # Mixes of the top cluster seeds (live-capped) decide which clusters are neighbours
        graphs = await graph.related_many([c.seed for c in clusters], max_live=3, timeout=7.0)
        clusters = unique_names(merge_clusters(clusters, graphs), profile)[:3]

    mix_seeds = {c.seed for c in clusters}
    recent = sorted((y for y in profile.last_played if y in profile.meta and profile.song_aff.get(y, 0) > 0.5
                     and y not in mix_seeds and y not in profile.hidden_songs and _titled(profile.meta[y])),
                    key=lambda y: -profile.last_played[y])[:2]

    mix_tasks = [asyncio.ensure_future(_mix_section(c, profile, hour, set())) for c in clusters]
    because_tasks = [asyncio.ensure_future(_because_section(s, profile, hour)) for s in recent]
    hour_task = asyncio.ensure_future(_hour_section(profile, hour))
    all_tasks = [*mix_tasks, *because_tasks, hour_task]
    done, pending = await asyncio.wait(all_tasks, timeout=HOME_BUDGET_SECONDS) if all_tasks else (set(), set())
    for t in pending:
        t.cancel()  # shielded Mix fetches carry on and are saved for next time

    def result(t: "asyncio.Future") -> Tuple[Optional[HomeSection], Optional[CandidateSet]]:
        if t in done and not t.cancelled() and t.exception() is None:
            return t.result()
        if t in done and not t.cancelled():
            logger.warning("Home section failed: %s", t.exception())
        return None, None

    mixes = [result(t) for t in mix_tasks]
    becauses = [result(t) for t in because_tasks]
    hour_sec = None
    if hour_task in done and not hour_task.cancelled() and hour_task.exception() is None:
        hour_sec = hour_task.result()

    used = {i.youtube_id for sec, _ in mixes if sec for i in sec.items}
    pools = [cs for _, cs in (*mixes, *becauses) if cs]
    discover = await _discover_section(pools, profile, hour, used) if (pools or not profile.has_signal) else None
    rediscover = _rediscover_section(profile, hour)

    ordered: List[Optional[HomeSection]] = [
        *(s for s, _ in mixes), discover, rediscover, *(s for s, _ in becauses), hour_sec,
    ]
    return [s for s in ordered if s is not None]


async def home_recs(user_id: str, hour: int) -> HomeRecs:
    cached = slates.get_home(user_id)
    if cached is not None:
        return cached
    profile = await profile_mod.load_profile(user_id)
    sections = await build_home(profile, hour)
    home = HomeRecs(generated_at=datetime.now(timezone.utc).isoformat(), sections=sections)
    if sections:
        slates.put_home(user_id, home)
    return home
