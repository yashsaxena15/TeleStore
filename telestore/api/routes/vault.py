import os
import time
import re
import hashlib
import hmac
import logging
from datetime import datetime, timezone
from typing import Optional
from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from telestore.security.credentials import require_auth, User
from telestore.services.email_service import create_and_send_vault_otp, check_vault_otp, verify_vault_otp, get_vault_db
from telestore.config import SESSION_SECRET_KEY
from telestore.db import database
from telestore.security.attempt_limiter import TooManyAttempts, pin_limiter, wait_message

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/vault", tags=["Vault"])

# Default minutes of inactivity before the vault auto-locks; each user can pick one of the allowed values
VAULT_INACTIVITY_TIMEOUT = 900
AUTO_LOCK_CHOICES = (5, 15, 30, 60)
DEFAULT_AUTO_LOCK_MINUTES = 15
RECOVERY_EMAIL_PURPOSE = "Vault Recovery Email Change"


# Pydantic Request Models
class RequestEmailOtpModel(BaseModel):
    email: str

class VerifyOtpModel(BaseModel):
    otp_code: str
    purpose: str = "Private Vault Setup"
    email: Optional[str] = None

class VerifyAndCreateModel(BaseModel):
    email: str
    otp_code: str
    pin: str

class UnlockVaultModel(BaseModel):
    pin: str

class ForgotPinResetModel(BaseModel):
    otp_code: str
    new_pin: str

class ChangePinModel(BaseModel):
    current_pin: str
    new_pin: str

class VaultSettingsModel(BaseModel):
    auto_lock_minutes: int

class RecoveryEmailOtpModel(BaseModel):
    email: str
    pin: str

class RecoveryEmailConfirmModel(BaseModel):
    email: str
    pin: str
    otp_code: str

class MoveVaultItemModel(BaseModel):
    file_id: str
    target_path: Optional[str] = None

class CreateVaultFolderModel(BaseModel):
    folder_name: str
    current_path: Optional[str] = "/Vault"


# Cryptographic Helpers
def _derive_pin_key(pin: str, salt: bytes) -> bytes:
    """Derive a 256-bit encryption key from 4-digit PIN using PBKDF2."""
    return hashlib.pbkdf2_hmac("sha256", pin.encode("utf-8"), salt, 100000, 32)

def _get_recovery_master_key(user_id: str, secret: str = None) -> bytes:
    """Derive a server-side recovery key tied to this user and system secret."""
    secret = secret or SESSION_SECRET_KEY
    return hashlib.pbkdf2_hmac("sha256", secret.encode("utf-8"), user_id.encode("utf-8"), 50000, 32)

# Vaults created before 2026-10-19 wrapped their recovery copy with this former public default
# secret. It is accepted only to read such a copy, which is then re-wrapped with SESSION_SECRET_KEY.
_LEGACY_RECOVERY_SECRET = "f6d2e3b9a0f43d9a2e6a56b2d3175cd9c05bbfe31d95ed2a7306b57cb1a8b6f0"

def _open_recovery_envelope(config: dict, user_id: str):
    """Return (vault_key, is_legacy) from the recovery envelope, trying the current secret first."""
    envelope = bytes.fromhex(config["recovery_envelope"])
    iv = bytes.fromhex(config["recovery_iv"])
    try:
        return AESGCM(_get_recovery_master_key(user_id)).decrypt(iv, envelope, None), False
    except InvalidTag:
        return AESGCM(_get_recovery_master_key(user_id, _LEGACY_RECOVERY_SECRET)).decrypt(iv, envelope, None), True

def _wrap_recovery_envelope(user_id: str, vault_key: bytes) -> dict:
    """Encrypt the vault key with the current server recovery key."""
    iv = os.urandom(12)
    envelope = AESGCM(_get_recovery_master_key(user_id)).encrypt(iv, vault_key, None)
    return {"recovery_envelope": envelope.hex(), "recovery_iv": iv.hex()}

