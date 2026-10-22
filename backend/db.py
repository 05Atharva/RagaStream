"""
Database client for Supabase PostgREST.

Uses postgrest-py directly instead of the full supabase-py client.
This avoids the GoTrueClient which corrupts the Authorization header
by overriding the service_role key with empty session tokens during
its internal session management, causing 401/42501 errors.

All routers call db.table("table_name") which returns a PostgREST
query builder — functionally identical to supabase.table().

IMPORTANT: The backend MUST use the Supabase service_role key (not
the anon key).  The service_role key bypasses Row-Level Security,
which is required because the backend enforces its own auth via JWT
validation in auth.py.  Using the anon key causes 42501 permission-
denied errors on every table that has RLS enabled.
"""
import os
import json
import base64
import logging
import threading

from postgrest import SyncPostgrestClient
from dotenv import load_dotenv

load_dotenv()
logger = logging.getLogger(__name__)


def _detect_key_role(key: str) -> str:
    """Decode the JWT payload to detect whether this is an anon or service_role key."""
    try:
        payload_b64 = key.split(".")[1]
        # Add padding
        payload_b64 += "=" * (4 - len(payload_b64) % 4)
        payload = json.loads(base64.urlsafe_b64decode(payload_b64))
        return payload.get("role", "unknown")
    except Exception:
        return "unknown"


class SupabaseDB:
    """Thin wrapper around SyncPostgrestClient that mirrors supabase.table()."""

    def __init__(self, url: str, key: str):
        rest_url = f"{url}/rest/v1"
        headers = {
            "apikey": key,
            "Authorization": f"Bearer {key}",
        }
        self._client = SyncPostgrestClient(rest_url, headers=headers)

    def table(self, name: str):
        """Return a PostgREST query builder for the given table."""
        return self._client.from_(name)


_db: SupabaseDB | None = None
# One client per thread. Routes run their sync DB calls on a thread pool, and a
# single shared HTTP/2 connection used from several threads at once can be reset
# ("RemoteProtocolError: ConnectionTerminated"): the app's burst of requests at
# launch then got 503s. Each thread keeps its own connection instead.
_local = threading.local()
_logged = False


def get_supabase() -> SupabaseDB:
    """Return this thread's PostgREST client (service_role key)."""
    db = getattr(_local, "db", None)
    if db is None:
        db = _local.db = _create()
    return db


def _create() -> SupabaseDB:
    global _db, _logged
    url = os.environ["SUPABASE_URL"]
    # Prefer the explicit service-role key; fall back to SUPABASE_KEY
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ["SUPABASE_KEY"]
    if not _logged:
        _logged = True
        role = _detect_key_role(key)
        if role == "anon":
            logger.warning(
                "\n"
                "==================================================================\n"
                "  WARNING: SUPABASE_KEY contains the *anon* key.\n"
                "  The backend requires the *service_role* key to bypass RLS.\n"
                "  Go to Supabase Dashboard → Project Settings → API →\n"
                "  copy the 'service_role' secret and set it as:\n"
                "      SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>\n"
                "  or replace SUPABASE_KEY in .env with the service_role key.\n"
                "  Until fixed, all DB writes will fail with 42501 errors.\n"
                "=================================================================="
            )
        else:
            logger.info("Supabase key role detected: %s", role)
        logger.info("Supabase PostgREST client ready (one connection per thread).")
    _db = SupabaseDB(url, key)
    return _db
