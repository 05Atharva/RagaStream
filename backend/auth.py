"""
JWT authentication helpers for Supabase-issued access tokens.

Uses a direct HTTP call to Supabase Auth API (GET /auth/v1/user) to verify
tokens.  This avoids using supabase-py's auth.get_user() which mutates
internal HTTP headers and contaminates the service_role client, causing
'permission denied' (42501) errors on subsequent DB queries.
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
import time
from typing import Dict, Optional, Tuple

import httpx
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from dotenv import load_dotenv

from db import get_supabase

load_dotenv()

bearer_scheme = HTTPBearer(auto_error=False)

# Supabase project URL and anon key for the Auth API 'apikey' header.
# Note: The Auth API requires the *anon* key (SUPABASE_KEY), NOT the
# service_role key.  The service_role key is used only in db.py for
# PostgREST queries that need to bypass RLS.
_SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
_SUPABASE_KEY = os.environ.get("SUPABASE_KEY", "")


# Verified tokens, so every request doesn't wait on a round-trip to Supabase.
# { sha256(token): (user_id, expires_at) } — never stores the token itself.
# A signed-out token can keep working for up to TOKEN_CACHE_SECONDS.
TOKEN_CACHE_SECONDS = 5 * 60
TOKEN_CACHE_MAX_ENTRIES = 2000
_token_cache: Dict[str, Tuple[str, float]] = {}


def _token_expiry(token: str) -> Optional[float]:
    """The token's own `exp` claim (read only after Supabase has verified it)."""
    try:
        payload = token.split(".")[1]
        payload += "=" * (-len(payload) % 4)
        return float(json.loads(base64.urlsafe_b64decode(payload))["exp"])
    except Exception:
        return None


async def _verify_token(token: str) -> dict | None:
    """
    Verify a Supabase access token via direct HTTP call.
    Returns the user dict on success, None on failure.
    """
    url = f"{_SUPABASE_URL}/auth/v1/user"
    headers = {
        "Authorization": f"Bearer {token}",
        "apikey": _SUPABASE_KEY,
    }
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(url, headers=headers)
        if resp.status_code == 200:
            return resp.json()
    return None


async def _user_id_for(token: str) -> Optional[str]:
    now = time.time()
    key = hashlib.sha256(token.encode()).hexdigest()
    hit = _token_cache.get(key)
    if hit and hit[1] > now:
        return hit[0]

    user_data = await _verify_token(token)
    if not user_data or "id" not in user_data:
        _token_cache.pop(key, None)
        return None

    expires_at = now + TOKEN_CACHE_SECONDS
    token_exp = _token_expiry(token)
    if token_exp is not None:
        expires_at = min(expires_at, token_exp)
    if len(_token_cache) >= TOKEN_CACHE_MAX_ENTRIES:
        for stale in [k for k, (_, exp) in _token_cache.items() if exp <= now]:
            _token_cache.pop(stale, None)
        if len(_token_cache) >= TOKEN_CACHE_MAX_ENTRIES:
            _token_cache.pop(next(iter(_token_cache)))
    _token_cache[key] = (user_data["id"], expires_at)
    return user_data["id"]


async def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
) -> dict:
    """
    Validate the Bearer token via Supabase and return the authenticated user id.
    """
    if not credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing authentication token.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    user_id = await _user_id_for(credentials.credentials)
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return {"user_id": user_id}


async def get_current_admin(user: dict = Depends(get_current_user)) -> dict:
    """
    Check the authenticated user against the user_profiles admin flag.
    """
    supabase = get_supabase()
    try:
        result = (
            supabase.table("user_profiles")
            .select("is_admin")
            .eq("id", user["user_id"])
            .single()
            .execute()
        )
        if not result.data or not result.data.get("is_admin"):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Admin access required.",
            )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Could not verify admin status.",
        ) from exc

    return user
