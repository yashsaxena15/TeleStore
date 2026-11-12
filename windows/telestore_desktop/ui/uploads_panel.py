"""The uploads panel in the bottom corner, like Google Drive's: "Uploading 2 items", each file's
progress, speed and time left, pause / resume / cancel. It collapses, and hides once all are done."""

import time

from PySide6.QtCore import QSize, Qt, QTimer, Signal
from PySide6.QtWidgets import (QFrame, QHBoxLayout, QLabel, QProgressBar, QPushButton, QScrollArea, QVBoxLayout,
                               QWidget)

from telestore_desktop.items import kind_of
from telestore_desktop.jobs import DONE, FAILED, PAUSED, PREPARING, SAVING, UPLOADING, WAITING
from telestore_desktop.parts import size_text
from telestore_desktop.ui import theme

BUSY = (WAITING, PREPARING, UPLOADING, SAVING)


def _left(seconds: float) -> str:
    if seconds < 60:
        return "less than a minute left"
    if seconds < 3600:
        return f"{int(seconds // 60)} min left"
    return f"{int(seconds // 3600)} h {int(seconds % 3600 // 60)} min left"


def describe(job) -> str:
    if job.status == UPLOADING:
        bits = [f"{job.progress:.0f}%"]
        if job.speed > 0:
            bits += [f"{size_text(job.speed)}/s", _left((job.size - job.sent) / job.speed)]
        if job.total_parts > 1:
            bits.append(f"part {min(job.total_parts, len(job.done_parts) + 1)} of {job.total_parts}")
        text = " · ".join(bits)
        return f"{text} · {job.error}" if job.error else text
    return {WAITING: "Waiting…", PREPARING: "Starting…", SAVING: "Saving to TeleStore…", PAUSED: "Paused",
            DONE: f"Uploaded to {job.dest}", FAILED: f"Couldn't upload: {job.error}"}.get(job.status, job.status)


class _Row(QFrame):
    def __init__(self, panel, job):
        super().__init__()
        self.setObjectName("uploadRow")
        self.panel, self.job_id = panel, job.id
        p = panel.p
        kind = kind_of(job.name, None)
        ico = QLabel()
        ico.setPixmap(theme.icon({"video": "video", "photo": "image", "audio": "audio"}.get(kind, "file"),
                                 theme.KIND_COLORS.get(kind, p.muted), 20).pixmap(20, 20))
        self.name = QLabel(job.name)
        self.name.setToolTip(job.local_path)
        self.name.setMinimumWidth(10)
        self.line = QLabel()
        self.line.setObjectName("muted")
        self.bar = QProgressBar()
        self.bar.setRange(0, 1000)
        self.bar.setTextVisible(False)
        self.action = QPushButton()
        self.action.setObjectName("iconButton")
        self.action.setIconSize(QSize(16, 16))
        self.action.clicked.connect(self._act)
        self.cancel = QPushButton()
        self.cancel.setObjectName("iconButton")
        self.cancel.setIcon(theme.icon("x", p.muted, 16))
        self.cancel.setToolTip("Cancel")
        self.cancel.clicked.connect(lambda: panel.engine.remove(self.job_id))
        text = QVBoxLayout()
        text.setSpacing(2)
        text.addWidget(self.name)
        text.addWidget(self.bar)
        text.addWidget(self.line)
        row = QHBoxLayout(self)
        row.setContentsMargins(12, 8, 8, 8)
        row.addWidget(ico)
        row.addLayout(text, 1)
        row.addWidget(self.action)
        row.addWidget(self.cancel)
        self.status = None

    def update_from(self, job) -> None:
        p = self.panel.p
        self.bar.setValue(int(job.progress * 10))
        self.bar.setVisible(job.status not in (DONE, FAILED))
        line = describe(job)
        metrics = self.line.fontMetrics()
        self.line.setText(metrics.elidedText(line, Qt.ElideRight, max(120, self.width() - 110)))
        self.line.setToolTip(line)
        self.line.setStyleSheet(f"color: {p.danger};" if job.status == FAILED else "")
        if job.status != self.status:
            self.status = job.status
            if job.status in (PAUSED, FAILED):
                self.action.setIcon(theme.icon("play" if job.status == PAUSED else "refresh", p.text, 16))
                self.action.setToolTip("Resume" if job.status == PAUSED else "Try again")
                self.action.show()
            elif job.status in BUSY:
                self.action.setIcon(theme.icon("pause", p.text, 16))
                self.action.setToolTip("Pause")
                self.action.show()
            else:
                self.action.setIcon(theme.icon("check", "#16a34a", 16))
                self.action.setToolTip("Done")
            self.cancel.setVisible(job.status != DONE)

    def _act(self) -> None:
        if self.status in (PAUSED, FAILED):
            self.panel.engine.resume(self.job_id)
        elif self.status in BUSY:
            self.panel.engine.pause(self.job_id)


