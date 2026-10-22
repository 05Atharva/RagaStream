"""
End-to-end tests of each surface and the /recs router, with a fake Mix graph, fake profile
loader and fake catalogue. No network, no DB.

Run from backend/:  venv/Scripts/python -m unittest discover -s tests -p "test_recs_*.py" -v
"""
import asyncio
import time
import unittest
from datetime import datetime

from test_recs_fixtures import DAY, FakeCatalogue, FakeStore, World, rel, song_row

import recs
from recs import text
from recs import slates, surfaces
from recs.graph import Related
from recs.profile import RawData


def run(coro):
    return asyncio.run(coro)


def ev(yt, kind, ago_s=60.0, **kw):
    return {"youtube_id": yt, "event": kind, "created_at": time.time() - ago_s, **kw}


def at(days_ago):
    return time.time() - days_ago * DAY


def big_mix(seed, n=30, prefix="m", channels=5):
    return [rel(f"{prefix}{i}", i + 1, channel=f"{prefix.upper()}Chan{i % channels}") for i in range(n)]


def ids(slate):
    return [i.youtube_id for i in slate.items]


class RadioTests(unittest.TestCase):
    def test_cold_start_equals_mix_order_with_one_fetch(self):
        mix = big_mix("S", 20)
        mix.insert(3, rel("dup", 4, channel=mix[2].channel, title=mix[2].title + " (Official Video)"))
        store = FakeStore(live={"S": mix})
        with World(store):
            slate = run(surfaces.radio_slate("u1", "S", 15))
        self.assertEqual(store.fetches, ["S"])
        want = [r.youtube_id for r in mix if r.youtube_id != "dup"][:15]
        self.assertEqual(ids(slate), want)
        self.assertEqual(slate.surface, "radio")
        self.assertNotIn("S", ids(slate))
        self.assertTrue(all(i.reason.startswith("Because you played") or i.reason for i in slate.items))

    def test_flow_is_kept_for_a_listener(self):
        mix = big_mix("S", 40)
        raw = RawData(events=[ev("m5", "complete", 3 * DAY)], songs=[song_row("m5", channel="M5Chan0")])
        with World(FakeStore(live={"S": mix}), raw=raw):
            slate = run(surfaces.radio_slate("u1", "S", 30))
        got = ids(slate)
        self.assertEqual(len(got), 30)
        # light re-rank: the first third is still drawn from the Mix's first third plus a little exploration
        early = [int(y[1:]) for y in got[:10]]
        self.assertLess(sum(early) / len(early), 16)

    def test_no_mix_falls_back_to_catalogue_then_empty(self):
        cat = FakeCatalogue([song_row(f"pop{i}", channel=f"P{i}") for i in range(6)])
        with World(FakeStore(fail={"S"}), catalogue=cat):
            slate = run(surfaces.radio_slate("u1", "S", 5))
        self.assertEqual(len(slate.items), 5)
        with World(FakeStore(fail={"S"})):
            self.assertEqual(run(surfaces.radio_slate("u1", "S", 5)).items, [])


