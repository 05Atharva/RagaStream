"""Render mounts secret files read-only; yt-dlp writes cookies back on close and used to crash."""
import os
import stat
import tempfile
import unittest

from routers.youtube import _count_youtube_cookies, _usable_cookie_file

COOKIES = "# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t0\tPREF\tf1=1\n.youtube.com\tTRUE\t/\tTRUE\t0\tSID\tabc\n"


class CookieFileTests(unittest.TestCase):
    def setUp(self):
        fd, self.path = tempfile.mkstemp(suffix="-cookies.txt")
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(COOKIES)

    def tearDown(self):
        os.chmod(self.path, stat.S_IREAD | stat.S_IWRITE)
        os.remove(self.path)

    def test_writable_file_is_used_as_is(self):
        self.assertEqual(_usable_cookie_file(self.path), self.path)

    def test_read_only_file_is_copied_somewhere_writable(self):
        os.chmod(self.path, stat.S_IREAD)
        used = _usable_cookie_file(self.path)
        self.assertNotEqual(used, self.path)
        self.assertTrue(os.access(used, os.W_OK))
        with open(used, encoding="utf-8") as f:
            self.assertEqual(f.read(), COOKIES)

    def test_missing_or_unset_means_no_cookies(self):
        self.assertIsNone(_usable_cookie_file(self.path + ".missing"))
        self.assertIsNone(_usable_cookie_file(None))

    def test_counts_youtube_cookies_without_reading_values_out(self):
        self.assertEqual(_count_youtube_cookies(self.path), 2)
        self.assertEqual(_count_youtube_cookies(None), 0)


if __name__ == "__main__":
    unittest.main()
