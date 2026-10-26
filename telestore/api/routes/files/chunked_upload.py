# telestore/api/routes/files/chunked_upload.py
"""Chunked uploads from the website, for files of any size (including 2 GB and more).

The browser sends 20 MB chunks, several at once. Each chunk is written at its own position in
its Telegram part's file (a part is 97 chunks, 1940 MB, under Telegram's 2000 MB limit), so
chunks may arrive in any order and a chunk sent twice is simply written again in place. When
every chunk of a part has arrived, the part goes to Telegram while the browser keeps sending.

At most MAX_PARTS_ON_DISK parts sit on the server's disk; a chunk for a further part is
answered 429 (try again shortly) rather than held open. Sessions live in memory: the browser
can continue one after a page reload (init with resume_upload_id), not after a server restart.
"""

import asyncio
import datetime
import math
import os
import secrets
import shutil
import time
from typing import Any, Dict, Optional

from fastapi import Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from telestore.api.routes.files.common import logger, router
from telestore.db import database
from telestore.security.credentials import User, require_auth, require_upload
from telestore.services.pipeline_uploader import upload_part_task
from telestore.services.priority_manager import priority_manager

CHUNK_SIZE = 20 * 1024 * 1024
TELEGRAM_PART_LIMIT = 1950 * 1024 * 1024
CHUNKS_PER_PART = TELEGRAM_PART_LIMIT // CHUNK_SIZE  # 97 chunks = 1940 MB
MAX_PARTS_ON_DISK = 3
SESSION_IDLE_LIMIT_S = 3600
RETRY_AFTER_S = 3

_active_upload_sessions: Dict[str, Dict[str, Any]] = {}

AUDIO = {".mp3", ".wav", ".ogg", ".flac", ".m4a", ".opus", ".aac"}
VIDEO = {".mp4", ".avi", ".mov", ".wmv", ".flv", ".webm", ".mkv", ".m4v", ".ts", ".3gp"}
PHOTO = {".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp"}


def active_upload_dirs() -> set:
    """Temp folders of uploads still in progress (the tg_files janitor must leave them alone)."""
    return {os.path.basename(s["dir"]) for s in _active_upload_sessions.values() if s.get("dir")}


def _file_type(name: str) -> str:
    ext = os.path.splitext(name)[1].lower()
    return "video" if ext in VIDEO else "audio" if ext in AUDIO else "photo" if ext in PHOTO else "document"


def _part_of(index: int) -> int:
    return index // CHUNKS_PER_PART


def _chunks_in_part(session: dict, part: int) -> int:
    return min(CHUNKS_PER_PART, session["total_chunks"] - part * CHUNKS_PER_PART)


def _chunk_length(session: dict, index: int) -> int:
    return min(CHUNK_SIZE, session["filesize"] - index * CHUNK_SIZE)


def _part_path(session: dict, part: int) -> str:
    return os.path.join(session["dir"], f"part_{part + 1}.tmp")


def _session_for(upload_id: str, user: User) -> dict:
    session = _active_upload_sessions.get(upload_id)
    if not session or session["user_id"] != str(user.telegram_user_id):
        raise HTTPException(status_code=404, detail="Upload session not found or expired")
    return session


def _expire_idle_sessions() -> None:
    # Measured from the last chunk, not the start: a 5 GB upload on a slow line runs for hours
    now = time.time()
    for upload_id, s in list(_active_upload_sessions.items()):
        if s.get("status") in ("processing",) or now - s.get("last_activity", now) <= SESSION_IDLE_LIMIT_S:
            continue
        _active_upload_sessions.pop(upload_id, None)
        priority_manager.notify_user_upload_finished(upload_id)
        for t in s.get("part_tasks", {}).values():
            if not t.done():
                t.cancel()
        shutil.rmtree(s["dir"], ignore_errors=True)


def _status(session: dict) -> dict:
    return {
        "upload_id": session["upload_id"],
        "chunk_size": CHUNK_SIZE,
        "total_chunks": session["total_chunks"],
        "received": sorted(session["received"]),
        "parts_uploaded": sum(1 for t in session["part_tasks"].values() if t.done() and not t.cancelled() and not t.exception()),
    }


class InitUploadRequest(BaseModel):
    filename: str
    filesize: int
    path: str = "/Home"
    resume_upload_id: Optional[str] = None
    # When a photo or video was taken (the phone's backup sends it), so timelines sort by it
    taken_at: Optional[str] = None


def _taken_at(value: Optional[str]) -> Optional[str]:
    """An ISO date/time as UTC "YYYY-MM-DDTHH:MM:SS", or None when missing or not a date."""
    if not value:
        return None
    try:
        when = datetime.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if when.tzinfo is not None:
        when = when.astimezone(datetime.timezone.utc).replace(tzinfo=None)
    return when.replace(microsecond=0).isoformat()


