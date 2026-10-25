# telestore/services/media_download_service.py
"""Video and audio downloads from YouTube, YouTube Music and the other sites yt-dlp supports.

Links are read with yt-dlp on the server; each video is then downloaded into a task's temp folder
and handed to the Remote Transfers manager, which stores it in Telegram or Google Drive.

yt-dlp's "generic" extractor (which fetches any web page) is turned off and links must point at
public addresses, so a link can't make the server fetch pages on its own network. The owner can
add a cookies.txt export of a signed-in browser (Settings › Integrations); YouTube asks servers
to "confirm you're not a bot" far less often with it, and age-restricted videos then work. The
PO token helper (the "pot" service in docker-compose) answers YouTube's bot checks too.

The owner can install a newer yt-dlp from Settings without rebuilding the image: it goes into
cache/ytdlp/lib, which is put ahead of the built-in copy and kept across restarts.
"""

import asyncio
import base64
import glob
import importlib
import importlib.metadata
import ipaddress
import json
import os
import re
import shutil
import site
import socket
import subprocess
import sys
import threading
import time
import urllib.parse
from typing import Callable, Optional

import requests

from telestore.config.settings import PROJECT_ROOT
from d4rk.Logs import setup_logger

logger = setup_logger("media_download")

SETTINGS_DIR = os.getenv("MEDIA_DOWNLOAD_DIR", os.path.join(PROJECT_ROOT, "cache", "ytdlp"))
COOKIES_FILE = os.path.join(SETTINGS_DIR, "cookies.txt")
COOKIES_STATUS_FILE = os.path.join(SETTINGS_DIR, "cookies-status.json")
LIB_DIR = os.path.join(SETTINGS_DIR, "lib")  # a newer yt-dlp installed from Settings
POT_PROVIDER_URL = os.getenv("POT_PROVIDER_URL", "http://pot:4416").rstrip("/")


def _use_installed_update() -> None:
    if os.path.isdir(os.path.join(LIB_DIR, "yt_dlp")):
        if LIB_DIR not in sys.path:
            sys.path.insert(0, LIB_DIR)
    elif LIB_DIR in sys.path:
        sys.path.remove(LIB_DIR)


_use_installed_update()
import yt_dlp  # noqa: E402  (after the path above, so an installed update wins)

MAX_PLAYLIST_ITEMS = 200
MAX_SYNC_ITEMS = 1000  # how far a synced playlist is read when looking for new videos
# Video: "best", "compat" (H.264, plays everywhere, up to 1080p), a height such as "2160", or
# "fmt:<id>" for sites that only name their versions (Facebook's "sd"/"hd")
QUALITY_LADDER = (4320, 2160, 1440, 1080, 720, 480, 360, 240, 144)
_QUALITY_RE = re.compile(r"^(best|compat|\d{3,4}|fmt:[A-Za-z0-9._-]{1,40})$")
# Audio: "original" keeps the site's own audio as is (no re-encoding); the others convert
AUDIO_FORMATS = ("original", "mp3", "m4a", "flac", "wav")
AUDIO_BITRATES = ("320", "256", "192", "160", "128")
# Exact codes: "en.*" would also fetch YouTube's machine translations into English from every
# other language (en-de-DE, en-ja…), one request each, and YouTube then rate-limits the server
SUBTITLE_LANGS = {"en": ["en", "en-orig", "en-US", "en-GB", "en-IN"], "hi": ["hi", "hi-orig", "hi-IN"], "all": ["all", "-live_chat"]}

NEEDS_COOKIES = "The owner can add YouTube cookies in Settings › Integrations › Video downloads, then try again."
# A YouTube sign-in export always holds these (LOGIN_INFO plus one of the SID cookies)
SIGNED_IN_COOKIES = ({"LOGIN_INFO"}, {"SID", "__Secure-1PSID"})


class MediaError(ValueError):
    """A download problem with a message that can be shown to the user as is."""


class MediaBlocked(MediaError):
    """YouTube is asking the server to prove it isn't a bot; waiting a while usually helps."""


class _Stopped(Exception):
    pass


# ── Links ──────────────────────────────────────────────────────────────────────────────────
_CHANNEL_ROOT = re.compile(r"^/(@[^/]+|channel/[^/]+|c/[^/]+|user/[^/]+)/?$")


