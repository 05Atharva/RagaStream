"""
Unit tests for the pure parts of the recs engine and the graph/candidate plumbing, with fakes.

Run from backend/:  venv/Scripts/python -m unittest discover -s tests -p "test_recs_*.py" -v
"""
import asyncio
import json
import math
import os
import tempfile
import time
import unittest

from test_recs_fixtures import DAY, NOW, FakeCatalogue, FakeStore, World, build, event, mix, rel, song_row

from recs import candidates, features, graph, ranker, reasons, rerank, text, weights
from recs.candidates import Candidate, Plan
from recs.profile import RawData, event_weight
from recs.ranker import Scored


def run(coro):
    return asyncio.run(coro)


def cand(yt, channel="Chan", title=None, dur=200, **kw):
    return Candidate(yt, title or f"Song {yt}", channel, dur, **kw)


def scored(c, score=0.0, **feats):
    base = {n: 0.0 for n in weights.FEATURES}
    base.update(feats)
    return Scored(c, base, score)


# ---------------------------------------------------------------------------
class TextTests(unittest.TestCase):
    def test_clean_title_strips_junk(self):
        cases = {
            "Tum Hi Ho (Official Video) | T-Series": "Tum Hi Ho",
            "Kun Faya Kun [Lyrical Video] ft. Mohit Chauhan": "Kun Faya Kun",
            "Raataan Lambiyan - Official Audio 4K": "Raataan Lambiyan",
            "Ve Kamleya | Rocky Aur Rani | Pritam": "Ve Kamleya",
            "Channa Mereya (Full Song) HD": "Channa Mereya",
        }
        for raw, want in cases.items():
            self.assertEqual(text.clean_title(raw), want, raw)

    def test_clean_title_never_returns_empty(self):
        self.assertEqual(text.clean_title("(Lyrics)"), "(Lyrics)")
        self.assertEqual(text.clean_title(""), "")

    def test_variants(self):
        self.assertEqual(text.variants("Apna Bana Le (Slowed + Reverb)"), {"slowed", "reverb"})
        self.assertEqual(text.variants("Tum Hi Ho Lo-Fi"), {"lofi"})
        self.assertEqual(text.variants("Kesariya Remix"), {"remix"})
        self.assertEqual(text.variants("Tum Hi Ho"), frozenset())
        self.assertIn("live", text.variants("Arijit Singh Live in Concert"))
        self.assertIn("unplugged", text.variants("MTV Unplugged"))
        self.assertIn("cover", text.variants("Tum Hi Ho (Cover)"))

    def test_non_music(self):
        for t in ["Arijit Singh Interview", "Pathaan trailer", "Song reaction", "Love Status 30 sec",
                  "Funny #shorts", "Nokia ringtone", "Music podcast ep 4", "Movie review"]:
            self.assertTrue(text.is_non_music(t), t)
        for t in ["Tum Hi Ho", "Kun Faya Kun", "Raataan Lambiyan (Official Video)"]:
            self.assertFalse(text.is_non_music(t), t)

    def test_title_key_matches_reuploads_not_variants(self):
        a = text.title_key("Tum Hi Ho (Official Video)", "T-Series")
        b = text.title_key("Tum Hi Ho [Lyrics] | T-Series", "T-Series")
        c = text.title_key("Tum Hi Ho (Slowed + Reverb)", "T-Series")
        d = text.title_key("Tum Hi Ho", "Sony Music")
        self.assertEqual(a, b)
        self.assertNotEqual(a, c)
        self.assertNotEqual(a, d)

    def test_short_title(self):
        self.assertEqual(text.short_title("Tum Hi Ho (Official Video)"), "Tum Hi Ho")
        long = text.short_title("A" * 10 + " " + "B" * 60)
        self.assertLessEqual(len(long), 36)
        self.assertTrue(long.endswith("…"))


