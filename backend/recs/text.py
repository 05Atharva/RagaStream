"""Title normalisation, variant detection and the non-music filter. Pure, no I/O."""
from __future__ import annotations

import re
from typing import FrozenSet

# Phrases that add nothing for a listener. Matched case-insensitively.
_JUNK_PHRASES = (
    r"official\s+(?:music\s+)?(?:video|audio|lyric\s+video|lyrical\s+video|song)",
    r"(?:full|lyrical|lyric|video|audio|hd|hq)\s+(?:full\s+)?(?:video\s+)?song",
    r"lyrical\s+video", r"lyric\s+video", r"music\s+video", r"full\s+video", r"full\s+audio",
    r"with\s+lyrics", r"lyrics?", r"lyrical", r"visuali[sz]er", r"audio",
    r"official", r"remastered(?:\s+\d{4})?", r"4k", r"1080p", r"720p", r"hd", r"hq",
)
_JUNK_WORDS = re.compile(r"(?<![\w])(?:%s)(?![\w])" % "|".join(_JUNK_PHRASES), re.I)
# A bracketed group is dropped when everything in it is junk (variants like (Remix) stay).
_BRACKET = re.compile(r"[\(\[\{]([^\)\]\}]*)[\)\]\}]")
_FEAT = re.compile(r"(?<![\w])(?:ft|feat|featuring)\b\.?\s+[^|\(\[\-–—]+", re.I)
_TRAIL = re.compile(r"[\s\-–—:,|/&+]+$")
_LEAD = re.compile(r"^[\s\-–—:,|/&+]+")
_SPACES = re.compile(r"\s+")

VARIANT_PATTERNS = {
    "slowed": re.compile(r"\bslowed\b", re.I),
    "reverb": re.compile(r"\breverb\b", re.I),
    "lofi": re.compile(r"\blo[\s\-]?fi\b", re.I),
    "remix": re.compile(r"\b(?:remix|bootleg|mashup)\b", re.I),
    "unplugged": re.compile(r"\bunplugged\b", re.I),
    "cover": re.compile(r"\bcover\b", re.I),
    "live": re.compile(r"\blive\b", re.I),
}

_NON_MUSIC = re.compile(
    r"\b(?:reaction|reacts?|review|interview|podcast|trailer|teaser|ringtone|status|"
    r"whatsapp|shorts|making\s+of|behind\s+the\s+scenes?|full\s+movie|episode|"
    # "BTS of Pasoori" is behind-the-scenes; "BTS - Dynamite" (the band) is not
    r"bts\s+(?:of|from|video)|rehears(?:al|als|e|ing)|vlog|unboxing|bloopers|breakdown|explained|"
    r"tutorial|how\s+to\s+(?:play|sing))\b|#shorts",
    re.I,
)
_COMPILATION = re.compile(r"\b(?:jukebox|non[\s\-]?stop|back\s+to\s+back|hours?\s+of|top\s+\d+|best\s+of)\b", re.I)


def _is_all_junk(inner: str) -> bool:
    rest = _JUNK_WORDS.sub("", inner)
    rest = re.sub(r"[\W_]+", "", rest)
    return rest == ""


def clean_title(title: str) -> str:
    """Display title without '(Official Video)', '[Lyrics]', '| T-Series', ft. lists, '4K'."""
    original = (title or "").strip()
    if not original:
        return ""
    text = _BRACKET.sub(lambda m: " " if _is_all_junk(m.group(1)) else m.group(0), original)
    head = text.split("|")[0]
    if head.strip():
        text = head
    text = _FEAT.sub(" ", text)
    text = _JUNK_WORDS.sub(" ", text)
    text = re.sub(r"[\(\[\{]\s*[\)\]\}]", " ", text)  # brackets emptied by the above
    text = _SPACES.sub(" ", text).strip()
    text = _LEAD.sub("", _TRAIL.sub("", text)).strip()
    return text or original


def variants(title: str) -> FrozenSet[str]:
    """Which special versions a title advertises: slowed, reverb, lofi, remix, unplugged, cover, live."""
    t = title or ""
    return frozenset(name for name, pat in VARIANT_PATTERNS.items() if pat.search(t))


def is_non_music(title: str) -> bool:
    return bool(_NON_MUSIC.search(title or ""))


def is_compilation(title: str) -> bool:
    return bool(_COMPILATION.search(title or ""))


def _alnum(text: str) -> str:
    return re.sub(r"[\W_]+", " ", text.casefold()).strip()


def title_key(title: str, channel: str = "") -> str:
    """Identity for duplicate detection: same song re-uploaded under the same channel."""
    vs = ",".join(sorted(variants(title)))
    return f"{_alnum(clean_title(title))}|{_alnum(channel)}|{vs}"


def channel_key(channel: str) -> str:
    return _alnum(channel or "")


def short_title(title: str, max_len: int = 36) -> str:
    """Cleaned title trimmed for reason copy."""
    t = clean_title(title)
    if len(t) <= max_len:
        return t
    cut = t[: max_len - 1].rsplit(" ", 1)[0] or t[: max_len - 1]
    return cut.rstrip(" ,-") + "…"


# ---------------------------------------------------------------------------
# Labels, channel names and artist credits
# ---------------------------------------------------------------------------

