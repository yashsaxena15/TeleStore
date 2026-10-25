"""Faster downloads: cached chunks streamed lazily, downloads that skip the SSD cache, bounded
cache writes, resumable downloads (ETag/If-Range), remembered WebDAV sign-ins and reuse of
the file's Telegram message across range requests."""

import asyncio
import base64
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException
from pyrogram import raw
from starlette.requests import Request

from telestore.api.app import app
from telestore.api.routes import stream as stream_routes
from telestore.api.routes.webdav import common as dav
from telestore.db import database
from telestore.security.credentials import User
from telestore.services import byte_streamer as bs

CS = 1024 * 1024


def _streamer(send):
    streamer = bs.ByteStreamer.__new__(bs.ByteStreamer)
    streamer.client = MagicMock()
    session = MagicMock()
    session.send = send
    streamer.get_file_properties = AsyncMock(return_value="fid")
    streamer.generate_media_session = AsyncMock(return_value=session)
    streamer.get_location = AsyncMock(return_value="loc")
    return streamer


def _collect(streamer, parts, **kw):
    async def run():
        return [c async for c in streamer.yield_parts(parts, chunk_size=CS, client_list=[streamer.client], **kw)]
    return asyncio.run(run())


PART = [{"chat_id": -100, "message_id": 1, "part_from_byte": 0, "part_until_byte": 3 * CS - 1, "part_index": 1}]


