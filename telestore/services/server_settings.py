# telestore/services/server_settings.py
"""Settings for the whole server that the owner changes in Settings › Server, kept in one record of
the ServerSettings collection. Read often (every signed-in request asks whether archive tools are
on), so the value is kept for a few seconds instead of asking the database each time."""

import threading
import time

from d4rk.Logs import setup_logger

logger = setup_logger("server_settings")

DEFAULTS = {
    # Compress to ZIP, Extract and Look inside: they use the server's disk and CPU for a long time
    "archives_enabled": True,
}
CACHE_SECONDS = 30

_lock = threading.Lock()
_cache = {"value": None, "at": 0.0}


def _coll():
    from telestore.services.remote_transfer_manager.helpers import get_remote_db
    return get_remote_db()["ServerSettings"]


def get() -> dict:
    with _lock:
        if _cache["value"] is not None and time.monotonic() - _cache["at"] < CACHE_SECONDS:
            return dict(_cache["value"])
    try:
        doc = _coll().find_one({"_id": "server"}) or {}
    except Exception as e:  # the database being away must not lock everyone out
        logger.warning(f"Couldn't read server settings: {e}")
        doc = {}
    value = {k: doc.get(k, v) for k, v in DEFAULTS.items()}
    with _lock:
        _cache.update(value=value, at=time.monotonic())
    return dict(value)


def update(**changes) -> dict:
    changes = {k: v for k, v in changes.items() if k in DEFAULTS and v is not None}
    if changes:
        _coll().update_one({"_id": "server"}, {"$set": changes}, upsert=True)
        logger.info(f"Server settings changed: {changes}")
    with _lock:
        _cache.update(value=None, at=0.0)
    return get()
