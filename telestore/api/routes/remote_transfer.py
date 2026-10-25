# telestore/api/routes/remote_transfer.py

from fastapi import APIRouter, Request, Depends, HTTPException, UploadFile, File, Form
from pydantic import BaseModel, Field
import asyncio
import posixpath
from typing import Literal, Optional, Union

from telestore.security.credentials import require_auth, require_upload, User
from telestore.services.remote_transfer_manager import remote_transfer_manager
from telestore.db import database

router = APIRouter(prefix="/transfers/remote", tags=["Remote Transfers"])

class EnqueueRemoteTransferModel(BaseModel):
    url: str
    destination_path: Optional[str] = "/Home"

class CancelRemoteTransferModel(BaseModel):
    task_id: str

class CancelRemoteGroupModel(BaseModel):
    group_id: str

class ResumeRemoteGroupModel(BaseModel):
    group_id: str

class RetryRemoteTransferModel(BaseModel):
    task_id: str

@router.post("/add")
async def add_remote_transfer(
    request: Request,
    body: EnqueueRemoteTransferModel,
    user: User = Depends(require_upload)
):
    """Enqueue a Google Drive (file/folder), BitTorrent Magnet, or direct URL server-to-server download."""
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

    # Ensure background processor is running
    remote_transfer_manager.start_worker(request.app)

    try:
        tasks = await remote_transfer_manager.enqueue_transfer(
            user_id=user_id,
            url=body.url,
            destination_path=body.destination_path or "/Home",
            chat_id=chat_id
        )
        return {
            "success": True,
            "message": f"Enqueued {len(tasks)} item(s) for server transfer.",
            "count": len(tasks),
            "tasks": tasks
        }
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to queue transfer: {str(e)}")

@router.post("/upload-torrent")
async def upload_torrent_transfer(
    request: Request,
    file: UploadFile = File(...),
    destination_path: Optional[str] = Form("/Home"),
    user: User = Depends(require_upload)
):
    """Enqueue a BitTorrent transfer from an uploaded .torrent file."""
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

    # Ensure background processor is running
    remote_transfer_manager.start_worker(request.app)

    try:
        torrent_bytes = await file.read()
        if not torrent_bytes:
            raise ValueError("Uploaded .torrent file is empty.")

        task = await remote_transfer_manager.enqueue_torrent_file(
            user_id=user_id,
            torrent_bytes=torrent_bytes,
            original_filename=file.filename or "uploaded.torrent",
            destination_path=destination_path or "/Home",
            chat_id=chat_id
        )
        return {
            "success": True,
            "message": f"Enqueued torrent '{task.get('filename')}' for server transfer.",
            "count": 1,
            "tasks": [task]
        }
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to queue torrent transfer: {str(e)}")

@router.get("/tasks")
async def get_remote_tasks(
    request: Request,
    user: User = Depends(require_auth)
):
    """Retrieve all active, queued, and recently completed remote transfers for the current user."""
    # Ensure worker running
    remote_transfer_manager.start_worker(request.app)
    user_id = str(user.telegram_user_id or user.username)
    return await asyncio.to_thread(remote_transfer_manager.get_user_tasks, user_id)

@router.post("/cancel")
async def cancel_remote_task(
    body: CancelRemoteTransferModel,
    user: User = Depends(require_auth)
):
    """Cancel an ongoing or queued background server transfer."""
    user_id = str(user.telegram_user_id or user.username)
    success = remote_transfer_manager.cancel_task(body.task_id, user_id)
    if not success:
        raise HTTPException(status_code=404, detail="Task not found or already terminated.")
    return {"success": True, "message": "Transfer cancelled."}

@router.post("/cancel-group")
async def cancel_remote_group(
    body: CancelRemoteGroupModel,
    user: User = Depends(require_auth)
):
    """Cancel all active and queued tasks belonging to a group/folder."""
    user_id = str(user.telegram_user_id or user.username)
    cancelled_count = remote_transfer_manager.cancel_group(body.group_id, user_id)
    return {"success": True, "cancelled_count": cancelled_count, "message": f"Cancelled {cancelled_count} transfer(s) in folder."}

