# src/Backend/routes/cloud_routes.py

import os
import re
import json
import base64
import secrets
import logging
import urllib.parse
import aiohttp
from typing import Optional, List, Dict, Any
from datetime import datetime, timezone
from fastapi import APIRouter, Request, Depends, HTTPException, Query, status, UploadFile, File
from fastapi.responses import HTMLResponse, RedirectResponse, StreamingResponse
from pydantic import BaseModel

from ..security.credentials import require_auth, User
from ..modules.google_drive_manager import GoogleDriveManager
from ..modules.remote_transfer_manager import remote_transfer_manager
from src.Database import database
from src.Config import WEB_APP

logger = logging.getLogger("cloud_routes")

router = APIRouter(prefix="/cloud", tags=["Cloud Storage"])

class AuthUrlRequest(BaseModel):
    redirect_uri: Optional[str] = None
    custom_client_id: Optional[str] = None
    custom_client_secret: Optional[str] = None

class DeleteFileRequest(BaseModel):
    file_id: str
    permanent: Optional[bool] = False

class RenameFileRequest(BaseModel):
    file_id: str
    new_name: str

class CreateFolderRequest(BaseModel):
    parent_id: Optional[str] = "root"
    folder_name: str

class StarFileRequest(BaseModel):
    file_id: str
    starred: bool = True

class RestoreFileRequest(BaseModel):
    file_id: str

class TransferToTelegramRequest(BaseModel):
    source_file_id: str
    destination_path: Optional[str] = "/Home"
    operation: Optional[str] = "copy"  # "copy" or "cut"

class TransferFromTelegramRequest(BaseModel):
    source_file_ids: List[str] = []
    source_folder_paths: List[str] = []
    target_folder_id: Optional[str] = "root"
    operation: Optional[str] = "copy"  # "copy" or "cut"

def _get_base_redirect_uri(request: Request, provided_uri: Optional[str] = None) -> str:
    if provided_uri and provided_uri.strip():
        return provided_uri.strip()
    
    # Try WEB_APP config or request base url
    base = WEB_APP.rstrip("/") if WEB_APP else str(request.base_url).rstrip("/")
    # Check headers for reverse proxy proto and host
    proto = request.headers.get("x-forwarded-proto") or request.url.scheme
    host = request.headers.get("x-forwarded-host") or request.headers.get("host") or request.url.netloc
    if host:
        base = f"{proto}://{host}"
    return f"{base}/api/cloud/gdrive/callback"

def _get_user_identifiers(user: User) -> List[str]:
    ids = [user.username]
    if user.telegram_user_id:
        ids.append(str(user.telegram_user_id))
    return ids

@router.get("/accounts")
async def list_cloud_accounts(user: User = Depends(require_auth)):
    """List all connected cloud accounts for the current user."""
    accounts = database.CloudAccounts.get_user_accounts(user_id=_get_user_identifiers(user))
    return {"accounts": accounts}

@router.post("/gdrive/auth-url")
async def generate_gdrive_auth_url(
    request: Request,
    body: AuthUrlRequest,
    user: User = Depends(require_auth)
):
    """Generate the Google OAuth 2.0 authorization consent URL."""
    user_id = str(user.telegram_user_id) if user.telegram_user_id else user.username
    redirect_uri = _get_base_redirect_uri(request, body.redirect_uri)

    # Encode state containing user_id and custom client credentials if any
    state_payload = {
        "user_id": user_id,
        "custom_client_id": body.custom_client_id or "",
        "custom_client_secret": body.custom_client_secret or "",
        "redirect_uri": redirect_uri,
        "timestamp": int(datetime.now(timezone.utc).timestamp())
    }
    state_token = base64.urlsafe_b64encode(json.dumps(state_payload).encode()).decode()

    try:
        auth_url = GoogleDriveManager.generate_auth_url(
            redirect_uri=redirect_uri,
            state=state_token,
            client_id=body.custom_client_id
        )
        return {"auth_url": auth_url, "redirect_uri": redirect_uri}
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        logger.error(f"[GDRIVE_AUTH] Error generating auth URL: {e}")
        raise HTTPException(status_code=500, detail="Failed to generate Google Drive authorization URL.")

