"""Faster uploads of one file: several connections to Telegram, a few pieces on each.

Telegram's client library (Pyrogram) sends a big file over one connection, 4 pieces of 512 KB at a
time, which comes to about 5 MB/s whatever the line. Telegram accepts the pieces of one file over
several connections at once, in any order, so this sends [connections] x [per_connection] pieces at a
time (12 by default). Each piece is tried again when it fails (Pyrogram only logs a failed piece,
which leaves a hole in the file).

It replaces the client's save_file for big files (over 10 MB); small files and thumbnails still go
the library's way. Anything unexpected makes that file go the library's way too (see install()).
"""

import asyncio
import inspect
import io
import logging
import math
from pathlib import PurePath

from pyrogram import StopTransmission, raw
from pyrogram import errors as tg_errors
from pyrogram.session import Session

log = logging.getLogger("telestore.fast_upload")
PIECE = 512 * 1024
BIG = 10 * 1024 * 1024
PIECE_ATTEMPTS = 5


class FastUploadError(Exception):
    pass


async def save_big_file(client, fp, file_size: int, file_name: str, progress=None, progress_args=(),
                        connections: int = 3, per_connection: int = 4, make_session=None):
    """Uploads [fp] (a seekable binary file of [file_size] bytes) and returns its InputFileBig."""
    total = math.ceil(file_size / PIECE)
    file_id = client.rnd_id()
    make_session = make_session or (lambda: _media_session(client))
    sessions = [await make_session() for _ in range(max(1, connections))]
    queue: asyncio.Queue = asyncio.Queue(maxsize=max(2, connections * per_connection))
    failure = []

    async def worker(session):
        while True:
            job = await queue.get()
            if job is None or failure:
                return
            index, data = job
            for attempt in range(1, PIECE_ATTEMPTS + 1):
                try:
                    ok = await session.invoke(raw.functions.upload.SaveBigFilePart(
                        file_id=file_id, file_part=index, file_total_parts=total, bytes=data))
                    if ok is False:
                        raise FastUploadError(f"Telegram refused piece {index}")
                    break
                except tg_errors.FloodWait as e:
                    await asyncio.sleep(int(e.value) + 1)
                except (asyncio.CancelledError, StopTransmission):
                    raise
                except Exception as e:
                    if attempt == PIECE_ATTEMPTS:
                        failure.append(e)
                        return
                    await asyncio.sleep(min(10, 2 * attempt))

    workers = [asyncio.ensure_future(worker(s)) for s in sessions for _ in range(max(1, per_connection))]
    try:
        fp.seek(0)
        for index in range(total):
            if failure:
                break
            data = fp.read(PIECE)
            if not data:
                break
            await queue.put((index, data))
            if progress:
                result = progress(min((index + 1) * PIECE, file_size), file_size, *progress_args)
                if inspect.isawaitable(result):
                    await result
        for _ in workers:
            await queue.put(None)
        await asyncio.gather(*workers)
    finally:
        for w in workers:
            if not w.done():
                w.cancel()
        await asyncio.gather(*workers, return_exceptions=True)
        for s in sessions:
            try:
                await s.stop()
            except Exception:
                pass
    if failure:
        raise FastUploadError(f"A piece couldn't be sent: {failure[0]}")
    return raw.types.InputFileBig(id=file_id, parts=total, name=file_name)


async def _media_session(client):
    session = Session(client, await client.storage.dc_id(), await client.storage.auth_key(),
                      await client.storage.test_mode(), is_media=True)
    await session.start()
    return session


def install(client, connections: int = 3, per_connection: int = 4) -> None:
    """Makes [client] send big files the fast way (its send_document etc. call client.save_file)."""
    original = client.save_file

    async def save_file(path, file_id=None, file_part=0, progress=None, progress_args=()):
        if path is None or file_id is not None or file_part:
            return await original(path, file_id=file_id, file_part=file_part, progress=progress, progress_args=progress_args)
        own = isinstance(path, (str, PurePath))
        fp = open(path, "rb") if own else path
        if not isinstance(fp, io.IOBase):
            return await original(path, progress=progress, progress_args=progress_args)
        try:
            fp.seek(0, io.SEEK_END)
            size = fp.tell()
            fp.seek(0)
            if size <= BIG:
                return await original(path, progress=progress, progress_args=progress_args)
            limit = (4000 if getattr(client.me, "is_premium", False) else 2000) * 1024 * 1024
            if size > limit:
                raise ValueError(f"Can't upload files bigger than {limit // (1024 * 1024)} MiB")
            name = getattr(fp, "name", "file")
            try:
                return await save_big_file(client, fp, size, name if isinstance(name, str) else "file", progress,
                                           progress_args, connections, per_connection)
            except (asyncio.CancelledError, StopTransmission, ValueError):
                raise
            except Exception as e:
                log.warning(f"Fast upload failed ({e}); sending this file the usual way")
                fp.seek(0)
                return await original(path, progress=progress, progress_args=progress_args)
        finally:
            if own:
                fp.close()

    client.save_file = save_file