# ---------------------------------------------------------------------------
class ProfileTests(unittest.TestCase):
    def raw(self, events, liked=(), playlist=(), feedback=(), songs=()):
        return RawData(events=list(events), liked=[{"at": a, "song": s} for a, s in liked],
                       playlist=[{"at": a, "song": s} for a, s in playlist],
                       feedback=list(feedback), songs=list(songs))

    def test_event_weight_table(self):
        self.assertEqual(event_weight("complete"), 1.0)
        self.assertEqual(event_weight("like"), 3.0)
        self.assertEqual(event_weight("unlike"), -2.0)
        self.assertEqual(event_weight("save"), 2.5)
        self.assertEqual(event_weight("queue"), 1.5)
        self.assertEqual(event_weight("start"), 0.0)
        self.assertEqual(event_weight("skip", 10, 200), -1.0)
        self.assertEqual(event_weight("skip", 60, 200), -0.4)      # 30 s .. 50 %
        self.assertEqual(event_weight("skip", 130, 200), 0.0)      # 50 .. 80 %: ignored

    def test_half_life_30_days(self):
        p = build(self.raw([event("a", "complete", ago_s=30 * DAY), event("b", "complete", ago_s=0)],
                           songs=[song_row("a"), song_row("b")]))
        self.assertAlmostEqual(p.song_aff["a"], 0.5, places=3)
        self.assertAlmostEqual(p.song_aff["b"], 1.0, places=3)

    def test_skips_and_channel_affinity(self):
        p = build(self.raw([event("a", "skip", listened_sec=5, duration_sec=200),
                            event("a", "skip", listened_sec=8, duration_sec=200)],
                           songs=[song_row("a", channel="X")]))
        self.assertEqual(p.skips["a"], 2)
        self.assertLess(p.song_aff["a"], 0)
        self.assertLess(p.channel_aff[text.channel_key("X")], 0)

    def test_liked_and_playlist_are_standing_affinity(self):
        p = build(self.raw([], liked=[(NOW, song_row("l"))], playlist=[(NOW - 30 * DAY, song_row("p"))]))
        self.assertAlmostEqual(p.song_aff["l"], 2.0, places=3)
        self.assertAlmostEqual(p.song_aff["p"], 0.75, places=3)       # 1.5 decayed one half-life
        self.assertEqual(p.liked, {"l"})
        self.assertEqual(p.playlist, {"p"})
        self.assertTrue(p.has_signal)

    def test_session_is_last_45_minutes(self):
        p = build(self.raw([event("a", "complete", ago_s=10 * 60), event("b", "complete", ago_s=50 * 60),
                            event("c", "skip", ago_s=60, listened_sec=3, duration_sec=200)],
                           songs=[song_row("a", channel="A"), song_row("b", channel="B"), song_row("c", channel="C")]))
        self.assertEqual([s.youtube_id for s in p.session], ["c", "a"])
        self.assertEqual(p.session_completed, ["a"])
        self.assertGreater(p.session_channels[text.channel_key("A")], 0)
        self.assertLess(p.session_channels[text.channel_key("C")], 0)
        self.assertNotIn(text.channel_key("B"), p.session_channels)

    def test_hidden_hours_variants_long(self):
        p = build(self.raw(
            [event("a", "complete", local_hour=23, duration_sec=1500),
             event("s", "complete", local_hour=23)],
            feedback=[{"target_type": "song", "target_id": "x", "kind": "hide"},
                      {"target_type": "channel", "target_id": "Bad Chan", "kind": "hide"}],
            songs=[song_row("a", channel="A"), song_row("s", title="Song (Slowed)", channel="A")]))
        self.assertEqual(p.hidden_songs, {"x"})
        self.assertEqual(p.hidden_channels, {text.channel_key("Bad Chan")})
        self.assertEqual(p.hour_hist[text.channel_key("A")][23], 2.0)
        self.assertIn("slowed", p.variant_taste)
        self.assertTrue(p.long_ok)
        self.assertEqual(p.recent_hour, 23)

    def test_cold_profile(self):
        p = build(RawData())
        self.assertFalse(p.has_signal)
        self.assertEqual(p.top_songs(5), [])
        self.assertEqual(p.rediscover_pool(), [])

    def test_rediscover_pool(self):
        p = build(self.raw([event("old", "complete", ago_s=60 * DAY), event("new", "complete", ago_s=DAY)],
                           liked=[(NOW - 90 * DAY, song_row("old")), (NOW - 90 * DAY, song_row("new"))]))
        self.assertEqual([y for y, _ in p.rediscover_pool(30)], ["old"])


