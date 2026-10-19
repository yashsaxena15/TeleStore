# telestore/api/routes/webdav/transfer.py

import os
import urllib.parse
import secrets
import aiofiles
from datetime import datetime, timezone
from typing import Optional, List

from fastapi import Request, Response, HTTPException
from fastapi.responses import StreamingResponse, HTMLResponse

from telestore.db import database
import re
import asyncio
import glob
from telestore.services.byte_streamer import get_byte_streamer
from telestore.services.streaming_utils import parse_range_header, resolve_mime_type
from telestore.services.pipeline_uploader import upload_part_task

from telestore.api.routes.webdav.browser import get_directory_items, render_webdav_html
from telestore.api.routes.webdav.common import format_dav_date, logger

async def handle_get_head(request: Request, segments: List[str], owner_id: str, is_head: bool = False) -> Response:
    """Handle WebDAV file download, Range-based media streaming, or HTML directory browsing."""
    is_dir, dir_items = get_directory_items(segments, owner_id)
    if is_dir:
        if is_head:
            return Response(status_code=200, media_type="text/html; charset=utf-8")
        return HTMLResponse(content=render_webdav_html(segments, dir_items), status_code=200)

    if len(segments) < 2:
        raise HTTPException(status_code=404, detail="File or directory not found")

    top_name = segments[0]
    target_name = segments[-1]

    file_doc = None
    if top_name == "Home":
        parent_db_path = "/" + "/".join(segments[:-1])
        file_doc = database.Files.find_one({
            "file_type": {"$ne": "folder"},
            "file_name": target_name,
            "file_path": parent_db_path if parent_db_path != "/Home" else {"$in": ["/Home", "/"]},
            "owner_id": owner_id,
            "trashed": {"$ne": True}
        })
    elif top_name == "Telegram Inbox":
        file_doc = database.Files.find_one({
            "file_path": "/Telegram Inbox",
            "file_name": target_name,
            "owner_id": owner_id,
            "trashed": {"$ne": True}
        })
    elif top_name == "Starred":
        file_doc = database.Files.find_one({
            "file_name": target_name,
            "starred": True,
            "owner_id": owner_id,
            "trashed": {"$ne": True}
        })
    elif top_name == "Trash":
        file_doc = database.Files.find_one({
            "file_name": target_name,
            "trashed": True,
            "owner_id": owner_id
        })

    if not file_doc:
        raise HTTPException(status_code=404, detail="File not found")

    file_size = file_doc.get("file_size", 0)
    chat_id = file_doc.get("chat_id")
    message_id = file_doc.get("message_id")
    parts = file_doc.get("parts")
    content_type = resolve_mime_type(target_name, explicit_mime=file_doc.get("mime_type"), is_watch=True)

    if is_head:
        return Response(
            status_code=200,
            headers={
                "Content-Length": str(file_size),
                "Content-Type": content_type,
                "Accept-Ranges": "bytes",
                "Last-Modified": format_dav_date(file_doc.get("modified_date")),
            }
        )

    # GET stream
    bot_manager = getattr(request.app.state, "bot_manager", None)
    if not bot_manager:
        raise HTTPException(status_code=503, detail="Bot worker pool not ready")

    client = bot_manager.get_least_busy_client()
    if not client:
        raise HTTPException(status_code=503, detail="No active bot client")

    range_header = request.headers.get("Range", "")
    try:
        from_bytes, until_bytes = parse_range_header(range_header, file_size)
    except ValueError:
        return Response(
            status_code=416,
            headers={
                "Content-Range": f"bytes */{file_size}",
                "Accept-Ranges": "bytes",
            }
        )

    req_length = until_bytes - from_bytes + 1

    # Prepare streaming parts
    if not parts:
        parts_list = [{
            "part_index": 1,
            "chat_id": chat_id,
            "message_id": message_id,
            "start_byte": 0,
            "end_byte": file_size - 1,
            "part_size": file_size,
        }]
    else:
        parts_list = parts

    parts_to_stream = []
    for p in parts_list:
        p_start = p.get("start_byte", 0)
        p_end = p.get("end_byte", p_start + p.get("part_size", 0) - 1)
        if p_end < from_bytes or p_start > until_bytes:
            continue

        overlap_start = max(from_bytes, p_start)
        overlap_end = min(until_bytes, p_end)

        parts_to_stream.append({
            "chat_id": p.get("chat_id", chat_id),
            "message_id": p.get("message_id", message_id),
            "part_from_byte": overlap_start - p_start,
            "part_until_byte": overlap_end - p_start,
            "part_index": p.get("part_index", 1),
        })

    tg_connect = get_byte_streamer(client)
    active_clients = [c for c in getattr(bot_manager, "client_list", []) if getattr(c, "is_connected", False)] or [client]

    body = tg_connect.yield_parts(
        parts_to_stream=parts_to_stream,
        chunk_size=1024 * 1024,
        client_list=active_clients,
    )

    encoded_filename = urllib.parse.quote(target_name)
    ascii_fallback = re.sub(r'[^\x20-\x7E]', '_', target_name).replace('"', '_')
    headers = {
        "Content-Length": str(req_length),
        "Content-Type": content_type,
        "Accept-Ranges": "bytes",
        "Cache-Control": "public, max-age=3600, immutable",
        "Last-Modified": format_dav_date(file_doc.get("modified_date")),
        "Content-Disposition": f'inline; filename="{ascii_fallback}"; filename*=UTF-8\'\'{encoded_filename}',
        "X-Content-Type-Options": "nosniff",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Expose-Headers": "Content-Length, Content-Range, Accept-Ranges",
    }
    if range_header:
        headers["Content-Range"] = f"bytes {from_bytes}-{until_bytes}/{file_size}"

    return StreamingResponse(
        body,
        status_code=206 if range_header else 200,
        headers=headers
    )


