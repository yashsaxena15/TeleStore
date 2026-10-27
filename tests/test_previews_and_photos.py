"""Previews for photos/videos without a Telegram thumbnail, and the backup-folder Photos filter."""

import asyncio
import io
import os
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from bson import ObjectId
from PIL import Image

from telestore.api.app import app
from telestore.db import database
from telestore.db.repositories.files import Files
from telestore.security.credentials import User, require_auth
from telestore.services import preview_service


@pytest.fixture
def preview_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(preview_service, "PREVIEW_DIR", str(tmp_path))
    return tmp_path


def _image_bytes(fmt: str, size=(2000, 1000), exif_rotate=False) -> bytes:
    img = Image.new("RGB", size, (200, 30, 30))
    buf = io.BytesIO()
    if exif_rotate:
        exif = Image.Exif()
        exif[0x0112] = 6  # stored sideways: viewers turn it 90°
        img.save(buf, fmt, exif=exif)
    else:
        img.save(buf, fmt)
    return buf.getvalue()


def _serve(data: bytes):
    resp = MagicMock(status_code=200)
    resp.raw.read.return_value = data
    resp.__enter__ = lambda s: s
    resp.__exit__ = lambda *a: False
    return patch.object(preview_service.requests, "get", return_value=resp)


class TestKinds:
    @pytest.mark.parametrize("doc, kind", [
        ({"file_name": "IMG_1.HEIC", "file_type": "document"}, "image"),
        ({"file_name": "big.jpg", "file_type": "document"}, "image"),
        ({"file_name": "x", "file_type": "photo"}, "image"),
        ({"file_name": "movie.mkv", "file_type": "document"}, "video"),
        ({"file_name": "notes.pdf", "file_type": "document"}, None),
    ])
    def test_kind(self, doc, kind):
        assert preview_service.preview_kind(doc) == kind


class TestImagePreviews:
    @pytest.mark.parametrize("fmt", ["JPEG", "PNG"])
    def test_makes_a_small_jpeg(self, preview_dir, fmt):
        doc = {"_id": ObjectId(), "file_name": f"a.{fmt.lower()}", "file_type": "document"}
        with _serve(_image_bytes(fmt)):
            path = asyncio.run(preview_service.make_preview(doc, "http://internal/dl"))
        with Image.open(path) as out:
            assert out.format == "JPEG" and max(out.size) == preview_service.PREVIEW_SIZE

    def test_turns_sideways_phone_photos_upright(self, preview_dir):
        doc = {"_id": ObjectId(), "file_name": "p.jpg", "file_type": "document"}
        with _serve(_image_bytes("JPEG", size=(2000, 1000), exif_rotate=True)):
            path = asyncio.run(preview_service.make_preview(doc, "u"))
        with Image.open(path) as out:
            assert out.size[1] > out.size[0]  # portrait after the EXIF turn

    def test_heic(self, preview_dir):
        pillow_heif = pytest.importorskip("pillow_heif")
        pillow_heif.register_heif_opener()
        buf = io.BytesIO()
        try:
            Image.new("RGB", (1200, 900), (10, 120, 200)).save(buf, "HEIF")
        except Exception as e:  # no HEIF encoder in this build: decoding is what matters
            pytest.skip(f"can't write a HEIC sample here: {e}")
        doc = {"_id": ObjectId(), "file_name": "IMG_0001.HEIC", "file_type": "document"}
        with _serve(buf.getvalue()):
            path = asyncio.run(preview_service.make_preview(doc, "u"))
        with Image.open(path) as out:
            assert out.format == "JPEG"

    def test_made_once_then_kept(self, preview_dir):
        doc = {"_id": ObjectId(), "file_name": "a.jpg", "file_type": "photo"}
        with _serve(_image_bytes("JPEG")) as get:
            asyncio.run(preview_service.make_preview(doc, "u"))
            asyncio.run(preview_service.make_preview(doc, "u"))
        assert get.call_count == 1

    def test_unreadable_file_is_remembered_for_a_day(self, preview_dir):
        doc = {"_id": ObjectId(), "file_name": "broken.jpg", "file_type": "photo"}
        with _serve(b"not an image") as get:
            assert asyncio.run(preview_service.make_preview(doc, "u")) is None
            assert asyncio.run(preview_service.make_preview(doc, "u")) is None
        assert get.call_count == 1

    def test_too_big_is_skipped(self, preview_dir, monkeypatch):
        monkeypatch.setattr(preview_service, "MAX_IMAGE_BYTES", 10)
        doc = {"_id": ObjectId(), "file_name": "a.jpg", "file_type": "photo"}
        with _serve(_image_bytes("JPEG")):
            assert asyncio.run(preview_service.make_preview(doc, "u")) is None

    def test_documents_get_nothing(self, preview_dir):
        doc = {"_id": ObjectId(), "file_name": "a.pdf", "file_type": "document"}
        assert asyncio.run(preview_service.make_preview(doc, "u")) is None


class TestPreviewRoute:
    @pytest.fixture(autouse=True)
    def signed_in(self):
        app.dependency_overrides[require_auth] = lambda: User(username="bob", telegram_user_id=42)
        yield
        app.dependency_overrides.pop(require_auth, None)

    def test_someone_elses_file_is_not_found(self, client):
        database.Files.find_one.return_value = None
        assert client.get(f"/files/preview/{ObjectId()}").status_code == 404
        query = database.Files.find_one.call_args.args[0]
        assert set(query["owner_id"]["$in"]) == {"bob", "42"}

    def test_locked_vault_is_refused(self, client):
        database.Files.find_one.return_value = {"_id": ObjectId(), "file_name": "a.jpg", "is_vault": True}
        with patch("telestore.api.routes.vault.is_vault_unlocked", return_value=False):
            assert client.get(f"/files/preview/{ObjectId()}").status_code == 403

    def test_serves_the_preview(self, client, tmp_path):
        oid = ObjectId()
        jpg = tmp_path / "p.jpg"
        jpg.write_bytes(_image_bytes("JPEG", size=(10, 10)))
        database.Files.find_one.return_value = {"_id": oid, "file_name": "IMG.HEIC", "file_type": "document"}
        with patch("telestore.services.preview_service.make_preview", AsyncMock(return_value=str(jpg))) as make:
            res = client.get(f"/files/preview/{oid}")
        assert res.status_code == 200 and res.headers["content-type"] == "image/jpeg"
        assert "file_id=" + str(oid) in make.call_args.args[1]  # the original, read as this user

    def test_bad_id(self, client):
        assert client.get("/files/preview/nope").status_code == 404


def test_photos_only_inside_the_backup_folder():
    repo = Files.__new__(Files)
    with patch.object(Files, "find", return_value=[]) as find:
        repo.get_files_by_path(path="all", owner_id="42", kind="media", under="/Home/Phone Backup/")
    query = find.call_args.args[0]
    assert query["file_path"] == {"$regex": r"^/Home/Phone\ Backup(/|$)"}
    assert query["owner_id"] == "42" and "$or" in query  # still photos and videos only


def test_under_outside_home_is_ignored():
    repo = Files.__new__(Files)
    with patch.object(Files, "find", return_value=[]) as find:
        repo.get_files_by_path(path="all", owner_id="42", kind="media", under="/Vault")
    assert find.call_args.args[0]["file_path"] == {"$not": {"$regex": "^/?Vault"}}


def test_preview_dir_lives_in_the_mounted_cache():
    assert os.path.join("cache", "previews") in preview_service.PREVIEW_DIR