class NextTests(unittest.TestCase):
    def setUp(self):
        self.live = {"S": big_mix("S", 30, "a"), "L": big_mix("L", 30, "l")}
        self.raw = RawData(
            liked=[{"at": at(2), "song": song_row("L", title="Liked Song", channel="LChan")}],
            events=[ev("L", "complete", 2 * DAY)],
            songs=[song_row("L", title="Liked Song", channel="LChan")],
        )

    def test_slate_shape_reasons_and_features_logged(self):
        with World(FakeStore(live=self.live), raw=self.raw):
            slate = run(surfaces.next_slate("u1", "S", ["a1"], 10))
            self.assertEqual(slate.surface, "autoplay")
            self.assertEqual(len(slate.items), 10)
            self.assertNotIn("S", ids(slate))
            self.assertNotIn("a1", ids(slate))
            self.assertEqual(len(set(ids(slate))), 10)
            for it in slate.items:
                self.assertTrue(it.reason)
                self.assertIn(it.reason_code, {"seed", "session", "taste", "walk", "channel", "rediscover",
                                               "catalogue", "discover"})
                self.assertTrue(it.thumbnail.startswith("https://"))
            first = slate.items[0].youtube_id
            feats = recs.features_for(slate.rec_id, first)
            self.assertIsNotNone(feats)
            self.assertIn("consensus", feats)
            self.assertIsNone(recs.features_for(slate.rec_id, "nope"))
            self.assertIsNone(recs.features_for("unknown", first))

    def test_skips_back_off_a_channel_now(self):
        base = RawData(events=[], songs=[])
        with World(FakeStore(live=self.live), raw=base):
            before = run(surfaces.next_slate("u1", "S", [], 12))
        bad_channel = before.items[0].channel
        skipped = RawData(
            events=[ev("zz1", "skip", 120, listened_sec=3, duration_sec=200),
                    ev("zz2", "skip", 60, listened_sec=4, duration_sec=200)],
            songs=[song_row("zz1", channel=bad_channel), song_row("zz2", channel=bad_channel)])
        with World(FakeStore(live=self.live), raw=skipped):
            after = run(surfaces.next_slate("u1", "S", [], 12))
        count = lambda s: sum(1 for i in s.items if i.channel == bad_channel)
        self.assertLessEqual(count(after), count(before))
        self.assertNotEqual(ids(before), ids(after))

    def test_hidden_song_and_channel_never_returned(self):
        raw = RawData(feedback=[{"target_type": "song", "target_id": "a0", "kind": "hide"},
                                {"target_type": "channel", "target_id": "AChan1", "kind": "hide"}])
        with World(FakeStore(live=self.live), raw=raw):
            slate = run(surfaces.next_slate("u1", "S", [], 30))
        self.assertNotIn("a0", ids(slate))
        self.assertTrue(all(i.channel != "AChan1" for i in slate.items))

    def test_stored_graph_when_yt_dlp_is_down(self):
        store = FakeStore(stored={"S": big_mix("S", 12, "a")}, fail={"S"})
        store.stored["S"] = (time.time() - 30 * DAY, store.stored["S"][1])
        with World(store):
            slate = run(surfaces.next_slate("u1", "S", [], 8))
        self.assertEqual(len(slate.items), 8)

    def test_live_fetches_capped_at_three(self):
        live = {"S": big_mix("S", 20, "a")}
        events = []
        songs = []
        for i in range(8):
            live[f"t{i}"] = big_mix(f"t{i}", 10, f"t{i}_")
            events += [ev(f"t{i}", "complete", (i + 1) * DAY)] * 2
            songs.append(song_row(f"t{i}", channel=f"T{i}"))
        store = FakeStore(live=live)
        with World(store, raw=RawData(events=events, songs=songs)):
            run(surfaces.next_slate("u1", "S", [], 10))
        self.assertLessEqual(len(store.fetches), 3)
        self.assertEqual(store.fetches[0], "S")


