"""Sharing routes: the Share dialog, Shared with me / by me, shared folders, and public links.

- /shares/item/{item_id}…   the owner manages an item's link and people (the Share dialog)
- /shares/mine, /with-me    Shared by me, Shared with me
- /shares/{share_id}/…      a member opens a share; editors also change a shared folder
- /share-links/{token}/…    anyone with the link (no sign-in), view-only

The rules live in services/share_service.py; streaming, zips and previews reuse the code the
owner's own files use.
"""

import asyncio
import html
import re
import urllib.parse
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import FileResponse, JSONResponse, Response
from pydantic import BaseModel

from d4rk.Logs import setup_logger
from telestore.security.attempt_limiter import AttemptLimiter, TooManyAttempts, wait_message
from telestore.security.credentials import User, require_auth
from telestore.services import event_service
from telestore.services import share_service as shares
from telestore.services.share_service import ShareError

logger = setup_logger("share_routes")

router = APIRouter(tags=["Sharing"])

# Wrong link addresses from one place: a few are typos, many are guessing
link_limiter = AttemptLimiter(free_attempts=20, base_lock=30, max_lock=900)

PUBLIC_HEADERS = {"X-Robots-Tag": "noindex, nofollow", "Referrer-Policy": "no-referrer"}


def _fail(e: ShareError) -> HTTPException:
    return HTTPException(status_code=e.status, detail=str(e))


class LinkSettings(BaseModel):
    enabled: bool = True
    allow_download: Optional[bool] = None
    expires_at: Optional[datetime] = None  # with clear_expiry false; null keeps the current one
    clear_expiry: bool = False
    max_downloads: Optional[int] = None
    clear_limit: bool = False


class AddMember(BaseModel):
    who: str  # a username or email
    role: str = "viewer"


class MemberRole(BaseModel):
    role: str


class NewFolder(BaseModel):
    path: str = ""  # inside the share
    name: str


class RenameItem(BaseModel):
    file_id: str
    new_name: str


class MoveItem(BaseModel):
    file_id: str
    target_path: str  # inside the share


class TrashItem(BaseModel):
    file_id: str


# ── The Share dialog (the item's owner) ────────────────────────────────────

@router.get("/shares/item/{item_id}")
async def share_dialog(item_id: str, user: User = Depends(require_auth)):
    try:
        return shares.get_view(item_id, user)
    except ShareError as e:
        raise _fail(e)


@router.put("/shares/item/{item_id}/link")
async def update_link(item_id: str, body: LinkSettings, user: User = Depends(require_auth)):
    try:
        return shares.set_link(item_id, user, body.enabled, body.allow_download, body.expires_at,
                               body.max_downloads, body.clear_expiry, body.clear_limit)
    except ShareError as e:
        raise _fail(e)


@router.post("/shares/item/{item_id}/link/reset")
async def reset_link(item_id: str, user: User = Depends(require_auth)):
    try:
        return shares.reset_link(item_id, user)
    except ShareError as e:
        raise _fail(e)


def _site(request: Request) -> str:
    proto = request.headers.get("x-forwarded-proto") or request.url.scheme
    host = request.headers.get("x-forwarded-host") or request.headers.get("host") or request.url.netloc
    return f"{proto}://{host}"


async def _email(to: str, subject: str, text: str, url: str) -> None:
    try:
        from telestore.services.email_service import send_email_async
        body = (f"<p>{html.escape(text)}</p><p><a href=\"{html.escape(url)}\">Open in TeleStore</a></p>")
        await send_email_async(to, subject, body, f"{text}\n\n{url}")
    except Exception as e:
        logger.warning(f"Couldn't email a share invite: {e}")


def _tell_member(request: Request, user: User, account: dict, view: dict, role: str) -> None:
    """A notification (and an email, when the account has one) for someone just given access."""
    sharer = shares.display_name({"username": user.username, "telegram_first_name": user.telegram_first_name,
                                  "telegram_last_name": user.telegram_last_name})
    name = view["item"]["name"]
    member_id = str(account["telegram_user_id"]) if account.get("telegram_user_id") else account.get("username")
    what = "folder" if view["item"]["type"] == "folder" else "file"
    title = f"{sharer} shared a {what} with you"
    body = f"“{name}” ({'can edit' if role == 'editor' else 'can view'})"
    event_service.record(member_id, "share", title, body, {"type": "shared", "share_id": view["share_id"]})
    if account.get("email"):
        url = f"{_site(request)}/shared-with-me"
        asyncio.create_task(_email(account["email"], title, f"{title}: {body}.", url))


