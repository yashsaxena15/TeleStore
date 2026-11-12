"""The upload engine: runs in its own thread with an asyncio loop, so the window stays responsive.

For each file: ask the server where it goes (/direct/prepare), send its parts straight to Telegram
(several at once, each read by position from the original file), then ask the server to save it
(/direct/complete). Finished parts are kept in the upload list on disk, so a paused, failed or
interrupted upload continues with only the missing parts.
"""

import asyncio
import logging
import os
import threading
import time
from concurrent.futures import Future
from typing import Callable, Dict, List, Optional

from telestore_desktop.api import ApiError, TeleStoreApi
from telestore_desktop.media_server import MediaServer
from telestore_desktop.jobs import DONE, FAILED, PAUSED, PREPARING, SAVING, UPLOADING, WAITING, Job, JobStore
from telestore_desktop.parts import PartReader, file_key
from telestore_desktop.ratelimit import RateLimit
from telestore_desktop.telegram import TelegramAccount, TelegramError

log = logging.getLogger("telestore.engine")
THUMB_KINDS = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif", ".mp4", ".mkv", ".mov", ".avi", ".webm", ".m4v"}


class Slots:
    """How many parts are sent at once; the number can change while uploads run."""

    def __init__(self, count: int):
        self.count = max(1, count)
        self.busy = 0
        self.cond = asyncio.Condition()

    async def acquire(self) -> None:
        async with self.cond:
            await self.cond.wait_for(lambda: self.busy < self.count)
            self.busy += 1

    async def release(self) -> None:
        async with self.cond:
            self.busy -= 1
            self.cond.notify_all()

    async def resize(self, count: int) -> None:
        async with self.cond:
            self.count = max(1, count)
            self.cond.notify_all()


