"""/import/* through FastAPI's TestClient: validation, auth, owner-only jobs, the error contract."""
import os
import time
import unittest
from unittest import mock

os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_KEY", "test")

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402
from auth import get_current_user  # noqa: E402
from importer import sources  # noqa: E402
from importer.errors import ImportFailure  # noqa: E402
from importer.jobs import JobManager  # noqa: E402
from importer.types import SourceData, SourceTrack  # noqa: E402
from routers import importer as import_router  # noqa: E402
from test_import_jobs import FakeStore, hit  # noqa: E402


def make_app(user="u1"):
    app = FastAPI()
    app.include_router(import_router.router, prefix="/import")
    if user:
        app.dependency_overrides[get_current_user] = lambda: {"user_id": user}
    return app


def data(n=3, source="spotify"):
    return SourceData(
        source=source, name="Mix", cover_url="https://i.scdn.co/x", owner="Spotify", partial=True, note="Only 100.",
        tracks=[SourceTrack(title=f"Song {i}", artists=["A"], album="Al", duration_sec=200 + i) for i in range(n)],
    )


class PreviewTests(unittest.TestCase):
    def post(self, body, loaded=None, error=None, user="u1"):
        async def fake(url=None, text=None):
            if error:
                raise error
            return loaded

        with mock.patch.object(sources, "load_source", fake):
            return TestClient(make_app(user)).post("/import/preview", json=body)

    def test_contract_shape(self):
        r = self.post({"url": "https://open.spotify.com/playlist/x"}, loaded=data())
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertEqual(set(body), {"source", "name", "description", "cover_url", "owner", "track_count", "partial", "note", "tracks"})
        self.assertEqual((body["source"], body["track_count"], body["partial"], body["note"]), ("spotify", 3, True, "Only 100."))
        self.assertEqual(body["tracks"][1], {"index": 1, "title": "Song 1", "artists": ["A"], "album": "Al",
                                             "duration_sec": 201, "youtube_id": None})

    def test_exactly_one_of_url_or_text(self):
        for body in ({}, {"url": "", "text": ""}, {"url": "https://x.com/a", "text": "Song"}, {"url": "  "}):
            self.assertEqual(self.post(body, loaded=data()).status_code, 422, body)
        self.assertEqual(self.post({"text": "Song - Artist"}, loaded=data()).status_code, 200)

    def test_oversized_input_is_refused(self):
        self.assertEqual(self.post({"url": "https://x.com/" + "a" * 3000}, loaded=data()).status_code, 422)
        self.assertEqual(self.post({"text": "a" * 100_001}, loaded=data()).status_code, 422)

    def test_unreadable_link_is_a_422_with_plain_advice(self):
        r = self.post({"url": "https://open.spotify.com/playlist/x"},
                      error=ImportFailure("This link isn't a public playlist. Open it in the app, make it public, or paste the song list instead."))
        self.assertEqual(r.status_code, 422)
        self.assertIn("paste the song list instead", r.json()["detail"])

    def test_requires_sign_in(self):
        r = TestClient(make_app(user=None)).post("/import/preview", json={"text": "Song"})
        self.assertEqual(r.status_code, 401)

    def test_real_text_path_end_to_end(self):
        r = TestClient(make_app()).post("/import/preview", json={"text": "1. Kesariya - Arijit Singh\n2. Tum Hi Ho by Arijit Singh\n"})
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertEqual((body["source"], body["track_count"], body["partial"]), ("text", 2, False))
        self.assertEqual(body["tracks"][1]["title"], "Tum Hi Ho")


class JobRouteTests(unittest.TestCase):
    def setUp(self):
        self.store = FakeStore()

        async def loader(url, text):
            return data()

        async def matcher(track):
            return hit(track.title), False

        self.manager = JobManager(loader, self.store, matcher)
        self.app = make_app()
        self.app.dependency_overrides[import_router.get_manager] = lambda: self.manager
        # One client context = one event loop for every request, like uvicorn: jobs outlive the request.
        self.client = TestClient(self.app)
        self.client.__enter__()
        self.addCleanup(self.client.__exit__, None, None, None)

    def as_user(self, user):
        self.app.dependency_overrides[get_current_user] = lambda: {"user_id": user}

    def wait_done(self, job_id):
        for _ in range(100):
            job = self.client.get(f"/import/jobs/{job_id}").json()
            if job["status"] in ("done", "failed"):
                return job
            time.sleep(0.02)
        self.fail("job did not finish")

    def test_start_poll_and_playlist(self):
        r = self.client.post("/import/jobs", json={"url": "https://open.spotify.com/playlist/x", "name": "Mine"})
        self.assertEqual(r.status_code, 202)
        job_id = r.json()["job_id"]
        job = self.wait_done(job_id)
        self.assertEqual(set(job), {"job_id", "status", "name", "source", "total", "matched", "not_found", "playlist_id", "error", "items"})
        self.assertEqual((job["status"], job["name"], job["total"], job["matched"]), ("done", "Mine", 3, 3))
        self.assertEqual(set(job["items"][0]), {"index", "title", "artists", "status", "song", "confidence"})
        self.assertEqual(job["items"][0]["song"]["title"], "Song 0")
        self.assertEqual(self.store.playlists[0]["name"], "Mine")

    def test_job_body_validation(self):
        for body in ({}, {"url": "https://x.com/a", "text": "x"}, {"text": "x", "name": "n" * 101}):
            self.assertEqual(self.client.post("/import/jobs", json=body).status_code, 422, body)

    def test_other_users_get_404(self):
        job_id = self.client.post("/import/jobs", json={"text": "Song"}).json()["job_id"]
        self.wait_done(job_id)
        self.as_user("intruder")
        self.assertEqual(self.client.get(f"/import/jobs/{job_id}").status_code, 404)
        self.assertEqual(self.client.post(f"/import/jobs/{job_id}/cancel").status_code, 404)
        self.as_user("u1")
        self.assertEqual(self.client.get(f"/import/jobs/{job_id}").status_code, 200)

    def test_cancel_is_204(self):
        job_id = self.client.post("/import/jobs", json={"text": "Song"}).json()["job_id"]
        r = self.client.post(f"/import/jobs/{job_id}/cancel")
        self.assertEqual((r.status_code, r.content), (204, b""))
        self.assertEqual(self.client.post("/import/jobs/unknown/cancel").status_code, 404)

    def test_third_running_import_is_429(self):
        import asyncio

        async def hang_loader(url, text):
            await asyncio.sleep(30)

        self.manager.loader = hang_loader
        codes = [self.client.post("/import/jobs", json={"text": "Song"}).status_code for _ in range(3)]
        self.assertEqual(codes, [202, 202, 429])
        self.assertIn("two imports", self.client.post("/import/jobs", json={"text": "Song"}).json()["detail"])


class WiringTests(unittest.TestCase):
    def test_every_import_route_requires_sign_in(self):
        client = TestClient(main.app)
        for method, path, kw in [("post", "/import/preview", {"json": {"text": "x"}}),
                                 ("post", "/import/jobs", {"json": {"text": "x"}}),
                                 ("get", "/import/jobs/abc", {}),
                                 ("post", "/import/jobs/abc/cancel", {})]:
            self.assertEqual(getattr(client, method)(path, **kw).status_code, 401, path)

    def test_routes_are_tagged_import(self):
        tags = {tuple(r.tags) for r in main.app.routes if getattr(r, "path", "").startswith("/import")}
        self.assertEqual(tags, {("Import",)})


if __name__ == "__main__":
    unittest.main()
