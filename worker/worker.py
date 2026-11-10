import os
import sys
import time
import shutil
import asyncio
import threading
import logging
import secrets
import urllib.parse
import aiohttp
from logging.handlers import RotatingFileHandler
from pyrogram import Client

# transfer_core.py (shared with the main server) sits next to this file on worker machines;
# run from the repo, it is telestore/transfer_core.py
sys.path.append(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "telestore"))
from transfer_core import (HEAD_BYTES, HTML_NAMES, SpeedMeter, aria2_file_args, check_download,  # noqa: E402,F401
                           eta_seconds, is_google_limit, looks_like_html, parse_aria2_line, retry_after_flood,
                           size_text, torrent_file_path)
import torrent_engine  # noqa: E402  (also shared: telestore/torrent_engine.py, copied next to this file)

LOG_FORMAT = "%(asctime)s [%(levelname)s] %(name)s: %(message)s"
logging.basicConfig(level=logging.INFO, format=LOG_FORMAT)
logger = logging.getLogger("tele_worker")
# Kept across restarts: logs/worker.log next to this file (5 files of 10 MB)
LOG_DIR = os.getenv("LOG_DIR", os.path.join(os.path.dirname(os.path.abspath(__file__)), "logs"))
try:
    os.makedirs(LOG_DIR, exist_ok=True)
    _file_log = RotatingFileHandler(os.path.join(LOG_DIR, "worker.log"), maxBytes=10 * 1024 * 1024, backupCount=5, encoding="utf-8")
    _file_log.setFormatter(logging.Formatter(LOG_FORMAT))
    logging.getLogger().addHandler(_file_log)
except OSError as e:
    logger.warning(f"Logs are not kept in a file ({e})")

MASTER_URL = os.getenv("MASTER_URL", "http://localhost:8000").rstrip("/")
WORKER_KEY = os.getenv("WORKER_KEY", "").strip()
if not WORKER_KEY:
    logger.critical("WORKER_KEY environment variable is not set. Worker cannot authenticate with master.")
    sys.exit(1)

WORKER_ID = os.getenv("WORKER_ID", f"worker-{secrets.token_hex(3)}")
WORK_DIR = os.getenv("WORK_DIR", "/tmp/tele_worker/cache")
PART_MAX_SIZE = 1950 * 1024 * 1024  # 1.95 GB Part standard
# No limit on how long a whole download takes (big files need many minutes), only on a quiet connection
READ_TIMEOUT = int(os.getenv("READ_TIMEOUT", "120"))
UPLOAD_REPORT_SECONDS = 5
# Torrents: with libtorrent (pip install libtorrent, in this worker's virtual environment) a file
# comes part by part, at most two parts of 1.95 GB on disk; aria2c (apt install aria2) is the
# fallback, a whole file at a time. Either way the same no-seeding rules as the main server.
ARIA2C = shutil.which("aria2c")
SKILLS = (["torrent"] if (torrent_engine.AVAILABLE or ARIA2C) else []) + (["torrent_parts"] if torrent_engine.AVAILABLE else [])
TORRENT_REPORT_SECONDS = 2

HEADERS = {
    "X-Worker-Key": WORKER_KEY,
    "Content-Type": "application/json"
}

def is_gdrive_quota_error(msg: str) -> bool:
    return is_google_limit(msg)


class TaskCancelled(Exception):
    """The master cancelled the task, or another machine took it over: stop without reporting a failure."""


def get_file_type(fname: str) -> str:
    ext = os.path.splitext(fname)[1].lower()
    if ext in ['.mp4', '.mkv', '.avi', '.mov', '.webm']:
        return "video"
    elif ext in ['.mp3', '.wav', '.ogg', '.flac', '.m4a']:
        return "audio"
    elif ext in ['.jpg', '.jpeg', '.png', '.gif', '.webp']:
        return "photo"
    return "document"

class _PartSlots:
    """Two parts on disk at a time (like the main server's disk budget for one job)."""

    def __init__(self, count: int):
        self._sem = threading.Semaphore(count)

    def acquire(self, blocking: bool = True, timeout=None) -> bool:
        return self._sem.acquire(blocking, timeout)

    def release(self) -> None:
        self._sem.release()


