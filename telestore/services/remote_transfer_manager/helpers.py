# telestore/services/remote_transfer_manager/helpers.py

import os
import re
from typing import Optional, Dict
from datetime import datetime, timezone
import urllib.parse
from pymongo import MongoClient

import requests

from telestore.config import DATABASE_URL, APP_NAME
from telestore.db import database

from telestore.services.remote_transfer_manager.common import logger

def get_file_type(fname: str) -> str:
    ext = os.path.splitext(fname)[1].lower()
    if ext in ['.mp4', '.mkv', '.avi', '.mov', '.webm']:
        return "video"
    elif ext in ['.mp3', '.wav', '.ogg', '.flac', '.m4a', '.opus', '.aac']:
        return "audio"
    elif ext in ['.jpg', '.jpeg', '.png', '.gif', '.webp']:
        return "photo"
    return "document"

class GoogleDriveQuotaExceededError(RuntimeError):
    """Raised when Google Drive rate limits public downloads due to daily quota exhaustion."""
    pass

def is_gdrive_quota_error(err: Exception) -> bool:
    if isinstance(err, GoogleDriveQuotaExceededError):
        return True
    msg = str(err).lower()
    return (
        "too many users have viewed or downloaded" in msg or
        "too many users have downloaded" in msg or
        "quota exceeded" in msg or
        "download quota" in msg
    )

def get_remote_db():
    if hasattr(database, "db") and database.db is not None:
        return database.db
    client = MongoClient(DATABASE_URL)
    return client[APP_NAME]

MODERN_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"

def probe_resource_for_range(
    url: str,
    gdrive_id: Optional[str] = None,
    custom_headers: Optional[Dict[str, str]] = None
):
    """
    Probes whether a URL or Google Drive file supports HTTP Range requests and resolves total file size & filename.
    Returns: (supports_range: bool, direct_url: str, filesize: int, filename: Optional[str])
    """
    import bs4

    session = requests.Session()
    session.headers.update({"User-Agent": MODERN_USER_AGENT})
    if custom_headers:
        session.headers.update(custom_headers)

    # 1. Google Drive Probe & Confirmation Link Resolution
    if gdrive_id or ("drive.google.com" in url or "docs.google.com" in url):
        gid = gdrive_id
        if not gid:
            m = re.search(r'/file/d/([a-zA-Z0-9_-]+)', url) or re.search(r'id=([a-zA-Z0-9_-]+)', url)
            if m:
                gid = m.group(1)

        direct_url = f"https://drive.google.com/uc?id={gid}&export=download" if gid else url
        final_url = direct_url
        try:
            resp = session.get(direct_url, stream=True, allow_redirects=True, timeout=12)
            content_type = resp.headers.get("Content-Type", "").lower()
            if content_type.startswith("text/html"):
                html_bytes = b""
                for chunk in resp.iter_content(chunk_size=16384):
                    html_bytes += chunk
                    if len(html_bytes) >= 131072:
                        break
                html_text = html_bytes.decode("utf-8", errors="replace")

                confirm_url = None
                try:
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
                except Exception:
                    pass

                if not confirm_url:
                    m_href = re.search(r'href="(\/uc\?export=download[^"]+)"', html_text) or re.search(r'href="(https:\/\/[^"]*drive\.usercontent\.google\.com\/download[^"]+)"', html_text)
                    if m_href:
                        confirm_url = m_href.group(1).replace("&amp;", "&")
                        if not confirm_url.startswith("http"):
                            confirm_url = "https://docs.google.com" + confirm_url

                if not confirm_url:
                    for k, v in resp.cookies.items():
                        if k.startswith("download_warning"):
                            confirm_url = f"https://drive.usercontent.google.com/download?id={gid}&export=download&confirm={v}"
                            break

                if confirm_url:
                    final_url = confirm_url

            # Probe Range 0-0 on resolved Google Drive download URL
            h = {"Range": "bytes=0-0"}
            with session.get(final_url, headers=h, stream=True, allow_redirects=True, timeout=8) as r_probe:
                fname = None
                cd = r_probe.headers.get("Content-Disposition", "")
                if "filename=" in cd:
                    m = re.search(r'filename\*?=(?:UTF-8\'\')?"?([^";]+)"?', cd)
                    if m: fname = m.group(1).strip()
                if not fname:
                    fname = f"gdrive_file_{gid}"

                tot = 0
                if r_probe.status_code == 206:
                    cr = r_probe.headers.get("Content-Range", "")
                    if "/" in cr:
                        try:
                            tot = int(cr.split("/")[-1])
                        except Exception as e:
                            logger.debug(f"Failed to parse content-range total: {e}")
                    return True, final_url, tot, fname
                elif r_probe.status_code == 200:
                    tot = int(r_probe.headers.get("Content-Length", 0))
                    return False, final_url, tot, fname
        except Exception as e:
            logger.warning(f"Google Drive probe failed: {e}")
        return False, url, 0, None

    # 2. Direct HTTP / HTTPS URL Probe
    try:
        h = {"Range": "bytes=0-0"}
        with session.get(url, headers=h, stream=True, allow_redirects=True, timeout=6) as resp:
            fname = None
            cd = resp.headers.get("Content-Disposition", "")
            if "filename=" in cd:
                m = re.search(r'filename\*?=(?:UTF-8\'\')?"?([^";]+)"?', cd)
                if m: fname = m.group(1).strip()
            if not fname:
                fname = os.path.basename(urllib.parse.urlsplit(resp.url).path) or "download.bin"

            if resp.status_code == 206:
                cr = resp.headers.get("Content-Range", "")
                tot = 0
                if "/" in cr:
                    try:
                        tot = int(cr.split("/")[-1])
                    except Exception as e:
                        logger.debug(f"Failed to parse content-range total: {e}")
                return True, resp.url, tot, fname
            elif resp.status_code == 200:
                tot = int(resp.headers.get("Content-Length", 0))
                return False, resp.url, tot, fname
    except Exception as e:
        logger.warning(f"Direct URL probe failed: {e}")

    return False, url, 0, None

