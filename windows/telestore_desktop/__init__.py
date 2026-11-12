"""TeleStore for Windows: uploads straight from this PC to the person's own Telegram storage channel.

No file data passes through the TeleStore server: the app signs in to TeleStore (to know where files
go and to save them) and to the person's own Telegram account (to upload). See windows/README.md.
"""

__version__ = "1.0.0"
APP_NAME = "TeleStore"
DEFAULT_SERVER = "https://telegram.backendforge.qd.je"
