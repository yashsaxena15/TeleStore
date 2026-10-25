# telestore/api/routes/user.py

from fastapi import APIRouter, Request, Depends, HTTPException
from pydantic import BaseModel
import datetime
from typing import Optional, List

from telestore.security.credentials import account_flags, is_owner_account, require_auth, User
from telestore.db import database
from telestore.utils.passwords import hash_password
from telestore.security.attempt_limiter import TooManyAttempts, password_limiter, wait_message
from d4rk.Logs import setup_logger

logger = setup_logger("user_routes")

# Create router with user prefix
router = APIRouter(prefix="/user", tags=["User Management"])

class UserProfileResponse(BaseModel):
    username: str
    email: Optional[str] = None
    telegram_user_id: Optional[int] = None
    telegram_username: Optional[str] = None
    telegram_first_name: Optional[str] = None
    telegram_last_name: Optional[str] = None
    telegram_profile_picture: Optional[str] = None

class IsOwnerResponse(BaseModel):
    is_owner: bool
    owner_telegram_id: Optional[int] = None

class UserPermission(BaseModel):
    read: bool = True
    write: bool = False

class UserResponse(BaseModel):
    id: str
    username: str
    email: Optional[str] = None
    telegram_user_id: Optional[int] = None
    telegram_username: Optional[str] = None
    # Owner controls: turned-off accounts can't sign in; can_upload covers uploads, leeches,
    # transfers into Telegram and archives. Missing values mean allowed.
    active: bool = True
    can_upload: bool = True
    is_owner: bool = False
    # Setup: uploads need a verified Telegram account and an index chat
    has_telegram: bool = False
    has_index_chat: bool = False
    created_at: str
    last_active: Optional[str] = None
    user_type: Optional[str] = None  # "local" or "google"

class UsersResponse(BaseModel):
    users: List[UserResponse]

class AddUserRequest(BaseModel):
    username: Optional[str] = None
    email: Optional[str] = None
    password: Optional[str] = None
    can_upload: bool = True
    permissions: Optional[UserPermission] = None  # old clients; no longer used

class UpdateUserRequest(BaseModel):
    email: Optional[str] = None
    active: Optional[bool] = None
    can_upload: Optional[bool] = None
    permissions: Optional[UserPermission] = None  # old clients; no longer used


def _is_bot_contact(doc: dict) -> bool:
    """A record the Telegram bot made on /start: named by a Telegram ID, no password and no email."""
    name = doc.get("username")
    named_by_id = isinstance(name, int) or (isinstance(name, str) and name.lstrip("-").isdigit())
    return named_by_id and not doc.get("password_hash") and not doc.get("email")


def _user_response(doc: dict, id_value: str, user_type: str, **overrides) -> "UserResponse":
    username = doc.get("username", "")
    active, can_upload = account_flags(username, doc)
    fields = dict(
        id=id_value,
        username=username,
        email=doc.get("email"),
        telegram_user_id=doc.get("telegram_user_id"),
        telegram_username=doc.get("telegram_username"),
        active=active,
        can_upload=can_upload,
        is_owner=is_owner_account(username, doc),
        has_telegram=bool(doc.get("telegram_user_id")),
        has_index_chat=doc.get("index_chat_id") is not None,
        created_at=str(doc.get("created_at") or datetime.datetime.now().strftime("%Y-%m-%d")),
        last_active=doc.get("last_active"),
        user_type=user_type,
    )
    fields.update(overrides)
    return UserResponse(**fields)

class ChangePasswordRequest(BaseModel):
    current_password: str = ""  # not needed when the owner sets someone else's password
    new_password: str

class IndexChatResponse(BaseModel):
    index_chat_id: Optional[int] = None

class UpdateIndexChatRequest(BaseModel):
    index_chat_id: Optional[int] = None

@router.get("", response_model=UsersResponse)
@router.get("/", response_model=UsersResponse)
async def get_users(request: Request, user: User = Depends(require_auth)):
    """
    Get all users (owner only)
    """
    try:
        from telestore.config import OWNER
        # Check if user is owner
        is_owner = False
        if user.username == "admin":
            # Admin user is always considered owner
            is_owner = True
        elif user.telegram_user_id and OWNER is not None:
            # Check if telegram_user_id matches OWNER
            is_owner = user.telegram_user_id == OWNER
        
        if not is_owner:
            raise HTTPException(status_code=403, detail="Access denied")
        
        # Get all users from database
        # Get all users from database
        all_users = database.Users.get_all_users()
        
        users = []
        
        # Process each user
        for user_doc in all_users:
            # Skip admin user as we'll add it separately with full details
            if user_doc.get("username") == "admin":
                continue
            # The bot saves a bare record for anyone who sends /start; those aren't sign-in accounts
            if _is_bot_contact(user_doc):
                continue
                
            # Determine user type
            user_type = "local" if (user_doc.get("username") and not user_doc.get("username").startswith("google_")) else "google"
            users.append(_user_response(user_doc, str(user_doc.get("_id")), user_type))
        # Add admin user with full details
        admin_user = database.Users.getUser("admin") or {}
        users.insert(0, _user_response({**admin_user, "username": "admin"}, "1", "local"))
        return UsersResponse(users=users)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching users: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("", response_model=UserResponse)
