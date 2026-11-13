"""Faster reading of files from Telegram: several connections kept open, several pieces at once.

Telegram's client library (Pyrogram) reads a file 1 MB at a time, one after another, over a brand-new
connection it opens for every read (a seek in a video, every download), and by default lets only one
file be read at a time. From a PC that comes to 1-2 MB/s whatever the line, and a second download
waits for the first.

This keeps a few connections open per Telegram data centre and asks for up to [window] 1 MB pieces of
a range at once, spread over them, handing the bytes back in order. All reads share a limit on the
pieces in flight, so several downloads and a video play side by side. A piece that fails is tried
again; anything this can't read (a file served from Telegram's CDN) raises Unsupported, and the
caller reads it the library's way.
"""

import asyncio
import logging
from typing import AsyncIterator, Dict, List

from pyrogram import raw
from pyrogram import errors as tg_errors
from pyrogram.file_id import FileId, FileType
from pyrogram.session import Auth, Session

log = logging.getLogger("telestore.fast_download")
CHUNK = 1024 * 1024  # Telegram's largest piece; offsets stay multiples of it
ATTEMPTS = 5


class Unsupported(Exception):
    """This file can't be read the fast way (read it the library's way instead)."""


class ReferenceExpired(Exception):
    """The message's file reference is old: fetch the message again and retry."""


def media_of(message):
    for kind in ("document", "video", "audio", "voice", "animation", "video_note", "photo", "sticker"):
        media = getattr(message, kind, None)
        if media is not None and getattr(media, "file_id", None):
            return media
    return None


def location_of(file_id: FileId):
    if file_id.file_type == FileType.PHOTO:
        return raw.types.InputPhotoFileLocation(id=file_id.media_id, access_hash=file_id.access_hash,
                                                file_reference=file_id.file_reference,
                                                thumb_size=file_id.thumbnail_size)
    if file_id.file_type == FileType.CHAT_PHOTO:
        raise Unsupported("chat photos")
    return raw.types.InputDocumentFileLocation(id=file_id.media_id, access_hash=file_id.access_hash,
                                               file_reference=file_id.file_reference,
                                               thumb_size=file_id.thumbnail_size)


class FastReader:
    def __init__(self, client, connections: int = 4, window: int = 8, max_in_flight: int = 24):
        self.client = client
        self.connections = max(1, connections)
        self.window = max(1, window)
        self.pieces = asyncio.Semaphore(max(1, max_in_flight))  # shared by every read
        self.pools: Dict[int, List[Session]] = {}
        self.turn: Dict[int, int] = {}
        self.locks: Dict[int, asyncio.Lock] = {}

    async def _session(self, dc_id: int) -> Session:
        """One of the open connections to [dc_id], in turn (opened the first time they're needed)."""
        lock = self.locks.setdefault(dc_id, asyncio.Lock())
        async with lock:
            pool = self.pools.setdefault(dc_id, [])
            if len(pool) < self.connections:
                pool.append(await self._open(dc_id))
            n = self.turn.get(dc_id, 0)
            self.turn[dc_id] = n + 1
            return pool[n % len(pool)]

    async def _open(self, dc_id: int) -> Session:
        storage = self.client.storage
        home = await storage.dc_id()
        test = await storage.test_mode()
        key = await storage.auth_key() if dc_id == home else await Auth(self.client, dc_id, test).create()
        session = Session(self.client, dc_id, key, test, is_media=True)
        await session.start()
        if dc_id != home:
            exported = await self.client.invoke(raw.functions.auth.ExportAuthorization(dc_id=dc_id))
            await session.invoke(raw.functions.auth.ImportAuthorization(id=exported.id, bytes=exported.bytes))
        return session

    async def _drop(self, dc_id: int, session: Session) -> None:
        """Forgets a connection that broke (a new one opens next time)."""
        pool = self.pools.get(dc_id) or []
        if session in pool:
            pool.remove(session)
        try:
            await session.stop()
        except Exception:
            pass

    async def _piece(self, dc_id: int, location, index: int) -> bytes:
        for attempt in range(1, ATTEMPTS + 1):
            session = await self._session(dc_id)
            try:
                async with self.pieces:
                    r = await session.invoke(raw.functions.upload.GetFile(
                        location=location, offset=index * CHUNK, limit=CHUNK, precise=False, cdn_supported=False),
                        sleep_threshold=30)
                if isinstance(r, raw.types.upload.File):
                    return r.bytes
                raise Unsupported(type(r).__name__)  # e.g. FileCdnRedirect
            except (Unsupported, asyncio.CancelledError):
                raise
            except tg_errors.FileReferenceExpired as e:
                raise ReferenceExpired() from e
            except tg_errors.FloodWait as e:
                await asyncio.sleep(int(e.value) + 1)
            except Exception as e:
                if attempt == ATTEMPTS:
                    raise
                log.info(f"Piece {index} failed ({type(e).__name__}: {e}); trying again")
                if isinstance(e, (OSError, ConnectionError, TimeoutError)):
                    await self._drop(dc_id, session)
                await asyncio.sleep(min(8, attempt * 1.5))
        raise IOError("unreachable")

    async def read(self, message, start: int, end: int) -> AsyncIterator[bytes]:
        """Bytes [start, end] of the message's file, in order, several pieces fetched at once."""
        media = media_of(message)
        if media is None:
            raise Unsupported("no file in the message")
        file_id = FileId.decode(media.file_id)
        location = location_of(file_id)
        dc_id = file_id.dc_id
        first, last = start // CHUNK, end // CHUNK
        ahead: Dict[int, asyncio.Task] = {}
        nxt = first
        try:
            for index in range(first, last + 1):
                while nxt <= last and nxt < index + self.window:
                    ahead[nxt] = asyncio.ensure_future(self._piece(dc_id, location, nxt))
                    nxt += 1
                data = await ahead.pop(index)
                lo = start - index * CHUNK if index == first else 0
                hi = end - index * CHUNK + 1 if index == last else len(data)
                piece = data[lo:hi]
                if not piece:
                    break
                yield piece
        finally:
            for task in ahead.values():
                task.cancel()
            if ahead:
                await asyncio.gather(*ahead.values(), return_exceptions=True)

    async def close(self) -> None:
        for dc_id, pool in list(self.pools.items()):
            for session in list(pool):
                await self._drop(dc_id, session)
        self.pools.clear()
