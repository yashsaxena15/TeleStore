"""Sharing, as in Google Drive: people (viewer / editor) and "Anyone with the link".

The Shares, Files and Users collections are small in-memory fakes; Telegram streaming is
replaced by a stub, so these check who may see and change what, not the bytes.
"""

import re
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from bson import ObjectId
from fastapi.responses import Response
from fastapi.testclient import TestClient

from telestore.api.app import app
from telestore.db import database
from telestore.security.credentials import User, require_auth
from telestore.services import share_service


# ── In-memory collections ───────────────────────────────────────────────────

def _get(doc, key):
    value = doc
    for part in key.split("."):
        if isinstance(value, list):
            return [v.get(part) for v in value if isinstance(v, dict)]
        if not isinstance(value, dict):
            return None
        value = value.get(part)
    return value


def _eq(have, want):
    if isinstance(have, list) and not isinstance(want, list):
        return want in have
    return have == want


def _match(doc, flt):
    for key, cond in flt.items():
        if key == "$or":
            if not any(_match(doc, f) for f in cond):
                return False
            continue
        have = _get(doc, key)
        if isinstance(cond, re.Pattern):
            if not (isinstance(have, str) and cond.search(have)):
                return False
        elif isinstance(cond, dict):
            if "$in" in cond and not any(_eq(have, w) for w in cond["$in"]):
                return False
            if "$ne" in cond and _eq(have, cond["$ne"]):
                return False
            if "$lt" in cond and not (have is not None and have < cond["$lt"]):
                return False
            if "$regex" in cond and not (isinstance(have, str) and re.search(cond["$regex"], have)):
                return False
            if "$exists" in cond and (have is not None) != cond["$exists"]:
                return False
        elif not _eq(have, cond):
            return False
    return True


def _set(doc, key, value):
    parts = key.split(".")
    for part in parts[:-1]:
        doc = doc.setdefault(part, {})
    doc[parts[-1]] = value


class Coll:
    def __init__(self):
        self.docs = []

    def find(self, flt=None, *a, **k):
        return [d for d in self.docs if _match(d, flt or {})]

    def find_one(self, flt=None, *a, **k):
        found = self.find(flt)
        return found[0] if found else None

    def insert_one(self, doc):
        doc.setdefault("_id", ObjectId())
        self.docs.append(doc)
        return MagicMock(inserted_id=doc["_id"])

    def update_one(self, flt, update, upsert=False):
        doc = self.find_one(flt)
        if not doc:
            return MagicMock(matched_count=0, modified_count=0)
        for key, value in update.get("$set", {}).items():
            _set(doc, key, value)
        for key, value in update.get("$inc", {}).items():
            _set(doc, key, (_get(doc, key) or 0) + value)
        for key in update.get("$unset", {}):
            doc.pop(key, None)
        return MagicMock(matched_count=1, modified_count=1)

    def delete_one(self, flt):
        doc = self.find_one(flt)
        if doc:
            self.docs.remove(doc)

    def delete_many(self, flt):
        self.docs = [d for d in self.docs if not _match(d, flt)]

    def create_index(self, *a, **k):
        pass


OWNER = User(username="owner", telegram_user_id=111, email="owner@example.com")
ALICE = User(username="alice", telegram_user_id=222, email="alice@example.com")
BOB = User(username="bob", telegram_user_id=333)


