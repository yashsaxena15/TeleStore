import os
import sys
import time
import shutil
import asyncio
import logging
import secrets
import urllib.parse
import aiohttp
from pyrogram import Client

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("tele_worker")

MASTER_URL = os.getenv("MASTER_URL", "http://localhost:8000").rstrip("/")
WORKER_KEY = os.getenv("WORKER_KEY", "").strip()
if not WORKER_KEY:
    logger.critical("WORKER_KEY environment variable is not set. Worker cannot authenticate with master.")
    sys.exit(1)

WORKER_ID = os.getenv("WORKER_ID", f"worker-{secrets.token_hex(3)}")
WORK_DIR = os.getenv("WORK_DIR", "/tmp/tele_worker/cache")
PART_MAX_SIZE = 1950 * 1024 * 1024  # 1.95 GB Part standard

HEADERS = {
    "X-Worker-Key": WORKER_KEY,
    "Content-Type": "application/json"
}

def is_gdrive_quota_error(msg: str) -> bool:
    m = msg.lower()
    return (
        "too many users have viewed or downloaded" in m or
        "too many users have downloaded" in m or
        "quota exceeded" in m or
        "download quota" in m
    )

def get_file_type(fname: str) -> str:
    ext = os.path.splitext(fname)[1].lower()
    if ext in ['.mp4', '.mkv', '.avi', '.mov', '.webm']:
        return "video"
    elif ext in ['.mp3', '.wav', '.ogg', '.flac', '.m4a']:
        return "audio"
    elif ext in ['.jpg', '.jpeg', '.png', '.gif', '.webp']:
        return "photo"
    return "document"