def _migrate_legacy_recovery(vault_coll, config: dict, user_id: str, vault_key: bytes) -> None:
    """If the recovery copy does not open with the current secret, re-wrap it from the PIN-unlocked vault key."""
    try:
        AESGCM(_get_recovery_master_key(user_id)).decrypt(
            bytes.fromhex(config["recovery_iv"]), bytes.fromhex(config["recovery_envelope"]), None)
    except InvalidTag:
        vault_coll.update_one({"user_id": user_id}, {"$set": _wrap_recovery_envelope(user_id, vault_key)})
        logger.info(f"Vault recovery copy re-wrapped with the current secret for user {user_id}")

def _mask_email(email: str) -> str:
    """Mask email for privacy, e.g. ya***28@gmail.com."""
    try:
        parts = email.split("@")
        if len(parts) != 2:
            return email
        name, domain = parts
        if len(name) <= 3:
            masked_name = name[0] + "***"
        else:
            masked_name = name[:2] + "***" + name[-2:]
        return f"{masked_name}@{domain}"
    except Exception:
        return email

def _auto_lock_minutes(config: Optional[dict]) -> int:
    minutes = (config or {}).get("auto_lock_minutes")
    return minutes if minutes in AUTO_LOCK_CHOICES else DEFAULT_AUTO_LOCK_MINUTES


def _session_timeout(request: Request) -> int:
    """Inactivity window in seconds for this session (set when the vault was unlocked)."""
    seconds = request.session.get("vault_timeout")
    return seconds if isinstance(seconds, int) and seconds > 0 else VAULT_INACTIVITY_TIMEOUT


def _start_unlocked_session(request: Request, config: Optional[dict]) -> None:
    request.session["vault_unlocked"] = True
    request.session["vault_unlocked_at"] = time.time()
    request.session["vault_timeout"] = _auto_lock_minutes(config) * 60


def _too_many(seconds: int) -> HTTPException:
    return HTTPException(status_code=429, detail=wait_message(seconds), headers={"Retry-After": str(seconds)})


def _check_pin(config: dict, pin: str, wrong_detail: str = "Incorrect vault PIN.") -> bytes:
    """Return the PIN-derived key when the PIN matches, else raise 401.

    Every PIN check goes through here so wrong guesses are rate limited per vault:
    after a few misses the vault refuses PINs (429) for a time that doubles each miss.
    """
    if not re.match(r"^\d{4}$", pin or ""):
        raise HTTPException(status_code=400, detail="Please enter your 4-digit vault PIN.")
    key = f"pin:{config.get('user_id')}"
    try:
        pin_limiter.check(key)
    except TooManyAttempts as e:
        raise _too_many(e.retry_after)
    derived = _derive_pin_key(pin, bytes.fromhex(config["pin_salt"]))
    if not hmac.compare_digest(hashlib.sha256(derived).hexdigest(), config["pin_hash"]):
        lock = pin_limiter.failure(key)
        if lock:
            logger.warning(f"Vault PIN for user {config.get('user_id')} locked for {lock}s after repeated failures")
            raise _too_many(lock)
        raise HTTPException(status_code=401, detail=wrong_detail)
    pin_limiter.success(key)
    return derived


def is_vault_unlocked(request: Request) -> bool:
    """Check if vault is unlocked and within the inactivity window."""
    unlocked = request.session.get("vault_unlocked", False)
    if not unlocked:
        return False
    unlocked_at = request.session.get("vault_unlocked_at", 0)
    if time.time() - unlocked_at > _session_timeout(request):
        request.session["vault_unlocked"] = False
        return False
    # Touch activity timestamp
    request.session["vault_unlocked_at"] = time.time()
    return True


