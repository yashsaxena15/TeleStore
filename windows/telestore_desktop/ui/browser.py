"""The file area, as on the website: where you are (breadcrumbs), search, grid or list, and the files."""

from dataclasses import dataclass, field
from datetime import datetime
from typing import List, Optional

from PySide6.QtCore import QRectF, QSize, Qt, Signal
from PySide6.QtGui import QIcon, QImage, QKeySequence, QPainter, QPainterPath, QPixmap, QShortcut
from PySide6.QtWidgets import (QAbstractItemView, QHBoxLayout, QHeaderView, QLabel, QLineEdit, QListView,
                               QListWidget, QListWidgetItem, QMenu, QPushButton, QStackedWidget, QTreeWidget,
                               QTreeWidgetItem, QVBoxLayout, QWidget)

from telestore_desktop.items import Item, from_listing, from_share
from telestore_desktop.parts import size_text
from telestore_desktop.ui import theme

TILE = 112  # thumbnail size in the grid
TITLES = {"recent": "Recent", "starred": "Starred", "shared": "Shared with me", "photos": "Photos", "trash": "Trash"}
EMPTY = {"folder": "This folder is empty.\nDrop files here, or use New › Upload files.",
         "recent": "Nothing yet. Files you add show up here.", "starred": "No starred files.\nStar files on the website or in the app.",
         "shared": "Nothing has been shared with you yet.", "photos": "No photos or videos yet.",
         "trash": "Trash is empty.", "search": "Nothing matches that search.", "share": "This shared folder is empty."}


@dataclass
class Location:
    kind: str  # folder, recent, starred, shared, share, photos, trash, search
    path: str = "/Home"  # folder: /Home/...; share: the folder inside the share ("" = its top)
    query: str = ""
    share_id: str = ""
    share_name: str = ""
    crumbs: List[str] = field(default_factory=list)

    @property
    def can_upload(self) -> bool:
        return self.kind == "folder"


def _when(value: str) -> str:
    try:
        d = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return d.astimezone().strftime("%d %b %Y, %H:%M")
    except (ValueError, AttributeError):
        return ""


def _rounded(image: QImage, size: int) -> QPixmap:
    """The image filling a square with rounded corners (as the website's grid)."""
    scaled = image.scaled(size * 2, size * 2, Qt.KeepAspectRatioByExpanding, Qt.SmoothTransformation)
    x, y = (scaled.width() - size * 2) // 2, (scaled.height() - size * 2) // 2
    out = QPixmap(size * 2, size * 2)
    out.fill(Qt.transparent)
    painter = QPainter(out)
    painter.setRenderHint(QPainter.Antialiasing)
    clip = QPainterPath()
    clip.addRoundedRect(QRectF(0, 0, size * 2, size * 2), 20, 20)
    painter.setClipPath(clip)
    painter.drawImage(0, 0, scaled, x, y, size * 2, size * 2)
    painter.end()
    out.setDevicePixelRatio(2)
    return out


