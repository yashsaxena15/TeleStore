"""Pausing and resuming the machines that run cloud transfers (Transfers › Workers, owner only).

A paused machine takes no new transfers. What it is running either finishes (the default) or, with
"stop now", goes back to the queue right away for the other machines. The main server is one of the
machines too ("master-vm1"); the others are the worker machines that report in (WorkerNodes)."""

import time
from datetime import datetime, timedelta, timezone
from typing import Optional

MAIN_ID = "master-vm1"
RUNNING = ["downloading", "uploading_tg"]
ONLINE_WITHIN = timedelta(seconds=60)
_CACHE_S = 3.0
_cache: dict = {}


def _db():
    from telestore.services.remote_transfer_manager.helpers import get_remote_db
    return get_remote_db()


def is_paused(worker_id: str, db=None, cached: bool = False) -> bool:
    if cached:
        hit = _cache.get(worker_id)
        if hit and time.monotonic() - hit[1] < _CACHE_S:
            return hit[0]
    doc = (_db() if db is None else db)["WorkerNodes"].find_one({"worker_id": worker_id}) or {}
    paused = bool(doc.get("paused"))
    _cache[worker_id] = (paused, time.monotonic())
    return paused


def set_paused(worker_id: str, paused: bool, db=None) -> None:
    now = datetime.now(timezone.utc)
    fields = {"worker_id": worker_id, "paused": paused, "paused_at" if paused else "resumed_at": now}
    (_db() if db is None else db)["WorkerNodes"].update_one({"worker_id": worker_id}, {"$set": fields}, upsert=True)
    _cache.pop(worker_id, None)


def hand_back(worker_id: str, db=None) -> int:
    """Puts what [worker_id] is running back in the queue, for the other machines. A worker machine
    sees it's no longer theirs on its next progress report and stops. Returns how many."""
    now = datetime.now(timezone.utc)
    res = (_db() if db is None else db)["RemoteTransfers"].update_many(
        {"claimed_by": worker_id, "status": {"$in": RUNNING}},
        {"$set": {"status": "queued", "phase": "Re-queued (its machine was paused)", "speed_bps": 0,
                  "download_bps": 0, "upload_bps": 0, "updated_at": now},
         "$unset": {"claimed_by": "", "claimed_at": ""}})
    return int(getattr(res, "modified_count", 0) or 0)


def _aware(t: Optional[datetime]) -> Optional[datetime]:
    return t.replace(tzinfo=timezone.utc) if t is not None and t.tzinfo is None else t


def overview(db=None) -> list:
    """Every machine, the main server first: online or not, paused or not, how many transfers it runs."""
    db = _db() if db is None else db
    now = datetime.now(timezone.utc)
    running: dict = {}
    for doc in db["RemoteTransfers"].aggregate([
            {"$match": {"status": {"$in": RUNNING}, "claimed_by": {"$exists": True}}},
            {"$group": {"_id": "$claimed_by", "n": {"$sum": 1}}}]):
        running[doc["_id"]] = doc["n"]
    nodes = {n.get("worker_id"): n for n in db["WorkerNodes"].find({}) if n.get("worker_id")}
    main = nodes.pop(MAIN_ID, {})
    out = [{"worker_id": MAIN_ID, "name": "Main server", "is_main": True, "online": True,
            "paused": bool(main.get("paused")), "running": running.get(MAIN_ID, 0), "last_seen": now.isoformat()}]
    for wid in sorted(nodes):
        n = nodes[wid]
        seen = _aware(n.get("last_seen"))
        out.append({"worker_id": wid, "name": wid, "is_main": False,
                    "online": bool(seen and now - seen <= ONLINE_WITHIN), "paused": bool(n.get("paused")),
                    "running": running.get(wid, 0), "last_seen": seen.isoformat() if seen else None})
    return out
