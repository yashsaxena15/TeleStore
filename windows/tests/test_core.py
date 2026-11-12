"""Reading parts, the resumable upload list, the saved sign-ins and the TeleStore API client."""

import io
import os
import stat
import sys

import pytest
import requests

from telestore_desktop import secure_store
from telestore_desktop.api import TOKEN_HEADER, ApiError, TeleStoreApi
from telestore_desktop.jobs import DONE, FAILED, UPLOADING, WAITING, Job, JobStore
from telestore_desktop.parts import PartReader, file_key, size_text
from telestore_desktop.settings import Settings


def _file(tmp_path, data=b"0123456789abcdefghijklmnopqrstuvwxyz"):
    p = tmp_path / "big.bin"
    p.write_bytes(data)
    return str(p)


class TestPartReader:
    def test_looks_like_a_file_of_its_own(self, tmp_path):
        r = PartReader(_file(tmp_path), 10, 10, "big.bin.part2")
        r.seek(0, io.SEEK_END)
        assert r.tell() == 10  # how Telegram's client finds the size
        r.seek(0)
        assert r.read(4) + r.read(100) == b"abcdefghij"
        assert r.read(5) == b""
        assert r.name == "big.bin.part2"

    def test_read_at_any_position(self, tmp_path):
        r = PartReader(_file(tmp_path), 30, 6, "x")  # the last, shorter part
        r.seek(4)
        assert r.read() == b"yz"
        assert isinstance(r, io.IOBase)

    def test_the_parts_make_the_whole_file(self, tmp_path):
        data = os.urandom(1000)
        path = _file(tmp_path, data)
        got = b"".join(PartReader(path, s, min(300, 1000 - s), "p").read() for s in range(0, 1000, 300))
        assert got == data

    def test_file_key_changes_when_the_file_does(self, tmp_path):
        path = _file(tmp_path)
        key = file_key(path, "/Home")
        assert file_key(path, "/Home/Other") != key
        with open(path, "ab") as f:
            f.write(b"more")
        assert file_key(path, "/Home") != key

    def test_size_text(self):
        assert size_text(512) == "512 B" and size_text(1536) == "1.5 KB" and size_text(5 * 1024 ** 3) == "5.0 GB"


def _job(n=1, status=WAITING, dest="/Home"):
    return Job(local_path=f"C:/f{n}", dest=dest, name=f"f{n}", size=100, key=f"k{n}|{dest}", status=status)


class TestJobStore:
    def test_kept_across_restarts(self, tmp_path):
        store = JobStore()
        job = store.add(_job())
        store.update(job, done_parts={"1": 55}, total_parts=3)
        again = JobStore()
        assert again.jobs[job.id].done_parts == {"1": 55}

    def test_a_running_upload_continues_after_a_restart(self):
        store = JobStore()
        job = store.add(_job(status=UPLOADING))
        store.update(job, speed=5.0)
        reloaded = JobStore().jobs[job.id]
        assert reloaded.status == WAITING and reloaded.speed == 0

    def test_the_same_file_to_the_same_folder_is_added_once(self):
        store = JobStore()
        first = store.add(_job())
        assert store.add(_job()) is first and len(store.jobs) == 1
        assert store.add(_job(dest="/Home/B")) is not first

    def test_clear_finished(self):
        store = JobStore()
        store.add(_job(1, DONE))
        keep = store.add(_job(2, FAILED))
        store.clear_done()
        assert list(store.jobs) == [keep.id]

    def test_waiting_ones_go_in_order(self):
        store = JobStore()
        a = store.add(_job(1))
        store.add(_job(2))
        assert store.next_waiting() is a