def clean_link(url: str) -> str:
    """The link alone: text copied with it (a chat message's time, a title) is dropped."""
    raw = (url or "").strip()
    match = re.search(r"https?://\S+", raw)
    raw = match.group(0) if match else (raw.split()[0] if raw else "")
    return raw.rstrip(".,;)]>\"'")


def check_public_url(url: str) -> str:
    """The cleaned link; raises MediaError for anything but http(s) links to public addresses."""
    raw = clean_link(url)
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
    # A channel's own page lists tabs (Videos, Shorts…); its Videos tab lists the videos
    host = parsed.hostname.lower()
    if host.endswith("youtube.com") and _CHANNEL_ROOT.match(parsed.path or ""):
        raw = urllib.parse.urlunparse(parsed._replace(path=parsed.path.rstrip("/") + "/videos"))
    return raw


def _is_channel(url: str) -> bool:
    return bool(re.search(r"youtube\.com/(@[^/]+|channel/[^/]+|c/[^/]+|user/[^/]+)/(videos|shorts|streams)", url))


def _friendly(error: Exception) -> MediaError:
    if isinstance(error, MediaError):
        return error
    text = re.sub(r"\x1b\[[0-9;]*m", "", str(error))
    lower = text.lower()
    if "age-restricted" in lower or "age restricted" in lower or "confirm your age" in lower or "inappropriate for some users" in lower:
        return MediaError("This video is age-restricted. " + NEEDS_COOKIES)
    if "sign in to confirm" in lower or ("confirm you" in lower and "bot" in lower):
        return MediaBlocked("YouTube asked this server to prove it isn't a bot. " + NEEDS_COOKIES)
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
    if "youtube:tab" in lower and ("http error 400" in lower or "playlist does not exist" in lower):
        return MediaError("This playlist link looks broken or incomplete, or the playlist is private. Copy it again from Share › Copy link.")
    if "video unavailable" in lower or "404" in lower or "has been removed" in lower or "does not exist" in lower:
        return MediaError("This video is unavailable or was removed.")
    if "logged-in" in lower or "login required" in lower or "log in" in lower or "sign in" in lower or "cookies" in lower:
        return MediaError("This site only shows this to signed-in accounts. " + NEEDS_COOKIES.replace("YouTube cookies", "cookies for this site"))
    if "429" in lower or "too many requests" in lower:
        return MediaBlocked("The site is asking us to slow down.")
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
    if POT_PROVIDER_URL:
        opts["extractor_args"] = {"youtubepot-bgutilhttp": {"base_url": [POT_PROVIDER_URL]}}
    if has_cookies():
        opts["cookiefile"] = COOKIES_FILE
    return opts


def _subtitle_langs(choice: dict) -> Optional[list]:
    value = choice.get("subtitles")
    if value is True:  # older requests: a yes/no box meaning English
        value = "en"
    return SUBTITLE_LANGS.get(value) if isinstance(value, str) else None


def _video_format(quality: str) -> dict:
    if quality.startswith("fmt:"):
        return {"format": f"{quality[4:]}/best"}
    if quality == "compat":
        # H.264 + AAC in MP4: plays on every device (YouTube stops H.264 at 1080p)
        return {"format": "bv*[vcodec^=avc1]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b",
                "format_sort": ["res:1080", "vcodec:h264", "ext:mp4:m4a"], "merge_output_format": "mp4"}
    sort = ["fps", "ext:mp4:m4a"]  # at the same size prefer MP4 (AV1/H.264) with AAC: an MP4 file
    if quality.isdigit():
        h = int(quality)
        return {"format": f"bv*[height<={h}]+ba/b[height<={h}]/b", "format_sort": [f"res:{h}", *sort],
                "merge_output_format": "mp4/mkv"}
    return {"format": "bv*+ba/b", "format_sort": ["res", *sort], "merge_output_format": "mp4/mkv"}


