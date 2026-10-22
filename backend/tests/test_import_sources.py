"""Source adapters on saved, trimmed fixtures (tests/fixtures/import/), link classification, fetch safety."""
import asyncio
import json
import os
import unittest
from pathlib import Path
from unittest import mock

os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_KEY", "test")

import httpx  # noqa: E402

from importer import fetch, sources  # noqa: E402
from importer.errors import ImportFailure  # noqa: E402

FIXTURES = Path(__file__).parent / "fixtures" / "import"


def fixture(name: str) -> str:
    return (FIXTURES / name).read_text(encoding="utf8")


class SpotifyTests(unittest.TestCase):
    def test_playlist_embed(self):
        data = sources.parse_spotify_embed(fixture("spotify_embed_playlist.html"))
        self.assertEqual((data.source, data.name, data.owner), ("spotify", "Today’s Top Hits", "Spotify"))
        self.assertEqual(len(data.tracks), 3)            # the podcast episode is skipped
        first = data.tracks[0]
        self.assertEqual(first.title, "expectations (feat. Chappell Roan)")
        self.assertEqual(first.artists, ["Olivia Rodrigo", "Chappell Roan"])
        self.assertEqual(first.duration_sec, 224)
        self.assertIsNone(first.youtube_id)
        self.assertTrue(data.cover_url.startswith("https://i.scdn.co/"))
        self.assertFalse(data.partial)

    def test_album_embed_has_album_name_on_tracks(self):
        data = sources.parse_spotify_embed(fixture("spotify_embed_album.html"), "album")
        self.assertEqual(data.name, "Global Warming")
        self.assertEqual(data.owner, "Pitbull")
        self.assertTrue(all(t.album == "Global Warming" for t in data.tracks))

    def test_hundred_songs_means_partial_with_a_note(self):
        page = fixture("spotify_embed_playlist.html")
        doc = json.loads(page.split('type="application/json">')[1].split("</script>")[0])
        entity = doc["props"]["pageProps"]["state"]["data"]["entity"]
        entity["trackList"] = [
            {"uri": f"spotify:track:{i}", "title": f"Song {i}", "subtitle": "Artist", "duration": 200000} for i in range(100)
        ]
        big = '<script id="__NEXT_DATA__" type="application/json">' + json.dumps(doc) + "</script>"
        data = sources.parse_spotify_embed(big)
        self.assertTrue(data.partial)
        self.assertIn("first 100", data.note)
        self.assertIn("Paste the full list", data.note)

    def test_private_or_missing_playlist_says_what_to_do(self):
        for page in ("<html>nothing here</html>",
                     '<script id="__NEXT_DATA__" type="application/json">{"props":{}}</script>',
                     '<script id="__NEXT_DATA__" type="application/json">{not json</script>'):
            with self.assertRaises(ImportFailure) as ctx:
                sources.parse_spotify_embed(page)
            self.assertIn("paste the song list instead", ctx.exception.detail)


class AppleMusicTests(unittest.TestCase):
    def test_playlist_page(self):
        data = sources.parse_apple_music(fixture("apple_music_playlist.html"))
        self.assertEqual((data.source, data.name, data.owner), ("apple_music", "Today’s Hits", "Apple Music Hits"))
        self.assertEqual(len(data.tracks), 3)
        self.assertEqual(data.tracks[0].title, "expectations")
        self.assertEqual(data.tracks[0].artists, ["Olivia Rodrigo", "Chappell Roan"])
        self.assertEqual(data.tracks[0].album, "expectations - Single")
        self.assertEqual(data.tracks[0].duration_sec, 224)
        self.assertTrue(data.cover_url.startswith("https://is1-ssl.mzstatic.com/"))

    def test_page_listing_fewer_songs_than_declared_is_partial(self):
        data = sources.parse_apple_music(fixture("apple_music_playlist.html"))
        self.assertTrue(data.partial)       # fixture declares 50, lists 3
        self.assertIn("3 of 50", data.note)

    def test_falls_back_to_jsonld_tracks_without_server_data(self):
        page = fixture("apple_music_playlist.html")
        page = page[: page.index('<script type="application/json" id="serialized-server-data">')] + "</head></html>"
        data = sources.parse_apple_music(page)
        self.assertEqual(len(data.tracks), 3)
        self.assertEqual(data.tracks[0].duration_sec, 223)    # PT3M43S
        self.assertEqual(data.tracks[0].artists, [])

    def test_empty_page(self):
        with self.assertRaises(ImportFailure):
            sources.parse_apple_music("<html></html>")


