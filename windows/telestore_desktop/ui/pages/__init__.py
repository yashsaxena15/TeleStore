"""The app's pages besides the file browser: Photos, Shared by me, Transfers and Storage."""

from PySide6.QtWidgets import QHBoxLayout, QLabel, QVBoxLayout, QWidget

from telestore_desktop.ui import theme


def page_header(palette, icon: str, title: str, subtitle_label: QLabel, actions=()) -> QHBoxLayout:
    """The website's page header: an icon, the title, a line under it, and buttons on the right."""
    ico = QLabel()
    ico.setPixmap(theme.icon(icon, palette.primary, 22).pixmap(22, 22))
    name = QLabel(title)
    name.setObjectName("pageTitle")
    subtitle_label.setObjectName("muted")
    words = QVBoxLayout()
    words.setSpacing(0)
    words.addWidget(name)
    words.addWidget(subtitle_label)
    row = QHBoxLayout()
    row.setSpacing(10)
    row.addWidget(ico)
    row.addLayout(words)
    row.addStretch()
    for w in actions:
        row.addWidget(w)
    return row


class Page(QWidget):
    """A page: shown() runs each time it comes to the front."""

    def __init__(self):
        super().__init__()
        self.setObjectName("content")

    def shown(self) -> None:
        pass
