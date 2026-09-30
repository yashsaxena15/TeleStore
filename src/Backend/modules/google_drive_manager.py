# src/Backend/modules/google_drive_manager.py

import time
import logging
import urllib.parse
import mimetypes
from typing import Dict, Any, Optional, List, Tuple
import aiohttp
from datetime import datetime, timezone

from src.Config import GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
from src.Database import database

logger = logging.getLogger("google_drive_manager")

OAUTH_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token"
USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo"
DRIVE_API_BASE = "https://www.googleapis.com/drive/v3"

SCOPES = [
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",
]

# In-memory access token cache: { account_id: { "token": str, "expires_at": float } }
_ACCESS_TOKEN_CACHE: Dict[str, Dict[str, Any]] = {}

def get_effective_client_credentials(custom_client_id: Optional[str] = None, custom_client_secret: Optional[str] = None) -> Tuple[str, str]:
    """Return custom client credentials if provided, otherwise fallback to system .env config."""
    cid = (custom_client_id or "").strip('"\' \t\r\n') or (GOOGLE_CLIENT_ID or "").strip('"\' \t\r\n')
    secret = (custom_client_secret or "").strip('"\' \t\r\n') or (GOOGLE_CLIENT_SECRET or "").strip('"\' \t\r\n')
    return cid, secret

