"""Sign-in to TeleStore, sign-in to Telegram, and the settings."""

from PySide6.QtCore import Qt
from PySide6.QtWidgets import (QCheckBox, QComboBox, QDialog, QDialogButtonBox, QFormLayout, QHBoxLayout, QInputDialog,
                               QLabel, QLineEdit, QMessageBox, QPushButton, QSpinBox, QStackedWidget, QVBoxLayout,
                               QWidget)

from telestore_desktop.api import ApiError, TeleStoreApi
from telestore_desktop.telegram import SignIn


def _note(text: str) -> QLabel:
    label = QLabel(text)
    label.setWordWrap(True)
    label.setObjectName("muted")
    return label


class LoginDialog(QDialog):
    """TeleStore username and password (the same as on the website)."""

    def __init__(self, runner, server: str, username: str = "", parent=None):
        super().__init__(parent)
        self.runner = runner
        self.api = None
        self.setWindowTitle("Sign in to TeleStore")
        self.setMinimumWidth(420)
        self.server = QLineEdit(server)
        self.username = QLineEdit(username)
        self.password = QLineEdit()
        self.password.setEchoMode(QLineEdit.Password)
        self.error = QLabel()
        self.error.setStyleSheet("color: #c62828;")
        self.error.setWordWrap(True)
        form = QFormLayout()
        form.addRow("Server", self.server)
        form.addRow("Username", self.username)
        form.addRow("Password", self.password)
        self.button = QPushButton("Sign in")
        self.button.setObjectName("primaryButton")
        self.button.setDefault(True)
        self.button.clicked.connect(self._sign_in)
        layout = QVBoxLayout(self)
        layout.addWidget(_note("Use the same username and password as on the TeleStore website."))
        layout.addLayout(form)
        layout.addWidget(self.error)
        layout.addWidget(self.button)
        (self.password if username else self.username).setFocus()

    def _sign_in(self) -> None:
        if not self.username.text().strip() or not self.password.text():
            self.error.setText("Enter your username and password.")
            return
        api = TeleStoreApi(self.server.text().strip() or "https://telegram.backendforge.qd.je")
        self.button.setEnabled(False)
        self.error.setText("Signing in…")

        def ok(_):
            self.api = api
            self.accept()

        def failed(e):
            self.button.setEnabled(True)
            self.error.setText(str(e) if isinstance(e, ApiError) else f"Couldn't sign in: {e}")

        self.runner.run(lambda: api.login(self.username.text(), self.password.text()), ok, failed)


class TelegramDialog(QDialog):
    """Signs in to the person's own Telegram account: phone number, code, and the two-step password."""

    def __init__(self, runner, api_id: int, api_hash: str, parent=None):
        super().__init__(parent)
        self.runner = runner
        self.api_id, self.api_hash = api_id, api_hash
        self.sign_in = None
        self.setWindowTitle("Sign in to Telegram")
        self.setMinimumWidth(440)
        self.pages = QStackedWidget()
        self.phone = QLineEdit()
        self.phone.setPlaceholderText("+91 98765 43210")
        self.code = QLineEdit()
        self.password = QLineEdit()
        self.password.setEchoMode(QLineEdit.Password)
        for text, field in (
            ("Your Telegram phone number, with the country code. Use the account that owns your TeleStore "
             "storage channel. Files are uploaded with this account, straight from this PC.", self.phone),
            ("Telegram sent a code to your Telegram app (or by SMS). Enter it here.", self.code),
            ("This account has two-step verification. Enter its password.", self.password),
        ):
            page = QWidget()
            box = QVBoxLayout(page)
            box.addWidget(_note(text))
            box.addWidget(field)
            box.addStretch()
            self.pages.addWidget(page)
        self.error = QLabel()
        self.error.setStyleSheet("color: #c62828;")
        self.error.setWordWrap(True)
        self.button = QPushButton("Send code")
        self.button.setObjectName("primaryButton")
        self.button.setDefault(True)
        self.button.clicked.connect(self._next)
        layout = QVBoxLayout(self)
        layout.addWidget(self.pages)
        layout.addWidget(self.error)
        layout.addWidget(self.button)
        layout.addWidget(_note("Your Telegram sign-in is saved only on this PC, encrypted for your Windows account."))

    def _busy(self, text: str) -> None:
        self.button.setEnabled(False)
        self.error.setStyleSheet("color: palette(text);")
        self.error.setText(text)

    def _failed(self, e) -> None:
        self.button.setEnabled(True)
        self.error.setStyleSheet("color: #c62828;")
        self.error.setText(str(e))

    def _next(self) -> None:
        step = self.pages.currentIndex()
        if step == 0:
            if not self.phone.text().strip():
                return self._failed("Enter your phone number.")
            self._busy("Asking Telegram for a code…")

            async def send():
                if self.sign_in is None:  # made in the background loop, where it runs
                    self.sign_in = SignIn(self.api_id, self.api_hash)
                await self.sign_in.send_code(self.phone.text())

            self.runner.run(send(), lambda _: self._show(1, "Sign in"), self._failed)
        elif step == 1:
            self._busy("Checking the code…")
            self.runner.run(self.sign_in.enter_code(self.code.text()),
                            lambda signed: self.accept() if signed else self._show(2, "Sign in"), self._failed)
        else:
            self._busy("Checking the password…")
            self.runner.run(self.sign_in.enter_password(self.password.text()), lambda _: self.accept(), self._failed)

    def _show(self, page: int, button: str) -> None:
        self.pages.setCurrentIndex(page)
        self.button.setText(button)
        self.button.setEnabled(True)
        self.error.setText("")
        (self.code if page == 1 else self.password).setFocus()

    def reject(self) -> None:
        if self.sign_in:
            self.runner.run(self.sign_in.cancel())
        super().reject()


