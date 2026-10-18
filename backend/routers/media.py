"""
Media router — lyrics and artwork colour.

Endpoints:
  GET /lyrics?title=&artist=&duration=   Synced lyrics via LRCLIB (free, no key)
  GET /artwork/color?url=                Dominant colour of a YouTube thumbnail
"""
from __future__ import annotations

import asyncio
import colorsys
import difflib
import io
import logging
import re
import time
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, HTTPException, Query
from PIL import Image

from schemas import ArtworkColorResponse, LyricLine, LyricsResponse

logger = logging.getLogger(__name__)
router = APIRouter()

LRCLIB_SEARCH_URL = "https://lrclib.net/api/search"
HTTP_HEADERS = {"User-Agent": "RagaStream/1.0 (personal music player)"}
CACHE_TTL_SECONDS = 24 * 60 * 60
MAX_CACHE_ENTRIES = 2000

_lyrics_cache: Dict[str, Dict[str, Any]] = {}
_color_cache: Dict[str, Dict[str, Any]] = {}


def _cache_get(cache: Dict[str, Dict[str, Any]], key: str) -> Any:
    entry = cache.get(key)
    if entry and entry["expires_at"] > time.time():
        return entry["data"]
    return None


def _cache_set(cache: Dict[str, Dict[str, Any]], key: str, data: Any) -> None:
    if len(cache) >= MAX_CACHE_ENTRIES:
        cache.pop(next(iter(cache)))
    cache[key] = {"data": data, "expires_at": time.time() + CACHE_TTL_SECONDS}


# ---------------------------------------------------------------------------
# Lyrics
# ---------------------------------------------------------------------------

# Words YouTube uploaders bolt onto titles that never appear in a track name.
_NOISE_RE = re.compile(
    r"\b(official|full|video|song|songs|audio|lyrical|lyrics?|with lyrics|8k|4k|hd|hq|"
    r"title|track|music|mv|remastered|bonus|jukebox|visualizer|"
    r"(?:feat|ft)\.?\s.*)\b",
    re.IGNORECASE,
)
_BRACKETS_RE = re.compile(r"[\(\[\{【].*?[\)\]\}】]")
_SEPARATORS_RE = re.compile(r"\s*[|‖¦~•:]\s*|\s+[-–—]\s+")


def _normalize(text: str) -> str:
    text = _BRACKETS_RE.sub(" ", text)
    text = _NOISE_RE.sub(" ", text)
    text = re.sub(r"[\"'“”‘’]", "", text)
    return re.sub(r"\s+", " ", text).strip(" -–—,.").strip()


def _title_candidates(title: str, artist: Optional[str]) -> List[str]:
    """
    Turn a raw YouTube title into likely track names, most specific first.
    'Aashiqui 2: Tum Hi Ho 8K Full Song | Aditya Roy Kapur' →
    ['Tum Hi Ho', 'Aashiqui 2', 'Aditya Roy Kapur', ...]
    """
    raw_segments = _SEPARATORS_RE.split(_BRACKETS_RE.sub(" ", title))
    # "Kun Faya Kun Full Video Song Rockstar" — the song name ends where the
    # first noise word starts; whatever follows is usually the movie.
    normalized = [_normalize(_NOISE_RE.split(s)[0]) or _normalize(s) for s in raw_segments]
    # "Movie: Song" — the part after a colon is usually the song. Only when the
    # pre-colon part is a real name (not a stripped label like "Lyrical:").
    colon_first = ":" in title and title.index(":") < len(raw_segments[0]) + 1
    if colon_first and len(normalized) >= 2 and len(normalized[0]) >= 2:
        normalized[0], normalized[1] = normalized[1], normalized[0]

    candidates: List[str] = []
    for seg in normalized:
        if len(seg) >= 2 and seg.lower() not in (c.lower() for c in candidates):
            candidates.append(seg)
    # The channel is usually a label (T-Series, Sony Music), so it's only used
    # for scoring, never as a query. Cap queries to stay polite to LRCLIB.
    return candidates[:3]


def _similarity(a: str, b: str) -> float:
    return difflib.SequenceMatcher(None, a.lower(), b.lower()).ratio()


def _score(result: dict, candidate: str, duration: Optional[int], title: str) -> float:
    track = result.get("trackName") or ""
    score = _similarity(track, candidate) ** 2 * 3
    if _normalize(track).lower() == candidate.lower():
        score += 1.0
    # Covers share the track name; the real artist is often named in the title.
    artists = re.split(r",|&| x | and |feat\.?", (result.get("artistName") or "").lower())
    if any(len(a.strip()) > 3 and a.strip() in title.lower() for a in artists):
        score += 0.75
    if result.get("syncedLyrics"):
        score += 1.0
    if duration and result.get("duration"):
        diff = abs(float(result["duration"]) - duration)
        # Music videos often carry long intros/outros, so penalise gently.
        score += 1.0 if diff <= 8 else 0.6 if diff <= 20 else 0.2 if diff <= 45 else -1.0
    if result.get("instrumental"):
        score -= 3
    return score


_LRC_LINE_RE = re.compile(r"\[(\d+):(\d+(?:\.\d+)?)\]")


def _parse_lrc(synced: str) -> List[LyricLine]:
    lines: List[LyricLine] = []
    for raw in synced.splitlines():
        stamps = _LRC_LINE_RE.findall(raw)
        text = _LRC_LINE_RE.sub("", raw).strip()
        for minutes, seconds in stamps:
            lines.append(LyricLine(time=int(minutes) * 60 + float(seconds), text=text))
    return sorted(lines, key=lambda line: line.time)


