"""Tests for authentication routes, password verification, and legacy hash upgrades."""

import hashlib
from unittest.mock import MagicMock
from src.Database import database
from src.Database.Mongodb._users import Users
from src.Utils.passwords import hash_password, needs_rehash, verify_password


class TestPasswordHashing:
    """Test scrypt hashing and legacy SHA-256 verification/upgrade logic."""

    def test_scrypt_hash_and_verify(self):
        password = "correct-horse-battery-staple"
        hashed = hash_password(password)

        assert hashed.startswith("scrypt$15$8$1$")
        assert verify_password(password, hashed) is True
        assert verify_password("wrong-password", hashed) is False
        assert needs_rehash(hashed) is False

    def test_legacy_sha256_verification_and_needs_rehash(self):
        password = "my-legacy-secret-2024"
        legacy_hash = hashlib.sha256(password.encode("utf-8")).hexdigest()

        # Legacy hash must be exactly 64 hex characters
        assert len(legacy_hash) == 64
        # Legacy hash must verify against correct password
        assert verify_password(password, legacy_hash) is True
        # Wrong password must fail
        assert verify_password("wrong-password", legacy_hash) is False
        # Legacy hashes must trigger needs_rehash so callers can upgrade them
        assert needs_rehash(legacy_hash) is True

    def test_empty_or_malformed_password(self):
        assert verify_password("", "scrypt$15$8$1$abc$def") is False
        assert verify_password("password", "") is False
        assert verify_password("password", "invalid_format") is False
        assert needs_rehash("") is True
        assert needs_rehash("malformed$hash") is True

    def test_db_users_upgrades_legacy_hash_to_scrypt(self):
        """Users.verify_user_credentials must auto-upgrade legacy SHA-256 to scrypt on login."""
        users_repo = Users.__new__(Users)
        users_repo.update_one = MagicMock()

        password = "user_plain_secret"
        legacy_hash = hashlib.sha256(password.encode("utf-8")).hexdigest()

        # Mock getUser finding a user with a legacy SHA-256 hash
        users_repo.getUser = MagicMock(return_value={
            "username": "legacy_user",
            "password_hash": legacy_hash,
            "telegram_user_id": 98765,
        })

        # Correct password verifies and triggers update_one
        assert users_repo.verify_user_credentials("legacy_user", password) is True
        users_repo.update_one.assert_called_once()
        call_args = users_repo.update_one.call_args[0]
        assert call_args[0] == {"username": "legacy_user"}
        new_hash = call_args[1]["$set"]["password_hash"]
        assert new_hash.startswith("scrypt$")
        assert verify_password(password, new_hash) is True

    def test_db_users_does_not_upgrade_on_failed_login(self):
        """Users.verify_user_credentials must not upgrade if password does not match."""
        users_repo = Users.__new__(Users)
        users_repo.update_one = MagicMock()

        password = "user_plain_secret"
        legacy_hash = hashlib.sha256(password.encode("utf-8")).hexdigest()

        users_repo.getUser = MagicMock(return_value={
            "username": "legacy_user",
            "password_hash": legacy_hash,
        })

        assert users_repo.verify_user_credentials("legacy_user", "incorrect_password") is False
        users_repo.update_one.assert_not_called()


class TestAuthRoutes:
    """Test /auth/login endpoint for success and failure conditions."""

    def test_fallback_admin_login_success(self, client, test_secrets):
        """Default admin login with correct credentials succeeds and returns token."""
        response = client.post(
            "/auth/login",
            json={
                "username": test_secrets["admin_username"],
                "password": test_secrets["admin_password"],
            },
        )
        assert response.status_code == 200
        data = response.json()
        assert data["message"] == "Login successful"
        assert data["username"] == test_secrets["admin_username"]
        assert "auth_token" in data
        assert len(data["auth_token"]) > 20

    def test_login_failure_wrong_password(self, client, test_secrets):
        """Login with wrong password fails with 401."""
        response = client.post(
            "/auth/login",
            json={
                "username": test_secrets["admin_username"],
                "password": "wrong-password-attempt",
            },
        )
        assert response.status_code == 401
        assert response.json()["detail"] == "Incorrect username or password"

    def test_login_failure_unknown_user(self, client):
        """Login with non-existent user and wrong password fails with 401."""
        database.Users.getUser.return_value = None
        response = client.post(
            "/auth/login",
            json={
                "username": "non_existent_user",
                "password": "some_random_password",
            },
        )
        assert response.status_code == 401

    def test_database_user_login_success(self, client):
        """Database user with valid credentials succeeds."""
        database.Users.getUser.return_value = {
            "username": "testuser",
            "telegram_user_id": 123456,
        }
        database.Users.verify_user_credentials.return_value = True

        response = client.post(
            "/auth/login",
            json={
                "username": "testuser",
                "password": "valid_user_password",
            },
        )
        assert response.status_code == 200
        data = response.json()
        assert data["message"] == "Login successful"
        assert data["username"] == "testuser"
        database.Files.create_default_folders.assert_called_once_with("123456")