@router.get("/status")
async def get_vault_status(request: Request, user: User = Depends(require_auth)):
    """Check whether the user has set up a Vault, and if it's currently unlocked."""
    user_id = str(user.telegram_user_id or user.username or "admin")
    vault_coll = get_vault_db()["VaultConfig"]
    config = vault_coll.find_one({"user_id": user_id})

    if not config:
        return {
            "is_setup": False,
            "is_unlocked": False,
            "email": None,
            "remaining_seconds": 0,
            "auto_lock_minutes": DEFAULT_AUTO_LOCK_MINUTES
        }

    unlocked = is_vault_unlocked(request)
    remaining_seconds = 0
    if unlocked:
        unlocked_at = request.session.get("vault_unlocked_at", 0)
        remaining_seconds = max(0, int(_session_timeout(request) - (time.time() - unlocked_at)))

    return {
        "is_setup": True,
        "is_unlocked": unlocked,
        "email": _mask_email(config.get("email", "")),
        "remaining_seconds": remaining_seconds,
        "auto_lock_minutes": _auto_lock_minutes(config)
    }


@router.post("/setup/request-otp")
async def request_setup_otp(body: RequestEmailOtpModel, user: User = Depends(require_auth)):
    """Step 1 of Setup: Send verification OTP to the user's provided email."""
    email = body.email.strip().lower()
    if not re.match(r"^[^@]+@[^@]+\.[^@]+$", email):
        raise HTTPException(status_code=400, detail="Please enter a valid email address.")

    user_id = str(user.telegram_user_id or user.username or "admin")
    try:
        await create_and_send_vault_otp(email, user_id, purpose="Private Vault Setup")
        return {"success": True, "message": f"Verification code sent to {email}"}
    except ValueError as ve:
        raise HTTPException(status_code=429, detail=str(ve))
    except Exception as e:
        logger.error(f"Failed to send setup OTP: {e}")
        raise HTTPException(status_code=500, detail="Failed to dispatch verification email. Please try again.")


@router.post("/verify-otp")
async def verify_vault_otp_endpoint(body: VerifyOtpModel, user: User = Depends(require_auth)):
    """Validates the OTP code immediately before allowing the user to proceed to PIN creation."""
    user_id = str(user.telegram_user_id or user.username or "admin")
    email = (body.email or "").strip().lower()

    if not email:
        vault_coll = get_vault_db()["VaultConfig"]
        config = vault_coll.find_one({"user_id": user_id})
        if config and config.get("email"):
            email = config["email"].strip().lower()

    if not email:
        raise HTTPException(status_code=400, detail="Recovery email address is required.")

    otp_code = body.otp_code.strip()
    if not re.match(r"^\d{6}$", otp_code):
        raise HTTPException(status_code=400, detail="Please enter a valid 6-digit verification code.")

    try:
        await check_vault_otp(email, user_id, otp_code, purpose=body.purpose)
        return {"success": True, "message": "Verification code confirmed."}
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        logger.error(f"Error checking OTP: {e}")
        raise HTTPException(status_code=500, detail="Failed to verify code. Please try again.")


@router.post("/setup/verify-and-create")
async def verify_and_create_vault(request: Request, body: VerifyAndCreateModel, user: User = Depends(require_auth)):
    """Step 2 of Setup: Verify OTP and create Vault with chosen 4-digit PIN."""
    pin = body.pin.strip()
    if not re.match(r"^\d{4}$", pin):
        raise HTTPException(status_code=400, detail="Vault PIN must be exactly 4 numeric digits.")

    user_id = str(user.telegram_user_id or user.username or "admin")
    email = body.email.strip().lower()

    # 1. Verify OTP
    try:
        valid = await verify_vault_otp(email, user_id, body.otp_code.strip(), purpose="Private Vault Setup")
        if not valid:
            raise HTTPException(status_code=400, detail="Invalid or expired verification code.")
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))

    # 2. Generate cryptographically strong random VaultKey (256-bit)
    vault_key = os.urandom(32)

    # 3. Create Envelope 1 (PIN Encrypted)
    pin_salt = os.urandom(16)
    pin_derived_key = _derive_pin_key(pin, pin_salt)
    pin_hash = hashlib.sha256(pin_derived_key).hexdigest()

    aes_pin = AESGCM(pin_derived_key)
    iv_pin = os.urandom(12)
    encrypted_vault_key = aes_pin.encrypt(iv_pin, vault_key, None)

    # 4. Create Envelope 2 (Server-assisted Recovery Encrypted)
    rec_key = _get_recovery_master_key(user_id)
    aes_rec = AESGCM(rec_key)
    iv_rec = os.urandom(12)
    recovery_envelope = aes_rec.encrypt(iv_rec, vault_key, None)

    # 5. Persist in VaultConfig
    vault_coll = get_vault_db()["VaultConfig"]
    now = datetime.now(timezone.utc)

    vault_coll.update_one(
        {"user_id": user_id},
        {
            "$set": {
                "user_id": user_id,
                "email": email,
                "pin_salt": pin_salt.hex(),
                "pin_hash": pin_hash,
                "encrypted_vault_key": encrypted_vault_key.hex(),
                "vault_key_iv": iv_pin.hex(),
                "recovery_envelope": recovery_envelope.hex(),
                "recovery_iv": iv_rec.hex(),
                "created_at": now,
                "updated_at": now
            }
        },
        upsert=True
    )

    # 6. Unlock session immediately
    _start_unlocked_session(request, None)

    return {"success": True, "message": "Private Vault successfully initialized and unlocked!"}


