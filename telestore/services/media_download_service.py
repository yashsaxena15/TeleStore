# telestore/services/media_download_service.py
"""Video and audio downloads from YouTube, YouTube Music and the other sites yt-dlp supports.

Links are read with yt-dlp on the server; each video is then downloaded into a task's temp folder
and handed to the Remote Transfers manager, which stores it in Telegram or Google Drive.

yt-dlp's "generic" extractor (which fetches any web page) is turned off and links must point at
public addresses, so a link can't make the server fetch pages on its own network. The owner can
add a cookies.txt export of a signed-in browser (Settings › Integrations); YouTube asks servers
to "confirm you're not a bot" far less often with it, and age-restricted videos then work.
"""

import asyncio
import base64
import glob
import ipaddress
import os
import re
import socket
import threading
import time
import urllib.parse
from typing import Callable, Optional

import requests
import yt_dlp
from yt_dlp.utils import DownloadError

from telestore.config.settings import PROJECT_ROOT
from d4rk.Logs import setup_logger

logger = setup_logger("media_download")

SETTINGS_DIR = os.getenv("MEDIA_DOWNLOAD_DIR", os.path.join(PROJECT_ROOT, "cache", "ytdlp"))
COOKIES_FILE = os.path.join(SETTINGS_DIR, "cookies.txt")

MAX_PLAYLIST_ITEMS = 200
QUALITIES = {"best": None, "1080": 1080, "720": 720, "480": 480}
AUDIO_FORMATS = ("mp3", "m4a")

NEEDS_COOKIES = "The owner can add YouTube cookies in Settings › Integrations › Video downloads, then try again."


class MediaError(ValueError):
    """A download problem with a message that can be shown to the user as is."""


class _Stopped(Exception):
    pass


# ── Links ──────────────────────────────────────────────────────────────────────────────────
def check_public_url(url: str) -> str:
    """The cleaned link; raises MediaError for anything but http(s) links to public addresses."""
    raw = (url or "").strip()
    if raw and "://" not in raw:
        raw = "https://" + raw
    parsed = urllib.parse.urlparse(raw)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise MediaError("Paste a link that starts with https://")
    try:
        addresses = {info[4][0] for info in socket.getaddrinfo(parsed.hostname, parsed.port or 443, proto=socket.IPPROTO_TCP)}
    except socket.gaierror:
        raise MediaError("That website couldn't be found. Check the link.")
    for address in addresses:
        ip = ipaddress.ip_address(address.split("%", 1)[0])
        if not ip.is_global:
            raise MediaError("Links to private or local network addresses can't be downloaded.")
    return raw


def _friendly(error: Exception) -> MediaError:
    if isinstance(error, MediaError):
        return error
    text = re.sub(r"\x1b\[[0-9;]*m", "", str(error))
    lower = text.lower()
    if "age-restricted" in lower or "age restricted" in lower or "confirm your age" in lower or "inappropriate for some users" in lower:
        return MediaError("This video is age-restricted. " + NEEDS_COOKIES)
    if "sign in to confirm" in lower or ("confirm you" in lower and "bot" in lower):
        return MediaError("YouTube asked this server to prove it isn't a bot. " + NEEDS_COOKIES)
    if "members-only" in lower or "join this channel" in lower:
        return MediaError("This video is for channel members only.")
    if "private video" in lower or "this video is private" in lower:
        return MediaError("This video is private.")
    if "drm" in lower:
        return MediaError("This is protected (DRM) content, which can't be downloaded.")
    if "live event will begin" in lower or "premieres in" in lower or "this live event" in lower:
        return MediaError("This is a live stream or premiere that hasn't finished. Try again after it ends.")
    if "not available in your country" in lower or "geo restrict" in lower or "geo-restrict" in lower:
        return MediaError("This video isn't available in the server's country.")
    if "no suitable extractor" in lower or "unsupported url" in lower:
        return MediaError("This website isn't supported. Try a link to the video page itself.")
    if "video unavailable" in lower or "404" in lower or "has been removed" in lower or "does not exist" in lower:
        return MediaError("This video is unavailable or was removed.")
    if "logged-in" in lower or "login required" in lower or "log in" in lower or "sign in" in lower or "cookies" in lower:
        return MediaError("This site only shows this to signed-in accounts. " + NEEDS_COOKIES.replace("YouTube cookies", "cookies for this site"))
    if "429" in lower or "too many requests" in lower:
        return MediaError("The site is asking us to slow down. Try again in a few minutes.")
    if "requested format is not available" in lower:
        return MediaError("That quality isn't available for this video. Pick Best and try again.")
    logger.warning(f"yt-dlp failed: {text[:400]}")
    return MediaError("Couldn't download this link. Check that it opens in your browser and try again.")


# ── Options ────────────────────────────────────────────────────────────────────────────────
class _QuietLog:
    """yt-dlp's messages go to the debug log; errors reach the user through MediaError."""
    def debug(self, msg):
        pass

    def info(self, msg):
        pass

    def warning(self, msg):
        logger.debug(f"yt-dlp: {msg}")

    def error(self, msg):
        logger.debug(f"yt-dlp: {msg}")


