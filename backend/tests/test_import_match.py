"""Matching: similarity, scoring signals, ranking and the search loop (no network)."""
import asyncio
import os
import unittest

os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_KEY", "test")

from importer import match  # noqa: E402
from importer.match import (  # noqa: E402
    ACCEPT, SearchError, core_title, find_match, pick_best, queries_for, rank_candidates, score_candidate,
    token_set_ratio, token_sort_ratio, tokens,
)
from importer.types import SourceTrack  # noqa: E402
from schemas import YouTubeSearchResult  # noqa: E402


def yt(vid, title, channel, duration):
    return YouTubeSearchResult(youtube_id=vid, title=title, channel=channel, duration=duration,
                               thumbnail=f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg")


class SimilarityTests(unittest.TestCase):
    def test_tokens_handle_accents_punctuation_and_devanagari(self):
        self.assertEqual(tokens("Beyoncé – Halo (Live!)"), ["beyonce", "halo", "live"])
        self.assertEqual(tokens("कैसरिया"), ["कैसरिया"])       # combining vowel signs stay inside the word

    def test_token_set_ignores_order_and_extra_words(self):
        self.assertEqual(token_set_ratio("Kesariya", "kesariya"), 1.0)
        self.assertEqual(token_set_ratio("Arijit Singh Kesariya", "Kesariya Arijit Singh"), 1.0)
        self.assertEqual(token_set_ratio("Kesariya", "Kesariya Brahmastra Arijit"), 1.0)   # subset: sort ratio guards this
        self.assertGreater(token_set_ratio("Kesaria", "Kesariya"), 0.85)
        self.assertLess(token_set_ratio("Kesariya", "Tum Hi Ho"), 0.4)
        self.assertEqual(token_set_ratio("", "x"), 0.0)

    def test_token_sort_penalises_extra_words(self):
        self.assertLess(token_sort_ratio("Love", "Love Me Like You Do"), 0.5)

    def test_core_title_drops_movie_and_feat_tags(self):
        self.assertEqual(core_title('Kesariya - From "Brahmastra"'), "Kesariya")
        self.assertEqual(core_title("Tum Hi Ho (From “Aashiqui 2”)"), "Tum Hi Ho")
        self.assertEqual(core_title("Dreams - 2004 Remaster"), "Dreams")
        self.assertEqual(core_title("Love Story (feat. X)"), "Love Story")
        self.assertEqual(core_title("Sunflower - Spider-Man: Into the Spider-Verse"), "Sunflower - Spider-Man: Into the Spider-Verse")


class ScoreTests(unittest.TestCase):
    ARTIST = ["Arijit Singh"]

    def score(self, cand_title, channel, duration, title="Kesariya", artists=None, src_duration=268):
        return score_candidate(title, artists or self.ARTIST, src_duration, cand_title, channel, duration)

    def test_right_song_beats_cover_and_slowed(self):
        results = [
            yt("cover", "Kesariya (Cover) | Brahmastra", "Some Singer", 270),
            yt("slow", "Kesariya (Slowed + Reverb)", "Lofi Hub", 330),
            yt("live", "Arijit Singh - Kesariya (Live at Arena)", "Concert Clips", 300),
            yt("right", "Kesariya (From \"Brahmastra\")", "Arijit Singh - Topic", 268),
        ]
        ranked = rank_candidates("Kesariya", self.ARTIST, 268, results)
        self.assertEqual(ranked[0][1].youtube_id, "right")
        self.assertGreaterEqual(ranked[0][0], 0.85)
        for score, cand in ranked[1:]:
            self.assertLess(score, ACCEPT, cand.youtube_id)

    def test_variants_are_allowed_when_the_source_asks_for_them(self):
        slowed = self.score("Kesariya (Slowed + Reverb)", "Lofi Hub", 268, title="Kesariya (Slowed + Reverb)")
        plain = self.score("Kesariya", "Lofi Hub", 268, title="Kesariya (Slowed + Reverb)")
        self.assertGreaterEqual(slowed, ACCEPT)
        self.assertLess(plain, slowed)       # source wants slowed; the original is penalised

    def test_each_hard_variant_is_penalised(self):
        base = self.score("Kesariya", "Arijit Singh - Topic", 268)
        for word in ("Remix", "Karaoke", "8D Audio", "Instrumental", "Sped Up", "Bass Boosted", "Acoustic", "Sad Version"):
            self.assertLess(self.score(f"Kesariya ({word})", "Arijit Singh - Topic", 268), base - 0.2, word)

    def test_topic_channel_wins_over_fan_lyrics_upload(self):
        topic = self.score("Tujhko (From “Cocktail 2”)", "Release - Topic", 343, title="Tujhko", artists=["Pritam", "Arijit Singh"], src_duration=342)
        fan = self.score("Pritam, Arijit Singh - Tujhko (Lyrics)", "Vibe Bird Play", 343, title="Tujhko", artists=["Pritam", "Arijit Singh"], src_duration=342)
        self.assertGreater(topic, fan)

    def test_official_and_label_channels_get_a_small_bonus(self):
        fan = self.score("Kesariya", "Random Uploads", 268)
        label = self.score("Kesariya", "T-Series", 268)
        vevo = self.score("Kesariya", "SonyMusicIndiaVEVO", 268)
        self.assertGreater(label, fan - 0.01)
        self.assertGreater(vevo, fan)

    def test_duration_breaks_ties_and_far_durations_hurt(self):
        near = self.score("Kesariya", "Arijit Singh", 270)
        ok = self.score("Kesariya", "Arijit Singh", 282)
        mid = self.score("Kesariya", "Arijit Singh", 310)
        far = self.score("Kesariya", "Arijit Singh", 420)
        self.assertGreater(near, ok)
        self.assertGreater(ok, mid)
        self.assertGreater(mid, far)
        self.assertGreater(near - far, 0.2)

    def test_equal_text_two_durations_pick_the_closer(self):
        results = [yt("a", "Kesariya", "Arijit Singh", 340), yt("b", "Kesariya", "Arijit Singh", 266)]
        self.assertEqual(rank_candidates("Kesariya", self.ARTIST, 268, results)[0][1].youtube_id, "b")

    def test_exact_ties_keep_search_order(self):
        results = [yt("a", "Kesariya", "Arijit Singh", 268), yt("b", "Kesariya", "Arijit Singh", 268)]
        self.assertEqual(rank_candidates("Kesariya", self.ARTIST, 268, results)[0][1].youtube_id, "a")

    def test_wrong_song_by_the_same_artist_is_rejected(self):
        self.assertLess(self.score("Arijit Singh - Tum Hi Ho", "Arijit Singh - Topic", 262), ACCEPT)

    def test_non_music_and_compilations_are_rejected(self):
        self.assertLess(self.score("Kesariya REACTION | Arijit Singh", "Reactor", 268), ACCEPT)
        self.assertLess(self.score("Kesariya Jukebox | Best of Arijit Singh", "T-Series", 3600), ACCEPT)

    def test_lyrics_duplicate_scores_below_the_official_upload(self):
        official = self.score("Kesariya (Official Audio)", "Sony Music India", 268)
        lyrics = self.score("Kesariya (Lyrics)", "Sony Music India", 268)
        self.assertGreater(official, lyrics)

    def test_label_channel_without_artist_name_is_neutral_not_fatal(self):
        s = self.score("Kesariya Full Audio", "T-Series", 268)
        self.assertGreaterEqual(s, ACCEPT)

    def test_unknown_duration_still_matches_a_clean_hit(self):
        s = score_candidate("Kesariya", self.ARTIST, None, "Arijit Singh - Kesariya (Official Video)", "Arijit Singh", 268)
        self.assertGreaterEqual(s, ACCEPT)

    def test_score_stays_in_range(self):
        for args in (("Kesariya", "Arijit Singh - Topic", 268), ("Remix Live Cover Karaoke 8D", "x", 5000)):
            s = self.score(args[0], args[1], args[2])
            self.assertTrue(0.0 <= s <= 1.0)


class AmbiguousOrderTests(unittest.TestCase):
    def test_pick_best_reads_the_line_in_the_order_the_results_support(self):
        track = SourceTrack(title="Arijit Singh", artists=["Kesariya"], alt_title="Kesariya", alt_artists=["Arijit Singh"])
        results = [yt("right", "Kesariya", "Arijit Singh - Topic", 268)]
        best = pick_best(track, results)
        self.assertEqual((best.candidate.youtube_id, best.title), ("right", "Kesariya"))
        self.assertGreaterEqual(best.confidence, ACCEPT)

    def test_queries_for_include_both_orders_once_each(self):
        track = SourceTrack(title="Kesariya", artists=["Arijit Singh"], alt_title="Arijit Singh", alt_artists=["Kesariya"])
        qs = queries_for(track)
        self.assertEqual(qs[0], "Kesariya Arijit Singh")
        self.assertIn("Arijit Singh Kesariya", qs)
        self.assertEqual(len(qs), len({q.casefold() for q in qs}))

    def test_queries_for_plain_track(self):
        track = SourceTrack(title='Kesariya - From "Brahmastra"', artists=["Arijit Singh", "Pritam"])
        self.assertEqual(queries_for(track), ["Kesariya Arijit Singh", "Kesariya Arijit Singh Pritam audio"])


class FindMatchTests(unittest.TestCase):
    def run_find(self, track, answers):
        calls = []

        async def fake_search(query):
            calls.append(query)
            answer = answers[min(len(calls) - 1, len(answers) - 1)]
            if isinstance(answer, Exception):
                raise answer
            return answer

        return asyncio.run(find_match(track, search_fn=fake_search)), calls

    TRACK = SourceTrack(title="Kesariya", artists=["Arijit Singh"], duration_sec=268)

    def test_stops_after_the_first_good_query(self):
        (best, failed), calls = self.run_find(self.TRACK, [[yt("ok", "Kesariya", "Arijit Singh - Topic", 268)]])
        self.assertEqual((best.candidate.youtube_id, failed, len(calls)), ("ok", False, 1))

    def test_falls_back_to_the_audio_query(self):
        weak = [yt("bad", "Something Else Entirely", "Nobody", 100)]
        good = [yt("ok", "Kesariya", "Arijit Singh - Topic", 268)]
        (best, failed), calls = self.run_find(self.TRACK, [weak, good])
        self.assertEqual(best.candidate.youtube_id, "ok")
        self.assertEqual(len(calls), 2)
        self.assertTrue(calls[1].endswith("audio"))

    def test_nothing_good_returns_the_best_weak_match_for_the_confidence(self):
        weak = [yt("bad", "Kesariya REACTION", "Nobody", 100)]
        (best, failed), _ = self.run_find(self.TRACK, [weak])
        self.assertLess(best.confidence, ACCEPT)
        self.assertFalse(failed)

    def test_no_results_at_all(self):
        (best, failed), _ = self.run_find(self.TRACK, [[]])
        self.assertEqual((best, failed), (None, False))

    def test_all_searches_erroring_is_reported_as_search_failure(self):
        (best, failed), calls = self.run_find(self.TRACK, [SearchError("down")])
        self.assertEqual((best, failed), (None, True))
        self.assertEqual(len(calls), 2)

    def test_one_error_then_a_hit_is_a_normal_match(self):
        (best, failed), _ = self.run_find(self.TRACK, [SearchError("blip"), [yt("ok", "Kesariya", "Arijit Singh - Topic", 268)]])
        self.assertEqual((best.candidate.youtube_id, failed), ("ok", False))


class SearchLimitTests(unittest.TestCase):
    def test_global_cap_is_four_at_once(self):
        active = {"now": 0, "max": 0}

        async def fake_search_videos(query, limit):
            active["now"] += 1
            active["max"] = max(active["max"], active["now"])
            await asyncio.sleep(0.01)
            active["now"] -= 1
            return []

        async def run():
            import routers.youtube as yt_router
            original = yt_router.search_videos
            yt_router.search_videos = fake_search_videos
            try:
                await asyncio.gather(*(match.search(f"q{i}") for i in range(12)))
            finally:
                yt_router.search_videos = original

        asyncio.run(run())
        self.assertEqual(active["max"], match.GLOBAL_SEARCHES)


if __name__ == "__main__":
    unittest.main()
