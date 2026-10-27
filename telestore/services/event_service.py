# telestore/services/event_service.py
"""Notifications: things that happened on the server that the user should hear about.

The Android app checks GET /user/notifications (every 15 minutes in the background, live while
open) and shows them as phone notifications; the website shows them under its bell. There is no
push service: each event is a row in the Events collection, kept for 30 days.

Events are recorded for: server transfers that finished or failed (leech, YouTube/yt-dlp,
Instagram; a folder or playlist counts once, when its last file is done), new videos from a
synced playlist, files arriving in the Telegram Inbox, storage almost full and new sign-ins.
"""

import re
from datetime import datetime, timezone
from typing import Iterable, List, Optional

from bson import ObjectId
from d4rk.Logs import setup_logger

logger = setup_logger("event_service")

KEEP_DAYS = 30
FINAL = ("completed", "failed", "cancelled")
STORAGE_WARN_AT = 0.9
_indexed = False


def _coll():
    global _indexed
    from telestore.services.remote_transfer_manager.helpers import get_remote_db
    coll = get_remote_db()["Events"]
    if not _indexed:
        try:
            coll.create_index([("owner_id", 1), ("_id", -1)])
            coll.create_index("dedupe", unique=True, sparse=True)
            coll.create_index("created_at", expireAfterSeconds=KEEP_DAYS * 24 * 3600)
        except Exception as e:
            logger.warning(f"Events indexes: {e}")
        _indexed = True
    return coll


def _now() -> datetime:
    return datetime.now(timezone.utc)


def record(owner_id: str, kind: str, title: str, body: str = "", target: Optional[dict] = None, dedupe: Optional[str] = None) -> bool:
    """Adds an event for [owner_id]; with [dedupe], the same event is only ever added once."""
    if not owner_id:
        return False
    doc = {"owner_id": str(owner_id), "kind": kind, "title": title[:200], "body": (body or "")[:500],
           "target": target, "created_at": _now(), "read": False}
    if dedupe:
        doc["dedupe"] = dedupe
    try:
        _coll().insert_one(doc)
        return True
    except Exception as e:
        if "duplicate key" not in str(e).lower():
            logger.warning(f"Couldn't record event {kind} for {owner_id}: {e}")
        return False


def _json(doc: dict) -> dict:
    created = doc.get("created_at")
    if isinstance(created, datetime):
        created = created.astimezone(timezone.utc).replace(tzinfo=None).isoformat(timespec="seconds") + "Z"
    return {"id": str(doc["_id"]), "kind": doc.get("kind"), "title": doc.get("title") or "", "body": doc.get("body") or "",
            "target": doc.get("target"), "created_at": created, "read": bool(doc.get("read"))}


def listing(owner_ids: Iterable[str], after: Optional[str] = None, limit: int = 30) -> dict:
    """The newest events (or only those newer than [after]), newest first, and the unread count."""
    owners = [str(o) for o in owner_ids if o]
    query = {"owner_id": {"$in": owners}}
    if after:
        try:
            query["_id"] = {"$gt": ObjectId(after)}
        except Exception:
            pass
    limit = max(1, min(100, int(limit or 30)))
    coll = _coll()
    items = [_json(d) for d in coll.find(query).sort("_id", -1).limit(limit)]
    unread = coll.count_documents({"owner_id": {"$in": owners}, "read": False})
    latest = coll.find_one({"owner_id": {"$in": owners}}, sort=[("_id", -1)])
    return {"items": items, "unread": unread, "latest": str(latest["_id"]) if latest else None}


def mark_read(owner_ids: Iterable[str], ids: Optional[List[str]] = None, everything: bool = False) -> int:
    owners = [str(o) for o in owner_ids if o]
    query = {"owner_id": {"$in": owners}, "read": False}
    if not everything:
        object_ids = []
        for i in ids or []:
            try:
                object_ids.append(ObjectId(i))
            except Exception:
                continue
        if not object_ids:
            return _coll().count_documents(query)
        query["_id"] = {"$in": object_ids}
    coll = _coll()
    coll.update_many(query, {"$set": {"read": True}})
    return coll.count_documents({"owner_id": {"$in": owners}, "read": False})


# ── What gets recorded ──────────────────────────────────────────────────────

def _kind(task: dict) -> str:
    if task.get("media_job_id") or task.get("group_type") == "media":
        return "media"
    if task.get("instagram_shortcode") or task.get("group_type") == "instagram":
        return "instagram"
    return "transfer"


_WHAT = {"media": "Video download", "instagram": "Instagram import", "transfer": "Transfer"}


def _folder_target(path: Optional[str]) -> dict:
    path = path or "/Home"
    if path.startswith("/Vault"):
        return {"type": "transfers"}  # a notification never opens the vault
    return {"type": "folder", "path": path}