class GenericTests(unittest.TestCase):
    def test_jsonld_music_album_with_listitems_and_graph(self):
        data = sources.parse_generic(fixture("generic_jsonld.html"))
        self.assertEqual((data.source, data.name, data.cover_url), ("jsonld", "Rockstar", "https://example.com/cover.jpg"))
        self.assertEqual([t.title for t in data.tracks], ["Kun Faya Kun", "Sadda Haq"])
        self.assertEqual(data.tracks[0].artists, ["A. R. Rahman", "Javed Ali"])
        self.assertEqual(data.tracks[0].duration_sec, 472)
        self.assertEqual(data.tracks[1].artists, ["A. R. Rahman"])      # falls back to the album artist
        self.assertTrue(data.partial)                                    # declares 3 tracks, lists 2

    def test_jiosaavn_page_state_with_js_literals(self):
        data = sources.parse_generic(fixture("jiosaavn_playlist.html"), "www.jiosaavn.com")
        self.assertEqual(data.name, "Arijit Singh - Love Songs - Hindi")
        self.assertEqual(len(data.tracks), 2)
        self.assertEqual(data.tracks[0].title, 'Shayad (From "Love Aaj Kal")')
        self.assertEqual(data.tracks[0].artists, ["Pritam", "Arijit Singh"])    # lyricist and cast left out
        self.assertEqual(data.tracks[0].duration_sec, 247)
        self.assertTrue(data.partial)                                            # list_count 30, two listed

    def test_jiosaavn_state_only_trusted_on_jiosaavn(self):
        with self.assertRaises(ImportFailure):
            sources.parse_generic(fixture("jiosaavn_playlist.html"), "evil.example")

    def test_page_without_tracks_suggests_pasting(self):
        with self.assertRaises(ImportFailure) as ctx:
            sources.parse_generic('<html><head><meta property="og:title" content="Nice page"></head></html>')
        self.assertIn("Paste the song list instead", ctx.exception.detail)

    def test_iso_durations(self):
        f = sources.iso_duration_seconds
        self.assertEqual((f("PT3M43S"), f("PT1H2M3S"), f("PT45S"), f("P0DT0H3M43S")), (223, 3723, 45, 223))
        self.assertIsNone(f("3:43"))
        self.assertIsNone(f(None))


class YouTubeTests(unittest.TestCase):
    def test_flat_playlist_skips_private_deleted_and_duplicates(self):
        info = json.loads(fixture("youtube_flat_playlist.json"))
        data = sources.build_youtube_source(info)
        self.assertEqual(data.source, "youtube")
        self.assertEqual([t.youtube_id for t in data.tracks], ["aaaaaaaaaaa", "ccccccccccc"])
        self.assertEqual(data.tracks[0].title, "Arijit Singh - Kesariya")       # "(Official Video)" cleaned
        self.assertEqual(data.tracks[1].artists, ["Arijit Singh"])             # " - Topic" cleaned
        self.assertEqual(data.tracks[1].duration_sec, 262)
        self.assertEqual(data.name, "Road trip")

    def test_nothing_playable_is_not_public(self):
        with self.assertRaises(ImportFailure):
            sources.build_youtube_source({"title": "x", "entries": [{"id": "bbbbbbbbbbb", "title": "[Private video]"}]})

    def test_server_cookies_are_never_used(self):
        with mock.patch.dict(os.environ, {"YTDLP_COOKIES_FILE": "cookies.txt"}):
            import routers.youtube as yt
            with mock.patch.object(yt, "YTDLP_COOKIES_FILE", "cookies.txt"):
                opts = sources._flat_opts()
        self.assertNotIn("cookiefile", opts)
        self.assertNotIn("cookiesfrombrowser", opts)
        self.assertEqual(opts["extract_flat"], "in_playlist")