def _chunk(offset):
    return bytes([offset // CS + 1]) * CS


class TestCache:
    def test_a_cached_part_needs_no_telegram_call(self):
        sent = []

        async def send(query, timeout=None):
            sent.append(query.offset)
        streamer = _streamer(send)
        with patch.object(bs.GLOBAL_CHUNK_CACHE, "get", side_effect=lambda c, m, off, cs: _chunk(off)):
            chunks = _collect(streamer, PART)
        assert chunks == [_chunk(0), _chunk(CS), _chunk(2 * CS)] and sent == []
        streamer.get_file_properties.assert_not_called()

    def test_from_the_first_missing_chunk_it_fetches(self):
        sent = []

        async def send(query, timeout=None):
            sent.append(query.offset)
            return raw.types.upload.File(type=raw.types.storage.FilePartial(), mtime=0, bytes=_chunk(query.offset))
        streamer = _streamer(send)
        cached = {0: _chunk(0)}  # only the first chunk is cached
        with patch.object(bs.GLOBAL_CHUNK_CACHE, "get", side_effect=lambda c, m, off, cs: cached.get(off)), \
                patch.object(bs.GLOBAL_CHUNK_CACHE, "put"), \
                patch.object(bs.DISK_CACHE_MANAGER, "get", return_value=None), \
                patch.object(bs, "_cache_in_background"):
            chunks = _collect(streamer, PART)
        assert chunks == [_chunk(0), _chunk(CS), _chunk(2 * CS)]
        assert sorted(sent) == [CS, 2 * CS]  # chunk 1 came from the cache, the rest from Telegram

    def test_downloads_skip_the_ssd_cache(self):
        async def send(query, timeout=None):
            return raw.types.upload.File(type=raw.types.storage.FilePartial(), mtime=0, bytes=_chunk(query.offset))
        for cache_writes, expected in ((False, 0), (True, 3)):
            streamer = _streamer(send)
            with patch.object(bs.GLOBAL_CHUNK_CACHE, "get", return_value=None), patch.object(bs.GLOBAL_CHUNK_CACHE, "put"), \
                    patch.object(bs.DISK_CACHE_MANAGER, "get", return_value=None), \
                    patch.object(bs, "_cache_in_background") as write:
                _collect(streamer, PART, cache_writes=cache_writes)
            assert write.call_count == expected
            if expected:
                # Only the start of the file is kept longer, not every seek's first chunk
                assert [c.kwargs["is_header"] for c in write.call_args_list].count(True) == 1

    def test_cache_writes_are_bounded(self):
        async def run():
            gate = asyncio.Event()

            async def slow_put(*a, **kw):
                await gate.wait()
            with patch.object(bs.DISK_CACHE_MANAGER, "put_async", side_effect=slow_put) as put:
                for i in range(bs.MAX_PENDING_CACHE_WRITES + 10):
                    bs._cache_in_background(-100, 1, i * CS, CS, b"x")
                await asyncio.sleep(0)
                assert put.call_count == bs.MAX_PENDING_CACHE_WRITES
                gate.set()
                await asyncio.sleep(0.01)
            assert not bs._pending_cache_writes
        asyncio.run(run())


class _Dl:
    def __init__(self):
        self.bot = MagicMock(is_connected=True)
        video = MagicMock(file_unique_id="uniq", file_size=1000, mime_type="video/mp4", file_name="movie.mp4")
        self.bot.get_messages = AsyncMock(return_value=MagicMock(video=video, document=None, photo=None, audio=None, voice=None))
        self.manager = MagicMock(client_list=[self.bot])
        self.manager.get_least_busy_client.return_value = self.bot
        streamer = MagicMock()

        async def parts(*a, **kw):
            self.kwargs = kw
            yield b"x" * 10
        streamer.yield_parts = parts
        self.streamer = streamer
        database.Files.find_one.return_value = {"file_name": "movie.mp4", "file_size": 1000, "file_unique_id": "uniq", "chat_id": -100, "message_id": 77, "owner_id": "42"}

    def __enter__(self):
        stream_routes._recent_messages.clear()
        app.state.bot_manager = self.manager
        self._p = [patch("telestore.api.routes.stream.require_auth", return_value=User(username="bob", telegram_user_id=42)),
                   patch("telestore.api.routes.stream.get_byte_streamer", return_value=self.streamer)]
        for p in self._p:
            p.start()
        return self

    def __exit__(self, *a):
        for p in self._p:
            p.stop()
        app.state.bot_manager = None
        stream_routes._recent_messages.clear()


class TestResume:
    def test_etag_and_if_range(self, client):
        with _Dl():
            first = client.get("/dl/movie.mp4?file_id=uniq", headers={"Range": "bytes=0-9"})
            etag = first.headers["etag"]
            same = client.get("/dl/movie.mp4?file_id=uniq", headers={"Range": "bytes=10-19", "If-Range": etag})
            changed = client.get("/dl/movie.mp4?file_id=uniq", headers={"Range": "bytes=10-19", "If-Range": '"other-1000"'})
        assert etag == '"uniq-1000"'
        assert same.status_code == 206 and same.headers["content-range"] == "bytes 10-19/1000"
        assert changed.status_code == 200 and "content-range" not in changed.headers  # may have changed: whole file

    def test_downloads_dont_fill_the_cache_but_playback_does(self, client):
        with _Dl() as dl:
            client.get("/dl/movie.mp4?file_id=uniq&download=1")
            assert dl.kwargs["cache_writes"] is False
            client.get("/dl/movie.mp4?file_id=uniq&inline=1", headers={"Range": "bytes=0-9"})
            assert dl.kwargs["cache_writes"] is True

    def test_seeks_reuse_the_files_message(self, client):
        with _Dl() as dl:
            for start in (0, 100, 500):
                client.get("/dl/movie.mp4?file_id=uniq", headers={"Range": f"bytes={start}-{start + 9}"})
        assert dl.bot.get_messages.await_count == 1


def _basic(user="bob", password="secret"):
    return "Basic " + base64.b64encode(f"{user}:{password}".encode()).decode()


def _dav_request(auth):
    return Request({"type": "http", "method": "PROPFIND", "path": "/webdav", "headers": [(b"authorization", auth.encode())], "query_string": b"", "app": app})


class TestWebDavSignIn:
    @pytest.fixture(autouse=True)
    def clean(self):
        dav.forget_webdav_logins()
        yield
        dav.forget_webdav_logins()

    def test_the_password_is_checked_once(self):
        database.Users.getUser.return_value = {"username": "bob", "telegram_user_id": 42, "index_chat_id": -100}
        with patch.object(dav, "check_login", return_value="bob") as check:
            for _ in range(5):
                user, owner, chat = dav.authenticate_webdav(_dav_request(_basic()))
        assert check.call_count == 1 and owner == "42"

    def test_a_password_change_forgets_it(self):
        database.Users.getUser.return_value = {"username": "bob", "telegram_user_id": 42}
        with patch.object(dav, "check_login", return_value="bob") as check:
            dav.authenticate_webdav(_dav_request(_basic()))
            dav.forget_webdav_logins()
            dav.authenticate_webdav(_dav_request(_basic()))
        assert check.call_count == 2

    def test_a_removed_user_is_refused_not_given_the_owners_files(self):
        database.Users.getUser.return_value = {"username": "bob", "telegram_user_id": 42}
        with patch.object(dav, "check_login", return_value="bob"):
            dav.authenticate_webdav(_dav_request(_basic()))
        database.Users.getUser.return_value = None  # deleted meanwhile
        with pytest.raises(HTTPException) as e:
            dav.authenticate_webdav(_dav_request(_basic()))
        assert e.value.status_code == 401

    def test_the_cache_never_holds_the_password(self):
        database.Users.getUser.return_value = {"username": "bob", "telegram_user_id": 42}
        with patch.object(dav, "check_login", return_value="bob"):
            dav.authenticate_webdav(_dav_request(_basic(password="hunter2")))
        assert all("hunter2" not in k and "hunter2" not in v[0] for k, v in dav._login_cache.items())
