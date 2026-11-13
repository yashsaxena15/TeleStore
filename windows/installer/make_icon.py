"""Makes installer/TeleStore.ico from the website's logo (telestore_desktop/assets/logo.svg), for the
.exe, the installer and the Start menu. Run by CI before PyInstaller; needs only PySide6."""

import os
import struct
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SIZES = (16, 24, 32, 48, 64, 128, 256)


def render(svg: str, size: int) -> bytes:
    from PySide6.QtCore import QBuffer, QByteArray, QIODevice, QRectF, Qt
    from PySide6.QtGui import QImage, QPainter
    from PySide6.QtSvg import QSvgRenderer
    renderer = QSvgRenderer(svg)
    if not renderer.isValid():
        raise SystemExit(f"Can't read {svg}")
    image = QImage(size, size, QImage.Format_ARGB32)
    image.fill(Qt.transparent)
    painter = QPainter(image)
    painter.setRenderHint(QPainter.Antialiasing)
    renderer.render(painter, QRectF(0, 0, size, size))
    painter.end()
    data = QByteArray()
    buf = QBuffer(data)
    buf.open(QIODevice.WriteOnly)
    image.save(buf, "PNG")
    return bytes(data)


def ico(pngs) -> bytes:
    """An .ico holding PNG images (Windows Vista and later read these)."""
    header = struct.pack("<HHH", 0, 1, len(pngs))
    entries, blobs, offset = b"", b"", 6 + 16 * len(pngs)
    for size, png in pngs:
        dim = 0 if size >= 256 else size
        entries += struct.pack("<BBBBHHII", dim, dim, 0, 0, 1, 32, len(png), offset)
        blobs += png
        offset += len(png)
    return header + entries + blobs


def main() -> None:
    from PySide6.QtGui import QGuiApplication
    os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
    _app = QGuiApplication.instance() or QGuiApplication(sys.argv[:1])
    svg = os.path.join(HERE, "..", "telestore_desktop", "assets", "logo.svg")
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "TeleStore.ico")
    with open(out, "wb") as f:
        f.write(ico([(s, render(svg, s)) for s in SIZES]))
    print(f"Wrote {out}")


if __name__ == "__main__":
    main()
