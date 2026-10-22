"""A Supabase hiccup must not sign people out: only a rejected token is a 401."""
import asyncio
import os
import unittest
from unittest import mock

os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_KEY", "test")

import httpx  # noqa: E402
from fastapi import HTTPException  # noqa: E402

import auth  # noqa: E402


class FakeClient:
    def __init__(self, response=None, exc=None):
        self.response, self.exc = response, exc

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_):
        return False

    async def get(self, *_a, **_k):
        if self.exc:
            raise self.exc
        return self.response


def run_with(response=None, exc=None):
    with mock.patch.object(auth.httpx, "AsyncClient", lambda **_k: FakeClient(response, exc)):
        return asyncio.run(auth._verify_token("tok"))


class AuthOutageTests(unittest.TestCase):
    def test_valid_token(self):
        self.assertEqual(run_with(httpx.Response(200, json={"id": "u1"}))["id"], "u1")

    def test_rejected_token_is_none_so_401(self):
        self.assertIsNone(run_with(httpx.Response(401)))
        self.assertIsNone(run_with(httpx.Response(403)))

    def test_supabase_down_or_slow_is_503_not_401(self):
        for resp, exc in ((httpx.Response(500), None), (httpx.Response(429), None), (httpx.Response(502), None),
                          (None, httpx.ConnectTimeout("slow")), (None, httpx.ConnectError("down"))):
            with self.assertRaises(HTTPException) as ctx:
                run_with(resp, exc)
            self.assertEqual(ctx.exception.status_code, 503)


if __name__ == "__main__":
    unittest.main()
