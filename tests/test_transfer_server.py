"""Transfers on the server and worker machines (November 2026):

1. Google's download limit is per file: only that file waits (6 h, then 12 h, then 24 h), the rest
   of its folder carries on, on the main server and on worker machines;
2. speeds are "now" (smoothed over a few seconds), with download and upload apart;
3. a folder copy's files come a page at a time, with a filter and search; its failed files can be
   retried alone; its summary says its name, source folder and destination;
4. an empty file is saved as a 0-byte record instead of failing;
5. Telegram's "sending too fast" is waited out, and the worker keeps saying it's busy meanwhile;
6. a finished Drive folder copy is checked against the folder, and missing files are copied again.
"""

import asyncio
import re
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

import pytest

from telestore import transfer_core
from telestore.services.remote_transfer_manager import manager as manager_module
from telestore.services.remote_transfer_manager.helpers import google_limit_pause
from telestore.services.remote_transfer_manager.manager import _fill_speeds, remote_transfer_manager


# ── A small in-memory collection (only what these tests use) ────────────────

def _match(doc, flt):
    for key, cond in flt.items():
        if key == "$or":
            if not any(_match(doc, f) for f in cond):
                return False
            continue
        value = doc.get(key)
        if isinstance(cond, dict):
            if "$in" in cond and value not in cond["$in"]:
                return False
            if "$nin" in cond and value in cond["$nin"]:
                return False
            if "$ne" in cond and value == cond["$ne"]:
                return False
            if "$exists" in cond and (key in doc) != cond["$exists"]:
                return False
            if "$regex" in cond and not re.search(cond["$regex"], str(value or ""), re.I if "i" in cond.get("$options", "") else 0):
                return False
        elif value != cond:
            return False
    return True


class Cursor(list):
    def sort(self, order, *a):
        for key, direction in reversed(order if isinstance(order, list) else [(order, a[0] if a else 1)]):
            super().sort(key=lambda d: (d.get(key) is None, d.get(key)), reverse=direction < 0)
        return self

    def skip(self, n):
        return Cursor(self[n:])

    def limit(self, n):
        return Cursor(self[:n])


class Coll:
    def __init__(self, docs=()):
        self.docs = []
        for d in docs:
            self.insert_one(dict(d))

    def find(self, flt=None, proj=None):
        return Cursor(dict(d) for d in self.docs if _match(d, flt or {}))  # copies, like a database

    def find_one(self, flt=None, proj=None, sort=None):
        found = self.find(flt)
        return found[0] if found else None

    def find_one_and_update(self, flt, update, **kw):
        found = self.find_one(flt)
        if found:
            self.update_one({"_id": found["_id"]}, update)
        return found

    def count_documents(self, flt):
        return len(self.find(flt))

    def insert_one(self, doc):
        doc.setdefault("_id", f"id{len(self.docs)}")
        self.docs.append(doc)

    def insert_many(self, docs):
        for d in docs:
            self.insert_one(d)

    def _apply(self, doc, update):
        doc.update(update.get("$set", {}))
        for key in update.get("$unset", {}):
            doc.pop(key, None)

    def update_one(self, flt, update, upsert=False):
        for d in self.docs:
            if _match(d, flt):
                self._apply(d, update)
                return MagicMock(matched_count=1, modified_count=1)
        if upsert:
            doc = {k: v for k, v in flt.items() if not isinstance(v, dict)}
            self._apply(doc, update)
            self.docs.append(doc)
        return MagicMock(matched_count=0, modified_count=0)

    def update_many(self, flt, update):
        hit = [d for d in self.docs if _match(d, flt)]
        for d in hit:
            self._apply(d, update)
        return MagicMock(matched_count=len(hit), modified_count=len(hit))


NOW = datetime(2026, 11, 2, 10, 0, tzinfo=timezone.utc)


# ── 1. Google's limit, one file at a time ───────────────────────────────────

def test_a_file_waits_longer_each_time_it_hits_googles_limit():
    waits = []
    task = {}
    for _ in range(4):
        update = google_limit_pause(task, NOW)
        waits.append(update["$set"]["cooldown_until"] - NOW)
        task["quota_hits"] = update["$set"]["quota_hits"]
    assert waits == [timedelta(hours=6), timedelta(hours=12), timedelta(hours=24), timedelta(hours=24)]
    assert update["$set"]["status"] == "paused_quota" and update["$set"]["speed_bps"] == 0
    assert "claimed_by" in update["$unset"]


