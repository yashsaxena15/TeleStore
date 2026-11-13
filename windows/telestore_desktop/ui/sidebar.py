"""The sidebar, as on the website: New, the library, Photos, Transfers and Storage, the storage meter
and the account."""

from PySide6.QtCore import QSize, Qt, Signal
from PySide6.QtWidgets import (QButtonGroup, QHBoxLayout, QLabel, QMenu, QProgressBar, QPushButton, QSizePolicy,
                               QToolButton, QVBoxLayout, QWidget)

from telestore_desktop.ui import theme

SECTIONS = [
    ("Library", [("home", "Home", "home"), ("recent", "Recent", "clock"), ("starred", "Starred", "star"),
                 ("shared", "Shared with me", "users"), ("shared-by-me", "Shared by me", "share"), ("trash", "Trash", "trash")]),
    ("Media", [("photos", "Photos", "image")]),
    ("Activity", [("transfers", "Transfers", "transfers"), ("storage", "Storage", "hard-drive")]),
]
PLACES = [p for _title, places in SECTIONS for p in places]
ICONS = {key: ico for key, _text, ico in PLACES}


class _Meter(QWidget):
    """The storage meter; a click opens the Storage page."""

    clicked = Signal()

    def mouseReleaseEvent(self, event) -> None:
        self.clicked.emit()


class Sidebar(QWidget):
    place_chosen = Signal(str)
    new_action = Signal(str)  # upload-files, upload-folder, new-folder
    account_action = Signal(str)  # settings, website, sign-out, updates

    def __init__(self, palette, username: str):
        super().__init__()
        self.setObjectName("sidebar")
        self.setFixedWidth(240)
        self.p = palette
        box = QVBoxLayout(self)
        box.setContentsMargins(12, 14, 12, 12)
        box.setSpacing(2)

        logo = QLabel()
        logo.setPixmap(theme.app_icon().pixmap(26, 26))
        brand = QLabel("TeleStore")
        brand.setObjectName("brand")
        top = QHBoxLayout()
        top.setSpacing(8)
        top.addWidget(logo)
        top.addWidget(brand)
        top.addStretch()
        box.addLayout(top)
        box.addSpacing(12)

        self.new_button = QToolButton()
        self.new_button.setObjectName("newButton")
        self.new_button.setText("  New")
        self.new_button.setIcon(theme.icon("plus", palette.primary_text, 18))
        self.new_button.setIconSize(QSize(18, 18))
        self.new_button.setToolButtonStyle(Qt.ToolButtonTextBesideIcon)
        self.new_button.setPopupMode(QToolButton.InstantPopup)
        self.new_button.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Fixed)
        menu = QMenu(self.new_button)
        for key, text, ico in (("upload-files", "Upload files", "upload"), ("upload-folder", "Upload folder", "folder-up"),
                               (None, None, None), ("new-folder", "New folder", "folder-plus")):
            if key is None:
                menu.addSeparator()
                continue
            action = menu.addAction(theme.icon(ico, palette.text, 18), text)
            action.triggered.connect(lambda _=False, k=key: self.new_action.emit(k))
        self.new_button.setMenu(menu)
        box.addWidget(self.new_button)

        self.group = QButtonGroup(self)
        self.group.setExclusive(True)
        self.buttons = {}
        self.badges = {}
        for title, places in SECTIONS:
            label = QLabel(title.upper())
            label.setObjectName("sectionLabel")
            box.addSpacing(10)
            box.addWidget(label)
            box.addSpacing(2)
            for key, text, ico in places:
                b = QPushButton(f"  {text}")
                b.setObjectName("navButton")
                b.setCheckable(True)
                b.setIcon(theme.icon(ico, palette.muted, 18))
                b.setIconSize(QSize(18, 18))
                b.setCursor(Qt.PointingHandCursor)
                b.clicked.connect(lambda _=False, k=key: self.place_chosen.emit(k))
                self.group.addButton(b)
                self.buttons[key] = b
                if key == "transfers":
                    badge = QLabel(b)
                    badge.setObjectName("navBadge")
                    badge.hide()
                    self.badges[key] = badge
                box.addWidget(b)
        box.addStretch()

        meter = _Meter()
        meter.setCursor(Qt.PointingHandCursor)
        meter.setToolTip("Open Storage")
        meter.clicked.connect(lambda: self.place_chosen.emit("storage"))
        m = QVBoxLayout(meter)
        m.setContentsMargins(4, 4, 4, 4)
        m.setSpacing(6)
        storage_label = QLabel("Storage")
        storage_label.setObjectName("sectionLabel")
        self.storage_bar = QProgressBar()
        self.storage_bar.setObjectName("storageBar")
        self.storage_bar.setTextVisible(False)
        self.storage_bar.setRange(0, 1000)
        self.storage_text = QLabel("…")
        self.storage_text.setObjectName("muted")
        self.storage_text.setWordWrap(True)
        m.addWidget(storage_label)
        m.addWidget(self.storage_bar)
        m.addWidget(self.storage_text)
        box.addWidget(meter)
        box.addSpacing(8)

        account = QToolButton()
        account.setObjectName("navButton")
        account.setText(f"  {username or 'Account'}")
        account.setIcon(theme.icon("users", palette.muted, 18))
        account.setToolButtonStyle(Qt.ToolButtonTextBesideIcon)
        account.setPopupMode(QToolButton.InstantPopup)
        account.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Fixed)
        account_menu = QMenu(account)
        for key, text, ico in (("settings", "Settings", "settings"), ("updates", "Check for updates", "update"),
                               ("website", "Open the website", "external"), (None, None, None),
                               ("sign-out", "Sign out", "logout")):
            if key is None:
                account_menu.addSeparator()
                continue
            action = account_menu.addAction(theme.icon(ico, palette.text, 18), text)
            action.triggered.connect(lambda _=False, k=key: self.account_action.emit(k))
        account.setMenu(account_menu)
        box.addWidget(account)

    def select(self, key: str) -> None:
        b = self.buttons.get(key)
        if b:
            b.setChecked(True)
        else:  # a place without a button (a search): nothing looks chosen
            self.group.setExclusive(False)
            for btn in self.buttons.values():
                btn.setChecked(False)
            self.group.setExclusive(True)
        for k, btn in self.buttons.items():
            btn.setIcon(theme.icon(ICONS[k], self.p.primary if k == key else self.p.muted, 18))

    def set_badge(self, key: str, count: int) -> None:
        badge = self.badges.get(key)
        if not badge:
            return
        badge.setText(str(count) if count < 100 else "99+")
        badge.setVisible(count > 0)
        badge.adjustSize()
        b = self.buttons[key]
        badge.move(b.width() - badge.width() - 10, (b.height() - badge.height()) // 2)

    def set_storage(self, used: int, quota: int, files: int, text: str) -> None:
        self.storage_text.setText(text)
        self.storage_bar.setVisible(bool(quota))
        if quota:
            self.storage_bar.setValue(int(min(1.0, used / quota) * 1000))


