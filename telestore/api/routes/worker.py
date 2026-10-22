# telestore/api/routes/worker.py

from fastapi import APIRouter, Request, HTTPException, Header, Depends, status
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
    elif ext in ['.mp3', '.wav', '.ogg', '.flac', '.m4a']:
        return "audio"
    elif ext in ['.jpg', '.jpeg', '.png', '.gif', '.webp']:
        return "photo"
    return "document"

logger = logging.getLogger("worker_routes")

LOCAL_ONLY_SOURCES = ("instagram",)

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


class ProgressUpdateModel(BaseModel):
    task_id: str
    worker_id: str
    transferred_bytes: int
    filesize: int
    speed_bps: int
    progress: float
    eta_seconds: int
    phase: str


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


@router.get("/nodes")
async def list_worker_nodes():
    """Public/Admin endpoint to view active distributed workers and their health."""
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
            "status": "online" if is_online else "offline"
        })
    return {"nodes": result, "count": len(result)}


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
            # Instagram imports need the server's Instagram session, so only the main server runs them
            "source_type": {"$nin": list(LOCAL_ONLY_SOURCES)},
        },
        {
            "$set": {
                "status": "downloading",
                "claimed_by": body.worker_id,
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

    # Allocate dedicated bot tokens for this worker (using bot tokens from index 6 onwards if available)
    worker_tokens = TOKENS[6:] if len(TOKENS) >= 7 else TOKENS

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
            "total_filesize": doc.get("total_filesize")
        },
        "telegram_config": {
            "api_id": API_ID,
            "api_hash": API_HASH,
            "tokens": worker_tokens
        }
    }


@router.post("/update-progress")
async def update_progress(
    body: ProgressUpdateModel,
    auth: None = Depends(verify_worker_auth)
):
    """Worker progress reporting endpoint."""
    coll = get_remote_db()["RemoteTransfers"]
    now = datetime.now(timezone.utc)

    # Check if task was cancelled
    task = coll.find_one({"task_id": body.task_id}, {"status": 1})
    if task and task.get("status") in ["cancelled", "failed"]:
        return {"status": "cancelled"}

    coll.update_one(
        {"task_id": body.task_id},
        {
            "$set": {
                "transferred_bytes": body.transferred_bytes,
                "filesize": body.filesize,
                "speed_bps": body.speed_bps,
                "progress": body.progress,
                "eta_seconds": body.eta_seconds,
                "phase": f"[{body.worker_id}] {body.phase}",
                "updated_at": now
            }
        }
    )
    return {"status": "ok"}


@router.post("/complete-task")
async def complete_task(
    body: CompleteTaskModel,
    auth: None = Depends(verify_worker_auth)
):
    """Called by the worker when file download and Telegram upload are successfully finished."""
    coll = get_remote_db()["RemoteTransfers"]
    now = datetime.now(timezone.utc)

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

        logger.info(f"[WORKER_COMPLETE] Range part task {body.task_id} completed via {body.worker_id}")
        return {"status": "ok"}

    # 1. Create target folder structure in database
    database.Files.create_folder_path(body.destination_path, owner_id=str(body.user_id))
    file_type = get_file_type(body.file_name)

    # 2. Add file record to Files collection
    if not body.is_multipart and body.message_id:
        database.Files.add_file(
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

    # 3. Mark RemoteTransfers record as completed
    coll.update_one(
        {"task_id": body.task_id},
        {
            "$set": {
                "status": "completed",
                "progress": 100,
                "transferred_bytes": body.file_size,
                "filesize": body.file_size,
                "phase": f"Completed via {body.worker_id} 🎉",
                "error_message": None,
                "updated_at": now
            }
        }
    )

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

    if body.is_quota_error:
        # Put task in 24h cooldown paused_quota
        cooldown_until = now + timedelta(hours=24)
        target_time = cooldown_until.strftime("%H:%M UTC")
        coll.update_one(
            {"task_id": body.task_id},
            {
                "$set": {
                    "status": "paused_quota",
                    "cooldown_until": cooldown_until,
                    "phase": f"Google Drive quota reached on {body.worker_id}. Auto-resumes at {target_time} 🕒",
                    "error_message": body.error_message,
                    "updated_at": now
                },
                "$unset": {"claimed_by": "", "claimed_at": ""}
            }
        )
        logger.warning(f"[WORKER_QUOTA] Task {body.task_id} hit Google Drive quota on {body.worker_id}. Paused for 24h.")
    else:
        coll.update_one(
            {"task_id": body.task_id},
            {
                "$set": {
                    "status": "failed",
                    "error_message": f"[{body.worker_id}] {body.error_message}",
                    "phase": f"Failed: {body.error_message[:60]}",
                    "updated_at": now
                }
            }
        )
        logger.error(f"[WORKER_FAIL] Task {body.task_id} failed on {body.worker_id}: {body.error_message}")

    return {"status": "ok"}
