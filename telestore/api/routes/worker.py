# telestore/api/routes/worker.py

from telestore.services.remote_transfer_manager.helpers import friendly_error, google_limit_pause
from telestore.services import event_service
from fastapi import APIRouter, Request, HTTPException, Header, Depends, status
from telestore.security.credentials import require_admin
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
from datetime import datetime, timezone, timedelta
import os
import logging
from pymongo import ReturnDocument

from telestore.config import API_ID, API_HASH, TOKENS, WORKER_SECRET_KEY
from telestore.db import database
from telestore.services.remote_transfer_manager import get_remote_db

def get_file_type(fname: str) -> str:
    ext = os.path.splitext(fname)[1].lower()
    if ext in ['.mp4', '.mkv', '.avi', '.mov', '.webm']:
        return "video"
    elif ext in ['.mp3', '.wav', '.ogg', '.flac', '.m4a', '.opus', '.aac']:
        return "audio"
    elif ext in ['.jpg', '.jpeg', '.png', '.gif', '.webp']:
        return "photo"
    return "document"

logger = logging.getLogger("worker_routes")

# Only the main server runs these: Instagram and video downloads need its sign-in sessions, and
# torrents need its torrent downloader (a worker machine has none, so it would only fail them)
LOCAL_ONLY_SOURCES = ("instagram", "media", "magnet", "torrent_file")
# One file of a torrent (the main server splits torrents): for workers that can do torrents
# (libtorrent or aria2c). One 1.95 GB part of a big torrent file: only with libtorrent.
TORRENT_SOURCES = ("torrent_item", "torrent_part")

router = APIRouter(prefix="/api/worker", tags=["Distributed Workers"])


def verify_worker_auth(x_worker_key: Optional[str] = Header(None, alias="X-Worker-Key")):
    """Verifies that the incoming request has the valid WORKER_SECRET_KEY."""
    if not x_worker_key or x_worker_key != WORKER_SECRET_KEY:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing X-Worker-Key header"
        )


class HeartbeatModel(BaseModel):
    worker_id: str
    specs: Optional[Dict[str, Any]] = None
    ip: Optional[str] = None


class ClaimTaskModel(BaseModel):
    worker_id: str
    # What this worker can do beyond plain downloads: "torrent" (a torrent's file, with libtorrent or
    # aria2c) and "torrent_parts" (one part of a big torrent file, libtorrent only). Older workers
    # send nothing and are never given either.
    skills: List[str] = []


class ProgressUpdateModel(BaseModel):
    task_id: str
    worker_id: str
    transferred_bytes: int
    filesize: int
    speed_bps: int
    progress: float
    eta_seconds: int
    phase: str
    # Newer workers: the step ("download" or "upload") and each side's speed now
    stage: Optional[str] = None
    download_bps: Optional[int] = None
    upload_bps: Optional[int] = None


class CompleteTaskModel(BaseModel):
    task_id: str
    worker_id: str
    user_id: str
    chat_id: int
    destination_path: str
    file_name: str
    file_size: int
    is_vault: bool = False
    is_multipart: bool = False
    is_range_part: bool = False
    is_torrent_part: bool = False  # one part of a big torrent file (part_info says which)
    is_empty: bool = False  # a 0-byte file: nothing was sent to Telegram, it is saved as a record
    part_info: Optional[Dict[str, Any]] = None
    # Single part:
    message_id: Optional[int] = None
    file_unique_id: Optional[str] = None
    thumbnail: Optional[str] = None
    # Multi part:
    parts: Optional[List[Dict[str, Any]]] = None
    part_size: Optional[int] = None


class FailTaskModel(BaseModel):
    task_id: str
    worker_id: str
    error_message: str
    is_quota_error: bool = False


@router.post("/heartbeat")
async def worker_heartbeat(
    body: HeartbeatModel,
    request: Request,
    auth: None = Depends(verify_worker_auth)
):
    coll = get_remote_db()["WorkerNodes"]
    now = datetime.now(timezone.utc)
    client_ip = body.ip or request.client.host

    coll.update_one(
        {"worker_id": body.worker_id},
        {
            "$set": {
                "worker_id": body.worker_id,
                "ip": client_ip,
                "specs": body.specs or {},
                "last_seen": now,
                "status": "online"
            }
        },
        upsert=True
    )
    return {"status": "ok", "timestamp": now.isoformat()}


