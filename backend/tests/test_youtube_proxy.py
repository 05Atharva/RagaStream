"""YTDLP_PROXY: yt-dlp and the audio relay must leave through the same proxy
(YouTube locks each audio URL to the IP that extracted it)."""
import asyncio
import http.server
import threading
import unittest
from unittest import mock

import httpx
import yt_dlp

import routers.youtube as yt


class _RecordingProxy(http.server.BaseHTTPRequestHandler):
    """A forward HTTP proxy that answers every request itself and remembers it."""
    seen: list = []

    def do_GET(self):
        type(self).seen.append(self.path)  # a proxy sees the absolute URL
        body = b"via proxy"
        self.send_response(200)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


class ProxySettingTests(unittest.TestCase):
    def test_reads_supported_schemes_only(self):
        self.assertIsNone(yt._read_proxy(None))
        self.assertIsNone(yt._read_proxy("  "))
        self.assertIsNone(yt._read_proxy("ftp://host:21"))
        self.assertIsNone(yt._read_proxy("host:8080"))
        for url in ("http://u:p@host:8080", "socks5://host:1080", "socks5h://u:p@host:1080"):
            self.assertEqual(yt._read_proxy(f" {url} "), url)

    def test_httpx_gets_plain_socks5(self):
        self.assertEqual(yt._httpx_proxy("socks5h://u:p@host:1080"), "socks5://u:p@host:1080")
        self.assertEqual(yt._httpx_proxy("http://host:8080"), "http://host:8080")
        self.assertIsNone(yt._httpx_proxy(None))

    def test_yt_dlp_options(self):
        with mock.patch.object(yt, "YTDLP_PROXY", "socks5h://host:1080"):
            self.assertEqual(yt._ydl_opts_base()["proxy"], "socks5h://host:1080")
        with mock.patch.object(yt, "YTDLP_PROXY", None):
            self.assertNotIn("proxy", yt._ydl_opts_base())

    def test_socks_proxies_are_supported_by_httpx(self):
        async def build():
            async with httpx.AsyncClient(proxy="socks5://u:p@127.0.0.1:1080"):
                pass
        asyncio.run(build())  # raises ImportError without httpx[socks]


class ThroughARealProxyTests(unittest.TestCase):
    def setUp(self):
        _RecordingProxy.seen = []
        self.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), _RecordingProxy)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.proxy = f"http://127.0.0.1:{self.server.server_address[1]}"

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()

    def test_yt_dlp_requests_go_through_the_proxy(self):
        with mock.patch.object(yt, "YTDLP_PROXY", self.proxy):
            opts = yt._ydl_opts_base()
        with yt_dlp.YoutubeDL(opts) as ydl:
            body = ydl.urlopen("http://youtube.invalid/watch?v=x").read()
        self.assertEqual(body, b"via proxy")
        self.assertEqual(_RecordingProxy.seen, ["http://youtube.invalid/watch?v=x"])

    def test_relay_reads_go_through_the_proxy(self):
        async def read():
            async with httpx.AsyncClient(proxy=yt._httpx_proxy(self.proxy)) as client:
                return (await client.get("http://googlevideo.invalid/videoplayback?id=1")).content

        self.assertEqual(asyncio.run(read()), b"via proxy")
        self.assertEqual(_RecordingProxy.seen, ["http://googlevideo.invalid/videoplayback?id=1"])

    def test_size_probe_uses_the_relay_proxy(self):
        with mock.patch.object(yt, "RELAY_PROXY", self.proxy):
            asyncio.run(yt._probe_size("http://googlevideo.invalid/videoplayback?id=2", {}))
        self.assertEqual(_RecordingProxy.seen, ["http://googlevideo.invalid/videoplayback?id=2"])


if __name__ == "__main__":
    unittest.main()
