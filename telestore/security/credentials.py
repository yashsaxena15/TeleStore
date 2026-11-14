from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPBearer
from typing import Optional
import hmac
import logging
from telestore.config import DEFAULT_ADMIN_USERNAME, DEFAULT_ADMIN_PASSWORD
from telestore.db import database
from pydantic import BaseModel
from telestore.security.attempt_limiter import TooManyAttempts, password_limiter

# Set up logging
logger = logging.getLogger(__name__)

# User class to hold full user information
class User(BaseModel):
    username: str
    email: Optional[str] = None
    telegram_user_id: Optional[int] = None
    telegram_username: Optional[str] = None
    telegram_first_name: Optional[str] = None
    telegram_last_name: Optional[str] = None
    telegram_profile_picture: Optional[str] = None
    # Set by the owner in Settings › Users (missing means allowed)
    active: bool = True
    can_upload: bool = True
    # Compress, extract and look inside archives (Settings › Server, and per user)
    archives: bool = True
    # Leeches, torrents, video / Instagram downloads and Google Drive (Settings › Users); require_auth
    # always sets it from the owner's choice (cloud_allowed), the default only matters to tests
    cloud: bool = True

# Fallback admin, used only when the username is not in the database.
# Both values come from .env (DEFAULT_ADMIN_PASSWORD is required by telestore.config).
USERNAME = DEFAULT_ADMIN_USERNAME


security = HTTPBearer(auto_error=False)

def verify_password(password: str) -> bool:
    return hmac.compare_digest(password.encode("utf-8"), DEFAULT_ADMIN_PASSWORD.encode("utf-8"))

def verify_credentials(username: str, password: str) -> bool:
    logger.info(f"Verifying credentials for username: '{username}'")
    
    # First, try to verify against the database
    try:
        # Check if user exists in database
        user_data = database.Users.getUser(username)
        if user_data:
            logger.info(f"User {username} found in database, verifying credentials")
            # Verify credentials using database method
            return database.Users.verify_user_credentials(username, password)
    except Exception as e:
        logger.error(f"Error checking database for user {username}: {e}")
    
    # If not found in database, fall back to default admin credentials
    logger.info(f"User {username} not found in database, checking against default admin credentials")
    is_username_valid = username == USERNAME
    is_password_valid = verify_password(password)
    return is_username_valid and is_password_valid

def canonical_username(username: Optional[str]) -> str:
    """The stored spelling of a typed username: spaces around it and letter case don't matter
    (phone keyboards add a trailing space and capitalise the first letter). An email address works
    too: it finds the one account with that email (none if two accounts share it)."""
    import re
    name = (username or "").strip()
    if not name:
        return name
    try:
        if database.Users.getUser(name):
            return name
        doc = database.Users.find_one({"username": {"$regex": f"^{re.escape(name)}$", "$options": "i"}})
        if doc and isinstance(doc.get("username"), str):
            return doc["username"]
        if "@" in name:
            email = name.lower()
            found = [d.get("username") for d in database.Users.get_all_users() or []
                     if isinstance(d.get("username"), str) and (d.get("email") or "").strip().lower() == email]
            if len(found) == 1:
                return found[0]
    except Exception as e:
        logger.error(f"Username lookup failed for '{name}': {e}")
    return name


def check_login(username: str, password: str) -> Optional[str]:
    """verify_credentials with brute-force protection for every password sign-in.

    Returns the account's stored username when the password is right, else None.
    Raises TooManyAttempts while the username is locked, including when this failure starts a lock.
    """
    name = canonical_username(username)
    key = f"pw:{name.lower()}"
    password_limiter.check(key)
    if verify_credentials(name, password):
        password_limiter.success(key)
        return name
    lock = password_limiter.failure(key)
    if lock:
        logger.warning(f"Password sign-in for '{name}' locked for {lock}s after repeated failures")
        raise TooManyAttempts(lock)
    return None

ACCOUNT_DISABLED = "This account has been turned off. Ask the owner to turn it back on."
UPLOADS_DISABLED = "Uploading is turned off for this account. Ask the owner to turn it on."
ARCHIVES_DISABLED = "Compress and extract are turned off by the owner."
# A user's archive tools: follow the server's switch, or always allow / block them for this user
ARCHIVE_CHOICES = ("default", "allow", "block")
CLOUD_DISABLED = ("Cloud features (leeching links and torrents, video downloads, Instagram, Google Drive) "
                  "use the server's bandwidth, so the owner turns them on per user. Ask the owner to allow them.")
# A user's cloud features: follow the server's switch, or always allow / block them for this user
CLOUD_CHOICES = ARCHIVE_CHOICES


def is_owner_account(username: Optional[str], user_data: Optional[dict]) -> bool:
    """The admin login and the Telegram OWNER can never be turned off or limited."""
    from telestore.config import OWNER
    if username == "admin":
        return True
    tg_id = (user_data or {}).get("telegram_user_id")
    try:
        return OWNER is not None and tg_id is not None and int(tg_id) == int(OWNER)
    except (TypeError, ValueError):
        return False


def account_flags(username: Optional[str], user_data: Optional[dict]) -> tuple:
    """(active, can_upload) for a user record; missing values mean allowed."""
    if is_owner_account(username, user_data):
        return True, True
    data = user_data or {}
    return data.get("active", True) is not False, data.get("can_upload", True) is not False


def _session_signed_in(request: Request) -> bool:
    """The browser's cookie session, unless that sign-in was ended from another device."""
    if not request.session.get("authenticated"):
        return False
    from telestore.services import device_service
    if device_service.session_valid(request):
        return True
    request.session.clear()
    return False


def is_authenticated(request: Request) -> bool:
    auth_status = _session_signed_in(request)
    logger.info(f"Checking authentication status: {auth_status}")
    return auth_status

