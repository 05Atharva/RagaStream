"""
In-memory import jobs, per user: at most 2 running, 20 kept, gone after 2 hours.

A job loads its source, matches each track (3 at a time), puts every matched song in the
catalogue as it goes (insert-only, so progress shows real songs), then creates the playlist in
source order. Nothing here touches the network or database directly: the loader, matcher and
store are passed in, which is also how the tests drive it.
"""
from __future__ import annotations

import asyncio
import logging
import secrets
import time
from collections import OrderedDict
from dataclasses import dataclass, field
from typing import Awaitable, Callable, Dict, List, Optional

from fastapi.concurrency import run_in_threadpool

from schemas import SongResponse

from .errors import ImportFailure
from .match import ACCEPT, Match, find_match
from .models import ImportJob, ImportJobItem
from .types import SourceData, SourceTrack

logger = logging.getLogger(__name__)

MAX_RUNNING_PER_USER = 2
MAX_KEPT_PER_USER = 20
JOB_TTL_SECONDS = 2 * 60 * 60
JOB_CONCURRENCY = 3
RUNNING = ("queued", "matching", "creating")
CANCELLED_MESSAGE = "Import cancelled."


class TooManyJobs(Exception):
    """Two imports are already running for this user."""


@dataclass
class JobState:
    job_id: str
    user_id: str
    name: str
    description: Optional[str]
    created_at: float
    status: str = "queued"
    source: str = "text"
    playlist_id: Optional[str] = None
    error: Optional[str] = None
    items: List[ImportJobItem] = field(default_factory=list)
    cancelled: bool = False
    task: Optional[asyncio.Task] = None
    given_name: bool = False

    @property
    def matched(self) -> int:
        return sum(1 for i in self.items if i.status == "matched")

    @property
    def not_found(self) -> int:
        return sum(1 for i in self.items if i.status == "not_found")

    def to_model(self) -> ImportJob:
        return ImportJob(
            job_id=self.job_id, status=self.status, name=self.name, source=self.source,
            total=len(self.items), matched=self.matched, not_found=self.not_found,
            playlist_id=self.playlist_id, error=self.error, items=[i.model_copy() for i in self.items],
        )


Loader = Callable[[Optional[str], Optional[str]], Awaitable[SourceData]]
Matcher = Callable[[SourceTrack], Awaitable[tuple]]   # -> (Match | None, search_failed)


def _song_meta(track: SourceTrack, match: Optional[Match]) -> dict:
    if match is not None:
        c = match.candidate
        return {"youtube_id": c.youtube_id, "title": c.title, "channel_name": c.channel,
                "thumbnail_url": c.thumbnail, "duration_sec": c.duration or None}
    channel = track.channel or (track.artists[0] if track.artists else "Unknown")
    return {"youtube_id": track.youtube_id, "title": track.title, "channel_name": channel,
            "thumbnail_url": track.thumbnail, "duration_sec": track.duration_sec}