def test_on_the_main_server_only_the_file_that_hit_the_limit_waits():
    coll = Coll([{"task_id": "a", "group_id": "G", "user_id": "42", "status": "downloading"},
                 {"task_id": "b", "group_id": "G", "user_id": "42", "status": "queued"},
                 {"task_id": "c", "group_id": "G", "user_id": "42", "status": "downloading"}])

    async def limited(task, cancel):
        raise transfer_core.GoogleLimitReached("Google Drive's download limit for 'a.zip' was reached")

    with patch.object(manager_module, "get_remote_db", return_value={"RemoteTransfers": coll}), \
            patch.object(remote_transfer_manager, "_run_download_and_upload", new=limited):
        asyncio.run(remote_transfer_manager._execute_task_wrapper({"task_id": "a", "group_id": "G", "user_id": "42"}))
    status = {d["task_id"]: d["status"] for d in coll.docs}
    assert status == {"a": "paused_quota", "b": "queued", "c": "downloading"}


@pytest.fixture
def worker_post(client, test_secrets):
    def send(coll, path, body):
        with patch("telestore.api.routes.worker.get_remote_db", return_value={"RemoteTransfers": coll}), \
                patch("telestore.api.routes.worker.database") as db, \
                patch("telestore.services.event_service.task_finished"):
            res = client.post(f"/api/worker/{path}", json=body, headers={"X-Worker-Key": test_secrets["worker_secret"]})
        return res.json(), db
    return send


def test_on_a_worker_machine_only_that_file_waits_and_longer_the_second_time(worker_post):
    coll = Coll([{"task_id": "t1", "status": "downloading", "claimed_by": "vm2", "quota_hits": 1, "group_id": "G"},
                 {"task_id": "t2", "status": "queued", "group_id": "G"}])
    body = {"task_id": "t1", "worker_id": "vm2", "error_message": "Google Drive's download limit…", "is_quota_error": True}
    assert worker_post(coll, "fail-task", body)[0] == {"status": "ok"}
    t1, t2 = coll.docs
    assert t1["status"] == "paused_quota" and t1["quota_hits"] == 2 and "claimed_by" not in t1
    assert t1["cooldown_until"] - t1["updated_at"] == timedelta(hours=12)
    assert t2["status"] == "queued"


def test_the_limit_page_and_the_limit_message_both_count():
    assert transfer_core.is_google_limit("Too many users have viewed or downloaded this file recently")
    assert transfer_core.is_google_limit("Google Drive's download limit for 'x' was reached")
    assert transfer_core.is_google_limit(transfer_core.GoogleLimitReached("anything"))
    assert not transfer_core.is_google_limit("HTTP 404 from source")


# ── 2. Speeds ───────────────────────────────────────────────────────────────

class Clock:
    def __init__(self):
        self.t = 0.0

    def __call__(self):
        return self.t


def test_speed_is_the_speed_now_not_the_average_since_the_start():
    clock = Clock()
    meter = transfer_core.SpeedMeter(clock=clock)
    total = 0
    meter.update(total)
    for _ in range(60):  # a minute at 10 MB/s
        clock.t += 1
        total += 10_000_000
        meter.update(total)
    assert 9_900_000 < meter.bps <= 10_000_000
    for _ in range(10):  # then it stalls: within seconds the speed says so (an average would still say ~8.6 MB/s)
        clock.t += 1
        meter.update(total)
    assert meter.bps < 1_500_000


def test_a_burst_doesnt_make_the_speed_jump():
    clock = Clock()
    meter = transfer_core.SpeedMeter(clock=clock)
    meter.update(0)
    clock.t += 0.5
    assert meter.update(50_000_000) < 0.2 * 100_000_000  # half a second at "100 MB/s" moves it only partly


def test_a_step_that_gives_one_speed_shows_it_on_its_side_and_still_ones_show_zero():
    down = {"speed_bps": 7, "status": "downloading"}
    _fill_speeds(down)
    assert (down["download_bps"], down["upload_bps"]) == (7, 0)
    up = {"speed_bps": 7, "status": "uploading_tg"}
    _fill_speeds(up)
    assert (up["download_bps"], up["upload_bps"]) == (0, 7)
    done = {"status": "completed", "speed_bps": 99, "download_bps": 5}
    _fill_speeds(done)
    assert (done["speed_bps"], done["download_bps"], done["upload_bps"]) == (0, 0, 0)