def has_cookies() -> bool:
    return os.path.exists(COOKIES_FILE)


def _base_options() -> dict:
    opts = {
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        "allowed_extractors": ["default", "-generic"],
        "socket_timeout": 30,
        "retries": 3,
        "fragment_retries": 5,
        "windowsfilenames": True,
        "noplaylist": True,
        "logger": _QuietLog(),
        # YouTube needs a JavaScript runtime to unlock its formats (Deno in the Docker image)
        "js_runtimes": {"deno": {}, "node": {}},
    }
    if has_cookies():
        opts["cookiefile"] = COOKIES_FILE
    return opts


def format_options(choice: dict) -> dict:
    """yt-dlp options for {"mode": "video", "quality", "subtitles"} or {"mode": "audio", "audio_format"}."""
    if choice.get("mode") == "audio":
        codec = choice.get("audio_format") if choice.get("audio_format") in AUDIO_FORMATS else "mp3"
        return {
            "format": "bestaudio/best",
            "writethumbnail": True,
            "postprocessors": [
                {"key": "FFmpegExtractAudio", "preferredcodec": codec, "preferredquality": "0"},
                {"key": "FFmpegMetadata", "add_metadata": True},
                {"key": "EmbedThumbnail"},
            ],
        }
    height = QUALITIES.get(str(choice.get("quality") or "best"))
    sort = [f"res:{height}"] if height else []
    opts = {
        "format": "bestvideo*+bestaudio/best",
        # Prefer MP4/H.264 + AAC so the file plays everywhere and streams in TeleStore
        "format_sort": sort + ["vcodec:h264", "ext:mp4:m4a"],
        "merge_output_format": "mp4",
        "postprocessors": [{"key": "FFmpegMetadata", "add_metadata": True}],
    }
    if choice.get("subtitles"):
        opts.update({"writesubtitles": True, "subtitleslangs": ["en.*", "en", "-live_chat"], "subtitlesformat": "srt/best"})
        opts["postprocessors"].append({"key": "FFmpegEmbedSubtitle", "already_have_subtitle": False})
    return opts


# ── Reading links ──────────────────────────────────────────────────────────────────────────
_probe_limit = threading.Semaphore(2)


def _entry_url(entry: dict) -> Optional[str]:
    url = entry.get("webpage_url") or entry.get("url")
    if url and not url.startswith("http") and entry.get("ie_key", "").lower().startswith("youtube"):
        url = f"https://www.youtube.com/watch?v={entry.get('id') or url}"
    return url if url and url.startswith("http") else None


def _probe(url: str) -> dict:
    opts = {**_base_options(), "noplaylist": False, "extract_flat": "in_playlist", "playlistend": MAX_PLAYLIST_ITEMS, "skip_download": True}
    with _probe_limit:
        try:
            with yt_dlp.YoutubeDL(opts) as ydl:
                info = ydl.extract_info(url, download=False)
        except DownloadError as e:
            raise _friendly(e)
        except Exception as e:
            raise _friendly(e)
    if not info:
        raise MediaError("Couldn't read this link.")
    if info.get("_type") in ("playlist", "multi_video") or info.get("entries") is not None:
        entries = []
        for entry in info.get("entries") or []:
            if not entry:
                continue
            link = _entry_url(entry)
            if not link:
                continue
            entries.append({
                "index": len(entries) + 1,
                "url": link,
                "title": entry.get("title") or link,
                "duration": entry.get("duration"),
            })
            if len(entries) >= MAX_PLAYLIST_ITEMS:
                break
        if not entries:
            raise MediaError("This playlist is empty or private.")
        thumbs = info.get("thumbnails") or []
        return {
            "kind": "playlist",
            "title": info.get("title") or "Playlist",
            "uploader": info.get("uploader") or info.get("channel"),
            "site": info.get("extractor_key"),
            "thumbnail_url": info.get("thumbnail") or (thumbs[-1].get("url") if thumbs else None),
            "count": info.get("playlist_count") or len(entries),
            "entries": entries,
        }
    if info.get("is_live") or info.get("live_status") in ("is_live", "is_upcoming"):
        raise MediaError("This is a live stream or premiere that hasn't finished. Try again after it ends.")
    link = info.get("webpage_url") or url
    return {
        "kind": "video",
        "title": info.get("title") or "Video",
        "uploader": info.get("uploader") or info.get("channel") or info.get("artist"),
        "site": info.get("extractor_key"),
        "thumbnail_url": info.get("thumbnail"),
        "duration": info.get("duration"),
        "count": 1,
        "entries": [{"index": 1, "url": link, "title": info.get("title") or link, "duration": info.get("duration")}],
    }


async def probe(url: str) -> dict:
    """{kind: video|playlist, title, uploader, site, thumbnail_url, duration?, count, entries: [{index, url, title, duration}]}"""
    url = check_public_url(url)
    return await asyncio.to_thread(_probe, url)