@router.post("/unlock")
async def unlock_vault(request: Request, body: UnlockVaultModel, user: User = Depends(require_auth)):
    """Unlock Vault using 4-digit PIN."""
    pin = body.pin.strip()
    if not re.match(r"^\d{4}$", pin):
        raise HTTPException(status_code=400, detail="Please enter a valid 4-digit PIN.")

    user_id = str(user.telegram_user_id or user.username or "admin")
    vault_coll = get_vault_db()["VaultConfig"]
    config = vault_coll.find_one({"user_id": user_id})

    if not config:
        raise HTTPException(status_code=404, detail="Vault is not setup yet.")

    pin_derived_key = _check_pin(config, pin, "Incorrect 4-digit PIN.")

    try:
        vault_key = AESGCM(pin_derived_key).decrypt(
            bytes.fromhex(config["vault_key_iv"]), bytes.fromhex(config["encrypted_vault_key"]), None)
        _migrate_legacy_recovery(vault_coll, config, user_id, vault_key)
    except Exception as e:
        logger.error(f"Vault recovery migration skipped for user {user_id}: {e}")

    # Successful unlock
    _start_unlocked_session(request, config)

    return {"success": True, "message": "Vault successfully unlocked."}


@router.post("/lock")
async def lock_vault(request: Request, user: User = Depends(require_auth)):
    """Immediately lock the vault."""
    request.session["vault_unlocked"] = False
    request.session["vault_unlocked_at"] = 0
    return {"success": True, "message": "Vault locked."}


@router.post("/forgot-pin/request-otp")
async def forgot_pin_request_otp(user: User = Depends(require_auth)):
    """Request a 6-digit OTP to the registered recovery email for PIN reset."""
    user_id = str(user.telegram_user_id or user.username or "admin")
    vault_coll = get_vault_db()["VaultConfig"]
    config = vault_coll.find_one({"user_id": user_id})

    if not config or not config.get("email"):
        raise HTTPException(status_code=404, detail="No registered recovery email found for this Vault.")

    email = config["email"]
    try:
        await create_and_send_vault_otp(email, user_id, purpose="Vault PIN Reset")
        return {
            "success": True,
            "message": f"Verification code sent to {_mask_email(email)}",
            "masked_email": _mask_email(email)
        }
    except ValueError as ve:
        raise HTTPException(status_code=429, detail=str(ve))
    except Exception as e:
        logger.error(f"Failed to send reset OTP: {e}")
        raise HTTPException(status_code=500, detail="Failed to dispatch verification email.")


