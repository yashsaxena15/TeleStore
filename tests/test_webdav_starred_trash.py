"""Folders shown in WebDAV's Starred and Trash can be opened, and files inside them read."""

from unittest.mock import patch

import pytest

from telestore.api.routes.webdav import common as dav
from telestore.db import database

AUTH = {"Authorization": "Basic Ym9iOnNlY3JldA=="}

FILES = [
    {"file_name": "My Drive", "file_type": "folder", "file_path": "/Home", "starred": True},
    {"file_name": "Report.pdf", "file_type": "document", "file_path": "/Home/My Drive", "file_size": 10},
    {"file_name": "Old.pdf", "file_type": "document", "file_path": "/Home/My Drive", "trashed": True},
    {"file_name": "Work", "file_type": "folder", "file_path": "/Home/My Drive"},
    {"file_name": "Plan.txt", "file_type": "document", "file_path": "/Home/My Drive/Work", "file_size": 5,
     "chat_id": -100, "message_id": 7},
    {"file_name": "Images", "file_type": "folder", "file_path": "/Home", "trashed": True},
    {"file_name": "cat.jpg", "file_type": "photo", "file_path": "/Home/Images", "trashed": True, "file_size": 3},
    {"file_name": "Images", "file_type": "folder", "file_path": "/Home"},  # a new folder with the same name
    {"file_name": "dog.jpg", "file_type": "photo", "file_path": "/Home/Images", "file_size": 4},
    {"file_name": "Secret", "file_type": "folder", "file_path": "/Vault", "starred": True, "is_vault": True},
]


def _matches(doc, query):
    for key, cond in query.items():
        value = doc.get(key)
        if isinstance(cond, dict):
            if "$ne" in cond and value == cond["$ne"]:
                return False
            if "$in" in cond and value not in cond["$in"]:
                return False
        elif value != cond:
            return False
    return True


@pytest.fixture(autouse=True)
def files():
    docs = [{"owner_id": "42", **d} for d in FILES]
    database.Files.find.side_effect = lambda q, *a, **kw: [d for d in docs if _matches(d, q)]
    database.Files.find_one.side_effect = lambda q, *a, **kw: next((d for d in docs if _matches(d, q)), None)
    database.Files.used_bytes.return_value = 0
    database.Users.getUser.return_value = {"username": "bob", "telegram_user_id": 42, "index_chat_id": -100}
    dav.forget_webdav_logins()
    dav._quota_cache.clear()
    with patch.object(dav, "check_login", return_value="bob"):
        yield
    database.Files.find.side_effect = None
    database.Files.find_one.side_effect = None
    dav.forget_webdav_logins()
    dav._quota_cache.clear()


def _propfind(client, path):
    return client.request("PROPFIND", path, headers={**AUTH, "Depth": "1"})


def test_a_starred_folder_opens_with_its_live_contents(client):
    res = _propfind(client, "/webdav/Starred/My Drive/")
    assert res.status_code == 207
    assert "Report.pdf" in res.text and "Work" in res.text
    assert "Old.pdf" not in res.text  # trashed, so only in Trash


def test_folders_inside_a_starred_folder_open_too(client):
    res = _propfind(client, "/webdav/Starred/My Drive/Work/")
    assert res.status_code == 207 and "Plan.txt" in res.text


def test_a_file_inside_a_starred_folder_has_its_details(client):
    res = client.request("PROPFIND", "/webdav/Starred/My Drive/Report.pdf", headers={**AUTH, "Depth": "0"})
    assert res.status_code == 207 and "<D:getcontentlength>10</D:getcontentlength>" in res.text


def test_a_trashed_folder_shows_what_was_trashed_with_it(client):
    res = _propfind(client, "/webdav/Trash/Images/")
    assert res.status_code == 207
    assert "cat.jpg" in res.text
    assert "dog.jpg" not in res.text  # lives in the new Images folder, not in Trash


def test_missing_items_and_vault_folders_stay_404(client):
    assert _propfind(client, "/webdav/Starred/Nope/").status_code == 404
    assert _propfind(client, "/webdav/Starred/My Drive/Nope").status_code == 404
    assert _propfind(client, "/webdav/Starred/Secret/").status_code == 404


def test_the_browser_listing_opens_a_starred_folder(client):
    res = client.get("/webdav/Starred/My%20Drive/", headers=AUTH)
    assert res.status_code == 200 and "Report.pdf" in res.text


def test_a_file_in_a_starred_folder_can_be_read(client):
    res = client.head("/webdav/Starred/My%20Drive/Work/Plan.txt", headers=AUTH)
    assert res.status_code == 200 and res.headers["content-length"] == "5"
