# telestore/services/instagram_service.py
"""Reads Instagram posts and reels with instaloader and downloads their photos and videos.

One shared Instaloader instance makes every request, one at a time, so the server stays under
Instagram's rate limits. When the owner connects an Instagram account (Settings › Integrations),
its session file is loaded and used for every import; the password itself is never stored.
"""

import asyncio
import base64
import os
import re
import threading
import urllib.parse
from typing import Callable, Optional

import instaloader
from instaloader import exceptions as ig_errors

from telestore.config.settings import PROJECT_ROOT
from d4rk.Logs import setup_logger

logger = setup_logger("instagram_service")

ALLOWED_HOSTS = {"instagram.com", "www.instagram.com", "m.instagram.com", "instagr.am", "www.instagr.am"}
_PATH_RE = re.compile(r"^/(?:[A-Za-z0-9._]+/)?(p|reel|reels|tv)/([A-Za-z0-9_-]{5,64})/?$")

SESSION_DIR = os.getenv("INSTAGRAM_SESSION_DIR", os.path.join(PROJECT_ROOT, "cache", "instagram"))
SESSION_FILE = os.path.join(SESSION_DIR, "session")
USERNAME_FILE = os.path.join(SESSION_DIR, "username")

NOT_FOUND = "This post is private or was removed."
RATE_LIMITED = "Instagram is asking us to slow down. Try again in a few minutes."
LOGIN_NEEDED = "Instagram only lets signed-in accounts download from this server. The owner can connect one in Settings › Integrations › Instagram."


class InstagramError(ValueError):
    """An Instagram problem with a message that can be shown to the user as is."""


def parse_instagram_url(url: str) -> tuple:
    """(kind, shortcode) for a post, reel or video link; raises InstagramError for anything else."""
    raw = (url or "").strip()
    if raw and "://" not in raw:
        raw = "https://" + raw
    parsed = urllib.parse.urlparse(raw)
    host = (parsed.hostname or "").lower()
    if parsed.scheme not in ("http", "https") or host not in ALLOWED_HOSTS:
        raise InstagramError("Paste a link to an Instagram post or reel, like https://www.instagram.com/reel/…")
    match = _PATH_RE.match(parsed.path or "/")
    if not match:
        raise InstagramError("Only posts, reels and videos can be imported. Stories and profiles aren't supported yet.")
    kind = {"reels": "reel"}.get(match.group(1), match.group(1))
    return kind, match.group(2)


def _friendly(error: Exception, signed_in: bool = True) -> InstagramError:
    if isinstance(error, InstagramError):
        return error
    text = str(error)
    blocked = any(code in text for code in ("401", "403")) or "Please wait a few minutes" in text
    # Signed out, Instagram turns cloud servers away with 401 "Please wait a few minutes"; no wait helps
    if not signed_in and (blocked or isinstance(error, (ig_errors.LoginRequiredException, ig_errors.QueryReturnedForbiddenException, ig_errors.TooManyRequestsException))):
        logger.info(f"Instagram refused a signed-out request: {text[:200]}")
        return InstagramError(LOGIN_NEEDED)
    if isinstance(error, ig_errors.TooManyRequestsException) or "429" in text or "Please wait a few minutes" in text:
        return InstagramError(RATE_LIMITED)
    if isinstance(error, (ig_errors.LoginRequiredException, ig_errors.QueryReturnedForbiddenException)):
        return InstagramError(LOGIN_NEEDED)
    if isinstance(error, (ig_errors.QueryReturnedNotFoundException, ig_errors.BadResponseException,
                          ig_errors.PrivateProfileNotFollowedException)):
        return InstagramError(NOT_FOUND)
    if blocked or "login" in text.lower():
        return InstagramError(LOGIN_NEEDED)
    logger.warning(f"Instagram request failed: {error}")
    return InstagramError("Couldn't read this post from Instagram. Check the link and try again.")


