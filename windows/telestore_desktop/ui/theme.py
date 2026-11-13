"""TeleStore's look: the website's colours (light and dark) and its line icons, for Qt.

The colours come from the website's frontend/src/styles/index.css (light: sky blue on a soft grey,
dark: indigo on near-black). Icons are small SVG line drawings in the style of the website's (lucide).
"""

from dataclasses import dataclass
from functools import lru_cache

from PySide6.QtCore import QByteArray, QRectF, Qt
from PySide6.QtGui import QColor, QGuiApplication, QIcon, QPainter, QPixmap
from PySide6.QtSvg import QSvgRenderer


@dataclass(frozen=True)
class Palette:
    name: str
    background: str
    card: str
    sidebar: str
    text: str
    muted: str
    border: str
    hover: str
    primary: str
    primary_text: str
    selected: str
    danger: str


LIGHT = Palette("light", background="#f1f5f9", card="#f8fafc", sidebar="#f8fafc", text="#0f172a", muted="#64748b",
                border="#e2e8f0", hover="#e2e8f0", primary="#0284c7", primary_text="#ffffff", selected="#e0f2fe",
                danger="#dc2626")
DARK = Palette("dark", background="#0a0a0c", card="#111113", sidebar="#111113", text="#fafafa", muted="#a1a1aa",
               border="#27272a", hover="#1f1f23", primary="#6366f1", primary_text="#ffffff", selected="#1e1b4b",
               danger="#f87171")

KIND_COLORS = {"folder": "#0ea5e9", "video": "#8b5cf6", "photo": "#10b981", "audio": "#f59e0b",
               "document": "#64748b", "pdf": "#ef4444", "archive": "#a16207"}


def system_is_dark() -> bool:
    try:
        return QGuiApplication.styleHints().colorScheme() == Qt.ColorScheme.Dark
    except Exception:
        return False


def pick(choice: str) -> Palette:
    """'light', 'dark' or 'system' (like Windows)."""
    if choice == "light":
        return LIGHT
    if choice == "dark":
        return DARK
    return DARK if system_is_dark() else LIGHT


