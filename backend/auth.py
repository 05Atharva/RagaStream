"""
JWT authentication and owner-approval helpers for Supabase-issued access tokens.

Uses a direct HTTP call to Supabase Auth API (GET /auth/v1/user) to verify
tokens.  This avoids using supabase-py's auth.get_user() which mutates
internal HTTP headers and contaminates the service_role client, causing
'permission denied' (42501) errors on subsequent DB queries.
"""
from __future__ import annotations

import base64
import hashlib
import json
import logging
import os
import time
from typing import Dict, Optional, Tuple

import httpx
from fastapi import Depends, HTTPException, status
from fastapi.concurrency import run_in_threadpool
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from dotenv import load_dotenv

from db import get_supabase

load_dotenv()
logger = logging.getLogger(__name__)

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
    # Only Supabase saying "this token is bad" (401/403) may become our 401: the app
    # signs the user out on a 401. A Supabase outage, rate limit or timeout must not
    # throw everyone out, so those are a 503 ("try again").
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(url, headers=headers)
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                            detail="Sign-in check is unavailable right now. Try again in a moment.") from exc
    if resp.status_code == 200:
        return resp.json()
    if resp.status_code in (401, 403):
        return None
    raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                        detail="Sign-in check is unavailable right now. Try again in a moment.")


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


async def get_signed_in_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
) -> dict:
    """
    Validate the Bearer token via Supabase and return the signed-in user id.
    Does NOT check approval: only for routes that must answer before approval
    (GET /me/access). Everything else uses get_current_user.
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


# ---------------------------------------------------------------------------
# Owner approval (public.user_access, see access_schema.sql)
# ---------------------------------------------------------------------------

# { user_id: (status, expires_at) }. Approved users are re-checked every 10
# minutes, others every 30 seconds so an approval shows up quickly.
APPROVED_CACHE_SECONDS = 10 * 60
WAITING_CACHE_SECONDS = 30
ACCESS_CACHE_MAX_ENTRIES = 2000
_access_cache: Dict[str, Tuple[str, float]] = {}

ACCESS_MESSAGES = {
    "pending": "Your account is waiting for the owner's approval. You'll get an email when you're in.",
    "rejected": "The owner declined this account, so RagaStream can't open for you.",
}


class ApprovalNotInstalled(Exception):
    """public.user_access doesn't exist yet (access_schema.sql not applied)."""


# Approval switches on when its table exists. Until then the gate stands aside
# (exactly the old behaviour) instead of locking everyone out with 503s.
NOT_INSTALLED_CACHE_SECONDS = 60
_warned_not_installed = False


def _is_missing_table(exc: Exception) -> bool:
    text = str(exc)
    return "PGRST205" in text or "42P01" in text or "Could not find the table" in text


def fetch_access_row(user_id: str) -> Optional[dict]:
    """The user's user_access row, or None when there isn't one.
    Raises ApprovalNotInstalled when the table is missing, and other errors as they are."""
    try:
        result = (
            get_supabase()
            .table("user_access")
            .select("status, email")
            .eq("user_id", user_id)
            .limit(1)
            .execute()
        )
    except Exception as exc:
        if _is_missing_table(exc):
            raise ApprovalNotInstalled() from exc
        raise
    rows = result.data or []
    return rows[0] if rows else None


def clear_access_cache(user_id: Optional[str] = None) -> None:
    if user_id is None:
        _access_cache.clear()
    else:
        _access_cache.pop(user_id, None)


async def _access_status(user_id: str) -> str:
    """'approved', 'pending' or 'rejected'. A missing row counts as pending (fail closed)."""
    now = time.time()
    hit = _access_cache.get(user_id)
    if hit and hit[1] > now:
        return hit[0]

    global _warned_not_installed
    try:
        row = await run_in_threadpool(fetch_access_row, user_id)
    except ApprovalNotInstalled:
        if not _warned_not_installed:
            logger.warning("Owner approval is OFF: public.user_access is missing. Apply backend/access_schema.sql to turn it on.")
            _warned_not_installed = True
        _access_cache[user_id] = ("approved", now + NOT_INSTALLED_CACHE_SECONDS)
        return "approved"
    except Exception as exc:
        logger.warning("Could not read user_access: %s", type(exc).__name__)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Could not check your account access right now. Try again in a moment.",
        ) from exc

    value = row.get("status") if row else None
    if value not in ("approved", "pending", "rejected"):
        value = "pending"

    ttl = APPROVED_CACHE_SECONDS if value == "approved" else WAITING_CACHE_SECONDS
    if len(_access_cache) >= ACCESS_CACHE_MAX_ENTRIES:
        for stale in [k for k, (_, exp) in _access_cache.items() if exp <= now]:
            _access_cache.pop(stale, None)
        if len(_access_cache) >= ACCESS_CACHE_MAX_ENTRIES:
            _access_cache.pop(next(iter(_access_cache)))
    _access_cache[user_id] = (value, now + ttl)
    return value


async def get_current_user(user: dict = Depends(get_signed_in_user)) -> dict:
    """
    The dependency every route uses: a signed-in user the owner has approved.
    401 for a bad token, 403 {code: access_pending | access_rejected} otherwise.
    """
    access = await _access_status(user["user_id"])
    if access != "approved":
        code = "access_rejected" if access == "rejected" else "access_pending"
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": code, "message": ACCESS_MESSAGES[access]},
        )
    return user


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
