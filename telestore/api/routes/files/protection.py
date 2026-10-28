# telestore/api/routes/files/protection.py
"""Protect from deletion, folder colours, and photo details (see the services of the same names)."""

from typing import Optional

from bson import ObjectId
from fastapi import Depends, HTTPException, Request
from pydantic import BaseModel

from telestore.api.routes.files.common import logger, router
from telestore.db import database
from telestore.security.attempt_limiter import TooManyAttempts, password_limiter, wait_message
from telestore.security.credentials import User, require_auth
from telestore.services import protection_service as protection


class UnlockRequest(BaseModel):
    password: Optional[str] = None
    code: Optional[str] = None


class ProtectRequest(BaseModel):
    file_id: str
    protected: bool
    unlock_token: Optional[str] = None


class ColorRequest(BaseModel):
    file_id: str
    color: Optional[str] = None


def owner_ids(user: User) -> list:
    return [i for i in {user.username, str(user.telegram_user_id) if user.telegram_user_id else None} if i]


def _own(file_id: str, user: User) -> dict:
    if not ObjectId.is_valid(file_id):
        raise HTTPException(status_code=404, detail="File or folder not found")
    doc = database.Files.find_one({"_id": ObjectId(file_id), "owner_id": {"$in": owner_ids(user)}})
    if not doc:
        raise HTTPException(status_code=404, detail="File or folder not found")
    return doc


def locked(message: str) -> HTTPException:
    """423: the client asks for the password (or code) and tries again with the unlock token."""
    return HTTPException(status_code=423, detail=message)


@router.get("/protection")
def protection_method(user: User = Depends(require_auth)):
    """How this account confirms deleting protected files."""
    return protection.method(user.username)


@router.post("/protection/code")
async def send_protection_code(user: User = Depends(require_auth)):
    """Accounts without a password get a 6-digit code by email instead."""
    from telestore.services.email_service import create_and_send_vault_otp
    user_data = database.Users.getUser(user.username) or {}
    email = (user_data.get("email") or user.email or "").strip()
    if not email:
        raise HTTPException(status_code=400, detail="Your account has no email. Set a password in Settings › Account instead.")
    try:
        await create_and_send_vault_otp(email, user.username, purpose=protection.CODE_PURPOSE, label="TeleStore")
    except ValueError as e:  # asked too often
        raise HTTPException(status_code=429, detail=str(e))
    return {"message": f"Code sent to {protection.hint(email)}."}


@router.post("/protection/unlock")
async def unlock_protection(body: UnlockRequest, user: User = Depends(require_auth)):
    """Checks the password (or email code) and returns a token that unlocks deleting for 5 minutes."""
    key = f"pw:{user.username.strip().lower()}"
    try:
        password_limiter.check(key)
    except TooManyAttempts as e:
        raise HTTPException(status_code=429, detail=wait_message(e.retry_after), headers={"Retry-After": str(e.retry_after)})
    if body.password:
        ok = protection.password_ok(user.username, body.password)
    elif body.code:
        from telestore.services.email_service import verify_vault_otp
        user_data = database.Users.getUser(user.username) or {}
        email = (user_data.get("email") or user.email or "").strip()
        ok = bool(email) and await verify_vault_otp(email, user.username, body.code.strip(), protection.CODE_PURPOSE)
    else:
        raise HTTPException(status_code=400, detail="Enter your password.")
    if not ok:
        lock = password_limiter.failure(key)
        if lock:
            raise HTTPException(status_code=429, detail=wait_message(lock), headers={"Retry-After": str(lock)})
        raise HTTPException(status_code=400, detail="Wrong password." if body.password else "Wrong or expired code.")
    password_limiter.success(key)
    return {"unlock_token": protection.issue_token(user.username), "expires_in": protection.TOKEN_SECONDS}


@router.post("/protect")
def protect_route(body: ProtectRequest, user: User = Depends(require_auth)):
    """Turns protection on (free) or off (needs the unlock token, so a slip can't undo it)."""
    doc = _own(body.file_id, user)
    if doc.get("is_vault"):
        raise HTTPException(status_code=400, detail="Private Vault files are already locked.")
    if not body.protected and doc.get("protected") and not protection.token_valid(body.unlock_token, user.username):
        raise locked(f"Confirm with your password to remove protection from “{doc.get('file_name')}”.")
    database.Files.update_one({"_id": doc["_id"]}, {"$set": {"protected": True}} if body.protected else {"$unset": {"protected": ""}})
    logger.info(f"{'Protected' if body.protected else 'Unprotected'} {doc.get('file_name')} for {user.username}")
    return {"protected": body.protected}


@router.post("/color")
def folder_color(body: ColorRequest, user: User = Depends(require_auth)):
    try:
        protection.set_color(body.file_id, owner_ids(user), body.color)
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"color": body.color}


@router.get("/{file_id}/photo-info")
async def photo_info(file_id: str, request: Request, user: User = Depends(require_auth)):
    """Camera, exposure, size, date and location from the photo itself (read once, then kept)."""
    import asyncio
    from telestore.api.routes import media
    from telestore.services import photo_info_service
    from telestore.services.preview_service import preview_kind

    doc = _own(file_id, user)
    if doc.get("is_vault"):
        from telestore.api.routes.vault import is_vault_unlocked
        if not is_vault_unlocked(request):
            raise HTTPException(status_code=403, detail="Unlock your Private Vault first.")
    if preview_kind(doc) != "image":
        raise HTTPException(status_code=422, detail="Details are only read from photos.")
    info = doc.get("photo_info")
    if info is None:
        source = media._get_internal_stream_url(doc.get("file_name", ""), media._caller_token(request, None, user), file_id)
        try:
            info = await asyncio.to_thread(photo_info_service.read, source, doc.get("file_size"))
        except Exception as e:
            logger.info(f"No photo details for {doc.get('file_name')}: {e}")
            raise HTTPException(status_code=422, detail="This photo's details couldn't be read.")
        database.Files.update_one({"_id": doc["_id"]}, {"$set": {"photo_info": info}})
    parent = doc.get("file_path") or "/"
    return {**info, "file_name": doc.get("file_name"), "file_size": doc.get("file_size"), "folder": parent, "taken_at": info.get("taken_at") or doc.get("taken_at")}
