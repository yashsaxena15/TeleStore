"""Thumbnails, loaded in the background (a few at a time) and kept in memory and on disk."""

import hashlib
import os
from collections import OrderedDict

from PySide6.QtCore import QObject, QRunnable, QThreadPool, Qt, Signal
from PySide6.QtGui import QImage

from telestore_desktop import paths


class _Signals(QObject):
    loaded = Signal(str, QImage)  # key, image


class _Job(QRunnable):
    def __init__(self, loader, key, url):
        super().__init__()
        self.loader, self.key, self.url = loader, key, url

    def run(self):
        image = QImage()
        try:
            data = self.loader.fetch(self.url)
            image.loadFromData(data)
            if not image.isNull():
                image = image.scaled(512, 512, Qt.KeepAspectRatio, Qt.SmoothTransformation)
                image.save(self.loader.disk_path(self.key), "JPG", 85)
        except Exception:
            pass
        self.loader.signals.loaded.emit(self.key, image)


class ThumbLoader:
    def __init__(self, fetch, workers: int = 6):
        self.fetch = fetch  # url -> bytes (api.fetch)
        self.signals = _Signals()
        self.pool = QThreadPool()
        self.pool.setMaxThreadCount(workers)
        self.memory: "OrderedDict[str, QImage]" = OrderedDict()
        self.pending = set()
        self.dir = os.path.join(paths.data_dir(), "thumbs")
        os.makedirs(self.dir, exist_ok=True)
        self.signals.loaded.connect(self._remember)

    def disk_path(self, key: str) -> str:
        return os.path.join(self.dir, hashlib.sha1(key.encode()).hexdigest() + ".jpg")

    def get(self, key: str, url: str):
        """The image now if it's known, else None (and [loaded] fires when it arrives)."""
        if key in self.memory:
            self.memory.move_to_end(key)
            return self.memory[key]
        cached = self.disk_path(key)
        if os.path.exists(cached):
            image = QImage(cached)
            if not image.isNull():
                self._remember(key, image)
                return image
        if key not in self.pending and url:
            self.pending.add(key)
            self.pool.start(_Job(self, key, url))
        return None

    def _remember(self, key: str, image: QImage) -> None:
        self.pending.discard(key)
        if image.isNull():
            return
        self.memory[key] = image
        while len(self.memory) > 600:
            self.memory.popitem(last=False)

    def clear_queue(self) -> None:
        self.pool.clear()
        self.pending.clear()
