from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPBearer
from typing import Optional
import hmac
import logging
from google.oauth2 import id_token
import os
from google.auth.transport import requests as google_requests
from telestore.config import GOOGLE_CLIENT_ID, DEFAULT_ADMIN_USERNAME, DEFAULT_ADMIN_PASSWORD
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

# Fallback admin, used only when the username is not in the database.
# Both values come from .env (DEFAULT_ADMIN_PASSWORD is required by telestore.config).
USERNAME = DEFAULT_ADMIN_USERNAME

# List of authorized admin emails (configurable via .env: AUTHORIZED_ADMIN_EMAILS)
_raw_admin_emails = os.getenv("AUTHORIZED_ADMIN_EMAILS", "")
AUTHORIZED_ADMINS = [e.strip() for e in _raw_admin_emails.split(",") if e.strip()]

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
    (phone keyboards add a trailing space and capitalise the first letter)."""
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

def verify_google_token(token: str) -> Optional[dict]:
    """Verify Google ID token and return user info if valid"""
    try:
        logger.info(f"Verifying Google token with client ID: {GOOGLE_CLIENT_ID}")
        
        # Check if GOOGLE_CLIENT_ID is set
        if not GOOGLE_CLIENT_ID:
            logger.error("GOOGLE_CLIENT_ID is not set in environment variables")
            return None
            
        # Specify the CLIENT_ID of the app that accesses the backend:
        idinfo = id_token.verify_oauth2_token(token, google_requests.Request(), GOOGLE_CLIENT_ID)
        
        # Who may sign in is decided by the login route (added users and AUTHORIZED_ADMIN_EMAILS)
        user_email = idinfo['email']
        if not idinfo.get('email_verified', False):
            logger.warning(f"Google account {user_email} has no verified email")
            return None
        
        # ID token is valid. Get user info
        user_info = {
            "user_id": idinfo['sub'],
            "email": idinfo['email'],
            "name": idinfo.get('name', ''),
            "picture": idinfo.get('picture', '')
        }
        
        logger.info(f"Google token verified successfully for user: {user_info['email']}")
        return user_info
    except ValueError as e:
        # Invalid token
        logger.error(f"Invalid Google token: {str(e)}")
        return None
    except Exception as e:
        logger.error(f"Google token verification failed: {e}")
        return None

ACCOUNT_DISABLED = "This account has been turned off. Ask the owner to turn it back on."
UPLOADS_DISABLED = "Uploading is turned off for this account. Ask the owner to turn it on."


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


def is_authenticated(request: Request) -> bool:
    auth_status = request.session.get("authenticated", False)
    logger.info(f"Checking authentication status: {auth_status}")
    return auth_status

def is_admin(request: Request) -> bool:
    """Check if the authenticated user is an admin"""
    if not is_authenticated(request):
        return False
    
    # Check if user authenticated via username/password (always admin)
    if request.session.get("auth_method") == "local":
        return True
    
    # Check if Google user is in authorized admins list
    if request.session.get("auth_method") == "google":
        user_email = request.session.get("user_email")
        return user_email in AUTHORIZED_ADMINS
    
    return False

def _with_account_flags(user: User, user_data: Optional[dict]) -> User:
    active, can_upload = account_flags(user.username, user_data)
    if not active:
        # A turned-off account stops working on its next request, even with an open session
        raise HTTPException(status_code=403, detail=ACCOUNT_DISABLED)
    user.active, user.can_upload = active, can_upload
    return user


def require_auth(request: Request) -> User:
    # Check session first
    if request.session.get("authenticated"):
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
        # For Google auth, check if user has Telegram verification
        if request.session.get("auth_method") == "google":
            user_data = database.Users.getUser(username)
            if user_data and user_data.get("telegram_user_id"):
                return str(user_data.get("telegram_user_id"))
        # For local auth (admin), return the Telegram user ID if available
        elif request.session.get("auth_method") == "local":
            # Check if the admin user has a Telegram user ID
            user_data = database.Users.getUser(username)
            if user_data and user_data.get("telegram_user_id"):
                return str(user_data.get("telegram_user_id"))
            return "admin"
        return username
    return None


def require_upload(user: User = Depends(require_auth)) -> User:
    """Like require_auth, for anything that adds files (uploads, leeches, transfers, archives)."""
    if not user.can_upload:
        raise HTTPException(status_code=403, detail=UPLOADS_DISABLED)
    return user
