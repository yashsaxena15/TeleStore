# telestore/services/video_duration.py
"""Video lengths for Photos' tiles ("0:38"). New backups send the length; older videos without
one are read with ffprobe in the background, a few at a time, when Photos lists them. Each video
is tried once per server run, so one that can't be read isn't tried over and over.
"""

import asyncio
import json
import subprocess
from typing import Callable, Optional

from bson import ObjectId
from d4rk.Logs import setup_logger

from telestore.db import database

logger = setup_logger("video_duration")

PER_LIST = 6  # videos read for one Photos page
_tried: set = set()
_busy = False


def probe(url: str, timeout: int = 45) -> Optional[float]:
    """The video's length in seconds, read by ffprobe (which fetches only what it needs)."""
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "json", url],
            capture_output=True, text=True, timeout=timeout,
        )
        value = float(json.loads(out.stdout or "{}").get("format", {}).get("duration", 0) or 0)
        return value if 0 < value <= 7 * 86400 else None
    except (subprocess.SubprocessError, ValueError, OSError, json.JSONDecodeError):
        return None


def missing(files: list) -> list:
    """The videos in a Photos page that have no length yet and haven't been tried."""
    from telestore.db.repositories.files import KIND_FILTERS
    import re
    video_names = re.compile(KIND_FILTERS["video"][1], re.IGNORECASE)
    return [
        f for f in files
        if not f.get("duration") and str(f.get("id")) not in _tried
        and (f.get("file_type") == "video" or video_names.search(f.get("file_name") or ""))
    ][:PER_LIST]


async def fill(files: list, url_for: Callable[[dict], str]) -> int:
    """Reads and saves the lengths of [files] (one batch at a time across the server). Returns how many were saved."""
    global _busy
    if _busy or not files:
        return 0
    _busy = True
    saved = 0
    try:
        for f in files:
            file_id = str(f.get("id"))
            _tried.add(file_id)
            seconds = await asyncio.to_thread(probe, url_for(f))
            if seconds and ObjectId.is_valid(file_id):
                database.Files.update_one({"_id": ObjectId(file_id)}, {"$set": {"duration": round(seconds, 3)}})
                saved += 1
    except Exception as e:
        logger.info(f"Reading video lengths stopped: {e}")
    finally:
        _busy = False
    return saved
