# telestore/services/download_check.py
"""Is a finished download really the file? Every leech checks its result here before it is
recorded: a web page where the file isn't one is refused (Google's limit page counts as Google's
download limit: the file waits and resumes), and so is a size different from what the source
announced. The checks themselves are in telestore/transfer_core.py, shared with worker machines."""

from telestore.transfer_core import HEAD_BYTES, HTML_NAMES, BadDownload, check_download, looks_like_html

__all__ = ["HEAD_BYTES", "HTML_NAMES", "BadDownload", "check", "looks_like_html"]

check = check_download
