"""Non-song uploads must not win a match or a recommendation (found live: "Pasoori" matched a BTS clip)."""
import unittest

from recs.text import is_non_music


class NonMusicTests(unittest.TestCase):
    def test_behind_the_scenes_and_rehearsals_are_not_songs(self):
        for title in ("BTS Of Pasoori | Ali Sethi and Shae Gill Rehearse", "Pasoori Rehearsal", "Behind The Scene - Kesariya",
                      "Kesariya guitar tutorial", "How to sing Tum Hi Ho", "Arijit Singh vlog", "Song breakdown explained"):
            self.assertTrue(is_non_music(title), title)

    def test_real_songs_still_pass(self):
        for title in ("Pasoori | Coke Studio | Season 14 | Ali Sethi x Shae Gill", "BTS (방탄소년단) 'Dynamite' Official MV",
                      "Kesariya - Brahmastra | Arijit Singh", "Tum Hi Ho Aashiqui 2 Full Song With Lyrics"):
            self.assertFalse(is_non_music(title), title)


if __name__ == "__main__":
    unittest.main()