class DistributedWorker:
    def __init__(self):
        self.session: aiohttp.ClientSession = None
        self.running = True
        self.bot_clients = {}
        os.makedirs(WORK_DIR, exist_ok=True)

    async def get_or_create_bot(self, token: str, api_id: int, api_hash: str) -> Client:
        if token not in self.bot_clients:
            bot_name = f"wbot_{token[:8]}"
            client = Client(
                bot_name,
                api_id=api_id,
                api_hash=api_hash,
                bot_token=token,
                in_memory=True,
                workdir="/tmp"
            )
            await client.start()
            self.bot_clients[token] = client
            logger.info(f"Started Telegram bot client for token ...{token[-6:]}")
        return self.bot_clients[token]

    async def heartbeat_loop(self):
        while self.running:
            try:
                specs = {
                    "cores": os.cpu_count() or 1,
                    "ram_mb": 1024,
                }
                async with self.session.post(
                    f"{MASTER_URL}/api/worker/heartbeat",
                    headers=HEADERS,
                    json={"worker_id": WORKER_ID, "specs": specs},
                    timeout=aiohttp.ClientTimeout(total=10)
                ):
                    pass
            except Exception as e:
                logger.warning(f"Heartbeat failed: {e}")
            await asyncio.sleep(15)

    async def report_progress(self, task_id: str, transferred: int, total: int, speed: int, progress: float, eta: int, phase: str):
        try:
            payload = {
                "task_id": task_id,
                "worker_id": WORKER_ID,
                "transferred_bytes": transferred,
                "filesize": total,
                "speed_bps": speed,
                "progress": progress,
                "eta_seconds": eta,
                "phase": phase
            }
            async with self.session.post(
                f"{MASTER_URL}/api/worker/update-progress",
                headers=HEADERS,
                json=payload,
                timeout=aiohttp.ClientTimeout(total=8)
            ) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    if data.get("status") == "cancelled":
                        raise asyncio.CancelledError("Task cancelled by master")
        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.debug(f"Failed to report progress: {e}")

    async def report_complete(self, payload: dict):
        try:
            payload["worker_id"] = WORKER_ID
            async with self.session.post(
                f"{MASTER_URL}/api/worker/complete-task",
                headers=HEADERS,
                json=payload,
                timeout=aiohttp.ClientTimeout(total=15)
            ) as resp:
                if resp.status == 200:
                    logger.info(f"Task {payload.get('task_id')} marked completed on Master.")
                else:
                    text = await resp.text()
                    logger.error(f"Master error completing task: {resp.status} {text}")
        except Exception as e:
            logger.error(f"Failed to report completion: {e}")

    async def report_fail(self, task_id: str, err_msg: str, is_quota: bool = False):
        try:
            payload = {
                "task_id": task_id,
                "worker_id": WORKER_ID,
                "error_message": err_msg,
                "is_quota_error": is_quota
            }
            async with self.session.post(
                f"{MASTER_URL}/api/worker/fail-task",
                headers=HEADERS,
                json=payload,
                timeout=aiohttp.ClientTimeout(total=15)
            ):
                pass
        except Exception as e:
            logger.error(f"Failed to report failure: {e}")

    async def process_task(self, task_data: dict, tg_config: dict):
        task_id = task_data["task_id"]
        source_url = task_data["source_url"]
        filename = task_data.get("filename") or "file"
        filesize = task_data.get("filesize") or 0
        chat_id = task_data["chat_id"]
        user_id = task_data["user_id"]
        dest_path = task_data.get("destination_path", "/Home")
        is_vault = bool(task_data.get("is_vault", False))
        gdrive_id = task_data.get("gdrive_id")

        is_range_part = task_data.get("is_range_part", False)
        range_start = task_data.get("range_start", 0)
        range_end = task_data.get("range_end")
        part_index = task_data.get("part_index", 1)
        total_parts = task_data.get("total_parts", 1)
        part_size = task_data.get("part_size", filesize)
        total_filesize = task_data.get("total_filesize") or filesize

        logger.info(f"Processing task {task_id}: {filename} (RangePart={is_range_part}, Part={part_index}/{total_parts})")
        task_dir = os.path.join(WORK_DIR, f"task_{task_id}")
        os.makedirs(task_dir, exist_ok=True)

        api_id = tg_config.get("api_id")
        api_hash = tg_config.get("api_hash")
        tokens = tg_config.get("tokens", [])
        if not tokens:
            raise RuntimeError("No bot tokens provided by master")

        bot = await self.get_or_create_bot(tokens[0], api_id, api_hash)

        try:
            download_url = source_url
            if gdrive_id or "drive.google.com" in source_url:
                gid = gdrive_id
                if not gid:
                    import re
                    m = re.search(r'id=([a-zA-Z0-9_-]+)', source_url) or re.search(r'/d/([a-zA-Z0-9_-]+)', source_url)
                    if m:
                        gid = m.group(1)
                if gid and not download_url.startswith("https://drive.usercontent.google.com"):
                    download_url = f"https://drive.usercontent.google.com/download?id={gid}&export=download&confirm=t"

            req_headers = {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
            }

            # ---------------------------------------------------------
            # BRANCH 1: Multi-Range Chunk Part Task
            # ---------------------------------------------------------
            if is_range_part:
                logger.info(f"Worker {WORKER_ID} downloading Range bytes={range_start}-{range_end} ({part_size} bytes) for Part {part_index}/{total_parts}...")
                req_headers["Range"] = f"bytes={range_start}-{range_end}"
                part_path = os.path.join(task_dir, f"{filename}.part{part_index}")

                async with self.session.get(download_url, headers=req_headers, allow_redirects=True) as resp:
                    if resp.status not in (200, 206):
                        txt = await resp.text()
                        if is_gdrive_quota_error(txt):
                            raise RuntimeError("Google Drive daily download quota exceeded")
                        raise RuntimeError(f"HTTP {resp.status} from source: {txt[:100]}")

                    with open(part_path, "wb") as pf:
                        chunk_size = 512 * 1024
                        transferred = 0
                        start_time = time.time()
                        last_rep_time = start_time
                        while True:
                            chunk = await resp.content.read(chunk_size)
                            if not chunk:
                                break
                            pf.write(chunk)
                            transferred += len(chunk)
                            now = time.time()
                            if now - last_rep_time >= 1.5:
                                last_rep_time = now
                                elapsed = max(0.1, now - start_time)
                                speed = int(transferred / elapsed)
                                prog = round((transferred / part_size) * 100, 1) if part_size > 0 else 0
                                eta = int((part_size - transferred) / speed) if (part_size > transferred and speed > 0) else 0
                                phase = f"Leeching Part {part_index}/{total_parts} @ {round(speed/1024/1024, 1)} MB/s ({prog}%)"
                                await self.report_progress(task_id, transferred, part_size, speed, prog, eta, phase)

                # Upload part file to Telegram Cloud
                logger.info(f"Worker {WORKER_ID} uploading Part {part_index}/{total_parts} ({transferred} bytes) to Telegram...")
                await self.report_progress(task_id, transferred, part_size, 0, 99.0, 0, f"Uploading Part {part_index}/{total_parts} to Telegram ☁️")
                target_name = f"{filename}.part{part_index}"
                caption = f"{filename} (Part {part_index})"
                msg = await bot.send_document(
                    chat_id=chat_id,
                    document=part_path,
                    caption=caption,
                    file_name=target_name,
                    force_document=True
                )
                uniq_id = getattr(msg.document, "file_unique_id", f"w_{msg.id}")

                try:
                    if os.path.exists(part_path):
                        os.remove(part_path)
                except Exception:
                    pass

                part_info = {
                    "part_index": part_index,
                    "chat_id": chat_id,
                    "message_id": msg.id,
                    "file_unique_id": uniq_id,
                    "part_size": transferred,
                    "start_byte": range_start,
                    "end_byte": range_start + transferred,
                    "thumbnail": None
                }

                comp_payload = {
                    "task_id": task_id,
                    "worker_id": WORKER_ID,
                    "user_id": user_id,
                    "chat_id": chat_id,
                    "destination_path": dest_path,
                    "file_name": filename,
                    "file_size": total_filesize,
                    "is_vault": is_vault,
                    "is_range_part": True,
                    "part_info": part_info
                }
                await self.report_complete(comp_payload)
                return

            # ---------------------------------------------------------
            # BRANCH 2: Standard Single Stream Task
            # ---------------------------------------------------------
            async with self.session.get(download_url, headers=req_headers, allow_redirects=True) as resp:
                if resp.status == 403 or resp.status == 429:
                    txt = await resp.text()
                    if is_gdrive_quota_error(txt):
                        raise RuntimeError("Google Drive daily download quota exceeded")
                    raise RuntimeError(f"HTTP {resp.status} from source: {txt[:100]}")
                elif resp.status >= 400:
                    txt = await resp.text()
                    raise RuntimeError(f"HTTP {resp.status} from source: {txt[:100]}")

                content_len = resp.headers.get("Content-Length")
                if content_len and content_len.isdigit():
                    filesize = int(content_len)

                cd = resp.headers.get("Content-Disposition", "")
                if "filename*=" in cd:
                    fname = cd.split("filename*=")[-1].split("''")[-1].strip('"\' ;')
                    filename = urllib.parse.unquote(fname)
                elif "filename=" in cd:
                    filename = cd.split("filename=")[-1].split(";")[0].strip('"\' ')

                transferred = 0
                part_index = 1
                start_time = time.time()
                last_rep_time = 0

                upload_tasks = []

                current_part_path = os.path.join(task_dir, f"{filename}.part{part_index}")
                current_part_file = open(current_part_path, "wb")
                part_start_byte = 0
                part_bytes_written = 0

                async def upload_part_fn(p_path, p_idx, s_byte, p_size, is_single):
                    try:
                        logger.info(f"Uploading part {p_idx} ({p_size} bytes) to Telegram...")
                        target_name = filename if is_single else f"{filename}.part{p_idx}"
                        caption = filename if is_single else f"{filename} (Part {p_idx})"
                        ext = os.path.splitext(filename)[1].lower()

                        if is_single:
                            try:
                                if ext in ['.mp4', '.mkv', '.avi', '.mov', '.webm']:
                                    msg = await bot.send_video(chat_id=chat_id, video=p_path, caption=caption, file_name=target_name)
                                elif ext in ['.mp3', '.wav', '.ogg', '.flac', '.m4a']:
                                    msg = await bot.send_audio(chat_id=chat_id, audio=p_path, caption=caption, file_name=target_name)
                                elif ext in ['.jpg', '.jpeg', '.png', '.gif', '.webp']:
                                    msg = await bot.send_photo(chat_id=chat_id, photo=p_path, caption=caption)
                                else:
                                    msg = await bot.send_document(chat_id=chat_id, document=p_path, caption=caption, file_name=target_name, force_document=True)
                            except Exception as upload_err:
                                logger.warning(f"[WORKER_UPLOAD] Specialized upload failed ({upload_err}), falling back to document upload...")
                                msg = await bot.send_document(chat_id=chat_id, document=p_path, caption=caption, file_name=target_name, force_document=True)
                        else:
                            msg = await bot.send_document(chat_id=chat_id, document=p_path, caption=caption, file_name=target_name, force_document=True)

                        file_obj = msg.document or msg.video or msg.audio or (msg.photo and msg.photo[-1] if isinstance(msg.photo, list) else msg.photo)
                        uniq_id = getattr(file_obj, "file_unique_id", f"w_{msg.id}")
                        return {
                            "part_index": p_idx,
                            "chat_id": chat_id,
                            "message_id": msg.id,
                            "file_unique_id": uniq_id,
                            "part_size": p_size,
                            "start_byte": s_byte,
                            "end_byte": s_byte + p_size
                        }
                    finally:
                        try:
                            if os.path.exists(p_path):
                                os.remove(p_path)
                        except Exception:
                            pass

                # Stream and buffer in chunks of 512 KB
                chunk_size = 512 * 1024
                while True:
                    chunk = await resp.content.read(chunk_size)
                    if not chunk:
                        break

                    current_part_file.write(chunk)
                    chunk_len = len(chunk)
                    transferred += chunk_len
                    part_bytes_written += chunk_len

                    now = time.time()
                    if now - last_rep_time >= 1.5:
                        last_rep_time = now
                        elapsed = max(0.1, now - start_time)
                        speed = int(transferred / elapsed)
                        prog = round((transferred / filesize) * 100, 1) if filesize > 0 else 0
                        eta = int((filesize - transferred) / speed) if (filesize > transferred and speed > 0) else 0
                        phase = f"Leeching @ {round(speed/1024/1024, 1)} MB/s ({prog}%)"
                        await self.report_progress(task_id, transferred, filesize, speed, prog, eta, phase)

                    # Check if part reached 1.95 GB
                    if part_bytes_written >= PART_MAX_SIZE:
                        current_part_file.close()
                        p_task = asyncio.create_task(
                            upload_part_fn(current_part_path, part_index, part_start_byte, part_bytes_written, False)
                        )
                        upload_tasks.append(p_task)

                        part_start_byte += part_bytes_written
                        part_index += 1
                        part_bytes_written = 0
                        current_part_path = os.path.join(task_dir, f"{filename}.part{part_index}")
                        current_part_file = open(current_part_path, "wb")

                current_part_file.close()

                # Final part
                is_single = (part_index == 1)
                p_task = asyncio.create_task(
                    upload_part_fn(current_part_path, part_index, part_start_byte, part_bytes_written, is_single)
                )
                upload_tasks.append(p_task)

                # Wait for all Telegram uploads to finish
                logger.info(f"Waiting for {len(upload_tasks)} part uploads to finish...")
                results = await asyncio.gather(*upload_tasks)
                results.sort(key=lambda x: x["part_index"])

                # Send completion
                if is_single:
                    res = results[0]
                    comp_payload = {
                        "task_id": task_id,
                        "user_id": user_id,
                        "chat_id": chat_id,
                        "destination_path": dest_path,
                        "file_name": filename,
                        "file_size": transferred,
                        "is_vault": is_vault,
                        "is_multipart": False,
                        "message_id": res["message_id"],
                        "file_unique_id": res["file_unique_id"]
                    }
                else:
                    comp_payload = {
                        "task_id": task_id,
                        "user_id": user_id,
                        "chat_id": chat_id,
                        "destination_path": dest_path,
                        "file_name": filename,
                        "file_size": transferred,
                        "is_vault": is_vault,
                        "is_multipart": True,
                        "parts": results,
                        "part_size": PART_MAX_SIZE
                    }

                await self.report_complete(comp_payload)

        except Exception as e:
            err_msg = str(e) or repr(e)
            logger.error(f"Task {task_id} failed: {err_msg}", exc_info=True)
            is_quota = is_gdrive_quota_error(err_msg)
            await self.report_fail(task_id, err_msg, is_quota)
        finally:
            shutil.rmtree(task_dir, ignore_errors=True)

    async def run(self):
        self.session = aiohttp.ClientSession()
        asyncio.create_task(self.heartbeat_loop())
        logger.info(f"Distributed Worker '{WORKER_ID}' started. Polling Master at {MASTER_URL}...")

        while self.running:
            try:
                async with self.session.post(
                    f"{MASTER_URL}/api/worker/claim-task",
                    headers=HEADERS,
                    json={"worker_id": WORKER_ID},
                    timeout=aiohttp.ClientTimeout(total=10)
                ) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        if data.get("has_task") and data.get("task"):
                            task = data["task"]
                            tg_cfg = data.get("telegram_config", {})
                            await self.process_task(task, tg_cfg)
                        else:
                            await asyncio.sleep(2)
                    elif resp.status == 401:
                        logger.error("Worker unauthorized! Check WORKER_KEY.")
                        await asyncio.sleep(10)
                    else:
                        text = await resp.text()
                        logger.warning(f"Claim task response {resp.status}: {text[:100]}")
                        await asyncio.sleep(3)
            except Exception as e:
                logger.error(f"Error in worker loop: {e}")
                await asyncio.sleep(3)

        if self.session:
            await self.session.close()

if __name__ == "__main__":
    if not WORKER_KEY:
        logger.error("WORKER_KEY environment variable is required!")
        sys.exit(1)
    worker = DistributedWorker()
    try:
        asyncio.run(worker.run())
    except KeyboardInterrupt:
        logger.info("Worker stopped by user.")