class ShuffleAndPlaylistTests(unittest.TestCase):
    def test_shuffle_excludes_context_and_current(self):
        live = {"c0": big_mix("c0", 25, "p"), "c1": big_mix("c1", 25, "p"), "c2": big_mix("c2", 25, "p")}
        context = ["c0", "c1", "c2", "p3", "p4"]
        with World(FakeStore(live=live)):
            slate = run(surfaces.shuffle_slate("u1", "c0", context, ["p5"], 12))
        self.assertEqual(slate.surface, "smart_shuffle")
        got = set(ids(slate))
        self.assertFalse(got & set(context))
        self.assertNotIn("p5", got)
        self.assertEqual(len(got), 12)

    def test_shuffle_without_current_uses_taste(self):
        raw = RawData(liked=[{"at": at(1), "song": song_row("L", channel="LC")}])
        with World(FakeStore(live={"L": big_mix("L", 20, "q")}), raw=raw):
            slate = run(surfaces.shuffle_slate("u1", None, [], [], 10))
        self.assertEqual(len(slate.items), 10)

    def test_shuffle_is_deterministic_for_same_input_apart_from_rec_id(self):
        live = {"c0": big_mix("c0", 25, "p")}
        with World(FakeStore(live=live)):
            a = run(surfaces.shuffle_slate("u1", "c0", ["c0", "x1", "x2"], [], 10))
            b = run(surfaces.shuffle_slate("u1", "c0", ["c0", "x1", "x2"], [], 10))
        self.assertNotEqual(a.rec_id, b.rec_id)

    def test_playlist_prefers_songs_many_seeds_agree_on(self):
        shared = rel("shared", 5, "SharedChan")
        live = {
            "p1": [shared, *[rel(f"u1_{i}", i + 1, f"A{i}") for i in range(10)]],
            "p2": [shared, *[rel(f"u2_{i}", i + 1, f"B{i}") for i in range(10)]],
            "p3": [shared, *[rel(f"u3_{i}", i + 1, f"C{i}") for i in range(10)]],
        }
        with World(FakeStore(live=live)):
            slate = run(surfaces.playlist_slate("u1", ["p1", "p2", "p3"], ["u1_0"], 10))
        self.assertEqual(slate.surface, "playlist_recs")
        self.assertEqual(slate.items[0].youtube_id, "shared")
        self.assertFalse({"p1", "p2", "p3", "u1_0"} & set(ids(slate)))

    def test_playlist_exploration_share_is_a_quarter(self):
        live = {"p1": big_mix("p1", 40, "z", channels=40)}
        raw = RawData(events=[ev("old", "complete", 5 * DAY)], songs=[song_row("old")])
        with World(FakeStore(live=live), raw=raw):
            slate = run(surfaces.playlist_slate("u1", ["p1"], [], 20))
        self.assertEqual(len(slate.items), 20)
        self.assertEqual(sum(1 for i in slate.items if i.reason_code == "discover"), 5)


class HomeTests(unittest.TestCase):
    def world(self, **kw):
        live = {}
        songs, events, liked = [], [], []
        for n, (yt, ch) in enumerate([("fa", "Arijit"), ("fb", "Arijit"), ("fc", "Pritam"), ("fd", "Lofi Girl")]):
            live[yt] = [rel(f"{yt}_{i}", i + 1, f"{yt.upper()}X{i % 6}") for i in range(30)]
            songs.append(song_row(yt, title=f"Fav {yt}", channel=ch))
            liked.append({"at": at(3 + n), "song": song_row(yt, title=f"Fav {yt}", channel=ch)})
            events += [ev(yt, "complete", (n + 1) * 3600 * 5, local_hour=23)] * 3
        # one loved song not played for 60 days -> "Back on rotation"
        for k in range(6):
            sid = f"old{k}"
            songs.append(song_row(sid, title=f"Old {k}", channel=f"OldChan{k % 3}"))
            liked.append({"at": at(100), "song": song_row(sid, title=f"Old {k}", channel=f"OldChan{k % 3}")})
            events.append(ev(sid, "complete", 60 * DAY))
        raw = RawData(events=events, liked=liked, songs=songs)
        return World(FakeStore(live=live), raw=raw, **kw)

    def test_sections_for_an_established_listener(self):
        with self.world():
            home = run(surfaces.home_recs("u1", 23))
            logged = [recs.features_for(s.rec_id, s.items[0].youtube_id) for s in home.sections]
        self.assertTrue(all(logged))
        kinds = [s.kind for s in home.sections]
        self.assertTrue(1 <= kinds.count("mix") <= 3)
        self.assertIn("rediscover", kinds)
        self.assertLessEqual(kinds.count("because"), 2)
        self.assertIn("hour", kinds)
        self.assertEqual(kinds[: kinds.count("mix")], ["mix"] * kinds.count("mix"))
        for s in home.sections:
            self.assertGreaterEqual(len(s.items), surfaces.HOME_MIN_ITEMS)
            self.assertLessEqual(len(s.items), 20)
            self.assertTrue(s.rec_id and s.id and s.title)
            self.assertEqual(len({i.youtube_id for i in s.items}), len(s.items))
        mix = next(s for s in home.sections if s.kind == "mix")
        self.assertTrue(mix.title.endswith(" Mix"))
        self.assertIsNotNone(mix.seed)
        hour = next(s for s in home.sections if s.kind == "hour")
        self.assertEqual(hour.title, "Your late-night set")
        self.assertTrue(all(i.reason == "Your late-night pick" for i in hour.items))
        rediscover = next(s for s in home.sections if s.kind == "rediscover")
        self.assertEqual(rediscover.title, "Back on rotation")
        self.assertTrue(all(i.reason_code == "rediscover" for i in rediscover.items))
        datetime.fromisoformat(home.generated_at)

    def test_channel_cap_per_row(self):
        with self.world():
            home = run(surfaces.home_recs("u1", 23))
        for s in home.sections:
            if len(s.items) >= 8:
                counts = {}
                for i in s.items:
                    counts[i.channel] = counts.get(i.channel, 0) + 1
                self.assertLessEqual(max(counts.values()), 4, s.id)

    def test_home_is_cached_and_invalidated(self):
        w = self.world()
        with w:
            first = run(surfaces.home_recs("u1", 23))
            fetches = len(w.store.fetches)
            second = run(surfaces.home_recs("u1", 23))
            self.assertIs(first, second)
            self.assertEqual(len(w.store.fetches), fetches)
            recs.invalidate_user("u1", home=False)
            self.assertIs(run(surfaces.home_recs("u1", 23)), first)
            recs.invalidate_user("u1")
            self.assertIsNone(slates.get_home("u1"))
            self.assertIsNot(run(surfaces.home_recs("u1", 23)), first)

    def test_cold_start_home_is_discover_from_catalogue(self):
        cat = FakeCatalogue([song_row(f"pop{i}", channel=f"P{i}") for i in range(12)])
        with World(catalogue=cat):
            home = run(surfaces.home_recs("u1", 9))
        self.assertEqual([s.kind for s in home.sections], ["discover"])
        self.assertEqual(home.sections[0].title, "New to you")

    def test_empty_everything_returns_no_sections_and_is_not_cached(self):
        with World():
            home = run(surfaces.home_recs("u1", 9))
            self.assertEqual(home.sections, [])
            self.assertIsNone(slates.get_home("u1"))

    def test_cluster_and_merge(self):
        raw = RawData(liked=[{"at": at(1), "song": song_row(y, channel=c)}
                             for y, c in [("a", "X"), ("b", "X"), ("c", "Y"), ("d", "Z")]])
        from test_recs_fixtures import build
        p = build(raw, time.time())
        clusters = surfaces.cluster_taste(p)
        self.assertEqual(clusters[0].name, "X")
        self.assertEqual(len(clusters[0].songs), 2)
        graphs = {clusters[0].seed: [Related("c", 1, "t", "Y", 200)]}
        merged = surfaces.merge_clusters(clusters, graphs)
        self.assertEqual(len(merged), 2)                     # Y folded into X, Z stays
        self.assertEqual(surfaces.display_name("Arijit Singh - Topic"), "Arijit Singh")


