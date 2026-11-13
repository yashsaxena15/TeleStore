"""One row per transfer, for the corner panel and the Transfers page: uploads from this PC, downloads
to it, and the transfers the server runs (links, torrents, cloud drives), in the website's words."""

import time
from dataclasses import dataclass, field
from typing import List

from PySide6.QtCore import QSize, Qt, Signal
from PySide6.QtWidgets import QFrame, QHBoxLayout, QLabel, QProgressBar, QPushButton, QVBoxLayout

from telestore_desktop import downloads as dl
from telestore_desktop.items import kind_of
from telestore_desktop.jobs import DONE, FAILED, PAUSED, PREPARING, SAVING, UPLOADING, WAITING
from telestore_desktop.parts import size_text
from telestore_desktop.ui import theme

RUNNING, QUEUED, STOPPED, FINISHED, BROKEN = "running", "waiting", "paused", "done", "failed"
SERVER_ACTIVE = {"queued", "downloading", "uploading_tg", "discovering", "paused_quota"}


def time_left(seconds: float) -> str:
    if seconds < 60:
        return "less than a minute left"
    if seconds < 3600:
        return f"{int(seconds // 60)} min left"
    return f"{int(seconds // 3600)} h {int(seconds % 3600 // 60)} min left"


@dataclass
class Entry:
    key: str  # u:<job>, d:<download>, r:<server task>
    kind: str  # upload, download, server
    name: str
    file_kind: str
    status: str  # running, waiting, paused, done, failed
    progress: float  # 0..100
    line: str
    actions: List[str] = field(default_factory=list)  # pause, resume, retry, cancel, show
    when: float = 0.0
    speed: float = 0.0
    tooltip: str = ""

    @property
    def busy(self) -> bool:
        return self.status in (RUNNING, QUEUED)


def _moving(done: int, size: int, speed: float, extra: str = "") -> str:
    bits = [f"{size_text(done)} of {size_text(size)}" if size else size_text(done)]
    if speed > 0:
        bits.append(f"{size_text(speed)}/s")
        if size > done:
            bits.append(time_left((size - done) / speed))
    if extra:
        bits.append(extra)
    return " · ".join(bits)


def from_upload(job) -> Entry:
    status = {UPLOADING: RUNNING, PREPARING: RUNNING, SAVING: RUNNING, WAITING: QUEUED, PAUSED: STOPPED,
              DONE: FINISHED, FAILED: BROKEN}.get(job.status, QUEUED)
    if job.status == UPLOADING:
        parts = f"part {min(job.total_parts, len(job.done_parts) + 1)} of {job.total_parts}" if job.total_parts > 1 else ""
        line = _moving(job.sent, job.size, job.speed, parts)
        if job.error:
            line += f" · {job.error}"
    else:
        line = {WAITING: "Waiting…", PREPARING: "Starting…", SAVING: "Saving to TeleStore…", PAUSED: "Paused",
                DONE: f"Uploaded to {job.dest}", FAILED: f"Couldn't upload: {job.error}"}.get(job.status, job.status)
    actions = {RUNNING: ["pause", "cancel"], QUEUED: ["pause", "cancel"], STOPPED: ["resume", "cancel"],
               BROKEN: ["retry", "cancel"], FINISHED: []}[status]
    return Entry(f"u:{job.id}", "upload", job.name, kind_of(job.name, None), status, job.progress, line, actions,
                 getattr(job, "finished_at", 0) or getattr(job, "added_at", 0) or 0, job.speed if status == RUNNING else 0.0,
                 job.local_path)


def from_download(d) -> Entry:
    status = {dl.DOWNLOADING: RUNNING, dl.LISTING: RUNNING, dl.WAITING: QUEUED, dl.PAUSED: STOPPED,
              dl.DONE: FINISHED, dl.FAILED: BROKEN}.get(d.status, QUEUED)
    if d.status == dl.DOWNLOADING:
        line = _moving(d.done, d.size or d.item.size, d.speed)
    elif d.status == dl.LISTING:
        line = "Finding the files in this folder…"
    else:
        line = {dl.WAITING: "Waiting…", dl.PAUSED: "Paused", dl.DONE: f"Saved to {d.target}",
                dl.FAILED: f"Couldn't download: {d.error}"}.get(d.status, d.status)
    if d.group and d.status != dl.DONE:
        line = f"{d.group} · {line}"
    actions = {RUNNING: ["pause", "cancel"], QUEUED: ["pause", "cancel"], STOPPED: ["resume", "cancel"],
               BROKEN: ["retry", "cancel"], FINISHED: ["show"]}[status]
    if d.status == dl.LISTING:
        actions = []
    return Entry(f"d:{d.id}", "download", d.name, "folder" if d.item.is_folder else d.item.kind, status, d.progress, line,
                 actions, d.finished_at or d.added_at, d.speed if status == RUNNING else 0.0, d.target)


