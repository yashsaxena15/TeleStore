"""Notes in app.log that help find problems seen on someone's PC: every window the app opens (what it
is, where, its title) and every moment the window froze (the app didn't respond for over half a
second). Nothing is sent anywhere; the log stays in %APPDATA%\\TeleStore."""

import logging
import time

from PySide6.QtCore import QEvent, QObject, QTimer

log = logging.getLogger("telestore.diagnostics")
TICK_MS = 100
STALL_MS = 500


class WindowWatcher(QObject):
    """Logs each top-level window as it appears (a window flashing open and shut shows up here)."""

    def eventFilter(self, obj, event) -> bool:
        try:
            if event.type() == QEvent.Show and obj.isWidgetType() and obj.isWindow():
                g = obj.geometry()
                log.info(f"Window shown: {type(obj).__name__} name={obj.objectName() or '-'} "
                         f"title={obj.windowTitle()!r} at {g.x()},{g.y()} {g.width()}x{g.height()}")
        except Exception:
            pass
        return False


class StallWatcher(QObject):
    """Logs when the window's thread was busy (the app looks frozen or laggy) for too long."""

    def __init__(self):
        super().__init__()
        self.last = time.monotonic()
        self.timer = QTimer(self)
        self.timer.timeout.connect(self._tick)
        self.timer.start(TICK_MS)

    def _tick(self) -> None:
        now = time.monotonic()
        late = (now - self.last) * 1000 - TICK_MS
        self.last = now
        if late > STALL_MS:
            log.warning(f"The window didn't respond for {late:.0f} ms")


def install(app) -> list:
    watcher, stalls = WindowWatcher(app), StallWatcher()
    app.installEventFilter(watcher)
    return [watcher, stalls]  # (kept alive by the caller)
