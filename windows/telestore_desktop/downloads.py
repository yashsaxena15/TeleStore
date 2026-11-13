"""Downloads to this PC: several files at once, whole folders (kept as folders), pause, resume and retry.

Your own files come straight from Telegram (the app's local media server) when that's on, else
through TeleStore; files shared with you come through TeleStore. A paused or failed download keeps
what it has (name.ext.part) and continues from there with a byte range.
"""

import os
import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

import requests

from telestore_desktop.items import Item, from_listing, from_share

WAITING, LISTING, DOWNLOADING, PAUSED, DONE, FAILED = "waiting", "listing", "downloading", "paused", "done", "failed"
ACTIVE = (WAITING, LISTING, DOWNLOADING)
_BAD = '<>:"/\\|?*'


def safe_name(name: str) -> str:
    cleaned = "".join("_" if c in _BAD or ord(c) < 32 else c for c in name or "").strip(" .")
    return cleaned or "file"


@dataclass
class Download:
    item: Item
    target: str  # the file on this PC
    group: str = ""  # the folder it belongs to, when a whole folder was downloaded
    id: str = field(default_factory=lambda: uuid.uuid4().hex[:12])
    status: str = WAITING
    done: int = 0
    size: int = 0
    speed: float = 0.0
    error: str = ""
    added_at: float = field(default_factory=time.time)
    finished_at: float = 0.0

    @property
    def name(self) -> str:
        return os.path.basename(self.target)

    @property
    def progress(self) -> float:
        total = self.size or self.item.size
        return 100.0 if self.status == DONE else (min(100.0, self.done * 100 / total) if total else 0.0)


