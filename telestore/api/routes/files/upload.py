# telestore/api/routes/files/upload.py

from fastapi import Request, Depends, HTTPException, File, UploadFile, Form
from pydantic import BaseModel
import os
import asyncio
import datetime
import aiofiles
import secrets
import shutil
from typing import List, Dict, Any

from telestore.security.credentials import require_auth, require_upload, User
from telestore.db import database
from telestore.services.pipeline_uploader import upload_part_task
from telestore.services.priority_manager import priority_manager

# For thumbnail route
from pyrogram import Client

from telestore.api.routes.files.common import logger, router

@router.post("/upload")
async def upload_file(
    request: Request,  # Make request parameter required to access bot manager
    file: UploadFile = File(...),
    path: str = Form(default="/", description="Destination path for the uploaded file"),
    user: User = Depends(require_upload)
):
    try:
        # DEBUG: Log the received path and file info
        print(f"Received upload request with path: {path}")
        print(f"File name: {file.filename}, File size: {file.size}, Content type: {file.content_type}")
        print(f"User: {user}")

        clean_p = path.strip().lower()
        if clean_p in ("/telegram inbox", "telegram inbox", "/inbox", "inbox", "/trash", "trash", "/starred", "starred") or clean_p.startswith("/telegram inbox/") or clean_p.startswith("telegram inbox/"):
            raise HTTPException(status_code=400, detail="Cannot upload files directly to Telegram Inbox, Trash, or Starred.")

        # Check if user has verified their Telegram account upfront before writing to disk
        if not user.telegram_user_id:
            raise HTTPException(status_code=400, detail="TELEGRAM_NOT_VERIFIED: Please verify your Telegram account before uploading files")
        
        # Get the user's index chat ID
        user_data = database.Users.find_one({"telegram_user_id": user.telegram_user_id})
        if not user_data or "index_chat_id" not in user_data:
            raise HTTPException(status_code=400, detail="User index chat not found")        
        chat_id = user_data["index_chat_id"]
        
        # Access bot_manager from app state upfront
        if not hasattr(request, 'app') or not hasattr(request.app.state, 'bot_manager'):
            raise HTTPException(status_code=503, detail="Bot manager not available")
        
        bot_manager = request.app.state.bot_manager
        if not bot_manager:
            raise HTTPException(status_code=503, detail="Bot manager not available")
        
        # Get a client to use for uploading
        client: Client = bot_manager.get_least_busy_client() if hasattr(bot_manager, 'get_least_busy_client') else None
        if not client:
            raise HTTPException(status_code=500, detail="No available bot clients")

        # Create the tg_files directory if it doesn't exist
        tg_files_dir = os.path.join(os.getcwd(), "tg_files")
        os.makedirs(tg_files_dir, exist_ok=True)
        
        # Max Telegram single file limit for bots: 1950 MB
        PART_MAX_SIZE = 1950 * 1024 * 1024
        upload_id = secrets.token_hex(8)
        priority_manager.notify_user_upload_started(upload_id)
        
        part_index = 1
        current_part_file = os.path.join(tg_files_dir, f"{upload_id}_part_{part_index}.tmp")
        current_part_written = 0
        total_written = 0
        upload_tasks: List[asyncio.Task] = []
        disk_semaphore = asyncio.Semaphore(2)  # Max 2 active parts on VM disk
        await disk_semaphore.acquire()

        file_extension = os.path.splitext(file.filename)[1].lower()
        file_type = "document"
        if file_extension in ['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v', '.ts', '.3gp', '.ogv']:
            file_type = "video"
        elif file_extension in ['.mp3', '.wav', '.ogg', '.flac', '.m4a']:
            file_type = "audio"
        elif file_extension in ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp']:
            file_type = "photo"
        
        part_f = await aiofiles.open(current_part_file, 'wb')
        try:
            while chunk := await file.read(4 * 1024 * 1024):  # 4MB chunks
                chunk_len = len(chunk)
                
                # If writing this chunk exceeds the part limit
                if current_part_written + chunk_len > PART_MAX_SIZE:
                    split_point = PART_MAX_SIZE - current_part_written
                    if split_point > 0:
                        await part_f.write(chunk[:split_point])
                        current_part_written += split_point
                        total_written += split_point
                    
                    await part_f.close()
                    
                    # Dispatch to Telegram in background (NON-BLOCKING!)
                    logger.info(
                        f"[DIRECT_UPLOAD] Part {part_index} reached {current_part_written} bytes. "
                        f"Dispatching background upload for '{file.filename}'..."
                    )
                    p_task = asyncio.create_task(
                        upload_part_task(
                            part_file_path=current_part_file,
                            part_index=part_index,
                            file_name=file.filename,
                            start_byte=total_written - current_part_written,
                            part_size=current_part_written,
                            chat_id=chat_id,
                            bot_manager=bot_manager,
                            fallback_client=client,
                            caption=f"{file.filename} (Part {part_index})",
                            semaphore=disk_semaphore,
                            is_single_part=False,
                            file_type=file_type
                        )
                    )
                    upload_tasks.append(p_task)
                    
                    # Acquire next slot (applies backpressure if 2 parts on disk)
                    await disk_semaphore.acquire()

                    # Start next part immediately without pausing client upload!
                    part_index += 1
                    current_part_file = os.path.join(tg_files_dir, f"{upload_id}_part_{part_index}.tmp")
                    part_f = await aiofiles.open(current_part_file, 'wb')
                    remainder = chunk[split_point:]
                    if remainder:
                        await part_f.write(remainder)
                        current_part_written = len(remainder)
                        total_written += len(remainder)
                    else:
                        current_part_written = 0
                else:
                    await part_f.write(chunk)
                    current_part_written += chunk_len
                    total_written += chunk_len
            
            await part_f.close()
        except Exception:
            if not part_f.closed:
                await part_f.close()
            for t in upload_tasks:
                if not t.done():
                    t.cancel()
            if os.path.exists(current_part_file):
                os.remove(current_part_file)
            raise

        if total_written == 0:
            disk_semaphore.release()
            if os.path.exists(current_part_file):
                os.remove(current_part_file)
            raise HTTPException(status_code=400, detail="Cannot upload empty files")

        # Case 1: Single-part file (<= 1950MB)
        if len(upload_tasks) == 0:
            logger.info(f"File '{file.filename}' ({total_written} bytes) fits in 1 Telegram message. Uploading...")
            res = await upload_part_task(
                part_file_path=current_part_file,
                part_index=1,
                file_name=file.filename,
                start_byte=0,
                part_size=total_written,
                chat_id=chat_id,
                bot_manager=bot_manager,
                fallback_client=client,
                caption=f"Uploaded file: {file.filename}",
                semaphore=disk_semaphore,
                is_single_part=True,
                file_type=file_type
            )

            success = database.Files.add_file(
                chat_id=chat_id,
                message_id=res["message_id"],
                thumbnail=res["thumbnail"],
                file_type=file_type,
                file_unique_id=res["file_unique_id"],
                file_size=total_written,
                file_name=file.filename,
                file_caption=f"Uploaded file: {file.filename}",
                file_path=path,
                owner_id=str(user.telegram_user_id)
            )
            return {
                "message": "File uploaded successfully",
                "file": {
                    "id": str(res["message_id"]),
                    "file_unique_id": res["file_unique_id"],
                    "file_name": file.filename,
                    "file_path": path,
                    "file_type": file_type,
                    "file_size": total_written,
                    "thumbnail": res["thumbnail"],
                    "modified": datetime.datetime.now().isoformat()
                }
            }

        # Case 2: Multi-part file (> 1950MB)
        else:
            if current_part_written > 0:
                logger.info(f"Dispatching final part {part_index} ({current_part_written} bytes) for '{file.filename}'...")
                final_task = asyncio.create_task(
                    upload_part_task(
                        part_file_path=current_part_file,
                        part_index=part_index,
                        file_name=file.filename,
                        start_byte=total_written - current_part_written,
                        part_size=current_part_written,
                        chat_id=chat_id,
                        bot_manager=bot_manager,
                        fallback_client=client,
                        caption=f"{file.filename} (Part {part_index}/{part_index})",
                        semaphore=disk_semaphore,
                        is_single_part=False,
                        file_type=file_type
                    )
                )
                upload_tasks.append(final_task)
            else:
                disk_semaphore.release()
                if os.path.exists(current_part_file):
                    try:
                        os.remove(current_part_file)
                    except Exception:
                        pass

            # Await all background upload tasks
            logger.info(f"[DIRECT_UPLOAD] Awaiting completion of {len(upload_tasks)} background upload part(s) for '{file.filename}'...")
            results = await asyncio.gather(*upload_tasks)
            results.sort(key=lambda x: x["part_index"])

            first_res = results[0]
            first_msg_id = first_res["message_id"]
            first_thumbnail = next((r["thumbnail"] for r in results if r.get("thumbnail")), None)
            first_unique_id = first_res["file_unique_id"]

            parts = [
                {
                    "part_index": r["part_index"],
                    "chat_id": r["chat_id"],
                    "message_id": r["message_id"],
                    "file_unique_id": r["file_unique_id"],
                    "part_size": r["part_size"],
                    "start_byte": r["start_byte"],
                    "end_byte": r["end_byte"]
                }
                for r in results
            ]

            final_unique_id = first_unique_id or f"mp_{upload_id}"
            success = database.Files.add_multipart_file(
                chat_id=chat_id,
                thumbnail=first_thumbnail,
                file_type=file_type,
                file_unique_id=final_unique_id,
                file_size=total_written,
                file_name=file.filename,
                file_caption=f"Uploaded multi-part file: {file.filename}",
                parts=parts,
                file_path=path,
                owner_id=str(user.telegram_user_id),
                part_size=PART_MAX_SIZE
            )
            return {
                "message": f"Multi-part file uploaded successfully ({len(parts)} parts)",
                "file": {
                    "id": str(parts[0]["message_id"]),
                    "file_unique_id": final_unique_id,
                    "file_name": file.filename,
                    "file_path": path,
                    "file_type": file_type,
                    "file_size": total_written,
                    "thumbnail": first_thumbnail,
                    "is_split": True,
                    "total_parts": len(parts),
                    "modified": datetime.datetime.now().isoformat()
                }
            }

    except Exception as e:
        logger.error(f"Error uploading file: {e}")
        if 'current_part_file' in locals() and current_part_file and os.path.exists(current_part_file):
            try:
                os.remove(current_part_file)
            except Exception:
                pass
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if 'upload_id' in locals() and upload_id:
            priority_manager.notify_user_upload_finished(upload_id)


