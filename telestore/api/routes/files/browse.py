# telestore/api/routes/files/browse.py

from fastapi import Request, Depends, HTTPException, Response , Query
import asyncio
from typing import Optional
from dataclasses import asdict

from telestore.security.credentials import require_auth, User
from telestore.db import database

# For thumbnail route
from pyrogram import Client

from telestore.api.routes.files.common import _auth_tokens, logger, router

@router.get("")
@router.get("/")
async def get_all_files_route(
    request: Request,
    path: str = Query(default="/", description="Folder path to fetch files from"),
    page: Optional[int] = Query(default=None, ge=1, description="Page number (1-indexed)"),
    page_size: Optional[int] = Query(default=None, ge=1, le=500, description="Items per page"),
    sort_by: Optional[str] = Query(default=None, description="Field to sort by (name, date, size)"),
    sort_order: Optional[str] = Query(default=None, description="Sort direction (asc, desc)"),
    user: User = Depends(require_auth)
):
    try:
        # Fetch files for the specified path and user
        logger.info(f"Fetching files for path {path} and user {user} (page={page}, page_size={page_size})")
        # Use the user's Telegram ID as the user identifier
        user_id = str(user.telegram_user_id) if user.telegram_user_id else user.username

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
                folders_first=True
            )
        else:
            files_data = database.Files.get_files_by_path(path=path, owner_id=user_id)
            total_items = len(files_data)

        files_list = []
        for f in files_data:
            f_dict = asdict(f)
            f_dict['id'] = str(f_dict['id'])  # Convert ObjectId to string
            f_dict['file_unique_id'] = f.file_unique_id  # Include file_unique_id for streaming
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
        # If normal auth fails, check for auth_token in query params
        if auth_token:
            # First check in-memory cache
            if auth_token in _auth_tokens:
                # Token is valid, proceed
                pass
            else:
                # Check in database if not found in memory
                try:
                    db_token_data = database.Users.get_auth_token(auth_token)
                    if db_token_data:
                        # Add to in-memory cache for future requests
                        _auth_tokens[auth_token] = {
                            "authenticated": True,
                            "username": db_token_data['username'],
                            "auth_method": db_token_data['auth_method'],
                            "created_at": db_token_data['created_at'].isoformat() if hasattr(db_token_data['created_at'], 'isoformat') else str(db_token_data['created_at'])
                        }
                        # Token is valid, proceed
                        pass
                    else:
                        # No valid authentication method
                        raise HTTPException(status_code=401, detail="Authentication required")
                except Exception as e:
                    logger.error(f"Failed to check auth token in database: {e}")
                    # No valid authentication method
                    raise HTTPException(status_code=401, detail="Authentication required")
        else:
            # No valid authentication method
            raise HTTPException(status_code=401, detail="Authentication required")
    
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
    except Exception as e:
        logger.error(f"Error downloading file thumbnail: {e}")
        raise HTTPException(status_code=500, detail=str(e))