@router.get("/gdrive/callback")
async def gdrive_oauth_callback(
    code: Optional[str] = Query(None),
    state: Optional[str] = Query(None),
    error: Optional[str] = Query(None)
):
    """Handle OAuth 2.0 callback redirect from Google."""
    if error:
        logger.warning(f"[GDRIVE_OAUTH] Google returned error: {error}")
        html_error = f"""
        <!DOCTYPE html>
        <html>
        <head><title>Authorization Failed</title></head>
        <body style="font-family:sans-serif; text-align:center; padding:50px;">
          <h2 style="color:#ef4444;">Google Drive Authorization Cancelled</h2>
          <p>Reason: {error}</p>
          <script>
            if (window.opener) {{
              window.opener.postMessage({{ type: 'GDRIVE_AUTH_ERROR', error: '{error}' }}, '*');
              setTimeout(() => window.close(), 2500);
            }} else {{
              setTimeout(() => {{ window.location.href = '/'; }}, 2500);
            }}
          </script>
        </body>
        </html>
        """
        return HTMLResponse(content=html_error, status_code=400)

    if not code or not state:
        raise HTTPException(status_code=400, detail="Missing code or state parameter.")

    try:
        raw_state = base64.urlsafe_b64decode(state.encode()).decode()
        state_data = json.loads(raw_state)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid state parameter: {e}")

    user_id = state_data.get("user_id")
    custom_cid = state_data.get("custom_client_id")
    custom_sec = state_data.get("custom_client_secret")
    redirect_uri = state_data.get("redirect_uri")

    try:
        exchanged = await GoogleDriveManager.exchange_code(
            code=code,
            redirect_uri=redirect_uri,
            client_id=custom_cid,
            client_secret=custom_sec
        )

        tokens = exchanged["tokens"]
        user_info = exchanged["user_info"]
        refresh_token = tokens.get("refresh_token")

        if not refresh_token:
            # If Google didn't return a refresh_token, it means the user was already authorized
            # We log a warning
            logger.warning("[GDRIVE_OAUTH] Google did not return a refresh_token (consent might have been cached).")

        email = user_info.get("email", "unknown@gmail.com")
        name = user_info.get("name") or email.split("@")[0]
        account_name = f"Google Drive ({name})"

        credentials = {
            "refresh_token": refresh_token,
            "client_id": custom_cid or "",
            "client_secret": custom_sec or ""
        }

        # If refresh_token is missing, try to preserve previous one from existing record
        if not refresh_token:
            existing = database.CloudAccounts.find_one({
                "user_id": str(user_id),
                "provider": "google_drive",
                "account_email": email
            })
            if existing and existing.get("credentials", {}).get("refresh_token"):
                credentials["refresh_token"] = existing["credentials"]["refresh_token"]

        account_id = database.CloudAccounts.save_account(
            user_id=user_id,
            provider="google_drive",
            account_name=account_name,
            account_email=email,
            credentials=credentials
        )

        success_html = f"""
        <!DOCTYPE html>
        <html>
        <head>
          <title>Google Drive Connected</title>
          <style>
            body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #f8fafc; display:flex; align-items:center; justify-content:center; height:100vh; margin:0; }}
            .card {{ background: #1e293b; padding: 32px 40px; border-radius: 16px; box-shadow: 0 10px 25px rgba(0,0,0,0.5); text-align: center; border: 1px solid #334155; max-width: 400px; }}
            h2 {{ color: #38bdf8; margin-top: 0; }}
            p {{ color: #94a3b8; font-size: 14px; }}
          </style>
        </head>
        <body>
          <div class="card">
            <h2>Connected Successfully!</h2>
            <p><strong>{email}</strong> has been linked to your Telegram Drive.</p>
            <p>This window will close automatically...</p>
          </div>
          <script>
            if (window.opener) {{
              window.opener.postMessage({{ type: 'GDRIVE_AUTH_SUCCESS', account_id: '{account_id}', email: '{email}' }}, '*');
              setTimeout(() => window.close(), 1200);
            }} else {{
              setTimeout(() => {{ window.location.href = '/?cloud_connected=true'; }}, 1500);
            }}
          </script>
        </body>
        </html>
        """
        return HTMLResponse(content=success_html, status_code=200)

    except Exception as e:
        logger.error(f"[GDRIVE_OAUTH] Callback handling error: {e}", exc_info=True)
        return HTMLResponse(content=f"<h3>Authentication error: {e}</h3>", status_code=500)

