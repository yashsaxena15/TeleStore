# telestore/services/preview_service.py
"""Small JPEG previews for photos and videos that have no Telegram thumbnail.

Telegram only makes thumbnails for files sent as photos or videos. Files sent as documents
(HEIC/HEIF photos, photos over 10 MB, multi-part files, WebDAV uploads, MKVs…) have none, so the
app and website showed an icon. This makes a preview from the original instead: images with
Pillow (HEIC through pillow-heif), videos with ffmpeg (one frame). Each preview is made once and
kept on disk under cache/previews; a file that can't be previewed is remembered for a day so it
isn't downloaded again on every scroll.
"""

import asyncio
import io
import os
import re
import time
from typing import Optional

import requests

from telestore.config.settings import PROJECT_ROOT
from d4rk.Logs import setup_logger

logger = setup_logger("preview_service")

PREVIEW_DIR = os.getenv("PREVIEW_CACHE_DIR", os.path.join(PROJECT_ROOT, "cache", "previews"))
PREVIEW_SIZE = 480            # longest side, px
MAX_IMAGE_BYTES = 80 * 1024 * 1024
FAILED_RETRY_SECONDS = 24 * 3600

IMAGE_EXT = re.compile(r"\.(jpe?g|png|gif|webp|bmp|heic|heif|tiff?)$", re.I)
VIDEO_EXT = re.compile(r"\.(mp4|mkv|avi|mov|webm|flv|wmv|m4v|3gp|ts)$", re.I)

_limit = asyncio.Semaphore(2)  # previews are made from the full file: keep it gentle
_heif_ready = False


def preview_kind(doc: dict) -> Optional[str]:
    """"image", "video" or None (nothing to preview)."""
    name = doc.get("file_name") or ""
    ftype = doc.get("file_type")
    if ftype == "photo" or IMAGE_EXT.search(name):
        return "image"
    if ftype == "video" or VIDEO_EXT.search(name):
        return "video"
    return None


def _paths(file_id: str) -> tuple:
    safe = re.sub(r"[^A-Za-z0-9_-]", "", file_id)
    return os.path.join(PREVIEW_DIR, f"{safe}.jpg"), os.path.join(PREVIEW_DIR, f"{safe}.failed")


def cached(file_id: str) -> Optional[str]:
    path, _ = _paths(file_id)
    return path if os.path.exists(path) else None


def _recently_failed(file_id: str) -> bool:
    _, failed = _paths(file_id)
    try:
        return time.time() - os.path.getmtime(failed) < FAILED_RETRY_SECONDS
    except OSError:
        return False


def _image_preview(source_url: str, out_path: str) -> bool:
    global _heif_ready
    from PIL import Image, ImageOps
    if not _heif_ready:
        try:
            from pillow_heif import register_heif_opener
            register_heif_opener()
        except Exception as e:  # HEIC previews just won't work
            logger.warning(f"HEIC support unavailable: {e}")
        _heif_ready = True
    with requests.get(source_url, stream=True, timeout=60) as resp:
        if resp.status_code != 200:
            return False
        data = resp.raw.read(MAX_IMAGE_BYTES + 1, decode_content=True)
    if not data or len(data) > MAX_IMAGE_BYTES:
        return False
    with Image.open(io.BytesIO(data)) as img:
        img = ImageOps.exif_transpose(img)  # phone photos are often stored sideways
        img.thumbnail((PREVIEW_SIZE, PREVIEW_SIZE))
        if img.mode not in ("RGB", "L"):
            img = img.convert("RGB")
        tmp = out_path + ".tmp"
        img.save(tmp, "JPEG", quality=80, optimize=True)
    os.replace(tmp, out_path)
    return True


async def _video_preview(source_url: str, out_path: str) -> bool:
    tmp = out_path + ".tmp.jpg"
    for seek in ("2", "0"):  # a frame 2 s in avoids black intros; very short clips need 0
        proc = await asyncio.create_subprocess_exec(
            "nice", "-n", "19", "ffmpeg", "-v", "error", "-y", "-ss", seek, "-i", source_url,
            "-frames:v", "1", "-vf", f"scale='min({PREVIEW_SIZE},iw)':-2", "-q:v", "5", tmp,
            stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL,
        )
        try:
            await asyncio.wait_for(proc.wait(), timeout=45)
        except asyncio.TimeoutError:
            proc.kill()
            continue
        if proc.returncode == 0 and os.path.exists(tmp) and os.path.getsize(tmp) > 0:
            os.replace(tmp, out_path)
            return True
    if os.path.exists(tmp):
        os.remove(tmp)
    return False


async def make_preview(doc: dict, source_url: str) -> Optional[str]:
    """The preview's file path, making it from [source_url] (the original) when needed."""
    file_id = str(doc["_id"])
    hit = cached(file_id)
    if hit:
        return hit
    kind = preview_kind(doc)
    if not kind or _recently_failed(file_id):
        return None
    os.makedirs(PREVIEW_DIR, exist_ok=True)
    out_path, failed = _paths(file_id)
    async with _limit:
        hit = cached(file_id)  # made while we waited
        if hit:
            return hit
        try:
            if kind == "image":
                ok = await asyncio.to_thread(_image_preview, source_url, out_path)
            else:
                ok = await _video_preview(source_url, out_path)
        except Exception as e:
            logger.info(f"No preview for {doc.get('file_name')}: {e}")
            ok = False
    if ok:
        if os.path.exists(failed):
            os.remove(failed)
        return out_path
    with open(failed, "w") as f:
        f.write(str(int(time.time())))
    return None
