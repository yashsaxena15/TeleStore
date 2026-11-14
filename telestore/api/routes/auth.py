# telestore/api/routes/auth.py

from telestore.services import device_service, event_service
from fastapi import APIRouter, Depends, Request, HTTPException, status
from pydantic import BaseModel
import secrets

from typing import Optional
from telestore.security.credentials import ACCOUNT_DISABLED, User, account_flags, canonical_username, check_login, require_auth
from telestore.services.email_service import create_and_send_vault_otp, verify_vault_otp
from telestore.utils.passwords import hash_password
from telestore.security.attempt_limiter import TooManyAttempts, password_limiter, wait_message
from telestore.db import database
from d4rk.Logs import setup_logger

MIN_PASSWORD_LENGTH = 6

logger = setup_logger("auth_routes")

# Create router with updated prefix
router = APIRouter(prefix="/auth", tags=["Authentication"])

# Apps that sign in (the Android app sends "android") get a 90-day token instead of 24 hours
APP_DEVICES = {"android", "windows"}
APP_TOKEN_HOURS = 90 * 24


class LoginRequest(BaseModel):
    username: str
    password: str
    device: Optional[str] = None

@router.post("/login")
async def login_post_route(request: Request, login_data: LoginRequest):
    logger.info(f"Login attempt for user: {login_data.username.strip()}")
    try:
        account = check_login(login_data.username, login_data.password)
    except TooManyAttempts as e:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=wait_message(e.retry_after),
            headers={"Retry-After": str(e.retry_after)},
        )
    if not account:
        logger.warning(f"Login failed for user: {login_data.username.strip()}")
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Incorrect username, email or password")

    user_data = database.Users.getUser(account)
    if not account_flags(account, user_data)[0]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=ACCOUNT_DISABLED)
    token = _issue_token(account, "local", user_data, login_data.device, request.headers.get("user-agent", ""))
    _start_session(request, account, "local", token_id=device_service.token_id(token))
    logger.info(f"Login successful for user: {account}")
    event_service.sign_in(account, request.headers.get("user-agent", ""), login_data.device)
    return {"message": "Login successful", "username": account, "auth_token": token}


def _start_session(request: Request, username: str, method: str, **extra) -> None:
    request.session["authenticated"] = True
    request.session["username"] = username
    request.session["auth_method"] = method
    request.session.update(extra)


def _issue_token(username: str, method: str, user_data: Optional[dict], device: Optional[str] = None, user_agent: str = "") -> str:
    """Creates the starter folders once for a verified user and returns a token for the desktop app.

    Only the first time: after that they are the user's own folders, free to rename or delete.
    """
    if user_data and user_data.get("telegram_user_id") and not user_data.get("default_folders_created"):
        created = database.Files.create_default_folders(str(user_data.get("telegram_user_id")))
        database.Users.update_user_by_identifier(username, {"default_folders_created": True})
        logger.info(f"Default folders created for user {username}: {created}")
    auth_token = secrets.token_urlsafe(32)
    device = (device or "").strip().lower()
    if device in APP_DEVICES:
        name = event_service.device_label(user_agent, device).removeprefix("the ").capitalize()
        database.Users.save_auth_token(username, auth_token, method, ttl_hours=APP_TOKEN_HOURS, device=device, device_name=name)
    else:
        name = event_service.device_label(user_agent)
        database.Users.save_auth_token(username, auth_token, method, device_name="Unknown browser" if name == "a new device" else name)
    return auth_token


@router.get("/google/config")
async def google_config():
    """Google sign-in was removed (sign in with a username or email and a password). Older apps
    still ask for this; no client ID makes them hide their Google button."""
    return {"client_id": None}


# ── Forgot password: a 6-digit code to the account's email, then a new password ──────────────
RESET_PURPOSE = "Password Reset"
RESET_SENT = "If that account has an email address, we've sent a 6-digit code to it."


class ForgotPasswordRequest(BaseModel):
    username: str


class ResetPasswordRequest(BaseModel):
    username: str
    code: str
    new_password: str


def _resettable_account(username: str):
    """(stored username, email) for an account that signs in with a password and has an email."""
    name = canonical_username(username)
    doc = database.Users.getUser(name) if name else None
    email = (doc or {}).get("email")
    if not doc or not email or not doc.get("password_hash") or not account_flags(name, doc)[0]:
        return None, None
    return name, email.strip().lower()


