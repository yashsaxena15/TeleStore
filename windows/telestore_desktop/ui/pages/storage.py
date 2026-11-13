"""Storage, as on the website: how much is used, what kind of files take the space, Trash, and the
largest files (a click opens the folder they're in)."""

from PySide6.QtCore import QRectF, Qt, Signal
from PySide6.QtGui import QColor, QPainter
from PySide6.QtWidgets import (QFrame, QGridLayout, QHBoxLayout, QLabel, QPushButton, QScrollArea, QTreeWidget,
                               QTreeWidgetItem, QVBoxLayout, QWidget)

from telestore_desktop.items import from_listing
from telestore_desktop.parts import size_text
from telestore_desktop.ui import theme
from telestore_desktop.ui.pages import Page, page_header

CATEGORIES = [("video", "Videos", "#8b5cf6"), ("photo", "Photos", "#10b981"), ("audio", "Music and audio", "#f59e0b"),
              ("document", "Documents", "#0ea5e9"), ("archive", "Archives", "#a16207"), ("other", "Other", "#64748b")]


class UsageBar(QWidget):
    """One bar split by kind of file (the website's storage bar)."""

    def __init__(self, palette):
        super().__init__()
        self.p = palette
        self.parts = []  # (bytes, colour)
        self.total = 0
        self.setFixedHeight(14)

    def set(self, parts, total: int) -> None:
        self.parts, self.total = parts, total
        self.update()

    def paintEvent(self, _event) -> None:
        painter = QPainter(self)
        painter.setRenderHint(QPainter.Antialiasing)
        r = QRectF(self.rect())
        painter.setPen(Qt.NoPen)
        painter.setBrush(QColor(self.p.border))
        painter.drawRoundedRect(r, 7, 7)
        if self.total <= 0:
            return
        x = 0.0
        painter.setClipRect(r)
        for value, colour in self.parts:
            w = r.width() * min(1.0, value / self.total)
            if w <= 0:
                continue
            painter.setBrush(QColor(colour))
            painter.drawRect(QRectF(x, 0, w, r.height()))
            x += w
        painter.end()


def _stat(title: str, value: QLabel, note: QLabel) -> QFrame:
    card = QFrame()
    card.setObjectName("card")
    t = QLabel(title)
    t.setObjectName("muted")
    value.setObjectName("statValue")
    note.setObjectName("muted")
    box = QVBoxLayout(card)
    box.setContentsMargins(16, 12, 16, 12)
    box.setSpacing(2)
    box.addWidget(t)
    box.addWidget(value)
    box.addWidget(note)
    return card


