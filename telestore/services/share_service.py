"""Sharing, as in Google Drive: a file or folder shared with other accounts, and/or by a link.

One share per item (the Shares collection), keyed by the item's id, so a share follows its item
when it is moved or renamed. A shared folder covers everything inside it, now and later.

- Members are other TeleStore accounts, each a viewer (open, stream, download) or an editor (also
  upload, make folders, rename, move and send to the owner's Trash, all inside the shared folder).
- The link ("Anyone with the link") is view-only. It can turn downloads off (viewing still works),
  expire at a time, and stop after a number of downloads. Resetting it gives a new address.
- Private Vault items can't be shared, and a shared item in Trash is unavailable until restored.

Paths given to and returned by share routes are relative to the shared folder: "" is the folder
itself, "/Trip/Day 1" a folder inside it. They never reach outside it.
"""

import re
import secrets
from datetime import datetime, timezone
from typing import Iterable, List, Optional, Tuple

from bson import ObjectId
from d4rk.Logs import setup_logger

from telestore.db import database

logger = setup_logger("share_service")

ROLES = ("viewer", "editor")
_indexed = False


class ShareError(Exception):
    """A share request that can't be done; [status] is the HTTP status to answer with."""

    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


def _coll():
    global _indexed
    from telestore.services.remote_transfer_manager.helpers import get_remote_db
    coll = get_remote_db()["Shares"]
    if not _indexed:
        try:
            coll.create_index("item_id", unique=True)
            coll.create_index("link.token", unique=True, sparse=True)
            coll.create_index("members.user_id")
            coll.create_index("owner_id")
        except Exception as e:
            logger.warning(f"Shares indexes: {e}")
        _indexed = True
    return coll


def now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(value) -> Optional[datetime]:
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    return None


# ── Accounts ───────────────────────────────────────────────────────────────

def account_id(user) -> str:
    """The id files and shares use for an account: its Telegram id, else its username."""
    return str(user.telegram_user_id) if user.telegram_user_id else user.username


def account_ids(user) -> List[str]:
    return [i for i in {user.username, str(user.telegram_user_id) if user.telegram_user_id else None} if i]


def display_name(user_doc: Optional[dict]) -> str:
    if not user_doc:
        return "Someone"
    first = (user_doc.get("telegram_first_name") or "").strip()
    last = (user_doc.get("telegram_last_name") or "").strip()
    name = f"{first} {last}".strip()
    username = user_doc.get("username") or ""
    if username.startswith("google_"):
        username = username[len("google_"):]
    return name or username or "Someone"


def find_account(who: str) -> Optional[dict]:
    """A TeleStore account by username or email (any case), or None."""
    who = (who or "").strip()
    if not who:
        return None
    exact = re.compile(f"^{re.escape(who)}$", re.I)
    for flt in ({"username": exact}, {"email": exact}, {"username": re.compile(f"^google_{re.escape(who)}$", re.I)}):
        found = database.Users.find_one(flt)
        if found:
            return found
    return None


def owner_user(owner_id: str):
    """The owner of a share as a User, so the usual file operations can run as them."""
    from telestore.security.credentials import User
    doc = None
    if str(owner_id).isdigit():
        doc = database.Users.find_one({"telegram_user_id": int(owner_id)})
    doc = doc or database.Users.find_one({"username": owner_id})
    if not doc:
        raise ShareError("The owner of this share no longer has an account.", 404)
    return User(username=doc.get("username"), email=doc.get("email"), telegram_user_id=doc.get("telegram_user_id"))


# ── Items ──────────────────────────────────────────────────────────────────

def is_vault(doc: dict) -> bool:
    path = (doc.get("file_path") or "").lstrip("/")
    return bool(doc.get("is_vault")) or path == "Vault" or path.startswith("Vault/")


def full_path(folder: dict) -> str:
    """Where a folder's contents live."""
    return f"{(folder.get('file_path') or '/Home').rstrip('/')}/{folder.get('file_name')}"


def get_item(item_id: str) -> Optional[dict]:
    if not item_id or not ObjectId.is_valid(str(item_id)):
        return None
    return database.Files.find_one({"_id": ObjectId(str(item_id))})