@router.post("/resume-group")
async def resume_remote_group(
    body: ResumeRemoteGroupModel,
    user: User = Depends(require_upload)
):
    """Manually resume all tasks in a group that were paused due to quota cooldown."""
    user_id = str(user.telegram_user_id or user.username)
    resumed_count = remote_transfer_manager.resume_group(body.group_id, user_id)
    return {"success": True, "resumed_count": resumed_count, "message": f"Resumed {resumed_count} transfer(s) in folder."}

@router.post("/retry")
async def retry_remote_task(
    body: RetryRemoteTransferModel,
    user: User = Depends(require_upload)
):
    """Retry a failed or paused remote transfer task."""
    user_id = str(user.telegram_user_id or user.username)
    success = remote_transfer_manager.retry_task(body.task_id, user_id)
    if not success:
        raise HTTPException(status_code=404, detail="Task not found or not in retryable state.")
    return {"success": True, "message": "Transfer retried."}

@router.post("/clear-completed")
async def clear_completed_remote_tasks(
    user: User = Depends(require_auth)
):
    """Clear completed and cancelled tasks from history."""
    user_id = str(user.telegram_user_id or user.username)
    deleted_count = remote_transfer_manager.clear_completed(user_id)
    return {"success": True, "cleared_count": deleted_count}


# ── Import from Instagram ──────────────────────────────────────────────────────────────────
MAX_INSTAGRAM_JOBS = 3  # posts waiting or running per user


class InstagramUrlModel(BaseModel):
    url: str


class InstagramDestinationModel(BaseModel):
    kind: Literal["home", "vault", "gdrive"]
    path: Optional[str] = None
    account_id: Optional[str] = None
    folder_id: Optional[str] = None
    folder_name: Optional[str] = None


class InstagramImportModel(BaseModel):
    url: str
    destination: InstagramDestinationModel


class InstagramLoginModel(BaseModel):
    username: str
    password: str


class InstagramCodeModel(BaseModel):
    code: str


class InstagramBrowserSessionModel(BaseModel):
    sessionid: str


async def _read_instagram_post(url: str) -> dict:
    from telestore.services.instagram_service import InstagramError, get_client, parse_instagram_url
    try:
        _, shortcode = parse_instagram_url(url)
        return await get_client().get_post(shortcode)
    except InstagramError as e:
        raise HTTPException(status_code=400, detail=str(e))


def _index_chat(user: User) -> int:
    if not user.telegram_user_id:
        raise HTTPException(status_code=400, detail="TELEGRAM_NOT_VERIFIED: Connect your Telegram account in Settings › Account first.")
    user_data = database.Users.find_one({"telegram_user_id": user.telegram_user_id})
    if not user_data or user_data.get("index_chat_id") is None:
        raise HTTPException(status_code=400, detail="Set your index chat in Settings › Connection first.")
    return user_data["index_chat_id"]


def _save_destination(request: Request, dest: InstagramDestinationModel, user: User) -> tuple:
    """(destination dict for the manager, index chat ID or None); raises 4xx for places that can't take files."""
    from telestore.api.routes.vault import is_vault_unlocked

    if dest.kind == "gdrive":
        ids = [user.username] + ([str(user.telegram_user_id)] if user.telegram_user_id else [])
        account = database.CloudAccounts.get_account_raw(account_id=dest.account_id or "", user_id=ids) if dest.account_id else None
        if not account:
            raise HTTPException(status_code=404, detail="Google Drive account not found.")
        folder_id = dest.folder_id or "my_drive"
        if folder_id in ("root", "google_drive", "starred", "trash", "shared_with_me"):
            raise HTTPException(status_code=400, detail="Pick a folder in My Drive.")
        folder_id = "root" if folder_id == "my_drive" else folder_id
        label = f"{account.get('account_name') or 'Google Drive'} / {dest.folder_name or 'My Drive'}"
        return {"kind": "gdrive", "account_id": dest.account_id, "account_user_ids": ids, "folder_id": folder_id, "label": label}, None

    path = posixpath.normpath("/" + (dest.path or "").strip().strip("/"))
    root = "/Vault" if dest.kind == "vault" else "/Home"
    if path != root and not path.startswith(root + "/"):
        raise HTTPException(status_code=400, detail=f"Pick a folder inside {'Private Vault' if dest.kind == 'vault' else 'Home'}.")
    if dest.kind == "vault" and not is_vault_unlocked(request):
        raise HTTPException(status_code=403, detail="Unlock your Private Vault first.")
    return {"kind": dest.kind, "path": path}, _index_chat(user)