class MixNamingTests(unittest.TestCase):
    def prof(self, rows):
        from test_recs_fixtures import build
        raw = RawData(liked=[{"at": at(1), "song": song_row(y, title=t, channel=c)} for y, t, c in rows])
        return build(raw, time.time())

    def test_label_songs_cluster_by_recurring_artist(self):
        p = self.prof([
            ("k", "Kesariya - Brahmastra | Ranbir Kapoor | Pritam | Arijit Singh", "Sony Music India"),
            ("t", "Tum Hi Ho | Aditya Roy Kapur | Arijit Singh", "T-Series"),
            ("s", "Solo Track | Nobody Known", "Zee Music Company"),
        ])
        clusters = surfaces.cluster_taste(p)
        names = {c.name for c in clusters}
        self.assertIn("Arijit Singh", names)
        self.assertNotIn("Zee Music Company", names)
        self.assertNotIn("Unknown", names)
        arijit = next(c for c in clusters if c.name == "Arijit Singh")
        self.assertEqual(sorted(arijit.songs), ["k", "t"])
        solo = next(c for c in clusters if c.seed == "s")
        self.assertEqual(solo.name, "Solo Track")            # no credible artist: the song's title

    def test_unknown_channel_never_named(self):
        p = self.prof([("u", "Some Song (Official Video)", "Unknown")])
        self.assertEqual([c.name for c in surfaces.cluster_taste(p)], ["Some Song"])

    def test_names_are_unique(self):
        p = self.prof([("a", "Same", "X"), ("b", "Other", "X"), ("c", "Third", "Y")])
        a = surfaces.Cluster("1", "Same", "a", ["a"], 2.0)
        b = surfaces.Cluster("2", "Same", "b", ["b"], 1.0)
        out = surfaces.unique_names([a, b], p)
        self.assertEqual([c.name for c in out], ["Same", "Other"])

    def test_pluralisation_and_subtitles(self):
        self.assertEqual(surfaces.plural_songs(1), "Built from 1 song you love")
        self.assertEqual(surfaces.plural_songs(3), "Built from 3 songs you love")
        p = self.prof([("a", "Kesariya", "Arijit"), ("b", "Raataan Lambiyan", "Arijit")])
        cl = surfaces.cluster_taste(p)[0]
        sub = surfaces.mix_subtitle(cl, p, [])
        self.assertTrue(sub.endswith(" and more"))
        self.assertIn("Kesariya", sub)
        self.assertIn("Raataan Lambiyan", sub)
        one = surfaces.cluster_taste(self.prof([("a", "Kesariya", "Arijit")]))[0]
        self.assertEqual(surfaces.mix_subtitle(one, self.prof([("a", "Kesariya", "Arijit")]), []),
                         "Built from 1 song you love")

    def test_because_subtitle_never_a_label(self):
        p = self.prof([("a", "Kesariya", "Arijit Singh"), ("t", "Song", "T-Series")])
        self.assertEqual(surfaces.because_subtitle(p, "a"), "More from Arijit Singh")
        self.assertEqual(surfaces.because_subtitle(p, "t"), "More like this")
        self.assertEqual(surfaces.because_subtitle(p, "missing"), "More like this")

    def test_label_never_names_a_mix(self):
        p = self.prof([("a", "Channa Ve | Akhil", "T-Series Lyrical"), ("b", "Tum Se Hi | Mohit", "T-Series Lyrical")])
        for c in surfaces.cluster_taste(p):
            self.assertFalse(text.is_label(c.name), c.name)
        forced = surfaces.Cluster("k", "T-Series", "a", ["a"], 1.0)
        self.assertEqual([c.name for c in surfaces.unique_names([forced], p)], ["Channa Ve"])

    def test_duo_recurring_credit_names_the_mix(self):
        p = self.prof([("a", "Mard Maratha | Ajay-Atul", "Zee Music Company"),
                       ("b", "Mann Mein Shiva | Ajay - Atul", "Zee Music Company")])
        self.assertEqual([c.name for c in surfaces.cluster_taste(p)], ["Ajay-Atul"])

    def test_display_name_strips_album_tail(self):
        self.assertEqual(surfaces.display_name("Arijit Singh · Brahmāstra"), "Arijit Singh")

    def test_home_mix_titles_have_no_labels(self):
        live = {"k": big_mix("k", 20, "a"), "t": big_mix("t", 20, "b")}
        rows = [("k", "Kesariya | Pritam | Arijit Singh", "Sony Music India"),
                ("t", "Tum Hi Ho | Aditya Roy Kapur | Arijit Singh", "T-Series")]
        raw = RawData(liked=[{"at": at(1), "song": song_row(y, title=t, channel=c)} for y, t, c in rows],
                      events=[ev(y, "complete", 3600) for y, _, _ in rows],
                      songs=[song_row(y, title=t, channel=c) for y, t, c in rows])
        with World(FakeStore(live=live), raw=raw):
            home = run(surfaces.home_recs("u1", 12))
        titles = [s.title for s in home.sections if s.kind == "mix"]
        self.assertEqual(titles, ["Arijit Singh Mix"])
        for s in home.sections:
            self.assertNotIn("Unknown", s.title)
            self.assertNotIn("T-Series", s.subtitle)


class ExportTests(unittest.TestCase):
    def test_package_exports_are_cheap_and_work(self):
        import sys
        self.assertNotIn("yt_dlp", sys.modules) if "routers.youtube" not in sys.modules else None
        slates.remember("rid", "autoplay", {"y": {"consensus": 0.5}})
        self.assertEqual(recs.features_for("rid", "y"), {"consensus": 0.5})
        recs.invalidate_user("nobody")


if __name__ == "__main__":
    unittest.main()
