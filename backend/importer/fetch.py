"""
One ordinary HTTPS GET of a public page, the way a browser opening the link would.

Rules (docs: backend/README.md, "Playlist import"):
  * a normal browser User-Agent, timeouts, a 5 MB cap, no retries;
  * no cookies, no login, no tokens, no anti-detection tricks;
  * the target must be a public internet host (this server fetches on a stranger's behalf,
    so loopback / private / link-local addresses are refused, on every redirect hop too).
"""
from __future__ import annotations

import asyncio
import ipaddress
import logging
import socket
from typing import Optional, Tuple
from urllib.parse import parse_qs, urljoin, urlsplit

import httpx

from .errors import ImportFailure

logger = logging.getLogger(__name__)

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/124.0.0.0 Safari/537.36"
)
MAX_PAGE_BYTES = 5 * 1024 * 1024
MAX_REDIRECTS = 3
TIMEOUT = httpx.Timeout(10.0, read=15.0)

_UNREADABLE = "We couldn't open that link. Check it opens in a browser, or paste the song list instead."


def safe_url_for_log(url: str) -> str:
    """Host and path only, plus YouTube's `list` id. Never query strings, fragments or credentials."""
    try:
        parts = urlsplit(url)
        out = f"{parts.scheme}://{parts.hostname or ''}{parts.path}"
        list_id = parse_qs(parts.query).get("list")
        if list_id:
            out += f"?list={list_id[0][:64]}"
        return out[:200]
    except Exception:
        return "<unparseable url>"


async def check_public_host(host: str, port: Optional[int]) -> None:
    """Raise ImportFailure unless every address the host resolves to is a public one."""
    if port not in (None, 80, 443):
        raise ImportFailure(_UNREADABLE)
    try:
        addresses = [ipaddress.ip_address(host)]
    except ValueError:
        try:
            infos = await asyncio.get_running_loop().getaddrinfo(host, port or 443, type=socket.SOCK_STREAM)
        except OSError:
            raise ImportFailure(_UNREADABLE)
        addresses = [ipaddress.ip_address(info[4][0].split("%")[0]) for info in infos]
    if not addresses or any(not address.is_global for address in addresses):
        raise ImportFailure(_UNREADABLE)


def _make_client() -> httpx.AsyncClient:
    return httpx.AsyncClient(
        timeout=TIMEOUT,
        follow_redirects=False,
        headers={"User-Agent": USER_AGENT, "Accept": "text/html,application/json;q=0.9,*/*;q=0.5", "Accept-Language": "en-US,en;q=0.8"},
    )


async def fetch_page(url: str) -> Tuple[str, str]:
    """GET `url` (following at most 3 redirects by hand). Returns (final_url, text)."""
    current = url
    async with _make_client() as client:
        for _hop in range(MAX_REDIRECTS + 1):
            parts = urlsplit(current)
            if parts.scheme not in ("http", "https") or not parts.hostname or parts.username or parts.password:
                raise ImportFailure(_UNREADABLE)
            try:
                port = parts.port
            except ValueError:
                raise ImportFailure(_UNREADABLE)
            await check_public_host(parts.hostname, port)
            logger.info("Import fetch %s", safe_url_for_log(current))
            try:
                async with client.stream("GET", current) as response:
                    if response.status_code in (301, 302, 303, 307, 308) and response.headers.get("location"):
                        current = urljoin(current, response.headers["location"])
                        continue
                    if response.status_code >= 400:
                        raise ImportFailure(_UNREADABLE)
                    chunks, size = [], 0
                    async for chunk in response.aiter_bytes():
                        size += len(chunk)
                        if size > MAX_PAGE_BYTES:
                            raise ImportFailure("That page is too large to read. Paste the song list instead.")
                        chunks.append(chunk)
                    encoding = response.encoding or "utf-8"
            except httpx.HTTPError:
                raise ImportFailure(_UNREADABLE)
            try:
                text = b"".join(chunks).decode(encoding, errors="replace")
            except LookupError:
                text = b"".join(chunks).decode("utf-8", errors="replace")
            return current, text
    raise ImportFailure(_UNREADABLE)  # too many redirects