# ---------------------------------------------------------------------------
class FeatureTests(unittest.TestCase):
    def test_all_features_bounded_and_complete(self):
        p = build(ProfileTests().raw([event("a", "complete", local_hour=9)], songs=[song_row("a", channel="C")]))
        c = cand("a", "C", best_rank=3, link_weight=2.0, direct=True, seed_sim=0.7, seeds={"s": 3})
        f = features.compute_features(c, p, hour=9)
        self.assertEqual(set(f), set(weights.FEATURES))
        for name, v in f.items():
            self.assertTrue(-1.0 <= v <= 1.0, (name, v))

    def test_consensus_and_rank(self):
        one = cand("a", link_weight=1.0, best_rank=1, direct=True)
        many = cand("b", link_weight=4.0, best_rank=1, direct=True)
        self.assertGreater(features.consensus(many), features.consensus(one))
        self.assertAlmostEqual(features.mix_rank(one), 1.0)
        self.assertAlmostEqual(features.mix_rank(cand("c", best_rank=4, direct=True)), 0.5)
        self.assertAlmostEqual(features.mix_rank(cand("d", best_rank=4, direct=False)), 0.25)

    def test_fatigue_and_novelty(self):
        p = build(ProfileTests().raw([event("day", "complete", ago_s=3600), event("three", "complete", ago_s=2 * DAY),
                                      event("old", "complete", ago_s=20 * DAY)],
                                     songs=[song_row("day"), song_row("three"), song_row("old")]))
        f = lambda y: features.compute_features(cand(y), p)
        self.assertEqual(f("day")["fatigue"], 1.0)
        self.assertEqual(f("three")["fatigue"], 0.5)
        self.assertEqual(f("old")["fatigue"], 0.0)
        self.assertEqual(f("old")["novelty"], 0.0)
        self.assertEqual(f("never")["novelty"], 1.0)

    def test_skip_penalty_from_song_and_channel(self):
        p = build(ProfileTests().raw([event("a", "skip", listened_sec=2, duration_sec=200)] * 2,
                                     songs=[song_row("a", channel="Bad")]))
        self.assertEqual(features.compute_features(cand("a", "Bad"), p)["skip_penalty"], 1.0)
        self.assertGreater(features.compute_features(cand("z", "Bad"), p)["skip_penalty"], 0.0)
        self.assertEqual(features.compute_features(cand("z", "Good"), p)["skip_penalty"], 0.0)

    def test_hour_fit(self):
        events = [event("a", "complete", local_hour=23) for _ in range(6)]
        p = build(ProfileTests().raw(events, songs=[song_row("a", channel="Night")]))
        self.assertGreater(features.hour_fit(p, "Night", 23), 0.5)
        self.assertLessEqual(features.hour_fit(p, "Night", 12), 0.0)
        self.assertEqual(features.hour_fit(p, "Other", 23), 0.0)
        self.assertEqual(features.hour_fit(p, "Night", None), 0.0)

    def test_variant_fit(self):
        events = [event("a", "complete") for _ in range(6)] + [event("b", "complete")] * 3
        p = build(ProfileTests().raw(events, songs=[song_row("a", title="Plain"), song_row("b", title="B (Slowed)")]))
        self.assertGreater(features.variant_fit(p, "X (Slowed)"), 0.0)
        self.assertLess(features.variant_fit(p, "X (Remix)"), 0.0)    # plays plain songs, never remixes
        self.assertEqual(features.variant_fit(p, "X"), 0.0)

    def test_quality(self):
        self.assertEqual(features.quality("Tum Hi Ho", 200), 0.0)
        self.assertEqual(features.quality("Song trailer", 200), -1.0)
        self.assertLess(features.quality("Best of 2020 jukebox", 300), 0.0)
        self.assertLess(features.quality("Long thing", 1000), 0.0)

    def test_session_steer(self):
        p = build(ProfileTests().raw([event("a", "skip", ago_s=30, listened_sec=2, duration_sec=200)],
                                     songs=[song_row("a", channel="Skipped")]))
        self.assertLess(features.compute_features(cand("z", "Skipped"), p)["session_steer"], 0)


