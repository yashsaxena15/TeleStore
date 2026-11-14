"""Links people give the server to download (remote leech) may only reach the public internet.

Otherwise anyone allowed to leech could make the server fetch addresses only it can reach (the
cloud provider's metadata service, the database, the app itself, machines on the private network)
and then read the answer from their own storage. Every request is checked, including each redirect
(the guarded session checks before it connects).
"""

import ipaddress
import socket
import urllib.parse

import requests
from requests.adapters import HTTPAdapter

PRIVATE_LINK = "Links to private or local network addresses can't be downloaded."


def host_is_public(host: str, port: int = 443) -> bool:
    try:
        infos = socket.getaddrinfo(host, port, proto=socket.IPPROTO_TCP)
    except socket.gaierror:
        return True  # unknown names fail on their own when fetched; nothing private is reached
    for info in infos:
        ip = ipaddress.ip_address(info[4][0].split("%", 1)[0])
        if not ip.is_global:
            return False
    return bool(infos)


def check_url(url: str) -> None:
    """Raises ValueError for an http(s) link to a non-public address (or another scheme)."""
    parsed = urllib.parse.urlparse(url or "")
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise ValueError("Only http and https links can be downloaded.")
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    if not host_is_public(parsed.hostname, port):
        raise ValueError(PRIVATE_LINK)


class _PublicOnly(HTTPAdapter):
    def send(self, request, *args, **kwargs):
        check_url(request.url)
        return super().send(request, *args, **kwargs)


def guard(session: requests.Session) -> requests.Session:
    session.mount("http://", _PublicOnly())
    session.mount("https://", _PublicOnly())
    return session


def session() -> requests.Session:
    """A requests session that refuses private addresses, redirects included."""
    return guard(requests.Session())