class GoogleDriveManager:
    @staticmethod
    def generate_auth_url(redirect_uri: str, state: str, client_id: Optional[str] = None) -> str:
        """Generate Google OAuth 2.0 authorization URL with offline access to get refresh_token."""
        cid, _ = get_effective_client_credentials(client_id)
        if not cid:
            raise ValueError("Google Client ID is not configured in .env or passed as custom credential.")

        params = {
            "client_id": cid,
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "scope": " ".join(SCOPES),
            "access_type": "offline",
            "prompt": "consent",  # Ensures refresh_token is always returned
            "include_granted_scopes": "true",
            "state": state
        }
        return f"{OAUTH_AUTH_URL}?{urllib.parse.urlencode(params)}"

    @staticmethod
    async def exchange_code(
        code: str,
        redirect_uri: str,
        client_id: Optional[str] = None,
        client_secret: Optional[str] = None
    ) -> Dict[str, Any]:
        """Exchange authorization code for access_token and refresh_token, and fetch user profile."""
        cid, secret = get_effective_client_credentials(client_id, client_secret)
        if not cid or not secret:
            raise ValueError("Google Client ID or Client Secret is missing.")

        payload = {
            "code": code,
            "client_id": cid,
            "client_secret": secret,
            "redirect_uri": redirect_uri,
            "grant_type": "authorization_code"
        }

        async with aiohttp.ClientSession() as session:
            async with session.post(OAUTH_TOKEN_URL, data=payload, timeout=15) as resp:
                if resp.status != 200:
                    err_body = await resp.text()
                    logger.error(f"[GDRIVE] Token exchange failed ({resp.status}): {err_body}")
                    raise RuntimeError(f"Failed to exchange Google OAuth code: {err_body}")
                token_data = await resp.json()

            access_token = token_data.get("access_token")
            # Fetch user email and display name
            headers = {"Authorization": f"Bearer {access_token}"}
            async with session.get(USERINFO_URL, headers=headers, timeout=10) as u_resp:
                user_info = await u_resp.json() if u_resp.status == 200 else {}

        return {
            "tokens": token_data,
            "user_info": user_info,
            "client_id": cid,
            "client_secret": secret
        }

    @staticmethod
    async def get_valid_access_token(account_doc: Dict[str, Any]) -> str:
        """Return a cached or newly refreshed access token for the given account document."""
        account_id = str(account_doc.get("_id") or account_doc.get("id"))
        now = time.time()

        # Check in-memory cache
        if account_id in _ACCESS_TOKEN_CACHE:
            cached = _ACCESS_TOKEN_CACHE[account_id]
            if cached.get("expires_at", 0) > now + 60:
                return cached["token"]

        creds = account_doc.get("credentials", {})
        refresh_token = creds.get("refresh_token")
        if not refresh_token:
            raise ValueError(f"No refresh_token found for Google Drive account {account_id}")

        cid, secret = get_effective_client_credentials(creds.get("client_id"), creds.get("client_secret"))
        if not cid or not secret:
            raise ValueError("Missing Client ID or Secret to refresh Google Drive token.")

        payload = {
            "client_id": cid,
            "client_secret": secret,
            "refresh_token": refresh_token,
            "grant_type": "refresh_token"
        }

        async with aiohttp.ClientSession() as session:
            async with session.post(OAUTH_TOKEN_URL, data=payload, timeout=15) as resp:
                if resp.status != 200:
                    err_text = await resp.text()
                    logger.error(f"[GDRIVE] Token refresh failed for account {account_id}: {err_text}")
                    raise RuntimeError(f"Google Drive token refresh failed: {err_text}")
                data = await resp.json()

        new_access_token = data.get("access_token")
        expires_in = int(data.get("expires_in", 3600))
        _ACCESS_TOKEN_CACHE[account_id] = {
            "token": new_access_token,
            "expires_at": now + expires_in
        }

        return new_access_token

    @staticmethod
    async def list_folder(
        access_token: str,
        folder_id: str = "root",
        page_size: int = 50,
        page_token: Optional[str] = None,
        search_query: Optional[str] = None,
        sort_by: Optional[str] = "folder,name",
        sort_order: Optional[str] = "asc"
    ) -> Dict[str, Any]:
        """List files and folders in a Google Drive directory with virtual folder support."""
        clean_folder = folder_id.strip() if isinstance(folder_id, str) and folder_id.strip() else "root"
        clean_search = search_query.strip() if isinstance(search_query, str) and search_query.strip() else ""

        # Virtual root level: if user is at root with no search, show 4 virtual folders
        if clean_folder in ("root", "google_drive") and not clean_search:
            virtual_items = [
                {
                    "id": "my_drive",
                    "name": "My Drive",
                    "type": "folder",
                    "is_folder": True,
                    "mimeType": "application/vnd.google-apps.folder",
                    "size": 0,
                    "modified": None,
                    "is_virtual": True
                },
                {
                    "id": "shared_with_me",
                    "name": "Shared with me",
                    "type": "folder",
                    "is_folder": True,
                    "mimeType": "application/vnd.google-apps.folder",
                    "size": 0,
                    "modified": None,
                    "is_virtual": True
                },
                {
                    "id": "starred",
                    "name": "Starred",
                    "type": "folder",
                    "is_folder": True,
                    "mimeType": "application/vnd.google-apps.folder",
                    "size": 0,
                    "modified": None,
                    "is_virtual": True
                },
                {
                    "id": "trash",
                    "name": "Trash",
                    "type": "folder",
                    "is_folder": True,
                    "mimeType": "application/vnd.google-apps.folder",
                    "size": 0,
                    "modified": None,
                    "is_virtual": True
                }
            ]
            return {
                "items": virtual_items,
                "nextPageToken": None,
                "folder_id": "root"
            }

        # Build Google Drive API query based on section or parent
        query_parts = []
        if clean_folder in ("root", "google_drive"):
            # Global search at root
            query_parts.append("trashed = false")
        elif clean_folder == "my_drive":
            query_parts.append("'root' in parents")
            query_parts.append("trashed = false")
        elif clean_folder == "shared_with_me":
            query_parts.append("sharedWithMe = true")
            query_parts.append("trashed = false")
        elif clean_folder == "starred":
            query_parts.append("starred = true")
            query_parts.append("trashed = false")
        elif clean_folder == "trash":
            query_parts.append("trashed = true")
        else:
            # Normal folder id
            query_parts.append(f"'{clean_folder}' in parents")
            query_parts.append("trashed = false")

        if clean_search:
            escaped_q = clean_search.replace("'", "\\'")
            query_parts.append(f"name contains '{escaped_q}'")

        q_str = " and ".join(query_parts)

        # Order by: folders first is customary
        order_by = "folder,name"
        if sort_by == "name":
            order_by = f"folder,name {sort_order or 'asc'}"
        elif sort_by in ("date", "modified", "modifiedTime"):
            order_by = f"folder,modifiedTime {sort_order or 'desc'}"
        elif sort_by in ("size", "quotaBytesUsed"):
            order_by = f"folder,quotaBytesUsed {sort_order or 'desc'}"

        params: Dict[str, Any] = {
            "q": q_str,
            "pageSize": min(200, max(1, page_size)),
            "fields": "nextPageToken, files(id, name, mimeType, size, modifiedTime, iconLink, thumbnailLink, webViewLink, webContentLink, parents, starred, trashed)",
            "orderBy": order_by,
            "supportsAllDrives": "true",
            "includeItemsFromAllDrives": "true"
        }
        if page_token:
            params["pageToken"] = page_token

        headers = {"Authorization": f"Bearer {access_token}"}
        url = f"{DRIVE_API_BASE}/files"

        async with aiohttp.ClientSession() as session:
            async with session.get(url, headers=headers, params=params, timeout=20) as resp:
                if resp.status != 200:
                    err_txt = await resp.text()
                    logger.error(f"[GDRIVE] list_folder failed: {err_txt}")
                    raise RuntimeError(f"Google Drive API error: {err_txt}")
                data = await resp.json()

        # Format items to standard FileItem schema
        raw_files = data.get("files", [])
        formatted_items = []
        for f in raw_files:
            mime = f.get("mimeType", "")
            is_folder = mime == "application/vnd.google-apps.folder"
            size = int(f.get("size", 0)) if not is_folder else 0

            # Infer type from mime / extension
            name = f.get("name", "Untitled")
            f_type = "folder" if is_folder else GoogleDriveManager._infer_file_type(name, mime)

            formatted_items.append({
                "id": f.get("id"),
                "name": name,
                "type": f_type,
                "mimeType": mime,
                "size": size,
                "modified": f.get("modifiedTime"),
                "thumbnailLink": f.get("thumbnailLink"),
                "webViewLink": f.get("webViewLink"),
                "webContentLink": f.get("webContentLink"),
                "is_folder": is_folder,
                "starred": bool(f.get("starred", False)),
                "trashed": bool(f.get("trashed", False)),
                "parents": f.get("parents", [])
            })

        return {
            "items": formatted_items,
            "nextPageToken": data.get("nextPageToken"),
            "folder_id": clean_folder
        }

    @staticmethod
    def _infer_file_type(name: str, mime: str) -> str:
        ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
        if mime.startswith("video/") or ext in ("mp4", "mkv", "avi", "mov", "webm", "flv", "wmv", "m4v"):
            return "video"
        if mime.startswith("image/") or ext in ("jpg", "jpeg", "png", "gif", "webp", "svg", "bmp"):
            return "photo"
        if mime.startswith("audio/") or ext in ("mp3", "m4a", "wav", "flac", "ogg", "aac", "opus"):
            return "audio"
        if ext in ("zip", "rar", "7z", "tar", "gz", "bz2", "xz"):
            return "archive"
        if ext in ("pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "csv", "epub"):
            return "document"
        return "file"

    @staticmethod
    async def get_file_info(access_token: str, file_id: str) -> Dict[str, Any]:
        """Fetch detailed metadata for a file or folder."""
        headers = {"Authorization": f"Bearer {access_token}"}
        url = f"{DRIVE_API_BASE}/files/{file_id}"
        params = {
            "fields": "id, name, mimeType, size, modifiedTime, parents, md5Checksum, webViewLink, thumbnailLink",
            "supportsAllDrives": "true"
        }
        async with aiohttp.ClientSession() as session:
            async with session.get(url, headers=headers, params=params, timeout=15) as resp:
                if resp.status != 200:
                    err_txt = await resp.text()
                    raise RuntimeError(f"Failed to fetch file info: {err_txt}")
                return await resp.json()

    @staticmethod
    async def rename_file(access_token: str, file_id: str, new_name: str) -> Dict[str, Any]:
        """Rename a file or folder in Google Drive."""
        headers = {"Authorization": f"Bearer {access_token}", "Content-Type": "application/json"}
        url = f"{DRIVE_API_BASE}/files/{file_id}?supportsAllDrives=true"
        payload = {"name": new_name}
        async with aiohttp.ClientSession() as session:
            async with session.patch(url, headers=headers, json=payload, timeout=15) as resp:
                if resp.status != 200:
                    err_txt = await resp.text()
                    raise RuntimeError(f"Failed to rename in Google Drive: {err_txt}")
                return await resp.json()

    @staticmethod
    async def delete_file(access_token: str, file_id: str, permanent: bool = False) -> bool:
        """Trash or permanently delete a file or folder in Google Drive."""
        headers = {"Authorization": f"Bearer {access_token}"}
        if permanent:
            url = f"{DRIVE_API_BASE}/files/{file_id}?supportsAllDrives=true"
            async with aiohttp.ClientSession() as session:
                async with session.delete(url, headers=headers, timeout=15) as resp:
                    return resp.status in (200, 204)
        else:
            url = f"{DRIVE_API_BASE}/files/{file_id}?supportsAllDrives=true"
            async with aiohttp.ClientSession() as session:
                async with session.patch(url, headers=headers, json={"trashed": True}, timeout=15) as resp:
                    return resp.status == 200

    @staticmethod
    async def create_folder(access_token: str, parent_id: str, folder_name: str) -> Dict[str, Any]:
        """Create a new folder in Google Drive."""
        headers = {"Authorization": f"Bearer {access_token}", "Content-Type": "application/json"}
        url = f"{DRIVE_API_BASE}/files?supportsAllDrives=true"
        payload = {
            "name": folder_name,
            "mimeType": "application/vnd.google-apps.folder",
            "parents": [parent_id or "root"]
        }
        async with aiohttp.ClientSession() as session:
            async with session.post(url, headers=headers, json=payload, timeout=15) as resp:
                if resp.status != 200:
                    err_txt = await resp.text()
                    raise RuntimeError(f"Failed to create folder in Google Drive: {err_txt}")
                return await resp.json()

    @staticmethod
    async def copy_file(
        access_token: str,
        file_id: str,
        target_parent_id: str = "root",
        new_name: Optional[str] = None
    ) -> Dict[str, Any]:
        """Copy a file within Google Drive using Google Drive API v3."""
        clean_target = target_parent_id.strip() if target_parent_id else "root"
        if clean_target in ("root", "my_drive", "google_drive"):
            clean_target = "root"

        url = f"{DRIVE_API_BASE}/files/{file_id}/copy?supportsAllDrives=true"
        headers = {"Authorization": f"Bearer {access_token}", "Content-Type": "application/json"}
        payload: Dict[str, Any] = {"parents": [clean_target]}
        if new_name:
            payload["name"] = new_name

        async with aiohttp.ClientSession() as session:
            async with session.post(url, headers=headers, json=payload, timeout=20) as resp:
                if resp.status not in (200, 201):
                    err_txt = await resp.text()
                    raise RuntimeError(f"Google Drive copy_file failed: {err_txt}")
                return await resp.json()

    @staticmethod
    async def move_file(
        access_token: str,
        file_id: str,
        target_parent_id: str = "root"
    ) -> Dict[str, Any]:
        """Move a file or folder within Google Drive by updating its parents."""
        clean_target = target_parent_id.strip() if target_parent_id else "root"
        if clean_target in ("root", "my_drive", "google_drive"):
            clean_target = "root"

        # 1. Fetch current parents
        file_info = await GoogleDriveManager.get_file_info(access_token, file_id)
        current_parents = file_info.get("parents", [])

        if clean_target in current_parents:
            # Already in target folder
            return file_info

        remove_parents = ",".join(current_parents)
        url = f"{DRIVE_API_BASE}/files/{file_id}"
        params = {
            "addParents": clean_target,
            "supportsAllDrives": "true"
        }
        if remove_parents:
            params["removeParents"] = remove_parents

        headers = {"Authorization": f"Bearer {access_token}", "Content-Type": "application/json"}
        async with aiohttp.ClientSession() as session:
            async with session.patch(url, headers=headers, params=params, json={}, timeout=20) as resp:
                if resp.status not in (200, 204):
                    err_txt = await resp.text()
                    raise RuntimeError(f"Google Drive move_file failed: {err_txt}")
                return await resp.json()

    @staticmethod
    async def copy_folder_recursive(
        access_token: str,
        folder_id: str,
        target_parent_id: str = "root"
    ) -> Dict[str, Any]:
        """Recursively copy a folder and all its contents inside Google Drive."""
        clean_target = target_parent_id.strip() if target_parent_id else "root"
        if clean_target in ("root", "my_drive", "google_drive"):
            clean_target = "root"

        # 1. Get info on source folder
        source_info = await GoogleDriveManager.get_file_info(access_token, folder_id)
        folder_name = source_info.get("name", "Copied Folder")

        # If copying inside the same parent, prepend "Copy of "
        if clean_target in source_info.get("parents", []):
            folder_name = f"Copy of {folder_name}"

        # 2. Create the destination folder
        new_folder = await GoogleDriveManager.create_folder(access_token, clean_target, folder_name)
        new_folder_id = new_folder["id"]

        # 3. List all immediate children of source folder
        headers = {"Authorization": f"Bearer {access_token}"}
        page_token = None
        while True:
            params = {
                "q": f"'{folder_id}' in parents and trashed = false",
                "fields": "nextPageToken, files(id, name, mimeType)",
                "pageSize": 100,
                "supportsAllDrives": "true",
                "includeItemsFromAllDrives": "true"
            }
            if page_token:
                params["pageToken"] = page_token

            async with aiohttp.ClientSession() as session:
                async with session.get(f"{DRIVE_API_BASE}/files", headers=headers, params=params, timeout=20) as resp:
                    if resp.status != 200:
                        err = await resp.text()
                        raise RuntimeError(f"Failed listing folder items to copy: {err}")
                    data = await resp.json()

            for child in data.get("files", []):
                cid = child["id"]
                cmime = child.get("mimeType", "")
                if cmime == "application/vnd.google-apps.folder":
                    await GoogleDriveManager.copy_folder_recursive(access_token, cid, new_folder_id)
                else:
                    await GoogleDriveManager.copy_file(access_token, cid, new_folder_id, child.get("name"))

            page_token = data.get("nextPageToken")
            if not page_token:
                break

        return new_folder

    @staticmethod
    def get_download_url(file_id: str) -> str:
        """Return the REST download URL for streaming."""
        return f"{DRIVE_API_BASE}/files/{file_id}?alt=media&supportsAllDrives=true"

    @staticmethod
    async def get_storage_quota(access_token: str) -> Dict[str, Any]:
        """Fetch real-time storage quota and user details from Google Drive."""
        headers = {"Authorization": f"Bearer {access_token}"}
        url = f"{DRIVE_API_BASE}/about?fields=storageQuota,user"
        async with aiohttp.ClientSession() as session:
            async with session.get(url, headers=headers, timeout=15) as resp:
                if resp.status != 200:
                    err_txt = await resp.text()
                    raise RuntimeError(f"Failed to fetch Google Drive storage quota: {err_txt}")
                data = await resp.json()
        
        quota = data.get("storageQuota", {})
        user_info = data.get("user", {})
        
        limit_val = quota.get("limit")
        limit_int = int(limit_val) if limit_val is not None else -1
        usage_int = int(quota.get("usage", 0))
        usage_drive = int(quota.get("usageInDrive", 0))
        usage_trash = int(quota.get("usageInDriveTrash", 0))

        return {
            "limit": limit_int,
            "usage": usage_int,
            "usageInDrive": usage_drive,
            "usageInDriveTrash": usage_trash,
            "user": {
                "displayName": user_info.get("displayName", ""),
                "emailAddress": user_info.get("emailAddress", ""),
                "photoLink": user_info.get("photoLink", "")
            }
        }

    @staticmethod
    async def toggle_star(access_token: str, file_id: str, starred: bool) -> bool:
        """Add or remove star from a file or folder in Google Drive."""
        headers = {"Authorization": f"Bearer {access_token}", "Content-Type": "application/json"}
        url = f"{DRIVE_API_BASE}/files/{file_id}?supportsAllDrives=true"
        payload = {"starred": starred}
        async with aiohttp.ClientSession() as session:
            async with session.patch(url, headers=headers, json=payload, timeout=15) as resp:
                return resp.status == 200

    @staticmethod
    async def restore_file(access_token: str, file_id: str) -> bool:
        """Restore a trashed file or folder in Google Drive back to its original location."""
        headers = {"Authorization": f"Bearer {access_token}", "Content-Type": "application/json"}
        url = f"{DRIVE_API_BASE}/files/{file_id}?supportsAllDrives=true"
        payload = {"trashed": False}
        async with aiohttp.ClientSession() as session:
            async with session.patch(url, headers=headers, json=payload, timeout=15) as resp:
                return resp.status == 200

    @staticmethod
    async def empty_trash(access_token: str) -> bool:
        """Permanently empty the entire trash in Google Drive."""
        headers = {"Authorization": f"Bearer {access_token}"}
        url = f"{DRIVE_API_BASE}/files/trash"
        async with aiohttp.ClientSession() as session:
            async with session.delete(url, headers=headers, timeout=30) as resp:
                return resp.status in (200, 204)

    @staticmethod
    async def initiate_resumable_upload(
        access_token: str,
        file_name: str,
        file_size: Optional[int] = None,
        mime_type: Optional[str] = None,
        parent_id: Optional[str] = None
    ) -> str:
        """
        Initiate a resumable upload session with Google Drive.
        Returns the upload session URL to stream chunked PUT requests to.
        """
        url = "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true"
        effective_mime = mime_type or mimetypes.guess_type(file_name)[0] or "application/octet-stream"
        headers = {
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json; charset=UTF-8",
            "X-Upload-Content-Type": effective_mime
        }
        if file_size is not None and file_size >= 0:
            headers["X-Upload-Content-Length"] = str(file_size)

        payload: Dict[str, Any] = {"name": file_name}
        if parent_id and parent_id not in ("root", "my_drive", "google_drive"):
            payload["parents"] = [parent_id]
        elif parent_id == "my_drive" or not parent_id:
            payload["parents"] = ["root"]

        async with aiohttp.ClientSession() as session:
            async with session.post(url, headers=headers, json=payload, timeout=30) as resp:
                if resp.status not in (200, 201):
                    err_text = await resp.text()
                    raise ValueError(f"Failed to initiate Google Drive upload: {resp.status} - {err_text}")
                upload_url = resp.headers.get("Location")
                if not upload_url:
                    raise ValueError("Google Drive did not return an upload session URL in Location header")
                return upload_url

    @staticmethod
    async def upload_resumable_stream(
        upload_session_url: str,
        async_stream_gen: Any,
        total_size: Optional[int] = None,
        progress_callback: Optional[Any] = None,
        cancel_event: Optional[Any] = None,
        chunk_size: int = 4 * 1024 * 1024  # 4 MB chunk buffer (multiple of 256 KB)
    ) -> Dict[str, Any]:
        """
        Streams data from an async byte generator to a Google Drive resumable upload session.
        Uses 0 VM disk buffer: chunks are kept only in RAM and uploaded sequentially.
        """
        buffer = bytearray()
        offset = 0
        total_str = str(total_size) if total_size is not None and total_size > 0 else "*"

        async with aiohttp.ClientSession() as session:
            async for data in async_stream_gen:
                if cancel_event and cancel_event.is_set():
                    raise asyncio.CancelledError("Upload cancelled by user")

                buffer.extend(data)
                while len(buffer) >= chunk_size:
                    chunk = bytes(buffer[:chunk_size])
                    buffer = buffer[chunk_size:]
                    chunk_len = len(chunk)
                    end_byte = offset + chunk_len - 1

                    headers = {
                        "Content-Length": str(chunk_len),
                        "Content-Range": f"bytes {offset}-{end_byte}/{total_str}"
                    }

                    # Retry loop for chunk upload
                    retry = 0
                    while retry < 3:
                        if cancel_event and cancel_event.is_set():
                            raise asyncio.CancelledError("Upload cancelled by user")
                        try:
                            async with session.put(upload_session_url, headers=headers, data=chunk, timeout=60) as resp:
                                if resp.status in (200, 201):
                                    # Finished early or exact size
                                    offset += chunk_len
                                    if progress_callback:
                                        await progress_callback(offset, total_size)
                                    return await resp.json()
                                elif resp.status == 308:
                                    # 308 Resume Incomplete is expected for partial chunks
                                    offset += chunk_len
                                    if progress_callback:
                                        await progress_callback(offset, total_size)
                                    break
                                else:
                                    err_t = await resp.text()
                                    logger.warning(f"[GDRIVE_UPLOAD] Chunk status {resp.status}: {err_t}. Retrying ({retry+1}/3)...")
                                    retry += 1
                                    await asyncio.sleep(2)
                        except Exception as conn_err:
                            logger.warning(f"[GDRIVE_UPLOAD] Chunk conn error: {conn_err}. Retrying ({retry+1}/3)...")
                            retry += 1
                            await asyncio.sleep(2)

                    if retry >= 3:
                        raise ConnectionError(f"Failed to upload chunk at offset {offset} after 3 retries")

            # Upload any remaining final chunk
            if len(buffer) > 0 or offset == 0:
                final_chunk = bytes(buffer)
                final_len = len(final_chunk)
                final_end = offset + final_len - 1 if final_len > 0 else 0
                final_total = str(offset + final_len) if total_size is None or total_size <= 0 else str(total_size)

                headers = {
                    "Content-Length": str(final_len),
                    "Content-Range": f"bytes {offset}-{final_end}/{final_total}"
                }

                retry = 0
                while retry < 3:
                    if cancel_event and cancel_event.is_set():
                        raise asyncio.CancelledError("Upload cancelled by user")
                    try:
                        async with session.put(upload_session_url, headers=headers, data=final_chunk, timeout=120) as resp:
                            if resp.status in (200, 201):
                                offset += final_len
                                if progress_callback:
                                    await progress_callback(offset, total_size)
                                return await resp.json()
                            elif resp.status == 308:
                                # Incomplete: query status
                                offset += final_len
                                break
                            else:
                                err_t = await resp.text()
                                logger.warning(f"[GDRIVE_UPLOAD] Final chunk error {resp.status}: {err_t}")
                                retry += 1
                                await asyncio.sleep(2)
                    except Exception as conn_err:
                        logger.warning(f"[GDRIVE_UPLOAD] Final chunk conn error: {conn_err}")
                        retry += 1
                        await asyncio.sleep(2)

                if retry >= 3:
                    raise ConnectionError(f"Failed to upload final chunk at offset {offset}")

            # If ended on exact chunk boundary, query the session to verify completion
            async with session.put(upload_session_url, headers={"Content-Length": "0", "Content-Range": f"bytes */{offset}"}, timeout=30) as resp:
                if resp.status in (200, 201):
                    return await resp.json()
                elif resp.status == 308:
                    raise ValueError(f"Google Drive upload incomplete: received status 308 with Range: {resp.headers.get('Range')}")
                else:
                    err_t = await resp.text()
                    raise ValueError(f"Failed to finalize upload: {resp.status} - {err_t}")

    @staticmethod
    async def crawl_folder_recursive(
        access_token: str,
        root_folder_id: str,
        root_folder_name: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Recursively scans a Google Drive folder and returns all files and subdirectories
        with their relative paths from root_folder_name.
        """
        headers = {"Authorization": f"Bearer {access_token}"}
        all_files: List[Dict[str, Any]] = []
        all_folders: List[Dict[str, Any]] = []

        # Queue of tuples: (folder_id, relative_path_prefix)
        queue = [(root_folder_id, root_folder_name or "")]

        async with aiohttp.ClientSession() as session:
            while queue:
                current_fid, current_prefix = queue.pop(0)
                page_token = None

                while True:
                    q = f"'{current_fid}' in parents and trashed = false"
                    url = f"{DRIVE_API_BASE}/files?q={urllib.parse.quote(q)}&fields=nextPageToken,files(id,name,size,mimeType)&pageSize=1000&supportsAllDrives=true"
                    if page_token:
                        url += f"&pageToken={page_token}"

                    async with session.get(url, headers=headers, timeout=30) as resp:
                        if resp.status != 200:
                            err_text = await resp.text()
                            logger.error(f"[GDRIVE_CRAWL] Error reading folder {current_fid}: {err_text}")
                            break
                        data = await resp.json()

                    for item in data.get("files", []):
                        item_id = item["id"]
                        item_name = item["name"]
                        item_mime = item.get("mimeType", "")
                        item_size = int(item.get("size", 0))

                        rel_path = f"{current_prefix}/{item_name}".strip("/")

                        if item_mime == "application/vnd.google-apps.folder":
                            all_folders.append({
                                "id": item_id,
                                "name": item_name,
                                "rel_path": rel_path
                            })
                            queue.append((item_id, rel_path))
                        else:
                            all_files.append({
                                "id": item_id,
                                "name": item_name,
                                "size": item_size,
                                "mimeType": item_mime,
                                "rel_path": rel_path
                            })

                    page_token = data.get("nextPageToken")
                    if not page_token:
                        break

        return {
            "root_folder_id": root_folder_id,
            "root_folder_name": root_folder_name,
            "files": all_files,
            "folders": all_folders,
            "total_files": len(all_files),
            "total_bytes": sum(f["size"] for f in all_files)
        }