async def handle_put(request: Request, segments: List[str], owner_id: str, default_chat_id: Optional[int]) -> Response:
    """Handle WebDAV file upload via HTTP PUT."""
    if len(segments) < 2:
        raise HTTPException(status_code=400, detail="Cannot upload to root directly")

    top_name = segments[0]
    file_name = segments[-1]

    if top_name == "Home":
        target_folder_path = "/" + "/".join(segments[:-1])
    elif top_name == "Telegram Inbox":
        target_folder_path = "/Telegram Inbox"
    else:
        raise HTTPException(status_code=403, detail=f"Cannot upload directly to {top_name}")

    bot_manager = getattr(request.app.state, "bot_manager", None)
    if not bot_manager:
        raise HTTPException(status_code=503, detail="Bot worker pool not ready")

    client = bot_manager.get_least_busy_client()
    if not client:
        raise HTTPException(status_code=503, detail="No active bot client")

    if not default_chat_id:
        raise HTTPException(status_code=400, detail="No valid storage channel configured for uploads")

    tg_files_dir = os.path.join(os.getcwd(), "tg_files")
    os.makedirs(tg_files_dir, exist_ok=True)
    PART_MAX_SIZE = 1950 * 1024 * 1024  # 1950 MB Telegram Bot file limit
    upload_id = secrets.token_hex(8)
    part_index = 1
    current_part_file = os.path.join(tg_files_dir, f"dav_{upload_id}_part_{part_index}.tmp")
    current_part_written = 0
    total_written = 0
    upload_tasks: List[asyncio.Task] = []
    disk_semaphore = asyncio.Semaphore(2)  # Max 2 parts buffered on VM disk (~3.9 GB cap)
    await disk_semaphore.acquire()  # Acquire buffer slot for Part 1

    # Categorize file type upfront
    ext = file_name.split(".")[-1].lower() if "." in file_name else ""
    file_type = "document"
    if ext in ["mp4", "mkv", "avi", "mov", "webm", "ts", "3gp"]:
        file_type = "video"
    elif ext in ["jpg", "jpeg", "png", "gif", "webp"]:
        file_type = "photo"
    elif ext in ["mp3", "wav", "ogg", "flac", "m4a"]:
        file_type = "audio"

    part_f = await aiofiles.open(current_part_file, "wb")
    try:
        async for chunk in request.stream():
            chunk_len = len(chunk)
            if current_part_written + chunk_len > PART_MAX_SIZE:
                split_point = PART_MAX_SIZE - current_part_written
                if split_point > 0:
                    await part_f.write(chunk[:split_point])
                    current_part_written += split_point
                    total_written += split_point

                await part_f.close()

                # Dispatch this part to Telegram in background (NON-BLOCKING!)
                # While Telegram uploads this part, the HTTP loop immediately starts receiving the next part!
                logger.info(
                    f"[WEBDAV_PUT] Part {part_index} reached {current_part_written} bytes. "
                    f"Dispatching to background Telegram uploader for '{file_name}'..."
                )
                p_task = asyncio.create_task(
                    upload_part_task(
                        part_file_path=current_part_file,
                        part_index=part_index,
                        file_name=file_name,
                        start_byte=total_written - current_part_written,
                        part_size=current_part_written,
                        chat_id=default_chat_id,
                        bot_manager=bot_manager,
                        fallback_client=client,
                        caption=f"{file_name} (Part {part_index})",
                        semaphore=disk_semaphore,
                        is_single_part=False,
                        file_type=file_type
                    )
                )
                upload_tasks.append(p_task)

                # Acquire buffer slot for next part (applies backpressure if 2 parts on disk)
                await disk_semaphore.acquire()

                # Immediately start receiving next part without waiting for Telegram upload!
                part_index += 1
                current_part_file = os.path.join(tg_files_dir, f"dav_{upload_id}_part_{part_index}.tmp")
                part_f = await aiofiles.open(current_part_file, "wb")
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

        if total_written == 0:
            disk_semaphore.release()
            if os.path.exists(current_part_file):
                os.remove(current_part_file)
            raise HTTPException(status_code=400, detail="Cannot upload empty files")

        # Case 1: Single-part file (<= 1950MB)
        if len(upload_tasks) == 0:
            logger.info(f"[WEBDAV_PUT] Uploading single part file '{file_name}' ({total_written} bytes)...")
            res = await upload_part_task(
                part_file_path=current_part_file,
                part_index=1,
                file_name=file_name,
                start_byte=0,
                part_size=total_written,
                chat_id=default_chat_id,
                bot_manager=bot_manager,
                fallback_client=client,
                caption=f"WebDAV upload: {file_name}",
                semaphore=disk_semaphore,
                is_single_part=True,
                file_type=file_type
            )

            existing = database.Files.find_one({
                "file_name": file_name,
                "file_path": target_folder_path,
                "owner_id": owner_id,
                "trashed": {"$ne": True}
            })
            if existing:
                database.Files.update_one(
                    {"_id": existing["_id"]},
                    {"$set": {
                        "chat_id": default_chat_id,
                        "message_id": res["message_id"],
                        "file_unique_id": res["file_unique_id"],
                        "file_size": total_written,
                        "thumbnail": res["thumbnail"],
                        "file_type": file_type,
                        "parts": None,
                        "modified_date": datetime.now(timezone.utc).isoformat()
                    }}
                )
            else:
                database.Files.add_file(
                    chat_id=default_chat_id,
                    message_id=res["message_id"],
                    thumbnail=res["thumbnail"],
                    file_type=file_type,
                    file_unique_id=res["file_unique_id"],
                    file_size=total_written,
                    file_name=file_name,
                    file_caption=f"WebDAV upload: {file_name}",
                    file_path=target_folder_path,
                    owner_id=owner_id
                )
        else:
            # Case 2: Multi-part file (> 1950MB)
            if current_part_written > 0:
                logger.info(f"[WEBDAV_PUT] Dispatching final part {part_index} ({current_part_written} bytes) for '{file_name}'...")
                final_task = asyncio.create_task(
                    upload_part_task(
                        part_file_path=current_part_file,
                        part_index=part_index,
                        file_name=file_name,
                        start_byte=total_written - current_part_written,
                        part_size=current_part_written,
                        chat_id=default_chat_id,
                        bot_manager=bot_manager,
                        fallback_client=client,
                        caption=f"{file_name} (Part {part_index}/{part_index})",
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

            # Wait for all background part uploads to complete
            logger.info(f"[WEBDAV_PUT] Awaiting completion of {len(upload_tasks)} background upload part(s) for '{file_name}'...")
            results = await asyncio.gather(*upload_tasks)
            results.sort(key=lambda x: x["part_index"])

            first_res = results[0]
            first_msg_id = first_res["message_id"]
            first_thumbnail = next((r["thumbnail"] for r in results if r.get("thumbnail")), None)
            first_media_unique_id = first_res["file_unique_id"]

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

            existing = database.Files.find_one({
                "file_name": file_name,
                "file_path": target_folder_path,
                "owner_id": owner_id,
                "trashed": {"$ne": True}
            })
            if existing:
                database.Files.update_one(
                    {"_id": existing["_id"]},
                    {"$set": {
                        "chat_id": default_chat_id,
                        "message_id": first_msg_id,
                        "file_unique_id": first_media_unique_id or f"dav_{first_msg_id}",
                        "file_size": total_written,
                        "thumbnail": first_thumbnail,
                        "file_type": file_type,
                        "parts": parts,
                        "modified_date": datetime.now(timezone.utc).isoformat()
                    }}
                )
            else:
                database.Files.insert_one({
                    "chat_id": default_chat_id,
                    "message_id": first_msg_id,
                    "thumbnail": first_thumbnail,
                    "file_type": file_type,
                    "file_unique_id": first_media_unique_id or f"dav_{first_msg_id}",
                    "file_size": total_written,
                    "file_name": file_name,
                    "file_caption": f"WebDAV upload: {file_name}",
                    "file_path": target_folder_path,
                    "owner_id": owner_id,
                    "parts": parts,
                    "modified_date": datetime.now(timezone.utc).isoformat(),
                    "starred": False,
                    "trashed": False
                })

        return Response(status_code=201)
    finally:
        if 'part_f' in locals() and not part_f.closed:
            await part_f.close()
        # Cancel any unfinished tasks if an exception aborted the request
        for t in upload_tasks:
            if not t.done():
                t.cancel()
        # Clean up any leftover temporary files for this upload session
        for tmp in glob.glob(os.path.join(tg_files_dir, f"dav_{upload_id}_part_*.tmp")):
            try:
                os.remove(tmp)
            except Exception:
                pass