# ----------------------------------------------------
# Chunked Resumable Upload Endpoints (for 2GB+ & large files)
# ----------------------------------------------------
_active_upload_sessions: Dict[str, Dict[str, Any]] = {}

class InitUploadRequest(BaseModel):
    filename: str
    filesize: int
    path: str = "/Home"

@router.post("/upload/init")
async def init_chunked_upload(
    req: InitUploadRequest,
    user: User = Depends(require_upload)
):
    if not user.telegram_user_id:
        raise HTTPException(status_code=400, detail="TELEGRAM_NOT_VERIFIED: Please verify your Telegram account before uploading files")

    # Clean up old upload sessions (> 1 hour old)
    now = datetime.datetime.utcnow()
    expired_uids = [
        uid for uid, s in list(_active_upload_sessions.items())
        if (now - datetime.datetime.fromisoformat(s.get("created_at", now.isoformat()))).total_seconds() > 3600
    ]
    for uid in expired_uids:
        s = _active_upload_sessions.pop(uid, None)
        if s:
            priority_manager.notify_user_upload_finished(uid)
            for t in s.get("upload_tasks", []):
                if not t.done():
                    t.cancel()
            if "dir" in s and os.path.exists(s["dir"]):
                shutil.rmtree(s["dir"], ignore_errors=True)

    clean_p = (req.path or "/Home").strip().lower()
    if clean_p in ("/telegram inbox", "telegram inbox", "/inbox", "inbox", "/trash", "trash", "/starred", "starred") or clean_p.startswith("/telegram inbox/") or clean_p.startswith("telegram inbox/"):
        raise HTTPException(status_code=400, detail="Cannot upload files directly to Telegram Inbox, Trash, or Starred.")

    upload_id = secrets.token_hex(12)
    priority_manager.notify_user_upload_started(upload_id)
    tg_files_dir = os.path.join(os.getcwd(), "tg_files", f"chunk_{upload_id}")
    os.makedirs(tg_files_dir, exist_ok=True)

    sem = asyncio.Semaphore(2)  # Max 2 active parts on VM disk
    await sem.acquire()

    _active_upload_sessions[upload_id] = {
        "upload_id": upload_id,
        "filename": req.filename,
        "filesize": req.filesize,
        "path": req.path or "/Home",
        "user_id": str(user.telegram_user_id),
        "created_at": datetime.datetime.utcnow().isoformat(),
        "total_written": 0,
        "current_part_index": 1,
        "current_part_written": 0,
        "parts": [],
        "first_thumbnail": None,
        "first_unique_id": None,
        "dir": tg_files_dir,
        "upload_tasks": [],
        "disk_semaphore": sem
    }
    logger.info(f"Initialized chunked upload {upload_id} for '{req.filename}' ({req.filesize} bytes)")
    return {
        "upload_id": upload_id,
        "chunk_size": 20 * 1024 * 1024,
        "part_max_size": 1950 * 1024 * 1024
    }

