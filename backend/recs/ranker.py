"""Linear scorer: score = sum(w_i * f_i) with per-surface weights. Pure, no I/O."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, Iterable, List, Mapping, Optional

from .candidates import Candidate
from .features import compute_features
from .profile import Profile
from .weights import FEATURES, get_weights


@dataclass
class Scored:
    cand: Candidate
    features: Dict[str, float]
    score: float


def score(features: Mapping[str, float], weights: Mapping[str, float]) -> float:
    return sum(weights.get(name, 0.0) * features.get(name, 0.0) for name in FEATURES)


def score_candidates(
    candidates: Iterable[Candidate],
    profile: Profile,
    surface: str,
    weights: Optional[Mapping[str, float]] = None,
    hour: Optional[int] = None,
) -> List[Scored]:
    """Features and score for each candidate, best first (ties keep input order).
    No I/O: this is what evaluate.py and train.py call."""
    w = weights if weights is not None else get_weights(surface)
    out = []
    for c in candidates:
        f = compute_features(c, profile, hour)
        out.append(Scored(c, f, score(f, w)))
    out.sort(key=lambda s: -s.score)
    return out
