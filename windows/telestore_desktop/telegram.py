"""The person's own Telegram account: signing in once, then sending files to their storage channel.

The session is saved with secure_store (encrypted for this Windows user); no bot token is used.
"""

import asyncio
import logging
from typing import Awaitable, Callable, Optional

from pyrogram import Client
from pyrogram import errors as tg_errors

from telestore_desktop import __version__, fast_upload, secure_store

log = logging.getLogger("telestore.telegram")
SESSION_FILE = "telegram.session"
PART_ATTEMPTS = 4


class TelegramError(Exception):
    pass


def _friendly(e: Exception) -> str:
    known = {
        tg_errors.PhoneNumberInvalid: "That phone number isn't valid. Use the international format, like +91 98765 43210.",
        tg_errors.PhoneCodeInvalid: "That code isn't right. Check the code Telegram sent and try again.",
        tg_errors.PhoneCodeExpired: "That code has expired. Ask for a new one.",
        tg_errors.PasswordHashInvalid: "That two-step verification password isn't right.",
        tg_errors.PhoneNumberBanned: "Telegram has blocked this phone number.",
    }
    for kind, text in known.items():
        if isinstance(e, kind):
            return text
    if isinstance(e, tg_errors.FloodWait):
        return f"Telegram asks to wait {e.value} seconds before trying again."
    return str(e) or type(e).__name__


def _client(api_id: int, api_hash: str, session_string: Optional[str] = None) -> Client:
    return Client("telestore-desktop", api_id=api_id, api_hash=api_hash, session_string=session_string,
                  in_memory=True, no_updates=True, device_model="TeleStore for Windows",
                  max_concurrent_transmissions=4,  # (the library's own reads; most go through fast_download)
                  app_version=__version__, system_version="Windows")


def has_saved_session() -> bool:
    return bool((secure_store.load(SESSION_FILE) or {}).get("session"))


def forget_session() -> None:
    secure_store.forget(SESSION_FILE)


class SignIn:
    """Signing in to Telegram, step by step: phone number, the code Telegram sends, and the two-step
    verification password if the account has one."""

    def __init__(self, api_id: int, api_hash: str):
        self.client = _client(api_id, api_hash)
        self.phone = ""
        self.code_hash = ""

    async def send_code(self, phone: str) -> None:
        self.phone = phone.replace(" ", "")
        try:
            if not self.client.is_connected:
                await self.client.connect()
            sent = await self.client.send_code(self.phone)
        except Exception as e:
            raise TelegramError(_friendly(e)) from e
        self.code_hash = sent.phone_code_hash

    async def enter_code(self, code: str) -> bool:
        """True when signed in; False when the account's two-step password is needed next."""
        try:
            await self.client.sign_in(self.phone, self.code_hash, code.strip())
        except tg_errors.SessionPasswordNeeded:
            return False
        except Exception as e:
            raise TelegramError(_friendly(e)) from e
        await self._finish()
        return True

    async def enter_password(self, password: str) -> None:
        try:
            await self.client.check_password(password)
        except Exception as e:
            raise TelegramError(_friendly(e)) from e
        await self._finish()

    async def _finish(self) -> None:
        session = await self.client.export_session_string()
        me = await self.client.get_me()
        secure_store.save(SESSION_FILE, {"session": session, "user_id": me.id, "name": me.first_name or ""})
        await self.cancel()

    async def cancel(self) -> None:
        try:
            if self.client.is_connected:
                await self.client.disconnect()
        except Exception:
            pass


class TelegramAccount:
    """The signed-in account, used for uploads."""

    def __init__(self, api_id: int, api_hash: str):
        self.api_id, self.api_hash = api_id, api_hash
        self.client: Optional[Client] = None
        self.known_chats = set()

    @property
    def user_id(self) -> Optional[int]:
        return (secure_store.load(SESSION_FILE) or {}).get("user_id")

    async def start(self) -> None:
        saved = secure_store.load(SESSION_FILE) or {}
        if not saved.get("session"):
            raise TelegramError("Sign in to Telegram first.")
        self.client = _client(self.api_id, self.api_hash, saved["session"])
        try:
            await self.client.start()
        except (tg_errors.AuthKeyUnregistered, tg_errors.SessionRevoked, tg_errors.UserDeactivated) as e:
            forget_session()
            raise TelegramError("Telegram signed this app out. Sign in to Telegram again.") from e
        fast_upload.install(self.client)  # big files over several connections (about 12 pieces at once)

    async def stop(self) -> None:
        if self.client and self.client.is_connected:
            try:
                await self.client.stop()
            except Exception:
                pass

    async def ensure_chat(self, chat_id: int) -> None:
        """Makes sure the account can post in the storage channel (Telegram needs to have seen it once)."""
        if chat_id in self.known_chats:
            return
        try:
            await self.client.get_chat(chat_id)
        except Exception:
            found = False
            async for dialog in self.client.get_dialogs():
                if dialog.chat.id == chat_id:
                    found = True
                    break
            if not found:
                raise TelegramError("This Telegram account isn't in your TeleStore storage channel. "
                                    "Sign in to Telegram with the account that owns the channel.")
        self.known_chats.add(chat_id)

    async def send(self, chat_id: int, make_reader: Callable[[], object], file_name: str, caption: str,
                   thumb: Optional[str], progress: Callable[[int, int], Awaitable[None]],
                   on_wait: Optional[Callable[[str], None]] = None) -> int:
        """Sends one file or part and returns its message id. Waits when Telegram says to slow down,
        and tries again after a network problem (each try starts the part from its beginning)."""
        attempt = 0
        while True:
            reader = make_reader()
            try:
                msg = await self.client.send_document(chat_id, document=reader, file_name=file_name, caption=caption,
                                                      thumb=thumb, force_document=True, progress=progress)
                return msg.id
            except tg_errors.FloodWait as e:
                if on_wait:
                    on_wait(f"Telegram asks to wait {e.value} s")
                await asyncio.sleep(int(e.value) + 1)
            except (asyncio.CancelledError, TelegramError):
                raise
            except (tg_errors.ChatWriteForbidden, tg_errors.ChannelPrivate, tg_errors.ChatAdminRequired) as e:
                raise TelegramError("This Telegram account can't post in your storage channel.") from e
            except Exception as e:
                attempt += 1
                if attempt >= PART_ATTEMPTS:
                    raise TelegramError(f"Telegram upload failed: {_friendly(e)}") from e
                wait = 5 * 3 ** (attempt - 1)  # 5, 15, 45 s
                log.warning(f"Upload of {file_name} failed ({e}); trying again in {wait} s")
                if on_wait:
                    on_wait(f"Network problem; trying again in {wait} s")
                await asyncio.sleep(wait)
            finally:
                try:
                    reader.close()
                except Exception:
                    pass