class JobManager:
    def __init__(self, loader: Loader, store, matcher: Matcher = find_match, clock: Callable[[], float] = time.time):
        self.loader, self.store, self.matcher, self.clock = loader, store, matcher, clock
        self._jobs: Dict[str, "OrderedDict[str, JobState]"] = {}

    # -- bookkeeping -------------------------------------------------------

    def _purge(self, user_id: str) -> "OrderedDict[str, JobState]":
        jobs = self._jobs.setdefault(user_id, OrderedDict())
        now = self.clock()
        for job_id in [j for j, s in jobs.items() if now - s.created_at > JOB_TTL_SECONDS and s.status not in RUNNING]:
            del jobs[job_id]
        while len(jobs) > MAX_KEPT_PER_USER:
            oldest_done = next((j for j, s in jobs.items() if s.status not in RUNNING), None)
            if oldest_done is None:
                break
            del jobs[oldest_done]
        return jobs

    def running_count(self, user_id: str) -> int:
        return sum(1 for s in self._purge(user_id).values() if s.status in RUNNING)

    def get(self, user_id: str, job_id: str) -> Optional[JobState]:
        return self._purge(user_id).get(job_id)   # another user's id is simply not in this dict

    def start(self, user_id: str, url: Optional[str], text: Optional[str],
              name: Optional[str], description: Optional[str]) -> JobState:
        if self.running_count(user_id) >= MAX_RUNNING_PER_USER:
            raise TooManyJobs()
        state = JobState(
            job_id=secrets.token_urlsafe(12), user_id=user_id, name=(name or "").strip() or "Imported playlist",
            description=(description or "").strip() or None, created_at=self.clock(),
            given_name=bool((name or "").strip()),
        )
        jobs = self._purge(user_id)
        jobs[state.job_id] = state
        self._purge(user_id)
        state.task = asyncio.get_running_loop().create_task(self._run(state, url, text))
        return state

    def cancel(self, user_id: str, job_id: str) -> bool:
        """False when the job is not this user's. Cancelling a finished job does nothing."""
        state = self.get(user_id, job_id)
        if state is None:
            return False
        if state.status in RUNNING:
            state.cancelled = True
            state.status, state.error = "failed", CANCELLED_MESSAGE
            if state.task and not state.task.done():
                state.task.cancel()
        return True

    # -- the work ----------------------------------------------------------

    async def _run(self, state: JobState, url: Optional[str], text: Optional[str]) -> None:
        try:
            data = await self.loader(url, text)
            state.source = data.source
            if not state.given_name:
                state.name = data.name
            if state.description is None and data.description:
                state.description = data.description
            state.items = [ImportJobItem(index=i, title=t.title, artists=list(t.artists)) for i, t in enumerate(data.tracks)]
            state.status = "matching"

            sem = asyncio.Semaphore(JOB_CONCURRENCY)
            tally = {"search_failed": 0, "searched_ok": 0}

            async def one(i: int, track: SourceTrack) -> None:
                async with sem:
                    if state.cancelled:
                        return
                    item = state.items[i]
                    try:
                        if track.youtube_id:
                            match, accepted = None, True
                            item.confidence = 1.0
                        else:
                            match, search_failed = await self.matcher(track)
                            tally["search_failed" if search_failed else "searched_ok"] += 1
                            accepted = match is not None and match.confidence >= ACCEPT
                            item.confidence = round(match.confidence, 2) if match else None
                        if accepted:
                            row = await run_in_threadpool(self.store.ensure_song, _song_meta(track, match))
                            item.song = SongResponse(**row)
                            item.status = "matched"
                        else:
                            item.status = "not_found"
                    except asyncio.CancelledError:
                        raise
                    except Exception:
                        logger.exception("Import: track %d failed", i)
                        item.status = "not_found"

            await asyncio.gather(*(one(i, t) for i, t in enumerate(data.tracks)))
            if state.cancelled:
                return

            if tally["searched_ok"] == 0 and tally["search_failed"] > 0:
                raise ImportFailure("YouTube search is not answering right now. Try the import again in a few minutes.")
            song_ids: List[str] = []
            for item in state.items:
                if item.status == "matched" and item.song and item.song.id not in song_ids:
                    song_ids.append(item.song.id)
            if not song_ids:
                raise ImportFailure(
                    "None of those songs could be found on YouTube. Check the spelling, "
                    "or paste the list with the artist after each song."
                )
            state.status = "creating"
            state.playlist_id = await run_in_threadpool(
                self.store.create_playlist, state.user_id, state.name[:100], state.description, song_ids
            )
            state.status = "done"
        except asyncio.CancelledError:
            if state.status in RUNNING:
                state.status, state.error = "failed", CANCELLED_MESSAGE
        except ImportFailure as exc:
            if not state.cancelled:
                state.status, state.error = "failed", exc.detail
        except Exception:
            logger.exception("Import job %s failed", state.job_id)
            if not state.cancelled:
                state.status, state.error = "failed", "Something went wrong while importing. Try again."
