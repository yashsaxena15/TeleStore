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
5. Torrents: the same aria2c settings on every machine (uploads to others kept to a trickle, no
   seeding after a download), and reading its progress lines.
"""

import asyncio
import math
import os
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


# ── Speed caps (a worker machine's own, set in its settings file) ─────────────

def kb_setting(name: str) -> int:
    """A speed setting in KB/s from the environment: missing, empty, 0 or not a number means no cap (0)."""
    try:
        return max(0, int(float(os.getenv(name, "") or 0)))
    except ValueError:
        return 0


class RateLimit:
    """Keeps a flow of bytes under [bytes_per_second] (0 = no cap), shared by every caller in one event
    loop: each caller books the time its bytes take at that speed and waits for its booking. Up to one
    second of unused time is kept as credit, so a short pause doesn't make the average fall below the cap."""

    BURST_SECONDS = 1.0

    def __init__(self, bytes_per_second: int):
        self.rate = max(0, int(bytes_per_second))
        self._free_at = 0.0

    async def take(self, size: int) -> None:
        if self.rate <= 0 or size <= 0:
            return
        now = time.monotonic()
        self._free_at = max(self._free_at, now - self.BURST_SECONDS) + size / self.rate
        wait = self._free_at - now
        if wait > 0:
            await asyncio.sleep(wait)


# ── Torrents (aria2c) ─────────────────────────────────────────────────────────

TORRENT_TRACKERS = (
    "udp://tracker.opentrackr.org:1337/announce",
    "udp://open.stealth.si:80/announce",
    "udp://tracker.torrent.eu.org:451/announce",
    "udp://tracker.bittor.pw:1337/announce",
    "udp://public.popcorn-tracker.org:6969/announce",
    "udp://tracker.dler.org:6969/announce",
    "udp://exodus.desync.com:6969/announce",
    "udp://open.demonii.com:1337/announce",
    "udp://tracker.moeking.me:6969/announce",
    "http://tracker.openbittorrent.com:80/announce",
    "udp://explodie.org:6969/announce",
    "udp://opentracker.i2p.rocks:6969/announce",
    "udp://tracker.tiny-vps.com:6969/announce",
    "udp://open.tracker.cl:1337/announce",
)

# Sharing with other peers is kept to a trickle (BitTorrent stalls a peer that shares nothing; 0
# would mean "no limit" to aria2c), and nothing is shared once a download has finished
TORRENT_UPLOAD_LIMIT = "1K"


def aria2_args(dht_dir: str, download_limit_kb: int = 0) -> list:
    """aria2c's command line before the download's own options (the same on every machine; a worker
    can add its own download speed cap, in KB/s, 0 = none)."""
    limit = [f"--max-overall-download-limit={download_limit_kb}K"] if download_limit_kb > 0 else []
    return [
        "aria2c",
        "--enable-dht=true",
        "--enable-peer-exchange=true",
        "--bt-enable-lpd=true",
        "--bt-max-peers=60",
        "--max-connection-per-server=16",
        "--split=16",
        "--seed-time=0",
        "--file-allocation=none",
        f"--max-overall-upload-limit={TORRENT_UPLOAD_LIMIT}",
        f"--bt-tracker={','.join(TORRENT_TRACKERS)}",
        f"--dht-file-path={dht_dir.rstrip('/')}/dht.dat",
        f"--dht-file-path6={dht_dir.rstrip('/')}/dht6.dat",
    ] + limit


def aria2_file_args(dht_dir: str, torrent_path: str, file_index: int, work_dir: str, download_limit_kb: int = 0) -> list:
    """One file of a torrent (its 1-based index), into work_dir; a second run picks up where it was."""
    return aria2_args(dht_dir, download_limit_kb) + [
        f"--select-file={file_index}",
        f"--dir={work_dir}",
        "--summary-interval=1",
        "--continue=true",
        torrent_path,
    ]


_ARIA2_UNITS = {"B": 1, "KIB": 1024, "KB": 1024, "MIB": 1024 ** 2, "MB": 1024 ** 2,
                "GIB": 1024 ** 3, "GB": 1024 ** 3, "TIB": 1024 ** 4, "TB": 1024 ** 4}


def _aria2_bytes(number: str, unit: str) -> int:
    return int(float(number) * _ARIA2_UNITS.get(unit.upper(), 1))


def parse_aria2_line(line: str) -> Optional[dict]:
    """aria2c's progress line, e.g. "[#2089b0 400.0KiB/33.2MiB(1%) CN:18 SD:6 DL:4.2MiB ETA:4m20s]",
    as {"done", "total", "progress", "speed_bps", "peers", "seeders"}; None for other lines."""
    if "CN:" not in line and "DL:" not in line:
        return None
    sizes = re.search(r"([0-9.]+)([KMGT]?i?B)/([0-9.]+)([KMGT]?i?B)", line)
    pct = re.search(r"\((\d+(?:\.\d+)?)%\)", line)
    speed = re.search(r"DL:([0-9.]+)([KMGT]?i?B)", line)
    peers = re.search(r"CN:(\d+)", line)
    seeders = re.search(r"SD:(\d+)", line)
    return {
        "done": _aria2_bytes(sizes.group(1), sizes.group(2)) if sizes else 0,
        "total": _aria2_bytes(sizes.group(3), sizes.group(4)) if sizes else 0,
        "progress": float(pct.group(1)) if pct else 0.0,
        "speed_bps": _aria2_bytes(speed.group(1), speed.group(2)) if speed else 0,
        "peers": int(peers.group(1)) if peers else 0,
        "seeders": int(seeders.group(1)) if seeders else 0,
    }


def torrent_file_path(work_dir: str, full_rel_path: str, name: str) -> Optional[str]:
    """Where aria2c put one file of a torrent: at its path inside the torrent, else found by name."""
    exact = os.path.join(work_dir, full_rel_path)
    if os.path.isfile(exact):
        return exact
    for root, _, names in os.walk(work_dir):
        if name in names:
            return os.path.join(root, name)
    return None