@router.get("/torrent/{task_id}")
async def torrent_details(task_id: str, worker_id: str, auth: None = Depends(verify_worker_auth)):
    """The .torrent of a torrent file transfer, for the worker that claimed it."""
    from fastapi.responses import FileResponse
    doc = get_remote_db()["RemoteTransfers"].find_one({"task_id": task_id})
    if not doc or doc.get("source_type") not in TORRENT_SOURCES or doc.get("claimed_by") != worker_id:
        raise HTTPException(status_code=404, detail="Not a torrent transfer of this worker")
    path = doc.get("torrent_path")
    if not path or not os.path.isfile(path):
        raise HTTPException(status_code=410, detail="The torrent's details are gone from the server")
    return FileResponse(path, media_type="application/x-bittorrent", filename=f"{task_id}.torrent")


@router.get("/nodes")
async def list_worker_nodes(admin: bool = Depends(require_admin)):
    """Admin view of the distributed workers and their health (their names and addresses aren't public)."""
    coll = get_remote_db()["WorkerNodes"]
    now = datetime.now(timezone.utc)
    stale_limit = now - timedelta(seconds=60)

    nodes = list(coll.find({}))
    result = []
    for n in nodes:
        last_seen = n.get("last_seen")
        if last_seen and last_seen.tzinfo is None:
            last_seen = last_seen.replace(tzinfo=timezone.utc)
        is_online = bool(last_seen and last_seen >= stale_limit)
        result.append({
            "worker_id": n.get("worker_id"),
            "ip": n.get("ip"),
            "specs": n.get("specs"),
            "last_seen": last_seen.isoformat() if last_seen else None,
            "status": "online" if is_online else "offline",
            "bot": n.get("bot_slot"),  # which of the workers' bots it sends with (0 = the first)
        })
    return {"nodes": result, "count": len(result)}


def tokens_for_worker(worker_id: str) -> List[str]:
    """The bots set aside for workers (from the 7th on, if there are 7 or more), with this worker's own
    bot first: a worker sends with the first one, so two workers don't share a bot. Each worker keeps
    its bot (stored on its WorkerNodes record); a new worker gets one no other worker has, or the one
    fewest workers share once every bot is taken."""
    pool = list(TOKENS[6:] if len(TOKENS) >= 7 else TOKENS)
    if len(pool) <= 1:
        return pool
    try:
        nodes = get_remote_db()["WorkerNodes"]
        node = nodes.find_one({"worker_id": worker_id}) or {}
        slot = node.get("bot_slot")
        if not isinstance(slot, int) or not 0 <= slot < len(pool):
            used = [0] * len(pool)
            for other in nodes.find({"worker_id": {"$ne": worker_id}, "bot_slot": {"$exists": True}}):
                s = other.get("bot_slot")
                if isinstance(s, int) and 0 <= s < len(pool):
                    used[s] += 1
            slot = used.index(min(used))
            nodes.update_one({"worker_id": worker_id}, {"$set": {"worker_id": worker_id, "bot_slot": slot}}, upsert=True)
    except Exception as e:  # never stop a claim over this: the shared first bot, as before
        logger.warning(f"[WORKER_CLAIM] Couldn't pick a bot of its own for {worker_id}: {e}")
        return pool
    return pool[slot:] + pool[:slot]


