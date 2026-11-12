"""Secrets on disk (the TeleStore sign-in and the Telegram session), readable only by this Windows user.

On Windows they are encrypted with DPAPI (CryptProtectData), tied to the Windows account: copying
the file to another PC or account makes it useless. Elsewhere (development, tests) the file is only
limited to its owner (0600).
"""

import base64
import ctypes
import json
import os
import sys
from typing import Optional

from telestore_desktop import paths

_PREFIX = b"DPAPI1:"


class _Blob(ctypes.Structure):
    _fields_ = [("cbData", ctypes.c_uint32), ("pbData", ctypes.POINTER(ctypes.c_char))]


def _dpapi(data: bytes, protect: bool) -> bytes:
    crypt32 = ctypes.windll.crypt32  # type: ignore[attr-defined]
    kernel32 = ctypes.windll.kernel32  # type: ignore[attr-defined]
    buf = ctypes.create_string_buffer(data, len(data))
    blob_in = _Blob(len(data), ctypes.cast(buf, ctypes.POINTER(ctypes.c_char)))
    blob_out = _Blob()
    fn = crypt32.CryptProtectData if protect else crypt32.CryptUnprotectData
    entropy = ctypes.create_string_buffer(b"TeleStore desktop")
    ent = _Blob(len(b"TeleStore desktop"), ctypes.cast(entropy, ctypes.POINTER(ctypes.c_char)))
    if not fn(ctypes.byref(blob_in), None, ctypes.byref(ent), None, None, 0x01, ctypes.byref(blob_out)):
        raise OSError("Windows couldn't protect or read the saved sign-in")
    try:
        return ctypes.string_at(blob_out.pbData, blob_out.cbData)
    finally:
        kernel32.LocalFree(blob_out.pbData)


def protect(data: bytes) -> bytes:
    if sys.platform == "win32":
        return _PREFIX + base64.b64encode(_dpapi(data, True))
    return base64.b64encode(data)


def unprotect(data: bytes) -> bytes:
    if data.startswith(_PREFIX):
        return _dpapi(base64.b64decode(data[len(_PREFIX):]), False)
    return base64.b64decode(data)


def save(name: str, value: dict) -> None:
    target = paths.path(name)
    tmp = target + ".tmp"
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "wb") as f:
        f.write(protect(json.dumps(value).encode()))
    os.replace(tmp, target)


def load(name: str) -> Optional[dict]:
    try:
        with open(paths.path(name), "rb") as f:
            return json.loads(unprotect(f.read()).decode())
    except (OSError, ValueError):
        return None


def forget(name: str) -> None:
    try:
        os.remove(paths.path(name))
    except OSError:
        pass
