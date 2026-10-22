"""Seeds for "Because you played …" rows must be real song titles (found in the live catalogue)."""
import unittest

from recs.profile import SongMeta
from recs.surfaces import _titled


def meta(title: str, channel: str = "Unknown") -> SongMeta:
    return SongMeta(youtube_id="abc123", title=title, channel=channel, duration=200, thumbnail="")


class TitledSeedTests(unittest.TestCase):
    def test_label_name_as_title_is_rejected(self):
        self.assertFalse(_titled(meta("T-Series")))
        self.assertFalse(_titled(meta("Zee Music Company")))

    def test_blank_or_unknown_title_is_rejected(self):
        self.assertFalse(_titled(meta("")))
        self.assertFalse(_titled(meta("Unknown")))

    def test_real_titles_pass(self):
        self.assertTrue(_titled(meta("Kesariya", "Arijit Singh · Brahmāstra")))
        self.assertTrue(_titled(meta("Aashiqui 2: Tum Hi Ho 8K Full Song | Aditya Roy Kapur", "T-Series")))


if __name__ == "__main__":
    unittest.main()
