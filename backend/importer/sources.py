"""
Source adapters. Each one turns a PUBLIC page into SourceData.

The parse_* functions are pure (text in, SourceData out) so they can be tested on saved fixtures.
Fetched pages are untrusted data: everything is read with json.loads / regex, never evaluated,
and nothing from a page is ever put into HTML.

What each service really exposes publicly (checked live, see README "Playlist import"):
  * Spotify: the public embed page, 100 songs at most per playlist.
  * Apple Music: the public page; songs, artists and durations in its server data.
  * YouTube / YouTube Music: yt-dlp flat playlist listing (no login, no cookies).
  * Others: schema.org JSON-LD, plus the page state JioSaavn serves to every visitor.
"""
from __future__ import annotations

import asyncio
import html as htmllib
import json
import logging
import re
import time
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import parse_qs, urlsplit

import yt_dlp

from recs.text import clean_channel, clean_title
from ytguard import YouTubeBusy, gate, wait_phrase

from .errors import NO_TRACKS, NOT_PUBLIC, PASTE_INSTEAD, ImportFailure
from .fetch import fetch_page, safe_url_for_log
from .models import MAX_TRACKS
from .textparse import parse_text, youtube_video_id
from .types import SourceData, SourceTrack

logger = logging.getLogger(__name__)

SPOTIFY_EMBED_CAP = 100
SHORT_LINK_HOSTS = ("spotify.link", "link.tospotify.com", "spoti.fi")

# ---------------------------------------------------------------------------
# Link classification
# ---------------------------------------------------------------------------

_SPOTIFY_PATH = re.compile(
    r"^/(?:intl-[a-z]{2}(?:-[a-z]{2})?/)?(?:embed/)?(playlist|album|track|artist|show|episode)/([A-Za-z0-9]{10,32})"
)


def _normalise_url(raw: str) -> str:
    url = (raw or "").strip()
    if url and "://" not in url and re.match(r"^[\w.-]+\.[a-z]{2,}/", url, re.I):
        url = "https://" + url
    return url


def classify(url: str) -> Tuple[str, Dict[str, str]]:
    """('spotify'|'youtube'|'apple'|'generic', info). Raises ImportFailure for links that can't work."""
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https") or not parts.hostname:
        raise ImportFailure("That doesn't look like a link. Paste a playlist link, or paste the song list instead.")
    host = parts.hostname.lower()

    if host in ("open.spotify.com", "play.spotify.com"):
        m = _SPOTIFY_PATH.match(parts.path)
        if not m:
            raise ImportFailure("Paste a Spotify playlist or album link. " + PASTE_INSTEAD)
        kind, sid = m.groups()
        if kind not in ("playlist", "album"):
            raise ImportFailure(
                f"That Spotify link is a {kind}, not a playlist or album. "
                "Paste a playlist or album link, or paste the song list instead."
            )
        return "spotify", {"kind": kind, "id": sid}

    if host == "youtu.be" or host == "youtube.com" or host.endswith(".youtube.com"):
        list_id = (parse_qs(parts.query).get("list") or [None])[0]
        if parts.path == "/playlist" or (list_id and parts.path in ("/watch", "/")):
            if not list_id or not re.fullmatch(r"[A-Za-z0-9_-]{10,64}", list_id):
                raise ImportFailure(NOT_PUBLIC)
            return "youtube", {"list": list_id}
        raise ImportFailure(
            "That YouTube link is a single video, not a playlist. Paste a playlist link, or paste the song list instead."
        )

    if host in ("music.apple.com", "embed.music.apple.com"):
        segs = [s for s in parts.path.split("/") if s]
        kind = next((s for s in segs if s in ("playlist", "album", "song", "artist", "station")), None)
        if kind not in ("playlist", "album") or (kind == "album" and "i" in parse_qs(parts.query)):
            raise ImportFailure(
                "Paste an Apple Music playlist or album link (not a single song or artist), or paste the song list instead."
            )
        return "apple", {"kind": kind}

    return "generic", {}


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------

_TAG = re.compile(r"<[^>]+>")


def _clean(text: Any, limit: int = 300) -> str:
    if not isinstance(text, str):
        return ""
    return _TAG.sub("", htmllib.unescape(text)).replace("\xa0", " ").strip()[:limit]