class TestSecureStore:
    def test_round_trip_and_forget(self):
        secure_store.save("x.auth", {"token": "abc"})
        assert secure_store.load("x.auth") == {"token": "abc"}
        secure_store.forget("x.auth")
        assert secure_store.load("x.auth") is None

    @pytest.mark.skipif(sys.platform == "win32", reason="Windows uses DPAPI instead")
    def test_only_its_owner_can_read_it(self):
        from telestore_desktop import paths
        secure_store.save("x.auth", {"token": "abc"})
        assert stat.S_IMODE(os.stat(paths.path("x.auth")).st_mode) == 0o600
        assert b"abc" not in open(paths.path("x.auth"), "rb").read()  # not plain text

    def test_a_damaged_file_means_signed_out(self):
        from telestore_desktop import paths
        open(paths.path("x.auth"), "wb").write(b"garbage!")
        assert secure_store.load("x.auth") is None


class TestSettings:
    def test_defaults_and_limits(self):
        s = Settings.load()
        assert s.parallel == 2 and s.speed_limit_kb == 0
        s.parallel, s.speed_limit_kb = 50, 2048
        s.save()
        loaded = Settings.load()
        assert loaded.parallel == 8 and loaded.speed_limit_kb == 2048


class FakeResponse:
    def __init__(self, status=200, body=None):
        self.status_code, self._body = status, body if body is not None else {}
        self.content = b"x"
        self.text = str(body)

    def json(self):
        return self._body


class FakeHttp:
    def __init__(self, *responses):
        self.responses, self.calls = list(responses), []
        self.headers = {}

    def request(self, method, url, headers=None, timeout=None, **kw):
        self.calls.append((method, url, headers or {}, kw))
        r = self.responses.pop(0)
        if isinstance(r, Exception):
            raise r
        return r


def _api(*responses, token=None):
    api = TeleStoreApi("https://ts.example/", token)
    api.http = FakeHttp(*responses)
    return api


class TestApi:
    def test_login_as_the_windows_app(self):
        api = _api(FakeResponse(body={"auth_token": "tok", "username": "me"}))
        api.login(" me ", "pw")
        method, url, _, kw = api.http.calls[0]
        assert (method, url) == ("POST", "https://ts.example/auth/login")
        assert kw["json"] == {"username": "me", "password": "pw", "device": "windows"}
        assert api.token == "tok"

    def test_sends_its_token(self):
        api = _api(FakeResponse(body={"total_bytes": 5}), token="tok")
        assert api.storage()["total_bytes"] == 5
        assert api.http.calls[0][2][TOKEN_HEADER] == "tok"

    def test_server_errors_read_well(self):
        api = _api(FakeResponse(400, {"detail": "Cannot upload files directly to Telegram Inbox, Trash, or Starred."}))
        with pytest.raises(ApiError, match="Telegram Inbox") as e:
            api.prepare("/Trash", "a", 1)
        assert e.value.status == 400

    def test_signed_out(self):
        with pytest.raises(ApiError, match="Signed out") as e:
            _api(FakeResponse(401, {"detail": "x"})).check()
        assert e.value.status == 401

    def test_no_internet(self):
        with pytest.raises(ApiError, match="Couldn't reach"):
            _api(requests.ConnectionError("down")).check()

    def test_folders_only_and_every_page(self):
        page1 = {"files": [{"file_name": "A", "file_type": "folder"}, {"file_name": "x.txt", "file_type": "document"}],
                 "pagination": {"total_pages": 2}}
        page2 = {"files": [{"file_name": "B", "file_type": "folder"}], "pagination": {"total_pages": 2}}
        api = _api(FakeResponse(body=page1), FakeResponse(body=page2))
        assert [f["file_name"] for f in api.folders("/Home")] == ["A", "B"]
        assert api.http.calls[1][3]["params"]["page"] == 2

    def test_complete_sends_each_parts_message(self):
        api = _api(FakeResponse(body={"message": "File saved"}))
        api.complete("/Home", "a.mkv", 30, [(1, 11), (2, 12)])
        assert api.http.calls[0][3]["json"] == {"path": "/Home", "filename": "a.mkv", "filesize": 30,
                                                "parts": [{"part_index": 1, "message_id": 11}, {"part_index": 2, "message_id": 12}]}
