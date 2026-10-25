# telestore/services/streaming_utils.py

import zlib
import json
import asyncio
import mimetypes
from typing import Optional, Tuple
from concurrent.futures import ThreadPoolExecutor

from pyrogram import Client
from pyrogram.file_id import FileId

executor = ThreadPoolExecutor()

def compress_data(data):
    return zlib.compress(data.encode(), level=zlib.Z_BEST_COMPRESSION)

def decompress_data(data):
    return zlib.decompress(data).decode()

def base62_encode(data):
    BASE62_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
    num = int.from_bytes(data, 'big')
    base62 = []
    while num:
        num, rem = divmod(num, 62)
        base62.append(BASE62_ALPHABET[rem])
    return ''.join(reversed(base62)) or '0'

def base62_decode(data):
    BASE62_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
    num = 0
    for char in data:
        num = num * 62 + BASE62_ALPHABET.index(char)
    return num.to_bytes((num.bit_length() + 7) // 8, 'big') or b'\0'

async def async_compress_data(data):
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(executor, compress_data, data)

async def async_decompress_data(data):
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(executor, decompress_data, data)

async def async_base62_encode(data):
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(executor, base62_encode, data)

async def async_base62_decode(data):
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(executor, base62_decode, data)

async def encode_string(data):
    json_data = json.dumps(data)
    compressed_data = await async_compress_data(json_data)
    return await async_base62_encode(compressed_data)

async def decode_string(encoded_data):
    compressed_data = await async_base62_decode(encoded_data)
    json_data = await async_decompress_data(compressed_data)
    return json.loads(json_data)

async def get_file_ids(client: Client, chat_id: int, message_id: int) -> FileId:
    """
    Get file IDs from a message
    """
    from d4rk.Logs import setup_logger
    LOGGER = setup_logger("streaming_utils")
    try:
        message = await client.get_messages(chat_id, message_id)
        LOGGER.info(f"get_file_ids [{getattr(client, 'name', client)}] chat={chat_id} msg={message_id}: empty={getattr(message, 'empty', None)} msg_id={getattr(message, 'id', None)}")
        if not message or getattr(message, 'empty', False):
            return None
            
        file = message.video or message.document or message.audio or message.voice or message.photo
        if not file:
            return None
            
        return FileId.decode(file.file_id) if file.file_id else None
    except Exception as e:
        LOGGER.warning(f"get_file_ids failed for {getattr(client, 'name', client)}: {type(e).__name__} - {e}")
        return None

class RangeNotSatisfiable(ValueError):
    """The requested range starts past the end of the file (HTTP 416)."""


def parse_byte_range(range_header: str, file_size: int) -> Optional[Tuple[int, int]]:
    """The inclusive (start, end) a Range header asks for, or None to send the whole file (200).

    Follows RFC 9110: "bytes=500-" and "bytes=500-999" as usual; "bytes=-500" is the last 500
    bytes; an end past the file is trimmed to the last byte; a header that isn't a single valid
    bytes range (another unit, several ranges, garbage) is ignored. Raises RangeNotSatisfiable
    only when the range starts at or past the end of the file.
    """
    if not range_header or file_size <= 0:
        return None
    value = range_header.strip().lower()
    if not value.startswith("bytes=") or "," in value:
        return None
    spec = value[len("bytes="):].strip()
    if "-" not in spec:
        return None
    start_s, end_s = (part.strip() for part in spec.split("-", 1))
    if not start_s.isdigit() and start_s != "":
        return None
    if end_s and not end_s.isdigit():
        return None
    if start_s == "":
        if not end_s:
            return None
        suffix = int(end_s)
        if suffix == 0:
            raise RangeNotSatisfiable("Empty suffix range")
        return max(0, file_size - suffix), file_size - 1
    start = int(start_s)
    if start >= file_size:
        raise RangeNotSatisfiable("Range starts past the end of the file")
    end = int(end_s) if end_s else file_size - 1
    if end < start:
        return None
    return start, min(end, file_size - 1)


def parse_range_header(range_header: str, file_size: int) -> Tuple[int, int]:
    """(start, end) inclusive; the whole file when there is no usable range. Raises ValueError
    (RangeNotSatisfiable) for a range that starts past the end."""
    byte_range = parse_byte_range(range_header, file_size)
    return byte_range if byte_range else (0, max(0, file_size - 1))

def resolve_mime_type(file_name: str, explicit_mime: str | None = None, is_watch: bool = False) -> str:
    # explicit_mime from Telegram is best
    if explicit_mime and explicit_mime != "application/octet-stream":
        return explicit_mime

    guessed = mimetypes.guess_type(file_name)[0]
    if guessed:
        return guessed

    # some helpful fallbacks
    ext = file_name.rsplit(".", 1)[-1].lower() if "." in file_name else ""
    if ext == "mkv":
        return "video/x-matroska"
    if ext in ("ts",):
        return "video/mp2t"
    if ext in ("m3u8", "m3u"):
        # HLS playlists
        return "application/vnd.apple.mpegurl"
    if ext in ("mp4", "m4v"):
        return "video/mp4"
    if ext in ("webm",):
        return "video/webm"
    if ext in ("mov",):
        return "video/quicktime"
    if ext in ("avi",):
        return "video/x-msvideo"
    if ext in ("flv",):
        return "video/x-flv"
    if ext in ("wmv",):
        return "video/x-ms-wmv"

    # last resort
    return "application/octet-stream"