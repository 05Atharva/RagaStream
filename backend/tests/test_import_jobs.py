"""Import job lifecycle with fakes: progress, playlist order, owner-only, cancel, limits, expiry."""
import asyncio
import os
import unittest

os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_KEY", "test")

from importer.errors import ImportFailure  # noqa: E402
from importer.jobs import (  # noqa: E402
    JOB_TTL_SECONDS, MAX_KEPT_PER_USER, MAX_RUNNING_PER_USER, JobManager, TooManyJobs,
)
from importer.match import Match  # noqa: E402
from importer.types import SourceData, SourceTrack  # noqa: E402
from schemas import YouTubeSearchResult  # noqa: E402


class FakeStore:
    def __init__(self):
        self.songs = {}            # youtube_id -> row
        self.playlists = []        # dicts
        self.fail_create = False

    def ensure_song(self, meta):
        row = self.songs.get(meta["youtube_id"])
        if row is None:
            row = {"id": f"song-{len(self.songs)}", "youtube_id": meta["youtube_id"], "title": meta["title"],
                   "channel_name": meta["channel_name"] or "Unknown", "thumbnail_url": meta.get("thumbnail_url"),
                   "duration_sec": meta.get("duration_sec"), "play_count": 0}
            self.songs[meta["youtube_id"]] = row
        return row

    def create_playlist(self, user_id, name, description, song_ids):
        if self.fail_create:
            raise RuntimeError("db down")
        self.playlists.append({"id": f"pl-{len(self.playlists)}", "user_id": user_id, "name": name,
                               "description": description, "song_ids": list(song_ids)})
        return self.playlists[-1]["id"]


def source(titles, name="My Mix", src="spotify"):
    return SourceData(source=src, name=name, tracks=[SourceTrack(title=t, artists=["Artist"], duration_sec=200) for t in titles])


