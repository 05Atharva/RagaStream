"""
Database client for Supabase PostgREST.

Uses postgrest-py directly instead of the full supabase-py client.
This avoids the GoTrueClient which corrupts the Authorization header
by overriding the service_role key with empty session tokens during
its internal session management, causing 401/42501 errors.

All routers call db.table("table_name") which returns a PostgREST
query builder — functionally identical to supabase.table().
"""
import os
import logging

from postgrest import SyncPostgrestClient
from dotenv import load_dotenv

load_dotenv()
logger = logging.getLogger(__name__)


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


def get_supabase() -> SupabaseDB:
    """Return a singleton PostgREST client using the service_role key."""
    global _db
    if _db is None:
        url = os.environ["SUPABASE_URL"]
        key = os.environ["SUPABASE_KEY"]
        _db = SupabaseDB(url, key)
        logger.info("Supabase PostgREST client ready.")
    return _db