class StoragePage(Page):
    open_folder = Signal(str)
    open_item = Signal(object)
    open_trash = Signal()

    def __init__(self, api, runner, palette):
        super().__init__()
        self.api, self.runner, self.p = api, runner, palette
        self.subtitle = QLabel("…")
        refresh = QPushButton()
        refresh.setObjectName("iconButton")
        refresh.setIcon(theme.icon("refresh", palette.text, 18))
        refresh.setToolTip("Refresh")
        refresh.clicked.connect(self.shown)
        header = page_header(palette, "hard-drive", "Storage", self.subtitle, [refresh])

        # Used of the quota
        usage = QFrame()
        usage.setObjectName("card")
        self.used = QLabel("…")
        self.used.setObjectName("bigValue")
        self.of = QLabel()
        self.of.setObjectName("muted")
        self.bar = UsageBar(palette)
        self.legend = QGridLayout()
        self.legend.setHorizontalSpacing(24)
        self.legend.setVerticalSpacing(8)
        top = QHBoxLayout()
        top.addWidget(self.used)
        top.addWidget(self.of, 0, Qt.AlignBottom)
        top.addStretch()
        u = QVBoxLayout(usage)
        u.setContentsMargins(20, 16, 20, 16)
        u.setSpacing(12)
        u.addLayout(top)
        u.addWidget(self.bar)
        u.addLayout(self.legend)

        # Counts
        self.files_v, self.files_n = QLabel("…"), QLabel("")
        self.folders_v, self.folders_n = QLabel("…"), QLabel("")
        self.starred_v, self.starred_n = QLabel("…"), QLabel("")
        self.trash_v, self.trash_n = QLabel("…"), QLabel("")
        stats = QHBoxLayout()
        stats.setSpacing(12)
        trash_card = _stat("In Trash", self.trash_v, self.trash_n)
        trash_card.setCursor(Qt.PointingHandCursor)
        trash_card.mousePressEvent = lambda _e: self.open_trash.emit()
        for card in (_stat("Files", self.files_v, self.files_n), _stat("Folders", self.folders_v, self.folders_n),
                     _stat("Starred", self.starred_v, self.starred_n), trash_card):
            stats.addWidget(card, 1)

        # Largest files
        largest_title = QLabel("Largest files")
        largest_title.setObjectName("sectionTitle")
        self.largest = QTreeWidget()
        self.largest.setHeaderLabels(["Name", "Folder", "Size"])
        self.largest.setRootIsDecorated(False)
        self.largest.setUniformRowHeights(True)
        self.largest.setMinimumHeight(260)
        self.largest.header().setStretchLastSection(False)
        from PySide6.QtWidgets import QHeaderView
        self.largest.header().setSectionResizeMode(0, QHeaderView.Stretch)
        self.largest.header().setSectionResizeMode(1, QHeaderView.ResizeToContents)
        self.largest.header().setSectionResizeMode(2, QHeaderView.ResizeToContents)
        self.largest.itemActivated.connect(lambda it, _c: self.open_item.emit(it.data(0, Qt.UserRole)))
        self.largest.setToolTip("Double-click to open; right-click for its folder")
        self.largest.setContextMenuPolicy(Qt.CustomContextMenu)
        self.largest.customContextMenuRequested.connect(self._largest_menu)
        self.error = QLabel()
        self.error.setObjectName("muted")
        self.error.hide()

        inner = QWidget()
        inner.setObjectName("content")
        box = QVBoxLayout(inner)
        box.setContentsMargins(24, 18, 24, 18)
        box.setSpacing(14)
        box.addLayout(header)
        box.addWidget(self.error)
        box.addWidget(usage)
        box.addLayout(stats)
        box.addWidget(largest_title)
        box.addWidget(self.largest, 1)
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setFrameShape(QFrame.NoFrame)
        scroll.setWidget(inner)
        outer = QVBoxLayout(self)
        outer.setContentsMargins(0, 0, 0, 0)
        outer.addWidget(scroll)

    def shown(self) -> None:
        self.runner.run(self.api.storage, self.show_stats, self._failed)

    def _failed(self, e) -> None:
        self.error.setText(f"Couldn't load storage: {e}")
        self.error.show()

    def show_stats(self, s: dict) -> None:
        self.error.hide()
        used, quota = int(s.get("total_bytes") or 0), int(s.get("quota_bytes") or 0)
        self.used.setText(size_text(used))
        self.of.setText(f"used of {size_text(quota)} · {size_text(max(0, quota - used))} free" if quota else "used · no limit")
        self.subtitle.setText(f"{int(s.get('total_files') or 0):,} files in {int(s.get('total_folders') or 0):,} folders")
        cats = s.get("by_category") or {}
        parts = [(int((cats.get(k) or {}).get("bytes") or 0), colour) for k, _n, colour in CATEGORIES]
        self.bar.set(parts, quota or max(1, used))
        while self.legend.count():
            w = self.legend.takeAt(0).widget()
            if w:
                w.hide()
                w.deleteLater()
        for n, (key, name, colour) in enumerate(CATEGORIES):
            c = cats.get(key) or {}
            dot = QLabel()
            dot.setFixedSize(10, 10)
            dot.setStyleSheet(f"background: {colour}; border-radius: 5px;")
            label = QLabel(f"{name}")
            amount = QLabel(f"{size_text(int(c.get('bytes') or 0))} · {int(c.get('count') or 0):,} files")
            amount.setObjectName("muted")
            cell = QWidget()
            row = QHBoxLayout(cell)
            row.setContentsMargins(0, 0, 0, 0)
            row.setSpacing(8)
            row.addWidget(dot)
            row.addWidget(label)
            row.addWidget(amount)
            row.addStretch()
            self.legend.addWidget(cell, n // 3, n % 3)
        self.files_v.setText(f"{int(s.get('total_files') or 0):,}")
        self.folders_v.setText(f"{int(s.get('total_folders') or 0):,}")
        self.starred_v.setText(f"{int(s.get('starred_count') or 0):,}")
        self.trash_v.setText(size_text(int(s.get("trash_bytes") or 0)))
        self.trash_n.setText(f"{int(s.get('trash_count') or 0):,} items · open Trash")
        self.largest.clear()
        for d in s.get("largest_files") or []:
            item = from_listing(d)
            row = QTreeWidgetItem([item.name, item.path, size_text(item.size)])
            row.setData(0, Qt.UserRole, item)
            row.setIcon(0, theme.icon({"video": "video", "photo": "image", "audio": "audio"}.get(item.kind, "file"),
                                      theme.KIND_COLORS.get(item.kind, self.p.muted), 20))
            self.largest.addTopLevelItem(row)

    def _largest_menu(self, pos) -> None:
        it = self.largest.itemAt(pos)
        if not it:
            return
        from PySide6.QtWidgets import QMenu
        item = it.data(0, Qt.UserRole)
        menu = QMenu(self)
        menu.addAction(theme.icon("external", self.p.text, 16), "Open", lambda: self.open_item.emit(item))
        menu.addAction(theme.icon("folder", self.p.text, 16), "Show in its folder", lambda: self.open_folder.emit(item.path))
        menu.exec(self.largest.viewport().mapToGlobal(pos))