def stylesheet(p: Palette) -> str:
    return f"""
    QWidget {{ color: {p.text}; font-family: 'Segoe UI', 'Inter', sans-serif; font-size: 13px; }}
    QMainWindow, #content, QDialog {{ background: {p.background}; }}
    #sidebar {{ background: {p.sidebar}; border-right: 1px solid {p.border}; }}
    #brand {{ font-size: 16px; font-weight: 700; }}
    #navButton {{ text-align: left; padding: 7px 10px; border: none; border-radius: 6px; background: transparent; }}
    #navButton:hover {{ background: {p.hover}; }}
    #navButton:checked {{ background: {p.selected}; color: {p.primary}; font-weight: 600; }}
    #newButton {{ background: {p.primary}; color: {p.primary_text}; border: none; border-radius: 8px;
                  padding: 9px 12px; font-weight: 600; text-align: left; }}
    #newButton:hover {{ background: {p.primary}; }}
    #newButton::menu-indicator, #navButton::menu-indicator {{ image: none; }}
    #sectionLabel, #muted {{ color: {p.muted}; font-size: 12px; }}
    #pageTitle {{ font-size: 18px; font-weight: 600; }}
    #crumb {{ border: none; background: transparent; padding: 4px 6px; border-radius: 6px; font-size: 15px; }}
    #crumb:hover {{ background: {p.hover}; }}
    #crumbLast {{ border: none; background: transparent; padding: 4px 6px; font-size: 15px; font-weight: 600; }}
    QLineEdit {{ background: {p.card}; border: 1px solid {p.border}; border-radius: 8px; padding: 7px 10px; }}
    QLineEdit:focus {{ border: 1px solid {p.primary}; }}
    QPushButton {{ background: {p.card}; border: 1px solid {p.border}; border-radius: 8px; padding: 7px 14px; }}
    QPushButton:hover {{ background: {p.hover}; }}
    QPushButton:disabled {{ color: {p.muted}; }}
    #primaryButton {{ background: {p.primary}; color: {p.primary_text}; border: none; font-weight: 600; }}
    #primaryButton:hover {{ background: {p.primary}; }}
    #iconButton {{ border: none; background: transparent; padding: 5px; border-radius: 6px; }}
    #iconButton:hover {{ background: {p.hover}; }}
    #iconButton:checked {{ background: {p.selected}; }}
    QListWidget, QTreeWidget {{ background: {p.background}; border: none; outline: 0; }}
    QListWidget::item {{ border-radius: 10px; padding: 6px; }}
    QListWidget::item:hover, QTreeWidget::item:hover {{ background: {p.hover}; }}
    QListWidget::item:selected, QTreeWidget::item:selected {{ background: {p.selected}; color: {p.text}; }}
    QTreeWidget::item {{ padding: 5px 2px; }}
    QHeaderView::section {{ background: {p.background}; color: {p.muted}; border: none;
                            border-bottom: 1px solid {p.border}; padding: 6px; font-weight: 600; }}
    QMenu {{ background: {p.card}; border: 1px solid {p.border}; border-radius: 8px; padding: 4px; }}
    QMenu::item {{ padding: 7px 24px 7px 10px; border-radius: 6px; }}
    QMenu::item:selected {{ background: {p.hover}; }}
    QMenu::separator {{ height: 1px; background: {p.border}; margin: 4px 6px; }}
    QProgressBar {{ background: {p.border}; border: none; border-radius: 3px; max-height: 6px; text-align: center; }}
    QProgressBar::chunk {{ background: {p.primary}; border-radius: 3px; }}
    #storageBar {{ max-height: 6px; }}
    #uploadsPanel {{ background: {p.card}; border: 1px solid {p.border}; border-radius: 12px; }}
    #uploadsHeader {{ font-weight: 600; }}
    #uploadsPanel QScrollArea, #uploadList, #uploadRow {{ background: {p.card}; }}
    #uploadRow {{ border-top: 1px solid {p.border}; }}
    #empty {{ color: {p.muted}; font-size: 14px; }}
    QScrollBar:vertical {{ background: transparent; width: 10px; margin: 2px; }}
    QScrollBar::handle:vertical {{ background: {p.border}; border-radius: 4px; min-height: 30px; }}
    QScrollBar::add-line, QScrollBar::sub-line {{ height: 0; }}
    QComboBox {{ background: {p.card}; border: 1px solid {p.border}; border-radius: 8px; padding: 6px 8px; }}
    QSpinBox {{ background: {p.card}; border: 1px solid {p.border}; border-radius: 6px; padding: 3px 4px; min-height: 22px; }}
    QToolTip {{ background: {p.card}; color: {p.text}; border: 1px solid {p.border}; }}
    #topbar {{ background: {p.background}; border-bottom: 1px solid {p.border}; }}
    #topSearch {{ background: {p.card}; border-radius: 10px; padding: 8px 12px; }}
    #updateButton {{ background: {p.selected}; color: {p.primary}; border: 1px solid {p.primary}; border-radius: 16px;
                     padding: 5px 12px; font-weight: 600; }}
    #linkButton {{ border: none; background: transparent; color: {p.primary}; padding: 4px 6px; }}
    #linkButton:hover {{ text-decoration: underline; background: transparent; }}
    #chip {{ background: {p.hover}; color: {p.muted}; border-radius: 8px; padding: 1px 7px; font-size: 11px; }}
    #chipButton {{ background: {p.card}; border: 1px solid {p.border}; border-radius: 14px; padding: 5px 12px; }}
    #chipButton:checked {{ background: {p.selected}; color: {p.primary}; border: 1px solid {p.primary}; }}
    #navBadge {{ background: {p.primary}; color: {p.primary_text}; border-radius: 8px; padding: 0 6px; font-size: 11px;
                 font-weight: 600; }}
    #card {{ background: {p.card}; border: 1px solid {p.border}; border-radius: 12px; }}
    #cardList, #transferRow {{ background: {p.card}; }}
    #transferRow {{ border-bottom: 1px solid {p.border}; }}
    #statValue {{ font-size: 20px; font-weight: 700; }}
    #bigValue {{ font-size: 28px; font-weight: 700; }}
    #sectionTitle {{ font-size: 14px; font-weight: 600; }}
    #selectionBar {{ background: {p.selected}; border-radius: 10px; }}
    #detailsPane {{ background: {p.card}; border-left: 1px solid {p.border}; }}
    #detailsBody, #preview {{ background: {p.card}; }}
    #preview {{ border-radius: 10px; }}
    #detailsName {{ font-size: 15px; font-weight: 600; }}
    #popup {{ background: {p.card}; border: 1px solid {p.border}; border-radius: 12px; }}
    #popupList, #notificationRow {{ background: {p.card}; }}
    #notificationRow {{ border-top: 1px solid {p.border}; }}
    #notificationRowNew {{ background: {p.selected}; border-top: 1px solid {p.border}; }}
    #notificationRow:hover, #notificationRowNew:hover {{ background: {p.hover}; }}
    QTabWidget::pane {{ border: none; }}
    QTextBrowser {{ background: {p.card}; border: 1px solid {p.border}; border-radius: 8px; padding: 6px; }}
    """


