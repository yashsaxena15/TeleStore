"""Import from Instagram: link parsing, where files may go, the queued tasks and the transfer itself."""

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from telestore.api.app import app
from telestore.db import database
from telestore.security.credentials import User, require_auth
from telestore.services import instagram_service
from telestore.services.instagram_service import InstagramError, file_name_for, parse_instagram_url
from telestore.services.remote_transfer_manager import manager as manager_module
from telestore.services.remote_transfer_manager import remote_transfer_manager

URL = "https://www.instagram.com/p/ABCdef12345/"
POST = {
    "shortcode": "ABCdef12345",
    "owner": "nasa",
    "caption": "Earth from orbit",
    "date": "2026-10-01T00:00:00",
    "items": [
        {"index": 1, "is_video": False, "url": "https://cdn/1.jpg", "thumbnail": "https://cdn/1.jpg", "ext": "jpg"},
        {"index": 2, "is_video": True, "url": "https://cdn/2.mp4", "thumbnail": "https://cdn/2.jpg", "ext": "mp4"},
    ],
}


@pytest.fixture
def as_user():
    def use(**kwargs):
        app.dependency_overrides[require_auth] = lambda: User(**{"username": "bob", "telegram_user_id": 42, **kwargs})
    yield use
    app.dependency_overrides.pop(require_auth, None)


@pytest.fixture
def ig():
    client = MagicMock()
    client.get_post = AsyncMock(return_value=POST)
    client.thumbnail = AsyncMock(return_value="data:image/jpeg;base64,AAA")
    with patch.object(instagram_service, "get_client", return_value=client):
        yield client


@pytest.fixture
def tasks_db():
    coll = MagicMock()
    coll.distinct.return_value = []
    coll.insert_one.side_effect = lambda doc: doc.setdefault("_id", "oid")  # pymongo adds _id to the doc
    db = {"RemoteTransfers": coll}
    with patch("telestore.services.remote_transfer_manager.helpers.get_remote_db", return_value=db), \
            patch.object(manager_module, "get_remote_db", return_value=db), \
            patch.object(remote_transfer_manager, "start_worker"):
        yield coll


@pytest.fixture
def index_chat():
    database.Users.find_one.return_value = {"telegram_user_id": 42, "index_chat_id": -100123}


class TestParseUrl:
    @pytest.mark.parametrize("url, expected", [
        ("https://www.instagram.com/p/ABCdef12345/", ("p", "ABCdef12345")),
        ("https://instagram.com/reel/Cx_y-Z12345/?igsh=abc", ("reel", "Cx_y-Z12345")),
        ("instagram.com/reels/Cx_y-Z12345", ("reel", "Cx_y-Z12345")),
        ("https://www.instagram.com/tv/B12345678/", ("tv", "B12345678")),
        ("https://www.instagram.com/nasa/p/ABCdef12345/", ("p", "ABCdef12345")),
        ("https://instagr.am/p/ABCdef12345", ("p", "ABCdef12345")),
    ])
    def test_posts_reels_and_videos(self, url, expected):
        assert parse_instagram_url(url) == expected

    @pytest.mark.parametrize("url", [
        "https://evil.com/p/ABCdef12345/",
        "https://instagram.com.evil.com/p/ABCdef12345/",
        "ftp://instagram.com/p/ABCdef12345/",
        "https://www.instagram.com/nasa/",
        "https://www.instagram.com/stories/nasa/123456/",
        "",
    ])
    def test_everything_else_is_refused(self, url):
        with pytest.raises(InstagramError):
            parse_instagram_url(url)

    def test_file_names(self):
        assert file_name_for("nasa", "ABC", POST["items"][0], 1) == "nasa_ABC.jpg"
        assert file_name_for("na/sa", "ABC", POST["items"][1], 2) == "nasa_ABC_2.mp4"


