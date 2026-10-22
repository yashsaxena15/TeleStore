"""Video and audio downloads with yt-dlp: safe links, the options, the routes and the transfer."""

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from telestore.api.app import app
from telestore.db import database
from telestore.security.credentials import User, require_auth
from telestore.services import media_download_service as media
from telestore.services.media_download_service import MediaError, check_public_url, format_options
from telestore.services.remote_transfer_manager import manager as manager_module
from telestore.services.remote_transfer_manager import remote_transfer_manager

VIDEO = {"kind": "video", "title": "Never Gonna Give You Up", "uploader": "Rick Astley", "site": "Youtube", "duration": 213,
         "thumbnail_url": None, "count": 1, "entries": [{"index": 1, "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "title": "Never Gonna Give You Up", "duration": 213}]}
PLAYLIST = {"kind": "playlist", "title": "Road trip", "uploader": "me", "site": "YoutubeTab", "thumbnail_url": None, "count": 3,
            "entries": [{"index": i, "url": f"https://www.youtube.com/watch?v=v{i}", "title": f"Song {i}", "duration": 200} for i in (1, 2, 3)]}


@pytest.fixture
def as_user():
    def use(**kwargs):
        app.dependency_overrides[require_auth] = lambda: User(**{"username": "bob", "telegram_user_id": 42, **kwargs})
    yield use
    app.dependency_overrides.pop(require_auth, None)


@pytest.fixture
def tasks_db():
    coll = MagicMock()
    coll.distinct.return_value = []
    coll.insert_one.side_effect = lambda doc: doc.setdefault("_id", "oid")
    db = {"RemoteTransfers": coll}
    with patch("telestore.services.remote_transfer_manager.helpers.get_remote_db", return_value=db), \
            patch.object(manager_module, "get_remote_db", return_value=db), \
            patch.object(remote_transfer_manager, "start_worker"):
        yield coll


@pytest.fixture
def index_chat():
    database.Users.find_one.return_value = {"telegram_user_id": 42, "index_chat_id": -100123}


def probing(info):
    return patch.object(media, "probe", AsyncMock(return_value=info))


class TestLinks:
    @pytest.mark.parametrize("url", ["http://localhost/x", "http://127.0.0.1:8000/", "http://10.0.0.5/", "http://169.254.169.254/latest", "ftp://youtube.com/x", "file:///etc/passwd", ""])
    def test_private_or_odd_links_are_refused(self, url):
        with pytest.raises(MediaError):
            check_public_url(url)

    def test_public_link(self):
        with patch("socket.getaddrinfo", return_value=[(None, None, None, None, ("142.250.1.1", 443))]):
            assert check_public_url("youtube.com/watch?v=x") == "https://youtube.com/watch?v=x"

    def test_generic_pages_are_off(self):
        assert media._base_options()["allowed_extractors"] == ["default", "-generic"]

    @pytest.mark.parametrize("text, expected", [
        ("ERROR: [youtube] x: Sign in to confirm you’re not a bot.", "prove it isn't a bot"),
        ("ERROR: Private video. Sign in if you've been granted access", "private"),
        ("ERROR: No suitable extractor found for URL", "isn't supported"),
        ("ERROR: Sign in to confirm your age. This video may be inappropriate for some users.", "age-restricted"),
        ("ERROR: This live event will begin in 3 hours.", "live stream"),
    ])
    def test_friendly_errors(self, text, expected):
        assert expected in str(media._friendly(Exception(text)))


class TestFormats:
    def test_video_prefers_mp4_at_the_chosen_height(self):
        opts = format_options({"mode": "video", "quality": "720"})
        assert opts["format_sort"][0] == "res:720" and opts["merge_output_format"] == "mp4"

    def test_best_video_has_no_height_limit(self):
        assert not format_options({"mode": "video", "quality": "best"})["format_sort"][0].startswith("res:")

    def test_audio(self):
        opts = format_options({"mode": "audio", "audio_format": "m4a"})
        assert opts["postprocessors"][0] == {"key": "FFmpegExtractAudio", "preferredcodec": "m4a", "preferredquality": "0"}
        assert any(p["key"] == "EmbedThumbnail" for p in opts["postprocessors"])

    def test_subtitles_are_embedded(self):
        opts = format_options({"mode": "video", "subtitles": True})
        assert opts["writesubtitles"] and any(p["key"] == "FFmpegEmbedSubtitle" for p in opts["postprocessors"])


class TestCookies:
    def test_saves_a_netscape_file(self, tmp_path, monkeypatch):
        monkeypatch.setattr(media, "SETTINGS_DIR", str(tmp_path))
        monkeypatch.setattr(media, "COOKIES_FILE", str(tmp_path / "cookies.txt"))
        res = media.save_cookies(b"# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t1999999999\tSID\tabc\n")
        assert res["has_cookies"] and res["cookie_sites"] == ["youtube.com"]
        assert oct((tmp_path / "cookies.txt").stat().st_mode)[-3:] == "600"
        assert not media.remove_cookies()["has_cookies"]

    def test_refuses_other_files(self, tmp_path, monkeypatch):
        monkeypatch.setattr(media, "COOKIES_FILE", str(tmp_path / "cookies.txt"))
        with pytest.raises(MediaError):
            media.save_cookies(b"hello world")


class TestRoutes:
    def test_preview_of_a_playlist(self, client, as_user):
        as_user()
        with probing(PLAYLIST), patch.object(media, "thumbnail", AsyncMock(return_value=None)):
            res = client.post("/api/transfers/remote/media/preview", json={"url": "https://www.youtube.com/playlist?list=x"})
        assert res.status_code == 200
        body = res.json()
        assert body["kind"] == "playlist" and body["count"] == 3
        assert body["entries"][0] == {"index": 1, "title": "Song 1", "duration": 200}

    def test_chosen_playlist_items_to_the_vault(self, client, as_user, tasks_db, index_chat):
        as_user()
        with probing(PLAYLIST), patch("telestore.api.routes.vault.is_vault_unlocked", return_value=True):
            res = client.post("/api/transfers/remote/media", json={
                "url": "https://www.youtube.com/playlist?list=x", "items": [1, 3],
                "choice": {"mode": "audio", "audio_format": "mp3"}, "destination": {"kind": "vault", "path": "/Vault/Music"}})
        assert res.status_code == 200, res.text
        docs = [c.args[0] for c in tasks_db.insert_one.call_args_list]
        assert [d["source_url"] for d in docs] == ["https://www.youtube.com/watch?v=v1", "https://www.youtube.com/watch?v=v3"]
        assert all(d["is_vault"] and d["destination_path"] == "/Vault/Music" and d["media_choice"]["mode"] == "audio" for d in docs)
        assert docs[0]["group_id"] == docs[1]["group_id"] and docs[0]["group_type"] == "media"
        assert docs[0]["filename"] == "Song 1.mp3"

    def test_single_video_to_drive(self, client, as_user, tasks_db):
        as_user(telegram_user_id=None)
        database.CloudAccounts.get_account_raw.return_value = {"id": "acc1", "account_name": "My Drive"}
        with probing(VIDEO):
            res = client.post("/api/transfers/remote/media", json={
                "url": "https://youtu.be/dQw4w9WgXcQ", "choice": {"mode": "video", "quality": "1080"},
                "destination": {"kind": "gdrive", "account_id": "acc1", "folder_id": "f1", "folder_name": "Videos"}})
        assert res.status_code == 200, res.text
        doc = tasks_db.insert_one.call_args.args[0]
        assert doc["cloud_account_id"] == "acc1" and doc["target_gdrive_folder_id"] == "f1" and "group_id" not in doc

    def test_no_items_chosen(self, client, as_user, tasks_db, index_chat):
        as_user()
        with probing(PLAYLIST):
            res = client.post("/api/transfers/remote/media", json={"url": "https://y/x", "items": [], "choice": {}, "destination": {"kind": "home", "path": "/Home"}})
        assert res.status_code == 400

    def test_too_many_running(self, client, as_user, tasks_db, index_chat):
        as_user()
        tasks_db.distinct.return_value = ["a", "b", "c"]
        res = client.post("/api/transfers/remote/media", json={"url": "https://y/x", "choice": {}, "destination": {"kind": "home", "path": "/Home"}})
        assert res.status_code == 429

    def test_bad_link_reads_clearly(self, client, as_user):
        as_user()
        res = client.post("/api/transfers/remote/media/preview", json={"url": "http://localhost/admin"})
        assert res.status_code == 400 and "private or local" in res.json()["detail"]

    def test_uploads_off(self, client, as_user):
        as_user(can_upload=False)
        assert client.post("/api/transfers/remote/media/preview", json={"url": "https://youtu.be/x"}).status_code == 403

    def test_only_the_owner_adds_cookies(self, client, as_user):
        as_user()
        res = client.post("/api/transfers/remote/media/cookies", files={"file": ("cookies.txt", b"x")})
        assert res.status_code == 403


class TestTransfer:
    def _task(self, **extra):
        return {"task_id": "rt_9", "user_id": "42", "chat_id": -100123, "source_url": "https://www.youtube.com/watch?v=v1", "source_type": "media",
                "media_choice": {"mode": "audio", "audio_format": "mp3"}, "filename": "Song 1.mp3", "destination_path": "/Home/Music", "is_vault": False, **extra}

    def _fake_download(self, size):
        async def download(url, choice, dest_dir, progress, should_stop):
            path = f"{dest_dir}/Song 1 [v1].mp3"
            with open(path, "wb") as f:
                f.truncate(size)
            return path
        return download

    def test_small_file_is_one_telegram_message(self, tmp_path, monkeypatch):
        monkeypatch.chdir(tmp_path)
        upload = AsyncMock(return_value={"message_id": 7, "file_unique_id": "u7", "thumbnail": "t"})
        mgr = manager_module.RemoteTransferManager()
        mgr._bot_manager = MagicMock()
        with patch.object(media, "download", self._fake_download(1000)), patch.object(manager_module, "upload_part_task", upload), \
                patch.object(mgr, "_update_task") as update:
            asyncio.run(mgr._run_download_and_upload(self._task(), MagicMock(is_set=lambda: False)))
        kwargs = database.Files.add_file.call_args.kwargs
        assert kwargs["file_name"] == "Song 1 [v1].mp3" and kwargs["file_path"] == "/Home/Music" and kwargs["file_type"] == "audio"
        assert update.call_args.args[1]["status"] == "completed"
        assert not (tmp_path / "tg_files" / "remote_rt_9").exists()

    def test_big_file_goes_up_in_parts(self, tmp_path, monkeypatch):
        monkeypatch.chdir(tmp_path)
        part_max = 1000
        monkeypatch.setattr(manager_module, "TELEGRAM_PART_SIZE", part_max)
        sizes = []

        async def upload(**kw):
            import os
            sizes.append(os.path.getsize(kw["part_file_path"]))
            os.remove(kw["part_file_path"])
            return {"message_id": kw["part_index"], "file_unique_id": f"u{kw['part_index']}"}
        mgr = manager_module.RemoteTransferManager()
        mgr._bot_manager = MagicMock()
        size = part_max + 5
        with patch.object(media, "download", self._fake_download(size)), patch.object(manager_module, "upload_part_task", upload), \
                patch.object(mgr, "_update_task"):
            asyncio.run(mgr._run_download_and_upload(self._task(), MagicMock(is_set=lambda: False)))
        assert sizes == [part_max, 5]
        kwargs = database.Files.add_multipart_file.call_args.kwargs
        assert kwargs["file_size"] == size and [p["start_byte"] for p in kwargs["parts"]] == [0, part_max]

    def test_low_disk_space_stops_before_downloading(self, tmp_path, monkeypatch):
        monkeypatch.chdir(tmp_path)
        mgr = manager_module.RemoteTransferManager()
        download = AsyncMock()
        with patch.object(media, "download", download), patch("shutil.disk_usage", return_value=MagicMock(free=10)), \
                patch.object(mgr, "_update_task"):
            with pytest.raises(RuntimeError):
                asyncio.run(mgr._run_download_and_upload(self._task(), MagicMock(is_set=lambda: False)))
        download.assert_not_called()
