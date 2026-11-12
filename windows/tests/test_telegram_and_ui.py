"""Sending with the person's Telegram account, and the windows (drawn off-screen)."""

import asyncio
import time
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from pyrogram import errors as tg_errors

from telestore_desktop import secure_store
from telestore_desktop import telegram as tg


class FakeReader:
    closed = False

    def close(self):
        self.closed = True


class FakeClient:
    def __init__(self, outcomes, dialogs=(), chat_ok=True):
        self.outcomes, self.dialogs, self.chat_ok, self.calls = list(outcomes), list(dialogs), chat_ok, []

    async def send_document(self, chat_id, **kw):
        self.calls.append(kw)
        out = self.outcomes.pop(0)
        if isinstance(out, Exception):
            raise out
        return SimpleNamespace(id=out)

    async def get_chat(self, chat_id):
        if not self.chat_ok:
            raise tg_errors.PeerIdInvalid()
        return SimpleNamespace(id=chat_id)

    async def get_dialogs(self):
        for chat_id in self.dialogs:
            yield SimpleNamespace(chat=SimpleNamespace(id=chat_id))


async def _no_wait(seconds):
    return None


def _account(client):
    acc = tg.TelegramAccount(1, "h")
    acc.client = client
    return acc


async def _progress(c, t):
    return None


class TestSend:
    def test_waits_when_telegram_asks_then_sends(self):
        client = FakeClient([tg_errors.FloodWait(value=3), 42])
        waits = []
        with patch.object(tg.asyncio, "sleep", _no_wait):
            mid = asyncio.run(_account(client).send(-100, FakeReader, "a", "cap", None, _progress, waits.append))
        assert mid == 42 and len(client.calls) == 2 and "wait 3" in waits[0]
        assert client.calls[0]["caption"] == "cap" and client.calls[0]["force_document"] is True

    def test_tries_again_after_a_network_problem(self):
        client = FakeClient([ConnectionError("reset"), OSError("again"), 7])
        with patch.object(tg.asyncio, "sleep", _no_wait):
            assert asyncio.run(_account(client).send(-100, FakeReader, "a", "c", None, _progress)) == 7

    def test_gives_up_after_a_few_tries(self):
        client = FakeClient([ConnectionError("x")] * tg.PART_ATTEMPTS)
        with patch.object(tg.asyncio, "sleep", _no_wait), pytest.raises(tg.TelegramError, match="upload failed"):
            asyncio.run(_account(client).send(-100, FakeReader, "a", "c", None, _progress))

    def test_no_right_to_post_is_clear(self):
        client = FakeClient([tg_errors.ChatWriteForbidden()])
        with pytest.raises(tg.TelegramError, match="can't post"):
            asyncio.run(_account(client).send(-100, FakeReader, "a", "c", None, _progress))

    def test_each_try_reads_the_part_from_its_start(self):
        made = []

        def reader():
            made.append(FakeReader())
            return made[-1]
        with patch.object(tg.asyncio, "sleep", _no_wait):
            asyncio.run(_account(FakeClient([ConnectionError("x"), 1])).send(-100, reader, "a", "c", None, _progress))
        assert len(made) == 2 and all(r.closed for r in made)


class TestChannel:
    def test_found_among_the_accounts_chats(self):
        acc = _account(FakeClient([], dialogs=[-5, -100], chat_ok=False))
        asyncio.run(acc.ensure_chat(-100))
        assert -100 in acc.known_chats

    def test_not_a_member_is_clear(self):
        acc = _account(FakeClient([], dialogs=[-5], chat_ok=False))
        with pytest.raises(tg.TelegramError, match="isn't in your TeleStore storage channel"):
            asyncio.run(acc.ensure_chat(-100))