@router.post("/upload/init")
async def init_chunked_upload(req: InitUploadRequest, user: User = Depends(require_upload)):
    if not user.telegram_user_id:
        raise HTTPException(status_code=400, detail="TELEGRAM_NOT_VERIFIED: Please verify your Telegram account before uploading files")
    _expire_idle_sessions()

    clean_p = (req.path or "/Home").strip().lower()
    if clean_p in ("/telegram inbox", "telegram inbox", "/inbox", "inbox", "/trash", "trash", "/starred", "starred") or clean_p.startswith("/telegram inbox/") or clean_p.startswith("telegram inbox/"):
        raise HTTPException(status_code=400, detail="Cannot upload files directly to Telegram Inbox, Trash, or Starred.")
    if req.filesize <= 0:
        raise HTTPException(status_code=400, detail="Empty files can't be uploaded (Telegram can't store them)")

    # The same file to the same folder after a page reload: continue where it stopped
    old = _active_upload_sessions.get(req.resume_upload_id or "")
    if old and old["user_id"] == str(user.telegram_user_id) and old["filename"] == req.filename \
            and old["filesize"] == req.filesize and old["path"] == (req.path or "/Home") and not old.get("error") \
            and old.get("status") not in ("processing", "completed"):
        old["last_activity"] = time.time()
        logger.info(f"Resuming chunked upload {old['upload_id']} for '{req.filename}' ({len(old['received'])} chunks already here)")
        return {**_status(old), "part_max_size": CHUNKS_PER_PART * CHUNK_SIZE, "resumed": True}

    upload_id = secrets.token_hex(12)
    priority_manager.notify_user_upload_started(upload_id)
    tg_files_dir = os.path.join(os.getcwd(), "tg_files", f"chunk_{upload_id}")
    os.makedirs(tg_files_dir, exist_ok=True)

    session = {
        "upload_id": upload_id,
        "filename": req.filename,
        "filesize": req.filesize,
        "path": req.path or "/Home",
        "taken_at": _taken_at(req.taken_at),
        "user_id": str(user.telegram_user_id),
        "created_at": datetime.datetime.utcnow().isoformat(),
        "last_activity": time.time(),
        "total_chunks": max(1, math.ceil(req.filesize / CHUNK_SIZE)),
        "received": set(),
        "part_counts": {},
        "part_tasks": {},
        "open_parts": set(),  # parts with data on disk not yet sent to Telegram (and deleted)
        "dir": tg_files_dir,
        "lock": asyncio.Lock(),
        "error": None,
    }
    _active_upload_sessions[upload_id] = session
    logger.info(f"Initialized chunked upload {upload_id} for '{req.filename}' ({req.filesize} bytes, {session['total_chunks']} chunks)")
    return {**_status(session), "part_max_size": CHUNKS_PER_PART * CHUNK_SIZE}


def _write_at(path: str, offset: int, data: bytes) -> None:
    fd = os.open(path, os.O_WRONLY | os.O_CREAT, 0o600)
    try:
        os.pwrite(fd, data, offset)
    finally:
        os.close(fd)


async def _store_chunk(request: Request, session: dict, index: int, data: bytes, user: User):
    if session.get("error"):
        raise HTTPException(status_code=500, detail=f"Upload failed: {session['error']}")
    if session.get("status") in ("processing", "completed"):
        return {"status": "duplicate", **_status(session)}
    if not 0 <= index < session["total_chunks"]:
        raise HTTPException(status_code=400, detail="Chunk number out of range")
    if len(data) != _chunk_length(session, index):
        raise HTTPException(status_code=400, detail=f"Chunk {index} should be {_chunk_length(session, index)} bytes, got {len(data)}")

    session["last_activity"] = time.time()
    priority_manager.touch_user_upload(session["upload_id"])
    part = _part_of(index)
    async with session["lock"]:
        if index in session["received"] or part in session["part_tasks"]:
            return {"status": "duplicate", **_status(session)}
        if part not in session["open_parts"] and len(session["open_parts"]) >= MAX_PARTS_ON_DISK:
            # The disk holds enough parts; ask the browser to send this one a bit later
            return JSONResponse(status_code=429, headers={"Retry-After": str(RETRY_AFTER_S)},
                                content={"detail": "Waiting for earlier parts to reach Telegram", "retry_after": RETRY_AFTER_S})
        session["open_parts"].add(part)

    await asyncio.to_thread(_write_at, _part_path(session, part), (index % CHUNKS_PER_PART) * CHUNK_SIZE, data)

    async with session["lock"]:
        if index not in session["received"]:
            session["received"].add(index)
            session["part_counts"][part] = session["part_counts"].get(part, 0) + 1
        if session["part_counts"][part] == _chunks_in_part(session, part) and part not in session["part_tasks"]:
            await _send_part(request, session, part, user)
    return {"status": "ok", "chunk_index": index, **_status(session)}


