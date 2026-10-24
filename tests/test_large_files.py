"""Large files: chunked uploads keep every byte once, ranges follow HTTP, streams never send
misplaced bytes, WebDAV saves multi-part and empty files properly, and deleting a copy keeps
the data the other copy uses."""

import asyncio
import io
import os
import time
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException
from starlette.datastructures import UploadFile
from starlette.requests import Request

from telestore.api import state
from telestore.api.app import app
from telestore.api.routes.files import upload as upload_routes
from telestore.db import database
from telestore.db.repositories.files import Files
from telestore.security.credentials import User
from telestore.services.streaming_utils import RangeNotSatisfiable, parse_byte_range

USER = User(username="bob", telegram_user_id=42)


def _session(tmp_path, **extra):
    return {
        "upload_id": "u1", "filename": "movie.mkv", "filesize": 30, "path": "/Home", "user_id": "42",
        "created_at": "2026-10-25T00:00:00", "last_activity": time.time(), "next_chunk": 0, "lock": asyncio.Lock(),
        "total_written": 0, "current_part_index": 1, "current_part_written": 0, "parts": [], "dir": str(tmp_path),
        "upload_tasks": [], "disk_semaphore": asyncio.Semaphore(1), **extra,
    }


def _chunk(data: bytes) -> UploadFile:
    return UploadFile(file=io.BytesIO(data), filename="movie.mkv")


def _request():
    return Request({"type": "http", "method": "POST", "path": "/", "headers": [], "query_string": b"", "app": app})


class TestChunkedUpload:
    def _send(self, upload_id, index, data):
        return asyncio.run(upload_routes.upload_file_chunk(_request(), upload_id, index, _chunk(data), USER))

    def test_a_chunk_sent_twice_is_kept_once(self, tmp_path):
        upload_routes._active_upload_sessions["u1"] = _session(tmp_path)
        try:
            self._send("u1", 0, b"a" * 10)
            again = self._send("u1", 0, b"a" * 10)  # the reply was lost and the browser retried
            self._send("u1", 1, b"b" * 10)
            assert again["status"] == "duplicate"
            assert (tmp_path / "part_1.tmp").read_bytes() == b"a" * 10 + b"b" * 10
            assert upload_routes._active_upload_sessions["u1"]["total_written"] == 20
        finally:
            upload_routes._active_upload_sessions.pop("u1", None)

    def test_a_chunk_from_the_future_is_refused_with_the_expected_index(self, tmp_path):
        upload_routes._active_upload_sessions["u1"] = _session(tmp_path)
        try:
            with pytest.raises(HTTPException) as e:
                self._send("u1", 3, b"x")
            assert e.value.status_code == 409 and e.value.detail["next_chunk"] == 0
            assert not (tmp_path / "part_1.tmp").exists()
        finally:
            upload_routes._active_upload_sessions.pop("u1", None)

    def test_complete_refuses_a_file_with_missing_bytes(self, tmp_path, client):
        upload_routes._active_upload_sessions["u1"] = _session(tmp_path, total_written=20)
        app.dependency_overrides[upload_routes.require_auth] = lambda: USER
        database.Users.find_one.return_value = {"index_chat_id": -100}
        app.state.bot_manager = MagicMock()
        try:
            res = client.post("/files/upload/complete", data={"upload_id": "u1"})
            assert res.status_code == 409 and "received 20 of 30 bytes" in res.json()["detail"]["message"]
        finally:
            upload_routes._active_upload_sessions.pop("u1", None)
            app.dependency_overrides.pop(upload_routes.require_auth, None)
            app.state.bot_manager = None

    def test_no_bot_at_a_part_boundary_keeps_the_chunk_out(self, tmp_path):
        upload_routes._active_upload_sessions["u1"] = _session(tmp_path, current_part_written=1950 * 1024 * 1024 - 5)
        database.Users.find_one.return_value = {}
        try:
            with pytest.raises(HTTPException) as e:
                self._send("u1", 0, b"z" * 10)
            assert e.value.status_code == 503
            # Not written, so the retry is a real write and not a "duplicate"
            assert upload_routes._active_upload_sessions["u1"]["next_chunk"] == 0
            assert not (tmp_path / "part_1.tmp").exists()
        finally:
            upload_routes._active_upload_sessions.pop("u1", None)

    def test_long_uploads_are_only_dropped_when_idle(self, tmp_path, client):
        long_running = _session(tmp_path / "a", created_at="2026-10-24T00:00:00", last_activity=time.time())
        idle = _session(tmp_path / "b", last_activity=time.time() - 2 * 3600)
        (tmp_path / "a").mkdir()
        (tmp_path / "b").mkdir()
        upload_routes._active_upload_sessions.update({"old_but_busy": long_running, "idle": idle})
        app.dependency_overrides[upload_routes.require_upload] = lambda: USER
        try:
            client.post("/files/upload/init", json={"filename": "x.bin", "filesize": 1, "path": "/Home"})
            assert "old_but_busy" in upload_routes._active_upload_sessions
            assert "idle" not in upload_routes._active_upload_sessions
        finally:
            for key in list(upload_routes._active_upload_sessions):
                upload_routes._active_upload_sessions.pop(key, None)
            app.dependency_overrides.pop(upload_routes.require_upload, None)


