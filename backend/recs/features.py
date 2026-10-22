"""
Per-candidate ranking features, all floats in roughly [-1, 1]. Pure, no I/O.

`compute_features(candidate, profile, hour)` is the one entry point; the evaluator and
trainer call it for any (profile, candidate) pair.
"""
from __future__ import annotations

import math
from typing import Dict, Optional

from .candidates import Candidate
from .profile import Profile
from .text import channel_key, is_compilation, is_non_music, variants
from .weights import FEATURES

DAY = 86400.0


def _clamp(x: float, lo: float = -1.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, x))


def consensus(c: Candidate) -> float:
    """How many seeds link to it, log-scaled (walk links count less)."""
    return _clamp(math.log1p(c.link_weight) / math.log1p(5.0), 0.0, 1.0)


def mix_rank(c: Candidate) -> float:
    if c.best_rank is None:
        return 0.0
    base = 1.0 / math.sqrt(max(1, c.best_rank))
    return base if c.direct else base * 0.5


def hour_fit(profile: Profile, channel: str, hour: Optional[int]) -> float:
    """How much more than evenly this channel is played around `hour` (smoothed over +-1h)."""
    if hour is None or not channel:
        return 0.0
    hist = profile.hour_hist.get(channel_key(channel))
    if not hist:
        return 0.0
    total = sum(hist)
    if total < 3:
        return 0.0
    near = hist[(hour - 1) % 24] + hist[hour % 24] + hist[(hour + 1) % 24]
    ratio = (near / total) / (3.0 / 24.0)
    return _clamp((ratio - 1.0) / 2.0)


def variant_fit(profile: Profile, title: str) -> float:
    vs = variants(title)
    if not vs:
        return 0.0
    vals = []
    for v in vs:
        if v in profile.variant_taste:
            vals.append(math.tanh(profile.variant_taste[v] / 3.0))
        elif profile.plain_taste >= 5.0:
            vals.append(-0.3)  # always plays the plain version, never this kind
        else:
            vals.append(0.0)
    return _clamp(sum(vals) / len(vals))


def quality(title: str, duration: int) -> float:
    """0 for a normal song, down to -1 for things that aren't songs."""
    if is_non_music(title):
        return -1.0
    q = 0.0
    if is_compilation(title):
        q -= 0.4
    if duration > 900:
        q -= 0.5
    elif duration > 600:
        q -= 0.2
    return _clamp(q)


def skip_signal(profile: Profile, yt: str) -> float:
    """0..1, driven by early skips. `profile.skips` counts every negative skip alike, so severity
    comes from the song's net affinity: an early skip (-1.0) reads as 1.0, a 30 s-50% skip (-0.4)
    as 0.4**1.5 = 0.25, and a song that was also completed or liked nets out to no penalty."""
    if not profile.skips.get(yt):
        return 0.0
    return min(1.0, max(0.0, -profile.song_aff.get(yt, 0.0))) ** 1.5


def compute_features(c: Candidate, profile: Profile, hour: Optional[int] = None) -> Dict[str, float]:
    ck = channel_key(c.channel)
    yt = c.youtube_id
    now = profile.now
    hour = hour if hour is not None else profile.recent_hour

    last = profile.last_played.get(yt)
    age = (now - last) if last else None
    if age is not None and age < DAY:
        fatigue = 1.0
    elif age is not None and age < 3 * DAY:
        fatigue = 0.5
    else:
        fatigue = 0.0

    song_skips = skip_signal(profile, yt)
    chan_neg = min(1.0, max(0.0, -profile.channel_aff.get(ck, 0.0)) / 4.0)

    played_before = (
        yt in profile.last_played or yt in profile.liked or yt in profile.playlist
        or profile.song_aff.get(yt, 0.0) != 0.0
    )

    feats = {
        "consensus": consensus(c),
        "mix_rank": mix_rank(c),
        "seed_sim": _clamp(c.seed_sim, 0.0, 1.0),
        "song_aff": math.tanh(profile.song_aff.get(yt, 0.0) / 3.0),
        "channel_aff": math.tanh(profile.channel_aff.get(ck, 0.0) / 6.0),
        "skip_penalty": max(song_skips, chan_neg),
        "fatigue": fatigue,
        "novelty": 0.0 if played_before else 1.0,
        "hour_fit": hour_fit(profile, c.channel, hour),
        "variant_fit": variant_fit(profile, c.title),
        "quality": quality(c.title, c.duration),
        "session_steer": _clamp(profile.session_channels.get(ck, 0.0)),
    }
    return {name: round(feats[name], 4) for name in FEATURES}
