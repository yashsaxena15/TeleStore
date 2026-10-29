"""A worker's reports count only while the task is still theirs: a task taken back (watchdog, server
restart) and started elsewhere can't be saved twice, and a worker still busy with it gets it back."""

from unittest.mock import patch

import pytest

from telestore.services.remote_transfer_manager.helpers import friendly_error


def _matches(doc, flt):
    for key, cond in flt.items():
        if key == "$or":
            if not any(_matches(doc, f) for f in cond):
                return False
        elif isinstance(cond, dict):
            if "$exists" in cond and (key in doc) != cond["$exists"]:
                return False
            if "$in" in cond and doc.get(key) not in cond["$in"]:
                return False
        elif doc.get(key) != cond:
            return False
    return True


class Result:
    def __init__(self, n):
        self.matched_count = self.modified_count = n


class Transfers:
    """RemoteTransfers, for the filters the worker routes use."""

    def __init__(self, **task):
        self.doc = {"task_id": "t1", **task}

    def find_one(self, flt, *a, **k):
        return self.doc if _matches(self.doc, flt) else None

    def update_one(self, flt, update, **k):
        if not _matches(self.doc, flt):
            return Result(0)
        self.doc.update(update.get("$set", {}))
        for key in update.get("$unset", {}):
            self.doc.pop(key, None)
        return Result(1)

    def find_one_and_update(self, flt, update, **k):
        return self.doc if self.update_one(flt, update).matched_count else None


PROGRESS = {"task_id": "t1", "worker_id": "vm2", "transferred_bytes": 5, "filesize": 10, "speed_bps": 1,
            "progress": 50.0, "eta_seconds": 5, "phase": "Uploading to Telegram ☁️ (50.0%)"}
DONE = {"task_id": "t1", "worker_id": "vm2", "user_id": "42", "chat_id": -100, "destination_path": "/Home",
        "file_name": "a.zip", "file_size": 10, "message_id": 7, "file_unique_id": "u7"}


@pytest.fixture
def post(client, test_secrets):
    def send(coll, path, body):
        with patch("telestore.api.routes.worker.get_remote_db", return_value={"RemoteTransfers": coll}), \
                patch("telestore.api.routes.worker.database") as db, \
                patch("telestore.services.event_service.task_finished"):
            res = client.post(f"/api/worker/{path}", json=body, headers={"X-Worker-Key": test_secrets["worker_secret"]})
        return res.json(), db
    return send


def test_progress_from_the_worker_that_has_it(post):
    coll = Transfers(status="downloading", claimed_by="vm2")
    assert post(coll, "update-progress", PROGRESS)[0] == {"status": "ok"}
    assert coll.doc["phase"].startswith("[vm2] Uploading")


def test_a_busy_worker_gets_back_a_task_the_watchdog_took(post):
    coll = Transfers(status="queued")
    assert post(coll, "update-progress", PROGRESS)[0] == {"status": "ok"}
    assert (coll.doc["status"], coll.doc["claimed_by"]) == ("downloading", "vm2")


@pytest.mark.parametrize("task", [
    {"status": "downloading", "claimed_by": "master-vm1"},
    {"status": "cancelled"},
    {"status": "completed", "claimed_by": "vm2"},
])
def test_a_worker_stops_when_the_task_isnt_theirs(post, task):
    coll = Transfers(**task)
    assert post(coll, "update-progress", PROGRESS)[0] == {"status": "cancelled"}
    assert "transferred_bytes" not in coll.doc


def test_a_finished_upload_is_saved_once(post):
    coll = Transfers(status="downloading", claimed_by="vm2")
    body, db = post(coll, "complete-task", DONE)
    assert body == {"status": "ok"} and db.Files.add_file.call_count == 1
    assert coll.doc["status"] == "completed"
    body, db = post(coll, "complete-task", DONE)  # reported again
    assert body == {"status": "ignored"} and not db.Files.add_file.called


def test_a_late_finish_is_ignored_when_another_machine_has_it(post):
    coll = Transfers(status="downloading", claimed_by="master-vm1")
    body, db = post(coll, "complete-task", DONE)
    assert body == {"status": "ignored"} and not db.Files.add_file.called
    assert coll.doc["claimed_by"] == "master-vm1"


def test_a_late_failure_doesnt_fail_another_machines_run(post):
    coll = Transfers(status="downloading", claimed_by="master-vm1")
    body, _ = post(coll, "fail-task", {"task_id": "t1", "worker_id": "vm2", "error_message": "TimeoutError()"})
    assert body == {"status": "ignored"} and coll.doc["status"] == "downloading"


def test_a_failure_reads_as_a_sentence(post):
    coll = Transfers(status="downloading", claimed_by="vm2")
    post(coll, "fail-task", {"task_id": "t1", "worker_id": "vm2", "error_message": "TimeoutError()"})
    assert coll.doc["status"] == "failed"
    assert coll.doc["error_message"] == "The transfer timed out (the connection stopped sending data). Tap Retry."


@pytest.mark.parametrize("raw", ["TimeoutError()", "asyncio.TimeoutError", "ServerTimeoutError('Timeout on reading data from socket')"])
def test_bare_timeouts_read_as_a_sentence(raw):
    assert friendly_error(raw).startswith("The transfer timed out")


def test_a_worker_timeout_that_says_where_is_kept():
    text = "Timed out while uploading to Telegram (no data for 120 s)."
    assert friendly_error(text) == text
