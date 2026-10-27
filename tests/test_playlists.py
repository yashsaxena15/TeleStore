"""Playlists: the undeletable Liked music, the user's own playlists, and the API."""

import itertools
from unittest.mock import patch

import pytest
from bson import ObjectId

from telestore.api.app import app
from telestore.security.credentials import User, require_auth
from telestore.services.playlist_service import LIKED, PlaylistError, Playlists


class FakeCollection:
    """Just enough of a Mongo collection: equality and $in filters, insert, $set, delete."""

    def __init__(self, docs=()):
        self.docs = [dict(d) for d in docs]
        self._ids = itertools.count()

    @staticmethod
    def _match(doc, flt):
        for key, want in flt.items():
            have = doc.get(key)
            if isinstance(want, dict) and "$in" in want:
                if have not in want["$in"]:
                    return False
            elif have != want:
                return False
        return True

    def find(self, flt=None):
        return [dict(d) for d in self.docs if self._match(d, flt or {})]

    def find_one(self, flt=None):
        found = self.find(flt)
        return found[0] if found else None

    def insert_one(self, doc):
        doc.setdefault("_id", ObjectId())
        self.docs.append(dict(doc))
        return type("Result", (), {"inserted_id": doc["_id"]})()

    def update_one(self, flt, update):
        for d in self.docs:
            if self._match(d, flt):
                d.update(update["$set"])
                return

    def delete_one(self, flt):
        self.docs = [d for d in self.docs if not self._match(d, flt)]


def song(name, owner="42", **extra):
    return {"_id": ObjectId(), "file_name": name, "file_type": "document", "owner_id": owner, "file_path": "/Home/Music", **extra}


@pytest.fixture
def library():
    files = FakeCollection([
        song("a.mp3"), song("b.flac"), song("clip.mkv"), song("notes.pdf"),
        song("gone.mp3", trashed=True), song("secret.mp3", is_vault=True), song("theirs.mp3", owner="99"),
    ])
    ids = {d["file_name"]: str(d["_id"]) for d in files.docs}
    return Playlists(FakeCollection(), files, "42", ["bob", "42"]), ids


class TestLikedMusic:
    def test_always_there_first(self, library):
        pl, _ = library
        pl.create("Road trip")
        lists = pl.list()
        assert [p["name"] for p in lists] == ["Liked music", "Road trip"]
        assert lists[0]["id"] == LIKED and lists[0]["kind"] == LIKED
        assert len(pl.list()) == 2  # made once

    def test_cannot_be_deleted_or_renamed(self, library):
        pl, _ = library
        with pytest.raises(PlaylistError, match="can't be deleted"):
            pl.delete(LIKED)
        with pytest.raises(PlaylistError, match="can't be renamed"):
            pl.rename(LIKED, "Mine")
        with pytest.raises(PlaylistError) as e:
            pl.create("liked MUSIC")
        assert e.value.status == 409

    def test_heart_toggles_newest_first(self, library):
        pl, ids = library
        assert pl.toggle_like(ids["a.mp3"]) is True
        assert pl.toggle_like(ids["b.flac"]) is True
        assert [f["file_name"] for f in pl.get(LIKED)["items"]] == ["b.flac", "a.mp3"]
        assert pl.toggle_like(ids["a.mp3"]) is False
        assert pl.toggle_like(ids["b.flac"], liked=True) is True  # explicit: stays liked
        assert pl.get(LIKED)["file_ids"] == [ids["b.flac"]]

    def test_only_own_music_and_videos(self, library):
        pl, ids = library
        for name in ("notes.pdf", "theirs.mp3", "secret.mp3"):
            with pytest.raises(PlaylistError):
                pl.toggle_like(ids[name])


