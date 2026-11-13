"""In-app updates: a check at start and every few hours, a button in the top bar when a new version
is out, and the update window (what's new, download with progress, install and reopen)."""

import threading

from PySide6.QtCore import QObject, QTimer, QUrl, Signal
from PySide6.QtGui import QDesktopServices
from PySide6.QtWidgets import QDialog, QHBoxLayout, QLabel, QProgressBar, QPushButton, QTextBrowser, QVBoxLayout

from telestore_desktop import __version__, updates
from telestore_desktop.parts import size_text

EVERY_MS = 6 * 3600 * 1000


class UpdateNotifier(QObject):
    available = Signal(object)  # updates.Release

    def __init__(self, runner, settings, first_delay_ms: int = 8000):
        super().__init__()
        self.runner, self.settings = runner, settings
        self.release = None
        self.timer = QTimer(self)
        self.timer.timeout.connect(self.check)
        if settings.check_updates:
            QTimer.singleShot(first_delay_ms, self.check)
            self.timer.start(EVERY_MS)

    def check(self, on_done=None, on_error=None) -> None:
        def found(release):
            self.release = release
            if release:
                self.available.emit(release)
            if on_done:
                on_done(release)

        self.runner.run(lambda: updates.check(self.settings.update_channel), found,
                        on_error or (lambda e: None))

    def stop(self) -> None:
        self.timer.stop()


class _Progress(QObject):
    step = Signal(int, int)
    done = Signal(object, object)  # path, error


class UpdateDialog(QDialog):
    """What's new, then Install now: downloads the installer, closes TeleStore and installs it."""

    def __init__(self, release, before_install, parent=None):
        super().__init__(parent)
        self.release, self.before_install = release, before_install
        self.setWindowTitle("Update TeleStore")
        self.setMinimumWidth(480)
        self.stop = threading.Event()
        title = QLabel(f"TeleStore {release.version} is available")
        title.setObjectName("pageTitle")
        sub = QLabel(f"You have {__version__}. "
                     + ("The update installs by itself and TeleStore opens again." if updates.installed()
                        else "This runs the TeleStore installer; after it, TeleStore updates itself."))
        sub.setObjectName("muted")
        sub.setWordWrap(True)
        notes = QTextBrowser()
        notes.setOpenExternalLinks(True)
        notes.setMarkdown(release.notes or "Fixes and improvements.")
        notes.setMaximumHeight(180)
        self.bar = QProgressBar()
        self.bar.setRange(0, 1000)
        self.bar.setTextVisible(False)
        self.bar.hide()
        self.status = QLabel()
        self.status.setObjectName("muted")
        self.status.setWordWrap(True)
        page = QPushButton("Release page")
        page.clicked.connect(lambda: QDesktopServices.openUrl(QUrl(release.page_url)))
        later = QPushButton("Later")
        later.clicked.connect(self.reject)
        self.install = QPushButton("Install now" + (f" ({size_text(release.size)})" if release.size else ""))
        self.install.setObjectName("primaryButton")
        self.install.setDefault(True)
        self.install.clicked.connect(self.start)
        buttons = QHBoxLayout()
        buttons.addWidget(page)
        buttons.addStretch()
        buttons.addWidget(later)
        buttons.addWidget(self.install)
        box = QVBoxLayout(self)
        box.addWidget(title)
        box.addWidget(sub)
        box.addWidget(notes)
        box.addWidget(self.bar)
        box.addWidget(self.status)
        box.addLayout(buttons)
        self.signals = _Progress(self)
        self.signals.step.connect(self._step)
        self.signals.done.connect(self._downloaded)

    def start(self) -> None:
        self.install.setEnabled(False)
        self.bar.show()
        self.status.setText("Downloading the update…")

        def work():
            try:
                path = updates.download(self.release, lambda d, t: (self.signals.step.emit(d, t), not self.stop.is_set())[1])
                self.signals.done.emit(path, None)
            except Exception as e:
                self.signals.done.emit(None, e)

        threading.Thread(target=work, daemon=True).start()

    def _step(self, done: int, total: int) -> None:
        if total:
            self.bar.setValue(int(done / total * 1000))
            self.status.setText(f"Downloading the update… {size_text(done)} of {size_text(total)}")

    def _downloaded(self, path, error) -> None:
        if error is not None:
            if not self.stop.is_set():
                self.status.setText(f"Couldn't download the update: {error}")
                self.install.setEnabled(True)
                self.install.setText("Try again")
            return
        self.status.setText("Installing… TeleStore closes and opens again in a moment.")
        if not self.before_install():  # e.g. uploads running and the person said not now
            self.status.setText("The update is downloaded. Install it when you're ready.")
            self.install.setEnabled(True)
            self.install.setText("Install now")
            return
        try:
            updates.run_installer(path, quiet=updates.installed())
        except OSError as e:
            self.status.setText(f"Couldn't start the installer: {e}")
            self.install.setEnabled(True)
            return
        self.accept()
        from PySide6.QtWidgets import QApplication
        QApplication.quit()

    def reject(self) -> None:
        self.stop.set()
        super().reject()
