"""YouTube rate limits (HTTP 429): backoff, cooldown, shared extractions, stale fallback."""
import asyncio
import time
import unittest
from unittest import mock

from fastapi import HTTPException

import ytguard
from ytguard import Gate, YouTubeBusy, parse_retry_after, rate_limit_of, retry_delay


def no_jitter(a, b):
    return 0.0


class Clock:
    def __init__(self, now=1000.0):
        self.now = now

    def __call__(self):
        return self.now


class FakeHTTPError(Exception):
    """Shaped like yt_dlp.networking.exceptions.HTTPError."""

    def __init__(self, status, headers=None):
        super().__init__(f"HTTP Error {status}")
        self.status = status
        self.response = mock.Mock(status=status, headers=headers or {})


class FakeDownloadError(Exception):
    """Shaped like yt_dlp.utils.DownloadError: the real error sits in exc_info."""

    def __init__(self, msg, inner=None):
        super().__init__(msg)
        self.exc_info = (type(inner), inner, None) if inner else None


class BackoffTests(unittest.TestCase):
    def test_doubles_from_ten_seconds_and_caps_at_five_minutes(self):
        self.assertEqual([retry_delay(a, no_jitter) for a in range(7)], [10, 20, 40, 80, 160, 300, 300])

    def test_jitter_is_at_most_five_seconds(self):
        for _ in range(50):
            self.assertTrue(10 <= retry_delay(0) <= 15)

    def test_retry_after_seconds_and_dates(self):
        self.assertEqual(parse_retry_after("120"), 120)
        self.assertEqual(parse_retry_after("Wed, 21 Oct 2015 07:28:30 GMT", now=1445412480.0), 30)
        self.assertEqual(parse_retry_after("999999"), ytguard.MAX_RETRY_AFTER)
        self.assertEqual(parse_retry_after("-5"), 0)
        for junk in (None, "", "soon", "nan"):
            self.assertIsNone(parse_retry_after(junk), junk)


class DetectionTests(unittest.TestCase):
    def test_nested_http_429_with_retry_after(self):
        exc = FakeDownloadError("ERROR: unable to download", FakeHTTPError(429, {"Retry-After": "90"}))
        self.assertEqual(rate_limit_of(exc), (True, 90))

    def test_message_only(self):
        self.assertEqual(rate_limit_of(Exception("HTTP Error 429: Too Many Requests")), (True, None))

    def test_session_limit_waits_the_longest(self):
        exc = Exception("The current session has been rate-limited by YouTube for up to an hour.")
        self.assertEqual(rate_limit_of(exc), (True, ytguard.MAX_DELAY))

    def test_other_errors_are_not_rate_limits(self):
        for exc in (FakeDownloadError("x", FakeHTTPError(403)), Exception("Video unavailable"),
                    Exception("[youtube] ab429cdefgh: Private video")):
            self.assertEqual(rate_limit_of(exc), (False, None), exc)


