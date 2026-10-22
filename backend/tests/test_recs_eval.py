"""
Tests for the offline evaluator and weight trainer (no network, no DB, no real weights.json).

Run from backend/:  venv/Scripts/python -m unittest discover -s tests -p "test_recs_eval.py" -v
"""
import copy
import json
import math
import os
import random
import tempfile
import unittest
from unittest import mock

import test_recs_fixtures  # noqa: F401  (sets env + sys.path)

from recs import evaluate as ev, train, weights
from recs.fixtures.synthetic import build_world
from recs.profile import RawData, build_profile

_WORLD = build_world()
_PREP = ev.prepare(_WORLD)


def _example(rng, true_w, n_noise=0.0):
    f = {name: rng.uniform(0.0, 1.0) for name in weights.FEATURES}
    f["quality"] = 0.0
    score = sum(true_w.get(k, 0.0) * v for k, v in f.items())
    return f, 1 if rng.random() < 1 / (1 + math.exp(-score)) else 0


def _planted(n, true_w, seed=3):
    rng = random.Random(seed)
    out = []
    for _ in range(n):
        f, y = _example(rng, true_w)
        out.append(train.Example(f, y))
    return out


class SyntheticWorldTests(unittest.TestCase):
    def test_deterministic(self):
        a, b = build_world(seed=11), build_world(seed=11)
        self.assertEqual(a.users["u00"].events, b.users["u00"].events)
        self.assertEqual(a.graphs["s0_00"], b.graphs["s0_00"])
        self.assertNotEqual(build_world(seed=12).users["u00"].events, a.users["u00"].events)

    def test_shape(self):
        self.assertEqual(len(_WORLD.songs), 200)
        self.assertEqual(len(_WORLD.users), 24)
        mix = _WORLD.graphs["s3_05"]
        same = sum(1 for r in mix if _WORLD.cluster_of[r.youtube_id] == 3)
        self.assertGreater(same / len(mix), 0.6)
        self.assertLess(same, len(mix))  # some cross-cluster noise


class NoisyWorldAndSkipTests(unittest.TestCase):
    def test_noisy_world_engine_beats_popularity(self):
        from recs.fixtures.synthetic import build_noisy_world
        # one small noisy world is too variable (few held-out positives): average a few seeds
        res = [ev.evaluate(ev.prepare(build_noisy_world(seed=s, n_users=40)), weights.DEFAULT_WEIGHTS["home"], "home")
               for s in (1, 2, 3, 4)]
        self.assertGreater(sum(r["engine"]["ndcg"] for r in res), sum(r["popularity"]["ndcg"] for r in res))

    def test_mid_skip_counts_a_quarter_of_an_early_skip(self):
        from recs import features
        from recs.profile import Profile
        early = Profile(skips={"a": 1}, song_aff={"a": -1.0})
        mid = Profile(skips={"a": 1}, song_aff={"a": -0.4})
        liked_too = Profile(skips={"a": 1}, song_aff={"a": 1.5})
        self.assertEqual(features.skip_signal(early, "a"), 1.0)
        self.assertLessEqual(features.skip_signal(mid, "a"), 0.26)
        self.assertEqual(features.skip_signal(liked_too, "a"), 0.0)


class MetricTests(unittest.TestCase):
    def test_recall(self):
        self.assertAlmostEqual(ev.recall_at_k(["a", "b", "c"], {"a", "c", "z"}, 3), 2 / 3)
        self.assertEqual(ev.recall_at_k(["a", "b", "c"], {"c"}, 2), 0.0)
        self.assertEqual(ev.recall_at_k(["a"], set(), 5), 0.0)

    def test_ndcg(self):
        got = ev.ndcg_at_k(["x", "a", "y", "c"], {"a", "c"}, 4)
        dcg = 1 / math.log2(3) + 1 / math.log2(5)
        ideal = 1 + 1 / math.log2(3)
        self.assertAlmostEqual(got, dcg / ideal)
        self.assertAlmostEqual(ev.ndcg_at_k(["a", "c", "x"], {"a", "c"}, 3), 1.0)
        self.assertEqual(ev.ndcg_at_k(["x", "y"], {"a"}, 2), 0.0)
        # K cuts the list: the hit at rank 3 does not count at K=2
        self.assertEqual(ev.ndcg_at_k(["x", "y", "a"], {"a"}, 2), 0.0)

    def test_diversity(self):
        self.assertEqual(ev.channel_diversity(["A", "a ", "B", "C"]), 0.75)
        self.assertEqual(ev.channel_diversity([]), 0.0)