async def _send_part(request: Request, session: dict, part: int, user: User) -> None:
    """Sends a complete part to Telegram in the background (the browser keeps sending)."""
    bot_manager = getattr(request.app.state, "bot_manager", None)
    user_data = database.Users.find_one({"telegram_user_id": user.telegram_user_id}) or {}
    chat_id = user_data.get("index_chat_id")
    client = bot_manager.get_least_busy_client() if bot_manager else None
    if not chat_id or not client:
        session["error"] = "No Telegram bot or index chat is available"
        raise HTTPException(status_code=503, detail="No Telegram bot or index chat is available right now. Try again in a minute.")
    single = session["total_chunks"] <= CHUNKS_PER_PART
    total_parts = math.ceil(session["total_chunks"] / CHUNKS_PER_PART)
    start = part * CHUNKS_PER_PART * CHUNK_SIZE
    size = min(CHUNKS_PER_PART * CHUNK_SIZE, session["filesize"] - start)
    session["chat_id"] = chat_id
    task = asyncio.create_task(upload_part_task(
        part_file_path=_part_path(session, part),
        part_index=part + 1,
        file_name=session["filename"],
        start_byte=start,
        part_size=size,
        chat_id=chat_id,
        bot_manager=bot_manager,
        fallback_client=client,
        caption=f"Uploaded file: {session['filename']}" if single else f"{session['filename']} (Part {part + 1}/{total_parts})",
        semaphore=None,
        is_single_part=single,
        file_type=_file_type(session["filename"]),
    ))
    session["part_tasks"][part] = task
    logger.info(f"[CHUNKED_UPLOAD] {session['upload_id']}: part {part + 1}/{total_parts} complete, sending to Telegram")

    def finished(t: asyncio.Task):
        session["open_parts"].discard(part)
        if t.cancelled():
            return
        if t.exception():
            # Stop the upload now instead of after the browser has sent every remaining gigabyte
            session["error"] = f"Part {part + 1} couldn't be saved to Telegram: {t.exception()}"
            logger.error(f"[CHUNKED_UPLOAD] {session['upload_id']}: {session['error']}")
    task.add_done_callback(finished)


@router.put("/upload/chunk/{upload_id}/{chunk_index}")
async def put_file_chunk(request: Request, upload_id: str, chunk_index: int, user: User = Depends(require_auth)):
    """One chunk as the raw request body (written to disk once, at its place in the file)."""
    session = _session_for(upload_id, user)
    return await _store_chunk(request, session, chunk_index, await request.body(), user)


@router.post("/upload/chunk")
async def upload_file_chunk(
    request: Request,
    upload_id: str = Form(...),
    chunk_index: int = Form(...),
    chunk_file: UploadFile = File(...),
    user: User = Depends(require_auth),
):
    """The same as PUT, for clients that send each chunk as a form upload."""
    session = _session_for(upload_id, user)
    return await _store_chunk(request, session, chunk_index, await chunk_file.read(), user)


