"""Updates, downloads (files, folders, resume), the Photos timeline, and the new pages."""

import os
import time
from datetime import date, datetime

import pytest
from PySide6.QtCore import Qt

from telestore_desktop import downloads as dl
from telestore_desktop import updates
from telestore_desktop.items import Item, from_listing

from test_telegram_and_ui import _pump, qapp, window  # noqa: F401  (fixtures)


# ── Updates ──
def _release(tag, version, prerelease=False, asset=None):
    name = asset or f"TeleStore-Setup-{version}.exe"
    return {"tag_name": tag, "prerelease": prerelease, "draft": False, "html_url": f"https://gh/{tag}", "body": "Notes",
            "assets": [{"name": f"TeleStore-{version}-portable.exe", "browser_download_url": "x", "size": 1},
                       {"name": name, "browser_download_url": f"https://gh/{tag}/{name}", "size": 1234}]}


LISTING = [_release("android-latest", "1.0.200", True, asset="TeleStore-1.0.200.apk"),
           _release("windows-latest", "1.0.70", True), _release("windows-v1.1.0", "1.1.0"),
           _release("windows-v1.0.5", "1.0.5"), _release("android-v1.1.0", "1.1.0", asset="app.apk")]


def test_versions_compare_by_number():
    assert updates.is_newer("1.0.10", "1.0.9")
    assert updates.is_newer("1.1.0", "1.0.70")
    assert not updates.is_newer("1.0.70", "1.0.70")
    assert updates.is_newer("1.0.1", "1.0")


def test_only_windows_installers_are_seen():
    found = updates.releases_from(LISTING)
    assert [(r.version, r.channel) for r in found] == [("1.0.70", "beta"), ("1.1.0", "stable"), ("1.0.5", "stable")]
    assert found[0].setup_url.endswith("TeleStore-Setup-1.0.70.exe") and found[0].size == 1234


def test_channels():
    found = updates.releases_from(LISTING)
    assert updates.newest(found, "stable").version == "1.1.0"
    assert updates.newest(found, "beta").version == "1.1.0"  # beta follows whichever is newest
    beta_only = updates.releases_from(LISTING[:2])
    assert updates.newest(beta_only, "beta").version == "1.0.70"
    assert updates.newest(beta_only, "stable") is None


class _Resp:
    def __init__(self, status=200, body=None, data=b"", headers=None):
        self.status_code, self._body, self.data = status, body, data
        self.headers = headers or {"Content-Length": str(len(data))}

    def json(self):
        return self._body

    def iter_content(self, n):
        for i in range(0, len(self.data), 4):
            yield self.data[i:i + 4]

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def test_check_says_whether_there_is_something_newer():
    # (conftest replaces updates.check for the app; the real one is reached through the module's own name)
    import importlib
    real = importlib.reload(updates).check
    assert real("beta", "1.0.60", get=lambda *a, **k: _Resp(body=LISTING)).version == "1.1.0"
    assert real("beta", "1.1.0", get=lambda *a, **k: _Resp(body=LISTING)) is None
    with pytest.raises(ConnectionError):
        real("beta", "1.0.0", get=lambda *a, **k: _Resp(status=403, body={}))


def test_download_checks_the_size(tmp_path):
    rel = updates.Release("1.2.0", "beta", "https://x/setup.exe", 10, "https://x")
    path = updates.download(rel, folder=str(tmp_path), get=lambda *a, **k: _Resp(data=b"0123456789"))
    assert open(path, "rb").read() == b"0123456789" and path.endswith("TeleStore-Setup-1.2.0.exe")
    rel.size = 99
    with pytest.raises(ConnectionError):
        updates.download(rel, folder=str(tmp_path / "b"), get=lambda *a, **k: _Resp(data=b"short"))
    assert not os.listdir(tmp_path / "b")


def test_not_installed_when_run_from_source():
    assert updates.installed() is False


# ── Downloads ──
class _Http:
    """Serves files by URL, with byte ranges, like the server and the app's media server."""

    def __init__(self, files):
        self.files, self.asked = files, []

    def get(self, url, headers=None, stream=True, timeout=None):
        headers = headers or {}
        self.asked.append((url, headers.get("Range")))
        data = self.files[url]
        rng = headers.get("Range")
        if rng:
            start = int(rng.split("=")[1].rstrip("-"))
            if start >= len(data):
                return _Resp(416)
            return _Resp(206, data=data[start:])
        return _Resp(200, data=data)


class _Api:
    token = None

    def __init__(self, files, under=None, share=None):
        self.http = _Http(files)
        self.under, self.share = under or {}, share or {}

    def file_url(self, item, inline=True):
        return f"u/{item.id}"

    def files_under(self, folder):
        return self.under.get(folder, [])

    def browse_share(self, share_id, path=""):
        return {"items": self.share.get(path, [])}