@pytest.fixture
def world():
    files, users, share_coll = Coll(), Coll(), Coll()
    for u in (OWNER, ALICE, BOB):
        users.insert_one({"username": u.username, "telegram_user_id": u.telegram_user_id, "email": u.email,
                          "telegram_first_name": u.username.capitalize()})

    def add(name, path="/Home", kind="document", owner="111", **extra):
        doc = {"file_name": name, "file_path": path, "file_type": kind, "owner_id": owner,
               "file_size": 10, "chat_id": -100, "message_id": 5, "file_unique_id": name, **extra}
        files.insert_one(doc)
        return doc

    trip = add("Trip", kind="folder")
    day1 = add("Day 1", "/Home/Trip", kind="folder")
    photo = add("beach.jpg", "/Home/Trip/Day 1", kind="photo", thumbnail="thumb-beach")
    notes = add("notes.txt", "/Home/Trip")
    outside = add("tax.pdf", "/Home")
    secret = add("pin.txt", "/Vault", is_vault=True)
    world = MagicMock(files=files, users=users, shares=share_coll, trip=trip, day1=day1, photo=photo,
                      notes=notes, outside=outside, secret=secret, add=add)
    world.as_user = {"user": OWNER}
    app.dependency_overrides[require_auth] = lambda: world.as_user["user"]
    with patch.object(database, "Files", files), patch.object(database, "Users", users), \
            patch.object(share_service, "_coll", lambda: share_coll), \
            patch("telestore.api.routes.shares.event_service.record") as record:
        world.record = record
        world.client = TestClient(app)  # no startup: nothing here needs Telegram
        yield world
    app.dependency_overrides.pop(require_auth, None)


def _as(world, user):
    world.as_user["user"] = user


def _link(world, item, **settings):
    r = world.client.put(f"/shares/item/{item['_id']}/link", json={"enabled": True, **settings})
    assert r.status_code == 200, r.text
    return r.json()["link"]["token"]


@pytest.fixture
def streamed():
    """Telegram streaming replaced by a stub that says which file it would send."""
    async def fake(request, doc, name="file"):
        return Response(content=doc["file_name"].encode(), headers={"X-Inline": str(request.state.is_watch)})
    with patch("telestore.api.routes.stream.stream_document", side_effect=fake) as stub:
        yield stub


# ── The Share dialog ───────────────────────────────────────────────────────

class TestDialog:
    def test_new_item_has_no_link_and_nobody(self, world):
        r = world.client.get(f"/shares/item/{world.trip['_id']}")
        assert r.status_code == 200
        assert r.json()["link"] is None and r.json()["members"] == []

    def test_only_the_owner_manages_sharing(self, world):
        _as(world, ALICE)
        assert world.client.get(f"/shares/item/{world.trip['_id']}").status_code == 404
        assert world.client.put(f"/shares/item/{world.trip['_id']}/link", json={"enabled": True}).status_code == 404

    def test_vault_and_trash_items_cant_be_shared(self, world):
        assert world.client.put(f"/shares/item/{world.secret['_id']}/link", json={"enabled": True}).status_code == 400
        world.notes["trashed"] = True
        assert world.client.put(f"/shares/item/{world.notes['_id']}/link", json={"enabled": True}).status_code == 400

    def test_add_people_by_username_or_email(self, world):
        r = world.client.post(f"/shares/item/{world.trip['_id']}/members", json={"who": "ALICE@example.com", "role": "editor"})
        assert r.status_code == 200
        r = world.client.post(f"/shares/item/{world.trip['_id']}/members", json={"who": "bob"})
        people = {m["username"]: m["role"] for m in r.json()["members"]}
        assert people == {"alice": "editor", "bob": "viewer"}
        # Each new person gets one notification
        assert world.record.call_count == 2
        assert world.record.call_args_list[0].args[0] == "222"

    def test_unknown_person_and_yourself_are_refused(self, world):
        assert world.client.post(f"/shares/item/{world.trip['_id']}/members", json={"who": "nobody"}).status_code == 404
        assert world.client.post(f"/shares/item/{world.trip['_id']}/members", json={"who": "owner"}).status_code == 400
        assert world.client.post(f"/shares/item/{world.trip['_id']}/members", json={"who": "bob", "role": "admin"}).status_code == 400

    def test_change_role_and_remove(self, world):
        world.client.post(f"/shares/item/{world.trip['_id']}/members", json={"who": "bob"})
        r = world.client.patch(f"/shares/item/{world.trip['_id']}/members/333", json={"role": "editor"})
        assert r.json()["members"][0]["role"] == "editor"
        r = world.client.delete(f"/shares/item/{world.trip['_id']}/members/333")
        assert r.json()["members"] == []
        # Nobody and no link left: the share itself is gone
        assert world.shares.docs == []

    def test_shared_mark(self, world):
        world.client.post(f"/shares/item/{world.trip['_id']}/members", json={"who": "bob"})
        assert share_service.shared_ids([str(world.trip["_id"]), str(world.notes["_id"])]) == {str(world.trip["_id"])}


