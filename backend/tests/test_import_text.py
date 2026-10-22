"""Pasted song lists: formats, noise, ambiguity, caps."""
import os
import unittest

os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_KEY", "test")

from importer.textparse import parse_line, parse_text, split_artists, youtube_video_id  # noqa: E402


class ParseLineTests(unittest.TestCase):
    def test_song_dash_artist_keeps_both_readings(self):
        t = parse_line("Kesariya - Arijit Singh")
        self.assertEqual((t.title, t.artists), ("Kesariya", ["Arijit Singh"]))
        self.assertEqual((t.alt_title, t.alt_artists), ("Arijit Singh", ["Kesariya"]))

    def test_en_dash_and_em_dash_and_pipe(self):
        for sep in ("–", "—", "|"):
            t = parse_line(f"Tum Hi Ho {sep} Arijit Singh")
            self.assertEqual(t.title, "Tum Hi Ho", sep)
            self.assertEqual(t.artists, ["Arijit Singh"], sep)

    def test_hyphen_inside_a_word_is_not_a_separator(self):
        t = parse_line("Sachin-Jigar Mashup")
        self.assertEqual(t.title, "Sachin-Jigar Mashup")
        self.assertIsNone(t.alt_title)

    def test_numbering_and_bullets_are_dropped(self):
        for line in ("1. Kesariya by Arijit Singh", "12) Kesariya by Arijit Singh", "- Kesariya by Arijit Singh",
                     "• Kesariya by Arijit Singh", "03 - Kesariya by Arijit Singh"):
            t = parse_line(line)
            self.assertEqual((t.title, t.artists), ("Kesariya", ["Arijit Singh"]), line)

    def test_by_splits_on_the_last_by(self):
        t = parse_line("Stand by Me by Ben E. King")
        self.assertEqual((t.title, t.artists), ("Stand by Me", ["Ben E. King"]))

    def test_feat_stays_in_the_title(self):
        t = parse_line("Love Me Like You Do (feat. Ellie) - Ellie Goulding")
        self.assertEqual(t.title, "Love Me Like You Do (feat. Ellie)")
        self.assertEqual(t.artists, ["Ellie Goulding"])

    def test_timestamps_are_removed_and_trailing_one_becomes_duration(self):
        t = parse_line("0:00 Kesariya - Arijit Singh")
        self.assertEqual(t.title, "Kesariya")
        t = parse_line("Kesariya - Arijit Singh 4:28")
        self.assertEqual((t.title, t.duration_sec), ("Kesariya", 268))
        self.assertEqual(parse_line("[1:02:03] Long Song").title, "Long Song")

    def test_title_only_line(self):
        t = parse_line("Tum Hi Ho")
        self.assertEqual((t.title, t.artists, t.alt_title), ("Tum Hi Ho", [], None))

    def test_blank_and_junk_lines(self):
        for line in ("", "   ", "---", "•", "1.", "x" * 400):
            self.assertIsNone(parse_line(line), repr(line)[:20])

    def test_title_starting_with_a_number_survives(self):
        self.assertEqual(parse_line("7 Rings - Ariana Grande").title, "7 Rings")
        self.assertEqual(parse_line("1999 - Prince").title, "1999")

    def test_artist_lists(self):
        self.assertEqual(split_artists("Pritam, Arijit Singh & Shilpa Rao"), ["Pritam", "Arijit Singh", "Shilpa Rao"])
        self.assertEqual(split_artists("Pritam, pritam"), ["Pritam"])


class ParseTextTests(unittest.TestCase):
    def test_blank_lines_and_duplicates_are_dropped(self):
        tracks, links, truncated = parse_text("Kesariya - Arijit Singh\n\n\nkesariya - arijit singh\nTum Hi Ho\n")
        self.assertEqual([t.title for t in tracks], ["Kesariya", "Tum Hi Ho"])
        self.assertEqual((links, truncated), ([], False))

    def test_cap_at_500(self):
        text = "\n".join(f"Song {i} - Artist" for i in range(520))
        tracks, _links, truncated = parse_text(text)
        self.assertEqual(len(tracks), 500)
        self.assertTrue(truncated)

    def test_youtube_links_keep_their_place_in_order(self):
        text = "First Song\nhttps://www.youtube.com/watch?v=dQw4w9WgXcQ\nhttps://youtu.be/9bZkp7q19f0?t=3\nLast Song"
        tracks, links, _ = parse_text(text)
        self.assertEqual(len(tracks), 4)
        self.assertEqual(links, [(1, "dQw4w9WgXcQ"), (2, "9bZkp7q19f0")])
        self.assertEqual(tracks[1].youtube_id, "dQw4w9WgXcQ")
        self.assertEqual(tracks[3].title, "Last Song")

    def test_non_youtube_links_are_ignored(self):
        tracks, links, _ = parse_text("https://example.com/not-a-song\nKesariya")
        self.assertEqual([t.title for t in tracks], ["Kesariya"])

    def test_youtube_video_id_forms(self):
        ok = {
            "https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLabc": "dQw4w9WgXcQ",
            "https://music.youtube.com/watch?v=dQw4w9WgXcQ": "dQw4w9WgXcQ",
            "https://youtu.be/dQw4w9WgXcQ": "dQw4w9WgXcQ",
            "https://www.youtube.com/shorts/dQw4w9WgXcQ": "dQw4w9WgXcQ",
        }
        for url, vid in ok.items():
            self.assertEqual(youtube_video_id(url), vid, url)
        for url in ("https://www.youtube.com/playlist?list=PLabc", "https://evil.com/watch?v=dQw4w9WgXcQ",
                    "https://www.youtube.com/watch?v=short"):
            self.assertIsNone(youtube_video_id(url), url)


if __name__ == "__main__":
    unittest.main()
