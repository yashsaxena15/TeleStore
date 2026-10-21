"""Brute-force protection for sign-in and the vault PIN."""

import pytest

from telestore.security.attempt_limiter import AttemptLimiter, TooManyAttempts


class FakeClock:
    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        return self.now


class TestAttemptLimiter:
    def test_free_attempts_then_doubling_locks(self):
        clock = FakeClock()
        lim = AttemptLimiter(free_attempts=3, base_lock=10, max_lock=40, clock=clock)
        assert [lim.failure("k") for _ in range(3)] == [0, 0, 0]
        assert lim.failure("k") == 10
        with pytest.raises(TooManyAttempts):
            lim.check("k")
        clock.now += 10
        lim.check("k")
        assert lim.failure("k") == 20
        clock.now += 20
        assert lim.failure("k") == 40
        clock.now += 40
        assert lim.failure("k") == 40  # capped

    def test_success_clears_and_old_failures_expire(self):
        clock = FakeClock()
        lim = AttemptLimiter(free_attempts=2, base_lock=10, window=100, clock=clock)
        lim.failure("k")
        lim.failure("k")
        lim.success("k")
        assert lim.failure("k") == 0
        lim.failure("k")
        clock.now += 101
        assert lim.failure("k") == 0  # the window passed, counting starts again

    def test_keys_are_independent_and_bounded(self):
        clock = FakeClock()
        lim = AttemptLimiter(free_attempts=1, base_lock=10, max_keys=5, clock=clock)
        lim.failure("a")
        assert lim.failure("a") == 10
        lim.check("b")
        for i in range(20):
            lim.failure(f"x{i}")
        assert len(lim._state) <= 5


class TestLoginLockout:
    def test_sixth_wrong_password_is_refused_with_retry_after(self, client):
        for _ in range(5):
            assert client.post("/auth/login", json={"username": "admin", "password": "nope"}).status_code == 401
        res = client.post("/auth/login", json={"username": "admin", "password": "nope"})
        assert res.status_code == 429
        assert int(res.headers["Retry-After"]) > 0
        # Even the right password waits until the lock ends
        res = client.post("/auth/login", json={"username": "admin", "password": "dummy-admin-password-test-only"})
        assert res.status_code == 429

    def test_lock_is_per_username(self, client):
        for _ in range(6):
            client.post("/auth/login", json={"username": "admin", "password": "nope"})
        assert client.post("/auth/login", json={"username": "someone", "password": "nope"}).status_code == 401
