"""Tests for the vault auto-lock setting and the change-recovery-email flow."""

import hashlib
import os
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from telestore.api.app import app
from telestore.api.routes import vault
from telestore.security.credentials import User, require_auth

PIN = "4321"


def _config(**extra):
    salt = os.urandom(16)
    return {
        "user_id": "admin",
        "email": "old@example.com",
        "pin_salt": salt.hex(),
        "pin_hash": hashlib.sha256(vault._derive_pin_key(PIN, salt)).hexdigest(),
        **extra,
    }


@pytest.fixture
def vault_coll():
    coll = MagicMock()
    coll.find_one.return_value = _config()
    coll.update_one.return_value = MagicMock(matched_count=1)
    db = {"VaultConfig": coll}
    app.dependency_overrides[require_auth] = lambda: User(username="admin")
    with patch.object(vault, "get_vault_db", return_value=db):
        yield coll
    app.dependency_overrides.pop(require_auth, None)


class TestAutoLock:
    def test_status_reports_saved_minutes(self, client, vault_coll):
        vault_coll.find_one.return_value = _config(auto_lock_minutes=60)
        assert client.get("/api/vault/status").json()["auto_lock_minutes"] == 60

    def test_status_falls_back_to_default(self, client, vault_coll):
        vault_coll.find_one.return_value = _config(auto_lock_minutes=7)
        assert client.get("/api/vault/status").json()["auto_lock_minutes"] == vault.DEFAULT_AUTO_LOCK_MINUTES

    def test_update_saves_allowed_value(self, client, vault_coll):
        res = client.put("/api/vault/settings", json={"auto_lock_minutes": 30})
        assert res.status_code == 200
        update = vault_coll.update_one.call_args[0][1]["$set"]
        assert update["auto_lock_minutes"] == 30

    def test_update_rejects_other_values(self, client, vault_coll):
        assert client.put("/api/vault/settings", json={"auto_lock_minutes": 999}).status_code == 400
        vault_coll.update_one.assert_not_called()

    def test_update_needs_a_vault(self, client, vault_coll):
        vault_coll.update_one.return_value = MagicMock(matched_count=0)
        assert client.put("/api/vault/settings", json={"auto_lock_minutes": 5}).status_code == 404

    def test_unlock_uses_saved_timeout(self, client, vault_coll):
        vault_coll.find_one.return_value = _config(auto_lock_minutes=5)
        assert client.post("/api/vault/unlock", json={"pin": PIN}).status_code == 200
        status = client.get("/api/vault/status").json()
        assert status["is_unlocked"] is True
        assert 0 < status["remaining_seconds"] <= 300


class TestRecoveryEmail:
    def test_request_needs_correct_pin(self, client, vault_coll):
        with patch.object(vault, "create_and_send_vault_otp", new=AsyncMock()) as send:
            res = client.post("/api/vault/recovery-email/request-otp", json={"email": "new@example.com", "pin": "0000"})
        assert res.status_code == 401
        send.assert_not_called()

    def test_request_rejects_same_email(self, client, vault_coll):
        with patch.object(vault, "create_and_send_vault_otp", new=AsyncMock()) as send:
            res = client.post("/api/vault/recovery-email/request-otp", json={"email": "OLD@example.com", "pin": PIN})
        assert res.status_code == 400
        send.assert_not_called()

    def test_request_sends_code_to_new_address(self, client, vault_coll):
        with patch.object(vault, "create_and_send_vault_otp", new=AsyncMock()) as send:
            res = client.post("/api/vault/recovery-email/request-otp", json={"email": " New@Example.com ", "pin": PIN})
        assert res.status_code == 200
        send.assert_awaited_once_with("new@example.com", "admin", purpose=vault.RECOVERY_EMAIL_PURPOSE)

    def test_confirm_saves_email_after_valid_code(self, client, vault_coll):
        with patch.object(vault, "verify_vault_otp", new=AsyncMock(return_value=True)):
            res = client.post("/api/vault/recovery-email/confirm", json={"email": "new@example.com", "pin": PIN, "otp_code": "123456"})
        assert res.status_code == 200
        assert vault_coll.update_one.call_args[0][1]["$set"]["email"] == "new@example.com"

    def test_confirm_rejects_wrong_code(self, client, vault_coll):
        with patch.object(vault, "verify_vault_otp", new=AsyncMock(return_value=False)):
            res = client.post("/api/vault/recovery-email/confirm", json={"email": "new@example.com", "pin": PIN, "otp_code": "000000"})
        assert res.status_code == 400
        vault_coll.update_one.assert_not_called()
