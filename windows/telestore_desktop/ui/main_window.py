"""The main window, laid out like the TeleStore website: the sidebar, a top bar (search, update,
notifications, details), the page (files, Photos, Shared by me, Transfers, Storage), the details
pane, and the transfers panel in the corner."""

import os

from PySide6.QtCore import QSettings, QSize, QTimer, QUrl
from PySide6.QtGui import QDesktopServices, QKeySequence, QShortcut
from PySide6.QtWidgets import (QApplication, QFileDialog, QHBoxLayout, QMainWindow, QMenu, QPushButton,
                               QStackedWidget, QSystemTrayIcon, QVBoxLayout, QWidget)

from telestore_desktop.downloads import ACTIVE as DOWNLOAD_ACTIVE
from telestore_desktop.downloads import DownloadManager
from telestore_desktop.parts import size_text
from telestore_desktop.ui import actions, dialogs, theme, viewers
from telestore_desktop.ui.browser import Browser, Location
from telestore_desktop.ui.details import DetailsPane
from telestore_desktop.ui.notifications import NotificationCenter, NotificationsPopup, bell_icon
from telestore_desktop.ui.pages.photos import PhotosPage
from telestore_desktop.ui.pages.shared_by_me import SharedByMePage
from telestore_desktop.ui.pages.storage import StoragePage
from telestore_desktop.ui.pages.transfers import TransfersPage
from telestore_desktop.ui.sidebar import Sidebar
from telestore_desktop.ui.thumbloader import ThumbLoader
from telestore_desktop.ui.update_ui import UpdateDialog, UpdateNotifier
from telestore_desktop.ui.uploads_panel import UploadsPanel

BROWSER_PLACES = {"home", "recent", "starred", "shared", "trash"}
BUSY_UPLOADS = ("waiting", "preparing", "uploading", "saving")