@router.post("/claim-task")
async def claim_task(
    body: ClaimTaskModel,
    auth: None = Depends(verify_worker_auth)
):
    """Atomically claim an available queued remote transfer task for an external worker."""
    coll = get_remote_db()["RemoteTransfers"]
    now = datetime.now(timezone.utc)

    # Atomically find and claim the oldest queued task that hasn't been claimed yet
    doc = coll.find_one_and_update(
        {
            "status": "queued",
            "claimed_by": {"$exists": False},
            # Instagram and video downloads need the server's sign-in sessions, so only the main server runs them
            "source_type": {"$nin": list(LOCAL_ONLY_SOURCES)
                            + ([] if "torrent" in body.skills else ["torrent_item"])
                            + ([] if "torrent_parts" in body.skills else ["torrent_part"])},
            # Copies from a connected Google Drive need that account's sign-in, which stays on the main server
            "cloud_account_id": {"$exists": False},
            # A torrent's file the main server has partly downloaded already: it finishes it
            "main_only": {"$ne": True},
        },
        {
            "$set": {
                "status": "downloading",
                "claimed_by": body.worker_id,
                "worker": body.worker_id,
                "claimed_at": now,
                "phase": f"Leeching via Worker ({body.worker_id})",
                "updated_at": now
            }
        },
        sort=[("created_at", 1)],
        return_document=ReturnDocument.AFTER
    )

    if not doc:
        return {"has_task": False, "task": None}

    logger.info(f"[WORKER_CLAIM] Task {doc['task_id']} ('{doc.get('filename')}') claimed by worker {body.worker_id}")

    worker_tokens = tokens_for_worker(body.worker_id)

    return {
        "has_task": True,
        "task": {
            "task_id": doc["task_id"],
            "source_url": doc["source_url"],
            "source_type": doc.get("source_type", "direct"),
            "gdrive_id": doc.get("gdrive_id"),
            "filename": doc.get("filename"),
            "filesize": doc.get("filesize", 0),
            "destination_path": doc.get("destination_path", "/Home"),
            "chat_id": doc.get("chat_id"),
            "user_id": doc.get("user_id"),
            "is_vault": doc.get("is_vault", False),
            "group_id": doc.get("group_id"),
            "group_name": doc.get("group_name"),
            "is_range_part": doc.get("is_range_part", False),
            "range_start": doc.get("range_start", 0),
            "range_end": doc.get("range_end"),
            "part_index": doc.get("part_index", 1),
            "total_parts": doc.get("total_parts", 1),
            "part_size": doc.get("part_size", doc.get("filesize", 0)),
            "total_filesize": doc.get("total_filesize"),
            # One file of a torrent: which file, and where it sits inside the torrent
            "torrent_file_index": doc.get("torrent_file_index"),
            "torrent_rel_path": doc.get("torrent_rel_path"),
            # One part of a big torrent file
            "torrent_file_name": doc.get("torrent_file_name"),
            "torrent_file_size": doc.get("torrent_file_size"),
            "part_start": doc.get("part_start"),
        },
        "telegram_config": {
            "api_id": API_ID,
            "api_hash": API_HASH,
            "tokens": worker_tokens
        }
    }


def _still_theirs(task_id: str, worker_id: str) -> dict:
    """The task, while [worker_id] may still report on it: claimed by it, or put back in the queue
    (watchdog, server restart) while it was busy and not started again elsewhere. A task another
    machine has taken, or that was cancelled, failed or finished, isn't theirs any more."""
    return {"task_id": task_id, "$or": [
        {"claimed_by": worker_id, "status": {"$in": ["downloading", "uploading_tg"]}},
        {"claimed_by": {"$exists": False}, "status": "queued"},
    ]}


@router.post("/update-progress")
async def update_progress(
    body: ProgressUpdateModel,
    auth: None = Depends(verify_worker_auth)
):
    """Worker progress reporting endpoint."""
    coll = get_remote_db()["RemoteTransfers"]
    now = datetime.now(timezone.utc)

    res = coll.update_one(
        _still_theirs(body.task_id, body.worker_id),
        {
            "$set": {
                "status": "uploading_tg" if body.stage == "upload" else "downloading",
                "claimed_by": body.worker_id,
                "worker": body.worker_id,
                "transferred_bytes": body.transferred_bytes,
                "filesize": body.filesize,
                "speed_bps": body.speed_bps,
                # Older workers send one speed: it is the step they are on
                "download_bps": body.download_bps if body.download_bps is not None else (0 if body.stage == "upload" else body.speed_bps),
                "upload_bps": body.upload_bps if body.upload_bps is not None else (body.speed_bps if body.stage == "upload" else 0),
                "progress": body.progress,
                "eta_seconds": body.eta_seconds,
                "phase": f"[{body.worker_id}] {body.phase}",
                "updated_at": now
            }
        }
    )
    if not res.matched_count:  # cancelled, or another machine has it now: the worker stops
        return {"status": "cancelled"}
    return {"status": "ok"}


