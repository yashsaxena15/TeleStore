# telestore/services/download_check.py
"""Is a finished download really the file?

A source that refuses a download doesn't always say so with an error code: Google Drive in
particular answers "200 OK" with a small web page ("Too many users have viewed or downloaded
this file recently…"). Saved as the file, that page looked like a finished copy. Every leech
checks its result here before it is recorded:

- a web page (by its first bytes) where the file isn't one is refused; Google's limit page
  counts as Google's daily limit (the transfer waits and resumes), anything else as a failure;
- a size different from what the source announced is refused.

The worker on other machines (worker/worker.py) does the same checks.
"""

import re
from typing import Optional

HTML_NAMES = (".htm", ".html", ".xhtml", ".shtml", ".mht", ".mhtml")
HEAD_BYTES = 4096

_QUOTA = re.compile(r"too many users have (viewed or )?downloaded|download quota|quota (was |has been )?exceeded", re.I)


class BadDownload(ValueError):
    """The source sent something other than the file (an error page, or too few or too many bytes)."""


def looks_like_html(head: bytes) -> bool:
    start = head[:1024].lstrip(b"\xef\xbb\xbf \t\r\n").lower()
    return start.startswith((b"<!doctype html", b"<html")) or (start.startswith(b"<") and b"<html" in start and b"<head" in head[:HEAD_BYTES].lower())


def _size(n: int) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024 or unit == "GB":
            return f"{n:.0f} {unit}" if unit == "B" else f"{n:.1f} {unit}"
        n /= 1024
    return f"{n} B"


def check(filename: str, received: int, expected: Optional[int] = None, head: bytes = b"") -> None:
    """Raises when [received] bytes (starting with [head]) aren't [filename] as the source announced it."""
    name = (filename or "").lower()
    if head and not name.endswith(HTML_NAMES) and looks_like_html(head):
        text = re.sub(r"<[^>]+>", " ", head.decode("utf-8", "ignore"))
        if _QUOTA.search(text):
            from telestore.services.remote_transfer_manager.helpers import GoogleDriveQuotaExceededError
            raise GoogleDriveQuotaExceededError(
                f"Google Drive's download limit for '{filename}' was reached (it sent a notice instead of the file)."
            )
        raise BadDownload(f"The source sent a web page instead of '{filename}' ({_size(received)}). Check the link, or try again later.")
    if expected and expected > 0 and received != expected:
        raise BadDownload(f"Only part of '{filename}' arrived: {_size(received)} of {_size(expected)}. Try again.")
