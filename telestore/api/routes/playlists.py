# telestore/api/routes/playlists.py
"""Playlists (with the undeletable "Liked music"), for the Android app and the website.

Under /files/playlists so the website's own /playlists page address never reaches the API.
"""

from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from telestore.db import database
from telestore.security.credentials import User, require_auth
from telestore.services.playlist_service import Playlists, PlaylistError

router = APIRouter(prefix="/files/playlists", tags=["Playlists"])


def playlists_collection():
    from telestore.services.remote_transfer_manager.helpers import get_remote_db
    return get_remote_db()["Playlists"]


def _playlists(user: User) -> Playlists:
    owner = str(user.telegram_user_id) if user.telegram_user_id else user.username
    owner_ids = {user.username, str(user.telegram_user_id) if user.telegram_user_id else None}
    return Playlists(playlists_collection(), database.Files, owner, owner_ids)


def _run(action):
    try:
        return action()
    except PlaylistError as e:
        raise HTTPException(status_code=e.status, detail=str(e))


class NewPlaylist(BaseModel):
    name: str
    file_ids: Optional[List[str]] = None


class Rename(BaseModel):
    name: str


class FileIds(BaseModel):
    file_ids: List[str]


class Like(BaseModel):
    file_id: str
    liked: Optional[bool] = None


@router.get("")
def list_playlists(user: User = Depends(require_auth)):
    return {"playlists": _run(lambda: _playlists(user).list())}


@router.post("")
def create_playlist(body: NewPlaylist, user: User = Depends(require_auth)):
    return _run(lambda: _playlists(user).create(body.name, body.file_ids))


@router.post("/like")
def like_file(body: Like, user: User = Depends(require_auth)):
    return {"liked": _run(lambda: _playlists(user).toggle_like(body.file_id, body.liked))}


@router.get("/{playlist_id}")
def get_playlist(playlist_id: str, user: User = Depends(require_auth)):
    return _run(lambda: _playlists(user).get(playlist_id))


@router.patch("/{playlist_id}")
def rename_playlist(playlist_id: str, body: Rename, user: User = Depends(require_auth)):
    return _run(lambda: _playlists(user).rename(playlist_id, body.name))


@router.delete("/{playlist_id}")
def delete_playlist(playlist_id: str, user: User = Depends(require_auth)):
    _run(lambda: _playlists(user).delete(playlist_id))
    return {"deleted": True}


@router.post("/{playlist_id}/items")
def add_items(playlist_id: str, body: FileIds, user: User = Depends(require_auth)):
    return _run(lambda: _playlists(user).add(playlist_id, body.file_ids))


@router.post("/{playlist_id}/items/remove")
def remove_items(playlist_id: str, body: FileIds, user: User = Depends(require_auth)):
    return _run(lambda: _playlists(user).remove(playlist_id, body.file_ids))


@router.put("/{playlist_id}/order")
def reorder_items(playlist_id: str, body: FileIds, user: User = Depends(require_auth)):
    return _run(lambda: _playlists(user).reorder(playlist_id, body.file_ids))