@router.post("/", response_model=UserResponse)
async def add_user(request: Request, user_request: AddUserRequest, user: User = Depends(require_auth)):
    """
    Add a new user (owner only)
    """
    try:
        from telestore.config import OWNER
        # Check if user is owner
        is_owner = False
        if user.username == "admin":
            # Admin user is always considered owner
            is_owner = True
        elif user.telegram_user_id and OWNER is not None:
            # Check if telegram_user_id matches OWNER
            is_owner = user.telegram_user_id == OWNER
        
        if not is_owner:
            raise HTTPException(status_code=403, detail="Access denied")
        
        # Validate input based on user type
        if not user_request.email:
            raise HTTPException(status_code=400, detail="Email is required")
        
        # For local users, username and password are required
        if user_request.username and not user_request.password:
            raise HTTPException(status_code=400, detail="Password is required for local users")
        
        # For Google users, only email is required
        if not user_request.username and user_request.password:
            raise HTTPException(status_code=400, detail="Username is required for local users")
        
        # Check if user already exists by username
        existing_user = None
        if user_request.username:
            existing_user = database.Users.getUser(user_request.username)
        
        # Also check if a Google user with this email already exists
        if not user_request.username:
            # Look for existing Google user with this email
            all_users = database.Users.get_all_users()
            for user in all_users:
                if user.get("username", "").startswith("google_") and user.get("email") == user_request.email:
                    existing_user = user
                    break
        
        if existing_user:
            raise HTTPException(status_code=400, detail="User already exists")
        
        # Hash password if provided
        password_hash = None
        if user_request.password:
            password_hash = hash_password(user_request.password)
        
        # Save user to database
        user_id_for_db = user_request.username if user_request.username else f"google_{user_request.email}"
        # SaveUser skips usernames it saved earlier in this process (e.g. a user deleted and added again)
        database.Users.user_cache.discard(user_id_for_db)
        save_result = database.Users.SaveUser(
            username=user_id_for_db,
            password_hash=password_hash,
            email=user_request.email
        )
        
        database.Users.update_user_by_identifier(user_id_for_db, {"active": True, "can_upload": user_request.can_upload})

        user_type = "local" if user_request.username else "google"
        new_doc = database.Users.getUser(user_id_for_db) or {"username": user_id_for_db, "email": user_request.email}
        new_user = _user_response(new_doc, str(save_result.inserted_id) if save_result else "unknown", user_type,
                                  username=user_request.username or "", active=True, can_upload=user_request.can_upload)
        return new_user
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error adding user: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.put("/{user_id_param}", response_model=UserResponse)
async def update_user(request: Request, user_id_param: str, user_request: UpdateUserRequest, user: User = Depends(require_auth)):
    """
    Update a user (owner only)
    """
    try:
        from telestore.config import OWNER
        # Check if user is owner
        is_owner = False
        if user.username == "admin":
            # Admin user is always considered owner
            is_owner = True
        elif user.telegram_user_id and OWNER is not None:
            # Check if telegram_user_id matches OWNER
            is_owner = user.telegram_user_id == OWNER
        
        if not is_owner:
            raise HTTPException(status_code=403, detail="Access denied")
        
        # Get current user data by identifier
        current_user = database.Users.get_user_by_identifier(user_id_param)
        if not current_user:
            raise HTTPException(status_code=404, detail="User not found")
        
        if is_owner_account(current_user.get("username"), current_user) and (user_request.active is False or user_request.can_upload is False):
            raise HTTPException(status_code=400, detail="The owner account can't be turned off or limited.")

        update_data = {}
        if user_request.email:
            update_data["email"] = user_request.email
        if user_request.active is not None:
            update_data["active"] = user_request.active
        if user_request.can_upload is not None:
            update_data["can_upload"] = user_request.can_upload
        if update_data:
            success = database.Users.update_user_by_identifier(user_id_param, update_data)
            if not success:
                raise HTTPException(status_code=500, detail="Failed to update user")

        updated = database.Users.get_user_by_identifier(user_id_param) or current_user
        user_type = "local" if (updated.get("username") and not updated.get("username").startswith("google_")) else "google"
        updated_user = _user_response(updated, user_id_param, user_type)
        return updated_user
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating user: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/{user_id_param}")
async def delete_user(request: Request, user_id_param: str, user: User = Depends(require_auth)):
    """
    Delete a user (owner only)
    """
    try:
        from telestore.config import OWNER
        # Check if user is owner
        is_owner = False
        if user.username == "admin":
            # Admin user is always considered owner
            is_owner = True
        elif user.telegram_user_id and OWNER is not None:
            # Check if telegram_user_id matches OWNER
            is_owner = user.telegram_user_id == OWNER
        
        if not is_owner:
            raise HTTPException(status_code=403, detail="Access denied")
        
        # Prevent deleting admin user
        # First check if this is the admin user by identifier
        admin_user = database.Users.getUser("admin")
        if admin_user and str(admin_user.get("_id")) == user_id_param:
            raise HTTPException(status_code=400, detail="Cannot delete admin user")
        
        # Also check if the identifier is "admin" directly
        if user_id_param == "admin" or user_id_param == "1":
            raise HTTPException(status_code=400, detail="Cannot delete admin user")
        
        # Delete user from database
        success = database.Users.delete_user(user_id_param)
        if not success:
            raise HTTPException(status_code=404, detail="User not found")
        
        from telestore.api.routes.webdav.common import forget_webdav_logins
        forget_webdav_logins()  # their remembered WebDAV sign-in stops working too
        return {"message": "User deleted successfully"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting user: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.put("/{user_id_param}/password")
async def change_user_password(request: Request, user_id_param: str, password_request: ChangePasswordRequest, user: User = Depends(require_auth)):
    """
    Change a user's password (owner only or user themselves)
    """
    try:
        from telestore.config import OWNER
        logger.info(f"Attempting to change password for user_id_param: {user_id_param}")
        
        # Get current user data
        current_username = user.username if user else request.session.get("username")
        current_user_data = database.Users.getUser(current_username)
        logger.info(f"Current user data: {current_user_data}")
        
        # Check if user is owner or trying to change their own password
        is_owner = False
        if current_user_data:
            if current_user_data.get("username") == "admin":
                # Admin user is always considered owner
                is_owner = True
            elif current_user_data.get("telegram_user_id") and OWNER is not None:
                # Check if telegram_user_id matches OWNER
                is_owner = int(current_user_data.get("telegram_user_id")) == OWNER
        logger.info(f"Is owner: {is_owner}")
        
        # Handle special case for admin user with ID "1"
        actual_user_id_param = user_id_param
        if user_id_param == "1":
            actual_user_id_param = "admin"
        
        # Get target user data
        target_user = database.Users.get_user_by_identifier(actual_user_id_param)
        logger.info(f"Target user data: {target_user}")
        
        if not target_user:
            logger.warning(f"User not found for user_id_param: {actual_user_id_param}")
            raise HTTPException(status_code=404, detail="User not found")
        
        # Allow if user is owner or if user is changing their own password
        target_username = target_user.get("username")
        is_self = target_username == current_username
        logger.info(f"Target username: {target_username}, Is self: {is_self}")
        
        if not is_owner and not is_self:
            logger.warning(f"Access denied - not owner ({is_owner}) and not self ({is_self})")
            raise HTTPException(status_code=403, detail="Access denied")
        
        # Accounts without a password yet (e.g. Telegram/Google sign-in) set their first one
        # without a current password; the requester is already authenticated as self or owner.
        has_password = bool(database.Users.get_password_hash(target_username))
        if is_owner and not is_self:
            # The owner sets a new password for someone who forgot theirs; no current password needed
            logger.info(f"Owner set a new password for user: {target_username}")
            is_password_correct = True
            password_limiter.success(f"pw:{target_username.strip().lower()}")
        elif has_password:
            # Same brute-force protection as sign-in, keyed by the account being changed
            key = f"pw:{target_username.strip().lower()}"
            try:
                password_limiter.check(key)
            except TooManyAttempts as e:
                raise HTTPException(status_code=429, detail=wait_message(e.retry_after), headers={"Retry-After": str(e.retry_after)})
            is_password_correct = database.Users.verify_current_password(target_username, password_request.current_password)
            if is_password_correct:
                password_limiter.success(key)
            else:
                lock = password_limiter.failure(key)
                if lock:
                    raise HTTPException(status_code=429, detail=wait_message(lock), headers={"Retry-After": str(lock)})
        else:
            logger.info(f"Setting first password for user: {target_username}")
            is_password_correct = True

        if not is_password_correct:
            logger.warning(f"Incorrect current password for user: {target_username}")
            raise HTTPException(status_code=400, detail="Current password is incorrect")
        
        if len(password_request.new_password) < 6:
            raise HTTPException(status_code=400, detail="Use a password of at least 6 characters.")
        # Hash new password
        logger.info(f"Hashing new password for user: {target_username}")
        new_password_hash = hash_password(password_request.new_password)
        
        # Update password in database
        logger.info(f"Updating password in database for user: {target_username}")
        success = database.Users.update_user_by_identifier(actual_user_id_param, {"password_hash": new_password_hash})
        from telestore.api.routes.webdav.common import forget_webdav_logins
        forget_webdav_logins()
        logger.info(f"Database update result: {success}")
        
        if not success:
            logger.error(f"Failed to update password for user: {target_username}")
            raise HTTPException(status_code=500, detail="Failed to update password")
        
        logger.info(f"Password updated successfully for user {target_username}")
        return {"message": "Password updated successfully"}
        
    except HTTPException:
        logger.info("Re-raising HTTPException")
        raise
    except Exception as e:
        logger.error(f"Error changing user password: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))
@router.get("/profile", response_model=UserProfileResponse)
async def get_user_profile(request: Request, user: User = Depends(require_auth)):
    """
    Get detailed user profile information including Telegram verification status
    """
    try:
        # Get user data from database
        user_data = database.Users.getUser(user.username)
        if not user_data:
            # Create user if not exists
            database.Users.SaveUser(user.username)
            user_data = database.Users.getUser(user.username)
        
        # Build response using the User object directly
        profile = UserProfileResponse(
            username=user.username,
            email=user.email,
            telegram_user_id=user.telegram_user_id,
            telegram_username=user.telegram_username,
            telegram_first_name=user.telegram_first_name,
            telegram_last_name=user.telegram_last_name,
            telegram_profile_picture=user.telegram_profile_picture
        )
        
        return profile
        
    except Exception as e:
        logger.error(f"Error fetching user profile: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/is-owner", response_model=IsOwnerResponse)
async def is_user_owner(request: Request, user: User = Depends(require_auth)):
    """
    Check if the current user is the owner (defined in OWNER env variable)
    """
    try:
        from telestore.config import OWNER
        # Check if user has telegram_user_id and if it matches OWNER
        is_owner = False
        owner_telegram_id = None
        
        if OWNER is not None:
            owner_telegram_id = OWNER
            # Special case for admin user - check if username is 'admin'
            if user.username == "admin":
                is_owner = True
            elif user.telegram_user_id:
                is_owner = user.telegram_user_id == OWNER
        
        return IsOwnerResponse(is_owner=is_owner, owner_telegram_id=owner_telegram_id)
    except Exception as e:
        logger.error(f"Error checking owner status: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/index-chat", response_model=IndexChatResponse)
async def get_user_index_chat(request: Request, user: User = Depends(require_auth)):
    """
    Get the index chat ID for the current user
    """
    try:
        # Get user data from database
        user_data = database.Users.getUser(user.username)
        if not user_data:
            # Create user if not exists
            database.Users.SaveUser(user.username)
            user_data = database.Users.getUser(user.username)
        
        # Get index chat ID from user data
        index_chat_id = user_data.get("index_chat_id") if user_data else None
        
        return IndexChatResponse(index_chat_id=index_chat_id)
        
    except Exception as e:
        logger.error(f"Error fetching user index chat: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.put("/index-chat", response_model=IndexChatResponse)
async def update_user_index_chat(request: Request, update_request: UpdateIndexChatRequest, user: User = Depends(require_auth)):
    """
    Update the index chat ID for the current user
    """
    try:
        # Update index chat ID in database
        update_data = {}
        if update_request.index_chat_id is not None:
            update_data["index_chat_id"] = update_request.index_chat_id
        else:
            # If None, remove the field
            update_data["$unset"] = {"index_chat_id": ""}
        
        # Perform the update
        if update_data:
            if "$unset" in update_data:
                # Handle removal of the field
                database.Users.update_one(
                    {"username": user.username},
                    {"$unset": update_data["$unset"]}
                )
            else:
                # Handle setting the field
                database.Users.update_one(
                    {"username": user.username},
                    {"$set": update_data}
                )
        
        # Get updated user data
        user_data = database.Users.getUser(user.username)
        index_chat_id = user_data.get("index_chat_id") if user_data else None
        
        return IndexChatResponse(index_chat_id=index_chat_id)
        
    except Exception as e:
        logger.error(f"Error updating user index chat: {e}")
        raise HTTPException(status_code=500, detail=str(e))