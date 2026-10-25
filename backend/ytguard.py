"""
One gate in front of every yt-dlp call, so a YouTube rate limit (HTTP 429)
isn't made worse by our own retries.

- At most YTDLP_MAX_CONCURRENT extractions run at once (default 2).
- When YouTube answers 429, new extractions are refused for a cooldown that
  doubles with each 429 in a row: 10s, 20s, 40s ... capped at 5 minutes, plus
  up to 5s of jitter. A longer Retry-After from YouTube wins.
- During the cooldown callers get YouTubeBusy straight away, without a request
  to YouTube. Routers turn it into HTTP 429 + Retry-After, or serve stale cache.
- The first success after a cooldown resets the backoff.

yt-dlp often reports the 429 only as a warning ("Unable to download webpage:
HTTP Error 429") and then fails with something vaguer ("Failed to extract any
player response"), so each call gets its own logger that watches for it.
"""
from __future__ import annotations

import asyncio
import logging
import math
import os
import random
import re
import time
from email.utils import parsedate_to_datetime
from typing import Any, Callable, Iterator, Optional, Tuple, TypeVar

logger = logging.getLogger(__name__)
T = TypeVar("T")

BASE_DELAY = 10          # seconds, first cooldown
MAX_DELAY = 300          # seconds, longest cooldown we pick ourselves
JITTER = 5               # seconds of random spread, so retries don't line up
MAX_RETRY_AFTER = 3600   # ignore absurd Retry-After values beyond an hour


def _env_int(name: str, default: int) -> int:
    try:
        return max(1, int(os.environ.get(name) or default))
    except ValueError:
        return default


MAX_CONCURRENT = _env_int("YTDLP_MAX_CONCURRENT", 2)

_RATE_LIMIT_RE = re.compile(r"http error 429|too many requests|rate[- ]limited", re.IGNORECASE)
# "The current session has been rate-limited by YouTube for up to an hour."
_LONG_LIMIT_RE = re.compile(r"for up to an hour", re.IGNORECASE)


def retry_delay(attempt: int, rand: Callable[[float, float], float] = random.uniform) -> float:
    """Exponential backoff with jitter, capped at 5 minutes: 10, 20, 40, 80, 160, 300..."""
    base = min(BASE_DELAY * (2 ** max(attempt, 0)), MAX_DELAY)
    return base + rand(0, JITTER)


def parse_retry_after(value: Any, now: Optional[float] = None) -> Optional[float]:
    """Seconds to wait from a Retry-After header (seconds or an HTTP date), or None."""
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    try:
        seconds = float(text)
    except ValueError:
        try:
            when = parsedate_to_datetime(text)
        except (TypeError, ValueError, IndexError):
            return None
        if when is None:
            return None
        seconds = when.timestamp() - (now if now is not None else time.time())
    if math.isnan(seconds):
        return None
    return max(0.0, min(seconds, MAX_RETRY_AFTER))


def _chain(exc: BaseException) -> Iterator[BaseException]:
    """The exception and everything it wraps (yt-dlp nests the real HTTP error)."""
    seen = set()
    stack = [exc]
    while stack:
        e = stack.pop()
        if not isinstance(e, BaseException) or id(e) in seen:
            continue
        seen.add(id(e))
        yield e
        exc_info = getattr(e, "exc_info", None)
        if isinstance(exc_info, tuple) and len(exc_info) > 1:
            stack.append(exc_info[1])
        stack.extend([getattr(e, "cause", None), e.__cause__, e.__context__])


def rate_limit_of(exc: BaseException) -> Tuple[bool, Optional[float]]:
    """(is this a YouTube rate limit?, Retry-After seconds if YouTube sent one)."""
    for e in _chain(exc):
        response = getattr(e, "response", None)
        status = getattr(e, "status", None)
        if not isinstance(status, int):
            status = getattr(e, "code", None)
        if not isinstance(status, int) and response is not None:
            status = getattr(response, "status", None) or getattr(response, "status_code", None)
        if status == 429:
            headers = getattr(response, "headers", None) or getattr(e, "headers", None)
            retry_after = None
            try:
                retry_after = parse_retry_after(headers.get("Retry-After")) if headers is not None else None
            except Exception:
                pass
            return True, retry_after
    for e in _chain(exc):
        text = str(e)
        if _RATE_LIMIT_RE.search(text):
            return True, float(MAX_DELAY) if _LONG_LIMIT_RE.search(text) else None
    return False, None


