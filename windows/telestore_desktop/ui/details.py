"""Details, as on the website's side pane: a preview, what it is, its size, where it is, its dates,
what a folder holds (files, folders, total size) and who it's shared with."""

from datetime import datetime
from typing import List, Optional

from PySide6.QtCore import Qt, Signal
from PySide6.QtGui import QImage, QPixmap
from PySide6.QtWidgets import (QFormLayout, QFrame, QHBoxLayout, QLabel, QPushButton, QScrollArea, QVBoxLayout,
                               QWidget)

from telestore_desktop.items import Item
from telestore_desktop.parts import size_text
from telestore_desktop.ui import theme

KIND_NAMES = {"folder": "Folder", "photo": "Photo", "video": "Video", "audio": "Audio", "pdf": "PDF document",
              "archive": "Archive", "document": "File"}


def nice_date(value: str) -> str:
    if not value:
        return ""
    try:
        d = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return str(value)
    if d.tzinfo:
        d = d.astimezone()
    return d.strftime("%d %b %Y, %H:%M")


def kind_name(item: Item) -> str:
    ext = item.ext.lstrip(".").upper()
    base = KIND_NAMES.get(item.kind, "File")
    return f"{base} ({ext})" if ext and not item.is_folder else base


def facts(item: Item) -> List[tuple]:
    """(label, value) rows for one item (without the server's folder counts and sharing)."""
    rows = [("Type", kind_name(item))]
    if not item.is_folder:
        rows.append(("Size", f"{size_text(item.size)} ({item.size:,} bytes)"))
    if item.share_id:
        rows.append(("Shared by", item.owner or "someone"))
    else:
        rows.append(("Location", item.path or "/Home"))
    if item.duration:
        s = int(item.duration)
        rows.append(("Length", f"{s // 3600}:{s // 60 % 60:02d}:{s % 60:02d}" if s >= 3600 else f"{s // 60}:{s % 60:02d}"))
    if item.taken_at:
        rows.append(("Taken", nice_date(item.taken_at)))
    if item.modified:
        rows.append(("Modified", nice_date(item.modified)))
    if item.created and item.created != item.modified:
        rows.append(("Added", nice_date(item.created)))
    if item.starred:
        rows.append(("Starred", "Yes"))
    return [(k, v) for k, v in rows if v]


