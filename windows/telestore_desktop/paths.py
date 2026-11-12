"""Where the app keeps its settings, sign-ins and unfinished uploads."""

import os
import sys


def data_dir() -> str:
    """%APPDATA%\\TeleStore on Windows (~/.config/telestore-desktop elsewhere); TELESTORE_DESKTOP_HOME overrides."""
    base = os.getenv("TELESTORE_DESKTOP_HOME")
    if not base:
        if sys.platform == "win32":
            base = os.path.join(os.getenv("APPDATA") or os.path.expanduser("~"), "TeleStore")
        else:
            base = os.path.join(os.path.expanduser("~"), ".config", "telestore-desktop")
    os.makedirs(base, exist_ok=True)
    return base


def path(name: str) -> str:
    return os.path.join(data_dir(), name)