@router.post("/upload/chunk")
async def upload_file_chunk(
    request: Request,
    upload_id: str = Form(...),
    chunk_index: int = Form(...),
    chunk_file: UploadFile = File(...),
    user: User = Depends(require_auth)
):
    session = _active_upload_sessions.get(upload_id)
    if not session or session["user_id"] != str(user.telegram_user_id):
        raise HTTPException(status_code=404, detail="Upload session not found or expired")

    priority_manager.touch_user_upload(upload_id)

    PART_MAX_SIZE = 1950 * 1024 * 1024
    part_idx = session["current_part_index"]
    part_file_path = os.path.join(session["dir"], f"part_{part_idx}.tmp")

    content = await chunk_file.read()
    chunk_len = len(content)

    async with aiofiles.open(part_file_path, 'ab') as f:
        await f.write(content)

    session["current_part_written"] += chunk_len
    session["total_written"] += chunk_len

    if session["current_part_written"] >= PART_MAX_SIZE:
        bot_manager = getattr(request.app.state, 'bot_manager', None)
        user_data = database.Users.find_one({"telegram_user_id": user.telegram_user_id})
        chat_id = user_data.get("index_chat_id")
        client = bot_manager.get_least_busy_client() if bot_manager else None

        if chat_id and client:
            file_extension = os.path.splitext(session["filename"])[1].lower()
            file_type = "document"
            if file_extension in ['.mp4', '.avi', '.mov', '.wmv', '.flv', '.webm', '.mkv']:
                file_type = "video"
            elif file_extension in ['.mp3', '.wav', '.ogg', '.flac', '.m4a']:
                file_type = "audio"
            elif file_extension in ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp']:
                file_type = "photo"

            logger.info(
                f"[CHUNKED_UPLOAD] Session {upload_id}: Part {part_idx} reached {session['current_part_written']} bytes. "
                f"Dispatching non-blocking background upload for '{session['filename']}'..."
            )
            # Dispatch background task without blocking the HTTP request!
            # The browser receives HTTP 200 OK immediately and continues uploading next chunks without freezing!
            task = asyncio.create_task(
                upload_part_task(
                    part_file_path=part_file_path,
                    part_index=part_idx,
                    file_name=session["filename"],
                    start_byte=session["total_written"] - session["current_part_written"],
                    part_size=session["current_part_written"],
                    chat_id=chat_id,
                    bot_manager=bot_manager,
                    fallback_client=client,
                    caption=f"{session['filename']} (Part {part_idx})",
                    semaphore=session.get("disk_semaphore"),
                    is_single_part=False,
                    file_type=file_type
                )
            )
            session.setdefault("upload_tasks", []).append(task)

            # Acquire permit for next part buffer (applies backpressure if 2 parts already on disk)
            if "disk_semaphore" in session:
                await session["disk_semaphore"].acquire()

            session["current_part_index"] += 1
            session["current_part_written"] = 0

    return {
        "status": "ok",
        "chunk_index": chunk_index,
        "total_written": session["total_written"],
        "parts_uploaded": len(session.get("upload_tasks", []))
    }

