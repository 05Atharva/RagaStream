"""
Slate memory: each served slate gets a rec_id and its items' features are kept (6 h, max 2,000
slates) so POST /events can attach the features the model saw. Also holds the Home cache.
"""
from __future__ import annotations

import secrets
import threading
import time
from collections import OrderedDict
from typing import Any, Dict, Optional, Tuple

SLATE_TTL = 6 * 60 * 60
SLATE_MAX = 2000
HOME_TTL = 3 * 60 * 60
HOME_MAX = 500

_lock = threading.Lock()
_slates: "OrderedDict[str, Tuple[float, str, Dict[str, Dict[str, float]]]]" = OrderedDict()
_home: "OrderedDict[str, Tuple[float, Any]]" = OrderedDict()


def new_rec_id() -> str:
    return secrets.token_urlsafe(6)


def remember(rec_id: str, surface: str, features: Dict[str, Dict[str, float]]) -> None:
    now = time.time()
    with _lock:
        _slates[rec_id] = (now, surface, features)
        _slates.move_to_end(rec_id)
        while len(_slates) > SLATE_MAX:
            _slates.popitem(last=False)


def features_for(rec_id: str, youtube_id: str) -> Optional[Dict[str, float]]:
    """Features the ranker saw for this item when it served the slate, or None."""
    with _lock:
        hit = _slates.get(rec_id)
        if hit is None:
            return None
        if time.time() - hit[0] > SLATE_TTL:
            _slates.pop(rec_id, None)
            return None
        _slates.move_to_end(rec_id)
        feats = hit[2].get(youtube_id)
        return dict(feats) if feats is not None else None


def surface_of(rec_id: str) -> Optional[str]:
    with _lock:
        hit = _slates.get(rec_id)
        return hit[1] if hit else None


def get_home(user_id: str) -> Any:
    with _lock:
        hit = _home.get(user_id)
        if hit is None:
            return None
        if time.time() - hit[0] > HOME_TTL:
            _home.pop(user_id, None)
            return None
        return hit[1]


def put_home(user_id: str, value: Any) -> None:
    with _lock:
        _home[user_id] = (time.time(), value)
        _home.move_to_end(user_id)
        while len(_home) > HOME_MAX:
            _home.popitem(last=False)


def clear_home(user_id: str) -> None:
    with _lock:
        _home.pop(user_id, None)


def clear_all() -> None:
    with _lock:
        _slates.clear()
        _home.clear()
