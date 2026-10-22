"""Human reasons for each pick, from its strongest source and feature. Pure, no I/O."""
from __future__ import annotations

from typing import Dict, Mapping, Optional, Tuple

from .candidates import Candidate
from .profile import Profile
from .text import short_title

_SOURCE_ORDER = {"seed": 0, "session": 1, "taste": 2, "walk": 3}
WEEK = 7 * 86400.0


def hour_label(hour: int) -> str:
    if hour < 5 or hour >= 22:
        return "late-night"
    if hour < 12:
        return "morning"
    if hour < 17:
        return "afternoon"
    return "evening"


def hour_reason(hour: int) -> Tuple[str, str]:
    return f"Your {hour_label(hour)} pick", "taste"


def _weeks_ago(profile: Profile, youtube_id: str) -> Optional[int]:
    last = profile.last_played.get(youtube_id)
    if not last:
        return None
    return max(1, round((profile.now - last) / WEEK))


def _strongest_seed(c: Candidate) -> Optional[str]:
    if not c.seeds:
        return None
    return min(c.seeds, key=lambda s: (_SOURCE_ORDER.get(c.seed_source.get(s, "walk"), 9), c.seeds[s]))


def reason_for(
    c: Candidate,
    features: Mapping[str, float],
    profile: Profile,
    titles: Mapping[str, str],
    *,
    explored: bool = False,
    hour: Optional[int] = None,
) -> Tuple[str, str]:
    """(reason text, reason_code). Codes: seed, session, taste, walk, channel, rediscover, catalogue, discover."""
    if explored:
        return "New to you", "discover"

    weeks = _weeks_ago(profile, c.youtube_id)
    if "rediscover" in c.sources and (weeks is None or weeks >= 2):
        if weeks is None:
            return "Back on rotation", "rediscover"
        return f"Back on rotation: last played {weeks} week{'s' if weeks != 1 else ''} ago", "rediscover"

    seed = _strongest_seed(c)
    if seed is not None:
        source = c.seed_source.get(seed, "walk")
        loved = sum(1 for s, src in c.seed_source.items() if src in ("taste", "session", "seed"))
        title = short_title(titles.get(seed, ""))
        if source == "taste" and loved >= 2:
            return f"Fits {loved} songs you love", "taste"
        if title:
            return f"Because you played {title}", source if source in ("seed", "session", "taste", "walk") else "seed"
        return "Because of what you've been playing", source if source in ("seed", "session", "taste", "walk") else "seed"

    if hour is not None and features.get("hour_fit", 0.0) >= 0.5:
        return hour_reason(hour)
    if "channel" in c.sources and c.channel:
        return f"You often play {c.channel}", "channel"
    if features.get("novelty", 0.0) >= 0.5:
        return "New to you", "catalogue"
    return "Picked for you", "catalogue"
