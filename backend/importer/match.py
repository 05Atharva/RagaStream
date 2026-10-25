"""
Find a source track on YouTube.

Searching goes through routers.youtube.search_videos (30-minute cache, in-flight sharing). Each
result is scored from title, artist, channel, duration and variant signals into a 0..1 confidence;
the best result is accepted at >= ACCEPT. Scoring is pure so it can be tested without any network.
"""
from __future__ import annotations

import asyncio
import logging
import re
import unicodedata
from dataclasses import dataclass
from difflib import SequenceMatcher
from typing import Dict, List, Optional, Sequence, Tuple

from fastapi import HTTPException

from recs.text import clean_channel, clean_title, is_compilation, is_label, is_non_music, variants
from schemas import YouTubeSearchResult

from .types import SourceTrack

logger = logging.getLogger(__name__)

ACCEPT = 0.55
SEARCH_LIMIT = 8
GLOBAL_SEARCHES = 4
# Imports run in the background, so a short YouTube rate limit is waited out
# (bounded) instead of marking every remaining song as failed.
RATE_LIMIT_RETRIES = 3
RATE_LIMIT_MAX_WAIT = 120   # seconds; a longer cooldown fails the search

# ---------------------------------------------------------------------------
# Text similarity (pure Python, no dependency)
# ---------------------------------------------------------------------------


def tokens(text: str) -> List[str]:
    """Lower-case words. Accents on Latin letters are dropped; Indic scripts keep their marks."""
    decomposed = unicodedata.normalize("NFKD", (text or "").casefold())
    kept = "".join(c for c in decomposed if not 0x300 <= ord(c) <= 0x36F)
    words, current = [], []
    for ch in kept:
        if ch.isalnum() or unicodedata.category(ch).startswith("M"):
            current.append(ch)
        elif current:
            words.append("".join(current))
            current = []
    if current:
        words.append("".join(current))
    return words


def _ratio(a: str, b: str) -> float:
    return SequenceMatcher(None, a, b).ratio() if a and b else 0.0


def token_set_ratio(a: str, b: str) -> float:
    """0..1. Order and repeated words don't matter; a shared core counts even with extra words."""
    ta, tb = set(tokens(a)), set(tokens(b))
    if not ta or not tb:
        return 0.0
    common = sorted(ta & tb)
    s0 = " ".join(common)
    s1 = " ".join(common + sorted(ta - tb))
    s2 = " ".join(common + sorted(tb - ta))
    if not common:
        return _ratio(s1, s2)
    return max(_ratio(s0, s1), _ratio(s0, s2), _ratio(s1, s2))


def token_sort_ratio(a: str, b: str) -> float:
    return _ratio(" ".join(sorted(tokens(a))), " ".join(sorted(tokens(b))))


# ---------------------------------------------------------------------------
# Titles and variants
# ---------------------------------------------------------------------------

_SRC_BRACKET_NOISE = re.compile(r"[\(\[]\s*(?:from|feat|ft|with|prod|remaster\w*|\d{4}\s+remaster\w*)\b[^\)\]]*[\)\]]", re.I)
_SRC_DASH_NOISE = re.compile(
    r"\s+-\s+(?:from\b|remaster\w*|\d{4}\s+remaster\w*|radio\s+edit|single\s+version|bonus\s+track|mono|stereo|"
    r"original\s+motion\s+picture).*$", re.I)

# Words a YouTube title adds that no source title has.
_NOISE_TOKENS = frozenset({
    "official", "video", "audio", "song", "full", "hd", "hq", "4k", "lyrics", "lyric", "lyrical", "music",
    "visualizer", "visualiser", "remastered", "new", "latest", "version", "songs", "film", "movie", "ft", "feat",
    "featuring", "topic", "vevo",
})

_EXTRA_VARIANTS = {
    "8d": re.compile(r"\b8d\b", re.I),
    "karaoke": re.compile(r"\bkaraoke\b", re.I),
    "instrumental": re.compile(r"\binstrumental\b", re.I),
    "sped": re.compile(r"\bsped[\s\-]?up\b|\bnightcore\b|\bspeed(?:ed)?\s+up\b", re.I),
    "bass": re.compile(r"\bbass[\s\-]?boost(?:ed)?\b", re.I),
    # "Sad Version", "Fan Version", "Film Version", "Female Mix", "Reprise", "Acoustic": not the original track
    "alt_version": re.compile(
        r"\b(?:sad|fan|female|male|film|duet|slow|club|extended|short|alternate|alternative|dance|solo)\s+(?:version|mix|edit)\b"
        r"|\breprise\b|\bacoustic\b|\bmashup\b", re.I),
}
_LYRICS_ONLY = re.compile(r"\blyrics?\b|\blyrical\b", re.I)
_OFFICIAL = re.compile(r"\bofficial\b|vevo\b", re.I)