def own_item(item_id: str, user) -> dict:
    """The caller's own file or folder that may be shared."""
    doc = get_item(item_id)
    if not doc or doc.get("owner_id") not in account_ids(user):
        raise ShareError("File or folder not found", 404)
    if is_vault(doc):
        raise ShareError("Items in your Private Vault can't be shared.", 400)
    if doc.get("trashed"):
        raise ShareError("Items in Trash can't be shared. Restore it first.", 400)
    return doc


def clean_rel(path: Optional[str]) -> str:
    """A path inside a shared folder as "/a/b" ("" for the folder itself); ".." is refused."""
    parts = [p for p in (path or "").replace("\\", "/").split("/") if p and p != "."]
    if any(p == ".." for p in parts):
        raise ShareError("That folder isn't part of this share.", 404)
    return "".join(f"/{p}" for p in parts)


def inside(root: dict, doc: dict) -> bool:
    """Whether [doc] is the shared item or (for a folder) anywhere inside it."""
    if doc.get("_id") == root.get("_id"):
        return True
    if root.get("file_type") != "folder" or doc.get("owner_id") != root.get("owner_id"):
        return False
    base = full_path(root)
    path = doc.get("file_path") or ""
    return path == base or path.startswith(base + "/")


def rel_of(root: dict, doc: dict) -> str:
    """The folder [doc] sits in, relative to the shared folder."""
    if doc.get("_id") == root.get("_id") or root.get("file_type") != "folder":
        return ""
    return (doc.get("file_path") or "")[len(full_path(root)):]


def abs_path(root: dict, rel: str) -> str:
    return full_path(root) + clean_rel(rel)


def visible(doc: dict) -> bool:
    return not doc.get("trashed") and not is_vault(doc)


def item_json(doc: dict, root: Optional[dict] = None) -> dict:
    """What share pages show of a file or folder (no Telegram ids)."""
    return {
        "id": str(doc.get("_id")),
        "name": doc.get("file_name"),
        "type": doc.get("file_type") or "document",
        "size": int(doc.get("file_size") or 0),
        "modified_date": doc.get("modified_date"),
        "taken_at": doc.get("taken_at"),
        "duration": doc.get("duration"),
        "has_thumb": bool(doc.get("thumbnail")) or (doc.get("file_type") in ("photo", "video")),
        "path": rel_of(root, doc) if root else "",
    }


def list_folder(root: dict, rel: str) -> List[dict]:
    """The files and folders directly in [rel] of a shared folder, folders first."""
    if root.get("file_type") != "folder":
        return [root] if not clean_rel(rel) else []
    docs = [d for d in database.Files.find({
        "owner_id": root.get("owner_id"),
        "file_path": abs_path(root, rel),
        "trashed": {"$ne": True},
        "is_vault": {"$ne": True},
    }) if visible(d)]
    docs.sort(key=lambda d: (d.get("file_type") != "folder", (d.get("file_name") or "").lower()))
    return docs


def files_under(root: dict, rel: str = "") -> Tuple[List[dict], str, str]:
    """All files in a shared folder (or one of its folders) for a zip: (files, folder path, name)."""
    if root.get("file_type") != "folder":
        return [root], root.get("file_path") or "/Home", root.get("file_name") or "file"
    base = abs_path(root, rel)
    files = [d for d in database.Files.find({
        "owner_id": root.get("owner_id"),
        "file_path": {"$regex": f"^{re.escape(base)}(/|$)"},
        "file_type": {"$ne": "folder"},
        "trashed": {"$ne": True},
        "is_vault": {"$ne": True},
    }) if visible(d)]
    files.sort(key=lambda x: (x.get("file_path", ""), x.get("file_name", "")))
    name = clean_rel(rel).rsplit("/", 1)[-1] or root.get("file_name") or "folder"
    return files, base, name


def child(root: dict, file_id: str) -> dict:
    """A file or folder of a share by its id, refused when it's outside the share."""
    doc = get_item(file_id)
    if not doc or not inside(root, doc) or not visible(doc):
        raise ShareError("File not found", 404)
    return doc


# ── Shares ─────────────────────────────────────────────────────────────────

def share_for_item(item_id: str) -> Optional[dict]:
    return _coll().find_one({"item_id": str(item_id)})


