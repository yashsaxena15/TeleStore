# telestore/services/remote_transfer_manager/manager.py

import os
import re
import time
import shutil
import asyncio
import secrets
import threading
from telestore.services.remote_transfer_manager.helpers import friendly_error
from telestore.services import event_service
from typing import Optional, Dict, Any, List
from datetime import datetime, timezone, timedelta
import urllib.parse

import math
import requests

from telestore.db import database
from telestore.services.pipeline_uploader import upload_part_task
from telestore.services.priority_manager import priority_manager
from telestore.services.torrent_manager import torrent_manager, parse_torrent_bytes

from telestore.services.remote_transfer_manager.common import logger
from telestore.services.remote_transfer_manager.helpers import GoogleDriveQuotaExceededError, MODERN_USER_AGENT, finalize_multipart_group_if_ready, get_file_type, get_remote_db, is_gdrive_quota_error, probe_resource_for_range
from telestore.services.remote_transfer_manager.pipeline import PipelinedStreamWriter

# Largest piece sent to Telegram as one message; bigger files go up in parts of this size
TELEGRAM_PART_SIZE = 1950 * 1024 * 1024
# Video downloads: pause between videos, and how long to wait (and how often) when YouTube blocks
MEDIA_GAP_S = 5
MEDIA_BLOCK_COOLDOWN = timedelta(minutes=30)
MEDIA_BLOCK_RETRIES = 3

RUNNING_STATUSES = ["downloading", "uploading_tg", "discovering"]
ACTIVE_STATUSES = ["queued", *RUNNING_STATUSES, "paused_quota"]
# Waiting files shown per folder leech on the Transfers page (the summary counts all of them)
GROUP_PREVIEW_SIZE = 20


