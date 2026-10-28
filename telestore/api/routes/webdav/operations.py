# telestore/api/routes/webdav/operations.py

import urllib.parse
import secrets
from datetime import datetime, timezone
from typing import List

from fastapi import Request, Response, HTTPException

from telestore.db import database
import re

from telestore.api.routes.webdav.common import logger, parse_webdav_path

async def handle_mkcol(request: Request, segments: List[str], owner_id: str) -> Response:
    """Handle WebDAV directory creation via MKCOL."""
    if len(segments) < 2:
        raise HTTPException(status_code=403, detail="Cannot create folders in root")

    if segments[0] != "Home":
        raise HTTPException(status_code=403, detail="Folders can only be created inside Home")

    new_folder_name = segments[-1]
    parent_folder_path = "/" + "/".join(segments[:-1])

    success = database.Files.add_folder(
        folder_name=new_folder_name,
        folder_path=parent_folder_path,
        owner_id=owner_id
    )
    if not success:
        return Response(status_code=200)  # Folder already exists

    return Response(status_code=201)


def _refuse_protected(item: dict, owner_id: str) -> None:
    """WebDAV apps can't ask for the password, so protected items can't be deleted through them."""
    from telestore.services.protection_service import blocker
    reason = blocker(item, [owner_id])
    if reason:
        raise HTTPException(status_code=403, detail=reason)


async def handle_delete(request: Request, segments: List[str], owner_id: str) -> Response:
    """Handle WebDAV item deletion via DELETE."""
    if len(segments) < 2:
        raise HTTPException(status_code=403, detail="Cannot delete top-level folders")

    top_name = segments[0]
    target_name = segments[-1]

    if top_name == "Trash":
        # Permanently purge from database and delete Telegram messages
        item = database.Files.find_one({"file_name": target_name, "trashed": True, "owner_id": owner_id, "is_vault": {"$ne": True}})
        if item:
            _refuse_protected(item, owner_id)
            from collections import defaultdict
            messages_to_delete = defaultdict(set)
            
            def collect_file_messages(doc):
                c_id = doc.get("chat_id")
                m_id = doc.get("message_id")
                if c_id and m_id:
                    messages_to_delete[c_id].add(m_id)
                for part in doc.get("parts") or []:  # every part, even if is_split is missing
                    p_mid = part.get("message_id")
                    if p_mid and c_id:
                        messages_to_delete[c_id].add(p_mid)

            if item.get("file_type") == "folder":
                folder_name = item.get("file_name", "")
                orig_path = item.get("original_path") or item.get("file_path", "/")
                if orig_path in ["/", ""]:
                    f_full = f"/{folder_name}"
                else:
                    f_full = f"{orig_path.rstrip('/')}/{folder_name}"
                
                content_query = {
                    "$or": [
                        {"file_path": f_full},
                        {"file_path": {"$regex": f"^{re.escape(f_full)}/"}}
                    ],
                    "owner_id": owner_id
                }
                for child_doc in database.Files.find(content_query):
                    collect_file_messages(child_doc)
                database.Files.delete_many(content_query)
            else:
                collect_file_messages(item)
            
            database.Files.delete_one({"_id": item["_id"]})
            messages_to_delete = database.Files.unreferenced_messages(messages_to_delete)

            if messages_to_delete:
                try:
                    bot_manager = getattr(request.app.state, 'bot_manager', None)
                    client = bot_manager.get_least_busy_client() if (bot_manager and hasattr(bot_manager, 'get_least_busy_client')) else None
                    if not client and bot_manager and hasattr(bot_manager, 'client_list') and bot_manager.client_list:
                        client = bot_manager.client_list[0]
                    if client:
                        for c_id, m_ids in messages_to_delete.items():
                            m_list = list(m_ids)
                            for i in range(0, len(m_list), 100):
                                batch = m_list[i:i+100]
                                try:
                                    await client.delete_messages(chat_id=c_id, message_ids=batch)
                                except Exception:
                                    pass
                except Exception:
                    pass

        return Response(status_code=204)

    # For Home or Telegram Inbox: Move to Trash
    parent_path = "/" + "/".join(segments[:-1])
    item = database.Files.find_one({
        "file_name": target_name,
        "file_path": parent_path if parent_path != "/Home" else {"$in": ["/Home", "/"]},
        "owner_id": owner_id,
        "trashed": {"$ne": True}
    })
    if not item and top_name == "Telegram Inbox":
        item = database.Files.find_one({
            "file_name": target_name,
            "file_path": "/Telegram Inbox",
            "owner_id": owner_id,
            "trashed": {"$ne": True}
        })

    if item:
        _refuse_protected(item, owner_id)
        database.Files.move_to_trash(str(item["_id"]), owner_id)
        return Response(status_code=204)

    raise HTTPException(status_code=404, detail="Item not found")


