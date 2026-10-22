"""
Tests for routers/events.py. Standard library unittest only; no network, no real DB.

Run from backend/:  venv/Scripts/python -m unittest discover -s tests -p "test_events.py" -v
"""
import os
import sys
import types
import unittest
import uuid
from datetime import datetime, timedelta, timezone
from unittest import mock

# Importing auth/db reads these; the values are never used.
os.environ.setdefault("SUPABASE_URL", "http://localhost")
os.environ.setdefault("SUPABASE_KEY", "dummy")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from auth import get_current_user  # noqa: E402
from routers import events as events_module  # noqa: E402


class Result:
    def __init__(self, data=None, count=None):
        self.data = data
        self.count = count


class FakeQuery:
    def __init__(self, db, name):
        self.db, self.name = db, name
        self.op = "select"
        self.payload = None
        self.on_conflict = None
        self.count_mode = None
        self.filters = []
        self.order_col, self.order_desc = None, False
        self.limit_n = None
        self.range_ = None

    # builders
    def select(self, cols="*", count=None):
        self.op, self.count_mode = "select", count
        return self

    def insert(self, payload):
        self.op, self.payload = "insert", payload
        return self

    def upsert(self, payload, on_conflict=None):
        self.op, self.payload, self.on_conflict = "upsert", payload, on_conflict
        return self

    def delete(self):
        self.op = "delete"
        return self

    def eq(self, col, val):
        self.filters.append(("eq", col, val))
        return self

    def gte(self, col, val):
        self.filters.append(("gte", col, val))
        return self

    def in_(self, col, vals):
        self.filters.append(("in", col, list(vals)))
        return self

    def order(self, col, desc=False):
        self.order_col, self.order_desc = col, desc
        return self

    def limit(self, n):
        self.limit_n = n
        return self

    def range(self, start, end):
        self.range_ = (start, end)
        return self

    # execution
    def _match(self, row):
        for op, col, val in self.filters:
            if op == "eq" and row.get(col) != val:
                return False
            if op == "gte" and not (row.get(col) is not None and row[col] >= val):
                return False
            if op == "in" and row.get(col) not in val:
                return False
        return True

    def execute(self):
        rows = self.db.tables.setdefault(self.name, [])
        self.db.calls.append(self)
        if self.op == "insert":
            batch = self.payload if isinstance(self.payload, list) else [self.payload]
            stored = [{"id": str(uuid.uuid4()), **dict(r)} for r in batch]
            rows.extend(stored)
            return Result(stored)
        if self.op == "upsert":
            keys = self.on_conflict.split(",")
            out = []
            for new in ([self.payload] if isinstance(self.payload, dict) else self.payload):
                existing = next((r for r in rows if all(r.get(k) == new[k] for k in keys)), None)
                if existing:
                    existing.update(new)
                    out.append(existing)
                else:
                    row = {"created_at": "2026-01-01T00:00:00+00:00", **new}
                    rows.append(row)
                    out.append(row)
            return Result(out)
        if self.op == "delete":
            doomed = [r for r in rows if self._match(r)]
            rows[:] = [r for r in rows if r not in doomed]
            return Result(doomed)
        matched = [r for r in rows if self._match(r)]
        if self.order_col:
            matched.sort(key=lambda r: r[self.order_col], reverse=self.order_desc)
        count = len(matched) if self.count_mode else None
        if self.range_:
            matched = matched[self.range_[0]: self.range_[1] + 1]
        if self.limit_n is not None:
            matched = matched[: self.limit_n]
        return Result([dict(r) for r in matched], count)


class FakeDB:
    def __init__(self):
        self.tables = {}
        self.calls = []

    def table(self, name):
        return FakeQuery(self, name)

    def calls_on(self, name, op=None):
        return [c for c in self.calls if c.name == name and (op is None or c.op == op)]


def ev(**overrides):
    base = {"youtube_id": "dQw4w9WgXcQ", "event": "start", "surface": "autoplay"}
    base.update(overrides)
    return base


USER = "user-a"
OTHER = "user-b"


class EventsTestCase(unittest.TestCase):
    def setUp(self):
        self.db = FakeDB()
        patcher = mock.patch.object(events_module, "get_supabase", lambda: self.db)
        patcher.start()
        self.addCleanup(patcher.stop)
        events_module._last_trim.clear()
        self.user = {"user_id": USER}
        app = FastAPI()
        app.include_router(events_module.router)
        app.dependency_overrides[get_current_user] = lambda: self.user
        self.client = TestClient(app)
        # Default: no recs package installed.
        patcher2 = mock.patch.dict(sys.modules, {"recs": None})
        patcher2.start()
        self.addCleanup(patcher2.stop)

    def post(self, *events):
        return self.client.post("/events", json={"events": list(events)})

    def stored(self):
        return self.db.tables.get("listening_events", [])


