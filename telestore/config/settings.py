# telestore/config/settings.py

import os 
from dotenv import load_dotenv
from pyrogram.types import ChatPrivileges
load_dotenv()

# Repository root (/app in the container) and the React app built by `npm run build`
PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
FRONTEND_DIR = os.path.join(PROJECT_ROOT, "frontend")
FRONTEND_DIST = os.path.join(FRONTEND_DIR, "dist")
# Scratch space for archives built on the server (zip/7z downloads, archive extraction)
TEMP_ARCHIVE_DIR = os.getenv("TEMP_ARCHIVE_DIR", os.path.join(PROJECT_ROOT, "temp_archives"))

APP_NAME = os.getenv("APP_NAME", "TeleStore")
TIME_ZONE = os.getenv("TIME_ZONE", "+5:30")
WEB_APP = os.getenv("WEB_APP", None)
API_ID = int(os.getenv("API_ID", "0")) if os.getenv("API_ID") else None
API_HASH = str(os.getenv("API_HASH", ""))
LOGGER_BOT = os.getenv("LOGGER_BOT")
OWNER = int(os.getenv("OWNER")) if os.getenv("OWNER") else None
GROUP = int(os.getenv("GROUP")) if os.getenv("GROUP") else None
LOGS = int(os.getenv("LOGS")) if os.getenv("LOGS") else None
MOVIE = int(os.getenv("MOVIE")) if os.getenv("MOVIE") else None
MOVIE_GROUP = int(os.getenv("MOVIE_GRP")) if os.getenv("MOVIE_GRP") else None
FILTER_CHAT = int(os.getenv("FILTER_CHAT")) if os.getenv("FILTER_CHAT") else None
LEECH_SOURCE = int(os.getenv("LEECH_SOURCE")) if os.getenv("LEECH_SOURCE") else None
LEECH_CHAT = int(os.getenv("LEECH_CHAT")) if os.getenv("LEECH_CHAT") else None
DATABASE_URL = str(os.getenv("DATABASE_URL", None))

# Google OAuth Configuration
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "").strip('"\' \t\r\n')
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET", "").strip('"\' \t\r\n')

# Web Server Configuration
PORT = int(os.getenv("PORT", "8000"))
HOST = os.getenv("HOST", "0.0.0.0")
def _required_secret(name, min_length=16, forbidden=()):
    """Read a secret from the environment; refuse to start without a real value."""
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"{name} is not set. Add it to .env (see .env.example).")
    if len(value) < min_length or value in forbidden or value.lower().startswith("change-me"):
        raise RuntimeError(f"{name} is too weak or still the example value. Set a real secret in .env.")
    return value

SESSION_SECRET_KEY = _required_secret(
    "SESSION_SECRET_KEY",
    min_length=32,
    forbidden=("f6d2e3b9a0f43d9a2e6a56b2d3175cd9c05bbfe31d95ed2a7306b57cb1a8b6f0",),
)
WORKER_SECRET_KEY = _required_secret(
    "WORKER_SECRET_KEY",
    min_length=24,
    forbidden=("tele_wsec_7f9a2b8c3d4e5f601a2b3c4d5e6f7a8b",),
)
# Optional: when unset, the GitHub auto-update webhook is disabled.
GITHUB_WEBHOOK_SECRET = os.getenv("GITHUB_WEBHOOK_SECRET", "").strip()

# Admin Credentials & Authorized Emails (Configurable via .env)
DEFAULT_ADMIN_USERNAME = os.getenv("DEFAULT_ADMIN_USERNAME", "admin")
DEFAULT_ADMIN_PASSWORD = _required_secret(
    "DEFAULT_ADMIN_PASSWORD", min_length=12, forbidden=("password", "admin", "changeme")
)

_raw_admin_emails = os.getenv("AUTHORIZED_ADMIN_EMAILS", "")
AUTHORIZED_ADMIN_EMAILS = [e.strip() for e in _raw_admin_emails.split(",") if e.strip()]

# SMTP Email Configuration
SMTP_HOST = os.getenv("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")

TOKENS = []
for i in range(20):
    if (t := os.getenv(f"TOKEN{i}")):
        TOKENS.append(t)


ADMIN=ChatPrivileges(
    can_manage_chat=True,
    can_delete_messages=True,
    can_manage_video_chats=True,
    can_restrict_members=True,
    can_promote_members=True,
    can_change_info=True,
    can_invite_users=True,
    can_pin_messages=True,
    )