async def _process_upload_completion(upload_id: str, session: dict, bot_manager, chat_id: int):
    try:
        session["status"] = "processing"
        client = bot_manager.get_least_busy_client() if bot_manager else None
        if not client:
            session["status"] = "error"
            session["error"] = "Telegram bot client not available"
            return

        part_idx = session["current_part_index"]
        part_file_path = os.path.join(session["dir"], f"part_{part_idx}.tmp")

        file_extension = os.path.splitext(session["filename"])[1].lower()
        file_type = "document"
        if file_extension in ['.mp4', '.avi', '.mov', '.wmv', '.flv', '.webm', '.mkv']:
            file_type = "video"
        elif file_extension in ['.mp3', '.wav', '.ogg', '.flac', '.m4a']:
            file_type = "audio"
        elif file_extension in ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp']:
            file_type = "photo"

        upload_tasks = session.get("upload_tasks", [])

        # Case 1: Single-part file (<= 1950MB) - no background tasks were spawned
        if len(upload_tasks) == 0:
            if not os.path.exists(part_file_path) or session["total_written"] == 0:
                session["status"] = "error"
                session["error"] = "No file chunks received"
                return

            logger.info(f"Uploading single-part file '{session['filename']}' ({session['total_written']} bytes) to Telegram chat {chat_id}...")
            res = await upload_part_task(
                part_file_path=part_file_path,
                part_index=1,
                file_name=session["filename"],
                start_byte=0,
                part_size=session["total_written"],
                chat_id=chat_id,
                bot_manager=bot_manager,
                fallback_client=client,
                caption=f"Uploaded file: {session['filename']}",
                semaphore=session.get("disk_semaphore"),
                is_single_part=True,
                file_type=file_type
            )

            database.Files.add_file(
                chat_id=chat_id,
                message_id=res["message_id"],
                thumbnail=res["thumbnail"],
                file_type=file_type,
                file_unique_id=res["file_unique_id"],
                file_size=session["total_written"],
                file_name=session["filename"],
                file_caption=f"Uploaded file: {session['filename']}",
                file_path=session["path"],
                owner_id=session["user_id"]
            )

            shutil.rmtree(session["dir"], ignore_errors=True)

            file_doc = database.Files.find_one({
                "chat_id": chat_id,
                "file_unique_id": res["file_unique_id"],
                "file_name": session["filename"],
                "trashed": {"$ne": True}
            })
            doc_id_str = str(file_doc["_id"]) if file_doc else str(res["message_id"])

            session["status"] = "completed"
            session["result_file"] = {
                "id": doc_id_str,
                "file_unique_id": res["file_unique_id"],
                "file_name": session["filename"],
                "file_path": session["path"],
                "file_type": file_type,
                "file_size": session["total_written"],
                "thumbnail": res["thumbnail"],
                "modified": datetime.datetime.now().isoformat()
            }
            session["result_message"] = "File uploaded successfully"
            logger.info(f"Chunked upload {upload_id} for '{session['filename']}' completed successfully.")
        else:
            # Case 2: Multi-part file (> 1950MB)
            if os.path.exists(part_file_path) and session["current_part_written"] > 0:
                logger.info(f"Dispatching final part {part_idx} ({session['current_part_written']} bytes)...")
                final_task = asyncio.create_task(
                    upload_part_task(
                        part_file_path=part_file_path,
                        part_index=part_idx,
                        file_name=session["filename"],
                        start_byte=session["total_written"] - session["current_part_written"],
                        part_size=session["current_part_written"],
                        chat_id=chat_id,
                        bot_manager=bot_manager,
                        fallback_client=client,
                        caption=f"{session['filename']} (Part {part_idx}/{part_idx})",
                        semaphore=session.get("disk_semaphore"),
                        is_single_part=False,
                        file_type=file_type
                    )
                )
                upload_tasks.append(final_task)
            else:
                if "disk_semaphore" in session:
                    session["disk_semaphore"].release()
                if os.path.exists(part_file_path):
                    try:
                        os.remove(part_file_path)
                    except Exception:
                        pass

            # Await all background upload tasks
            logger.info(f"[CHUNKED_UPLOAD] Awaiting completion of {len(upload_tasks)} background upload part(s) for '{session['filename']}'...")
            results = await asyncio.gather(*upload_tasks)
            results.sort(key=lambda x: x["part_index"])

            first_res = results[0]
            first_thumbnail = next((r["thumbnail"] for r in results if r.get("thumbnail")), None)
            first_unique_id = first_res["file_unique_id"]

            parts = [
                {
                    "part_index": r["part_index"],
                    "chat_id": r["chat_id"],
                    "message_id": r["message_id"],
                    "file_unique_id": r["file_unique_id"],
                    "part_size": r["part_size"],
                    "start_byte": r["start_byte"],
                    "end_byte": r["end_byte"]
                }
                for r in results
            ]

            final_unique_id = first_unique_id or f"mp_{upload_id}"
            database.Files.add_multipart_file(
                chat_id=chat_id,
                thumbnail=first_thumbnail,
                file_type=file_type,
                file_unique_id=final_unique_id,
                file_size=session["total_written"],
                file_name=session["filename"],
                file_caption=f"Uploaded multi-part file: {session['filename']}",
                parts=parts,
                file_path=session["path"],
                owner_id=session["user_id"],
                part_size=1950 * 1024 * 1024
            )

            shutil.rmtree(session["dir"], ignore_errors=True)

            file_doc = database.Files.find_one({
                "chat_id": chat_id,
                "file_unique_id": final_unique_id,
                "file_name": session["filename"],
                "trashed": {"$ne": True}
            })
            doc_id_str = str(file_doc["_id"]) if file_doc else str(parts[0]["message_id"])

            session["status"] = "completed"
            session["result_file"] = {
                "id": doc_id_str,
                "file_unique_id": final_unique_id,
                "file_name": session["filename"],
                "file_path": session["path"],
                "file_type": file_type,
                "file_size": session["total_written"],
                "thumbnail": first_thumbnail,
                "is_split": True,
                "total_parts": len(parts),
                "modified": datetime.datetime.now().isoformat()
            }
            session["result_message"] = f"Multi-part file uploaded successfully ({len(parts)} parts)"
            logger.info(f"Chunked multi-part upload {upload_id} for '{session['filename']}' completed successfully.")
    except Exception as e:
        logger.error(f"Error processing upload completion {upload_id}: {e}", exc_info=True)
        session["status"] = "error"
        session["error"] = str(e)
        if os.path.exists(session.get("dir", "")):
            shutil.rmtree(session["dir"], ignore_errors=True)
    finally:
        priority_manager.notify_user_upload_finished(upload_id)

