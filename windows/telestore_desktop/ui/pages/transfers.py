"""Transfers, as on the website: uploads from this PC, downloads to it, and what the server is
transferring for you (links, torrents, cloud drives), with filters and pause / resume / cancel."""

from PySide6.QtCore import Qt, QTimer
from PySide6.QtWidgets import (QButtonGroup, QFrame, QHBoxLayout, QLabel, QPushButton, QScrollArea, QVBoxLayout,
                               QWidget)

from telestore_desktop.ui import dialogs
from telestore_desktop.ui.pages import Page, page_header
from telestore_desktop.ui.transfer_rows import (BROKEN, FINISHED, QUEUED, RUNNING, STOPPED, TransferRow, from_download,
                                                from_group, from_server, from_upload, summary)
from telestore_desktop.ui.uploads_panel import act

FILTERS = [("all", "All"), ("active", "Active"), ("upload", "Uploads"), ("download", "Downloads"),
           ("server", "On the server"), ("done", "Finished"), ("failed", "Failed")]


def matches(entry, key: str) -> bool:
    if key == "all":
        return True
    if key == "active":
        return entry.status in (RUNNING, QUEUED, STOPPED)
    if key == "done":
        return entry.status == FINISHED
    if key == "failed":
        return entry.status == BROKEN
    return entry.kind == key