@router.post("/shares/item/{item_id}/members")
async def add_member(item_id: str, body: AddMember, request: Request, user: User = Depends(require_auth)):
    try:
        view, added = shares.add_member(item_id, user, body.who, body.role)
    except ShareError as e:
        raise _fail(e)
    if added:
        _tell_member(request, user, added, view, body.role)
    return view


@router.patch("/shares/item/{item_id}/members/{member_id}")
async def change_member(item_id: str, member_id: str, body: MemberRole, user: User = Depends(require_auth)):
    try:
        return shares.set_member_role(item_id, user, member_id, body.role)
    except ShareError as e:
        raise _fail(e)


@router.delete("/shares/item/{item_id}/members/{member_id}")
async def remove_member(item_id: str, member_id: str, user: User = Depends(require_auth)):
    try:
        return shares.remove_member(item_id, user, member_id)
    except ShareError as e:
        raise _fail(e)


@router.delete("/shares/item/{item_id}")
async def stop_sharing(item_id: str, user: User = Depends(require_auth)):
    try:
        return shares.stop_sharing(item_id, user)
    except ShareError as e:
        raise _fail(e)


@router.get("/shares/mine")
async def shared_by_me(user: User = Depends(require_auth)):
    return {"shares": shares.mine(user)}


@router.get("/shares/with-me")
async def shared_with_me(user: User = Depends(require_auth)):
    return {"shares": shares.with_me(user)}


# ── Opening shared files (members and links) ───────────────────────────────

def _first_bytes(request: Request) -> bool:
    """A request that starts reading a file from its beginning (counts as one download)."""
    rng = request.headers.get("Range", "")
    return not rng or bool(re.match(r"^\s*bytes=0-", rng))


async def _stream(request: Request, doc: dict, inline: bool, link_share: Optional[dict] = None):
    from telestore.api.routes.stream import stream_document
    if doc.get("file_type") == "folder":
        raise HTTPException(status_code=400, detail="That's a folder. Download it as a zip instead.")
    if link_share is not None and not inline:
        if not (link_share.get("link") or {}).get("allow_download", True):
            raise HTTPException(status_code=403, detail="The owner turned off downloads for this link.")
        if _first_bytes(request):
            try:
                shares.count_download(link_share)
            except ShareError as e:
                raise _fail(e)
    request.state.is_watch = inline
    response = await stream_document(request, doc, doc.get("file_name") or "file")
    if link_share is not None:
        response.headers.update(PUBLIC_HEADERS)
    return response


async def _thumb(request: Request, doc: dict, owner_id: str, public: bool):
    """A file's thumbnail: Telegram's when it has one, else a preview made from the file."""
    headers = {"Cache-Control": "private, max-age=86400", **(PUBLIC_HEADERS if public else {})}
    thumb = doc.get("thumbnail")
    bot_manager = getattr(request.app.state, "bot_manager", None)
    if thumb and bot_manager:
        try:
            client = bot_manager.get_least_busy_client()
            data = await client.download_media(thumb, in_memory=True)
            data = data.getvalue() if hasattr(data, "getvalue") else data
            if data:
                return Response(content=data, media_type="image/jpeg", headers=headers)
        except Exception as e:
            logger.info(f"Shared thumbnail not available from Telegram: {e}")
    if doc.get("file_type") in ("photo", "video") or re.search(r"\.(jpe?g|png|webp|heic|gif|mp4|mov|mkv|webm)$", doc.get("file_name") or "", re.I):
        from telestore.api.routes import media
        from telestore.services.preview_service import make_preview
        try:
            owner = shares.owner_user(owner_id)
        except ShareError as e:
            raise _fail(e)
        source = media._get_internal_stream_url(doc.get("file_name", ""), media._caller_token(request, None, owner), str(doc["_id"]))
        path = await make_preview(doc, source)
        if path:
            return FileResponse(path, media_type="image/jpeg", headers=headers)
    raise HTTPException(status_code=404, detail="Thumbnail not available")


def _listing(root: dict, path: str) -> dict:
    rel = shares.clean_rel(path)
    if rel and root.get("file_type") == "folder":
        # The folder itself must exist inside the share
        parent, name = rel.rsplit("/", 1)
        from telestore.db import database
        folder = database.Files.find_one({"owner_id": root.get("owner_id"), "file_path": shares.abs_path(root, parent),
                                          "file_name": name, "file_type": "folder", "trashed": {"$ne": True}})
        if not folder:
            raise ShareError("That folder isn't part of this share.", 404)
    return {"path": rel, "items": [shares.item_json(d, root) for d in shares.list_folder(root, rel)]}


