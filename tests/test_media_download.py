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
    @pytest.fixture
    def cookie_dir(self, tmp_path, monkeypatch):
        monkeypatch.setattr(media, "SETTINGS_DIR", str(tmp_path))
        monkeypatch.setattr(media, "COOKIES_FILE", str(tmp_path / "cookies.txt"))
        monkeypatch.setattr(media, "COOKIES_STATUS_FILE", str(tmp_path / "cookies-status.json"))
        monkeypatch.setattr(media, "_pot_running", lambda: False)
        return tmp_path

    def _file(self, *names):
        return ("# Netscape HTTP Cookie File\n" + "".join(f".youtube.com\tTRUE\t/\tTRUE\t1999999999\t{n}\tabc\n" for n in names)).encode()

    def test_saves_a_signed_in_export(self, cookie_dir):
        with patch.object(media, "_check_youtube_sign_in", return_value="signed_in"):
            res = media.save_cookies(self._file("SID", "LOGIN_INFO", "SAPISID"))
        assert res["has_cookies"] and res["cookie_sites"] == ["youtube.com"] and res["youtube_sign_in"] == "signed_in"
        assert oct((cookie_dir / "cookies.txt").stat().st_mode)[-3:] == "600"
        assert not media.remove_cookies()["has_cookies"]

    def test_refuses_a_signed_out_export(self, cookie_dir):
        # What a browser that isn't signed in exports: only side cookies
        with pytest.raises(MediaError, match="aren't from a signed-in YouTube"):
            media.save_cookies(self._file("__Secure-3PSID", "__Secure-3PAPISID", "VISITOR_INFO1_LIVE"))
        assert not (cookie_dir / "cookies.txt").exists()

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
            path = f"{dest_dir}/Song 1.mp3"
            with open(path, "wb") as f:
                f.truncate(size)
            return path, "v1"
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
        assert kwargs["file_name"] == "Song 1.mp3" and kwargs["file_path"] == "/Home/Music" and kwargs["file_type"] == "audio"
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


class TestPhaseTwo:
    def test_text_pasted_with_the_link_is_dropped(self):
        assert media.clean_link("https://music.youtube.com/playlist?list=PLabc 05:23 PM") == "https://music.youtube.com/playlist?list=PLabc"
        assert media.clean_link("Check this: https://youtu.be/x).") == "https://youtu.be/x"

    def test_channel_page_opens_its_videos(self):
        with patch("socket.getaddrinfo", return_value=[(None, None, None, None, ("142.250.1.1", 443))]):
            assert check_public_url("https://www.youtube.com/@mkbhd") == "https://www.youtube.com/@mkbhd/videos"
            assert check_public_url("https://www.youtube.com/@mkbhd/shorts") == "https://www.youtube.com/@mkbhd/shorts"

    def test_broken_playlist_link(self):
        msg = str(media._friendly(Exception("ERROR: [youtube:tab] PLx05:23 PM: Unable to download API page: HTTP Error 400: Bad Request")))
        assert "looks broken or incomplete" in msg

    def test_bot_check_is_a_block(self):
        assert isinstance(media._friendly(Exception("Sign in to confirm you're not a bot")), media.MediaBlocked)

    @pytest.mark.parametrize("value, langs, automatic", [
        ("hi", ["hi", "hi-orig", "hi-IN"], True),
        ("all", ["all", "-live_chat"], False),  # automatic captions exist in ~100 languages
        (True, ["en", "en-orig", "en-US", "en-GB", "en-IN"], True),
    ])
    def test_subtitle_languages(self, value, langs, automatic):
        opts = format_options({"mode": "video", "subtitles": value})
        assert opts["subtitleslangs"] == langs and opts["writeautomaticsub"] is automatic
        assert not any(lang.endswith(".*") for lang in langs)  # no machine translations

    def test_rate_limited_subtitles_keep_the_video(self, tmp_path):
        tried = []

        class FakeYDL:
            def __init__(self, opts):
                self.opts = opts

            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

            def extract_info(self, url, download):
                tried.append(bool(self.opts.get("writesubtitles")))
                if self.opts.get("writesubtitles"):
                    raise Exception("ERROR: Unable to download video subtitles for 'en': HTTP Error 429: Too Many Requests")
                path = tmp_path / "Song.mp4"
                path.write_bytes(b"x")
                return {"id": "v1", "requested_downloads": [{"filepath": str(path)}]}
        with patch.object(media.yt_dlp, "YoutubeDL", FakeYDL), patch.object(media, "check_public_url", lambda u: u):
            path, vid = asyncio.run(media.download("https://youtu.be/v1", {"mode": "video", "subtitles": "en"}, str(tmp_path)))
        assert tried == [True, False] and path.endswith("Song.mp4") and vid == "v1"

    def test_chapters_and_cover_in_videos(self):
        opts = format_options({"mode": "video"})
        assert opts["postprocessors"][0]["add_chapters"] and any(p["key"] == "EmbedThumbnail" for p in opts["postprocessors"])

    def test_po_token_helper_is_used(self):
        assert media._base_options()["extractor_args"]["youtubepot-bgutilhttp"]["base_url"] == [media.POT_PROVIDER_URL]

    def test_same_name_in_the_folder_gets_the_id(self):
        mgr = manager_module.RemoteTransferManager()
        task = {"user_id": "42", "destination_path": "/Home/Music"}
        database.Files.find_one.return_value = None
        assert mgr._media_file_name(task, "Song.mp3", "abc") == "Song.mp3"
        database.Files.find_one.return_value = {"file_name": "Song.mp3"}
        assert mgr._media_file_name(task, "Song.mp3", "abc") == "Song [abc].mp3"
        assert mgr._media_file_name({**task, "cloud_account_id": "acc"}, "Song.mp3", "abc") == "Song.mp3"

    def test_a_block_pauses_the_rest_of_the_playlist(self, tasks_db):
        mgr = manager_module.RemoteTransferManager()
        task = {"task_id": "rt_1", "user_id": "42", "group_id": "grp_1", "source_type": "media"}
        assert mgr._pause_blocked_media(task, media.MediaBlocked("bot"))
        query, update = tasks_db.update_many.call_args.args
        assert query["group_id"] == "grp_1" and update["$set"]["status"] == "paused_quota" and update["$set"]["cooldown_until"]
        assert tasks_db.update_one.call_args.args[1]["$inc"] == {"block_retries": 1}
        # After three waits the video fails instead of waiting again
        assert not mgr._pause_blocked_media({**task, "block_retries": 3}, media.MediaBlocked("bot"))
        assert not mgr._pause_blocked_media(task, MediaError("private"))

    def test_update_installs_into_the_cache(self, tmp_path, monkeypatch):
        monkeypatch.setattr(media, "LIB_DIR", str(tmp_path / "lib"))
        calls = []

        def run(cmd, **kw):
            calls.append(cmd)
            (tmp_path / "lib.new" / "yt_dlp").mkdir(parents=True)
            return MagicMock(returncode=0)
        with patch("subprocess.run", run), patch.object(media, "_reload_yt_dlp"), patch.object(media, "settings", return_value={"ok": True}):
            assert asyncio.run(media.update_yt_dlp()) == {"ok": True}
        assert "--target" in calls[0] and "yt-dlp" in calls[0]
        assert (tmp_path / "lib" / "yt_dlp").is_dir()

    def test_only_the_owner_updates(self, client, as_user):
        as_user()
        assert client.post("/api/transfers/remote/media/update").status_code == 403