class InstagramClient:
    def __init__(self):
        self._lock = threading.Lock()  # instaloader is synchronous; one request at a time
        self._loader = self._new_loader()
        self._pending_login: Optional[instaloader.Instaloader] = None
        self._load_saved_session()

    @staticmethod
    def _new_loader() -> instaloader.Instaloader:
        return instaloader.Instaloader(
            quiet=True,
            download_comments=False,
            save_metadata=False,
            compress_json=False,
            max_connection_attempts=1,
        )

    def _load_saved_session(self) -> None:
        username = self.connected_username()
        if not username:
            return
        try:
            self._loader.load_session_from_file(username, SESSION_FILE)
            logger.info(f"Loaded the saved Instagram session for @{username}")
        except Exception as e:
            logger.warning(f"Couldn't load the saved Instagram session: {e}")

    # ── Signed-in account (owner only) ─────────────────────────────────────────────────────
    @staticmethod
    def connected_username() -> Optional[str]:
        try:
            if os.path.exists(SESSION_FILE):
                with open(USERNAME_FILE) as f:
                    return f.read().strip() or None
        except OSError:
            pass
        return None

    def _save_session(self, loader: instaloader.Instaloader, username: str) -> None:
        os.makedirs(SESSION_DIR, mode=0o700, exist_ok=True)
        loader.save_session_to_file(SESSION_FILE)
        with open(USERNAME_FILE, "w") as f:
            f.write(username)
        os.chmod(USERNAME_FILE, 0o600)
        with self._lock:
            self._loader = loader

    def login(self, username: str, password: str) -> dict:
        """{"connected": True} or {"needs_2fa": True}; raises InstagramError with a readable reason."""
        username = username.strip().lstrip("@")
        loader = self._new_loader()
        try:
            loader.login(username, password)
        except ig_errors.TwoFactorAuthRequiredException:
            self._pending_login = loader
            return {"needs_2fa": True}
        except ig_errors.BadCredentialsException:
            raise InstagramError("Wrong Instagram username or password.")
        except Exception as e:
            logger.warning(f"Instagram login failed for @{username}: {type(e).__name__}")
            raise InstagramError("Instagram didn't accept the sign-in. Open Instagram on your phone, approve the sign-in if it asks, then try again.")
        self._save_session(loader, username)
        return {"connected": True, "username": username}

    def finish_two_factor(self, code: str) -> dict:
        loader = self._pending_login
        if not loader:
            raise InstagramError("Start the sign-in again.")
        try:
            loader.two_factor_login(code.strip())
        except ig_errors.BadCredentialsException:
            raise InstagramError("That code is wrong. Try again.")
        except Exception:
            self._pending_login = None
            raise InstagramError("Instagram didn't accept the code. Start the sign-in again.")
        self._pending_login = None
        username = loader.context.username
        self._save_session(loader, username)
        return {"connected": True, "username": username}

    def logout(self) -> None:
        for path in (SESSION_FILE, USERNAME_FILE):
            try:
                os.remove(path)
            except FileNotFoundError:
                pass
        with self._lock:
            self._loader = self._new_loader()

    # ── Posts ──────────────────────────────────────────────────────────────────────────────
    def _read_post(self, shortcode: str) -> dict:
        with self._lock:
            try:
                post = instaloader.Post.from_shortcode(self._loader.context, shortcode)
                if post.typename == "GraphSidecar":
                    nodes = list(post.get_sidecar_nodes())
                    items = [{"is_video": n.is_video, "url": n.video_url if n.is_video else n.display_url, "thumbnail": n.display_url} for n in nodes]
                else:
                    items = [{"is_video": post.is_video, "url": post.video_url if post.is_video else post.url, "thumbnail": post.url}]
                info = {
                    "shortcode": shortcode,
                    "owner": post.owner_username,
                    "caption": post.caption or "",
                    "date": post.date_utc.isoformat() if post.date_utc else None,
                }
            except Exception as e:
                raise _friendly(e, signed_in=self._loader.context.is_logged_in)
        items = [it for it in items if it["url"]]
        if not items:
            raise InstagramError(NOT_FOUND)
        for index, it in enumerate(items, start=1):
            it["index"] = index
            it["ext"] = "mp4" if it["is_video"] else "jpg"
        info["items"] = items
        return info

    async def get_post(self, shortcode: str) -> dict:
        """{shortcode, owner, caption, date, items: [{index, is_video, url, thumbnail, ext}]}"""
        return await asyncio.to_thread(self._read_post, shortcode)

    def _download(self, url: str, dest_path: str, progress: Optional[Callable[[int, int], None]], should_stop: Callable[[], bool]) -> int:
        try:
            resp = self._loader.context.get_raw(url)
        except Exception as e:
            raise _friendly(e)
        total = int(resp.headers.get("Content-Length") or 0)
        written = 0
        with resp, open(dest_path, "wb") as f:
            for chunk in resp.iter_content(chunk_size=512 * 1024):
                if should_stop():
                    raise InterruptedError("Cancelled by user")
                if chunk:
                    f.write(chunk)
                    written += len(chunk)
                    if progress:
                        progress(written, total)
        if written == 0:
            raise InstagramError("Instagram sent an empty file. Try again.")
        return written

    def _thumbnail(self, url: str) -> Optional[str]:
        try:
            resp = self._loader.context.get_raw(url)
            with resp:
                data = resp.raw.read(2 * 1024 * 1024 + 1)
        except Exception:
            return None
        if not data or len(data) > 2 * 1024 * 1024:
            return None
        return "data:image/jpeg;base64," + base64.b64encode(data).decode()

    async def thumbnail(self, url: str) -> Optional[str]:
        """A data: URL of a preview image (Instagram's image server refuses other sites' pages)."""
        return await asyncio.to_thread(self._thumbnail, url)

    async def download(self, url: str, dest_path: str, progress=None, should_stop=lambda: False) -> int:
        """Streams one photo or video into dest_path; returns its size in bytes."""
        return await asyncio.to_thread(self._download, url, dest_path, progress, should_stop)


def file_name_for(owner: str, shortcode: str, item: dict, total: int) -> str:
    safe_owner = re.sub(r"[^A-Za-z0-9._-]", "", owner or "instagram") or "instagram"
    suffix = f"_{item['index']}" if total > 1 else ""
    return f"{safe_owner}_{shortcode}{suffix}.{item['ext']}"


_client: Optional[InstagramClient] = None


def get_client() -> InstagramClient:
    global _client
    if _client is None:
        _client = InstagramClient()
    return _client
