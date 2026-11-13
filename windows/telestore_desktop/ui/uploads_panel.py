"""The panel in the bottom corner, like Google Drive's: "Uploading 2 items · Downloading 1", each file's
progress, speed and time left, pause / resume / cancel. It folds, and hides once everything is done.
The full list (with the server's own transfers) is on the Transfers page."""

import os
import time

from PySide6.QtCore import Qt, QTimer, QUrl, Signal
from PySide6.QtGui import QDesktopServices
from PySide6.QtWidgets import QFrame, QHBoxLayout, QLabel, QPushButton, QScrollArea, QVBoxLayout, QWidget

from telestore_desktop.jobs import DONE
from telestore_desktop.ui import theme
from telestore_desktop.ui.transfer_rows import BROKEN, FINISHED, QUEUED, RUNNING, STOPPED, TransferRow, from_download, from_upload


def act(action: str, key: str, engine, downloads) -> None:
    """Runs a row's button on the upload engine or the download manager."""
    kind, _, job_id = key.partition(":")
    if kind == "u":
        {"pause": engine.pause, "resume": engine.resume, "retry": engine.resume, "cancel": engine.remove}[action](job_id)
    elif kind == "d" and downloads:
        if action == "show":
            job = downloads.jobs.get(job_id)
            if job:
                show_in_folder(job.target)
            return
        {"pause": downloads.pause, "resume": downloads.resume, "retry": downloads.resume, "cancel": downloads.cancel}[action](job_id)


def show_in_folder(path: str) -> None:
    if os.name == "nt":
        import subprocess
        subprocess.Popen(["explorer", "/select,", os.path.normpath(path)])
    else:
        QDesktopServices.openUrl(QUrl.fromLocalFile(os.path.dirname(path)))


class UploadsPanel(QFrame):
    finished_in = Signal(str)  # a TeleStore folder that just got a file (to refresh it)
    open_transfers = Signal()

    def __init__(self, parent, engine, store, palette, downloads=None):
        super().__init__(parent)
        self.setObjectName("uploadsPanel")
        self.engine, self.store, self.p, self.downloads = engine, store, palette, downloads
        self.setFixedWidth(420)
        self.rows = {}
        self.collapsed = False
        self.all_done_at = 0.0
        self.dismissed = set()  # finished downloads already hidden from this panel
        self.known_done = {j.id for j in store.all() if j.status == DONE}
        self.hide_when = None  # a check: True while the panel shouldn't show

        self.title = QLabel()
        self.title.setObjectName("uploadsHeader")
        see_all = QPushButton("See all")
        see_all.setObjectName("linkButton")
        see_all.setCursor(Qt.PointingHandCursor)
        see_all.clicked.connect(self.open_transfers.emit)
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
        head.addWidget(see_all)
        head.addWidget(self.fold)
        head.addWidget(close)
        self.list = QWidget()
        self.list.setObjectName("uploadList")
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

    def _entries(self):
        out = [from_upload(j) for j in self.store.all()]
        if self.downloads:
            out += [from_download(d) for d in self.downloads.all() if d.id not in self.dismissed]
        return out

    def close_panel(self) -> None:
        if any(e.busy for e in self._entries()):
            self.collapsed = True
            self.scroll.hide()
            self.place()
            return  # transfers keep going: it only folds while they run
        self._clear_finished()
        self.hide()

    def _clear_finished(self) -> None:
        self.store.clear_done()
        if self.downloads:
            self.dismissed |= {d.id for d in self.downloads.all() if d.status == "done"}

    def refresh(self) -> None:
        for job in self.store.all():
            if job.status == DONE and job.id not in self.known_done:
                self.known_done.add(job.id)
                self.finished_in.emit(job.dest)
        entries = self._entries()
        for e in entries:
            if e.key not in self.rows:
                row = TransferRow(e, self.p)
                row.act.connect(lambda a, k: act(a, k, self.engine, self.downloads))
                self.rows[e.key] = row
                self.list_box.insertWidget(self.list_box.count() - 1, row)
            else:
                self.rows[e.key].update_from(e)
        keys = {e.key for e in entries}
        for key in [k for k in self.rows if k not in keys]:
            gone = self.rows.pop(key)
            gone.hide()
            gone.deleteLater()
        height = min(300, sum(r.sizeHint().height() for r in self.rows.values()))
        if height and self.scroll.height() != height:
            self.scroll.setFixedHeight(height)
            if self.isVisible():
                self.place()
        up = sum(1 for e in entries if e.busy and e.kind == "upload")
        down = sum(1 for e in entries if e.busy and e.kind == "download")
        failed = sum(1 for e in entries if e.status == BROKEN)
        paused = sum(1 for e in entries if e.status == STOPPED)
        done = sum(1 for e in entries if e.status == FINISHED)
        if up or down:
            bits = ([f"Uploading {up} item{'s' if up != 1 else ''}"] if up else []) + \
                   ([f"Downloading {down} item{'s' if down != 1 else ''}"] if down else [])
            self.title.setText(" · ".join(bits))
        elif failed:
            self.title.setText(f"{failed} transfer{'s' if failed != 1 else ''} couldn't finish")
        elif paused:
            self.title.setText(f"{paused} transfer{'s' if paused != 1 else ''} paused")
        else:
            uploads_done = sum(1 for e in entries if e.status == FINISHED and e.kind == "upload")
            noun = "upload" if uploads_done == done else "transfer"
            self.title.setText(f"{done} {noun}{'s' if done != 1 else ''} complete")
        self.fold.setIcon(theme.icon("chevron-up" if self.collapsed else "chevron-down", self.p.text, 16))
        busy = up + down
        if self.suppressed():
            self.hide()
            return
        if entries and not self.isVisible() and (busy or failed or paused):
            self.show()
            self.place()
        # Everything finished: it hides by itself a little later (unless something needs attention)
        if self.isVisible() and entries and not busy and not failed and not paused:
            if not self.all_done_at:
                self.all_done_at = time.time()
            elif time.time() - self.all_done_at > 8 and not self.underMouse():
                self._clear_finished()
                self.hide()
                self.all_done_at = 0.0
        elif busy:
            self.all_done_at = 0.0
        if not entries and self.isVisible():
            self.hide()

    def suppressed(self) -> bool:
        """Hidden while the Transfers page (which shows the same) is open."""
        return bool(self.hide_when and self.hide_when())

    def show_now(self) -> None:
        if self.suppressed():
            return
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


__all__ = ["UploadsPanel", "act", "show_in_folder", "RUNNING", "QUEUED"]