def test_a_worker_uploading_says_so_with_its_upload_speed(worker_post):
    coll = Coll([{"task_id": "t1", "status": "downloading", "claimed_by": "vm2"}])
    body = {"task_id": "t1", "worker_id": "vm2", "transferred_bytes": 5, "filesize": 10, "speed_bps": 3, "progress": 50.0,
            "eta_seconds": 2, "phase": "Uploading", "stage": "upload", "download_bps": 0, "upload_bps": 3}
    assert worker_post(coll, "update-progress", body)[0] == {"status": "ok"}
    doc = coll.docs[0]
    assert (doc["status"], doc["download_bps"], doc["upload_bps"], doc["worker"]) == ("uploading_tg", 0, 3, "vm2")


def test_an_older_worker_speed_counts_as_download(worker_post):
    coll = Coll([{"task_id": "t1", "status": "downloading", "claimed_by": "vm2"}])
    body = {"task_id": "t1", "worker_id": "vm2", "transferred_bytes": 5, "filesize": 10, "speed_bps": 3, "progress": 50.0,
            "eta_seconds": 2, "phase": "Leeching"}
    worker_post(coll, "update-progress", body)
    assert (coll.docs[0]["status"], coll.docs[0]["download_bps"], coll.docs[0]["upload_bps"]) == ("downloading", 3, 0)


# ── 3. A folder copy's files, a page at a time ──────────────────────────────

def _folder():
    docs = [{"task_id": "run", "status": "downloading", "filename": "big.iso", "updated_at": NOW}]
    docs += [{"task_id": f"fail{i}", "status": "failed", "filename": f"broken{i}.bin", "updated_at": NOW - timedelta(minutes=i)} for i in range(2)]
    docs += [{"task_id": f"q{i:02d}", "status": "queued" if i % 5 else "paused_quota", "filename": f"lecture{i:02d}.mp4",
              "created_at": NOW + timedelta(seconds=i)} for i in range(30)]
    docs += [{"task_id": f"d{i}", "status": "completed", "filename": f"notes{i}.pdf", "updated_at": NOW - timedelta(hours=i)} for i in range(10)]
    for i, d in enumerate(docs):
        d.update(_id=i, user_id="42", group_id="G", group_name="College", destination_path="/Home/College",
                 group_source_url="https://drive.google.com/drive/folders/abc")
    return Coll(docs)


def _page(coll, **kw):
    groups = MagicMock()
    groups.find.return_value = []
    with patch.object(manager_module, "get_remote_db", return_value={"RemoteTransfers": coll, "TransferGroups": groups}), \
            patch.object(manager_module.RemoteTransferManager, "_group_summaries", return_value={"G": {"name": "College"}}):
        return remote_transfer_manager.get_group_tasks("42", "G", **kw)


def test_a_folder_lists_running_then_failed_then_waiting_then_finished_a_page_at_a_time():
    coll = _folder()
    first = _page(coll, limit=10)
    assert first["total"] == 43 and first["summary"] == {"name": "College"}
    assert [t["task_id"] for t in first["tasks"]] == ["run", "fail0", "fail1"] + [f"q{i:02d}" for i in range(7)]
    second = _page(coll, offset=10, limit=30)
    assert [t["task_id"] for t in second["tasks"]] == [f"q{i:02d}" for i in range(7, 30)] + [f"d{i}" for i in range(7)]
    last = _page(coll, offset=40, limit=30)
    assert [t["task_id"] for t in last["tasks"]] == ["d7", "d8", "d9"]


def test_a_folder_can_show_only_one_kind_and_be_searched():
    coll = _folder()
    assert [t["task_id"] for t in _page(coll, filter="failed")["tasks"]] == ["fail0", "fail1"]
    waiting = _page(coll, filter="waiting", q="LECTURE1")
    assert waiting["total"] == 10 and all("lecture1" in t["filename"] for t in waiting["tasks"])
    assert _page(coll, filter="done", q="nothing like it")["tasks"] == []


def test_someone_elses_folder_isnt_found():
    with patch.object(manager_module, "get_remote_db", return_value={"RemoteTransfers": _folder()}):
        assert remote_transfer_manager.get_group_tasks("99", "G") is None


def test_retry_failed_queues_only_the_failed_files():
    coll = _folder()
    with patch.object(manager_module, "get_remote_db", return_value={"RemoteTransfers": coll}):
        assert remote_transfer_manager.retry_failed("G", "42") == 2
    counts = {}
    for d in coll.docs:
        counts[d["status"]] = counts.get(d["status"], 0) + 1
    assert counts == {"downloading": 1, "queued": 26, "paused_quota": 6, "completed": 10}