class TestSync:
    @pytest.fixture
    def syncs(self):
        coll = MagicMock()
        coll.count_documents.return_value = 0
        coll.find_one.return_value = None
        coll.insert_one.side_effect = lambda doc: doc.setdefault("_id", "oid")
        from telestore.services import media_sync
        with patch.object(media_sync, "_coll", return_value=coll):
            yield coll

    def test_sync_with_the_download(self, client, as_user, tasks_db, index_chat, syncs):
        as_user()
        info = {**PLAYLIST, "url": "https://www.youtube.com/playlist?list=x"}
        with probing(info):
            res = client.post("/api/transfers/remote/media", json={"url": "https://www.youtube.com/playlist?list=x", "items": [], "sync": True,
                                                                   "choice": {"mode": "audio"}, "destination": {"kind": "home", "path": "/Home/Music"}})
        assert res.status_code == 200, res.text
        assert res.json()["message"] == "Synced: new videos will download by themselves."
        tasks_db.insert_one.assert_not_called()
        doc = syncs.insert_one.call_args.args[0]
        assert doc["seen_urls"] == [e["url"] for e in PLAYLIST["entries"]] and doc["destination_label"] == "/Home/Music"

    def test_ten_at_most(self, client, as_user, tasks_db, index_chat, syncs):
        as_user()
        syncs.count_documents.return_value = 10
        res = client.post("/api/transfers/remote/media", json={"url": "https://y/x", "sync": True, "choice": {}, "destination": {"kind": "home", "path": "/Home"}})
        assert res.status_code == 429

    def test_check_queues_only_new_videos(self, syncs):
        from telestore.services import media_sync
        doc = {"sync_id": "sync_1", "user_id": "42", "url": "https://www.youtube.com/playlist?list=x", "choice": {"mode": "audio"},
               "destination": {"kind": "home", "path": "/Home"}, "chat_id": -100, "seen_urls": [PLAYLIST["entries"][0]["url"]]}
        with probing({**PLAYLIST, "url": doc["url"]}), patch.object(remote_transfer_manager, "enqueue_media") as enqueue:
            assert asyncio.run(media_sync.check(doc)) == 2
        assert [e["index"] for e in enqueue.call_args.args[2]] == [2, 3]
        assert syncs.update_one.call_args.args[1]["$set"]["last_new_count"] == 2