def _meta(page: str, prop: str) -> Optional[str]:
    for tag in re.finditer(r"<meta\b[^>]*>", page, re.I):
        t = tag.group(0)
        if re.search(rf'(?:property|name)=["\']{re.escape(prop)}["\']', t, re.I):
            m = re.search(r'content=(?:"([^"]*)"|\'([^\']*)\')', t, re.I)
            if m:
                return _clean(m.group(1) if m.group(1) is not None else m.group(2), 500) or None
    return None


def _https(url: Any) -> Optional[str]:
    return url if isinstance(url, str) and url.startswith("https://") and len(url) < 600 else None


_ISO_DURATION = re.compile(r"^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$")


def iso_duration_seconds(value: Any) -> Optional[int]:
    """'PT3M43S' -> 223. None when it isn't an ISO-8601 duration."""
    if not isinstance(value, str):
        return None
    m = _ISO_DURATION.match(value.strip())
    if not m or not any(m.groups()):
        return None
    d, h, mi, s = m.groups()
    return int(d or 0) * 86400 + int(h or 0) * 3600 + int(mi or 0) * 60 + int(float(s or 0))


def _script_json(page: str, pattern: str) -> Optional[Any]:
    m = re.search(pattern, page, re.S)
    if not m:
        return None
    try:
        return json.loads(m.group(1))
    except ValueError:
        return None


def _ld_json_blocks(page: str) -> List[Any]:
    out = []
    for m in re.finditer(r"<script\b[^>]*type=[\"']?application/ld\+json[\"']?[^>]*>(.*?)</script>", page, re.S | re.I):
        try:
            out.append(json.loads(m.group(1)))
        except ValueError:
            continue
    return out


def _as_list(value: Any) -> list:
    if value is None:
        return []
    return value if isinstance(value, list) else [value]


def _names(value: Any) -> List[str]:
    out = []
    for item in _as_list(value):
        name = item.get("name") if isinstance(item, dict) else item
        name = _clean(name, 120)
        if name and name not in out:
            out.append(name)
    return out


# ---------------------------------------------------------------------------
# Spotify (public embed page)
# ---------------------------------------------------------------------------

