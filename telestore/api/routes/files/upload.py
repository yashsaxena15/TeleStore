# telestore/api/routes/files/upload.py

from fastapi import Request, Depends, HTTPException, File, UploadFile, Form
import os
import asyncio
import datetime
import aiofiles
import secrets
from typing import List

from telestore.security.credentials import require_upload, User
from telestore.db import database
from telestore.services.pipeline_uploader import upload_part_task
from telestore.services.disk_budget import AsyncPartSlots
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
        # Max 2 active parts on disk, each reserved from the server's disk budget
        disk_semaphore = AsyncPartSlots(expected_total=file.size or 0)
        await disk_semaphore.acquire()

        file_extension = os.path.splitext(file.filename)[1].lower()
        file_type = "document"
        if file_extension in ['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v', '.ts', '.3gp', '.ogv']:
            file_type = "video"
        elif file_extension in ['.mp3', '.wav', '.ogg', '.flac', '.m4a', '.opus', '.aac']:
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
        if 'disk_semaphore' in locals():
            disk_semaphore.close()  # give back what a failed upload still held
        if 'upload_id' in locals() and upload_id:
            priority_manager.notify_user_upload_finished(upload_id)
