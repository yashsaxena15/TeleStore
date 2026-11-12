# telestore/api/routes/direct.py
"""Direct uploads from the Windows app (November 2026).

The app signs in to the person's own Telegram account and uploads straight to their storage channel
at their own connection's speed; no file data passes through this server. The server only:

- POST /direct/prepare: says where the file goes (the person's storage channel), how it is cut into
  parts (1.95 GB, read by position from the original file) and the caption of each message, after
  the same checks as an upload through the server;
- POST /direct/complete: reads those messages with the server's bots, checks they are in the
  person's own channel with the right sizes and captions, and only then saves the file record, in
  the same format as any other upload (so the website, the Android app, streaming, WebDAV and
  sharing all work with it unchanged).

The captions are the ones the server's own uploads use ("Uploaded file: <name>" and "<name> (Part
N)"), so the Telegram Inbox listener leaves these messages alone. GET /direct/config gives a signed-in
uploader the Telegram app ID the desktop app signs in with.

GET /direct/locate/{file_id} (phase 10) says which messages of the person's own channel hold one of
their own files, so the app can view, play and download it straight from Telegram with their account.
Never for vault files (the vault's lock stays on the server) or anyone else's.
"""

import math
import os
from typing import List, Optional

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from telestore.config import API_HASH, API_ID
from telestore.db import database
from telestore.security.credentials import User, require_auth, require_upload
from d4rk.Logs import setup_logger

logger = setup_logger("direct_routes")
router = APIRouter(prefix="/direct", tags=["Direct upload"])

PART_SIZE = 1950 * 1024 * 1024  # Telegram's limit for one file, as every other upload uses
MAX_PARTS = 512  # about 1 TB
NOT_HERE = ("/telegram inbox", "telegram inbox", "/inbox", "inbox", "/trash", "trash", "/starred", "starred")
VIDEO = {".mp4", ".mkv", ".avi", ".mov", ".wmv", ".flv", ".webm", ".m4v", ".ts", ".3gp", ".ogv"}
AUDIO = {".mp3", ".wav", ".ogg", ".flac", ".m4a", ".opus", ".aac"}
PHOTO = {".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp"}


class PrepareRequest(BaseModel):
    path: str = "/Home"
    filename: str = Field(min_length=1, max_length=255)
    filesize: int


class DirectPart(BaseModel):
    part_index: int
    message_id: int


class CompleteRequest(PrepareRequest):
    parts: List[DirectPart]
    taken_at: Optional[str] = None  # when a photo or video was taken, if the app knows


def file_type(name: str) -> str:
    ext = os.path.splitext(name)[1].lower()
    return "video" if ext in VIDEO else "audio" if ext in AUDIO else "photo" if ext in PHOTO else "document"


def plan(filename: str, filesize: int) -> List[dict]:
    """The messages a file becomes: one for a file up to 1.95 GB, else one per 1.95 GB part."""
    total = max(1, math.ceil(filesize / PART_SIZE))
    if total == 1:
        return [{"part_index": 1, "start": 0, "length": filesize, "file_name": filename,
                 "caption": f"Uploaded file: {filename}"}]
    return [{"part_index": i, "start": (i - 1) * PART_SIZE, "length": min(PART_SIZE, filesize - (i - 1) * PART_SIZE),
             "file_name": f"{filename}.part{i}", "caption": f"{filename} (Part {i})"} for i in range(1, total + 1)]


def _clean_name(name: str) -> str:
    name = (name or "").strip()
    if not name or name in (".", "..") or "/" in name or "\\" in name or "\x00" in name:
        raise HTTPException(status_code=400, detail="That file name can't be used.")
    return name


def _clean_path(path: str) -> str:
    path = "/" + (path or "/Home").strip().strip("/")
    if path == "/":
        path = "/Home"
    low = path.lower()
    if low in NOT_HERE or low.startswith(("/telegram inbox/", "/trash/", "/starred/")):
        raise HTTPException(status_code=400, detail="Cannot upload files directly to Telegram Inbox, Trash, or Starred.")
    if low == "/vault" or low.startswith("/vault/"):
        raise HTTPException(status_code=400, detail="The Windows app can't upload to the Private Vault yet. Use the website or the Android app.")
    if any(seg in ("", ".", "..") for seg in path.split("/")[1:]):
        raise HTTPException(status_code=400, detail="That folder path can't be used.")
    return path


