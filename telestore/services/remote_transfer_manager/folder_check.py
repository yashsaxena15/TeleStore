# telestore/services/remote_transfer_manager/folder_check.py
"""The end-of-copy check of a Google Drive folder copy.

When the last file of a folder copy is done, the folder is listed again and every file in it is
looked for where it belongs. Files that are missing (never queued, or saved elsewhere) and didn't
simply fail are queued again; the result is kept with the copy (TransferGroups) and shown on its
Transfers row. A copy is checked at most MAX_ROUNDS times, so it can't loop.
"""

import os
import secrets
import shutil
import threading
from datetime import datetime, timezone
from typing import Callable, Iterable, List, Optional, Tuple

from telestore.services.remote_transfer_manager.common import logger
from telestore.services.remote_transfer_manager.helpers import MODERN_USER_AGENT, get_remote_db

MAX_ROUNDS = 2
SHOWN_NAMES = 20
_running = set()
_lock = threading.Lock()


def list_drive_folder(folder_id: str) -> List[Tuple[str, str, str]]:
    """(file id, folder path inside the copy, file name) for every file in a public Drive folder."""
    from gdown.download_folder import download_folder
    out = f"/tmp/gdrive_check_{secrets.token_hex(4)}/"
    os.makedirs(out, exist_ok=True)
    try:
        files = download_folder(id=folder_id, output=out, skip_download=True, quiet=True, user_agent=MODERN_USER_AGENT) or []
        listed = []
        for f in files:
            rel = os.path.relpath(f.local_path, out).replace("\\", "/").strip("/")
            listed.append((f.id, os.path.dirname(rel).strip("/"), os.path.basename(rel)))
        return listed
    finally:
        shutil.rmtree(out, ignore_errors=True)


def find_missing(listed: Iterable[Tuple[str, str, str]], destination: str, owner: str, files, tasks, group_id: str) -> Tuple[int, list, list]:
    """Compares a folder listing with what was saved: (files found, missing to copy, missing that failed)."""
    found, missing, failed = 0, [], []
    for file_id, rel_dir, name in listed:
        folder = f"{destination}/{rel_dir}" if rel_dir else destination
        if files.find_one({"owner_id": owner, "file_path": folder, "file_name": name, "trashed": {"$ne": True}}, {"_id": 1}):
            found += 1
        elif tasks.find_one({"group_id": group_id, "gdrive_id": file_id, "status": "failed"}, {"_id": 1}):
            failed.append(name)
        elif tasks.find_one({"group_id": group_id, "gdrive_id": file_id, "status": {"$in": ["queued", "downloading", "uploading_tg", "paused_quota"]}}, {"_id": 1}):
            continue  # on its way already
        else:
            missing.append((file_id, folder, name))
    return found, missing, failed


def check_folder_copy(group_id: str, lister: Callable[[str], list] = list_drive_folder, files=None, notify=True) -> Optional[dict]:
    """Checks a finished folder copy against its source and queues what is missing. Returns the result."""
    db = get_remote_db()
    tasks, groups = db["RemoteTransfers"], db["TransferGroups"]
    if files is None:
        from telestore.db import database
        files = database.Files
    one = tasks.find_one({"group_id": group_id, "group_folder_id": {"$exists": True}, "group_destination": {"$exists": True}})
    if not one:
        return None  # not a Drive folder copy (or from before the check existed)
    record = groups.find_one({"group_id": group_id}) or {}
    rounds = int(record.get("check_rounds") or 0)
    if rounds >= MAX_ROUNDS:
        return record.get("check")
    # Files land where discovery put them: the copy's destination, then their path in the listing
    owner, root = str(one["user_id"]), one["group_destination"]
    listed = lister(one["group_folder_id"])
    found, missing, failed = find_missing(listed, root, owner, files, tasks, group_id)
    now = datetime.now(timezone.utc)
    if missing:
        base = {k: one.get(k) for k in ("user_id", "chat_id", "is_vault", "group_id", "group_name", "group_type",
                                        "group_source_url", "group_folder_id", "group_destination")}
        tasks.insert_many([{
            **base, "task_id": f"rt_{secrets.token_hex(6)}", "source_url": f"https://drive.google.com/uc?id={fid}", "gdrive_id": fid,
            "source_type": "gdrive_file", "destination_path": folder, "filename": name, "filesize": 0, "transferred_bytes": 0,
            "speed_bps": 0, "progress": 0, "eta_seconds": 0, "status": "queued", "phase": "Queued (missing at the end-of-copy check)",
            "error_message": None, "group_total_items": len(listed), "created_at": now, "updated_at": now,
        } for fid, folder, name in missing])
    check = {"checked_at": now.isoformat(timespec="seconds"), "listed": len(listed), "found": found,
             "missing": len(missing), "missing_names": [n for _, _, n in missing][:SHOWN_NAMES], "failed": len(failed)}
    groups.update_one({"group_id": group_id}, {"$set": {"group_id": group_id, "user_id": owner, "check": check, "check_rounds": rounds + 1}}, upsert=True)
    logger.info(f"[FOLDER_CHECK] {group_id}: {found} of {len(listed)} found, {len(missing)} queued again, {len(failed)} failed")
    if notify and missing:
        from telestore.services import event_service
        name = one.get("group_name") or "Folder"
        event_service.record(owner, "transfer", "Folder copy check",
                             f"{name}: {len(missing)} file(s) were missing at the end and are being copied again.",
                             {"type": "transfers"}, dedupe=f"check:{group_id}:{rounds + 1}")
    return check


def check_in_background(group_id: str) -> None:
    """Runs the check without holding up whoever finished the last file (once at a time per copy)."""
    with _lock:
        if group_id in _running:
            return
        _running.add(group_id)

    def run():
        try:
            check_folder_copy(group_id)
        except Exception as e:
            logger.warning(f"[FOLDER_CHECK] {group_id}: couldn't check the copy: {e}")
        finally:
            with _lock:
                _running.discard(group_id)

    threading.Thread(target=run, name=f"folder-check-{group_id}", daemon=True).start()
