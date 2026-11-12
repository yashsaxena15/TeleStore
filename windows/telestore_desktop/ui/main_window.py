"""The main window: TeleStore folders on the left, the upload list on the right."""

from PySide6.QtCore import Qt, QTimer
from PySide6.QtGui import QAction
from PySide6.QtWidgets import (QAbstractItemView, QFileDialog, QHBoxLayout, QHeaderView, QLabel, QMainWindow,
                               QProgressBar, QPushButton, QSplitter, QTableWidget, QTableWidgetItem, QTreeWidget,
                               QTreeWidgetItem, QVBoxLayout, QWidget)

from telestore_desktop.jobs import DONE, FAILED, PAUSED, PREPARING, SAVING, UPLOADING, WAITING
from telestore_desktop.parts import size_text
from telestore_desktop.ui import dialogs

STATUS_TEXT = {WAITING: "Waiting", PREPARING: "Starting", UPLOADING: "Uploading", SAVING: "Saving",
               DONE: "Done", PAUSED: "Paused", FAILED: "Failed"}
COLUMNS = ["Name", "Size", "To", "Progress", "Speed", "Status"]


class MainWindow(QMainWindow):
    def __init__(self, app_state):
        super().__init__()
        self.s = app_state  # api, engine, store, settings, runner, account name, sign-out callbacks
        self.setWindowTitle("TeleStore")
        self.resize(1100, 640)
        self.setAcceptDrops(True)
        self.rows = {}  # job id -> table row

        # Top: who is signed in, and storage used
        self.who = QLabel()
        self.storage_text = QLabel("Storage: …")
        self.storage_bar = QProgressBar()
        self.storage_bar.setMaximumWidth(220)
        self.storage_bar.setTextVisible(False)
        self.storage_bar.hide()
        top = QHBoxLayout()
        top.addWidget(self.who, 1)
        top.addWidget(self.storage_text)
        top.addWidget(self.storage_bar)

        # Left: TeleStore folders (the upload destination)
        self.tree = QTreeWidget()
        self.tree.setHeaderLabel("TeleStore folders")
        self.tree.itemExpanded.connect(self._load_children)
        self.tree.currentItemChanged.connect(self._folder_changed)
        refresh = QPushButton("Refresh")
        refresh.clicked.connect(self._load_tree)
        left = QWidget()
        lbox = QVBoxLayout(left)
        lbox.setContentsMargins(0, 0, 0, 0)
        lbox.addWidget(self.tree)
        lbox.addWidget(refresh)

        # Right: the uploads
        self.dest = QLabel()
        self.dest.setStyleSheet("font-weight: 600;")
        add_files = QPushButton("Add files…")
        add_files.clicked.connect(self._pick_files)
        add_folder = QPushButton("Add folder…")
        add_folder.clicked.connect(self._pick_folder)
        self.pause_btn = QPushButton("Pause")
        self.pause_btn.clicked.connect(lambda: self._each_selected(self.s.engine.pause))
        self.resume_btn = QPushButton("Resume / Retry")
        self.resume_btn.clicked.connect(lambda: self._each_selected(self.s.engine.resume))
        self.remove_btn = QPushButton("Remove")
        self.remove_btn.clicked.connect(self._remove)
        clear = QPushButton("Clear finished")
        clear.clicked.connect(self._clear_done)
        buttons = QHBoxLayout()
        for b in (add_files, add_folder, self.pause_btn, self.resume_btn, self.remove_btn, clear):
            buttons.addWidget(b)
        buttons.addStretch()

        self.table = QTableWidget(0, len(COLUMNS))
        self.table.setHorizontalHeaderLabels(COLUMNS)
        self.table.setSelectionBehavior(QAbstractItemView.SelectRows)
        self.table.setEditTriggers(QAbstractItemView.NoEditTriggers)
        self.table.verticalHeader().hide()
        header = self.table.horizontalHeader()
        header.setSectionResizeMode(0, QHeaderView.Stretch)
        for col in range(1, len(COLUMNS)):
            header.setSectionResizeMode(col, QHeaderView.ResizeToContents)
        self.table.setColumnWidth(3, 160)
        self.hint = QLabel("Drop files or folders here, or use Add files… They go straight from this PC to Telegram.")
        self.hint.setStyleSheet("color: palette(mid);")

        right = QWidget()
        rbox = QVBoxLayout(right)
        rbox.setContentsMargins(0, 0, 0, 0)
        rbox.addWidget(self.dest)
        rbox.addLayout(buttons)
        rbox.addWidget(self.table)
        rbox.addWidget(self.hint)

        split = QSplitter()
        split.addWidget(left)
        split.addWidget(right)
        split.setStretchFactor(1, 3)
        split.setSizes([260, 840])

        central = QWidget()
        box = QVBoxLayout(central)
        box.addLayout(top)
        box.addWidget(split)
        self.setCentralWidget(central)
        self._menus()

        self.timer = QTimer(self)
        self.timer.timeout.connect(self._refresh)
        self.timer.start(700)
        self.who.setText(self.s.who)
        self._set_dest(self.s.settings.last_folder or "/Home")
        self._load_tree()
        self._load_storage()

    # ── Menus ──
    def _menus(self) -> None:
        menu = self.menuBar().addMenu("&TeleStore")
        for text, slot in (("Settings…", self._settings), ("Refresh storage", self._load_storage),
                           ("Open the website", self._open_site), (None, None), ("Quit", self.close)):
            if text is None:
                menu.addSeparator()
                continue
            action = QAction(text, self)
            action.triggered.connect(slot)
            menu.addAction(action)

    def _open_site(self) -> None:
        from PySide6.QtCore import QUrl
        from PySide6.QtGui import QDesktopServices
        QDesktopServices.openUrl(QUrl(self.s.settings.server))

    # ── Folders ──
    def _folder_item(self, name: str, path: str) -> QTreeWidgetItem:
        item = QTreeWidgetItem([name])
        item.setData(0, Qt.UserRole, path)
        item.setChildIndicatorPolicy(QTreeWidgetItem.ShowIndicator)
        return item

    def _load_tree(self) -> None:
        self.tree.clear()
        home = self._folder_item("Home", "/Home")
        self.tree.addTopLevelItem(home)
        home.setExpanded(True)
        self.tree.setCurrentItem(home)

    def _load_children(self, item: QTreeWidgetItem) -> None:
        if item.data(0, Qt.UserRole + 1):
            return
        item.setData(0, Qt.UserRole + 1, True)
        path = item.data(0, Qt.UserRole)

        def show(folders):
            for f in folders:
                item.addChild(self._folder_item(f.get("file_name", "?"), f"{path.rstrip('/')}/{f.get('file_name')}"))
            if not folders:
                item.setChildIndicatorPolicy(QTreeWidgetItem.DontShowIndicator)

        def failed(e):
            item.setData(0, Qt.UserRole + 1, False)
            self.statusBar().showMessage(f"Couldn't load {path}: {e}", 8000)

        self.s.runner.run(lambda: self.s.api.folders(path), show, failed)

    def _folder_changed(self, item, _old=None) -> None:
        if item:
            self._set_dest(item.data(0, Qt.UserRole))

    def _set_dest(self, path: str) -> None:
        self.current = path
        self.dest.setText(f"Upload to: {path}")
        if self.s.settings.last_folder != path:
            self.s.settings.last_folder = path
            self.s.settings.save()

    def _load_storage(self) -> None:
        def show(stats):
            used, quota = int(stats.get("total_bytes") or 0), int(stats.get("quota_bytes") or 0)
            files = int(stats.get("total_files") or 0)
            text = f"Storage used: {size_text(used)}" + (f" of {size_text(quota)}" if quota else "") + f" · {files} files"
            self.storage_text.setText(text)
            if quota:
                self.storage_bar.setMaximum(1000)
                self.storage_bar.setValue(int(min(1.0, used / quota) * 1000))
                self.storage_bar.show()

        self.s.runner.run(self.s.api.storage, show, lambda e: self.storage_text.setText(f"Storage: {e}"))

    # ── Adding uploads ──
    def _add(self, paths) -> None:
        paths = [p for p in paths if p]
        if not paths:
            return
        dest = self.current
        self.statusBar().showMessage(f"Adding {len(paths)} item(s) to {dest}…", 4000)
        self.s.engine.add(paths, dest)

    def _pick_files(self) -> None:
        files, _ = QFileDialog.getOpenFileNames(self, f"Upload to {self.current}")
        self._add(files)

    def _pick_folder(self) -> None:
        self._add([QFileDialog.getExistingDirectory(self, f"Upload a folder to {self.current}")])

    def dragEnterEvent(self, event) -> None:
        if event.mimeData().hasUrls():
            event.acceptProposedAction()

    def dropEvent(self, event) -> None:
        self._add([u.toLocalFile() for u in event.mimeData().urls() if u.isLocalFile()])

    # ── The upload list ──
    def _selected_ids(self):
        rows = {i.row() for i in self.table.selectedIndexes()}
        return [self.table.item(r, 0).data(Qt.UserRole) for r in sorted(rows) if self.table.item(r, 0)]

    def _each_selected(self, action) -> None:
        for job_id in self._selected_ids():
            action(job_id)

    def _remove(self) -> None:
        ids = self._selected_ids()
        if ids and dialogs.confirm(self, "Remove uploads", f"Remove {len(ids)} upload(s) from the list? "
                                   "Unfinished ones stop; files already saved stay in TeleStore."):
            for job_id in ids:
                self.s.engine.remove(job_id)

    def _clear_done(self) -> None:
        self.s.store.clear_done()

    def _refresh(self) -> None:
        jobs = self.s.store.all()
        ids = [j.id for j in jobs]
        if ids != [self.table.item(r, 0).data(Qt.UserRole) for r in range(self.table.rowCount()) if self.table.item(r, 0)]:
            selected = set(self._selected_ids())
            self.table.setRowCount(len(jobs))
            for r, job in enumerate(jobs):
                name = QTableWidgetItem(job.name)
                name.setData(Qt.UserRole, job.id)
                name.setToolTip(job.local_path)
                self.table.setItem(r, 0, name)
                bar = QProgressBar()
                bar.setRange(0, 1000)
                self.table.setCellWidget(r, 3, bar)
                for c in (1, 2, 4, 5):
                    self.table.setItem(r, c, QTableWidgetItem(""))
                if job.id in selected:
                    self.table.selectRow(r)
        for r, job in enumerate(jobs):
            self.table.item(r, 1).setText(size_text(job.size) + (f" · {job.total_parts} parts" if job.total_parts > 1 else ""))
            self.table.item(r, 2).setText(job.dest)
            bar = self.table.cellWidget(r, 3)
            bar.setValue(int(job.progress * 10))
            bar.setFormat(f"{job.progress:.1f}%")
            self.table.item(r, 4).setText(f"{size_text(job.speed)}/s" if job.status == UPLOADING and job.speed else "")
            status = STATUS_TEXT.get(job.status, job.status)
            if job.status == UPLOADING and job.total_parts > 1:
                status += f" (part {min(job.total_parts, len(job.done_parts) + 1)} of {job.total_parts})"
            if job.error:
                status += f": {job.error}"
            cell = self.table.item(r, 5)
            cell.setText(status)
            cell.setToolTip(job.error or "")
        self.hint.setVisible(not jobs)
        busy = sum(1 for j in jobs if j.status in (WAITING, PREPARING, UPLOADING, SAVING))
        speed = sum(j.speed for j in jobs if j.status == UPLOADING)
        if self.s.engine.state not in ("ready", "starting"):
            self.statusBar().showMessage(f"Uploads stopped: {self.s.engine.state}")
        elif busy:
            self.statusBar().showMessage(f"{busy} upload(s) in progress · {size_text(speed)}/s")
        for note in self.s.engine.take_notes():
            self.statusBar().showMessage(note, 10000)
        if self._had_busy and not busy:
            self._load_storage()
        self._had_busy = bool(busy)

    _had_busy = False

    # ── Settings and closing ──
    def _settings(self) -> None:
        d = dialogs.SettingsDialog(self.s.settings, self)
        if not d.exec():
            return
        self.s.settings.parallel = d.parallel.value()
        self.s.settings.speed_limit_kb = d.limit.value()
        self.s.settings.save()
        self.s.engine.set_parallel(self.s.settings.parallel)
        self.s.engine.set_speed_limit(self.s.settings.speed_limit_kb)
        if d.sign_out_tg.isChecked() or d.sign_out_ts.isChecked():
            self.s.sign_out(telegram=d.sign_out_tg.isChecked(), telestore=d.sign_out_ts.isChecked())

    def closeEvent(self, event) -> None:
        busy = [j for j in self.s.store.all() if j.status in (PREPARING, UPLOADING, SAVING)]
        if busy and not dialogs.confirm(self, "Uploads running",
                                        f"{len(busy)} upload(s) are running. Close anyway? They continue from the "
                                        "last finished part next time."):
            event.ignore()
            return
        self.timer.stop()
        try:
            self.s.engine.stop()
        except Exception:
            pass
        event.accept()

