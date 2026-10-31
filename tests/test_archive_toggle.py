"""Archive tools (compress, extract, look inside) can be turned off by the owner for everyone
(Settings › Server) or for one user, and they don't start when the disk can't hold the job."""

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from telestore.api.app import app
from telestore.security.credentials import User, archives_allowed, require_auth
from telestore.services import server_settings


@pytest.fixture
def server_switch():
    """Settings › Server, without the database: set state["on"] to flip the switch."""
    state = {"on": True}
    with patch.object(server_settings, "get", side_effect=lambda: {"archives_enabled": state["on"]}):
        yield state


@pytest.mark.parametrize("server_on, choice, allowed", [
    (True, None, True),
    (False, None, False),
    (False, "allow", True),   # e.g. only the owner keeps them
    (True, "block", False),
    (False, "block", False),
    (True, "something else", True),  # unknown values follow the server
])
def test_the_users_choice_wins_over_the_server_switch(server_switch, server_on, choice, allowed):
    server_switch["on"] = server_on
    assert archives_allowed({"archives": choice} if choice else {}) is allowed


@pytest.fixture
def signed_in():
    def sign_in(**flags):
        app.dependency_overrides[require_auth] = lambda: User(username="bob", telegram_user_id=42, **flags)
    yield sign_in
    app.dependency_overrides.pop(require_auth, None)


@pytest.mark.parametrize("method, path, body", [
    ("get", "/archive/inspect/abc", None),
    ("post", "/archive/extract", {"file_id": "abc", "target_path": "/Home"}),
    ("post", "/archive/compress", {"item_ids": ["abc"], "destination_path": "/Home", "zip_name": "a.zip"}),
])
def test_turned_off_archive_tools_are_refused(client, signed_in, method, path, body):
    signed_in(archives=False)
    res = getattr(client, method)(path, json=body) if body else getattr(client, method)(path)
    assert res.status_code == 403
    assert res.json()["detail"] == "Compress and extract are turned off by the owner."


def test_jobs_can_still_be_listed_and_cancelled_when_turned_off(client, signed_in):
    signed_in(archives=False)
    with patch("telestore.api.routes.archive.archive_task_manager") as manager:
        manager.list_tasks.return_value = [{"id": "t1", "status": "running"}]
        assert client.get("/archive/tasks").json() == {"tasks": [{"id": "t1", "status": "running"}]}


def test_the_app_learns_what_it_may_show(client, signed_in):
    signed_in(archives=False)
    assert client.get("/user/features").json() == {"archives": False, "is_owner": False}


def test_only_the_owner_sees_and_changes_server_settings(client, signed_in, server_switch):
    signed_in()
    assert client.get("/system/settings").status_code == 403
    assert client.put("/system/settings", json={"archives_enabled": False}).status_code == 403
    app.dependency_overrides[require_auth] = lambda: User(username="admin")
    with patch.object(server_settings, "update", return_value={"archives_enabled": False}) as update:
        assert client.put("/system/settings", json={"archives_enabled": False}).json() == {"archives_enabled": False}
    assert update.call_args.kwargs == {"archives_enabled": False}


def test_server_settings_are_stored_and_read_back():
    coll = MagicMock()
    coll.find_one.return_value = {"_id": "server", "archives_enabled": False}
    with patch.object(server_settings, "_coll", return_value=coll):
        server_settings._cache.update(value=None, at=0.0)
        assert server_settings.update(archives_enabled=False, unknown=1) == {"archives_enabled": False}
        assert coll.update_one.call_args.args == ({"_id": "server"}, {"$set": {"archives_enabled": False}})
        server_settings._cache.update(value=None, at=0.0)
        coll.find_one.return_value = None
        assert server_settings.get() == {"archives_enabled": True}  # nothing stored: on
    server_settings._cache.update(value=None, at=0.0)


def test_the_owner_sets_a_users_archive_tools(client, signed_in):
    app.dependency_overrides[require_auth] = lambda: User(username="admin")
    stored = {"_id": "u2", "username": "family"}
    with patch("telestore.api.routes.user.database") as db, patch.object(server_settings, "get", return_value={"archives_enabled": False}):
        db.Users.get_user_by_identifier.side_effect = lambda _id: stored
        db.Users.update_user_by_identifier.side_effect = lambda _id, data: stored.update(data) or True
        res = client.put("/user/u2", json={"archives": "allow"})
        assert res.status_code == 200
        assert (res.json()["archives"], res.json()["archives_allowed"]) == ("allow", True)
        assert client.put("/user/u2", json={"archives": "maybe"}).status_code == 400


def test_looking_inside_needs_room_for_the_whole_archive(client, signed_in):
    signed_in()
    doc = {"_id": "x", "file_name": "big.zip", "file_size": 40 * 2**30, "chat_id": 1, "message_id": 2}
    with patch("telestore.api.routes.archive._own_item", return_value=doc), \
            patch("telestore.api.routes.archive.check_disk_safety", return_value=(False, "Operation blocked for server safety", {})) as check:
        res = client.get("/archive/inspect/x")
    assert res.status_code == 400 and "server safety" in res.json()["detail"]
    assert check.call_args.args[0] == 40 * 2**30 + 512 * 2**20


def test_extracting_stops_before_unpacking_when_the_contents_dont_fit(tmp_path):
    from telestore.services import cloud_archive

    manager = MagicMock()
    manager._cancel_events = {}
    manager.is_cancelled.return_value = False
    payload = {"file_doc": {"chat_id": 1, "message_id": 2, "file_size": 10 * 2**30, "file_name": "big.zip"},
               "target_path": "/Home", "user_id": "42", "bot_manager": MagicMock(client_list=[])}
    with patch.object(cloud_archive, "TEMP_ARCHIVE_DIR", str(tmp_path)), \
            patch.object(cloud_archive, "download_file_to_temp", new=AsyncMock()), \
            patch.object(cloud_archive, "unpacked_size", new=AsyncMock(return_value=30 * 2**30)), \
            patch("telestore.services.archive_task_manager.check_disk_safety", return_value=(False, "No room.", {})), \
            patch.object(cloud_archive, "extract_with_7z_or_fallback", new=AsyncMock()) as unpack, \
            patch.object(cloud_archive, "ByteStreamer"):
        with pytest.raises(Exception, match=r"Not enough disk space to unpack 'big.zip' \(30.0 GB inside\)"):
            asyncio.run(cloud_archive.execute_task_extract("t1", payload, manager))
    unpack.assert_not_called()
