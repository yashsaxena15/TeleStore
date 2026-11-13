"""Notifications, as on the website's bell: something shared with you, transfers that finished or
failed, a file in the Telegram Inbox, storage almost full, a new sign-in. New ones also pop up in
Windows (from the tray icon) when TeleStore isn't the window you're using."""

from datetime import datetime, timezone
from typing import List

from PySide6.QtCore import QObject, QPoint, QRectF, QSize, Qt, QTimer, Signal
from PySide6.QtGui import QColor, QFont, QIcon, QPainter, QPixmap
from PySide6.QtWidgets import (QFrame, QHBoxLayout, QLabel, QPushButton, QScrollArea, QVBoxLayout, QWidget)

from telestore_desktop.ui import theme

POLL_MS = 60_000
KIND_ICONS = {"share": "users", "transfer": "cloud", "media": "video", "playlist_sync": "video", "inbox": "download",
              "storage": "hard-drive", "sign_in": "settings", "archive": "folder"}


def ago(value: str, now: datetime = None) -> str:
    try:
        d = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return ""
    if d.tzinfo is None:
        d = d.replace(tzinfo=timezone.utc)
    seconds = ((now or datetime.now(timezone.utc)) - d).total_seconds()
    if seconds < 60:
        return "just now"
    if seconds < 3600:
        return f"{int(seconds // 60)} min ago"
    if seconds < 86400:
        return f"{int(seconds // 3600)} h ago"
    if seconds < 7 * 86400:
        return f"{int(seconds // 86400)} d ago"
    return d.astimezone().strftime("%d %b %Y")


class NotificationCenter(QObject):
    """Keeps the newest notifications and the unread count, checking the server every minute."""

    changed = Signal()
    arrived = Signal(list)  # new ones since the last check (not the first load)

    def __init__(self, api, runner, interval_ms: int = POLL_MS):
        super().__init__()
        self.api, self.runner = api, runner
        self.items: List[dict] = []
        self.unread = 0
        self.latest = None
        self.loaded = False
        self.busy = False
        self.timer = QTimer(self)
        self.timer.timeout.connect(self.check)
        self.timer.start(interval_ms)

    def check(self) -> None:
        if self.busy:
            return
        self.busy = True
        after = self.latest if self.loaded else None

        def done(body):
            self.busy = False
            self.merge(body or {}, fresh=not self.loaded)

        def failed(_e):
            self.busy = False

        self.runner.run(lambda: self.api.notifications(after=after), done, failed)

    def merge(self, body: dict, fresh: bool) -> None:
        new = body.get("items") or []
        known = {i.get("id") for i in self.items}
        added = [i for i in new if i.get("id") not in known]
        self.items = (added + self.items)[:60] if not fresh else new
        self.unread = int(body.get("unread") or 0)
        if body.get("latest"):
            self.latest = body["latest"]
        was_loaded, self.loaded = self.loaded, True
        self.changed.emit()
        if was_loaded and added:
            self.arrived.emit([i for i in added if not i.get("read")])

    def mark_all_read(self) -> None:
        if not self.unread:
            return
        for i in self.items:
            i["read"] = True
        self.unread = 0
        self.changed.emit()
        self.runner.run(lambda: self.api.mark_notifications_read(), None, lambda e: None)

    def stop(self) -> None:
        self.timer.stop()


def bell_icon(palette, unread: int) -> QIcon:
    """The bell, with a red count when something is unread."""
    base = theme.icon("bell", palette.text, 20)
    if not unread:
        return base
    out = QIcon()
    for scale in (1, 2):
        size = 28 * scale
        pm = QPixmap(size, size)
        pm.fill(Qt.transparent)
        painter = QPainter(pm)
        painter.setRenderHint(QPainter.Antialiasing)
        painter.drawPixmap(4 * scale, 4 * scale, base.pixmap(20, 20).scaled(20 * scale, 20 * scale))
        text = "9+" if unread > 9 else str(unread)
        painter.setBrush(QColor("#ef4444"))
        painter.setPen(Qt.NoPen)
        r = QRectF(size - 15 * scale, 0, 15 * scale, 15 * scale)
        painter.drawEllipse(r)
        font = QFont()
        font.setPixelSize(int(9 * scale))
        font.setBold(True)
        painter.setFont(font)
        painter.setPen(QColor("#ffffff"))
        painter.drawText(r, Qt.AlignCenter, text)
        painter.end()
        pm.setDevicePixelRatio(scale)
        out.addPixmap(pm)
    return out