class TestJanitor:
    def test_running_uploads_are_left_alone(self, tmp_path, monkeypatch):
        monkeypatch.chdir(tmp_path)
        tg = tmp_path / "tg_files"
        for name in ("chunk_live", "chunk_dead", "dav_live_part_1.tmp", "dav_dead_part_1.tmp"):
            path = tg / name
            if name.startswith("chunk"):
                path.mkdir(parents=True)
                (path / "part_1.tmp").write_bytes(b"x")
            else:
                path.write_bytes(b"x")
        old = time.time() - 3 * 3600
        for root, dirs, files in os.walk(tg):
            for n in dirs + files:
                os.utime(os.path.join(root, n), (old, old))
        upload_routes._active_upload_sessions["live"] = {"dir": str(tg / "chunk_live")}
        state.active_dav_uploads.add("live")
        try:
            state.cleanup_stale_upload_files(3600)
        finally:
            upload_routes._active_upload_sessions.pop("live", None)
            state.active_dav_uploads.discard("live")
        assert sorted(os.listdir(tg)) == ["chunk_live", "dav_live_part_1.tmp"]

    def test_a_folder_with_a_fresh_file_is_kept(self, tmp_path, monkeypatch):
        monkeypatch.chdir(tmp_path)
        folder = tmp_path / "tg_files" / "chunk_orphan"
        folder.mkdir(parents=True)
        (folder / "part_1.tmp").write_bytes(b"x")  # still being written
        old = time.time() - 3 * 3600
        os.utime(folder, (old, old))
        state.cleanup_stale_upload_files(3600)
        assert folder.exists()


class TestRanges:
    @pytest.mark.parametrize("header, expected", [
        ("bytes=0-499", (0, 499)),
        ("bytes=500-", (500, 999)),
        ("bytes=-200", (800, 999)),          # the last 200 bytes (was read as the first 201)
        ("bytes=900-5000", (900, 999)),      # past the end: trimmed (was an error)
        ("bytes=-5000", (0, 999)),
        ("bytes=0-0", (0, 0)),
        ("", None),
        ("items=0-10", None),                # another unit: whole file
        ("bytes=0-10,20-30", None),          # several ranges: whole file
        ("bytes=abc", None),
        ("bytes=50-10", None),
    ])
    def test_ranges(self, header, expected):
        assert parse_byte_range(header, 1000) == expected

    @pytest.mark.parametrize("header", ["bytes=1000-", "bytes=5000-6000", "bytes=-0"])
    def test_not_satisfiable(self, header):
        with pytest.raises(RangeNotSatisfiable):
            parse_byte_range(header, 1000)


