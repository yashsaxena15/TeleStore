"""Whether an account may use the cloud features (they use the server's bandwidth; the owner decides,
in Settings › Users), looked up by the id its records are kept under."""

from typing import Optional

from telestore.security.credentials import cloud_allowed


def _db():
    from telestore.services.remote_transfer_manager.helpers import get_remote_db
    return get_remote_db()


def user_for_owner_id(owner_id, db=None) -> Optional[dict]:
    """The user whose records are kept under [owner_id]: a Telegram user id once linked, else the username."""
    users = (_db() if db is None else db)["Users"]
    text = str(owner_id)
    ids = [text]
    try:
        ids.append(int(text))
    except ValueError:
        pass
    return users.find_one({"telegram_user_id": {"$in": ids}}) or users.find_one({"username": text})


def allowed_for_owner_id(owner_id, db=None) -> bool:
    user = user_for_owner_id(owner_id, db)
    if user is None:
        return str(owner_id) == "admin"
    return cloud_allowed(user.get("username"), user)
