"""Archive routes (inspect, extract, compress) only touch the caller's own files, and vault
items only while the vault is unlocked."""

from unittest.mock import MagicMock, patch

import pytest
from bson import ObjectId

from telestore.api.app import app
from telestore.api.routes import archive as archive_routes
from telestore.db import database
from telestore.security.credentials import User, require_auth, require_upload

MINE = str(ObjectId())
THEIRS = str(ObjectId())
FOLDER = str(ObjectId())
SECRET = str(ObjectId())

DOCS = {
    MINE: {"_id": ObjectId(MINE), "file_name": "mine.zip", "file_path": "/Home", "owner_id": "111", "chat_id": 1, "message_id": 1, "file_size": 10},
    THEIRS: {"_id": ObjectId(THEIRS), "file_name": "theirs.zip", "file_path": "/Home", "owner_id": "222", "chat_id": 1, "message_id": 2, "file_size": 10},
    FOLDER: {"_id": ObjectId(FOLDER), "file_name": "Movies", "file_path": "/Home", "file_type": "folder", "owner_id": "111"},
    SECRET: {"_id": ObjectId(SECRET), "file_name": "s.zip", "file_path": "/Vault", "is_vault": True, "owner_id": "111", "chat_id": 1, "message_id": 3, "file_size": 10},
}


def _find_one(query):
    """Answers like Mongo for the queries the routes make: by _id or file_unique_id, with an owner filter."""
    for doc in DOCS.values():
        if "_id" in query and doc["_id"] != query["_id"]:
            continue
        if "file_unique_id" in query:
            continue
        owner = query.get("owner_id")
        if isinstance(owner, dict) and doc["owner_id"] not in owner["$in"]:
            continue
        if owner is None and "_id" not in query:
            continue
        return doc
    return None


@pytest.fixture
def as_user():
    user = User(username="me", telegram_user_id=111)
    app.dependency_overrides[require_auth] = lambda: user
    app.dependency_overrides[require_upload] = lambda: user
    database.Files.find_one.side_effect = _find_one
    database.Files.find.return_value = []
    app.state.bot_manager = MagicMock()
    yield user
    database.Files.find_one.side_effect = None
    app.dependency_overrides.pop(require_auth, None)
    app.dependency_overrides.pop(require_upload, None)


class TestArchiveOwnership:
    def test_someone_elses_archive_is_not_found(self, client, as_user):
        assert client.get(f"/archive/inspect/{THEIRS}").status_code == 404
        assert client.post("/archive/extract", json={"file_id": THEIRS, "target_path": "/Home"}).status_code == 404

    def test_file_names_no_longer_find_files(self, client, as_user):
        assert client.get("/archive/inspect/theirs.zip").status_code == 404

    def test_compress_refuses_other_peoples_files(self, client, as_user):
        with patch.object(archive_routes.archive_task_manager, "create_task") as create:
            res = client.post("/archive/compress", json={"item_ids": [MINE, THEIRS], "destination_path": "/Home", "zip_name": "x.zip"})
        assert res.status_code == 404
        create.assert_not_called()

    def test_vault_items_need_the_vault_open(self, client, as_user):
        with patch("telestore.api.routes.vault.is_vault_unlocked", return_value=False):
            assert client.get(f"/archive/inspect/{SECRET}").status_code == 403
            with patch.object(archive_routes.archive_task_manager, "create_task") as create:
                res = client.post("/archive/compress", json={"item_ids": [SECRET], "destination_path": "/Home", "zip_name": "x.zip"})
            assert res.status_code == 403
            create.assert_not_called()

    def test_compressing_a_folder_counts_and_packs_only_my_files(self, client, as_user):
        with patch.object(archive_routes, "check_disk_safety", return_value=(True, "", {})), \
             patch.object(archive_routes.archive_task_manager, "create_task", return_value="t1") as create:
            res = client.post("/archive/compress", json={"item_ids": [FOLDER, MINE], "destination_path": "/Home", "zip_name": "x.zip"})
        assert res.status_code == 200, res.text
        folder_query = database.Files.find.call_args[0][0]
        assert set(folder_query["owner_id"]["$in"]) == {"111", "me"}
        payload = create.call_args.kwargs["payload"]
        assert set(payload["owner_ids"]) == {"111", "me"}
        assert payload["item_ids"] == [FOLDER, MINE]


class TestCompressJob:
    def test_the_job_only_collects_the_owners_files(self):
        from telestore.services import cloud_archive
        database.Files.find_one.side_effect = _find_one
        database.Files.find.return_value = []
        try:
            payload = {"item_ids": [THEIRS], "owner_ids": ["111", "me"], "destination_path": "/Home", "zip_name": "x", "user_id": "111", "bot_manager": MagicMock()}
            import asyncio
            with pytest.raises(ValueError, match="No files found"):
                asyncio.run(cloud_archive.execute_task_compress("t1", payload, MagicMock()))
        finally:
            database.Files.find_one.side_effect = None