@router.post("/forgot-pin/reset")
async def forgot_pin_reset(request: Request, body: ForgotPinResetModel, user: User = Depends(require_auth)):
    """Verify OTP and set a new 4-digit PIN without losing files."""
    new_pin = body.new_pin.strip()
    if not re.match(r"^\d{4}$", new_pin):
        raise HTTPException(status_code=400, detail="New PIN must be exactly 4 numeric digits.")

    user_id = str(user.telegram_user_id or user.username or "admin")
    vault_coll = get_vault_db()["VaultConfig"]
    config = vault_coll.find_one({"user_id": user_id})

    if not config:
        raise HTTPException(status_code=404, detail="Vault not found.")

    email = config["email"]

    # 1. Verify OTP
    try:
        valid = await verify_vault_otp(email, user_id, body.otp_code.strip(), purpose="Vault PIN Reset")
        if not valid:
            raise HTTPException(status_code=400, detail="Invalid or expired verification code.")
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))

    # 2. Recover Master VaultKey from Recovery Envelope
    try:
        vault_key, recovery_is_legacy = _open_recovery_envelope(config, user_id)
    except Exception as e:
        logger.error(f"Recovery decryption failed: {e}")
        raise HTTPException(status_code=500, detail="Decryption error during key recovery.")

    # 3. Re-encrypt VaultKey into Envelope 1 with the new PIN
    new_salt = os.urandom(16)
    new_pin_derived_key = _derive_pin_key(new_pin, new_salt)
    new_pin_hash = hashlib.sha256(new_pin_derived_key).hexdigest()

    aes_pin = AESGCM(new_pin_derived_key)
    new_iv_pin = os.urandom(12)
    new_encrypted_vault_key = aes_pin.encrypt(new_iv_pin, vault_key, None)

    now = datetime.now(timezone.utc)
    vault_coll.update_one(
        {"user_id": user_id},
        {
            "$set": {
                "pin_salt": new_salt.hex(),
                "pin_hash": new_pin_hash,
                "encrypted_vault_key": new_encrypted_vault_key.hex(),
                "vault_key_iv": new_iv_pin.hex(),
                **(_wrap_recovery_envelope(user_id, vault_key) if recovery_is_legacy else {}),
                "updated_at": now
            }
        }
    )

    # 4. Automatically unlock session
    _start_unlocked_session(request, config)

    return {"success": True, "message": "PIN successfully reset and Vault unlocked!"}


@router.post("/change-pin")
async def change_pin(request: Request, body: ChangePinModel, user: User = Depends(require_auth)):
    """Change PIN when current PIN is known."""
    current_pin = body.current_pin.strip()
    new_pin = body.new_pin.strip()

    if not re.match(r"^\d{4}$", new_pin):
        raise HTTPException(status_code=400, detail="New PIN must be exactly 4 numeric digits.")

    user_id = str(user.telegram_user_id or user.username or "admin")
    vault_coll = get_vault_db()["VaultConfig"]
    config = vault_coll.find_one({"user_id": user_id})

    if not config:
        raise HTTPException(status_code=404, detail="Vault not found.")

    # Verify current PIN
    current_derived_key = _check_pin(config, current_pin, "Current PIN is incorrect.")

    # Decrypt VaultKey using current PIN
    try:
        aes_cur = AESGCM(current_derived_key)
        vault_key = aes_cur.decrypt(bytes.fromhex(config["vault_key_iv"]), bytes.fromhex(config["encrypted_vault_key"]), None)
    except Exception:
        raise HTTPException(status_code=500, detail="Decryption failed with current PIN.")

    # Re-encrypt with new PIN
    new_salt = os.urandom(16)
    new_derived_key = _derive_pin_key(new_pin, new_salt)
    new_pin_hash = hashlib.sha256(new_derived_key).hexdigest()

    aes_new = AESGCM(new_derived_key)
    new_iv = os.urandom(12)
    new_encrypted_key = aes_new.encrypt(new_iv, vault_key, None)

    now = datetime.now(timezone.utc)
    vault_coll.update_one(
        {"user_id": user_id},
        {
            "$set": {
                "pin_salt": new_salt.hex(),
                "pin_hash": new_pin_hash,
                "encrypted_vault_key": new_encrypted_key.hex(),
                "vault_key_iv": new_iv.hex(),
                "updated_at": now
            }
        }
    )

    _start_unlocked_session(request, config)
    return {"success": True, "message": "PIN changed successfully."}


