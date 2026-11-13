"""Files and folders as the app shows them, from the server's listings (own files and shared ones)."""

import os
from dataclasses import dataclass
from typing import Optional

VIDEO = {".mp4", ".mkv", ".avi", ".mov", ".wmv", ".flv", ".webm", ".m4v", ".ts", ".3gp", ".ogv"}
AUDIO = {".mp3", ".wav", ".ogg", ".flac", ".m4a", ".opus", ".aac", ".wma"}
PHOTO = {".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp", ".heic", ".heif", ".avif", ".tif", ".tiff"}
ARCHIVE = {".zip", ".rar", ".7z", ".tar", ".gz", ".bz2", ".xz"}
VIEWABLE_PHOTO = {".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp", ".tif", ".tiff"}


@dataclass
class Item:
    id: str
    name: str
    kind: str  # folder, photo, video, audio, pdf, archive, document
    size: int = 0
    path: str = "/Home"  # the folder it's in
    modified: str = ""
    thumbnail: Optional[str] = None  # Telegram's thumbnail id (own files)
    has_thumb: bool = False  # shared files: the share serves a thumbnail
    starred: bool = False
    share_id: Optional[str] = None  # opened from Shared with me
    share_path: str = ""  # its folder inside the share
    share_root: bool = False  # the shared item itself (as Shared with me lists it)
    owner: str = ""
    taken_at: str = ""  # when a photo or video was taken (its date in Photos)
    duration: float = 0.0  # seconds, for videos and songs
    created: str = ""  # when it was added to TeleStore
    raw: Optional[dict] = None  # the server's own fields, for Details

    @property
    def is_folder(self) -> bool:
        return self.kind == "folder"

    @property
    def full_path(self) -> str:
        return f"{self.path.rstrip('/')}/{self.name}"

    @property
    def ext(self) -> str:
        return os.path.splitext(self.name)[1].lower()


def kind_of(name: str, file_type: Optional[str]) -> str:
    if file_type == "folder":
        return "folder"
    ext = os.path.splitext(name or "")[1].lower()
    if ext in VIDEO or file_type == "video":
        return "video"
    if ext in PHOTO or file_type == "photo":
        return "photo"
    if ext in AUDIO or file_type in ("audio", "voice"):
        return "audio"
    if ext == ".pdf":
        return "pdf"
    if ext in ARCHIVE:
        return "archive"
    return "document"


def from_listing(d: dict) -> Item:
    """An item of /files (the person's own)."""
    name = d.get("file_name") or "?"
    return Item(id=str(d.get("id") or d.get("_id") or ""), name=name, kind=kind_of(name, d.get("file_type")),
                size=int(d.get("file_size") or 0), path=d.get("file_path") or "/Home",
                modified=str(d.get("modified_date") or ""), thumbnail=d.get("thumbnail") or None,
                starred=bool(d.get("starred")), taken_at=str(d.get("taken_at") or ""),
                duration=float(d.get("duration") or 0), created=str(d.get("created_at") or d.get("upload_date") or ""), raw=d)


def from_share(d: dict, share_id: str, share_path: str = "", owner: str = "") -> Item:
    """An item of a share (/shares/with-me or /shares/{id}/browse)."""
    name = d.get("name") or d.get("file_name") or "?"
    file_type = d.get("type") or d.get("file_type") or ("folder" if d.get("folder") else None)
    return Item(id=str(d.get("id") or ""), name=name, kind=kind_of(name, file_type), size=int(d.get("size") or 0),
                path=d.get("path") or "", modified=str(d.get("modified_date") or ""), has_thumb=bool(d.get("has_thumb")),
                share_id=share_id, share_path=share_path, owner=owner, taken_at=str(d.get("taken_at") or ""),
                duration=float(d.get("duration") or 0), raw=d)


def from_my_share(d: dict) -> Item:
    """An item of Shared by me (/shares/mine): one of your own files, so it opens as your own."""
    item = from_share(d.get("item") or {}, "", "")
    item.share_id = None
    item.path = d.get("location") or "/Home"
    item.raw = d
    return item
