# telestore/services/remote_transfer_manager/pipeline.py

import os
import threading
from typing import Optional, Dict, Any, List


from telestore.services.priority_manager import priority_manager

class PipelinedStreamWriter:
    """
    A file-like streaming buffer that chunks incoming data into 1.95 GB part files.
    As soon as a part reaches 1.95 GB (or stream finishes), it notifies via on_part_ready callback
    which immediately launches an asynchronous background upload to Telegram.
    Uses a semaphore to throttle disk writes (backpressure) so at most 2 parts exist on disk.
    Supports QoS priority auto-pausing when user uploads are active.
    """
    def __init__(
        self,
        tg_dir: str,
        semaphore: threading.Semaphore,
        cancel_event: threading.Event,
        on_part_ready: Any,
        on_pause_state_changed: Optional[Any] = None,
        part_max_size: int = 1950 * 1024 * 1024
    ):
        self.tg_dir = tg_dir
        self.semaphore = semaphore
        self.cancel_event = cancel_event
        self.on_part_ready = on_part_ready
        self.on_pause_state_changed = on_pause_state_changed
        self.part_max_size = part_max_size

        self.current_part_index = 1
        self.current_part_file = None
        self.current_part_path = ""
        self.current_part_bytes = 0
        self.total_bytes = 0
        self.parts: List[Dict[str, Any]] = []
        self._lock = threading.Lock()
        self._closed = False

    def _check_priority_pause(self):
        if priority_manager.is_user_upload_active():
            if self.on_pause_state_changed:
                self.on_pause_state_changed(True)
            while priority_manager.is_user_upload_active():
                if self.cancel_event.is_set():
                    raise InterruptedError("Download cancelled by user")
                priority_manager.wait_if_user_upload_active(timeout=1.0)
            if self.on_pause_state_changed:
                self.on_pause_state_changed(False)

    def _open_next_part(self):
        while not self.cancel_event.is_set():
            self._check_priority_pause()
            acquired = self.semaphore.acquire(timeout=0.5)
            if acquired:
                break
        if self.cancel_event.is_set():
            raise InterruptedError("Download cancelled by user")

        self.current_part_path = os.path.join(self.tg_dir, f"part_{self.current_part_index}.tmp")
        self.current_part_file = open(self.current_part_path, "wb")
        self.current_part_bytes = 0

    def write(self, data: bytes) -> int:
        if self.cancel_event.is_set():
            raise InterruptedError("Download cancelled by user")
        if not data:
            return 0

        self._check_priority_pause()

        with self._lock:
            written = 0
            data_len = len(data)

            while written < data_len:
                if self.cancel_event.is_set():
                    raise InterruptedError("Download cancelled by user")

                self._check_priority_pause()

                if self.current_part_file is None:
                    self._open_next_part()

                space_in_part = self.part_max_size - self.current_part_bytes
                chunk = data[written : written + space_in_part]
                self.current_part_file.write(chunk)
                chunk_len = len(chunk)

                self.current_part_bytes += chunk_len
                self.total_bytes += chunk_len
                written += chunk_len

                if self.current_part_bytes >= self.part_max_size:
                    self._seal_current_part(is_final=False)

            return written

    def _seal_current_part(self, is_final: bool = False):
        if self.current_part_file is None:
            return

        self.current_part_file.flush()
        self.current_part_file.close()
        self.current_part_file = None

        part_size = self.current_part_bytes
        part_index = self.current_part_index
        part_path = self.current_part_path
        start_byte = self.total_bytes - part_size

        is_single_part = is_final and len(self.parts) == 0

        part_info = {
            "part_index": part_index,
            "part_path": part_path,
            "part_size": part_size,
            "start_byte": start_byte,
            "is_single_part": is_single_part
        }
        self.parts.append(part_info)

        self.on_part_ready(
            part_path,
            part_index,
            start_byte,
            part_size,
            is_final,
            is_single_part
        )

        if not is_final:
            self.current_part_index += 1

    def finish(self):
        with self._lock:
            if self._closed:
                return
            self._closed = True
            if self.current_part_file is not None and self.current_part_bytes > 0:
                self._seal_current_part(is_final=True)
            elif len(self.parts) == 0 and self.current_part_file is not None:
                self._seal_current_part(is_final=True)

    def flush(self):
        if self.current_part_file:
            self.current_part_file.flush()

    def tell(self) -> int:
        return self.total_bytes

    def cleanup(self):
        with self._lock:
            if self.current_part_file:
                try:
                    self.current_part_file.close()
                except Exception:
                    pass
                self.current_part_file = None

    def close(self):
        self.finish()