@router.post("/forgot-password/request")
async def forgot_password_request(body: ForgotPasswordRequest):
    """Sends a reset code. Always answers the same way, so it can't be used to find usernames."""
    name, email = _resettable_account(body.username)
    if name:
        try:
            await create_and_send_vault_otp(email, f"pwreset:{name}", purpose=RESET_PURPOSE, label="Password Reset")
        except ValueError as e:
            raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail=str(e))
        except Exception as e:
            logger.error(f"Failed to send password reset code for {name}: {e}")
    else:
        logger.info(f"Password reset requested for an account that can't be reset: {body.username.strip()}")
    return {"message": RESET_SENT}


@router.post("/forgot-password/reset")
async def forgot_password_reset(body: ResetPasswordRequest):
    if len(body.new_password) < MIN_PASSWORD_LENGTH:
        raise HTTPException(status_code=400, detail=f"Use a password of at least {MIN_PASSWORD_LENGTH} characters.")
    name, email = _resettable_account(body.username)
    wrong = HTTPException(status_code=400, detail="That code is wrong or has expired. Request a new one.")
    if not name:
        raise wrong
    try:
        valid = await verify_vault_otp(email, f"pwreset:{name}", body.code.strip(), purpose=RESET_PURPOSE)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not valid:
        raise wrong
    database.Users.update_user_by_identifier(name, {"password_hash": hash_password(body.new_password)})
    from telestore.api.routes.webdav.common import forget_webdav_logins
    forget_webdav_logins()
    # A successful reset also lifts any sign-in lockout for the account
    password_limiter.success(f"pw:{name.lower()}")
    logger.info(f"Password reset by email code for user {name}")
    return {"message": "Password changed. You can sign in now."}


@router.post("/logout")
async def logout_route(request: Request):
    from telestore.api.state import _auth_tokens
    request.session.clear()
    auth_header = request.headers.get("X-Auth-Token") or request.query_params.get("token")
    if auth_header:
        database.Users.remove_auth_token(auth_header)
        _auth_tokens.pop(auth_header, None)  # the server's memory too, so the token stops working now
    return {"message": "Logged out successfully"}

@router.get("/check")
async def check_auth(request: Request):
    from telestore.api.state import _auth_tokens, cached_token_valid
    # Check if there's an auth token in headers or query param
    auth_header = request.headers.get("X-Auth-Token") or request.query_params.get("token")
    if auth_header and cached_token_valid(auth_header):
        token_data = _auth_tokens[auth_header]
        logger.info(f"Auth check result using token: authenticated=True, user={token_data.get('username')}")
        return {
            "authenticated": True,
            "username": token_data.get("username"),
            "user_picture": token_data.get("user_picture"),
            "is_admin": token_data.get("username") == "admin" or token_data.get("auth_method") == "local"
        }
    
    authenticated = request.session.get("authenticated", False)
    if authenticated and not device_service.session_valid(request):
        request.session.clear()  # signed out from another device
        authenticated = False
    logger.info(f"Auth check result: authenticated={authenticated}")
    return {
        "authenticated": authenticated,
        "username": request.session.get("username"),
        "user_picture": request.session.get("user_picture"),
        "is_admin": request.session.get("username") == "admin" or request.session.get("auth_method") == "local"
    }

# ── Your devices ────────────────────────────────────────────────────────────

@router.get("/devices")
def list_devices(request: Request, user: User = Depends(require_auth)):
    """Every place this account is signed in, this device first."""
    return {"devices": device_service.listing(user.username, device_service.current_id(request))}


@router.post("/devices/sign-out-others")
def sign_out_other_devices(request: Request, user: User = Depends(require_auth)):
    return {"signed_out": device_service.sign_out_others(user.username, device_service.current_id(request))}


@router.delete("/devices/{device_id}")
def sign_out_device(device_id: str, request: Request, user: User = Depends(require_auth)):
    if device_id == device_service.current_id(request):
        raise HTTPException(status_code=400, detail="This is the device you're using. Use Sign out instead.")
    if not device_service.sign_out(user.username, device_id):
        raise HTTPException(status_code=404, detail="That device is already signed out.")
    return {"message": "Signed out."}