@router.put("/settings")
async def update_vault_settings(request: Request, body: VaultSettingsModel, user: User = Depends(require_auth)):
    """Change how long the vault stays unlocked without activity. The PIN is still needed to unlock."""
    if body.auto_lock_minutes not in AUTO_LOCK_CHOICES:
        raise HTTPException(status_code=400, detail=f"Auto-lock must be one of {', '.join(map(str, AUTO_LOCK_CHOICES))} minutes.")

    user_id = str(user.telegram_user_id or user.username or "admin")
    vault_coll = get_vault_db()["VaultConfig"]
    result = vault_coll.update_one(
        {"user_id": user_id},
        {"$set": {"auto_lock_minutes": body.auto_lock_minutes, "updated_at": datetime.now(timezone.utc)}}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Vault is not set up yet.")

    # Apply to the current session too, so the change takes effect without unlocking again
    if is_vault_unlocked(request):
        request.session["vault_timeout"] = body.auto_lock_minutes * 60
    return {"success": True, "auto_lock_minutes": body.auto_lock_minutes}


def _normalize_new_email(email: str, config: dict) -> str:
    email = (email or "").strip().lower()
    if not re.match(r"^[^@]+@[^@]+\.[^@]+$", email):
        raise HTTPException(status_code=400, detail="Please enter a valid email address.")
    if email == (config.get("email") or "").strip().lower():
        raise HTTPException(status_code=400, detail="That is already your recovery email.")
    return email


@router.post("/recovery-email/request-otp")
async def request_recovery_email_otp(body: RecoveryEmailOtpModel, user: User = Depends(require_auth)):
    """Step 1 of changing the recovery email: confirm the PIN, then send a code to the new address."""
    user_id = str(user.telegram_user_id or user.username or "admin")
    config = get_vault_db()["VaultConfig"].find_one({"user_id": user_id})
    if not config:
        raise HTTPException(status_code=404, detail="Vault is not set up yet.")

    _check_pin(config, body.pin.strip())
    email = _normalize_new_email(body.email, config)
    try:
        await create_and_send_vault_otp(email, user_id, purpose=RECOVERY_EMAIL_PURPOSE)
        return {"success": True, "message": f"Verification code sent to {_mask_email(email)}"}
    except ValueError as ve:
        raise HTTPException(status_code=429, detail=str(ve))
    except Exception as e:
        logger.error(f"Failed to send recovery email OTP: {e}")
        raise HTTPException(status_code=500, detail="Failed to dispatch verification email. Please try again.")


@router.post("/recovery-email/confirm")
async def confirm_recovery_email(body: RecoveryEmailConfirmModel, user: User = Depends(require_auth)):
    """Step 2: check the PIN and the code sent to the new address, then save it.
    The recovery envelope is keyed to the user, not the email, so no re-encryption is needed."""
    user_id = str(user.telegram_user_id or user.username or "admin")
    vault_coll = get_vault_db()["VaultConfig"]
    config = vault_coll.find_one({"user_id": user_id})
    if not config:
        raise HTTPException(status_code=404, detail="Vault is not set up yet.")

    _check_pin(config, body.pin.strip())
    email = _normalize_new_email(body.email, config)
    try:
        valid = await verify_vault_otp(email, user_id, body.otp_code.strip(), purpose=RECOVERY_EMAIL_PURPOSE)
        if not valid:
            raise HTTPException(status_code=400, detail="Invalid or expired verification code.")
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))

    vault_coll.update_one({"user_id": user_id}, {"$set": {"email": email, "updated_at": datetime.now(timezone.utc)}})
    return {"success": True, "email": _mask_email(email)}


