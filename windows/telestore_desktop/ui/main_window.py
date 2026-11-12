"""The main window, laid out like the TeleStore website: the sidebar, the files, and the uploads panel."""

from PySide6.QtCore import QSettings, QTimer, QUrl
from PySide6.QtGui import QDesktopServices
from PySide6.QtWidgets import QFileDialog, QHBoxLayout, QMainWindow, QWidget

from telestore_desktop.parts import size_text
from telestore_desktop.ui import actions, dialogs, viewers
from telestore_desktop.ui.browser import Browser, Location
from telestore_desktop.ui.sidebar import Sidebar
from telestore_desktop.ui.thumbloader import ThumbLoader
from telestore_desktop.ui.uploads_panel import UploadsPanel


class MainWindow(QMainWindow):
    def __init__(self, app_state):
        super().__init__()
        self.s = app_state  # api, engine, store, settings, runner, username, palette, sign_out, restyle
        self.setWindowTitle("TeleStore")
        self.setMinimumSize(900, 560)
        p = app_state.palette
        self.thumbs = ThumbLoader(app_state.api.fetch)

        self.sidebar = Sidebar(p, app_state.username)
        self.sidebar.place_chosen.connect(self.open_place)
        self.sidebar.new_action.connect(self.new_action)
        self.sidebar.account_action.connect(self.account_action)
        self.browser = Browser(app_state.api, app_state.runner, self.thumbs, p, app_state.settings.view)
        self.browser.open_item.connect(lambda item, around: viewers.open_item(self, self.s.api, self.s.runner, p, item, around))
        self.browser.download_item.connect(lambda item: viewers.save_as(self, self.s.api, self.s.runner, item))
        self.browser.files_dropped.connect(self.upload_here)
        self.browser.action.connect(self.item_action)
        self.browser.location_changed.connect(self._moved)
        self.browser.grid_btn.clicked.connect(lambda: self._save_view("grid"))
        self.browser.list_btn.clicked.connect(lambda: self._save_view("list"))

        central = QWidget()
        row = QHBoxLayout(central)
        row.setContentsMargins(0, 0, 0, 0)
        row.setSpacing(0)
        row.addWidget(self.sidebar)
        row.addWidget(self.browser, 1)
        self.setCentralWidget(central)

        self.panel = UploadsPanel(self.browser, app_state.engine, app_state.store, p)
        self.panel.finished_in.connect(self._uploaded_to)
        self._refresh_soon = QTimer(self)
        self._refresh_soon.setSingleShot(True)
        self._refresh_soon.timeout.connect(self._after_uploads)

        self.status_timer = QTimer(self)
        self.status_timer.timeout.connect(self._engine_notes)
        self.status_timer.start(1000)

        geometry = QSettings("TeleStore", "Desktop").value("geometry")
        if geometry:
            self.restoreGeometry(geometry)
        else:
            self.resize(1200, 760)
        start = app_state.settings.last_folder or "/Home"
        self.browser.go(Location("folder", start if start.startswith("/Home") else "/Home"), remember=False)
        self.load_storage()

    # ── Where you are ──
    def open_place(self, key: str) -> None:
        self.browser.go(Location("folder", "/Home") if key == "home" else Location(key))

    def _moved(self, loc: Location) -> None:
        place = "home" if loc.kind == "folder" else ("shared" if loc.kind == "share" else loc.kind)
        self.sidebar.select(place)
        if loc.kind == "folder" and self.s.settings.last_folder != loc.path:
            self.s.settings.last_folder = loc.path
            self.s.settings.save()

    def _save_view(self, view: str) -> None:
        self.s.settings.view = view
        self.s.settings.save()

    def load_storage(self) -> None:
        def show(stats):
            used, quota = int(stats.get("total_bytes") or 0), int(stats.get("quota_bytes") or 0)
            files = int(stats.get("total_files") or 0)
            text = f"{size_text(used)} used" + (f" of {size_text(quota)}" if quota else "") + f" · {files:,} files"
            self.sidebar.set_storage(used, quota, files, text)

        self.s.runner.run(self.s.api.storage, show, lambda e: self.sidebar.set_storage(0, 0, 0, "Storage unavailable"))

    # ── New: uploads and folders, always into the folder you're looking at ──
    def _upload_folder(self):
        loc = self.browser.loc
        if not loc.can_upload:
            dialogs.info(self, "Upload", "Open a folder in Home first: uploads go into the folder you're looking at.")
            return None
        return loc.path

    def new_action(self, key: str) -> None:
        dest = self._upload_folder()
        if not dest:
            return
        if key == "upload-files":
            files, _ = QFileDialog.getOpenFileNames(self, f"Upload to {dest}")
            self.upload_here(files)
        elif key == "upload-folder":
            folder = QFileDialog.getExistingDirectory(self, f"Upload a folder to {dest}")
            self.upload_here([folder] if folder else [])
        elif key == "new-folder":
            name = dialogs.ask_text(self, "New folder", "Name:")
            if name:
                self.s.runner.run(lambda: self.s.api.create_folder(name, dest), lambda _: self.browser.reload(),
                                  lambda e: dialogs.info(self, "New folder", f"Couldn't make the folder.\n{e}"))

    def upload_here(self, paths) -> None:
        paths = [p for p in paths if p]
        if not paths:
            return
        dest = self._upload_folder()
        if not dest:
            return
        if self.s.engine.state not in ("ready", "starting"):
            dialogs.info(self, "Uploads", f"Uploads can't start: {self.s.engine.state}")
            return
        self.s.engine.add(paths, dest)
        self.panel.show_now()

    def _uploaded_to(self, folder: str) -> None:
        self._last_upload_folder = folder
        self._refresh_soon.start(1200)

    def _after_uploads(self) -> None:
        if self.browser.loc.kind == "folder" and self.browser.loc.path == getattr(self, "_last_upload_folder", None):
            self.browser.reload()
        elif self.browser.loc.kind == "recent":
            self.browser.reload()
        self.load_storage()

    def _engine_notes(self) -> None:
        for note in self.s.engine.take_notes():
            self.statusBar().showMessage(note, 10000)
        if self.s.engine.state not in ("ready", "starting"):
            self.statusBar().showMessage(f"Uploads can't run: {self.s.engine.state}")

    # ── Right-click actions (phase 9) ──
    def _each(self, items, call, done_text: str) -> None:
        """Runs [call](item) for each item in the background, then refreshes and says how it went."""
        def work():
            failed = []
            for item in items:
                try:
                    call(item)
                except Exception as e:  # e.g. a protected item (the server says why)
                    failed.append(f"{item.name}: {e}")
            return failed

        def finished(failed):
            self.browser.reload()
            if failed:
                dialogs.info(self, "TeleStore", "Some items couldn't be changed:\n\n" + "\n".join(failed[:10]))
            else:
                self.statusBar().showMessage(done_text, 5000)
            self.load_storage()

        self.s.runner.run(work, finished, lambda e: dialogs.info(self, "TeleStore", str(e)))

    def item_action(self, name: str, items: list) -> None:
        api = self.s.api
        n = len(items)
        what = f"{n} items" if n != 1 else f"“{items[0].name}”"
        if name == "rename":
            item = items[0]
            new = dialogs.ask_text(self, "Rename", "New name:", item.name)
            if new and new != item.name:
                self._each([item], lambda i: api.rename(i.id, new), f"Renamed to {new}")
        elif name == "move":
            d = actions.MoveDialog(api, self.s.runner, self.s.palette, n, [i.full_path for i in items if i.is_folder], self)
            if d.exec():
                target = d.target()
                self._each(items, lambda i: api.move(i.id, target), f"Moved {what} to {target}")
        elif name in ("star", "unstar"):
            self._each(items, lambda i: api.star(i.id, name == "star"),
                       f"{'Added' if name == 'star' else 'Removed'} {what} {'to' if name == 'star' else 'from'} Starred")
        elif name == "share":
            actions.ShareDialog(api, self.s.runner, items[0], self).exec()
        elif name == "trash":
            if dialogs.confirm(self, "Move to Trash", f"Move {what} to Trash?\nYou can restore it from Trash."):
                self._each(items, lambda i: api.trash(i.id), f"Moved {what} to Trash")
        elif name == "restore":
            self._each(items, lambda i: api.restore(i.id), f"Restored {what}")
        elif name == "delete":
            if dialogs.confirm(self, "Delete forever", f"Delete {what} forever?\nThis can't be undone."):
                self._each(items, lambda i: api.delete_forever(i.id), f"Deleted {what}")
        elif name == "empty-trash":
            if dialogs.confirm(self, "Empty trash", "Delete everything in Trash forever?\nThis can't be undone."):
                self.s.runner.run(api.empty_trash, lambda r: (self.browser.reload(), self.load_storage(),
                                                              self.statusBar().showMessage((r or {}).get("message") or "Trash emptied", 6000)),
                                  lambda e: dialogs.info(self, "Empty trash", str(e)))

    # ── Account ──
    def account_action(self, key: str) -> None:
        if key == "website":
            QDesktopServices.openUrl(QUrl(self.s.settings.server))
        elif key == "sign-out":
            self.s.sign_out(telegram=False, telestore=True)
        elif key == "settings":
            d = dialogs.SettingsDialog(self.s.settings, self)
            if not d.exec():
                return
            if d.sign_out:
                self.s.sign_out(telegram=d.sign_out == "telegram", telestore=d.sign_out == "telestore")
                return
            self.s.settings.speed_limit_kb = d.speed_limit_kb()
            new_theme = d.theme.currentData()
            changed = new_theme != self.s.settings.theme
            self.s.settings.theme = new_theme
            self.s.settings.save()
            self.s.engine.set_speed_limit(self.s.settings.speed_limit_kb)
            if changed:
                dialogs.info(self, "Theme", "The new theme is used the next time TeleStore opens.")

    # ── Window ──
    def resizeEvent(self, event) -> None:
        super().resizeEvent(event)
        if self.panel.isVisible():
            self.panel.place()

    def closeEvent(self, event) -> None:
        busy = [j for j in self.s.store.all() if j.status in ("preparing", "uploading", "saving")]
        if busy and not dialogs.confirm(self, "Uploads running",
                                        f"{len(busy)} upload(s) are still running. Close anyway?\n"
                                        "They continue from where they stopped next time you open TeleStore."):
            event.ignore()
            return
        QSettings("TeleStore", "Desktop").setValue("geometry", self.saveGeometry())
        self.status_timer.stop()
        self.panel.timer.stop()
        try:
            self.s.engine.stop()
        except Exception:
            pass
        event.accept()

