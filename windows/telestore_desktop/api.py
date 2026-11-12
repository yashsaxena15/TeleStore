"""The TeleStore server's API, as the website and the Android app use it (no file data goes here)."""

import os
from typing import Callable, List, Optional
from urllib.parse import quote, urlencode

import requests

from telestore_desktop import __version__

TOKEN_HEADER = "X-Auth-Token"
DEVICE = "windows"


class ApiError(Exception):
    def __init__(self, message: str, status: int = 0):
        super().__init__(message)
        self.status = status


def _detail(resp: requests.Response) -> str:
    try:
        body = resp.json()
    except ValueError:
        return resp.text[:200] or f"HTTP {resp.status_code}"
    detail = body.get("detail") if isinstance(body, dict) else None
    if isinstance(detail, dict):
        detail = detail.get("message")
    if isinstance(detail, list):  # FastAPI's validation errors
        detail = "; ".join(str(d.get("msg", d)) for d in detail)
    return str(detail or body.get("message") or f"HTTP {resp.status_code}")


class TeleStoreApi:
    def __init__(self, server: str, token: Optional[str] = None, timeout: float = 30):
        self.server = server.rstrip("/")
        self.token = token
        self.timeout = timeout
        self.http = requests.Session()
        self.http.headers["User-Agent"] = f"TeleStore-Windows/{__version__}"
        # Phase 10: this PC's address for one of your own files, straight from Telegram (None = through TeleStore)
        self.direct: Optional[Callable] = None

    def _call(self, method: str, path: str, **kw):
        headers = kw.pop("headers", {})
        if self.token:
            headers[TOKEN_HEADER] = self.token
        try:
            resp = self.http.request(method, f"{self.server}/{path.lstrip('/')}", headers=headers,
                                     timeout=kw.pop("timeout", self.timeout), **kw)
        except requests.RequestException as e:
            raise ApiError(f"Couldn't reach TeleStore ({type(e).__name__}). Check the internet connection.") from e
        if resp.status_code == 401:
            raise ApiError("Signed out: sign in to TeleStore again.", 401)
        if resp.status_code >= 400:
            raise ApiError(_detail(resp), resp.status_code)
        return resp.json() if resp.content else {}

    # ── Sign-in ──
    def login(self, username: str, password: str) -> dict:
        body = self._call("POST", "auth/login", json={"username": username.strip(), "password": password, "device": DEVICE})
        self.token = body.get("auth_token")
        if not self.token:
            raise ApiError("The server didn't give a sign-in token.")
        return body

    def check(self) -> dict:
        return self._call("GET", "auth/check")

    def logout(self) -> None:
        try:
            self._call("POST", "auth/logout", timeout=10)
        except ApiError:
            pass  # signing out works offline too
        self.token = None

    # ── Files ──
    def list_files(self, path: str, page: int = 1, page_size: int = 200, sort_by: str = "name", order: str = "asc",
                   q: Optional[str] = None, kind: Optional[str] = None) -> dict:
        """One page of a folder ("/Home/…", "starred", "trash", "all"), or a search with [q]."""
        params = {"path": path, "page": page, "page_size": page_size, "sort_by": sort_by, "sort_order": order}
        if q:
            params["q"] = q
        if kind:
            params["kind"] = kind
        return self._call("GET", "files", params=params)

    def create_folder(self, name: str, parent: str) -> dict:
        return self._call("POST", "folders/create", json={"folderName": name, "currentPath": parent})

    # ── Changing files (as on the website) ──
    def rename(self, file_id: str, new_name: str) -> dict:
        return self._call("POST", "files/rename", json={"file_id": file_id, "new_name": new_name})

    def move(self, file_id: str, target_path: str) -> dict:
        return self._call("POST", "files/move", json={"file_id": file_id, "target_path": target_path})

    def star(self, file_id: str, starred: bool) -> dict:
        return self._call("POST", "files/star", json={"file_id": file_id, "starred": starred})

    def trash(self, file_id: str) -> dict:
        return self._call("POST", "files/trash", json={"file_id": file_id})

    def restore(self, file_id: str) -> dict:
        return self._call("POST", "files/restore", json={"file_id": file_id})

    def delete_forever(self, file_id: str) -> dict:
        return self._call("POST", "files/delete", json={"file_id": file_id})

    def empty_trash(self) -> dict:
        return self._call("POST", "files/trash/empty", timeout=120)

    # ── Sharing (the website's Share dialog) ──
    def share_view(self, item_id: str) -> dict:
        return self._call("GET", f"shares/item/{quote(item_id, safe='')}")

    def share_link(self, item_id: str, enabled: bool) -> dict:
        return self._call("PUT", f"shares/item/{quote(item_id, safe='')}/link", json={"enabled": enabled})

    def share_add(self, item_id: str, who: str, role: str = "viewer") -> dict:
        return self._call("POST", f"shares/item/{quote(item_id, safe='')}/members", json={"who": who.strip(), "role": role})

    def share_remove(self, item_id: str, user_id) -> dict:
        return self._call("DELETE", f"shares/item/{quote(item_id, safe='')}/members/{quote(str(user_id), safe='')}")

    def link_address(self, token: str) -> str:
        return f"{self.server}/s/{quote(token, safe='')}"

    def locate(self, file_id: str) -> dict:
        """Which messages of your channel hold one of your own files (for opening it straight from Telegram)."""
        return self._call("GET", f"direct/locate/{quote(file_id, safe='')}")

    def shared_with_me(self) -> List[dict]:
        return self._call("GET", "shares/with-me").get("shares") or []

    def browse_share(self, share_id: str, path: str = "") -> dict:
        return self._call("GET", f"shares/{quote(share_id, safe='')}/browse", params={"path": path})

    # ── Addresses with the token in them (players and image loading can't send headers) ──
    def _url(self, path: str, **params) -> str:
        return f"{self.server}/{path}?{urlencode({k: v for k, v in params.items() if v is not None})}"

    def file_url(self, item, inline: bool = True) -> str:
        """Where to open or download a file: straight from Telegram when it can, else through TeleStore."""
        if self.direct and not item.share_id:
            try:
                url = self.direct(item, inline)
            except Exception:
                url = None
            if url:
                return url
        return self.server_file_url(item, inline)

    def server_file_url(self, item, inline: bool = True) -> str:
        if item.share_id:
            return self._url(f"shares/{quote(item.share_id, safe='')}/dl/{quote(item.id, safe='')}",
                             inline=1 if inline else None, token=self.token)
        return self._url(f"dl/{quote(item.name, safe='')}", file_id=item.id, inline=1 if inline else None, token=self.token)

    def thumbnail_url(self, item) -> Optional[str]:
        if item.share_id:
            return self._url(f"shares/{quote(item.share_id, safe='')}/thumb/{quote(item.id, safe='')}",
                             token=self.token) if item.has_thumb or item.kind in ("photo", "video") else None
        if item.thumbnail:
            return self._url(f"files/thumbnail/{quote(item.thumbnail, safe='')}", auth_token=self.token)
        if item.kind in ("photo", "video"):
            return self._url(f"files/preview/{quote(item.id, safe='')}", token=self.token)
        return None

    def fetch(self, url: str, timeout: float = 30) -> bytes:
        try:
            resp = self.http.get(url, timeout=timeout)
        except requests.RequestException as e:
            raise ApiError(f"Couldn't reach TeleStore ({type(e).__name__}).") from e
        if resp.status_code >= 400:
            raise ApiError(_detail(resp), resp.status_code)
        return resp.content

    def download(self, url: str, target: str, progress: Optional[Callable[[int, int], bool]] = None) -> None:
        """Saves [url] to [target]; [progress](done, total) returning False stops it."""
        tmp = target + ".part"
        try:
            with self.http.get(url, stream=True, timeout=(30, 120)) as resp:
                if resp.status_code >= 400:
                    raise ApiError(_detail(resp), resp.status_code)
                total = int(resp.headers.get("Content-Length") or 0)
                done = 0
                with open(tmp, "wb") as f:
                    for chunk in resp.iter_content(1024 * 1024):
                        f.write(chunk)
                        done += len(chunk)
                        if progress and progress(done, total) is False:
                            raise InterruptedError("Download cancelled")
            os.replace(tmp, target)
        except requests.RequestException as e:
            raise ApiError(f"The download stopped ({type(e).__name__}).") from e
        finally:
            if os.path.exists(tmp):
                os.remove(tmp)

    def folders(self, path: str) -> List[dict]:
        """The folders directly inside [path] ("/Home", "/Home/Movies"...), by name."""
        found, page = [], 1
        while True:
            body = self._call("GET", "files", params={"path": path, "page": page, "page_size": 500,
                                                      "sort_by": "name", "sort_order": "asc"})
            files = body.get("files") or []
            found += [f for f in files if f.get("file_type") == "folder"]
            pages = (body.get("pagination") or {}).get("total_pages") or 1
            if page >= pages or not files:
                return found
            page += 1

    def storage(self) -> dict:
        return self._call("GET", "files/analytics")

    def create_folder_path(self, full_path: str) -> dict:
        return self._call("POST", "folders/create-path", json={"fullPath": full_path})

    # ── Direct upload ──
    def direct_config(self) -> dict:
        return self._call("GET", "direct/config")

    def prepare(self, path: str, filename: str, filesize: int) -> dict:
        return self._call("POST", "direct/prepare", json={"path": path, "filename": filename, "filesize": filesize})

    def complete(self, path: str, filename: str, filesize: int, parts: List[tuple], taken_at: Optional[str] = None) -> dict:
        body = {"path": path, "filename": filename, "filesize": filesize,
                "parts": [{"part_index": i, "message_id": m} for i, m in parts]}
        if taken_at:
            body["taken_at"] = taken_at
        return self._call("POST", "direct/complete", json=body, timeout=120)