@router.delete("/accounts/{account_id}")
async def disconnect_cloud_account(account_id: str, user: User = Depends(require_auth)):
    """Disconnect and unlink a cloud storage account."""
    deleted = database.CloudAccounts.delete_account(account_id=account_id, user_id=_get_user_identifiers(user))
    if not deleted:
        raise HTTPException(status_code=404, detail="Cloud account not found or access denied.")
    return {"success": True, "message": "Cloud account disconnected successfully."}

@router.get("/{account_id}/files")
async def list_cloud_files(
    account_id: str,
    folder_id: Optional[str] = Query(default="root"),
    page_size: Optional[int] = Query(default=50, ge=1, le=200),
    page_token: Optional[str] = Query(default=None),
    query: Optional[str] = Query(default=None),
    sort_by: Optional[str] = Query(default="name"),
    sort_order: Optional[str] = Query(default="asc"),
    user: User = Depends(require_auth)
):
    """List files and folders in a Google Drive directory."""
    account = database.CloudAccounts.get_account_raw(account_id=account_id, user_id=_get_user_identifiers(user))
    if not account:
        raise HTTPException(status_code=404, detail="Cloud account not found.")

    try:
        access_token = await GoogleDriveManager.get_valid_access_token(account)
        res = await GoogleDriveManager.list_folder(
            access_token=access_token,
            folder_id=folder_id if isinstance(folder_id, str) and folder_id.strip() else "root",
            page_size=page_size if isinstance(page_size, int) else 50,
            page_token=page_token if isinstance(page_token, str) else None,
            search_query=query if isinstance(query, str) and query.strip() else None,
            sort_by=sort_by if isinstance(sort_by, str) else "name",
            sort_order=sort_order if isinstance(sort_order, str) else "asc"
        )
        return {
            "account_id": account_id,
            "provider": account.get("provider", "google_drive"),
            "account_name": account.get("account_name"),
            "account_email": account.get("account_email"),
            "folder_id": res.get("folder_id"),
            "items": res.get("items", []),
            "nextPageToken": res.get("nextPageToken")
        }
    except Exception as e:
        logger.error(f"[GDRIVE_LIST] Error listing files for {account_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/{account_id}/files/delete")
async def delete_cloud_file(
    account_id: str,
    body: DeleteFileRequest,
    user: User = Depends(require_auth)
):
    """Trash or delete a file/folder in Google Drive."""
    account = database.CloudAccounts.get_account_raw(account_id=account_id, user_id=_get_user_identifiers(user))
    if not account:
        raise HTTPException(status_code=404, detail="Cloud account not found.")

    try:
        access_token = await GoogleDriveManager.get_valid_access_token(account)
        success = await GoogleDriveManager.delete_file(
            access_token=access_token,
            file_id=body.file_id,
            permanent=bool(body.permanent)
        )
        return {"success": success, "message": "File deleted in Google Drive."}
    except Exception as e:
        logger.error(f"[GDRIVE_DELETE] Error deleting {body.file_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/{account_id}/files/rename")
async def rename_cloud_file(
    account_id: str,
    body: RenameFileRequest,
    user: User = Depends(require_auth)
):
    """Rename a file or folder in Google Drive."""
    account = database.CloudAccounts.get_account_raw(account_id=account_id, user_id=_get_user_identifiers(user))
    if not account:
        raise HTTPException(status_code=404, detail="Cloud account not found.")

    try:
        access_token = await GoogleDriveManager.get_valid_access_token(account)
        updated = await GoogleDriveManager.rename_file(
            access_token=access_token,
            file_id=body.file_id,
            new_name=body.new_name
        )
        return {"success": True, "file": updated}
    except Exception as e:
        logger.error(f"[GDRIVE_RENAME] Error renaming {body.file_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/{account_id}/files/mkdir")
async def create_cloud_folder(
    account_id: str,
    body: CreateFolderRequest,
    user: User = Depends(require_auth)
):
    """Create a new folder in Google Drive."""
    account = database.CloudAccounts.get_account_raw(account_id=account_id, user_id=_get_user_identifiers(user))
    if not account:
        raise HTTPException(status_code=404, detail="Cloud account not found.")

    try:
        access_token = await GoogleDriveManager.get_valid_access_token(account)
        created = await GoogleDriveManager.create_folder(
            access_token=access_token,
            parent_id=body.parent_id or "root",
            folder_name=body.folder_name
        )
        return {"success": True, "folder": created}
    except Exception as e:
        logger.error(f"[GDRIVE_MKDIR] Error creating folder: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/{account_id}/storage")
