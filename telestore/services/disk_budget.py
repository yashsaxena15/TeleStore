# telestore/services/disk_budget.py
"""One disk budget for the whole server.

Every job that keeps upload parts on the server's disk (uploads from the app and website, WebDAV,
leeches) reserves a part's size before writing it and gives it back once the part has reached
Telegram and its file was deleted. A job waits while the budget is full, so all of them together
never hold more than DISK_BUDGET_BYTES (4 GB by default) on disk, whatever runs at the same time.

A part reserves only what it will hold: a 1 MB photo takes 1 MB of the budget, a big file 1.95 GB
per part. Each job also keeps its own limit of parts on disk, as before.
"""

import asyncio
import os
import threading
import time
from collections import deque
from typing import Callable, Optional

from d4rk.Logs import setup_logger

logger = setup_logger("disk_budget")

PART_SIZE = 1950 * 1024 * 1024  # Telegram's limit for a bot upload
DEFAULT_LIMIT = 4 * 1024 * 1024 * 1024


class DiskBudget:
    """Bytes on disk that jobs have reserved; usable from asyncio code and from threads."""

    def __init__(self, limit: int):
        self.limit = max(1, int(limit))
        self._used = 0
        self._cond = threading.Condition()

    def _fit(self, n: int) -> int:
        # A single part bigger than the whole budget still runs, alone
        return max(0, min(int(n), self.limit))

    def try_reserve(self, n: int) -> bool:
        n = self._fit(n)
        with self._cond:
            if self._used + n > self.limit and self._used > 0:
                return False
            self._used += n
            return True

    def reserve(self, n: int, timeout: Optional[float] = None) -> bool:
        """Waits (in a thread) until [n] bytes fit; False when [timeout] passed first."""
        n = self._fit(n)
        deadline = None if timeout is None else time.monotonic() + timeout
        with self._cond:
            while self._used + n > self.limit and self._used > 0:
                left = None if deadline is None else deadline - time.monotonic()
                if left is not None and left <= 0:
                    return False
                self._cond.wait(left if left is not None else 1.0)
            self._used += n
            return True

    async def reserve_async(self, n: int, cancelled: Callable[[], bool] = lambda: False) -> bool:
        """Waits (without holding a thread) until [n] bytes fit; False when [cancelled] says so."""
        waited = False
        while not self.try_reserve(n):
            if cancelled():
                return False
            if not waited:
                logger.info(f"[DISK_BUDGET] Waiting for {n / 2**20:.0f} MB ({self.status()['used_mb']} of {self.status()['limit_mb']} MB in use)")
                waited = True
            await asyncio.sleep(0.25)
        return True

    def release(self, n: int) -> None:
        n = self._fit(n)
        with self._cond:
            self._used = max(0, self._used - n)
            self._cond.notify_all()

    def status(self) -> dict:
        with self._cond:
            return {"used_mb": round(self._used / 2**20), "limit_mb": round(self.limit / 2**20)}


DISK_BUDGET = DiskBudget(int(os.getenv("DISK_BUDGET_BYTES", DEFAULT_LIMIT)))


class _Slots:
    """Takes the place of a job's "parts on disk" semaphore: acquire before writing a part, release once
    it is uploaded and deleted (upload_part_task does that). Each part also reserves its bytes from the
    server's DISK_BUDGET. close() gives back whatever a failed job still held."""

    def __init__(self, expected_total: int = 0, budget: DiskBudget = DISK_BUDGET, part_size: int = PART_SIZE):
        self._budget = budget
        self._part_size = part_size
        self._expected = max(0, int(expected_total or 0))
        self._planned = 0  # bytes reserved for parts so far, to size the next one
        self._held = deque()
        self._lock = threading.Lock()
        self._closed = False

    def _next_amount(self) -> int:
        if not self._expected:
            return self._part_size
        left = self._expected - self._planned
        # Writing past the announced size (a wrong Content-Length) still reserves something
        return min(self._part_size, left) if left > 0 else min(self._part_size, 64 * 1024 * 1024)

    def _hold(self, amount: int) -> None:
        with self._lock:
            self._planned += amount
            self._held.append(amount)

    def _give_back(self) -> None:
        with self._lock:
            amount = self._held.popleft() if self._held else 0
        if amount:
            self._budget.release(amount)

    def close(self) -> None:
        """Gives back every part still reserved (the job ended or failed); later releases are no-ops."""
        with self._lock:
            amounts, self._held = list(self._held), deque()
            self._closed = True
        for amount in amounts:
            self._budget.release(amount)


class AsyncPartSlots(_Slots):
    """For asyncio jobs: `await slots.acquire()` before each part (at most [per_job] on disk)."""

    def __init__(self, expected_total: int = 0, per_job: int = 2, cancelled: Callable[[], bool] = lambda: False, **kw):
        super().__init__(expected_total, **kw)
        self._sem = asyncio.Semaphore(per_job)
        self._cancelled = cancelled

    async def acquire(self) -> bool:
        await self._sem.acquire()
        amount = self._next_amount()
        if not await self._budget.reserve_async(amount, self._cancelled):
            self._sem.release()
            raise asyncio.CancelledError("Cancelled while waiting for disk space")
        self._hold(amount)
        return True

    def release(self) -> None:
        self._give_back()
        self._sem.release()


class ThreadPartSlots(_Slots):
    """For jobs writing from a thread: `slots.acquire(timeout=0.5)` like threading.Semaphore."""

    def __init__(self, expected_total: int = 0, per_job: int = 2, **kw):
        super().__init__(expected_total, **kw)
        self._sem = threading.Semaphore(per_job)

    def acquire(self, blocking: bool = True, timeout: Optional[float] = None) -> bool:
        started = time.monotonic()
        if not self._sem.acquire(blocking, timeout):
            return False
        amount = self._next_amount()
        left = None if timeout is None else max(0.0, timeout - (time.monotonic() - started))
        if not self._budget.reserve(amount, left if blocking else 0):
            self._sem.release()
            return False
        self._hold(amount)
        return True

    def release(self) -> None:
        self._give_back()
        self._sem.release()
