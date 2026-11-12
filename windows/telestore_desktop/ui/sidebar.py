"""The sidebar, as on the website: New, the library, storage used and the account."""

from PySide6.QtCore import QSize, Qt, Signal
from PySide6.QtWidgets import (QButtonGroup, QHBoxLayout, QLabel, QMenu, QProgressBar, QPushButton, QSizePolicy, QToolButton,
                               QVBoxLayout, QWidget)

from telestore_desktop.ui import theme

PLACES = [("home", "Home", "home"), ("recent", "Recent", "clock"), ("starred", "Starred", "star"),
          ("shared", "Shared with me", "users"), ("photos", "Photos", "image"), ("trash", "Trash", "trash")]


class Sidebar(QWidget):
    place_chosen = Signal(str)
    new_action = Signal(str)  # upload-files, upload-folder, new-folder
    account_action = Signal(str)  # settings, website, sign-out

    def __init__(self, palette, username: str):
        super().__init__()
        self.setObjectName("sidebar")
        self.setFixedWidth(232)
        self.p = palette
        box = QVBoxLayout(self)
        box.setContentsMargins(12, 14, 12, 12)
        box.setSpacing(4)

        brand = QLabel("TeleStore")
        brand.setObjectName("brand")
        box.addWidget(brand)
        box.addSpacing(10)

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
        box.addSpacing(12)

        self.group = QButtonGroup(self)
        self.group.setExclusive(True)
        self.buttons = {}
        for key, text, ico in PLACES:
            b = QPushButton(f"  {text}")
            b.setObjectName("navButton")
            b.setCheckable(True)
            b.setIcon(theme.icon(ico, palette.muted, 18))
            b.setIconSize(QSize(18, 18))
            b.setCursor(Qt.PointingHandCursor)
            b.clicked.connect(lambda _=False, k=key: self.place_chosen.emit(k))
            self.group.addButton(b)
            self.buttons[key] = b
            box.addWidget(b)
        box.addStretch()

        storage_label = QLabel("Storage")
        storage_label.setObjectName("sectionLabel")
        self.storage_bar = QProgressBar()
        self.storage_bar.setObjectName("storageBar")
        self.storage_bar.setTextVisible(False)
        self.storage_bar.setRange(0, 1000)
        self.storage_text = QLabel("…")
        self.storage_text.setObjectName("muted")
        box.addWidget(storage_label)
        box.addWidget(self.storage_bar)
        box.addWidget(self.storage_text)
        box.addSpacing(10)

        account = QToolButton()
        account.setObjectName("navButton")
        account.setText(f"  {username or 'Account'}")
        account.setIcon(theme.icon("users", palette.muted, 18))
        account.setToolButtonStyle(Qt.ToolButtonTextBesideIcon)
        account.setPopupMode(QToolButton.InstantPopup)
        account_menu = QMenu(account)
        for key, text, ico in (("settings", "Settings", "settings"), ("website", "Open the website", "external"),
                               (None, None, None), ("sign-out", "Sign out", "logout")):
            if key is None:
                account_menu.addSeparator()
                continue
            action = account_menu.addAction(theme.icon(ico, palette.text, 18), text)
            action.triggered.connect(lambda _=False, k=key: self.account_action.emit(k))
        account.setMenu(account_menu)
        row = QHBoxLayout()
        row.addWidget(account)
        row.addStretch()
        box.addLayout(row)

    def select(self, key: str) -> None:
        b = self.buttons.get(key)
        if b:
            b.setChecked(True)
        for k, btn in self.buttons.items():
            ico = dict((p[0], p[2]) for p in PLACES)[k]
            btn.setIcon(theme.icon(ico, self.p.primary if k == key else self.p.muted, 18))

    def set_storage(self, used: int, quota: int, files: int, text: str) -> None:
        self.storage_text.setText(text)
        self.storage_bar.setVisible(bool(quota))
        if quota:
            self.storage_bar.setValue(int(min(1.0, used / quota) * 1000))
