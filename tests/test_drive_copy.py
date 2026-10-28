"""Copies from a connected Google Drive: they run on the main server with a fresh sign-in, and
their errors read as one sentence."""

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from telestore.services.remote_transfer_manager.helpers import friendly_error

GOOGLE_403 = 'HTTP 403 from source: {\n  "error": {\n    "code": 403,\n    "message": "The request is missing a valid API key.",\n    "errors": []}}'


def test_workers_leave_drive_copies_to_the_main_server(client, test_secrets):
    coll = MagicMock()
    coll.find_one_and_update.return_value = None
    with patch("telestore.api.routes.worker.get_remote_db", return_value={"RemoteTransfers": coll}):
        res = client.post("/api/worker/claim-task", json={"worker_id": "w1"}, headers={"X-Worker-Key": test_secrets["worker_secret"]})
    assert res.json() == {"has_task": False, "task": None}
    query = coll.find_one_and_update.call_args.args[0]
    assert query["cloud_account_id"] == {"$exists": False}


def test_a_drive_copy_signs_in_again_before_downloading():
    from telestore.services.remote_transfer_manager.manager import RemoteTransferManager
    manager = object.__new__(RemoteTransferManager)
    task = {"task_id": "t1", "user_id": "42", "cloud_account_id": "acc1", "custom_headers": {"Authorization": "Bearer old"}}
    with patch("telestore.db.database.CloudAccounts.get_account_raw", return_value={"_id": "acc1"}) as account, \
            patch("telestore.services.google_drive_manager.GoogleDriveManager.get_valid_access_token", new=AsyncMock(return_value="fresh")):
        asyncio.run(manager._refresh_drive_sign_in(task))
    assert task["custom_headers"]["Authorization"] == "Bearer fresh"
    assert account.call_args.kwargs["account_id"] == "acc1"


def test_a_disconnected_drive_account_says_so():
    from telestore.services.remote_transfer_manager.manager import RemoteTransferManager
    manager = object.__new__(RemoteTransferManager)
    with patch("telestore.db.database.CloudAccounts.get_account_raw", return_value=None), pytest.raises(ValueError, match="isn't connected"):
        asyncio.run(manager._refresh_drive_sign_in({"task_id": "t1", "cloud_account_id": "gone"}))


def test_other_tasks_are_left_alone():
    from telestore.services.remote_transfer_manager.manager import RemoteTransferManager
    task = {"task_id": "t1", "source_url": "https://example.com/a.iso"}
    asyncio.run(object.__new__(RemoteTransferManager)._refresh_drive_sign_in(task))
    assert "custom_headers" not in task


@pytest.mark.parametrize("raw, readable", [
    (GOOGLE_403, "Google Drive refused the download (its sign-in had expired). Tap Retry."),
    ('HTTP 403 from source: {"error": {"errors": [{"reason": "downloadQuotaExceeded"}]}}', "Google Drive's download limit for this file was reached. Try again in a few hours."),
    ('HTTP 404 from source: {"error": {"code": 404, "message": "File not found: abc."}}', "The file isn't in Google Drive any more, or this account can't see it."),
    ("HTTP 502 from source: <html>bad gateway</html> {}", "The source refused the download (error 502). Tap Retry, or check the link."),
    ("Not enough space on the server.", "Not enough space on the server."),
    (None, None),
])
def test_errors_read_as_one_sentence(raw, readable):
    assert friendly_error(raw) == readable


def test_a_worker_failure_is_stored_readable(client, test_secrets):
    coll = MagicMock()
    with patch("telestore.api.routes.worker.get_remote_db", return_value={"RemoteTransfers": coll}), \
            patch("telestore.services.event_service.task_finished"):
        client.post("/api/worker/fail-task", json={"task_id": "t1", "worker_id": "vm2", "error_message": GOOGLE_403},
                    headers={"X-Worker-Key": test_secrets["worker_secret"]})
    saved = coll.update_one.call_args.args[1]["$set"]
    assert saved["error_message"] == "Google Drive refused the download (its sign-in had expired). Tap Retry."
    assert saved["error_detail"].startswith("[vm2] HTTP 403")


def test_a_folder_says_why_its_files_failed():
    from telestore.services.remote_transfer_manager.manager import RemoteTransferManager
    coll = MagicMock()
    coll.aggregate.return_value = [
        {"_id": {"group": "G", "status": "completed"}, "count": 2, "filesize": 10, "transferred": 10, "speed": 0},
        {"_id": {"group": "G", "status": "failed"}, "count": 3, "filesize": 0, "transferred": 0, "speed": 0},
        {"_id": {"group": "H", "status": "completed"}, "count": 1, "filesize": 1, "transferred": 1, "speed": 0},
    ]
    coll.find_one.return_value = {"error_message": "Google Drive refused the download (its sign-in had expired). Tap Retry."}
    groups = RemoteTransferManager._group_summaries(coll, "42", ["G", "H"])
    assert groups["G"]["error"].startswith("Google Drive refused")
    assert "error" not in groups["H"]
    assert coll.find_one.call_args.args[0] == {"user_id": "42", "group_id": "G", "status": "failed"}


def test_the_task_list_never_sends_sign_in_headers():
    from telestore.services.remote_transfer_manager.manager import RemoteTransferManager

    class Rows(list):
        def sort(self, *a, **k):
            return self

        def limit(self, n):
            return self

    failed = {"_id": "x", "task_id": "t1", "status": "failed", "group_id": None, "custom_headers": {"Authorization": "Bearer secret"},
              "error_message": GOOGLE_403, "error_detail": "raw"}
    coll = MagicMock()
    coll.find.side_effect = lambda q, *a, **k: Rows([failed]) if q.get("status") == {"$in": ["completed", "cancelled", "failed"]} else Rows()
    coll.distinct.return_value = []
    with patch("telestore.services.remote_transfer_manager.manager.get_remote_db", return_value={"RemoteTransfers": coll}):
        listing = object.__new__(RemoteTransferManager).get_user_tasks("42")
    task = listing["tasks"][0]
    assert "custom_headers" not in task and "error_detail" not in task
    assert task["error_message"].startswith("Google Drive refused")