@router.post("/complete-task")
async def complete_task(
    body: CompleteTaskModel,
    auth: None = Depends(verify_worker_auth)
):
    """Called by the worker when file download and Telegram upload are successfully finished."""
    coll = get_remote_db()["RemoteTransfers"]
    now = datetime.now(timezone.utc)

    # Only the machine that has the task saves it: a late report (another machine took the task over)
    # would add a second copy of the file
    if not coll.find_one_and_update(
        _still_theirs(body.task_id, body.worker_id),
        {"$set": {"status": "uploading_tg", "claimed_by": body.worker_id, "phase": "Saving…", "updated_at": now}},
    ):
        logger.warning(f"[WORKER_LATE] Task {body.task_id} finished on {body.worker_id}, but it isn't theirs any more. Ignored.")
        return {"status": "ignored"}

    # One part of a big torrent file: the file is saved once its last part is in
    if body.is_torrent_part and body.part_info:
        p_sz = int(body.part_info.get("part_size") or 0)
        coll.update_one({"task_id": body.task_id}, {"$set": {
            "status": "completed", "progress": 100.0, "transferred_bytes": p_sz, "filesize": p_sz,
            "speed_bps": 0, "download_bps": 0, "upload_bps": 0, "eta_seconds": 0,
            "completed_part_info": body.part_info,
            "phase": f"Part {body.part_info.get('part_index', 1)} saved via {body.worker_id} ☁️",
            "updated_at": now,
        }})
        task_doc = coll.find_one({"task_id": body.task_id})
        if task_doc and task_doc.get("torrent_file_key"):
            from telestore.services.remote_transfer_manager.helpers import finalize_torrent_file_if_ready
            finalize_torrent_file_if_ready(task_doc["torrent_file_key"])
        event_service.task_finished(body.task_id)
        logger.info(f"[WORKER_COMPLETE] Torrent part task {body.task_id} completed via {body.worker_id}")
        return {"status": "ok"}

    # Multi-Range Chunk Part completion:
    if body.is_range_part and body.part_info:
        p_sz = body.part_info.get("part_size", body.file_size)
        coll.update_one(
            {"task_id": body.task_id},
            {
                "$set": {
                    "status": "completed",
                    "progress": 100.0,
                    "transferred_bytes": p_sz,
                    "filesize": p_sz,
                    "speed_bps": 0,
                    "eta_seconds": 0,
                    "completed_part_info": body.part_info,
                    "phase": f"Part {body.part_info.get('part_index', 1)} completed via {body.worker_id} 🎉",
                    "updated_at": now
                }
            }
        )
        task_doc = coll.find_one({"task_id": body.task_id})
        group_id = task_doc.get("group_id") if task_doc else None
        if group_id:
            from telestore.services.remote_transfer_manager import finalize_multipart_group_if_ready
            await finalize_multipart_group_if_ready(group_id, task_doc)

        event_service.task_finished(body.task_id)
        logger.info(f"[WORKER_COMPLETE] Range part task {body.task_id} completed via {body.worker_id}")
        return {"status": "ok"}

    # Saving the file record must work, or the transfer fails (it never looks finished while missing)
    try:
        # 1. Create target folder structure in database
        database.Files.create_folder_path(body.destination_path, owner_id=str(body.user_id))
        file_type = get_file_type(body.file_name)

        # 2. Add file record to Files collection
        if body.is_empty:
            database.Files.save_empty(body.file_name, body.destination_path, str(body.user_id), file_type=file_type,
                                      is_vault=body.is_vault, key=body.task_id)
        elif not body.is_multipart and body.message_id:
            database.Files.claim_upload(
                chat_id=body.chat_id,
                message_id=body.message_id,
                thumbnail=body.thumbnail,
                file_type=file_type,
                file_unique_id=body.file_unique_id or f"uniq_{body.message_id}",
                file_size=body.file_size,
                file_name=body.file_name,
                file_caption=f"Uploaded file: {body.file_name}",
                file_path=body.destination_path,
                owner_id=str(body.user_id),
                is_vault=body.is_vault
            )
        else:
            parts = body.parts or []
            first_unique = parts[0]["file_unique_id"] if parts else "multipart_worker"
            database.Files.add_multipart_file(
                chat_id=body.chat_id,
                thumbnail=body.thumbnail,
                file_type=file_type,
                file_unique_id=first_unique,
                file_size=body.file_size,
                file_name=body.file_name,
                file_caption=f"Uploaded multi-part file: {body.file_name}",
                parts=parts,
                file_path=body.destination_path,
                owner_id=str(body.user_id),
                part_size=body.part_size or (1950 * 1024 * 1024),
                is_vault=body.is_vault
            )

    except Exception as e:
        logger.error(f"[WORKER_COMPLETE] Task {body.task_id}: '{body.file_name}' reached Telegram but couldn't be saved: {e}")
        coll.update_one({"task_id": body.task_id}, {"$set": {
            "status": "failed", "error_message": f"'{body.file_name}' couldn't be saved to {body.destination_path}. Tap Retry.",
            "error_detail": f"[{body.worker_id}] {e}"[:2000], "phase": "Failed: couldn't save the file", "updated_at": now,
        }})
        event_service.task_finished(body.task_id)
        return {"status": "failed"}

    # 3. Mark RemoteTransfers record as completed
    coll.update_one(
        {"task_id": body.task_id},
        {
            "$set": {
                "status": "completed",
                "progress": 100,
                "transferred_bytes": body.file_size,
                "filesize": body.file_size,
                "phase": f"Completed via {body.worker_id} 🎉" if not body.is_empty else f"Completed via {body.worker_id} (an empty file, 0 bytes)",
                "speed_bps": 0, "download_bps": 0, "upload_bps": 0, "eta_seconds": 0,
                "error_message": None,
                "updated_at": now
            }
        }
    )

    event_service.task_finished(body.task_id)
    logger.info(f"[WORKER_COMPLETE] Task {body.task_id} ('{body.file_name}') successfully completed via {body.worker_id}")
    return {"status": "ok"}