class DownloadManager:
    def __init__(self, api, parallel: int = 3):
        self.api = api
        self.parallel = max(1, parallel)
        self.jobs: Dict[str, Download] = {}
        self.order: List[str] = []
        self.notes: List[str] = []  # messages for the window
        self.finished: List[Download] = []  # newly finished (the window takes them to say so)
        self._lock = threading.Condition()
        self._stops: Dict[str, threading.Event] = {}
        self._reserved = set()
        self._closing = False
        self._workers = [threading.Thread(target=self._work, name=f"download-{n}", daemon=True) for n in range(self.parallel)]
        for w in self._workers:
            w.start()

    # ── Adding ──
    def add(self, items: List[Item], folder: str) -> None:
        """Queues files, and folders with everything inside them, into [folder] on this PC."""
        os.makedirs(folder, exist_ok=True)
        files = [i for i in items if not i.is_folder]
        with self._lock:
            for item in files:
                self._queue(item, self._free_name(folder, item.name))
            self._lock.notify_all()
        for item in (i for i in items if i.is_folder):
            threading.Thread(target=self._add_folder, args=(item, folder), daemon=True).start()

    def _add_folder(self, folder_item: Item, folder: str) -> None:
        marker = Download(item=folder_item, target=os.path.join(folder, safe_name(folder_item.name)), status=LISTING)
        with self._lock:
            self._remember(marker)
        try:
            found = self.contents(folder_item)
        except Exception as e:
            with self._lock:
                marker.status, marker.error = FAILED, f"Couldn't list the folder: {e}"
            return
        root = self._free_name(folder, folder_item.name, is_folder=True)
        with self._lock:
            self._forget(marker.id)
            if not found:
                self.notes.append(f"{folder_item.name} is empty: nothing to download.")
            for item, rel in found:
                where = os.path.join(root, *[safe_name(p) for p in rel.split("/") if p])
                self._queue(item, self._free_name(where, item.name), group=folder_item.name)
            self._lock.notify_all()

    def contents(self, folder_item: Item) -> List[Tuple[Item, str]]:
        """Every file in a folder, with its folder inside it ("" = at the top, "Day 1/Raw")."""
        if folder_item.share_id:
            out = []
            start = "" if folder_item.share_root else f"{folder_item.share_path.strip('/')}/{folder_item.name}".strip("/")
            todo = [(start, "")]
            while todo:
                path, rel = todo.pop(0)
                for d in self.api.browse_share(folder_item.share_id, path).get("items") or []:
                    item = from_share(d, folder_item.share_id, path)
                    if item.is_folder:
                        todo.append((f"{path}/{item.name}".strip("/"), f"{rel}/{item.name}".strip("/")))
                    else:
                        out.append((item, rel))
            return out
        base = folder_item.full_path.rstrip("/")
        out = []
        for d in self.api.files_under(base):
            item = from_listing(d)
            rel = item.path[len(base):].strip("/") if item.path.startswith(base) else ""
            out.append((item, rel))
        return out

    def _queue(self, item: Item, target: str, group: str = "") -> Download:
        job = Download(item=item, target=target, group=group, size=item.size)
        self._remember(job)
        return job

    def _remember(self, job: Download) -> None:
        self.jobs[job.id] = job
        self.order.append(job.id)

    def _forget(self, job_id: str) -> None:
        job = self.jobs.pop(job_id, None)
        if job_id in self.order:
            self.order.remove(job_id)
        if job:
            self._reserved.discard(job.target.lower())

    def _free_name(self, folder: str, name: str, is_folder: bool = False) -> str:
        """[name] in [folder], or "name (1).ext" when that's taken (on disk or by another download)."""
        os.makedirs(folder, exist_ok=True)
        base, ext = (name, "") if is_folder else os.path.splitext(safe_name(name))
        base = safe_name(base)
        n = 0
        while True:
            candidate = os.path.join(folder, f"{base}{f' ({n})' if n else ''}{ext}")
            if not os.path.exists(candidate) and candidate.lower() not in self._reserved:
                self._reserved.add(candidate.lower())
                return candidate
            n += 1

    # ── Controls ──
    def all(self) -> List[Download]:
        with self._lock:
            return [self.jobs[i] for i in self.order if i in self.jobs]

    def pause(self, job_id: str) -> None:
        with self._lock:
            job = self.jobs.get(job_id)
            if job and job.status in (WAITING, DOWNLOADING):
                job.status, job.speed = PAUSED, 0.0
                stop = self._stops.get(job_id)
                if stop:
                    stop.set()

    def resume(self, job_id: str) -> None:
        with self._lock:
            job = self.jobs.get(job_id)
            if job and job.status in (PAUSED, FAILED) and not job.item.is_folder:
                job.status, job.error = WAITING, ""
                self._lock.notify_all()

    def cancel(self, job_id: str) -> None:
        with self._lock:
            job = self.jobs.get(job_id)
            if not job:
                return
            stop = self._stops.get(job_id)
            if stop:
                stop.set()
            if job.status != DONE:
                for leftover in (job.target + ".part",):
                    try:
                        os.remove(leftover)
                    except OSError:
                        pass
            self._forget(job_id)

    def clear_finished(self) -> None:
        with self._lock:
            for job in [j for j in self.jobs.values() if j.status == DONE]:
                self._forget(job.id)

    def take_finished(self) -> List[Download]:
        with self._lock:
            out, self.finished = self.finished, []
            return out

    def take_notes(self) -> List[str]:
        with self._lock:
            out, self.notes = self.notes, []
            return out

    def close(self) -> None:
        with self._lock:
            self._closing = True
            for stop in self._stops.values():
                stop.set()
            self._lock.notify_all()

    # ── The work ──
    def _next(self) -> Optional[Download]:
        with self._lock:
            while not self._closing:
                for job_id in self.order:
                    job = self.jobs.get(job_id)
                    if job and job.status == WAITING:
                        job.status = DOWNLOADING
                        self._stops[job.id] = threading.Event()
                        return job
                self._lock.wait(1)
            return None

    def _work(self) -> None:
        while True:
            job = self._next()
            if job is None:
                return
            stop = self._stops[job.id]
            try:
                self._fetch(job, stop)
                with self._lock:
                    if job.id in self.jobs and not stop.is_set():
                        job.status, job.speed, job.finished_at = DONE, 0.0, time.time()
                        self.finished.append(job)
            except Exception as e:
                with self._lock:
                    if job.status == DOWNLOADING:  # not paused or cancelled meanwhile
                        job.status, job.speed, job.error = FAILED, 0.0, str(e) or type(e).__name__
            finally:
                with self._lock:
                    self._stops.pop(job.id, None)

    def _fetch(self, job: Download, stop: threading.Event) -> None:
        os.makedirs(os.path.dirname(job.target), exist_ok=True)
        part = job.target + ".part"
        have = os.path.getsize(part) if os.path.exists(part) else 0
        url = self.api.file_url(job.item, inline=False)
        headers = {"Range": f"bytes={have}-"} if have else {}
        if getattr(self.api, "token", None):
            headers["X-Auth-Token"] = self.api.token
        http = getattr(self.api, "http", None) or requests
        try:
            resp = http.get(url, headers=headers, stream=True, timeout=(30, 120))
        except requests.RequestException as e:
            raise ConnectionError(f"Couldn't reach the file ({type(e).__name__}). Try again.") from e
        with resp:
            if resp.status_code == 416 and have:  # it was complete already
                os.replace(part, job.target)
                job.done = job.size = have
                return
            if resp.status_code >= 400:
                raise ConnectionError(f"The server answered {resp.status_code}.")
            if resp.status_code != 206:
                have = 0  # no ranges here: start over
            length = int(resp.headers.get("Content-Length") or 0)
            job.size = have + length if length else (job.item.size or 0)
            job.done = have
            meter_t, meter_b = time.monotonic(), have
            try:
                with open(part, "ab" if have else "wb") as f:
                    for chunk in resp.iter_content(512 * 1024):
                        if stop.is_set():
                            return
                        f.write(chunk)
                        job.done += len(chunk)
                        now = time.monotonic()
                        if now - meter_t >= 1:
                            rate = (job.done - meter_b) / (now - meter_t)
                            job.speed = rate if job.speed == 0 else job.speed * 0.6 + rate * 0.4
                            meter_t, meter_b = now, job.done
            except requests.RequestException as e:
                raise ConnectionError(f"The download stopped ({type(e).__name__}). Resume continues from here.") from e
        if stop.is_set():
            return
        if job.size and job.done < job.size:
            raise ConnectionError("The download stopped early. Resume continues from here.")
        os.replace(part, job.target)
