"""Notifications: what the server records, and the API the app and the website read."""

from unittest.mock import patch

import pytest
from bson import ObjectId

from telestore.api.app import app
from telestore.security.credentials import User, require_auth
from telestore.services import event_service

REAL_STORAGE_CHECK = event_service.storage_check


class FakeCollection:
    """Enough of Mongo for events and transfers: equality, $in, $nin, $gt, sort by _id, unique dedupe."""

    def __init__(self, docs=()):
        self.docs = [dict(d) for d in docs]

    @staticmethod
    def _ok(doc, flt):
        for key, want in flt.items():
            have = doc.get(key)
            if isinstance(want, dict):
                if "$in" in want and have not in want["$in"]:
                    return False
                if "$nin" in want and have in want["$nin"]:
                    return False
                if "$gt" in want and not (have is not None and have > want["$gt"]):
                    return False
            elif have != want:
                return False
        return True

    def create_index(self, *a, **k):
        pass

    def insert_one(self, doc):
        if doc.get("dedupe") and any(d.get("dedupe") == doc["dedupe"] for d in self.docs):
            raise Exception("E11000 duplicate key error")
        doc.setdefault("_id", ObjectId())
        self.docs.append(dict(doc))

    def find(self, flt=None):
        docs = [d for d in self.docs if self._ok(d, flt or {})]

        class Cursor(list):
            def sort(self, key, direction):
                return Cursor(sorted(self, key=lambda d: d[key], reverse=direction < 0))

            def limit(self, n):
                return Cursor(self[:n])
        return Cursor(docs)

    def find_one(self, flt=None, sort=None):
        docs = self.find(flt)
        if sort:
            docs = docs.sort(sort[0][0], sort[0][1])
        return docs[0] if docs else None

    def count_documents(self, flt):
        return len(self.find(flt))

    def update_many(self, flt, update):
        for d in self.docs:
            if self._ok(d, flt):
                d.update(update["$set"])


@pytest.fixture
def db():
    events, transfers = FakeCollection(), FakeCollection()
    store = {"Events": events, "RemoteTransfers": transfers}
    with patch("telestore.services.remote_transfer_manager.helpers.get_remote_db", return_value=store), \
            patch.object(event_service, "storage_check"):
        yield events, transfers


def titles(events):
    return [(e["title"], e["body"]) for e in events.docs]


class TestTransfers:
    def test_single_file_done_and_failed(self, db):
        events, transfers = db
        transfers.docs += [
            {"task_id": "t1", "user_id": "42", "status": "completed", "filename": "Movie.mkv", "destination_path": "/Home/Movies"},
            {"task_id": "t2", "user_id": "42", "status": "failed", "filename": "Big.iso", "error_message": "Link expired"},
        ]
        event_service.task_finished("t1")
        event_service.task_finished("t1")  # told twice: one event
        event_service.task_finished("t2")
        assert titles(events) == [("Transfer finished", "Movie.mkv saved."), ("Transfer failed", "Big.iso: Link expired")]
        assert events.docs[0]["target"] == {"type": "folder", "path": "/Home/Movies"}
        assert events.docs[1]["target"] == {"type": "transfers"}

    def test_a_folder_counts_once_when_its_last_file_is_done(self, db):
        events, transfers = db
        transfers.docs += [
            {"task_id": f"g{i}", "user_id": "42", "status": s, "group_id": "G", "group_name": "Holiday", "destination_path": "/Home/Holiday"}
            for i, s in enumerate(["completed", "completed", "downloading"])
        ]
        event_service.task_finished("g0")
        assert events.docs == []  # one still downloading
        transfers.docs[2]["status"] = "failed"
        event_service.task_finished("g2")
        event_service.task_finished("g1")
        assert titles(events) == [("Transfer finished with problems", "Holiday: 2 saved, 1 failed.")]

    def test_kinds_and_the_vault(self, db):
        events, transfers = db
        transfers.docs += [
            {"task_id": "m", "user_id": "42", "status": "completed", "filename": "Song.mp3", "media_job_id": "j", "destination_path": "/Home/Music"},
            {"task_id": "i", "user_id": "42", "status": "completed", "filename": "post.jpg", "instagram_shortcode": "abc", "destination_path": "/Vault/Insta"},
        ]
        event_service.task_finished("m")
        event_service.task_finished("i")
        assert [e["kind"] for e in events.docs] == ["media", "instagram"]
        assert events.docs[0]["title"] == "Video download finished"
        assert events.docs[1]["target"] == {"type": "transfers"}  # never opens the vault

    def test_cancelled_says_nothing(self, db):
        events, transfers = db
        transfers.docs.append({"task_id": "c", "user_id": "42", "status": "cancelled", "filename": "x"})
        event_service.task_finished("c")
        assert events.docs == []