def _iso_seconds(value) -> float:
    from datetime import datetime
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).timestamp()
    except (TypeError, ValueError):
        return 0.0


def from_server(task: dict) -> Entry:
    raw = task.get("status") or "queued"
    status = (RUNNING if raw in ("downloading", "uploading_tg", "discovering") else QUEUED if raw in ("queued", "paused_quota")
              else FINISHED if raw == "completed" else BROKEN if raw == "failed" else STOPPED)
    size, done = int(task.get("filesize") or 0), int(task.get("transferred_bytes") or 0)
    progress = float(task.get("progress") or (done * 100 / size if size else 0))
    speed = float(task.get("download_bps") or task.get("upload_bps") or task.get("speed_bps") or 0)
    phase = task.get("phase") or ""
    if raw in ("downloading", "uploading_tg"):
        what = "Uploading to Telegram" if raw == "uploading_tg" else "Downloading"
        line = f"{what} · " + _moving(done, size, speed)
    else:
        line = {"queued": "Waiting on the server…", "discovering": "Finding the files…", "completed": "Saved to TeleStore",
                "failed": f"Failed: {task.get('error_message') or 'unknown error'}", "cancelled": "Cancelled",
                "paused_quota": phase or "Paused by Google Drive's daily limit"}.get(raw, raw)
    if phase and raw in ("downloading", "uploading_tg", "discovering"):
        line = f"{line} · {phase}"
    worker = task.get("worker")
    if worker and worker != "main" and status == RUNNING:
        line += f" · on {worker}"
    actions = ["cancel"] if raw in SERVER_ACTIVE else ["retry"] if raw == "failed" else []
    name = task.get("filename") or task.get("source_url") or "Transfer"
    return Entry(f"r:{task.get('task_id')}", "server", name, kind_of(name, None), status, progress, line, actions,
                 _iso_seconds(task.get("updated_at") or task.get("created_at")), speed if status == RUNNING else 0.0,
                 task.get("destination_path") or "")


def from_group(group_id: str, g: dict) -> Entry:
    """A folder the server transfers (a Google Drive folder, a torrent's files): one row for all its files."""
    counts = g.get("counts") or {}
    total = int(g.get("total") or sum(counts.values()) or 0)
    done_n, failed_n = int(counts.get("completed") or 0), int(counts.get("failed") or 0)
    moving = sum(int(counts.get(s) or 0) for s in ("downloading", "uploading_tg", "discovering"))
    waiting = sum(int(counts.get(s) or 0) for s in ("queued", "paused_quota"))
    size, done = int(g.get("filesize") or 0), int(g.get("transferred_bytes") or 0)
    speed = float(g.get("download_bps") or g.get("upload_bps") or g.get("speed_bps") or 0)
    status = RUNNING if moving else QUEUED if waiting else BROKEN if failed_n else FINISHED
    files = f"{done_n:,} of {total:,} files"
    if status == RUNNING:
        line = f"{files} · " + _moving(done, size, speed)
    elif status == QUEUED:
        line = f"{files} · " + ("paused by Google Drive's daily limit" if counts.get("paused_quota") else "waiting on the server")
    elif status == BROKEN:
        line = f"{files} · {failed_n:,} failed" + (f": {g['error']}" if g.get("error") else "")
    else:
        line = f"All {total:,} files saved to TeleStore"
    actions = ["cancel"] if status in (RUNNING, QUEUED) else ["retry"] if failed_n else []
    progress = done_n * 100 / total if total else 0.0
    return Entry(f"g:{group_id}", "server", g.get("name") or "Folder transfer", "folder", status, progress, line, actions,
                 _iso_seconds(g.get("created_at")), speed if status == RUNNING else 0.0, g.get("destination_path") or "")


ICONS = {"pause": ("pause", "Pause"), "resume": ("play", "Resume"), "retry": ("refresh", "Try again"),
         "cancel": ("x", "Cancel"), "show": ("folder", "Show in folder")}