def _zip_info(root: dict, path: str, url_for_part) -> dict:
    from telestore.api.routes.folders import zip_parts
    files, _, name = shares.files_under(root, shares.clean_rel(path))
    return zip_parts(files, name, url_for_part)


def _zip_part(request: Request, root: dict, path: str, part: int):
    from telestore.api.routes.folders import zip_response
    from telestore.services.zip_streamer import MAX_ZIP_PART_SIZE, partition_files_for_zip
    if root.get("file_type") != "folder":
        raise ShareError("Only folders download as a zip.", 400)
    files, base, name = shares.files_under(root, shares.clean_rel(path))
    if not files:
        raise ShareError("This folder is empty.", 404)
    parts = partition_files_for_zip(files, MAX_ZIP_PART_SIZE)
    if part < 1 or part > len(parts):
        raise ShareError(f"Invalid part {part}. Total parts: {len(parts)}", 400)
    zip_name = f"{name}.zip" if len(parts) == 1 else f"{name}-part{part}.zip"
    return zip_response(request, parts[part - 1], base, name, zip_name)


# Members

@router.get("/shares/{share_id}/browse")
async def browse_share(share_id: str, path: str = Query(default="", max_length=1000), user: User = Depends(require_auth)):
    try:
        share, root, role = shares.member_access(share_id, user)
        owner = shares.owner_user_doc(share.get("owner_id"))
        return {"share_id": share_id, "role": role, "owner": {"name": shares.display_name(owner)},
                "root": shares.item_json(root), **_listing(root, path)}
    except ShareError as e:
        raise _fail(e)


@router.get("/shares/{share_id}/dl/{file_id}")
async def member_download(request: Request, share_id: str, file_id: str, inline: bool = False, user: User = Depends(require_auth)):
    try:
        _, root, _ = shares.member_access(share_id, user)
        doc = shares.child(root, file_id)
    except ShareError as e:
        raise _fail(e)
    return await _stream(request, doc, inline)


@router.get("/shares/{share_id}/thumb/{file_id}")
async def member_thumb(request: Request, share_id: str, file_id: str, user: User = Depends(require_auth)):
    try:
        share, root, _ = shares.member_access(share_id, user)
        doc = shares.child(root, file_id)
    except ShareError as e:
        raise _fail(e)
    return await _thumb(request, doc, share.get("owner_id"), public=False)


@router.get("/shares/{share_id}/zip-info")
async def member_zip_info(share_id: str, path: str = Query(default=""), user: User = Depends(require_auth)):
    try:
        _, root, _ = shares.member_access(share_id, user)
        q = urllib.parse.quote(shares.clean_rel(path))
        return _zip_info(root, path, lambda i: f"/shares/{share_id}/zip?path={q}&part={i}")
    except ShareError as e:
        raise _fail(e)


@router.get("/shares/{share_id}/zip")
async def member_zip(request: Request, share_id: str, path: str = Query(default=""), part: int = 1, user: User = Depends(require_auth)):
    try:
        _, root, _ = shares.member_access(share_id, user)
        return _zip_part(request, root, path, part)
    except ShareError as e:
        raise _fail(e)


# Editors: changes inside a shared folder, made as its owner (files stay the owner's)

def _not_root(root: dict, doc: dict, what: str) -> None:
    if doc.get("_id") == root.get("_id"):
        raise ShareError(f"The shared folder itself can't be {what}. Ask its owner.", 400)


@router.post("/shares/{share_id}/folders")
async def editor_new_folder(share_id: str, body: NewFolder, user: User = Depends(require_auth)):
    from telestore.api.routes.folders import CreateFolderRequest, create_folder_route
    try:
        share, root = shares.editor_access(share_id, user)
        owner = shares.owner_user(share["owner_id"])
        target = shares.abs_path(root, body.path)
    except ShareError as e:
        raise _fail(e)
    return await create_folder_route(CreateFolderRequest(folderName=body.name, currentPath=target), user=owner)


@router.post("/shares/{share_id}/rename")
async def editor_rename(share_id: str, body: RenameItem, user: User = Depends(require_auth)):
    from telestore.api.routes.files.manage import RenameFileRequest, rename_file_route
    try:
        share, root = shares.editor_access(share_id, user)
        shares.child(root, body.file_id)
        owner = shares.owner_user(share["owner_id"])
    except ShareError as e:
        raise _fail(e)
    return await rename_file_route(RenameFileRequest(file_id=body.file_id, new_name=body.new_name), user=owner)