async def handle_move(request: Request, segments: List[str], owner_id: str) -> Response:
    """Handle WebDAV file/folder renaming and movement via MOVE."""
    dest_header = request.headers.get("Destination", "")
    if not dest_header:
        raise HTTPException(status_code=400, detail="Missing Destination header")

    dest_url = urllib.parse.urlparse(dest_header)
    dest_segments = parse_webdav_path(dest_url.path)

    if len(segments) < 2 or len(dest_segments) < 2:
        raise HTTPException(status_code=403, detail="Cannot move top-level virtual directories")

    source_top = segments[0]
    source_name = segments[-1]
    dest_top = dest_segments[0]
    dest_name = dest_segments[-1]

    # Resolve source document
    source_parent = "/" + "/".join(segments[:-1])
    source_doc = database.Files.find_one({
        "file_name": source_name,
        "file_path": source_parent if source_parent != "/Home" else {"$in": ["/Home", "/"]},
        "owner_id": owner_id,
        "trashed": {"$ne": True}
    })
    if not source_doc and source_top == "Telegram Inbox":
        source_doc = database.Files.find_one({
            "file_name": source_name,
            "file_path": "/Telegram Inbox",
            "owner_id": owner_id,
            "trashed": {"$ne": True}
        })

    if not source_doc:
        raise HTTPException(status_code=404, detail="Source item not found")

    dest_parent_path = "/" + "/".join(dest_segments[:-1])
    if dest_top == "Telegram Inbox":
        dest_parent_path = "/Telegram Inbox"

    # If it's a folder rename/move:
    if source_doc.get("file_type") == "folder":
        old_folder_path = "/" + "/".join(segments)
        new_folder_path = "/" + "/".join(dest_segments)

        database.Files.update_one(
            {"_id": source_doc["_id"]},
            {"$set": {
                "file_name": dest_name,
                "file_path": dest_parent_path,
                "modified_date": datetime.now(timezone.utc).isoformat()
            }}
        )

        # Recursively update all child files and subfolders
        database.Files.update_many(
            {"file_path": old_folder_path, "owner_id": owner_id},
            {"$set": {"file_path": new_folder_path}}
        )
        database.Files.update_many(
            {"file_path": {"$regex": f"^{re.escape(old_folder_path)}/"}, "owner_id": owner_id},
            [{"$set": {"file_path": {"$replaceOne": {"input": "$file_path", "find": old_folder_path, "replacement": new_folder_path}}}}]
        )
    else:
        # File move or rename
        database.Files.update_one(
            {"_id": source_doc["_id"]},
            {"$set": {
                "file_name": dest_name,
                "file_path": dest_parent_path,
                "modified_date": datetime.now(timezone.utc).isoformat()
            }}
        )

    logger.info(f"[WEBDAV_MOVE] Moved '{source_name}' to '{dest_parent_path}/{dest_name}'")
    return Response(status_code=201)


async def handle_copy(request: Request, segments: List[str], owner_id: str) -> Response:
    """Handle WebDAV file copy via COPY."""
    dest_header = request.headers.get("Destination", "")
    if not dest_header:
        raise HTTPException(status_code=400, detail="Missing Destination header")

    dest_url = urllib.parse.urlparse(dest_header)
    dest_segments = parse_webdav_path(dest_url.path)
    if len(dest_segments) < 2:
        raise HTTPException(status_code=403, detail="Invalid destination path")

    source_name = segments[-1]
    source_parent = "/" + "/".join(segments[:-1])
    dest_name = dest_segments[-1]
    dest_parent = "/" + "/".join(dest_segments[:-1])

    source_doc = database.Files.find_one({
        "file_name": source_name,
        "file_path": source_parent if source_parent != "/Home" else {"$in": ["/Home", "/"]},
        "owner_id": owner_id,
        "trashed": {"$ne": True}
    })
    if not source_doc:
        raise HTTPException(status_code=404, detail="Source file not found")

    new_doc = dict(source_doc)
    new_doc.pop("_id", None)
    new_doc["file_name"] = dest_name
    new_doc["file_path"] = dest_parent
    new_doc["modified_date"] = datetime.now(timezone.utc).isoformat()

    database.Files.insert_one(new_doc)
    return Response(status_code=201)


def handle_lock(request: Request) -> Response:
    """Satisfy WebDAV LOCK requests from RaiDrive, Windows Explorer, and Microsoft Office."""
    lock_token = f"urn:uuid:{secrets.token_hex(16)}"
    xml = f"""<?xml version="1.0" encoding="utf-8"?>
<D:prop xmlns:D="DAV:">
  <D:lockdiscovery>
    <D:activelock>
      <D:locktype><D:write/></D:locktype>
      <D:lockscope><D:exclusive/></D:lockscope>
      <D:depth>0</D:depth>
      <D:timeout>Second-3600</D:timeout>
      <D:locktoken>
        <D:href>{lock_token}</D:href>
      </D:locktoken>
      <D:lockroot>
        <D:href>{request.url.path}</D:href>
      </D:lockroot>
    </D:activelock>
  </D:lockdiscovery>
</D:prop>"""
    return Response(
        content=xml,
        status_code=200,
        media_type="application/xml; charset=utf-8",
        headers={"Lock-Token": f"<{lock_token}>"}
    )


def handle_proppatch(request: Request) -> Response:
    """Acknowledge PROPPATCH attributes."""
    xml = f"""<?xml version="1.0" encoding="utf-8"?>
<D:multistatus xmlns:D="DAV:">
  <D:response>
    <D:href>{request.url.path}</D:href>
    <D:propstat>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
</D:multistatus>"""
    return Response(
        content=xml,
        status_code=207,
        media_type="application/xml; charset=utf-8"
    )
