"""Reading files from Telegram several pieces at once, in order, with retries and the fallbacks."""

import asyncio
import random
from types import SimpleNamespace

import pytest
from pyrogram import errors as tg_errors
from pyrogram import raw
from pyrogram.file_id import FileId, FileType

from telestore_desktop import fast_download as fd

DATA = random.Random(1).randbytes(int(fd.CHUNK * 3.5))


def _message():
    fid = FileId(file_type=FileType.DOCUMENT, dc_id=4, media_id=1, access_hash=2, file_reference=b"ref").encode()
    return SimpleNamespace(document=SimpleNamespace(file_id=fid))


class _Session:
    def __init__(self, behaviour=None):
        self.asked, self.in_flight, self.most = [], 0, 0
        self.behaviour = behaviour or (lambda req: None)

    async def invoke(self, req, sleep_threshold=None):
        self.asked.append(req.offset)
        self.in_flight += 1
        self.most = max(self.most, self.in_flight)
        try:
            await asyncio.sleep(random.random() / 200)  # pieces come back out of order
            special = self.behaviour(req)
            if special is not None:
                return special
            return raw.types.upload.File(type=raw.types.storage.FilePartial(), mtime=0,
                                         bytes=DATA[req.offset:req.offset + req.limit])
        finally:
            self.in_flight -= 1


def _reader(session, **kw):
    r = fd.FastReader(client=None, **kw)

    async def one(dc_id):
        assert dc_id == 4
        return session
    r._session = one
    return r


async def _all(reader, start, end):
    return b"".join([p async for p in reader.read(_message(), start, end)])


def test_reads_any_range_in_order_several_pieces_at_once():
    s = _Session()
    r = _reader(s, window=4)
    assert asyncio.run(_all(r, 0, len(DATA) - 1)) == DATA
    assert asyncio.run(_all(r, 123, fd.CHUNK * 2 + 77)) == DATA[123:fd.CHUNK * 2 + 78]
    assert asyncio.run(_all(r, len(DATA) - 10, len(DATA) - 1)) == DATA[-10:]
    assert s.most > 1  # several pieces were asked for at once
    assert all(off % fd.CHUNK == 0 for off in s.asked)


def test_a_failed_piece_is_tried_again(monkeypatch):
    monkeypatch.setattr(fd.asyncio, "sleep", _no_wait())
    tries = {"n": 0}

    def flaky(req):
        if req.offset == fd.CHUNK and tries["n"] < 2:
            tries["n"] += 1
            raise RuntimeError("connection reset")
    assert asyncio.run(_all(_reader(_Session(flaky)), 0, len(DATA) - 1)) == DATA


def _no_wait():
    real = asyncio.sleep

    async def short(delay, *a, **k):
        await real(0)
    return short


def test_cdn_files_go_the_usual_way():
    redirect = raw.types.upload.FileCdnRedirect(dc_id=1, file_token=b"t", encryption_key=b"k", encryption_iv=b"i",
                                                file_hashes=[])
    with pytest.raises(fd.Unsupported):
        asyncio.run(_all(_reader(_Session(lambda req: redirect)), 0, 10))


def test_an_old_file_reference_asks_for_the_message_again():
    def expired(req):
        raise tg_errors.FileReferenceExpired()
    with pytest.raises(fd.ReferenceExpired):
        asyncio.run(_all(_reader(_Session(expired)), 0, 10))


def test_stopping_early_cancels_the_pieces_ahead():
    s = _Session()
    r = _reader(s, window=3)

    async def first_only():
        async for piece in r.read(_message(), 0, len(DATA) - 1):
            return piece
    assert asyncio.run(first_only()) == DATA[:fd.CHUNK]
