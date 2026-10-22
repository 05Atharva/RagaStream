"""
/recs/* routes through FastAPI's TestClient with get_current_user overridden.

Run from backend/:  venv/Scripts/python -m unittest discover -s tests -p "test_recs_*.py" -v
"""
import unittest

from test_recs_fixtures import FakeStore, World, rel, song_row

from fastapi import FastAPI
from fastapi.testclient import TestClient

from auth import get_current_user
from routers import recs as recs_router


def make_client(authenticated=True):
    app = FastAPI()
    app.include_router(recs_router.router)
    if authenticated:
        app.dependency_overrides[get_current_user] = lambda: {"user_id": "u1"}
    return TestClient(app)


def mix(prefix, n=30):
    return [rel(f"{prefix}{i}", i + 1, f"{prefix.upper()}C{i % 6}") for i in range(n)]


class RouterTests(unittest.TestCase):
    def test_requires_sign_in(self):
        client = make_client(authenticated=False)
        for method, path, kw in [("get", "/recs/next?seed=abc", {}), ("get", "/recs/radio?seed=abc", {}),
                                 ("post", "/recs/shuffle", {"json": {}}),
                                 ("post", "/recs/playlist", {"json": {"youtube_ids": []}}),
                                 ("get", "/recs/home", {})]:
            self.assertEqual(getattr(client, method)(path, **kw).status_code, 401, path)

    def test_next_returns_slate(self):
        with World(FakeStore(live={"abc": mix("n")})):
            r = make_client().get("/recs/next", params={"seed": "abc", "exclude": "n0,n1", "limit": 5})
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertEqual(body["surface"], "autoplay")
        self.assertEqual(len(body["items"]), 5)
        self.assertTrue(body["rec_id"])
        self.assertEqual(set(body["items"][0]), {"youtube_id", "title", "channel", "duration", "thumbnail",
                                                 "reason", "reason_code"})
        self.assertFalse({"n0", "n1", "abc"} & {i["youtube_id"] for i in body["items"]})

    def test_radio_defaults_and_flow(self):
        with World(FakeStore(live={"abc": mix("r", 40)})):
            r = make_client().get("/recs/radio", params={"seed": "abc"})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["surface"], "radio")
        self.assertEqual(len(r.json()["items"]), 30)
        self.assertEqual(r.json()["items"][0]["youtube_id"], "r0")

    def test_radio_with_nothing_is_a_502_so_the_app_can_fall_back(self):
        with World(FakeStore(fail={"abc"})):
            r = make_client().get("/recs/radio", params={"seed": "abc"})
        self.assertEqual(r.status_code, 502)
        self.assertIn("detail", r.json())

    def test_shuffle_and_playlist(self):
        live = {"c0": mix("s"), "p0": mix("q")}
        with World(FakeStore(live=live)):
            client = make_client()
            r = client.post("/recs/shuffle", json={"current": "c0", "context": ["c0", "x"], "exclude": [], "limit": 6})
            self.assertEqual(r.status_code, 200)
            self.assertEqual(r.json()["surface"], "smart_shuffle")
            self.assertEqual(len(r.json()["items"]), 6)
            r = client.post("/recs/playlist", json={"youtube_ids": ["p0"], "limit": 4})
            self.assertEqual(r.status_code, 200)
            self.assertEqual(r.json()["surface"], "playlist_recs")
            self.assertEqual(len(r.json()["items"]), 4)

    def test_home_shape(self):
        from test_recs_surfaces import HomeTests
        with HomeTests().world():
            r = make_client().get("/recs/home", params={"hour": 23})
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertIn("generated_at", body)
        self.assertGreaterEqual(len(body["sections"]), 3)
        sec = body["sections"][0]
        self.assertEqual(set(sec), {"id", "kind", "title", "subtitle", "seed", "rec_id", "items"})

    def test_validation(self):
        client = make_client()
        too_many = ",".join(f"id{i}" for i in range(201))
        cases = [
            ("get", "/recs/next", {"params": {"seed": "bad id!"}}),
            ("get", "/recs/next", {"params": {"seed": "abc", "limit": 31}}),
            ("get", "/recs/next", {"params": {"seed": "abc", "limit": 0}}),
            ("get", "/recs/next", {"params": {"seed": "abc", "exclude": too_many}}),
            ("get", "/recs/next", {"params": {"seed": "abc", "exclude": "ok,not ok!"}}),
            ("get", "/recs/next", {"params": {}}),
            ("get", "/recs/radio", {"params": {"seed": "abc", "limit": 51}}),
            ("get", "/recs/home", {"params": {"hour": 24}}),
            ("post", "/recs/shuffle", {"json": {"context": [f"i{n}" for n in range(201)]}}),
            ("post", "/recs/shuffle", {"json": {"limit": 31}}),
            ("post", "/recs/shuffle", {"json": {"current": "bad id"}}),
            ("post", "/recs/playlist", {"json": {"youtube_ids": [f"i{n}" for n in range(201)]}}),
            ("post", "/recs/playlist", {"json": {"youtube_ids": ["a"], "exclude": ["x y"]}}),
            ("post", "/recs/playlist", {"json": {}}),
        ]
        for method, path, kw in cases:
            self.assertEqual(getattr(client, method)(path, **kw).status_code, 422, (path, kw))

    def test_engine_failure_is_a_502_not_a_crash(self):
        from recs import surfaces
        from unittest import mock

        async def boom(*a, **k):
            raise RuntimeError("secret internals")

        with mock.patch.object(surfaces, "next_slate", boom):
            r = make_client().get("/recs/next", params={"seed": "abc"})
        self.assertEqual(r.status_code, 502)
        self.assertNotIn("secret", r.text)


if __name__ == "__main__":
    unittest.main()