@router.post("/fail-task")
async def fail_task(
    body: FailTaskModel,
    auth: None = Depends(verify_worker_auth)
):
    """Called by worker if download or upload failed."""
    coll = get_remote_db()["RemoteTransfers"]
    now = datetime.now(timezone.utc)
    theirs = _still_theirs(body.task_id, body.worker_id)

    if not coll.find_one(theirs, {"_id": 1}):  # another machine has it now: its result counts
        logger.warning(f"[WORKER_LATE] Task {body.task_id} failed on {body.worker_id}, but it isn't theirs any more. Ignored.")
        return {"status": "ignored"}

    if body.is_quota_error:
        # Only this file waits for Google's limit (it is per file); the queue resumes it by itself
        task = coll.find_one({"task_id": body.task_id}, {"quota_hits": 1}) or {}
        coll.update_one(theirs, google_limit_pause(task, now, body.worker_id))
        logger.warning(f"[WORKER_QUOTA] Task {body.task_id} hit Google Drive's limit on {body.worker_id}. Only this file waits.")
    else:
        coll.update_one(
            theirs,
            {
                "$set": {
                    "status": "failed",
                    "error_message": friendly_error(body.error_message),
                    "error_detail": f"[{body.worker_id}] {body.error_message}"[:2000],
                    "phase": f"Failed: {body.error_message[:60]}",
                    "speed_bps": 0, "download_bps": 0, "upload_bps": 0,
                    "updated_at": now
                }
            }
        )
        event_service.task_finished(body.task_id)
        logger.error(f"[WORKER_FAIL] Task {body.task_id} failed on {body.worker_id}: {body.error_message}")

    return {"status": "ok"}
