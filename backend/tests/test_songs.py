"""POST /songs must never overwrite the shared catalogue (any signed-in account can call it)."""
import os
import unittest
from types import SimpleNamespace
from unittest import mock

os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_KEY", "test")

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from auth import get_current_user  # noqa: E402
from routers import songs  # noqa: E402


class FakeTable:
    def __init__(self, db, rows):
        self.db, self.rows, self.filters, self.op, self.payload = db, rows, {}, "select", None

    def select(self, *_a, **_k): self.op = "select"; return self
    def eq(self, col, val): self.filters[col] = val; return self
    def limit(self, _n): return self
    def insert(self, payload): self.op, self.payload = "insert", payload; return self
    def upsert(self, *_a, **_k): self.db.calls.append("upsert"); return self
    def update(self, *_a, **_k): self.db.calls.append("update"); return self

    def execute(self):
        self.db.calls.append(self.op)
        if self.op == "insert":
            if self.db.fail_insert:
                self.db.rows.append({"id": "race", **self.payload})
                raise RuntimeError("duplicate key")
            row = {"id": f"id-{len(self.rows)}", "play_count": 0, **self.payload}
            self.rows.append(row)
            return SimpleNamespace(data=[row])
        hits = [r for r in self.rows if all(r.get(k) == v for k, v in self.filters.items())]
        return SimpleNamespace(data=hits[:1])


class FakeDB:
    def __init__(self, rows=None, fail_insert=False):
        self.rows, self.calls, self.fail_insert = list(rows or []), [], fail_insert

    def table(self, _name):
        return FakeTable(self, self.rows)


class CreateSongTests(unittest.TestCase):
    def setUp(self):
        app = FastAPI()
        app.include_router(songs.router, prefix="/songs")
        app.dependency_overrides[get_current_user] = lambda: {"user_id": "stranger"}
        self.client = TestClient(app)

    def post(self, db, **body):
        payload = {"youtube_id": "abc123", "title": "Kesariya", "channel_name": "Sony Music India", **body}
        with mock.patch.object(songs, "get_supabase", return_value=db):
            return self.client.post("/songs", json=payload)

    def test_existing_song_is_returned_unchanged(self):
        original = {"id": "s1", "youtube_id": "abc123", "title": "Kesariya", "channel_name": "Sony Music India",
                    "thumbnail_url": "https://i.ytimg.com/vi/abc123/hqdefault.jpg", "play_count": 3}
        db = FakeDB([original])
        r = self.post(db, title="HACKED", thumbnail_url="https://evil.example/x.png")
        self.assertEqual(r.status_code, 201)
        self.assertEqual(r.json()["title"], "Kesariya")
        self.assertEqual(db.rows[0]["title"], "Kesariya")
        self.assertNotIn("upsert", db.calls)
        self.assertNotIn("update", db.calls)
        self.assertNotIn("insert", db.calls)

    def test_new_song_inserted_with_only_youtube_thumbnails(self):
        db = FakeDB()
        r = self.post(db, thumbnail_url="https://evil.example/track.png")
        self.assertEqual(r.status_code, 201)
        self.assertIsNone(db.rows[0]["thumbnail_url"])
        db2 = FakeDB()
        self.post(db2, thumbnail_url="https://i.ytimg.com/vi/abc123/hqdefault.jpg")
        self.assertEqual(db2.rows[0]["thumbnail_url"], "https://i.ytimg.com/vi/abc123/hqdefault.jpg")

    def test_race_returns_the_row_that_won(self):
        db = FakeDB(fail_insert=True)
        r = self.post(db)
        self.assertEqual(r.status_code, 201)
        self.assertEqual(r.json()["id"], "race")

    def test_bad_input_rejected(self):
        for body in ({"youtube_id": "../etc"}, {"youtube_id": "x" * 40}, {"title": "t" * 301},
                     {"duration_sec": -1}, {"title": ""}):
            self.assertEqual(self.post(FakeDB(), **body).status_code, 422, body)


class ApprovalNotInstalledTests(unittest.TestCase):
    """Until access_schema.sql is applied, the gate must stand aside, not 503 everyone."""

    def test_missing_table_means_everyone_is_approved(self):
        import asyncio

        import auth

        class Missing:
            def table(self, _n):
                raise RuntimeError("{'code': 'PGRST205', 'message': \"Could not find the table 'public.user_access'\"}")

        auth.clear_access_cache()
        with mock.patch.object(auth, "get_supabase", return_value=Missing()):
            self.assertEqual(asyncio.run(auth._access_status("u1")), "approved")
        auth.clear_access_cache()

    def test_other_db_errors_still_fail_closed(self):
        import asyncio

        import auth
        from fastapi import HTTPException

        class Down:
            def table(self, _n):
                raise RuntimeError("connection reset")

        auth.clear_access_cache()
        with mock.patch.object(auth, "get_supabase", return_value=Down()):
            with self.assertRaises(HTTPException) as ctx:
                asyncio.run(auth._access_status("u2"))
        self.assertEqual(ctx.exception.status_code, 503)
        auth.clear_access_cache()


if __name__ == "__main__":
    unittest.main()