def _storage_chat(user: User) -> int:
    if not user.telegram_user_id:
        raise HTTPException(status_code=400, detail="TELEGRAM_NOT_VERIFIED: Please verify your Telegram account before uploading files")
    user_data = database.Users.find_one({"telegram_user_id": {"$in": [int(user.telegram_user_id), str(user.telegram_user_id)]}}) or {}
    chat_id = user_data.get("index_chat_id")
    if not chat_id:
        raise HTTPException(status_code=400, detail="Your storage channel isn't set up yet. Set it up with the TeleStore bot first.")
    return int(chat_id)


def _check(req: PrepareRequest, user: User):
    name = _clean_name(req.filename)
    path = _clean_path(req.path)
    if req.filesize <= 0:
        raise HTTPException(status_code=400, detail="Empty files can't be uploaded (Telegram can't store them)")
    parts = plan(name, req.filesize)
    if len(parts) > MAX_PARTS:
        raise HTTPException(status_code=400, detail="That file is too big.")
    return name, path, parts, _storage_chat(user)


@router.get("/config")
async def direct_config(user: User = Depends(require_upload)):
    """What the desktop app needs to sign in to Telegram: the app ID (DESKTOP_API_ID / DESKTOP_API_HASH
    if set, else the server's own)."""
    api_id = os.getenv("DESKTOP_API_ID") or API_ID
    api_hash = os.getenv("DESKTOP_API_HASH") or API_HASH
    if not api_id or not api_hash:
        raise HTTPException(status_code=503, detail="Direct upload isn't set up on this server.")
    return {"api_id": int(api_id), "api_hash": api_hash, "part_size": PART_SIZE}


@router.post("/prepare")
async def direct_prepare(req: PrepareRequest, user: User = Depends(require_upload)):
    name, path, parts, chat_id = _check(req, user)
    return {"chat_id": chat_id, "path": path, "file_name": name, "file_size": req.filesize,
            "part_size": PART_SIZE, "total_parts": len(parts), "parts": parts}


def _clients(request: Request) -> list:
    manager = getattr(request.app.state, "bot_manager", None)
    if not manager:
        return []
    first = manager.get_least_busy_client() if hasattr(manager, "get_least_busy_client") else None
    found = []
    for client in [first, *(getattr(manager, "client_list", None) or [])]:
        if client is not None and all(client is not other for other in found):
            found.append(client)
    return found


async def _read_messages(request: Request, chat_id: int, ids: List[int]) -> dict:
    """The messages by id, read by the first bot that can; a missing one is left out."""
    last = None
    for client in _clients(request):
        try:
            got = await client.get_messages(chat_id, ids)
            got = got if isinstance(got, list) else [got]
            return {m.id: m for m in got if m is not None and not getattr(m, "empty", False)}
        except Exception as e:  # another bot may still reach the channel
            last = e
            logger.warning(f"[DIRECT] A bot couldn't read messages of chat {chat_id}: {e}")
    raise HTTPException(status_code=503, detail=f"The server's bots couldn't read your channel right now ({last or 'no bot available'}). Try again in a minute.")


def _media(msg):
    return msg.document or msg.video or msg.audio or msg.photo or getattr(msg, "voice", None)


