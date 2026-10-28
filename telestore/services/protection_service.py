# telestore/services/protection_service.py
"""Protect from deletion: a protected file or folder can't be moved to Trash or deleted forever
until the user confirms with their password (or, for accounts without one, a code sent by email).

Protection covers what's inside a protected folder too, and a folder that holds something
protected. Confirming gives a short-lived unlock token, so deleting many items asks once.
WebDAV apps can't ask for a password, so they can't delete protected items at all.
"""

import re
import secrets
import time
from typing import Iterable, List, Optional

from d4rk.Logs import setup_logger

from telestore.db import database

logger = setup_logger("protection_service")

TOKEN_SECONDS = 300
CODE_PURPOSE = "Delete protected files"
FOLDER_COLORS = ("red", "orange", "yellow", "green", "teal", "blue", "purple", "grey")

_tokens: dict = {}  # token -> (username, expires at)


class ProtectedError(Exception):
    """Deleting this needs the user's confirmation (HTTP 423)."""


def full_path(doc: dict) -> str:
    """Where a folder's contents live: its parent path plus its name."""
    parent = (doc.get("file_path") or "/").rstrip("/")
    return f"{parent}/{doc.get('file_name') or ''}"


def _under(path: Optional[str], folder: str) -> bool:
    path = (path or "/").rstrip("/") or "/"
    return path == folder or path.startswith(folder + "/")


def _inside_query(folder: str) -> dict:
    return {"$regex": f"^{re.escape(folder)}(/|$)"}


def blocker(doc: dict, owner_ids: Iterable[str]) -> Optional[str]:
    """The name of what makes deleting [doc] need confirmation, or None when it's free to go:
    the item itself, a protected folder it's inside, or (for a folder) something protected in it."""
    owners = list(owner_ids)
    if doc.get("protected"):
        return doc.get("file_name") or "This item"
    # Trashed items remember where they were
    where = doc.get("original_path") if doc.get("trashed") else doc.get("file_path")
    for folder in database.Files.find({"owner_id": {"$in": owners}, "file_type": "folder", "protected": True}):
        if _under(where, full_path(folder)):
            return folder.get("file_name") or "A folder"
    if doc.get("file_type") == "folder":
        inside = full_path(doc)
        found = database.Files.find_one({"owner_id": {"$in": owners}, "protected": True, "$or": [
            {"file_path": _inside_query(inside)}, {"original_path": _inside_query(inside)},
        ]})
        if found:
            return found.get("file_name") or "Something inside"
    return None


def trash_blocker(owner_ids: Iterable[str]) -> Optional[str]:
    """Emptying the Trash: the first protected thing in it, if any."""
    found = database.Files.find_one({"owner_id": {"$in": list(owner_ids)}, "trashed": True, "protected": True})
    return (found.get("file_name") or "Something") if found else None


def protected_message(name: str) -> str:
    return f"“{name}” is protected. Confirm with your password to delete it."


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


def issue_token(username: str) -> str:
    now = time.time()
    for t, (_, expires) in list(_tokens.items()):
        if expires < now:
            _tokens.pop(t, None)
    token = secrets.token_urlsafe(24)
    _tokens[token] = (username, now + TOKEN_SECONDS)
    return token


def token_valid(token: Optional[str], username: str) -> bool:
    if not token:
        return False
    entry = _tokens.get(token)
    return bool(entry) and entry[0] == username and entry[1] >= time.time()


def require(token: Optional[str], username: str, name: Optional[str]) -> None:
    """Raises ProtectedError when [name] blocks the delete and the token doesn't unlock it."""
    if name and not token_valid(token, username):
        raise ProtectedError(protected_message(name))


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