def _thumbnail(url: Optional[str]) -> Optional[str]:
    if not url:
        return None
    try:
        check_public_url(url)
        with requests.get(url, timeout=10, stream=True, headers={"User-Agent": "Mozilla/5.0"}) as resp:
            if resp.status_code != 200 or not resp.headers.get("Content-Type", "").startswith("image/"):
                return None
            data = resp.raw.read(1024 * 1024 + 1)
            if len(data) > 1024 * 1024:
                return None
            return f"data:{resp.headers['Content-Type'].split(';')[0]};base64," + base64.b64encode(data).decode()
    except Exception:
        return None


async def thumbnail(url: Optional[str]) -> Optional[str]:
    """A data: URL of the preview image (shown in the dialog without loading other sites)."""
    return await asyncio.to_thread(_thumbnail, url)


# ── Downloading ────────────────────────────────────────────────────────────────────────────
def _download(url: str, choice: dict, dest_dir: str, progress: Optional[Callable[[int, int, int], None]], should_stop: Callable[[], bool]) -> str:
    check_public_url(url)
    last = [0.0]

    def hook(d):
        if should_stop():
            raise _Stopped()
        if d.get("status") == "downloading" and progress:
            now = time.time()
            if now - last[0] >= 0.8:
                last[0] = now
                progress(int(d.get("downloaded_bytes") or 0), int(d.get("total_bytes") or d.get("total_bytes_estimate") or 0), int(d.get("speed") or 0))

    opts = {
        **_base_options(),
        **format_options(choice),
        "outtmpl": os.path.join(dest_dir, "%(title).150B [%(id)s].%(ext)s"),
        "paths": {"home": dest_dir, "temp": dest_dir},
        "progress_hooks": [hook],
    }
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=True)
    except _Stopped:
        raise InterruptedError("Cancelled by user")
    except DownloadError as e:
        if isinstance(getattr(e, "exc_info", (None, None))[1], _Stopped) or should_stop():
            raise InterruptedError("Cancelled by user")
        raise _friendly(e)
    except Exception as e:
        raise _friendly(e)

    downloads = (info or {}).get("requested_downloads") or []
    path = downloads[-1].get("filepath") if downloads else None
    if not path or not os.path.exists(path):
        # Fall back to the newest media file in the folder (post-processors rename files)
        files = [f for f in glob.glob(os.path.join(dest_dir, "*")) if not f.endswith((".part", ".ytdl", ".jpg", ".webp", ".png", ".srt", ".vtt"))]
        if not files:
            raise MediaError("The download finished but no file was produced.")
        path = max(files, key=os.path.getmtime)
    return path


async def download(url: str, choice: dict, dest_dir: str, progress=None, should_stop=lambda: False) -> str:
    """Downloads one video (or its audio) into dest_dir; returns the file path."""
    return await asyncio.to_thread(_download, url, choice, dest_dir, progress, should_stop)


# ── Settings (owner) ───────────────────────────────────────────────────────────────────────
def save_cookies(data: bytes) -> dict:
    text = data.decode("utf-8", errors="replace")
    lines = [line for line in text.splitlines() if line.strip() and not line.startswith("#")]
    rows = [line.split("\t") for line in lines]
    if not text.lstrip().startswith("# Netscape HTTP Cookie File") and not text.lstrip().startswith("# HTTP Cookie File") and not all(len(r) >= 7 for r in rows[:5] or [[]]):
        raise MediaError("That isn't a cookies.txt file. Export one with the \"Get cookies.txt LOCALLY\" extension.")
    domains = sorted({r[0].lstrip(".").lower() for r in rows if len(r) >= 7})
    if not domains:
        raise MediaError("That cookies.txt file is empty.")
    os.makedirs(SETTINGS_DIR, mode=0o700, exist_ok=True)
    with open(COOKIES_FILE, "w", encoding="utf-8") as f:
        f.write(text if text.endswith("\n") else text + "\n")
    os.chmod(COOKIES_FILE, 0o600)
    return settings()


def remove_cookies() -> dict:
    try:
        os.remove(COOKIES_FILE)
    except FileNotFoundError:
        pass
    return settings()


def settings() -> dict:
    domains = []
    updated = None
    if has_cookies():
        updated = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(os.path.getmtime(COOKIES_FILE)))
        with open(COOKIES_FILE, encoding="utf-8", errors="replace") as f:
            domains = sorted({line.split("\t")[0].lstrip(".").lower() for line in f if line.strip() and not line.startswith("#") and len(line.split("\t")) >= 7})
    sites = sorted({d for d in domains if any(k in d for k in ("youtube", "google", "vimeo", "instagram", "facebook", "twitter", "x.com", "tiktok", "reddit", "soundcloud"))})
    return {"version": yt_dlp.version.__version__, "has_cookies": bool(domains), "cookie_sites": sites[:12], "cookies_updated_at": updated}
