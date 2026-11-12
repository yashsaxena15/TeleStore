"""Phase 8: one file over several connections, with every piece retried until it's in."""

import asyncio
import io

import pytest
from pyrogram import errors as tg_errors
from pyrogram import raw

from telestore_desktop import fast_upload as fu


class FakeSession:
    def __init__(self, log, fail=None, flood_once=False):
        self.log, self.fail, self.flood_once, self.stopped = log, fail or {}, flood_once, False
        self.busy = 0

    async def invoke(self, rpc):
        self.busy += 1
        FakeSession.most = max(getattr(FakeSession, "most", 0), FakeSession.total() + 1)
        FakeSession.running += 1
        try:
            await asyncio.sleep(0.001)
            if self.flood_once:
                self.flood_once = False
                raise tg_errors.FloodWait(value=0)
            left = self.fail.get(rpc.file_part, 0)
            if left:
                self.fail[rpc.file_part] = left - 1
                raise ConnectionError("reset")
            self.log.append((rpc.file_part, rpc.file_total_parts, len(rpc.bytes), rpc.file_id))
            return True
        finally:
            FakeSession.running -= 1

    running = 0

    @classmethod
    def total(cls):
        return cls.running

    async def stop(self):
        self.stopped = True


class FakeClient:
    me = type("Me", (), {"is_premium": False})()

    def __init__(self):
        self.original_calls = []

    def rnd_id(self):
        return 777

    async def save_file(self, path, file_id=None, file_part=0, progress=None, progress_args=()):
        self.original_calls.append(path)
        return "original"


async def _no_wait(*_a, **_k):
    return None


def _run(data, sessions, **kw):
    made = iter(sessions)

    async def make():
        return next(made)
    return asyncio.run(fu.save_big_file(FakeClient(), io.BytesIO(data), len(data), "big.bin.part1",
                                        make_session=make, **kw))


def test_every_piece_once_and_in_the_right_place(monkeypatch):
    monkeypatch.setattr(fu, "PIECE", 1000)
    data = bytes(range(256)) * 40  # 10,240 bytes -> 11 pieces
    log = []
    sessions = [FakeSession(log) for _ in range(3)]
    result = _run(data, sessions, connections=3, per_connection=4)
    assert isinstance(result, raw.types.InputFileBig) and result.parts == 11 and result.id == 777
    assert sorted(p for p, *_ in log) == list(range(11))
    assert all(total == 11 and fid == 777 for _, total, _, fid in log)
    assert sum(n for _, _, n, _ in log) == len(data)
    assert all(s.stopped for s in sessions)


def test_many_pieces_at_once(monkeypatch):
    monkeypatch.setattr(fu, "PIECE", 100)
    FakeSession.most = 0
    log = []
    _run(b"x" * 10_000, [FakeSession(log) for _ in range(3)], connections=3, per_connection=4)
    assert FakeSession.most > 4  # more than the library's 4


def test_a_failed_piece_is_sent_again(monkeypatch):
    monkeypatch.setattr(fu, "PIECE", 1000)
    monkeypatch.setattr(fu.asyncio, "sleep", _fast_sleep())
    log = []
    _run(b"y" * 5000, [FakeSession(log, fail={2: 2}, flood_once=True)], connections=1, per_connection=2)
    assert sorted(p for p, *_ in log) == [0, 1, 2, 3, 4]


def test_a_piece_that_never_goes_fails_the_file(monkeypatch):
    monkeypatch.setattr(fu, "PIECE", 1000)
    monkeypatch.setattr(fu.asyncio, "sleep", _fast_sleep())
    with pytest.raises(fu.FastUploadError):
        _run(b"z" * 5000, [FakeSession([], fail={3: 99})], connections=1, per_connection=2)


def test_progress_goes_to_the_whole_size(monkeypatch):
    monkeypatch.setattr(fu, "PIECE", 1000)
    seen = []

    async def progress(cur, tot):
        seen.append((cur, tot))
    _run(b"p" * 2500, [FakeSession([])], connections=1, per_connection=1, progress=progress)
    assert seen[-1] == (2500, 2500) and len(seen) == 3


class TestInstall:
    def test_small_files_and_thumbnails_go_the_usual_way(self):
        client = FakeClient()
        fu.install(client)
        assert asyncio.run(client.save_file(io.BytesIO(b"small"))) == "original"
        assert len(client.original_calls) == 1

    def test_big_files_go_the_fast_way(self, monkeypatch):
        client = FakeClient()
        fu.install(client)
        called = []

        async def fast(c, fp, size, name, *a, **k):
            called.append(size)
            return "fast"
        monkeypatch.setattr(fu, "save_big_file", fast)
        big = io.BytesIO(b"b" * (fu.BIG + 1))
        assert asyncio.run(client.save_file(big)) == "fast" and called == [fu.BIG + 1]
        assert client.original_calls == []

    def test_any_problem_falls_back_to_the_usual_way(self, monkeypatch):
        client = FakeClient()
        fu.install(client)

        async def broken(*a, **k):
            raise fu.FastUploadError("nope")
        monkeypatch.setattr(fu, "save_big_file", broken)
        assert asyncio.run(client.save_file(io.BytesIO(b"b" * (fu.BIG + 1)))) == "original"

    def test_too_big_for_the_account(self, monkeypatch):
        client = FakeClient()
        fu.install(client)

        class Huge(io.RawIOBase):
            def seekable(self):
                return True

            def seek(self, off, whence=0):
                self.pos = 2001 * 1024 * 1024 if whence == io.SEEK_END else off
                return self.pos

            def tell(self):
                return self.pos
        with pytest.raises(ValueError, match="2000 MiB"):
            asyncio.run(client.save_file(Huge()))


def _fast_sleep():
    real = asyncio.sleep

    async def sleep(seconds, *a, **k):
        return await real(0)
    return sleep