def parse_spotify_embed(page: str, kind: str = "playlist") -> SourceData:
    next_data = _script_json(page, r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>')
    try:
        entity = next_data["props"]["pageProps"]["state"]["data"]["entity"]
        track_list = entity["trackList"]
    except (TypeError, KeyError):
        raise ImportFailure(NOT_PUBLIC)
    if not isinstance(track_list, list) or not track_list:
        raise ImportFailure(NOT_PUBLIC)

    name = _clean(entity.get("name") or entity.get("title"), 150) or ("Spotify album" if kind == "album" else "Spotify playlist")
    is_album = entity.get("type") == "album" or kind == "album"
    subtitle = _clean(entity.get("subtitle"), 150) or None

    tracks: List[SourceTrack] = []
    for item in track_list:
        if not isinstance(item, dict) or not str(item.get("uri", "")).startswith("spotify:track:"):
            continue  # podcast episodes and local files aren't songs
        title = _clean(item.get("title"), 200)
        if not title:
            continue
        artists = [a.strip() for a in re.split(r",\s*", _clean(item.get("subtitle"), 300)) if a.strip()]
        ms = item.get("duration")
        tracks.append(SourceTrack(
            title=title, artists=artists, album=name if is_album else None,
            duration_sec=round(ms / 1000) if isinstance(ms, (int, float)) and ms > 0 else None,
        ))
    if not tracks:
        raise ImportFailure(NOT_PUBLIC)

    cover = None
    sources = (entity.get("coverArt") or {}).get("sources") or []
    if sources and isinstance(sources[0], dict):
        cover = _https(sources[0].get("url"))
    if not cover:
        images = [i for i in ((entity.get("visualIdentity") or {}).get("image") or []) if isinstance(i, dict)]
        images.sort(key=lambda i: i.get("maxWidth") or 0, reverse=True)
        cover = _https(images[0].get("url")) if images else None

    partial = (not is_album) and len(track_list) >= SPOTIFY_EMBED_CAP
    note = None
    if partial:
        note = (f"Spotify only shows the first {SPOTIFY_EMBED_CAP} songs of a shared playlist. "
                "Paste the full list to import the rest.")
    return SourceData(
        source="spotify", name=name, tracks=tracks[:MAX_TRACKS], cover_url=cover,
        owner=subtitle, partial=partial, note=note,
    )


# ---------------------------------------------------------------------------
# Apple Music (public page: JSON-LD for the header, serialized server data for the songs)
# ---------------------------------------------------------------------------

def _apple_items(page: str) -> List[dict]:
    data = _script_json(page, r'<script[^>]*id="serialized-server-data"[^>]*>(.*?)</script>')
    out: List[dict] = []
    try:
        sections = data["data"][0]["data"]["sections"]
    except (TypeError, KeyError, IndexError):
        return out
    for section in sections if isinstance(sections, list) else []:
        if isinstance(section, dict) and str(section.get("id", "")).startswith("track-list"):
            out.extend(i for i in section.get("items", []) if isinstance(i, dict))
    return out


def parse_apple_music(page: str) -> SourceData:
    header: dict = {}
    for block in _ld_json_blocks(page):
        for node in _as_list(block):
            if isinstance(node, dict) and any(t in ("MusicPlaylist", "MusicAlbum") for t in _as_list(node.get("@type"))):
                header = node
                break
    items = _apple_items(page)

    tracks: List[SourceTrack] = []
    is_playlist = header.get("@type") == "MusicPlaylist"
    album_artists = _names(header.get("byArtist")) or _names(header.get("author"))
    for item in items:
        title = _clean(item.get("title"), 200)
        if not title:
            continue
        artists = [_clean(l.get("title"), 120) for l in _as_list(item.get("subtitleLinks")) if isinstance(l, dict)]
        artists = [a for a in artists if a] or ([] if is_playlist else album_artists)
        album = None
        for link in _as_list(item.get("tertiaryLinks")):
            if isinstance(link, dict) and link.get("title"):
                album = _clean(link["title"], 200)
                break
        ms = item.get("duration")
        tracks.append(SourceTrack(
            title=title, artists=artists, album=album,
            duration_sec=round(ms / 1000) if isinstance(ms, (int, float)) and ms > 0 else None,
        ))

    if not tracks:  # server data missing: fall back to the JSON-LD track list (titles + durations only)
        for t in _as_list(header.get("track")):
            if isinstance(t, dict) and _clean(t.get("name")):
                tracks.append(SourceTrack(
                    title=_clean(t["name"], 200), artists=_names(t.get("byArtist")) or ([] if is_playlist else album_artists),
                    duration_sec=iso_duration_seconds(t.get("duration")),
                ))
    if not tracks:
        raise ImportFailure(NOT_PUBLIC)

    name = (_clean(header.get("name"), 150)
            or re.sub(r"\s+on Apple Music$", "", _meta(page, "og:title") or "")
            or "Apple Music playlist")
    declared = header.get("numTracks")
    partial = isinstance(declared, int) and declared > len(tracks)
    return SourceData(
        source="apple_music", name=name, tracks=tracks[:MAX_TRACKS], cover_url=_https(_meta(page, "og:image")),
        owner=(_names(header.get("author")) or _names(header.get("byArtist")) or [None])[0],
        partial=partial,
        note=(f"Apple Music's public page lists {len(tracks)} of {declared} songs. Paste the full list to import the rest.")
        if partial else None,
    )


# ---------------------------------------------------------------------------
# Generic pages: schema.org JSON-LD, then JioSaavn's page state
# ---------------------------------------------------------------------------

def _walk_ld(node: Any, depth: int = 0):
    if depth > 6:
        return
    if isinstance(node, list):
        for n in node[:200]:
            yield from _walk_ld(n, depth + 1)
    elif isinstance(node, dict):
        yield node
        if "@graph" in node:
            yield from _walk_ld(node["@graph"], depth + 1)


def parse_jsonld(page: str) -> Optional[SourceData]:
    """schema.org MusicPlaylist / MusicAlbum with `track` entries, or None when the page has none."""
    for block in _ld_json_blocks(page):
        for node in _walk_ld(block):
            if not any(t in ("MusicPlaylist", "MusicAlbum") for t in _as_list(node.get("@type"))):
                continue
            album_artists = _names(node.get("byArtist")) or _names(node.get("author"))
            tracks: List[SourceTrack] = []
            for entry in _as_list(node.get("track")):
                if isinstance(entry, dict) and isinstance(entry.get("item"), dict):  # ListItem wrapper
                    entry = entry["item"]
                if not isinstance(entry, dict):
                    continue
                title = _clean(entry.get("name"), 200)
                if not title:
                    continue
                in_album = entry.get("inAlbum")
                tracks.append(SourceTrack(
                    title=title, artists=_names(entry.get("byArtist")) or album_artists,
                    album=(_names(in_album) or [None])[0] if in_album else None,
                    duration_sec=iso_duration_seconds(entry.get("duration")),
                ))
            if tracks:
                declared = node.get("numTracks")
                return SourceData(
                    source="jsonld",
                    name=_clean(node.get("name"), 150) or _meta(page, "og:title") or "Imported playlist",
                    tracks=tracks[:MAX_TRACKS], description=_clean(node.get("description"), 500) or None,
                    cover_url=_https(_meta(page, "og:image")) or _https(node.get("image")),
                    owner=(_names(node.get("author")) or _names(node.get("byArtist")) or [None])[0],
                    partial=len(tracks) > MAX_TRACKS or (isinstance(declared, int) and declared > len(tracks)),
                )
    return None


def _jiosaavn_state(page: str) -> Optional[dict]:
    """JioSaavn serves its page state as `window.__INITIAL_DATA__ = {...}` (a JS object literal with
    `new Date("...")` and `undefined`). Rewrite those two and read it as JSON; nothing is evaluated."""
    marker = "window.__INITIAL_DATA__ = "
    start = page.find(marker)
    if start < 0:
        return None
    start += len(marker)
    end = page.find("\n", start)
    raw = page[start: end if end > 0 else len(page)].strip().rstrip(";")
    raw = re.sub(r'new Date\(("[^"]*")\)', r"\1", raw)
    raw = re.sub(r"(?<=[:\[,])undefined(?=[,\]}])", "null", raw)
    try:
        data = json.loads(raw)
    except ValueError:
        return None
    return data if isinstance(data, dict) else None


def _saavn_text(value: Any) -> str:
    if isinstance(value, dict):
        value = value.get("text")
    return _clean(value, 200)


def _saavn_artists(song: dict) -> List[str]:
    people = [a for a in _as_list(song.get("artists")) if isinstance(a, dict) and a.get("name")]
    chosen = [a for a in people if a.get("role") in ("singer", "primary_artists", "primaryartists")]
    if not chosen:
        chosen = [a for a in people if a.get("role") in ("", None, "music", "artist")]
    names: List[str] = []
    for a in chosen:
        n = _clean(a["name"], 120)
        if n and n not in names:
            names.append(n)
    return names[:6]


def parse_jiosaavn(page: str) -> Optional[SourceData]:
    state = _jiosaavn_state(page)
    if not state:
        return None
    album = ((state.get("albumView") or {}).get("album")) or {}
    playlist = ((state.get("playlist") or {}).get("playlist")) or {}
    node, songs = (album, album.get("songs")) if album.get("songs") else (playlist, playlist.get("list"))
    if not isinstance(songs, list) or not songs:
        return None
    tracks = []
    for song in songs:
        if not isinstance(song, dict) or song.get("type") not in (None, "song"):
            continue
        title = _saavn_text(song.get("title"))
        if title:
            tracks.append(SourceTrack(
                title=title, artists=_saavn_artists(song),
                album=_saavn_text(song.get("album")) or None,
                duration_sec=int(song["duration"]) if str(song.get("duration", "")).isdigit() else None,
            ))
    if not tracks:
        return None
    declared = node.get("song_count") or node.get("list_count")
    image = _as_list(node.get("image"))
    partial = isinstance(declared, int) and declared > len(tracks)
    return SourceData(
        source="jsonld", name=_saavn_text(node.get("title")) or _clean(node.get("H2"), 150) or "JioSaavn playlist",
        tracks=tracks[:MAX_TRACKS],
        cover_url=_https(image[0]) if image else _https(_meta(page, "og:image")),
        partial=partial,
        note=f"The page lists {len(tracks)} of {declared} songs. Paste the full list to import the rest." if partial else None,
    )


def parse_generic(page: str, host: str = "") -> SourceData:
    found = parse_jsonld(page)
    if found:
        return found
    if host.endswith("jiosaavn.com"):
        found = parse_jiosaavn(page)
        if found:
            return found
    raise ImportFailure(NO_TRACKS)


# ---------------------------------------------------------------------------
# YouTube / YouTube Music playlists (yt-dlp flat listing, no login)
# ---------------------------------------------------------------------------

_UNAVAILABLE_TITLES = ("[private video]", "[deleted video]", "private video", "deleted video", "[unavailable video]")


def _flat_opts(log=None) -> dict:
    from routers.youtube import _ydl_opts_base  # same yt-dlp setup as search

    opts = _ydl_opts_base(log)
    # Never the server's own YouTube cookies: the link is a stranger's, and cookies could expose
    # private playlists of whoever the cookies belong to.
    opts.pop("cookiefile", None)
    opts.pop("cookiesfrombrowser", None)
    opts.update({"extract_flat": "in_playlist", "playlistend": MAX_TRACKS + 1, "noplaylist": False})
    return opts


def build_youtube_source(info: dict) -> SourceData:
    """Pure: a yt-dlp flat playlist dict to SourceData."""
    entries = [e for e in (info.get("entries") or []) if isinstance(e, dict)]
    tracks: List[SourceTrack] = []
    seen = set()
    for entry in entries:
        vid = entry.get("id")
        title = (entry.get("title") or "").strip()
        if not vid or not re.fullmatch(r"[A-Za-z0-9_-]{11}", str(vid)) or vid in seen:
            continue
        if not title or title.lower() in _UNAVAILABLE_TITLES or title.lower().startswith("[unavailable"):
            continue
        if entry.get("availability") in ("private", "needs_auth", "premium_only", "subscriber_only"):
            continue
        seen.add(vid)
        channel = (entry.get("channel") or entry.get("uploader") or "").strip()
        duration = entry.get("duration")
        artist = clean_channel(channel)
        tracks.append(SourceTrack(
            title=clean_title(title) or title, artists=[artist] if artist else [],
            duration_sec=int(duration) if isinstance(duration, (int, float)) and duration > 0 else None,
            youtube_id=str(vid), channel=channel or None,
            thumbnail=f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg",
        ))
    if not tracks:
        raise ImportFailure(NOT_PUBLIC)
    partial = len(tracks) > MAX_TRACKS
    thumbs = info.get("thumbnails") or []
    cover = _https(thumbs[-1].get("url")) if thumbs and isinstance(thumbs[-1], dict) else None
    return SourceData(
        source="youtube", name=_clean(info.get("title"), 150) or "YouTube playlist",
        tracks=tracks[:MAX_TRACKS], cover_url=cover or tracks[0].thumbnail,
        owner=_clean(info.get("channel") or info.get("uploader"), 100) or None,
        partial=partial,
        note=f"Only the first {MAX_TRACKS} songs were read." if partial else None,
    )


async def fetch_youtube_playlist(list_id: str) -> SourceData:
    url = f"https://www.youtube.com/playlist?list={list_id}"

    def run(log) -> dict:
        with yt_dlp.YoutubeDL(_flat_opts(log)) as ydl:
            return ydl.extract_info(url, download=False) or {}

    try:
        info = await gate.run(run)
    except YouTubeBusy as busy:
        raise ImportFailure(f"YouTube is limiting requests from the server. Try again in {wait_phrase(busy.retry_after)}.")
    except yt_dlp.utils.DownloadError as exc:
        logger.info("Import: YouTube playlist %s not readable: %s", list_id[:40], str(exc)[:120])
        raise ImportFailure(NOT_PUBLIC)
    except Exception:
        logger.exception("Import: YouTube playlist listing failed")
        raise ImportFailure("YouTube didn't answer. Try again in a moment, or paste the song list instead.")
    return build_youtube_source(info)


# ---------------------------------------------------------------------------
# Pasted text (and pasted YouTube links, titled through YouTube's public oEmbed)
# ---------------------------------------------------------------------------

_oembed_cache: Dict[str, Tuple[float, Optional[dict]]] = {}
OEMBED_TTL = 60 * 60
MAX_OEMBED_LINKS = 150


async def _oembed(video_id: str) -> Optional[dict]:
    hit = _oembed_cache.get(video_id)
    if hit and hit[0] > time.time():
        return hit[1]
    url = f"https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v={video_id}&format=json"
    result = None
    try:
        _final, body = await fetch_page(url)
        data = json.loads(body)
        if isinstance(data, dict) and data.get("title"):
            result = {"title": _clean(data["title"], 250), "author": _clean(data.get("author_name"), 120)}
    except (ImportFailure, ValueError):
        result = None  # private, deleted or embedding disabled: skipped
    if len(_oembed_cache) > 2000:
        _oembed_cache.clear()
    _oembed_cache[video_id] = (time.time() + OEMBED_TTL, result)
    return result


async def build_text_source(text: str) -> SourceData:
    tracks, links, truncated = parse_text(text)
    note_parts: List[str] = []
    partial = truncated
    if truncated:
        note_parts.append(f"Only the first {MAX_TRACKS} songs were read.")
    if links:
        links_to_read = links[:MAX_OEMBED_LINKS]
        dropped = {pos for pos, _v in links[len(links_to_read):]}
        if dropped:
            partial = True
            note_parts.append(f"Only the first {MAX_OEMBED_LINKS} YouTube links were read.")
        sem = asyncio.Semaphore(5)

        async def look(vid: str):
            async with sem:
                return await _oembed(vid)

        results = await asyncio.gather(*(look(v) for _p, v in links_to_read))
        skipped = 0
        for (pos, vid), meta in zip(links_to_read, results):
            if not meta:
                dropped.add(pos)
                skipped += 1
                continue
            t = tracks[pos]
            t.title = clean_title(meta["title"]) or meta["title"]
            t.artists = [clean_channel(meta["author"])] if meta["author"] else []
            t.channel = meta["author"] or None
            t.thumbnail = f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg"
        tracks = [t for i, t in enumerate(tracks) if i not in dropped]
        if skipped:
            plural = "s" if skipped != 1 else ""
            note_parts.append(f"{skipped} YouTube link{plural} couldn't be read (private or removed).")
    if not tracks:
        raise ImportFailure(
            "We couldn't find any songs in that text. Put one song per line, like \"Kesariya - Arijit Singh\"."
        )
    return SourceData(
        source="text", name="Imported songs", tracks=tracks[:MAX_TRACKS],
        partial=partial, note=" ".join(note_parts) or None,
    )


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

_source_cache: Dict[str, Tuple[float, SourceData]] = {}
SOURCE_CACHE_TTL = 5 * 60   # preview then import = one fetch, not two


def _cache_get(key: str) -> Optional[SourceData]:
    hit = _source_cache.get(key)
    if hit and hit[0] > time.time():
        return hit[1]
    _source_cache.pop(key, None)
    return None


def _cache_put(key: str, data: SourceData) -> None:
    if len(_source_cache) >= 50:
        _source_cache.pop(next(iter(_source_cache)))
    _source_cache[key] = (time.time() + SOURCE_CACHE_TTL, data)


async def load_source(url: Optional[str] = None, text: Optional[str] = None) -> SourceData:
    """Read a public playlist link, or a pasted song list. Raises ImportFailure."""
    if text and text.strip():
        lines = [l.strip() for l in text.strip().splitlines() if l.strip()]
        if len(lines) == 1 and re.match(r"https?://\S+$", lines[0], re.I) and not youtube_video_id(lines[0]):
            url = lines[0]  # a link pasted into the text box is still a link
        else:
            return await build_text_source(text)
    if not url or not url.strip():
        raise ImportFailure("Paste a playlist link or a song list.")

    url = _normalise_url(url)
    list_id = (parse_qs(urlsplit(url).query).get("list") or [""])[0]
    key = f"{safe_url_for_log(url)}|{list_id}"
    cached = _cache_get(key)
    if cached:
        return cached

    page: Optional[str] = None
    host = (urlsplit(url).hostname or "").lower()
    if host in SHORT_LINK_HOSTS:  # share links: follow the redirect, then treat the result as the link
        url, page = await fetch_page(url)
        host = (urlsplit(url).hostname or "").lower()
    kind, info = classify(url)
    logger.info("Import source %s for %s", kind, safe_url_for_log(url))

    if kind == "spotify":
        _final, embed = await fetch_page(f"https://open.spotify.com/embed/{info['kind']}/{info['id']}")
        data = parse_spotify_embed(embed, info["kind"])
    elif kind == "youtube":
        data = await fetch_youtube_playlist(info["list"])
    elif kind == "apple":
        _final, body = await fetch_page(f"https://music.apple.com{urlsplit(url).path}")
        data = parse_apple_music(body)
    else:
        if page is None:
            _final, page = await fetch_page(url)
        data = parse_generic(page, host)
    _cache_put(key, data)
    return data
