"""
JWT authentication helpers for Supabase-issued access tokens.

Uses a direct HTTP call to Supabase Auth API (GET /auth/v1/user) to verify
tokens.  This avoids using supabase-py's auth.get_user() which mutates
internal HTTP headers and contaminates the service_role client, causing
'permission denied' (42501) errors on subsequent DB queries.
"""
from __future__ import annotations

import os
from typing import Optional

import httpx
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from dotenv import load_dotenv

from db import get_supabase

load_dotenv()

bearer_scheme = HTTPBearer(auto_error=False)

# Supabase project URL and anon/service key for the apikey header
_SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
_SUPABASE_KEY = os.environ.get("SUPABASE_KEY", "")


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
    async with httpx.AsyncClient() as client:
        resp = await client.get(url, headers=headers)
        if resp.status_code == 200:
            return resp.json()
    return None


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

    user_data = await _verify_token(credentials.credentials)
    if not user_data or "id" not in user_data:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return {"user_id": user_data["id"]}


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
