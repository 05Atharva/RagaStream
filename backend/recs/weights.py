"""Per-surface ranking weights: the contract's starting table, or weights.json from train.py."""
from __future__ import annotations

import json
import logging
import math
import os
from typing import Dict, Optional

logger = logging.getLogger(__name__)

FEATURES = (
    "consensus", "mix_rank", "seed_sim", "song_aff", "channel_aff", "skip_penalty",
    "fatigue", "novelty", "hour_fit", "variant_fit", "quality", "session_steer",
)
SURFACES = ("autoplay", "radio", "smart_shuffle", "playlist", "home")

# Slate surface name -> weights profile
WEIGHT_KEY = {"playlist_recs": "playlist"}

_COLUMNS = {
    #                 cons  rank  sim   song  chan  skip   fat   nov  hour  var   qual  sess
    "autoplay":      (1.0, 0.8, 1.2, 0.6, 1.0, -1.5, -1.2, 0.3, 0.3, 0.4, 1.0, 1.0),
    "radio":         (0.8, 1.2, 1.4, 0.3, 0.4, -1.0, -0.8, 0.5, 0.1, 0.4, 1.0, 0.6),
    "smart_shuffle": (1.2, 0.6, 1.0, 0.5, 0.6, -1.5, -1.0, 0.4, 0.2, 0.4, 1.0, 0.8),
    "playlist":      (1.4, 0.6, 1.0, 0.4, 0.5, -1.0, -0.5, 0.6, 0.0, 0.4, 1.0, 0.0),
    "home":          (1.0, 0.5, 0.6, 1.0, 1.0, -1.5, -1.0, 0.4, 0.5, 0.4, 1.0, 0.3),
}
DEFAULT_WEIGHTS: Dict[str, Dict[str, float]] = {
    s: dict(zip(FEATURES, col)) for s, col in _COLUMNS.items()
}
# Share of slots given to novel candidates, per surface.
EXPLORATION: Dict[str, float] = {
    "autoplay": 0.15, "radio": 0.20, "smart_shuffle": 0.15, "playlist": 0.25, "home": 0.15,
}

WEIGHTS_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "weights.json")
_cache: Dict[str, object] = {"mtime": None, "path": None, "weights": DEFAULT_WEIGHTS}


def key_for(surface: str) -> str:
    return WEIGHT_KEY.get(surface, surface)


def _valid(entry: object) -> Optional[Dict[str, float]]:
    """A surface entry is valid when it has exactly the known features, all finite numbers."""
    if not isinstance(entry, dict) or set(entry) != set(FEATURES):
        return None
    out: Dict[str, float] = {}
    for name in FEATURES:
        v = entry[name]
        if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
            return None
        out[name] = float(v)
    return out


def load_weights(path: Optional[str] = None) -> Dict[str, Dict[str, float]]:
    """Weights from `path` (default weights.json); any invalid or missing surface uses the default."""
    path = path or WEIGHTS_PATH
    merged = {s: dict(w) for s, w in DEFAULT_WEIGHTS.items()}
    try:
        with open(path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
    except FileNotFoundError:
        return merged
    except (OSError, ValueError) as exc:
        logger.warning("Ignoring unreadable weights file %s: %s", path, exc)
        return merged
    if not isinstance(data, dict):
        logger.warning("Ignoring weights file %s: expected an object.", path)
        return merged
    for surface in SURFACES:
        entry = _valid(data.get(surface))
        if entry is not None:
            merged[surface] = entry
        elif surface in data:
            logger.warning("Ignoring invalid weights for %s in %s.", surface, path)
    return merged


def get_weights(surface: str, path: Optional[str] = None) -> Dict[str, float]:
    """Current weights for a surface; reloads when weights.json changes on disk."""
    path = path or WEIGHTS_PATH
    try:
        mtime: Optional[float] = os.path.getmtime(path)
    except OSError:
        mtime = None
    if _cache["mtime"] != mtime or _cache["path"] != path:
        _cache.update(mtime=mtime, path=path, weights=load_weights(path))
    return _cache["weights"][key_for(surface)]  # type: ignore[index]


def exploration_share(surface: str) -> float:
    return EXPLORATION.get(key_for(surface), 0.15)