class TransfersPage(Page):
    def __init__(self, api, runner, engine, store, downloads, palette):
        super().__init__()
        self.api, self.runner, self.engine, self.store, self.downloads, self.p = api, runner, engine, store, downloads, palette
        self.server_tasks = []
        self.server_groups = {}
        self.server_error = ""
        self.filter = "all"
        self.rows = {}
        self.loading_server = False

        self.subtitle = QLabel("Uploads, downloads and the server's transfers")
        self.clear_btn = QPushButton("Clear finished")
        self.clear_btn.clicked.connect(self.clear_finished)
        header = page_header(palette, "transfers", "Transfers", self.subtitle, [self.clear_btn])

        chips = QHBoxLayout()
        chips.setSpacing(6)
        self.chip_group = QButtonGroup(self)
        self.chips = {}
        for key, text in FILTERS:
            b = QPushButton(text)
            b.setObjectName("chipButton")
            b.setCheckable(True)
            b.setCursor(Qt.PointingHandCursor)
            b.clicked.connect(lambda _=False, k=key: self.set_filter(k))
            self.chip_group.addButton(b)
            self.chips[key] = b
            chips.addWidget(b)
        chips.addStretch()
        self.chips["all"].setChecked(True)

        self.list = QWidget()
        self.list.setObjectName("cardList")
        self.list_box = QVBoxLayout(self.list)
        self.list_box.setContentsMargins(0, 0, 0, 0)
        self.list_box.setSpacing(0)
        self.list_box.addStretch()
        self.scroll = QScrollArea()
        self.scroll.setWidgetResizable(True)
        self.scroll.setFrameShape(QFrame.NoFrame)
        self.scroll.setHorizontalScrollBarPolicy(Qt.ScrollBarAlwaysOff)
        self.scroll.setWidget(self.list)
        self.scroll.setObjectName("card")
        self.empty = QLabel("Nothing here yet.\nUploads, downloads and the server's transfers show up here.")
        self.empty.setObjectName("empty")
        self.empty.setAlignment(Qt.AlignCenter)
        self.note = QLabel()
        self.note.setObjectName("muted")
        self.note.hide()

        box = QVBoxLayout(self)
        box.setContentsMargins(24, 18, 24, 16)
        box.setSpacing(12)
        box.addLayout(header)
        box.addLayout(chips)
        box.addWidget(self.note)
        box.addWidget(self.scroll, 1)
        box.addWidget(self.empty, 1)

        self.timer = QTimer(self)
        self.timer.timeout.connect(self.refresh)
        self.server_timer = QTimer(self)
        self.server_timer.timeout.connect(self.load_server)

    def shown(self) -> None:
        self.refresh()
        self.load_server()
        self.timer.start(700)
        self.server_timer.start(3000)

    def hideEvent(self, event) -> None:
        self.timer.stop()
        self.server_timer.stop()
        super().hideEvent(event)

    def set_filter(self, key: str) -> None:
        self.filter = key
        self.chips[key].setChecked(True)
        self.refresh()

    def load_server(self) -> None:
        if self.loading_server:
            return
        self.loading_server = True

        def done(body):
            self.loading_server = False
            self.server_tasks = (body or {}).get("tasks") or []
            self.server_groups = (body or {}).get("groups") or {}
            self.server_error = ""
            self.refresh()

        def failed(e):
            self.loading_server = False
            self.server_error = f"Couldn't load the server's transfers: {e}"
            self.refresh()

        self.runner.run(self.api.remote_tasks, done, failed)

    def entries(self):
        out = [from_upload(j) for j in self.store.all()]
        if self.downloads:
            out += [from_download(d) for d in self.downloads.all()]
        out += [from_server(t) for t in self.server_tasks if not t.get("group_id")]
        out += [from_group(gid, g) for gid, g in self.server_groups.items()]
        order = {RUNNING: 0, QUEUED: 1, STOPPED: 2, BROKEN: 3, FINISHED: 4}
        out.sort(key=lambda e: (order.get(e.status, 5), -e.when))
        return out

    def refresh(self) -> None:
        everything = self.entries()
        self.subtitle.setText(summary(everything) or "Uploads, downloads and the server's transfers")
        counts = {key: sum(1 for e in everything if matches(e, key)) for key, _ in FILTERS}
        for key, text in FILTERS:
            self.chips[key].setText(f"{text}  {counts[key]}" if counts[key] and key != "all" else text)
        self.clear_btn.setEnabled(counts["done"] > 0)
        self.note.setText(self.server_error)
        self.note.setVisible(bool(self.server_error))
        shown = [e for e in everything if matches(e, self.filter)]
        # Rows are kept and updated in place; the order follows the list
        keys = [e.key for e in shown]
        for key in [k for k in self.rows if k not in keys]:
            self.rows.pop(key).deleteLater()
        for n, e in enumerate(shown):
            row = self.rows.get(e.key)
            if row is None:
                row = TransferRow(e, self.p, show_kind=True)
                row.act.connect(self._act)
                self.rows[e.key] = row
            else:
                row.update_from(e)
            if self.list_box.indexOf(row) != n:
                self.list_box.insertWidget(n, row)
        self.scroll.setVisible(bool(shown))
        self.empty.setVisible(not shown)
        if not shown:
            self.empty.setText("Nothing here." if everything else
                               "Nothing here yet.\nUploads, downloads and the server's transfers show up here.")

    def _act(self, action: str, key: str) -> None:
        kind, _, task_id = key.partition(":")
        if kind == "g":
            if action == "cancel" and not dialogs.confirm(self, "Cancel folder transfer",
                                                          "Cancel every file of this folder that hasn't finished?"):
                return
            call = self.api.cancel_remote_group if action == "cancel" else self.api.retry_failed_remote
            self.runner.run(lambda: call(task_id), lambda _: self.load_server(),
                            lambda e: dialogs.info(self, "Transfers", str(e)))
            return
        if kind != "r":
            act(action, key, self.engine, self.downloads)
            QTimer.singleShot(200, self.refresh)
            return
        if action == "cancel" and not dialogs.confirm(self, "Cancel transfer", "Cancel this transfer on the server?"):
            return
        call = self.api.cancel_remote if action == "cancel" else self.api.retry_remote
        self.runner.run(lambda: call(task_id), lambda _: self.load_server(),
                        lambda e: dialogs.info(self, "Transfers", str(e)))

    def clear_finished(self) -> None:
        self.store.clear_done()
        if self.downloads:
            self.downloads.clear_finished()
        if any(t.get("status") in ("completed", "failed", "cancelled") for t in self.server_tasks):
            self.runner.run(self.api.clear_finished_remote, lambda _: self.load_server(), lambda e: None)
        self.refresh()