@router.post("/instagram/preview")
async def preview_instagram(body: InstagramUrlModel, user: User = Depends(require_upload)):
    """What an Instagram link holds: the account, caption and each photo or video."""
    from telestore.services.instagram_service import get_client
    post = await _read_instagram_post(body.url)
    return {
        "shortcode": post["shortcode"],
        "owner": post["owner"],
        "caption": post["caption"],
        "date": post["date"],
        "thumbnail": await get_client().thumbnail(post["items"][0]["thumbnail"]),
        "items": [{"index": it["index"], "is_video": it["is_video"]} for it in post["items"]],
    }


@router.post("/instagram")
async def import_instagram(request: Request, body: InstagramImportModel, user: User = Depends(require_upload)):
    """Queues every photo and video of a post or reel, saved to Home, the Private Vault or a Google Drive."""
    destination, chat_id = _save_destination(request, body.destination, user)
    user_id = str(user.telegram_user_id or user.username)

    from telestore.services.remote_transfer_manager.helpers import get_remote_db
    waiting = get_remote_db()["RemoteTransfers"].distinct("instagram_shortcode", {
        "user_id": user_id, "source_type": "instagram", "status": {"$in": ["queued", "downloading", "uploading_tg"]},
    })
    if len(waiting) >= MAX_INSTAGRAM_JOBS:
        raise HTTPException(status_code=429, detail=f"You already have {len(waiting)} Instagram imports running. Wait for one to finish.")

    post = await _read_instagram_post(body.url)
    remote_transfer_manager.start_worker(request.app)
    tasks = remote_transfer_manager.enqueue_instagram(user_id, post, body.url.strip(), destination, chat_id)
    count = len(tasks)
    return {
        "success": True,
        "message": f"Importing {count} {'item' if count == 1 else 'items'} from @{post['owner']}.",
        "count": count,
        "group_id": tasks[0].get("group_id"),
        "tasks": tasks,
    }


def _is_owner(user: User) -> bool:
    from telestore.security.credentials import is_owner_account
    return is_owner_account(user.username, {"telegram_user_id": user.telegram_user_id})


def _require_owner(user: User) -> None:
    if not _is_owner(user):
        raise HTTPException(status_code=403, detail="Only the owner can connect an Instagram account.")


@router.get("/instagram/session")
async def instagram_session(user: User = Depends(require_auth)):
    from telestore.services.instagram_service import get_client
    username = get_client().connected_username()
    return {"connected": bool(username), "username": username}


@router.post("/instagram/session/login")
async def instagram_login(body: InstagramLoginModel, user: User = Depends(require_auth)):
    from telestore.services.instagram_service import InstagramError, get_client
    _require_owner(user)
    try:
        return await asyncio.to_thread(get_client().login, body.username, body.password)
    except InstagramError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/instagram/session/2fa")
async def instagram_two_factor(body: InstagramCodeModel, user: User = Depends(require_auth)):
    from telestore.services.instagram_service import InstagramError, get_client
    _require_owner(user)
    try:
        return await asyncio.to_thread(get_client().finish_two_factor, body.code)
    except InstagramError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/instagram/session/browser")
async def instagram_browser_session(body: InstagramBrowserSessionModel, user: User = Depends(require_auth)):
    from telestore.services.instagram_service import InstagramError, get_client
    _require_owner(user)
    try:
        return await asyncio.to_thread(get_client().login_with_browser_session, body.sessionid)
    except InstagramError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/instagram/session")
async def instagram_logout(user: User = Depends(require_auth)):
    from telestore.services.instagram_service import get_client
    _require_owner(user)
    get_client().logout()
    return {"connected": False, "username": None}


