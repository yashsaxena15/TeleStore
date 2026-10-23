"""Items in Trash can't be moved, and the starter folders are made only once."""

from unittest.mock import patch

import pytest
from bson import ObjectId

from telestore.api.app import app
from telestore.api.routes import auth as auth_routes
from telestore.db import database
from telestore.db.repositories.files import Files
from telestore.security.credentials import User, require_auth

FILE_ID = str(ObjectId())


@pytest.fixture
def as_user():
    app.dependency_overrides[require_auth] = lambda: User(username="bob", telegram_user_id=42)
    yield
    app.dependency_overrides.pop(require_auth, None)


class TestMove:
    def test_trashed_items_cant_move(self, client, as_user):
        database.Files.check_file_owner.return_value = True
        database.Files.find_one.return_value = {"_id": FILE_ID, "file_name": "a.txt", "file_path": "/Home", "trashed": True}
        res = client.post("/files/move", json={"file_id": FILE_ID, "target_path": "/Home/Old stuff"})
        assert res.status_code == 400 and "Restore it first" in res.json()["detail"]
        database.Files.update_one.assert_not_called()

    def test_nothing_moves_into_a_trashed_folder(self, client, as_user):
        database.Files.check_file_owner.return_value = True
        database.Files.find_one.return_value = {"_id": FILE_ID, "file_name": "a.txt", "file_path": "/Home"}
        database.Files.is_trashed_folder_path.return_value = True
        res = client.post("/files/move", json={"file_id": FILE_ID, "target_path": "/Home/Old stuff"})
        assert res.status_code == 400 and "in Trash" in res.json()["detail"]


class TestStarterFolders:
    def test_made_only_once(self):
        database.Files.create_default_folders.return_value = ["Images"]
        auth_routes._issue_token("bob", "local", {"telegram_user_id": 42})
        database.Files.create_default_folders.assert_called_once_with("42")
        database.Users.update_user_by_identifier.assert_called_with("bob", {"default_folders_created": True})

        database.Files.create_default_folders.reset_mock()
        auth_routes._issue_token("bob", "local", {"telegram_user_id": 42, "default_folders_created": True})
        database.Files.create_default_folders.assert_not_called()


def test_trashed_folder_path():
    repo = Files.__new__(Files)
    with patch.object(Files, "find_one", return_value={"_id": 1}) as find_one:
        assert repo.is_trashed_folder_path("/Home/Old stuff", "42")
        assert find_one.call_args.args[0]["file_name"] == "Old stuff" and find_one.call_args.args[0]["trashed"] is True
    assert not repo.is_trashed_folder_path("/Home")