class SplitTests(unittest.TestCase):
    def test_train_side_has_nothing_from_the_test_period(self):
        for uid, raw in list(_WORLD.users.items())[:6]:
            split = ev.split_time(raw)
            train_raw = ev.split_raw(raw, split)
            self.assertTrue(train_raw.events)
            self.assertTrue(all(e["created_at"] < split for e in train_raw.events))
            self.assertTrue(all(r["at"] < split for r in train_raw.liked + train_raw.playlist))

    def test_future_events_do_not_change_the_profile(self):
        uid = "u01"
        raw = _WORLD.users[uid]
        split = ev.split_time(raw)
        base = build_profile(ev.split_raw(raw, split), uid, split)

        future = copy.deepcopy(raw)
        last = max(e["created_at"] for e in raw.events)
        song = _WORLD.songs[0]
        for i in range(30):  # a flood of loved songs and a hide, all after the split
            future.events.append({"youtube_id": song["youtube_id"], "event": "like", "created_at": last + 1 + i,
                                  "local_hour": 3})
            future.liked.append({"at": last + 1 + i, "song": song})
        future.feedback.append({"target_type": "song", "target_id": "s1_01", "kind": "hide", "at": last + 5})
        again = build_profile(ev.split_raw(future, split), uid, split)

        self.assertEqual(base.song_aff, again.song_aff)
        self.assertEqual(base.channel_aff, again.channel_aff)
        self.assertEqual(base.liked, again.liked)
        self.assertEqual(base.last_played, again.last_played)
        self.assertEqual(base.hidden_songs, again.hidden_songs)

    def test_positives_are_new_and_in_the_test_period(self):
        for case in _PREP.cases.values():
            self.assertTrue(case.test_pos)
            self.assertFalse(case.test_pos & case.train_pos)
            self.assertTrue(all(e["created_at"] >= case.split for e in case.test_events))


class EngineVsBaselineTests(unittest.TestCase):
    def test_home_beats_popularity_on_ndcg(self):
        res = ev.evaluate(_PREP, weights.DEFAULT_WEIGHTS["home"], "home")
        self.assertGreater(res["users"], 10)
        self.assertGreater(res["engine"]["ndcg"], res["popularity"]["ndcg"])
        self.assertGreater(res["engine"]["recall"], res["popularity"]["recall"])
        self.assertGreater(res["engine"]["coverage"], res["popularity"]["coverage"])

    def test_autoplay_beats_popularity_on_ndcg(self):
        res = ev.evaluate(_PREP, weights.DEFAULT_WEIGHTS["autoplay"], "autoplay")
        self.assertGreater(res["engine"]["ndcg"], res["popularity"]["ndcg"])

    def test_lists_exclude_what_the_user_already_loved(self):
        w = weights.DEFAULT_WEIGHTS["home"]
        for uid in list(_PREP.cases)[:5]:
            case = _PREP.cases[uid]
            for lst in (ev.engine_list(_PREP, uid, "home", w, 10), ev.mix_list(_PREP, uid, "home", 10),
                        ev.popularity_list(_PREP, uid, 10)):
                self.assertFalse(set(lst) & case.train_pos)
                self.assertEqual(len(lst), len(set(lst)))


