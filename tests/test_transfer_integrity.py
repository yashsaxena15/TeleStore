"""A finished transfer is the real file, in the folder it was sent to:

1. a download that is an error page, or only part of the file, is refused (Google's limit page
   counts as its daily limit), on the master and on worker machines;
2. the Telegram Inbox listener leaves TeleStore's own uploads alone (any of its bots, the
   "Uploaded file:" caption, split parts) and waits before taking an unrecorded file;
3. saving the record never fails silently: an upload the listener took first moves out of Inbox.
"""

import asyncio
import importlib
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from telestore.services import download_check
from telestore.services.download_check import BadDownload, check
from telestore.services.remote_transfer_manager.helpers import GoogleDriveQuotaExceededError, is_gdrive_quota_error

GOOGLE_LIMIT_PAGE = b"""<!DOCTYPE html><html><head><title>Google Drive - Quota exceeded</title></head><body>
<p class="uc-error-caption">Sorry, you can't view or download this file at this time.</p>
<p class="uc-error-subcaption">Too many users have viewed or downloaded this file recently.</p></body></html>"""
OTHER_PAGE = b"<html><head><title>404</title></head><body>Not here</body></html>"


# ── 1. Downloads ────────────────────────────────────────────────────────────

def test_googles_limit_page_saved_as_a_rom_is_googles_limit():
    with pytest.raises(GoogleDriveQuotaExceededError) as e:
        check("RisingOS-6.2-ota.zip", 2040, None, GOOGLE_LIMIT_PAGE)
    assert is_gdrive_quota_error(e.value)  # so the transfer waits for the limit and resumes


@pytest.mark.parametrize("name", ["data.f2fs.win015", "lec41_voice.mp4", "types.py", "backup.bin"])
def test_any_web_page_instead_of_the_file_is_refused(name):
    with pytest.raises(BadDownload, match="sent a web page"):
        check(name, len(OTHER_PAGE), None, OTHER_PAGE)


def test_a_real_web_page_is_fine():
    check("lesson.htm", len(OTHER_PAGE), len(OTHER_PAGE), OTHER_PAGE)
    check("Index.HTML", len(OTHER_PAGE), None, OTHER_PAGE)


def test_only_part_of_the_file_is_refused():
    with pytest.raises(BadDownload, match="Only part of 'movie.mkv' arrived: 1.0 MB of 2.0 MB"):
        check("movie.mkv", 1024 * 1024, 2 * 1024 * 1024, b"\x1aE\xdf\xa3")


def test_files_whose_size_the_source_didnt_give_and_other_text_files_pass():
    check("movie.mkv", 5, 0, b"\x1aE\xdf\xa3")
    check("notes.xml", 40, 40, b"<?xml version='1.0'?><notes/>")
    check("readme.md", 9, 9, b"# Hello <b>")


@pytest.fixture
def worker():
    """worker/worker.py, the script that runs on worker machines."""
    with patch.dict("os.environ", {"WORKER_KEY": "test"}):
        sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "worker"))
        try:
            yield importlib.import_module("worker")
        finally:
            sys.path.pop(0)


def test_worker_machines_check_downloads_the_same_way(worker):
    with pytest.raises(RuntimeError) as e:
        worker.check_download("RisingOS-6.2-ota.zip", 2040, 0, GOOGLE_LIMIT_PAGE)
    assert worker.is_gdrive_quota_error(str(e.value))  # reported as Google's limit, so it waits
    with pytest.raises(ValueError, match="sent a web page"):
        worker.check_download("data.f2fs.win015", 60, 0, OTHER_PAGE)
    with pytest.raises(ValueError, match="Only part of"):
        worker.check_download("a.bin", 10, 20, b"\x00")
    worker.check_download("lesson.htm", 60, 60, OTHER_PAGE)
    assert worker.HTML_NAMES == download_check.HTML_NAMES


# ── 2. The Telegram Inbox listener ──────────────────────────────────────────

def message(caption=None, sender_id=None, name="setup.exe"):
    return SimpleNamespace(caption=caption, from_user=SimpleNamespace(id=sender_id) if sender_id else None, via_bot=None,
                           document=SimpleNamespace(file_name=name), video=None, audio=None, photo=None)