class ValidationTests(EventsTestCase):
    def test_bad_event_name(self):
        self.assertEqual(self.post(ev(event="explode")).status_code, 422)

    def test_bad_surface(self):
        self.assertEqual(self.post(ev(surface="moon")).status_code, 422)

    def test_too_many_events(self):
        self.assertEqual(self.post(*[ev() for _ in range(51)]).status_code, 422)

    def test_no_events(self):
        self.assertEqual(self.post().status_code, 422)

    def test_bad_youtube_id(self):
        for bad in ("", "has space", "semi;colon", "x" * 33):
            self.assertEqual(self.post(ev(youtube_id=bad)).status_code, 422, bad)

    def test_bad_numbers(self):
        self.assertEqual(self.post(ev(local_hour=24)).status_code, 422)
        self.assertEqual(self.post(ev(listened_sec=-1)).status_code, 422)
        self.assertEqual(self.post(ev(duration_sec=-0.5)).status_code, 422)

    def test_long_context_and_rec_id(self):
        self.assertEqual(self.post(ev(context_id="c" * 129)).status_code, 422)
        self.assertEqual(self.post(ev(rec_id="r" * 129)).status_code, 422)

    def test_nothing_stored_on_rejection(self):
        self.post(ev(), ev(event="nope"))
        self.assertEqual(self.stored(), [])

    def test_exactly_50_ok(self):
        res = self.post(*[ev() for _ in range(50)])
        self.assertEqual(res.status_code, 202)
        self.assertEqual(res.json(), {"accepted": 50})


class RecordTests(EventsTestCase):
    def test_accepted_and_single_bulk_insert(self):
        res = self.post(ev(), ev(event="skip", listened_sec=12, local_hour=23), ev(surface="home"))
        self.assertEqual(res.status_code, 202)
        self.assertEqual(res.json(), {"accepted": 3})
        inserts = self.db.calls_on("listening_events", "insert")
        self.assertEqual(len(inserts), 1)
        self.assertEqual(len(inserts[0].payload), 3)
        self.assertTrue(all(r["user_id"] == USER for r in self.stored()))
        self.assertEqual(self.stored()[1]["listened_sec"], 12)

    def test_surface_defaults_to_other(self):
        self.post({"youtube_id": "abc", "event": "like"})
        self.assertEqual(self.stored()[0]["surface"], "other")

    def test_song_id_uuid_kept_and_garbage_dropped(self):
        good = str(uuid.uuid4())
        self.post(ev(song_id=good), ev(song_id="not-a-uuid"))
        self.assertEqual([r["song_id"] for r in self.stored()], [good, None])

    def test_at_is_clamped(self):
        now = datetime.now(timezone.utc)
        future = (now + timedelta(days=2)).isoformat()
        ancient = (now - timedelta(days=30)).isoformat()
        recent = (now - timedelta(hours=3)).isoformat()
        naive = (now - timedelta(hours=1)).replace(tzinfo=None).isoformat()
        self.post(ev(at=future), ev(at=ancient), ev(at=recent), ev(at=naive), ev())
        times = [datetime.fromisoformat(r["created_at"]) for r in self.stored()]
        after = datetime.now(timezone.utc)
        self.assertLessEqual(times[0], after)
        self.assertGreater(times[0], now - timedelta(seconds=5))
        self.assertAlmostEqual((now - times[1]).total_seconds(), 7 * 86400, delta=5)
        self.assertAlmostEqual((now - times[2]).total_seconds(), 3 * 3600, delta=5)
        self.assertAlmostEqual((now - times[3]).total_seconds(), 3600, delta=5)
        self.assertLessEqual(times[4], after)

    def test_features_attached_from_recs(self):
        fake = types.ModuleType("recs")
        fake.features_for = lambda rec_id, yt: {"consensus": 0.5, "rec": rec_id, "yt": yt} if rec_id == "slate1" else None
        invalidated = []
        fake.invalidate_user = lambda uid, home=True: invalidated.append((uid, home))
        with mock.patch.dict(sys.modules, {"recs": fake}):
            self.post(ev(rec_id="slate1"), ev(rec_id="unknown"), ev())
        rows = self.stored()
        self.assertEqual(rows[0]["features"], {"consensus": 0.5, "rec": "slate1", "yt": "dQw4w9WgXcQ"})
        self.assertIsNone(rows[1]["features"])
        self.assertIsNone(rows[2]["features"])
        self.assertEqual(invalidated, [(USER, False)])  # events refresh the profile, not Home

    def test_works_without_recs_package(self):
        res = self.post(ev(rec_id="slate1"))
        self.assertEqual(res.status_code, 202)
        self.assertIsNone(self.stored()[0]["features"])

    def test_broken_recs_does_not_fail_request(self):
        fake = types.ModuleType("recs")

        def boom(*args):
            raise RuntimeError("nope")

        fake.features_for = boom
        fake.invalidate_user = boom
        with mock.patch.dict(sys.modules, {"recs": fake}):
            res = self.post(ev(rec_id="slate1"))
        self.assertEqual(res.status_code, 202)

    def test_insert_failure_is_500_with_hint(self):
        def fail(self_):
            raise RuntimeError("relation does not exist")

        with mock.patch.object(FakeQuery, "execute", fail):
            res = self.post(ev())
        self.assertEqual(res.status_code, 500)
        self.assertIn("recs_schema.sql", res.json()["detail"])

    def test_trim_keeps_newest_5000_for_this_user_only(self):
        base = datetime(2026, 1, 1, tzinfo=timezone.utc)
        mine = [
            {"id": f"m{i}", "user_id": USER, "created_at": (base + timedelta(seconds=i)).isoformat()}
            for i in range(5003)
        ]
        theirs = [{"id": f"t{i}", "user_id": OTHER, "created_at": base.isoformat()} for i in range(10)]
        self.db.tables["listening_events"] = mine + theirs
        self.post(ev())  # +1 -> 5004 mine; background trim runs after the response
        remaining_mine = [r for r in self.stored() if r["user_id"] == USER]
        self.assertEqual(len(remaining_mine), 5000)
        self.assertNotIn("m0", {r["id"] for r in remaining_mine})
        self.assertEqual(len([r for r in self.stored() if r["user_id"] == OTHER]), 10)
        for call in self.db.calls_on("listening_events"):
            if call.op in ("delete", "select"):
                self.assertIn(("eq", "user_id", USER), call.filters)

    def test_trim_runs_at_most_once_per_interval(self):
        self.post(ev())
        selects = len(self.db.calls_on("listening_events", "select"))
        self.post(ev())
        self.assertEqual(len(self.db.calls_on("listening_events", "select")), selects)
        self.assertEqual(selects, 1)


