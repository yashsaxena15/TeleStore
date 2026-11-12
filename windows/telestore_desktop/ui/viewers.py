"""Opening files: photos in a viewer, videos and music in a player, anything else downloaded and opened.

In this version they come through the TeleStore server, as on the website (with the sign-in token in
the address, which the server accepts for players and images).
"""

import os
import re
import sys
import threading
from typing import List

from PySide6.QtCore import QObject, Qt, QUrl, Signal
from PySide6.QtGui import QDesktopServices, QImage, QKeySequence, QPixmap, QShortcut
from PySide6.QtWidgets import (QDialog, QFileDialog, QHBoxLayout, QLabel, QProgressDialog, QPushButton, QSlider,
                               QVBoxLayout, QWidget)

from telestore_desktop import paths
from telestore_desktop.items import VIEWABLE_PHOTO, Item
from telestore_desktop.parts import size_text
from telestore_desktop.ui import theme


def _clock(ms: int) -> str:
    s = max(0, ms // 1000)
    return f"{s // 3600}:{s // 60 % 60:02d}:{s % 60:02d}" if s >= 3600 else f"{s // 60}:{s % 60:02d}"


def safe_name(name: str) -> str:
    return re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", name).strip(" .") or "file"


class ImageViewer(QDialog):
    """A photo, full size; ← → for the previous and next photo in the folder, Esc to close."""

    def __init__(self, api, runner, photos: List[Item], index: int, parent=None):
        super().__init__(parent)
        self.api, self.runner, self.photos, self.index = api, runner, photos, index
        self.setWindowTitle("TeleStore")
        self.resize(1100, 760)
        self.setStyleSheet("QDialog { background: #000; } QLabel { color: #e5e5e5; } "
                           "QPushButton { background: rgba(255,255,255,0.08); color: #fff; border: none; border-radius: 20px; padding: 10px; }"
                           "QPushButton:hover { background: rgba(255,255,255,0.18); }")
        self.title = QLabel()
        self.title.setAlignment(Qt.AlignCenter)
        self.picture = QLabel("Loading…")
        self.picture.setAlignment(Qt.AlignCenter)
        self.picture.setMinimumSize(200, 200)
        prev_b, next_b = QPushButton(), QPushButton()
        prev_b.setIcon(theme.icon("chevron-left", "#ffffff", 22))
        next_b.setIcon(theme.icon("chevron-right", "#ffffff", 22))
        prev_b.clicked.connect(lambda: self.step(-1))
        next_b.clicked.connect(lambda: self.step(1))
        save = QPushButton("  Download")
        save.setIcon(theme.icon("download", "#ffffff", 18))
        save.clicked.connect(lambda: save_as(self, self.api, self.runner, self.photos[self.index]))
        row = QHBoxLayout()
        row.addWidget(prev_b)
        row.addWidget(self.picture, 1)
        row.addWidget(next_b)
        top = QHBoxLayout()
        top.addWidget(self.title, 1)
        top.addWidget(save)
        box = QVBoxLayout(self)
        box.addLayout(top)
        box.addLayout(row, 1)
        self.image = QImage()
        QShortcut(QKeySequence(Qt.Key_Left), self, activated=lambda: self.step(-1))
        QShortcut(QKeySequence(Qt.Key_Right), self, activated=lambda: self.step(1))
        self.load()

    def step(self, delta: int) -> None:
        if self.photos:
            self.index = (self.index + delta) % len(self.photos)
            self.load()

    def load(self) -> None:
        item = self.photos[self.index]
        self.title.setText(f"{item.name}   ·   {self.index + 1} of {len(self.photos)}")
        self.picture.setText("Loading…")
        self.picture.setPixmap(QPixmap())
        want = self.index
        # Photos Qt can't show (HEIC…) come as the server's preview
        url = self.api.file_url(item) if item.ext in VIEWABLE_PHOTO else (self.api.thumbnail_url(item) or self.api.file_url(item))

        def shown(data):
            if want != self.index:
                return
            self.image = QImage()
            self.image.loadFromData(data)
            if self.image.isNull():
                self.picture.setText("This photo can't be shown here. Use Download to open it.")
            else:
                self._fit()

        self.runner.run(lambda: self.api.fetch(url, timeout=120), shown,
                        lambda e: self.picture.setText(f"Couldn't load the photo.\n{e}"))

    def _fit(self) -> None:
        if not self.image.isNull():
            ratio = self.devicePixelRatioF()
            pm = QPixmap.fromImage(self.image.scaled(int(self.picture.width() * ratio), int(self.picture.height() * ratio),
                                                     Qt.KeepAspectRatio, Qt.SmoothTransformation))
            pm.setDevicePixelRatio(ratio)
            self.picture.setPixmap(pm)

    def resizeEvent(self, event) -> None:
        super().resizeEvent(event)
        self._fit()


class Player(QWidget):
    """A video or song, streamed from TeleStore: play/pause (Space), seek, volume, full screen (F or double-click)."""

    def __init__(self, api, runner, item: Item, palette):
        super().__init__()
        from PySide6.QtMultimedia import QAudioOutput, QMediaPlayer
        from PySide6.QtMultimediaWidgets import QVideoWidget
        self.api, self.runner, self.item = api, runner, item
        self.setWindowTitle(f"{item.name} – TeleStore")
        self.setAttribute(Qt.WA_DeleteOnClose)
        self.resize(1100, 680 if item.kind == "video" else 260)
        self.setStyleSheet("QWidget { background: #0a0a0c; color: #e5e5e5; } QPushButton { border: none; padding: 6px; border-radius: 6px; }"
                           "QPushButton:hover { background: #1f1f23; }")
        self.player = QMediaPlayer(self)
        self.audio = QAudioOutput(self)
        self.player.setAudioOutput(self.audio)
        self.video = QVideoWidget()
        self.player.setVideoOutput(self.video)
        self.note = QLabel()
        self.note.setAlignment(Qt.AlignCenter)
        self.note.setWordWrap(True)
        if item.kind != "video":
            self.video.hide()
            self.note.setPixmap(theme.icon("audio", "#f59e0b", 72).pixmap(72, 72))
        self.play_b = QPushButton()
        self.play_b.clicked.connect(self.toggle)
        self.seek = QSlider(Qt.Horizontal)
        self.seek.sliderMoved.connect(self.player.setPosition)
        self.time = QLabel("0:00 / 0:00")
        vol_icon = QLabel()
        vol_icon.setPixmap(theme.icon("volume", "#e5e5e5", 18).pixmap(18, 18))
        self.volume = QSlider(Qt.Horizontal)
        self.volume.setRange(0, 100)
        self.volume.setValue(80)
        self.volume.setFixedWidth(100)
        self.volume.valueChanged.connect(lambda v: self.audio.setVolume(v / 100))
        self.audio.setVolume(0.8)
        full = QPushButton()
        full.setIcon(theme.icon("fullscreen", "#e5e5e5", 18))
        full.clicked.connect(self.toggle_full)
        full.setVisible(item.kind == "video")
        controls = QHBoxLayout()
        controls.addWidget(self.play_b)
        controls.addWidget(self.seek, 1)
        controls.addWidget(self.time)
        controls.addSpacing(10)
        controls.addWidget(vol_icon)
        controls.addWidget(self.volume)
        controls.addWidget(full)
        self.controls = QWidget()
        self.controls.setLayout(controls)
        title = QLabel(item.name)
        title.setAlignment(Qt.AlignCenter)
        box = QVBoxLayout(self)
        box.setContentsMargins(0, 0, 0, 0)
        box.addWidget(self.video, 1)
        box.addWidget(self.note, 0 if item.kind == "video" else 1)
        box.addWidget(title)
        box.addWidget(self.controls)
        self.player.positionChanged.connect(self._position)
        self.player.durationChanged.connect(lambda d: self.seek.setRange(0, d))
        self.player.playbackStateChanged.connect(lambda _s: self._icons())
        self.player.errorOccurred.connect(self._error)
        QShortcut(QKeySequence(Qt.Key_Space), self, activated=self.toggle)
        QShortcut(QKeySequence(Qt.Key_F), self, activated=self.toggle_full)
        QShortcut(QKeySequence(Qt.Key_Escape), self, activated=self._escape)
        QShortcut(QKeySequence(Qt.Key_Right), self, activated=lambda: self.player.setPosition(self.player.position() + 10000))
        QShortcut(QKeySequence(Qt.Key_Left), self, activated=lambda: self.player.setPosition(max(0, self.player.position() - 10000)))
        self._icons()
        self.player.setSource(QUrl(api.file_url(item)))
        self.player.play()

    def _icons(self) -> None:
        from PySide6.QtMultimedia import QMediaPlayer
        playing = self.player.playbackState() == QMediaPlayer.PlayingState
        self.play_b.setIcon(theme.icon("pause" if playing else "play", "#e5e5e5", 20))

    def toggle(self) -> None:
        from PySide6.QtMultimedia import QMediaPlayer
        if self.player.playbackState() == QMediaPlayer.PlayingState:
            self.player.pause()
        else:
            self.player.play()

    def toggle_full(self) -> None:
        if self.item.kind == "video":
            self.showNormal() if self.isFullScreen() else self.showFullScreen()

    def _escape(self) -> None:
        if self.isFullScreen():
            self.showNormal()
        else:
            self.close()

    def mouseDoubleClickEvent(self, event) -> None:
        self.toggle_full()

    def _position(self, ms: int) -> None:
        if not self.seek.isSliderDown():
            self.seek.setValue(ms)
        self.time.setText(f"{_clock(ms)} / {_clock(self.player.duration())}")

    def _error(self, *_args) -> None:
        self.video.hide()
        self.note.setPixmap(QPixmap())
        self.note.setText(f"This file can't be played here ({self.player.errorString() or 'unsupported format'}).\n"
                          "Use Download to open it in another player.")

    def closeEvent(self, event) -> None:
        self.player.stop()
        super().closeEvent(event)


class _Progress(QObject):
    step = Signal(int, int)
    done = Signal(object)


def _download(parent, api, item: Item, target: str, then=None) -> None:
    """Downloads with a progress window (Cancel stops it)."""
    box = QProgressDialog(f"Downloading {item.name}…", "Cancel", 0, 1000, parent)
    box.setWindowTitle("TeleStore")
    box.setWindowModality(Qt.WindowModal)
    box.setMinimumDuration(300)
    box.setAutoClose(False)
    signals = _Progress(box)
    stop = threading.Event()
    box.canceled.connect(stop.set)

    def step(done, total):
        if total:
            box.setValue(int(done / total * 1000))
            box.setLabelText(f"Downloading {item.name}…\n{size_text(done)} of {size_text(total)}")
        else:
            box.setLabelText(f"Downloading {item.name}…\n{size_text(done)}")

    def finished(error):
        box.close()
        if error is None and then:
            then(target)
        elif error is not None and not stop.is_set():
            from telestore_desktop.ui.dialogs import info
            info(parent, "Download failed", f"Couldn't download {item.name}.\n{error}")

    signals.step.connect(step)
    signals.done.connect(finished)

    def work():
        try:
            api.download(api.file_url(item, inline=False), target,
                         lambda d, t: (signals.step.emit(d, t), not stop.is_set())[1])
            signals.done.emit(None)
        except Exception as e:
            signals.done.emit(e)

    threading.Thread(target=work, daemon=True).start()
    box.show()


def save_as(parent, api, runner, item: Item) -> None:
    downloads = os.path.join(os.path.expanduser("~"), "Downloads")
    target, _ = QFileDialog.getSaveFileName(parent, "Save as", os.path.join(downloads, safe_name(item.name)))
    if target:
        _download(parent, api, item, target, then=lambda path: None)


def open_with_windows(path: str) -> None:
    if sys.platform == "win32":
        os.startfile(path)  # type: ignore[attr-defined]
    else:
        QDesktopServices.openUrl(QUrl.fromLocalFile(path))


def open_item(parent, api, runner, palette, item: Item, siblings: List[Item]) -> None:
    if item.kind == "photo":
        photos = [i for i in siblings if i.kind == "photo"] or [item]
        index = next((n for n, i in enumerate(photos) if i.id == item.id), 0)
        ImageViewer(api, runner, photos, index, parent).show()
        return
    if item.kind in ("video", "audio"):
        player = Player(api, runner, item, palette)
        player.show()
        parent._players = [p for p in getattr(parent, "_players", []) if p.isVisible()] + [player]
        return
    # Anything else: download to the app's own folder, then open it with its Windows app
    folder = os.path.join(paths.data_dir(), "opened")
    os.makedirs(folder, exist_ok=True)
    target = os.path.join(folder, f"{item.id[:8]}_{safe_name(item.name)}")
    if os.path.exists(target) and os.path.getsize(target) == item.size:
        open_with_windows(target)
        return
    _download(parent, api, item, target, then=open_with_windows)
