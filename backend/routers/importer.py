"""
Playlist import (docs: backend/README.md, "Playlist import").

  POST /import/preview              read a public link or a pasted song list
  POST /import/jobs                 start matching + creating the playlist
  GET  /import/jobs/{job_id}        progress (owner only)
  POST /import/jobs/{job_id}/cancel
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Response

from auth import get_current_user
from importer import sources
from importer.errors import ImportFailure
from importer.jobs import JobManager, TooManyJobs
from importer.models import (
    ImportJob, ImportJobRequest, ImportPreview, ImportPreviewRequest, ImportTrack, JobCreated,
)
from importer.store import SupabaseStore

router = APIRouter()

_manager: Optional[JobManager] = None


def get_manager() -> JobManager:
    global _manager
    if _manager is None:
        # `sources.load_source` is looked up at call time so tests can swap it.
        async def loader(url, text):
            return await sources.load_source(url, text)

        _manager = JobManager(loader, SupabaseStore())
    return _manager


@router.post("/preview", response_model=ImportPreview)
async def preview(body: ImportPreviewRequest, _user: dict = Depends(get_current_user)):
    """What we can read from a public playlist link or a pasted list. Nothing is saved."""
    try:
        data = await sources.load_source(body.url, body.text)
    except ImportFailure as exc:
        raise HTTPException(status_code=422, detail=exc.detail)
    return ImportPreview(
        source=data.source, name=data.name, description=data.description, cover_url=data.cover_url,
        owner=data.owner, track_count=len(data.tracks), partial=data.partial, note=data.note,
        tracks=[
            ImportTrack(index=i, title=t.title, artists=t.artists, album=t.album,
                        duration_sec=t.duration_sec, youtube_id=t.youtube_id)
            for i, t in enumerate(data.tracks)
        ],
    )


@router.post("/jobs", response_model=JobCreated, status_code=202)
async def start_job(
    body: ImportJobRequest,
    user: dict = Depends(get_current_user),
    manager: JobManager = Depends(get_manager),
):
    try:
        state = manager.start(user["user_id"], body.url, body.text, body.name, body.description)
    except TooManyJobs:
        raise HTTPException(
            status_code=429,
            detail="You already have two imports running. Wait for one to finish, or cancel it.",
        )
    return JobCreated(job_id=state.job_id)


@router.get("/jobs/{job_id}", response_model=ImportJob)
async def get_job(job_id: str, user: dict = Depends(get_current_user), manager: JobManager = Depends(get_manager)):
    state = manager.get(user["user_id"], job_id)
    if state is None:
        raise HTTPException(status_code=404, detail="Import not found. It may have expired.")
    return state.to_model()


@router.post("/jobs/{job_id}/cancel", status_code=204)
async def cancel_job(job_id: str, user: dict = Depends(get_current_user), manager: JobManager = Depends(get_manager)):
    if not manager.cancel(user["user_id"], job_id):
        raise HTTPException(status_code=404, detail="Import not found. It may have expired.")
    return Response(status_code=204)