# ---------------------------------------------------------------------------
class WeightsAndRankerTests(unittest.TestCase):
    def test_default_table_matches_contract(self):
        w = weights.DEFAULT_WEIGHTS
        self.assertEqual(w["autoplay"]["seed_sim"], 1.2)
        self.assertEqual(w["radio"]["mix_rank"], 1.2)
        self.assertEqual(w["smart_shuffle"]["consensus"], 1.2)
        self.assertEqual(w["playlist"]["consensus"], 1.4)
        self.assertEqual(w["home"]["song_aff"], 1.0)
        self.assertEqual(w["autoplay"]["skip_penalty"], -1.5)
        self.assertEqual(weights.exploration_share("playlist_recs"), 0.25)
        self.assertEqual(weights.exploration_share("radio"), 0.20)
        self.assertEqual(weights.key_for("playlist_recs"), "playlist")
        for surface in weights.SURFACES:
            self.assertEqual(set(w[surface]), set(weights.FEATURES))

    def test_load_valid_file_and_fallback(self):
        custom = {n: 0.1 for n in weights.FEATURES}
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "weights.json")
            with open(path, "w") as fh:
                json.dump({"radio": custom, "home": {"consensus": 1.0}, "autoplay": {**custom, "x": 1}}, fh)
            got = weights.load_weights(path)
            self.assertEqual(got["radio"], custom)                                     # valid: used
            self.assertEqual(got["home"], weights.DEFAULT_WEIGHTS["home"])             # incomplete: default
            self.assertEqual(got["autoplay"], weights.DEFAULT_WEIGHTS["autoplay"])     # unknown key: default
            self.assertEqual(got["playlist"], weights.DEFAULT_WEIGHTS["playlist"])     # absent: default

    def test_bad_files_fall_back(self):
        with tempfile.TemporaryDirectory() as d:
            self.assertEqual(weights.load_weights(os.path.join(d, "missing.json")), weights.DEFAULT_WEIGHTS)
            for body in ("not json", "[1,2]", json.dumps({"radio": {**{n: 1 for n in weights.FEATURES}, "quality": "x"}}),
                         json.dumps({"radio": {**{n: 1 for n in weights.FEATURES}, "quality": float("nan")}})):
                path = os.path.join(d, "w.json")
                with open(path, "w") as fh:
                    fh.write(body)
                self.assertEqual(weights.load_weights(path)["radio"], weights.DEFAULT_WEIGHTS["radio"], body)

    def test_get_weights_reloads_on_change(self):
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "weights.json")
            self.assertEqual(weights.get_weights("radio", path), weights.DEFAULT_WEIGHTS["radio"])
            with open(path, "w") as fh:
                json.dump({"radio": {n: 2.0 for n in weights.FEATURES}}, fh)
            os.utime(path, (time.time() + 5, time.time() + 5))
            self.assertEqual(weights.get_weights("radio", path)["consensus"], 2.0)
            os.remove(path)
            self.assertEqual(weights.get_weights("radio", path), weights.DEFAULT_WEIGHTS["radio"])

    def test_score_is_weighted_sum(self):
        f = {n: 0.0 for n in weights.FEATURES}
        f.update(consensus=1.0, skip_penalty=1.0)
        w = weights.DEFAULT_WEIGHTS["autoplay"]
        self.assertAlmostEqual(ranker.score(f, w), 1.0 - 1.5)

    def test_score_candidates_sorts_and_uses_custom_weights(self):
        p = build(RawData())
        good = cand("g", best_rank=1, link_weight=1.0, direct=True, seed_sim=1.0, seeds={"s": 1})
        bad = cand("b", best_rank=30, link_weight=0.35, direct=False, seeds={"s": 30})
        out = ranker.score_candidates([bad, good], p, "radio")
        self.assertEqual([s.cand.youtube_id for s in out], ["g", "b"])
        flat = {n: 0.0 for n in weights.FEATURES}
        out = ranker.score_candidates([bad, good], p, "radio", weights=flat)
        self.assertEqual([s.score for s in out], [0.0, 0.0])