def _wait_done(manager, n, timeout=5):
    end = time.time() + timeout
    while time.time() < end:
        jobs = manager.all()
        if len(jobs) >= n and all(j.status in (dl.DONE, dl.FAILED) for j in jobs):
            return jobs
        time.sleep(0.02)
    raise AssertionError([(j.name, j.status, j.error) for j in manager.all()])


def test_several_files_at_once_with_free_names(tmp_path):
    (tmp_path / "a.txt").write_bytes(b"old")
    api = _Api({"u/1": b"hello", "u/2": b"world!", "u/3": b"again"})
    m = dl.DownloadManager(api, parallel=2)
    items = [Item("1", "a.txt", "document", 5), Item("2", "b.txt", "document", 6), Item("3", "a.txt", "document", 5)]
    m.add(items, str(tmp_path))
    _wait_done(m, 3)
    assert (tmp_path / "a.txt").read_bytes() == b"old"  # never overwritten
    assert sorted(p.name for p in tmp_path.iterdir()) == ["a (1).txt", "a (2).txt", "a.txt", "b.txt"]
    assert {(tmp_path / "a (1).txt").read_bytes(), (tmp_path / "a (2).txt").read_bytes()} == {b"hello", b"again"}
    assert len(m.take_finished()) == 3
    m.close()


def test_a_whole_folder_keeps_its_layout(tmp_path):
    under = {"/Home/Trip": [
        {"id": "f1", "file_name": "a.jpg", "file_type": "photo", "file_size": 3, "file_path": "/Home/Trip"},
        {"id": "f2", "file_name": "b.mp4", "file_type": "video", "file_size": 4, "file_path": "/Home/Trip/Day 1"},
        {"id": "f3", "file_name": "c.jpg", "file_type": "photo", "file_size": 2, "file_path": "/Home/Trip/Day 1/Raw"}]}
    api = _Api({"u/f1": b"aaa", "u/f2": b"bbbb", "u/f3": b"cc"}, under=under)
    m = dl.DownloadManager(api)
    m.add([Item("t", "Trip", "folder", path="/Home")], str(tmp_path))
    _wait_done(m, 3)
    assert (tmp_path / "Trip" / "a.jpg").read_bytes() == b"aaa"
    assert (tmp_path / "Trip" / "Day 1" / "b.mp4").read_bytes() == b"bbbb"
    assert (tmp_path / "Trip" / "Day 1" / "Raw" / "c.jpg").read_bytes() == b"cc"
    assert {j.group for j in m.all()} == {"Trip"}
    m.close()


def test_a_shared_folder_is_walked_through_the_share(tmp_path):
    share = {"": [{"id": "s1", "name": "x.jpg", "type": "photo", "size": 1}, {"id": "d", "name": "Sub", "type": "folder"}],
             "Sub": [{"id": "s2", "name": "y.jpg", "type": "photo", "size": 1}]}
    api = _Api({"u/s1": b"x", "u/s2": b"y"}, share=share)
    m = dl.DownloadManager(api)
    root = Item("r", "Holiday", "folder", share_id="sh", share_root=True)
    m.add([root], str(tmp_path))
    _wait_done(m, 2)
    assert (tmp_path / "Holiday" / "x.jpg").read_bytes() == b"x"
    assert (tmp_path / "Holiday" / "Sub" / "y.jpg").read_bytes() == b"y"
    m.close()


def test_resumes_from_what_it_has(tmp_path):
    (tmp_path / "big.bin.part").write_bytes(b"01234")
    api = _Api({"u/9": b"0123456789"})
    m = dl.DownloadManager(api)
    m.add([Item("9", "big.bin", "document", 10)], str(tmp_path))
    _wait_done(m, 1)
    assert (tmp_path / "big.bin").read_bytes() == b"0123456789"
    assert api.http.asked == [("u/9", "bytes=5-")]
    m.close()


def test_cancel_removes_the_partial_file(tmp_path):
    m = dl.DownloadManager(_Api({}), parallel=1)
    m.close()  # nothing runs: the job stays waiting
    m.add([Item("1", "a.bin", "document", 10)], str(tmp_path))
    job = m.all()[0]
    (tmp_path / "a.bin.part").write_bytes(b"xx")
    m.pause(job.id)
    assert job.status == dl.PAUSED
    m.cancel(job.id)
    assert m.all() == [] and not (tmp_path / "a.bin.part").exists()


