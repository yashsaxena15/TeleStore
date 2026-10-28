# telestore/services/photo_info_service.py
"""Photo details (the Photos viewer's swipe-up panel): size and megapixels, camera and lens,
exposure, when and where it was taken, read from the photo's EXIF with Pillow (HEIC through
pillow-heif). Most photos keep EXIF near the start, so the first 512 KB is tried before the
whole file. The result is saved on the file's record, so each photo is read once.
"""

import io
from fractions import Fraction
from typing import Optional

import requests
from d4rk.Logs import setup_logger

logger = setup_logger("photo_info_service")

HEAD_BYTES = 512 * 1024
MAX_BYTES = 60 * 1024 * 1024

# EXIF tag numbers
MAKE, MODEL, DATETIME = 271, 272, 306
EXIF_IFD, GPS_IFD = 0x8769, 0x8825
EXPOSURE, FNUMBER, ISO, TAKEN, FOCAL, FLASH, LENS = 33434, 33437, 34855, 36867, 37386, 37385, 42036
LAT_REF, LAT, LON_REF, LON, ALT_REF, ALT = 1, 2, 3, 4, 5, 6

_heif_ready = False


def _heif():
    global _heif_ready
    if not _heif_ready:
        try:
            from pillow_heif import register_heif_opener
            register_heif_opener()
        except Exception as e:
            logger.warning(f"HEIC support unavailable: {e}")
        _heif_ready = True


def _num(value) -> Optional[float]:
    try:
        if isinstance(value, tuple) and len(value) == 2:
            return float(value[0]) / float(value[1]) if value[1] else None
        return float(value)
    except (TypeError, ValueError, ZeroDivisionError):
        return None


def _text(value) -> Optional[str]:
    if isinstance(value, bytes):
        value = value.decode("utf-8", "ignore")
    value = (str(value) if value is not None else "").strip("\x00 ").strip()
    return value or None


def _degrees(dms, ref) -> Optional[float]:
    try:
        d, m, s = (_num(x) for x in dms)
        value = d + m / 60 + s / 3600
    except (TypeError, ValueError):
        return None
    return -value if _text(ref) in ("S", "W") else value


def _exposure(seconds: Optional[float]) -> Optional[str]:
    """1/120, 2 or 0.5 → "1/120", "2", "1/2" (seconds)."""
    if not seconds or seconds <= 0:
        return None
    if seconds >= 1:
        return f"{seconds:g}"
    return f"1/{round(1 / seconds)}" if (1 / seconds) >= 1.5 else str(Fraction(seconds).limit_denominator(10))


def _iso_time(value) -> Optional[str]:
    """EXIF "2024:05:01 14:03:22" → "2024-05-01T14:03:22" (the camera's local time)."""
    text = _text(value)
    if not text or len(text) < 19:
        return None
    return text[:10].replace(":", "-") + "T" + text[11:19]


def extract(data: bytes) -> dict:
    """The details Pillow can read from [data] (a whole image, or enough of its start)."""
    from PIL import Image
    _heif()
    with Image.open(io.BytesIO(data)) as img:
        width, height = img.size
        fmt = img.format
        exif = img.getexif()
    sub = exif.get_ifd(EXIF_IFD) if exif else {}
    gps = exif.get_ifd(GPS_IFD) if exif else {}
    flash = sub.get(FLASH)
    info = {
        "width": width,
        "height": height,
        "megapixels": round(width * height / 1_000_000, 1) if width and height else None,
        "format": fmt,
        "camera_make": _text(exif.get(MAKE)) if exif else None,
        "camera_model": _text(exif.get(MODEL)) if exif else None,
        "lens": _text(sub.get(LENS)),
        "aperture": round(_num(sub.get(FNUMBER)), 1) if _num(sub.get(FNUMBER)) else None,
        "exposure": _exposure(_num(sub.get(EXPOSURE))),
        "iso": int(sub[ISO][0] if isinstance(sub.get(ISO), tuple) else sub[ISO]) if sub.get(ISO) else None,
        "focal_length": round(_num(sub.get(FOCAL)), 1) if _num(sub.get(FOCAL)) else None,
        "flash": bool(int(flash) & 1) if flash is not None else None,
        "taken_at": _iso_time(sub.get(TAKEN) or (exif.get(DATETIME) if exif else None)),
        "latitude": None,
        "longitude": None,
        "altitude": None,
    }
    if gps.get(LAT) and gps.get(LON):
        lat, lon = _degrees(gps[LAT], gps.get(LAT_REF)), _degrees(gps[LON], gps.get(LON_REF))
        if lat is not None and lon is not None and not (lat == 0 and lon == 0):
            info["latitude"], info["longitude"] = round(lat, 6), round(lon, 6)
            alt = _num(gps.get(ALT))
            if alt is not None:
                info["altitude"] = round(-alt if gps.get(ALT_REF) in (1, b"\x01") else alt, 1)
    return info


def _fetch(url: str, limit: Optional[int]) -> bytes:
    headers = {"Range": f"bytes=0-{limit - 1}"} if limit else {}
    with requests.get(url, headers=headers, stream=True, timeout=60) as resp:
        if resp.status_code not in (200, 206):
            raise ValueError(f"The file couldn't be read ({resp.status_code}).")
        return resp.raw.read((limit or MAX_BYTES) + 1, decode_content=True)


def read(source_url: str, file_size: Optional[int]) -> dict:
    """Reads the start of the file, then (for photos that keep EXIF further in) the whole of it."""
    first_error = None
    try:
        return extract(_fetch(source_url, HEAD_BYTES))
    except Exception as e:  # cut off too early, or the format needs the whole file (HEIC often does)
        first_error = e
    if file_size and file_size > MAX_BYTES:
        raise ValueError(f"This photo is too large to read its details ({first_error}).")
    return extract(_fetch(source_url, None))