def _audio_postprocessors(choice: dict) -> list:
    fmt = choice.get("audio_format") if choice.get("audio_format") in AUDIO_FORMATS else "original"
    if fmt == "original":
        # "best" keeps the codec and only rewraps it (Opus → .opus, AAC → .m4a): nothing re-encoded
        extract = {"key": "FFmpegExtractAudio", "preferredcodec": "best"}
    else:
        bitrate = choice.get("audio_bitrate") if choice.get("audio_bitrate") in AUDIO_BITRATES else "192"
        extract = {"key": "FFmpegExtractAudio", "preferredcodec": fmt,
                   "preferredquality": bitrate if fmt in ("mp3", "m4a") else "0"}
    pps = [extract, {"key": "FFmpegMetadata", "add_metadata": True, "add_chapters": True}]
    if fmt != "wav":  # WAV can't carry a cover
        pps.append({"key": "EmbedThumbnail"})
    return pps


def format_options(choice: dict) -> dict:
    """yt-dlp options for a download choice:
    {"mode": "video", "quality", "subtitles"} or
    {"mode": "audio", "audio_format", "audio_bitrate", "audio_source"}."""
    if choice.get("mode") == "audio":
        source = choice.get("audio_source")
        audio = f"{source}/bestaudio/best" if source and re.fullmatch(r"[A-Za-z0-9._-]{1,40}", source) else "bestaudio/best"
        return {"format": audio, "writethumbnail": True, "postprocessors": _audio_postprocessors(choice)}
    quality = str(choice.get("quality") or "best")
    if not _QUALITY_RE.match(quality):
        quality = "best"
    opts = {
        **_video_format(quality),
        "writethumbnail": True,
        "postprocessors": [
            {"key": "FFmpegMetadata", "add_metadata": True, "add_chapters": True},
            {"key": "EmbedThumbnail"},
        ],
    }
    langs = _subtitle_langs(choice)
    if langs:
        # Captions made by the uploader, plus YouTube's automatic ones for one language
        # ("all" stays with the uploader's: automatic ones exist in a hundred languages)
        opts.update({"writesubtitles": True, "writeautomaticsub": choice.get("subtitles") != "all", "subtitleslangs": langs, "subtitlesformat": "srt/vtt/best"})
        opts["postprocessors"].insert(0, {"key": "FFmpegEmbedSubtitle", "already_have_subtitle": False})
    return opts


_CODEC_NAMES = {"opus": "Opus", "mp4a": "AAC", "aac": "AAC", "vorbis": "Vorbis", "mp3": "MP3", "flac": "FLAC", "ac-3": "AC-3", "ec-3": "E-AC-3"}


def _size(f: dict) -> int:
    return int(f.get("filesize") or f.get("filesize_approx") or 0)


def media_options(info: dict) -> dict:
    """What one video offers: {"video": [{value, height, fps, hdr, size}] largest first, plus named
    versions for sites without sizes; "audio": [{id, codec, abr, size}] best first}."""
    formats = info.get("formats") or []
    has_codec = lambda c: c not in (None, "none")  # noqa: E731
    audio = [f for f in formats if not has_codec(f.get("vcodec")) and has_codec(f.get("acodec"))]
    audio_size = max((_size(f) for f in audio if (f.get("ext") == "m4a")), default=0) or max((_size(f) for f in audio), default=0)

    heights, named = {}, []
    for f in formats:
        if f.get("ext") == "mhtml" or f.get("vcodec") == "none":
            continue  # storyboards and audio-only
        h = f.get("height")
        if h:
            if h < 100:
                continue
            entry = heights.setdefault(h, {"value": str(h), "height": h, "fps": 0, "hdr": False, "size": 0, "_mp4": 0})
            entry["fps"] = max(entry["fps"], round(f.get("fps") or 0))
            entry["hdr"] = entry["hdr"] or (f.get("dynamic_range") or "SDR") != "SDR"
            total = _size(f) + (audio_size if not has_codec(f.get("acodec")) else 0)
            if total:
                entry["size"] = max(entry["size"], total)
                if f.get("ext") == "mp4":  # what "prefer MP4" will pick at this size
                    entry["_mp4"] = max(entry["_mp4"], total)
        elif f.get("format_id"):
            named.append({"value": f"fmt:{f['format_id']}", "label": (f.get("format_note") or f["format_id"]).upper(),
                          "size": _size(f)})
    video = []
    for h in sorted(heights, reverse=True):
        e = heights[h]
        e["size"] = e.pop("_mp4") or e["size"]
        video.append(e)
    if not video:
        video = list(reversed(named))  # e.g. Facebook: HD, SD

    seen, sources = set(), []
    for f in sorted(audio, key=lambda f: f.get("abr") or 0, reverse=True):
        codec = _CODEC_NAMES.get((f.get("acodec") or "").split(".")[0].lower(), (f.get("acodec") or "audio").split(".")[0])
        key = (codec, round(f.get("abr") or 0))
        if key in seen:
            continue
        seen.add(key)
        sources.append({"id": f.get("format_id"), "codec": codec, "abr": round(f.get("abr") or 0), "size": _size(f)})
    return {"video": video, "audio": sources}