class FeedbackTests(EventsTestCase):
    def add(self, **body):
        base = {"target_type": "song", "target_id": "abc123", "kind": "hide", "label": "Tum Hi Ho"}
        base.update(body)
        return self.client.post("/feedback", json=base)

    def test_create_returns_row(self):
        res = self.add()
        self.assertEqual(res.status_code, 201)
        body = res.json()
        self.assertEqual(
            {k: body[k] for k in ("target_type", "target_id", "kind", "label")},
            {"target_type": "song", "target_id": "abc123", "kind": "hide", "label": "Tum Hi Ho"},
        )

    def test_upsert_is_idempotent(self):
        self.add()
        self.add(label="Renamed")
        rows = self.db.tables["song_feedback"]
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["label"], "Renamed")
        self.assertEqual(self.db.calls_on("song_feedback", "upsert")[0].on_conflict, "user_id,target_type,target_id")

    def test_validation(self):
        self.assertEqual(self.add(target_type="album").status_code, 422)
        self.assertEqual(self.add(kind="more").status_code, 422)
        self.assertEqual(self.add(target_id="").status_code, 422)
        self.assertEqual(self.add(target_id="x" * 201).status_code, 422)
        self.assertEqual(self.add(label="x" * 201).status_code, 422)

    def test_list_filters_by_user_newest_first(self):
        self.db.tables["song_feedback"] = [
            {"user_id": USER, "target_type": "song", "target_id": "old", "kind": "hide", "label": None, "created_at": "2026-01-01T00:00:00+00:00"},
            {"user_id": USER, "target_type": "channel", "target_id": "T-Series", "kind": "hide", "label": "T-Series", "created_at": "2026-02-01T00:00:00+00:00"},
            {"user_id": OTHER, "target_type": "song", "target_id": "secret", "kind": "hide", "label": None, "created_at": "2026-03-01T00:00:00+00:00"},
        ]
        res = self.client.get("/feedback")
        self.assertEqual(res.status_code, 200)
        self.assertEqual([r["target_id"] for r in res.json()], ["T-Series", "old"])
        self.assertNotIn("user_id", res.json()[0])

    def _seed(self):
        self.db.tables["song_feedback"] = [
            {"user_id": USER, "target_type": "song", "target_id": "a", "kind": "hide"},
            {"user_id": USER, "target_type": "channel", "target_id": "Lo/Fi Co", "kind": "hide"},
            {"user_id": OTHER, "target_type": "song", "target_id": "a", "kind": "hide"},
        ]

    def test_delete_one_scoped_to_user(self):
        self._seed()
        res = self.client.delete("/feedback/song/a")
        self.assertEqual(res.status_code, 204)
        left = [(r["user_id"], r["target_id"]) for r in self.db.tables["song_feedback"]]
        self.assertEqual(sorted(left), [(USER, "Lo/Fi Co"), (OTHER, "a")])

    def test_delete_channel_name_with_slash(self):
        self._seed()
        self.assertEqual(self.client.delete("/feedback/channel/Lo/Fi Co").status_code, 204)
        self.assertEqual(len(self.db.tables["song_feedback"]), 2)

    def test_clear_all_and_by_type_scoped_to_user(self):
        self._seed()
        self.assertEqual(self.client.delete("/feedback", params={"target_type": "channel"}).status_code, 204)
        self.assertEqual(len(self.db.tables["song_feedback"]), 2)
        self.assertEqual(self.client.delete("/feedback").status_code, 204)
        self.assertEqual([r["user_id"] for r in self.db.tables["song_feedback"]], [OTHER])

    def test_bad_target_type_in_path(self):
        self.assertEqual(self.client.delete("/feedback/album/x").status_code, 422)

    def test_feedback_changes_invalidate(self):
        fake = types.ModuleType("recs")
        fake.features_for = lambda *a: None
        calls = []
        fake.invalidate_user = lambda uid, home=True: calls.append((uid, home))
        with mock.patch.dict(sys.modules, {"recs": fake}):
            self.add()
            self.client.delete("/feedback/song/abc123")
            self.client.delete("/feedback")
        self.assertEqual(calls, [(USER, True)] * 3)  # feedback also clears Home


