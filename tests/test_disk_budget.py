"""The server-wide disk budget: jobs that keep upload parts on disk share one limit, wait while it is
full, reserve only what a part holds, and give everything back when they end or fail."""

import asyncio
import threading
import time

import pytest

from telestore.services.disk_budget import AsyncPartSlots, DiskBudget, ThreadPartSlots

MB = 1024 * 1024


def test_reserve_waits_while_full_and_releases_wake_it():
    budget = DiskBudget(100 * MB)
    assert budget.try_reserve(60 * MB)
    assert not budget.try_reserve(50 * MB)
    got = []
    t = threading.Thread(target=lambda: got.append(budget.reserve(50 * MB, timeout=5)))
    t.start()
    time.sleep(0.2)
    assert got == []  # still waiting
    budget.release(60 * MB)
    t.join(2)
    assert got == [True] and budget.status()["used_mb"] == 50


def test_a_part_bigger_than_the_budget_still_runs_alone():
    budget = DiskBudget(100 * MB)
    assert budget.try_reserve(500 * MB)  # counted as the whole budget
    assert not budget.try_reserve(1)
    budget.release(500 * MB)
    assert budget.status()["used_mb"] == 0


def test_parts_reserve_only_what_they_hold():
    budget = DiskBudget(4096 * MB)
    slots = AsyncPartSlots(expected_total=3 * MB, budget=budget, part_size=1950 * MB)
    asyncio.run(slots.acquire())
    assert budget.status()["used_mb"] == 3  # a small file takes a small share
    slots.release()
    assert budget.status()["used_mb"] == 0


def test_a_big_file_reserves_full_parts_then_the_rest():
    budget = DiskBudget(10_000 * MB)
    slots = ThreadPartSlots(expected_total=2500 * MB, budget=budget, part_size=1950 * MB)
    assert slots.acquire(timeout=1) and slots.acquire(timeout=1)
    assert budget.status()["used_mb"] == 2500  # 1950 + 550
    slots.release()
    slots.release()
    assert budget.status()["used_mb"] == 0


def test_jobs_together_never_pass_the_limit():
    budget = DiskBudget(4000 * MB)
    a = ThreadPartSlots(budget=budget, part_size=1950 * MB)  # sizes unknown: full parts
    b = ThreadPartSlots(budget=budget, part_size=1950 * MB)
    assert a.acquire(timeout=1) and b.acquire(timeout=1)
    assert not a.acquire(timeout=0.3)  # a third part would pass 4000 MB: it waits
    b.release()
    assert a.acquire(timeout=1)
    assert budget.status()["used_mb"] == 3900


def test_a_failed_job_gives_everything_back_and_late_releases_do_nothing():
    budget = DiskBudget(4000 * MB)
    slots = ThreadPartSlots(budget=budget, part_size=1950 * MB)
    assert slots.acquire(timeout=1) and slots.acquire(timeout=1)
    slots.close()
    assert budget.status()["used_mb"] == 0
    slots.release()  # an upload task finishing after the job ended
    assert budget.status()["used_mb"] == 0


def test_cancelling_while_waiting_stops_the_job():
    budget = DiskBudget(100 * MB)
    assert budget.try_reserve(100 * MB)
    cancelled = threading.Event()
    slots = AsyncPartSlots(expected_total=50 * MB, budget=budget, cancelled=cancelled.is_set)

    async def run():
        asyncio.get_running_loop().call_later(0.3, cancelled.set)
        await slots.acquire()

    with pytest.raises(asyncio.CancelledError):
        asyncio.run(run())
    assert budget.status()["used_mb"] == 100


def test_chunked_uploads_wait_when_the_server_budget_is_full(client, test_secrets):
    from unittest.mock import patch

    from telestore.api.routes.files import chunked_upload
    from telestore.security.credentials import User, require_auth
    from telestore.api.app import app

    full = DiskBudget(10 * MB)
    assert full.try_reserve(10 * MB)
    session = {"upload_id": "u1", "user_id": "42", "filesize": 5 * MB, "total_chunks": 1, "received": set(), "part_counts": {},
               "part_tasks": {}, "open_parts": set(), "reserved": {}, "dir": "/tmp", "lock": asyncio.Lock(), "error": None,
               "filename": "a.bin", "path": "/Home"}
    app.dependency_overrides[require_auth] = lambda: User(username="bob", telegram_user_id=42)
    try:
        with patch.object(chunked_upload, "DISK_BUDGET", full), patch.dict(chunked_upload._active_upload_sessions, {"u1": session}):
            res = client.put("/files/upload/chunk/u1/0", content=b"x" * (5 * MB))
            assert res.status_code == 429 and res.headers["Retry-After"] == "3"
            assert session["reserved"] == {} and session["open_parts"] == set()
            full.release(10 * MB)
            with patch.object(chunked_upload, "_send_part", new=lambda *a, **k: asyncio.sleep(0)), \
                    patch.object(chunked_upload, "_write_at"):
                assert client.put("/files/upload/chunk/u1/0", content=b"x" * (5 * MB)).status_code == 200
            assert session["reserved"] == {0: 5 * MB} and full.status()["used_mb"] == 5
            chunked_upload._release_all(session)
            assert full.status()["used_mb"] == 0
    finally:
        app.dependency_overrides.pop(require_auth, None)
