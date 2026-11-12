"""The upload list, kept on disk so an upload continues after Wi-Fi drops or the PC restarts.

Each finished part's Telegram message is saved as soon as it is sent; a resumed upload sends only
the parts still missing, then asks the server to save the file.
"""

import json
import os
import threading
import time
import uuid
from dataclasses import asdict, dataclass, field
from typing import Dict, List, Optional

from telestore_desktop import paths

WAITING, PREPARING, UPLOADING, SAVING, DONE, PAUSED, FAILED = (
    "waiting", "preparing", "uploading", "saving", "done", "paused", "failed")
ACTIVE = (PREPARING, UPLOADING, SAVING)


@dataclass
class Job:
    local_path: str
    dest: str  # TeleStore folder, e.g. /Home/Movies
    name: str
    size: int
    key: str
    id: str = field(default_factory=lambda: uuid.uuid4().hex[:12])
    status: str = WAITING
    error: str = ""
    done_parts: Dict[str, int] = field(default_factory=dict)  # part index (as text) -> message id
    total_parts: int = 0
    sent: int = 0  # bytes in Telegram so far (finished parts + the running ones)
    speed: float = 0.0
    added_at: float = field(default_factory=time.time)
    finished_at: float = 0.0

    @property
    def progress(self) -> float:
        return 100.0 if self.status == DONE else (self.sent / self.size * 100 if self.size else 0.0)


class JobStore:
    """The jobs, saved to uploads.json after every change (thread-safe)."""

    def __init__(self, file: Optional[str] = None):
        self.file = file or paths.path("uploads.json")
        self.lock = threading.RLock()
        self.jobs: Dict[str, Job] = {}
        self._load()

    def _load(self) -> None:
        try:
            with open(self.file, encoding="utf-8") as f:
                raw = json.load(f)
        except (OSError, ValueError):
            raw = []
        for item in raw:
            try:
                job = Job(**item)
            except TypeError:
                continue
            if job.status in ACTIVE:
                job.status = WAITING  # the app closed mid-upload: continue from the parts already sent
            job.speed = 0.0
            self.jobs[job.id] = job

    def save(self) -> None:
        with self.lock:
            data = [asdict(j) for j in self.jobs.values()]
            tmp = self.file + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(data, f)
            os.replace(tmp, self.file)

    def add(self, job: Job) -> Job:
        with self.lock:
            for other in self.jobs.values():
                if other.key == job.key and other.status != DONE:
                    return other  # already in the list: the same file to the same folder
            self.jobs[job.id] = job
            self.save()
            return job

    def update(self, job: Job, **changes) -> None:
        with self.lock:
            for k, v in changes.items():
                setattr(job, k, v)
            self.save()

    def remove(self, job_id: str) -> None:
        with self.lock:
            self.jobs.pop(job_id, None)
            self.save()

    def clear_done(self) -> None:
        with self.lock:
            self.jobs = {k: j for k, j in self.jobs.items() if j.status != DONE}
            self.save()

    def all(self) -> List[Job]:
        with self.lock:
            return sorted(self.jobs.values(), key=lambda j: j.added_at)

    def next_waiting(self) -> Optional[Job]:
        with self.lock:
            return next((j for j in self.all() if j.status == WAITING), None)
