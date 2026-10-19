# telestore/api/routes/webdav/propfind.py

import mimetypes
from typing import List

from fastapi import Request, Response, HTTPException

from telestore.db import database

# --- Handler Implementations ---

from telestore.api.routes.webdav.common import VIRTUAL_TOP_LEVEL, build_response_xml

async def handle_propfind(request: Request, segments: List[str], owner_id: str) -> Response:
    """Handle WebDAV PROPFIND directory and file enumeration."""
    depth = request.headers.get("Depth", "1")
    responses_xml = []

    # Case A: Root (/webdav/)
    if len(segments) == 0:
        responses_xml.append(build_response_xml("/webdav/", "WebDAV Root", is_collection=True))
        if depth == "1":
            for top in VIRTUAL_TOP_LEVEL:
                responses_xml.append(build_response_xml(f"/webdav/{top}/", top, is_collection=True))

    # Case B: Top-level Virtual Folders (/webdav/Home, /webdav/Telegram Inbox, etc.)
    elif len(segments) == 1 and segments[0] in VIRTUAL_TOP_LEVEL:
        top_name = segments[0]
        responses_xml.append(build_response_xml(f"/webdav/{top_name}/", top_name, is_collection=True))

        if depth == "1":
            if top_name == "Home":
                # User-created folders in Home root
                folders = list(database.Files.find({
                    "file_type": "folder",
                    "file_path": {"$in": ["/Home", "/"]},
                    "owner_id": owner_id,
                    "trashed": {"$ne": True}
                }))
                for fol in folders:
                    fol_name = fol.get("file_name", "Folder")
                    responses_xml.append(build_response_xml(
                        f"/webdav/Home/{fol_name}/",
                        fol_name,
                        is_collection=True,
                        modified=fol.get("modified_date")
                    ))

                # Files in Home root
                files = list(database.Files.find({
                    "file_type": {"$ne": "folder"},
                    "file_path": {"$in": ["/Home", "/"]},
                    "owner_id": owner_id,
                    "trashed": {"$ne": True}
                }))
                for f in files:
                    fname = f.get("file_name", "File")
                    mimetype, _ = mimetypes.guess_type(fname)
                    responses_xml.append(build_response_xml(
                        f"/webdav/Home/{fname}",
                        fname,
                        is_collection=False,
                        size=f.get("file_size", 0),
                        mime_type=mimetype or "application/octet-stream",
                        modified=f.get("modified_date")
                    ))

            elif top_name == "Telegram Inbox":
                files = list(database.Files.find({
                    "file_path": "/Telegram Inbox",
                    "owner_id": owner_id,
                    "trashed": {"$ne": True}
                }))
                for f in files:
                    fname = f.get("file_name", "File")
                    mimetype, _ = mimetypes.guess_type(fname)
                    responses_xml.append(build_response_xml(
                        f"/webdav/Telegram Inbox/{fname}",
                        fname,
                        is_collection=False,
                        size=f.get("file_size", 0),
                        mime_type=mimetype or "application/octet-stream",
                        modified=f.get("modified_date")
                    ))

            elif top_name == "Starred":
                items = list(database.Files.find({
                    "starred": True,
                    "owner_id": owner_id,
                    "trashed": {"$ne": True},
                    "is_vault": {"$ne": True}
                }))
                for item in items:
                    iname = item.get("file_name", "Item")
                    is_fol = item.get("file_type") == "folder"
                    mimetype, _ = mimetypes.guess_type(iname)
                    responses_xml.append(build_response_xml(
                        f"/webdav/Starred/{iname}/" if is_fol else f"/webdav/Starred/{iname}",
                        iname,
                        is_collection=is_fol,
                        size=item.get("file_size", 0),
                        mime_type=mimetype or "application/octet-stream",
                        modified=item.get("modified_date")
                    ))

            elif top_name == "Trash":
                items = list(database.Files.find({
                    "trashed": True,
                    "owner_id": owner_id,
                    "is_vault": {"$ne": True}
                }))
                for item in items:
                    iname = item.get("file_name", "Item")
                    is_fol = item.get("file_type") == "folder"
                    mimetype, _ = mimetypes.guess_type(iname)
                    responses_xml.append(build_response_xml(
                        f"/webdav/Trash/{iname}/" if is_fol else f"/webdav/Trash/{iname}",
                        iname,
                        is_collection=is_fol,
                        size=item.get("file_size", 0),
                        mime_type=mimetype or "application/octet-stream",
                        modified=item.get("trashed_at") or item.get("modified_date")
                    ))

    # Case C: Subfolders and Files inside Home or other sections
    else:
        top_name = segments[0]
        if top_name == "Home":
            # Determine path in database
            target_subpath = "/" + "/".join(segments)
            parent_db_path = "/" + "/".join(segments[:-1])
            target_name = segments[-1]

            # 1. Check if target is a folder
            folder_doc = database.Files.find_one({
                "file_type": "folder",
                "file_name": target_name,
                "file_path": parent_db_path if parent_db_path != "/Home" else {"$in": ["/Home", "/"]},
                "owner_id": owner_id,
                "trashed": {"$ne": True}
            })

            if folder_doc:
                # Target is a folder
                responses_xml.append(build_response_xml(
                    f"/webdav/{'/'.join(segments)}/",
                    target_name,
                    is_collection=True,
                    modified=folder_doc.get("modified_date")
                ))

                if depth == "1":
                    # List subfolders inside this folder
                    subfolders = list(database.Files.find({
                        "file_type": "folder",
                        "file_path": target_subpath,
                        "owner_id": owner_id,
                        "trashed": {"$ne": True}
                    }))
                    for sf in subfolders:
                        sf_name = sf.get("file_name", "Folder")
                        responses_xml.append(build_response_xml(
                            f"/webdav/{'/'.join(segments)}/{sf_name}/",
                            sf_name,
                            is_collection=True,
                            modified=sf.get("modified_date")
                        ))

                    # List files inside this folder
                    subfiles = list(database.Files.find({
                        "file_type": {"$ne": "folder"},
                        "file_path": target_subpath,
                        "owner_id": owner_id,
                        "trashed": {"$ne": True}
                    }))
                    for sf in subfiles:
                        sf_name = sf.get("file_name", "File")
                        mimetype, _ = mimetypes.guess_type(sf_name)
                        responses_xml.append(build_response_xml(
                            f"/webdav/{'/'.join(segments)}/{sf_name}",
                            sf_name,
                            is_collection=False,
                            size=sf.get("file_size", 0),
                            mime_type=mimetype or "application/octet-stream",
                            modified=sf.get("modified_date")
                        ))
            else:
                # 2. Check if target is a file
                file_doc = database.Files.find_one({
                    "file_type": {"$ne": "folder"},
                    "file_name": target_name,
                    "file_path": parent_db_path if parent_db_path != "/Home" else {"$in": ["/Home", "/"]},
                    "owner_id": owner_id,
                    "trashed": {"$ne": True}
                })
                if not file_doc:
                    raise HTTPException(status_code=404, detail="Item not found")

                mimetype, _ = mimetypes.guess_type(target_name)
                responses_xml.append(build_response_xml(
                    f"/webdav/{'/'.join(segments)}",
                    target_name,
                    is_collection=False,
                    size=file_doc.get("file_size", 0),
                    mime_type=mimetype or "application/octet-stream",
                    modified=file_doc.get("modified_date")
                ))

        elif top_name == "Telegram Inbox":
            fname = segments[-1]
            file_doc = database.Files.find_one({
                "file_path": "/Telegram Inbox",
                "file_name": fname,
                "owner_id": owner_id,
                "trashed": {"$ne": True}
            })
            if not file_doc:
                raise HTTPException(status_code=404, detail="File not found")
            mimetype, _ = mimetypes.guess_type(fname)
            responses_xml.append(build_response_xml(
                f"/webdav/Telegram Inbox/{fname}",
                fname,
                is_collection=False,
                size=file_doc.get("file_size", 0),
                mime_type=mimetype or "application/octet-stream",
                modified=file_doc.get("modified_date")
            ))
        else:
            raise HTTPException(status_code=404, detail="Path not found")

    full_xml = f"""<?xml version="1.0" encoding="utf-8"?>
<D:multistatus xmlns:D="DAV:">
{chr(10).join(responses_xml)}
</D:multistatus>"""

    return Response(
        content=full_xml,
        status_code=207,
        media_type="application/xml; charset=utf-8"
    )
