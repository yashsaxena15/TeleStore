"""Shared by me, as on the website: everything you share, who has it and whether its link is on;
manage the sharing, copy the link or stop sharing."""

from datetime import datetime

from PySide6.QtCore import QSize, Qt, Signal
from PySide6.QtGui import QGuiApplication
from PySide6.QtWidgets import QHeaderView, QLabel, QMenu, QPushButton, QTreeWidget, QTreeWidgetItem, QVBoxLayout

from telestore_desktop.items import from_my_share
from telestore_desktop.ui import dialogs, theme
from telestore_desktop.ui.pages import Page, page_header


def link_text(link) -> str:
    if not link:
        return "Off"
    state = link.get("state") or ("active" if link.get("enabled") else "off")
    words = {"active": "On", "off": "Off", "expired": "Expired", "used_up": "Download limit reached",
             "disabled": "Off"}.get(state, state.capitalize())
    if state == "active" and link.get("max_downloads"):
        words += f" · {link.get('downloads') or 0} of {link['max_downloads']} downloads"
    if state == "active" and link.get("expires_at"):
        try:
            words += " · until " + datetime.fromisoformat(link["expires_at"].replace("Z", "+00:00")).astimezone().strftime("%d %b %Y")
        except ValueError:
            pass
    return words


def people_text(n: int) -> str:
    return "Only the link" if not n else f"{n} {'person' if n == 1 else 'people'}"


class SharedByMePage(Page):
    open_item = Signal(object)  # a file to open
    open_folder = Signal(str)  # a folder (or the folder a file is in) to go to
    manage = Signal(object)  # the Share dialog for an item

    def __init__(self, api, runner, palette):
        super().__init__()
        self.api, self.runner, self.p = api, runner, palette
        self.subtitle = QLabel("…")
        refresh = QPushButton()
        refresh.setObjectName("iconButton")
        refresh.setIcon(theme.icon("refresh", palette.text, 18))
        refresh.setToolTip("Refresh")
        refresh.clicked.connect(self.shown)
        header = page_header(palette, "share", "Shared by me", self.subtitle, [refresh])
        self.table = QTreeWidget()
        self.table.setHeaderLabels(["Name", "Location", "Shared with", "Link"])
        self.table.setRootIsDecorated(False)
        self.table.setUniformRowHeights(True)
        self.table.setIconSize(QSize(22, 22))
        h = self.table.header()
        h.setSectionResizeMode(0, QHeaderView.Stretch)
        for col in (1, 2, 3):
            h.setSectionResizeMode(col, QHeaderView.ResizeToContents)
        self.table.itemActivated.connect(lambda it, _c: self._open(it.data(0, Qt.UserRole)))
        self.table.setContextMenuPolicy(Qt.CustomContextMenu)
        self.table.customContextMenuRequested.connect(self._menu)
        self.empty = QLabel("You haven't shared anything yet.\nRight-click a file or folder and choose Share….")
        self.empty.setObjectName("empty")
        self.empty.setAlignment(Qt.AlignCenter)
        box = QVBoxLayout(self)
        box.setContentsMargins(24, 18, 24, 16)
        box.setSpacing(12)
        box.addLayout(header)
        box.addWidget(self.table, 1)
        box.addWidget(self.empty, 1)
        self.empty.hide()
        self.shares = []

    def shown(self) -> None:
        self.subtitle.setText("Loading…")
        self.runner.run(self.api.shared_by_me, self.fill, lambda e: self.subtitle.setText(f"Couldn't load: {e}"))

    def fill(self, shares) -> None:
        self.shares = shares or []
        self.table.clear()
        for s in self.shares:
            item = from_my_share(s)
            where = item.path + ("  (in Trash)" if s.get("trashed") else "")
            row = QTreeWidgetItem([item.name, where, people_text(int(s.get("members") or 0)), link_text(s.get("link"))])
            row.setData(0, Qt.UserRole, item)
            row.setIcon(0, theme.icon({"folder": "folder", "video": "video", "photo": "image", "audio": "audio"}.get(item.kind, "file"),
                                      theme.KIND_COLORS.get(item.kind, self.p.muted), 22, fill=item.is_folder))
            self.table.addTopLevelItem(row)
        n = len(self.shares)
        self.subtitle.setText(f"{n} shared item{'s' if n != 1 else ''}" if n else "Nothing shared yet")
        self.table.setVisible(bool(n))
        self.empty.setVisible(not n)

    def _open(self, item) -> None:
        if item is None:
            return
        if item.is_folder:
            self.open_folder.emit(item.full_path)
        else:
            self.open_item.emit(item)

    def _menu(self, pos) -> None:
        it = self.table.itemAt(pos)
        if not it:
            return
        item = it.data(0, Qt.UserRole)
        link = (item.raw or {}).get("link") or {}
        menu = QMenu(self)
        menu.addAction(theme.icon("external", self.p.text, 16), "Open", lambda: self._open(item))
        menu.addAction(theme.icon("folder", self.p.text, 16), "Show in its folder", lambda: self.open_folder.emit(item.path))
        menu.addSeparator()
        menu.addAction(theme.icon("users", self.p.text, 16), "Manage sharing…", lambda: self.manage.emit(item))
        if link.get("enabled") and link.get("token"):
            menu.addAction(theme.icon("link", self.p.text, 16), "Copy link",
                           lambda: QGuiApplication.clipboard().setText(self.api.link_address(link["token"])))
        menu.addSeparator()
        menu.addAction(theme.icon("x", self.p.danger, 16), "Stop sharing", lambda: self.stop(item))
        menu.exec(self.table.viewport().mapToGlobal(pos))

    def stop(self, item) -> None:
        if not dialogs.confirm(self, "Stop sharing", f"Stop sharing “{item.name}”?\nPeople lose access and its link stops working."):
            return
        self.runner.run(lambda: self.api.stop_sharing(item.id), lambda _: self.shown(),
                        lambda e: dialogs.info(self, "Stop sharing", str(e)))
