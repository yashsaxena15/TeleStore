"""Owner controls on user accounts: Active and Can upload, plus adding users at /user."""

from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from telestore.api.app import app
from telestore.db import database
from telestore.security import credentials
from telestore.security.credentials import User, account_flags, require_auth, require_upload


@pytest.fixture
def as_user():
    def use(**kwargs):
        app.dependency_overrides[require_auth] = lambda: User(**{"username": "bob", **kwargs})
    yield use
    app.dependency_overrides.pop(require_auth, None)


class TestAccountFlags:
    def test_missing_values_mean_allowed(self):
        assert account_flags("bob", {"username": "bob"}) == (True, True)
        assert account_flags("bob", None) == (True, True)

    def test_saved_values(self):
        assert account_flags("bob", {"active": False, "can_upload": True}) == (False, True)
        assert account_flags("bob", {"active": True, "can_upload": False}) == (True, False)

    def test_owner_is_never_limited(self):
        assert account_flags("admin", {"active": False, "can_upload": False}) == (True, True)
        assert account_flags("yash", {"telegram_user_id": 123456789, "active": False}) == (True, True)

    def test_turned_off_account_is_refused(self):
        with pytest.raises(HTTPException) as e:
            credentials._with_account_flags(User(username="bob"), {"active": False})
        assert e.value.status_code == 403

    def test_upload_guard(self):
        with pytest.raises(HTTPException) as e:
            require_upload(User(username="bob", can_upload=False))
        assert e.value.status_code == 403
        assert require_upload(User(username="bob")).username == "bob"


class TestUploadEndpoints:
    @pytest.mark.parametrize("path, body", [
        ("/files/upload/init", {"filename": "a.bin", "filesize": 10, "path": "/Home"}),
        ("/api/transfers/remote/add", {"url": "https://example.com/a.iso", "destination_path": "/Home"}),
    ])
    def test_refused_when_uploads_are_off(self, client, as_user, path, body):
        as_user(can_upload=False)
        res = client.post(path, json=body)
        assert res.status_code == 403
        assert "Uploading is turned off" in res.json()["detail"]

    def test_browsing_still_works(self, client, as_user):
        as_user(can_upload=False)
        database.Files.get_files_by_path.return_value = ([], 0)
        assert client.get("/files", params={"path": "/Home"}).status_code != 403


class TestSignIn:
    def test_turned_off_account_cannot_sign_in(self, client):
        database.Users.getUser.return_value = {"username": "bob", "active": False}
        database.Users.verify_user_credentials.return_value = True
        res = client.post("/auth/login", json={"username": "bob", "password": "right"})
        assert res.status_code == 403
        assert "turned off" in res.json()["detail"]


class TestManageUsers:
    def test_add_user_works_without_trailing_slash(self, client, as_user):
        as_user(username="admin")
        database.Users.getUser.return_value = None
        database.Users.get_all_users.return_value = []
        database.Users.user_cache = set()
        database.Users.SaveUser.return_value = SimpleNamespace(inserted_id="abc")
        res = client.post("/user", json={"username": "newbie", "email": "n@example.com", "password": "secret123", "can_upload": False})
        assert res.status_code == 200, res.text
        assert res.json()["can_upload"] is False
        saved = database.Users.update_user_by_identifier.call_args[0]
        assert saved == ("newbie", {"active": True, "can_upload": False})

    def test_owner_account_cannot_be_turned_off(self, client, as_user):
        as_user(username="admin")
        database.Users.get_user_by_identifier.return_value = {"username": "admin"}
        res = client.put("/user/1", json={"active": False})
        assert res.status_code == 400

    def test_turning_a_user_off(self, client, as_user):
        as_user(username="admin")
        database.Users.get_user_by_identifier.return_value = {"username": "bob", "telegram_user_id": 42, "index_chat_id": -100}
        database.Users.update_user_by_identifier.return_value = True
        res = client.put("/user/abc", json={"active": False})
        assert res.status_code == 200
        assert database.Users.update_user_by_identifier.call_args[0] == ("abc", {"active": False})
        body = res.json()
        assert body["has_telegram"] is True and body["has_index_chat"] is True
