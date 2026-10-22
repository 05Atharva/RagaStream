"""Owner review of new accounts: only OWNER_EMAILS, never yourself, cache cleared on decision."""
import os
import unittest
from types import SimpleNamespace
from unittest import mock

os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_KEY", "test")

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import auth  # noqa: E402
from routers import me, owner  # noqa: E402

OWNER = "11111111-1111-1111-1111-111111111111"
STRANGER = "22222222-2222-2222-2222-222222222222"
PENDING = "33333333-3333-3333-3333-333333333333"


class Query:
    def __init__(self, db):
        self.db, self.filters, self.op, self.payload = db, [], "select", None

    def select(self, *_a, **_k): return self
    def update(self, payload): self.op, self.payload = "update", payload; return self
    def eq(self, col, val): self.filters.append(("eq", col, val)); return self
    def neq(self, col, val): self.filters.append(("neq", col, val)); return self
    def in_(self, col, vals): self.filters.append(("in", col, vals)); return self
    def order(self, *_a, **_k): return self
    def limit(self, _n): return self

    def _match(self, row):
        for kind, col, val in self.filters:
            if kind == "eq" and row.get(col) != val: return False
            if kind == "neq" and row.get(col) == val: return False
            if kind == "in" and row.get(col) not in val: return False
        return True

    def execute(self):
        hits = [r for r in self.db.rows if self._match(r)]
        if self.op == "update":
            for r in hits:
                r.update(self.payload)
            self.db.updates.append((self.filters, self.payload))
        return SimpleNamespace(data=hits)


class DB:
    def __init__(self):
        self.updates = []
        self.rows = [
            {"user_id": OWNER, "email": "atharvakanawade@gmail.com", "provider": "email", "status": "approved", "requested_at": "2026-10-01", "decided_at": "2026-10-22"},
            {"user_id": STRANGER, "email": "someone@example.com", "provider": "google", "status": "approved", "requested_at": "2026-10-20", "decided_at": "2026-10-21"},
            {"user_id": PENDING, "email": "priya@example.com", "provider": "google", "status": "pending", "requested_at": "2026-10-22", "decided_at": None},
        ]

    def table(self, _name):
        return Query(self)


class OwnerTests(unittest.TestCase):
    def setUp(self):
        self.db = DB()
        app = FastAPI()
        app.include_router(owner.router)
        app.include_router(me.router)
        self.app = app
        self.client = TestClient(app)
        auth.clear_access_cache()
        patches = [
            mock.patch.object(auth, "get_supabase", return_value=self.db),
            mock.patch.object(owner, "get_supabase", return_value=self.db),
            mock.patch.dict(os.environ, {"OWNER_EMAILS": "AtharvaKanawade@gmail.com"}),
        ]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)

    def as_user(self, uid):
        self.app.dependency_overrides[auth.get_signed_in_user] = lambda: {"user_id": uid}

    def test_non_owner_is_refused(self):
        self.as_user(STRANGER)
        r = self.client.get("/owner/requests")
        self.assertEqual(r.status_code, 403)
        self.assertEqual(r.json()["detail"]["code"], "not_owner")
        self.assertEqual(self.client.post(f"/owner/requests/{PENDING}", json={"action": "approve"}).status_code, 403)
        self.assertEqual(self.db.updates, [])

    def test_pending_user_cannot_reach_owner_routes(self):
        self.as_user(PENDING)
        self.assertEqual(self.client.get("/owner/requests").status_code, 403)

    def test_owner_lists_pending_and_recent_without_self(self):
        self.as_user(OWNER)
        body = self.client.get("/owner/requests").json()
        self.assertEqual([p["user_id"] for p in body["pending"]], [PENDING])
        self.assertEqual([r["user_id"] for r in body["recent"]], [STRANGER])

    def test_approve_updates_and_clears_their_cache(self):
        auth._access_cache[PENDING] = ("pending", 9e18)
        self.as_user(OWNER)
        r = self.client.post(f"/owner/requests/{PENDING}", json={"action": "approve"})
        self.assertEqual(r.json(), {"user_id": PENDING, "status": "approved"})
        self.assertEqual(self.db.rows[2]["status"], "approved")
        self.assertNotIn(PENDING, auth._access_cache)

    def test_owner_cannot_change_own_access_or_send_junk(self):
        self.as_user(OWNER)
        self.assertEqual(self.client.post(f"/owner/requests/{OWNER}", json={"action": "reject"}).status_code, 400)
        self.assertEqual(self.client.post("/owner/requests/not-a-uuid", json={"action": "approve"}).status_code, 400)
        self.assertEqual(self.client.post(f"/owner/requests/{PENDING}", json={"action": "delete"}).status_code, 422)
        self.assertEqual(self.client.post("/owner/requests/44444444-4444-4444-4444-444444444444", json={"action": "approve"}).status_code, 404)

    def test_me_access_reports_owner(self):
        self.as_user(OWNER)
        self.assertTrue(self.client.get("/me/access").json()["is_owner"])
        self.as_user(STRANGER)
        self.assertFalse(self.client.get("/me/access").json()["is_owner"])

    def test_no_owner_emails_means_no_owner(self):
        with mock.patch.dict(os.environ, {"OWNER_EMAILS": ""}):
            self.as_user(OWNER)
            self.assertEqual(self.client.get("/owner/requests").status_code, 403)


if __name__ == "__main__":
    unittest.main()
