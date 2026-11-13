"""Photos, as on the website and in the Android app: the phone backup's photos and videos
(/Home/Phone Backup), newest first, grouped by the day they were taken under month titles, loading
more as you scroll. Albums are the folders inside the backup; Favourites are starred photos and
videos; Archive is what was archived on the phone or the website.

The timeline is one widget that draws only what's on screen, so thousands of photos scroll smoothly.
"""

from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import List, Optional

from PySide6.QtCore import QPoint, QRect, QRectF, QSize, Qt, QTimer, Signal
from PySide6.QtGui import QColor, QFont, QPainter, QPainterPath, QPen
from PySide6.QtWidgets import (QButtonGroup, QFrame, QHBoxLayout, QLabel, QListView, QListWidget, QListWidgetItem,
                               QMenu, QPushButton, QScrollArea, QStackedWidget, QVBoxLayout, QWidget)

from telestore_desktop.items import Item, from_listing
from telestore_desktop.ui import theme
from telestore_desktop.ui.pages import Page, page_header

PHOTOS_FOLDER = "/Home/Phone Backup"
PAGE_SIZE = 200
GAP = 4


# ── Dates (the same words as the website's timeline.js) ──
def when(item: Item) -> Optional[datetime]:
    """When it was taken, else when it was changed, in this PC's time."""
    for value in (item.taken_at, item.modified):
        if not value:
            continue
        try:
            d = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except ValueError:
            continue
        return d.astimezone().replace(tzinfo=None) if d.tzinfo else d
    return None


def day_label(d: Optional[datetime], today: Optional[date] = None) -> str:
    """ "Today", "Yesterday", "Thu, Oct 29", or "Thu, Jan 2, 2025" in another year."""
    if d is None:
        return "Undated"
    today = today or date.today()
    if d.date() == today:
        return "Today"
    if d.date() == today - timedelta(days=1):
        return "Yesterday"
    text = f"{d:%a}, {d:%b} {d.day}"
    return text if d.year == today.year else f"{text}, {d.year}"


def month_label(d: Optional[datetime], today: Optional[date] = None) -> str:
    today = today or date.today()
    if d is None:
        return "Undated"
    return f"{d:%B}" if d.year == today.year else f"{d:%B} {d.year}"


@dataclass
class Group:
    key: str
    date: Optional[datetime]
    label: str
    items: List[Item]


def group_by_day(items: List[Item], today: Optional[date] = None) -> List[Group]:
    """Days in the order the items come (newest first from the server)."""
    groups = {}
    for item in items:
        d = when(item)
        key = d.strftime("%Y-%m-%d") if d else "undated"
        if key not in groups:
            groups[key] = Group(key, d, day_label(d, today), [])
        groups[key].items.append(item)
    return list(groups.values())


def group_by_month(items: List[Item], today: Optional[date] = None) -> List[Group]:
    groups = {}
    for item in items:
        d = when(item)
        key = d.strftime("%Y-%m") if d else "undated"
        if key not in groups:
            groups[key] = Group(key, d, month_label(d, today), [])
        groups[key].items.append(item)
    return list(groups.values())


def month_title(previous: Optional[datetime], d: Optional[datetime], today: Optional[date] = None) -> str:
    """The big month title above the first day of each month (not for this month, as on the website)."""
    today = today or date.today()
    if d is None:
        return ""
    if previous is not None and previous.year == d.year and previous.month == d.month:
        return ""
    if d.year == today.year and d.month == today.month:
        return ""
    return month_label(d, today)


def clock(seconds: float) -> str:
    s = int(seconds or 0)
    return f"{s // 3600}:{s // 60 % 60:02d}:{s % 60:02d}" if s >= 3600 else f"{s // 60}:{s % 60:02d}"


# ── The timeline ──
@dataclass
class Row:
    kind: str  # month, day, tiles
    y: int
    height: int
    text: str = ""
    items: Optional[List[Item]] = None