# ── Video and audio downloads (yt-dlp) ─────────────────────────────────────────────────────
MAX_MEDIA_JOBS = 3  # links waiting or running per user


class MediaChoiceModel(BaseModel):
    mode: Literal["video", "audio"] = "video"
    # "best", "compat" (H.264 up to 1080p), a height ("2160", "144"…) or "fmt:<id>" (e.g. Facebook "hd")
    quality: str = Field("best", pattern=r"^(best|compat|\d{3,4}|fmt:[A-Za-z0-9._-]{1,40})$")
    # "original" keeps the site's audio as is; the rest convert (bitrate for MP3/M4A)
    audio_format: Literal["original", "mp3", "m4a", "flac", "wav"] = "original"
    audio_bitrate: Optional[Literal["320", "256", "192", "160", "128"]] = None
    audio_source: Optional[str] = Field(None, pattern=r"^[A-Za-z0-9._-]{1,40}$")  # one of the site's audio versions
    # Subtitle language: "en", "hi" or "all"; None or False for none (True means English)
    subtitles: Optional[Union[Literal["en", "hi", "all"], bool]] = None


class MediaDownloadModel(BaseModel):
    url: str
    choice: MediaChoiceModel
    destination: InstagramDestinationModel
    items: Optional[list[int]] = None  # playlist entries to download (1-based); all when missing
    sync: bool = False  # keep downloading the playlist's or channel's new videos


class MediaSyncUpdateModel(BaseModel):
    enabled: bool


async def _probe_media(url: str) -> dict:
    from telestore.services.media_download_service import MediaError, probe
    try:
        return await probe(url)
    except MediaError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/media/preview")
async def preview_media(body: InstagramUrlModel, user: User = Depends(require_upload)):
    """What a link holds: one video, or a playlist and its videos."""
    from telestore.services.media_download_service import thumbnail
    info = await _probe_media(body.url)
    return {
        "kind": info["kind"],
        "is_channel": info.get("is_channel", False),
        "title": info["title"],
        "uploader": info.get("uploader"),
        "site": info.get("site"),
        "duration": info.get("duration"),
        "options": info.get("options"),
        "count": info["count"],
        "thumbnail": await thumbnail(info.get("thumbnail_url")),
        "entries": [{"index": e["index"], "title": e["title"], "duration": e.get("duration")} for e in info["entries"]],
    }


@router.post("/media")
async def download_media(request: Request, body: MediaDownloadModel, user: User = Depends(require_upload)):
    """Queues the video, its audio, or the chosen videos of a playlist."""
    destination, chat_id = _save_destination(request, body.destination, user)
    user_id = str(user.telegram_user_id or user.username)

    from telestore.services.remote_transfer_manager.helpers import get_remote_db
    running = get_remote_db()["RemoteTransfers"].distinct("media_job_id", {
        "user_id": user_id, "source_type": "media", "status": {"$in": ["queued", "downloading", "uploading_tg"]},
    })
    if len(running) >= MAX_MEDIA_JOBS:
        raise HTTPException(status_code=429, detail=f"You already have {len(running)} downloads running. Wait for one to finish.")

    from telestore.services import media_sync
    if body.sync and media_sync.count_for(user_id) >= media_sync.MAX_SYNCS_PER_USER:
        raise HTTPException(status_code=429, detail=f"You can keep up to {media_sync.MAX_SYNCS_PER_USER} playlists in sync. Remove one in Settings › Integrations first.")

    info = await _probe_media(body.url)
    if body.sync and info["kind"] != "playlist":
        raise HTTPException(status_code=400, detail="Only playlists and channels can be kept in sync.")
    entries = info["entries"]
    if body.items is not None:
        wanted = set(body.items)
        entries = [e for e in entries if e["index"] in wanted]
        # Syncing with nothing picked means: only the videos that come out from now on
        if not entries and not body.sync:
            raise HTTPException(status_code=400, detail="Pick at least one video.")

    remote_transfer_manager.start_worker(request.app)
    choice = body.choice.model_dump()
    tasks = remote_transfer_manager.enqueue_media(user_id, info, entries, choice, destination, chat_id) if entries else []
    sync = media_sync.create(user_id, info, choice, destination, chat_id) if body.sync else None
    count = len(tasks)
    what = "audio" if body.choice.mode == "audio" else "video"
    message = f"Downloading {count} {what} {'file' if count == 1 else 'files'}." if count > 1 or what == "audio" else "Downloading the video."
    if sync:
        message = (message + " New videos will download by themselves.") if count else "Synced: new videos will download by themselves."
    return {
        "success": True,
        "message": message,
        "count": count,
        "group_id": tasks[0].get("group_id") if tasks else None,
        "tasks": tasks,
        "sync": sync,
    }


