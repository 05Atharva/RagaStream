"""
RagaStream FastAPI backend — entry point.
"""
from contextlib import asynccontextmanager
import asyncio
import logging
import os

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routers import admin, auth_return, events, history, importer, liked, me, media, owner, playlists, recs, search, songs, youtube
from auth import get_current_user
from db import get_supabase

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Lifespan — startup / shutdown
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Verify Supabase connection on startup
    try:
        get_supabase()
        logger.info("Supabase client ready.")
    except Exception as exc:
        logger.warning("Supabase not configured: %s", exc)

    # Start background cache-cleanup task for YouTube
    cleanup_task = asyncio.create_task(youtube.cache_cleanup_loop())

    yield

    # Shutdown
    cleanup_task.cancel()
    try:
        await cleanup_task
    except asyncio.CancelledError:
        pass


# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------

app = FastAPI(
    title="RagaStream API",
    version="1.0.0",
    description="Backend API for the RagaStream music streaming app.",
    lifespan=lifespan,
    redirect_slashes=False,   # prevent 307s that strip Authorization headers
)

# CORS only matters for browsers; the phone app ignores it. Auth is a Bearer
# token, not a cookie, so credentials stay off. Set CORS_ORIGINS (comma-separated)
# to restrict browser access in production.
_cors_origins = [o.strip() for o in os.environ.get("CORS_ORIGINS", "*").split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Routers
# ---------------------------------------------------------------------------

# Every route needs a signed-in user except /health and the audio relay
# (which checks a signed link instead; see routers/youtube.py).
_signed_in = [Depends(get_current_user)]

app.include_router(songs.router,        prefix="/songs",  tags=["Songs"], dependencies=_signed_in)
app.include_router(songs.genres_router, prefix="/genres", tags=["Songs"], dependencies=_signed_in)
app.include_router(youtube.router,   prefix="/youtube",   tags=["YouTube"])
app.include_router(playlists.router, prefix="/playlists", tags=["Playlists"])
app.include_router(liked.router,     prefix="/liked",     tags=["Liked"])
app.include_router(history.router,   prefix="/history",   tags=["History"])
app.include_router(importer.router,  prefix="/import",    tags=["Import"], dependencies=_signed_in)
app.include_router(search.router,    prefix="/search",    tags=["Search"], dependencies=_signed_in)
app.include_router(admin.router,     prefix="/admin",     tags=["Admin"])
app.include_router(media.router,                          tags=["Media"], dependencies=_signed_in)
# Recommendations (docs/RECOMMENDATIONS.md). Both check sign-in on every route.
app.include_router(events.router,                         tags=["Recs"])
app.include_router(recs.router,                           tags=["Recs"])
# Owner approval status: signed-in only, deliberately not approval-gated.
app.include_router(me.router,                             tags=["Me"])
# Google sign-in's landing page on the way back into the app. Public by design:
# it only forwards the sign-in result to the app's own exp:// / ragastream:// links.
app.include_router(auth_return.router,                    tags=["Auth"])
# Owner reviews new accounts (Settings → Requests). Approved + OWNER_EMAILS only.
app.include_router(owner.router,                          tags=["Owner"])


@app.get("/health", tags=["Health"])
async def health():
    return {"status": "ok", "service": "ragastream-api"}