# Indian music is mostly uploaded by label channels, which say nothing about taste.
_LABEL_BASES = frozenset({
    "unknown", "t series", "tseries", "zee", "zee music", "zee5", "sony", "sony music", "yrf", "yash raj",
    "yash raj films", "tips", "saregama", "speed", "speed records", "desi music factory", "times", "venus",
    "shemaroo", "eros now", "eros", "aditya", "lahari", "think", "white hill", "coke studio", "mtv", "mtv beats",
    "pen", "rajshri", "gaana", "jiosaavn", "wynk", "nh studios", "anand audio", "t series regional",
    "sony music south", "tips music", "tips films", "times music", "universal music", "warner music",
    "t series apna punjab", "t series bhakti sagar", "lyrical", "worldwide records", "ultra", "ultra bollywood",
    "goldmines", "goldmines gaane sune ansune", "hungama", "hungama music", "divo", "dreamz music",
})
_LABEL_PREFIXES = ("t series", "tseries", "zee", "yash raj", "yrf", "saregama", "shemaroo", "lahari",
                   "eros now", "tips", "sony music", "coke studio", "mtv", "desi music factory", "speed records")
_LABEL_NOISE = frozenset({
    "official", "vevo", "music", "company", "channel", "india", "records", "film", "films", "entertainment",
    "pakistan", "topic", "hd", "hq", "studios", "tv", "originals", "audio", "video", "videos", "network",
})
_CHANNEL_TAIL = re.compile(r"\s*[·•|]\s*.*$")
_CHANNEL_NOISE = re.compile(r"\s*(?:-\s*topic|vevo|official(?:\s+channel)?)\s*$", re.I)


def clean_channel(channel: str) -> str:
    """Channel name without ' - Topic', 'VEVO', 'Official' and '· Album' tails."""
    name = _CHANNEL_TAIL.sub("", channel or "").strip()
    prev = None
    while prev != name:
        prev, name = name, _CHANNEL_NOISE.sub("", name).strip()
    return name


def is_label(channel: str) -> bool:
    """True for label/aggregator channels (T-Series, Zee Music Company, ...) and empty/Unknown."""
    tokens = _alnum(clean_channel(channel)).split()
    if not tokens:
        return True
    full = " ".join(tokens)
    if full in _LABEL_BASES:
        return True
    # "T-Series Lyrical", "T-Series Presents", "Zee Music Marathi": a strong label name starts the channel
    if any(full == b or full.startswith(b + " ") for b in _LABEL_PREFIXES):
        return True
    while len(tokens) > 1 and tokens[-1] in _LABEL_NOISE:
        tokens.pop()
        if " ".join(tokens) in _LABEL_BASES:
            return True
    return False


_SPLIT = re.compile(r"\s*(?:\||\s[-–—]\s|,|&|\bfeat\.?|\bft\.?|\bfeaturing\b|\s+[xX]\s+)\s*")
_NOT_NAMES = re.compile(
    r"\b(?:season|episode|full|song|songs|video|audio|lyrics?|lyrical|official|movie|film|hd|hq|4k|"
    r"version|ost|soundtrack|album|from|new|latest|superhit|hit|hits|sad|romantic|live|remix|cover)\b|\d",
    re.I,
)


def _looks_like_name(seg: str) -> bool:
    seg = seg.strip(" .'\"")
    words = seg.split()
    if not 1 <= len(words) <= 4 or len(seg) > 32:
        return False
    if _NOT_NAMES.search(seg) or is_label(seg) or _JUNK_WORDS.search(seg):
        return False
    return all(w[0].isupper() for w in words if w[0].isalpha()) and all(w[0].isalpha() for w in words)


# Composer duos/trios are one artist however they are written ("Ajay-Atul", "Ajay - Atul", "Ajay & Atul").
DUOS = ("Ajay-Atul", "Vishal-Shekhar", "Salim-Sulaiman", "Shankar-Ehsaan-Loy", "Sachin-Jigar", "Sajid-Wajid",
        "Jatin-Lalit", "Nadeem-Shravan", "Laxmikant-Pyarelal", "Shankar-Jaikishan", "Kalyanji-Anandji", "Meet Bros")
_DUO_SEP = r"\s*(?:-|\u2013|\u2014|&|\band\b)\s*"
_DUO_PATTERNS = [
    (d, re.compile(r"\b" + _DUO_SEP.join(re.escape(p) for p in re.split(r"[-\s]+", d)) + r"\b", re.I))
    for d in DUOS
]


def extract_credits(title: str) -> list:
    """Likely artist/credit names in a title, in order. The first segment is the song, not a credit."""
    t = _BRACKET.sub(" ", title or "")
    held = {}
    for i, (canon, pat) in enumerate(_DUO_PATTERNS):
        key = "Qduo" + chr(97 + i) + "q"
        if pat.search(t):
            t = pat.sub(key, t)
            held[key] = canon
    segs = [s for s in _SPLIT.split(t) if s and s.strip()]
    seen, out = set(), []
    for seg in segs[1:]:
        seg = held.get(seg.strip(), seg).strip(" .'\"")
        k = _alnum(seg)
        if k and k not in seen and _looks_like_name(seg):
            seen.add(k)
            out.append(seg)
    return out


def label_artists(songs: list, min_count: int = 2) -> dict:
    """{youtube_id: artist} for label-uploaded songs, from (youtube_id, title) pairs.
    A credit counts as the artist only when it recurs across the given songs."""
    credits = {yt: extract_credits(title) for yt, title in songs}
    counts: dict = {}
    for names in credits.values():
        for n in names:
            counts[_alnum(n)] = counts.get(_alnum(n), 0) + 1
    out: dict = {}
    for yt, names in credits.items():
        best = None
        for n in names:  # earliest credit wins a tie
            c = counts[_alnum(n)]
            if c >= min_count and (best is None or c > counts[_alnum(best)]):
                best = n
        if best:
            out[yt] = best
    return out