class YouTubeBusy(Exception):
    """YouTube is rate-limiting this server; try again after `retry_after` seconds."""

    def __init__(self, retry_after: float):
        self.retry_after = max(1, int(math.ceil(retry_after)))
        super().__init__(f"YouTube is rate-limiting this server; retry in {self.retry_after}s.")


class YtdlpLog:
    """yt-dlp logger for one call: forwards warnings and errors to our log (so a
    server-side failure says why) and remembers whether YouTube said 429."""

    def __init__(self) -> None:
        self.rate_limited = False
        self.retry_after: Optional[float] = None

    def _note(self, msg: str) -> None:
        if _RATE_LIMIT_RE.search(msg):
            self.rate_limited = True
            if _LONG_LIMIT_RE.search(msg):
                self.retry_after = float(MAX_DELAY)

    def debug(self, msg: str) -> None:  # yt-dlp routes info to debug too: too chatty
        pass

    def info(self, msg: str) -> None:
        pass

    def warning(self, msg: str) -> None:
        self._note(msg)
        logging.getLogger("yt-dlp").warning("%s", msg[:400])

    def error(self, msg: str) -> None:
        self._note(msg)
        logging.getLogger("yt-dlp").error("%s", msg[:400])


class Gate:
    def __init__(
        self,
        max_concurrent: int = MAX_CONCURRENT,
        clock: Callable[[], float] = time.time,
        rand: Callable[[float, float], float] = random.uniform,
    ) -> None:
        self.max_concurrent = max_concurrent
        self.clock = clock
        self.rand = rand
        self.strikes = 0          # 429s in a row; picks the next cooldown
        self.until = 0.0          # no extraction before this time
        self._sem: Optional[asyncio.Semaphore] = None
        self._sem_loop: Optional[asyncio.AbstractEventLoop] = None

    def reset(self) -> None:
        self.strikes = 0
        self.until = 0.0

    def remaining(self) -> float:
        return max(0.0, self.until - self.clock())

    def check(self) -> None:
        """Raise YouTubeBusy while cooling down."""
        left = self.remaining()
        if left > 0:
            raise YouTubeBusy(left)

    def trip(self, retry_after: Optional[float] = None) -> float:
        """Record a 429 and return the seconds to wait. 429s from calls that were
        already running when the cooldown started don't count as a new strike."""
        now = self.clock()
        if self.until > now:
            if retry_after:
                self.until = max(self.until, now + retry_after)
            return self.until - now
        delay = retry_delay(self.strikes, self.rand)
        if retry_after:
            delay = max(delay, retry_after)
        self.strikes += 1
        self.until = now + delay
        logger.warning("YouTube said 429 (too many requests): pausing yt-dlp for %.0fs (429 #%d in a row).",
                       delay, self.strikes)
        return delay

    def succeeded(self) -> None:
        if self.strikes:
            logger.info("YouTube answered again after %d rate limit(s).", self.strikes)
        self.strikes = 0

    def _semaphore(self) -> asyncio.Semaphore:
        loop = asyncio.get_running_loop()
        if self._sem is None or self._sem_loop is not loop:
            self._sem, self._sem_loop = asyncio.Semaphore(self.max_concurrent), loop
        return self._sem

    async def run(self, fn: Callable[[YtdlpLog], T]) -> T:
        """Run the blocking `fn(log)` in a worker thread, at most `max_concurrent`
        at a time. Pass `log` to yt-dlp as its logger. Raises YouTubeBusy (and
        starts a cooldown) instead of letting a 429 through."""
        self.check()
        async with self._semaphore():
            self.check()  # a 429 may have landed while we queued
            log = YtdlpLog()
            try:
                result = await asyncio.get_running_loop().run_in_executor(None, fn, log)
            except Exception as exc:
                limited, retry_after = rate_limit_of(exc)
                if limited or log.rate_limited:
                    raise YouTubeBusy(self.trip(retry_after or log.retry_after)) from exc
                raise
            self.succeeded()
            return result


gate = Gate()


def wait_phrase(seconds: float) -> str:
    """'45 seconds' / 'a minute' / '3 minutes', for error messages."""
    s = max(1, int(math.ceil(seconds)))
    if s < 60:
        return f"{s} seconds"
    minutes = int(math.ceil(s / 60))
    return "a minute" if minutes == 1 else f"{minutes} minutes"