class TestOwnPlaylists:
    def test_create_add_reorder_remove(self, library):
        pl, ids = library
        made = pl.create("  Road   trip ", [ids["a.mp3"], ids["clip.mkv"]])
        assert made["name"] == "Road trip" and made["count"] == 2 and made["added"] == 2
        again = pl.add(made["id"], [ids["a.mp3"], ids["b.flac"], ids["notes.pdf"]])
        assert again["added"] == 1 and again["count"] == 3  # no duplicates, no documents
        pl.reorder(made["id"], [ids["b.flac"], ids["a.mp3"], ids["clip.mkv"]])
        pl.remove(made["id"], [ids["a.mp3"]])
        assert [f["file_name"] for f in pl.get(made["id"])["items"]] == ["b.flac", "clip.mkv"]

    def test_reorder_must_match(self, library):
        pl, ids = library
        made = pl.create("Mix", [ids["a.mp3"], ids["b.flac"]])
        with pytest.raises(PlaylistError) as e:
            pl.reorder(made["id"], [ids["a.mp3"]])
        assert e.value.status == 409

    def test_trashed_files_are_left_out_but_kept(self, library):
        pl, ids = library
        made = pl.create("Mix", [ids["a.mp3"]])
        pl.playlists.update_one({"_id": ObjectId(made["id"])}, {"$set": {"items": [ids["a.mp3"], ids["gone.mp3"]]}})
        got = pl.get(made["id"])
        assert [f["file_name"] for f in got["items"]] == ["a.mp3"] and got["count"] == 2

    def test_names(self, library):
        pl, _ = library
        made = pl.create("Mix")
        with pytest.raises(PlaylistError):
            pl.create("mix")
        with pytest.raises(PlaylistError):
            pl.create("   ")
        assert pl.rename(made["id"], "Gym")["name"] == "Gym"
        pl.delete(made["id"])
        assert [p["name"] for p in pl.list()] == ["Liked music"]

    def test_someone_elses_playlist_is_not_found(self, library):
        pl, _ = library
        made = pl.create("Mix")
        other = Playlists(pl.playlists, pl.files, "99", ["99"])
        for action in (lambda: other.get(made["id"]), lambda: other.delete(made["id"]), lambda: other.get("nope")):
            with pytest.raises(PlaylistError) as e:
                action()
            assert e.value.status == 404

    def test_cover_is_the_first_playable_item(self, library):
        pl, ids = library
        made = pl.create("Mix", [ids["clip.mkv"], ids["a.mp3"]])
        assert pl.list()[1]["cover"]["id"] == ids["clip.mkv"] and made["cover"]["file_name"] == "clip.mkv"


class TestApi:
    @pytest.fixture(autouse=True)
    def signed_in(self, library):
        pl, ids = library
        app.dependency_overrides[require_auth] = lambda: User(username="bob", telegram_user_id=42)
        with patch("telestore.api.routes.playlists.playlists_collection", return_value=pl.playlists), \
                patch("telestore.api.routes.playlists.database.Files", pl.files):
            yield ids
        app.dependency_overrides.pop(require_auth, None)

    def test_round_trip(self, client, signed_in):
        ids = signed_in
        assert client.get("/files/playlists").json()["playlists"][0]["name"] == "Liked music"
        made = client.post("/files/playlists", json={"name": "Mix", "file_ids": [ids["a.mp3"]]}).json()
        assert client.post(f"/files/playlists/{made['id']}/items", json={"file_ids": [ids["b.flac"]]}).json()["count"] == 2
        assert client.post("/files/playlists/like", json={"file_id": ids["a.mp3"]}).json() == {"liked": True}
        assert client.get("/files/playlists/liked").json()["items"][0]["file_name"] == "a.mp3"
        assert client.patch(f"/files/playlists/{made['id']}", json={"name": "Gym"}).json()["name"] == "Gym"
        assert client.post(f"/files/playlists/{made['id']}/items/remove", json={"file_ids": [ids["a.mp3"]]}).json()["count"] == 1
        assert client.delete(f"/files/playlists/{made['id']}").json() == {"deleted": True}

    def test_errors_say_why(self, client):
        res = client.delete("/files/playlists/liked")
        assert res.status_code == 400 and "can't be deleted" in res.json()["detail"]
        assert client.get(f"/files/playlists/{ObjectId()}").status_code == 404
        assert client.post("/files/playlists", json={"name": ""}).status_code == 400

    def test_signed_out(self, client):
        app.dependency_overrides.pop(require_auth, None)
        assert client.get("/files/playlists").status_code == 401