# ---------------------------------------------------------------------------
class RerankTests(unittest.TestCase):
    def setUp(self):
        self.p = build(ProfileTests().raw([event("seen", "complete")], songs=[song_row("seen")]))

    def items(self, n, channels=None, novelty=1.0):
        channels = channels or [f"C{i}" for i in range(n)]
        return [scored(cand(f"s{i}", channels[i % len(channels)]), score=n - i, novelty=novelty) for i in range(n)]

    def ids(self, picks):
        return [x.scored.cand.youtube_id for x in picks]

    def test_hard_filters(self):
        p = build(ProfileTests().raw(
            [event("x", "complete", duration_sec=100)],
            feedback=[{"target_type": "song", "target_id": "hid", "kind": "hide"},
                      {"target_type": "channel", "target_id": "Banned", "kind": "hide"}],
            songs=[song_row("x")]))
        items = [scored(cand("hid", "A")), scored(cand("b1", "Banned")), scored(cand("short", "B", dur=30)),
                 scored(cand("long", "C", dur=3000)), scored(cand("ex", "D")), scored(cand("seed", "E")),
                 scored(cand("ok", "F"))]
        got = self.ids(rerank.rerank(items, p, limit=10, exclude={"ex", "seed"}))
        self.assertEqual(got, ["ok"])

    def test_long_tracks_allowed_for_listeners_of_long_tracks(self):
        p = build(ProfileTests().raw([event("x", "complete", duration_sec=3000)], songs=[song_row("x")]))
        got = self.ids(rerank.rerank([scored(cand("long", "C", dur=3000)), scored(cand("huge", "C", dur=0))], p, limit=5))
        self.assertIn("long", got)

    def test_unknown_duration_is_kept(self):
        got = self.ids(rerank.rerank([scored(cand("u", "C", dur=0))], self.p, limit=5))
        self.assertEqual(got, ["u"])

    def test_duplicate_versions_removed(self):
        items = [scored(cand("a", "T", title="Tum Hi Ho (Official Video)")),
                 scored(cand("b", "T", title="Tum Hi Ho [Lyrics]")),
                 scored(cand("c", "T", title="Tum Hi Ho (Slowed)"))]
        self.assertEqual(self.ids(rerank.rerank(items, self.p, limit=5)), ["a", "c"])

    def test_channel_spacing(self):
        chans = ["A", "A", "A", "B", "B", "C", "D", "E"]
        items = [scored(cand(f"s{i}", c), score=10 - i) for i, c in enumerate(chans)]
        out = rerank.rerank(items, self.p, limit=8)
        seq = [x.scored.cand.channel for x in out]
        for i in range(len(seq) - 2):
            self.assertEqual(len(set(seq[i:i + 3])), len(seq[i:i + 3]) if len(set(seq)) >= 3 else 1, seq)

    def test_spacing_relaxes_when_only_one_channel(self):
        items = [scored(cand(f"s{i}", "Only"), score=5 - i) for i in range(5)]
        self.assertEqual(self.ids(rerank.rerank(items, self.p, limit=5)), [f"s{i}" for i in range(5)])

    def test_row_cap(self):
        items = [scored(cand(f"s{i}", "Same" if i < 6 else f"O{i}"), score=20 - i) for i in range(10)]
        out = rerank.rerank(items, self.p, limit=10, row_cap=2)
        self.assertEqual(sum(1 for x in out if x.scored.cand.channel == "Same"), 2)

    def test_exploration_is_reproducible_and_novel(self):
        p = build(ProfileTests().raw([event("seen", "complete")], songs=[song_row("seen")]))
        items = self.items(40)
        a = rerank.rerank(items, p, limit=10, exploration=0.2, rng_seed="abc")
        b = rerank.rerank(items, p, limit=10, exploration=0.2, rng_seed="abc")
        c = rerank.rerank(items, p, limit=10, exploration=0.2, rng_seed="zzz")
        self.assertEqual(self.ids(a), self.ids(b))
        self.assertEqual(sum(x.explored for x in a), 2)
        self.assertEqual(len(a), 10)
        self.assertNotEqual(self.ids(a), self.ids(c))
        pool_ids = {f"s{i}" for i in range(30)}                  # top 3x by score
        for x in a:
            self.assertIn(x.scored.cand.youtube_id, pool_ids)

    def test_exploration_only_picks_novel(self):
        items = self.items(40, novelty=0.0)
        out = rerank.rerank(items, self.p, limit=10, exploration=0.3, rng_seed="k")
        self.assertEqual(sum(x.explored for x in out), 0)
        self.assertEqual(self.ids(out), [f"s{i}" for i in range(10)])

    def test_cold_start_keeps_order(self):
        cold = build(RawData())
        items = self.items(40)
        out = rerank.rerank(items, cold, limit=10, exploration=0.5, rng_seed="k")
        self.assertEqual(self.ids(out), [f"s{i}" for i in range(10)])


