"""Storage space for WebDAV clients (RFC 4331 quota) and the Storage page."""

from unittest.mock import patch

from telestore.api.app import app
from telestore.api.routes.webdav import common as dav
from telestore.config import STORAGE_QUOTA_BYTES
from telestore.db import database
from telestore.db.repositories.files import Files
from telestore.security.credentials import User, require_auth


def test_the_display_size_is_100_tb_in_windows_units():
    assert STORAGE_QUOTA_BYTES == 100 * 1024 ** 4


def test_used_and_free_are_cached_for_a_minute():
    dav._quota_cache.clear()
    database.Files.used_bytes.return_value = 1_500_000_000_000
    assert dav.storage_quota("42") == (1_500_000_000_000, STORAGE_QUOTA_BYTES - 1_500_000_000_000)
    dav.storage_quota("42")
    assert database.Files.used_bytes.call_count == 1
    dav._quota_cache.clear()


def test_used_bytes_sums_one_owners_files():
    repo = Files.__new__(Files)
    with patch.object(Files, "aggregate", return_value=iter([{"_id": None, "bytes": 123}])) as aggregate:
        assert repo.used_bytes("42") == 123
    match = aggregate.call_args.args[0][0]["$match"]
    assert match == {"owner_id": "42", "file_type": {"$ne": "folder"}}


def test_propfind_shows_space_on_folders_not_files(client):
    dav._quota_cache.clear()
    database.Users.getUser.return_value = {"username": "bob", "telegram_user_id": 42, "index_chat_id": -100}
    database.Files.used_bytes.return_value = 2048
    with patch.object(dav, "check_login", return_value="bob"):
        dav.forget_webdav_logins()
        res = client.request("PROPFIND", "/webdav/", headers={"Authorization": "Basic Ym9iOnNlY3JldA==", "Depth": "1"})
    assert res.status_code == 207
    body = res.text
    assert body.count("<D:quota-used-bytes>2048</D:quota-used-bytes>") == body.count("<D:collection/>") > 0
    assert f"<D:quota-available-bytes>{STORAGE_QUOTA_BYTES - 2048}</D:quota-available-bytes>" in body
    dav._quota_cache.clear()
    dav.forget_webdav_logins()


def test_storage_page_gets_the_size_and_free_space(client):
    app.dependency_overrides[require_auth] = lambda: User(username="bob", telegram_user_id=42)
    database.Files.get_storage_analytics.return_value = {"total_bytes": 1000, "total_files": 1}
    try:
        res = client.get("/files/analytics")
    finally:
        app.dependency_overrides.pop(require_auth, None)
    assert res.json()["quota_bytes"] == STORAGE_QUOTA_BYTES and res.json()["free_bytes"] == STORAGE_QUOTA_BYTES - 1000