class _Dl:
    """The pieces /dl needs: a signed-in user, a bot and a file record."""
    def __init__(self, record):
        self.bot = MagicMock(is_connected=True)
        video = MagicMock(file_unique_id="uniq", file_size=(record or {}).get("file_size", 0), mime_type="video/mp4", file_name="movie.mp4")
        self.bot.get_messages = AsyncMock(return_value=MagicMock(video=video, document=None, photo=None, audio=None, voice=None))
        manager = MagicMock(client_list=[self.bot])
        manager.get_least_busy_client.return_value = self.bot
        self.manager = manager
        self.streamer = MagicMock()
        self.pulled = []

        async def parts(*a, **kw):
            self.pulled.append(1)
            yield b"x" * 10
        self.streamer.yield_parts = parts
        database.Files.find_one.return_value = record

    def __enter__(self):
        app.state.bot_manager = self.manager
        self._patches = [patch("telestore.api.routes.stream.require_auth", return_value=USER),
                         patch("telestore.api.routes.stream.get_byte_streamer", return_value=self.streamer)]
        for p in self._patches:
            p.start()
        return self

    def __exit__(self, *a):
        for p in self._patches:
            p.stop()
        app.state.bot_manager = None


RECORD = {"file_name": "movie.mp4", "file_size": 1000, "file_unique_id": "uniq", "chat_id": -100, "message_id": 9, "owner_id": "42"}


class TestDownloadRoute:
    def test_head_sends_headers_without_pulling_the_file(self, client):
        with _Dl(RECORD) as dl:
            res = client.head("/dl/movie.mp4?file_id=uniq")
        assert res.status_code == 200 and res.headers["content-length"] == "1000"
        assert dl.pulled == []  # nothing fetched from Telegram

    def test_range_past_the_end_is_416_not_500(self, client):
        with _Dl(RECORD):
            res = client.get("/dl/movie.mp4?file_id=uniq", headers={"Range": "bytes=5000-"})
        assert res.status_code == 416 and res.headers["content-range"] == "bytes */1000"

    def test_cache_header_is_private(self, client):
        with _Dl(RECORD):
            res = client.get("/dl/movie.mp4?file_id=uniq", headers={"Range": "bytes=0-9"})
        assert res.status_code == 206 and "private" in res.headers["cache-control"] and "immutable" not in res.headers["cache-control"]

    def test_every_lookup_is_limited_to_the_signed_in_user(self, client):
        with _Dl(None):
            res = client.get("/dl/movie.mp4?file_id=6531a0f2c3b4a5d6e7f80910&path=/Home")
        assert res.status_code == 404
        queries = [c.args[0] for c in database.Files.find_one.call_args_list if c.args and isinstance(c.args[0], dict)]
        assert len(queries) >= 5  # by ID, by unique ID, by path, by name...
        assert all(set(q.get("owner_id", {}).get("$in", [])) == {"42", "bob"} for q in queries), queries

    def test_an_empty_file_downloads_as_empty(self, client):
        with _Dl({"file_name": "new.txt", "file_size": 0, "file_unique_id": "empty_1", "chat_id": None, "message_id": None, "owner_id": "42"}):
            res = client.get("/dl/new.txt?file_id=empty_1")
        assert res.status_code == 200 and res.content == b""