# ---------------------------------------------------------------------------
class ReasonTests(unittest.TestCase):
    def setUp(self):
        self.p = build(ProfileTests().raw([event("old", "complete", ago_s=21 * DAY)], songs=[song_row("old")]))

    def test_seed_reason(self):
        c = cand("c", seeds={"s": 1}, seed_source={"s": "seed"}, sources={"seed"})
        self.assertEqual(reasons.reason_for(c, {}, self.p, {"s": "Kun Faya Kun (Official Video)"}),
                         ("Because you played Kun Faya Kun", "seed"))

    def test_taste_count_reason(self):
        c = cand("c", seeds={"a": 1, "b": 2}, seed_source={"a": "taste", "b": "taste"}, sources={"taste"})
        self.assertEqual(reasons.reason_for(c, {}, self.p, {}), ("Fits 2 songs you love", "taste"))

    def test_rediscover_weeks(self):
        c = cand("old", sources={"rediscover"})
        text_, code = reasons.reason_for(c, {}, self.p, {})
        self.assertEqual(code, "rediscover")
        self.assertEqual(text_, "Back on rotation: last played 3 weeks ago")

    def test_explored_channel_and_hour(self):
        c = cand("c", "Arijit", sources={"channel"})
        self.assertEqual(reasons.reason_for(c, {}, self.p, {}, explored=True), ("New to you", "discover"))
        self.assertEqual(reasons.reason_for(c, {}, self.p, {}), ("You often play Arijit", "channel"))
        c2 = cand("d", sources={"catalogue"})
        self.assertEqual(reasons.reason_for(c2, {"hour_fit": 0.8}, self.p, {}, hour=23),
                         ("Your late-night pick", "taste"))
        self.assertEqual(reasons.reason_for(c2, {"novelty": 1.0}, self.p, {}), ("New to you", "catalogue"))

    def test_hour_labels(self):
        self.assertEqual([reasons.hour_label(h) for h in (2, 8, 14, 19, 23)],
                         ["late-night", "morning", "afternoon", "evening", "late-night"])


# ---------------------------------------------------------------------------
class GraphTests(unittest.TestCase):
    def test_fresh_db_rows_need_no_fetch(self):
        store = FakeStore(stored={"A": mix("A", ["b", "c"])})
        with World(store):
            got = run(graph.get_related("A"))
        self.assertEqual([r.youtube_id for r in got], ["b", "c"])
        self.assertEqual(store.fetches, [])

    def test_fetch_when_absent_and_persist(self):
        store = FakeStore(live={"A": mix("A", ["b", "c"])})
        with World(store):
            got = run(graph.get_related("A"))
            again = run(graph.get_related("A"))
        self.assertEqual(len(got), 2)
        self.assertEqual(again, got)
        self.assertEqual(store.fetches, ["A"])                  # second call served from memory
        self.assertEqual(store.saved["A"], got)

    def test_stale_rows_refetched_and_kept_on_failure(self):
        store = FakeStore(stored={"A": mix("A", ["old"])}, fail={"A"})
        store.stored["A"] = (time.time() - 8 * DAY, store.stored["A"][1])
        with World(store):
            got = run(graph.get_related("A"))
        self.assertEqual(store.fetches, ["A"])
        self.assertEqual([r.youtube_id for r in got], ["old"])  # stale beats nothing

    def test_failure_with_nothing_stored_is_empty(self):
        store = FakeStore(fail={"A"})
        with World(store):
            self.assertEqual(run(graph.get_related("A")), [])

    def test_live_cap_and_concurrency(self):
        ids = [f"S{i}" for i in range(8)]
        store = FakeStore(live={s: mix(s, ["x", "y"]) for s in ids})
        store.delay = 0.02
        with World(store):
            out = run(graph.related_many(ids, max_live=5))
            self.assertEqual(len(store.fetches), 5)             # cap on live fetches per request
            self.assertEqual(sum(1 for s in ids if out[s]), 5)
            self.assertLessEqual(store.peak, graph.MAX_CONCURRENT_FETCHES)

    def test_timeout_returns_stale_but_fetch_finishes(self):
        store = FakeStore(live={"A": mix("A", ["b"])})
        store.delay = 0.15

        async def go():
            first = await graph.related_many(["A"], max_live=1, timeout=0.02)
            await asyncio.sleep(0.3)
            return first, await graph.related_many(["A"], max_live=0)

        with World(store):
            first, later = run(go())
        self.assertEqual(first["A"], [])
        self.assertEqual([r.youtube_id for r in later["A"]], ["b"])

    def test_concurrent_requests_share_one_fetch(self):
        store = FakeStore(live={"A": mix("A", ["b"])})
        store.delay = 0.03

        async def go():
            return await asyncio.gather(*(graph.get_related("A") for _ in range(4)))

        with World(store):
            run(go())
        self.assertEqual(store.fetches, ["A"])

    def test_similarity(self):
        a = {"x", "y", "z"}
        b = {"y", "z", "w"}
        self.assertAlmostEqual(graph.similarity_sets("A", a, "B", b), 0.5)
        self.assertAlmostEqual(graph.similarity_sets("A", a | {"B"}, "B", b), len(a & b) / len((a | {"B"}) | b) + 1)
        store = FakeStore(stored={"A": mix("A", ["x", "B"]), "B": mix("B", ["x"])})
        with World(store):
            self.assertGreater(run(graph.similarity("A", "B")), 1.0)

    def test_neighbours_depth(self):
        store = FakeStore(stored={"A": mix("A", ["b"]), "b": mix("b", ["c", "A"])})
        with World(store):
            one = run(graph.neighbours(["A"], 1))
            two = run(graph.neighbours(["A"], 2))
        self.assertEqual(one["A"], {"b"})
        self.assertEqual(two["A"], {"b", "c"})