@pytest.fixture
def listener():
    from telestore.telegram.plugins import channel_listener
    with patch.object(channel_listener, "OWN_BOT_IDS", {111, 222}):
        yield channel_listener


@pytest.mark.parametrize("msg, ours", [
    (message(sender_id=222), True),                       # a bot lent to a worker machine
    (message(caption="setup.exe", sender_id=999), False),  # someone posting a file
    (message(caption="Uploaded file: setup.exe"), True),
    (message(caption="big.iso (Part 2/3)"), True),
    (message(name="big.iso.part2"), True),
    (message(caption="Archive: photos.zip"), True),
    (message(caption="setup.exe"), False),                 # a channel post: decided by its caption
])
def test_teleStores_own_uploads_never_go_to_inbox(listener, msg, ours):
    assert listener.is_telestore_upload(msg) is ours


def test_the_listener_waits_and_leaves_files_recorded_meanwhile(listener):
    msg = SimpleNamespace(chat=SimpleNamespace(id=-100), id=7)
    with patch.object(listener, "INBOX_GRACE_SECONDS", 0), patch.object(listener, "database") as db:
        db.Files.find_one.return_value = {"_id": "x", "file_path": "/Home/Tools"}  # the upload got there first
        asyncio.run(listener._capture_for_inbox(msg))
    db.Files.add_file.assert_not_called()


# ── 3. Saving never fails silently ──────────────────────────────────────────

UPLOAD = dict(chat_id=-100, message_id=7, thumbnail=None, file_type="document", file_unique_id="u7", file_size=10,
              file_name="data.f2fs.win016", file_caption="Uploaded file: data.f2fs.win016", file_path="/Home/Tools/TWRP", owner_id="42")


def files_with(existing):
    from telestore.db.repositories.files import Files
    files = MagicMock()
    files.find_one.side_effect = [existing, {"_id": "new", **UPLOAD}]
    return Files, files


def test_an_upload_the_inbox_listener_took_first_moves_to_its_folder():
    Files, files = files_with({"_id": "inbox1", "chat_id": -100, "message_id": 7, "file_path": "/Telegram Inbox", "file_name": "data.f2fs.win016", "owner_id": "42"})
    with patch("telestore.services.event_service.forget_inbox_file") as forget:
        saved = Files.claim_upload(files, **UPLOAD)
    assert files.update_one.call_args.args[0] == {"_id": "inbox1"}
    assert files.update_one.call_args.args[1]["$set"]["file_path"] == "/Home/Tools/TWRP"
    assert saved["file_path"] == "/Home/Tools/TWRP"
    forget.assert_called_once_with(-100, 7)  # and its "New file in Telegram Inbox" notice goes


def test_a_new_upload_is_saved_and_returned():
    Files, files = files_with(None)
    assert Files.claim_upload(files, **UPLOAD)["_id"] == "new"
    files.add_file.assert_called_once()


def test_an_upload_that_couldnt_be_saved_fails():
    from telestore.db.repositories.files import Files
    files = MagicMock()
    files.find_one.return_value = None
    with pytest.raises(RuntimeError, match="couldn't be saved to /Home/Tools/TWRP"):
        Files.claim_upload(files, **UPLOAD)


def test_a_worker_transfer_that_couldnt_be_saved_fails_instead_of_finishing(client, test_secrets):
    coll = MagicMock()
    coll.find_one_and_update.return_value = {"task_id": "t1"}
    with patch("telestore.api.routes.worker.get_remote_db", return_value={"RemoteTransfers": coll}), \
            patch("telestore.api.routes.worker.database") as db, \
            patch("telestore.services.event_service.task_finished"):
        db.Files.claim_upload.side_effect = RuntimeError("database away")
        res = client.post("/api/worker/complete-task", headers={"X-Worker-Key": test_secrets["worker_secret"]}, json={
            "task_id": "t1", "worker_id": "vm2", "user_id": "42", "chat_id": -100, "destination_path": "/Home/Tools",
            "file_name": "a.bin", "file_size": 10, "message_id": 7, "file_unique_id": "u7"})
    assert res.json() == {"status": "failed"}
    saved = coll.update_one.call_args.args[1]["$set"]
    assert saved["status"] == "failed" and "couldn't be saved" in saved["error_message"]
