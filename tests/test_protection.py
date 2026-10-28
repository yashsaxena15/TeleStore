"""Protect from deletion, folder colours and photo details."""

import io
import re
from unittest.mock import patch

import pytest
from bson import ObjectId

from telestore.api.app import app
from telestore.db import database
from telestore.security.credentials import User, require_auth
from telestore.services import photo_info_service, protection_service


def _match(doc, flt):
    for key, want in flt.items():
        if key == "$or":
            if not any(_match(doc, f) for f in want):
                return False
            continue
        have = doc.get(key)
        if isinstance(want, dict):
            if "$in" in want and have not in want["$in"]:
                return False
            if "$ne" in want and have == want["$ne"]:
                return False
            if "$regex" in want and not (isinstance(have, str) and re.search(want["$regex"], have)):
                return False
        elif have != want:
            return False
    return True


class FakeFiles:
    def __init__(self):
        self.docs = []

    def add(self, name, path="/Home", kind="document", **extra):
        doc = {"_id": ObjectId(), "file_name": name, "file_path": path, "file_type": kind, "owner_id": "42", **extra}
        self.docs.append(doc)
        return doc

    def find(self, flt=None, *a, **k):
        return [d for d in self.docs if _match(d, flt or {})]

    def find_one(self, flt=None, *a, **k):
        found = self.find(flt)
        return found[0] if found else None

    def update_one(self, flt, update):
        doc = self.find_one(flt)
        if doc:
            doc.update(update.get("$set", {}))
            for key in update.get("$unset", {}):
                doc.pop(key, None)

    def check_file_owner(self, file_id, owner):
        return any(str(d["_id"]) == file_id and d["owner_id"] == owner for d in self.docs)

    def move_to_trash(self, file_id, owner):
        doc = self.find_one({"_id": ObjectId(file_id)})
        doc["trashed"] = True
        return True

    def delete_many(self, flt):
        self.docs = [d for d in self.docs if not _match(d, flt)]

    def unreferenced_messages(self, messages):
        return {}


@pytest.fixture
def files():
    fake = FakeFiles()
    protection_service._tokens.clear()
    with patch.object(database, "Files", fake):
        yield fake


@pytest.fixture
def bob(files):
    app.dependency_overrides[require_auth] = lambda: User(username="bob", telegram_user_id=42)
    with patch.object(database.Users, "get_password_hash", return_value="hash"), \
            patch.object(database.Users, "verify_current_password", side_effect=lambda u, p: p == "right-pass"):
        yield files
    app.dependency_overrides.pop(require_auth, None)


def unlock(client, password="right-pass"):
    return client.post("/files/protection/unlock", json={"password": password})


class TestWhatIsProtected:
    def test_the_item_a_folder_it_is_in_and_a_folder_holding_it(self, files):
        taxes = files.add("Taxes", kind="folder", protected=True)
        inside = files.add("2024.pdf", path="/Home/Taxes/Old")
        holder = files.add("Docs", kind="folder")
        files.add("passport.pdf", path="/Home/Docs", protected=True)
        loose = files.add("notes.txt")
        assert protection_service.blocker(taxes, ["42"]) == "Taxes"
        assert protection_service.blocker(inside, ["42"]) == "Taxes"
        assert protection_service.blocker(holder, ["42"]) == "passport.pdf"
        assert protection_service.blocker(loose, ["42"]) is None
        # A neighbour whose name merely starts the same isn't inside
        assert protection_service.blocker(files.add("x", path="/Home/Taxes2"), ["42"]) is None

    def test_a_trashed_item_remembers_where_it_was(self, files):
        files.add("Taxes", kind="folder", protected=True)
        doc = files.add("2024.pdf", path="/Trash", trashed=True, original_path="/Home/Taxes")
        assert protection_service.blocker(doc, ["42"]) == "Taxes"


class TestDeleting:
    def test_trash_needs_the_password_then_works(self, client, bob):
        doc = bob.add("passport.pdf", protected=True)
        res = client.post("/files/trash", json={"file_id": str(doc["_id"])})
        assert res.status_code == 423 and "passport.pdf" in res.json()["detail"]
        assert not doc.get("trashed")
        assert unlock(client, "nope").status_code == 400
        token = unlock(client).json()["unlock_token"]
        assert client.post("/files/trash", json={"file_id": str(doc["_id"]), "unlock_token": token}).status_code == 200
        assert doc["trashed"] is True

    def test_a_token_is_only_good_for_its_own_account(self, client, bob):
        doc = bob.add("passport.pdf", protected=True)
        other = protection_service.issue_token("eve")
        assert client.post("/files/trash", json={"file_id": str(doc["_id"]), "unlock_token": other}).status_code == 423

    def test_delete_forever_and_empty_trash(self, client, bob):
        doc = bob.add("passport.pdf", protected=True, trashed=True)
        assert client.post("/files/delete", json={"file_id": str(doc["_id"])}).status_code == 423
        assert client.post("/files/trash/empty").status_code == 423
        token = unlock(client).json()["unlock_token"]
        assert client.post("/files/trash/empty", json={"unlock_token": token}).status_code == 200
        assert bob.docs == []

    def test_unprotected_items_go_as_before(self, client, bob):
        doc = bob.add("notes.txt")
        assert client.post("/files/trash", json={"file_id": str(doc["_id"])}).status_code == 200

    def test_delete_forever_answers_404_not_500(self, client, bob):
        assert client.post("/files/delete", json={"file_id": str(ObjectId())}).status_code in (403, 404)