# ── Reading links ──────────────────────────────────────────────────────────────────────────
_probe_limit = threading.Semaphore(2)


def _entry_url(entry: dict) -> Optional[str]:
    url = entry.get("webpage_url") or entry.get("url")
    if url and not url.startswith("http") and entry.get("ie_key", "").lower().startswith("youtube"):
        url = f"https://www.youtube.com/watch?v={entry.get('id') or url}"
    return url if url and url.startswith("http") else None


def _probe(url: str, limit: int) -> dict:
    opts = {**_base_options(), "noplaylist": False, "extract_flat": "in_playlist", "playlistend": limit, "skip_download": True}
    with _probe_limit:
        try:
            with yt_dlp.YoutubeDL(opts) as ydl:
                info = ydl.extract_info(url, download=False)
        except Exception as e:
            raise _friendly(e)
    if not info:
        raise MediaError("Couldn't read this link.")
    if info.get("_type") in ("playlist", "multi_video") or info.get("entries") is not None:
        entries = []
        for entry in info.get("entries") or []:
            if not entry or entry.get("_type") == "playlist":
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
            if len(entries) >= limit:
                break
        if not entries:
            raise MediaError("This playlist is empty or private.")
        thumbs = info.get("thumbnails") or []
        title = info.get("title") or "Playlist"
        channel = _is_channel(url)
        return {
            "kind": "playlist",
            "is_channel": channel,
            "title": re.sub(r"\s+-\s+Videos$", "", title) if channel else title,
            "uploader": info.get("uploader") or info.get("channel"),
            "site": info.get("extractor_key"),
            "thumbnail_url": info.get("thumbnail") or (thumbs[-1].get("url") if thumbs else None),
            "count": info.get("playlist_count") or len(entries),
            "entries": entries,
            "url": url,
        }
    if info.get("is_live") or info.get("live_status") in ("is_live", "is_upcoming"):
        raise MediaError("This is a live stream or premiere that hasn't finished. Try again after it ends.")
    link = info.get("webpage_url") or url
    return {
        "kind": "video",
        "is_channel": False,
        "title": info.get("title") or "Video",
        "uploader": info.get("uploader") or info.get("channel") or info.get("artist"),
        "site": info.get("extractor_key"),
        "thumbnail_url": info.get("thumbnail"),
        "duration": info.get("duration"),
        "options": media_options(info),
        "count": 1,
        "entries": [{"index": 1, "url": link, "title": info.get("title") or link, "duration": info.get("duration")}],
        "url": url,
    }


