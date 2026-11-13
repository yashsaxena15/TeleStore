"""Start-up: sign in to TeleStore, then to Telegram, then the main window with the upload engine."""

import logging
import os
import sys
from logging.handlers import RotatingFileHandler
from types import SimpleNamespace

from PySide6.QtCore import QEventLoop
from PySide6.QtWidgets import QApplication, QMessageBox

from telestore_desktop import APP_NAME, __version__, paths, secure_store
from telestore_desktop import telegram as tg
from telestore_desktop.api import ApiError, TeleStoreApi
from telestore_desktop.downloads import DownloadManager
from telestore_desktop.engine import UploadEngine
from telestore_desktop.jobs import JobStore
from telestore_desktop.settings import Settings
from telestore_desktop.ui import diagnostics, dialogs, theme, thumbs
from telestore_desktop.ui.main_window import MainWindow
from telestore_desktop.ui.runner import Runner

AUTH_FILE = "telestore.auth"
log = logging.getLogger("telestore")


def _logging() -> None:
    handler = RotatingFileHandler(paths.path("app.log"), maxBytes=5 * 1024 * 1024, backupCount=3, encoding="utf-8")
    handler.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(name)s: %(message)s"))
    root = logging.getLogger()
    root.addHandler(handler)
    root.setLevel(logging.INFO)
    logging.getLogger("pyrogram").setLevel(logging.WARNING)


def _wait(runner: Runner, work):
    """Runs [work] in the background while the window stays responsive; returns its result or raises."""
    box = {}
    loop = QEventLoop()

    def done(value):
        box["value"] = value
        loop.quit()

    runner.run(work, done, done)
    loop.exec()
    if isinstance(box.get("value"), Exception):
        raise box["value"]
    return box.get("value")


class App:
    def __init__(self):
        self.qt = QApplication.instance() or QApplication(sys.argv)
        self.qt.setApplicationName(APP_NAME)
        self.qt.setApplicationVersion(__version__)
        self.qt.setStyle("Fusion")
        self.qt.setWindowIcon(theme.app_icon())
        self.runner = Runner()
        self.settings = Settings.load()
        self.palette = theme.pick(self.settings.theme)
        self.qt.setStyleSheet(theme.stylesheet(self.palette))
        self.window = None

    def telestore(self):
        """A signed-in TeleStore API, from the saved sign-in or by asking."""
        saved = secure_store.load(AUTH_FILE) or {}
        if saved.get("token") and saved.get("server") == self.settings.server:
            api = TeleStoreApi(self.settings.server, saved["token"])
            try:
                _wait(self.runner, api.check)
                return api
            except ApiError as e:
                if e.status != 401:
                    raise
        d = dialogs.LoginDialog(self.runner, self.settings.server, self.settings.username)
        if not d.exec():
            return None
        self.settings.server = d.api.server
        self.settings.username = d.username.text().strip()
        self.settings.save()
        secure_store.save(AUTH_FILE, {"server": d.api.server, "token": d.api.token})
        return d.api

    def run(self) -> int:
        _logging()
        log.info(f"TeleStore for Windows {__version__} starting")
        self._watchers = diagnostics.install(self.qt)
        while True:
            try:
                api = self.telestore()
                if api is None:
                    return 0
                config = _wait(self.runner, api.direct_config)
            except ApiError as e:
                if e.status == 401:
                    secure_store.forget(AUTH_FILE)
                    continue
                QMessageBox.critical(None, APP_NAME, f"TeleStore isn't available: {e}")
                return 1
            if not tg.has_saved_session():
                d = dialogs.TelegramDialog(self.runner, config["api_id"], config["api_hash"])
                if not d.exec():
                    return 0
            break

        account = tg.TelegramAccount(config["api_id"], config["api_hash"])
        store = JobStore()
        engine = UploadEngine(api, account, store, self.settings.parallel, self.settings.speed_limit_kb, thumbs.make,
                              direct_open=self.settings.direct_open)
        engine.start()
        engine.ready.wait(5)
        state = SimpleNamespace(api=api, engine=engine, store=store, settings=self.settings, runner=self.runner,
                                username=self.settings.username, palette=self.palette, sign_out=self.sign_out,
                                downloads=DownloadManager(api))
        self.window = MainWindow(state)
        self.window.show()
        return self.qt.exec()

    def sign_out(self, telegram: bool, telestore: bool) -> None:
        if not dialogs.confirm(self.window, "Sign out", "Sign out now? The app closes; unfinished uploads stay in the list."):
            return
        self.window._shutdown()
        if telegram:
            tg.forget_session()
        if telestore:
            try:
                self.window.s.api.logout()
            finally:
                secure_store.forget(AUTH_FILE)
        self.qt.quit()


def main() -> None:
    if os.name == "nt":
        try:  # its own taskbar icon and name instead of python's
            import ctypes
            ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID("TeleStore.Desktop")
        except Exception:
            pass
    sys.exit(App().run())