class TestImportRoute:
    def test_preview_has_no_media_links(self, client, as_user, ig):
        as_user()
        res = client.post("/api/transfers/remote/instagram/preview", json={"url": URL})
        assert res.status_code == 200
        body = res.json()
        assert body["owner"] == "nasa" and body["thumbnail"].startswith("data:image/")
        assert body["items"] == [{"index": 1, "is_video": False}, {"index": 2, "is_video": True}]

    def test_bad_link(self, client, as_user, ig):
        as_user()
        res = client.post("/api/transfers/remote/instagram/preview", json={"url": "https://example.com/x"})
        assert res.status_code == 400

    def test_home_import_queues_one_task_per_item(self, client, as_user, ig, tasks_db, index_chat):
        as_user()
        res = client.post("/api/transfers/remote/instagram", json={"url": URL, "destination": {"kind": "home", "path": "/Home/Insta"}})
        assert res.status_code == 200, res.text
        docs = [c.args[0] for c in tasks_db.insert_one.call_args_list]
        assert [d["filename"] for d in docs] == ["nasa_ABCdef12345_1.jpg", "nasa_ABCdef12345_2.mp4"]
        assert {d["destination_path"] for d in docs} == {"/Home/Insta"}
        assert all(d["source_type"] == "instagram" and d["chat_id"] == -100123 and d["user_id"] == "42" and not d["is_vault"] for d in docs)
        assert docs[0]["group_id"] and docs[0]["group_id"] == docs[1]["group_id"]

    @pytest.mark.parametrize("path", ["/Telegram Inbox", "/Trash", "/Vault", "/", "/Home/../Vault"])
    def test_home_must_be_inside_home(self, client, as_user, ig, tasks_db, index_chat, path):
        as_user()
        res = client.post("/api/transfers/remote/instagram", json={"url": URL, "destination": {"kind": "home", "path": path}})
        assert res.status_code == 400
        tasks_db.insert_one.assert_not_called()

    def test_locked_vault_is_refused(self, client, as_user, ig, tasks_db, index_chat):
        as_user()
        with patch("telestore.api.routes.vault.is_vault_unlocked", return_value=False):
            res = client.post("/api/transfers/remote/instagram", json={"url": URL, "destination": {"kind": "vault", "path": "/Vault"}})
        assert res.status_code == 403
        tasks_db.insert_one.assert_not_called()

    def test_unlocked_vault(self, client, as_user, ig, tasks_db, index_chat):
        as_user()
        with patch("telestore.api.routes.vault.is_vault_unlocked", return_value=True):
            res = client.post("/api/transfers/remote/instagram", json={"url": URL, "destination": {"kind": "vault", "path": "/Vault/Saved"}})
        assert res.status_code == 200
        assert all(c.args[0]["is_vault"] and c.args[0]["destination_path"] == "/Vault/Saved" for c in tasks_db.insert_one.call_args_list)

    def test_needs_index_chat_for_home(self, client, as_user, ig, tasks_db):
        as_user()
        database.Users.find_one.return_value = {"telegram_user_id": 42}
        res = client.post("/api/transfers/remote/instagram", json={"url": URL, "destination": {"kind": "home", "path": "/Home"}})
        assert res.status_code == 400 and "index chat" in res.json()["detail"]

    def test_drive_needs_no_telegram(self, client, as_user, ig, tasks_db):
        as_user(telegram_user_id=None)
        database.CloudAccounts.get_account_raw.return_value = {"id": "acc1", "account_name": "My Drive"}
        res = client.post("/api/transfers/remote/instagram", json={"url": URL, "destination": {"kind": "gdrive", "account_id": "acc1", "folder_id": "fold9", "folder_name": "Insta"}})
        assert res.status_code == 200, res.text
        assert database.CloudAccounts.get_account_raw.call_args.kwargs["user_id"] == ["bob"]
        doc = tasks_db.insert_one.call_args_list[0].args[0]
        assert doc["cloud_account_id"] == "acc1" and doc["target_gdrive_folder_id"] == "fold9" and doc["user_id"] == "bob"

    def test_someone_elses_drive_is_refused(self, client, as_user, ig, tasks_db):
        as_user()
        database.CloudAccounts.get_account_raw.return_value = None
        res = client.post("/api/transfers/remote/instagram", json={"url": URL, "destination": {"kind": "gdrive", "account_id": "acc9"}})
        assert res.status_code == 404

    def test_too_many_running(self, client, as_user, ig, tasks_db, index_chat):
        as_user()
        tasks_db.distinct.return_value = ["a", "b", "c"]
        res = client.post("/api/transfers/remote/instagram", json={"url": URL, "destination": {"kind": "home", "path": "/Home"}})
        assert res.status_code == 429

    def test_uploads_off(self, client, as_user, ig):
        as_user(can_upload=False)
        res = client.post("/api/transfers/remote/instagram", json={"url": URL, "destination": {"kind": "home", "path": "/Home"}})
        assert res.status_code == 403

    def test_only_the_owner_connects_instagram(self, client, as_user, ig):
        as_user()
        res = client.post("/api/transfers/remote/instagram/session/login", json={"username": "x", "password": "y"})
        assert res.status_code == 403