async def probe(url: str, limit: int = MAX_PLAYLIST_ITEMS) -> dict:
    """{kind: video|playlist, is_channel, title, uploader, site, thumbnail_url, duration?, count, url,
    entries: [{index, url, title, duration}]}"""
    url = check_public_url(url)
    return await asyncio.to_thread(_probe, url, limit)


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
def _download(url: str, choice: dict, dest_dir: str, progress: Optional[Callable[[int, int, int], None]], should_stop: Callable[[], bool]) -> tuple:
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

    def run(with_choice: dict):
        opts = {
            **_base_options(),
            **format_options(with_choice),
            # Just the title; the manager adds the video ID only when the folder already has that name
            "outtmpl": os.path.join(dest_dir, "%(title).150B.%(ext)s"),
            "paths": {"home": dest_dir, "temp": dest_dir},
            "progress_hooks": [hook],
        }
        try:
            with yt_dlp.YoutubeDL(opts) as ydl:
                return ydl.extract_info(url, download=True)
        except _Stopped:
            raise InterruptedError("Cancelled by user")
        except Exception as e:
            if isinstance(getattr(e, "exc_info", (None, None))[1], _Stopped) or should_stop():
                raise InterruptedError("Cancelled by user")
            raise _friendly(e)

    try:
        info = run(choice)
    except MediaError as e:
        # Subtitles are a bonus: when the site slows us down, try once more without them
        if not _subtitle_langs(choice) or not isinstance(e, MediaBlocked):
            raise
        logger.info(f"Retrying {url} without subtitles: {e}")
        for leftover in glob.glob(os.path.join(dest_dir, "*")):
            os.remove(leftover)
        info = run({**choice, "subtitles": None})

    downloads = (info or {}).get("requested_downloads") or []
    path = downloads[-1].get("filepath") if downloads else None
    if not path or not os.path.exists(path):
        # Fall back to the newest media file in the folder (post-processors rename files)
        files = [f for f in glob.glob(os.path.join(dest_dir, "*")) if not f.endswith((".part", ".ytdl", ".jpg", ".webp", ".png", ".srt", ".vtt"))]
        if not files:
            raise MediaError("The download finished but no file was produced.")
        path = max(files, key=os.path.getmtime)
    return path, (info or {}).get("id")


async def download(url: str, choice: dict, dest_dir: str, progress=None, should_stop=lambda: False) -> tuple:
    """Downloads one video (or its audio) into dest_dir; returns (file path, video ID)."""
    return await asyncio.to_thread(_download, url, choice, dest_dir, progress, should_stop)


# ── Cookies (owner) ────────────────────────────────────────────────────────────────────────
def _cookie_rows(text: str) -> list:
    return [line.split("\t") for line in text.splitlines() if line.strip() and not line.startswith("#") and len(line.split("\t")) >= 7]


def _check_youtube_sign_in() -> str:
    """"signed_in", "signed_out" or "unknown" (YouTube was blocking or unreachable), asking for Watch Later."""
    opts = {**_base_options(), "noplaylist": False, "extract_flat": "in_playlist", "playlistend": 1, "skip_download": True}
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            ydl.extract_info("https://www.youtube.com/playlist?list=WL", download=False)
        return "signed_in"
    except Exception as e:
        text = str(e).lower()
        if "does not exist" in text or "sign in" in text and "bot" not in text:
            return "signed_out"
        return "unknown"


