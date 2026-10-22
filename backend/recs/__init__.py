"""
Recommendation engine ("Raag engine"). See docs/RECOMMENDATIONS.md.

Importing this package is cheap; the engine modules load when first used.
"""
from __future__ import annotations

from typing import Dict, Optional


def features_for(rec_id: str, youtube_id: str) -> Optional[Dict[str, float]]:
    """Features the ranker saw for an item in a served slate (None once forgotten)."""
    from . import slates
    return slates.features_for(rec_id, youtube_id)


def invalidate_user(user_id: str, home: bool = True) -> None:
    """Forget a user's cached profile and, unless home=False, their Home sections."""
    from . import profile, slates
    profile.invalidate(user_id)
    if home:
        slates.clear_home(user_id)


__all__ = ["features_for", "invalidate_user"]