# ---------------------------------------------------------------------------
class CandidateTests(unittest.TestCase):
    def plan(self, **kw):
        return Plan(**kw)

    def test_sources_seeds_and_consensus(self):
        graphs = {"A": mix("A", ["x", "y", "z"]), "B": mix("B", ["y", "z", "w"])}
        p = build(RawData())
        cs = candidates.assemble(self.plan(seed=["A"], taste=["B"], walk=False), graphs, None, p)
        self.assertEqual(set(cs.by_id), {"x", "y", "z", "w"})
        y = cs.by_id["y"]
        self.assertEqual(y.sources, {"seed", "taste"})
        self.assertEqual(set(y.seeds), {"A", "B"})
        self.assertEqual(y.seed_source, {"A": "seed", "B": "taste"})
        self.assertGreater(y.link_weight, cs.by_id["x"].link_weight)
        self.assertEqual(cs.by_id["w"].sources, {"taste"})
        self.assertTrue(y.direct)

    def test_walk_is_discounted(self):
        graphs = {"A": mix("A", ["b", "c"])}
        walk = {"b": mix("b", ["deep", "c"])}
        cs = candidates.assemble(self.plan(seed=["A"]), graphs, walk, build(RawData()))
        deep = cs.by_id["deep"]
        self.assertEqual(deep.sources, {"walk"})
        self.assertFalse(deep.direct)
        self.assertEqual(deep.seeds, {"A": 1})
        self.assertAlmostEqual(deep.link_weight, candidates.LINK_WEIGHT["walk"])
        self.assertEqual(cs.by_id["c"].sources, {"seed", "walk"})
        self.assertLess(deep.seed_sim, cs.by_id["b"].seed_sim)

    def test_channel_rediscover_catalogue_tags(self):
        raw = RawData(liked=[{"at": NOW - 90 * DAY, "song": song_row("fav", channel="Fav")}])
        p = build(raw)
        chan = [candidates.SongMeta("c1", "Chan song", "Fav", 200)]
        cat = [candidates.SongMeta("pop", "Popular", "P", 200)]
        cs = candidates.assemble(self.plan(rediscover=True, channel=True, catalogue=True), {}, None, p, chan, cat)
        self.assertEqual(cs.by_id["fav"].sources, {"rediscover"})
        self.assertEqual(cs.by_id["c1"].sources, {"channel"})
        self.assertEqual(cs.by_id["pop"].sources, {"catalogue"})

    def test_seed_listed_twice_counts_once(self):
        graphs = {"A": mix("A", ["x"])}
        cs = candidates.assemble(self.plan(seed=["A"], taste=["A"], walk=False), graphs, None, build(RawData()))
        self.assertEqual(cs.by_id["x"].sources, {"seed"})

    def test_gather_cold_start_uses_catalogue_and_one_live_fetch(self):
        store = FakeStore(live={"A": mix("A", ["x", "y"])})
        cat = FakeCatalogue([song_row("pop1"), song_row("pop2")])
        with World(store, catalogue=cat):
            cs = run(candidates.gather(Plan(seed=["A"], catalogue=True), build(RawData())))
        self.assertEqual(store.fetches, ["A"])
        self.assertEqual(set(cs.by_id), {"x", "y", "pop1", "pop2"})

    def test_gather_looks_up_missing_seed_titles(self):
        store = FakeStore(live={"A": mix("A", ["x"])})
        with World(store, catalogue=FakeCatalogue([song_row("A", title="Seed Title")])):
            cs = run(candidates.gather(Plan(seed=["A"]), build(RawData())))
        self.assertEqual(cs.titles["A"], "Seed Title")