class GateTests(unittest.TestCase):
    def setUp(self):
        self.clock = Clock()
        self.gate = Gate(max_concurrent=2, clock=self.clock, rand=no_jitter)
        self.calls = 0

    def run_gate(self, fn):
        return asyncio.run(self.gate.run(fn))

    def limited_like_render(self, log):
        """What the Render logs showed: the 429 is only a warning, then a vague error."""
        self.calls += 1
        log.warning("[youtube] BddP6PYo2gs: Unable to download webpage: HTTP Error 429: Too Many Requests")
        raise Exception("[youtube] BddP6PYo2gs: Failed to extract any player response")

    def ok(self, log):
        self.calls += 1
        return "ok"

    def test_429_warning_starts_a_cooldown_and_blocks_calls(self):
        with self.assertRaises(YouTubeBusy) as ctx:
            self.run_gate(self.limited_like_render)
        self.assertEqual(ctx.exception.retry_after, 10)
        with self.assertRaises(YouTubeBusy):
            self.run_gate(self.ok)
        self.assertEqual(self.calls, 1)  # the second call never reached YouTube

    def test_each_429_in_a_row_waits_longer_and_success_resets(self):
        waits = []
        for _ in range(3):
            with self.assertRaises(YouTubeBusy) as ctx:
                self.run_gate(self.limited_like_render)
            waits.append(ctx.exception.retry_after)
            self.clock.now += ctx.exception.retry_after
        self.assertEqual(waits, [10, 20, 40])
        self.assertEqual(self.run_gate(self.ok), "ok")
        with self.assertRaises(YouTubeBusy) as ctx:
            self.run_gate(self.limited_like_render)
        self.assertEqual(ctx.exception.retry_after, 10)

    def test_longer_retry_after_wins(self):
        def limited(log):
            raise FakeDownloadError("x", FakeHTTPError(429, {"Retry-After": "120"}))
        with self.assertRaises(YouTubeBusy) as ctx:
            self.run_gate(limited)
        self.assertEqual(ctx.exception.retry_after, 120)

    def test_simultaneous_429s_count_once(self):
        self.gate.trip()
        self.gate.trip()
        self.gate.trip()
        self.assertEqual(self.gate.strikes, 1)

    def test_other_errors_pass_through_without_cooldown(self):
        def broken(log):
            raise ValueError("Video unavailable")
        with self.assertRaises(ValueError):
            self.run_gate(broken)
        self.assertEqual(self.gate.remaining(), 0)

    def test_concurrency_cap(self):
        active = {"now": 0, "max": 0}

        def slow(log):
            active["now"] += 1
            active["max"] = max(active["max"], active["now"])
            time.sleep(0.02)
            active["now"] -= 1

        async def run():
            await asyncio.gather(*(self.gate.run(slow) for _ in range(6)))

        asyncio.run(run())
        self.assertEqual(active["max"], 2)


