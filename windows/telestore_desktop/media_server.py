"""Phase 10: your own files straight from Telegram, for the player, the photo viewer and downloads.

A small web server on this PC only (127.0.0.1, with a random secret in every address) serves a file
by streaming it from your storage channel with your own Telegram account, with byte ranges, so
videos start at once and seeking works. The TeleStore server only says which messages hold the file
(GET /direct/locate). For anything it can't serve (a file shared with you, the Private Vault, a
Telegram problem) it sends the player to the TeleStore server's own address instead, as before.
"""

import asyncio
import logging
import mimetypes
import re
import secrets
import time
from typing import Optional
from urllib.parse import parse_qs, quote, unquote, urlsplit

log = logging.getLogger("telestore.media")
CHUNK = 1024 * 1024  # what Telegram sends at a time
LOCATE_SECONDS = 600
# Windows' own list misses some (.mkv, .flac…), so the usual media types are named here first
TYPES = {".mp4": "video/mp4", ".m4v": "video/mp4", ".mkv": "video/x-matroska", ".webm": "video/webm", ".mov": "video/quicktime",
         ".avi": "video/x-msvideo", ".ts": "video/mp2t", ".3gp": "video/3gpp", ".wmv": "video/x-ms-wmv", ".flv": "video/x-flv",
         ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".aac": "audio/aac", ".flac": "audio/flac", ".ogg": "audio/ogg",
         ".opus": "audio/ogg", ".wav": "audio/wav", ".wma": "audio/x-ms-wma", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
         ".png": "image/png", ".gif": "image/gif", ".webp": "image/webp", ".bmp": "image/bmp", ".heic": "image/heic",
         ".pdf": "application/pdf", ".zip": "application/zip", ".txt": "text/plain"}


def content_type(name: str) -> str:
    ext = ("." + name.rsplit(".", 1)[-1].lower()) if "." in name else ""
    return TYPES.get(ext) or mimetypes.guess_type(name)[0] or "application/octet-stream"