async def get_cloud_storage(
    account_id: str,
    user: User = Depends(require_auth)
):
    """Fetch real-time quota usage and user details for the connected Google Drive account."""
    account = database.CloudAccounts.get_account_raw(account_id=account_id, user_id=_get_user_identifiers(user))
    if not account:
        raise HTTPException(status_code=404, detail="Cloud account not found.")

    try:
        access_token = await GoogleDriveManager.get_valid_access_token(account)
        quota = await GoogleDriveManager.get_storage_quota(access_token)
        return {
            "account_id": account_id,
            "provider": account.get("provider", "google_drive"),
            "account_email": account.get("account_email"),
            "account_name": account.get("account_name"),
            **quota
        }
    except Exception as e:
        logger.error(f"[GDRIVE_STORAGE] Error fetching quota for {account_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/{account_id}/stream/{file_id}")
async def stream_cloud_file(
    account_id: str,
    file_id: str,
    request: Request,
    user: User = Depends(require_auth)
):
    """
    Stream a video/audio file directly from Google Drive to the browser player
    supporting HTTP Range requests (206 Partial Content) with zero disk storage on VM.
    """
    account = database.CloudAccounts.get_account_raw(account_id=account_id, user_id=_get_user_identifiers(user))
    if not account:
        raise HTTPException(status_code=404, detail="Cloud account not found.")

    try:
        access_token = await GoogleDriveManager.get_valid_access_token(account)
        meta = await GoogleDriveManager.get_file_info(access_token, file_id)
        file_name = meta.get("name", "video.mp4")
        mime_type = meta.get("mimeType", "video/mp4")

        # Forward Range header if present
        range_header = request.headers.get("Range")
        drive_headers = {"Authorization": f"Bearer {access_token}"}
        if range_header:
            drive_headers["Range"] = range_header

        url = GoogleDriveManager.get_download_url(file_id)

        session = aiohttp.ClientSession()
        resp = await session.get(url, headers=drive_headers, timeout=aiohttp.ClientTimeout(total=None, sock_read=60))

        if resp.status not in (200, 206):
            err_text = await resp.text()
            resp.close()
            await session.close()
            logger.error(f"[GDRIVE_STREAM] Failed to fetch stream: status={resp.status}, err={err_text}")
            raise HTTPException(status_code=resp.status, detail=f"Google Drive stream error: {err_text}")

        async def body_stream():
            try:
                async for chunk in resp.content.iter_chunked(256 * 1024):
                    yield chunk
            finally:
                resp.close()
                await session.close()

        out_headers = {
            "Accept-Ranges": "bytes",
            "Content-Type": resp.headers.get("Content-Type") or mime_type,
            "Cache-Control": "no-cache",
        }
        if "Content-Range" in resp.headers:
            out_headers["Content-Range"] = resp.headers["Content-Range"]
        if "Content-Length" in resp.headers:
            out_headers["Content-Length"] = resp.headers["Content-Length"]

        safe_name = urllib.parse.quote(file_name)
        out_headers["Content-Disposition"] = f'inline; filename="{safe_name}"; filename*=UTF-8\'\'{safe_name}'

        return StreamingResponse(
            body_stream(),
            status_code=resp.status,
            headers=out_headers
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[GDRIVE_STREAM] Error streaming file {file_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/{account_id}/download/{file_id}")
async def download_cloud_file(
    account_id: str,
    file_id: str,
    request: Request,
    user: User = Depends(require_auth)
):
    """
    Directly stream a file from Google Drive to the client as an attachment download
    without opening Google Drive's web viewer.
    """
    account = database.CloudAccounts.get_account_raw(account_id=account_id, user_id=_get_user_identifiers(user))
    if not account:
        raise HTTPException(status_code=404, detail="Cloud account not found.")

    try:
        access_token = await GoogleDriveManager.get_valid_access_token(account)
        meta = await GoogleDriveManager.get_file_info(access_token, file_id)
        file_name = meta.get("name", "download")
        mime_type = meta.get("mimeType", "application/octet-stream")

        url = GoogleDriveManager.get_download_url(file_id)
        drive_headers = {"Authorization": f"Bearer {access_token}"}

        range_header = request.headers.get("Range")
        if range_header:
            drive_headers["Range"] = range_header

        session = aiohttp.ClientSession()
        resp = await session.get(url, headers=drive_headers, timeout=aiohttp.ClientTimeout(total=None, sock_read=60))

        if resp.status not in (200, 206):
            err_text = await resp.text()
            resp.close()
            await session.close()
            logger.error(f"[GDRIVE_DOWNLOAD] Failed to download: status={resp.status}, err={err_text}")
            raise HTTPException(status_code=resp.status, detail=f"Google Drive download error: {err_text}")

        async def body_stream():
            try:
                async for chunk in resp.content.iter_chunked(512 * 1024):
                    yield chunk
            finally:
                resp.close()
                await session.close()

        safe_name = urllib.parse.quote(file_name)
        out_headers = {
            "Accept-Ranges": "bytes",
            "Content-Type": resp.headers.get("Content-Type") or mime_type,
            "Content-Disposition": f'attachment; filename="{safe_name}"; filename*=UTF-8\'\'{safe_name}',
        }
        if "Content-Range" in resp.headers:
            out_headers["Content-Range"] = resp.headers["Content-Range"]
        if "Content-Length" in resp.headers:
            out_headers["Content-Length"] = resp.headers["Content-Length"]

        return StreamingResponse(
            body_stream(),
            status_code=resp.status,
            headers=out_headers
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[GDRIVE_DOWNLOAD] Error downloading file {file_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/{account_id}/files/star")
async def star_cloud_file(
    account_id: str,
    body: StarFileRequest,
    user: User = Depends(require_auth)
):
    """Star or unstar a file/folder in Google Drive."""
    account = database.CloudAccounts.get_account_raw(account_id=account_id, user_id=_get_user_identifiers(user))
    if not account:
        raise HTTPException(status_code=404, detail="Cloud account not found.")

    try:
        access_token = await GoogleDriveManager.get_valid_access_token(account)
        success = await GoogleDriveManager.toggle_star(
            access_token=access_token,
            file_id=body.file_id,
            starred=body.starred
        )
        return {"success": success, "starred": body.starred}
    except Exception as e:
        logger.error(f"[GDRIVE_STAR] Error starring {body.file_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/{account_id}/files/restore")
async def restore_cloud_file(
    account_id: str,
    body: RestoreFileRequest,
    user: User = Depends(require_auth)
):
    """Restore a trashed file or folder in Google Drive."""
    account = database.CloudAccounts.get_account_raw(account_id=account_id, user_id=_get_user_identifiers(user))
    if not account:
        raise HTTPException(status_code=404, detail="Cloud account not found.")

    try:
        access_token = await GoogleDriveManager.get_valid_access_token(account)
        success = await GoogleDriveManager.restore_file(
            access_token=access_token,
            file_id=body.file_id
        )
        return {"success": success, "message": "File restored in Google Drive."}
    except Exception as e:
        logger.error(f"[GDRIVE_RESTORE] Error restoring {body.file_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/{account_id}/trash/empty")
async def empty_cloud_trash(
    account_id: str,
    user: User = Depends(require_auth)
):
    """Permanently empty Google Drive trash."""
    account = database.CloudAccounts.get_account_raw(account_id=account_id, user_id=_get_user_identifiers(user))
    if not account:
        raise HTTPException(status_code=404, detail="Cloud account not found.")

    try:
        access_token = await GoogleDriveManager.get_valid_access_token(account)
        success = await GoogleDriveManager.empty_trash(access_token)
        return {"success": success, "message": "Google Drive trash emptied."}
    except Exception as e:
        logger.error(f"[GDRIVE_EMPTY_TRASH] Error emptying trash: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/{account_id}/transfer-to-telegram")
async def transfer_to_telegram(
    account_id: str,
    body: TransferToTelegramRequest,
    request: Request,
    user: User = Depends(require_auth)
):
    """
    Stream and copy/cut a file or full recursive folder directly from Google Drive into Telegram storage.
    Enqueues the transfer into RemoteTransferManager with Zero-Disk footprint.
    """
    if not user.telegram_user_id:
        raise HTTPException(
            status_code=400,
            detail="TELEGRAM_NOT_VERIFIED: Please connect your Telegram account before initiating cloud transfers."
        )

    user_data = database.Users.find_one({"telegram_user_id": user.telegram_user_id})
    if not user_data or "index_chat_id" not in user_data:
        raise HTTPException(status_code=400, detail="User index chat not configured.")

    chat_id = user_data["index_chat_id"]
    user_id = str(user.telegram_user_id)

    account = database.CloudAccounts.get_account_raw(account_id=account_id, user_id=_get_user_identifiers(user))
    if not account:
        raise HTTPException(status_code=404, detail="Cloud account not found.")

    try:
        access_token = await GoogleDriveManager.get_valid_access_token(account)
        file_info = await GoogleDriveManager.get_file_info(access_token, body.source_file_id)
        
        file_name = file_info.get("name", "Google_Drive_Item")
        is_folder = file_info.get("mimeType") == "application/vnd.google-apps.folder"
        clean_dest = (body.destination_path or "/Home").rstrip("/")

        # Make sure background worker is alive
        remote_transfer_manager.start_worker(request.app)

        if is_folder:
            crawl_data = await GoogleDriveManager.crawl_folder_recursive(access_token, body.source_file_id, root_folder_name=file_name)
            files = crawl_data.get("files", [])
            
            if not files:
                database.Files.create_folder_path(f"{clean_dest}/{file_name}", owner_id=user_id)
                if body.operation == "cut":
                    await GoogleDriveManager.delete_file(access_token, body.source_file_id)
                return {
                    "success": True,
                    "message": f"Created empty folder '{file_name}' in Telegram.",
                    "tasks": []
                }

            group_id = f"grp_{secrets.token_hex(6)}"
            all_tasks = []
            for f in files:
                rel_dir = os.path.dirname(f["rel_path"]).replace("\\", "/").strip("/")
                item_dest = f"{clean_dest}/{rel_dir}" if rel_dir else f"{clean_dest}/{file_name}"
                media_url = GoogleDriveManager.get_download_url(f["id"])

                queued = await remote_transfer_manager.enqueue_transfer(
                    user_id=user_id,
                    url=media_url,
                    destination_path=item_dest,
                    chat_id=chat_id,
                    custom_headers={"Authorization": f"Bearer {access_token}"},
                    custom_filename=f["name"],
                    custom_filesize=f["size"],
                    post_action_delete=(body.operation == "cut"),
                    cloud_account_id=account_id,
                    cloud_file_id=f["id"],
                    group_id=group_id,
                    group_name=file_name,
                    group_total_items=len(files)
                )
                all_tasks.extend(queued)

            return {
                "success": True,
                "message": f"Queued {len(files)} file(s) from folder '{file_name}' to {clean_dest}.",
                "tasks": all_tasks,
                "group_id": group_id
            }
        else:
            file_size = int(file_info.get("size", 0))
            media_url = GoogleDriveManager.get_download_url(body.source_file_id)

            tasks = await remote_transfer_manager.enqueue_transfer(
                user_id=user_id,
                url=media_url,
                destination_path=clean_dest,
                chat_id=chat_id,
                custom_headers={"Authorization": f"Bearer {access_token}"},
                custom_filename=file_name,
                custom_filesize=file_size,
                post_action_delete=(body.operation == "cut"),
                cloud_account_id=account_id,
                cloud_file_id=body.source_file_id
            )

            return {
                "success": True,
                "message": f"Transfer queued for '{file_name}' to {clean_dest}.",
                "tasks": tasks
            }
    except Exception as e:
        logger.error(f"[GDRIVE_TRANSFER] Error enqueueing transfer: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/{account_id}/transfer-from-telegram")
async def transfer_from_telegram(
    account_id: str,
    body: TransferFromTelegramRequest,
    request: Request,
    user: User = Depends(require_auth)
):
    """
    Stream and copy/cut Telegram files/folders directly into Google Drive.
    Uses Zero VM Disk Footprint: Streams bytes from Telegram MTProto to GDrive Resumable Upload.
    """
    user_identifiers = _get_user_identifiers(user)
    user_id = str(user.telegram_user_id) if user.telegram_user_id else user.username

    account = database.CloudAccounts.get_account_raw(account_id=account_id, user_id=user_identifiers)
    if not account:
        raise HTTPException(status_code=404, detail="Cloud account not found.")

    target_fid = body.target_folder_id or "root"
    if target_fid in ("root", "my_drive", "google_drive"):
        target_fid = "root"

    # Make sure background worker is alive
    remote_transfer_manager.start_worker(request.app)

    from bson import ObjectId
    files_to_transfer: List[Dict[str, Any]] = []

    # 1. Resolve source file IDs
    if body.source_file_ids:
        for fid in body.source_file_ids:
            query = {}
            if ObjectId.is_valid(fid):
                query = {"_id": ObjectId(fid), "owner_id": {"$in": user_identifiers}}
            else:
                query = {"file_unique_id": fid, "owner_id": {"$in": user_identifiers}}
            doc = database.Files.find_one(query)
            if doc:
                files_to_transfer.append({"doc": doc, "rel_subpath": ""})

    # 2. Resolve source folder paths
    if body.source_folder_paths:
        for fpath in body.source_folder_paths:
            clean_fpath = fpath.strip().rstrip("/")
            folder_base_name = clean_fpath.split("/")[-1]
            nested_files = list(database.Files.find({
                "file_path": {"$regex": f"^{re.escape(clean_fpath)}"},
                "owner_id": {"$in": user_identifiers},
                "file_type": {"$ne": "folder"}
            }))
            for nfile in nested_files:
                sub = nfile.get("file_path", "")[len(clean_fpath):].strip("/")
                rel_dir = f"{folder_base_name}/{sub}".strip("/") if sub else folder_base_name
                files_to_transfer.append({"doc": nfile, "rel_subpath": rel_dir})

    if not files_to_transfer:
        raise HTTPException(status_code=400, detail="No valid Telegram files found to transfer.")

    # Deduplicate files by _id
    seen_ids = set()
    unique_files = []
    for item in files_to_transfer:
        oid = str(item["doc"]["_id"])
        if oid not in seen_ids:
            seen_ids.add(oid)
            unique_files.append(item)

    group_id = f"grp_{secrets.token_hex(6)}" if len(unique_files) > 1 else None
    group_name = (
        body.source_folder_paths[0].split("/")[-1]
        if body.source_folder_paths
        else f"{len(unique_files)} items to Google Drive"
    ) if group_id else None

    queued_tasks = []
    for item in unique_files:
        fdoc = item["doc"]
        rel_sub = item["rel_subpath"]
        t_id = str(fdoc["_id"])
        fname = fdoc.get("file_name", "Telegram_File")
        fsize = int(fdoc.get("file_size", 0))

        q_task = await remote_transfer_manager.enqueue_telegram_to_gdrive(
            user_id=user_id,
            telegram_file_id=t_id,
            cloud_account_id=account_id,
            target_gdrive_folder_id=target_fid,
            filename=fname,
            filesize=fsize,
            post_action_delete=(body.operation == "cut"),
            group_id=group_id,
            group_name=group_name,
            group_total_items=len(unique_files) if group_id else None,
            target_rel_subpath=rel_sub
        )
        queued_tasks.append(q_task)

    return {
        "success": True,
        "message": f"Queued {len(queued_tasks)} file(s) for transfer to Google Drive.",
        "tasks": queued_tasks,
        "group_id": group_id
    }

@router.post("/{account_id}/upload")
async def upload_to_google_drive(
    account_id: str,
    file: UploadFile = File(...),
    folder_id: Optional[str] = Query("root"),
    user: User = Depends(require_auth)
):
    """
    Directly upload a file from the user's browser into Google Drive.
    Pipes the upload directly into Google Drive's resumable upload session with zero disk usage.
    """
    user_identifiers = _get_user_identifiers(user)
    account = database.CloudAccounts.get_account_raw(account_id=account_id, user_id=user_identifiers)
    if not account:
        raise HTTPException(status_code=404, detail="Cloud account not found.")

    target_fid = folder_id or "root"
    if target_fid in ("root", "my_drive", "google_drive"):
        target_fid = "root"

    try:
        access_token = await GoogleDriveManager.get_valid_access_token(account)
        file_name = file.filename or "upload.bin"
        file_size = file.size
        mime_type = file.content_type or "application/octet-stream"

        # 1. Initiate Resumable Upload
        upload_session_url = await GoogleDriveManager.initiate_resumable_upload(
            access_token=access_token,
            file_name=file_name,
            file_size=file_size,
            mime_type=mime_type,
            parent_id=target_fid
        )

        # 2. Async stream chunks from file
        async def file_stream_gen():
            while True:
                chunk = await file.read(512 * 1024)
                if not chunk:
                    break
                yield chunk

        upload_result = await GoogleDriveManager.upload_resumable_stream(
            upload_session_url=upload_session_url,
            async_stream_gen=file_stream_gen(),
            total_size=file_size
        )

        return {
            "success": True,
            "message": f"File '{file_name}' uploaded successfully to Google Drive.",
            "file": upload_result
        }
    except Exception as e:
        logger.error(f"[GDRIVE_UPLOAD] Error uploading file to Google Drive: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))