@router.post("/upload/complete")
async def complete_chunked_upload(
    request: Request,
    upload_id: str = Form(...),
    user: User = Depends(require_auth)
):
    session = _active_upload_sessions.get(upload_id)
    if not session or session["user_id"] != str(user.telegram_user_id):
        raise HTTPException(status_code=404, detail="Upload session not found or expired")

    bot_manager = getattr(request.app.state, 'bot_manager', None)
    user_data = database.Users.find_one({"telegram_user_id": user.telegram_user_id})
    chat_id = user_data.get("index_chat_id")
    client = bot_manager.get_least_busy_client() if bot_manager else None

    if not chat_id or not client:
        raise HTTPException(status_code=500, detail="Telegram chat or bot client not available")

    # If already processing or completed, return current status immediately
    if session.get("status") in ["processing", "completed"]:
        return {
            "status": session["status"],
            "upload_id": upload_id,
            "message": "Upload is already processing or completed"
        }

    session["status"] = "processing"
    # Run Telegram upload in background task so HTTP connection responds immediately
    asyncio.create_task(_process_upload_completion(upload_id, session, bot_manager, chat_id))

    return {
        "status": "processing",
        "upload_id": upload_id,
        "message": "File received. Processing and saving to Telegram cloud..."
    }

@router.get("/upload/status/{upload_id}")
async def get_upload_status(
    upload_id: str,
    user: User = Depends(require_auth)
):
    session = _active_upload_sessions.get(upload_id)
    if not session:
        raise HTTPException(status_code=404, detail="Upload session not found or expired")

    if session.get("user_id") != str(user.telegram_user_id):
        raise HTTPException(status_code=403, detail="Forbidden")

    status = session.get("status", "uploading")
    if status == "completed":
        return {
            "status": "completed",
            "file": session.get("result_file"),
            "message": session.get("result_message", "File uploaded successfully")
        }
    elif status == "error":
        err_msg = session.get("error", "Upload processing failed")
        return {
            "status": "error",
            "error": err_msg
        }
    else:
        return {
            "status": "processing",
            "message": "Saving to Telegram cloud..."
        }

