"""A Google Drive folder link's file list (November 2026).

Google sometimes answers the list request with a page without the files (it limits requests from
one server for a while), so the list is asked for again a few times before failing. "Retry" on a
folder whose list failed lists it again; it used to queue the folder link as if it were one file.
"""

import asyncio
import os
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from telestore.services.remote_transfer_manager import manager as manager_module
from telestore.services.remote_transfer_manager.manager import remote_transfer_manager
from test_transfer_server import Coll


class Transfers(Coll):
    def distinct(self, key, flt=None):
        return list({d.get(key) for d in self.find(flt or {}) if d.get(key) is not None})

    def delete_one(self, flt):
        hit = self.find_one(flt)
        if hit:
            self.docs = [d for d in self.docs if d["_id"] != hit["_id"]]


def _disc(status="discovering", **extra):
    return {"task_id": "disc_grp_1", "group_id": "grp_1", "user_id": "7", "chat_id": 1,
            "source_url": "https://drive.google.com/drive/folders/F1", "gdrive_id": "F1",
            "source_type": "gdrive_folder", "destination_path": "/Home/Health", "status": status,
            "is_vault": False, **extra}


def _listing(*answers):
    """A stand-in for gdown's folder listing that gives these answers in turn."""
    calls = []

    def download_folder(id, output, **kw):
        calls.append(id)
        answer = answers[min(len(calls), len(answers)) - 1]
        if isinstance(answer, Exception):
            raise answer
        return [SimpleNamespace(id=f"f{i}", local_path=os.path.join(output, "Health & Care", name))
                for i, name in enumerate(answer or [])] or answer
    return download_folder, calls


def _discover(coll, listing):
    download_folder, calls = listing
    waits = []

    async def no_wait(seconds):
        waits.append(seconds)

    with patch("telestore.services.remote_transfer_manager.manager.get_remote_db", return_value={"RemoteTransfers": coll}), \
            patch("gdown.download_folder.download_folder", download_folder), \
            patch.object(manager_module, "_sleep", no_wait), \
            patch("telestore.services.remote_transfer_manager.manager.event_service.task_finished"):
        asyncio.run(remote_transfer_manager._async_discover_folder(
            disc_task_id="disc_grp_1", group_id="grp_1", folder_id="F1",
            url="https://drive.google.com/drive/folders/F1", user_id="7", chat_id=1,
            clean_dest="/Home/Health", is_vault=False))
    return calls, waits


class TestListing:
    def test_an_empty_answer_is_asked_again(self):
        coll = Transfers([_disc()])
        calls, waits = _discover(coll, _listing(None, [], ["a.mp4", "b.mp4"]))
        assert len(calls) == 3 and waits == [10, 30]
        files = coll.find({"group_id": "grp_1"})
        assert sorted(d["filename"] for d in files) == ["a.mp4", "b.mp4"]
        assert all(d["status"] == "queued" for d in files)  # the placeholder is gone

    def test_a_failed_request_is_asked_again_too(self):
        coll = Transfers([_disc()])
        calls, _ = _discover(coll, _listing(OSError("connection reset"), ["a.mp4"]))
        assert len(calls) == 2 and coll.find_one({"filename": "a.mp4"})

    def test_after_every_try_it_says_why(self):
        coll = Transfers([_disc()])
        calls, waits = _discover(coll, _listing(None))
        assert len(calls) == 4 and waits == [10, 30, 90]
        disc = coll.find_one({"task_id": "disc_grp_1"})
        assert disc["status"] == "failed"
        assert disc["error_message"] == manager_module.FOLDER_LIST_EMPTY


class TestRetry:
    @pytest.fixture
    def coll(self):
        coll = Transfers([_disc("failed", error_message="Google didn't return this folder's files."),
                          {"task_id": "rt_1", "group_id": "grp_1", "user_id": "7", "status": "failed",
                           "source_type": "gdrive_file"}])
        with patch("telestore.services.remote_transfer_manager.manager.get_remote_db", return_value={"RemoteTransfers": coll}), \
                patch.object(remote_transfer_manager, "_start_discovery") as start:
            coll.start = start
            yield coll

    def test_retry_failed_lists_the_folder_again(self, coll):
        assert remote_transfer_manager.retry_failed("grp_1", "7") == 2
        disc = coll.find_one({"task_id": "disc_grp_1"})
        assert disc["status"] == "discovering" and disc["error_message"] is None
        assert coll.start.call_args.args[0]["gdrive_id"] == "F1"
        # The folder link is never queued as a file; a failed file is
        assert coll.find_one({"task_id": "rt_1"})["status"] == "queued"

    def test_retry_one_folder_listing(self, coll):
        assert remote_transfer_manager.retry_task("disc_grp_1", "7") is True
        assert coll.find_one({"task_id": "disc_grp_1"})["status"] == "discovering"
        coll.start.assert_called_once()

    def test_resume_group_lists_it_again(self, coll):
        remote_transfer_manager.resume_group("grp_1", "7")
        assert coll.find_one({"task_id": "disc_grp_1"})["status"] == "discovering"

    def test_someone_elses_folder_isnt_touched(self, coll):
        assert remote_transfer_manager.retry_failed("grp_1", "8") == 0
        assert coll.find_one({"task_id": "disc_grp_1"})["status"] == "failed"
        coll.start.assert_not_called()