@router.post("/move-in")
async def move_into_vault(request: Request, body: MoveVaultItemModel, user: User = Depends(require_auth)):
    """Move a file or folder into the Private Vault."""
    if not is_vault_unlocked(request):
        raise HTTPException(status_code=403, detail="Vault is locked. Please unlock Vault first.")

    target_path = body.target_path or "/Vault"
    if not target_path.startswith("/Vault"):
        target_path = "/Vault"

    try:
        obj_id = ObjectId(body.file_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid file ID.")

    # Update item and any sub-items if folder
    item = database.Files.find_one({"_id": obj_id})
    if not item:
        raise HTTPException(status_code=404, detail="File or folder not found.")

    database.Files.update_one(
        {"_id": obj_id},
        {"$set": {"is_vault": True, "file_path": target_path}}
    )

    # If it was a folder, move its nested children into vault too
    if item.get("file_type") == "folder":
        old_parent = item.get('file_path', '').rstrip('/')
        folder_name = item.get('file_name', '')
        old_full_path = f"{old_parent}/{folder_name}" if old_parent else f"/{folder_name}"
        new_parent = target_path.rstrip('/')
        new_full_path = f"{new_parent}/{folder_name}" if new_parent else f"/{folder_name}"

        # 1. Update direct children
        database.Files.update_many(
            {"file_path": old_full_path},
            {"$set": {"file_path": new_full_path, "is_vault": True}}
        )
        # 2. Update nested descendants
        database.Files.update_many(
            {"file_path": {"$regex": f"^{re.escape(old_full_path)}/"}},
            [{"$set": {
                "file_path": {
                    "$replaceOne": {
                        "input": "$file_path",
                        "find": old_full_path,
                        "replacement": new_full_path
                    }
                },
                "is_vault": True
            }}]
        )

    return {"success": True, "message": f"Moved to Vault ({target_path})"}


@router.post("/move-out")
async def move_out_of_vault(request: Request, body: MoveVaultItemModel, user: User = Depends(require_auth)):
    """Move a file or folder out of Private Vault back into Home."""
    if not is_vault_unlocked(request):
        raise HTTPException(status_code=403, detail="Vault is locked. Please unlock Vault first.")

    target_path = body.target_path or "/Home"
    try:
        obj_id = ObjectId(body.file_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid file ID.")

    item = database.Files.find_one({"_id": obj_id})
    if not item:
        raise HTTPException(status_code=404, detail="File or folder not found.")

    database.Files.update_one(
        {"_id": obj_id},
        {"$set": {"is_vault": False, "file_path": target_path}}
    )

    if item.get("file_type") == "folder":
        old_parent = item.get('file_path', '').rstrip('/')
        folder_name = item.get('file_name', '')
        old_full_path = f"{old_parent}/{folder_name}" if old_parent else f"/{folder_name}"
        new_parent = target_path.rstrip('/')
        new_full_path = f"{new_parent}/{folder_name}" if new_parent else f"/{folder_name}"

        # 1. Update direct children
        database.Files.update_many(
            {"file_path": old_full_path},
            {"$set": {"file_path": new_full_path, "is_vault": False}}
        )
        # 2. Update nested descendants
        database.Files.update_many(
            {"file_path": {"$regex": f"^{re.escape(old_full_path)}/"}},
            [{"$set": {
                "file_path": {
                    "$replaceOne": {
                        "input": "$file_path",
                        "find": old_full_path,
                        "replacement": new_full_path
                    }
                },
                "is_vault": False
            }}]
        )

    return {"success": True, "message": f"Moved to {target_path}"}


@router.post("/create-folder")
async def create_vault_folder(request: Request, body: CreateVaultFolderModel, user: User = Depends(require_auth)):
    """Create a folder inside Private Vault."""
    if not is_vault_unlocked(request):
        raise HTTPException(status_code=403, detail="Vault is locked. Please unlock Vault first.")

    user_id = str(user.telegram_user_id or user.username or "admin")
    name = body.folder_name.strip()
    if not name or len(name) > 60:
        raise HTTPException(status_code=400, detail="Invalid folder name.")

    current_path = body.current_path or "/Vault"
    if not current_path.startswith("/Vault"):
        current_path = "/Vault"

    success = database.Files.add_folder(name, current_path, user_id)
    if not success:
        raise HTTPException(status_code=400, detail="A folder with this name already exists in this location.")

    return {"success": True, "message": f"Folder '{name}' created inside Vault."}
