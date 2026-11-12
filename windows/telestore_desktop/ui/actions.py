"""Phase 9: the windows the right-click actions open: Move to… (a folder picker) and Share…"""

from PySide6.QtCore import Qt
from PySide6.QtGui import QGuiApplication
from PySide6.QtWidgets import (QCheckBox, QComboBox, QDialog, QDialogButtonBox, QHBoxLayout, QLabel, QLineEdit,
                               QListWidget, QListWidgetItem, QPushButton, QTreeWidget, QTreeWidgetItem, QVBoxLayout)

from telestore_desktop.ui import theme


class MoveDialog(QDialog):
    """Pick a folder in Home to move items into."""

    def __init__(self, api, runner, palette, count: int, exclude=(), parent=None):
        super().__init__(parent)
        self.api, self.runner, self.p = api, runner, palette
        self.exclude = set(exclude)  # the folders being moved (can't go into themselves)
        self.setWindowTitle("Move to")
        self.resize(420, 480)
        self.tree = QTreeWidget()
        self.tree.setHeaderHidden(True)
        self.tree.itemExpanded.connect(self._load)
        self.tree.currentItemChanged.connect(self._chosen)
        self.where = QLabel()
        self.where.setObjectName("muted")
        buttons = QDialogButtonBox(QDialogButtonBox.Cancel)
        self.ok = buttons.addButton("Move here", QDialogButtonBox.AcceptRole)
        self.ok.setObjectName("primaryButton")
        buttons.accepted.connect(self.accept)
        buttons.rejected.connect(self.reject)
        box = QVBoxLayout(self)
        box.addWidget(QLabel(f"Move {count} item{'s' if count != 1 else ''} to:"))
        box.addWidget(self.tree, 1)
        box.addWidget(self.where)
        box.addWidget(buttons)
        home = self._node("Home", "/Home")
        self.tree.addTopLevelItem(home)
        home.setExpanded(True)
        self.tree.setCurrentItem(home)

    def _node(self, name, path):
        item = QTreeWidgetItem([name])
        item.setIcon(0, theme.icon("folder", theme.KIND_COLORS["folder"], 18, fill=True))
        item.setData(0, Qt.UserRole, path)
        item.setChildIndicatorPolicy(QTreeWidgetItem.ShowIndicator)
        return item

    def _load(self, item) -> None:
        if item.data(0, Qt.UserRole + 1):
            return
        item.setData(0, Qt.UserRole + 1, True)
        path = item.data(0, Qt.UserRole)

        def show(folders):
            for f in folders:
                full = f"{path.rstrip('/')}/{f.get('file_name')}"
                if full not in self.exclude:
                    item.addChild(self._node(f.get("file_name", "?"), full))
            if not item.childCount():
                item.setChildIndicatorPolicy(QTreeWidgetItem.DontShowIndicator)

        self.runner.run(lambda: self.api.folders(path), show, lambda e: self.where.setText(f"Couldn't load {path}: {e}"))

    def _chosen(self, item, _old=None) -> None:
        self.where.setText(item.data(0, Qt.UserRole) if item else "")

    def target(self) -> str:
        item = self.tree.currentItem()
        return item.data(0, Qt.UserRole) if item else "/Home"


class ShareDialog(QDialog):
    """Share one file or folder, as on the website: people (viewer or editor) and a link anyone can open."""

    def __init__(self, api, runner, item, parent=None):
        super().__init__(parent)
        self.api, self.runner, self.item = api, runner, item
        self.setWindowTitle(f"Share “{item.name}”")
        self.setMinimumWidth(480)
        self.who = QLineEdit()
        self.who.setPlaceholderText("Add people by username or email")
        self.role = QComboBox()
        self.role.addItem("Viewer", "viewer")
        self.role.addItem("Editor", "editor")
        add = QPushButton("Add")
        add.setObjectName("primaryButton")
        add.clicked.connect(self._add)
        self.who.returnPressed.connect(self._add)
        row = QHBoxLayout()
        row.addWidget(self.who, 1)
        row.addWidget(self.role)
        row.addWidget(add)
        self.people = QListWidget()
        self.people.setMaximumHeight(160)
        remove = QPushButton("Remove selected person")
        remove.clicked.connect(self._remove)
        self.link_on = QCheckBox("Anyone with the link can view")
        self.link_on.toggled.connect(self._link)
        self.link = QLineEdit()
        self.link.setReadOnly(True)
        self.copy = QPushButton("Copy link")
        self.copy.clicked.connect(self._copy)
        link_row = QHBoxLayout()
        link_row.addWidget(self.link, 1)
        link_row.addWidget(self.copy)
        self.note = QLabel()
        self.note.setObjectName("muted")
        self.note.setWordWrap(True)
        done = QPushButton("Done")
        done.clicked.connect(self.accept)
        box = QVBoxLayout(self)
        box.addLayout(row)
        box.addWidget(QLabel("People with access"))
        box.addWidget(self.people)
        box.addWidget(remove, 0, Qt.AlignLeft)
        box.addSpacing(8)
        box.addWidget(QLabel("General access"))
        box.addWidget(self.link_on)
        box.addLayout(link_row)
        box.addWidget(self.note)
        box.addWidget(done, 0, Qt.AlignRight)
        self._busy = True
        self.refresh()

    def refresh(self, view=None) -> None:
        if view is None:
            self.runner.run(lambda: self.api.share_view(self.item.id), self.refresh, self._failed)
            return
        self._busy = True
        self.people.clear()
        for m in view.get("members") or []:
            text = f"{m.get('name') or m.get('username')}  ·  {(m.get('role') or 'viewer').capitalize()}"
            if m.get("email"):
                text += f"  ·  {m['email']}"
            it = QListWidgetItem(text)
            it.setData(Qt.UserRole, m.get("user_id"))
            self.people.addItem(it)
        if not self.people.count():
            self.people.addItem("Only you")
        link = view.get("link") or {}
        on = bool(link.get("enabled")) and link.get("state", "active") == "active"
        self.link_on.setChecked(on)
        self.link.setText(self.api.link_address(link["token"]) if on and link.get("token") else "")
        self.copy.setEnabled(on)
        self.note.setText("Downloads, an expiry date and a download limit can be set on the website."
                          if on else "Only the people above can open it.")
        self._busy = False

    def _failed(self, e) -> None:
        self._busy = False
        self.note.setText(str(e))

    def _add(self) -> None:
        who = self.who.text().strip()
        if who:
            self.runner.run(lambda: self.api.share_add(self.item.id, who, self.role.currentData()),
                            lambda _: (self.who.clear(), self.refresh()), self._failed)

    def _remove(self) -> None:
        it = self.people.currentItem()
        if it and it.data(Qt.UserRole) is not None:
            uid = it.data(Qt.UserRole)
            self.runner.run(lambda: self.api.share_remove(self.item.id, uid), lambda _: self.refresh(), self._failed)

    def _link(self, on: bool) -> None:
        if not self._busy:
            self.runner.run(lambda: self.api.share_link(self.item.id, on), lambda _: self.refresh(), self._failed)

    def _copy(self) -> None:
        QGuiApplication.clipboard().setText(self.link.text())
        self.note.setText("Link copied.")