class DetailsPane(QFrame):
    closed = Signal()
    open_item = Signal(object)
    download = Signal(list)
    share = Signal(object)

    def __init__(self, api, runner, palette):
        super().__init__()
        self.setObjectName("detailsPane")
        self.setFixedWidth(320)
        self.api, self.runner, self.p = api, runner, palette
        self.items: List[Item] = []
        self.generation = 0

        title = QLabel("Details")
        title.setObjectName("sectionTitle")
        close = QPushButton()
        close.setObjectName("iconButton")
        close.setIcon(theme.icon("x", palette.text, 16))
        close.setToolTip("Close details")
        close.clicked.connect(self.closed.emit)
        head = QHBoxLayout()
        head.addWidget(title, 1)
        head.addWidget(close)

        self.preview = QLabel()
        self.preview.setAlignment(Qt.AlignCenter)
        self.preview.setFixedHeight(190)
        self.preview.setObjectName("preview")
        self.name = QLabel()
        self.name.setObjectName("detailsName")
        self.name.setWordWrap(True)
        self.name.setTextInteractionFlags(Qt.TextSelectableByMouse)
        self.form = QFormLayout()
        self.form.setLabelAlignment(Qt.AlignLeft)
        self.form.setHorizontalSpacing(14)
        self.form.setVerticalSpacing(8)
        self.extra = QLabel()
        self.extra.setWordWrap(True)
        self.extra.setObjectName("muted")
        self.buttons = QHBoxLayout()
        self.open_btn = QPushButton("Open")
        self.open_btn.clicked.connect(lambda: self.items and self.open_item.emit(self.items[0]))
        self.download_btn = QPushButton("Download")
        self.download_btn.clicked.connect(lambda: self.items and self.download.emit(list(self.items)))
        self.share_btn = QPushButton("Share")
        self.share_btn.clicked.connect(lambda: self.items and self.share.emit(self.items[0]))
        for b in (self.open_btn, self.download_btn, self.share_btn):
            self.buttons.addWidget(b)
        self.empty = QLabel("Select a file or folder to see its details.")
        self.empty.setObjectName("muted")
        self.empty.setWordWrap(True)
        self.empty.setAlignment(Qt.AlignCenter)

        body = QWidget()
        body.setObjectName("detailsBody")
        box = QVBoxLayout(body)
        box.setContentsMargins(16, 4, 16, 16)
        box.setSpacing(12)
        box.addWidget(self.preview)
        box.addWidget(self.name)
        box.addLayout(self.buttons)
        box.addLayout(self.form)
        box.addWidget(self.extra)
        box.addWidget(self.empty)
        box.addStretch()
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setFrameShape(QFrame.NoFrame)
        scroll.setHorizontalScrollBarPolicy(Qt.ScrollBarAlwaysOff)
        scroll.setWidget(body)
        outer = QVBoxLayout(self)
        outer.setContentsMargins(0, 12, 8, 0)
        head.setContentsMargins(16, 0, 0, 4)
        outer.addLayout(head)
        outer.addWidget(scroll, 1)
        self.show_items([])

    def _clear_form(self) -> None:
        while self.form.rowCount():
            self.form.removeRow(0)

    def _row(self, label: str, value: str) -> QLabel:
        name = QLabel(label)
        name.setObjectName("muted")
        v = QLabel(value)
        v.setWordWrap(True)
        v.setTextInteractionFlags(Qt.TextSelectableByMouse)
        self.form.addRow(name, v)
        return v

    def show_items(self, items: List[Item]) -> None:
        self.generation += 1
        self.items = list(items)
        self._clear_form()
        self.extra.setText("")
        for w in (self.preview, self.name, self.open_btn, self.download_btn, self.share_btn):
            w.setVisible(bool(items))
        self.empty.setVisible(not items)
        if not items:
            return
        if len(items) > 1:
            files = [i for i in items if not i.is_folder]
            folders = len(items) - len(files)
            self.name.setText(f"{len(items)} items selected")
            self.preview.setPixmap(theme.icon("file", self.p.muted, 72).pixmap(72, 72))
            self._row("Files", f"{len(files)}")
            if folders:
                self._row("Folders", f"{folders}")
            self._row("Size", size_text(sum(i.size for i in files)) + (" (plus the folders)" if folders else ""))
            self.open_btn.hide()
            self.share_btn.hide()
            return
        item = items[0]
        self.name.setText(item.name)
        self.open_btn.setText("Open folder" if item.is_folder else "Open")
        self.share_btn.setVisible(not item.share_id)
        self.preview.setPixmap(theme.tile(item.kind, 96, self.p.card))
        for label, value in facts(item):
            self._row(label, value)
        gen = self.generation
        url = None if item.is_folder else self.api.thumbnail_url(item)
        if url:
            def picture(data):
                if gen != self.generation:
                    return
                image = QImage()
                image.loadFromData(data or b"")
                if not image.isNull():
                    ratio = self.devicePixelRatioF()
                    pm = QPixmap.fromImage(image.scaled(int(288 * ratio), int(190 * ratio), Qt.KeepAspectRatio,
                                                        Qt.SmoothTransformation))
                    pm.setDevicePixelRatio(ratio)
                    self.preview.setPixmap(pm)
            self.runner.run(lambda: self.api.fetch(url), picture, lambda e: None)
        if item.is_folder and not item.share_id:
            holds = self._row("Contains", "Counting…")
            total = self._row("Total size", "…")

            def counted(s):
                if gen != self.generation:
                    return
                files, folders = int(s.get("total_files") or 0), int(s.get("total_subfolders") or 0)
                holds.setText(f"{files:,} file{'s' if files != 1 else ''}, {folders:,} folder{'s' if folders != 1 else ''}")
                total.setText(size_text(int(s.get("total_size") or 0)))

            def no_count(e):
                if gen == self.generation:
                    holds.setText("Couldn't count")
                    total.setText("")

            self.runner.run(lambda: self.api.folder_stats(item.id), counted, no_count)
        if not item.share_id:
            sharing = self._row("Sharing", "…")

            def shared(view):
                if gen != self.generation:
                    return
                sharing.setText(sharing_text(view))

            self.runner.run(lambda: self.api.share_view(item.id), shared,
                            lambda e: gen == self.generation and sharing.setText("Not shared"))


def sharing_text(view: Optional[dict]) -> str:
    view = view or {}
    people = len(view.get("members") or [])
    link = view.get("link") or {}
    bits = []
    if people:
        bits.append(f"{people} {'person' if people == 1 else 'people'}")
    if link.get("enabled"):
        bits.append("anyone with the link")
    return "Shared with " + " and ".join(bits) if bits else "Not shared"
