"""Linking a TeleStore account to its Telegram account and its storage chat, safely.

Each account's files are recorded under its Telegram user id once Telegram is linked (under the
username before that), and they live in its storage chat. So:

  * one Telegram account belongs to one TeleStore account: linking a Telegram account another
    TeleStore account already uses is refused (otherwise both would see and change the same files);
  * one storage chat belongs to one TeleStore account (otherwise both would save into it);
  * linking moves the account's earlier records (under its username, or a Telegram account it used
    before) to the new Telegram id, so nothing it had disappears from view.
"""

import logging
from typing import Iterable, Optional

logger = logging.getLogger(__name__)

# The collections that say whose something is, and the field that says it
OWNED = [("Files", "owner_id"), ("Shares", "owner_id"), ("Playlists", "owner_id"), ("Events", "owner_id"),
         ("RemoteTransfers", "user_id"), ("TransferGroups", "user_id"), ("MediaSyncs", "user_id"),
         ("Cloudaccounts", "user_id"), ("VaultConfig", "user_id")]


class LinkRefused(Exception):
    """The link isn't allowed; the message says why, in words for the person."""


def _db():
    from telestore.services.remote_transfer_manager.helpers import get_remote_db
    return get_remote_db()


def _both(value) -> list:
    """An id as it may be stored: a number or text."""
    out = [str(value)]
    try:
        out.append(int(value))
    except (TypeError, ValueError):
        pass
    return out


def _label(doc: dict) -> str:
    name = doc.get("username") or "another account"
    return name[len("google_"):] if name.startswith("google_") else name


def telegram_owner(telegram_id, db=None) -> Optional[dict]:
    """The TeleStore account this Telegram account is linked to, if any."""
    return (db or _db())["Users"].find_one({"telegram_user_id": {"$in": _both(telegram_id)}})


def chat_owner(chat_id, db=None) -> Optional[dict]:
    """The TeleStore account whose storage chat this is, if any."""
    return (db or _db())["Users"].find_one({"index_chat_id": {"$in": _both(chat_id)}})


def check_telegram_free(username: str, telegram_id, db=None) -> None:
    other = telegram_owner(telegram_id, db)
    if other and other.get("username") != username:
        raise LinkRefused(
            f"This Telegram account is already connected to the TeleStore account “{_label(other)}”. "
            "One Telegram account can belong to only one TeleStore account, so your files never mix with "
            "theirs. Connect a different Telegram account, or ask the admin to disconnect it from that account first.")


def check_chat_free(chat_id, username: Optional[str] = None, telegram_id=None, db=None) -> None:
    """Refuses a storage chat another account already uses ([username] or [telegram_id] says who's asking)."""
    other = chat_owner(chat_id, db)
    if not other:
        return
    mine = (username and other.get("username") == username) or \
        (telegram_id is not None and str(other.get("telegram_user_id")) == str(telegram_id))
    if not mine:
        raise LinkRefused(
            f"This chat is already the storage chat of the TeleStore account “{_label(other)}”. "
            "Each account needs its own storage chat: make a new private group and add the bot there.")


def move_records(old_ids: Iterable, new_id: str, db=None) -> dict:
    """Everything recorded under [old_ids] (an account's username, a Telegram id it used before) now
    belongs to [new_id]. Returns how many were moved in each collection."""
    db = db or _db()
    olds = [str(o) for o in old_ids if o not in (None, "") and str(o) != str(new_id)]
    moved = {}
    if not olds:
        return moved
    for name, field in OWNED:
        try:
            r = db[name].update_many({field: {"$in": olds}}, {"$set": {field: str(new_id)}})
            if r.modified_count:
                moved[name] = r.modified_count
        except Exception as e:  # one collection failing doesn't stop the others
            logger.error(f"Moving {name} records to the new Telegram id failed: {e}")
    return moved


def link_telegram(username: str, telegram_data: dict, db=None) -> dict:
    """Links [username] to the Telegram account in [telegram_data] (refusing one another account uses),
    then moves the account's earlier records to it. Returns what was moved."""
    db = db or _db()
    new_id = telegram_data.get("telegram_user_id")
    if new_id is None:
        raise LinkRefused("Telegram didn't say which account this is. Try again.")
    check_telegram_free(username, new_id, db)
    user = db["Users"].find_one({"username": username}) or {}
    before = user.get("telegram_user_id")
    fields = {k: telegram_data.get(k) for k in ("telegram_user_id", "telegram_username", "telegram_first_name",
                                                "telegram_last_name", "telegram_profile_picture")}
    from datetime import datetime
    fields["updated_at"] = datetime.utcnow()
    db["Users"].update_one({"username": username}, {"$set": fields}, upsert=True)
    moved = move_records([username, before], str(new_id), db)
    if moved:
        logger.info(f"Linked {username} to Telegram; moved its earlier records: {moved}")
    return moved