@router.post("/complete")
async def direct_complete(req: CompleteRequest, request: Request, user: User = Depends(require_upload)):
    name, path, expected, chat_id = _check(req, user)
    given = {p.part_index: p.message_id for p in req.parts}
    if sorted(given) != [p["part_index"] for p in expected] or len(req.parts) != len(expected):
        raise HTTPException(status_code=400, detail=f"Expected parts 1 to {len(expected)}, one message each.")
    ids = [given[p["part_index"]] for p in expected]
    if len(set(ids)) != len(ids):
        raise HTTPException(status_code=400, detail="Each part must be its own message.")

    # A message already saved as another file can't become this one too
    chat_ids = [chat_id, str(chat_id)]
    for mid in ids:
        taken = database.Files.find_one({"$or": [{"chat_id": {"$in": chat_ids}, "message_id": mid},
                                                 {"parts.chat_id": {"$in": chat_ids}, "parts.message_id": mid}]})
        if taken and not (len(ids) == 1 and taken.get("file_path") == "/Telegram Inbox"):
            raise HTTPException(status_code=409, detail="That upload is already saved as a file.")

    messages = await _read_messages(request, chat_id, ids)
    results = []
    for part, mid in zip(expected, ids):
        msg = messages.get(mid)
        media = _media(msg) if msg else None
        if not media:
            raise HTTPException(status_code=400, detail=f"Part {part['part_index']} isn't in your storage channel.")
        if int(getattr(media, "file_size", 0) or 0) != part["length"]:
            raise HTTPException(status_code=400, detail=f"Part {part['part_index']} has the wrong size.")
        if (msg.caption or "").strip() != part["caption"]:
            raise HTTPException(status_code=400, detail=f"Part {part['part_index']} isn't this file's upload.")
        thumbs = getattr(media, "thumbs", None)
        results.append({"part_index": part["part_index"], "chat_id": chat_id, "message_id": mid,
                        "file_unique_id": getattr(media, "file_unique_id", None) or f"part_{part['part_index']}",
                        "part_size": part["length"], "start_byte": part["start"], "end_byte": part["start"] + part["length"] - 1,
                        "thumbnail": thumbs[0].file_id if thumbs else None})

    kind = file_type(name)
    owner = str(user.telegram_user_id)
    if len(results) == 1:
        res = results[0]
        doc = database.Files.claim_upload(
            chat_id=chat_id, message_id=res["message_id"], thumbnail=res["thumbnail"], file_type=kind,
            file_unique_id=res["file_unique_id"], file_size=req.filesize, file_name=name,
            file_caption=f"Uploaded file: {name}", file_path=path, owner_id=owner)
    else:
        parts = [{k: r[k] for k in ("part_index", "chat_id", "message_id", "file_unique_id", "part_size", "start_byte", "end_byte")}
                 for r in results]
        database.Files.add_multipart_file(
            chat_id=chat_id, thumbnail=next((r["thumbnail"] for r in results if r["thumbnail"]), None), file_type=kind,
            file_unique_id=results[0]["file_unique_id"], file_size=req.filesize, file_name=name,
            file_caption=f"Uploaded multi-part file: {name}", parts=parts, file_path=path, owner_id=owner, part_size=PART_SIZE)
        doc = database.Files.find_one({"chat_id": chat_id, "message_id": results[0]["message_id"], "is_split": True,
                                       "file_name": name, "owner_id": owner})
    if not doc:
        raise HTTPException(status_code=500, detail=f"'{name}' reached Telegram but couldn't be saved. Try again.")
    if req.taken_at:
        database.Files.update_one({"_id": doc["_id"]}, {"$set": {"taken_at": req.taken_at}})
    logger.info(f"[DIRECT] '{name}' ({req.filesize} bytes, {len(results)} part(s)) saved to {path} for {owner}")
    return {"message": "File saved", "file": {"id": str(doc["_id"]), "file_name": name, "file_path": path,
                                              "file_type": kind, "file_size": req.filesize, "total_parts": len(results)}}


@router.get("/locate/{file_id}")
async def direct_locate(file_id: str, user: User = Depends(require_auth)):
    """Where one of the person's own files is in Telegram: its messages, in order, with their sizes."""
    from telestore.api.routes.files.protection import owner_ids
    doc = database.Files.find_one({"_id": ObjectId(file_id), "owner_id": {"$in": owner_ids(user)}}) \
        if ObjectId.is_valid(file_id) else None
    if not doc or doc.get("file_type") == "folder" or not doc.get("chat_id") and not doc.get("parts"):
        raise HTTPException(status_code=404, detail="File not found")
    if doc.get("is_vault") or str(doc.get("file_path") or "").lower().startswith("/vault"):
        raise HTTPException(status_code=403, detail="Private Vault files open through the server.")
    size = int(doc.get("file_size") or 0)
    if doc.get("is_split") and doc.get("parts"):
        parts = [{"chat_id": int(p["chat_id"]), "message_id": int(p["message_id"]), "size": int(p.get("part_size") or 0),
                  "start": int(p.get("start_byte") or 0)} for p in sorted(doc["parts"], key=lambda p: p.get("part_index", 0))]
    else:
        parts = [{"chat_id": int(doc["chat_id"]), "message_id": int(doc["message_id"]), "size": size, "start": 0}]
    return {"id": str(doc["_id"]), "name": doc.get("file_name") or "file", "size": size, "parts": parts}