class _Row(QFrame):
    clicked = Signal(dict)

    def __init__(self, item: dict, palette):
        super().__init__()
        self.item = item
        self.setObjectName("notificationRow" if item.get("read") else "notificationRowNew")
        self.setCursor(Qt.PointingHandCursor)
        ico = QLabel()
        ico.setPixmap(theme.icon(KIND_ICONS.get(item.get("kind") or "", "bell"), palette.primary, 18).pixmap(18, 18))
        ico.setAlignment(Qt.AlignTop)
        title = QLabel(item.get("title") or "")
        title.setWordWrap(True)
        title.setStyleSheet("font-weight: 600;")
        body = QLabel(item.get("body") or "")
        body.setWordWrap(True)
        body.setObjectName("muted")
        body.setVisible(bool(item.get("body")))
        when = QLabel(ago(item.get("created_at")))
        when.setObjectName("muted")
        words = QVBoxLayout()
        words.setSpacing(2)
        words.addWidget(title)
        words.addWidget(body)
        words.addWidget(when)
        row = QHBoxLayout(self)
        row.setContentsMargins(12, 10, 12, 10)
        row.addWidget(ico)
        row.addLayout(words, 1)

    def mouseReleaseEvent(self, event) -> None:
        self.clicked.emit(self.item)


class NotificationsPopup(QFrame):
    """The list under the bell."""

    chosen = Signal(dict)

    def __init__(self, center: NotificationCenter, palette, parent=None):
        super().__init__(parent, Qt.Popup)
        self.center, self.p = center, palette
        self.setObjectName("popup")
        self.setFixedSize(QSize(380, 460))
        title = QLabel("Notifications")
        title.setObjectName("sectionTitle")
        self.read_all = QPushButton("Mark all as read")
        self.read_all.setObjectName("linkButton")
        self.read_all.clicked.connect(center.mark_all_read)
        head = QHBoxLayout()
        head.setContentsMargins(14, 12, 10, 8)
        head.addWidget(title, 1)
        head.addWidget(self.read_all)
        self.list = QWidget()
        self.list.setObjectName("popupList")
        self.box = QVBoxLayout(self.list)
        self.box.setContentsMargins(0, 0, 0, 0)
        self.box.setSpacing(0)
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setFrameShape(QFrame.NoFrame)
        scroll.setHorizontalScrollBarPolicy(Qt.ScrollBarAlwaysOff)
        scroll.setWidget(self.list)
        outer = QVBoxLayout(self)
        outer.setContentsMargins(0, 0, 0, 0)
        outer.setSpacing(0)
        outer.addLayout(head)
        outer.addWidget(scroll, 1)
        center.changed.connect(self.fill)
        self.fill()

    def fill(self) -> None:
        while self.box.count():
            w = self.box.takeAt(0).widget()
            if w:
                w.hide()
                w.deleteLater()
        if not self.center.items:
            empty = QLabel("No notifications yet." if self.center.loaded else "Loading…")
            empty.setObjectName("empty")
            empty.setAlignment(Qt.AlignCenter)
            empty.setMinimumHeight(200)
            self.box.addWidget(empty)
        for item in self.center.items:
            row = _Row(item, self.p)
            row.clicked.connect(self._chosen)
            self.box.addWidget(row)
        self.box.addStretch()
        self.read_all.setEnabled(self.center.unread > 0)

    def _chosen(self, item: dict) -> None:
        self.hide()
        self.chosen.emit(item)

    def open_below(self, anchor: QWidget) -> None:
        self.center.check()
        self.fill()
        at = anchor.mapToGlobal(QPoint(anchor.width() - self.width(), anchor.height() + 4))
        self.move(at)
        self.show()