def test_a_folder_summary_has_its_name_source_destination_and_speeds():
    coll = MagicMock()
    coll.aggregate.return_value = [
        {"_id": {"group": "G", "status": "downloading"}, "count": 2, "filesize": 10, "transferred": 4, "speed": 9, "down": 6, "up": 3,
         "created_at": NOW},
        {"_id": {"group": "G", "status": "completed"}, "count": 1, "filesize": 5, "transferred": 5, "speed": 50, "down": 50, "up": 0,
         "created_at": NOW - timedelta(hours=1)},
    ]
    coll.find_one.return_value = {"group_name": "College", "group_source_url": "https://drive.google.com/drive/folders/abc",
                                  "destination_path": "/Home/College/Sem 1"}
    g = manager_module.RemoteTransferManager._group_summaries(coll, "42", ["G"])["G"]
    assert (g["name"], g["source_url"], g["destination_path"]) == ("College", "https://drive.google.com/drive/folders/abc", "/Home/College/Sem 1")
    assert (g["speed_bps"], g["download_bps"], g["upload_bps"]) == (9, 6, 3)  # finished files' last speeds don't count
    assert g["created_at"] == (NOW - timedelta(hours=1)).isoformat()


def test_the_folder_page_route(client, test_secrets):
    from telestore.api.app import app
    from telestore.security.credentials import User, require_auth
    app.dependency_overrides[require_auth] = lambda: User(username="bob", telegram_user_id=42)
    try:
        with patch.object(remote_transfer_manager, "get_group_tasks", return_value=None) as page:
            assert client.get("/transfers/remote/groups/G/tasks?filter=failed&q=a&offset=50").status_code == 404
        page.assert_called_once_with("42", "G", "failed", "a", 50, 50)
        assert client.get("/transfers/remote/groups/G/tasks?filter=everything").status_code == 422
    finally:
        app.dependency_overrides.pop(require_auth, None)


# ── 4. Empty files ──────────────────────────────────────────────────────────

def test_an_empty_file_is_a_record_with_no_message():
    from telestore.db.repositories.files import Files
    files = Coll()
    saved = Files.save_empty(files, "notes.txt", "/Home/College", "42", key="t1")
    assert saved["file_size"] == 0 and saved["message_id"] is None and saved["file_unique_id"] == "empty_t1"
    assert files.docs[0]["file_path"] == "/Home/College" and files.docs[0]["file_caption"] == "Uploaded file: notes.txt"
    Files.save_empty(files, "notes.txt", "/Home/College", "42", key="t2")  # again: emptied, not doubled
    assert len(files.docs) == 1 and files.docs[0]["file_unique_id"] == "empty_t2"


def test_a_worker_reporting_an_empty_file_saves_it_as_a_record(worker_post):
    coll = Coll([{"task_id": "t1", "status": "downloading", "claimed_by": "vm2"}])
    body = {"task_id": "t1", "worker_id": "vm2", "user_id": "42", "chat_id": -100, "destination_path": "/Home/College",
            "file_name": "Lec-3.mp4", "file_size": 0, "is_empty": True}
    result, db = worker_post(coll, "complete-task", body)
    assert result == {"status": "ok"}
    db.Files.save_empty.assert_called_once()
    assert db.Files.save_empty.call_args.args[:3] == ("Lec-3.mp4", "/Home/College", "42")
    assert not db.Files.claim_upload.called
    assert coll.docs[0]["status"] == "completed" and "empty file" in coll.docs[0]["phase"]


def test_an_empty_download_sends_no_part_to_telegram(tmp_path):
    from telestore.services.remote_transfer_manager.pipeline import PipelinedStreamWriter
    ready = []
    writer = PipelinedStreamWriter(tg_dir=str(tmp_path), semaphore=MagicMock(), cancel_event=MagicMock(is_set=lambda: False),
                                   on_part_ready=lambda *a, **k: ready.append(a))
    writer.finish()
    writer.cleanup()
    assert ready == [] and writer.total_bytes == 0


# ── 5. Telegram's "sending too fast" ────────────────────────────────────────

class FloodWait(Exception):
    def __init__(self, value):
        super().__init__(f'Telegram says: [420 FLOOD_WAIT_X] - A wait of {value} seconds is required (caused by "messages.SendMedia")')
        self.value = value


def test_telegrams_wait_is_waited_out_then_sent():
    waited, tries = [], []

    async def send():
        tries.append(1)
        if len(tries) < 3:
            raise FloodWait(40)
        return "sent"

    async def sleep(s):
        waited.append(s)

    assert asyncio.run(transfer_core.retry_after_flood(send, sleep=sleep)) == "sent"
    assert waited == [41, 41]