# ── The Photos timeline ──
def test_day_and_month_words():
    from telestore_desktop.ui.pages.photos import day_label, month_label, month_title
    today = date(2026, 11, 13)
    assert day_label(datetime(2026, 11, 13, 9), today) == "Today"
    assert day_label(datetime(2026, 11, 12, 23), today) == "Yesterday"
    assert day_label(datetime(2026, 10, 29), today) == "Thu, Oct 29"
    assert day_label(datetime(2025, 1, 2), today) == "Thu, Jan 2, 2025"
    assert day_label(None, today) == "Undated"
    assert month_label(datetime(2026, 3, 1), today) == "March"
    assert month_label(datetime(2024, 3, 1), today) == "March 2024"
    assert month_title(None, datetime(2026, 11, 2), today) == ""  # not this month
    assert month_title(None, datetime(2026, 10, 2), today) == "October"
    assert month_title(datetime(2026, 10, 9), datetime(2026, 10, 2), today) == ""


def test_grouped_by_the_day_they_were_taken():
    from telestore_desktop.ui.pages.photos import group_by_day, group_by_month
    rows = [{"id": "1", "file_name": "a.jpg", "taken_at": "2026-11-13T08:00:00", "modified_date": "2020-01-01T00:00:00"},
            {"id": "2", "file_name": "b.jpg", "taken_at": "2026-11-13T07:00:00"},
            {"id": "3", "file_name": "c.mp4", "modified_date": "2026-11-01T07:00:00"},
            {"id": "4", "file_name": "d.jpg"}]
    items = [from_listing(r) for r in rows]
    days = group_by_day(items, date(2026, 11, 13))
    assert [(d.label, [i.id for i in d.items]) for d in days] == [("Today", ["1", "2"]), ("Sun, Nov 1", ["3"]),
                                                                  ("Undated", ["4"])]
    assert [g.label for g in group_by_month(items, date(2026, 11, 13))] == ["November", "Undated"]


def test_photos_page_shows_the_phone_backup_by_day(qapp, window):  # noqa: F811
    asked = []
    original = window.s.api.media
    window.s.api.media = lambda under, page=1, page_size=200: (asked.append(under), original(under, page, page_size))[1]
    window.open_place("photos")
    assert window.stack.currentWidget() is window.photos
    _pump(qapp, lambda: window.photos.timeline.items)
    assert asked[0] == "/Home/Phone Backup"
    kinds = [r.kind for r in window.photos.timeline.rows]
    assert kinds.count("day") == 5 and "tiles" in kinds
    assert window.sidebar.buttons["photos"].isChecked()
    assert "5 photos and videos" in window.photos.subtitle.text()


# ── Pages ──
def test_storage_page(qapp, window):  # noqa: F811
    stats = {"total_bytes": 3 * 1024 ** 3, "quota_bytes": 10 * 1024 ** 3, "total_files": 12, "total_folders": 3,
             "trash_bytes": 1024, "trash_count": 2, "starred_count": 1,
             "by_category": {"video": {"count": 2, "bytes": 2 * 1024 ** 3}, "photo": {"count": 10, "bytes": 1024 ** 3}},
             "largest_files": [{"id": "a1", "file_name": "clip.mp4", "file_type": "video", "file_size": 2 * 1024 ** 3,
                                "file_path": "/Home/Movies"}]}
    window.s.api.storage = lambda: stats
    window.open_place("storage")
    _pump(qapp, lambda: window.storage.largest.topLevelItemCount() == 1)
    assert window.storage.used.text() == "3.0 GB"
    assert "7.0 GB free" in window.storage.of.text()
    assert window.storage.trash_v.text() == "1.0 KB"
    opened = []
    window.storage.open_folder.connect(opened.append)
    window.storage.open_folder.emit("/Home/Movies")
    assert window.stack.currentWidget() is window.browser and window.browser.loc.path == "/Home/Movies"


def test_shared_by_me_page(qapp, window, monkeypatch):  # noqa: F811
    from telestore_desktop.ui import dialogs
    window.open_place("shared-by-me")
    _pump(qapp, lambda: window.shared_by_me.table.topLevelItemCount() == 1)
    row = window.shared_by_me.table.topLevelItem(0)
    assert [row.text(c) for c in range(4)] == ["clip.mp4", "/Home", "2 people", "On"]
    monkeypatch.setattr(dialogs, "confirm", lambda *a: True)
    stopped = []
    window.s.api.stop_sharing = lambda item_id: stopped.append(item_id) or {}
    window.shared_by_me.stop(row.data(0, Qt.UserRole))
    _pump(qapp, lambda: stopped == ["a1"])


