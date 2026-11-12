"""Keeps a flow of bytes under a speed (the same idea as the server's workers use)."""

import asyncio
import time


class RateLimit:
    """Bytes per second for every upload together (0 = no cap); up to one second of unused time is
    kept as credit, so short pauses don't make the average fall below the cap."""

    BURST_SECONDS = 1.0

    def __init__(self, bytes_per_second: int = 0):
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
