"""The TeleStore server's API, as the website and the Android app use it (no file data goes here)."""

from typing import List, Optional

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
