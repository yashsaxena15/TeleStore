# telestore/services/playlist_service.py
"""Playlists of music and videos, shared by the Android app and the website.

Each account has one "Liked music" playlist (made the first time playlists are listed) that can't
be renamed or deleted; the heart in the players adds to it and removes from it. Other playlists
are the user's own. A playlist stores file ids in order; files that were deleted or moved to Trash
are left out when the playlist is read (and come back if the file is restored).
"""

import re
from datetime import datetime, timezone
from typing import Iterable, List, Optional

from bson import ObjectId

LIKED = "liked"
LIKED_NAME = "Liked music"
MAX_ITEMS = 5000
MAX_PLAYLISTS = 200
MAX_NAME = 100

AUDIO_EXT = re.compile(r"\.(mp3|wav|flac|aac|ogg|m4a|wma|opus)$", re.I)
VIDEO_EXT = re.compile(r"\.(mp4|mkv|avi|mov|webm|flv|wmv|m4v|3gp|ts)$", re.I)

# The fields a file has in GET /files, so both apps read playlist items the same way
FILE_FIELDS = (
    "chat_id", "message_id", "file_type", "thumbnail", "file_unique_id", "file_size", "file_name",
    "file_caption", "file_path", "owner_id", "modified_date", "is_split", "total_parts", "part_size",
    "starred", "taken_at",
)


class PlaylistError(Exception):
    """A request that can't be done; [status] is the HTTP status to answer with."""

    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


def _now() -> str:
    return datetime.now(timezone.utc).replace(tzinfo=None).isoformat(timespec="seconds")


def is_playable(doc: dict) -> bool:
    """Music and videos (by stored type or by name); not folders, Trash or the vault."""
    if not doc or doc.get("file_type") == "folder" or doc.get("trashed") or doc.get("is_vault"):
        return False
    name = doc.get("file_name") or ""
    return doc.get("file_type") in ("audio", "voice", "video") or bool(AUDIO_EXT.search(name) or VIDEO_EXT.search(name))


def file_json(doc: dict) -> dict:
    data = {key: doc.get(key) for key in FILE_FIELDS}
    data["id"] = str(doc["_id"])
    data["starred"] = bool(data.get("starred"))
    data["file_path"] = data.get("file_path") or "/"
    return data


def _clean_name(name: Optional[str]) -> str:
    name = " ".join((name or "").split())
    if not name:
        raise PlaylistError(400, "Give the playlist a name")
    if len(name) > MAX_NAME:
        raise PlaylistError(400, f"Playlist names can be up to {MAX_NAME} characters")
    return name


def _object_id(value: str) -> ObjectId:
    try:
        return ObjectId(value)
    except Exception:
        raise PlaylistError(404, "Playlist not found")


