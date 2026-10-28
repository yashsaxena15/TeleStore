# telestore/api/routes/files/browse.py

from fastapi import Request, Depends, HTTPException, Response , Query
import asyncio
from typing import Optional
from dataclasses import asdict

from telestore.security.credentials import require_auth, User
from telestore.db import database

# For thumbnail route
from pyrogram import Client

from telestore.api.routes.files.common import logger, router

def is_vault_path(path: str) -> bool:
    clean = (path or "").strip().lower().lstrip("/")
    return clean == "vault" or clean.startswith("vault/")


@router.get("")
@router.get("/")
async def get_all_files_route(
    request: Request,
    path: str = Query(default="/", description="Folder path to fetch files from"),
    page: Optional[int] = Query(default=None, ge=1, description="Page number (1-indexed)"),
    page_size: Optional[int] = Query(default=None, ge=1, le=500, description="Items per page"),
    sort_by: Optional[str] = Query(default=None, description="Field to sort by (name, date, size)"),
    sort_order: Optional[str] = Query(default=None, description="Sort direction (asc, desc)"),
    q: Optional[str] = Query(default=None, max_length=200, description="Search names in all your folders (path is ignored)"),
    kind: Optional[str] = Query(default=None, description="With path=all: only video, photo, audio or document files"),
    under: Optional[str] = Query(default=None, max_length=500, description="With path=all: only files inside this /Home folder and its subfolders"),
    user: User = Depends(require_auth)
):
    try:
        # Fetch files for the specified path and user
        logger.info(f"Fetching files for path {path} and user {user} (page={page}, page_size={page_size})")
        # Use the user's Telegram ID as the user identifier
        user_id = str(user.telegram_user_id) if user.telegram_user_id else user.username

        # The Private Vault's contents (names, thumbnails) only while it is unlocked with the PIN
        if is_vault_path(path):
            from telestore.api.routes.vault import is_vault_unlocked
            if not is_vault_unlocked(request):
                raise HTTPException(status_code=403, detail="Vault is locked. Please unlock Vault first.")

        # Fast non-blocking catchup check if user is accessing Telegram Inbox
        if path in ["inbox", "/inbox", "Telegram Inbox", "/Telegram Inbox", "/Home/Telegram Inbox"]:
            try:
                bot_manager = getattr(request.app.state, 'bot_manager', None)
                if bot_manager:
                    client = bot_manager.get_least_busy_client() if hasattr(bot_manager, 'get_least_busy_client') else None
                    if not client and hasattr(bot_manager, 'client_list') and bot_manager.client_list:
                        client = bot_manager.client_list[0]
                    if client:
                        user_doc = database.Users.find_one({
                            "$or": [
                                {"telegram_user_id": user.telegram_user_id},
                                {"username": user.username}
                            ]
                        }) if hasattr(database, 'Users') else None
                        chat_id = user_doc.get("index_chat_id") if user_doc else None
                        if chat_id:
                            from telestore.telegram.plugins.channel_listener import catchup_channel_inbox
                            # Max 1.2s timeout so the UI request remains instantaneous
                            await asyncio.wait_for(
                                catchup_channel_inbox(client, chat_id, user_id, max_lookahead=100),
                                timeout=1.2
                            )
            except asyncio.TimeoutError:
                logger.info("[FILES_ROUTE] Inbox catchup timed out after 1.2s; loading existing files")
            except Exception as sync_err:
                logger.warning(f"[FILES_ROUTE] Inbox catchup error: {sync_err}")

        is_paginated = (page is not None or page_size is not None)
        if is_paginated:
            p = max(1, page or 1)
            ps = max(1, min(500, page_size or 50))
            files_data, total_items = database.Files.get_files_by_path(
                path=path,
                owner_id=user_id,
                page=p,
                page_size=ps,
                sort_by=sort_by,
                sort_order=sort_order,
                folders_first=True,
                q=q,
                kind=kind,
                under=under
            )
        else:
            files_data = database.Files.get_files_by_path(path=path, owner_id=user_id, q=q, kind=kind, under=under)
            total_items = len(files_data)

        from telestore.services.protection_service import protected_folders_of
        guards = protected_folders_of([user_id])
        files_list = []
        for f in files_data:
            f_dict = asdict(f)
            f_dict['id'] = str(f_dict['id'])  # Convert ObjectId to string
            f_dict['file_unique_id'] = f.file_unique_id  # Include file_unique_id for streaming
            # Inside a protected folder: protected too (apps hide Move to Trash for it)
            f_dict['protected_by'] = guards.covering(f_dict.get('original_path') if f_dict.get('trashed') else f_dict.get('file_path'))
            files_list.append(f_dict)

        if is_paginated:
            import math
            total_pages = math.ceil(total_items / ps) if total_items > 0 else 1
            start_index = (p - 1) * ps + 1 if total_items > 0 else 0
            end_index = min(p * ps, total_items)
            return {
                "files": files_list,
                "pagination": {
                    "page": p,
                    "page_size": ps,
                    "total_items": total_items,
                    "total_pages": total_pages,
                    "has_next": p < total_pages,
                    "has_prev": p > 1,
                    "start_index": start_index,
                    "end_index": end_index
                }
            }

        return {"files": files_list}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching files for path {path}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/analytics")
