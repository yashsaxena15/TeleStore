"""Slows down password and PIN guessing.

After a few free failures, each further failure locks the key (a username or a vault owner)
for a period that doubles every time, up to a cap. A success clears the key, and failures
older than the window are forgotten. State lives in memory: the server runs as one process,
and a restart only gives an attacker the few free attempts again.
"""

import threading
import time


class TooManyAttempts(Exception):
    def __init__(self, retry_after: int):
        super().__init__(f"Too many attempts. Try again in {retry_after} seconds.")
        self.retry_after = retry_after


def wait_message(seconds: int) -> str:
    if seconds >= 60:
        minutes = (seconds + 59) // 60
        return f"Too many wrong attempts. Try again in {minutes} minute{'s' if minutes != 1 else ''}."
    return f"Too many wrong attempts. Try again in {seconds} second{'s' if seconds != 1 else ''}."


class AttemptLimiter:
    def __init__(self, free_attempts: int = 5, base_lock: int = 30, max_lock: int = 900,
                 window: int = 3600, max_keys: int = 10_000, clock=time.monotonic):
        self.free_attempts = free_attempts
        self.base_lock = base_lock
        self.max_lock = max_lock
        self.window = window
        self.max_keys = max_keys
        self._clock = clock
        self._state = {}  # key -> [failures, locked_until, last_failure]
        self._lock = threading.Lock()

    def _entry(self, key: str, now: float):
        entry = self._state.get(key)
        if entry and now - entry[2] > self.window and now >= entry[1]:
            del self._state[key]
            return None
        return entry

    def retry_after(self, key: str) -> int:
        """Seconds until the key may try again (0 when allowed)."""
        with self._lock:
            now = self._clock()
            entry = self._entry(key, now)
            if not entry or now >= entry[1]:
                return 0
            return max(1, int(entry[1] - now + 0.999))

    def check(self, key: str) -> None:
        """Raise TooManyAttempts while the key is locked."""
        wait = self.retry_after(key)
        if wait:
            raise TooManyAttempts(wait)

    def failure(self, key: str) -> int:
        """Record a failed attempt; returns the lock now in force, in seconds (0 if none)."""
        with self._lock:
            now = self._clock()
            entry = self._entry(key, now) or [0, 0.0, now]
            entry[0] += 1
            entry[2] = now
            over = entry[0] - self.free_attempts
            lock = min(self.max_lock, self.base_lock * (2 ** (over - 1))) if over > 0 else 0
            entry[1] = now + lock
            self._state[key] = entry
            if len(self._state) > self.max_keys:
                self._prune(now)
            return lock

    def success(self, key: str) -> None:
        with self._lock:
            self._state.pop(key, None)

    def _prune(self, now: float) -> None:
        for key in [k for k, e in self._state.items() if now - e[2] > self.window and now >= e[1]]:
            del self._state[key]
        # Still too many: drop the oldest entries
        if len(self._state) > self.max_keys:
            for key, _ in sorted(self._state.items(), key=lambda kv: kv[1][2])[: len(self._state) - self.max_keys]:
                del self._state[key]


# One limiter for account passwords (web login, WebDAV, change-password) and one for vault PINs
password_limiter = AttemptLimiter()
pin_limiter = AttemptLimiter()
