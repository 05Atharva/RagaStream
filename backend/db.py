"""
Database client: Supabase.
"""
import os
import functools

from supabase import create_client, Client
from dotenv import load_dotenv

load_dotenv()


# ---------------------------------------------------------------------------
# Supabase
# ---------------------------------------------------------------------------

@functools.lru_cache(maxsize=1)
def get_supabase() -> Client:
    url = os.environ["SUPABASE_URL"]
    key = os.environ["SUPABASE_KEY"]
    return create_client(url, key)
