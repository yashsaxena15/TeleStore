"""The visitor's address. nginx in front of the app sets X-Real-IP to the address it saw; that
header is only believed when the request really came through a proxy on this machine (or the
Docker network), so a visitor can't pick their own address by sending the header themselves."""

import ipaddress

from fastapi import Request


def client_ip(request: Request) -> str:
    peer = request.client.host if request.client else ""
    try:
        via_proxy = ipaddress.ip_address(peer).is_private or ipaddress.ip_address(peer).is_loopback
    except ValueError:
        via_proxy = False
    if via_proxy:
        real = (request.headers.get("x-real-ip") or "").strip()
        if real:
            return real
    return peer or "?"