def test_transfers_page_lists_uploads_downloads_and_the_server(qapp, window, tmp_path):  # noqa: F811
    from telestore_desktop.jobs import Job
    window.s.store.add(Job(local_path=str(tmp_path / "x"), dest="/Home", name="up.mp4", size=10, key="k", status="paused"))
    window.downloads.close()
    window.downloads.add([Item("z", "down.zip", "archive", 10)], str(tmp_path))
    window.open_place("transfers")
    _pump(qapp, lambda: len(window.transfers.rows) == 3)
    names = {e.name: e for e in window.transfers.entries()}
    assert names["movie.mkv"].kind == "server" and names["movie.mkv"].status == "running"
    assert names["up.mp4"].actions == ["resume", "cancel"]
    assert names["down.zip"].kind == "download"
    window.transfers.set_filter("server")
    assert list(window.transfers.rows) == ["r:r1"]
    assert "Downloads  1" in [b.text() for b in window.transfers.chips.values()]
    window.downloads.cancel(names["down.zip"].key[2:])  # (closing would ask about the waiting download)


def test_download_selected_items_goes_to_the_downloads_folder(qapp, window, tmp_path):  # noqa: F811
    window.s.settings.download_folder = str(tmp_path)
    got = []
    window.downloads.add = lambda items, folder: got.append(([i.name for i in items], folder))
    _pump(qapp, lambda: window.browser.grid.count() == 4)
    window.browser.grid.item(0).setSelected(True)
    window.browser.grid.item(1).setSelected(True)
    assert window.browser.bar.isVisible() and window.browser.bar_count.text() == "2 selected"
    window.browser._bar_action("download")
    assert got == [(["Movies", "clip.mp4"], str(tmp_path))]


def test_details_pane(qapp, window):  # noqa: F811
    _pump(qapp, lambda: window.browser.grid.count() == 4)
    window.info_btn.setChecked(True)
    assert window.details.isVisible()
    window.browser.grid.item(0).setSelected(True)  # the Movies folder
    def texts():
        return " ".join(label.text() for label in window.details.findChildren(type(window.details.name)))

    _pump(qapp, lambda: "3 files" in texts() and "Shared with" in texts())
    shown = texts()
    assert "4.0 KB" in shown and "Shared with 1 person" in shown


def test_details_facts():
    from telestore_desktop.ui.details import facts, sharing_text
    item = from_listing({"id": "1", "file_name": "clip.mp4", "file_type": "video", "file_size": 2048, "file_path": "/Home/A",
                         "duration": 75, "taken_at": "2026-01-02T03:04:00"})
    rows = dict(facts(item))
    assert rows["Type"] == "Video (MP4)" and rows["Location"] == "/Home/A" and rows["Length"] == "1:15"
    assert sharing_text({"members": [1, 2], "link": {"enabled": True}}) == "Shared with 2 people and anyone with the link"
    assert sharing_text({}) == "Not shared"


def test_notifications(qapp, window):  # noqa: F811
    _pump(qapp, lambda: window.notes.loaded)
    assert window.notes.unread == 1 and window.notes.items[0]["title"] == "Bob shared Trip"
    arrived = []
    window.notes.arrived.connect(arrived.append)
    window.notes.merge({"items": [{"id": "n2", "title": "Done", "read": False}], "unread": 2, "latest": "n2"}, fresh=False)
    assert [i["id"] for i in arrived[0]] == ["n2"] and [i["id"] for i in window.notes.items] == ["n2", "n1"]
    window.follow_notification({"target": {"type": "transfers"}})
    assert window.stack.currentWidget() is window.transfers
    window.follow_notification({"target": {"type": "folder", "path": "/Home/Movies"}})
    assert window.browser.loc.path == "/Home/Movies"
    window.notes.mark_all_read()
    assert window.notes.unread == 0


def test_update_button_appears(qapp, window):  # noqa: F811
    window.updater.available.emit(updates.Release("9.9.9", "beta", "u", 1, "p"))
    assert window.update_btn.isVisibleTo(window) and "9.9.9" in window.update_btn.text()


def test_sidebar_has_every_page(qapp, window):  # noqa: F811
    for key in ("home", "recent", "starred", "shared", "shared-by-me", "trash", "photos", "transfers", "storage"):
        window.open_place(key)
        qapp.processEvents()
        assert window.sidebar.buttons[key].isChecked(), key


def test_a_folder_transfer_is_one_row():
    from telestore_desktop.ui.transfer_rows import from_group
    e = from_group("g1", {"name": "Lectures", "total": 10, "counts": {"completed": 4, "downloading": 1, "queued": 5},
                          "filesize": 1000, "transferred_bytes": 400, "download_bps": 50})
    assert e.key == "g:g1" and e.status == "running" and e.actions == ["cancel"] and "4 of 10 files" in e.line
    e = from_group("g1", {"name": "Lectures", "total": 10, "counts": {"completed": 8, "failed": 2}, "error": "404"})
    assert e.status == "failed" and e.actions == ["retry"] and "2 failed: 404" in e.line