class TestSavedSession:
    def test_saved_and_forgotten(self):
        assert not tg.has_saved_session()
        secure_store.save(tg.SESSION_FILE, {"session": "abc", "user_id": 5})
        assert tg.has_saved_session() and tg.TelegramAccount(1, "h").user_id == 5
        tg.forget_session()
        assert not tg.has_saved_session()

    def test_start_without_a_session(self):
        with pytest.raises(tg.TelegramError, match="Sign in to Telegram"):
            asyncio.run(tg.TelegramAccount(1, "h").start())


# ── The windows, off-screen ──

@pytest.fixture
def qapp():
    from PySide6.QtWidgets import QApplication
    return QApplication.instance() or QApplication([])


@pytest.fixture
def window(qapp, tmp_path):
    from test_engine import FakeAccount, FakeApi

    from telestore_desktop.engine import UploadEngine
    from telestore_desktop.jobs import JobStore
    from telestore_desktop.settings import Settings
    from telestore_desktop.ui.main_window import MainWindow
    from telestore_desktop.ui.runner import Runner

    api = FakeApi()
    api.folders = lambda path: [{"file_name": "Movies", "file_type": "folder"}] if path == "/Home" else []
    api.storage = lambda: {"total_bytes": 5 * 1024 ** 3, "total_files": 12, "quota_bytes": 0}
    store = JobStore()
    engine = UploadEngine(api, FakeAccount(), store, parallel=2)
    engine.start()
    state = SimpleNamespace(api=api, engine=engine, store=store, settings=Settings.load(), runner=Runner(),
                            who="Signed in as me", sign_out=lambda **k: None)
    w = MainWindow(state)
    yield w
    w.timer.stop()
    engine.stop()


def _pump(qapp, cond, timeout=5):
    end = time.time() + timeout
    while time.time() < end:
        qapp.processEvents()
        if cond():
            return
        time.sleep(0.02)
    raise AssertionError("timed out")


def test_main_window_shows_folders_storage_and_uploads(qapp, window, tmp_path):
    _pump(qapp, lambda: "5.0 GB" in window.storage_text.text())
    assert "12 files" in window.storage_text.text()
    home = window.tree.topLevelItem(0)
    _pump(qapp, lambda: home.childCount() == 1)
    window.tree.setCurrentItem(home.child(0))
    assert window.current == "/Home/Movies" and "/Home/Movies" in window.dest.text()

    f = tmp_path / "clip.mp4"
    f.write_bytes(b"x" * 25)
    window._add([str(f)])
    _pump(qapp, lambda: window.s.api.completed)
    window._refresh()
    assert window.table.rowCount() == 1
    assert window.table.item(0, 0).text() == "clip.mp4"
    assert window.table.item(0, 2).text() == "/Home/Movies"
    _pump(qapp, lambda: (window._refresh() or True) and window.table.item(0, 5).text() == "Done")
    window._clear_done()
    window._refresh()
    assert window.table.rowCount() == 0 and window.hint.isVisibleTo(window)


def test_dialogs_build(qapp):
    from telestore_desktop.settings import Settings
    from telestore_desktop.ui import dialogs
    from telestore_desktop.ui.runner import Runner
    runner = Runner()
    login = dialogs.LoginDialog(runner, "https://ts.example", "me")
    assert login.username.text() == "me"
    tgd = dialogs.TelegramDialog(runner, 1, "h")
    assert tgd.pages.count() == 3 and tgd.button.text() == "Send code"
    tgd._next()  # no phone number yet
    assert "phone number" in tgd.error.text()
    s = dialogs.SettingsDialog(Settings.load())
    assert s.parallel.value() == 3 and s.limit.specialValueText() == "No cap"


def test_photo_thumbnail(qapp, tmp_path):
    import os

    from PySide6.QtGui import QColor, QImage

    from telestore_desktop.ui import thumbs
    img = QImage(1200, 800, QImage.Format_RGB32)
    img.fill(QColor("teal"))
    src = str(tmp_path / "p.png")
    img.save(src)
    out = thumbs.make(src)
    assert out and QImage(out).width() == 320 and os.path.getsize(out) <= 200 * 1024
    os.remove(out)
    assert thumbs.make(str(tmp_path / "missing.mkv")) is None
