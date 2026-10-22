"""
Tests for the owner-approval gate (auth.py) and GET /me/access.
Standard library unittest only; no network, no real DB.

Run from backend/:  venv/Scripts/python -m unittest discover -s tests -p "test_access.py" -v
"""
import os
import sys
import unittest
from unittest import mock

os.environ.setdefault("SUPABASE_URL", "http://localhost")
os.environ.setdefault("SUPABASE_KEY", "dummy")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi import Depends, FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import auth  # noqa: E402
import main  # noqa: E402

TOKENS = {"tok-approved": "u-approved", "tok-pending": "u-pending",
          "tok-rejected": "u-rejected", "tok-missing": "u-missing"}
ROWS = {
    "u-approved": {"status": "approved", "email": "ok@example.com"},
    "u-pending": {"status": "pending", "email": "wait@example.com"},
    "u-rejected": {"status": "rejected", "email": "no@example.com"},
}


class AccessTestCase(unittest.TestCase):
    def setUp(self):
        self.reads = []
        self.fail_db = False
        self.rows = {k: dict(v) for k, v in ROWS.items()}

        async def fake_user_id(token):
            return TOKENS.get(token)

        def fake_fetch(user_id):
            self.reads.append(user_id)
            if self.fail_db:
                raise RuntimeError("db down")
            return self.rows.get(user_id)

        for patcher in (
            mock.patch.object(auth, "_user_id_for", fake_user_id),
            mock.patch.object(auth, "fetch_access_row", fake_fetch),
        ):
            patcher.start()
            self.addCleanup(patcher.stop)
        auth.clear_access_cache()
        self.addCleanup(auth.clear_access_cache)

        self.app = FastAPI()

        @self.app.get("/guarded")
        async def guarded(user: dict = Depends(auth.get_current_user)):
            return user

        self.client = TestClient(self.app)

    def get(self, token, path="/guarded", client=None):
        headers = {"Authorization": f"Bearer {token}"} if token else {}
        return (client or self.client).get(path, headers=headers)


class GateTests(AccessTestCase):
    def test_approved_allowed(self):
        res = self.get("tok-approved")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json(), {"user_id": "u-approved"})

    def test_pending_403_with_code(self):
        res = self.get("tok-pending")
        self.assertEqual(res.status_code, 403)
        detail = res.json()["detail"]
        self.assertEqual(detail["code"], "access_pending")
        self.assertTrue(detail["message"])

    def test_rejected_403_with_code(self):
        res = self.get("tok-rejected")
        self.assertEqual(res.status_code, 403)
        self.assertEqual(res.json()["detail"]["code"], "access_rejected")

    def test_missing_row_is_pending(self):
        res = self.get("tok-missing")
        self.assertEqual(res.status_code, 403)
        self.assertEqual(res.json()["detail"]["code"], "access_pending")

    def test_unknown_status_value_fails_closed(self):
        self.rows["u-approved"]["status"] = "banana"
        self.assertEqual(self.get("tok-approved").status_code, 403)

    def test_no_or_bad_token_is_401_without_db_read(self):
        self.assertEqual(self.get(None).status_code, 401)
        self.assertEqual(self.get("nope").status_code, 401)
        self.assertEqual(self.reads, [])

    def test_db_error_is_503_and_not_cached(self):
        self.fail_db = True
        res = self.get("tok-approved")
        self.assertEqual(res.status_code, 503)
        self.assertIn("Try again", res.json()["detail"])
        self.fail_db = False
        self.assertEqual(self.get("tok-approved").status_code, 200)


