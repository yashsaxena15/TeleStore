# telestore/services/protection_service.py
"""Protect from deletion: a protected file or folder can't be moved to Trash or deleted forever,
from anywhere (app, website, WebDAV). To delete it the user first removes the protection, which
needs their password (or, for accounts without one, a code sent by email).

Protection is for the item itself: the files and folders inside a protected folder can be
deleted as usual. A folder that holds something protected can't be deleted (it would take the
protected item with it). A confirmation unlocks removing protection from one item,
once: it can never be used to delete anything.
"""

import re
import secrets
import time
from typing import Iterable, List, Optional

from d4rk.Logs import setup_logger

from telestore.db import database

logger = setup_logger("protection_service")

TOKEN_SECONDS = 120
CODE_PURPOSE = "Delete protected files"
FOLDER_COLORS = ("red", "orange", "yellow", "green", "teal", "blue", "purple", "grey")

_tokens: dict = {}  # token -> (username, file id, expires at)


class ProtectedError(Exception):
    """This can't be deleted while it (or something in or around it) is protected (HTTP 423)."""


def full_path(doc: dict) -> str:
    """Where a folder's contents live: its parent path plus its name."""
    parent = (doc.get("file_path") or "/").rstrip("/")
    return f"{parent}/{doc.get('file_name') or ''}"


def _inside_query(folder: str) -> dict:
    return {"$regex": f"^{re.escape(folder)}(/|$)"}


def blocker(doc: dict, owner_ids: Iterable[str]) -> Optional[str]:
    """Why [doc] can't be deleted, as a sentence, or None when it's free to go: it is protected
    itself, or (a folder) it holds something protected, which would go with it. What's inside a
    protected folder is not protected: only the folder itself can't be deleted."""
    owners = list(owner_ids)
    name = doc.get("file_name") or "This item"
    if doc.get("protected"):
        return f"“{name}” is protected. Remove protection first."
    if doc.get("file_type") == "folder":
        inside = full_path(doc)
        found = database.Files.find_one({"owner_id": {"$in": owners}, "protected": True, "$or": [
            {"file_path": _inside_query(inside)}, {"original_path": _inside_query(inside)},
        ]})
        if found:
            return f"“{name}” contains a protected item (“{found.get('file_name') or 'something'}”). Remove its protection first."
    return None


def refuse(doc: Optional[dict], owner_ids: Iterable[str]) -> None:
    """Raises ProtectedError when [doc] can't be deleted. No password unlocks this."""
    if doc:
        reason = blocker(doc, owner_ids)
        if reason:
            raise ProtectedError(reason)


def kept_in_trash(owner_ids: Iterable[str]) -> list:
    """Trashed items Empty Trash leaves alone: protected ones (from before protection blocked
    trashing) and folders holding them."""
    owners = list(owner_ids)
    return [d for d in database.Files.find({"owner_id": {"$in": owners}, "trashed": True}) if blocker(d, owners)]


# ── Confirming ──────────────────────────────────────────────────────────────

def _default_admin(username: str) -> bool:
    """The built-in owner account, which signs in with DEFAULT_ADMIN_PASSWORD until it sets its own."""
    from telestore.security.credentials import USERNAME
    return username == USERNAME and not database.Users.get_password_hash(username)


def method(username: str) -> dict:
    """How this account confirms: its password, an email code (no password), or neither."""
    if database.Users.get_password_hash(username) or _default_admin(username):
        return {"method": "password", "email_hint": None}
    user = database.Users.getUser(username) or {}
    email = (user.get("email") or "").strip()
    if email:
        return {"method": "email", "email_hint": hint(email)}
    return {"method": "none", "email_hint": None}


def hint(email: str) -> str:
    """y•••@gmail.com"""
    name, _, domain = email.partition("@")
    return f"{name[:1]}•••@{domain}" if domain else "your email"


def password_ok(username: str, password: str) -> bool:
    if _default_admin(username):
        from telestore.security.credentials import verify_password
        return verify_password(password)
    return database.Users.verify_current_password(username, password)


def issue_token(username: str, file_id: str) -> str:
    """A one-time pass to remove protection from [file_id], after the password (or code) checked out."""
    now = time.time()
    for t, entry in list(_tokens.items()):
        if entry[2] < now:
            _tokens.pop(t, None)
    token = secrets.token_urlsafe(24)
    _tokens[token] = (username, str(file_id), now + TOKEN_SECONDS)
    return token


def use_token(token: Optional[str], username: str, file_id: str) -> bool:
    """True (once) when [token] was issued to [username] for removing protection from [file_id]."""
    entry = _tokens.pop(token, None) if token else None
    return bool(entry) and entry[0] == username and entry[1] == str(file_id) and entry[2] >= time.time()


def set_color(file_id: str, owner_ids: List[str], color: Optional[str]) -> bool:
    from bson import ObjectId
    if color is not None and color not in FOLDER_COLORS:
        raise ValueError("Unknown colour.")
    doc = database.Files.find_one({"_id": ObjectId(file_id), "owner_id": {"$in": owner_ids}})
    if not doc:
        raise LookupError("Folder not found.")
    if doc.get("file_type") != "folder":
        raise ValueError("Only folders can have a colour.")
    database.Files.update_one({"_id": doc["_id"]}, {"$set": {"color": color}} if color else {"$unset": {"color": ""}})
    return True