class ClassifyTests(unittest.TestCase):
    def test_spotify_variants(self):
        for url in ("https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=abc",
                    "https://open.spotify.com/intl-hi/playlist/37i9dQZF1DXcBWIGoYBM5M",
                    "https://open.spotify.com/embed/playlist/37i9dQZF1DXcBWIGoYBM5M"):
            self.assertEqual(sources.classify(url), ("spotify", {"kind": "playlist", "id": "37i9dQZF1DXcBWIGoYBM5M"}), url)
        self.assertEqual(sources.classify("https://open.spotify.com/album/4aawyAB9vmqN3uQ7FjRGTy")[1]["kind"], "album")

    def test_spotify_track_is_not_a_playlist(self):
        with self.assertRaises(ImportFailure) as ctx:
            sources.classify("https://open.spotify.com/track/4aawyAB9vmqN3uQ7FjRGTy")
        self.assertIn("not a playlist or album", ctx.exception.detail)

    def test_youtube_playlist_links(self):
        for url in ("https://www.youtube.com/playlist?list=PLMC9KNkIncKvYin_USF1qoJQnIyMAfRxl",
                    "https://music.youtube.com/playlist?list=PLMC9KNkIncKvYin_USF1qoJQnIyMAfRxl",
                    "https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLMC9KNkIncKvYin_USF1qoJQnIyMAfRxl"):
            self.assertEqual(sources.classify(url), ("youtube", {"list": "PLMC9KNkIncKvYin_USF1qoJQnIyMAfRxl"}), url)

    def test_single_youtube_video_is_refused_with_advice(self):
        with self.assertRaises(ImportFailure) as ctx:
            sources.classify("https://www.youtube.com/watch?v=dQw4w9WgXcQ")
        self.assertIn("single video", ctx.exception.detail)

    def test_apple_and_generic(self):
        self.assertEqual(sources.classify("https://music.apple.com/in/playlist/x/pl.abc")[0], "apple")
        self.assertEqual(sources.classify("https://music.apple.com/in/album/x/123")[0], "apple")
        with self.assertRaises(ImportFailure):
            sources.classify("https://music.apple.com/in/album/x/123?i=456")      # a single song
        with self.assertRaises(ImportFailure):
            sources.classify("https://music.apple.com/in/artist/x/123")
        self.assertEqual(sources.classify("https://www.jiosaavn.com/featured/x/abc__")[0], "generic")

    def test_not_a_link(self):
        with self.assertRaises(ImportFailure):
            sources.classify("ftp://example.com/x")


class LoadSourceTests(unittest.TestCase):
    def setUp(self):
        sources._source_cache.clear()

    def run_async(self, coro):
        return asyncio.run(coro)

    def test_spotify_goes_through_the_embed_page_without_the_query_string(self):
        seen = []

        async def fake_fetch(url):
            seen.append(url)
            return url, fixture("spotify_embed_playlist.html")

        with mock.patch.object(sources, "fetch_page", fake_fetch):
            data = self.run_async(sources.load_source("https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=secret"))
        self.assertEqual(seen, ["https://open.spotify.com/embed/playlist/37i9dQZF1DXcBWIGoYBM5M"])
        self.assertEqual(data.source, "spotify")

    def test_second_load_comes_from_cache(self):
        calls = []

        async def fake_fetch(url):
            calls.append(url)
            return url, fixture("apple_music_playlist.html")

        with mock.patch.object(sources, "fetch_page", fake_fetch):
            for _ in range(2):
                self.run_async(sources.load_source("https://music.apple.com/us/playlist/todays-hits/pl.abc"))
        self.assertEqual(len(calls), 1)

    def test_link_pasted_into_the_text_box_is_still_a_link(self):
        async def fake_fetch(url):
            return url, fixture("generic_jsonld.html")

        with mock.patch.object(sources, "fetch_page", fake_fetch):
            data = self.run_async(sources.load_source(text="  https://example.org/album/rockstar \n"))
        self.assertEqual(data.name, "Rockstar")

    def test_pasted_text_and_youtube_links(self):
        async def fake_oembed(vid):
            return {"title": "Kesariya (Official Video)", "author": "Sony Music India"} if vid == "dQw4w9WgXcQ" else None

        text = "Tum Hi Ho - Arijit Singh\nhttps://youtu.be/dQw4w9WgXcQ\nhttps://youtu.be/9bZkp7q19f0\n"
        with mock.patch.object(sources, "_oembed", fake_oembed):
            data = self.run_async(sources.load_source(text=text))
        self.assertEqual(data.source, "text")
        self.assertEqual([t.title for t in data.tracks], ["Tum Hi Ho", "Kesariya"])
        self.assertEqual(data.tracks[1].youtube_id, "dQw4w9WgXcQ")
        self.assertIn("1 YouTube link couldn't be read", data.note)

    def test_text_with_nothing_usable(self):
        with self.assertRaises(ImportFailure):
            self.run_async(sources.load_source(text="---\n1.\n"))

    def test_text_over_500_lines_is_partial(self):
        text = "\n".join(f"Song {i} - Artist" for i in range(501))
        data = self.run_async(sources.load_source(text=text))
        self.assertEqual((len(data.tracks), data.partial), (500, True))


