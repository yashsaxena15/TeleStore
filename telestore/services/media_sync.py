# telestore/services/media_sync.py
"""Synced playlists and channels: new videos are downloaded by themselves.

When someone downloads a playlist or channel with "Also download new videos automatically", the
link, their choices and every video it holds right then are saved. Every few hours the server
reads the link again and queues only the videos it hasn't seen before, one link at a time with a
pause between them so YouTube isn't flooded.
"""

import asyncio
import os
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from d4rk.Logs import setup_logger

logger = setup_logger("media_sync")

CHECK_EVERY = timedelta(hours=float(os.getenv("MEDIA_SYNC_HOURS", "6")))
MAX_SYNCS_PER_USER = 10
MAX_NEW_PER_CHECK = 50
PAUSE_BETWEEN_LINKS_S = 30


def _coll():
    from telestore.services.remote_transfer_manager.helpers import get_remote_db
    return get_remote_db()["MediaSyncs"]


def _public(doc: dict) -> dict:
    return {
        "id": doc["sync_id"],
        "title": doc.get("title"),
        "url": doc.get("url"),
        "is_channel": bool(doc.get("is_channel")),
        "choice": doc.get("choice"),
        "destination_label": doc.get("destination_label"),
        "enabled": bool(doc.get("enabled", True)),
        "known_count": len(doc.get("seen_urls") or []),
        "last_checked": doc["last_checked"].isoformat() if isinstance(doc.get("last_checked"), datetime) else None,
        "last_new_count": doc.get("last_new_count", 0),
        "last_error": doc.get("last_error"),
    }


def count_for(user_id: str) -> int:
    return _coll().count_documents({"user_id": str(user_id)})


def create(user_id: str, info: Dict[str, Any], choice: Dict[str, Any], destination: Dict[str, Any], chat_id: Optional[int]) -> dict:
    """Starts syncing a playlist; every video it holds now counts as seen."""
    now = datetime.now(timezone.utc)
    if destination["kind"] == "gdrive":
        label = destination.get("label") or "Google Drive"
    else:
        label = destination["path"].replace("/Vault", "Private Vault", 1) if destination["kind"] == "vault" else destination["path"]
    doc = {
        "sync_id": f"sync_{secrets.token_hex(6)}",
        "user_id": str(user_id),
        "url": info["url"],
        "title": info.get("title"),
        "is_channel": bool(info.get("is_channel")),
        "choice": choice,
        "destination": destination,
        "destination_label": label,
        "chat_id": chat_id,
        "seen_urls": [e["url"] for e in info["entries"]],
        "enabled": True,
        "last_checked": now,
        "last_new_count": 0,
        "last_error": None,
        "created_at": now,
    }
    existing = _coll().find_one({"user_id": str(user_id), "url": info["url"]})
    if existing:
        # Syncing the same link again just updates its choices
        _coll().update_one({"sync_id": existing["sync_id"]}, {"$set": {k: doc[k] for k in ("choice", "destination", "destination_label", "chat_id", "title")} | {"enabled": True},
                                                            "$addToSet": {"seen_urls": {"$each": doc["seen_urls"]}}})
        return _public(_coll().find_one({"sync_id": existing["sync_id"]}))
    _coll().insert_one(doc)
    return _public(doc)


def list_for(user_id: str) -> List[dict]:
    return [_public(d) for d in _coll().find({"user_id": str(user_id)}).sort("created_at", -1)]


def set_enabled(user_id: str, sync_id: str, enabled: bool) -> Optional[dict]:
    res = _coll().update_one({"user_id": str(user_id), "sync_id": sync_id}, {"$set": {"enabled": bool(enabled)}})
    return _public(_coll().find_one({"sync_id": sync_id})) if res.matched_count else None


def remove(user_id: str, sync_id: str) -> bool:
    return _coll().delete_one({"user_id": str(user_id), "sync_id": sync_id}).deleted_count > 0


async def check(doc: dict) -> int:
    """Reads one synced link and queues the videos it hasn't seen; returns how many."""
    from telestore.services import media_download_service as media
    from telestore.services.remote_transfer_manager import remote_transfer_manager

    now = datetime.now(timezone.utc)
    try:
        info = await media.probe(doc["url"], limit=media.MAX_SYNC_ITEMS)
    except media.MediaError as e:
        _coll().update_one({"sync_id": doc["sync_id"]}, {"$set": {"last_checked": now, "last_error": str(e)}})
        return 0
    seen = set(doc.get("seen_urls") or [])
    new = [e for e in info["entries"] if e["url"] not in seen][:MAX_NEW_PER_CHECK]
    if new:
        remote_transfer_manager.enqueue_media(doc["user_id"], {**info, "title": f"{info.get('title') or 'Playlist'} (new)"}, new, doc["choice"], doc["destination"], doc.get("chat_id"))
        logger.info(f"[SYNC] {len(new)} new video(s) from '{info.get('title')}' for user {doc['user_id']}")
    _coll().update_one({"sync_id": doc["sync_id"]}, {
        "$set": {"last_checked": now, "last_new_count": len(new), "last_error": None},
        "$addToSet": {"seen_urls": {"$each": [e["url"] for e in new]}},
    })
    return len(new)


async def run_forever():
    """Checks synced links that are due, one at a time; runs for the life of the server."""
    await asyncio.sleep(60)
    while True:
        try:
            due = list(_coll().find({"enabled": True, "last_checked": {"$lte": datetime.now(timezone.utc) - CHECK_EVERY}}).sort("last_checked", 1).limit(20))
            for doc in due:
                await check(doc)
                await asyncio.sleep(PAUSE_BETWEEN_LINKS_S)
        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.warning(f"Synced playlists check failed: {e}")
        await asyncio.sleep(600)
