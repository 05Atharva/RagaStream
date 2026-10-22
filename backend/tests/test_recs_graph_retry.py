"""related_songs reads retry once: concurrent reads share one HTTP/2 connection, which can reset
(seen live as ConnectionTerminated)."""
import unittest
from types import SimpleNamespace
from unittest import mock

from recs.graph import GraphStore


class _Query:
    def __init__(self, outcomes):
        self.outcomes = outcomes

    def __getattr__(self, _name):  # select / in_ / order return the same builder
        return lambda *a, **k: self

    def execute(self):
        outcome = self.outcomes.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        return SimpleNamespace(data=outcome)


ROW = {"seed_id": "S", "youtube_id": "A", "rank": 1, "title": "Song", "channel": "Ch", "duration": 200,
       "fetched_at": "2026-10-22T06:50:15+00:00"}


class GraphRetryTests(unittest.TestCase):
    def run_with(self, outcomes):
        db = SimpleNamespace(table=lambda _name: _Query(outcomes))
        with mock.patch("db.get_supabase", return_value=db):
            return GraphStore._load_sync(["S"])

    def test_one_reset_then_success(self):
        out = self.run_with([ConnectionError("ConnectionTerminated"), [ROW]])
        self.assertEqual([r.youtube_id for r in out["S"][1]], ["A"])

    def test_two_failures_degrade_to_empty(self):
        self.assertEqual(self.run_with([ConnectionError("x"), ConnectionError("y")]), {})


if __name__ == "__main__":
    unittest.main()
