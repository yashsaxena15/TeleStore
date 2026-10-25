# telestore/api/routes/webdav/dispatcher.py
import asyncio

from fastapi import Request, Response, HTTPException


from telestore.security.credentials import ACCOUNT_DISABLED, UPLOADS_DISABLED, account_flags
from telestore.api.routes.webdav.common import authenticate_webdav, parse_webdav_path, router
from telestore.api.routes.webdav.operations import handle_copy, handle_delete, handle_lock, handle_mkcol, handle_move, handle_proppatch
from telestore.api.routes.webdav.propfind import handle_propfind
from telestore.api.routes.webdav.transfer import handle_get_head, handle_put

@router.api_route("", methods=["OPTIONS", "PROPFIND", "GET", "HEAD", "PUT", "DELETE", "MKCOL", "MOVE", "COPY", "LOCK", "UNLOCK", "PROPPATCH"])
@router.api_route("/", methods=["OPTIONS", "PROPFIND", "GET", "HEAD", "PUT", "DELETE", "MKCOL", "MOVE", "COPY", "LOCK", "UNLOCK", "PROPPATCH"])
@router.api_route("/{path:path}", methods=["OPTIONS", "PROPFIND", "GET", "HEAD", "PUT", "DELETE", "MKCOL", "MOVE", "COPY", "LOCK", "UNLOCK", "PROPPATCH"])
async def webdav_dispatcher(request: Request, path: str = ""):
    method = request.method.upper()

    # 1. OPTIONS: Handshake & capabilities (Clients like RaiDrive/Windows test this upfront)
    if method == "OPTIONS":
        return Response(
            status_code=200,
            headers={
                "DAV": "1, 2",
                "MS-Author-Via": "DAV",
                "Allow": "OPTIONS, GET, HEAD, POST, PUT, DELETE, TRACE, PROPFIND, PROPPATCH, MKCOL, COPY, MOVE, LOCK, UNLOCK",
                "Accept-Ranges": "bytes",
            }
        )

    # 2. Authenticate all operational WebDAV requests
    # In a thread: checking a password (scrypt + database) would otherwise stall every stream
    user_data, owner_id, default_chat_id = await asyncio.to_thread(authenticate_webdav, request)
    segments = parse_webdav_path(path)
    active, can_upload = account_flags(user_data.get("username"), user_data)
    if not active:
        raise HTTPException(status_code=403, detail=ACCOUNT_DISABLED)
    if method in ("PUT", "COPY") and not can_upload:
        raise HTTPException(status_code=403, detail=UPLOADS_DISABLED)

    # 3. Handle specific methods
    if method == "PROPFIND":
        return await handle_propfind(request, segments, owner_id)
    elif method in ("GET", "HEAD"):
        return await handle_get_head(request, segments, owner_id, is_head=(method == "HEAD"))
    elif method == "PUT":
        return await handle_put(request, segments, owner_id, default_chat_id)
    elif method == "MKCOL":
        return await handle_mkcol(request, segments, owner_id)
    elif method == "DELETE":
        return await handle_delete(request, segments, owner_id)
    elif method == "MOVE":
        return await handle_move(request, segments, owner_id)
    elif method == "COPY":
        return await handle_copy(request, segments, owner_id)
    elif method == "LOCK":
        return handle_lock(request)
    elif method == "UNLOCK":
        return Response(status_code=204)
    elif method == "PROPPATCH":
        return handle_proppatch(request)
    else:
        raise HTTPException(status_code=405, detail="Method Not Allowed")