def shared_ids(item_ids: Iterable[str]) -> set:
    """Which of these items are shared (with anyone, or by an active link): for the "Shared" mark."""
    ids = [str(i) for i in item_ids if i]
    if not ids:
        return set()
    out = set()
    for s in _coll().find({"item_id": {"$in": ids}}):
        if s.get("members") or (s.get("link") or {}).get("enabled"):
            out.add(s["item_id"])
    return out


def _ensure(doc: dict) -> dict:
    share = share_for_item(doc["_id"])
    if share:
        return share
    share = {
        "share_id": "sh_" + secrets.token_hex(8),
        "item_id": str(doc["_id"]),
        "owner_id": doc.get("owner_id"),
        "item_type": doc.get("file_type"),
        "created_at": now(),
        "link": None,
        "members": [],
    }
    _coll().insert_one(dict(share))
    return share_for_item(doc["_id"]) or share


def _drop_if_empty(share: dict) -> None:
    fresh = _coll().find_one({"share_id": share["share_id"]})
    if fresh and not fresh.get("members") and not (fresh.get("link") or {}).get("token"):
        _coll().delete_one({"share_id": share["share_id"]})


def link_state(share: dict) -> Optional[str]:
    """Why a link doesn't work right now ("off", "expired", "used_up"), or None when it works."""
    link = share.get("link") or {}
    if not link.get("enabled") or not link.get("token"):
        return "off"
    expires = _aware(link.get("expires_at"))
    if expires and expires <= now():
        return "expired"
    limit = link.get("max_downloads")
    if limit and int(link.get("downloads") or 0) >= int(limit):
        return "used_up"
    return None


def _link_json(share: dict) -> Optional[dict]:
    link = share.get("link")
    if not link or not link.get("token"):
        return None
    expires = _aware(link.get("expires_at"))
    return {
        "enabled": bool(link.get("enabled")),
        "token": link["token"],
        "allow_download": link.get("allow_download", True),
        "expires_at": expires.isoformat() if expires else None,
        "max_downloads": link.get("max_downloads"),
        "downloads": int(link.get("downloads") or 0),
        "state": link_state(share) or "active",
    }


def view(doc: dict, share: Optional[dict]) -> dict:
    """The Share dialog: the item, its link and the people it's shared with."""
    members = []
    for m in (share or {}).get("members") or []:
        account = database.Users.find_one({"username": m.get("username")})
        members.append({
            "user_id": m.get("user_id"),
            "username": m.get("username"),
            "name": display_name(account) if account else m.get("username"),
            "email": (account or {}).get("email"),
            "role": m.get("role", "viewer"),
        })
    return {
        "share_id": (share or {}).get("share_id"),
        "item": item_json(doc),
        "link": _link_json(share) if share else None,
        "members": members,
    }


def get_view(item_id: str, user) -> dict:
    doc = own_item(item_id, user)
    return view(doc, share_for_item(doc["_id"]))


def set_link(item_id: str, user, enabled: bool, allow_download: Optional[bool] = None,
             expires_at: Optional[datetime] = None, max_downloads: Optional[int] = None,
             clear_expiry: bool = False, clear_limit: bool = False) -> dict:
    doc = own_item(item_id, user)
    share = _ensure(doc)
    link = dict(share.get("link") or {})
    if not link.get("token"):
        link = {"token": secrets.token_urlsafe(16), "allow_download": True, "expires_at": None,
                "max_downloads": None, "downloads": 0, "created_at": now()}
    link["enabled"] = bool(enabled)
    if allow_download is not None:
        link["allow_download"] = bool(allow_download)
    if clear_expiry:
        link["expires_at"] = None
    elif expires_at is not None:
        expires = _aware(expires_at)
        if expires <= now():
            raise ShareError("Pick an expiry time in the future.", 400)
        link["expires_at"] = expires
    if clear_limit:
        link["max_downloads"] = None
    elif max_downloads is not None:
        if max_downloads < 1:
            raise ShareError("The download limit must be at least 1.", 400)
        link["max_downloads"] = int(max_downloads)
        # A new limit counts from now
        link["downloads"] = 0
    _coll().update_one({"share_id": share["share_id"]}, {"$set": {"link": link}})
    return get_view(item_id, user)


