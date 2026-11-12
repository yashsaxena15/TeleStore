"""Direct uploads from the Windows app (November 2026).

The app uploads straight to the person's own storage channel with their own Telegram account; the
server only says where and how (/direct/prepare) and, after checking the messages with its bots,
saves the record (/direct/complete), in the same format as any other upload.
"""

from types import SimpleNamespace
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from telestore.api.app import app
from telestore.api.routes import direct
from telestore.db import database
from telestore.db.repositories.files import Files as RealFiles
from telestore.security.credentials import User, require_auth
from test_shares import Coll

GB = 1024 ** 3
PART = direct.PART_SIZE
CHAT = -1001234
ME = User(username="me", telegram_user_id=111)
NEW = User(username="new", telegram_user_id=222)  # verified, but no storage channel yet
NOBODY = User(username="nobody")  # Telegram not verified


class Files(Coll):
    """The real repository's recording logic over the in-memory collection."""
    check_if_exists = RealFiles.check_if_exists
    add_file = RealFiles.add_file
    claim_upload = RealFiles.claim_upload
    add_multipart_file = RealFiles.add_multipart_file


class Bot:
    """A bot that reads messages of the storage channel."""

    def __init__(self, messages, fail=False):
        self.messages, self.fail, self.asked = messages, fail, []

    async def get_messages(self, chat_id, ids):
        self.asked.append((chat_id, ids))
        if self.fail:
            raise RuntimeError("CHANNEL_PRIVATE")
        return [self.messages.get((chat_id, i)) for i in ids]


def message(mid, size, caption, thumb=None, kind="document"):
    media = SimpleNamespace(file_size=size, file_unique_id=f"u{mid}", thumbs=[SimpleNamespace(file_id=thumb)] if thumb else None)
    return SimpleNamespace(id=mid, caption=caption, empty=False, document=media if kind == "document" else None,
                           video=media if kind == "video" else None, audio=None, photo=None, voice=None)


@pytest.fixture
def world():
    files, users = Files(), Coll()
    users.insert_one({"username": "me", "telegram_user_id": 111, "index_chat_id": CHAT})
    users.insert_one({"username": "new", "telegram_user_id": 222})
    msgs = {}
    bots = [Bot(msgs)]
    w = SimpleNamespace(files=files, msgs=msgs, bots=bots, user={"u": ME})
    app.dependency_overrides[require_auth] = lambda: w.user["u"]
    manager = SimpleNamespace(get_least_busy_client=lambda: bots[0], client_list=bots)
    with patch.object(database, "Files", files), patch.object(database, "Users", users):
        app.state.bot_manager = manager
        w.client = TestClient(app)
        yield w
    app.dependency_overrides.pop(require_auth, None)
    app.state.bot_manager = None


def prepare(w, name="film.mkv", size=10, path="/Home/Movies"):
    return w.client.post("/direct/prepare", json={"path": path, "filename": name, "filesize": size})


def complete(w, parts, name="film.mkv", size=10, path="/Home/Movies"):
    return w.client.post("/direct/complete", json={"path": path, "filename": name, "filesize": size,
                                                   "parts": [{"part_index": i, "message_id": m} for i, m in parts]})


class TestPlan:
    def test_a_small_file_is_one_message(self):
        assert direct.plan("a.mkv", 10) == [{"part_index": 1, "start": 0, "length": 10, "file_name": "a.mkv",
                                             "caption": "Uploaded file: a.mkv"}]

    def test_a_big_file_is_parts_read_by_position(self):
        size = 5 * GB
        parts = direct.plan("big.mkv", size)
        assert [p["length"] for p in parts] == [PART, PART, size - 2 * PART]
        assert [p["start"] for p in parts] == [0, PART, 2 * PART]
        assert [p["caption"] for p in parts] == ["big.mkv (Part 1)", "big.mkv (Part 2)", "big.mkv (Part 3)"]
        assert parts[1]["file_name"] == "big.mkv.part2"

    def test_exactly_one_part_is_one_message(self):
        assert len(direct.plan("a", PART)) == 1 and len(direct.plan("a", PART + 1)) == 2


class TestPrepare:
    def test_says_where_and_how(self, world):
        res = prepare(world, size=5 * GB)
        assert res.status_code == 200
        body = res.json()
        assert body["chat_id"] == CHAT and body["path"] == "/Home/Movies" and body["total_parts"] == 3
        assert body["parts"][2]["caption"] == "film.mkv (Part 3)"

    @pytest.mark.parametrize("path", ["/Trash", "/Telegram Inbox/x", "/starred", "/Vault", "/Vault/Docs", "/Home/../Vault"])
    def test_places_files_cant_go(self, world, path):
        assert prepare(world, path=path).status_code == 400

    @pytest.mark.parametrize("name", ["", "a/b", "..", "a\\b"])
    def test_bad_names(self, world, name):
        assert prepare(world, name=name).status_code in (400, 422)

    def test_empty_files(self, world):
        assert prepare(world, size=0).status_code == 400

    def test_needs_a_verified_telegram_account(self, world):
        world.user["u"] = NOBODY
        assert "TELEGRAM_NOT_VERIFIED" in prepare(world).json()["detail"]

    def test_needs_a_storage_channel(self, world):
        world.user["u"] = NEW
        assert "storage channel" in prepare(world).json()["detail"]

    def test_uploads_turned_off_for_the_account(self, world):
        world.user["u"] = User(username="me", telegram_user_id=111, can_upload=False)
        assert prepare(world).status_code == 403

    def test_root_means_home(self, world):
        assert prepare(world, path="/").json()["path"] == "/Home"