class AbortUploadRequest(BaseModel):
    upload_id: str

@router.post("/upload/abort")
async def abort_chunked_upload(
    req: AbortUploadRequest,
    user: User = Depends(require_auth)
):
    upload_id = req.upload_id
    session = _active_upload_sessions.pop(upload_id, None)
    priority_manager.notify_user_upload_finished(upload_id)
    tg_files_dir = os.path.join(os.getcwd(), "tg_files", f"chunk_{upload_id}")

    if session:
        # Check permissions if user_id present
        if session.get("user_id") and session["user_id"] != str(user.telegram_user_id):
            raise HTTPException(status_code=403, detail="Forbidden")

        # Cancel any ongoing background upload tasks
        for t in session.get("upload_tasks", []):
            if not t.done():
                t.cancel()

        # Release disk semaphore permit if held
        if "disk_semaphore" in session:
            try:
                session["disk_semaphore"].release()
            except Exception:
                pass

        # Purge temporary directory from disk
        if "dir" in session and os.path.exists(session["dir"]):
            shutil.rmtree(session["dir"], ignore_errors=True)

    if os.path.exists(tg_files_dir):
        shutil.rmtree(tg_files_dir, ignore_errors=True)

    logger.info(f"Upload session {upload_id} aborted by user and disk storage purged.")
    return {
        "status": "aborted",
        "upload_id": upload_id,
        "message": "Upload aborted and temporary files cleaned up."
    }
