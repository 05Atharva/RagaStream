"""
JWT authentication via Supabase.
Provides a FastAPI dependency that extracts and verifies the Bearer token.
"""
from __future__ import annotations
import os
from typing import Optional

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from db import get_supabase

bearer_scheme = HTTPBearer(auto_error=False)


async def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
) -> dict:
    """
    Validates the Supabase JWT from the Authorization header.
    Returns the user dict on success, raises 401 on failure.
    """
    if not credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing authentication token.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token = credentials.credentials
    supabase = get_supabase()

    try:
        response = supabase.auth.get_user(token)
        if response.user is None:
            raise ValueError("No user returned.")
        return {"id": response.user.id, "email": response.user.email}
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token.",
            headers={"WWW-Authenticate": "Bearer"},
        )


async def get_current_admin(
    user: dict = Depends(get_current_user),
) -> dict:
    """
    Extends get_current_user by also checking the is_admin flag in the DB.
    """
    supabase = get_supabase()
    try:
        result = (
            supabase.table("user_profiles")
            .select("is_admin")
            .eq("id", user["id"])
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
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Could not verify admin status.",
        )
    return user