def task_finished(task_id: str) -> None:
    """Called when a transfer task reaches completed or failed. A group (folder leech, playlist,
    Instagram carousel, a big file sent in parts) gives one event, when its last task is done."""
    try:
        from telestore.services.remote_transfer_manager.helpers import get_remote_db
        coll = get_remote_db()["RemoteTransfers"]
        task = coll.find_one({"task_id": task_id})
        if not task or task.get("status") not in ("completed", "failed"):
            return
        owner = task.get("user_id")
        kind = _kind(task)
        what = _WHAT[kind]
        group_id = task.get("group_id")
        if group_id:
            if coll.count_documents({"group_id": group_id, "status": {"$nin": list(FINAL)}}):
                return  # more to come
            done = coll.count_documents({"group_id": group_id, "status": "completed"})
            failed = coll.count_documents({"group_id": group_id, "status": "failed"})
            name = task.get("group_name") or task.get("filename") or "Folder"
            if task.get("part_index") and not task.get("group_name"):
                name = task.get("filename") or name  # a big file sent in parts
            if failed and not done:
                title, body = f"{what} failed", f"{name}: none of the {failed} file(s) could be saved."
            elif failed:
                title, body = f"{what} finished with problems", f"{name}: {done} saved, {failed} failed."
            else:
                title, body = f"{what} finished", f"{name}: {done} file(s) saved." if done != 1 else f"{name} saved."
            target = {"type": "transfers"} if failed else _folder_target(task.get("destination_path"))
            record(owner, kind, title, body, target, dedupe=f"group:{group_id}")
        else:
            name = task.get("filename") or "File"
            if task["status"] == "failed":
                reason = (task.get("error_message") or "").strip()
                record(owner, kind, f"{what} failed", f"{name}: {reason[:200]}" if reason else name, {"type": "transfers"}, dedupe=f"task:{task_id}")
            else:
                record(owner, kind, f"{what} finished", f"{name} saved.", _folder_target(task.get("destination_path")), dedupe=f"task:{task_id}")
        storage_check(owner)
    except Exception as e:
        logger.warning(f"Couldn't record the finish of {task_id}: {e}")


def playlist_sync(owner: str, title: str, count: int, destination: Optional[str] = None) -> None:
    if count > 0:
        record(owner, "playlist_sync", f"{count} new video{'s' if count != 1 else ''}", f"From “{title}”, downloading now.", {"type": "transfers"})


def inbox_file(owner: str, file_name: str, chat_id=None, message_id=None) -> None:
    record(owner, "inbox", "New file in Telegram Inbox", file_name, {"type": "folder", "path": "/Telegram Inbox"},
           dedupe=f"inbox:{chat_id}:{message_id}" if chat_id and message_id else None)


def storage_check(owner: str) -> None:
    """Warns once a week when the account uses 90% or more of its storage."""
    try:
        from telestore.config import STORAGE_QUOTA_BYTES
        from telestore.db import database
        used = database.Files.used_bytes(str(owner))
        if not STORAGE_QUOTA_BYTES or used < STORAGE_WARN_AT * STORAGE_QUOTA_BYTES:
            return
        week = _now().strftime("%G-%V")
        percent = int(used * 100 / STORAGE_QUOTA_BYTES)
        record(owner, "storage", "Storage almost full", f"{percent}% of your storage is used.", {"type": "settings"}, dedupe=f"storage:{owner}:{week}")
    except Exception as e:
        logger.warning(f"Storage check for {owner}: {e}")


_AGENT = [(re.compile(p, re.I), name) for p, name in (
    (r"edg/", "Edge"), (r"opr/|opera", "Opera"), (r"firefox/", "Firefox"), (r"chrome/", "Chrome"), (r"safari/", "Safari"),
)]
_OS = [(re.compile(p, re.I), name) for p, name in (
    (r"android", "Android"), (r"iphone|ipad", "iOS"), (r"windows", "Windows"), (r"mac os", "macOS"), (r"linux", "Linux"),
)]


def device_label(user_agent: str = "", device: Optional[str] = None) -> str:
    """"the Android app", "Chrome on Windows"… from the sign-in request."""
    if device:
        return f"the {device.capitalize()} app"
    browser = next((n for p, n in _AGENT if p.search(user_agent or "")), None)
    system = next((n for p, n in _OS if p.search(user_agent or "")), None)
    if browser and system:
        return f"{browser} on {system}"
    return browser or system or "a new device"


def sign_in(owner: str, user_agent: str = "", device: Optional[str] = None, method: str = "password") -> None:
    how = "with Google" if method == "google" else ""
    record(owner, "sign_in", "New sign-in", " ".join(f"Your account was signed in to on {device_label(user_agent, device)} {how}".split()) + ".",
           {"type": "settings"})