class TestTransfer:
    def _task(self, **extra):
        return {"task_id": "rt_1", "user_id": "42", "chat_id": -100123, "source_url": URL, "source_type": "instagram",
                "instagram_shortcode": "ABCdef12345", "instagram_index": 2, "instagram_media_url": "https://cdn/old.mp4",
                "instagram_caption": "Earth", "filename": "nasa_ABCdef12345_2.mp4", "destination_path": "/Home/Insta", "is_vault": True, **extra}

    def test_saves_to_telegram_and_library(self, tmp_path, monkeypatch):
        monkeypatch.chdir(tmp_path)
        client = MagicMock()

        async def download(url, dest, progress, should_stop):
            open(dest, "wb").write(b"x" * 10)
            return 10
        client.download = download
        upload = AsyncMock(return_value={"message_id": 7, "file_unique_id": "u7", "thumbnail": "t"})
        mgr = manager_module.RemoteTransferManager()
        mgr._bot_manager = MagicMock()
        with patch.object(instagram_service, "get_client", return_value=client), \
                patch.object(manager_module, "upload_part_task", upload), \
                patch.object(mgr, "_update_task") as update:
            asyncio.run(mgr._run_download_and_upload(self._task(), MagicMock(is_set=lambda: False)))
        assert upload.call_args.kwargs["is_single_part"] and upload.call_args.kwargs["file_type"] == "video"
        kwargs = database.Files.add_file.call_args.kwargs
        assert kwargs["file_path"] == "/Home/Insta" and kwargs["owner_id"] == "42" and kwargs["is_vault"] is True and kwargs["file_size"] == 10
        assert update.call_args.args[1]["status"] == "completed"
        assert not (tmp_path / "tg_files" / "remote_rt_1").exists()

    def test_expired_link_reads_the_post_again(self, tmp_path, monkeypatch):
        monkeypatch.chdir(tmp_path)
        client = MagicMock()
        seen = []

        async def download(url, dest, progress, should_stop):
            seen.append(url)
            if url.endswith("old.mp4"):
                raise InstagramError("expired")
            open(dest, "wb").write(b"x")
            return 1
        client.download = download
        client.get_post = AsyncMock(return_value=POST)
        mgr = manager_module.RemoteTransferManager()
        mgr._bot_manager = MagicMock()
        with patch.object(instagram_service, "get_client", return_value=client), \
                patch.object(manager_module, "upload_part_task", AsyncMock(return_value={"message_id": 1, "file_unique_id": "u"})), \
                patch.object(mgr, "_update_task"):
            asyncio.run(mgr._run_download_and_upload(self._task(), MagicMock(is_set=lambda: False)))
        assert seen == ["https://cdn/old.mp4", "https://cdn/2.mp4"]

    def test_saves_to_google_drive(self, tmp_path, monkeypatch):
        monkeypatch.chdir(tmp_path)
        client = MagicMock()

        async def download(url, dest, progress, should_stop):
            open(dest, "wb").write(b"abc")
            return 3
        client.download = download
        database.CloudAccounts.get_account_raw.return_value = {"id": "acc1"}
        sent = []

        async def upload_stream(upload_session_url, async_stream_gen, total_size, cancel_event):
            async for chunk in async_stream_gen:
                sent.append(chunk)
            return {"id": "g1"}
        gdm = MagicMock()
        gdm.get_valid_access_token = AsyncMock(return_value="tok")
        gdm.initiate_resumable_upload = AsyncMock(return_value="https://upload")
        gdm.upload_resumable_stream = upload_stream
        mgr = manager_module.RemoteTransferManager()
        task = self._task(cloud_account_id="acc1", cloud_account_user_ids=["bob"], target_gdrive_folder_id="fold9", is_vault=False)
        with patch.object(instagram_service, "get_client", return_value=client), \
                patch("telestore.services.google_drive_manager.GoogleDriveManager", gdm), \
                patch.object(mgr, "_update_task"):
            asyncio.run(mgr._run_download_and_upload(task, MagicMock(is_set=lambda: False)))
        assert gdm.initiate_resumable_upload.call_args.kwargs["parent_id"] == "fold9"
        assert b"".join(sent) == b"abc"
        database.Files.add_file.assert_not_called()


def test_workers_never_claim_instagram_tasks(client, test_secrets):
    coll = MagicMock()
    coll.find_one_and_update.return_value = None
    with patch("telestore.api.routes.worker.get_remote_db", return_value={"RemoteTransfers": coll}):
        res = client.post("/api/worker/claim-task", json={"worker_id": "w1"}, headers={"X-Worker-Key": test_secrets["worker_secret"]})
    assert res.status_code == 200
    assert coll.find_one_and_update.call_args.args[0]["source_type"] == {"$nin": ["instagram"]}