async def get_storage_analytics_route(user: User = Depends(require_auth)):
    try:
        user_id = str(user.telegram_user_id) if user.telegram_user_id else user.username
        stats = database.Files.get_storage_analytics(user_id)
        from telestore.config import STORAGE_QUOTA_BYTES
        used = stats.get("total_bytes") or 0
        return {**stats, "quota_bytes": STORAGE_QUOTA_BYTES, "free_bytes": max(0, STORAGE_QUOTA_BYTES - used)}
    except Exception as e:
        logger.error(f"Error getting storage analytics: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# Add file upload endpoint

@router.get("/thumbnail/{file_id}")
async def get_file_thumbnail(file_id: str, request: Request, auth_token: str = None):
    # Check authentication - first try the normal auth, then check for token in query params
    try:
        # This will raise an exception if not authenticated via normal means
        require_auth(request)
    except HTTPException:
        # Image tags can't send headers, so the token may come in the address instead. The shared
        # check honours expiry and sign-out (this route used to keep its own copy that didn't).
        from telestore.api.state import _auth_tokens as shared_tokens, cached_token, cached_token_valid
        if not auth_token:
            raise HTTPException(status_code=401, detail="Authentication required")
        if not cached_token_valid(auth_token):
            db_token_data = database.Users.get_auth_token(auth_token)
            if not db_token_data:
                raise HTTPException(status_code=401, detail="Authentication required")
            shared_tokens[auth_token] = cached_token(db_token_data)

    try:
        bot_manager = request.app.state.bot_manager
        if not bot_manager:
            raise HTTPException(status_code=503, detail="Bot manager not available")

        # Get a client to use for downloading
        client: Client = bot_manager.get_least_busy_client() if hasattr(bot_manager, 'get_least_busy_client') else None
        if not client:
            raise HTTPException(status_code=500, detail="No available bot clients")
        
        photo_data = await client.download_media(file_id, in_memory=True)
        if photo_data:
            # Check if it's a BytesIO object
            if hasattr(photo_data, 'getvalue'):
                photo_bytes = photo_data.getvalue()
                if len(photo_bytes) > 0:
                    # Return the photo data
                    return Response(
                        content=photo_bytes,
                        media_type="image/jpeg",
                        headers={"Cache-Control": "max-age=3600"}  # Cache for 1 hour
                    )
            else:
                # If it's already bytes, return directly
                if len(photo_data) > 0:
                    return Response(
                        content=photo_data,
                        media_type="image/jpeg",
                        headers={"Cache-Control": "max-age=3600"}  # Cache for 1 hour
                    )
    except HTTPException:
        raise
    except Exception as e:
        # A thumbnail Telegram no longer has (or a bad id) is "not found", so apps show their own icon
        logger.warning(f"Thumbnail not available: {e}")
        raise HTTPException(status_code=404, detail="Thumbnail not available")
    raise HTTPException(status_code=404, detail="Thumbnail not available")


@router.get("/preview/{file_id}")
async def get_file_preview(file_id: str, request: Request, token: Optional[str] = None, user: User = Depends(require_auth)):
    """A JPEG preview of a photo or video that has no Telegram thumbnail (made once, then kept).

    Image tags can't send headers, so apps pass ?token= (accepted by the auth middleware).
    """
    from bson import ObjectId
    from fastapi.responses import FileResponse
    from telestore.api.routes import media
    from telestore.services.preview_service import make_preview

    if not ObjectId.is_valid(file_id):
        raise HTTPException(status_code=404, detail="Preview not available")
    owner_ids = [i for i in {user.username, str(user.telegram_user_id) if user.telegram_user_id else None} if i]
    doc = database.Files.find_one({"_id": ObjectId(file_id), "owner_id": {"$in": owner_ids}, "trashed": {"$ne": True}})
    if not doc:
        raise HTTPException(status_code=404, detail="Preview not available")
    if doc.get("is_vault"):
        from telestore.api.routes.vault import is_vault_unlocked
        if not is_vault_unlocked(request):
            raise HTTPException(status_code=403, detail="Unlock your Private Vault first.")
    source = media._get_internal_stream_url(doc.get("file_name", ""), media._caller_token(request, token, user), file_id)
    path = await make_preview(doc, source)
    if not path:
        raise HTTPException(status_code=404, detail="Preview not available")
    return FileResponse(path, media_type="image/jpeg", headers={"Cache-Control": "private, max-age=604800"})