class CacheTests(AccessTestCase):
    def test_approved_cached_for_ten_minutes(self):
        with mock.patch.object(auth.time, "time", return_value=1000.0):
            self.get("tok-approved")
            self.get("tok-approved")
        self.assertEqual(self.reads, ["u-approved"])
        with mock.patch.object(auth.time, "time", return_value=1000.0 + 9 * 60):
            self.get("tok-approved")
        self.assertEqual(len(self.reads), 1)
        with mock.patch.object(auth.time, "time", return_value=1000.0 + 10 * 60 + 1):
            self.get("tok-approved")
        self.assertEqual(len(self.reads), 2)

    def test_pending_cached_for_thirty_seconds_then_picks_up_approval(self):
        with mock.patch.object(auth.time, "time", return_value=1000.0):
            self.assertEqual(self.get("tok-pending").status_code, 403)
            self.rows["u-pending"]["status"] = "approved"
            self.assertEqual(self.get("tok-pending").status_code, 403)  # still cached
        self.assertEqual(len(self.reads), 1)
        with mock.patch.object(auth.time, "time", return_value=1031.0):
            self.assertEqual(self.get("tok-pending").status_code, 200)
        self.assertEqual(len(self.reads), 2)

    def test_missing_row_cached_briefly(self):
        with mock.patch.object(auth.time, "time", return_value=1000.0):
            self.get("tok-missing")
            self.get("tok-missing")
        self.assertEqual(self.reads, ["u-missing"])


class MeAccessTests(AccessTestCase):
    def setUp(self):
        super().setUp()
        self.app_client = TestClient(main.app)

    def test_pending_user_gets_status(self):
        res = self.get("tok-pending", "/me/access", self.app_client)
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json(), {"status": "pending", "email": "wait@example.com", "is_owner": False})

    def test_each_status(self):
        for token, expected in (("tok-approved", "approved"), ("tok-rejected", "rejected"), ("tok-missing", "pending")):
            res = self.get(token, "/me/access", self.app_client)
            self.assertEqual(res.status_code, 200)
            self.assertEqual(res.json()["status"], expected)

    def test_requires_sign_in(self):
        self.assertEqual(self.get(None, "/me/access", self.app_client).status_code, 401)
        self.assertEqual(self.get("nope", "/me/access", self.app_client).status_code, 401)

    def test_db_error_is_503(self):
        self.fail_db = True
        self.assertEqual(self.get("tok-pending", "/me/access", self.app_client).status_code, 503)


class EveryRouterIsGatedTests(AccessTestCase):
    """Real app, token check faked: a pending user must be refused everywhere."""

    ROUTES = [
        ("GET", "/songs"), ("POST", "/songs"), ("GET", "/genres"),
        ("GET", "/youtube/search?q=x"), ("GET", "/youtube/stream?id=dQw4w9WgXcQ"), ("GET", "/youtube/radio?id=dQw4w9WgXcQ"),
        ("GET", "/playlists"), ("GET", "/liked"), ("GET", "/history"),
        ("GET", "/search/?q=x"), ("GET", "/admin/users"),
        ("POST", "/events"), ("GET", "/feedback"), ("GET", "/recs/metrics"), ("GET", "/recs/home"),
        ("GET", "/lyrics"), ("GET", "/artwork/color"),
    ]

    def _request(self, client, method, path, token=None):
        headers = {"Authorization": f"Bearer {token}"} if token else {}
        return client.request(method, path, headers=headers, json={} if method == "POST" else None)

    def test_pending_and_rejected_refused(self):
        client = TestClient(main.app)
        for token, code in (("tok-pending", "access_pending"), ("tok-rejected", "access_rejected")):
            for method, path in self.ROUTES:
                res = self._request(client, method, path, token)
                # 422 would mean validation ran before the gate; the gate must come first.
                self.assertEqual(res.status_code, 403, f"{method} {path} -> {res.status_code}")
                self.assertEqual(res.json()["detail"]["code"], code, f"{method} {path}")

    def test_missing_token_refused(self):
        client = TestClient(main.app)
        for method, path in self.ROUTES:
            self.assertEqual(self._request(client, method, path).status_code, 401, f"{method} {path}")

    def test_health_stays_open(self):
        self.assertEqual(TestClient(main.app).get("/health").status_code, 200)


if __name__ == "__main__":
    unittest.main()
