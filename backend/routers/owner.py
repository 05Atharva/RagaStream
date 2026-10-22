"""
Owner-only review of new accounts (the in-app "Requests" screen).

Supabase can't render the email's confirmation page on its default domain, so the
owner approves here instead. The owner is whoever's account email is listed in
OWNER_EMAILS (comma-separated). The email comes from user_access, which the sign-up
trigger copies from auth.users, so a user can't claim it. No OWNER_EMAILS: no owner.
"""
from __future__ import annotations

import logging
import os
import uuid
from datetime import datetime, timezone
from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel

import auth
from auth import get_current_user
from db import get_supabase

logger = logging.getLogger(__name__)
router = APIRouter()

PENDING_LIMIT = 100
RECENT_LIMIT = 20


def owner_emails() -> set:
    return {e.strip().lower() for e in os.environ.get("OWNER_EMAILS", "").split(",") if e.strip()}


def is_owner_email(email: Optional[str]) -> bool:
    return bool(email) and email.strip().lower() in owner_emails()


async def get_owner(user: dict = Depends(get_current_user)) -> dict:
    """An approved user whose account email is in OWNER_EMAILS."""
    try:
        row = await run_in_threadpool(auth.fetch_access_row, user["user_id"])
    except Exception as exc:
        logger.warning("Could not read user_access: %s", type(exc).__name__)
        raise HTTPException(status_code=503, detail="Could not check your account right now. Try again in a moment.") from exc
    if not row or not is_owner_email(row.get("email")):
        raise HTTPException(status_code=403, detail={"code": "not_owner", "message": "Only the owner can review requests."})
    return {**user, "email": row.get("email")}


class PendingRequest(BaseModel):
    user_id: str
    email: Optional[str] = None
    provider: Optional[str] = None
    requested_at: Optional[str] = None


class DecidedRequest(BaseModel):
    user_id: str
    email: Optional[str] = None
    provider: Optional[str] = None
    status: Literal["approved", "rejected"]
    decided_at: Optional[str] = None


class RequestsResponse(BaseModel):
    pending: List[PendingRequest]
    recent: List[DecidedRequest]


class DecisionRequest(BaseModel):
    action: Literal["approve", "reject"]


class DecisionResponse(BaseModel):
    user_id: str
    status: Literal["approved", "rejected"]


def _load_requests(owner_id: str) -> dict:
    table = get_supabase().table("user_access")
    pending = (
        table.select("user_id, email, provider, requested_at")
        .eq("status", "pending")
        .order("requested_at")
        .limit(PENDING_LIMIT)
        .execute()
    ).data or []
    recent = (
        get_supabase().table("user_access")
        .select("user_id, email, provider, status, decided_at")
        .in_("status", ["approved", "rejected"])
        .neq("user_id", owner_id)
        .order("decided_at", desc=True, nullsfirst=False)
        .limit(RECENT_LIMIT)
        .execute()
    ).data or []
    return {"pending": pending, "recent": recent}


@router.get("/owner/requests", response_model=RequestsResponse)
async def list_requests(owner: dict = Depends(get_owner)):
    return await run_in_threadpool(_load_requests, owner["user_id"])


@router.post("/owner/requests/{user_id}", response_model=DecisionResponse)
async def decide_request(user_id: str, body: DecisionRequest, owner: dict = Depends(get_owner)):
    try:
        target = str(uuid.UUID(user_id))
    except ValueError:
        raise HTTPException(status_code=400, detail="That isn't a valid account id.")
    if target == owner["user_id"]:
        raise HTTPException(status_code=400, detail="You can't change your own access.")

    new_status = "approved" if body.action == "approve" else "rejected"

    def _update() -> List[dict]:
        return (
            get_supabase().table("user_access")
            .update({"status": new_status, "decided_at": datetime.now(timezone.utc).isoformat()})
            .eq("user_id", target)
            .execute()
        ).data or []

    rows = await run_in_threadpool(_update)
    if not rows:
        raise HTTPException(status_code=404, detail="That sign-up no longer exists.")
    auth.clear_access_cache(target)  # takes effect on their next request, not in 10 minutes
    logger.info("Owner %s set %s to %s", owner["user_id"], target, new_status)
    return {"user_id": target, "status": new_status}
