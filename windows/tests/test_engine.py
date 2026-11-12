"""The upload engine with a fake Telegram account and a fake TeleStore server."""

import asyncio
import os
import time

import pytest

from telestore_desktop.api import ApiError
from telestore_desktop.engine import UploadEngine
from telestore_desktop.jobs import DONE, FAILED, PAUSED, JobStore
from telestore_desktop.telegram import TelegramError

PART = 10  # tiny parts, so a 25-byte file is 3 parts


def plan(name, size):
    """The server's /direct/prepare plan (telestore/api/routes/direct.py), with tiny parts."""
    total = max(1, -(-size // PART))
    if total == 1:
        return [{"part_index": 1, "start": 0, "length": size, "file_name": name, "caption": f"Uploaded file: {name}"}]
    return [{"part_index": i, "start": (i - 1) * PART, "length": min(PART, size - (i - 1) * PART),
             "file_name": f"{name}.part{i}", "caption": f"{name} (Part {i})"} for i in range(1, total + 1)]


class FakeApi:
    def __init__(self):
        self.completed, self.folders_made, self.complete_error = [], [], None

    def prepare(self, path, filename, filesize):
        return {"chat_id": -100, "path": path, "parts": plan(filename, filesize), "total_parts": len(plan(filename, filesize))}

    def complete(self, path, filename, filesize, parts, taken_at=None):
        if self.complete_error:
            raise self.complete_error
        self.completed.append((path, filename, filesize, parts))
        return {"message": "File saved"}

    def create_folder_path(self, full_path):
        self.folders_made.append(full_path)
        return {}


class FakeAccount:
    def __init__(self):
        self.sent = {}  # message id -> (file name, caption, bytes)
        self.next_id = 100
        self.fail_parts = set()  # file names that fail once
        self.running = 0
        self.most = 0
        self.delay = 0.0
        self.chats = []

    async def start(self):
        pass

    async def stop(self):
        pass

    async def ensure_chat(self, chat_id):
        self.chats.append(chat_id)

    async def send(self, chat_id, make_reader, file_name, caption, thumb, progress, on_wait=None):
        self.running += 1
        self.most = max(self.most, self.running)
        try:
            await asyncio.sleep(self.delay)
            reader = make_reader()
            reader.seek(0, 2)
            size = reader.tell()
            reader.seek(0)
            data = reader.read()
            reader.close()
            await progress(size, size)
            if file_name in self.fail_parts:
                self.fail_parts.discard(file_name)
                raise TelegramError("Telegram upload failed: network")
            self.next_id += 1
            self.sent[self.next_id] = (file_name, caption, data)
            return self.next_id
        finally:
            self.running -= 1


def wait_for(cond, timeout=5):
    end = time.time() + timeout
    while time.time() < end:
        if cond():
            return
        time.sleep(0.02)
    raise AssertionError("timed out")


@pytest.fixture
def engine():
    api, account, store = FakeApi(), FakeAccount(), JobStore()
    eng = UploadEngine(api, account, store, parallel=2)
    eng.start()
    eng.ready.wait(2)
    yield eng
    eng.stop()


def _file(tmp_path, name="film.mkv", data=None):
    p = tmp_path / name
    p.write_bytes(data if data is not None else bytes(range(25)))
    return str(p)


def test_a_big_file_goes_in_parts_and_is_saved(engine, tmp_path):
    path = _file(tmp_path)
    engine.add([path], "/Home/Movies").result(5)
    job = engine.store.all()[0]
    wait_for(lambda: job.status == DONE)
    (dest, name, size, parts), = engine.api.completed
    assert (dest, name, size) == ("/Home/Movies", "film.mkv", 25)
    assert [i for i, _ in parts] == [1, 2, 3]
    got = b"".join(engine.account.sent[m][2] for _, m in parts)
    assert got == bytes(range(25))
    assert [engine.account.sent[m][1] for _, m in parts] == ["film.mkv (Part 1)", "film.mkv (Part 2)", "film.mkv (Part 3)"]
    assert job.progress == 100 and engine.account.chats == [-100]


def test_a_small_file_is_one_message(engine, tmp_path):
    engine.add([_file(tmp_path, "a.txt", b"hello")], "/Home").result(5)
    wait_for(lambda: engine.api.completed)
    (_, _, _, parts), = engine.api.completed
    assert engine.account.sent[parts[0][1]][:2] == ("a.txt", "Uploaded file: a.txt")


def test_a_failed_part_keeps_the_finished_ones_and_retry_sends_only_the_rest(engine, tmp_path):
    engine.account.fail_parts = {"film.mkv.part2"}
    engine.account.delay = 0.01
    engine.add([_file(tmp_path)], "/Home").result(5)
    job = engine.store.all()[0]
    wait_for(lambda: job.status == FAILED)
    assert "network" in job.error and "2" not in job.done_parts
    kept = set(job.done_parts)
    before = len(engine.account.sent)
    engine.resume(job.id)
    wait_for(lambda: job.status == DONE)
    sent_again = [v[0] for v in engine.account.sent.values()][before:]
    assert sorted(sent_again) == sorted(f"film.mkv.part{i}" for i in (1, 2, 3) if str(i) not in kept)
    assert [i for i, _ in engine.api.completed[0][3]] == [1, 2, 3]


def test_resume_after_a_restart_sends_only_missing_parts(tmp_path):
    store = JobStore()
    api, account = FakeApi(), FakeAccount()
    path = _file(tmp_path)
    from telestore_desktop.jobs import Job
    from telestore_desktop.parts import file_key
    job = store.add(Job(local_path=path, dest="/Home", name="film.mkv", size=25, key=file_key(path, "/Home"),
                        status="uploading", done_parts={"1": 7, "2": 8}))
    eng = UploadEngine(api, account, JobStore(), parallel=2)  # a new start reads the list again
    eng.start()
    try:
        wait_for(lambda: api.completed)
        assert [v[0] for v in account.sent.values()] == ["film.mkv.part3"]
        assert api.completed[0][3][:2] == [(1, 7), (2, 8)]
    finally:
        eng.stop()
    assert job.id


def test_never_more_parts_at_once_than_set(engine, tmp_path):
    engine.account.delay = 0.05
    engine.add([_file(tmp_path, f"f{i}.bin") for i in range(3)], "/Home").result(5)
    wait_for(lambda: len(engine.api.completed) == 3, 10)
    assert engine.account.most <= 2


def test_pause_and_resume(engine, tmp_path):
    engine.account.delay = 0.3
    engine.add([_file(tmp_path)], "/Home").result(5)
    job = engine.store.all()[0]
    wait_for(lambda: engine.account.running > 0)
    engine.pause(job.id)
    wait_for(lambda: job.status == PAUSED)
    engine.account.delay = 0
    engine.resume(job.id)
    wait_for(lambda: job.status == DONE)


def test_already_saved_counts_as_done(engine, tmp_path):
    engine.api.complete_error = ApiError("That upload is already saved as a file.", 409)
    engine.add([_file(tmp_path, "a.txt", b"x")], "/Home").result(5)
    job = engine.store.all()[0]
    wait_for(lambda: job.status == DONE)


def test_a_server_refusal_is_shown(engine, tmp_path):
    engine.api.complete_error = ApiError("Part 1 has the wrong size.", 400)
    engine.add([_file(tmp_path, "a.txt", b"x")], "/Home").result(5)
    job = engine.store.all()[0]
    wait_for(lambda: job.status == FAILED)
    assert job.error == "Part 1 has the wrong size."


def test_a_folder_keeps_its_layout(engine, tmp_path):
    root = tmp_path / "Trip"
    (root / "Day 1").mkdir(parents=True)
    (root / "notes.txt").write_bytes(b"n")
    (root / "Day 1" / "beach.jpg").write_bytes(b"photo")
    (root / "empty.txt").write_bytes(b"")
    added = engine.add([str(root)], "/Home").result(5)
    assert sorted((j.dest, j.name) for j in added) == [("/Home/Trip", "notes.txt"), ("/Home/Trip/Day 1", "beach.jpg")]
    assert engine.api.folders_made == ["/Home/Trip", "/Home/Trip/Day 1"]
    assert any("empty" in n for n in engine.take_notes())
    wait_for(lambda: len(engine.api.completed) == 2)


def test_a_changed_file_isnt_sent(engine, tmp_path):
    engine.account.delay = 0.2
    path = _file(tmp_path)
    engine.add([path], "/Home").result(5)
    job = engine.store.all()[0]
    engine.pause(job.id)
    wait_for(lambda: job.status == PAUSED)
    with open(path, "ab") as f:
        f.write(b"changed")
    os.utime(path, (time.time() + 10, time.time() + 10))
    engine.resume(job.id)
    wait_for(lambda: job.status == FAILED)
    assert "changed" in job.error


def test_speed_cap_slows_uploads(tmp_path):
    api, account, store = FakeApi(), FakeAccount(), JobStore()
    eng = UploadEngine(api, account, store, parallel=1, speed_limit_kb=1)  # 1 KB/s
    eng.limit.BURST_SECONDS = 0
    eng.start()
    try:
        start = time.time()
        eng.add([_file(tmp_path, "k.bin", b"x" * 1536)], "/Home").result(5)  # 1.5 KB
        wait_for(lambda: api.completed, 10)
        assert time.time() - start >= 1.2
    finally:
        eng.stop()


def test_opening_straight_from_telegram_starts_and_stops_with_the_engine(tmp_path):
    from telestore_desktop.items import Item
    api, account, store = FakeApi(), FakeAccount(), JobStore()
    api.direct = None
    eng = UploadEngine(api, account, store, direct_open=True)
    eng.start()
    wait_for(lambda: api.direct is not None)
    url = api.direct(Item(id="1", name="a.mkv", kind="video"), True)
    assert url.startswith(f"http://127.0.0.1:{eng.media.port}/")
    eng.set_direct_open(False)
    assert api.direct is None
    eng.set_direct_open(True)
    assert api.direct is not None
    eng.stop()
    assert api.direct is None
