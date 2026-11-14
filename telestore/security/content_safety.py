"""Serving people's own files safely from the site's origin.

Anyone can upload any file, and the site keeps the sign-in in the browser. A file that a browser
would run as a page (HTML, SVG, XML, scripts) opened from this origin could read that sign-in. So
every file response says "don't guess the type" (nosniff) and "this is not a page of the site"
(a CSP sandbox: no scripts, its own empty origin), and page-like files are never shown inline.
PDFs skip the sandbox (browsers then refuse to show them) — their viewers don't run page scripts.
"""

ACTIVE_TYPES = {
    "text/html", "application/xhtml+xml", "image/svg+xml", "text/xml", "application/xml",
    "text/javascript", "application/javascript", "application/x-javascript", "application/ecmascript",
    "text/ecmascript", "text/xsl", "application/xslt+xml", "multipart/x-mixed-replace",
    "application/rss+xml", "application/atom+xml", "application/mathml+xml",
}
SANDBOX = "sandbox; default-src 'none'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'unsafe-inline'"


def _base(mime: str) -> str:
    return (mime or "").split(";", 1)[0].strip().lower()


def is_active(mime: str) -> bool:
    """A type a browser would run as a page."""
    return _base(mime) in ACTIVE_TYPES


def disposition(inline_wanted: bool, mime: str) -> str:
    """inline only for files that can't act as a page (SVG still shows in <img>, which never runs it)."""
    if not inline_wanted:
        return "attachment"
    return "attachment" if is_active(mime) and _base(mime) != "image/svg+xml" else "inline"


def file_headers(mime: str) -> dict:
    headers = {"X-Content-Type-Options": "nosniff"}
    if _base(mime) != "application/pdf":
        headers["Content-Security-Policy"] = SANDBOX
    return headers