KIND_BADGE = {"upload": ("upload", "Upload"), "download": ("download", "Download"), "server": ("cloud", "On the server")}


class TransferRow(QFrame):
    act = Signal(str, str)  # action, entry key

    def __init__(self, entry: Entry, palette, show_kind: bool = False):
        super().__init__()
        self.setObjectName("transferRow")
        self.p = palette
        self.key = entry.key
        self.show_kind = show_kind
        self.icon = QLabel()
        self.icon.setFixedSize(QSize(28, 28))
        self.icon.setAlignment(Qt.AlignCenter)
        self.name = QLabel()
        self.name.setMinimumWidth(10)
        self.badge = QLabel()
        self.badge.setObjectName("chip")
        self.badge.setVisible(show_kind)
        self.line = QLabel()
        self.line.setObjectName("muted")
        self.line.setMinimumWidth(10)
        self.bar = QProgressBar()
        self.bar.setRange(0, 1000)
        self.bar.setTextVisible(False)
        self.buttons = QHBoxLayout()
        self.buttons.setSpacing(2)
        top = QHBoxLayout()
        top.setSpacing(6)
        top.addWidget(self.name, 1)
        top.addWidget(self.badge)
        text = QVBoxLayout()
        text.setSpacing(3)
        text.addLayout(top)
        text.addWidget(self.bar)
        text.addWidget(self.line)
        row = QHBoxLayout(self)
        row.setContentsMargins(12, 8, 8, 8)
        row.addWidget(self.icon)
        row.addLayout(text, 1)
        row.addLayout(self.buttons)
        self._actions = None
        self.update_from(entry)

    def update_from(self, e: Entry) -> None:
        p = self.p
        ico = "folder" if e.file_kind == "folder" else {"video": "video", "photo": "image", "audio": "audio"}.get(e.file_kind, "file")
        self.icon.setPixmap(theme.icon(ico, theme.KIND_COLORS.get(e.file_kind, p.muted), 20, fill=e.file_kind == "folder").pixmap(20, 20))
        self.name.setText(self.name.fontMetrics().elidedText(e.name, Qt.ElideMiddle, max(120, self.width() - 200)))
        self.name.setToolTip(e.tooltip or e.name)
        if self.show_kind:
            self.badge.setText(KIND_BADGE[e.kind][1])
        self.bar.setValue(int(e.progress * 10))
        self.bar.setVisible(e.status in (RUNNING, QUEUED, STOPPED))
        self.line.setText(self.line.fontMetrics().elidedText(e.line, Qt.ElideRight, max(120, self.width() - 150)))
        self.line.setToolTip(e.line)
        self.line.setStyleSheet(f"color: {p.danger};" if e.status == BROKEN else
                                ("color: #16a34a;" if e.status == FINISHED else ""))
        if e.actions != self._actions:
            self._actions = list(e.actions)
            while self.buttons.count():
                w = self.buttons.takeAt(0).widget()
                if w:
                    w.hide()
                    w.deleteLater()
            for name in e.actions:
                ico_name, tip = ICONS[name]
                b = QPushButton()
                b.setObjectName("iconButton")
                b.setIcon(theme.icon(ico_name, p.muted if name == "cancel" else p.text, 16))
                b.setIconSize(QSize(16, 16))
                b.setToolTip(tip)
                b.clicked.connect(lambda _=False, n=name: self.act.emit(n, self.key))
                self.buttons.addWidget(b)
            if e.status == FINISHED and not e.actions:
                done = QLabel()
                done.setPixmap(theme.icon("check", "#16a34a", 16).pixmap(16, 16))
                self.buttons.addWidget(done)


def summary(entries: List[Entry]) -> str:
    """ "2 running · 3 waiting · 4.2 MB/s" (as the website's Transfers header)."""
    running = sum(1 for e in entries if e.status == RUNNING)
    waiting = sum(1 for e in entries if e.status == QUEUED)
    paused = sum(1 for e in entries if e.status == STOPPED)
    failed = sum(1 for e in entries if e.status == BROKEN)
    speed = sum(e.speed for e in entries)
    bits = [f"{running} running" if running else "", f"{waiting} waiting" if waiting else "",
            f"{paused} paused" if paused else "", f"{failed} failed" if failed else "",
            f"{size_text(speed)}/s" if speed > 0 else ""]
    return " · ".join(b for b in bits if b)


def now() -> float:
    return time.time()