def core_title(title: str) -> str:
    """Source title without '(feat. X)', '(From "Movie")', '- Remastered 2011'."""
    t = _SRC_BRACKET_NOISE.sub(" ", title or "")
    t = _SRC_DASH_NOISE.sub("", t)
    return re.sub(r"\s+", " ", t).strip() or (title or "").strip()


def all_variants(title: str) -> frozenset:
    found = set(variants(title))
    found.update(name for name, pat in _EXTRA_VARIANTS.items() if pat.search(title or ""))
    return frozenset(found)


# ---------------------------------------------------------------------------
# Scoring
# ---------------------------------------------------------------------------


def _artist_score(artists: Sequence[str], haystack: set, label_channel: bool) -> float:
    """How well the source artists show up in the channel name or the video title (0..1)."""
    best = 0.0
    for i, artist in enumerate(artists[:4]):
        words = tokens(artist)
        if not words:
            continue
        hit = sum(1 for w in words if w in haystack or any(_ratio(w, h) >= 0.86 for h in haystack if abs(len(h) - len(w)) <= 2))
        weight = 1.0 if i == 0 else 0.85
        best = max(best, weight * hit / len(words))
    if best == 0.0 and artists and label_channel:
        return 0.5   # a label channel (T-Series, Zee...) carries no artist name; neither for nor against
    return best


def score_candidate(
    title: str,
    artists: Sequence[str],
    duration_sec: Optional[int],
    cand_title: str,
    cand_channel: str,
    cand_duration: int,
    source_title_raw: Optional[str] = None,
) -> float:
    """Confidence 0..1 that this YouTube result is the source song."""
    src_core = core_title(title)
    src_variants = all_variants(source_title_raw if source_title_raw is not None else title)
    cand_variants = all_variants(cand_title)

    artist_words = {w for a in artists for w in tokens(a)}
    channel = clean_channel(cand_channel or "")
    channel_words = set(tokens(channel))
    topic = bool(re.search(r"-\s*topic\s*$", cand_channel or "", re.I))
    label = is_label(cand_channel or "")

    src_words = set(tokens(src_core))
    # "Song (From 'Movie') | Cast | Composers": only the song part is compared with the source title.
    cand_head = core_title(clean_title(cand_title))
    cand_words = [w for w in tokens(cand_head) if w not in _NOISE_TOKENS]
    # Artist names in the video title ("Arijit Singh - Kesariya") aren't part of the song's title.
    trimmed = [w for w in cand_words if w in src_words or w not in artist_words]
    title_sim = 0.5 * token_set_ratio(src_core, " ".join(trimmed)) + 0.5 * token_sort_ratio(src_core, " ".join(trimmed))

    haystack = channel_words | set(tokens(cand_title))
    artist = _artist_score(artists, haystack, label and not channel_words & artist_words)
    if topic:
        artist = max(artist, 0.5)   # auto-generated "Artist - Topic" / "Release - Topic": studio audio, name unknown
    score = 0.55 * title_sim + 0.25 * artist

    if topic:
        score += 0.10
    elif _OFFICIAL.search(cand_channel or ""):
        score += 0.05
    elif label:
        score += 0.05
    elif _OFFICIAL.search(cand_title or ""):
        score += 0.02

    if duration_sec and cand_duration:
        diff = abs(duration_sec - cand_duration)
        if diff <= 8:
            score += 0.12
        elif diff <= 20:
            score += 0.06
        elif diff > 60:
            score -= 0.15
        elif diff > 30:
            score -= 0.04

    extra = cand_variants - src_variants
    soft = {"lyrics"} if _LYRICS_ONLY.search(cand_title or "") and not _LYRICS_ONLY.search(source_title_raw or title) else set()
    score -= min(0.55, 0.30 * len(extra))
    if soft:
        score -= 0.12
    score -= 0.15 * len(src_variants - cand_variants)   # asked for the slowed version, got the original
    if is_compilation(cand_title) and not is_compilation(title):
        score -= 0.30
    if is_non_music(cand_title) and not is_non_music(title):
        score -= 0.40
    return max(0.0, min(1.0, score))


@dataclass
class Match:
    candidate: YouTubeSearchResult
    confidence: float
    title: str = ""          # the reading that matched (matters for pasted "A - B" lines)