def reset_link(item_id: str, user) -> dict:
    """A new address for the link; the old one stops working at once."""
    doc = own_item(item_id, user)
    share = _ensure(doc)
    link = dict(share.get("link") or {"enabled": True, "allow_download": True, "expires_at": None, "max_downloads": None})
    link.update({"token": secrets.token_urlsafe(16), "downloads": 0, "created_at": now()})
    _coll().update_one({"share_id": share["share_id"]}, {"$set": {"link": link}})
    return get_view(item_id, user)


def add_member(item_id: str, user, who: str, role: str = "viewer") -> Tuple[dict, Optional[dict]]:
    """Shares with an account; returns (dialog, the account when it was newly added)."""
    if role not in ROLES:
        raise ShareError("Role must be viewer or editor.", 400)
    doc = own_item(item_id, user)
    account = find_account(who)
    if not account:
        raise ShareError("No TeleStore account has that username or email.", 404)
    member_id = str(account["telegram_user_id"]) if account.get("telegram_user_id") else account.get("username")
    if member_id in account_ids(user) or account.get("username") == user.username:
        raise ShareError("That's your own account.", 400)
    share = _ensure(doc)
    members = list(share.get("members") or [])
    existing = next((m for m in members if m.get("user_id") == member_id), None)
    if existing:
        existing["role"] = role
    else:
        members.append({"user_id": member_id, "username": account.get("username"), "role": role, "added_at": now()})
    _coll().update_one({"share_id": share["share_id"]}, {"$set": {"members": members}})
    return get_view(item_id, user), (None if existing else account)


def set_member_role(item_id: str, user, member_id: str, role: str) -> dict:
    if role not in ROLES:
        raise ShareError("Role must be viewer or editor.", 400)
    doc = own_item(item_id, user)
    share = share_for_item(doc["_id"])
    members = list((share or {}).get("members") or [])
    hit = next((m for m in members if m.get("user_id") == member_id), None)
    if not hit:
        raise ShareError("That person doesn't have access.", 404)
    hit["role"] = role
    _coll().update_one({"share_id": share["share_id"]}, {"$set": {"members": members}})
    return get_view(item_id, user)


def remove_member(item_id: str, user, member_id: str) -> dict:
    doc = own_item(item_id, user)
    share = share_for_item(doc["_id"])
    if share:
        members = [m for m in share.get("members") or [] if m.get("user_id") != member_id]
        _coll().update_one({"share_id": share["share_id"]}, {"$set": {"members": members}})
        _drop_if_empty(share)
    return get_view(item_id, user)


def stop_sharing(item_id: str, user) -> dict:
    doc = own_item(item_id, user)
    _coll().delete_one({"item_id": str(doc["_id"])})
    return get_view(item_id, user)


def forget(item_ids: Iterable[str]) -> None:
    """Drops the shares of items deleted for good."""
    ids = [str(i) for i in item_ids if i]
    if ids:
        _coll().delete_many({"item_id": {"$in": ids}})


def _live(share: dict) -> Optional[dict]:
    """The shared item when it exists; a share whose item was deleted for good is dropped."""
    doc = get_item(share.get("item_id"))
    if not doc:
        _coll().delete_one({"share_id": share["share_id"]})
        return None
    return doc


def mine(user) -> List[dict]:
    """Shared by me: every item the caller shares, newest first."""
    out = []
    for share in _coll().find({"owner_id": {"$in": account_ids(user)}}):
        doc = _live(share)
        if not doc:
            continue
        if not share.get("members") and not (share.get("link") or {}).get("enabled"):
            continue
        out.append({
            "share_id": share["share_id"],
            "item": item_json(doc),
            # Where your item is in your own files ("/Home/Trip"), to open it there
            "location": doc.get("file_path") or "/Home",
            "trashed": bool(doc.get("trashed")),
            "link": _link_json(share),
            "members": len(share.get("members") or []),
            "created_at": _aware(share.get("created_at")).isoformat() if _aware(share.get("created_at")) else None,
        })
    out.sort(key=lambda s: s["created_at"] or "", reverse=True)
    return out