class UploadsPanel(QFrame):
    finished_in = Signal(str)  # a TeleStore folder that just got a file (to refresh it)

    def __init__(self, parent, engine, store, palette):
        super().__init__(parent)
        self.setObjectName("uploadsPanel")
        self.engine, self.store, self.p = engine, store, palette
        self.setFixedWidth(400)
        self.rows = {}
        self.collapsed = False
        self.all_done_at = 0.0
        self.known_done = {j.id for j in store.all() if j.status == DONE}

        self.title = QLabel()
        self.title.setObjectName("uploadsHeader")
        self.fold = QPushButton()
        self.fold.setObjectName("iconButton")
        self.fold.clicked.connect(self.toggle)
        close = QPushButton()
        close.setObjectName("iconButton")
        close.setIcon(theme.icon("x", palette.text, 16))
        close.setToolTip("Close")
        close.clicked.connect(self.close_panel)
        head = QHBoxLayout()
        head.setContentsMargins(14, 10, 8, 10)
        head.addWidget(self.title, 1)
        head.addWidget(self.fold)
        head.addWidget(close)
        self.list = QWidget()
        self.list_box = QVBoxLayout(self.list)
        self.list_box.setContentsMargins(0, 0, 0, 0)
        self.list_box.setSpacing(0)
        self.list_box.addStretch()
        self.scroll = QScrollArea()
        self.scroll.setWidgetResizable(True)
        self.scroll.setFrameShape(QFrame.NoFrame)
        self.scroll.setWidget(self.list)
        self.scroll.setMaximumHeight(300)
        self.scroll.setHorizontalScrollBarPolicy(Qt.ScrollBarAlwaysOff)
        self.list.setObjectName("uploadList")
        box = QVBoxLayout(self)
        box.setContentsMargins(0, 0, 0, 0)
        box.setSpacing(0)
        box.addLayout(head)
        box.addWidget(self.scroll)
        self.hide()
        self.timer = QTimer(self)
        self.timer.timeout.connect(self.refresh)
        self.timer.start(500)

    def toggle(self) -> None:
        self.collapsed = not self.collapsed
        self.scroll.setVisible(not self.collapsed)
        self.place()

    def close_panel(self) -> None:
        busy = [j for j in self.store.all() if j.status in BUSY]
        if busy:
            self.collapsed = True
            self.scroll.hide()
            self.place()
            return  # uploads keep going: it only folds while they run
        self.store.clear_done()
        self.hide()

    def refresh(self) -> None:
        jobs = self.store.all()
        for job in jobs:
            if job.id not in self.rows:
                row = _Row(self, job)
                self.rows[job.id] = row
                self.list_box.insertWidget(self.list_box.count() - 1, row)
            self.rows[job.id].update_from(job)
            if job.status == DONE and job.id not in self.known_done:
                self.known_done.add(job.id)
                self.finished_in.emit(job.dest)
        for job_id in [k for k in self.rows if k not in {j.id for j in jobs}]:
            self.rows.pop(job_id).deleteLater()
        height = min(300, sum(r.sizeHint().height() for r in self.rows.values()))
        if height and self.scroll.height() != height:
            self.scroll.setFixedHeight(height)
            if self.isVisible():
                self.place()
        busy = sum(1 for j in jobs if j.status in BUSY)
        failed = sum(1 for j in jobs if j.status == FAILED)
        paused = sum(1 for j in jobs if j.status == PAUSED)
        done = sum(1 for j in jobs if j.status == DONE)
        if busy:
            self.title.setText(f"Uploading {busy} item{'s' if busy != 1 else ''}")
        elif failed:
            self.title.setText(f"{failed} upload{'s' if failed != 1 else ''} couldn't finish")
        elif paused:
            self.title.setText(f"{paused} upload{'s' if paused != 1 else ''} paused")
        else:
            self.title.setText(f"{done} upload{'s' if done != 1 else ''} complete")
        self.fold.setIcon(theme.icon("chevron-up" if self.collapsed else "chevron-down", self.p.text, 16))
        if jobs and not self.isVisible() and (busy or failed or paused):
            self.show()
            self.place()
        # Everything finished: it hides by itself a little later (unless something needs attention)
        if self.isVisible() and jobs and not busy and not failed and not paused:
            if not self.all_done_at:
                self.all_done_at = time.time()
            elif time.time() - self.all_done_at > 8 and not self.underMouse():
                self.store.clear_done()
                self.hide()
                self.all_done_at = 0.0
        else:
            self.all_done_at = 0.0 if busy else self.all_done_at
        if not jobs and self.isVisible():
            self.hide()

    def show_now(self) -> None:
        self.collapsed = False
        self.scroll.show()
        self.show()
        self.place()

    def place(self) -> None:
        parent = self.parentWidget()
        if not parent:
            return
        self.adjustSize()
        self.move(parent.width() - self.width() - 20, parent.height() - self.height() - 20)
        self.raise_()