# ── Anyone with the link ───────────────────────────────────────────────────

class TestLink:
    def test_folder_link_works_without_signing_in(self, world):
        token = _link(world, world.trip)
        app.dependency_overrides.pop(require_auth, None)
        r = world.client.get(f"/share-links/{token}/info")
        assert r.status_code == 200
        assert r.json()["item"]["name"] == "Trip" and r.json()["owner_name"] == "Owner"
        assert r.headers["X-Robots-Tag"].startswith("noindex")
        names = [i["name"] for i in world.client.get(f"/share-links/{token}/list").json()["items"]]
        assert names == ["Day 1", "notes.txt"]  # folders first
        inner = world.client.get(f"/share-links/{token}/list", params={"path": "/Day 1"}).json()
        assert [i["name"] for i in inner["items"]] == ["beach.jpg"] and inner["path"] == "/Day 1"

    def test_link_never_reaches_outside_the_folder(self, world, streamed):
        token = _link(world, world.trip)
        assert world.client.get(f"/share-links/{token}/list", params={"path": "/../"}).status_code == 404
        assert world.client.get(f"/share-links/{token}/list", params={"path": "/Nope"}).status_code == 404
        assert world.client.get(f"/share-links/{token}/dl/{world.outside['_id']}").status_code == 404
        assert world.client.get(f"/share-links/{token}/dl/{world.secret['_id']}").status_code == 404
        assert world.client.get(f"/share-links/{token}/dl/{world.photo['_id']}").status_code == 200

    def test_file_link_opens_only_that_file(self, world, streamed):
        token = _link(world, world.notes)
        assert world.client.get(f"/share-links/{token}/dl/{world.notes['_id']}").content == b"notes.txt"
        assert world.client.get(f"/share-links/{token}/dl/{world.photo['_id']}").status_code == 404

    def test_turned_off_link_stops(self, world):
        token = _link(world, world.trip)
        world.client.put(f"/shares/item/{world.trip['_id']}/link", json={"enabled": False})
        r = world.client.get(f"/share-links/{token}/info")
        assert r.status_code == 410 and "turned off" in r.json()["detail"]

    def test_expired_link_stops(self, world):
        token = _link(world, world.trip, expires_at=(datetime.now(timezone.utc) + timedelta(hours=1)).isoformat())
        assert world.client.get(f"/share-links/{token}/info").status_code == 200
        world.shares.docs[0]["link"]["expires_at"] = datetime.now(timezone.utc) - timedelta(seconds=1)
        r = world.client.get(f"/share-links/{token}/info")
        assert r.status_code == 410 and "expired" in r.json()["detail"]
        # An expiry in the past can't be set
        assert world.client.put(f"/shares/item/{world.trip['_id']}/link",
                                json={"enabled": True, "expires_at": "2020-01-01T00:00:00Z"}).status_code == 400

    def test_download_limit(self, world, streamed):
        token = _link(world, world.notes, max_downloads=2)
        url = f"/share-links/{token}/dl/{world.notes['_id']}"
        assert world.client.get(url).status_code == 200
        # Viewing in the page and later chunks of the same download don't count
        assert world.client.get(url, params={"inline": 1}).status_code == 200
        assert world.client.get(url, headers={"Range": "bytes=500-"}).status_code == 200
        assert world.client.get(url).status_code == 200
        r = world.client.get(f"/share-links/{token}/info")
        assert r.status_code == 410 and "download limit" in r.json()["detail"]

    def test_limit_is_checked_at_the_moment_of_counting(self, world):
        _link(world, world.notes, max_downloads=1)
        share = world.shares.docs[0]
        share_service.count_download(share)
        # A second download that passed the first check at the same time is still refused
        with pytest.raises(share_service.ShareError):
            share_service.count_download(share)

    def test_downloads_off_still_allows_viewing(self, world, streamed):
        token = _link(world, world.trip, allow_download=False)
        url = f"/share-links/{token}/dl/{world.notes['_id']}"
        assert world.client.get(url).status_code == 403
        r = world.client.get(url, params={"inline": 1})
        assert r.status_code == 200 and r.headers["X-Inline"] == "True"
        assert world.client.get(f"/share-links/{token}/zip-info").status_code == 403
        assert world.client.get(f"/share-links/{token}/info").json()["allow_download"] is False

    def test_reset_gives_a_new_address(self, world):
        old = _link(world, world.trip)
        new = world.client.post(f"/shares/item/{world.trip['_id']}/link/reset").json()["link"]["token"]
        assert new != old
        assert world.client.get(f"/share-links/{old}/info").status_code == 404
        assert world.client.get(f"/share-links/{new}/info").status_code == 200

    def test_link_follows_a_moved_folder(self, world):
        token = _link(world, world.trip)
        world.trip["file_path"] = "/Home/Archive"
        for doc in (world.day1, world.notes):
            doc["file_path"] = doc["file_path"].replace("/Home/Trip", "/Home/Archive/Trip")
        world.photo["file_path"] = "/Home/Archive/Trip/Day 1"
        assert [i["name"] for i in world.client.get(f"/share-links/{token}/list").json()["items"]] == ["Day 1", "notes.txt"]

    def test_item_in_trash_or_vault_is_unavailable(self, world):
        token = _link(world, world.trip)
        world.trip["trashed"] = True
        assert world.client.get(f"/share-links/{token}/info").status_code == 410
        world.trip["trashed"] = False
        world.trip["is_vault"] = True
        assert world.client.get(f"/share-links/{token}/info").status_code == 410

    def test_trashed_files_inside_are_hidden(self, world):
        token = _link(world, world.trip)
        world.notes["trashed"] = True
        assert [i["name"] for i in world.client.get(f"/share-links/{token}/list").json()["items"]] == ["Day 1"]

    def test_guessing_addresses_is_slowed_down(self, world):
        # 20 free tries; the 21st wrong address starts a wait
        for _ in range(21):
            assert world.client.get("/share-links/guess/info").status_code == 404
        r = world.client.get("/share-links/guess/info")
        assert r.status_code == 429 and "Retry-After" in r.headers

    def test_zip_parts_of_a_shared_folder(self, world):
        token = _link(world, world.trip)
        info = world.client.get(f"/share-links/{token}/zip-info").json()
        assert info["total_files"] == 2 and info["parts"][0]["name"] == "Trip.zip"
        assert info["parts"][0]["download_url"].startswith(f"/share-links/{token}/zip?")