class SettingsDialog(QDialog):
    """One simple page: upload speed, theme, and signing out."""

    def __init__(self, settings, parent=None):
        super().__init__(parent)
        self.setWindowTitle("Settings")
        self.setMinimumWidth(440)
        self.sign_out = None  # "telegram" or "telestore" when chosen
        self.limit_on = QCheckBox("Limit upload speed")
        self.limit = QSpinBox()
        self.limit.setRange(1, 1000)
        self.limit.setSuffix(" MB/s")
        self.limit.setMinimumWidth(110)
        on = settings.speed_limit_kb > 0
        self.limit_on.setChecked(on)
        self.limit.setValue(max(1, round(settings.speed_limit_kb / 1024)) if on else 5)
        self.limit.setEnabled(on)
        self.limit_on.toggled.connect(self.limit.setEnabled)
        self.theme = QComboBox()
        for key, text in (("system", "Like Windows"), ("light", "Light"), ("dark", "Dark")):
            self.theme.addItem(text, key)
        self.theme.setCurrentIndex(max(0, self.theme.findData(settings.theme)))
        self.direct = QCheckBox("Open, play and download my files straight from Telegram")
        self.direct.setChecked(settings.direct_open)
        speed = QHBoxLayout()
        speed.addWidget(self.limit_on)
        speed.addWidget(self.limit)
        speed.addStretch()
        form = QFormLayout()
        form.addRow("Uploads", speed)
        form.addRow("Theme", self.theme)
        form.addRow("Viewing", self.direct)
        out_tg = QPushButton("Sign out of Telegram")
        out_tg.clicked.connect(lambda: self._out("telegram"))
        out_ts = QPushButton("Sign out of TeleStore")
        out_ts.clicked.connect(lambda: self._out("telestore"))
        outs = QHBoxLayout()
        outs.addWidget(out_tg)
        outs.addWidget(out_ts)
        outs.addStretch()
        buttons = QDialogButtonBox(QDialogButtonBox.Save | QDialogButtonBox.Cancel)
        buttons.accepted.connect(self.accept)
        buttons.rejected.connect(self.reject)
        layout = QVBoxLayout(self)
        layout.addLayout(form)
        layout.addWidget(_note("Uploads go straight from this PC to your Telegram storage channel. "
                               "Without a limit they use as much of your connection as Telegram allows. "
                               "With straight from Telegram on, your own files open at your home connection's speed "
                               "without using the TeleStore server; shared and Private Vault files still open "
                               "through TeleStore."))
        layout.addSpacing(8)
        layout.addWidget(_note("Account"))
        layout.addLayout(outs)
        layout.addSpacing(8)
        layout.addWidget(buttons)

    def _out(self, which: str) -> None:
        self.sign_out = which
        self.accept()

    def speed_limit_kb(self) -> int:
        return self.limit.value() * 1024 if self.limit_on.isChecked() else 0


def confirm(parent, title: str, text: str) -> bool:
    return QMessageBox.question(parent, title, text, QMessageBox.Yes | QMessageBox.No, QMessageBox.No) == QMessageBox.Yes


def info(parent, title: str, text: str) -> None:
    box = QMessageBox(parent)
    box.setWindowTitle(title)
    box.setText(text)
    box.setTextInteractionFlags(Qt.TextSelectableByMouse)
    box.exec()


def ask_text(parent, title: str, label: str, value: str = "") -> str:
    text, ok = QInputDialog.getText(parent, title, label, QLineEdit.Normal, value)
    return text.strip() if ok else ""