class TestProtecting:
    def test_on_is_free_off_needs_the_password(self, client, bob):
        doc = bob.add("notes.txt")
        assert client.post("/files/protect", json={"file_id": str(doc["_id"]), "protected": True}).json() == {"protected": True}
        assert doc["protected"] is True
        assert client.post("/files/protect", json={"file_id": str(doc["_id"]), "protected": False}).status_code == 423
        token = unlock(client).json()["unlock_token"]
        assert client.post("/files/protect", json={"file_id": str(doc["_id"]), "protected": False, "unlock_token": token}).status_code == 200
        assert "protected" not in doc

    def test_how_an_account_confirms(self, client, files):
        app.dependency_overrides[require_auth] = lambda: User(username="gina", telegram_user_id=42)
        try:
            with patch.object(database.Users, "get_password_hash", return_value=None), \
                    patch.object(database.Users, "getUser", return_value={"email": "gina@gmail.com"}):
                assert client.get("/files/protection").json() == {"method": "email", "email_hint": "g•••@gmail.com"}
            with patch.object(database.Users, "get_password_hash", return_value=None), \
                    patch.object(database.Users, "getUser", return_value={}):
                assert client.get("/files/protection").json()["method"] == "none"
        finally:
            app.dependency_overrides.pop(require_auth, None)

    def test_an_email_code_unlocks_too(self, client, files):
        app.dependency_overrides[require_auth] = lambda: User(username="gina", telegram_user_id=42)
        try:
            with patch.object(database.Users, "getUser", return_value={"email": "gina@gmail.com"}), \
                    patch("telestore.services.email_service.verify_vault_otp", side_effect=lambda e, u, c, p: c == "123456") as check:
                assert client.post("/files/protection/unlock", json={"code": "000000"}).status_code == 400
                assert "unlock_token" in client.post("/files/protection/unlock", json={"code": "123456"}).json()
            assert check.call_args.args[3] == protection_service.CODE_PURPOSE
        finally:
            app.dependency_overrides.pop(require_auth, None)


class TestColours:
    def test_folders_only_and_known_colours(self, client, bob):
        folder = bob.add("Taxes", kind="folder")
        file = bob.add("a.txt")
        assert client.post("/files/color", json={"file_id": str(folder["_id"]), "color": "red"}).json() == {"color": "red"}
        assert folder["color"] == "red"
        assert client.post("/files/color", json={"file_id": str(folder["_id"]), "color": None}).status_code == 200
        assert "color" not in folder
        assert client.post("/files/color", json={"file_id": str(folder["_id"]), "color": "pink"}).status_code == 400
        assert client.post("/files/color", json={"file_id": str(file["_id"]), "color": "red"}).status_code == 400


def test_webdav_cannot_delete_protected_items(files):
    from fastapi import HTTPException
    from telestore.api.routes.webdav.operations import _refuse_protected
    doc = files.add("passport.pdf", protected=True)
    with pytest.raises(HTTPException) as e:
        _refuse_protected(doc, "42")
    assert e.value.status_code == 403
    _refuse_protected(files.add("notes.txt"), "42")


class TestPhotoDetails:
    def _photo(self, gps=True):
        from PIL import Image
        img = Image.new("RGB", (400, 300), "white")
        exif = Image.Exif()
        exif[271], exif[272] = "Google", "Pixel 8"
        sub = exif.get_ifd(0x8769)
        sub[33434], sub[33437], sub[34855], sub[37386], sub[37385] = 1 / 120, 1.8, 100, 6.9, 0
        sub[36867], sub[42036] = "2024:05:01 14:03:22", "Pixel 8 back camera"
        if gps:
            g = exif.get_ifd(0x8825)
            g[1], g[2], g[3], g[4] = "N", (15.0, 33.0, 9.72), "E", (73.0, 45.0, 6.12)
        buf = io.BytesIO()
        img.save(buf, "JPEG", exif=exif)
        return buf.getvalue()

    def test_reads_camera_exposure_size_and_place(self):
        info = photo_info_service.extract(self._photo())
        assert (info["width"], info["height"], info["megapixels"], info["format"]) == (400, 300, 0.1, "JPEG")
        assert (info["camera_make"], info["camera_model"], info["lens"]) == ("Google", "Pixel 8", "Pixel 8 back camera")
        assert (info["aperture"], info["exposure"], info["iso"], info["focal_length"], info["flash"]) == (1.8, "1/120", 100, 6.9, False)
        assert info["taken_at"] == "2024-05-01T14:03:22"
        assert (info["latitude"], info["longitude"]) == (15.5527, 73.7517)

    def test_no_location_is_none(self):
        info = photo_info_service.extract(self._photo(gps=False))
        assert info["latitude"] is None and info["longitude"] is None

    @pytest.mark.parametrize("seconds, text", [(1 / 120, "1/120"), (2, "2"), (0.5, "1/2"), (0.8, "4/5"), (None, None)])
    def test_exposure_text(self, seconds, text):
        assert photo_info_service._exposure(seconds) == text

    def test_the_route_reads_once_and_keeps_it(self, client, bob):
        doc = bob.add("IMG_1.jpg", file_type="photo", file_size=1000)
        with patch("telestore.services.photo_info_service.read", return_value={"width": 4000, "height": 3000, "megapixels": 12.0, "taken_at": None}) as read, \
                patch("telestore.api.routes.media._get_internal_stream_url", return_value="http://x"), \
                patch("telestore.api.routes.media._caller_token", return_value="t"):
            first = client.get(f"/files/{doc['_id']}/photo-info").json()
            second = client.get(f"/files/{doc['_id']}/photo-info").json()
        assert first == second and first["megapixels"] == 12.0 and first["file_name"] == "IMG_1.jpg"
        assert read.call_count == 1

    def test_only_photos(self, client, bob):
        doc = bob.add("song.mp3", file_type="audio")
        assert client.get(f"/files/{doc['_id']}/photo-info").status_code == 422
