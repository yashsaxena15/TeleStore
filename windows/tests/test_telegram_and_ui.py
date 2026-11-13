"""Sending with the person's Telegram account, and the windows (drawn off-screen)."""

import asyncio
import time
from types import SimpleNamespace
from unittest.mock import patch

from PySide6.QtCore import Qt

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


class FakeBrowseApi:
    """The server's listing calls, with a small library."""

    def __init__(self, inner):
        self.inner = inner
        self.made = []

    def __getattr__(self, name):
        return getattr(self.inner, name)

    def list_files(self, path, page=1, page_size=200, sort_by="name", order="asc", q=None, kind=None):
        home = [{"id": "f1", "file_name": "Movies", "file_type": "folder", "file_path": "/Home"},
                {"id": "a1", "file_name": "clip.mp4", "file_type": "video", "file_size": 5 * 1024 ** 2, "file_path": "/Home",
                 "modified_date": "2026-11-01T10:00:00"},
                {"id": "a2", "file_name": "beach.jpg", "file_type": "photo", "file_size": 2048, "file_path": "/Home"},
                {"id": "a3", "file_name": "notes.pdf", "file_type": "document", "file_size": 999, "file_path": "/Home"}]
        files = {"/Home": home, "/Home/Movies": [], "starred": home[1:2], "trash": []}.get(path, home[1:] if path == "all" else [])
        if q:
            files = [f for f in home if q.lower() in f["file_name"].lower()]
        return {"files": files, "pagination": {"total_pages": 1}}

    def shared_with_me(self):
        return [{"share_id": "s1", "role": "viewer", "owner": {"name": "Alice"},
                 "item": {"id": "x1", "name": "Trip", "type": "folder"}}]

    def browse_share(self, share_id, path=""):
        return {"items": [{"id": "x2", "name": "day1.jpg", "type": "photo", "size": 10, "has_thumb": True}]}

    def storage(self):
        return {"total_bytes": 5 * 1024 ** 3, "total_files": 12, "quota_bytes": 0}

    def media(self, under, page=1, page_size=200):
        files = [{"id": f"m{n}", "file_name": f"IMG_{n}.jpg", "file_type": "photo", "file_size": 1000,
                  "file_path": under, "taken_at": f"2026-10-{20 - n:02d}T10:00:00"} for n in range(5)]
        return {"files": files, "pagination": {"has_next": False, "total_items": 5}}

    def shared_by_me(self):
        return [{"share_id": "s9", "item": {"id": "a1", "name": "clip.mp4", "type": "video", "size": 5},
                 "location": "/Home", "members": 2, "link": {"enabled": True, "token": "t", "state": "active"}}]

    def remote_tasks(self):
        return {"tasks": [{"task_id": "r1", "filename": "movie.mkv", "status": "downloading", "filesize": 1000,
                           "transferred_bytes": 250, "download_bps": 100}]}

    def notifications(self, after=None, limit=30):
        return {"items": [{"id": "n1", "kind": "share", "title": "Bob shared Trip", "body": "", "read": False,
                           "created_at": "2026-11-13T10:00:00Z", "target": {"type": "shared"}}],
                "unread": 1, "latest": "n1"}

    def mark_notifications_read(self, ids=None):
        return 0

    def folder_stats(self, folder_id):
        return {"total_files": 3, "total_subfolders": 1, "total_size": 4096}

    def files_under(self, folder):
        return []

    def create_folder(self, name, parent):
        self.made.append((name, parent))
        return {}

    calls = None

    def _log(self, *call):
        if self.calls is None:
            self.calls = []
        self.calls.append(call)
        return {}

    def rename(self, file_id, new_name):
        return self._log("rename", file_id, new_name)

    def move(self, file_id, target):
        return self._log("move", file_id, target)

    def star(self, file_id, starred):
        return self._log("star", file_id, starred)

    def trash(self, file_id):
        if file_id == "locked":
            from telestore_desktop.api import ApiError
            raise ApiError("This item is protected from deletion.", 423)
        return self._log("trash", file_id)

    def restore(self, file_id):
        return self._log("restore", file_id)

    def delete_forever(self, file_id):
        return self._log("delete", file_id)

    def empty_trash(self):
        return self._log("empty") or {"message": "Trash emptied"}

    def folders(self, path):
        return [{"file_name": "Movies", "file_type": "folder"}] if path == "/Home" else []

    def share_view(self, item_id):
        link = {"enabled": True, "token": "tok1", "state": "active"} if ("link", item_id, True) in (self.calls or []) else None
        return {"members": [{"user_id": 5, "username": "bob", "name": "Bob", "role": "viewer"}], "link": link}

    def share_link(self, item_id, enabled):
        return self._log("link", item_id, enabled)

    def share_add(self, item_id, who, role="viewer"):
        return self._log("add", item_id, who, role)

    def share_remove(self, item_id, user_id):
        return self._log("remove", item_id, user_id)

    def link_address(self, token):
        return f"https://ts.example/s/{token}"

    def thumbnail_url(self, item):
        return None

    def file_url(self, item, inline=True):
        return f"https://ts.example/dl/{item.name}"

    def fetch(self, url, timeout=30):
        return b""