class Timeline(QWidget):
    """Month titles, day headings and square tiles; click selects (Ctrl / Shift add), double-click opens."""

    open_item = Signal(object, list)
    context = Signal(list, QPoint)
    near_end = Signal()

    def __init__(self, api, thumbs, palette):
        super().__init__()
        self.api, self.thumbs, self.p = api, thumbs, palette
        self.items: List[Item] = []
        self.layout_kind = "day"
        self.rows: List[Row] = []
        self.tile = 160
        self.selected = set()
        self.anchor: Optional[int] = None
        self.hover: Optional[str] = None
        self.index = {}
        self.setMouseTracking(True)
        self.setFocusPolicy(Qt.StrongFocus)
        self.thumbs.signals.loaded.connect(self._loaded)
        self._width = 0
        self._scaled = {}  # (key, size) -> the tile's picture, cropped and scaled once

    def set_items(self, items: List[Item], keep_selection: bool = False) -> None:
        self.items = items
        self.index = {self._key(i): n for n, i in enumerate(items)}
        if not keep_selection:
            self.selected = set()
        self.relayout()

    def set_layout(self, kind: str) -> None:
        self.layout_kind = kind
        self.relayout()

    def _key(self, item: Item) -> str:
        return f"p:{item.id}:{item.thumbnail or ''}"

    def relayout(self) -> None:
        width = max(300, self.width() or self._width or 900)
        self._width = width
        small = self.layout_kind == "month"
        columns = max(5, width // 110) if small else max(3, width // 190)
        self.tile = (width - GAP * (columns - 1)) // columns
        rows, y = [], 0
        if small:
            for group in group_by_month(self.items):
                rows.append(Row("month", y, 44, group.label))
                y += 44
                for n in range(0, len(group.items), columns):
                    rows.append(Row("tiles", y, self.tile + GAP, items=group.items[n:n + columns]))
                    y += self.tile + GAP
        else:
            previous = None
            for group in group_by_day(self.items):
                title = month_title(previous, group.date)
                if title:
                    rows.append(Row("month", y, 56, title))
                    y += 56
                rows.append(Row("day", y, 40, group.label))
                y += 40
                for n in range(0, len(group.items), columns):
                    rows.append(Row("tiles", y, self.tile + GAP, items=group.items[n:n + columns]))
                    y += self.tile + GAP
                if group.date:
                    previous = group.date
        self.rows = rows
        self.setMinimumHeight(y + 24)
        self.update()

    def resizeEvent(self, event) -> None:
        if event.size().width() != event.oldSize().width():
            self.relayout()
        super().resizeEvent(event)

    def _tiles(self):
        """(rect, item) for every tile."""
        for row in self.rows:
            if row.kind == "tiles":
                for n, item in enumerate(row.items):
                    yield QRect(n * (self.tile + GAP), row.y, self.tile, self.tile), item

    def item_at(self, pos: QPoint) -> Optional[Item]:
        for row in self.rows:
            if row.kind == "tiles" and row.y <= pos.y() < row.y + row.height:
                n = pos.x() // (self.tile + GAP)
                if 0 <= n < len(row.items) and pos.x() - n * (self.tile + GAP) < self.tile:
                    return row.items[n]
        return None

    def paintEvent(self, event) -> None:
        painter = QPainter(self)
        painter.setRenderHint(QPainter.Antialiasing)
        painter.setRenderHint(QPainter.SmoothPixmapTransform)
        area = event.rect()
        painter.fillRect(area, QColor(self.p.background))
        title_font = QFont(self.font())
        title_font.setPointSizeF(self.font().pointSizeF() * 1.6)
        title_font.setWeight(QFont.DemiBold)
        day_font = QFont(self.font())
        day_font.setWeight(QFont.DemiBold)
        badge_font = QFont(self.font())
        badge_font.setPointSizeF(max(7.0, self.font().pointSizeF() * 0.85))
        badge_font.setWeight(QFont.DemiBold)
        for row in self.rows:
            if row.y > area.bottom() or row.y + row.height < area.top():
                continue
            if row.kind in ("month", "day"):
                painter.setFont(title_font if row.kind == "month" and self.layout_kind == "day" else day_font)
                painter.setPen(QColor(self.p.text))
                painter.drawText(QRect(2, row.y, self.width(), row.height - 8), Qt.AlignLeft | Qt.AlignBottom, row.text)
                continue
            for n, item in enumerate(row.items):
                rect = QRect(n * (self.tile + GAP), row.y, self.tile, self.tile)
                self._paint_tile(painter, rect, item, badge_font)
        painter.end()
        self._want_thumbs(area)

    def _paint_tile(self, painter: QPainter, rect: QRect, item: Item, badge_font: QFont) -> None:
        key = self._key(item)
        url = self.api.thumbnail_url(item)
        picture = self._picture(key) if url else None
        clip = QPainterPath()
        clip.addRoundedRect(QRectF(rect), 6, 6)
        painter.save()
        painter.setClipPath(clip)
        if picture is not None:
            painter.drawImage(QRectF(rect), picture)
        else:
            painter.fillRect(rect, QColor(self.p.card))
            glyph = theme.icon("video" if item.kind == "video" else "image", theme.KIND_COLORS.get(item.kind, self.p.muted), 32)
            painter.drawPixmap(rect.center().x() - 16, rect.center().y() - 16, glyph.pixmap(32, 32))
        if item.kind == "video":
            text = f"▶ {clock(item.duration)}" if item.duration else "▶"
            painter.setFont(badge_font)
            w = painter.fontMetrics().horizontalAdvance(text) + 12
            badge = QRect(rect.right() - w - 6, rect.top() + 6, w, 20)
            painter.setPen(Qt.NoPen)
            painter.setBrush(QColor(0, 0, 0, 150))
            painter.drawRoundedRect(QRectF(badge), 10, 10)
            painter.setPen(QColor("#ffffff"))
            painter.drawText(badge, Qt.AlignCenter, text)
        if item.starred:
            painter.drawPixmap(rect.left() + 6, rect.bottom() - 24, theme.icon("star", "#ffffff", 18, fill=True).pixmap(18, 18))
        selected = key in self.selected
        if selected or self.hover == key:
            painter.setBrush(QColor(0, 0, 0, 60) if not selected else QColor(self.p.primary).lighter(100))
            if selected:
                tint = QColor(self.p.primary)
                tint.setAlpha(70)
                painter.setBrush(tint)
            painter.setPen(Qt.NoPen)
            painter.drawRect(rect)
        painter.restore()
        if selected:
            painter.setPen(QPen(QColor(self.p.primary), 3))
            painter.setBrush(Qt.NoBrush)
            painter.drawRoundedRect(QRectF(rect).adjusted(1.5, 1.5, -1.5, -1.5), 6, 6)
            painter.drawPixmap(rect.left() + 6, rect.top() + 6, theme.icon("check-circle", self.p.primary, 22, fill=False).pixmap(22, 22))

    def _picture(self, key: str):
        """The thumbnail cropped to a square of this tile size (made once, then reused)."""
        size = self.tile * 2
        known = self._scaled.get((key, size))
        if known is not None:
            return known
        image = self.thumbs.cached(key)
        if image is None or image.isNull():
            return None
        scaled = image.scaled(size, size, Qt.KeepAspectRatioByExpanding, Qt.SmoothTransformation)
        square = scaled.copy((scaled.width() - size) // 2, (scaled.height() - size) // 2, size, size)
        if len(self._scaled) > 800:
            self._scaled.clear()
        self._scaled[(key, size)] = square
        return square

    def _want_thumbs(self, area: QRect) -> None:
        """Asks for the thumbnails on screen (and a screenful below)."""
        below = area.adjusted(0, -200, 0, area.height() + 400)
        for rect, item in self._tiles():
            if rect.intersects(below):
                url = self.api.thumbnail_url(item)
                if url:
                    self.thumbs.get(self._key(item), url)
        last = self.rows[-1].y if self.rows else 0
        if last and area.bottom() > last - 1500:
            self.near_end.emit()

    def _loaded(self, key: str, _image) -> None:
        if key in self.index:
            self.update()

    # ── Mouse and keys ──
    def mouseMoveEvent(self, event) -> None:
        item = self.item_at(event.position().toPoint())
        key = self._key(item) if item else None
        if key != self.hover:
            self.hover = key
            self.setCursor(Qt.PointingHandCursor if item else Qt.ArrowCursor)
            self.update()

    def leaveEvent(self, event) -> None:
        self.hover = None
        self.update()

    def mousePressEvent(self, event) -> None:
        self.setFocus()
        item = self.item_at(event.position().toPoint())
        if event.button() == Qt.RightButton:
            if item and self._key(item) not in self.selected:
                self.selected = {self._key(item)}
                self.anchor = self.index.get(self._key(item))
                self.update()
            if item:
                self.context.emit(self.chosen(), event.globalPosition().toPoint())
            return
        if not item:
            self.selected = set()
            self.update()
            return
        key, at = self._key(item), self.index.get(self._key(item), 0)
        mods = event.modifiers()
        if mods & Qt.ShiftModifier and self.anchor is not None:
            lo, hi = sorted((self.anchor, at))
            self.selected |= {self._key(i) for i in self.items[lo:hi + 1]}
        elif mods & Qt.ControlModifier or self.selected:
            # Once something is picked, a click adds or removes (as on the website and in the app)
            self.selected ^= {key}
            self.anchor = at
        else:
            self.selected = set()
            self.anchor = at
        self.update()

    def mouseDoubleClickEvent(self, event) -> None:
        item = self.item_at(event.position().toPoint())
        if item:
            self.selected = set()
            self.update()
            self.open_item.emit(item, list(self.items))

    def keyPressEvent(self, event) -> None:
        if event.key() == Qt.Key_Escape and self.selected:
            self.selected = set()
            self.update()
        elif event.key() == Qt.Key_A and event.modifiers() & Qt.ControlModifier:
            self.selected = {self._key(i) for i in self.items}
            self.update()
        else:
            super().keyPressEvent(event)

    def chosen(self) -> List[Item]:
        return [i for i in self.items if self._key(i) in self.selected]


class PhotosPage(Page):
    open_item = Signal(object, list)
    action = Signal(str, list)  # the browser's actions: star, unstar, share, trash, info…
    download = Signal(list)

    def __init__(self, api, runner, thumbs, palette, settings):
        super().__init__()
        self.api, self.runner, self.thumbs, self.p, self.settings = api, runner, thumbs, palette, settings
        self.mode = "all"  # all, albums, album, starred, archive
        self.album = ""
        self.items: List[Item] = []
        self.page = 0
        self.more = True
        self.loading = False
        self.generation = 0

        self.subtitle = QLabel("…")
        self.layout_btn = QPushButton()
        self.layout_btn.setObjectName("iconButton")
        self.layout_btn.setToolTip("Bigger or smaller photos (Day / Month)")
        self.layout_btn.clicked.connect(self.toggle_layout)
        refresh = QPushButton()
        refresh.setObjectName("iconButton")
        refresh.setIcon(theme.icon("refresh", palette.text, 18))
        refresh.setToolTip("Refresh")
        refresh.clicked.connect(lambda: self.load(reset=True))
        header = page_header(palette, "image", "Photos", self.subtitle, [self.layout_btn, refresh])

        chips = QHBoxLayout()
        chips.setSpacing(6)
        self.chip_group = QButtonGroup(self)
        self.chips = {}
        for key, text in (("all", "Photos"), ("albums", "Albums"), ("starred", "Favourites"), ("archive", "Archive")):
            b = QPushButton(text)
            b.setObjectName("chipButton")
            b.setCheckable(True)
            b.setCursor(Qt.PointingHandCursor)
            b.clicked.connect(lambda _=False, k=key: self.switch(k))
            self.chip_group.addButton(b)
            self.chips[key] = b
            chips.addWidget(b)
        self.back_album = QPushButton("  All albums")
        self.back_album.setObjectName("linkButton")
        self.back_album.setIcon(theme.icon("chevron-left", palette.primary, 16))
        self.back_album.clicked.connect(lambda: self.switch("albums"))
        self.back_album.hide()
        chips.addSpacing(10)
        chips.addWidget(self.back_album)
        chips.addStretch()
        self.chips["all"].setChecked(True)

        self.timeline = Timeline(api, thumbs, palette)
        self.timeline.set_layout(settings.photos_layout)
        self.timeline.open_item.connect(self.open_item.emit)
        self.timeline.context.connect(self._menu)
        self.timeline.near_end.connect(self._more)
        self.scroll = QScrollArea()
        self.scroll.setWidgetResizable(True)
        self.scroll.setFrameShape(QFrame.NoFrame)
        self.scroll.setHorizontalScrollBarPolicy(Qt.ScrollBarAlwaysOff)
        self.scroll.setWidget(self.timeline)
        self.scroll.setStyleSheet(f"QScrollArea {{ background: {palette.background}; border: none; }}")
        self.scroll.verticalScrollBar().valueChanged.connect(lambda _v: self.timeline.update())

        self.albums = QListWidget()
        self.albums.setViewMode(QListView.IconMode)
        self.albums.setIconSize(QSize(150, 150))
        self.albums.setGridSize(QSize(176, 200))
        self.albums.setResizeMode(QListView.Adjust)
        self.albums.setMovement(QListView.Static)
        self.albums.setWordWrap(True)
        self.albums.itemActivated.connect(lambda it: self.open_album(it.data(Qt.UserRole)))
        self.message = QLabel()
        self.message.setObjectName("empty")
        self.message.setAlignment(Qt.AlignCenter)
        self.stack = QStackedWidget()
        for w in (self.scroll, self.albums, self.message):
            self.stack.addWidget(w)

        box = QVBoxLayout(self)
        box.setContentsMargins(24, 18, 24, 12)
        box.setSpacing(12)
        box.addLayout(header)
        box.addLayout(chips)
        box.addWidget(self.stack, 1)
        self._layout_icon()
        self.loaded_once = False

    def shown(self) -> None:
        if not self.loaded_once:
            self.loaded_once = True
            self.load(reset=True)

    def _layout_icon(self) -> None:
        self.layout_btn.setIcon(theme.icon("grid" if self.timeline.layout_kind == "day" else "image", self.p.text, 18))

    def toggle_layout(self) -> None:
        kind = "month" if self.timeline.layout_kind == "day" else "day"
        self.timeline.set_layout(kind)
        self.settings.photos_layout = kind
        self.settings.save()
        self._layout_icon()

    def switch(self, mode: str) -> None:
        self.mode = mode
        self.chips["albums" if mode == "album" else mode].setChecked(True)
        self.back_album.setVisible(mode == "album")
        if mode == "albums":
            self.load_albums()
        else:
            self.load(reset=True)

    def open_album(self, name: str) -> None:
        self.album = name
        self.switch("album")

    def _message(self, text: str) -> None:
        self.message.setText(text)
        self.stack.setCurrentWidget(self.message)

    # ── Loading ──
    def _fetch(self, page: int):
        if self.mode == "archive":
            body = self.api.list_files("archive", page, PAGE_SIZE, "date", "desc")
        elif self.mode == "starred":
            body = self.api.list_files("starred", page, 500, "date", "desc")
            body["files"] = [f for f in body.get("files") or [] if from_listing(f).kind in ("photo", "video")]
        else:
            under = f"{PHOTOS_FOLDER}/{self.album}" if self.mode == "album" else PHOTOS_FOLDER
            body = self.api.media(under, page, PAGE_SIZE)
        files = [from_listing(f) for f in body.get("files") or [] if f.get("file_type") != "folder"]
        pagination = body.get("pagination") or {}
        more = bool(pagination.get("has_next")) if "has_next" in pagination else page < int(pagination.get("total_pages") or 1)
        return files, more, int(pagination.get("total_items") or pagination.get("total") or 0)

    def load(self, reset: bool = False) -> None:
        if reset:
            self.generation += 1
            self.items, self.page, self.more = [], 0, True
            self.loading = False
            self.thumbs.clear_queue()
            self._message("Loading…")
        if self.loading or not self.more:
            return
        self.loading = True
        gen, page = self.generation, self.page + 1

        def shown(result):
            if gen != self.generation:
                return
            files, more, total = result
            self.loading = False
            self.page, self.more = page, more
            self.items += files
            self._show(total)

        def failed(e):
            if gen == self.generation:
                self.loading = False
                self._message(f"Couldn't load photos.\n{e}")

        self.runner.run(lambda: self._fetch(page), shown, failed)

    def _more(self) -> None:
        if self.mode not in ("albums",) and self.more and not self.loading:
            QTimer.singleShot(0, self.load)

    def _show(self, total: int) -> None:
        if not self.items:
            self._message({"archive": "Nothing in the Archive.", "starred": "No favourite photos or videos yet.\nStar some to see them here.",
                           "album": "This album is empty."}.get(self.mode, "No photos yet.\nPhotos backed up from your phone show up here."))
            self.subtitle.setText("")
            return
        self.timeline.set_items(self.items, keep_selection=True)
        self.stack.setCurrentWidget(self.scroll)
        n = total or len(self.items)
        where = {"archive": "in the Archive", "starred": "starred", "album": f"in {self.album}"}.get(self.mode, "")
        self.subtitle.setText(f"{n:,}{'+' if self.more and not total else ''} photos and videos {where}".strip())

    def load_albums(self) -> None:
        self._message("Loading…")
        self.subtitle.setText("Folders in Phone Backup")

        def fetch():
            body = self.api.list_files(PHOTOS_FOLDER, 1, 500, "name", "asc")
            return [f.get("file_name") for f in body.get("files") or [] if f.get("file_type") == "folder"]

        def shown(names):
            self.albums.clear()
            if not names:
                self._message("No albums yet.\nFolders inside Phone Backup show up here.")
                return
            for name in names:
                it = QListWidgetItem(theme.icon("folder", theme.KIND_COLORS["folder"], 150, fill=True), name)
                it.setData(Qt.UserRole, name)
                self.albums.addItem(it)
                self._cover(it, name)
            self.stack.setCurrentWidget(self.albums)
            self.subtitle.setText(f"{len(names)} album{'s' if len(names) != 1 else ''}")

        self.runner.run(fetch, shown, lambda e: self._message(f"Couldn't load albums.\n{e}"))

    def _cover(self, it: QListWidgetItem, name: str) -> None:
        """The album's newest photo as its cover."""
        def fetch():
            files = self.api.media(f"{PHOTOS_FOLDER}/{name}", 1, 1).get("files") or []
            if not files:
                return None
            item = from_listing(files[0])
            url = self.api.thumbnail_url(item)
            return self.api.fetch(url) if url else None

        def shown(data):
            if not data:
                return
            from PySide6.QtGui import QIcon, QImage
            from telestore_desktop.ui.browser import _rounded
            image = QImage()
            image.loadFromData(data)
            if not image.isNull():
                try:
                    it.setIcon(QIcon(_rounded(image, 150)))
                except RuntimeError:
                    pass

        self.runner.run(fetch, shown, lambda e: None)

    # ── Right-click ──
    def _menu(self, items: List[Item], where: QPoint) -> None:
        if not items:
            return
        menu = QMenu(self)
        n = len(items)
        if n == 1:
            menu.addAction(theme.icon("external", self.p.text, 16), "Open", lambda: self.open_item.emit(items[0], list(self.timeline.items)))
        menu.addAction(theme.icon("download", self.p.text, 16), "Download" if n == 1 else f"Download {n} items",
                       lambda: self.download.emit(items))
        menu.addSeparator()
        starred = all(i.starred for i in items)
        menu.addAction(theme.icon("star", self.p.text, 16), "Remove from Favourites" if starred else "Add to Favourites",
                       lambda: self.action.emit("unstar" if starred else "star", items))
        if n == 1:
            menu.addAction(theme.icon("users", self.p.text, 16), "Share…", lambda: self.action.emit("share", items))
            menu.addAction(theme.icon("info", self.p.text, 16), "Details", lambda: self.action.emit("info", items))
        menu.addSeparator()
        menu.addAction(theme.icon("trash", self.p.text, 16), "Move to Trash", lambda: self.action.emit("trash", items))
        menu.exec(where)

    def reload(self) -> None:
        if self.mode == "albums":
            self.load_albums()
        else:
            self.load(reset=True)