class TestStreamNeverShiftsBytes:
    def test_a_missing_chunk_stops_the_stream(self):
        """Part 1's second chunk can't be fetched: the stream must stop there, not go on to part 2."""
        from pyrogram import raw
        from telestore.services import byte_streamer as bs

        cs = 1024 * 1024
        streamer = bs.ByteStreamer.__new__(bs.ByteStreamer)
        streamer.client = MagicMock()

        async def send(query, timeout=None):
            if query.offset == cs:  # part 1, chunk 2
                raise OSError("network")
            return raw.types.upload.File(type=raw.types.storage.FilePartial(), mtime=0, bytes=bytes([query.offset // cs % 251]) * cs)
        session = MagicMock()
        session.send = send
        streamer.get_file_properties = AsyncMock(return_value="fid")
        streamer.generate_media_session = AsyncMock(return_value=session)
        streamer.get_location = AsyncMock(return_value="loc")

        parts = [
            {"chat_id": -100, "message_id": 1, "part_from_byte": 0, "part_until_byte": 3 * cs - 1, "part_index": 1},
            {"chat_id": -100, "message_id": 2, "part_from_byte": 0, "part_until_byte": cs - 1, "part_index": 2},
        ]

        async def collect():
            out = []
            async for chunk in streamer.yield_parts(parts, chunk_size=cs, client_list=[streamer.client]):
                out.append(chunk)
            return out
        with patch.object(bs.DISK_CACHE_MANAGER, "get", return_value=None), \
                patch.object(bs.DISK_CACHE_MANAGER, "put_async", AsyncMock()), \
                patch.object(bs.GLOBAL_CHUNK_CACHE, "get", return_value=None), \
                patch.object(bs.GLOBAL_CHUNK_CACHE, "put"), \
                patch("asyncio.sleep", AsyncMock()):
            chunks = asyncio.run(collect())
        # Only part 1's first chunk: nothing from part 2 is sent in its place
        assert len(chunks) == 1 and chunks[0] == bytes([0]) * cs


class TestWebDav:
    def test_mark_split_files(self):
        repo = Files.__new__(Files)
        with patch.object(Files, "update_many", return_value=MagicMock(modified_count=10)) as update_many:
            assert repo.mark_split_files() == 10
        query, pipeline = update_many.call_args.args
        assert query == {"parts.1": {"$exists": True}, "is_split": {"$ne": True}}
        assert pipeline[0]["$set"]["is_split"] is True

    def _put(self, body: bytes, existing=None):
        from telestore.api.routes.webdav import transfer

        async def receive():
            return {"type": "http.request", "body": body, "more_body": False}
        request = Request({"type": "http", "method": "PUT", "path": "/webdav/Home/new.txt", "headers": [], "query_string": b"", "app": app}, receive)
        app.state.bot_manager = MagicMock()
        database.Files.find_one.return_value = existing
        try:
            return asyncio.run(transfer.handle_put(request, ["Home", "new.txt"], "42", -100))
        finally:
            app.state.bot_manager = None

    def test_an_empty_put_creates_an_empty_file(self, tmp_path, monkeypatch):
        monkeypatch.chdir(tmp_path)
        res = self._put(b"")
        assert res.status_code == 201
        doc = database.Files.insert_one.call_args.args[0]
        assert doc["file_size"] == 0 and doc["message_id"] is None and doc["file_name"] == "new.txt" and doc["file_path"] == "/Home"

    def test_vault_files_are_hidden_in_starred_and_trash(self, client):
        from telestore.api.routes.webdav import transfer
        database.Files.find_one.return_value = None
        request = Request({"type": "http", "method": "GET", "path": "/", "headers": [], "query_string": b"", "app": app})
        for top in ("Starred", "Trash"):
            with pytest.raises(HTTPException):
                asyncio.run(transfer.handle_get_head(request, [top, "secret.pdf"], "42", False))
            assert database.Files.find_one.call_args.args[0]["is_vault"] == {"$ne": True}


class TestSharedMessages:
    def test_a_copy_keeps_its_messages(self):
        repo = Files.__new__(Files)
        # Message 5 is still used by a copy; 6 and 7 aren't
        with patch.object(Files, "find", return_value=[{"message_id": 5, "parts": None}]):
            assert repo.unreferenced_messages({-100: {5, 6, 7}}) == {-100: {6, 7}}

    def test_nothing_left_to_delete(self):
        repo = Files.__new__(Files)
        with patch.object(Files, "find", return_value=[{"message_id": 1, "parts": [{"message_id": 2}]}]):
            assert repo.unreferenced_messages({-100: {1, 2}}) == {}