@pytest.fixture
def window(qapp, tmp_path):
    from test_engine import FakeAccount, FakeApi

    from telestore_desktop.engine import UploadEngine
    from telestore_desktop.jobs import JobStore
    from telestore_desktop.settings import Settings
    from telestore_desktop.ui import theme
    from telestore_desktop.ui.main_window import MainWindow
    from telestore_desktop.ui.runner import Runner

    api = FakeBrowseApi(FakeApi())
    store = JobStore()
    engine = UploadEngine(api, FakeAccount(), store, parallel=2)
    engine.start()
    state = SimpleNamespace(api=api, engine=engine, store=store, settings=Settings.load(), runner=Runner(),
                            username="me", palette=theme.LIGHT, sign_out=lambda **k: None)
    w = MainWindow(state)
    w.resize(1200, 760)
    w.show()
    yield w
    w.status_timer.stop()
    w.panel.timer.stop()
    engine.stop()
    from telestore_desktop.ui import dialogs
    ask, dialogs.confirm = dialogs.confirm, lambda *a: True  # closing never waits on a question
    try:
        w.close()
    finally:
        dialogs.confirm = ask


def _pump(qapp, cond, timeout=5):
    end = time.time() + timeout
    while time.time() < end:
        qapp.processEvents()
        if cond():
            return
        time.sleep(0.02)
    raise AssertionError("timed out")


def _names(w):
    return [w.browser.grid.item(i).text() for i in range(w.browser.grid.count())]


def test_opens_home_with_folders_first_and_storage(qapp, window):
    _pump(qapp, lambda: _names(window) == ["Movies", "clip.mp4", "beach.jpg", "notes.pdf"])
    _pump(qapp, lambda: "5.0 GB used" in window.sidebar.storage_text.text())
    assert window.sidebar.buttons["home"].isChecked()


def test_double_click_a_folder_goes_in_and_back_comes_out(qapp, window):
    _pump(qapp, lambda: window.browser.grid.count() == 4)
    window.browser._activate(window.browser.grid.item(0).data(Qt.UserRole))
    assert window.browser.loc.path == "/Home/Movies"
    _pump(qapp, lambda: "empty" in window.browser.message.text())
    window.browser.go_back()
    assert window.browser.loc.path == "/Home"


def test_sidebar_places(qapp, window):
    window.open_place("starred")
    _pump(qapp, lambda: _names(window) == ["clip.mp4"])
    assert window.sidebar.buttons["starred"].isChecked()
    window.open_place("trash")
    _pump(qapp, lambda: "Trash is empty" in window.browser.message.text())
    window.open_place("shared")
    _pump(qapp, lambda: _names(window) == ["Trip"])
    window.browser._activate(window.browser.grid.item(0).data(Qt.UserRole))
    assert window.browser.loc.kind == "share" and window.browser.loc.share_name == "Trip"
    _pump(qapp, lambda: _names(window) == ["day1.jpg"])


def test_search(qapp, window):
    window.browser.search.setText("clip")
    window.browser._search()
    _pump(qapp, lambda: _names(window) == ["clip.mp4"])


def test_list_view(qapp, window):
    _pump(qapp, lambda: window.browser.grid.count() == 4)
    window.browser.set_view("list")
    assert window.browser.stack.currentWidget() is window.browser.table
    assert window.browser.table.topLevelItem(0).text(0) == "Movies"