def rank_candidates(
    title: str,
    artists: Sequence[str],
    duration_sec: Optional[int],
    candidates: Sequence[YouTubeSearchResult],
) -> List[Tuple[float, YouTubeSearchResult]]:
    """Best first. Ties go to the closer duration, then the earlier search result."""
    scored = []
    for position, cand in enumerate(candidates):
        if not cand.youtube_id:
            continue
        s = score_candidate(title, artists, duration_sec, cand.title, cand.channel, cand.duration)
        diff = abs(duration_sec - cand.duration) if duration_sec and cand.duration else 10_000
        scored.append((round(s, 4), -diff, -position, cand))
    scored.sort(key=lambda row: (row[0], row[1], row[2]), reverse=True)
    return [(s, c) for s, _d, _p, c in scored]


def pick_best(track: SourceTrack, results: Sequence[YouTubeSearchResult]) -> Optional[Match]:
    """Best candidate across both readings of an ambiguous pasted line."""
    readings = [(track.title, track.artists)]
    if track.alt_title:
        readings.append((track.alt_title, track.alt_artists))
    best: Optional[Match] = None
    for title, artists in readings:
        ranked = rank_candidates(title, artists, track.duration_sec, results)
        if ranked and (best is None or ranked[0][0] > best.confidence):
            best = Match(candidate=ranked[0][1], confidence=ranked[0][0], title=title)
    return best


def queries_for(track: SourceTrack) -> List[str]:
    """Primary query, then the fallback ('title artists audio')."""
    out: List[str] = []
    readings = [(track.title, track.artists)]
    if track.alt_title:
        readings.append((track.alt_title, track.alt_artists))
    for title, artists in readings[:1]:
        core = core_title(title)
        first = artists[0] if artists else ""
        out.append(f"{core} {first}".strip())
        out.append(f"{core} {' '.join(artists[:3])} audio".strip())
    if track.alt_title:
        # Ambiguous "A - B": one extra query that searches the whole line, in the other order.
        out.insert(1, f"{core_title(track.alt_title)} {track.alt_artists[0] if track.alt_artists else ''}".strip())
    seen, unique = set(), []
    for q in out:
        key = " ".join(q.casefold().split())
        if q and key not in seen:
            seen.add(key)
            unique.append(q)
    return unique


# ---------------------------------------------------------------------------
# Searching (3 at a time per job, 4 at a time overall)
# ---------------------------------------------------------------------------

_global_sems: Dict[int, asyncio.Semaphore] = {}


def global_search_limit() -> asyncio.Semaphore:
    """One semaphore per running event loop (a semaphore must not outlive its loop)."""
    loop_id = id(asyncio.get_running_loop())
    if loop_id not in _global_sems:
        if len(_global_sems) > 8:
            _global_sems.clear()
        _global_sems[loop_id] = asyncio.Semaphore(GLOBAL_SEARCHES)
    return _global_sems[loop_id]


class SearchError(Exception):
    """YouTube search itself failed (not 'no good match')."""


def _rate_limit_wait(exc: HTTPException) -> Optional[float]:
    """Seconds the server asked us to wait (HTTP 429), or None for other errors."""
    if exc.status_code != 429:
        return None
    try:
        return float((exc.headers or {}).get("Retry-After", 30))
    except (TypeError, ValueError):
        return 30.0


async def search(query: str, sleep=asyncio.sleep) -> List[YouTubeSearchResult]:
    from routers.youtube import search_videos  # late: keeps this module testable without yt-dlp set up

    for attempt in range(RATE_LIMIT_RETRIES + 1):
        async with global_search_limit():
            try:
                return await search_videos(query, SEARCH_LIMIT)
            except HTTPException as exc:
                wait = _rate_limit_wait(exc)
                if wait is None or wait > RATE_LIMIT_MAX_WAIT or attempt == RATE_LIMIT_RETRIES:
                    raise SearchError(exc.detail) from exc
        await sleep(wait)  # outside the limit, so other searches aren't held up
    raise SearchError("YouTube search failed.")  # unreachable; keeps type checkers happy


async def find_match(track: SourceTrack, search_fn=search) -> Tuple[Optional[Match], bool]:
    """(best match or None, search_failed). The best match may be below ACCEPT; the caller decides.
    Stops at the first query whose best result is good enough. `search_failed` is True when every
    query errored, so the caller can tell 'YouTube is down' from 'not found'."""
    best: Optional[Match] = None
    errors = attempts = 0
    for query in queries_for(track)[:3]:
        attempts += 1
        try:
            results = await search_fn(query)
        except SearchError:
            errors += 1
            continue
        found = pick_best(track, results)
        if found and (best is None or found.confidence > best.confidence):
            best = found
        if best and best.confidence >= ACCEPT:
            break
    return best, (bool(attempts) and errors == attempts)