# ── People ─────────────────────────────────────────────────────────────────

def _share_with(world, who, role):
    world.client.post(f"/shares/item/{world.trip['_id']}/members", json={"who": who, "role": role})
    return world.shares.docs[0]["share_id"]


class TestPeople:
    def test_shared_with_me_and_by_me(self, world):
        share_id = _share_with(world, "alice", "viewer")
        mine = world.client.get("/shares/mine").json()["shares"]
        assert [s["item"]["name"] for s in mine] == ["Trip"] and mine[0]["members"] == 1
        _as(world, ALICE)
        mine_alice = world.client.get("/shares/with-me").json()["shares"]
        assert mine_alice[0]["share_id"] == share_id and mine_alice[0]["owner"]["name"] == "Owner"
        _as(world, BOB)
        assert world.client.get("/shares/with-me").json()["shares"] == []

    def test_viewer_browses_and_opens(self, world, streamed):
        share_id = _share_with(world, "alice", "viewer")
        _as(world, ALICE)
        r = world.client.get(f"/shares/{share_id}/browse", params={"path": "/Day 1"})
        assert r.status_code == 200 and r.json()["role"] == "viewer"
        assert [i["name"] for i in r.json()["items"]] == ["beach.jpg"]
        assert world.client.get(f"/shares/{share_id}/dl/{world.photo['_id']}").status_code == 200
        assert world.client.get(f"/shares/{share_id}/dl/{world.outside['_id']}").status_code == 404

    def test_others_cant_open_the_share(self, world):
        share_id = _share_with(world, "alice", "viewer")
        _as(world, BOB)
        assert world.client.get(f"/shares/{share_id}/browse").status_code == 404

    def test_viewer_cant_change_anything(self, world):
        share_id = _share_with(world, "alice", "viewer")
        _as(world, ALICE)
        r = world.client.post(f"/shares/{share_id}/rename", json={"file_id": str(world.notes["_id"]), "new_name": "x.txt"})
        assert r.status_code == 403
        assert world.client.post(f"/shares/{share_id}/trash", json={"file_id": str(world.notes["_id"])}).status_code == 403

    def test_editor_changes_run_as_the_owner(self, world):
        share_id = _share_with(world, "alice", "editor")
        _as(world, ALICE)
        with patch("telestore.api.routes.files.manage.rename_file_route", new=AsyncMock(return_value={"ok": 1})) as rename, \
                patch("telestore.api.routes.files.manage.move_file_route", new=AsyncMock(return_value={"ok": 1})) as move, \
                patch("telestore.api.routes.files.manage.trash_file_route", new=AsyncMock(return_value={"ok": 1})) as trash:
            assert world.client.post(f"/shares/{share_id}/rename", json={"file_id": str(world.notes["_id"]), "new_name": "n.txt"}).status_code == 200
            assert rename.call_args.kwargs["user"].username == "owner"
            r = world.client.post(f"/shares/{share_id}/move", json={"file_id": str(world.notes["_id"]), "target_path": "/Day 1"})
            assert r.status_code == 200 and move.call_args.args[0].target_path == "/Home/Trip/Day 1"
            assert world.client.post(f"/shares/{share_id}/trash", json={"file_id": str(world.notes["_id"])}).status_code == 200
            assert trash.call_args.kwargs["user"].telegram_user_id == 111

    def test_editor_stays_inside_the_folder(self, world):
        share_id = _share_with(world, "alice", "editor")
        _as(world, ALICE)
        assert world.client.post(f"/shares/{share_id}/trash", json={"file_id": str(world.outside["_id"])}).status_code == 404
        assert world.client.post(f"/shares/{share_id}/trash", json={"file_id": str(world.trip["_id"])}).status_code == 400
        assert world.client.post(f"/shares/{share_id}/move", json={"file_id": str(world.notes["_id"]), "target_path": "/../.."}).status_code == 404
        r = world.client.post(f"/shares/{share_id}/move", json={"file_id": str(world.day1["_id"]), "target_path": "/Day 1"})
        assert r.status_code == 400 and "into itself" in r.json()["detail"]

    def test_editor_uploads_belong_to_the_owner(self, world):
        from telestore.api.routes.shares import upload_target
        share_id = _share_with(world, "alice", "editor")
        owner, path = upload_target(share_id, "/Day 1", ALICE)
        assert owner.telegram_user_id == 111 and path == "/Home/Trip/Day 1"
        _share_with(world, "bob", "viewer")
        with pytest.raises(Exception):
            upload_target(share_id, "", BOB)

    def test_upload_init_into_a_shared_folder(self, world):
        from telestore.api.routes.files import chunked_upload
        from telestore.security.credentials import require_upload
        share_id = _share_with(world, "alice", "editor")
        app.dependency_overrides[require_upload] = lambda: ALICE
        try:
            r = world.client.post("/files/upload/init", json={"filename": "new.jpg", "filesize": 100, "path": "/Day 1", "share_id": share_id})
        finally:
            app.dependency_overrides.pop(require_upload, None)
        assert r.status_code == 200, r.text
        session = chunked_upload._active_upload_sessions.pop(r.json()["upload_id"])
        assert session["user_id"] == "111" and session["uploader"] == "222" and session["path"] == "/Home/Trip/Day 1"


# ── Thumbnails of other accounts' files ────────────────────────────────────

def test_thumbnail_only_of_your_own_files(world):
    with patch("telestore.api.routes.files.browse.require_auth", return_value=ALICE):
        assert world.client.get("/files/thumbnail/thumb-beach").status_code == 404
    from telestore.api.routes.files.browse import _owns_thumbnail
    with patch("telestore.api.routes.files.browse.require_auth", return_value=OWNER):
        assert _owns_thumbnail(MagicMock(), "thumb-beach", None)
