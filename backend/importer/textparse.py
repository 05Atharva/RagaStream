"""
Pasted song lists. Lenient, pure, no I/O.

Understands "Song - Artist", "Artist - Song", "1. Song by Artist", "Song (feat. X)", YouTube
tracklist timestamps, bullets and numbering. A lone "A - B" is ambiguous, so the track keeps both
readings (title/artists and alt_title/alt_artists) and the matcher decides from search results.
YouTube links are returned separately; the caller looks up their titles.
"""
from __future__ import annotations

import re
from typing import List, Optional, Tuple
from urllib.parse import parse_qs, urlsplit

from .models import MAX_TRACKS
from .types import SourceTrack

_BULLET_OR_NUMBER = re.compile(r"^\s*(?:[-•*·▪●‣]+\s+|\(?\d{1,3}[.)]\s+|\d{1,3}\s*[-–—:]\s+|#\d{1,3}\s+)")
_TIME = r"\d{1,2}:\d{2}(?::\d{2})?"
_LEADING_TIME = re.compile(rf"^\s*[\[(]?{_TIME}[\])]?\s*[-–—:]?\s*")
_TRAILING_TIME = re.compile(rf"\s*[\[(]?({_TIME})[\])]?\s*$")
_SEPARATOR = re.compile(r"\s+[-–—|]\s+|\t+")
_BY = re.compile(r"\s+by\s+", re.I)
_ARTIST_SPLIT = re.compile(r"\s*(?:,|&|\s+x\s+|\s+and\s+(?=[A-Z]))\s*")
_URL = re.compile(r"https?://\S+", re.I)
MAX_LINE_CHARS = 200

_YT_HOSTS = ("youtube.com", "youtu.be", "music.youtube.com", "m.youtube.com", "www.youtube.com")


def youtube_video_id(url: str) -> Optional[str]:
    """The video id of a watch / youtu.be / shorts / music link, else None."""
    try:
        parts = urlsplit(url.strip())
    except ValueError:
        return None
    host = (parts.hostname or "").lower()
    if not (host == "youtu.be" or host == "youtube.com" or host.endswith(".youtube.com")):
        return None
    candidate = None
    if host == "youtu.be":
        candidate = parts.path.strip("/").split("/")[0]
    elif parts.path == "/watch":
        candidate = (parse_qs(parts.query).get("v") or [None])[0]
    elif parts.path.startswith(("/shorts/", "/embed/", "/live/")):
        candidate = parts.path.split("/")[2] if len(parts.path.split("/")) > 2 else None
    if candidate and re.fullmatch(r"[A-Za-z0-9_-]{11}", candidate):
        return candidate
    return None


def _seconds(stamp: str) -> int:
    nums = [int(n) for n in stamp.split(":")]
    total = 0
    for n in nums:
        total = total * 60 + n
    return total


def split_artists(text: str) -> List[str]:
    out, seen = [], set()
    for name in _ARTIST_SPLIT.split(text or ""):
        name = name.strip(" .\"'")
        if name and name.casefold() not in seen:
            seen.add(name.casefold())
            out.append(name)
    return out


def parse_line(line: str) -> Optional[SourceTrack]:
    """One pasted line to a track, or None when it is blank / not a song."""
    text = (line or "").strip()
    if not text or len(text) > MAX_LINE_CHARS or re.fullmatch(r"\W*\d{1,3}[.)]?\W*", text):
        return None   # blank, too long to be a song line, or just a number
    for _ in range(2):  # "1. 0:00 Song" style stacks
        text = _BULLET_OR_NUMBER.sub("", text, count=1)
        text = _LEADING_TIME.sub("", text, count=1)
    duration = None
    trailing = _TRAILING_TIME.search(text)
    if trailing and trailing.start() > 0:
        duration = _seconds(trailing.group(1))
        text = text[: trailing.start()]
    text = text.strip(" \t-–—|\"")
    if not re.search(r"\w", text):
        return None

    parts = [p.strip() for p in _SEPARATOR.split(text) if p.strip()]
    if len(parts) >= 2:
        left, right = parts[0], " - ".join(parts[1:])
        return SourceTrack(
            title=left, artists=split_artists(right), duration_sec=duration or None,
            alt_title=right, alt_artists=split_artists(left),
        )
    pieces = _BY.split(text)
    if len(pieces) >= 2:  # "Stand by Me by Ben E. King": the last " by " splits song from artist
        song = " by ".join(pieces[:-1]).strip()
        artist = pieces[-1].strip()
        if song and artist:
            return SourceTrack(title=song, artists=split_artists(artist), duration_sec=duration or None)
    return SourceTrack(title=text, duration_sec=duration or None)


def parse_text(text: str, limit: int = MAX_TRACKS) -> Tuple[List[SourceTrack], List[Tuple[int, str]], bool]:
    """(tracks, youtube_links, truncated).

    `youtube_links` holds (position, video_id) for lines that are YouTube links; `position` is the
    index in the combined song order, so the caller can slot looked-up titles back in place.
    Tracks and links are numbered together and capped at `limit`."""
    tracks: List[SourceTrack] = []
    links: List[Tuple[int, str]] = []
    seen = set()
    truncated = False
    position = 0
    for raw in (text or "").splitlines():
        line = raw.strip()
        if not line:
            continue
        url = _URL.search(line)
        if url:
            video_id = youtube_video_id(url.group(0))
            if not video_id:
                continue
            if video_id in seen:
                continue
            seen.add(video_id)
            if position >= limit:
                truncated = True
                break
            links.append((position, video_id))
            tracks.append(SourceTrack(title="", youtube_id=video_id))  # placeholder, filled by the caller
            position += 1
            continue
        track = parse_line(line)
        if track is None:
            continue
        key = (track.title.casefold(), tuple(a.casefold() for a in track.artists))
        if key in seen:
            continue
        seen.add(key)
        if position >= limit:
            truncated = True
            break
        tracks.append(track)
        position += 1
    return tracks, links, truncated
