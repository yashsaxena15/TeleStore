# telestore/api/routes/webdav/common.py

import base64
import urllib.parse
from datetime import datetime, timezone
from email.utils import format_datetime
from xml.sax.saxutils import escape as xml_escape
from typing import Optional, Tuple, Dict, Any, List

from fastapi import APIRouter, Request, HTTPException

from telestore.db import database
from telestore.config import OWNER, LOGS, MOVIE, GROUP, FILTER_CHAT
from telestore.security.credentials import verify_credentials
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

    if not username or not password or not verify_credentials(username, password):
        raise HTTPException(
            status_code=401,
            detail="Unauthorized",
            headers={"WWW-Authenticate": 'Basic realm="TeleStore WebDAV"'}
        )

    # Resolve user metadata
    user_data = database.Users.getUser(username) if hasattr(database, "Users") else None
    if not user_data:
        user_data = {"username": username, "telegram_user_id": OWNER}

    owner_id = str(user_data.get("telegram_user_id") or user_data.get("username") or OWNER)
    chat_id = user_data.get("index_chat_id")
    if not chat_id:
        chat_id = [c for c in [LOGS, MOVIE, GROUP, FILTER_CHAT] if c is not None][0] if [c for c in [LOGS, MOVIE, GROUP, FILTER_CHAT] if c is not None] else None

    return user_data, owner_id, chat_id


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
