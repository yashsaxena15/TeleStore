# telestore/services/device_service.py
"""Your devices: every sign-in (app or browser) with its name and when it was last used, and
signing one out from another device.

Each sign-in is a row in AuthTokens. Devices are named by a short id made from the token (the
token itself never leaves the server). A website sign-in also has a cookie session; it carries
the same id, so signing that browser out ends the cookie too.
"""

import hashlib
import time
from datetime import datetime
from typing import Optional

from d4rk.Logs import setup_logger

logger = setup_logger("device_service")

SESSION_KEY = "token_id"
# "Last active" is saved at most this often per device
TOUCH_EVERY = 300
# A cookie session's sign-in is looked up again after this long (signing out clears it at once)
SESSION_RECHECK = 60

_session_checks: dict = {}  # token id -> (still signed in, when checked)


def token_id(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()[:20]


def _tokens():
    from telestore.db import database
    return database.Users.database.AuthTokens


def touch(token: str, cached: dict) -> None:
    """Records that this device was just used (at most every few minutes)."""
    now = time.monotonic()
    # (monotonic counts from boot, so "never saved" must not look like "saved at 0")
    if cached.get("_touched") is not None and now - cached["_touched"] < TOUCH_EVERY:
        return
    cached["_touched"] = now
    try:
        _tokens().update_one({"auth_token": token}, {"$set": {"last_seen": datetime.now()}})
    except Exception as e:
        logger.warning(f"Couldn't record last use: {e}")


def session_valid(request) -> bool:
    """False when the sign-in behind this browser's cookie was signed out from another device."""
    tid = request.session.get(SESSION_KEY)
    if not tid:
        # A session from before devices existed: adopt the token the website sends with it
        token = request.headers.get("X-Auth-Token")
        if token:
            request.session[SESSION_KEY] = token_id(token)
        return True
    valid, checked = _session_checks.get(tid, (None, 0))
    if valid is None or time.monotonic() - checked > SESSION_RECHECK:
        try:
            valid = _find(request.session.get("username"), tid) is not None
        except Exception:
            valid = True  # the database is unreachable: don't sign anyone out for that
        _session_checks[tid] = (valid, time.monotonic())
    return valid


def current_id(request) -> Optional[str]:
    token = request.headers.get("X-Auth-Token") or request.query_params.get("token")
    return token_id(token) if token else request.session.get(SESSION_KEY)


def _rows(username: str):
    return _tokens().find({"username": username, "expires_at": {"$gte": datetime.now()}})


def _find(username: Optional[str], tid: str) -> Optional[dict]:
    if not username:
        return None
    return next((d for d in _rows(username) if (d.get("token_id") or token_id(d["auth_token"])) == tid), None)


def _name(doc: dict) -> str:
    if doc.get("device_name"):
        return doc["device_name"]
    if doc.get("device"):
        return f"{doc['device'].capitalize()} app"
    return "Unknown device (signed in before this update)"


def _iso(value) -> Optional[str]:
    return value.isoformat(timespec="seconds") if isinstance(value, datetime) else None


def listing(username: str, current: Optional[str]) -> list:
    """This account's signed-in devices: this one first, then the most recently used."""
    devices = []
    for doc in _rows(username):
        tid = doc.get("token_id") or token_id(doc["auth_token"])
        devices.append({
            "id": tid,
            "name": _name(doc),
            "kind": "app" if doc.get("device") else "browser",
            "method": "google" if doc.get("auth_method") == "google" else "password",
            "signed_in_at": _iso(doc.get("created_at")),
            "last_seen": _iso(doc.get("last_seen") or doc.get("created_at")),
            "current": tid == current,
        })
    devices.sort(key=lambda d: (not d["current"], -(datetime.fromisoformat(d["last_seen"]).timestamp() if d["last_seen"] else 0)))
    return devices


def sign_out(username: str, tid: str) -> bool:
    """Ends one sign-in: its token stops working and its browser cookie with it."""
    from telestore.api.state import _auth_tokens
    doc = _find(username, tid)
    if not doc:
        return False
    _tokens().delete_one({"_id": doc["_id"]})
    _auth_tokens.pop(doc["auth_token"], None)
    _session_checks[tid] = (False, time.monotonic())
    logger.info(f"Signed out device {tid} of {username}")
    return True


def sign_out_others(username: str, current: Optional[str]) -> int:
    ids = [d["id"] for d in listing(username, current) if not d["current"]]
    return sum(1 for tid in ids if sign_out(username, tid))
