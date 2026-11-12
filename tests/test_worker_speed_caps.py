"""A worker machine's own speed caps (November 2026).

WORKER_DOWNLOAD_LIMIT_KB and WORKER_UPLOAD_LIMIT_KB, in each worker's settings file, cap that
machine's downloads (web, Google Drive, torrents with libtorrent or aria2c) and its uploads to
Telegram. Empty or 0 means no cap, so a machine without them works as before.
"""

import asyncio
import importlib
import sys
from pathlib import Path
from unittest.mock import patch

import pytest

from telestore import torrent_engine, transfer_core


class Clock:
    """time.monotonic and asyncio.sleep without real waiting."""

    def __init__(self):
        self.now = 1000.0
        self.slept = 0.0

    def monotonic(self):
        return self.now

    async def sleep(self, seconds):
        self.slept += seconds
        self.now += seconds


@pytest.fixture
def clock():
    c = Clock()
    with patch.object(transfer_core.time, "monotonic", c.monotonic), patch.object(transfer_core.asyncio, "sleep", c.sleep):
        yield c


@pytest.mark.parametrize("value, expected", [(None, 0), ("", 0), ("0", 0), ("2048", 2048), ("1.5", 1), ("-5", 0), ("fast", 0)])
def test_kb_setting(value, expected, monkeypatch):
    if value is None:
        monkeypatch.delenv("X_LIMIT_KB", raising=False)
    else:
        monkeypatch.setenv("X_LIMIT_KB", value)
    assert transfer_core.kb_setting("X_LIMIT_KB") == expected


def test_no_cap_never_waits(clock):
    limit = transfer_core.RateLimit(0)
    for _ in range(100):
        asyncio.run(limit.take(10 * 1024 * 1024))
    assert clock.slept == 0


def test_cap_keeps_the_average_speed(clock):
    limit = transfer_core.RateLimit(1024 * 1024)  # 1 MB/s

    async def go():
        for _ in range(40):  # 20 MB in 512 KB reads
            await limit.take(512 * 1024)
    start = clock.now
    asyncio.run(go())
    # 20 s at 1 MB/s, less the one second of credit the first reads may use
    assert 19.0 <= clock.now - start <= 20.0


def test_cap_is_shared_by_two_downloads(clock):
    limit = transfer_core.RateLimit(1024 * 1024)

    async def one():
        for _ in range(10):
            await limit.take(512 * 1024)

    async def both():
        await asyncio.gather(one(), one())
    start = clock.now
    asyncio.run(both())
    assert 9.0 <= clock.now - start <= 10.0  # 10 MB together, not 5 MB each at full speed


def test_aria2_download_cap():
    assert not any(a.startswith("--max-overall-download-limit") for a in transfer_core.aria2_args("/d"))
    args = transfer_core.aria2_file_args("/d", "/t/x.torrent", 2, "/w", 2048)
    assert "--max-overall-download-limit=2048K" in args
    assert args[-1] == "/t/x.torrent"
    assert "--max-overall-upload-limit=1K" in args  # the upload trickle is still there


@pytest.mark.skipif(not torrent_engine.AVAILABLE, reason="libtorrent is not installed")
def test_libtorrent_download_cap():
    eng = torrent_engine.TorrentEngine({"listen_interfaces": "127.0.0.1:0", "enable_dht": False})
    assert eng.session.get_settings()["download_rate_limit"] == 0
    eng.set_download_limit(2048 * 1024)
    assert eng.session.get_settings()["download_rate_limit"] == 2048 * 1024


def _load_worker(tmp_path, env):
    with patch.dict("os.environ", {"WORKER_KEY": "test", "WORK_DIR": str(tmp_path / "work"), **env}):
        sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "worker"))
        try:
            sys.modules.pop("worker", None)
            return importlib.import_module("worker")
        finally:
            sys.path.pop(0)
            sys.modules.pop("worker", None)


def test_worker_reads_its_caps(tmp_path):
    w = _load_worker(tmp_path, {"WORKER_DOWNLOAD_LIMIT_KB": "2048", "WORKER_UPLOAD_LIMIT_KB": "1024"})
    assert (w.DOWNLOAD_LIMIT_KB, w.UPLOAD_LIMIT_KB) == (2048, 1024)
    worker = w.DistributedWorker()
    assert worker.download_limit.rate == 2048 * 1024
    assert worker.upload_limit.rate == 1024 * 1024


def test_worker_without_caps(tmp_path):
    w = _load_worker(tmp_path, {"WORKER_DOWNLOAD_LIMIT_KB": "", "WORKER_UPLOAD_LIMIT_KB": ""})
    worker = w.DistributedWorker()
    assert worker.download_limit.rate == 0 and worker.upload_limit.rate == 0


def test_telegram_upload_waits_for_the_cap(tmp_path, clock):
    w = _load_worker(tmp_path, {"WORKER_UPLOAD_LIMIT_KB": "1024"})
    worker = w.DistributedWorker()
    reports = []

    async def report_progress(*args, **kwargs):
        reports.append(args)
    worker.report_progress = report_progress
    progress = worker.upload_progress("rt_1", "Uploading")
    part = 512 * 1024
    total = 20 * part  # 10 MB

    async def upload():
        for n in range(1, 21):  # how Telegram's client calls it, after each 512 KB
            await progress(n * part, total)
    start = clock.now
    asyncio.run(upload())
    assert 9.0 <= clock.now - start <= 10.0  # 10 MB at 1 MB/s
    assert reports  # still telling the master it is busy