class FetchSafetyTests(unittest.TestCase):
    def test_log_url_strips_queries_but_keeps_youtube_list(self):
        self.assertEqual(fetch.safe_url_for_log("https://open.spotify.com/playlist/abc?si=SECRET&token=x"),
                         "https://open.spotify.com/playlist/abc")
        self.assertEqual(fetch.safe_url_for_log("https://www.youtube.com/playlist?list=PLabc&si=SECRET"),
                         "https://www.youtube.com/playlist?list=PLabc")
        self.assertNotIn("user", fetch.safe_url_for_log("https://user:pw@example.com/x#frag"))

    def test_private_addresses_are_refused(self):
        for host in ("127.0.0.1", "10.0.0.5", "192.168.1.1", "169.254.169.254", "::1", "0.0.0.0"):
            with self.assertRaises(ImportFailure, msg=host):
                asyncio.run(fetch.check_public_host(host, 443))
        with self.assertRaises(ImportFailure):
            asyncio.run(fetch.check_public_host("93.184.216.34", 8080))      # odd port
        asyncio.run(fetch.check_public_host("93.184.216.34", 443))           # public address is fine

    def _client(self, handler):
        return lambda: httpx.AsyncClient(transport=httpx.MockTransport(handler), follow_redirects=False)

    def test_redirect_to_a_private_host_is_blocked(self):
        def handler(request):
            return httpx.Response(302, headers={"location": "http://127.0.0.1/admin"})

        with mock.patch.object(fetch, "_make_client", self._client(handler)), \
                mock.patch.object(fetch, "check_public_host", wraps=fetch.check_public_host) as check:
            async def run():
                # first hop is a literal public IP so no DNS is needed
                return await fetch.fetch_page("https://93.184.216.34/start")

            with self.assertRaises(ImportFailure):
                asyncio.run(run())
            self.assertEqual(check.call_count, 2)

    def test_page_over_the_size_cap_is_refused(self):
        big = b"x" * (fetch.MAX_PAGE_BYTES + 10)

        def handler(request):
            return httpx.Response(200, content=big)

        with mock.patch.object(fetch, "_make_client", self._client(handler)):
            with self.assertRaises(ImportFailure) as ctx:
                asyncio.run(fetch.fetch_page("https://93.184.216.34/big"))
        self.assertIn("too large", ctx.exception.detail)

    def test_error_status_and_normal_page(self):
        def handler(request):
            if request.url.path == "/missing":
                return httpx.Response(404)
            return httpx.Response(200, text="<html>ok</html>")

        with mock.patch.object(fetch, "_make_client", self._client(handler)):
            with self.assertRaises(ImportFailure):
                asyncio.run(fetch.fetch_page("https://93.184.216.34/missing"))
            final, text = asyncio.run(fetch.fetch_page("https://93.184.216.34/page"))
        self.assertEqual((final, text), ("https://93.184.216.34/page", "<html>ok</html>"))

    def test_only_a_browser_user_agent_is_sent(self):
        seen = {}

        def handler(request):
            seen.update(request.headers)
            return httpx.Response(200, text="ok")

        def client():
            return httpx.AsyncClient(transport=httpx.MockTransport(handler), headers={"User-Agent": fetch.USER_AGENT})

        with mock.patch.object(fetch, "_make_client", client):
            asyncio.run(fetch.fetch_page("https://93.184.216.34/"))
        self.assertTrue(seen["user-agent"].startswith("Mozilla/5.0"))
        self.assertNotIn("authorization", seen)
        self.assertNotIn("cookie", seen)


if __name__ == "__main__":
    unittest.main()