async def _search_lrclib(client: httpx.AsyncClient, query: str) -> Optional[List[dict]]:
    """Search results, or None when LRCLIB is unreachable/overloaded."""
    try:
        resp = await client.get(LRCLIB_SEARCH_URL, params={"q": query}, timeout=8.0)
        if resp.status_code == 200:
            data = resp.json()
            return data if isinstance(data, list) else []
        logger.warning("LRCLIB search %r returned %s", query, resp.status_code)
    except httpx.HTTPError as exc:
        logger.warning("LRCLIB search failed for %r: %s", query, exc)
    return None


@router.get("/lyrics", response_model=LyricsResponse)
async def get_lyrics(
    title: str = Query(..., min_length=1),
    artist: Optional[str] = Query(None),
    duration: Optional[int] = Query(None, ge=0),
):
    """Find the best LRCLIB match for a YouTube title; synced lines when available."""
    cache_key = f"{title}|{artist}|{duration}"
    cached = _cache_get(_lyrics_cache, cache_key)
    if cached is not None:
        if cached == "miss":
            raise HTTPException(status_code=404, detail="No lyrics found.")
        return cached

    candidates = _title_candidates(title, artist)
    async with httpx.AsyncClient(headers=HTTP_HEADERS) as client:
        results = await asyncio.gather(*(_search_lrclib(client, c) for c in candidates))

    best: Optional[Tuple[float, dict]] = None
    for candidate, matches in zip(candidates, results):
        for match in (matches or [])[:10]:
            if not (match.get("syncedLyrics") or match.get("plainLyrics")):
                continue
            score = _score(match, candidate, duration, title)
            if best is None or score > best[0]:
                best = (score, match)

    # Below this the "match" is usually a different song entirely.
    if best is None or best[0] < 3.0:
        if any(matches is None for matches in results):
            # Upstream trouble, not a real miss — let the client retry later.
            raise HTTPException(status_code=503, detail="Lyrics service is busy. Try again shortly.")
        _cache_set(_lyrics_cache, cache_key, "miss")
        raise HTTPException(status_code=404, detail="No lyrics found.")

    match = best[1]
    synced = match.get("syncedLyrics")
    response = LyricsResponse(
        synced=bool(synced),
        lines=_parse_lrc(synced) if synced else [],
        plain=match.get("plainLyrics"),
        track_name=match.get("trackName") or "",
        artist_name=match.get("artistName") or "",
        source="LRCLIB",
    )
    _cache_set(_lyrics_cache, cache_key, response)
    return response


# ---------------------------------------------------------------------------
# Artwork colour
# ---------------------------------------------------------------------------

_ALLOWED_IMAGE_HOSTS = (".ytimg.com", ".ggpht.com", ".googleusercontent.com")


def _is_allowed_image_url(url: str) -> bool:
    parsed = urlparse(url)
    host = (parsed.hostname or "").lower()
    return parsed.scheme == "https" and any(
        host == suffix.lstrip(".") or host.endswith(suffix) for suffix in _ALLOWED_IMAGE_HOSTS
    )


def _to_hex(rgb: Tuple[float, float, float]) -> str:
    return "#{:02x}{:02x}{:02x}".format(*(max(0, min(255, round(c * 255))) for c in rgb))


def _extract_color(image_bytes: bytes) -> ArtworkColorResponse:
    img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    # hqdefault thumbnails letterbox 16:9 video inside 4:3 — crop the bars.
    w, h = img.size
    if abs(w / h - 4 / 3) < 0.05:
        bar = round(h / 8)
        img = img.crop((0, bar, w, h - bar))
    img = img.resize((64, 64))
    palette_img = img.quantize(colors=8, method=Image.Quantize.MEDIANCUT)
    palette = palette_img.getpalette() or []
    counts = sorted(palette_img.getcolors() or [], reverse=True)

    best: Optional[Tuple[float, Tuple[float, float, float]]] = None
    for count, index in counts:
        r, g, b = (c / 255 for c in palette[index * 3: index * 3 + 3])
        hue, light, sat = colorsys.rgb_to_hls(r, g, b)
        if light < 0.08 or light > 0.92:
            continue  # near-black / near-white carry no mood
        score = count * (0.35 + sat)
        if best is None or score > best[0]:
            best = (score, (hue, light, sat))

    hue, light, sat = best[1] if best else (0.73, 0.5, 0.6)  # fallback: brand purple hue
    sat = max(sat, 0.3)
    accent = colorsys.hls_to_rgb(hue, min(max(light, 0.35), 0.55), sat)
    background = colorsys.hls_to_rgb(hue, 0.22, min(sat, 0.65))
    muted = colorsys.hls_to_rgb(hue, 0.12, min(sat, 0.5))
    return ArtworkColorResponse(accent=_to_hex(accent), background=_to_hex(background), muted=_to_hex(muted))


@router.get("/artwork/color", response_model=ArtworkColorResponse)
async def get_artwork_color(url: str = Query(..., min_length=1)):
    """Palette (accent / background / muted) derived from a thumbnail's dominant colour."""
    if not _is_allowed_image_url(url):
        raise HTTPException(status_code=400, detail="Only YouTube thumbnail URLs are supported.")

    cached = _cache_get(_color_cache, url)
    if cached is not None:
        return cached

    try:
        async with httpx.AsyncClient(headers=HTTP_HEADERS, follow_redirects=False) as client:
            resp = await client.get(url, timeout=8.0)
        resp.raise_for_status()
        if len(resp.content) > 5 * 1024 * 1024:
            raise HTTPException(status_code=413, detail="Image too large.")
        result = await asyncio.get_event_loop().run_in_executor(None, _extract_color, resp.content)
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("Artwork colour failed for %s: %s", url, exc)
        raise HTTPException(status_code=502, detail="Could not read artwork.")

    _cache_set(_color_cache, url, result)
    return result
