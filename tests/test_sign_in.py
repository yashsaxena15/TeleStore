"""Sign-in fixes: usernames ignore spaces and case, sign-in with the account's email,
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


class TestEmailSignIn:
    DOCS = [{"username": "yashsaxena15", "password_hash": "x", "email": "Yash@Example.com"},
            {"username": "mummy", "password_hash": "x", "email": "mummy@example.com"}]

    def test_the_email_signs_in_to_its_account(self, client):
        _users(self.DOCS)
        database.Users.verify_user_credentials.side_effect = lambda name, pw: name == "yashsaxena15" and pw == "right"
        res = client.post("/auth/login", json={"username": " yash@example.com", "password": "right"})
        database.Users.verify_user_credentials.side_effect = None
        assert res.status_code == 200, res.text
        assert res.json()["username"] == "yashsaxena15"

    def test_an_email_two_accounts_share_finds_neither(self):
        from telestore.security.credentials import canonical_username
        _users(self.DOCS + [{"username": "other", "email": "mummy@example.com"}])
        assert canonical_username("mummy@example.com") == "mummy@example.com"

    def test_google_sign_in_is_gone(self, client):
        assert client.get("/auth/google/config").json() == {"client_id": None}  # older apps hide their button
        assert client.post("/auth/google", json={"token": "t"}).status_code in (404, 405)

    def test_new_users_need_a_username_and_password(self, client, as_user):
        as_user(username="admin")
        _users(self.DOCS)
        assert client.post("/user", json={"email": "new@example.com"}).status_code == 400
        res = client.post("/user", json={"username": "new", "password": "secret1", "email": "MUMMY@example.com"})
        assert res.status_code == 400 and "already uses this email" in res.json()["detail"]


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