def test_drop_uploads_into_the_folder_you_are_in(qapp, window, tmp_path):
    _pump(qapp, lambda: window.browser.grid.count() == 4)
    f = tmp_path / "new.mp4"
    f.write_bytes(b"x" * 25)
    window.upload_here([str(f)])
    _pump(qapp, lambda: window.s.api.inner.completed)
    assert window.s.api.inner.completed[0][0] == "/Home"
    _pump(qapp, lambda: window.panel.isVisible() or window.panel.title.text().endswith("complete"))
    _pump(qapp, lambda: "complete" in window.panel.title.text())


def test_no_uploads_outside_home_folders(qapp, window, monkeypatch):
    from telestore_desktop.ui import dialogs
    told = []
    monkeypatch.setattr(dialogs, "info", lambda parent, title, text: told.append(text))
    window.open_place("trash")
    window.upload_here(["C:/x.bin"])
    assert told and "Open a folder in Home" in told[0]


def test_new_folder(qapp, window, monkeypatch):
    from telestore_desktop.ui import dialogs
    monkeypatch.setattr(dialogs, "ask_text", lambda *a, **k: "Holidays")
    window.new_action("new-folder")
    _pump(qapp, lambda: window.s.api.made == [("Holidays", "/Home")])


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
    assert s.speed_limit_kb() == 0 and s.theme.currentData() == "system"
    s.limit_on.setChecked(True)
    s.limit.setValue(3)
    assert s.speed_limit_kb() == 3 * 1024


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


def test_photo_viewer_steps_through_the_folder(qapp, tmp_path):
    from PySide6.QtCore import QBuffer, QByteArray
    from PySide6.QtGui import QColor, QImage

    from telestore_desktop.items import Item
    from telestore_desktop.ui.runner import Runner
    from telestore_desktop.ui.viewers import ImageViewer
    img = QImage(64, 48, QImage.Format_RGB32)
    img.fill(QColor("orange"))
    ba = QByteArray()
    buf = QBuffer(ba)
    buf.open(QBuffer.WriteOnly)
    img.save(buf, "PNG")
    asked = []
    api = SimpleNamespace(file_url=lambda item, inline=True: f"u/{item.name}", thumbnail_url=lambda item: f"t/{item.name}",
                          fetch=lambda url, timeout=30: (asked.append(url), bytes(ba))[1])
    photos = [Item(id="1", name="a.jpg", kind="photo"), Item(id="2", name="b.heic", kind="photo")]
    v = ImageViewer(api, Runner(), photos, 0)
    v.show()
    _pump(qapp, lambda: not v.picture.pixmap().isNull())
    assert "1 of 2" in v.title.text()
    v.step(1)
    _pump(qapp, lambda: "t/b.heic" in asked)  # HEIC comes as the server's preview
    assert "2 of 2" in v.title.text()
    v.step(1)
    assert "1 of 2" in v.title.text()
    v.close()


def test_player_builds(qapp):
    pytest.importorskip("PySide6.QtMultimedia")
    from telestore_desktop.items import Item
    from telestore_desktop.ui import theme
    from telestore_desktop.ui.viewers import Player
    api = SimpleNamespace(file_url=lambda item, inline=True: "http://127.0.0.1:9/none.mp4")
    p = Player(api, None, Item(id="1", name="song.mp3", kind="audio"), theme.DARK)
    assert p.video.isHidden() and p.windowTitle().startswith("song.mp3")
    p.close()


def test_other_files_are_downloaded_then_opened(qapp, monkeypatch, tmp_path):
    from telestore_desktop.items import Item
    from telestore_desktop.ui import viewers
    opened, saved = [], []
    monkeypatch.setattr(viewers, "_download", lambda parent, api, item, target, then=None: (saved.append(target), then(target)))
    monkeypatch.setattr(viewers, "open_with_windows", lambda path: opened.append(path))
    viewers.open_item(None, SimpleNamespace(), None, None, Item(id="abcdef123", name="Report: Q3?.pdf", kind="pdf", size=5), [])
    assert opened == saved and saved[0].endswith("abcdef12_Report_ Q3_.pdf")


# ── Phase 9: right-click actions ──

def _ready(qapp, window):
    _pump(qapp, lambda: window.browser.grid.count() == 4)
    return [window.browser.grid.item(i).data(Qt.UserRole) for i in range(4)]


def _calls(window):
    return window.s.api.calls or []


def test_rename(qapp, window, monkeypatch):
    from telestore_desktop.ui import dialogs
    items = _ready(qapp, window)
    monkeypatch.setattr(dialogs, "ask_text", lambda *a, **k: "holiday.mp4")
    window.item_action("rename", [items[1]])
    _pump(qapp, lambda: ("rename", "a1", "holiday.mp4") in _calls(window))