class MetricsTests(EventsTestCase):
    def _event(self, kind, surface, days_ago, listened=None):
        when = datetime.now(timezone.utc) - timedelta(days=days_ago, minutes=1)
        return {"user_id": USER, "event": kind, "surface": surface,
                "listened_sec": listened, "created_at": when.isoformat()}

    def test_math_per_window(self):
        rows = []
        # autoplay in last 7 days: 4 starts, 1 skip at 10 s, 1 skip at 45 s, 2 completes, 1 like
        rows += [self._event("start", "autoplay", 1) for _ in range(4)]
        rows += [self._event("skip", "autoplay", 1, 10), self._event("skip", "autoplay", 1, 45)]
        rows += [self._event("complete", "autoplay", 1) for _ in range(2)]
        rows += [self._event("like", "autoplay", 1)]
        # library in last 7 days: 6 starts, 1 save
        rows += [self._event("start", "library", 2) for _ in range(6)]
        rows += [self._event("save", "library", 2)]
        # 20 days ago (only the 28-day window): 10 home starts, 5 early skips
        rows += [self._event("start", "home", 20) for _ in range(10)]
        rows += [self._event("skip", "home", 20, 5) for _ in range(5)]
        # older than 28 days: ignored
        rows += [self._event("start", "radio", 40)]
        # someone else's events must never count
        rows += [{**self._event("start", "autoplay", 1), "user_id": OTHER} for _ in range(100)]
        self.db.tables["listening_events"] = rows

        res = self.client.get("/recs/metrics")
        self.assertEqual(res.status_code, 200)
        w7, w28 = res.json()["windows"]
        self.assertEqual((w7["days"], w28["days"]), (7, 28))

        self.assertEqual(w7["starts"], 10)
        self.assertEqual(w7["rec_share"], 0.4)
        by7 = {s["surface"]: s for s in w7["surfaces"]}
        self.assertEqual(set(by7), {"autoplay", "library"})
        self.assertEqual(by7["autoplay"]["starts"], 4)
        self.assertEqual(by7["autoplay"]["skip_rate_30s"], 0.25)
        self.assertEqual(by7["autoplay"]["completion_rate"], 0.5)
        self.assertEqual(by7["autoplay"]["saves_per_100"], 25.0)
        self.assertEqual(by7["library"]["saves_per_100"], round(100 / 6, 4))
        self.assertEqual(by7["library"]["skip_rate_30s"], 0.0)

        self.assertEqual(w28["starts"], 20)
        self.assertEqual(w28["rec_share"], 0.7)
        by28 = {s["surface"]: s for s in w28["surfaces"]}
        self.assertEqual(by28["home"]["skip_rate_30s"], 0.5)
        self.assertNotIn("radio", by28)

    def test_no_events(self):
        res = self.client.get("/recs/metrics")
        self.assertEqual(res.status_code, 200)
        for window in res.json()["windows"]:
            self.assertEqual(window["starts"], 0)
            self.assertIsNone(window["rec_share"])
            self.assertEqual(window["surfaces"], [])

    def test_query_is_scoped_and_bounded(self):
        self.client.get("/recs/metrics")
        call = self.db.calls_on("listening_events", "select")[0]
        self.assertIn(("eq", "user_id", USER), call.filters)
        self.assertLessEqual(call.limit_n, 5000)


if __name__ == "__main__":
    unittest.main()