@router.post("/shares/{share_id}/move")
async def editor_move(share_id: str, body: MoveItem, user: User = Depends(require_auth)):
    from telestore.api.routes.files.manage import MoveFileRequest, move_file_route
    try:
        share, root = shares.editor_access(share_id, user)
        doc = shares.child(root, body.file_id)
        _not_root(root, doc, "moved")
        target = shares.abs_path(root, body.target_path)
        if doc.get("file_type") == "folder":
            own = shares.full_path(doc)
            if target == own or target.startswith(own + "/"):
                raise ShareError("A folder can't be moved into itself.", 400)
        owner = shares.owner_user(share["owner_id"])
    except ShareError as e:
        raise _fail(e)
    return await move_file_route(MoveFileRequest(file_id=body.file_id, target_path=target), user=owner)


@router.post("/shares/{share_id}/trash")
async def editor_trash(share_id: str, body: TrashItem, user: User = Depends(require_auth)):
    from telestore.api.routes.files.manage import TrashRequest, trash_file_route
    try:
        share, root = shares.editor_access(share_id, user)
        doc = shares.child(root, body.file_id)
        _not_root(root, doc, "deleted")
        owner = shares.owner_user(share["owner_id"])
    except ShareError as e:
        raise _fail(e)
    return await trash_file_route(TrashRequest(file_id=body.file_id), user=owner)


def upload_target(share_id: str, path: str, user: User):
    """(owner, folder path) for an editor's upload into a shared folder (used by /files/upload/init)."""
    try:
        share, root = shares.editor_access(share_id, user)
        owner = shares.owner_user(share["owner_id"])
    except ShareError as e:
        raise _fail(e)
    if not owner.telegram_user_id:
        raise HTTPException(status_code=400, detail="The owner of this folder can't receive uploads right now.")
    return owner, shares.abs_path(root, path)


# ── Anyone with the link ───────────────────────────────────────────────────

def _client_key(request: Request) -> str:
    forwarded = (request.headers.get("x-forwarded-for") or "").split(",")[0].strip()
    return "link:" + (forwarded or (request.client.host if request.client else "?"))


def _by_link(request: Request, token: str):
    key = _client_key(request)
    try:
        link_limiter.check(key)
    except TooManyAttempts as e:
        raise HTTPException(status_code=429, detail=wait_message(e.retry_after), headers={"Retry-After": str(e.retry_after)})
    try:
        found = shares.link_access(token)
    except ShareError as e:
        if e.status == 404:
            link_limiter.failure(key)
        raise HTTPException(status_code=e.status, detail=str(e), headers=PUBLIC_HEADERS)
    return found


@router.get("/share-links/{token}/info")
async def link_info(request: Request, token: str):
    share, doc = _by_link(request, token)
    return JSONResponse(shares.link_info(share, doc), headers=PUBLIC_HEADERS)


@router.get("/share-links/{token}/list")
async def link_list(request: Request, token: str, path: str = Query(default="", max_length=1000)):
    _, root = _by_link(request, token)
    try:
        body = _listing(root, path)
    except ShareError as e:
        raise _fail(e)
    return JSONResponse(body, headers=PUBLIC_HEADERS)


@router.get("/share-links/{token}/dl/{file_id}")
async def link_download(request: Request, token: str, file_id: str, inline: bool = False):
    share, root = _by_link(request, token)
    try:
        doc = shares.child(root, file_id)
    except ShareError as e:
        raise _fail(e)
    return await _stream(request, doc, inline, link_share=share)


@router.get("/share-links/{token}/thumb/{file_id}")
async def link_thumb(request: Request, token: str, file_id: str):
    share, root = _by_link(request, token)
    try:
        doc = shares.child(root, file_id)
    except ShareError as e:
        raise _fail(e)
    return await _thumb(request, doc, share.get("owner_id"), public=True)


@router.get("/share-links/{token}/zip-info")
async def link_zip_info(request: Request, token: str, path: str = Query(default="")):
    share, root = _by_link(request, token)
    if not (share.get("link") or {}).get("allow_download", True):
        raise HTTPException(status_code=403, detail="The owner turned off downloads for this link.")
    try:
        q = urllib.parse.quote(shares.clean_rel(path))
        return _zip_info(root, path, lambda i: f"/share-links/{token}/zip?path={q}&part={i}")
    except ShareError as e:
        raise _fail(e)


@router.get("/share-links/{token}/zip")
async def link_zip(request: Request, token: str, path: str = Query(default=""), part: int = 1):
    share, root = _by_link(request, token)
    if not (share.get("link") or {}).get("allow_download", True):
        raise HTTPException(status_code=403, detail="The owner turned off downloads for this link.")
    try:
        response = _zip_part(request, root, path, part)
        shares.count_download(share)
    except ShareError as e:
        raise _fail(e)
    response.headers.update(PUBLIC_HEADERS)
    return response

