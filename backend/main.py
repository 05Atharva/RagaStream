"""
RagaStream FastAPI backend — entry point.
"""
from contextlib import asynccontextmanager
import asyncio
import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routers import songs, youtube, playlists, search, admin
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
)

# CORS — allow all origins for development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Routers
# ---------------------------------------------------------------------------

app.include_router(songs.router,        prefix="/songs",  tags=["Songs"])
app.include_router(songs.genres_router,               tags=["Songs"])
app.include_router(youtube.router,   prefix="/youtube",   tags=["YouTube"])
app.include_router(playlists.router, prefix="/playlists", tags=["Playlists"])
app.include_router(search.router,    prefix="/search",    tags=["Search"])
app.include_router(admin.router,     prefix="/admin",     tags=["Admin"])


@app.get("/health", tags=["Health"])
async def health():
    return {"status": "ok", "service": "ragastream-api"}