class TestOthers:
    def test_inbox_once_per_message(self, db):
        events, _ = db
        event_service.inbox_file("42", "scan.pdf", -100, 7)
        event_service.inbox_file("42", "scan.pdf", -100, 7)
        assert titles(events) == [("New file in Telegram Inbox", "scan.pdf")]

    def test_playlist_sync(self, db):
        events, _ = db
        event_service.playlist_sync("42", "Daily mix", 0)
        event_service.playlist_sync("42", "Daily mix", 3)
        assert titles(events) == [("3 new videos", "From “Daily mix”, downloading now.")]

    @pytest.mark.parametrize("agent, device, label", [
        ("Mozilla/5.0 (Windows NT 10.0) Chrome/128.0 Safari/537.36", None, "Chrome on Windows"),
        ("Mozilla/5.0 (Linux; Android 14) Firefox/130.0", None, "Firefox on Android"),
        ("okhttp/4.12", "android", "the Android app"),
        ("", None, "a new device"),
    ])
    def test_device_names(self, agent, device, label):
        assert event_service.device_label(agent, device) == label

    def test_storage_almost_full_once_a_week(self, db):
        events, _ = db
        with patch("telestore.db.database.Files.used_bytes", return_value=95), patch("telestore.config.STORAGE_QUOTA_BYTES", 100):
            REAL_STORAGE_CHECK("42")
            REAL_STORAGE_CHECK("42")
        with patch("telestore.db.database.Files.used_bytes", return_value=50), patch("telestore.config.STORAGE_QUOTA_BYTES", 100):
            REAL_STORAGE_CHECK("7")
        assert titles(events) == [("Storage almost full", "95% of your storage is used.")]


class TestApi:
    @pytest.fixture(autouse=True)
    def signed_in(self, db):
        app.dependency_overrides[require_auth] = lambda: User(username="bob", telegram_user_id=42)
        yield db
        app.dependency_overrides.pop(require_auth, None)

    def test_list_newer_and_mark_read(self, client, signed_in):
        events, _ = signed_in
        event_service.record("42", "inbox", "One")
        event_service.record("bob", "sign_in", "Two")
        event_service.record("99", "inbox", "Someone else's")
        got = client.get("/user/notifications").json()
        assert [i["title"] for i in got["items"]] == ["Two", "One"] and got["unread"] == 2
        assert got["items"][0]["created_at"].endswith("Z")
        newer = client.get(f"/user/notifications?after={got['items'][1]['id']}").json()
        assert [i["title"] for i in newer["items"]] == ["Two"]
        assert client.post("/user/notifications/read", json={"ids": [got["items"][0]["id"]]}).json() == {"unread": 1}
        assert client.post("/user/notifications/read", json={"all": True}).json() == {"unread": 0}
        assert events.docs[2]["read"] is False  # not this user's

    def test_signed_out(self, client):
        app.dependency_overrides.pop(require_auth, None)
        assert client.get("/user/notifications").status_code == 401


def test_sign_in_is_recorded(client):
    with patch("telestore.api.routes.auth.check_login", return_value="bob"), \
            patch("telestore.api.routes.auth.account_flags", return_value=(True, True)), \
            patch.object(event_service, "sign_in") as recorded:
        res = client.post("/auth/login", json={"username": "bob", "password": "x", "device": "android"}, headers={"user-agent": "okhttp"})
    assert res.status_code == 200
    assert recorded.call_args.args[:3] == ("bob", "okhttp", "android")


def test_the_server_marks_finishes(db):
    from telestore.services.remote_transfer_manager.manager import RemoteTransferManager
    events, transfers = db
    with patch.object(event_service, "task_finished") as finished, \
            patch("telestore.services.remote_transfer_manager.manager.get_remote_db", return_value={"RemoteTransfers": transfers}):
        transfers.update_one = lambda *a, **k: None
        RemoteTransferManager._update_task(object.__new__(RemoteTransferManager), "t9", {"status": "failed"})
        RemoteTransferManager._update_task(object.__new__(RemoteTransferManager), "t9", {"progress": 50})
    finished.assert_called_once_with("t9")