async def finalize_multipart_group_if_ready(group_id: str, sample_task_doc: dict) -> bool:
    coll = get_remote_db()["RemoteTransfers"]
    now = datetime.now(timezone.utc)

    # 1. Check if any part in this group is still incomplete
    incomplete_count = coll.count_documents({
        "group_id": group_id,
        "is_range_part": True,
        "status": {"$ne": "completed"}
    })
    if incomplete_count > 0:
        logger.info(f"[MULTI_RANGE] Group {group_id}: {incomplete_count} parts still in progress...")
        return False

    # 2. Atomically acquire lock on group
    lock_doc = coll.find_one_and_update(
        {
            "group_id": group_id,
            "is_range_part": True,
            "is_multipart_finalized": {"$ne": True}
        },
        {"$set": {"is_multipart_finalized": True}}
    )
    if not lock_doc:
        logger.info(f"[MULTI_RANGE] Group {group_id} already finalized.")
        return True

    # 3. Gather all parts sorted by part_index
    part_docs = list(coll.find({"group_id": group_id, "is_range_part": True}).sort("part_index", 1))
    parts = []
    total_file_size = 0
    for p in part_docs:
        c_info = p.get("completed_part_info")
        if c_info:
            parts.append(c_info)
            total_file_size += c_info.get("part_size", 0)

    if not parts or len(parts) != len(part_docs):
        logger.error(f"[MULTI_RANGE] Group {group_id}: Missing completed_part_info (found {len(parts)}/{len(part_docs)})!")
        return False

    dest_path = sample_task_doc.get("destination_path", "/Home")
    user_id = sample_task_doc["user_id"]
    chat_id = sample_task_doc["chat_id"]
    file_name = sample_task_doc.get("filename") or "download.bin"
    is_vault = bool(sample_task_doc.get("is_vault", False))
    file_type = get_file_type(file_name)

    # Ensure folder path exists
    database.Files.create_folder_path(dest_path, owner_id=str(user_id))

    first_uid = parts[0].get("file_unique_id", f"mp_{parts[0]['message_id']}")
    PART_MAX_SIZE = 1950 * 1024 * 1024
    database.Files.add_multipart_file(
        chat_id=chat_id,
        thumbnail=parts[0].get("thumbnail"),
        file_type=file_type,
        file_unique_id=first_uid,
        file_size=sample_task_doc.get("total_filesize") or total_file_size,
        file_name=file_name,
        file_caption=f"Uploaded multi-part file: {file_name}",
        parts=parts,
        file_path=dest_path,
        owner_id=str(user_id),
        part_size=PART_MAX_SIZE,
        is_vault=is_vault
    )

    coll.update_many(
        {"group_id": group_id},
        {
            "$set": {
                "phase": f"Completed & Saved to Telegram ({len(parts)} parts) ☁️",
                "progress": 100.0,
                "speed_bps": 0,
                "eta_seconds": 0,
                "updated_at": now
            }
        }
    )
    logger.info(f"[MULTI_RANGE] Group {group_id}: Successfully finalized multi-part file '{file_name}' ({len(parts)} parts) into database!")
    return True
