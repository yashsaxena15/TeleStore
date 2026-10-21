"""Storage analytics: totals, categories and largest files.

The MongoDB aggregation is checked against the Python summary on a real server when
TEST_MONGO_URL is set (e.g. a throwaway `docker run -p 27099:27017 mongo:7`); otherwise only
the Python summary runs.
"""

import os
import random
from unittest.mock import patch

import pytest

from telestore.db.repositories.files import Files


def _items():
    return [
        {"_id": "a", "file_name": "movie.mkv", "file_type": "video", "file_size": 500, "file_path": "/Home", "owner_id": "o"},
        {"_id": "b", "file_name": "secret.mkv", "file_type": "video", "file_size": 900, "file_path": "/Vault", "is_vault": True, "owner_id": "o"},
        {"_id": "c", "file_name": "old.mkv", "file_type": "video", "file_size": 800, "file_path": "/Vault/Sub", "owner_id": "o"},
        {"_id": "d", "file_name": "Movies", "file_type": "folder", "file_size": 0, "file_path": "/Home", "owner_id": "o"},
        {"_id": "e", "file_name": "song.FLAC", "file_type": "document", "file_size": "40", "file_path": "/Home", "owner_id": "o", "starred": True},
        {"_id": "f", "file_name": "backup.tar.gz", "file_type": "document", "file_size": 70, "file_path": "/Home", "owner_id": "o"},
        {"_id": "g", "file_name": "deleted.pdf", "file_type": "document", "file_size": 30, "file_path": "/Home", "owner_id": "o", "trashed": True, "starred": True},
        {"_id": "h", "file_name": "README", "file_type": "document", "file_size": None, "file_path": "/Home", "owner_id": "o"},
        {"_id": "i", "file_name": "voice", "file_type": "voice", "file_size": 5, "file_path": "/Home", "owner_id": "o"},
        {"_id": "j", "file_name": "notes.bin", "file_type": "other", "file_size": 9, "file_path": "/Home", "owner_id": "o"},
        {"_id": "z", "file_name": "theirs.mkv", "file_type": "video", "file_size": 99999, "file_path": "/Home", "owner_id": "someone-else"},
    ]


def test_python_summary_hides_vault_files_and_counts_everything():
    stats = Files._summarize_storage([i for i in _items() if i["owner_id"] == "o"])
    assert [f["file_name"] for f in stats["largest_files"]] == ["movie.mkv", "backup.tar.gz", "song.FLAC", "notes.bin", "voice", "README"]
    assert stats["total_files"] == 8
    assert stats["total_folders"] == 1
    assert stats["trash_count"] == 1 and stats["trash_bytes"] == 30
    assert stats["starred_count"] == 1
    assert stats["by_category"]["audio"] == {"count": 2, "bytes": 45}
    assert stats["by_category"]["archive"] == {"count": 1, "bytes": 70}


def test_falls_back_to_python_when_aggregation_fails():
    files = Files.__new__(Files)
    with patch.object(Files, "aggregate", side_effect=RuntimeError("no aggregation"), create=True), \
            patch.object(Files, "find", lambda self, query: iter([i for i in _items() if i["owner_id"] == "o"])):
        stats = files.get_storage_analytics("o")
    assert stats["total_files"] == 8


@pytest.fixture
def mongo_files():
    url = os.getenv("TEST_MONGO_URL")
    if not url:
        pytest.skip("TEST_MONGO_URL not set")
    from pymongo import MongoClient
    client = MongoClient(url, serverSelectionTimeoutMS=3000)
    coll = client["telestore_storage_test"]["Files"]
    coll.drop()
    yield Files(coll)
    coll.drop()


def _comparable(stats):
    # Ties in size can come back in any order; compare the largest files as a set of (size, name)
    return {**stats, "largest_files": sorted((f["file_size"], f["file_name"]) for f in stats["largest_files"])}


def test_aggregation_matches_python_summary(mongo_files):
    mongo_files.insert_many(_items())
    expected = Files._summarize_storage([i for i in _items() if i["owner_id"] == "o"])
    assert _comparable(mongo_files.get_storage_analytics("o")) == _comparable(expected)


def test_aggregation_matches_on_random_data(mongo_files):
    rng = random.Random(7)
    types = ["video", "audio", "voice", "photo", "document", "folder", "other", None]
    exts = ["mkv", "mp3", "jpg", "pdf", "zip", "iso", "TXT", "weird", ""]
    docs = []
    for n in range(600):
        ext = rng.choice(exts)
        docs.append({
            "file_name": f"f{n}.{ext}" if ext else f"f{n}",
            "file_type": rng.choice(types),
            "file_size": rng.choice([rng.randint(0, 10**10), str(rng.randint(0, 999)), None]),
            "file_path": rng.choice(["/Home", "/Home/A", "/Vault", "/Vault/X", "/Vaultish"]),
            "trashed": rng.random() < 0.1,
            "starred": rng.random() < 0.1,
            "owner_id": "o",
        })
    mongo_files.insert_many([dict(d) for d in docs])
    expected = Files._summarize_storage(docs)
    got = mongo_files.get_storage_analytics("o")
    assert {k: v for k, v in got.items() if k != "largest_files"} == {k: v for k, v in expected.items() if k != "largest_files"}
    assert [f["file_size"] for f in got["largest_files"]] == [f["file_size"] for f in expected["largest_files"]]