class LabelTests(unittest.TestCase):
    def test_label_detection(self):
        for c in ["T-Series", "Zee Music Company", "Sony Music India", "Tips Official", "Saregama Music",
                  "Speed Records", "Desi Music Factory", "Times Music", "Think Music India", "YRF",
                  "Eros Now Music", "Coke Studio Pakistan", "Lahari Music", "White Hill Music",
                  "Shemaroo", "Venus", "Aditya Music", "Unknown", "", "T-Series VEVO"]:
            self.assertTrue(text.is_label(c), c)
        for c in ["Arijit Singh", "Arijit Singh - Topic", "Pritam VEVO", "Lofi Girl", "Ali Sethi"]:
            self.assertFalse(text.is_label(c), c)

    def test_clean_channel(self):
        self.assertEqual(text.clean_channel("Arijit Singh - Topic"), "Arijit Singh")
        self.assertEqual(text.clean_channel("Arijit Singh · Brahmāstra"), "Arijit Singh")
        self.assertEqual(text.clean_channel("Pritam VEVO"), "Pritam")
        self.assertEqual(text.clean_channel("Ali Sethi Official"), "Ali Sethi")

    def test_extract_credits(self):
        kesariya = text.extract_credits(
            "Kesariya - Brahmāstra | Ranbir Kapoor | Alia Bhatt | Pritam | Arijit Singh | Amitabh B")
        for n in ("Ranbir Kapoor", "Alia Bhatt", "Pritam", "Arijit Singh"):
            self.assertIn(n, kesariya)
        self.assertNotIn("Kesariya", kesariya)
        self.assertEqual(text.extract_credits(
            "Tum Hi Ho Aashiqui 2 Full Song With Lyrics | Aditya Roy Kapur, Shraddha Kapoor"),
            ["Aditya Roy Kapur", "Shraddha Kapoor"])
        self.assertEqual(text.extract_credits(
            "Pasoori | Coke Studio | Season 14 | Ali Sethi x Shae Gill"), ["Ali Sethi", "Shae Gill"])
        self.assertEqual(text.extract_credits("Plain Title"), [])

    def test_label_artists_need_recurrence(self):
        songs = [("k", "Kesariya | Ranbir Kapoor | Arijit Singh"),
                 ("t", "Tum Hi Ho | Aditya Roy Kapur | Arijit Singh"),
                 ("p", "Pasoori | Coke Studio | Ali Sethi x Shae Gill")]
        got = text.label_artists(songs)
        self.assertEqual(got, {"k": "Arijit Singh", "t": "Arijit Singh"})


class DuoAndLabelGuardTests(unittest.TestCase):
    def test_label_variants_with_tails(self):
        for c in ["T-Series Lyrical", "T-Series Presents", "Zee Music Marathi", "Sony Music South", "T-Series Bhakti Sagar"]:
            self.assertTrue(text.is_label(c), c)
        self.assertFalse(text.is_label("Tipsy Gypsy"))

    def test_label_credit_is_never_an_artist(self):
        self.assertEqual(text.extract_credits("Channa Ve | T-Series Presents | T-Series | Akhil Sachdeva"),
                         ["Akhil Sachdeva"])

    def test_duos_stay_whole(self):
        for written in ("Ajay-Atul", "Ajay - Atul", "Ajay & Atul", "Ajay and Atul"):
            self.assertEqual(text.extract_credits(f"Mard Maratha | {written} | Singer One"),
                             ["Ajay-Atul", "Singer One"], written)
        self.assertEqual(text.extract_credits("Song | Shankar - Ehsaan - Loy | Vishal-Shekhar, Meet Bros"),
                         ["Shankar-Ehsaan-Loy", "Vishal-Shekhar", "Meet Bros"])
        self.assertEqual(text.extract_credits("Song | Vishal Mishra | Tanishk Bagchi"),
                         ["Vishal Mishra", "Tanishk Bagchi"])
        self.assertEqual(text.extract_credits("Song | Sachin-Jigar x Sajid & Wajid"), ["Sachin-Jigar", "Sajid-Wajid"])


if __name__ == "__main__":
    unittest.main()
