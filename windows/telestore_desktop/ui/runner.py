"""Runs slow work (network, Telegram sign-in) off the window's thread and hands the result back."""

import asyncio
import threading
from typing import Any, Callable, Optional

from PySide6.QtCore import QObject, Signal


class _Bridge(QObject):
    done = Signal(object, object, object)  # callback, result, error


class Runner:
    """One background asyncio loop; results come back on the window's thread."""

    def __init__(self):
        self.loop = asyncio.new_event_loop()
        self.bridge = _Bridge()
        self.bridge.done.connect(self._deliver)
        threading.Thread(target=self.loop.run_forever, name="background", daemon=True).start()

    def run(self, work, on_done: Optional[Callable[[Any], None]] = None,
            on_error: Optional[Callable[[Exception], None]] = None) -> None:
        """[work] is a coroutine, or a plain function (run in a worker thread)."""
        async def wrapped():
            return await work if asyncio.iscoroutine(work) else await asyncio.to_thread(work)

        def finished(fut):
            try:
                self.bridge.done.emit(on_done, fut.result(), None)
            except Exception as e:
                self.bridge.done.emit(on_error, None, e)

        asyncio.run_coroutine_threadsafe(wrapped(), self.loop).add_done_callback(finished)

    @staticmethod
    def _deliver(callback, result, error) -> None:
        if callback is None:
            return
        callback(error if error is not None else result)