class RemoteTransferManager:
    """
    Manages background cloud-to-cloud server transfers (Google Drive, direct URLs).
    Runs independently of browser sessions, persists state to MongoDB, and throttles concurrency.
    """
    def __init__(self, max_concurrent: int = 2):
        self.max_concurrent = max_concurrent
        self.semaphore = asyncio.Semaphore(max_concurrent)
        self.active_tasks: Dict[str, asyncio.Task] = {}
        self.cancel_events: Dict[str, threading.Event] = {}
        self._running = False
        self._queue_worker_task: Optional[asyncio.Task] = None
        self._sync_task: Optional[asyncio.Task] = None
        self._bot_manager = None
        self._last_media_at = 0.0

    def set_bot_manager(self, bot_manager):
        self._bot_manager = bot_manager

    def init_db(self):
        """Reset any interrupted tasks on startup."""
        try:
            coll = get_remote_db()["RemoteTransfers"]
            # Folder leeches can queue tens of thousands of tasks; keep the Transfers list and claims fast
            coll.create_index([("user_id", 1), ("status", 1), ("group_id", 1)])
            coll.create_index([("group_id", 1), ("status", 1)])
            # Only this server's own tasks: a worker machine carries on with its own (the watchdog
            # takes them back if it went quiet)
            coll.update_many(
                {"status": {"$in": ["downloading", "uploading_tg"]}, "claimed_by": {"$in": [None, "master-vm1"]}},
                {
                    "$set": {
                        "status": "queued",
                        "phase": "Resumed after server restart",
                        "speed_bps": 0,
                        "updated_at": datetime.now(timezone.utc)
                    },
                    "$unset": {"claimed_by": "", "claimed_at": ""}
                }
            )
        except Exception as e:
            logger.warning(f"Failed to reset interrupted remote tasks: {e}")

    def start_worker(self, app=None):
        if app and hasattr(app.state, "bot_manager"):
            self._bot_manager = app.state.bot_manager

        if not self._running:
            self._running = True
            self.init_db()
            self._queue_worker_task = asyncio.create_task(self._process_queue_loop())
            from telestore.services.media_sync import run_forever as run_media_syncs
            self._sync_task = asyncio.create_task(run_media_syncs())
            logger.info("Remote Transfer Manager background worker loop started.")

    async def _process_queue_loop(self):
        """Continuously checks for queued tasks and launches them up to concurrency limit."""
        while self._running:
            try:
                # If user upload is active, yield bandwidth and pause queue processing
                if priority_manager.is_user_upload_active():
                    await asyncio.sleep(2)
                    continue

                coll = get_remote_db()["RemoteTransfers"]

                # Auto-resume any tasks whose quota cooldown has expired (e.g. 24h passed)
                now_utc = datetime.now(timezone.utc)
                resumed_res = coll.update_many(
                    {
                        "status": "paused_quota",
                        "cooldown_until": {"$lte": now_utc}
                    },
                    {
                        "$set": {
                            "status": "queued",
                            "phase": "Queued (Resumed after quota reset)",
                            "updated_at": now_utc
                        },
                        "$unset": {"cooldown_until": "", "claimed_by": "", "claimed_at": ""}
                    }
                )
                if resumed_res.modified_count > 0:
                    logger.info(f"Auto-resumed {resumed_res.modified_count} tasks from Google Drive quota cooldown.")

                # Watchdog: Re-queue tasks abandoned by dead/offline workers
                stale_threshold = now_utc - timedelta(seconds=120)
                abandoned_res = coll.update_many(
                    {
                        "status": {"$in": ["downloading", "uploading_tg"]},
                        "claimed_by": {"$nin": [None, "master-vm1"]},
                        "updated_at": {"$lte": stale_threshold}
                    },
                    {
                        "$set": {
                            "status": "queued",
                            "phase": "Re-queued (Worker offline/timeout)",
                            "updated_at": now_utc
                        },
                        "$unset": {"claimed_by": "", "claimed_at": ""}
                    }
                )
                if abandoned_res.modified_count > 0:
                    logger.warning(f"[WORKER_WATCHDOG] Re-queued {abandoned_res.modified_count} stale tasks from inactive workers.")

                # Concurrency limit for local processing on VM 1 (leave remaining tasks for distributed workers)
                max_local_concurrent = int(os.getenv("MAX_LOCAL_CONCURRENT", "1"))
                available_slots = max(0, max_local_concurrent - len(self.active_tasks))

                if available_slots > 0:
                    # Find queued tasks that have NOT been claimed by an external worker
                    queued_cursor = coll.find({
                        "status": "queued",
                        "claimed_by": {"$exists": False}
                    }).sort("created_at", 1).limit(available_slots)
                    queued_tasks = list(queued_cursor)

                    for item in queued_tasks:
                        task_id = item["task_id"]
                        if task_id not in self.active_tasks:
                            # Claim task locally (only if no worker took it meanwhile)
                            claimed = coll.update_one(
                                {"task_id": task_id, "status": "queued", "claimed_by": {"$exists": False}},
                                {
                                    "$set": {
                                        "status": "downloading",
                                        "claimed_by": "master-vm1",
                                        "claimed_at": now_utc,
                                        "phase": "Starting local transfer...",
                                        "updated_at": now_utc
                                    }
                                }
                            )
                            if not claimed.modified_count:
                                continue
                            # Launch task wrapper
                            t = asyncio.create_task(self._execute_task_wrapper(item))
                            self.active_tasks[task_id] = t

                await asyncio.sleep(2)
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error in remote transfer queue loop: {e}", exc_info=True)
                await asyncio.sleep(3)

    async def enqueue_transfer(
        self,
        user_id: str,
        url: str,
        destination_path: str,
        chat_id: int,
        custom_headers: Optional[Dict[str, str]] = None,
        custom_filename: Optional[str] = None,
        custom_filesize: Optional[int] = None,
        post_action_delete: bool = False,
        cloud_account_id: Optional[str] = None,
        cloud_file_id: Optional[str] = None,
        group_id: Optional[str] = None,
        group_name: Optional[str] = None,
        group_total_items: Optional[int] = None
    ) -> List[Dict[str, Any]]:
        """
        Parses the URL (GDrive file, GDrive folder, direct URL) and creates
        queued task documents in MongoDB.
        """
        url = url.strip()
        coll = get_remote_db()["RemoteTransfers"]
        now = datetime.now(timezone.utc)
        clean_dest = destination_path.strip() or "/Home"
        is_vault = clean_dest.startswith("/Vault") or clean_dest == "Vault"

        # Check if Magnet Link
        if url.startswith("magnet:?xt="):
            task_id = f"rt_{secrets.token_hex(6)}"
            dn_match = re.search(r'dn=([^&]+)', url)
            filename = urllib.parse.unquote_plus(dn_match.group(1)) if dn_match else "Resolving Magnet..."
            doc = {
                "task_id": task_id,
                "user_id": str(user_id),
                "chat_id": chat_id,
                "source_url": url,
                "gdrive_id": None,
                "source_type": "magnet",
                "destination_path": clean_dest,
                "filename": filename,
                "filesize": 0,
                "transferred_bytes": 0,
                "speed_bps": 0,
                "peer_count": 0,
                "progress": 0,
                "eta_seconds": 0,
                "status": "queued",
                "phase": "Queued",
                "error_message": None,
                "is_vault": is_vault,
                "created_at": now,
                "updated_at": now
            }
            coll.insert_one(doc)
            doc["_id"] = str(doc["_id"])
            return [doc]

        # Check if Google Drive Folder
        folder_match = re.search(r'/drive/folders/([a-zA-Z0-9_-]+)', url) or re.search(r'id=([a-zA-Z0-9_-]+)', url) if 'folders' in url else None
        
        if folder_match:
            folder_id = folder_match.group(1)
            group_id = f"grp_{secrets.token_hex(6)}"
            disc_task_id = f"disc_{group_id}"

            # Create placeholder discovery task immediately to return instantly to frontend
            disc_doc = {
                "task_id": disc_task_id,
                "user_id": str(user_id),
                "chat_id": chat_id,
                "source_url": url,
                "gdrive_id": folder_id,
                "source_type": "gdrive_folder",
                "destination_path": clean_dest,
                "filename": "Google Drive Folder",
                "filesize": 0,
                "transferred_bytes": 0,
                "speed_bps": 0,
                "progress": 0,
                "eta_seconds": 0,
                "status": "discovering",
                "phase": "🔍 Analyzing folder & discovering files in background...",
                "error_message": None,
                "is_vault": is_vault,
                "group_id": group_id,
                "group_name": "Google Drive Folder",
                "group_type": "folder",
                "group_total_items": 0,
                "created_at": now,
                "updated_at": now
            }
            coll.insert_one(disc_doc)
            disc_doc["_id"] = str(disc_doc["_id"])

            # Launch background discovery task without blocking the HTTP request
            asyncio.create_task(
                self._async_discover_folder(
                    disc_task_id=disc_task_id,
                    group_id=group_id,
                    folder_id=folder_id,
                    url=url,
                    user_id=str(user_id),
                    chat_id=chat_id,
                    clean_dest=clean_dest,
                    is_vault=is_vault
                )
            )

            return [disc_doc]

        # Check if Google Drive Single File
        gdrive_file_id = None
        file_match = re.search(r'/file/d/([a-zA-Z0-9_-]+)', url) or re.search(r'id=([a-zA-Z0-9_-]+)', url)
        if file_match and ('drive.google.com' in url or 'docs.google.com' in url):
            gdrive_file_id = file_match.group(1)

        source_type = "gdrive_file" if gdrive_file_id else "direct_url"

        # Check if Multi-Range Chunking is applicable for Large Single Files
        PART_MAX_SIZE = int(os.getenv("MULTI_RANGE_PART_SIZE_MB", "1950")) * 1024 * 1024
        min_split_size = int(os.getenv("MULTI_RANGE_MIN_SIZE_MB", "1950")) * 1024 * 1024

        # Probe resource for Range support, total file size, and direct URL
        probe_task = asyncio.to_thread(
            probe_resource_for_range,
            url=url,
            gdrive_id=gdrive_file_id,
            custom_headers=custom_headers
        )
        try:
            supports_range, final_url, probed_size, probed_filename = await asyncio.wait_for(probe_task, timeout=6.0)
        except Exception as pe:
            logger.debug(f"Resource probe skipped/timed out: {pe}")
            supports_range, final_url, probed_size, probed_filename = False, url, (custom_filesize or 0), custom_filename

        effective_size = probed_size or custom_filesize or 0
        effective_filename = custom_filename or probed_filename or "download.bin"

        # If Range headers are supported AND file exceeds split threshold, split into parallel part tasks!
        if supports_range and effective_size >= min_split_size:
            num_parts = math.ceil(effective_size / PART_MAX_SIZE)
            if num_parts >= 2:
                mp_group_id = f"grp_mp_{secrets.token_hex(6)}"
                created_tasks = []
                for part_idx in range(1, num_parts + 1):
                    p_start = (part_idx - 1) * PART_MAX_SIZE
                    p_end = min(effective_size - 1, part_idx * PART_MAX_SIZE - 1)
                    p_size = p_end - p_start + 1
                    p_tid = f"rt_{secrets.token_hex(6)}"

                    p_doc = {
                        "task_id": p_tid,
                        "user_id": str(user_id),
                        "chat_id": chat_id,
                        "source_url": final_url,
                        "gdrive_id": gdrive_file_id,
                        "source_type": source_type,
                        "destination_path": clean_dest,
                        "filename": effective_filename,
                        "filesize": p_size,
                        "total_filesize": effective_size,
                        "transferred_bytes": 0,
                        "speed_bps": 0,
                        "progress": 0,
                        "eta_seconds": 0,
                        "status": "queued",
                        "phase": f"Queued (Part {part_idx}/{num_parts})",
                        "error_message": None,
                        "is_vault": is_vault,
                        "is_range_part": True,
                        "range_start": p_start,
                        "range_end": p_end,
                        "part_index": part_idx,
                        "total_parts": num_parts,
                        "part_size": p_size,
                        "group_id": mp_group_id,
                        "group_name": effective_filename,
                        "group_type": "file",
                        "group_total_items": num_parts,
                        "created_at": now,
                        "updated_at": now
                    }
                    if custom_headers:
                        p_doc["custom_headers"] = custom_headers
                    if post_action_delete:
                        p_doc["post_action_delete"] = True
                    if cloud_account_id:
                        p_doc["cloud_account_id"] = cloud_account_id
                    if cloud_file_id:
                        p_doc["cloud_file_id"] = cloud_file_id

                    coll.insert_one(p_doc)
                    p_doc["_id"] = str(p_doc["_id"])
                    created_tasks.append(p_doc)

                logger.info(
                    f"[MULTI_RANGE] Split '{effective_filename}' ({effective_size / 1024 / 1024:.1f} MB) "
                    f"into {num_parts} parallel range parts under group {mp_group_id}"
                )
                return created_tasks

        # Single task fallback if not split
        task_id = f"rt_{secrets.token_hex(6)}"
        doc = {
            "task_id": task_id,
            "user_id": str(user_id),
            "chat_id": chat_id,
            "source_url": final_url if supports_range else url,
            "gdrive_id": gdrive_file_id,
            "source_type": source_type,
            "destination_path": clean_dest,
            "filename": effective_filename,
            "filesize": effective_size,
            "transferred_bytes": 0,
            "speed_bps": 0,
            "progress": 0,
            "eta_seconds": 0,
            "status": "queued",
            "phase": "Queued",
            "error_message": None,
            "is_vault": is_vault,
            "created_at": now,
            "updated_at": now
        }
        if custom_headers:
            doc["custom_headers"] = custom_headers
        if post_action_delete:
            doc["post_action_delete"] = True
        if cloud_account_id:
            doc["cloud_account_id"] = cloud_account_id
        if cloud_file_id:
            doc["cloud_file_id"] = cloud_file_id
        if group_id:
            doc["group_id"] = group_id
            doc["group_name"] = group_name
            doc["group_total_items"] = group_total_items

        coll.insert_one(doc)
        doc["_id"] = str(doc["_id"])
        return [doc]


    async def _async_discover_folder(
        self,
        disc_task_id: str,
        group_id: str,
        folder_id: str,
        url: str,
        user_id: str,
        chat_id: int,
        clean_dest: str,
        is_vault: bool
    ):
        """Asynchronously discovers files in a Google Drive folder without blocking HTTP requests."""
        coll = get_remote_db()["RemoteTransfers"]
        resolve_output_dir = f"/tmp/gdrive_resolve_{secrets.token_hex(4)}/"
        os.makedirs(resolve_output_dir, exist_ok=True)

        def _resolve_folder():
            from gdown.download_folder import download_folder
            return download_folder(id=folder_id, output=resolve_output_dir, skip_download=True, quiet=True, user_agent=MODERN_USER_AGENT)

        try:
            logger.info(f"[ASYNC_DISCOVERY] Starting background discovery for folder {folder_id} (group {group_id})...")
            folder_files = await asyncio.to_thread(_resolve_folder)
            if not folder_files:
                raise ValueError("Google Drive folder is empty or not accessible.")

            # Deduplication: Find any existing tasks for this user & destination
            existing_gdrive_ids = set(
                coll.distinct("gdrive_id", {
                    "user_id": str(user_id),
                    "gdrive_id": {"$ne": None},
                    "destination_path": {"$regex": f"^{re.escape(clean_dest)}"},
                    "status": {"$in": ["queued", "downloading", "uploading_tg", "completed", "paused_quota"]}
                })
            )

            root_folder_name = "Google Drive Folder"
            if folder_files:
                first_rel = os.path.relpath(folder_files[0].local_path, resolve_output_dir).replace("\\", "/").strip("/")
                parts = [p for p in first_rel.split("/") if p]
                if parts:
                    root_folder_name = parts[0]

            now = datetime.now(timezone.utc)
            docs_to_insert = []
            for gfile in folder_files:
                if gfile.id in existing_gdrive_ids:
                    continue  # Skip already queued/downloaded/paused file

                task_id = f"rt_{secrets.token_hex(6)}"
                rel_from_root = os.path.relpath(gfile.local_path, resolve_output_dir).replace("\\", "/").strip("/")
                rel_dir = os.path.dirname(rel_from_root).strip("/")
                fname = os.path.basename(rel_from_root) or f"gdrive_file_{gfile.id}"
                item_dest = f"{clean_dest}/{rel_dir}" if rel_dir else clean_dest

                doc = {
                    "task_id": task_id,
                    "user_id": str(user_id),
                    "chat_id": chat_id,
                    "source_url": f"https://drive.google.com/uc?id={gfile.id}",
                    "gdrive_id": gfile.id,
                    "source_type": "gdrive_file",
                    "destination_path": item_dest,
                    "filename": fname,
                    "filesize": 0,
                    "transferred_bytes": 0,
                    "speed_bps": 0,
                    "progress": 0,
                    "eta_seconds": 0,
                    "status": "queued",
                    "phase": "Queued",
                    "error_message": None,
                    "is_vault": is_vault,
                    "group_id": group_id,
                    "group_name": root_folder_name,
                    "group_type": "folder",
                    "group_total_items": len(folder_files),
                    "created_at": now,
                    "updated_at": now
                }
                docs_to_insert.append(doc)

            if docs_to_insert:
                batch_size = 500
                for i in range(0, len(docs_to_insert), batch_size):
                    batch = docs_to_insert[i:i + batch_size]
                    coll.insert_many(batch)
                coll.delete_one({"task_id": disc_task_id})
                logger.info(f"[ASYNC_DISCOVERY] Enqueued {len(docs_to_insert)} items for group {group_id} ({root_folder_name}).")
            else:
                # All files were already completed or queued!
                coll.update_one(
                    {"task_id": disc_task_id},
                    {"$set": {
                        "status": "completed",
                        "filename": root_folder_name,
                        "group_name": root_folder_name,
                        "phase": f"All {len(folder_files)} file(s) are already completed! 🎉",
                        "progress": 100,
                        "updated_at": datetime.now(timezone.utc)
                    }}
                )
                event_service.task_finished(disc_task_id)
        except Exception as e:
            logger.error(f"[ASYNC_DISCOVERY] Failed to resolve GDrive folder: {e}", exc_info=True)
            err_msg = str(e)
            if "Cannot retrieve the public link" in err_msg or "Check FAQ" in err_msg:
                err_msg = "Google Drive folder is not accessible (make sure 'Anyone with the link can view' is turned on)."
            coll.update_one(
                {"task_id": disc_task_id},
                {"$set": {
                    "status": "failed",
                    "error_message": err_msg,
                    "phase": f"Discovery failed: {err_msg[:60]}",
                    "updated_at": datetime.now(timezone.utc)
                }}
            )
            event_service.task_finished(disc_task_id)
        finally:
            shutil.rmtree(resolve_output_dir, ignore_errors=True)

    async def enqueue_torrent_file(
        self,
        user_id: str,
        torrent_bytes: bytes,
        original_filename: str,
        destination_path: str,
        chat_id: int
    ) -> Dict[str, Any]:
        """
        Validates an uploaded .torrent file, saves it into cache/torrents,
        and creates a queued task document in MongoDB.
        """
        coll = get_remote_db()["RemoteTransfers"]
        now = datetime.now(timezone.utc)
        clean_dest = destination_path.strip() or "/Home"
        is_vault = clean_dest.startswith("/Vault") or clean_dest == "Vault"

        try:
            meta = parse_torrent_bytes(torrent_bytes)
        except Exception as e:
            raise ValueError(f"Invalid .torrent file: {e}")

        torrent_dir = os.path.join(os.getcwd(), "cache", "torrents")
        os.makedirs(torrent_dir, exist_ok=True)

        task_id = f"rt_{secrets.token_hex(6)}"
        torrent_path = os.path.join(torrent_dir, f"{task_id}.torrent")
        with open(torrent_path, "wb") as f:
            f.write(torrent_bytes)

        doc = {
            "task_id": task_id,
            "user_id": str(user_id),
            "chat_id": chat_id,
            "source_url": f"torrent:{original_filename}",
            "torrent_path": torrent_path,
            "gdrive_id": None,
            "source_type": "torrent_file",
            "destination_path": clean_dest,
            "filename": meta.get("name") or original_filename,
            "filesize": meta.get("total_size", 0),
            "transferred_bytes": 0,
            "speed_bps": 0,
            "peer_count": 0,
            "progress": 0,
            "eta_seconds": 0,
            "status": "queued",
            "phase": "Queued",
            "error_message": None,
            "is_vault": is_vault,
            "created_at": now,
            "updated_at": now
        }
        coll.insert_one(doc)
        doc["_id"] = str(doc["_id"])
        return doc

    async def enqueue_telegram_to_gdrive(
        self,
        user_id: str,
        telegram_file_id: str,
        cloud_account_id: str,
        target_gdrive_folder_id: str,
        filename: str,
        filesize: int,
        post_action_delete: bool = False,
        group_id: Optional[str] = None,
        group_name: Optional[str] = None,
        group_total_items: Optional[int] = None,
        target_rel_subpath: Optional[str] = None
    ) -> Dict[str, Any]:
        coll = get_remote_db()["RemoteTransfers"]
        now = datetime.now(timezone.utc)
        task_id = f"rt_{secrets.token_hex(6)}"

        doc = {
            "task_id": task_id,
            "user_id": str(user_id),
            "chat_id": 0,
            "source_url": f"telegram://{telegram_file_id}",
            "source_type": "telegram_to_gdrive",
            "telegram_file_id": telegram_file_id,
            "cloud_account_id": cloud_account_id,
            "target_gdrive_folder_id": target_gdrive_folder_id,
            "target_rel_subpath": target_rel_subpath,
            "destination_path": f"Google Drive / {target_gdrive_folder_id}",
            "filename": filename,
            "filesize": filesize or 0,
            "transferred_bytes": 0,
            "speed_bps": 0,
            "progress": 0,
            "eta_seconds": 0,
            "status": "queued",
            "phase": "Queued for Google Drive Upload",
            "error_message": None,
            "post_action_delete": post_action_delete,
            "created_at": now,
            "updated_at": now
        }
        if group_id:
            doc["group_id"] = group_id
            doc["group_name"] = group_name
            doc["group_total_items"] = group_total_items

        coll.insert_one(doc)
        doc["_id"] = str(doc["_id"])
        return doc

    def enqueue_instagram(
        self,
        user_id: str,
        post: Dict[str, Any],
        source_url: str,
        destination: Dict[str, Any],
        chat_id: Optional[int] = None,
    ) -> List[Dict[str, Any]]:
        """One queued task per photo or video of an Instagram post.

        destination is {"kind": "home"|"vault", "path"} or {"kind": "gdrive", "account_id",
        "account_user_ids", "folder_id", "label"}. A carousel shares one group in Transfers.
        """
        from telestore.services.instagram_service import file_name_for

        coll = get_remote_db()["RemoteTransfers"]
        now = datetime.now(timezone.utc)
        items = post["items"]
        is_drive = destination["kind"] == "gdrive"
        group_id = f"grp_{secrets.token_hex(6)}" if len(items) > 1 else None
        caption = (post.get("caption") or "").strip()
        docs = []
        for item in items:
            doc = {
                "task_id": f"rt_{secrets.token_hex(6)}",
                "user_id": str(user_id),
                "chat_id": chat_id or 0,
                "source_url": source_url,
                "source_type": "instagram",
                "instagram_shortcode": post["shortcode"],
                "instagram_index": item["index"],
                "instagram_media_url": item["url"],
                "instagram_caption": caption,
                "filename": file_name_for(post.get("owner"), post["shortcode"], item, len(items)),
                "filesize": 0,
                "transferred_bytes": 0,
                "speed_bps": 0,
                "progress": 0,
                "eta_seconds": 0,
                "status": "queued",
                "phase": "Queued",
                "error_message": None,
                "created_at": now,
                "updated_at": now,
            }
            if is_drive:
                doc.update({
                    "cloud_account_id": destination["account_id"],
                    "cloud_account_user_ids": destination["account_user_ids"],
                    "target_gdrive_folder_id": destination["folder_id"],
                    "destination_path": destination.get("label") or "Google Drive",
                    "is_vault": False,
                })
            else:
                doc.update({"destination_path": destination["path"], "is_vault": destination["kind"] == "vault"})
            if group_id:
                doc.update({"group_id": group_id, "group_name": f"@{post.get('owner')} · {post['shortcode']}", "group_type": "instagram", "group_total_items": len(items)})
            coll.insert_one(doc)
            doc["_id"] = str(doc["_id"])
            docs.append(doc)
        return docs

    async def _execute_instagram(self, task_doc: dict, cancel_event: threading.Event):
        from telestore.services.instagram_service import InstagramError, get_client

        task_id = task_doc["task_id"]
        user_id = task_doc["user_id"]
        filename = task_doc.get("filename") or "instagram.bin"
        client = get_client()

        tg_dir = os.path.join(os.getcwd(), "tg_files", f"remote_{task_id}")
        os.makedirs(tg_dir, exist_ok=True)
        local_path = os.path.join(tg_dir, filename)

        last_report = [0.0]
        started = time.time()

        def on_progress(done: int, total: int):
            now_t = time.time()
            if now_t - last_report[0] < 0.8 and done != total:
                return
            last_report[0] = now_t
            speed = int(done / max(0.1, now_t - started))
            self._update_task(task_id, {
                "status": "downloading",
                "transferred_bytes": done,
                "filesize": total or done,
                "progress": min(90.0, round(done / total * 90, 1)) if total else 0,
                "speed_bps": speed,
                "eta_seconds": int((total - done) / speed) if speed and total > done else 0,
                "phase": "Downloading from Instagram",
            })

        try:
            self._update_task(task_id, {"status": "downloading", "phase": "Downloading from Instagram", "speed_bps": 0})
            try:
                size = await client.download(task_doc["instagram_media_url"], local_path, on_progress, cancel_event.is_set)
            except InstagramError:
                # Instagram's media links expire after a few hours (e.g. a retry the next day): read the post again
                post = await client.get_post(task_doc["instagram_shortcode"])
                fresh = next((it for it in post["items"] if it["index"] == task_doc.get("instagram_index")), None)
                if not fresh:
                    raise InstagramError("This photo or video is no longer in the post.")
                self._update_task(task_id, {"instagram_media_url": fresh["url"]})
                size = await client.download(fresh["url"], local_path, on_progress, cancel_event.is_set)

            if cancel_event.is_set():
                raise InterruptedError("Cancelled by user")

            if task_doc.get("cloud_account_id"):
                await self._save_file_to_drive(task_doc, local_path, size, cancel_event)
                where = "Google Drive"
            else:
                caption = f"{task_doc.get('instagram_caption') or filename}\n\n{task_doc.get('source_url') or ''}".strip()
                await self._save_file_to_telegram(task_doc, local_path, size, caption)
                where = "Private Vault" if task_doc.get("is_vault") else "TeleStore"

            self._update_task(task_id, {
                "status": "completed",
                "progress": 100.0,
                "speed_bps": 0,
                "eta_seconds": 0,
                "filesize": size,
                "transferred_bytes": size,
                "phase": f"Saved to {where}",
            })
            logger.info(f"[INSTAGRAM] {filename} ({size} bytes) saved to {where} for user {user_id}")
        finally:
            shutil.rmtree(tg_dir, ignore_errors=True)

    def enqueue_media(
        self,
        user_id: str,
        info: Dict[str, Any],
        entries: List[Dict[str, Any]],
        choice: Dict[str, Any],
        destination: Dict[str, Any],
        chat_id: Optional[int] = None,
    ) -> List[Dict[str, Any]]:
        """One queued task per video of a link read by yt-dlp (a playlist shares one group)."""
        coll = get_remote_db()["RemoteTransfers"]
        now = datetime.now(timezone.utc)
        job_id = f"media_{secrets.token_hex(6)}"
        group_id = f"grp_{secrets.token_hex(6)}" if info.get("kind") == "playlist" else None
        ext = "." + (choice.get("audio_format") or "mp3") if choice.get("mode") == "audio" else ".mp4"
        docs = []
        for entry in entries:
            doc = {
                "task_id": f"rt_{secrets.token_hex(6)}",
                "user_id": str(user_id),
                "chat_id": chat_id or 0,
                "source_url": entry["url"],
                "source_type": "media",
                "media_job_id": job_id,
                "media_choice": choice,
                "media_site": info.get("site"),
                # The real name is known once yt-dlp has the file
                "filename": re.sub(r'[\\/:*?"<>|]+', "_", entry.get("title") or "video")[:150] + ext,
                "filesize": 0,
                "transferred_bytes": 0,
                "speed_bps": 0,
                "progress": 0,
                "eta_seconds": 0,
                "status": "queued",
                "phase": "Queued",
                "error_message": None,
                "created_at": now,
                "updated_at": now,
            }
            if destination["kind"] == "gdrive":
                doc.update({
                    "cloud_account_id": destination["account_id"],
                    "cloud_account_user_ids": destination["account_user_ids"],
                    "target_gdrive_folder_id": destination["folder_id"],
                    "destination_path": destination.get("label") or "Google Drive",
                    "is_vault": False,
                })
            else:
                doc.update({"destination_path": destination["path"], "is_vault": destination["kind"] == "vault"})
            if group_id:
                doc.update({"group_id": group_id, "group_name": info.get("title") or "Playlist", "group_type": "media", "group_total_items": len(entries)})
            coll.insert_one(doc)
            doc["_id"] = str(doc["_id"])
            docs.append(doc)
        return docs

    async def _execute_media(self, task_doc: dict, cancel_event: threading.Event):
        from telestore.services import media_download_service as media

        task_id = task_doc["task_id"]
        tg_dir = os.path.join(os.getcwd(), "tg_files", f"remote_{task_id}")
        shutil.rmtree(tg_dir, ignore_errors=True)
        os.makedirs(tg_dir, exist_ok=True)

        free = shutil.disk_usage(tg_dir).free
        if free < 3 * 1024 ** 3:
            raise RuntimeError("The server is almost out of disk space. Try again after other downloads finish.")

        def on_progress(done: int, total: int, speed: int):
            self._update_task(task_id, {
                "status": "downloading",
                "transferred_bytes": done,
                "filesize": total or done,
                "progress": min(90.0, round(done / total * 90, 1)) if total else 0,
                "speed_bps": speed,
                "eta_seconds": int((total - done) / speed) if speed and total > done else 0,
                "phase": "Downloading",
            })

        try:
            # A short pause between the videos of a playlist, so the site doesn't see a burst
            wait = MEDIA_GAP_S - (time.time() - self._last_media_at)
            if wait > 0:
                self._update_task(task_id, {"status": "downloading", "phase": "Waiting a moment before the next video", "speed_bps": 0})
                await asyncio.sleep(wait)
            self._update_task(task_id, {"status": "downloading", "phase": "Reading the link", "speed_bps": 0})
            try:
                path, video_id = await media.download(task_doc["source_url"], task_doc.get("media_choice") or {}, tg_dir, on_progress, cancel_event.is_set)
            finally:
                self._last_media_at = time.time()
            if cancel_event.is_set():
                raise InterruptedError("Cancelled by user")
            size = os.path.getsize(path)
            file_name = self._media_file_name(task_doc, os.path.basename(path), video_id)
            self._update_task(task_id, {"filename": file_name, "filesize": size, "transferred_bytes": size})

            if task_doc.get("cloud_account_id"):
                await self._save_file_to_drive(task_doc, path, size, cancel_event, file_name)
                where = "Google Drive"
            else:
                await self._save_file_to_telegram(task_doc, path, size, f"{os.path.splitext(file_name)[0]}\n\n{task_doc['source_url']}", file_name)
                where = "Private Vault" if task_doc.get("is_vault") else "TeleStore"

            self._update_task(task_id, {
                "status": "completed",
                "progress": 100.0,
                "speed_bps": 0,
                "eta_seconds": 0,
                "phase": f"Saved to {where}",
            })
            logger.info(f"[MEDIA] {file_name} ({size} bytes) saved to {where} for user {task_doc['user_id']}")
        finally:
            shutil.rmtree(tg_dir, ignore_errors=True)

    def _media_file_name(self, task_doc: dict, name: str, video_id: Optional[str]) -> str:
        """The title as the name; the video ID is added only when that folder already has the name."""
        if task_doc.get("cloud_account_id") or not video_id:
            return name
        try:
            taken = database.Files.find_one({"file_name": name, "file_path": task_doc.get("destination_path") or "/Home", "owner_id": str(task_doc["user_id"])})
        except Exception:
            taken = None
        if not taken:
            return name
        stem, ext = os.path.splitext(name)
        return f"{stem} [{video_id}]{ext}"

    async def _save_file_to_telegram(self, task_doc: dict, local_path: str, size: int, caption: str, file_name: Optional[str] = None):
        """Uploads a finished local file to the user's index chat and adds it to their library.

        Files over Telegram's limit go up in 1.95 GB parts, cut one at a time so the disk only
        ever holds the file plus one part.
        """
        task_id = task_doc["task_id"]
        filename = file_name or task_doc.get("filename") or os.path.basename(local_path)
        destination_path = task_doc.get("destination_path") or "/Home"
        user_id = task_doc["user_id"]
        chat_id = task_doc["chat_id"]
        caption = caption[:1000]  # Telegram captions stop at 1024 characters
        file_type = get_file_type(filename)
        self._update_task(task_id, {"status": "uploading_tg", "phase": "Saving to Telegram", "progress": 92.0, "speed_bps": 0})

        bot_manager = self._bot_manager
        bot = bot_manager.get_least_busy_client() if bot_manager else None
        if not bot:
            raise RuntimeError("No Telegram bot is available right now. Try again in a minute.")

        part_max = TELEGRAM_PART_SIZE
        database.Files.create_folder_path(destination_path, owner_id=str(user_id))
        if size <= part_max:
            res = await upload_part_task(
                part_file_path=local_path, part_index=1, file_name=filename, start_byte=0, part_size=size,
                chat_id=chat_id, bot_manager=bot_manager, fallback_client=bot, caption=caption,
                semaphore=None, is_single_part=True, file_type=file_type,
            )
            database.Files.add_file(
                chat_id=chat_id, message_id=res["message_id"], thumbnail=res.get("thumbnail"), file_type=file_type,
                file_unique_id=res["file_unique_id"], file_size=size, file_name=filename, file_caption=caption,
                file_path=destination_path, owner_id=str(user_id), is_vault=bool(task_doc.get("is_vault")),
            )
            return

        total_parts = math.ceil(size / part_max)
        parts = []
        with open(local_path, "rb") as source:
            for index in range(1, total_parts + 1):
                start = (index - 1) * part_max
                part_path = f"{local_path}.part{index}"
                with open(part_path, "wb") as out:
                    remaining = min(part_max, size - start)
                    while remaining > 0:
                        chunk = source.read(min(8 * 1024 * 1024, remaining))
                        if not chunk:
                            break
                        out.write(chunk)
                        remaining -= len(chunk)
                part_size = os.path.getsize(part_path)
                self._update_task(task_id, {"phase": f"Saving to Telegram (part {index} of {total_parts})", "progress": round(92 + 7 * (index - 1) / total_parts, 1)})
                res = await upload_part_task(
                    part_file_path=part_path, part_index=index, file_name=filename, start_byte=start, part_size=part_size,
                    chat_id=chat_id, bot_manager=bot_manager, fallback_client=bot, caption=f"{filename} (Part {index})",
                    semaphore=None, is_single_part=False, file_type=file_type,
                )
                parts.append({
                    "part_index": index, "chat_id": chat_id, "message_id": res["message_id"], "file_unique_id": res["file_unique_id"],
                    "part_size": part_size, "start_byte": start, "end_byte": start + part_size, "thumbnail": res.get("thumbnail"),
                })
        database.Files.add_multipart_file(
            chat_id=chat_id, thumbnail=parts[0].get("thumbnail"), file_type=file_type, file_unique_id=parts[0]["file_unique_id"],
            file_size=size, file_name=filename, file_caption=caption, parts=parts, file_path=destination_path,
            owner_id=str(user_id), part_size=part_max, is_vault=bool(task_doc.get("is_vault")),
        )

    async def _save_file_to_drive(self, task_doc: dict, local_path: str, size: int, cancel_event: threading.Event, file_name: Optional[str] = None):
        import aiofiles
        from telestore.services.google_drive_manager import GoogleDriveManager

        task_id = task_doc["task_id"]
        self._update_task(task_id, {"status": "uploading_tg", "phase": "Saving to Google Drive", "progress": 92.0, "speed_bps": 0})
        account = database.CloudAccounts.get_account_raw(
            account_id=task_doc["cloud_account_id"],
            user_id=task_doc.get("cloud_account_user_ids") or task_doc["user_id"],
        )
        if not account:
            raise ValueError("That Google Drive account is no longer connected.")
        access_token = await GoogleDriveManager.get_valid_access_token(account)
        session_url = await GoogleDriveManager.initiate_resumable_upload(
            access_token=access_token,
            file_name=file_name or task_doc.get("filename") or os.path.basename(local_path),
            file_size=size,
            parent_id=task_doc.get("target_gdrive_folder_id") or "root",
        )

        async def read_file():
            async with aiofiles.open(local_path, "rb") as f:
                while chunk := await f.read(1024 * 1024):
                    yield chunk

        await GoogleDriveManager.upload_resumable_stream(
            upload_session_url=session_url,
            async_stream_gen=read_file(),
            total_size=size,
            cancel_event=cancel_event,
        )

    async def _ensure_gdrive_subfolders(self, access_token: str, base_folder_id: str, rel_path: str) -> str:
        from telestore.services.google_drive_manager import GoogleDriveManager
        segments = [s.strip() for s in rel_path.replace("\\", "/").split("/") if s.strip()]
        current_parent = "root" if base_folder_id in ("root", "my_drive", "google_drive", None) else base_folder_id

        for seg in segments:
            items = await GoogleDriveManager.list_folder(access_token, folder_id=current_parent, query=seg)
            existing = None
            for item in items.get("files", []):
                if item.get("name") == seg and item.get("is_folder"):
                    existing = item["id"]
                    break
            if existing:
                current_parent = existing
            else:
                created = await GoogleDriveManager.create_folder(access_token, parent_id=current_parent, folder_name=seg)
                current_parent = created["id"]
        return current_parent

    async def _execute_telegram_to_gdrive(self, task_doc: dict, cancel_event: threading.Event):
        task_id = task_doc["task_id"]
        user_id = task_doc["user_id"]
        telegram_file_id = task_doc.get("telegram_file_id")
        cloud_account_id = task_doc.get("cloud_account_id")
        target_fid = task_doc.get("target_gdrive_folder_id") or "root"
        filename = task_doc.get("filename", "file.bin")

        self._update_task(task_id, {
            "status": "uploading_tg",
            "phase": "Connecting to Telegram & Google Drive...",
            "speed_bps": 0
        })

        from bson import ObjectId
        from telestore.services.google_drive_manager import GoogleDriveManager
        from telestore.services.byte_streamer import ByteStreamer

        # 1. Fetch file record from database.Files
        file_doc = None
        if telegram_file_id:
            if ObjectId.is_valid(telegram_file_id):
                file_doc = database.Files.find_one({"_id": ObjectId(telegram_file_id)})
            if not file_doc:
                file_doc = database.Files.find_one({"file_unique_id": telegram_file_id})
        if not file_doc:
            raise ValueError(f"Telegram file not found for ID: {telegram_file_id}")

        file_name = file_doc.get("file_name", filename)
        file_size = int(file_doc.get("file_size", 0))

        # 2. Get Google Drive account and access token
        account = database.CloudAccounts.get_account_raw(account_id=cloud_account_id, user_id=user_id)
        if not account:
            raise ValueError(f"Google Drive account '{cloud_account_id}' not found.")
        access_token = await GoogleDriveManager.get_valid_access_token(account)

        # 3. If relative subfolders need to be created in Google Drive
        rel_subpath = task_doc.get("target_rel_subpath")
        effective_parent = target_fid
        if rel_subpath:
            effective_parent = await self._ensure_gdrive_subfolders(access_token, target_fid, rel_subpath)

        # 4. Initiate Resumable Upload on Google Drive
        self._update_task(task_id, {
            "filesize": file_size,
            "phase": "Initiating Google Drive upload session..."
        })
        upload_session_url = await GoogleDriveManager.initiate_resumable_upload(
            access_token=access_token,
            file_name=file_name,
            file_size=file_size,
            parent_id=effective_parent
        )

        # 5. Acquire bot client and prepare parts
        bot_manager = self._bot_manager
        client = None
        for _ in range(30):
            if cancel_event.is_set():
                raise InterruptedError("Cancelled by user")
            client = bot_manager.get_least_busy_client() if bot_manager else None
            if client:
                break
            await asyncio.sleep(1)

        if not client:
            raise RuntimeError("No Telegram bot client available for streaming.")

        parts_to_stream = []
        if file_doc.get("parts") and len(file_doc["parts"]) > 0:
            for p in file_doc["parts"]:
                parts_to_stream.append({
                    "chat_id": p["chat_id"],
                    "message_id": p["message_id"],
                    "part_from_byte": 0,
                    "part_until_byte": p["part_size"] - 1,
                    "part_index": p["part_index"]
                })
        else:
            parts_to_stream.append({
                "chat_id": file_doc["chat_id"],
                "message_id": file_doc["message_id"],
                "part_from_byte": 0,
                "part_until_byte": file_size - 1 if file_size > 0 else 0,
                "part_index": 1
            })

        tg_streamer = ByteStreamer(client)
        clients_pool = bot_manager.clients if bot_manager else [client]
        async_stream_gen = tg_streamer.yield_parts(
            parts_to_stream=parts_to_stream,
            chunk_size=1024 * 1024,
            client_list=clients_pool
        )

        # 6. Stream directly from Telegram into Google Drive Resumable Upload
        last_progress_time = [time.time()]
        last_bytes = [0]

        async def progress_cb(cur_transferred: int, total_sz: Optional[int]):
            if cancel_event.is_set():
                raise InterruptedError("Cancelled by user")
            now_t = time.time()
            dt = now_t - last_progress_time[0]
            if dt >= 0.8 or (total_sz and cur_transferred >= total_sz):
                speed = int((cur_transferred - last_bytes[0]) / max(0.1, dt))
                last_progress_time[0] = now_t
                last_bytes[0] = cur_transferred
                pct = round((cur_transferred / total_sz) * 100, 1) if total_sz and total_sz > 0 else 0
                rem_bytes = max(0, total_sz - cur_transferred) if total_sz else 0
                eta = int(rem_bytes / max(1, speed)) if speed > 0 and total_sz else 0
                self._update_task(task_id, {
                    "transferred_bytes": cur_transferred,
                    "speed_bps": speed,
                    "progress": pct,
                    "eta_seconds": eta,
                    "phase": f"Streaming to Google Drive ({pct}%)"
                })

        upload_result = await GoogleDriveManager.upload_resumable_stream(
            upload_session_url=upload_session_url,
            async_stream_gen=async_stream_gen,
            total_size=file_size,
            progress_callback=progress_cb,
            cancel_event=cancel_event
        )

        self._update_task(task_id, {
            "status": "completed",
            "speed_bps": 0,
            "eta_seconds": 0,
            "filesize": file_size,
            "transferred_bytes": file_size,
            "phase": "Completed & Saved to Google Drive ☁️"
        })
        logger.info(f"[TELEGRAM_TO_GDRIVE] File '{file_name}' ({file_size} bytes) successfully uploaded to Google Drive ID: {upload_result.get('id')}")

        if task_doc.get("post_action_delete"):
            try:
                database.Files.delete_file(str(file_doc["_id"]), owner_id=str(user_id))
                logger.info(f"[TELEGRAM_TO_GDRIVE] Purged source Telegram file {file_doc['_id']} after cut.")
            except Exception as del_err:
                logger.warning(f"[TELEGRAM_TO_GDRIVE] Failed to delete source Telegram file: {del_err}")

    async def _execute_task_wrapper(self, task_doc: dict):
        task_id = task_doc["task_id"]
        cancel_event = threading.Event()
        self.cancel_events[task_id] = cancel_event

        async with self.semaphore:
            try:
                await self._run_download_and_upload(task_doc, cancel_event)
            except asyncio.CancelledError:
                logger.info(f"Task {task_id} cancelled.")
                self._update_task(task_id, {"status": "cancelled", "phase": "Cancelled by user", "speed_bps": 0})
            except Exception as e:
                err_text = str(e)
                if self._pause_blocked_media(task_doc, e):
                    return
                if is_gdrive_quota_error(e):
                    logger.warning(f"Google Drive quota exceeded for task {task_id}: {err_text}")
                    cooldown_until = datetime.now(timezone.utc) + timedelta(hours=24)
                    coll = get_remote_db()["RemoteTransfers"]
                    group_id = task_doc.get("group_id")
                    target_query = {"user_id": str(task_doc["user_id"]), "status": {"$in": ["queued", "downloading"]}}
                    if group_id:
                        target_query["group_id"] = group_id
                    else:
                        target_query["task_id"] = task_id

                    coll.update_many(
                        target_query,
                        {
                            "$set": {
                                "status": "paused_quota",
                                "cooldown_until": cooldown_until,
                                "phase": "Google Drive quota exceeded. Auto-resumes in 24h 🕒",
                                "error_message": "Google Drive 24h download limit reached. Transfer will automatically resume when quota resets.",
                                "speed_bps": 0,
                                "updated_at": datetime.now(timezone.utc)
                            },
                            "$unset": {"claimed_by": "", "claimed_at": ""}
                        }
                    )
                    return

                logger.error(f"Task {task_id} failed: {e}", exc_info=True)
                if "Cannot retrieve the public link" in err_text or "Check FAQ" in err_text:
                    err_text = "Google Drive file is not accessible (it may be deleted, moved to trash, or restricted by the owner)."
                phase_err = "Failed: " + (err_text[:50] + "..." if len(err_text) > 50 else err_text)
                self._update_task(task_id, {"status": "failed", "error_message": err_text, "phase": phase_err, "speed_bps": 0})
            finally:
                self.active_tasks.pop(task_id, None)
                self.cancel_events.pop(task_id, None)

    def _pause_blocked_media(self, task_doc: dict, error: Exception) -> bool:
        """When YouTube blocks the server, this video and the rest of its playlist wait and retry later.

        Returns False (the task simply fails) once a video has been retried MEDIA_BLOCK_RETRIES times.
        """
        from telestore.services.media_download_service import MediaBlocked
        if not isinstance(error, MediaBlocked):
            return False
        retries = int(task_doc.get("block_retries") or 0)
        if retries >= MEDIA_BLOCK_RETRIES:
            return False
        now = datetime.now(timezone.utc)
        until = now + MEDIA_BLOCK_COOLDOWN
        target = {"user_id": str(task_doc["user_id"]), "source_type": "media", "status": {"$in": ["queued", "downloading"]}}
        if task_doc.get("group_id"):
            target["group_id"] = task_doc["group_id"]
        else:
            target["task_id"] = task_doc["task_id"]
        coll = get_remote_db()["RemoteTransfers"]
        update = {
            "$set": {
                "status": "paused_quota",
                "cooldown_until": until,
                "phase": f"YouTube is blocking the server for now. Tries again at {until.strftime('%H:%M')} UTC",
                "error_message": str(error),
                "speed_bps": 0,
                "updated_at": now,
            },
            "$unset": {"claimed_by": "", "claimed_at": ""},
        }
        coll.update_many(target, update)
        coll.update_one({"task_id": task_doc["task_id"]}, {**update, "$inc": {"block_retries": 1}})
        logger.warning(f"[MEDIA] YouTube blocked task {task_doc['task_id']}; paused until {until.isoformat()} (retry {retries + 1})")
        return True

    async def _run_range_part_transfer(self, task_doc: dict, cancel_event: threading.Event):
        task_id = task_doc["task_id"]
        source_url = task_doc["source_url"]
        chat_id = task_doc["chat_id"]
        filename = task_doc.get("filename") or "download.bin"
        range_start = task_doc["range_start"]
        range_end = task_doc["range_end"]
        part_index = task_doc["part_index"]
        total_parts = task_doc["total_parts"]
        part_size = task_doc["part_size"]
        group_id = task_doc.get("group_id")

        tg_dir = os.path.join(os.getcwd(), "tg_files", f"remote_{task_id}")
        os.makedirs(tg_dir, exist_ok=True)
        part_file_path = os.path.join(tg_dir, f"{filename}.part{part_index}")

        # Wait for available Telegram bot client
        bot_manager = self._bot_manager
        client = None
        for _ in range(30):
            if cancel_event.is_set():
                raise InterruptedError("Cancelled by user")
            client = bot_manager.get_least_busy_client() if bot_manager else None
            if client:
                break
            await asyncio.sleep(1)

        if not client:
            raise RuntimeError("No Telegram bot client available for upload.")

        self._update_task(task_id, {
            "status": "downloading",
            "phase": f"[master-vm1] Connecting to source for Part {part_index}/{total_parts}...",
            "speed_bps": 0
        })

        def _download_chunk():
            req_headers = {
                "User-Agent": MODERN_USER_AGENT,
                "Range": f"bytes={range_start}-{range_end}"
            }
            if task_doc.get("custom_headers"):
                req_headers.update(task_doc["custom_headers"])

            with requests.get(source_url, stream=True, timeout=60, headers=req_headers) as resp:
                if resp.status_code not in [200, 206]:
                    resp.raise_for_status()

                transferred = 0
                start_time = time.time()
                last_rep = start_time

                with open(part_file_path, "wb") as pf:
                    for chunk in resp.iter_content(chunk_size=2 * 1024 * 1024):
                        if cancel_event.is_set():
                            raise InterruptedError("Cancelled by user")

                        if priority_manager.is_user_upload_active():
                            self._update_task(task_id, {
                                "status": "paused",
                                "phase": "Paused: Prioritizing User Upload 👤",
                                "speed_bps": 0
                            })
                            while priority_manager.is_user_upload_active() and not cancel_event.is_set():
                                priority_manager.wait_if_user_upload_active(timeout=1.0)
                            self._update_task(task_id, {
                                "status": "downloading",
                                "phase": f"[master-vm1] Resumed Part {part_index}/{total_parts} ▶️"
                            })

                        if chunk:
                            pf.write(chunk)
                            transferred += len(chunk)
                            now = time.time()
                            if now - last_rep >= 1.0:
                                last_rep = now
                                dt = max(0.1, now - start_time)
                                speed = int(transferred / dt)
                                prog = min(99.0, round((transferred / part_size) * 100, 1)) if part_size > 0 else 0
                                eta = int((part_size - transferred) / speed) if (speed > 0 and part_size > transferred) else 0
                                self._update_task(task_id, {
                                    "transferred_bytes": transferred,
                                    "filesize": part_size,
                                    "progress": prog,
                                    "speed_bps": speed,
                                    "eta_seconds": eta,
                                    "phase": f"[master-vm1] Leeching Part {part_index}/{total_parts} @ {speed/1024/1024:.1f} MB/s ({prog}%)"
                                })

                return transferred

        downloaded_bytes = await asyncio.to_thread(_download_chunk)

        if cancel_event.is_set():
            raise InterruptedError("Cancelled by user")

        self._update_task(task_id, {
            "status": "uploading_tg",
            "phase": f"[master-vm1] Uploading Part {part_index}/{total_parts} to Telegram Cloud ☁️",
            "progress": 99.0
        })

        caption = f"{filename} (Part {part_index})"
        ftype = get_file_type(filename)

        res = await upload_part_task(
            part_file_path=part_file_path,
            part_index=part_index,
            file_name=filename,
            start_byte=range_start,
            part_size=downloaded_bytes,
            chat_id=chat_id,
            bot_manager=bot_manager,
            fallback_client=client,
            caption=caption,
            semaphore=None,
            is_single_part=False,
            file_type=ftype,
            progress=None
        )

        try:
            shutil.rmtree(tg_dir, ignore_errors=True)
        except Exception:
            pass

        part_info = {
            "part_index": part_index,
            "chat_id": chat_id,
            "message_id": res["message_id"],
            "file_unique_id": res["file_unique_id"],
            "part_size": downloaded_bytes,
            "start_byte": range_start,
            "end_byte": range_start + downloaded_bytes,
            "thumbnail": res.get("thumbnail")
        }

        coll = get_remote_db()["RemoteTransfers"]
        now = datetime.now(timezone.utc)
        coll.update_one(
            {"task_id": task_id},
            {
                "$set": {
                    "status": "completed",
                    "progress": 100.0,
                    "transferred_bytes": downloaded_bytes,
                    "filesize": part_size,
                    "speed_bps": 0,
                    "eta_seconds": 0,
                    "completed_part_info": part_info,
                    "phase": f"Part {part_index}/{total_parts} completed via master-vm1 🎉",
                    "updated_at": now
                }
            }
        )
        event_service.task_finished(task_id)

        logger.info(f"[MULTI_RANGE] Part {part_index}/{total_parts} for '{filename}' completed locally on master-vm1")
        if group_id:
            await finalize_multipart_group_if_ready(group_id, task_doc)

    async def _refresh_drive_sign_in(self, task_doc: dict) -> None:
        """Puts a fresh Google access token in this task's request headers (in memory only)."""
        account_id = task_doc.get("cloud_account_id")
        if not account_id or task_doc.get("source_type") == "telegram_to_gdrive":
            return
        from telestore.services.google_drive_manager import GoogleDriveManager
        # The task was queued by this account's owner (checked when it was queued)
        account = database.CloudAccounts.get_account_raw(account_id=account_id)
        if not account:
            raise ValueError("The Google Drive account this copy came from isn't connected any more.")
        token = await GoogleDriveManager.get_valid_access_token(account)
        task_doc["custom_headers"] = {**(task_doc.get("custom_headers") or {}), "Authorization": f"Bearer {token}"}

    async def _run_download_and_upload(self, task_doc: dict, cancel_event: threading.Event):
        if task_doc.get("source_type") == "telegram_to_gdrive":
            await self._execute_telegram_to_gdrive(task_doc, cancel_event)
            return

        if task_doc.get("source_type") == "instagram":
            await self._execute_instagram(task_doc, cancel_event)
            return

        if task_doc.get("source_type") == "media":
            await self._execute_media(task_doc, cancel_event)
            return

        # A copy from a connected Google Drive: sign in again now (a saved token lasts about an hour)
        await self._refresh_drive_sign_in(task_doc)

        if task_doc.get("is_range_part"):
            await self._run_range_part_transfer(task_doc, cancel_event)
            return

        task_id = task_doc["task_id"]
        source_url = task_doc["source_url"]
        gdrive_id = task_doc.get("gdrive_id")
        destination_path = task_doc.get("destination_path", "/Home")
        user_id = task_doc["user_id"]
        chat_id = task_doc["chat_id"]
        is_vault = bool(task_doc.get("is_vault", False))

        tg_dir = os.path.join(os.getcwd(), "tg_files", f"remote_{task_id}")
        os.makedirs(tg_dir, exist_ok=True)

        PART_MAX_SIZE = 1950 * 1024 * 1024  # 1.95 GB Part standard

        self._update_task(task_id, {
            "status": "downloading",
            "phase": "Connecting to source...",
            "speed_bps": 0
        })

        # Wait for available Telegram bot client
        bot_manager = self._bot_manager
        client = None
        for _ in range(30):
            if cancel_event.is_set():
                raise InterruptedError("Cancelled by user")
            client = bot_manager.get_least_busy_client() if bot_manager else None
            if client:
                break
            await asyncio.sleep(1)

        if not client:
            raise RuntimeError("No Telegram bot client available for upload.")

        loop = asyncio.get_running_loop()
        upload_tasks = []
        uploaded_bytes_map = {}
        filename_holder = [task_doc.get("filename") or "download.bin"]
        estimated_total = [task_doc.get("filesize", 0)]
        last_progress_time = [time.time()]
        last_dl = [0]
        last_up = [0]
        disk_semaphore = threading.Semaphore(2)  # Cap VM disk buffer to max 2 parts (~3.9GB)

        def get_file_type(fname: str) -> str:
            ext = os.path.splitext(fname)[1].lower()
            if ext in ['.mp4', '.mkv', '.avi', '.mov', '.webm']:
                return "video"
            elif ext in ['.mp3', '.wav', '.ogg', '.flac', '.m4a', '.opus', '.aac']:
                return "audio"
            elif ext in ['.jpg', '.jpeg', '.png', '.gif', '.webp']:
                return "photo"
            return "document"

        def report_combined_progress(cur_dl: int, cur_up: int, total_sz: int):
            if cancel_event.is_set():
                raise InterruptedError("Cancelled by user")

            now_t = time.time()
            dt = now_t - last_progress_time[0]
            if dt >= 0.8 or (total_sz and (cur_dl >= total_sz or cur_up >= total_sz)):
                dl_speed = max(0, (cur_dl - last_dl[0]) / dt) if dt > 0 else 0
                up_speed = max(0, (cur_up - last_up[0]) / dt) if dt > 0 else 0
                last_progress_time[0] = now_t
                last_dl[0] = cur_dl
                last_up[0] = cur_up

                if total_sz and total_sz > 0:
                    dl_pct = (cur_dl / total_sz) * 50.0
                    up_pct = (cur_up / total_sz) * 50.0
                    overall_progress = min(99.5, round(dl_pct + up_pct, 1))
                    active_speed = max(dl_speed, up_speed)
                    eta = int((total_sz - cur_up) / active_speed) if (active_speed > 0 and cur_up < total_sz) else 0

                    if cur_dl < total_sz:
                        phase = f"Streaming Part {writer.current_part_index}: DL {dl_speed/1024/1024:.1f}MB/s | UP {up_speed/1024/1024:.1f}MB/s ({overall_progress}%)"
                    else:
                        phase = f"Uploading to Telegram Cloud ({round((cur_up / total_sz) * 100, 1)}%)"
                else:
                    overall_progress = 0
                    active_speed = max(dl_speed, up_speed)
                    eta = 0
                    phase = f"Streaming: DL {cur_dl/1024/1024:.1f}MB | UP {cur_up/1024/1024:.1f}MB"

                self._update_task(task_id, {
                    "filename": filename_holder[0],
                    "transferred_bytes": cur_up,
                    "filesize": total_sz or cur_dl,
                    "progress": overall_progress,
                    "speed_bps": active_speed,
                    "eta_seconds": eta,
                    "phase": phase,
                    "status": "uploading_tg" if cur_dl >= (total_sz or 1) else "downloading"
                })

        def make_part_progress(p_num: int):
            def _cb(cur: int, tot: int):
                uploaded_bytes_map[p_num] = cur
                tot_up = sum(uploaded_bytes_map.values())
                report_combined_progress(writer.total_bytes, tot_up, estimated_total[0])
            return _cb

        def on_part_ready(part_path: str, p_idx: int, s_byte: int, p_sz: int, is_final: bool, is_single_part: bool):
            ftype = get_file_type(filename_holder[0])
            caption = f"Uploaded file: {filename_holder[0]}" if is_single_part else f"{filename_holder[0]} (Part {p_idx})"

            coro = upload_part_task(
                part_file_path=part_path,
                part_index=p_idx,
                file_name=filename_holder[0],
                start_byte=s_byte,
                part_size=p_sz,
                chat_id=chat_id,
                bot_manager=bot_manager,
                fallback_client=client,
                caption=caption,
                semaphore=disk_semaphore,
                is_single_part=is_single_part,
                file_type=ftype,
                progress=make_part_progress(p_idx)
            )

            # Thread-safe dispatch onto event loop
            if threading.current_thread() is threading.main_thread():
                task = loop.create_task(coro)
            else:
                fut = asyncio.run_coroutine_threadsafe(coro, loop)
                task = asyncio.wrap_future(fut, loop=loop)
            upload_tasks.append(task)

        def on_pause_state_changed(is_paused: bool):
            if is_paused:
                self._update_task(task_id, {
                    "status": "paused",
                    "phase": "Paused: Prioritizing User Upload 👤 (Will auto-resume)",
                    "speed_bps": 0
                })
            else:
                self._update_task(task_id, {
                    "status": "downloading",
                    "phase": f"Resumed: Streaming Part {writer.current_part_index} ▶️",
                    "speed_bps": 0
                })

        # Create Producer-Consumer Pipelined Stream Writer
        writer = PipelinedStreamWriter(
            tg_dir=tg_dir,
            semaphore=disk_semaphore,
            cancel_event=cancel_event,
            on_part_ready=on_part_ready,
            on_pause_state_changed=on_pause_state_changed
        )

        try:
            # --- STEP 1: Stream Data from Source into Writer or BitTorrent Engine ---
            if task_doc.get("source_type") in ["magnet", "torrent_file"]:
                logger.info(f"[REMOTE_TRANSFER] Task {task_id}: Processing BitTorrent/Magnet leech transfer...")

                # Step 1: Obtain .torrent file
                if task_doc.get("source_type") == "magnet":
                    self._update_task(task_id, {
                        "status": "downloading",
                        "phase": "Connecting to swarm & resolving magnet metadata...",
                        "speed_bps": 0
                    })
                    meta_dir = os.path.join(tg_dir, "meta")

                    def _on_meta_prog(msg: str):
                        self._update_task(task_id, {"phase": msg})

                    torrent_file_path = await asyncio.to_thread(
                        torrent_manager.resolve_magnet_metadata,
                        source_url,
                        meta_dir,
                        cancel_event,
                        _on_meta_prog,
                        180
                    )
                else:
                    torrent_file_path = task_doc.get("torrent_path")
                    if not torrent_file_path or not os.path.exists(torrent_file_path):
                        raise FileNotFoundError("Torrent file not found on server.")

                with open(torrent_file_path, "rb") as tf:
                    t_bytes = tf.read()
                meta = parse_torrent_bytes(t_bytes)

                root_name = meta["name"]
                is_multi_file = meta["is_multi_file"]
                files = meta["files"]
                total_torrent_size = meta["total_size"]
                total_files = len(files)

                self._update_task(task_id, {
                    "filename": root_name,
                    "filesize": total_torrent_size,
                    "phase": f"Found {total_files} file(s) in torrent ({round(total_torrent_size / (1024*1024), 1)} MB)"
                })

                completed_bytes = 0
                dl_work_dir = os.path.join(tg_dir, "dl")
                os.makedirs(dl_work_dir, exist_ok=True)

                for file_idx, f_item in enumerate(files, start=1):
                    if cancel_event.is_set():
                        raise InterruptedError("Cancelled by user")

                    f_name = f_item["name"]
                    f_size = f_item["size"]
                    f_rel_path = f_item["rel_path"]
                    f_full_rel_path = f_item["full_rel_path"]

                    # Compute target destination folder preserving nested directory tree
                    if is_multi_file:
                        sub_dir = os.path.dirname(f_rel_path).replace("\\", "/").strip("/")
                        target_folder = f"{destination_path}/{root_name}/{sub_dir}".rstrip("/") if sub_dir else f"{destination_path}/{root_name}"
                    else:
                        target_folder = destination_path

                    database.Files.create_folder_path(target_folder, owner_id=str(user_id))

                    if f_size == 0:
                        # Handle 0-byte file without downloading
                        empty_path = os.path.join(dl_work_dir, f_name)
                        with open(empty_path, "wb"):
                            pass
                        res = await upload_part_task(
                            part_file_path=empty_path,
                            part_index=1,
                            file_name=f_name,
                            start_byte=0,
                            part_size=0,
                            chat_id=chat_id,
                            bot_manager=bot_manager,
                            fallback_client=client,
                            is_single_part=True,
                            file_type="document"
                        )
                        database.Files.add_file(
                            chat_id=chat_id,
                            message_id=res["message_id"],
                            thumbnail=res.get("thumbnail"),
                            file_type="document",
                            file_unique_id=res["file_unique_id"],
                            file_size=0,
                            file_name=f_name,
                            file_caption=f"Uploaded file: {f_name}",
                            file_path=target_folder,
                            owner_id=str(user_id),
                            is_vault=is_vault
                        )
                        continue

                    # Callbacks for aria2c download
                    def _aria_progress(p_info: dict):
                        if cancel_event.is_set():
                            raise InterruptedError("Cancelled by user")
                        pct = p_info["progress"]
                        speed = p_info["speed_bps"]
                        peers = p_info["peers"]
                        cur_f_dl = int((pct / 100.0) * f_size)
                        cur_total_transferred = completed_bytes + int(cur_f_dl * 0.5)
                        total_pct = min(99.0, round((cur_total_transferred / (total_torrent_size or 1)) * 100, 1))

                        self._update_task(task_id, {
                            "status": "downloading",
                            "progress": total_pct,
                            "speed_bps": speed,
                            "peer_count": peers,
                            "transferred_bytes": cur_total_transferred,
                            "phase": f"Leeching [{file_idx}/{total_files}] {f_name} ({pct:.1f}%) | ⚡ {peers} peers"
                        })

                    def _aria_pause(is_p: bool):
                        if is_p:
                            self._update_task(task_id, {
                                "status": "paused",
                                "phase": "Paused: Prioritizing User Upload 👤 (Will auto-resume)",
                                "speed_bps": 0
                            })
                        else:
                            self._update_task(task_id, {
                                "status": "downloading",
                                "phase": f"Resumed: Leeching [{file_idx}/{total_files}] {f_name} ▶️",
                                "speed_bps": 0
                            })

                    logger.info(f"[REMOTE_TRANSFER] Task {task_id}: Leeching file {file_idx}/{total_files}: {f_name} ({f_size} bytes)")
                    await asyncio.to_thread(
                        torrent_manager.download_file_selective,
                        torrent_file_path,
                        f_item["index"],
                        dl_work_dir,
                        cancel_event,
                        _aria_progress,
                        _aria_pause
                    )

                    if cancel_event.is_set():
                        raise InterruptedError("Cancelled by user")

                    # Locate downloaded file
                    downloaded_file = os.path.join(dl_work_dir, f_full_rel_path)
                    if not os.path.exists(downloaded_file):
                        found = False
                        for root, _, files_in_dir in os.walk(dl_work_dir):
                            if f_name in files_in_dir:
                                downloaded_file = os.path.join(root, f_name)
                                found = True
                                break
                        if not found:
                            raise FileNotFoundError(f"Downloaded file '{f_name}' not found at {downloaded_file}")

                    actual_size = os.path.getsize(downloaded_file)
                    ftype = get_file_type(f_name)

                    if actual_size <= PART_MAX_SIZE:
                        # Single-part upload
                        self._update_task(task_id, {
                            "status": "uploading_tg",
                            "phase": f"Uploading [{file_idx}/{total_files}] {f_name} to Telegram..."
                        })

                        def _part_up_prog(cur: int, tot: int):
                            cur_up = completed_bytes + int(f_size * 0.5) + int(cur * 0.5)
                            total_pct = min(99.5, round((cur_up / (total_torrent_size or 1)) * 100, 1))
                            self._update_task(task_id, {
                                "progress": total_pct,
                                "transferred_bytes": cur_up,
                                "phase": f"Uploading [{file_idx}/{total_files}] {f_name} ({round((cur/tot)*100, 1)}%)"
                            })

                        res = await upload_part_task(
                            part_file_path=downloaded_file,
                            part_index=1,
                            file_name=f_name,
                            start_byte=0,
                            part_size=actual_size,
                            chat_id=chat_id,
                            bot_manager=bot_manager,
                            fallback_client=client,
                            caption=f"Uploaded file: {f_name}",
                            is_single_part=True,
                            file_type=ftype,
                            progress=_part_up_prog
                        )

                        database.Files.add_file(
                            chat_id=chat_id,
                            message_id=res["message_id"],
                            thumbnail=res.get("thumbnail"),
                            file_type=ftype,
                            file_unique_id=res["file_unique_id"],
                            file_size=actual_size,
                            file_name=f_name,
                            file_caption=f"Uploaded file: {f_name}",
                            file_path=target_folder,
                            owner_id=str(user_id),
                            is_vault=is_vault
                        )
                    else:
                        # Multi-part chunked upload for > 1.95 GB file
                        logger.info(f"[REMOTE_TRANSFER] Task {task_id}: Chunking large file {f_name} ({actual_size} bytes)")
                        self._update_task(task_id, {
                            "status": "uploading_tg",
                            "phase": f"Chunking & Uploading [{file_idx}/{total_files}] {f_name}..."
                        })

                        mp_upload_tasks = []
                        mp_bytes_map = {}
                        mp_disk_sem = threading.Semaphore(2)

                        def _on_mp_part_ready(part_path, p_idx, s_byte, p_sz, is_fin, is_single):
                            caption = f"{f_name} (Part {p_idx})"
                            def _mp_prog(cur, tot):
                                mp_bytes_map[p_idx] = cur
                                tot_up = sum(mp_bytes_map.values())
                                cur_up = completed_bytes + int(f_size * 0.5) + int(tot_up * 0.5)
                                total_pct = min(99.5, round((cur_up / (total_torrent_size or 1)) * 100, 1))
                                self._update_task(task_id, {
                                    "progress": total_pct,
                                    "transferred_bytes": cur_up,
                                    "phase": f"Uploading [{file_idx}/{total_files}] {f_name} Part {p_idx} ({round((tot_up/actual_size)*100, 1)}%)"
                                })

                            coro = upload_part_task(
                                part_file_path=part_path,
                                part_index=p_idx,
                                file_name=f_name,
                                start_byte=s_byte,
                                part_size=p_sz,
                                chat_id=chat_id,
                                bot_manager=bot_manager,
                                fallback_client=client,
                                caption=caption,
                                semaphore=mp_disk_sem,
                                is_single_part=False,
                                file_type=ftype,
                                progress=_mp_prog
                            )
                            t = loop.create_task(coro)
                            mp_upload_tasks.append(t)

                        mp_writer = PipelinedStreamWriter(
                            tg_dir=tg_dir,
                            semaphore=mp_disk_sem,
                            cancel_event=cancel_event,
                            on_part_ready=_on_mp_part_ready,
                            on_pause_state_changed=on_pause_state_changed
                        )

                        with open(downloaded_file, "rb") as rf:
                            while True:
                                if cancel_event.is_set():
                                    raise InterruptedError("Cancelled by user")
                                chunk = rf.read(2 * 1024 * 1024)
                                if not chunk:
                                    break
                                mp_writer.write(chunk)
                        mp_writer.finish()

                        mp_results = await asyncio.gather(*mp_upload_tasks)
                        mp_results.sort(key=lambda x: x["part_index"])

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
                            for r in mp_results
                        ]

                        database.Files.add_multipart_file(
                            chat_id=chat_id,
                            thumbnail=mp_results[0].get("thumbnail"),
                            file_type=ftype,
                            file_unique_id=mp_results[0]["file_unique_id"],
                            file_size=actual_size,
                            file_name=f_name,
                            file_caption=f"Uploaded multi-part file: {f_name}",
                            parts=parts,
                            file_path=target_folder,
                            owner_id=str(user_id),
                            part_size=PART_MAX_SIZE,
                            is_vault=is_vault
                        )

                    # Immediately clean up downloaded file
                    if os.path.exists(downloaded_file):
                        try:
                            os.remove(downloaded_file)
                        except Exception as e:
                            logger.warning(f"Could not remove {downloaded_file}: {e}")

                    # Remove any .aria2 files and empty dirs in dl_work_dir
                    for root, dirs, d_files in os.walk(dl_work_dir, topdown=False):
                        for df in d_files:
                            if df.endswith(".aria2"):
                                try:
                                    os.remove(os.path.join(root, df))
                                except Exception:
                                    pass
                        for d in dirs:
                            dir_to_check = os.path.join(root, d)
                            try:
                                if not os.listdir(dir_to_check):
                                    os.rmdir(dir_to_check)
                            except Exception:
                                pass

                    completed_bytes += f_size

                # Clean temp directory
                shutil.rmtree(tg_dir, ignore_errors=True)

                self._update_task(task_id, {
                    "status": "completed",
                    "progress": 100.0,
                    "speed_bps": 0,
                    "eta_seconds": 0,
                    "filesize": total_torrent_size,
                    "transferred_bytes": total_torrent_size,
                    "phase": f"Completed ({total_files} file(s) saved to Telegram) ☁️"
                })
                logger.info(f"[REMOTE_TRANSFER] Task {task_id}: BitTorrent transfer finished successfully!")
                return

            elif task_doc.get("source_type") == "gdrive_file":
                import gdown

                # First resolve metadata if filename is generic
                if not task_doc.get("filename") or task_doc["filename"] == "Resolving...":
                    try:
                        def _resolve():
                            return gdown.download(
                                id=gdrive_id,
                                url=source_url if not gdrive_id else None,
                                skip_download=True,
                                quiet=True,
                                user_agent=MODERN_USER_AGENT
                            )
                        resolved = await asyncio.to_thread(_resolve)
                        if resolved and getattr(resolved, 'path', None):
                            filename_holder[0] = os.path.basename(resolved.path)
                    except Exception as e:
                        logger.warning(f"Could not pre-resolve GDrive filename: {e}")

                def _gdown_progress(cur, tot):
                    if tot:
                        estimated_total[0] = tot
                    tot_up = sum(uploaded_bytes_map.values())
                    report_combined_progress(cur, tot_up, estimated_total[0])

                def _do_gdown():
                    if priority_manager.is_user_upload_active():
                        on_pause_state_changed(True)
                        while priority_manager.is_user_upload_active() and not cancel_event.is_set():
                            priority_manager.wait_if_user_upload_active(timeout=1.0)
                        on_pause_state_changed(False)

                    try:
                        return gdown.download(
                            id=gdrive_id,
                            url=source_url if not gdrive_id else None,
                            output=writer,
                            quiet=True,
                            progress=_gdown_progress,
                            cancel=cancel_event,
                            user_agent=MODERN_USER_AGENT
                        )
                    except Exception as gerr:
                        err_str = str(gerr)
                        if is_gdrive_quota_error(gerr):
                            raise GoogleDriveQuotaExceededError(err_str)
                        logger.warning(f"gdown encountered: {err_str}. Attempting direct HTTP fallback for {gdrive_id}...")
                        import requests
                        import urllib.parse
                        import re

                        session = requests.Session()
                        session.headers.update({"User-Agent": MODERN_USER_AGENT})
                        direct_url = f"https://drive.google.com/uc?id={gdrive_id}&export=download" if gdrive_id else source_url
                        
                        resp = session.get(direct_url, stream=True, allow_redirects=True, timeout=60)
                        if resp.status_code == 404:
                            raise FileNotFoundError("Google Drive file not found (HTTP 404). It may have been deleted, moved to trash, or the link is invalid.")

                        # Check if Google Drive returned an HTML page (virus scan warning, quota error, or interstitial)
                        content_type = resp.headers.get("Content-Type", "").lower()
                        if content_type.startswith("text/html"):
                            # Safely read at most 128 KB of HTML (never load multi-MBs into memory)
                            html_bytes = b""
                            for chunk in resp.iter_content(chunk_size=16384):
                                html_bytes += chunk
                                if len(html_bytes) >= 131072:
                                    break
                            html_text = html_bytes.decode("utf-8", errors="replace")

                            confirm_url = None
                            # 1. Parse HTML for download confirmation form or URL
                            try:
                                import bs4
                                soup = bs4.BeautifulSoup(html_text, "html.parser")
                                form = soup.select_one("#download-form") or soup.select_one("#downloadForm") or soup.find("form", action=re.compile(r"download"))
                                if form and form.get("action"):
                                    action = form["action"]
                                    if not action.startswith("http"):
                                        action = urllib.parse.urljoin("https://drive.usercontent.google.com", action)
                                    query_params = urllib.parse.parse_qs(urllib.parse.urlsplit(action).query)
                                    for param in form.find_all("input", attrs={"type": "hidden"}):
                                        if param.get("name") and param.get("value") is not None:
                                            query_params[param["name"]] = [param["value"]]
                                    url_parts = urllib.parse.urlsplit(action)
                                    new_query = urllib.parse.urlencode(query_params, doseq=True)
                                    confirm_url = urllib.parse.urlunsplit(url_parts._replace(query=new_query))
                            except Exception as e_bs4:
                                logger.debug(f"Form parsing error: {e_bs4}")

                            if not confirm_url:
                                # 2. Check for confirmation href link in HTML
                                m_href = re.search(r'href="(\/uc\?export=download[^"]+)"', html_text) or re.search(r'href="(https:\/\/[^"]*drive\.usercontent\.google\.com\/download[^"]+)"', html_text)
                                if m_href:
                                    confirm_url = m_href.group(1).replace("&amp;", "&")
                                    if not confirm_url.startswith("http"):
                                        confirm_url = "https://docs.google.com" + confirm_url

                            if not confirm_url:
                                # 3. Check for cookies (download_warning_*)
                                for k, v in resp.cookies.items():
                                    if k.startswith("download_warning"):
                                        confirm_url = f"https://drive.usercontent.google.com/download?id={gdrive_id}&export=download&confirm={v}"
                                        break

                            if confirm_url:
                                logger.info(f"[REMOTE_TRANSFER] Following GDrive confirmation URL for {gdrive_id}...")
                                resp = session.get(confirm_url, stream=True, allow_redirects=True, timeout=60)
                                content_type = resp.headers.get("Content-Type", "").lower()

                            # SAFETY GUARD: If response is STILL text/html, Google Drive refused to download the file!
                            if content_type.startswith("text/html"):
                                err_reason = "Google Drive download quota exceeded or access restricted."
                                m_sub = re.search(r'<p class="uc-error-subcaption">(.*?)</p>', html_text, re.DOTALL)
                                if m_sub:
                                    clean_sub = re.sub(r'<[^>]+>', '', m_sub.group(1)).strip()
                                    if clean_sub:
                                        err_reason = clean_sub
                                elif "Too many users have viewed or downloaded this file recently" in html_text:
                                    err_reason = "Too many users have downloaded this file recently (Google Drive 24h quota limit exceeded). Please try again later."
                                if is_gdrive_quota_error(Exception(err_reason)):
                                    raise GoogleDriveQuotaExceededError(err_reason)
                                raise RuntimeError(f"Google Drive Error: {err_reason}")

                        resp.raise_for_status()

                        cd = resp.headers.get("Content-Disposition", "")
                        if "filename=" in cd:
                            cd_match = re.search(r'filename\*?=(?:UTF-8\'\')?"?([^";]+)"?', cd)
                            if cd_match:
                                filename_holder[0] = cd_match.group(1).strip()
                        tot = resp.headers.get("Content-Length")
                        if tot:
                            try:
                                estimated_total[0] = int(tot)
                            except Exception:
                                pass

                        for chunk in resp.iter_content(chunk_size=2 * 1024 * 1024):
                            if cancel_event.is_set():
                                raise InterruptedError("Cancelled by user")
                            if chunk:
                                writer.write(chunk)
                                tot_up = sum(uploaded_bytes_map.values())
                                report_combined_progress(writer.total_bytes, tot_up, estimated_total[0])

                logger.info(f"[REMOTE_TRANSFER] Task {task_id}: Streaming download from Google Drive...")
                await asyncio.to_thread(_do_gdown)
                writer.finish()

            else:
                # Direct HTTP / HTTPS stream download via requests with Range resumption
                logger.info(f"[REMOTE_TRANSFER] Task {task_id}: Streaming download from direct URL...")
                def _do_direct_download():
                    import requests
                    headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}
                    max_retries = 15
                    retry = 0

                    while retry < max_retries:
                        if cancel_event.is_set():
                            raise InterruptedError("Cancelled by user")

                        if priority_manager.is_user_upload_active():
                            on_pause_state_changed(True)
                            while priority_manager.is_user_upload_active() and not cancel_event.is_set():
                                priority_manager.wait_if_user_upload_active(timeout=1.0)
                            on_pause_state_changed(False)

                        req_headers = dict(headers)
                        if task_doc.get("custom_headers"):
                            req_headers.update(task_doc["custom_headers"])
                        if writer.total_bytes > 0:
                            req_headers["Range"] = f"bytes={writer.total_bytes}-"

                        try:
                            with requests.get(source_url, stream=True, timeout=60, headers=req_headers) as resp:
                                if resp.status_code not in [200, 206]:
                                    resp.raise_for_status()

                                if writer.total_bytes == 0:
                                    tot = resp.headers.get("Content-Length")
                                    if tot:
                                        try:
                                            estimated_total[0] = int(tot)
                                        except Exception:
                                            pass
                                elif resp.status_code == 206:
                                    cr = resp.headers.get("Content-Range", "")
                                    if "/" in cr:
                                        try:
                                            estimated_total[0] = int(cr.split("/")[-1])
                                        except Exception:
                                            pass

                                cd = resp.headers.get("Content-Disposition", "")
                                cd_match = re.search(r'filename=["\']?([^"\';]+)["\']?', cd)
                                if cd_match:
                                    filename_holder[0] = cd_match.group(1)
                                elif not task_doc.get("filename") or task_doc["filename"] == "Resolving...":
                                    filename_holder[0] = os.path.basename(source_url.split("?")[0]) or f"download_{task_id}.bin"

                                for chunk in resp.iter_content(chunk_size=2 * 1024 * 1024):
                                    if cancel_event.is_set():
                                        raise InterruptedError("Cancelled by user")
                                    if chunk:
                                        writer.write(chunk)
                                        tot_up = sum(uploaded_bytes_map.values())
                                        report_combined_progress(writer.total_bytes, tot_up, estimated_total[0])

                                break
                        except (requests.exceptions.ConnectionError, requests.exceptions.Timeout) as conn_err:
                            if cancel_event.is_set():
                                raise InterruptedError("Cancelled by user")
                            logger.warning(f"Connection dropped: {conn_err}. Reconnecting from byte {writer.total_bytes}...")
                            retry += 1
                            time.sleep(2)

                await asyncio.to_thread(_do_direct_download)
                writer.finish()

            if not upload_tasks or writer.total_bytes == 0:
                raise ValueError("No data received or transfer was cancelled.")

            # Safety Guard: Ensure downloaded media/archive files are not corrupt HTML snippets (< 50 KB)
            target_ext = filename_holder[0].rsplit(".", 1)[-1].lower() if "." in filename_holder[0] else ""
            if target_ext in ("mkv", "mp4", "avi", "mov", "webm", "ts", "m4v", "flv", "zip", "rar", "7z", "tar", "gz", "iso") and writer.total_bytes < 50 * 1024:
                raise ValueError(
                    f"Corrupt or invalid download: Received only {writer.total_bytes} bytes for '{filename_holder[0]}'. "
                    f"The remote source returned an error page or broken stream instead of the actual media file."
                )

            # Ensure folder hierarchy exists in MongoDB
            database.Files.create_folder_path(destination_path, owner_id=str(user_id))
            file_type = get_file_type(filename_holder[0])

            # --- STEP 2: Finalize Telegram Storage Registration ---
            if len(upload_tasks) == 1 and writer.parts[0].get("part_index") == 1 and writer.total_bytes <= PART_MAX_SIZE:
                # Single-part file upload complete
                res = await upload_tasks[0]
                database.Files.add_file(
                    chat_id=chat_id,
                    message_id=res["message_id"],
                    thumbnail=res.get("thumbnail"),
                    file_type=file_type,
                    file_unique_id=res["file_unique_id"],
                    file_size=writer.total_bytes,
                    file_name=filename_holder[0],
                    file_caption=f"Uploaded file: {filename_holder[0]}",
                    file_path=destination_path,
                    owner_id=str(user_id),
                    is_vault=is_vault
                )
            else:
                # Multi-part file upload complete
                results = await asyncio.gather(*upload_tasks)
                results.sort(key=lambda x: x["part_index"])

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

                database.Files.add_multipart_file(
                    chat_id=chat_id,
                    thumbnail=results[0].get("thumbnail"),
                    file_type=file_type,
                    file_unique_id=results[0]["file_unique_id"],
                    file_size=writer.total_bytes,
                    file_name=filename_holder[0],
                    file_caption=f"Uploaded multi-part file: {filename_holder[0]}",
                    parts=parts,
                    file_path=destination_path,
                    owner_id=str(user_id),
                    part_size=PART_MAX_SIZE,
                    is_vault=is_vault
                )

            # Cleanup temp directory
            shutil.rmtree(tg_dir, ignore_errors=True)

            self._update_task(task_id, {
                "status": "completed",
                "progress": 100.0,
                "speed_bps": 0,
                "eta_seconds": 0,
                "filesize": writer.total_bytes,
                "transferred_bytes": writer.total_bytes,
                "phase": "Completed & Saved to Telegram ☁️"
            })
            logger.info(f"[REMOTE_TRANSFER] Task {task_id}: Pipelined streaming transfer completed successfully!")

            # If this was a cut operation from a cloud account, delete the source file
            if task_doc.get("post_action_delete") and task_doc.get("cloud_account_id") and task_doc.get("cloud_file_id"):
                try:
                    from telestore.services.google_drive_manager import GoogleDriveManager
                    acc = database.CloudAccounts.get_account_raw(task_doc["cloud_account_id"])
                    if acc:
                        token = await GoogleDriveManager.get_valid_access_token(acc)
                        await GoogleDriveManager.delete_file(token, task_doc["cloud_file_id"])
                        logger.info(f"[REMOTE_TRANSFER] Deleted source cloud file {task_doc['cloud_file_id']} after cut transfer.")
                except Exception as del_err:
                    logger.warning(f"[REMOTE_TRANSFER] Failed to delete source cloud file after cut: {del_err}")

        except (asyncio.CancelledError, InterruptedError):
            for t in upload_tasks:
                if not t.done():
                    t.cancel()
            shutil.rmtree(tg_dir, ignore_errors=True)
            raise
        except Exception:
            for t in upload_tasks:
                if not t.done():
                    t.cancel()
            shutil.rmtree(tg_dir, ignore_errors=True)
            raise
        finally:
            writer.cleanup()

    def _update_task(self, task_id: str, updates: dict):
        try:
            coll = get_remote_db()["RemoteTransfers"]
            updates["updated_at"] = datetime.now(timezone.utc)
            if updates.get("error_message"):
                # Keep what really happened for the logs; the user reads one plain sentence
                raw = updates["error_message"]
                updates["error_message"] = friendly_error(raw)
                if updates["error_message"] != raw:
                    updates["error_detail"] = str(raw)[:2000]
            coll.update_one({"task_id": task_id}, {"$set": updates})
        except Exception as e:
            logger.warning(f"Failed to update remote transfer {task_id}: {e}")
            return
        if updates.get("status") in ("completed", "failed"):
            event_service.task_finished(task_id)

    def cancel_task(self, task_id: str, user_id: str) -> bool:
        coll = get_remote_db()["RemoteTransfers"]
        rec = coll.find_one({"task_id": task_id, "user_id": str(user_id)})
        if not rec:
            return False

        # Signal cancellation event if active
        if task_id in self.cancel_events:
            self.cancel_events[task_id].set()

        if task_id in self.active_tasks:
            self.active_tasks[task_id].cancel()

        self._update_task(task_id, {
            "status": "cancelled",
            "phase": "Cancelled by user",
            "speed_bps": 0
        })
        
        # Clean disk buffer
        tg_dir = os.path.join(os.getcwd(), "tg_files", f"remote_{task_id}")
        if os.path.exists(tg_dir):
            shutil.rmtree(tg_dir, ignore_errors=True)

        if rec.get("source_type") == "torrent_file" and rec.get("torrent_path"):
            if os.path.exists(rec["torrent_path"]):
                try:
                    os.remove(rec["torrent_path"])
                except Exception:
                    pass

        return True

    def cancel_group(self, group_id: str, user_id: str) -> int:
        """Cancel all active or queued tasks belonging to a group/folder."""
        coll = get_remote_db()["RemoteTransfers"]
        tasks = list(coll.find({
            "group_id": group_id,
            "user_id": str(user_id),
            "status": {"$in": ["queued", "downloading", "uploading_tg"]}
        }))
        cancelled_count = 0
        for task in tasks:
            if self.cancel_task(task["task_id"], user_id):
                cancelled_count += 1
        return cancelled_count

    def clear_completed(self, user_id: str) -> int:
        coll = get_remote_db()["RemoteTransfers"]
        cleared_tasks = list(coll.find({
            "user_id": str(user_id),
            "status": {"$in": ["completed", "cancelled", "failed"]},
            "source_type": "torrent_file"
        }))
        for t in cleared_tasks:
            t_path = t.get("torrent_path")
            if t_path and os.path.exists(t_path):
                try:
                    os.remove(t_path)
                except Exception:
                    pass

        res = coll.delete_many({
            "user_id": str(user_id),
            "status": {"$in": ["completed", "cancelled", "failed"]}
        })
        return res.deleted_count

    def resume_group(self, group_id: str, user_id: str) -> int:
        """Manually resume or retry any tasks in a group that were paused due to quota cooldown, failed, or queued."""
        coll = get_remote_db()["RemoteTransfers"]
        res = coll.update_many(
            {
                "group_id": group_id,
                "user_id": str(user_id),
                "status": {"$in": ["paused_quota", "failed", "queued"]}
            },
            {
                "$set": {
                    "status": "queued",
                    "phase": "Queued (Resumed by user)",
                    "updated_at": datetime.now(timezone.utc),
                    "error_message": None
                },
                "$unset": {"cooldown_until": "", "claimed_by": "", "claimed_at": ""}
            }
        )
        return res.modified_count

    def retry_task(self, task_id: str, user_id: str) -> bool:
        """Retry a single remote transfer task."""
        coll = get_remote_db()["RemoteTransfers"]
        res = coll.update_one(
            {
                "task_id": task_id,
                "user_id": str(user_id),
                "status": {"$in": ["failed", "paused_quota", "cancelled"]}
            },
            {
                "$set": {
                    "status": "queued",
                    "phase": "Queued (Retried by user)",
                    "progress": 0,
                    "transferred_bytes": 0,
                    "speed_bps": 0,
                    "error_message": None,
                    "updated_at": datetime.now(timezone.utc)
                },
                "$unset": {"cooldown_until": "", "claimed_by": "", "claimed_at": ""}
            }
        )
        return res.modified_count > 0

    def get_user_tasks(self, user_id: str) -> Dict[str, Any]:
        """The Transfers page's list. Tasks outside a group come in full; a folder leech can hold tens
        of thousands of files, so each group sends the files moving now, the next few waiting and a
        summary of all of them (counts per status and bytes), never every row."""
        coll = get_remote_db()["RemoteTransfers"]
        uid = str(user_id)
        active_docs = list(coll.find({
            "user_id": uid,
            "status": {"$in": ACTIVE_STATUSES},
            "group_id": None,
        }).sort("created_at", -1))

        active_groups = coll.distinct("group_id", {"user_id": uid, "status": {"$in": ACTIVE_STATUSES}, "group_id": {"$ne": None}})
        for group_id in active_groups:
            active_docs += list(coll.find({"user_id": uid, "group_id": group_id, "status": {"$in": RUNNING_STATUSES}}))
            active_docs += list(coll.find({
                "user_id": uid,
                "group_id": group_id,
                "status": {"$in": ["queued", "paused_quota"]},
            }).sort("created_at", 1).limit(GROUP_PREVIEW_SIZE))

        # Recent completed/cancelled/failed history
        history_docs = list(coll.find({
            "user_id": uid,
            "status": {"$in": ["completed", "cancelled", "failed"]}
        }).sort("updated_at", -1).limit(40))

        docs = active_docs + history_docs
        for d in docs:
            d["_id"] = str(d["_id"])
            if isinstance(d.get("created_at"), datetime):
                d["created_at"] = d["created_at"].isoformat()
            if isinstance(d.get("updated_at"), datetime):
                d["updated_at"] = d["updated_at"].isoformat()
            if isinstance(d.get("cooldown_until"), datetime):
                d["cooldown_until"] = d["cooldown_until"].isoformat()
            # Sign-in headers stay on the server; older failures may still hold raw source text
            d.pop("custom_headers", None)
            d.pop("error_detail", None)
            d["error_message"] = friendly_error(d.get("error_message"))
            for part in d.get("parts") or []:
                if isinstance(part, dict):
                    part.pop("custom_headers", None)

        group_ids = sorted({d["group_id"] for d in docs if d.get("group_id")})
        return {"tasks": docs, "groups": self._group_summaries(coll, uid, group_ids)}

    @staticmethod
    def _group_summaries(coll, user_id: str, group_ids: List[str]) -> Dict[str, Dict[str, Any]]:
        if not group_ids:
            return {}
        rows = coll.aggregate([
            {"$match": {"user_id": user_id, "group_id": {"$in": group_ids}}},
            {"$group": {
                "_id": {"group": "$group_id", "status": "$status"},
                "count": {"$sum": 1},
                "filesize": {"$sum": {"$ifNull": ["$filesize", 0]}},
                "transferred": {"$sum": {"$ifNull": ["$transferred_bytes", 0]}},
                "speed": {"$sum": {"$ifNull": ["$speed_bps", 0]}},
            }},
        ])
        summaries: Dict[str, Dict[str, Any]] = {}
        for row in rows:
            group = summaries.setdefault(row["_id"]["group"], {"total": 0, "counts": {}, "filesize": 0, "transferred_bytes": 0, "speed_bps": 0})
            group["total"] += row["count"]
            group["counts"][row["_id"]["status"]] = row["count"]
            group["filesize"] += row["filesize"]
            group["transferred_bytes"] += row["transferred"]
            group["speed_bps"] += row["speed"]
        # Why files failed: the latest reason, so a folder doesn't just say "3 failed"
        for group_id, group in summaries.items():
            if group["counts"].get("failed"):
                failed = coll.find_one({"user_id": user_id, "group_id": group_id, "status": "failed"}, {"error_message": 1}, sort=[("updated_at", -1)])
                group["error"] = friendly_error((failed or {}).get("error_message"))
        return summaries

remote_transfer_manager = RemoteTransferManager(max_concurrent=2)