async def _process_upload_completion(upload_id: str, session: dict) -> None:
    try:
        session["status"] = "processing"
        results = await asyncio.gather(*(session["part_tasks"][p] for p in sorted(session["part_tasks"])))
        file_type = _file_type(session["filename"])
        chat_id = session["chat_id"]
        if len(results) == 1:
            res = results[0]
            database.Files.add_file(
                chat_id=chat_id, message_id=res["message_id"], thumbnail=res["thumbnail"], file_type=file_type,
                file_unique_id=res["file_unique_id"], file_size=session["filesize"], file_name=session["filename"],
                file_caption=f"Uploaded file: {session['filename']}", file_path=session["path"], owner_id=session["user_id"],
            )
            unique_id, thumbnail, extra = res["file_unique_id"], res["thumbnail"], {}
        else:
            parts = [{k: r[k] for k in ("part_index", "chat_id", "message_id", "file_unique_id", "part_size", "start_byte", "end_byte")} for r in results]
            thumbnail = next((r["thumbnail"] for r in results if r.get("thumbnail")), None)
            unique_id = results[0]["file_unique_id"] or f"mp_{upload_id}"
            database.Files.add_multipart_file(
                chat_id=chat_id, thumbnail=thumbnail, file_type=file_type, file_unique_id=unique_id,
                file_size=session["filesize"], file_name=session["filename"],
                file_caption=f"Uploaded multi-part file: {session['filename']}", parts=parts,
                file_path=session["path"], owner_id=session["user_id"], part_size=CHUNKS_PER_PART * CHUNK_SIZE,
            )
            extra = {"is_split": True, "total_parts": len(parts)}
        file_doc = database.Files.find_one({"chat_id": chat_id, "file_unique_id": unique_id, "file_name": session["filename"], "trashed": {"$ne": True}})
        if file_doc and session.get("taken_at"):
            database.Files.update_one({"_id": file_doc["_id"]}, {"$set": {"taken_at": session["taken_at"]}})
        session["result_file"] = {
            "id": str(file_doc["_id"]) if file_doc else str(results[0]["message_id"]),
            "file_unique_id": unique_id, "file_name": session["filename"], "file_path": session["path"],
            "file_type": file_type, "file_size": session["filesize"], "thumbnail": thumbnail,
            "modified": datetime.datetime.now(datetime.timezone.utc).isoformat(), **extra,
        }
        session["result_message"] = "File uploaded successfully" if len(results) == 1 else f"Multi-part file uploaded successfully ({len(results)} parts)"
        session["status"] = "completed"
        logger.info(f"Chunked upload {upload_id} for '{session['filename']}' completed ({len(results)} part(s)).")
    except Exception as e:
        logger.error(f"Error processing upload completion {upload_id}: {e}", exc_info=True)
        session["status"] = "error"
        session["error"] = session.get("error") or str(e)
    finally:
        shutil.rmtree(session.get("dir", ""), ignore_errors=True)
        priority_manager.notify_user_upload_finished(upload_id)


@router.post("/upload/complete")
async def complete_chunked_upload(request: Request, upload_id: str = Form(...), user: User = Depends(require_auth)):
    session = _session_for(upload_id, user)
    if session.get("status") in ("processing", "completed"):
        return {"status": session["status"], "upload_id": upload_id, "message": "Upload is already processing or completed"}
    if session.get("error"):
        raise HTTPException(status_code=500, detail=f"Upload failed: {session['error']}")
    missing = session["total_chunks"] - len(session["received"])
    if missing:
        # Never save a file with a gap in it
        first_missing = next(i for i in range(session["total_chunks"]) if i not in session["received"])
        raise HTTPException(status_code=409, detail={"message": f"Upload incomplete: {missing} chunk(s) missing.", "next_chunk": first_missing,
                                                      "received": sorted(session["received"])})
    session["status"] = "processing"
    asyncio.create_task(_process_upload_completion(upload_id, session))
    return {"status": "processing", "upload_id": upload_id, "message": "File received. Processing and saving to Telegram cloud..."}


@router.get("/upload/status/{upload_id}")
async def get_upload_status(upload_id: str, user: User = Depends(require_auth)):
    session = _active_upload_sessions.get(upload_id)
    if not session:
        raise HTTPException(status_code=404, detail="Upload session not found or expired")
    if session.get("user_id") != str(user.telegram_user_id):
        raise HTTPException(status_code=403, detail="Forbidden")
    status = session.get("status", "uploading")
    if status == "completed":
        return {"status": "completed", "file": session.get("result_file"), "message": session.get("result_message", "File uploaded successfully")}
    if status == "error" or (session.get("error") and status != "processing"):
        return {"status": "error", "error": session.get("error") or "Upload processing failed"}
    if status == "processing":
        return {"status": "processing", "message": "Saving to Telegram cloud..."}
    return {"status": "uploading", **_status(session)}


class AbortUploadRequest(BaseModel):
    upload_id: str


@router.post("/upload/abort")
async def abort_chunked_upload(req: AbortUploadRequest, user: User = Depends(require_auth)):
    upload_id = req.upload_id
    session = _active_upload_sessions.get(upload_id)
    if session and session.get("user_id") and session["user_id"] != str(user.telegram_user_id):
        raise HTTPException(status_code=403, detail="Forbidden")
    _active_upload_sessions.pop(upload_id, None)
    priority_manager.notify_user_upload_finished(upload_id)
    if session:
        for t in session.get("part_tasks", {}).values():
            if not t.done():
                t.cancel()
        shutil.rmtree(session.get("dir", ""), ignore_errors=True)
    shutil.rmtree(os.path.join(os.getcwd(), "tg_files", f"chunk_{upload_id}"), ignore_errors=True)
    logger.info(f"Upload session {upload_id} aborted by user and disk storage purged.")
    return {"status": "aborted", "upload_id": upload_id, "message": "Upload aborted and temporary files cleaned up."}