def test_other_errors_and_very_long_waits_are_not_retried():
    async def broken():
        raise RuntimeError("HTTP 400")

    async def forever():
        raise FloodWait(5000)

    async def sleep(s):
        raise AssertionError("no waiting")

    with pytest.raises(RuntimeError):
        asyncio.run(transfer_core.retry_after_flood(broken, sleep=sleep))
    with pytest.raises(FloodWait):
        asyncio.run(transfer_core.retry_after_flood(forever, sleep=sleep))
    assert transfer_core.flood_wait_seconds(RuntimeError("[420 FLOOD_WAIT_X] - A wait of 12 seconds is required")) == 12


@pytest.fixture
def worker():
    import importlib
    import sys
    from pathlib import Path
    with patch.dict("os.environ", {"WORKER_KEY": "test", "LOG_DIR": "/tmp/telestore-worker-test-logs"}):
        sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "worker"))
        try:
            yield importlib.import_module("worker")
        finally:
            sys.path.pop(0)


def test_a_waiting_worker_keeps_telling_the_master_its_busy(worker):
    w = worker.DistributedWorker.__new__(worker.DistributedWorker)
    w.last_report = {"t1": {"transferred_bytes": 5, "filesize": 10, "progress": 50.0}}
    reports, tries = [], []

    async def report(task_id, transferred, total, speed, progress, eta, phase, stage="download"):
        reports.append((transferred, stage, phase))
    w.report_progress = report

    async def send():
        tries.append(1)
        if len(tries) == 1:
            raise FloodWait(0)
        return "sent"

    assert asyncio.run(w.send(send, "t1")) == "sent"
    assert reports and reports[0][:2] == (5, "upload") and "Telegram asks to wait" in reports[0][2]


def test_the_worker_uses_the_shared_checks(worker):
    assert worker.check_download is transfer_core.check_download or worker.check_download.__module__ == "transfer_core"
    assert worker.is_gdrive_quota_error("Google Drive's download limit for 'x' was reached")


# ── 6. The end-of-copy check ────────────────────────────────────────────────

def test_a_finished_folder_copy_queues_whats_missing_once_and_says_so():
    from telestore.services.remote_transfer_manager import folder_check
    base = {"user_id": "42", "chat_id": -100, "group_id": "G", "group_name": "College", "group_folder_id": "abc",
            "group_destination": "/Home", "group_source_url": "https://drive.google.com/drive/folders/abc"}
    tasks = Coll([{**base, "task_id": "a", "gdrive_id": "1", "status": "completed", "destination_path": "/Home/College"},
                  {**base, "task_id": "b", "gdrive_id": "2", "status": "failed", "destination_path": "/Home/College/Sem 1"}])
    groups, files = Coll(), Coll([{"owner_id": "42", "file_path": "/Home/College", "file_name": "a.pdf"}])
    listing = [("1", "College", "a.pdf"), ("2", "College/Sem 1", "b.pdf"), ("3", "College/Sem 1", "c.pdf")]
    with patch.object(folder_check, "get_remote_db", return_value={"RemoteTransfers": tasks, "TransferGroups": groups}), \
            patch("telestore.services.event_service.record") as notice:
        check = folder_check.check_folder_copy("G", lister=lambda folder: listing, files=files)
        assert (check["listed"], check["found"], check["missing"], check["failed"]) == (3, 1, 1, 1)
        queued = tasks.find_one({"gdrive_id": "3"})
        assert queued["status"] == "queued" and queued["destination_path"] == "/Home/College/Sem 1" and queued["filename"] == "c.pdf"
        assert queued["group_id"] == "G" and queued["group_destination"] == "/Home"
        assert "1 file(s) were missing" in notice.call_args.args[3]
        folder_check.check_folder_copy("G", lister=lambda folder: listing, files=files)  # second round: nothing new to queue
        folder_check.check_folder_copy("G", lister=lambda folder: (_ for _ in ()).throw(AssertionError("no third round")), files=files)
    assert len([d for d in tasks.docs if d["gdrive_id"] == "3"]) == 1  # already on its way: not queued twice, and no third round
    assert groups.docs[0]["check_rounds"] == 2


def test_copies_from_before_the_check_are_left_alone():
    from telestore.services.remote_transfer_manager import folder_check
    tasks = Coll([{"task_id": "a", "group_id": "G", "user_id": "42", "status": "completed"}])
    with patch.object(folder_check, "get_remote_db", return_value={"RemoteTransfers": tasks, "TransferGroups": Coll()}):
        assert folder_check.check_folder_copy("G", lister=lambda f: [], files=Coll()) is None