class UploadEngine:
    def __init__(self, api: TeleStoreApi, account: TelegramAccount, store: JobStore, parallel: int = 3,
                 speed_limit_kb: int = 0, thumbnailer: Optional[Callable[[str], Optional[str]]] = None,
                 direct_open: bool = False):
        self.api, self.account, self.store = api, account, store
        self.parallel = max(1, parallel)
        self.limit = RateLimit(speed_limit_kb * 1024)
        self.thumbnailer = thumbnailer
        self.direct_open = direct_open  # phase 10: open your own files straight from Telegram
        self.media: Optional[MediaServer] = None
        self.loop: Optional[asyncio.AbstractEventLoop] = None
        self.thread: Optional[threading.Thread] = None
        self.running: Dict[str, asyncio.Task] = {}
        self.notes: List[str] = []  # messages for the window (read with take_notes)
        self.ready = threading.Event()
        self.state = "starting"  # starting, ready, or the reason it can't upload
        self._wake: Optional[asyncio.Event] = None
        self._stopping = False
        self._slots: Optional[Slots] = None

    # ── Controls, callable from the window's thread ──
    def start(self) -> None:
        self.thread = threading.Thread(target=self._run, name="uploads", daemon=True)
        self.thread.start()
        self.ready.wait(10)  # controls can be used as soon as this returns

    def stop(self, timeout: float = 15) -> None:
        """Stops the uploads (finished parts are kept) and signs the Telegram client out of this run."""
        if self.loop and self.thread and self.thread.is_alive():
            self.loop.call_soon_threadsafe(self._request_stop)
            self.thread.join(timeout)

    def _request_stop(self) -> None:
        self._stopping = True
        self._wake.set()

    def add(self, local_paths: List[str], dest: str) -> Future:
        return self._call(self._add(local_paths, dest))

    def pause(self, job_id: str) -> None:
        self._call(self._pause(job_id))

    def resume(self, job_id: str) -> None:
        self._call(self._resume(job_id))

    def remove(self, job_id: str) -> None:
        self._call(self._remove(job_id))

    def set_parallel(self, count: int) -> None:
        self.parallel = max(1, count)
        if self._slots:
            self._call(self._slots.resize(self.parallel))

    def set_speed_limit(self, kb: int) -> None:
        self.limit.rate = max(0, kb) * 1024

    def set_direct_open(self, on: bool) -> None:
        self.direct_open = on
        if self.media and on:
            self.api.direct = self.media.url
        elif not on:
            self.api.direct = None
        if on and not self.media and self.loop and self.state == "ready":
            self._call(self._start_media())

    async def _start_media(self) -> None:
        try:
            self.media = MediaServer(self.account, self.api)
            await self.media.start()
            self.api.direct = self.media.url
        except Exception as e:  # files still open through TeleStore
            log.warning(f"Opening straight from Telegram isn't available: {e}")
            self.media = None

    def take_notes(self) -> List[str]:
        notes, self.notes = self.notes, []
        return notes

    def _call(self, coro) -> Future:
        if not self.loop:
            raise RuntimeError("The upload engine isn't running")
        return asyncio.run_coroutine_threadsafe(coro, self.loop)

    # ── The engine's own thread ──
    def _run(self) -> None:
        self.loop = asyncio.new_event_loop()
        asyncio.set_event_loop(self.loop)
        self._wake = asyncio.Event()
        self._slots = Slots(self.parallel)
        self.ready.set()
        try:
            self.loop.run_until_complete(self._main())
        finally:
            self.loop.close()

    async def _main(self) -> None:
        try:
            await self.account.start()
            self.state = "ready"
            if self.direct_open:
                await self._start_media()
        except Exception as e:
            self.state = str(e)
            self.notes.append(str(e))
            return
        while not self._stopping:
            # Several files at once, as many as parts may be sent (each file sends its own parts)
            while len(self.running) < self.parallel:
                job = self.store.next_waiting()
                if not job:
                    break
                self.store.update(job, status=PREPARING, error="")
                self.running[job.id] = asyncio.create_task(self._upload(job))
            self._wake.clear()
            try:
                await asyncio.wait_for(self._wake.wait(), 2)
            except asyncio.TimeoutError:
                pass
        for task in list(self.running.values()):
            task.cancel()
        await asyncio.gather(*self.running.values(), return_exceptions=True)
        if self.media:
            self.api.direct = None
            await self.media.stop()
        await self.account.stop()

    async def _add(self, local_paths: List[str], dest: str) -> List[Job]:
        added = []
        for local in local_paths:
            local = os.path.abspath(local)
            if os.path.isdir(local):
                added += await self._add_folder(local, dest)
            elif os.path.isfile(local):
                job = self._job(local, dest)
                if job:
                    added.append(job)
        self._wake.set()
        return added

    async def _add_folder(self, folder: str, dest: str) -> List[Job]:
        """A folder keeps its layout: its folders are made in TeleStore first, then its files go in."""
        base = os.path.basename(folder.rstrip("\\/"))
        added = []
        for root, dirs, files in os.walk(folder):
            dirs.sort()
            rel = os.path.relpath(root, folder)
            target = "/".join([dest.rstrip("/"), base] + ([] if rel == "." else rel.replace("\\", "/").split("/")))
            try:
                await asyncio.to_thread(self.api.create_folder_path, target)
            except ApiError as e:
                self.notes.append(f"Couldn't make folder {target}: {e}")
                continue
            for name in sorted(files):
                job = self._job(os.path.join(root, name), target)
                if job:
                    added.append(job)
        return added

    def _job(self, local: str, dest: str) -> Optional[Job]:
        size = os.path.getsize(local)
        name = os.path.basename(local)
        if size == 0:
            self.notes.append(f"Skipped {name}: empty files can't be stored in Telegram.")
            return None
        return self.store.add(Job(local_path=local, dest=dest, name=name, size=size, key=file_key(local, dest)))

    async def _pause(self, job_id: str) -> None:
        job = self.store.jobs.get(job_id)
        task = self.running.get(job_id)
        if task:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
        if job and job.status != DONE:
            self.store.update(job, status=PAUSED, speed=0.0)

    async def _resume(self, job_id: str) -> None:
        job = self.store.jobs.get(job_id)
        if job and job.status in (PAUSED, FAILED):
            self.store.update(job, status=WAITING, error="")
            self._wake.set()

    async def _remove(self, job_id: str) -> None:
        task = self.running.get(job_id)
        if task:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
        self.store.remove(job_id)

    async def _upload(self, job: Job) -> None:
        try:
            await self._upload_job(job)
        except asyncio.CancelledError:
            pass  # paused or removed: the finished parts are kept
        except (ApiError, TelegramError, OSError, ValueError) as e:
            self.store.update(job, status=FAILED, error=str(e), speed=0.0)
        except Exception as e:  # never leave a job looking busy
            log.exception("Upload failed")
            self.store.update(job, status=FAILED, error=f"{type(e).__name__}: {e}", speed=0.0)
        finally:
            self.running.pop(job.id, None)
            if self._wake:
                self._wake.set()

    async def _upload_job(self, job: Job) -> None:
        if not os.path.isfile(job.local_path):
            raise OSError("The file isn't there any more.")
        if file_key(job.local_path, job.dest) != job.key:
            raise OSError("The file changed since it was added. Remove it and add it again.")
        plan = await asyncio.to_thread(self.api.prepare, job.dest, job.name, job.size)
        chat_id = int(plan["chat_id"])
        parts = plan["parts"]
        await self.account.ensure_chat(chat_id)
        done = {int(k): v for k, v in job.done_parts.items()}
        sent_before = sum(p["length"] for p in parts if p["part_index"] in done)
        self.store.update(job, status=UPLOADING, total_parts=len(parts), sent=sent_before)

        running: Dict[int, int] = {}
        meter = {"t": time.monotonic(), "bytes": sent_before}

        def account_progress():
            job.sent = sent_before + sum(running.values())
            now = time.monotonic()
            if now - meter["t"] >= 1:
                rate = (job.sent - meter["bytes"]) / (now - meter["t"])
                job.speed = rate if job.speed == 0 else job.speed * 0.6 + rate * 0.4
                meter.update(t=now, bytes=job.sent)

        thumb = None
        if len(parts) == 1 and self.thumbnailer and os.path.splitext(job.name)[1].lower() in THUMB_KINDS:
            thumb = await asyncio.to_thread(self.thumbnailer, job.local_path)

        async def send_part(part: dict) -> None:
            nonlocal sent_before
            index = part["part_index"]
            await self._slots.acquire()
            try:
                state = {"seen": 0}

                async def progress(current: int, total: int) -> None:
                    # Telegram's client waits for this after each 512 KB: waiting keeps the speed cap
                    await self.limit.take(current - state["seen"])
                    state["seen"] = current
                    running[index] = current
                    account_progress()

                def reader():
                    running[index] = 0
                    state["seen"] = 0
                    return PartReader(job.local_path, part["start"], part["length"], part["file_name"])

                message_id = await self.account.send(
                    chat_id, reader, part["file_name"], part["caption"], thumb if index == 1 else None, progress,
                    on_wait=lambda text: setattr(job, "error", text))
            finally:
                await self._slots.release()
            running.pop(index, None)
            sent_before += part["length"]
            job.done_parts[str(index)] = message_id
            self.store.update(job, error="")

        todo = [p for p in parts if p["part_index"] not in done]
        tasks = [asyncio.create_task(send_part(p)) for p in todo]
        try:
            await asyncio.gather(*tasks)
        except BaseException:
            for t in tasks:
                t.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
            raise
        finally:
            if thumb and os.path.isfile(thumb):
                try:
                    os.remove(thumb)
                except OSError:
                    pass

        self.store.update(job, status=SAVING, speed=0.0, sent=job.size)
        ids = [(p["part_index"], job.done_parts[str(p["part_index"])]) for p in parts]
        try:
            await asyncio.to_thread(self.api.complete, job.dest, job.name, job.size, ids)
        except ApiError as e:
            if e.status != 409:  # 409: saved already (the app closed right after saving it)
                raise
        self.store.update(job, status=DONE, error="", finished_at=time.time())