@router.get("/media/settings")
async def media_settings(user: User = Depends(require_auth)):
    from telestore.services.media_download_service import get_settings
    return await get_settings()


@router.post("/media/update")
async def update_media_downloader(user: User = Depends(require_auth)):
    """Installs the newest yt-dlp on the server (owner); downloads that are running finish first."""
    from telestore.services.media_download_service import MediaError, update_yt_dlp
    if not _is_owner(user):
        raise HTTPException(status_code=403, detail="Only the owner can update the downloader.")
    try:
        return await update_yt_dlp()
    except MediaError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/media/use-builtin")
async def use_builtin_media_downloader(user: User = Depends(require_auth)):
    from telestore.services.media_download_service import use_builtin_yt_dlp
    if not _is_owner(user):
        raise HTTPException(status_code=403, detail="Only the owner can change the downloader.")
    return await asyncio.to_thread(use_builtin_yt_dlp)


def _sync_user(user: User) -> str:
    return str(user.telegram_user_id or user.username)


@router.get("/media/syncs")
async def list_media_syncs(user: User = Depends(require_auth)):
    from telestore.services import media_sync
    return {"syncs": media_sync.list_for(_sync_user(user)), "every_hours": media_sync.CHECK_EVERY.total_seconds() / 3600}


@router.post("/media/syncs/{sync_id}")
async def update_media_sync(sync_id: str, body: MediaSyncUpdateModel, user: User = Depends(require_upload)):
    from telestore.services import media_sync
    sync = media_sync.set_enabled(_sync_user(user), sync_id, body.enabled)
    if not sync:
        raise HTTPException(status_code=404, detail="That synced playlist wasn't found.")
    return sync


@router.post("/media/syncs/{sync_id}/check")
async def check_media_sync(request: Request, sync_id: str, user: User = Depends(require_upload)):
    """Looks for new videos now instead of waiting for the next check."""
    from telestore.services import media_sync
    doc = media_sync._coll().find_one({"user_id": _sync_user(user), "sync_id": sync_id})
    if not doc:
        raise HTTPException(status_code=404, detail="That synced playlist wasn't found.")
    remote_transfer_manager.start_worker(request.app)
    found = await media_sync.check(doc)
    return {"new": found, "sync": media_sync._public(media_sync._coll().find_one({"sync_id": sync_id}))}


@router.delete("/media/syncs/{sync_id}")
async def delete_media_sync(sync_id: str, user: User = Depends(require_auth)):
    from telestore.services import media_sync
    if not media_sync.remove(_sync_user(user), sync_id):
        raise HTTPException(status_code=404, detail="That synced playlist wasn't found.")
    return {"success": True}


@router.post("/media/cookies")
async def upload_media_cookies(file: UploadFile = File(...), user: User = Depends(require_auth)):
    """The owner's cookies.txt export of a signed-in browser, used for every download."""
    from telestore.services.media_download_service import MediaError, save_cookies
    if not _is_owner(user):
        raise HTTPException(status_code=403, detail="Only the owner can add cookies.")
    data = await file.read(2 * 1024 * 1024 + 1)
    if len(data) > 2 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="That file is too big for a cookies.txt.")
    try:
        return save_cookies(data)
    except MediaError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/media/cookies")
async def remove_media_cookies(user: User = Depends(require_auth)):
    from telestore.services.media_download_service import remove_cookies
    if not _is_owner(user):
        raise HTTPException(status_code=403, detail="Only the owner can remove cookies.")
    return remove_cookies()