class TrainerTests(unittest.TestCase):
    def test_label_rules(self):
        self.assertEqual(train.label_event("complete", 200, 200), (1, 1.0))
        self.assertEqual(train.label_event("queue", None, None), (1, 1.0))
        self.assertEqual(train.label_event("skip", 12, 200), (0, 1.0))
        self.assertEqual(train.label_event("skip", 60, 200), (0, 0.4))
        self.assertIsNone(train.label_event("skip", 180, 200))
        self.assertIsNone(train.label_event("start", 0, 200))

    def test_recovers_planted_signs(self):
        true_w = {"song_aff": 2.0, "skip_penalty": -2.0, "seed_sim": 1.0}
        coef = train.fit(_planted(1500, true_w))
        self.assertGreater(coef["song_aff"], 0.5)
        self.assertLess(coef["skip_penalty"], -0.5)
        self.assertGreater(coef["seed_sim"], 0.0)
        self.assertLess(abs(coef["hour_fit"]), abs(coef["song_aff"]))  # irrelevant features stay small

    def test_sign_guards_and_fixed_quality(self):
        examples = _planted(800, {"skip_penalty": 2.0, "fatigue": 2.0, "novelty": 1.0})  # planted the wrong way
        default = weights.DEFAULT_WEIGHTS["home"]
        new = train.to_weights(train.fit(examples), examples, default)
        self.assertLessEqual(new["skip_penalty"], 0.0)
        self.assertLessEqual(new["fatigue"], 0.0)
        self.assertEqual(new["quality"], default["quality"])
        self.assertGreater(new["novelty"], 0.0)

    def test_gate_needs_300_examples(self):
        few = _planted(299, {"song_aff": 2.0})
        rep = train.train_surface("home", few, _PREP, weights.DEFAULT_WEIGHTS["home"])
        self.assertEqual(rep["status"], "refused")
        self.assertIn("300", rep["reason"])
        enough = _planted(300, {"song_aff": 2.0})
        rep = train.train_surface("home", enough, _PREP, weights.DEFAULT_WEIGHTS["home"])
        self.assertNotEqual(rep["status"], "refused")

    def _run(self, ndcg_old, ndcg_new, write=True):
        examples = _planted(400, {"song_aff": 2.0, "skip_penalty": -2.0})
        results = iter([{"engine": {"ndcg": ndcg_old}}, {"engine": {"ndcg": ndcg_new}}])
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "weights.json")
            with mock.patch.object(ev, "evaluate", side_effect=lambda *a, **k: next(results)):
                rep = train.train_surface("home", examples, _PREP, weights.DEFAULT_WEIGHTS["home"],
                                          write=write, path=path)
            exists = os.path.exists(path)
            loaded = weights.load_weights(path) if exists else None
        return rep, exists, loaded

    def test_write_refused_when_ndcg_does_not_improve(self):
        rep, exists, _ = self._run(0.30, 0.30)
        self.assertEqual(rep["status"], "not_improved")
        self.assertFalse(exists)
        rep, exists, _ = self._run(0.30, 0.25)
        self.assertFalse(exists)

    def test_write_happens_only_with_flag_and_improvement(self):
        rep, exists, loaded = self._run(0.30, 0.40)
        self.assertEqual(rep["status"], "written")
        self.assertTrue(exists)
        self.assertEqual(loaded["home"], rep["new"])  # weights.load_weights accepts the file
        self.assertEqual(loaded["autoplay"], weights.DEFAULT_WEIGHTS["autoplay"])
        rep, exists, _ = self._run(0.30, 0.40, write=False)
        self.assertEqual(rep["status"], "improved")
        self.assertFalse(exists)

    def test_write_merges_surfaces(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "weights.json")
            train.write_weights(path, "home", weights.DEFAULT_WEIGHTS["home"])
            train.write_weights(path, "radio", weights.DEFAULT_WEIGHTS["radio"])
            with open(path, encoding="utf-8") as fh:
                self.assertEqual(set(json.load(fh)), {"home", "radio"})
            with self.assertRaises(ValueError):
                train.write_weights(path, "home", {"consensus": 1.0})

    def test_cli_end_to_end_leaves_real_weights_alone(self):
        before = os.path.exists(weights.WEIGHTS_PATH)
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "weights.json")
            with mock.patch("builtins.print"):
                code = train.main(["--surface", "home", "--write", "--path", path])
            self.assertEqual(code, 0)
            if os.path.exists(path):  # written only because NDCG improved; must be loadable
                self.assertEqual(set(weights.load_weights(path)["home"]), set(weights.FEATURES))
        self.assertEqual(os.path.exists(weights.WEIGHTS_PATH), before)

    def test_replayed_examples_are_labelled_and_featurised(self):
        examples = train.replay_examples(_PREP, "home")
        self.assertGreaterEqual(len(examples), train.MIN_EXAMPLES)
        self.assertTrue(all(set(e.features) == set(weights.FEATURES) for e in examples))
        self.assertTrue(any(e.label == 1 for e in examples) and any(e.label == 0 for e in examples))


class EvaluateCliTests(unittest.TestCase):
    def test_json_output_and_exit_code(self):
        out = []
        with mock.patch("builtins.print", side_effect=lambda *a, **k: out.append(" ".join(map(str, a)))):
            code = ev.main(["--json", "--surface", "home"])
        self.assertEqual(code, 0)
        data = json.loads(out[0])
        self.assertEqual(set(data["results"]["home"]), {"surface", "k", "users", "engine", "popularity", "mix"})


if __name__ == "__main__":
    unittest.main()