class RouterTests(unittest.TestCase):
    def setUp(self):
        import routers.youtube as yt
        self.yt = yt
        yt._stream_cache.clear()
        yt._stream_inflight.clear()
        yt._search_cache.clear()
        yt._radio_cache.clear()
        yt._radio_inflight.clear()
        ytguard.gate.reset()

    tearDown = setUp

    def test_simultaneous_plays_share_one_extraction(self):
        calls = []

        async def fake_extract(video_id):
            calls.append(video_id)
            await asyncio.sleep(0.02)
            return {"stream_url": "u", "title": "t"}

        async def run():
            return await asyncio.gather(*(self.yt._resolve_stream("aaaaaaaaaaa") for _ in range(3)))

        with mock.patch.object(self.yt, "_extract_stream", fake_extract):
            results = asyncio.run(run())
        self.assertEqual(calls, ["aaaaaaaaaaa"])
        self.assertEqual({r["stream_url"] for r in results}, {"u"})

    def test_cache_lasts_until_shortly_before_youtube_expiry(self):
        now = 1_000_000.0
        url = f"https://rr1.googlevideo.com/videoplayback?expire={int(now + 6 * 3600)}&id=x"
        entry = self.yt._cache_stream("aaaaaaaaaaa", {"stream_url": url}, now)
        self.assertEqual(entry["expires_at"] - now, self.yt.STREAM_CACHE_MAX_TTL)
        self.assertEqual(entry["usable_until"], now + 6 * 3600 - 60)
        short = f"https://x/videoplayback?expire={int(now + 120)}"
        self.assertLessEqual(self.yt._cache_stream("b", {"stream_url": short}, now)["expires_at"], now + 120)
        self.assertEqual(self.yt._cache_stream("c", {"stream_url": "https://x/no-expiry"}, now)["expires_at"],
                         now + self.yt.CACHE_TTL_SECONDS)

    def test_rate_limit_reuses_an_unexpired_url_but_fresh_gets_429(self):
        now = time.time()
        self.yt._stream_cache["aaaaaaaaaaa"] = {
            "data": {"stream_url": "old"}, "fetched_at": now - 5 * 3600,
            "expires_at": now - 60, "usable_until": now + 600,
        }

        async def busy(video_id):
            raise YouTubeBusy(30)

        with mock.patch.object(self.yt, "_extract_stream", busy):
            self.assertEqual(asyncio.run(self.yt._resolve_stream("aaaaaaaaaaa"))["stream_url"], "old")
            with self.assertRaises(HTTPException) as ctx:
                asyncio.run(self.yt._resolve_stream("aaaaaaaaaaa", fresh=True))
        self.assertEqual(ctx.exception.status_code, 429)
        self.assertEqual(ctx.exception.headers["Retry-After"], "30")

    def test_fresh_reuses_a_seconds_old_extraction(self):
        self.yt._stream_cache["aaaaaaaaaaa"] = {
            "data": {"stream_url": "new"}, "fetched_at": time.time(),
            "expires_at": time.time() + 3600, "usable_until": time.time() + 3600,
        }

        async def never(video_id):
            raise AssertionError("should not extract again")

        with mock.patch.object(self.yt, "_extract_stream", never):
            self.assertEqual(asyncio.run(self.yt._resolve_stream("aaaaaaaaaaa", fresh=True))["stream_url"], "new")

    def test_search_serves_older_results_during_a_rate_limit(self):
        from schemas import YouTubeSearchResult
        old = [YouTubeSearchResult(youtube_id="aaaaaaaaaaa", title="Kesariya", channel="c", duration=1, thumbnail="t")]
        self.yt._search_cache["kesariya"] = {"data": old, "limit": 8, "expires_at": time.time() - 60}

        class BusyGate:
            async def run(self, fn):
                raise YouTubeBusy(40)

        with mock.patch.object(self.yt, "gate", BusyGate()):
            self.assertEqual(asyncio.run(self.yt.search_videos("Kesariya", 8)), old)
            with self.assertRaises(HTTPException) as ctx:
                asyncio.run(self.yt.search_videos("something new", 8))
        self.assertEqual(ctx.exception.status_code, 429)
        self.assertIn("40 seconds", ctx.exception.detail)

    def test_old_search_and_radio_results_are_kept_a_while(self):
        now = time.time()
        self.yt._search_cache["recent"] = {"data": [], "limit": 8, "expires_at": now - 60}
        self.yt._search_cache["ancient"] = {"data": [], "limit": 8, "expires_at": now - self.yt.STALE_GRACE_SECONDS - 1}
        self.yt._stream_cache["dead"] = {"data": {}, "fetched_at": 0, "expires_at": 0, "usable_until": now - 1}
        self.assertEqual(self.yt._evict_dead_entries(now), 2)
        self.assertEqual(list(self.yt._search_cache), ["recent"])


class ImportSearchTests(unittest.TestCase):
    def test_waits_out_a_short_rate_limit(self):
        from importer import match
        import routers.youtube as yt
        attempts = []
        slept = []

        async def flaky(query, limit):
            attempts.append(query)
            if len(attempts) < 3:
                raise HTTPException(status_code=429, detail="busy", headers={"Retry-After": "5"})
            return []

        async def fake_sleep(s):
            slept.append(s)

        with mock.patch.object(yt, "search_videos", flaky):
            self.assertEqual(asyncio.run(match.search("q", sleep=fake_sleep)), [])
        self.assertEqual(slept, [5.0, 5.0])

    def test_long_rate_limit_fails_the_search(self):
        from importer import match
        import routers.youtube as yt

        async def limited(query, limit):
            raise HTTPException(status_code=429, detail="busy", headers={"Retry-After": "600"})

        async def fake_sleep(s):
            raise AssertionError("should not wait 10 minutes")

        with mock.patch.object(yt, "search_videos", limited):
            with self.assertRaises(match.SearchError):
                asyncio.run(match.search("q", sleep=fake_sleep))


if __name__ == "__main__":
    unittest.main()
