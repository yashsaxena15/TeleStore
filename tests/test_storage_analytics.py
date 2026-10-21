"""Storage analytics must not list Private Vault files by name."""

from unittest.mock import patch

from telestore.db.repositories.files import Files


def _analytics(items):
    files = Files.__new__(Files)
    with patch.object(Files, "find", lambda self, query: iter(items)):
        return files.get_storage_analytics("owner")


def test_vault_files_count_but_are_not_listed():
    items = [
        {"_id": "a", "file_name": "movie.mkv", "file_type": "video", "file_size": 500, "file_path": "/Home"},
        {"_id": "b", "file_name": "secret.mkv", "file_type": "video", "file_size": 900, "file_path": "/Vault", "is_vault": True},
        {"_id": "c", "file_name": "old.mkv", "file_type": "video", "file_size": 800, "file_path": "/Vault/Sub"},
    ]
    stats = _analytics(items)
    names = [f["file_name"] for f in stats["largest_files"]]
    assert names == ["movie.mkv"]
    assert stats["total_bytes"] == 2200
    assert stats["total_files"] == 3