def with_me(user) -> List[dict]:
    """Shared with me: items other accounts shared with the caller (not those in Trash or the Vault)."""
    ids = account_ids(user)
    out = []
    for share in _coll().find({"members.user_id": {"$in": ids}}):
        doc = _live(share)
        if not doc or not visible(doc):
            continue
        member = next(m for m in share["members"] if m.get("user_id") in ids)
        owner = owner_user_doc(share.get("owner_id"))
        out.append({
            "share_id": share["share_id"],
            "role": member.get("role", "viewer"),
            "owner": {"username": (owner or {}).get("username"), "name": display_name(owner)},
            "item": item_json(doc),
            "shared_at": _aware(member.get("added_at")).isoformat() if _aware(member.get("added_at")) else None,
        })
    out.sort(key=lambda s: s["shared_at"] or "", reverse=True)
    return out


def owner_user_doc(owner_id: str) -> Optional[dict]:
    if owner_id and str(owner_id).isdigit():
        found = database.Users.find_one({"telegram_user_id": int(owner_id)})
        if found:
            return found
    return database.Users.find_one({"username": owner_id}) if owner_id else None


def member_access(share_id: str, user) -> Tuple[dict, dict, str]:
    """(share, shared item, role) for a member of the share; refused for anyone else."""
    share = _coll().find_one({"share_id": share_id}) if share_id else None
    ids = account_ids(user)
    member = next((m for m in (share or {}).get("members") or [] if m.get("user_id") in ids), None)
    if not share or not member:
        raise ShareError("This share doesn't exist or isn't shared with you.", 404)
    doc = get_item(share["item_id"])
    if not doc:
        raise ShareError("This item was deleted by its owner.", 404)
    if doc.get("trashed"):
        raise ShareError("This item is in its owner's Trash.", 410)
    if is_vault(doc):
        raise ShareError("This item is no longer shared.", 410)
    return share, doc, member.get("role", "viewer")


def editor_access(share_id: str, user) -> Tuple[dict, dict]:
    share, doc, role = member_access(share_id, user)
    if role != "editor":
        raise ShareError("You can only view this share.", 403)
    if doc.get("file_type") != "folder":
        raise ShareError("Only shared folders can be changed.", 400)
    return share, doc


LINK_MESSAGES = {
    "off": "This link was turned off by its owner.",
    "expired": "This link has expired.",
    "used_up": "This link has reached its download limit.",
}


def link_access(token: str) -> Tuple[dict, dict]:
    """(share, shared item) for a working link; ShareError (404/410) says why not."""
    share = _coll().find_one({"link.token": token}) if token else None
    if not share:
        raise ShareError("This link doesn't exist.", 404)
    reason = link_state(share)
    if reason:
        raise ShareError(LINK_MESSAGES[reason], 410)
    doc = get_item(share["item_id"])
    if not doc:
        raise ShareError("This item was deleted by its owner.", 410)
    if doc.get("trashed"):
        raise ShareError("This item is in its owner's Trash.", 410)
    if is_vault(doc):
        raise ShareError("This item is no longer shared.", 410)
    return share, doc


def count_download(share: dict) -> None:
    """One download of a link (a file, or a part of a folder's zip); refused past its limit."""
    link = share.get("link") or {}
    limit = link.get("max_downloads")
    flt = {"share_id": share["share_id"], "link.token": link.get("token")}
    if limit:
        flt["link.downloads"] = {"$lt": int(limit)}
    res = _coll().update_one(flt, {"$inc": {"link.downloads": 1}})
    if limit and not getattr(res, "modified_count", 0):
        raise ShareError(LINK_MESSAGES["used_up"], 410)


def link_info(share: dict, doc: dict) -> dict:
    owner = owner_user_doc(share.get("owner_id"))
    link = share.get("link") or {}
    limit = link.get("max_downloads")
    expires = _aware(link.get("expires_at"))
    return {
        "item": item_json(doc, doc),
        "owner_name": display_name(owner),
        "allow_download": link.get("allow_download", True),
        "expires_at": expires.isoformat() if expires else None,
        "downloads_left": max(0, int(limit) - int(link.get("downloads") or 0)) if limit else None,
    }
