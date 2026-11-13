"""Updates from GitHub Releases, like the Android app's.

Every merge to main replaces the rolling "windows-latest" pre-release (Beta); a tag like
windows-v1.2.0 makes a tested release (Stable). Each release carries the installer
TeleStore-Setup-<version>.exe. The app compares that version with its own, downloads the
installer and runs it; the installer closes the app, replaces it and opens it again. Sign-ins,
settings and unfinished uploads live in %APPDATA%\\TeleStore, so they stay.
"""

import os
import re
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from typing import Callable, Iterable, List, Optional, Tuple

import requests

from telestore_desktop import __version__

REPO = "yashsaxena15/TeleStore"
RELEASES = f"https://api.github.com/repos/{REPO}/releases?per_page=40"
PAGE = f"https://github.com/{REPO}/releases"
SETUP = re.compile(r"^TeleStore-Setup-(\d+(?:\.\d+)*)\.exe$", re.I)
CHANNELS = {"stable": "Stable (tested releases)", "beta": "Beta (every new build)"}


@dataclass
class Release:
    version: str
    channel: str  # stable or beta
    setup_url: str
    size: int
    page_url: str
    notes: str = ""


def version_tuple(text: str) -> Tuple[int, ...]:
    nums = re.findall(r"\d+", text or "")
    return tuple(int(n) for n in nums[:4]) or (0,)


def is_newer(candidate: str, current: str) -> bool:
    a, b = version_tuple(candidate), version_tuple(current)
    width = max(len(a), len(b))
    return a + (0,) * (width - len(a)) > b + (0,) * (width - len(b))


def releases_from(listing: Iterable[dict]) -> List[Release]:
    """The Windows releases among GitHub's list (Android ones are skipped), with their installer."""
    out = []
    for r in listing or []:
        tag = r.get("tag_name") or ""
        if tag == "windows-latest":
            channel = "beta"
        elif tag.startswith("windows-v") and not r.get("prerelease") and not r.get("draft"):
            channel = "stable"
        else:
            continue
        for asset in r.get("assets") or []:
            m = SETUP.match(asset.get("name") or "")
            if m:
                out.append(Release(m.group(1), channel, asset.get("browser_download_url") or "", int(asset.get("size") or 0),
                                   r.get("html_url") or PAGE, (r.get("body") or "").strip()))
                break
    return out


def newest(releases: Iterable[Release], channel: str) -> Optional[Release]:
    """Stable: only tested releases. Beta: the newest of everything."""
    pick = [r for r in releases if channel == "beta" or r.channel == "stable"]
    return max(pick, key=lambda r: version_tuple(r.version), default=None)


def check(channel: str = "beta", current: str = __version__, get: Callable = requests.get) -> Optional[Release]:
    """The release to update to, or None when this is already the newest."""
    try:
        resp = get(RELEASES, timeout=20, headers={"Accept": "application/vnd.github+json",
                                                  "User-Agent": f"TeleStore-Windows/{current}"})
    except requests.RequestException as e:
        raise ConnectionError(f"Couldn't reach GitHub to look for updates ({type(e).__name__}).") from e
    if resp.status_code >= 400:
        raise ConnectionError(f"GitHub answered {resp.status_code} when looking for updates.")
    best = newest(releases_from(resp.json()), channel)
    return best if best and is_newer(best.version, current) else None


def download(release: Release, progress: Optional[Callable[[int, int], bool]] = None, folder: Optional[str] = None,
             get: Callable = requests.get) -> str:
    """Saves the installer to a temporary folder and returns its path; [progress] returning False stops it."""
    folder = folder or os.path.join(tempfile.gettempdir(), "TeleStore-update")
    os.makedirs(folder, exist_ok=True)
    target = os.path.join(folder, f"TeleStore-Setup-{release.version}.exe")
    if os.path.isfile(target) and release.size and os.path.getsize(target) == release.size:
        return target  # downloaded already
    tmp = target + ".part"
    try:
        with get(release.setup_url, stream=True, timeout=(20, 120)) as resp:
            if resp.status_code >= 400:
                raise ConnectionError(f"The download failed (HTTP {resp.status_code}).")
            total = int(resp.headers.get("Content-Length") or release.size or 0)
            done = 0
            with open(tmp, "wb") as f:
                for chunk in resp.iter_content(512 * 1024):
                    f.write(chunk)
                    done += len(chunk)
                    if progress and progress(done, total) is False:
                        raise InterruptedError("Update download cancelled")
        if release.size and os.path.getsize(tmp) != release.size:
            raise ConnectionError("The update didn't download completely. Try again.")
        os.replace(tmp, target)
        return target
    except requests.RequestException as e:
        raise ConnectionError(f"The update download stopped ({type(e).__name__}).") from e
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)


def installed() -> bool:
    """True when this copy was installed by the setup (it can update itself in place)."""
    if not getattr(sys, "frozen", False):
        return False
    return os.path.isfile(os.path.join(os.path.dirname(sys.executable), "unins000.exe"))


def run_installer(path: str, quiet: bool) -> None:
    """Starts the installer on its own (it outlives the app). Quiet: shows only its progress, then opens TeleStore."""
    args = [path] + (["/SILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/CLOSEAPPLICATIONS"] if quiet else [])
    flags = 0
    if sys.platform == "win32":
        flags = subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP  # type: ignore[attr-defined]
    subprocess.Popen(args, close_fds=True, creationflags=flags)