class TestComplete:
    def test_saves_a_single_file(self, world):
        world.msgs[(CHAT, 50)] = message(50, 10, "Uploaded file: film.mkv", thumb="t50", kind="video")
        res = complete(world, [(1, 50)])
        assert res.status_code == 200, res.text
        doc = world.files.find_one({"message_id": 50})
        assert doc["file_path"] == "/Home/Movies" and doc["owner_id"] == "111" and doc["file_type"] == "video"
        assert doc["file_size"] == 10 and doc["thumbnail"] == "t50" and doc["chat_id"] == CHAT

    def test_saves_a_big_file_in_parts(self, world):
        size = 5 * GB
        sizes = [PART, PART, size - 2 * PART]
        for i, s in enumerate(sizes, 1):
            world.msgs[(CHAT, 100 + i)] = message(100 + i, s, f"film.mkv (Part {i})")
        res = complete(world, [(1, 101), (2, 102), (3, 103)], size=size)
        assert res.status_code == 200, res.text
        doc = world.files.find_one({"is_split": True})
        assert doc["total_parts"] == 3 and doc["file_size"] == size and doc["owner_id"] == "111"
        assert [(p["start_byte"], p["end_byte"]) for p in doc["parts"]] == [
            (0, PART - 1), (PART, 2 * PART - 1), (2 * PART, size - 1)]
        assert res.json()["file"]["total_parts"] == 3

    def test_a_missing_message_is_refused(self, world):
        assert complete(world, [(1, 77)]).status_code == 400
        assert world.files.docs == []

    def test_the_wrong_size_is_refused(self, world):
        world.msgs[(CHAT, 50)] = message(50, 9, "Uploaded file: film.mkv")
        assert "wrong size" in complete(world, [(1, 50)]).json()["detail"]

    def test_another_files_message_is_refused(self, world):
        world.msgs[(CHAT, 50)] = message(50, 10, "Uploaded file: other.mkv")
        assert complete(world, [(1, 50)]).status_code == 400

    def test_only_the_persons_own_channel_is_read(self, world):
        world.msgs[(CHAT, 50)] = message(50, 10, "Uploaded file: film.mkv")
        complete(world, [(1, 50)])
        assert {chat for chat, _ in world.bots[0].asked} == {CHAT}

    def test_parts_must_be_all_there_and_different(self, world):
        size = 5 * GB
        assert complete(world, [(1, 101), (2, 102)], size=size).status_code == 400
        assert complete(world, [(1, 101), (2, 101), (3, 103)], size=size).status_code == 400

    def test_a_message_cant_be_saved_twice(self, world):
        world.msgs[(CHAT, 50)] = message(50, 10, "Uploaded file: film.mkv")
        assert complete(world, [(1, 50)]).status_code == 200
        assert complete(world, [(1, 50)]).status_code == 409
        assert len(world.files.docs) == 1

    def test_taken_by_telegram_inbox_first_moves_to_its_folder(self, world):
        world.files.insert_one({"chat_id": CHAT, "message_id": 50, "file_unique_id": "u50", "file_name": "film.mkv",
                                "file_path": "/Telegram Inbox", "owner_id": "111"})
        world.msgs[(CHAT, 50)] = message(50, 10, "Uploaded file: film.mkv")
        with patch("telestore.services.event_service.forget_inbox_file"):
            assert complete(world, [(1, 50)]).status_code == 200
        assert world.files.find_one({"message_id": 50})["file_path"] == "/Home/Movies"

    def test_when_no_bot_can_read_the_channel(self, world):
        world.bots[0].fail = True
        assert complete(world, [(1, 50)]).status_code == 503

    def test_another_bot_is_tried(self, world):
        world.msgs[(CHAT, 50)] = message(50, 10, "Uploaded file: film.mkv")
        world.bots[0].fail = True
        world.bots.append(Bot(world.msgs))
        assert complete(world, [(1, 50)]).status_code == 200


class TestConfig:
    def test_gives_the_telegram_app_id(self, world):
        with patch.object(direct, "API_ID", 12345), patch.object(direct, "API_HASH", "abc"):
            body = world.client.get("/direct/config").json()
        assert body == {"api_id": 12345, "api_hash": "abc", "part_size": PART}

    def test_a_desktop_app_id_of_its_own(self, world, monkeypatch):
        monkeypatch.setenv("DESKTOP_API_ID", "999")
        monkeypatch.setenv("DESKTOP_API_HASH", "zzz")
        assert world.client.get("/direct/config").json()["api_id"] == 999

    def test_signed_in_only(self, world):
        app.dependency_overrides.pop(require_auth, None)
        assert world.client.get("/direct/config").status_code == 401
        assert world.client.get("/api/direct/config").status_code == 401


def test_the_windows_app_gets_a_long_lived_token():
    from telestore.api.routes import auth
    assert "windows" in auth.APP_DEVICES