def test_move_star_trash_restore_delete(qapp, window, monkeypatch):
    from telestore_desktop.ui import actions, dialogs
    items = _ready(qapp, window)
    monkeypatch.setattr(dialogs, "confirm", lambda *a: True)
    monkeypatch.setattr(actions.MoveDialog, "exec", lambda self: True)
    monkeypatch.setattr(actions.MoveDialog, "target", lambda self: "/Home/Movies")
    window.item_action("move", items[1:3])
    window.item_action("star", [items[2]])
    window.item_action("trash", [items[3]])
    window.item_action("restore", [items[3]])
    window.item_action("delete", [items[3]])
    window.item_action("empty-trash", [])
    want = [("move", "a1", "/Home/Movies"), ("move", "a2", "/Home/Movies"), ("star", "a2", True), ("trash", "a3"),
            ("restore", "a3"), ("delete", "a3"), ("empty",)]
    _pump(qapp, lambda: all(w in _calls(window) for w in want))


def test_nothing_happens_without_confirming(qapp, window, monkeypatch):
    from telestore_desktop.ui import dialogs
    items = _ready(qapp, window)
    monkeypatch.setattr(dialogs, "confirm", lambda *a: False)
    window.item_action("trash", [items[1]])
    window.item_action("delete", [items[1]])
    for _ in range(20):
        qapp.processEvents()
        time.sleep(0.01)
    assert _calls(window) == []


def test_a_protected_item_says_why(qapp, window, monkeypatch):
    from telestore_desktop.items import Item
    from telestore_desktop.ui import dialogs
    told = []
    monkeypatch.setattr(dialogs, "confirm", lambda *a: True)
    monkeypatch.setattr(dialogs, "info", lambda parent, title, text: told.append(text))
    window.item_action("trash", [Item(id="locked", name="Taxes", kind="folder")])
    _pump(qapp, lambda: told)
    assert "protected" in told[0]


def test_keys_f2_and_delete(qapp, window, monkeypatch):
    from telestore_desktop.ui import dialogs
    monkeypatch.setattr(dialogs, "confirm", lambda *a: False)  # Delete asks first
    monkeypatch.setattr(dialogs, "ask_text", lambda *a, **k: "")  # F2 asks for the name
    items = _ready(qapp, window)
    got = []
    window.browser.action.connect(lambda name, its: got.append((name, [i.id for i in its])))
    window.browser.grid.item(1).setSelected(True)
    window.browser._key_action("rename")
    window.browser._key_action("trash")
    assert got == [("rename", ["a1"]), ("trash", ["a1"])]
    window.open_place("trash")
    window.browser.items = items
    assert window.browser.empty_btn.isVisibleTo(window)


def test_move_dialog_lists_folders_but_not_the_ones_moving(qapp):
    from telestore_desktop.ui import theme
    from telestore_desktop.ui.actions import MoveDialog
    from telestore_desktop.ui.runner import Runner
    api = SimpleNamespace(folders=lambda path: [{"file_name": "Movies"}, {"file_name": "Music"}] if path == "/Home" else [])
    d = MoveDialog(api, Runner(), theme.LIGHT, 1, exclude=["/Home/Music"])
    home = d.tree.topLevelItem(0)
    _pump(qapp, lambda: home.childCount() == 1)
    assert home.child(0).text(0) == "Movies"
    d.tree.setCurrentItem(home.child(0))
    assert d.target() == "/Home/Movies"


def test_share_dialog(qapp, window):
    from telestore_desktop.items import Item
    from telestore_desktop.ui.actions import ShareDialog
    d = ShareDialog(window.s.api, window.s.runner, Item(id="a1", name="clip.mp4", kind="video"))
    _pump(qapp, lambda: d.people.count() == 1 and "Bob" in d.people.item(0).text())
    assert not d.link_on.isChecked() and not d.copy.isEnabled()
    d.link_on.setChecked(True)
    _pump(qapp, lambda: d.link.text() == "https://ts.example/s/tok1")
    d.who.setText("carol")
    d.role.setCurrentIndex(1)
    d._add()
    _pump(qapp, lambda: ("add", "a1", "carol", "editor") in _calls(window))
    d.people.setCurrentRow(0)
    d._remove()
    _pump(qapp, lambda: ("remove", "a1", 5) in _calls(window))
    d.close()
