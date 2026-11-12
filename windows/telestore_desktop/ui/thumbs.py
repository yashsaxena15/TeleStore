"""Thumbnails sent with photos and videos (Telegram wants a JPEG up to 320x320 and 200 KB)."""

import os
import shutil
import subprocess
import tempfile
from typing import Optional

from PySide6.QtCore import Qt
from PySide6.QtGui import QImage

PHOTOS = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif"}


def _fit(image: QImage) -> Optional[str]:
    if image.isNull():
        return None
    small = image.scaled(320, 320, Qt.KeepAspectRatio, Qt.SmoothTransformation)
    out = tempfile.NamedTemporaryFile(prefix="telestore-thumb-", suffix=".jpg", delete=False).name
    for quality in (85, 70, 55, 40):
        if small.save(out, "JPG", quality) and os.path.getsize(out) <= 200 * 1024:
            return out
    os.remove(out)
    return None


def make(path: str) -> Optional[str]:
    """A thumbnail file for [path], or None (videos need ffmpeg on the PATH)."""
    ext = os.path.splitext(path)[1].lower()
    try:
        if ext in PHOTOS:
            return _fit(QImage(path))
        ffmpeg = shutil.which("ffmpeg")
        if not ffmpeg:
            return None
        frame = tempfile.NamedTemporaryFile(prefix="telestore-frame-", suffix=".jpg", delete=False).name
        flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        subprocess.run([ffmpeg, "-y", "-loglevel", "error", "-ss", "3", "-i", path, "-frames:v", "1", frame],
                       timeout=60, check=False, creationflags=flags)
        try:
            return _fit(QImage(frame)) if os.path.getsize(frame) else None
        finally:
            os.remove(frame)
    except Exception:
        return None