def is_admin(request: Request) -> bool:
    """Check if the authenticated user is an admin"""
    if not is_authenticated(request):
        return False
    
    # Check if user authenticated via username/password (always admin)
    if request.session.get("auth_method") == "local":
        return True
        
    return False

def archive_choice(user_data: Optional[dict]) -> str:
    choice = (user_data or {}).get("archives")
    return choice if choice in ARCHIVE_CHOICES else "default"


def archives_allowed(user_data: Optional[dict]) -> bool:
    """Compress, extract and look inside: the user's own setting, else the server's switch."""
    choice = archive_choice(user_data)
    if choice != "default":
        return choice == "allow"
    from telestore.services import server_settings
    return bool(server_settings.get()["archives_enabled"])


def cloud_choice(user_data: Optional[dict]) -> str:
    choice = (user_data or {}).get("cloud")
    return choice if choice in CLOUD_CHOICES else "default"


def cloud_allowed(username: Optional[str], user_data: Optional[dict]) -> bool:
    """Cloud leeches, torrents, video and Instagram downloads, Google Drive: they cost the server's
    bandwidth, so the owner decides. The owner always has them; others follow their own setting, else
    the server's switch (off unless the owner turns it on)."""
    if is_owner_account(username, user_data):
        return True
    choice = cloud_choice(user_data)
    if choice != "default":
        return choice == "allow"
    from telestore.services import server_settings
    return bool(server_settings.get().get("cloud_enabled", False))


def _with_account_flags(user: User, user_data: Optional[dict]) -> User:
    active, can_upload = account_flags(user.username, user_data)
    if not active:
        # A turned-off account stops working on its next request, even with an open session
        raise HTTPException(status_code=403, detail=ACCOUNT_DISABLED)
    user.active, user.can_upload = active, can_upload
    user.archives = archives_allowed(user_data)
    user.cloud = cloud_allowed(user.username, user_data)
    return user


def require_auth(request: Request) -> User:
    # Check session first
    if _session_signed_in(request):
        # For local auth, return the username
        username = request.session.get("username")
        # Get user data from database
        user_data = database.Users.getUser(username)
        
        # Create User object with all available information
        user = User(
            username=username,
            email=request.session.get("user_email") or (user_data.get("email") if user_data else None),
            telegram_user_id=user_data.get("telegram_user_id") if user_data else None,
            telegram_username=user_data.get("telegram_username") if user_data else None,
            telegram_first_name=user_data.get("telegram_first_name") if user_data else None,
            telegram_last_name=user_data.get("telegram_last_name") if user_data else None,
            telegram_profile_picture=user_data.get("telegram_profile_picture") if user_data else None
        )
        return _with_account_flags(user, user_data)
    
    # Check if authenticated via token (from middleware)
    if hasattr(request.state, 'authenticated_via_token') and request.state.authenticated_via_token:
        # Return the username from token data
        token_data = getattr(request.state, 'auth_token_data', {})
        username = token_data.get("username")
        # Get user data from database
        user_data = database.Users.getUser(username)
        
        # Create User object with all available information
        user = User(
            username=username,
            email=token_data.get("user_email") or (user_data.get("email") if user_data else None),
            telegram_user_id=user_data.get("telegram_user_id") if user_data else None,
            telegram_username=user_data.get("telegram_username") if user_data else None,
            telegram_first_name=user_data.get("telegram_first_name") if user_data else None,
            telegram_last_name=user_data.get("telegram_last_name") if user_data else None,
            telegram_profile_picture=user_data.get("telegram_profile_picture") if user_data else None
        )
        return _with_account_flags(user, user_data)
    
    raise HTTPException(status_code=401, detail="Authentication required")

def require_admin(request: Request):
    """Require admin privileges"""
    if not is_authenticated(request):
        raise HTTPException(status_code=401, detail="Authentication required")
    
    if not is_admin(request):
        raise HTTPException(status_code=403, detail="Admin privileges required")
    
    return True

def get_current_user(request: Request) -> Optional[str]:
    if is_authenticated(request):
        # For local auth, return the username
        username = request.session.get("username")
        # For local auth (admin), return the Telegram user ID if available
        if request.session.get("auth_method") == "local":
            # Check if the admin user has a Telegram user ID
            user_data = database.Users.getUser(username)
            if user_data and user_data.get("telegram_user_id"):
                return str(user_data.get("telegram_user_id"))
            return "admin"
        return username
    return None


def require_archives(user: User = Depends(require_auth)) -> User:
    """For compress, extract and look inside, which the owner can turn off (for everyone or one user)."""
    if not user.archives:
        raise HTTPException(status_code=403, detail=ARCHIVES_DISABLED)
    return user


def is_owner_user(user: User) -> bool:
    return is_owner_account(user.username, {"telegram_user_id": user.telegram_user_id})


def require_owner(user: User = Depends(require_auth)) -> User:
    if not is_owner_user(user):
        raise HTTPException(status_code=403, detail="Only the owner can change this.")
    return user


def require_upload(user: User = Depends(require_auth)) -> User:
    """Like require_auth, for anything that adds files (uploads, leeches, transfers, archives)."""
    if not user.can_upload:
        raise HTTPException(status_code=403, detail=UPLOADS_DISABLED)
    return user


def require_cloud(user: User = Depends(require_auth)) -> User:
    """For the cloud features (they use the server's bandwidth): only for users the owner allows."""
    if not user.cloud:
        raise HTTPException(status_code=403, detail=CLOUD_DISABLED)
    return user


def require_cloud_upload(user: User = Depends(require_upload)) -> User:
    """A cloud feature that also adds files: needs both permissions."""
    if not user.cloud:
        raise HTTPException(status_code=403, detail=CLOUD_DISABLED)
    return user