def save_cookies(data: bytes) -> dict:
    text = data.decode("utf-8", errors="replace")
    rows = _cookie_rows(text)
    if not text.lstrip().startswith(("# Netscape HTTP Cookie File", "# HTTP Cookie File")) and not rows:
        raise MediaError("That isn't a cookies.txt file. Export one with the \"Get cookies.txt LOCALLY\" extension.")
    if not rows:
        raise MediaError("That cookies.txt file is empty.")
    youtube_names = {r[5] for r in rows if "youtube.com" in r[0].lower()}
    if youtube_names and not all(youtube_names & needed for needed in SIGNED_IN_COOKIES):
        raise MediaError("These cookies aren't from a signed-in YouTube. Sign in at youtube.com (your picture shows at the top right), export again from that tab, then add the new file.")
    # Merge by site: a Facebook export replaces Facebook's cookies and keeps YouTube's
    new_sites = {_site(r[0]) for r in rows}
    kept = []
    if has_cookies():
        with open(COOKIES_FILE, encoding="utf-8", errors="replace") as f:
            kept = ["\t".join(r) for r in _cookie_rows(f.read()) if _site(r[0]) not in new_sites]
    lines = ["# Netscape HTTP Cookie File", *kept, *("\t".join(r) for r in rows)]
    os.makedirs(SETTINGS_DIR, mode=0o700, exist_ok=True)
    with open(COOKIES_FILE, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    os.chmod(COOKIES_FILE, 0o600)
    if youtube_names:  # only a new YouTube export changes what YouTube says about the sign-in
        with open(COOKIES_STATUS_FILE, "w") as f:
            json.dump({"youtube": _check_youtube_sign_in(), "checked_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}, f)
    return settings()


def _site(domain: str) -> str:
    """The site a cookie belongs to: ".m.facebook.com" → "facebook.com"."""
    parts = domain.lstrip(".").lower().split(".")
    return ".".join(parts[-2:])


def remove_cookies() -> dict:
    for path in (COOKIES_FILE, COOKIES_STATUS_FILE):
        try:
            os.remove(path)
        except FileNotFoundError:
            pass
    return settings()


# ── Updating yt-dlp (owner) ────────────────────────────────────────────────────────────────
_update_lock = threading.Lock()


def _builtin_version() -> Optional[str]:
    for dist in importlib.metadata.distributions(path=site.getsitepackages()):
        if (dist.metadata["Name"] or "").lower() == "yt-dlp":
            return dist.version
    return None


def _reload_yt_dlp() -> None:
    """Loads yt-dlp again (downloads already running keep the copy they started with)."""
    global yt_dlp
    for name in [n for n in sys.modules if n.split(".")[0] in ("yt_dlp", "yt_dlp_ejs", "yt_dlp_plugins")]:
        del sys.modules[name]
    _use_installed_update()
    importlib.invalidate_caches()
    yt_dlp = importlib.import_module("yt_dlp")


def _update() -> dict:
    if not _update_lock.acquire(blocking=False):
        raise MediaError("An update is already running.")
    try:
        new_dir, old_dir = LIB_DIR + ".new", LIB_DIR + ".old"
        shutil.rmtree(new_dir, ignore_errors=True)
        result = subprocess.run(
            [sys.executable, "-m", "pip", "install", "--quiet", "--no-cache-dir", "--disable-pip-version-check",
             "--upgrade", "--no-deps", "--target", new_dir, "yt-dlp", "yt-dlp-ejs"],
            capture_output=True, text=True, timeout=300,
        )
        if result.returncode != 0:
            shutil.rmtree(new_dir, ignore_errors=True)
            logger.warning(f"yt-dlp update failed: {(result.stderr or result.stdout)[-400:]}")
            raise MediaError("Couldn't download the update. Check the server's internet connection and try again.")
        shutil.rmtree(old_dir, ignore_errors=True)
        if os.path.isdir(LIB_DIR):
            os.rename(LIB_DIR, old_dir)
        os.rename(new_dir, LIB_DIR)
        shutil.rmtree(old_dir, ignore_errors=True)
        _reload_yt_dlp()
        logger.info(f"yt-dlp updated to {yt_dlp.version.__version__}")
        return settings()
    finally:
        _update_lock.release()


async def update_yt_dlp() -> dict:
    """Installs the newest yt-dlp into cache/ytdlp/lib and switches to it."""
    return await asyncio.to_thread(_update)


def use_builtin_yt_dlp() -> dict:
    with _update_lock:
        shutil.rmtree(LIB_DIR, ignore_errors=True)
        _reload_yt_dlp()
    return settings()


# ── Status ─────────────────────────────────────────────────────────────────────────────────
def _pot_running() -> bool:
    if not POT_PROVIDER_URL:
        return False
    try:
        return requests.get(f"{POT_PROVIDER_URL}/ping", timeout=2).ok
    except Exception:
        return False


def settings() -> dict:
    sites, updated, status = [], None, None
    if has_cookies():
        updated = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(os.path.getmtime(COOKIES_FILE)))
        with open(COOKIES_FILE, encoding="utf-8", errors="replace") as f:
            domains = sorted({r[0].lstrip(".").lower() for r in _cookie_rows(f.read())})
        sites = sorted({_site(d) for d in domains})
        try:
            with open(COOKIES_STATUS_FILE) as f:
                status = json.load(f).get("youtube")
        except (OSError, ValueError):
            status = None
    version = yt_dlp.version.__version__
    builtin = _builtin_version()
    return {
        "version": version,
        "builtin_version": builtin,
        "updated": os.path.isdir(os.path.join(LIB_DIR, "yt_dlp")),
        "has_cookies": has_cookies(),
        "cookie_sites": sites[:12],
        "cookies_updated_at": updated,
        "youtube_sign_in": status,
        "pot_helper": _pot_running(),
    }


async def get_settings() -> dict:
    return await asyncio.to_thread(settings)