# Line icons (24x24, stroke), in the style of the website's lucide icons
_PATHS = {
    "home": '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M9.5 21v-6h5v6"/>',
    "clock": '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    "star": '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z"/>',
    "users": '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8"/><path d="M18 14.8c1.9.7 3.1 2.5 3.5 5.2"/>',
    "image": '<rect x="3" y="3" width="18" height="18" rx="2.5"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/>',
    "trash": '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/>',
    "plus": '<path d="M12 5v14M5 12h14"/>',
    "upload": '<path d="M12 15V3"/><path d="m7 8 5-5 5 5"/><path d="M5 15v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4"/>',
    "folder-up": '<path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M12 16v-6M9 13l3-3 3 3"/>',
    "folder-plus": '<path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M12 10v6M9 13h6"/>',
    "folder": '<path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    "file": '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
    "video": '<rect x="2.5" y="6" width="13" height="12" rx="2"/><path d="m15.5 10 6-3.5v11l-6-3.5"/>',
    "audio": '<path d="M9 18V5l11-2v13"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>',
    "search": '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
    "grid": '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    "list": '<path d="M8 6h13M8 12h13M8 18h13"/><path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
    "chevron-right": '<path d="m9 6 6 6-6 6"/>',
    "chevron-down": '<path d="m6 9 6 6 6-6"/>',
    "chevron-up": '<path d="m6 15 6-6 6 6"/>',
    "chevron-left": '<path d="m15 6-6 6 6 6"/>',
    "arrow-left": '<path d="M19 12H5"/><path d="m11 6-6 6 6 6"/>',
    "pause": '<path d="M9 5v14M15 5v14"/>',
    "play": '<path d="M7 4.5v15l12-7.5z"/>',
    "x": '<path d="M6 6l12 12M18 6 6 18"/>',
    "check": '<path d="m5 12.5 4.5 4.5L19 7"/>',
    "alert": '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5h.01"/>',
    "settings": '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    "download": '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>',
    "external": '<path d="M14 4h6v6"/><path d="M20 4 10 14"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/>',
    "refresh": '<path d="M20 11a8 8 0 0 0-14.9-3.5L3 10"/><path d="M3 4v6h6"/><path d="M4 13a8 8 0 0 0 14.9 3.5L21 14"/><path d="M21 20v-6h-6"/>',
    "cloud": '<path d="M7 18a4.5 4.5 0 0 1-.5-9 6 6 0 0 1 11.5 1.5A4 4 0 0 1 17.5 18z"/>',
    "logout": '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="M10 17l-5-5 5-5"/><path d="M5 12h11"/>',
    "volume": '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
    "fullscreen": '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
    "bell": '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/>',
    "info": '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4.5M12 8h.01"/>',
    "share": '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/>',
    "hard-drive": '<path d="M22 12H2"/><path d="M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.1z"/><path d="M6 16h.01M10 16h.01"/>',
    "transfers": '<path d="m21 16-4 4-4-4"/><path d="M17 20V4"/><path d="m3 8 4-4 4 4"/><path d="M7 4v16"/>',
    "link": '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
    "check-circle": '<circle cx="12" cy="12" r="9"/><path d="m8 12.5 3 3 5-6"/>',
    "archive": '<rect x="2.5" y="3.5" width="19" height="5" rx="1"/><path d="M4.5 8.5V19a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V8.5"/><path d="M10 12.5h4"/>',
    "update": '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M3 15v4a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-4"/>',
    "x-circle": '<circle cx="12" cy="12" r="9"/><path d="m15 9-6 6M9 9l6 6"/>',
}


@lru_cache(maxsize=512)
def icon(name: str, color: str, size: int = 20, fill: bool = False) -> QIcon:
    body = _PATHS.get(name, _PATHS["file"])
    fill_attr = color if fill else "none"
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="{fill_attr}" stroke="{color}" '
           f'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">{body}</svg>')
    renderer = QSvgRenderer(QByteArray(svg.encode()))
    result = QIcon()
    for scale in (1, 2):
        pm = QPixmap(size * scale, size * scale)
        pm.fill(Qt.transparent)
        painter = QPainter(pm)
        renderer.render(painter, QRectF(0, 0, size * scale, size * scale))
        painter.end()
        pm.setDevicePixelRatio(scale)
        result.addPixmap(pm)
    return result


def app_icon() -> QIcon:
    """TeleStore's logo (the website's), for the window, the taskbar and the tray."""
    import os
    logo = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "assets", "logo.svg")
    renderer = QSvgRenderer(logo)
    result = QIcon()
    if not renderer.isValid():
        return icon("cloud", "#1F78B4", 32)
    for size in (16, 24, 32, 48, 64, 128, 256):
        pm = QPixmap(size, size)
        pm.fill(Qt.transparent)
        painter = QPainter(pm)
        painter.setRenderHint(QPainter.Antialiasing)
        renderer.render(painter, QRectF(0, 0, size, size))
        painter.end()
        result.addPixmap(pm)
    return result


@lru_cache(maxsize=64)
def tile(kind: str, size: int, background: str) -> QPixmap:
    """The picture for a file without a thumbnail: its kind's icon on a soft coloured card."""
    color = KIND_COLORS.get(kind, KIND_COLORS["document"])
    pm = QPixmap(size * 2, size * 2)
    pm.fill(Qt.transparent)
    painter = QPainter(pm)
    painter.setRenderHint(QPainter.Antialiasing)
    tint = QColor(color)
    tint.setAlpha(28)
    painter.setBrush(tint)
    painter.setPen(Qt.NoPen)
    painter.drawRoundedRect(QRectF(0, 0, size * 2, size * 2), 22, 22)
    name = {"folder": "folder", "video": "video", "photo": "image", "audio": "audio"}.get(kind, "file")
    glyph = icon(name, color, size, fill=(kind == "folder")).pixmap(size, size)
    painter.drawPixmap(int(size * 0.5), int(size * 0.5), size, size, glyph)
    painter.end()
    pm.setDevicePixelRatio(2)
    return pm