class DistributedWorker:
    def __init__(self):
        self.session: aiohttp.ClientSession = None
        self.running = True
        self.bot_clients = {}
        self.last_report = {}  # task_id → the last progress sent (resent while waiting for Telegram)
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

    async def report_progress(self, task_id: str, transferred: int, total: int, speed: int, progress: float, eta: int, phase: str,
                              stage: str = "download"):
        try:
            payload = {
                "task_id": task_id,
                "worker_id": WORKER_ID,
                "transferred_bytes": transferred,
                "filesize": total,
                "speed_bps": speed,
                "stage": stage,
                "download_bps": speed if stage == "download" else 0,
                "upload_bps": speed if stage == "upload" else 0,
                "progress": progress,
                "eta_seconds": eta,
                "phase": phase
            }
            self.last_report[task_id] = payload
            async with self.session.post(
                f"{MASTER_URL}/api/worker/update-progress",
                headers=HEADERS,
                json=payload,
                timeout=aiohttp.ClientTimeout(total=8)
            ) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    if data.get("status") == "cancelled":
                        raise TaskCancelled("Task cancelled by master, or taken over by another machine")
        except TaskCancelled:
            raise
        except Exception as e:
            logger.debug(f"Failed to report progress: {e}")

    def upload_progress(self, task_id: str, label: str):
        """A Telegram upload's progress callback: tells the master every few seconds that this worker is
        still busy, so a long upload isn't taken back as abandoned."""
        state = {"last": 0.0}
        meter = SpeedMeter()

        async def progress(current: int, total: int):
            now = time.time()
            speed = meter.update(current)
            if now - state["last"] < UPLOAD_REPORT_SECONDS:
                return
            state["last"] = now
            prog = round(current / total * 100, 1) if total else 0
            eta = eta_seconds(total - current, speed)
            try:
                await self.report_progress(task_id, current, total, speed, prog, eta, f"{label} @ {round(speed/1024/1024, 1)} MB/s ({prog}%)", "upload")
            except TaskCancelled:
                pass  # an upload can't stop half-way; the master ignores its result
        return progress

    async def send(self, upload, task_id: str):
        """A Telegram upload; when Telegram says to slow down (FLOOD_WAIT), waits as long as it asks and tries again."""
        def waiting(seconds: int):
            logger.warning(f"Telegram asks to wait {seconds} s before sending more (task {task_id}); trying again then.")

        async def wait(seconds: float):
            # Still busy with it: the master takes back a task that goes quiet for 2 minutes
            end = time.monotonic() + seconds
            while (left := end - time.monotonic()) > 0:
                last = self.last_report.get(task_id)
                if last:
                    try:
                        await self.report_progress(task_id, last["transferred_bytes"], last["filesize"], 0, last["progress"], int(left),
                                                   f"Telegram asks to wait {int(left)} s before sending more", "upload")
                    except TaskCancelled:
                        pass  # the upload is stopped by its own result being ignored
                await asyncio.sleep(min(30, left))
        return await retry_after_flood(upload, on_wait=waiting, sleep=wait)

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

    async def upload_part(self, bot, task_id: str, chat_id: int, filename: str, p_path: str, p_idx: int, s_byte: int,
                          p_size: int, is_single: bool) -> dict:
        """Sends one file (or one part of a big one) to Telegram; the local copy is removed after."""
        try:
            logger.info(f"Uploading part {p_idx} ({p_size} bytes) to Telegram...")
            target_name = filename if is_single else f"{filename}.part{p_idx}"
            # "Uploaded file:" marks it as TeleStore's own upload (not a file for Telegram Inbox)
            caption = f"Uploaded file: {filename}" if is_single else f"{filename} (Part {p_idx})"
            ext = os.path.splitext(filename)[1].lower()
            progress = self.upload_progress(task_id, "Uploading to Telegram ☁️" if is_single else f"Uploading Part {p_idx} to Telegram ☁️")

            if is_single:
                try:
                    if ext in ['.mp4', '.mkv', '.avi', '.mov', '.webm']:
                        msg = await self.send(lambda: bot.send_video(chat_id=chat_id, video=p_path, caption=caption, file_name=target_name, progress=progress), task_id)
                    elif ext in ['.mp3', '.wav', '.ogg', '.flac', '.m4a']:
                        msg = await self.send(lambda: bot.send_audio(chat_id=chat_id, audio=p_path, caption=caption, file_name=target_name, progress=progress), task_id)
                    elif ext in ['.jpg', '.jpeg', '.png', '.gif', '.webp']:
                        msg = await self.send(lambda: bot.send_photo(chat_id=chat_id, photo=p_path, caption=caption, progress=progress), task_id)
                    else:
                        msg = await self.send(lambda: bot.send_document(chat_id=chat_id, document=p_path, caption=caption, file_name=target_name, force_document=True, progress=progress), task_id)
                except Exception as upload_err:
                    logger.warning(f"[WORKER_UPLOAD] Specialized upload failed ({upload_err}), falling back to document upload...")
                    msg = await self.send(lambda: bot.send_document(chat_id=chat_id, document=p_path, caption=caption, file_name=target_name, force_document=True, progress=progress), task_id)
            else:
                msg = await self.send(lambda: bot.send_document(chat_id=chat_id, document=p_path, caption=caption, file_name=target_name, force_document=True, progress=progress), task_id)

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

    async def fetch_torrent(self, task_id: str, path: str) -> None:
        """The .torrent of a torrent file transfer, from the master."""
        async with self.session.get(f"{MASTER_URL}/api/worker/torrent/{task_id}", headers={"X-Worker-Key": WORKER_KEY},
                                    params={"worker_id": WORKER_ID}, timeout=aiohttp.ClientTimeout(total=60)) as resp:
            if resp.status != 200:
                raise RuntimeError(f"Couldn't get the torrent's details from the server (HTTP {resp.status})")
            data = await resp.read()
        with open(path, "wb") as f:
            f.write(data)

    async def download_torrent_file(self, task_id: str, torrent: str, index: int, size: int, name: str, dl_dir: str) -> None:
        """Downloads one file of a torrent with aria2c, telling the master its progress every few seconds."""
        cmd = aria2_file_args(WORK_DIR, torrent, index, dl_dir)
        cmd[0] = ARIA2C
        proc = await asyncio.create_subprocess_exec(*cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT)
        info = {"done": 0, "speed_bps": 0, "progress": 0.0, "peers": 0}
        last = 0.0
        # One read of aria2c's output waits across rounds; when it's quiet (looking for peers) the
        # master is still told this worker is busy
        reading = asyncio.ensure_future(proc.stdout.readline())
        try:
            while True:
                finished, _ = await asyncio.wait({reading}, timeout=max(TORRENT_REPORT_SECONDS, 0.1))
                if reading in finished:
                    line = reading.result()
                    if line == b"":
                        break  # aria2c finished
                    parsed = parse_aria2_line(line.decode("utf-8", "replace"))
                    if parsed:
                        info = parsed
                    reading = asyncio.ensure_future(proc.stdout.readline())
                now = time.time()
                if now - last >= TORRENT_REPORT_SECONDS:
                    last = now
                    done = info.get("done") or int(info["progress"] / 100 * size)
                    speed = info["speed_bps"]
                    phase = f"Leeching {name} @ {round(speed / 1024 / 1024, 1)} MB/s ({info['progress']:.1f}%) | ⚡ {info['peers']} peers"
                    await self.report_progress(task_id, done, size, speed, min(99.0, info["progress"]), eta_seconds(max(0, size - done), speed), phase)
            code = await proc.wait()
        except BaseException:
            reading.cancel()
            if proc.returncode is None:
                proc.kill()
                await proc.wait()
            raise
        if code != 0:
            raise RuntimeError(f"The torrent download stopped (aria2c exit code {code}). It may have too few peers right now.")

    async def torrent_by_parts(self, task_data: dict, bot, task_dir: str, torrent: str) -> None:
        """One file of a torrent with libtorrent: each 1.95 GB part goes to Telegram while the next
        one downloads, so at most two parts are on disk whatever the file's size."""
        task_id = task_data["task_id"]
        name = task_data.get("filename") or "file"
        size = int(task_data.get("filesize") or 0)
        chat_id = task_data["chat_id"]
        loop = asyncio.get_running_loop()
        slots = _PartSlots(2)
        futures = []
        last = [0.0]

        def on_progress(info: dict) -> None:
            now = time.time()
            if now - last[0] < TORRENT_REPORT_SECONDS:
                return
            last[0] = now
            phase = (f"Leeching {name} · part {info['part']} of {info['parts']} @ {round(info['speed_bps'] / 1024 / 1024, 1)} MB/s "
                     f"({info['progress']:.1f}%) | ⚡ {info['peers']} peers")
            fut = asyncio.run_coroutine_threadsafe(self.report_progress(
                task_id, info["done"], size, info["speed_bps"], min(99.0, info["progress"]),
                eta_seconds(max(0, size - info["done"]), info["speed_bps"]), phase), loop)
            try:
                fut.result(timeout=15)
            except TaskCancelled:
                raise
            except Exception:
                pass

        def on_part(part) -> None:
            for fut in futures:
                if fut.done() and fut.exception():
                    raise fut.exception()

            async def send():
                try:
                    return await self.upload_part(bot, task_id, chat_id, name, part.path, part.index, part.start,
                                                  part.length, part.is_single)
                finally:
                    slots.release()
            futures.append(asyncio.run_coroutine_threadsafe(send(), loop))

        await self.fetch_torrent(task_id, torrent)
        with open(torrent, "rb") as f:
            torrent_bytes = f.read()
        logger.info(f"Task {task_id}: torrent file #{task_data['torrent_file_index']} '{name}' ({size_text(size)}), part by part")
        try:
            await asyncio.to_thread(
                torrent_engine.get_engine().download_file, torrent_bytes, int(task_data["torrent_file_index"]),
                os.path.join(task_dir, "dl"), os.path.join(task_dir, "parts"),
                slots=slots, on_part=on_part, cancelled=lambda: not self.running, on_progress=on_progress)
        except BaseException:
            for fut in futures:
                fut.cancel()
            raise
        results = sorted([await asyncio.wrap_future(f) for f in futures], key=lambda r: r["part_index"])
        base = {"task_id": task_id, "user_id": task_data["user_id"], "chat_id": chat_id,
                "destination_path": task_data.get("destination_path", "/Home"), "file_name": name,
                "file_size": size, "is_vault": bool(task_data.get("is_vault", False))}
        if len(results) == 1:
            await self.report_complete({**base, "is_multipart": False, "message_id": results[0]["message_id"],
                                        "file_unique_id": results[0]["file_unique_id"]})
        else:
            await self.report_complete({**base, "is_multipart": True, "parts": results, "part_size": PART_MAX_SIZE})

    async def torrent_part(self, task_data: dict, bot, task_dir: str) -> None:
        """One 1.95 GB part of a big torrent file: only its pieces, sent to Telegram; the master
        saves the file once every part is in (from this machine or another)."""
        if not torrent_engine.AVAILABLE:
            raise RuntimeError("libtorrent isn't installed on this worker")
        task_id = task_data["task_id"]
        name = task_data.get("torrent_file_name") or task_data.get("filename") or "file"
        index, total = int(task_data["part_index"]), int(task_data["total_parts"])
        length = int(task_data.get("part_size") or 0)
        chat_id = task_data["chat_id"]
        loop = asyncio.get_running_loop()
        slots = _PartSlots(1)
        holder = []
        last = [0.0]

        def on_progress(info: dict) -> None:
            now = time.time()
            if now - last[0] < TORRENT_REPORT_SECONDS:
                return
            last[0] = now
            done = int(info.get("part_done") or 0)
            pct = round(done / (length or 1) * 100, 1)
            phase = (f"Leeching {name} part {index} of {total} @ {round(info['speed_bps'] / 1024 / 1024, 1)} MB/s "
                     f"({pct:.1f}%) | ⚡ {info['peers']} peers")
            fut = asyncio.run_coroutine_threadsafe(self.report_progress(
                task_id, done, length, info["speed_bps"], min(99.0, pct), eta_seconds(max(0, length - done), info["speed_bps"]), phase), loop)
            try:
                fut.result(timeout=15)
            except TaskCancelled:
                raise
            except Exception:
                pass

        torrent = os.path.join(task_dir, "details.torrent")
        await self.fetch_torrent(task_id, torrent)
        with open(torrent, "rb") as f:
            torrent_bytes = f.read()
        logger.info(f"Task {task_id}: '{name}' part {index} of {total} ({size_text(length)})")
        await asyncio.to_thread(
            torrent_engine.get_engine().download_file, torrent_bytes, int(task_data["torrent_file_index"]),
            os.path.join(task_dir, "dl"), os.path.join(task_dir, "parts"),
            slots=slots, on_part=holder.append, cancelled=lambda: not self.running, on_progress=on_progress,
            done_parts=set(range(1, total + 1)) - {index})
        part = holder[0]
        try:
            result = await self.upload_part(bot, task_id, chat_id, name, part.path, index, part.start, part.length, False)
        finally:
            slots.release()
        await self.report_complete({
            "task_id": task_id, "user_id": task_data["user_id"], "chat_id": chat_id,
            "destination_path": task_data.get("destination_path", "/Home"), "file_name": name,
            "file_size": int(task_data.get("torrent_file_size") or length), "is_vault": bool(task_data.get("is_vault", False)),
            "is_torrent_part": True, "part_info": result,
        })

    async def process_torrent_item(self, task_data: dict, bot, task_dir: str) -> None:
        """One file of a torrent: download it, send it to Telegram, tell the master."""
        if torrent_engine.AVAILABLE:
            await self.torrent_by_parts(task_data, bot, task_dir, os.path.join(task_dir, "details.torrent"))
            return
        task_id = task_data["task_id"]
        name = task_data.get("filename") or "file"
        size = int(task_data.get("filesize") or 0)
        chat_id = task_data["chat_id"]
        torrent = os.path.join(task_dir, "details.torrent")
        dl_dir = os.path.join(task_dir, "dl")
        os.makedirs(dl_dir, exist_ok=True)

        await self.fetch_torrent(task_id, torrent)
        logger.info(f"Task {task_id}: torrent file #{task_data['torrent_file_index']} '{name}' ({size_text(size)})")
        await self.download_torrent_file(task_id, torrent, int(task_data["torrent_file_index"]), size, name, dl_dir)

        path = torrent_file_path(dl_dir, task_data.get("torrent_rel_path") or name, name)
        if not path:
            raise RuntimeError(f"'{name}' wasn't found after the torrent download")
        actual = os.path.getsize(path)
        await self.report_progress(task_id, 0, actual, 0, 0, 0, "Uploading to Telegram ☁️", "upload")

        base = {"task_id": task_id, "user_id": task_data["user_id"], "chat_id": chat_id,
                "destination_path": task_data.get("destination_path", "/Home"), "file_name": name,
                "file_size": actual, "is_vault": bool(task_data.get("is_vault", False))}
        if actual <= PART_MAX_SIZE:
            res = await self.upload_part(bot, task_id, chat_id, name, path, 1, 0, actual, True)
            await self.report_complete({**base, "is_multipart": False, "message_id": res["message_id"],
                                        "file_unique_id": res["file_unique_id"]})
            return

        # Bigger than one Telegram file: parts of 1.95 GB, one at a time (little extra disk)
        results, start, index = [], 0, 1
        with open(path, "rb") as src:
            while start < actual:
                part_path = os.path.join(task_dir, f"{name}.part{index}")
                length = min(PART_MAX_SIZE, actual - start)
                with open(part_path, "wb") as dst:
                    left = length
                    while left:
                        chunk = src.read(min(8 * 1024 * 1024, left))
                        if not chunk:
                            break
                        dst.write(chunk)
                        left -= len(chunk)
                results.append(await self.upload_part(bot, task_id, chat_id, name, part_path, index, start, length, False))
                start += length
                index += 1
        os.remove(path)
        await self.report_complete({**base, "is_multipart": True, "parts": results, "part_size": PART_MAX_SIZE})

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
        step = "downloading from the source"
        upload_tasks = []

        try:
            if task_data.get("source_type") == "torrent_item":
                step = "downloading the torrent file"
                await self.process_torrent_item(task_data, bot, task_dir)
                return
            if task_data.get("source_type") == "torrent_part":
                step = "downloading the torrent part"
                await self.torrent_part(task_data, bot, task_dir)
                return

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
                        head = b""
                        meter = SpeedMeter()
                        last_rep_time = time.time()
                        while True:
                            chunk = await resp.content.read(chunk_size)
                            if not chunk:
                                break
                            if len(head) < HEAD_BYTES:
                                head += chunk[:HEAD_BYTES - len(head)]
                            pf.write(chunk)
                            transferred += len(chunk)
                            now = time.time()
                            speed = meter.update(transferred)
                            if now - last_rep_time >= 1.5:
                                last_rep_time = now
                                prog = round((transferred / part_size) * 100, 1) if part_size > 0 else 0
                                eta = eta_seconds(part_size - transferred, speed)
                                phase = f"Leeching Part {part_index}/{total_parts} @ {round(speed/1024/1024, 1)} MB/s ({prog}%)"
                                await self.report_progress(task_id, transferred, part_size, speed, prog, eta, phase)

                check_download(filename, transferred, part_size, head)

                # Upload part file to Telegram Cloud
                step = "uploading to Telegram"
                logger.info(f"Worker {WORKER_ID} uploading Part {part_index}/{total_parts} ({transferred} bytes) to Telegram...")
                await self.report_progress(task_id, transferred, part_size, 0, 99.0, 0, f"Uploading Part {part_index}/{total_parts} to Telegram ☁️", "upload")
                target_name = f"{filename}.part{part_index}"
                caption = f"{filename} (Part {part_index})"
                msg = await self.send(lambda: bot.send_document(
                    chat_id=chat_id,
                    document=part_path,
                    caption=caption,
                    file_name=target_name,
                    force_document=True,
                    progress=self.upload_progress(task_id, f"Uploading Part {part_index}/{total_parts} to Telegram ☁️")
                ), task_id)
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
                announced = 0  # the size the source gave for this download (checked at the end)
                head = b""
                if content_len and content_len.isdigit():
                    filesize = announced = int(content_len)

                cd = resp.headers.get("Content-Disposition", "")
                if "filename*=" in cd:
                    fname = cd.split("filename*=")[-1].split("''")[-1].strip('"\' ;')
                    filename = urllib.parse.unquote(fname)
                elif "filename=" in cd:
                    filename = cd.split("filename=")[-1].split(";")[0].strip('"\' ')

                transferred = 0
                part_index = 1
                meter = SpeedMeter()
                last_rep_time = 0

                current_part_path = os.path.join(task_dir, f"{filename}.part{part_index}")
                current_part_file = open(current_part_path, "wb")
                part_start_byte = 0
                part_bytes_written = 0

                async def upload_part_fn(p_path, p_idx, s_byte, p_size, is_single):
                    return await self.upload_part(bot, task_id, chat_id, filename, p_path, p_idx, s_byte, p_size, is_single)

                # Stream and buffer in chunks of 512 KB
                chunk_size = 512 * 1024
                while True:
                    chunk = await resp.content.read(chunk_size)
                    if not chunk:
                        break
                    if len(head) < HEAD_BYTES:
                        head += chunk[:HEAD_BYTES - len(head)]

                    current_part_file.write(chunk)
                    chunk_len = len(chunk)
                    transferred += chunk_len
                    part_bytes_written += chunk_len

                    now = time.time()
                    speed = meter.update(transferred)
                    if now - last_rep_time >= 1.5:
                        last_rep_time = now
                        prog = round((transferred / filesize) * 100, 1) if filesize > 0 else 0
                        eta = eta_seconds(filesize - transferred, speed)
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
                check_download(filename, transferred, announced, head)

                if transferred == 0:
                    # The download finished and the file is empty: Telegram can't hold 0 bytes, the master saves a record
                    logger.info(f"Task {task_id}: '{filename}' is empty; reported as a 0-byte file.")
                    await self.report_complete({"task_id": task_id, "user_id": user_id, "chat_id": chat_id, "destination_path": dest_path,
                                                "file_name": filename, "file_size": 0, "is_vault": is_vault, "is_empty": True})
                    return

                # Final part
                is_single = (part_index == 1)
                p_task = asyncio.create_task(
                    upload_part_fn(current_part_path, part_index, part_start_byte, part_bytes_written, is_single)
                )
                upload_tasks.append(p_task)

                # Wait for all Telegram uploads to finish
                step = "uploading to Telegram"
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

        except TaskCancelled:
            logger.warning(f"Task {task_id} stopped: cancelled, or another machine has it now.")
            for t in upload_tasks:
                t.cancel()
        except Exception as e:
            for t in upload_tasks:
                t.cancel()
            if isinstance(e, asyncio.TimeoutError):
                err_msg = f"Timed out while {step} (no data for {READ_TIMEOUT} s)."
            else:
                err_msg = str(e) or f"{type(e).__name__} while {step}"
            logger.error(f"Task {task_id} failed: {err_msg}", exc_info=True)
            is_quota = is_gdrive_quota_error(err_msg)
            await self.report_fail(task_id, err_msg, is_quota)
        finally:
            self.last_report.pop(task_id, None)
            shutil.rmtree(task_dir, ignore_errors=True)

    async def run(self):
        self.session = aiohttp.ClientSession(
            timeout=aiohttp.ClientTimeout(total=None, sock_connect=30, sock_read=READ_TIMEOUT)
        )
        asyncio.create_task(self.heartbeat_loop())
        logger.info(f"Distributed Worker '{WORKER_ID}' started. Polling Master at {MASTER_URL}...")
        how = ("libtorrent, part by part, and single parts of big files" if torrent_engine.AVAILABLE else
               f"aria2c at {ARIA2C}, a whole file at a time" if ARIA2C else "")
        logger.info(f"Torrent files: {'yes (' + how + ')' if how else 'no (neither libtorrent nor aria2c is installed)'}")

        while self.running:
            try:
                async with self.session.post(
                    f"{MASTER_URL}/api/worker/claim-task",
                    headers=HEADERS,
                    json={"worker_id": WORKER_ID, "skills": SKILLS},
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

