"""Sign-in fixes: usernames ignore spaces and case, Google sign-in by email for added users,
owner password reset, email "Forgot password?", and bot /start records hidden from Users."""

from unittest.mock import AsyncMock, patch

import pytest

from telestore.api.app import app
from telestore.api.routes import auth as auth_routes
from telestore.db import database
from telestore.security.credentials import User, require_auth


def _users(docs):
    """Make database.Users answer getUser / find_one / get_all_users from a list of docs."""
    by_name = {d["username"]: d for d in docs}
    database.Users.getUser.side_effect = lambda name: by_name.get(name)
    database.Users.get_all_users.return_value = docs

    def find_one(query):
        q = query.get("username")
        if isinstance(q, dict) and "$regex" in q:
            target = q["$regex"].strip("^$").replace("\\", "").lower()
            return next((d for d in docs if isinstance(d["username"], str) and d["username"].lower() == target), None)
        return by_name.get(q)
    database.Users.find_one.side_effect = find_one
    database.Users.user_cache = set()


@pytest.fixture(autouse=True)
def reset_side_effects():
    yield
    for m in (database.Users.getUser, database.Users.find_one):
        m.side_effect = None


@pytest.fixture
def as_user():
    def use(**kwargs):
        app.dependency_overrides[require_auth] = lambda: User(**kwargs)
    yield use
    app.dependency_overrides.pop(require_auth, None)


class TestPasswordSignIn:
    @pytest.mark.parametrize("typed", ["yashsaxena15 ", " Yashsaxena15", "YASHSAXENA15"])
    def test_spaces_and_case_are_ignored(self, client, typed):
        _users([{"username": "yashsaxena15", "password_hash": "x"}])
        database.Users.verify_user_credentials.side_effect = lambda name, pw: name == "yashsaxena15" and pw == "right"
        res = client.post("/auth/login", json={"username": typed, "password": "right"})
        database.Users.verify_user_credentials.side_effect = None
        assert res.status_code == 200, res.text
        assert res.json()["username"] == "yashsaxena15"

    def test_wrong_password_still_fails(self, client):
        _users([{"username": "yashsaxena15", "password_hash": "x"}])
        database.Users.verify_user_credentials.return_value = False
        assert client.post("/auth/login", json={"username": "yashsaxena15", "password": "nope"}).status_code == 401


class TestGoogleSignIn:
    INFO = {"email": "guest@gmail.com", "name": "Guest Person", "picture": ""}

    def test_config_exposes_client_id_key(self, client):
        assert "client_id" in client.get("/auth/google/config").json()

    def test_added_google_user_signs_in_by_email(self, client):
        _users([{"username": "google_guest@gmail.com", "email": "guest@gmail.com"}])
        with patch.object(auth_routes, "verify_google_token", return_value=self.INFO):
            res = client.post("/auth/google", json={"token": "t"})
        assert res.status_code == 200, res.text
        assert res.json()["user"]["username"] == "google_guest@gmail.com"

    def test_same_display_name_does_not_give_access(self, client):
        _users([{"username": "Guest Person", "password_hash": "x"}])
        with patch.object(auth_routes, "verify_google_token", return_value=self.INFO):
            res = client.post("/auth/google", json={"token": "t"})
        assert res.status_code == 403
        assert "hasn't been added" in res.json()["detail"]

    def test_admin_email_gets_an_account(self, client):
        _users([])
        with patch.object(auth_routes, "verify_google_token", return_value=self.INFO), \
                patch.object(auth_routes, "AUTHORIZED_ADMINS", ["Guest@gmail.com"]):
            res = client.post("/auth/google", json={"token": "t"})
        assert res.status_code == 200
        database.Users.SaveUser.assert_called_with(username="google_guest@gmail.com", email="guest@gmail.com")


