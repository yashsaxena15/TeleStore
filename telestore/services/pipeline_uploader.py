import os
import asyncio
import logging
import shutil
from typing import Optional, Dict, Any

from pyrogram.errors import FloodWait

logger = logging.getLogger(__name__)

PART_UPLOAD_ATTEMPTS = 3  # tries per part, each on the least busy bot
AUDIO_EXTS = ["mp3", "wav", "ogg", "flac", "m4a", "opus", "aac"]


async def extract_audio_cover(audio_path: str) -> Optional[str]:
    """Saves an audio file's built-in cover art as a small JPEG for Telegram; None when it has none.

    Telegram doesn't read the cover out of an uploaded song itself, so without this songs have no
    thumbnail. Telegram wants a JPEG of at most 320x320 and 200 KB.
    """
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        return None
    cover_path = f"{audio_path}.cover.jpg"
    for quality in (3, 8, 15):
        proc = await asyncio.create_subprocess_exec(
            ffmpeg, "-y", "-v", "error", "-i", audio_path, "-map", "0:v:0", "-frames:v", "1",
            "-vf", "scale=320:320:force_original_aspect_ratio=decrease", "-q:v", str(quality), cover_path,
            stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL,
        )
        try:
            await asyncio.wait_for(proc.wait(), timeout=30)
        except asyncio.TimeoutError:
            proc.kill()
            break
        if proc.returncode != 0 or not os.path.exists(cover_path):
            break  # no picture in the file
        if os.path.getsize(cover_path) <= 200 * 1024:
            return cover_path
    if os.path.exists(cover_path):
        os.remove(cover_path)
    return None


async def upload_part_task(
    part_file_path: str,
    part_index: int,
    file_name: str,
    start_byte: int,
    part_size: int,
    chat_id: int,
    bot_manager: Any,
    fallback_client: Any,
    caption: Optional[str] = None,
    semaphore: Optional[asyncio.Semaphore] = None,
    is_single_part: bool = False,
    file_type: str = "document",
    progress: Optional[Any] = None,
    progress_args: Optional[tuple] = ()
) -> Dict[str, Any]:
    """
    Asynchronously uploads a file part to Telegram using the least busy bot,
    extracts metadata, deletes the temporary file from VM disk immediately,
    and releases backpressure semaphore.
    """
    try:
        if caption is None:
            caption = file_name if is_single_part else f"{file_name} (Part {part_index})"

        ext = file_name.split(".")[-1].lower() if "." in file_name else ""
        target_file_name = file_name if is_single_part else f"{file_name}.part{part_index}"

        upload_kwargs = {}
        if progress:
            upload_kwargs["progress"] = progress
            if progress_args:
                upload_kwargs["progress_args"] = progress_args

        async def send_with(client):
            if is_single_part:
                try:
                    if ext in ["jpg", "jpeg", "png", "gif", "webp"] and part_size <= 10 * 1024 * 1024:
                        return await client.send_photo(chat_id=chat_id, photo=part_file_path, caption=caption, **upload_kwargs)
                    if ext in ["mp4", "mkv", "avi", "mov", "webm"]:
                        return await client.send_video(chat_id=chat_id, video=part_file_path, caption=caption, file_name=target_file_name, **upload_kwargs)
                    if ext in AUDIO_EXTS:
                        cover = await extract_audio_cover(part_file_path)
                        try:
                            return await client.send_audio(chat_id=chat_id, audio=part_file_path, caption=caption, file_name=target_file_name, thumb=cover, **upload_kwargs)
                        finally:
                            if cover and os.path.exists(cover):
                                os.remove(cover)
                except FloodWait:
                    raise
                except Exception as e:
                    logger.warning(f"[PIPELINE_UPLOAD] Specialized upload fallback to document: {e}")
                return await client.send_document(chat_id=chat_id, document=part_file_path, caption=caption, file_name=target_file_name, force_document=True, **upload_kwargs)
            # Multi-part chunk parts MUST always be sent as raw documents so Telegram does not re-encode them
            return await client.send_document(chat_id=chat_id, document=part_file_path, caption=caption,
                                              file_name=target_file_name, force_document=True, **upload_kwargs)

        # A few tries, each on the least busy bot. The bot's workload is raised while it sends, so
        # the parts of one file go to different bots at the same time instead of queueing on one.
        msg = None
        for attempt in range(1, PART_UPLOAD_ATTEMPTS + 1):
            client = (bot_manager.get_least_busy_client() if bot_manager else None) or fallback_client
            if not client:
                raise RuntimeError("No Telegram client available for upload")
            logger.info(f"[PIPELINE_UPLOAD] Part {part_index} ({part_size} bytes) of '{file_name}' via bot '{getattr(client, 'name', 'bot')}' (try {attempt})")
            busy = hasattr(client, "add_workload")
            if busy:
                client.add_workload(1)
            try:
                msg = await send_with(client)
                break
            except FloodWait as e:
                if attempt == PART_UPLOAD_ATTEMPTS:
                    raise
                wait = min(int(getattr(e, "value", 5) or 5), 120)
                logger.warning(f"[PIPELINE_UPLOAD] FloodWait {wait}s on part {part_index} of '{file_name}'")
                await asyncio.sleep(wait)
            except (asyncio.CancelledError, FileNotFoundError):
                raise
            except Exception as e:
                if attempt == PART_UPLOAD_ATTEMPTS:
                    raise
                logger.warning(f"[PIPELINE_UPLOAD] Part {part_index} of '{file_name}' failed (try {attempt}): {e}; retrying")
                await asyncio.sleep(3 * attempt)
            finally:
                if busy:
                    client.add_workload(-1)

        media = msg.document or msg.video or msg.audio or msg.photo or msg.voice
        file_unique_id = getattr(media, "file_unique_id", f"part_{part_index}")
        thumbnail = media.thumbs[0].file_id if (hasattr(media, "thumbs") and media.thumbs) else None

        logger.info(
            f"[PIPELINE_UPLOAD] Part {part_index} for '{file_name}' uploaded successfully (msg_id: {msg.id})."
        )

        return {
            "part_index": part_index,
            "chat_id": chat_id,
            "message_id": msg.id,
            "file_unique_id": file_unique_id,
            "part_size": part_size,
            "start_byte": start_byte,
            "end_byte": start_byte + part_size - 1,
            "thumbnail": thumbnail,
        }
    finally:
        # Immediate cleanup of temporary part file from VM disk
        if os.path.exists(part_file_path):
            try:
                os.remove(part_file_path)
                logger.debug(f"[PIPELINE_UPLOAD] Cleaned up temporary part file: {part_file_path}")
            except Exception as e:
                logger.warning(f"[PIPELINE_UPLOAD] Failed to remove {part_file_path}: {e}")

        # Release semaphore slot for next part buffer on disk
        if semaphore:
            semaphore.release()
