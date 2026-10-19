"""Pytest configuration and global test fixtures for TeleStore backend tests.

All environment secrets are set before any src module is imported, ensuring
tests run completely isolated without .env, database, or network access.
"""

import os
import sys
from pathlib import Path
from unittest.mock import MagicMock
import pytest

# 1. Set required secrets in environment BEFORE importing telestore.config
TEST_SESSION_SECRET = "dummy-session-key-for-tests-only-min-32-chars-long"
TEST_WORKER_SECRET = "dummy-worker-key-for-tests-only-min-24-chars-long"
TEST_ADMIN_PASSWORD = "dummy-admin-password-test-only"
TEST_ADMIN_USERNAME = "admin"
TEST_GITHUB_SECRET = "dummy-github-webhook-secret-for-tests"
TEST_CACHE_DIR = "/tmp/telestore_test_cache"

os.environ["SESSION_SECRET_KEY"] = TEST_SESSION_SECRET
os.environ["WORKER_SECRET_KEY"] = TEST_WORKER_SECRET
os.environ["DEFAULT_ADMIN_PASSWORD"] = TEST_ADMIN_PASSWORD
os.environ["DEFAULT_ADMIN_USERNAME"] = TEST_ADMIN_USERNAME
os.environ["GITHUB_WEBHOOK_SECRET"] = TEST_GITHUB_SECRET
os.environ["DATABASE_URL"] = "mongodb://dummy-host:27017/telestore_test"
os.environ["MEDIA_CACHE_DIR"] = TEST_CACHE_DIR
os.environ["OWNER"] = "123456789"

# Ensure repo root is on sys.path
repo_root = str(Path(__file__).parent.parent)
if repo_root not in sys.path:
    sys.path.insert(0, repo_root)

# 2. Mock MongoDB database object before route modules load
from telestore.db import database

mock_users = MagicMock()
mock_files = MagicMock()
mock_settings = MagicMock()
mock_movies = MagicMock()
mock_tgcodes = MagicMock()
mock_cloud_accounts = MagicMock()

# Default mock behavior
mock_users.getUser.return_value = None
mock_users.verify_user_credentials.return_value = False
mock_users.save_auth_token.return_value = True
mock_users.cleanup_expired_tokens.return_value = 0

database.Users = mock_users
database.Files = mock_files
database.Settings = mock_settings
database.Movies = mock_movies
database.Tgcodes = mock_tgcodes
database.CloudAccounts = mock_cloud_accounts
database.is_connected = True

# 3. Import FastAPI app after mocks are in place
from fastapi.testclient import TestClient  # noqa: E402
from telestore.api.app import app


@pytest.fixture(autouse=True)
def reset_db_mocks():
    """Reset database mock states between tests."""
    mock_users.reset_mock()
    mock_files.reset_mock()
    mock_settings.reset_mock()
    mock_movies.reset_mock()
    mock_tgcodes.reset_mock()
    mock_cloud_accounts.reset_mock()

    # Re-apply safe defaults
    mock_users.getUser.return_value = None
    mock_users.verify_user_credentials.return_value = False
    mock_users.save_auth_token.return_value = True
    mock_users.cleanup_expired_tokens.return_value = 0
    mock_files.create_default_folders.return_value = []
    mock_files.find_one.return_value = None

    yield


@pytest.fixture
def client():
    """Provide a FastAPI TestClient instance."""
    with TestClient(app, raise_server_exceptions=False) as test_client:
        yield test_client


@pytest.fixture
def test_secrets():
    """Provide reference to test dummy secret constants."""
    return {
        "session_secret": TEST_SESSION_SECRET,
        "worker_secret": TEST_WORKER_SECRET,
        "admin_password": TEST_ADMIN_PASSWORD,
        "admin_username": TEST_ADMIN_USERNAME,
        "github_secret": TEST_GITHUB_SECRET,
    }
