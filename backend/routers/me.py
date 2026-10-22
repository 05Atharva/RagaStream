"""
GET /me/access: the signed-in user's approval status.

Deliberately not gated on approval (it uses get_signed_in_user), so the app can
ask a pending or rejected user where they stand. See access_schema.sql.
"""
from __future__ import annotations

import logging
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel

import auth
from auth import get_signed_in_user

logger = logging.getLogger(__name__)
router = APIRouter()


class AccessResponse(BaseModel):
    status: Literal["pending", "approved", "rejected"]
    email: Optional[str] = None
    is_owner: bool = False


@router.get("/me/access", response_model=AccessResponse)
async def my_access(user: dict = Depends(get_signed_in_user)):
    try:
        row = await run_in_threadpool(auth.fetch_access_row, user["user_id"])
    except auth.ApprovalNotInstalled:
        # Approval isn't switched on yet (access_schema.sql not applied): everyone is in.
        return {"status": "approved", "email": user.get("email")}
    except Exception as exc:
        logger.warning("Could not read user_access: %s", type(exc).__name__)
        raise HTTPException(
            status_code=503,
            detail="Could not check your account access right now. Try again in a moment.",
        ) from exc
    value = (row or {}).get("status")
    if value not in ("approved", "pending", "rejected"):
        value = "pending"  # no row yet: fail closed
    email = (row or {}).get("email")
    from routers.owner import is_owner_email  # local import: owner imports auth, avoid a cycle at load
    return {"status": value, "email": email, "is_owner": value == "approved" and is_owner_email(email)}