class MediaServer:
    def __init__(self, account, api):
        self.account, self.api = account, api
        self.secret = secrets.token_urlsafe(18)
        self.port = 0
        self.server: Optional[asyncio.AbstractServer] = None
        self.places = {}  # file id -> (when, the server's answer)
        self.messages = {}  # (chat, message) -> message
        self.served = 0  # bytes sent (for tests and the log)

    async def start(self) -> None:
        self.server = await asyncio.start_server(self._handle, "127.0.0.1", 0)
        self.port = self.server.sockets[0].getsockname()[1]
        log.info(f"Opening files straight from Telegram on 127.0.0.1:{self.port}")

    async def stop(self) -> None:
        if self.server:
            self.server.close()
            await self.server.wait_closed()

    def url(self, item, inline: bool = True) -> Optional[str]:
        """This PC's address for one of your own files, or None (shared files go through TeleStore)."""
        if not self.port or item.share_id or item.is_folder:
            return None
        return (f"http://127.0.0.1:{self.port}/{self.secret}/f/{quote(item.id, safe='')}/{quote(item.name, safe='')}"
                + ("" if inline else "?download=1"))

    # ── Serving ──
    async def _handle(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        try:
            head = await asyncio.wait_for(reader.readuntil(b"\r\n\r\n"), 30)
            await self._serve(head.decode("latin-1"), writer)
        except (asyncio.IncompleteReadError, asyncio.LimitOverrunError, asyncio.TimeoutError, ConnectionError):
            pass
        except Exception as e:
            log.warning(f"Serving a file failed: {e}")
        finally:
            try:
                writer.close()
                await writer.wait_closed()
            except Exception:
                pass

    async def _serve(self, head: str, writer) -> None:
        lines = head.split("\r\n")
        method, target = (lines[0].split(" ") + ["", ""])[:2]
        headers = {k.strip().lower(): v.strip() for k, _, v in (ln.partition(":") for ln in lines[1:] if ":" in ln)}
        url = urlsplit(target)
        bits = url.path.split("/")
        if method not in ("GET", "HEAD") or len(bits) < 5 or bits[1] != self.secret or bits[2] != "f":
            return await self._reply(writer, 404, {"Content-Length": "0"})
        file_id, name = unquote(bits[3]), unquote(bits[4])
        download = "download" in parse_qs(url.query)
        try:
            place = await self._locate(file_id)
        except Exception as e:  # not ours to serve: the TeleStore server serves it, as before
            log.info(f"Opening {name} through TeleStore ({e})")
            return await self._redirect(writer, file_id, name, download)

        size = int(place["size"])
        start, end, status = 0, max(0, size - 1), 200
        m = re.match(r"bytes=(\d*)-(\d*)", headers.get("range", ""))
        if m and size:
            if m.group(1):
                start = int(m.group(1))
                end = min(int(m.group(2)), size - 1) if m.group(2) else size - 1
            elif m.group(2):  # the last N bytes
                start, end = max(0, size - int(m.group(2))), size - 1
            if start > end or start >= size:
                return await self._reply(writer, 416, {"Content-Range": f"bytes */{size}", "Content-Length": "0"})
            status = 206
        length = end - start + 1 if size else 0
        out = {"Content-Type": content_type(name), "Accept-Ranges": "bytes",
               "Content-Length": str(length), "Cache-Control": "no-store",
               "Content-Disposition": f"{'attachment' if download else 'inline'}; filename*=UTF-8''{quote(name)}"}
        if status == 206:
            out["Content-Range"] = f"bytes {start}-{end}/{size}"
        await self._reply(writer, status, out)
        if method == "GET" and length:
            await self._send_range(writer, place["parts"], start, end)

    async def _reply(self, writer, status: int, headers: dict) -> None:
        reason = {200: "OK", 206: "Partial Content", 302: "Found", 404: "Not Found", 416: "Range Not Satisfiable"}[status]
        text = f"HTTP/1.1 {status} {reason}\r\n" + "".join(f"{k}: {v}\r\n" for k, v in headers.items()) + "Connection: close\r\n\r\n"
        writer.write(text.encode("latin-1", "replace"))
        await writer.drain()

    async def _redirect(self, writer, file_id: str, name: str, download: bool) -> None:
        from types import SimpleNamespace
        item = SimpleNamespace(id=file_id, name=name, share_id=None)
        await self._reply(writer, 302, {"Location": self.api.server_file_url(item, inline=not download), "Content-Length": "0"})

    async def _locate(self, file_id: str) -> dict:
        known = self.places.get(file_id)
        if known and time.monotonic() - known[0] < LOCATE_SECONDS:
            return known[1]
        place = await asyncio.to_thread(self.api.locate, file_id)
        self.places[file_id] = (time.monotonic(), place)
        return place

    async def _message(self, chat_id: int, message_id: int):
        key = (chat_id, message_id)
        if key not in self.messages:
            await self.account.ensure_chat(chat_id)
            msg = await self.account.client.get_messages(chat_id, message_id)
            if not msg or getattr(msg, "empty", False):
                raise LookupError("That message isn't in your channel")
            self.messages[key] = msg
        return self.messages[key]

    async def _send_range(self, writer, parts, start: int, end: int) -> None:
        """Bytes [start, end] of the file, from the parts' messages, 1 MB at a time from Telegram."""
        for part in parts:
            p_start, p_size = int(part["start"]), int(part["size"])
            p_end = p_start + p_size - 1
            if p_end < start or p_start > end:
                continue
            lo, hi = max(start, p_start) - p_start, min(end, p_end) - p_start
            msg = await self._message(int(part["chat_id"]), int(part["message_id"]))
            skip, need = lo % CHUNK, hi - lo + 1
            async for chunk in self.account.client.stream_media(msg, offset=lo // CHUNK):
                piece = chunk[skip:skip + need]
                skip = 0
                writer.write(piece)
                await writer.drain()
                need -= len(piece)
                self.served += len(piece)
                if need <= 0:
                    break
            if need > 0:
                raise IOError(f"Telegram sent {need} bytes too few")