class TestForgotPassword:
    def test_request_sends_code_for_accounts_with_email(self, client):
        _users([{"username": "yashsaxena15", "password_hash": "x", "email": "Yash@Example.com"}])
        with patch.object(auth_routes, "create_and_send_vault_otp", new=AsyncMock()) as send:
            res = client.post("/auth/forgot-password/request", json={"username": "Yashsaxena15 "})
        assert res.status_code == 200
        send.assert_awaited_once_with("yash@example.com", "pwreset:yashsaxena15", purpose="Password Reset", label="Password Reset")

    def test_request_answers_the_same_for_unknown_users(self, client):
        _users([])
        with patch.object(auth_routes, "create_and_send_vault_otp", new=AsyncMock()) as send:
            res = client.post("/auth/forgot-password/request", json={"username": "nobody"})
        assert res.status_code == 200
        assert res.json()["message"] == auth_routes.RESET_SENT
        send.assert_not_called()

    def test_reset_with_right_code_sets_new_password(self, client):
        _users([{"username": "yashsaxena15", "password_hash": "x", "email": "yash@example.com"}])
        with patch.object(auth_routes, "verify_vault_otp", new=AsyncMock(return_value=True)):
            res = client.post("/auth/forgot-password/reset", json={"username": "yashsaxena15", "code": "123456", "new_password": "brandnew1"})
        assert res.status_code == 200
        name, update = database.Users.update_user_by_identifier.call_args[0]
        assert name == "yashsaxena15" and update["password_hash"].startswith("scrypt$")

    def test_reset_rejects_wrong_code_and_short_password(self, client):
        _users([{"username": "yashsaxena15", "password_hash": "x", "email": "yash@example.com"}])
        with patch.object(auth_routes, "verify_vault_otp", new=AsyncMock(return_value=False)):
            assert client.post("/auth/forgot-password/reset", json={"username": "yashsaxena15", "code": "000000", "new_password": "brandnew1"}).status_code == 400
        assert client.post("/auth/forgot-password/reset", json={"username": "yashsaxena15", "code": "1", "new_password": "x"}).status_code == 400
        database.Users.update_user_by_identifier.assert_not_called()


class TestOwnerReset:
    def test_owner_sets_password_without_current(self, client, as_user):
        as_user(username="admin")
        _users([{"username": "admin"}, {"username": "family", "password_hash": "x"}])
        database.Users.get_user_by_identifier.return_value = {"username": "family"}
        database.Users.get_password_hash.return_value = "x"
        database.Users.update_user_by_identifier.return_value = True
        res = client.put("/user/u2/password", json={"new_password": "fresh123"})
        assert res.status_code == 200, res.text
        database.Users.verify_current_password.assert_not_called()

    def test_others_still_need_their_current_password(self, client, as_user):
        as_user(username="family")
        _users([{"username": "family", "password_hash": "x"}])
        database.Users.get_user_by_identifier.return_value = {"username": "family"}
        database.Users.get_password_hash.return_value = "x"
        database.Users.verify_current_password.return_value = False
        res = client.put("/user/family/password", json={"current_password": "wrong", "new_password": "fresh123"})
        assert res.status_code == 400


    def test_password_change_never_logs_the_account_record(self, client, as_user):
        from telestore.api.routes import user as user_routes
        as_user(username="family")
        secret = "scrypt$do-not-log-this-hash"
        _users([{"username": "family", "password_hash": secret, "email": "f@example.com"}])
        database.Users.get_user_by_identifier.return_value = {"username": "family", "password_hash": secret}
        database.Users.get_password_hash.return_value = secret
        database.Users.verify_current_password.return_value = True
        database.Users.update_user_by_identifier.return_value = True
        with patch.object(user_routes, "logger") as log:
            res = client.put("/user/family/password", json={"current_password": "old-pass", "new_password": "fresh123"})
        assert res.status_code == 200, res.text
        logged = " ".join(str(c) for c in log.mock_calls)
        assert secret not in logged and "old-pass" not in logged and "fresh123" not in logged


class TestUsersList:
    def test_bot_start_records_are_hidden(self, client, as_user):
        as_user(username="admin")
        _users([{"username": "admin"}, {"username": 5551234, "telegram_user_id": 5551234}, {"username": "family", "email": "f@example.com"}])
        names = [u["username"] for u in client.get("/user").json()["users"]]
        assert names == ["admin", "family"]
