"""Reading one part of a big file straight from the original, with no copy on disk."""

import io
import os


class PartReader(io.RawIOBase):
    """A read-only window [start, start + length) of a file, which looks like a whole file of its own
    (Telegram's client seeks to its end for the size, then reads it in 512 KB pieces)."""

    def __init__(self, path: str, start: int, length: int, name: str):
        super().__init__()
        self._f = open(path, "rb")
        self._start, self._length, self._pos = start, length, 0
        self.name = name

    def readable(self) -> bool:
        return True

    def seekable(self) -> bool:
        return True

    def tell(self) -> int:
        return self._pos

    def seek(self, offset: int, whence: int = io.SEEK_SET) -> int:
        base = {io.SEEK_SET: 0, io.SEEK_CUR: self._pos, io.SEEK_END: self._length}[whence]
        self._pos = max(0, min(self._length, base + offset))
        return self._pos

    def read(self, size: int = -1) -> bytes:
        left = self._length - self._pos
        if left <= 0:
            return b""
        size = left if size is None or size < 0 else min(size, left)
        self._f.seek(self._start + self._pos)
        data = self._f.read(size)
        self._pos += len(data)
        return data

    def readinto(self, b) -> int:
        data = self.read(len(b))
        b[:len(data)] = data
        return len(data)

    def close(self) -> None:
        try:
            self._f.close()
        finally:
            super().close()


def file_key(path: str, dest: str) -> str:
    """Which upload a file is, across restarts: the same file (path, size, modified) to the same folder."""
    st = os.stat(path)
    return f"{os.path.abspath(path)}|{st.st_size}|{int(st.st_mtime)}|{dest}"


def size_text(n: float) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024 or unit == "GB":
            return f"{n:.0f} {unit}" if unit == "B" else f"{n:.1f} {unit}"
        n /= 1024
    return f"{n:.1f} TB"