class Browser(QWidget):
    open_item = Signal(object, list)  # the item, and the items around it (for next / previous)
    download_item = Signal(object)
    action = Signal(str, list)  # rename, move, star, unstar, share, trash, restore, delete, empty-trash
    files_dropped = Signal(list)  # local paths, to upload here
    location_changed = Signal(object)

    def __init__(self, api, runner, thumbs, palette, view: str = "grid"):
        super().__init__()
        self.setObjectName("content")
        self.api, self.runner, self.thumbs, self.p = api, runner, thumbs, palette
        self.loc = Location("folder")
        self.history: List[Location] = []
        self.items: List[Item] = []
        self.by_key = {}
        self.generation = 0
        self.setAcceptDrops(True)

        # Header: back, where you are, search, view
        self.back = QPushButton()
        self.back.setObjectName("iconButton")
        self.back.setIcon(theme.icon("arrow-left", palette.text, 18))
        self.back.setToolTip("Back (Alt+Left)")
        self.back.clicked.connect(self.go_back)
        self.crumbs = QHBoxLayout()
        self.crumbs.setSpacing(0)
        self.search = QLineEdit()
        self.search.setPlaceholderText("Search in TeleStore")
        self.search.setClearButtonEnabled(True)
        self.search.addAction(theme.icon("search", palette.muted, 16), QLineEdit.LeadingPosition)
        self.search.setFixedWidth(280)
        self.search.returnPressed.connect(self._search)
        self.grid_btn = self._toggle("grid", "Grid")
        self.list_btn = self._toggle("list", "List")
        self.grid_btn.clicked.connect(lambda: self.set_view("grid"))
        self.list_btn.clicked.connect(lambda: self.set_view("list"))
        refresh = QPushButton()
        refresh.setObjectName("iconButton")
        refresh.setIcon(theme.icon("refresh", palette.text, 18))
        refresh.setToolTip("Refresh (F5)")
        refresh.clicked.connect(self.reload)
        header = QHBoxLayout()
        header.addWidget(self.back)
        header.addLayout(self.crumbs)
        header.addStretch()
        header.addWidget(self.search)
        header.addSpacing(8)
        header.addWidget(self.grid_btn)
        header.addWidget(self.list_btn)
        header.addWidget(refresh)

        # The grid
        self.grid = QListWidget()
        self.grid.setViewMode(QListView.IconMode)
        self.grid.setIconSize(QSize(TILE, TILE))
        self.grid.setGridSize(QSize(TILE + 46, TILE + 54))
        self.grid.setResizeMode(QListView.Adjust)
        self.grid.setMovement(QListView.Static)
        self.grid.setWordWrap(True)
        self.grid.setUniformItemSizes(True)
        self.grid.setSelectionMode(QAbstractItemView.ExtendedSelection)
        self.grid.setTextElideMode(Qt.ElideMiddle)
        self.grid.itemActivated.connect(lambda it: self._activate(it.data(Qt.UserRole)))
        self.grid.setContextMenuPolicy(Qt.CustomContextMenu)
        self.grid.customContextMenuRequested.connect(lambda pos: self._menu(self.grid, pos))

        # The list
        self.table = QTreeWidget()
        self.table.setHeaderLabels(["Name", "Modified", "Size"])
        self.table.setRootIsDecorated(False)
        self.table.setSortingEnabled(True)
        self.table.setUniformRowHeights(True)
        self.table.setIconSize(QSize(22, 22))
        self.table.setSelectionMode(QAbstractItemView.ExtendedSelection)
        self.table.header().setSectionResizeMode(0, QHeaderView.Stretch)
        self.table.header().setSectionResizeMode(1, QHeaderView.ResizeToContents)
        self.table.header().setSectionResizeMode(2, QHeaderView.ResizeToContents)
        self.table.itemActivated.connect(lambda it, _c: self._activate(it.data(0, Qt.UserRole)))
        self.table.setContextMenuPolicy(Qt.CustomContextMenu)
        self.table.customContextMenuRequested.connect(lambda pos: self._menu(self.table, pos))

        self.message = QLabel()
        self.message.setObjectName("empty")
        self.message.setAlignment(Qt.AlignCenter)
        self.stack = QStackedWidget()
        for w in (self.grid, self.table, self.message):
            self.stack.addWidget(w)

        box = QVBoxLayout(self)
        box.setContentsMargins(20, 14, 20, 12)
        box.addLayout(header)
        box.addSpacing(8)
        box.addWidget(self.stack)

        self.view = view
        self.set_view(view, reload=False)
        self.thumbs.signals.loaded.connect(self._thumb_loaded)
        self.empty_btn = QPushButton("Empty trash")
        self.empty_btn.clicked.connect(lambda: self.action.emit("empty-trash", []))
        self.empty_btn.hide()
        header.insertWidget(3, self.empty_btn)  # after the stretch, before search
        for keys, slot in ((Qt.Key_F2, lambda: self._key_action("rename")), (QKeySequence.Delete, lambda: self._key_action("trash")),
                           (QKeySequence.Back, self.go_back), (Qt.Key_Backspace, self.go_back),
                           (QKeySequence.Refresh, self.reload), (QKeySequence.Find, self.search.setFocus)):
            QShortcut(QKeySequence(keys), self, activated=slot)

    def _toggle(self, ico: str, tip: str) -> QPushButton:
        b = QPushButton()
        b.setObjectName("iconButton")
        b.setCheckable(True)
        b.setIcon(theme.icon(ico, self.p.text, 18))
        b.setToolTip(tip)
        return b

    # ── Where you are ──
    def go(self, loc: Location, remember: bool = True) -> None:
        if remember and self.loc != loc:
            self.history.append(self.loc)
            del self.history[:-50]
        self.loc = loc
        self.back.setEnabled(bool(self.history))
        if loc.kind != "search":
            self.search.clear()
        self.empty_btn.setVisible(loc.kind == "trash")
        self._show_crumbs()
        self.location_changed.emit(loc)
        self.reload()

    def go_back(self) -> None:
        if self.history:
            self.go(self.history.pop(), remember=False)
            self.back.setEnabled(bool(self.history))

    def _show_crumbs(self) -> None:
        while self.crumbs.count():
            w = self.crumbs.takeAt(0).widget()
            if w:
                w.deleteLater()
        loc = self.loc
        if loc.kind == "folder":
            segs = [s for s in loc.path.split("/") if s]
            trail = [(seg, "/" + "/".join(segs[:i + 1])) for i, seg in enumerate(segs)]
            trail = [("Home" if p == "/Home" else n, p) for n, p in trail]
            for i, (name, path) in enumerate(trail):
                self._crumb(name, i == len(trail) - 1, lambda _=False, p=path: self.go(Location("folder", p)))
        elif loc.kind == "share":
            self._crumb("Shared with me", False, lambda: self.go(Location("shared")))
            parts = [s for s in loc.path.split("/") if s]
            self._crumb(loc.share_name, not parts, lambda: self.go(Location("share", "", share_id=loc.share_id, share_name=loc.share_name)))
            for i, seg in enumerate(parts):
                sub = "/".join(parts[:i + 1])
                self._crumb(seg, i == len(parts) - 1, lambda _=False, s=sub: self.go(
                    Location("share", s, share_id=loc.share_id, share_name=loc.share_name)))
        elif loc.kind == "search":
            self._crumb(f"Results for “{loc.query}”", True, None)
        else:
            self._crumb(TITLES.get(loc.kind, loc.kind), True, None)

    def _crumb(self, text: str, last: bool, on_click) -> None:
        if self.crumbs.count():
            arrow = QLabel()
            arrow.setPixmap(theme.icon("chevron-right", self.p.muted, 16).pixmap(16, 16))
            self.crumbs.addWidget(arrow)
        b = QPushButton(text)
        b.setObjectName("crumbLast" if last else "crumb")
        b.setFlat(True)
        if on_click and not last:
            b.setCursor(Qt.PointingHandCursor)
            b.clicked.connect(on_click)
        self.crumbs.addWidget(b)

    def _search(self) -> None:
        q = self.search.text().strip()
        if q:
            self.go(Location("search", query=q))

    # ── Loading ──
    def reload(self) -> None:
        self.generation += 1
        gen = self.generation
        self.thumbs.clear_queue()
        self._show_message("Loading…")
        loc = self.loc

        def load():
            if loc.kind == "shared":
                return [from_share(s.get("item") or {}, s.get("share_id", ""), "", (s.get("owner") or {}).get("name", ""))
                        for s in self.api.shared_with_me()]
            if loc.kind == "share":
                body = self.api.browse_share(loc.share_id, loc.path)
                return [from_share(d, loc.share_id, loc.path) for d in body.get("items") or []]
            if loc.kind == "recent":
                body = self.api.list_files("all", 1, 100, "date", "desc")
                return [i for i in map(from_listing, body.get("files") or []) if not i.is_folder]
            if loc.kind == "photos":
                body = self.api.list_files("all", 1, 300, "taken", "desc", kind="media")
                return list(map(from_listing, body.get("files") or []))
            path = {"starred": "starred", "trash": "trash"}.get(loc.kind, loc.path if loc.kind == "folder" else "/Home")
            found, page = [], 1
            while True:
                body = self.api.list_files(path, page, 500, "name", "asc", q=loc.query or None)
                found += map(from_listing, body.get("files") or [])
                if page >= ((body.get("pagination") or {}).get("total_pages") or 1) or page >= 20:
                    return found
                page += 1

        def shown(items):
            if gen == self.generation:
                folders = [i for i in items if i.is_folder]
                files = [i for i in items if not i.is_folder]
                self._fill(folders + files if loc.kind in ("folder", "starred", "trash", "search", "share", "shared") else items)

        def failed(e):
            if gen == self.generation:
                self._show_message(f"Couldn't load this.\n{e}")

        self.runner.run(load, shown, failed)

    def _show_message(self, text: str) -> None:
        self.message.setText(text)
        self.stack.setCurrentWidget(self.message)

    def _key(self, item: Item) -> str:
        return f"{item.share_id or ''}:{item.id}:{item.thumbnail or ''}"

    def _picture(self, item: Item, size: int) -> QPixmap:
        url = None if item.is_folder else self.api.thumbnail_url(item)
        if url:
            image = self.thumbs.get(self._key(item), url)
            if image is not None:
                return _rounded(image, size)
        return theme.tile(item.kind, size, self.p.card)

    def _fill(self, items: List[Item]) -> None:
        self.items = items
        self.by_key = {}
        self.grid.clear()
        self.table.clear()
        self.table.setSortingEnabled(False)
        if not items:
            self._show_message(EMPTY.get(self.loc.kind, ""))
            return
        for item in items:
            gi = QListWidgetItem(QIcon(self._picture(item, TILE)), item.name)
            gi.setData(Qt.UserRole, item)
            gi.setToolTip(self._tooltip(item))
            gi.setTextAlignment(Qt.AlignHCenter | Qt.AlignTop)
            self.grid.addItem(gi)
            ti = _SortItem([item.name, _when(item.modified), "" if item.is_folder else size_text(item.size)])
            ti.setData(0, Qt.UserRole, item)
            ti.setData(2, Qt.UserRole, -1 if item.is_folder else item.size)
            ti.setData(1, Qt.UserRole, item.modified)
            ti.setIcon(0, theme.icon({"folder": "folder", "video": "video", "photo": "image", "audio": "audio"}.get(item.kind, "file"),
                                     theme.KIND_COLORS.get(item.kind, self.p.muted), 22, fill=item.is_folder))
            self.table.addTopLevelItem(ti)
            self.by_key.setdefault(self._key(item), []).append(gi)
        self.table.setSortingEnabled(True)
        if self.loc.kind in ("recent", "photos"):
            self.table.sortItems(1, Qt.DescendingOrder)
        else:
            self.table.sortItems(0, Qt.AscendingOrder)
        self.stack.setCurrentWidget(self.grid if self.view == "grid" else self.table)

    def _tooltip(self, item: Item) -> str:
        bits = [item.name]
        if not item.is_folder:
            bits.append(size_text(item.size))
        if item.modified:
            bits.append(_when(item.modified))
        if item.owner:
            bits.append(f"Shared by {item.owner}")
        return "\n".join(b for b in bits if b)

    def _thumb_loaded(self, key: str, image: QImage) -> None:
        if image.isNull():
            return
        for gi in self.by_key.get(key, []):
            try:
                gi.setIcon(QIcon(_rounded(image, TILE)))
            except RuntimeError:
                pass  # the folder changed meanwhile

    def set_view(self, view: str, reload: bool = False) -> None:
        self.view = view
        self.grid_btn.setChecked(view == "grid")
        self.list_btn.setChecked(view == "list")
        if self.stack.currentWidget() in (self.grid, self.table):
            self.stack.setCurrentWidget(self.grid if view == "grid" else self.table)

    # ── Using items ──
    def selected(self) -> List[Item]:
        if self.view == "grid":
            return [i.data(Qt.UserRole) for i in self.grid.selectedItems()]
        return [i.data(0, Qt.UserRole) for i in self.table.selectedItems()]

    def _activate(self, item: Optional[Item]) -> None:
        if not item:
            return
        if item.is_folder:
            if item.share_id:
                sub = (f"{item.share_path.strip('/')}/{item.name}".strip("/")) if self.loc.kind == "share" else ""
                name = self.loc.share_name if self.loc.kind == "share" else item.name
                self.go(Location("share", sub, share_id=item.share_id, share_name=name))
            elif self.loc.kind != "trash":
                self.go(Location("folder", item.full_path))
            return
        self.open_item.emit(item, [i for i in self.items if not i.is_folder])

    def _menu(self, view, pos) -> None:
        items = self.selected()
        if not items:
            return
        menu = QMenu(self)
        first = items[0]
        own = not any(i.share_id for i in items)
        files = [i for i in items if not i.is_folder]

        def add(ico, text, fn, shortcut=None):
            a = menu.addAction(theme.icon(ico, self.p.text, 16), text, fn)
            if shortcut:
                a.setShortcut(QKeySequence(shortcut))
            return a

        if self.loc.kind == "trash":
            add("refresh", "Restore", lambda: self.action.emit("restore", items))
            menu.addSeparator()
            add("trash", "Delete forever", lambda: self.action.emit("delete", items))
        else:
            if len(items) == 1:
                add("external", "Open", lambda: self._activate(first))
            if files:
                add("download", "Download…" if len(files) == 1 else f"Download {len(files)} files…",
                    lambda: [self.download_item.emit(i) for i in files])
            if own:
                menu.addSeparator()
                if len(items) == 1:
                    add("settings", "Rename", lambda: self.action.emit("rename", items), "F2")
                add("folder-up", "Move to…", lambda: self.action.emit("move", items))
                starred = all(i.starred for i in items)
                add("star", "Remove from Starred" if starred else "Add to Starred",
                    lambda: self.action.emit("unstar" if starred else "star", items))
                if len(items) == 1:
                    add("users", "Share…", lambda: self.action.emit("share", items))
                menu.addSeparator()
                add("trash", "Move to Trash", lambda: self.action.emit("trash", items), "Del")
        if menu.actions():
            menu.exec(view.viewport().mapToGlobal(pos))

    def _key_action(self, name: str) -> None:
        items = self.selected()
        if not items or any(i.share_id for i in items):
            return
        if self.loc.kind == "trash":
            if name == "trash":
                self.action.emit("delete", items)
        elif name != "rename" or len(items) == 1:
            self.action.emit(name, items)

    # ── Dropping files to upload here ──
    def dragEnterEvent(self, event) -> None:
        if event.mimeData().hasUrls():
            event.acceptProposedAction()

    def dragMoveEvent(self, event) -> None:
        if event.mimeData().hasUrls():
            event.acceptProposedAction()

    def dropEvent(self, event) -> None:
        self.files_dropped.emit([u.toLocalFile() for u in event.mimeData().urls() if u.isLocalFile()])


class _SortItem(QTreeWidgetItem):
    """Sorts size and date by value, and keeps folders first."""

    def __lt__(self, other) -> bool:
        col = self.treeWidget().sortColumn() if self.treeWidget() else 0
        a, b = self.data(0, Qt.UserRole), other.data(0, Qt.UserRole)
        if a and b and a.is_folder != b.is_folder:
            ascending = self.treeWidget().header().sortIndicatorOrder() == Qt.AscendingOrder
            return a.is_folder if ascending else b.is_folder
        if col in (1, 2):
            return (self.data(col, Qt.UserRole) or 0) < (other.data(col, Qt.UserRole) or 0) if col == 2 else \
                str(self.data(col, Qt.UserRole) or "") < str(other.data(col, Qt.UserRole) or "")
        return self.text(0).lower() < other.text(0).lower()
