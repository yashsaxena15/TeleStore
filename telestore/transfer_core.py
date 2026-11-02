# telestore/transfer_core.py
"""What the main server and the worker machines (worker/worker.py) share about transfers.

Standard library only: the same file is copied next to worker.py on each worker machine
(see worker/README.md), so both sides check downloads, measure speed, wait for Google's
limit and for Telegram's rate limit in exactly the same way.

1. Is a finished download really the file? A source that refuses a download doesn't always
   say so with an error code: Google Drive answers "200 OK" with a small web page ("Too many
   users have viewed or downloaded this file recently…"). That page, or only part of the file,
   is refused.
2. Speed "now": smoothed over a few seconds, not the average since the start.
3. Google's download limit is per file: only that file waits, a few hours at first, longer if
   it hits the limit again.
4. Telegram's "sending too fast" (FLOOD_WAIT): wait as long as Telegram says, then try again.
"""

import asyncio
import math
import re
import time
from typing import Awaitable, Callable, Optional, TypeVar

# ── 1. Checking a download ──────────────────────────────────────────────────

HTML_NAMES = (".htm", ".html", ".xhtml", ".shtml", ".mht", ".mhtml")
HEAD_BYTES = 4096

_GOOGLE_LIMIT = re.compile(
    r"too many users have (viewed or )?downloaded|download quota|quota (was |has been )?exceeded|download limit", re.I)


class BadDownload(ValueError):
    """The source sent something other than the file (an error page, or too few or too many bytes)."""


class GoogleLimitReached(RuntimeError):
    """Google Drive's download limit for this file was reached: it waits and tries again later."""


def is_google_limit(text) -> bool:
    """Whether an error (or its text) is Google Drive's download limit."""
    return isinstance(text, GoogleLimitReached) or bool(_GOOGLE_LIMIT.search(str(text or "")))


def looks_like_html(head: bytes) -> bool:
    start = head[:1024].lstrip(b"\xef\xbb\xbf \t\r\n").lower()
    return start.startswith((b"<!doctype html", b"<html")) or (start.startswith(b"<") and b"<html" in start and b"<head" in head[:HEAD_BYTES].lower())


def size_text(n: float) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024 or unit == "GB":
            return f"{n:.0f} {unit}" if unit == "B" else f"{n:.1f} {unit}"
        n /= 1024
    return f"{n} B"


def check_download(filename: str, received: int, expected: Optional[int] = None, head: bytes = b"") -> None:
    """Raises when [received] bytes (starting with [head]) aren't [filename] as the source announced it."""
    name = (filename or "").lower()
    if head and not name.endswith(HTML_NAMES) and looks_like_html(head):
        text = re.sub(r"<[^>]+>", " ", head.decode("utf-8", "ignore"))
        if is_google_limit(text):
            raise GoogleLimitReached(f"Google Drive's download limit for '{filename}' was reached (it sent a notice instead of the file).")
        raise BadDownload(f"The source sent a web page instead of '{filename}' ({size_text(received)}). Check the link, or try again later.")
    if expected and expected > 0 and received != expected:
        raise BadDownload(f"Only part of '{filename}' arrived: {size_text(received)} of {size_text(expected)}. Try again.")


# ── 2. Speed ────────────────────────────────────────────────────────────────

class SpeedMeter:
    """The speed now, from a running byte count: each reading is weighed by how long ago it was,
    so a stall shows within seconds and a burst doesn't make the number jump."""

    def __init__(self, window: float = 5.0, clock: Callable[[], float] = time.monotonic):
        self.window = window
        self.clock = clock
        self._t: Optional[float] = None
        self._bytes = 0
        self._bps = 0.0

    def update(self, total_bytes: int) -> int:
        now = self.clock()
        if self._t is None:
            self._t, self._bytes = now, total_bytes
            return 0
        dt = now - self._t
        if dt <= 0:
            return int(self._bps)
        rate = max(0, total_bytes - self._bytes) / dt
        weight = 1 - math.exp(-dt / self.window)
        self._bps += (rate - self._bps) * weight
        self._t, self._bytes = now, total_bytes
        return int(self._bps)

    @property
    def bps(self) -> int:
        return int(self._bps)


def eta_seconds(remaining: int, bps: int) -> int:
    return int(remaining / bps) if bps > 0 and remaining > 0 else 0


# ── 3. Google's limit ───────────────────────────────────────────────────────

GOOGLE_LIMIT_WAITS_HOURS = (6, 12, 24)


def google_limit_wait_hours(times_hit_before: int) -> int:
    """How long a file waits after hitting Google's limit: 6 h the first time, then 12 h, then 24 h."""
    return GOOGLE_LIMIT_WAITS_HOURS[min(max(0, times_hit_before), len(GOOGLE_LIMIT_WAITS_HOURS) - 1)]


# ── 4. Telegram's rate limit ────────────────────────────────────────────────

FLOOD_RETRIES = 5
FLOOD_MAX_WAIT = 15 * 60

T = TypeVar("T")


def flood_wait_seconds(error: BaseException) -> Optional[int]:
    """Seconds Telegram asks to wait (FLOOD_WAIT / "A wait of N seconds is required"), or None."""
    if "FloodWait" in type(error).__name__ or "FLOOD_WAIT" in str(error):
        value = getattr(error, "value", None)
        if isinstance(value, (int, float)) and value >= 0:
            return int(value)
        m = re.search(r"wait of (\d+) seconds", str(error))
        return int(m.group(1)) if m else 30
    return None


async def retry_after_flood(send: Callable[[], Awaitable[T]], retries: int = FLOOD_RETRIES, max_wait: int = FLOOD_MAX_WAIT,
                            on_wait: Optional[Callable[[int], None]] = None, sleep=asyncio.sleep) -> T:
    """Runs [send]; when Telegram says to slow down, waits as long as it asks (a little more) and tries again."""
    for attempt in range(retries + 1):
        try:
            return await send()
        except Exception as e:
            wait = flood_wait_seconds(e)
            if wait is None or attempt == retries or wait > max_wait:
                raise
            if on_wait:
                on_wait(wait)
            await sleep(wait + 1)
    raise RuntimeError("unreachable")