class MainWindow(QMainWindow):
    def __init__(self, app_state):
        super().__init__()
        self.s = app_state  # api, engine, store, settings, runner, username, palette, sign_out (+ downloads)
        self.setWindowTitle("TeleStore")
        self.setWindowIcon(theme.app_icon())
        self.setMinimumSize(960, 600)
        p = app_state.palette
        api, runner = app_state.api, app_state.runner
        self.thumbs = ThumbLoader(api.fetch)
        self.downloads = getattr(app_state, "downloads", None) or DownloadManager(api)

        # Sidebar
        self.sidebar = Sidebar(p, app_state.username)
        self.sidebar.place_chosen.connect(self.open_place)
        self.sidebar.new_action.connect(self.new_action)
        self.sidebar.account_action.connect(self.account_action)

        # Pages
        self.browser = Browser(api, runner, self.thumbs, p, app_state.settings.view)
        self.browser.open_item.connect(self.open_file)
        self.browser.download_items.connect(self.download)
        self.browser.files_dropped.connect(self.upload_here)
        self.browser.action.connect(self.item_action)
        self.browser.location_changed.connect(self._moved)
        self.browser.selection_changed.connect(self._selected)
        self.browser.grid_btn.clicked.connect(lambda: self._save_view("grid"))
        self.browser.list_btn.clicked.connect(lambda: self._save_view("list"))
        self.photos = PhotosPage(api, runner, self.thumbs, p, app_state.settings)
        self.photos.open_item.connect(self.open_file)
        self.photos.action.connect(self.item_action)
        self.photos.download.connect(self.download)
        self.shared_by_me = SharedByMePage(api, runner, p)
        self.shared_by_me.open_item.connect(lambda item: self.open_file(item, [item]))
        self.shared_by_me.open_folder.connect(self.open_folder)
        self.shared_by_me.manage.connect(self.share)
        self.transfers = TransfersPage(api, runner, app_state.engine, app_state.store, self.downloads, p)
        self.storage = StoragePage(api, runner, p)
        self.storage.open_item.connect(lambda item: self.open_file(item, [item]))
        self.storage.open_folder.connect(self.open_folder)
        self.storage.open_trash.connect(lambda: self.open_place("trash"))
        self.pages = {"browser": self.browser, "photos": self.photos, "shared-by-me": self.shared_by_me,
                      "transfers": self.transfers, "storage": self.storage}
        self.stack = QStackedWidget()
        for page in self.pages.values():
            self.stack.addWidget(page)

        # Top bar: search, an update when there is one, notifications, details
        self.notes = NotificationCenter(api, runner)
        self.notes.changed.connect(self._bell)
        self.notes.arrived.connect(self._new_notifications)
        topbar = QWidget()
        topbar.setObjectName("topbar")
        top = QHBoxLayout(topbar)
        top.setContentsMargins(20, 10, 16, 10)
        top.setSpacing(6)
        self.search = self.browser.search  # the website's search sits in the top bar
        self.search.setObjectName("topSearch")
        self.search.setFixedWidth(460)
        self.search.setPlaceholderText("Search in TeleStore (Ctrl+F)")
        top.addWidget(self.search)
        top.addStretch()
        self.update_btn = QPushButton()
        self.update_btn.setObjectName("updateButton")
        self.update_btn.setIcon(theme.icon("update", p.primary, 16))
        self.update_btn.clicked.connect(self.show_update)
        self.update_btn.hide()
        self.bell = QPushButton()
        self.bell.setObjectName("iconButton")
        self.bell.setIconSize(QSize(28, 28))
        self.bell.setToolTip("Notifications")
        self.bell.clicked.connect(self.open_notifications)
        self.info_btn = QPushButton()
        self.info_btn.setObjectName("iconButton")
        self.info_btn.setCheckable(True)
        self.info_btn.setIcon(theme.icon("info", p.text, 20))
        self.info_btn.setIconSize(QSize(20, 20))
        self.info_btn.setToolTip("Details (Alt+Enter)")
        self.info_btn.toggled.connect(self.toggle_details)
        top.addWidget(self.update_btn)
        top.addWidget(self.bell)
        top.addWidget(self.info_btn)
        self.popup = NotificationsPopup(self.notes, p, self)
        self.popup.chosen.connect(self.follow_notification)
        self._bell()

        self.details = DetailsPane(api, runner, p)
        self.details.closed.connect(lambda: self.info_btn.setChecked(False))
        self.details.open_item.connect(lambda item: self.browser._activate(item) if item.is_folder else self.open_file(item, [item]))
        self.details.download.connect(self.download)
        self.details.share.connect(self.share)
        self.details.hide()

        column = QWidget()
        col = QVBoxLayout(column)
        col.setContentsMargins(0, 0, 0, 0)
        col.setSpacing(0)
        col.addWidget(topbar)
        col.addWidget(self.stack, 1)
        central = QWidget()
        row = QHBoxLayout(central)
        row.setContentsMargins(0, 0, 0, 0)
        row.setSpacing(0)
        row.addWidget(self.sidebar)
        row.addWidget(column, 1)
        row.addWidget(self.details)
        self.setCentralWidget(central)

        self.panel = UploadsPanel(self, app_state.engine, app_state.store, p, self.downloads)
        self.panel.finished_in.connect(self._uploaded_to)
        self.panel.open_transfers.connect(lambda: self.open_place("transfers"))
        self.panel.hide_when = lambda: self.current_page() == "transfers"
        self._refresh_soon = QTimer(self)
        self._refresh_soon.setSingleShot(True)
        self._refresh_soon.timeout.connect(self._after_uploads)

        self.status_timer = QTimer(self)
        self.status_timer.timeout.connect(self._engine_notes)
        self.status_timer.start(1000)

        # Windows notifications come from a tray icon
        self.tray = None
        if QSystemTrayIcon.isSystemTrayAvailable():
            self.tray = QSystemTrayIcon(theme.app_icon(), self)
            self.tray.setToolTip("TeleStore")
            menu = QMenu()
            menu.addAction("Open TeleStore", self.bring_to_front)
            menu.addAction("Transfers", lambda: (self.bring_to_front(), self.open_place("transfers")))
            self.tray.setContextMenu(menu)
            self.tray.activated.connect(lambda reason: reason == QSystemTrayIcon.Trigger and self.bring_to_front())
            self.tray.messageClicked.connect(self.bring_to_front)
            self.tray.show()

        QShortcut(QKeySequence("Alt+Return"), self, activated=self.info_btn.toggle)
        self.updater = UpdateNotifier(runner, app_state.settings)
        self.updater.available.connect(self._update_available)

        geometry = QSettings("TeleStore", "Desktop").value("geometry")
        if geometry:
            self.restoreGeometry(geometry)
        else:
            self.resize(1280, 800)
        start = app_state.settings.last_folder or "/Home"
        self.browser.go(Location("folder", start if start.startswith("/Home") else "/Home"), remember=False)
        self.load_storage()
        self.notes.check()

    # ── Where you are ──
    def open_place(self, key: str) -> None:
        if key in BROWSER_PLACES:
            self.stack.setCurrentWidget(self.browser)
            self.browser.go(Location("folder", "/Home") if key == "home" else Location(key))
            return
        page = self.pages.get(key)
        if page is None:
            return
        self.stack.setCurrentWidget(page)
        self.sidebar.select(key)
        self._selected([])
        page.shown()

    def open_folder(self, path: str) -> None:
        self.stack.setCurrentWidget(self.browser)
        self.browser.go(Location("folder", path or "/Home"))

    def current_page(self) -> str:
        return next((k for k, w in self.pages.items() if w is self.stack.currentWidget()), "browser")

    def _moved(self, loc: Location) -> None:
        self.stack.setCurrentWidget(self.browser)
        place = "home" if loc.kind == "folder" else ("shared" if loc.kind == "share" else loc.kind)
        self.sidebar.select(place)
        self._selected([])
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

    # ── Details ──
    def toggle_details(self, on: bool) -> None:
        self.details.setVisible(on)
        if on:
            self.details.show_items(self.browser.selected() if self.current_page() == "browser" else [])

    def _selected(self, items) -> None:
        if self.details.isVisible():
            self.details.show_items(items)

    def show_details(self, items) -> None:
        self.info_btn.setChecked(True)
        self.details.show_items(items)

    # ── Opening and downloading ──
    def open_file(self, item, around) -> None:
        viewers.open_item(self, self.s.api, self.s.runner, self.s.palette, item, around)

    def download(self, items) -> None:
        items = [i for i in items if i]
        if not items:
            return
        folder = self.s.settings.downloads_dir
        try:
            self.downloads.add(items, folder)
        except OSError as e:
            dialogs.info(self, "Download", f"Couldn't save to {folder}.\n{e}\nChoose another folder in Settings.")
            return
        n = len(items)
        self.statusBar().showMessage(f"Downloading {n} item{'s' if n != 1 else ''} to {folder}", 6000)
        self.panel.show_now()

    def share(self, item) -> None:
        actions.ShareDialog(self.s.api, self.s.runner, item, self).exec()
        if self.current_page() == "shared-by-me":
            self.shared_by_me.shown()

    # ── New: uploads and folders, always into the folder you're looking at ──
    def _upload_folder(self):
        loc = self.browser.loc
        if self.current_page() != "browser" or not loc.can_upload:
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
        if self.current_page() == "browser":
            if self.browser.loc.kind == "folder" and self.browser.loc.path == getattr(self, "_last_upload_folder", None):
                self.browser.reload()
            elif self.browser.loc.kind == "recent":
                self.browser.reload()
        self.load_storage()

    def _engine_notes(self) -> None:
        for note in self.s.engine.take_notes() + self.downloads.take_notes():
            self.statusBar().showMessage(note, 10000)
        finished = self.downloads.take_finished()
        if finished:
            text = (f"Downloaded {finished[0].name}" if len(finished) == 1 else f"Downloaded {len(finished)} files")
            self.statusBar().showMessage(f"{text} to {self.s.settings.downloads_dir}", 8000)
            if not self.isActiveWindow() and not self._downloads_busy():
                self.toast("Downloads finished", text)
        if self.s.engine.state not in ("ready", "starting"):
            self.statusBar().showMessage(f"Uploads can't run: {self.s.engine.state}")
        self.sidebar.set_badge("transfers", self._uploads_busy() + self._downloads_busy())

    def _uploads_busy(self) -> int:
        return sum(1 for j in self.s.store.all() if j.status in BUSY_UPLOADS)

    def _downloads_busy(self) -> int:
        return sum(1 for d in self.downloads.all() if d.status in DOWNLOAD_ACTIVE)

    # ── Right-click and selection actions ──
    def _refresh_view(self) -> None:
        page = self.current_page()
        if page == "browser":
            self.browser.reload()
        elif page == "photos":
            self.photos.reload()
        elif page in self.pages:
            self.pages[page].shown()

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
            self._refresh_view()
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
        if name == "info":
            self.show_details(items)
        elif name == "rename":
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
            self.share(items[0])
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

    # ── Notifications ──
    def _bell(self) -> None:
        self.bell.setIcon(bell_icon(self.s.palette, self.notes.unread))
        self.bell.setToolTip(f"Notifications ({self.notes.unread} new)" if self.notes.unread else "Notifications")

    def open_notifications(self) -> None:
        self.popup.open_below(self.bell)
        QTimer.singleShot(1500, self.notes.mark_all_read)

    def _new_notifications(self, items) -> None:
        if items and not self.isActiveWindow():
            first = items[0]
            more = f" (+{len(items) - 1} more)" if len(items) > 1 else ""
            self.toast(first.get("title") or "TeleStore", (first.get("body") or "") + more)

    def toast(self, title: str, text: str) -> None:
        if self.tray:
            self.tray.showMessage(title, text, theme.app_icon(), 6000)

    def follow_notification(self, item: dict) -> None:
        target = item.get("target") or {}
        kind = target.get("type")
        if kind == "folder" and target.get("path"):
            self.open_folder(target["path"])
        elif kind == "transfers":
            self.open_place("transfers")
        elif kind == "shared":
            self.open_place("shared")
        elif kind == "settings":
            self.open_place("storage")

    def bring_to_front(self) -> None:
        self.showNormal() if self.isMinimized() else self.show()
        self.raise_()
        self.activateWindow()

    # ── Updates ──
    def _update_available(self, release) -> None:
        self.update_btn.setText(f" Update to {release.version}")
        self.update_btn.setToolTip("A new version of TeleStore is ready to install")
        self.update_btn.show()

    def show_update(self) -> None:
        if self.updater.release:
            UpdateDialog(self.updater.release, self.prepare_for_update, self).exec()

    def check_updates_now(self, channel: str = None) -> None:
        if channel:
            self.s.settings.update_channel = channel
        self.statusBar().showMessage("Looking for updates…", 5000)

        def done(release):
            if release:
                self.show_update()
            else:
                from telestore_desktop import __version__
                dialogs.info(self, "Updates", f"TeleStore {__version__} is the newest version.")

        self.updater.check(done, lambda e: dialogs.info(self, "Updates", str(e)))

    def prepare_for_update(self) -> bool:
        """Stops transfers so the installer can replace the app (uploads continue after the update)."""
        busy = self._uploads_busy() + self._downloads_busy()
        if busy and not dialogs.confirm(self, "Install the update",
                                        f"{busy} transfer(s) are running. Install now?\n"
                                        "Uploads continue after the update; downloads continue when you resume them."):
            return False
        self._shutdown()
        return True

    # ── Account ──
    def account_action(self, key: str) -> None:
        if key == "website":
            QDesktopServices.openUrl(QUrl(self.s.settings.server))
        elif key == "sign-out":
            self.s.sign_out(telegram=False, telestore=True)
        elif key == "updates":
            self.check_updates_now()
        elif key == "settings":
            d = dialogs.SettingsDialog(self.s.settings, self, check_updates=self.check_updates_now)
            if not d.exec():
                return
            if d.sign_out:
                self.s.sign_out(telegram=d.sign_out == "telegram", telestore=d.sign_out == "telestore")
                return
            settings = self.s.settings
            settings.speed_limit_kb = d.speed_limit_kb()
            new_theme = d.theme.currentData()
            changed = new_theme != settings.theme
            settings.theme = new_theme
            settings.direct_open = d.direct.isChecked()
            folder = d.folder.text().strip()
            default = os.path.join(os.path.expanduser("~"), "Downloads")
            settings.download_folder = "" if os.path.normcase(folder) == os.path.normcase(default) else folder
            settings.check_updates = d.auto_update.isChecked()
            settings.update_channel = d.channel.currentData()
            settings.save()
            self.s.engine.set_speed_limit(settings.speed_limit_kb)
            self.s.engine.set_direct_open(settings.direct_open)
            if settings.check_updates and not self.updater.timer.isActive():
                self.updater.timer.start()
            elif not settings.check_updates:
                self.updater.stop()
            if changed:
                dialogs.info(self, "Theme", "The new theme is used the next time TeleStore opens.")

    # ── Window ──
    def resizeEvent(self, event) -> None:
        super().resizeEvent(event)
        if self.panel.isVisible():
            self.panel.place()

    def _shutdown(self) -> None:
        QSettings("TeleStore", "Desktop").setValue("geometry", self.saveGeometry())
        self.status_timer.stop()
        self.panel.timer.stop()
        self.transfers.timer.stop()
        self.transfers.server_timer.stop()
        self.notes.stop()
        self.updater.stop()
        self.downloads.close()
        if self.tray:
            self.tray.hide()
        try:
            self.s.engine.stop()
        except Exception:
            pass

    def closeEvent(self, event) -> None:
        uploads, downloads = self._uploads_busy(), self._downloads_busy()
        if (uploads or downloads) and not dialogs.confirm(
                self, "Transfers running",
                f"{uploads + downloads} transfer(s) are still running. Close anyway?\n"
                "Uploads continue from where they stopped next time you open TeleStore."):
            event.ignore()
            return
        self._shutdown()
        event.accept()
        QApplication.instance() and QApplication.instance().quit()