def hit(title, confidence=0.9):
    vid = "v" + "".join(c for c in title if c.isalnum()).lower().ljust(10, "x")[:10]
    return Match(candidate=YouTubeSearchResult(youtube_id=vid, title=title, channel="Artist - Topic", duration=200,
                                               thumbnail=f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg"), confidence=confidence)


class Harness:
    def __init__(self, data, matcher=None, clock=None):
        self.store = FakeStore()
        self.gate = asyncio.Event()
        self.clock_now = [1000.0]

        async def loader(url, text):
            if isinstance(data, Exception):
                raise data
            return data

        async def default_matcher(track):
            return (None, False) if track.title.startswith("missing") else (hit(track.title), False)

        self.manager = JobManager(loader, self.store, matcher or default_matcher, clock=lambda: self.clock_now[0])

    async def finish(self, state, timeout=5):
        await asyncio.wait_for(state.task, timeout)
        return state.to_model()


class LifecycleTests(unittest.TestCase):
    def test_playlist_is_created_in_source_order_with_matched_songs_only(self):
        async def run():
            h = Harness(source(["Alpha", "missing one", "Beta", "Gamma"]))
            state = h.manager.start("u1", "https://x", None, None, None)
            job = await h.finish(state)
            return h, job

        h, job = asyncio.run(run())
        self.assertEqual((job.status, job.total, job.matched, job.not_found), ("done", 4, 3, 1))
        self.assertEqual(job.name, "My Mix")
        self.assertEqual([i.status for i in job.items], ["matched", "not_found", "matched", "matched"])
        self.assertEqual(job.playlist_id, "pl-0")
        playlist = h.store.playlists[0]
        by_id = {r["id"]: r["title"] for r in h.store.songs.values()}
        self.assertEqual([by_id[s] for s in playlist["song_ids"]], ["Alpha", "Beta", "Gamma"])
        self.assertEqual(playlist["user_id"], "u1")
        self.assertEqual(job.items[0].song.title, "Alpha")
        self.assertEqual(job.items[0].confidence, 0.9)
        self.assertIsNone(job.items[1].song)

    def test_given_name_and_description_win_over_the_source(self):
        async def run():
            h = Harness(source(["Alpha"]))
            state = h.manager.start("u1", None, "text", "  Road trip ", "For the car")
            await h.finish(state)
            return h

        h = asyncio.run(run())
        self.assertEqual((h.store.playlists[0]["name"], h.store.playlists[0]["description"]), ("Road trip", "For the car"))

    def test_progress_is_visible_while_matching(self):
        async def run():
            gate = asyncio.Event()

            async def slow_matcher(track):
                if track.title == "Gamma":
                    await gate.wait()
                return hit(track.title), False

            h = Harness(source(["Alpha", "Beta", "Gamma"]), matcher=slow_matcher)
            state = h.manager.start("u1", None, "x", None, None)
            for _ in range(50):
                await asyncio.sleep(0.01)
                if state.matched == 2:
                    break
            mid = state.to_model()
            gate.set()
            done = await h.finish(state)
            return mid, done

        mid, done = asyncio.run(run())
        self.assertEqual((mid.status, mid.total, mid.matched, mid.not_found), ("matching", 3, 2, 0))
        self.assertEqual([i.status for i in mid.items], ["matched", "matched", "pending"])
        self.assertIsNotNone(mid.items[0].song)        # real catalogue rows show up while matching
        self.assertEqual((done.status, done.matched), ("done", 3))

    def test_matching_is_three_at_a_time(self):
        async def run():
            active = {"now": 0, "max": 0}

            async def matcher(track):
                active["now"] += 1
                active["max"] = max(active["max"], active["now"])
                await asyncio.sleep(0.01)
                active["now"] -= 1
                return hit(track.title), False

            h = Harness(source([f"Song{i}" for i in range(12)]), matcher=matcher)
            await h.finish(h.manager.start("u1", None, "x", None, None))
            return active["max"]

        self.assertEqual(asyncio.run(run()), 3)

    def test_youtube_sources_need_no_matching(self):
        async def run():
            data = SourceData(source="youtube", name="YT list", tracks=[
                SourceTrack(title="One", artists=["A"], youtube_id="aaaaaaaaaaa", channel="A - Topic", duration_sec=100),
                SourceTrack(title="Two", artists=["B"], youtube_id="bbbbbbbbbbb", channel="B", duration_sec=200),
            ])

            async def never(track):
                raise AssertionError("YouTube tracks must not be searched")

            h = Harness(data, matcher=never)
            return h, await h.finish(h.manager.start("u1", "https://youtube.com/playlist?list=x", None, None, None))

        h, job = asyncio.run(run())
        self.assertEqual((job.status, job.matched, job.items[0].confidence), ("done", 2, 1.0))
        self.assertEqual(h.store.songs["aaaaaaaaaaa"]["channel_name"], "A - Topic")

    def test_duplicates_resolving_to_one_song_appear_once_in_the_playlist(self):
        async def run():
            h = Harness(source(["Alpha", "Alpha"]))
            job = await h.finish(h.manager.start("u1", None, "x", None, None))
            return h, job

        h, job = asyncio.run(run())
        self.assertEqual(job.matched, 2)
        self.assertEqual(len(h.store.playlists[0]["song_ids"]), 1)

    def test_low_confidence_is_not_found_but_keeps_its_confidence(self):
        async def run():
            async def weak(track):
                return hit(track.title, 0.31), False

            h = Harness(source(["Alpha"]), matcher=weak)
            return await h.finish(h.manager.start("u1", None, "x", None, None))

        job = asyncio.run(run())
        self.assertEqual(job.status, "failed")                       # nothing matched: no empty playlist
        self.assertEqual((job.items[0].status, job.items[0].confidence), ("not_found", 0.31))
        self.assertIn("None of those songs", job.error)

    def test_nothing_matched_creates_no_playlist(self):
        async def run():
            h = Harness(source(["missing a", "missing b"]))
            return h, await h.finish(h.manager.start("u1", None, "x", None, None))

        h, job = asyncio.run(run())
        self.assertEqual((job.status, job.playlist_id, h.store.playlists), ("failed", None, []))

    def test_unreadable_source_fails_with_its_message(self):
        async def run():
            h = Harness(ImportFailure("This link isn't a public playlist. Paste the song list instead."))
            return await h.finish(h.manager.start("u1", "https://x", None, None, None))

        job = asyncio.run(run())
        self.assertEqual(job.status, "failed")
        self.assertIn("Paste the song list instead", job.error)

    def test_youtube_search_down_fails_instead_of_pretending_nothing_was_found(self):
        async def run():
            async def down(track):
                return None, True

            h = Harness(source(["Alpha", "Beta"]), matcher=down)
            return await h.finish(h.manager.start("u1", None, "x", None, None))

        job = asyncio.run(run())
        self.assertEqual(job.status, "failed")
        self.assertIn("search", job.error.lower())

    def test_database_failure_is_a_failed_job_with_a_plain_message(self):
        async def run():
            h = Harness(source(["Alpha"]))
            h.store.fail_create = True
            return await h.finish(h.manager.start("u1", None, "x", None, None))

        with self.assertLogs("importer.jobs", "ERROR"):
            job = asyncio.run(run())
        self.assertEqual(job.status, "failed")
        self.assertNotIn("db down", job.error)


class AccessTests(unittest.TestCase):
    def test_only_the_owner_can_read_or_cancel(self):
        async def run():
            h = Harness(source(["Alpha"]))
            state = h.manager.start("u1", None, "x", None, None)
            await h.finish(state)
            return (h.manager.get("u1", state.job_id) is not None, h.manager.get("u2", state.job_id),
                    h.manager.cancel("u2", state.job_id), h.manager.cancel("u1", state.job_id),
                    h.manager.get("u1", "nope"))

        mine, theirs, other_cancel, own_cancel, missing = asyncio.run(run())
        self.assertTrue(mine)
        self.assertIsNone(theirs)
        self.assertFalse(other_cancel)
        self.assertTrue(own_cancel)       # cancelling a finished job is a harmless no-op
        self.assertIsNone(missing)


class CancelTests(unittest.TestCase):
    def test_cancel_stops_matching_and_creates_no_playlist(self):
        async def run():
            started = asyncio.Event()

            async def hang(track):
                started.set()
                await asyncio.sleep(30)

            h = Harness(source(["Alpha", "Beta"]), matcher=hang)
            state = h.manager.start("u1", None, "x", None, None)
            await asyncio.wait_for(started.wait(), 2)
            self.assertTrue(h.manager.cancel("u1", state.job_id))
            await asyncio.wait_for(asyncio.gather(state.task, return_exceptions=True), 2)
            return h, state.to_model()

        h, job = asyncio.run(run())
        self.assertEqual(job.status, "failed")
        self.assertEqual(job.error, "Import cancelled.")
        self.assertEqual(h.store.playlists, [])

    def test_cancel_frees_the_running_slot(self):
        async def run():
            async def hang(track):
                await asyncio.sleep(30)

            h = Harness(source(["Alpha"]), matcher=hang)
            states = [h.manager.start("u1", None, "x", None, None) for _ in range(MAX_RUNNING_PER_USER)]
            await asyncio.sleep(0.01)
            blocked = False
            try:
                h.manager.start("u1", None, "x", None, None)
            except TooManyJobs:
                blocked = True
            h.manager.cancel("u1", states[0].job_id)
            h.manager.start("u1", None, "x", None, None)    # a slot is free again
            for s in h.manager._jobs["u1"].values():
                h.manager.cancel("u1", s.job_id)
            await asyncio.gather(*(s.task for s in h.manager._jobs["u1"].values()), return_exceptions=True)
            return blocked

        self.assertTrue(asyncio.run(run()))


class LimitTests(unittest.TestCase):
    def test_third_running_job_is_refused_but_another_user_is_not(self):
        async def run():
            async def hang(track):
                await asyncio.sleep(30)

            h = Harness(source(["Alpha"]), matcher=hang)
            a = h.manager.start("u1", None, "x", None, None)
            b = h.manager.start("u1", None, "x", None, None)
            with self.assertRaises(TooManyJobs):
                h.manager.start("u1", None, "x", None, None)
            other = h.manager.start("u2", None, "x", None, None)
            for state in (a, b, other):
                h.manager.cancel(state.user_id, state.job_id)
            await asyncio.gather(a.task, b.task, other.task, return_exceptions=True)

        asyncio.run(run())

    def test_only_twenty_finished_jobs_are_kept(self):
        async def run():
            h = Harness(source(["Alpha"]))
            ids = []
            for _ in range(MAX_KEPT_PER_USER + 5):
                state = h.manager.start("u1", None, "x", None, None)
                await h.finish(state)
                ids.append(state.job_id)
            kept = [h.manager.get("u1", i) is not None for i in ids]
            return kept

        kept = asyncio.run(run())
        self.assertEqual(sum(kept), MAX_KEPT_PER_USER)
        self.assertFalse(any(kept[:5]))          # oldest go first
        self.assertTrue(all(kept[5:]))

    def test_jobs_expire_after_two_hours(self):
        async def run():
            h = Harness(source(["Alpha"]))
            state = h.manager.start("u1", None, "x", None, None)
            await h.finish(state)
            fresh = h.manager.get("u1", state.job_id) is not None
            h.clock_now[0] += JOB_TTL_SECONDS + 1
            return fresh, h.manager.get("u1", state.job_id)

        fresh, expired = asyncio.run(run())
        self.assertTrue(fresh)
        self.assertIsNone(expired)


if __name__ == "__main__":
    unittest.main()
