# telestore/api/routes/webdav/common.py

import base64
import hashlib
import hmac
import threading
import time
import urllib.parse
from datetime import datetime, timezone
from email.utils import format_datetime
from xml.sax.saxutils import escape as xml_escape
from typing import Optional, Tuple, Dict, Any, List

from fastapi import APIRouter, Request, HTTPException

from telestore.db import database
from telestore.config import OWNER, LOGS, MOVIE, GROUP, FILTER_CHAT, SESSION_SECRET_KEY, STORAGE_QUOTA_BYTES
from telestore.security.credentials import check_login
from telestore.security.attempt_limiter import TooManyAttempts
from d4rk.Logs import setup_logger

logger = setup_logger("webdav_routes")

router = APIRouter(prefix="/webdav", tags=["WebDAV"])

VIRTUAL_TOP_LEVEL = ["Home", "Telegram Inbox", "Starred", "Trash"]


def format_dav_date(dt: Optional[Any] = None) -> str:
    """Format datetime into standard RFC 1123 format for WebDAV."""
    if not dt:
        dt = datetime.now(timezone.utc)
    elif isinstance(dt, str):
        try:
            dt = datetime.fromisoformat(dt.replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
        except Exception:
            dt = datetime.now(timezone.utc)
    elif isinstance(dt, datetime):
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
    return format_datetime(dt, usegmt=True)


def parse_webdav_path(raw_path: str) -> List[str]:
    """Clean and decompose WebDAV URI path into logical segments."""
    unquoted = urllib.parse.unquote(raw_path or "")
    # Remove prefix if present
    if unquoted.startswith("/webdav"):
        unquoted = unquoted[len("/webdav"):]
    segments = [s for s in unquoted.strip("/").split("/") if s]
    return segments


# Explorer and Finder send many small requests, each with the password. Checking it costs ~90 ms
# of scrypt plus database reads, so a successful sign-in is remembered for a few minutes, keyed
# by an HMAC of the header (the password itself is never kept). A password change clears it;
# a turned-off account is still refused at once (its flags are read on every request).
LOGIN_CACHE_SECONDS = 300
_login_cache: Dict[str, Tuple[str, float]] = {}
_login_cache_lock = threading.Lock()


def _login_key(auth_header: str) -> str:
    return hmac.new(SESSION_SECRET_KEY.encode(), auth_header.encode(), hashlib.sha256).hexdigest()


def forget_webdav_logins() -> None:
    """Call when any password changes, so old passwords stop working for WebDAV right away."""
    with _login_cache_lock:
        _login_cache.clear()


def _remembered_login(auth_header: str) -> Optional[str]:
    key = _login_key(auth_header)
    with _login_cache_lock:
        hit = _login_cache.get(key)
        if hit and hit[1] > time.time():
            return hit[0]
        _login_cache.pop(key, None)
    return None


def _remember_login(auth_header: str, account: str) -> None:
    with _login_cache_lock:
        if len(_login_cache) > 1000:
            _login_cache.clear()
        _login_cache[_login_key(auth_header)] = (account, time.time() + LOGIN_CACHE_SECONDS)


def authenticate_webdav(request: Request) -> Tuple[Dict[str, Any], str, Optional[int]]:
    """
    Authenticate WebDAV request via HTTP Basic Auth.
    Returns (user_data, owner_id, chat_id).
    """
    auth_header = request.headers.get("Authorization", "")
    token_query = request.query_params.get("token")

    username = None
    password = None

    if auth_header.startswith("Basic "):
        try:
            encoded = auth_header[6:].strip()
            decoded = base64.b64decode(encoded).decode("utf-8", errors="ignore")
            if ":" in decoded:
                username, password = decoded.split(":", 1)
        except Exception as e:
            logger.warning(f"[WEBDAV] Failed to decode Basic Auth: {e}")

    # Fallback to query token if provided
    if not username and token_query:
        # Check token in database
        token_doc = database.Users.get_auth_token(token_query) if hasattr(database, "Users") else None
        if token_doc:
            username = token_doc.get("username")
            user_data = database.Users.getUser(username) if hasattr(database, "Users") else None
            if user_data:
                owner_id = str(user_data.get("telegram_user_id") or user_data.get("username") or OWNER)
                chat_id = user_data.get("index_chat_id")
                return user_data, owner_id, chat_id

    try:
        account = _remembered_login(auth_header) if auth_header.startswith("Basic ") else None
        from_cache = bool(account)
        if not account and username and password:
            account = check_login(username, password)
            if account:
                _remember_login(auth_header, account)
        signed_in = bool(account)
        if account:
            username = account
    except TooManyAttempts as e:
        raise HTTPException(status_code=429, detail="Too many failed sign-ins", headers={"Retry-After": str(e.retry_after)})
    if not signed_in:
        raise HTTPException(
            status_code=401,
            detail="Unauthorized",
            headers={"WWW-Authenticate": 'Basic realm="TeleStore WebDAV"'}
        )

    # Resolve user metadata
    user_data = database.Users.getUser(username) if hasattr(database, "Users") else None
    if not user_data and from_cache:
        # Removed since the sign-in was remembered: never fall back to the owner's identity below
        forget_webdav_logins()
        raise HTTPException(status_code=401, detail="Unauthorized", headers={"WWW-Authenticate": 'Basic realm="TeleStore WebDAV"'})
    if not user_data:
        user_data = {"username": username, "telegram_user_id": OWNER}

    owner_id = str(user_data.get("telegram_user_id") or user_data.get("username") or OWNER)
    chat_id = user_data.get("index_chat_id")
    if not chat_id:
        chat_id = [c for c in [LOGS, MOVIE, GROUP, FILTER_CHAT] if c is not None][0] if [c for c in [LOGS, MOVIE, GROUP, FILTER_CHAT] if c is not None] else None

    return user_data, owner_id, chat_id


QUOTA_CACHE_SECONDS = 60
_quota_cache: Dict[str, Tuple[int, float]] = {}


def storage_quota(owner_id: str) -> Tuple[int, int]:
    """(used, available) bytes for the WebDAV quota properties (RFC 4331). Cached for a minute:
    Explorer and Finder ask for it with nearly every folder they open."""
    hit = _quota_cache.get(owner_id)
    if hit and hit[1] > time.time():
        used = hit[0]
    else:
        try:
            used = database.Files.used_bytes(owner_id)
        except Exception as e:
            logger.warning(f"[WEBDAV] Couldn't total storage for quota: {e}")
            used = hit[0] if hit else 0
        _quota_cache[owner_id] = (used, time.time() + QUOTA_CACHE_SECONDS)
    return used, max(0, STORAGE_QUOTA_BYTES - used)


def quota_props(owner_id: str) -> str:
    used, available = storage_quota(owner_id)
    return (f"\n        <D:quota-available-bytes>{available}</D:quota-available-bytes>"
            f"\n        <D:quota-used-bytes>{used}</D:quota-used-bytes>")


COLLECTION_TYPE = "<D:resourcetype><D:collection/></D:resourcetype>"


def build_response_xml(href: str, display_name: str, is_collection: bool, size: int = 0, mime_type: str = "application/octet-stream", modified: Optional[str] = None) -> str:
    """Build a single <D:response> block for WebDAV 207 Multi-Status."""
    encoded_href = urllib.parse.quote(href, safe="/")
    escaped_name = xml_escape(display_name or "")
    date_str = format_dav_date(modified)

    if is_collection:
        prop_block = f"""        <D:displayname>{escaped_name}</D:displayname>
        <D:resourcetype><D:collection/></D:resourcetype>
        <D:getlastmodified>{date_str}</D:getlastmodified>"""
    else:
        prop_block = f"""        <D:displayname>{escaped_name}</D:displayname>
        <D:resourcetype/>
        <D:getcontentlength>{size}</D:getcontentlength>
        <D:getcontenttype>{mime_type}</D:getcontenttype>
        <D:getlastmodified>{date_str}</D:getlastmodified>"""

    return f"""  <D:response>
    <D:href>{encoded_href}</D:href>
    <D:propstat>
      <D:prop>
{prop_block}
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>"""