class Playlists:
    """Playlists of one account. [playlists] and [files] are the Mongo collections."""

    def __init__(self, playlists, files, owner: str, owner_ids: Iterable[str]):
        self.playlists = playlists
        self.files = files
        self.owner = owner
        self.owner_ids = [i for i in owner_ids if i]

    # ── Reading ──────────────────────────────────────────────────────────────

    def _liked(self) -> dict:
        doc = self.playlists.find_one({"owner_id": self.owner, "kind": LIKED})
        if doc:
            return doc
        doc = {"owner_id": self.owner, "kind": LIKED, "name": LIKED_NAME, "items": [], "created_at": _now(), "updated_at": _now()}
        doc["_id"] = self.playlists.insert_one(doc).inserted_id
        return doc

    def _get(self, playlist_id: str) -> dict:
        if playlist_id == LIKED:
            return self._liked()
        doc = self.playlists.find_one({"_id": _object_id(playlist_id), "owner_id": self.owner})
        if not doc:
            raise PlaylistError(404, "Playlist not found")
        return doc

    def _files(self, ids: List[str]) -> dict:
        """The account's playable files among [ids], by id."""
        object_ids = []
        for i in ids:
            try:
                object_ids.append(ObjectId(i))
            except Exception:
                continue
        if not object_ids:
            return {}
        found = self.files.find({"_id": {"$in": object_ids}, "owner_id": {"$in": self.owner_ids}})
        return {str(d["_id"]): d for d in found if is_playable(d)}

    def _summary(self, doc: dict, files: Optional[dict] = None) -> dict:
        items = list(doc.get("items") or [])
        files = files if files is not None else self._files(items[:4])
        cover = next((files[i] for i in items if i in files), None)
        return {
            "id": LIKED if doc.get("kind") == LIKED else str(doc["_id"]),
            "name": doc.get("name") or "",
            "kind": doc.get("kind") or "user",
            "count": len(items),
            "file_ids": items,
            "cover": file_json(cover) if cover else None,
            "updated_at": doc.get("updated_at"),
        }

    def list(self) -> list:
        """Liked music first, then the user's playlists, most recently changed first."""
        liked = self._liked()
        own = [d for d in self.playlists.find({"owner_id": self.owner}) if d.get("kind") != LIKED]
        own.sort(key=lambda d: d.get("updated_at") or "", reverse=True)
        return [self._summary(liked)] + [self._summary(d) for d in own]

    def get(self, playlist_id: str) -> dict:
        doc = self._get(playlist_id)
        items = list(doc.get("items") or [])
        files = self._files(items)
        result = self._summary(doc, files)
        result["items"] = [file_json(files[i]) for i in items if i in files]
        return result

    # ── Changing ─────────────────────────────────────────────────────────────

    def create(self, name: str, file_ids: Optional[List[str]] = None) -> dict:
        name = _clean_name(name)
        if name.casefold() == LIKED_NAME.casefold():
            raise PlaylistError(409, f"“{LIKED_NAME}” is already a playlist")
        own = [d for d in self.playlists.find({"owner_id": self.owner}) if d.get("kind") != LIKED]
        if len(own) >= MAX_PLAYLISTS:
            raise PlaylistError(400, f"You can have up to {MAX_PLAYLISTS} playlists")
        if any((d.get("name") or "").casefold() == name.casefold() for d in own):
            raise PlaylistError(409, f"You already have a playlist called “{name}”")
        doc = {"owner_id": self.owner, "kind": "user", "name": name, "items": [], "created_at": _now(), "updated_at": _now()}
        doc["_id"] = self.playlists.insert_one(doc).inserted_id
        if file_ids:
            return self.add(str(doc["_id"]), file_ids)
        return self._summary(doc)

    def rename(self, playlist_id: str, name: str) -> dict:
        doc = self._get(playlist_id)
        if doc.get("kind") == LIKED:
            raise PlaylistError(400, f"“{LIKED_NAME}” can't be renamed")
        name = _clean_name(name)
        clash = [d for d in self.playlists.find({"owner_id": self.owner})
                 if d["_id"] != doc["_id"] and (d.get("name") or "").casefold() == name.casefold()]
        if clash or name.casefold() == LIKED_NAME.casefold():
            raise PlaylistError(409, f"You already have a playlist called “{name}”")
        self._save(doc, name=name)
        return self._summary(doc)

    def delete(self, playlist_id: str) -> None:
        doc = self._get(playlist_id)
        if doc.get("kind") == LIKED:
            raise PlaylistError(400, f"“{LIKED_NAME}” can't be deleted")
        self.playlists.delete_one({"_id": doc["_id"], "owner_id": self.owner})

    def add(self, playlist_id: str, file_ids: List[str]) -> dict:
        """Adds the playable files among [file_ids] at the end, skipping ones already in it."""
        doc = self._get(playlist_id)
        items = list(doc.get("items") or [])
        wanted = list(dict.fromkeys(str(i) for i in file_ids or []))
        files = self._files(wanted)
        new = [i for i in wanted if i in files and i not in items]
        if not files:
            raise PlaylistError(400, "Only music and videos can go in a playlist")
        if len(items) + len(new) > MAX_ITEMS:
            raise PlaylistError(400, f"A playlist can hold up to {MAX_ITEMS} items")
        if new:
            items.extend(new)
            self._save(doc, items=items)
        result = self._summary(doc)
        result["added"] = len(new)
        return result

    def remove(self, playlist_id: str, file_ids: List[str]) -> dict:
        doc = self._get(playlist_id)
        gone = {str(i) for i in file_ids or []}
        items = [i for i in doc.get("items") or [] if i not in gone]
        self._save(doc, items=items)
        return self._summary(doc)

    def reorder(self, playlist_id: str, file_ids: List[str]) -> dict:
        """[file_ids] in their new order; it must hold exactly the playlist's items."""
        doc = self._get(playlist_id)
        items = list(doc.get("items") or [])
        order = [str(i) for i in file_ids or []]
        if sorted(order) != sorted(items):
            raise PlaylistError(409, "The playlist changed; refresh and try again")
        self._save(doc, items=order)
        return self._summary(doc)

    def toggle_like(self, file_id: str, liked: Optional[bool] = None) -> bool:
        """Likes or unlikes a file (flips it when [liked] isn't given); returns whether it's liked now."""
        doc = self._liked()
        items = list(doc.get("items") or [])
        now = (file_id not in items) if liked is None else liked
        if now and file_id not in items:
            if not self._files([file_id]):
                raise PlaylistError(400, "Only music and videos can be liked")
            items.insert(0, file_id)  # newest likes first, as in music apps
        elif not now:
            items = [i for i in items if i != file_id]
        self._save(doc, items=items)
        return now

    def _save(self, doc: dict, **changes) -> None:
        changes["updated_at"] = _now()
        self.playlists.update_one({"_id": doc["_id"], "owner_id": self.owner}, {"$set": changes})
        doc.update(changes)
