"""The owner decides who may use the cloud features (they cost the server's bandwidth), and can pause
or resume each machine that runs cloud transfers (Transfers › Workers)."""

import asyncio
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from telestore.api.app import app
from telestore.security.credentials import User, cloud_allowed, require_auth
from telestore.services import cloud_access, server_settings, worker_control


@pytest.fixture
def server_switch():
    state = {"on": False}
    with patch.object(server_settings, "get", side_effect=lambda: {"archives_enabled": True, "cloud_enabled": state["on"]}):
        yield state


@pytest.mark.parametrize("server_on, choice, allowed", [
    (False, None, False),  # off unless the owner allows it
    (True, None, True),
    (False, "allow", True),
    (True, "block", False),
    (False, "nonsense", False),
])
def test_the_users_choice_wins_over_the_server_switch(server_switch, server_on, choice, allowed):
    server_switch["on"] = server_on
    assert cloud_allowed("bob", {"cloud": choice} if choice else {}) is allowed


def test_the_owner_always_has_them(server_switch):
    assert cloud_allowed("admin", {"cloud": "block"}) is True


@pytest.fixture
def signed_in():
    def sign_in(**flags):
        app.dependency_overrides[require_auth] = lambda: User(username="bob", telegram_user_id=42, **flags)
    yield sign_in
    app.dependency_overrides.pop(require_auth, None)


@pytest.mark.parametrize("method, path, body", [
    ("post", "/api/transfers/remote/add", {"url": "https://example.com/a.zip"}),
    ("post", "/api/transfers/remote/retry", {"task_id": "t1"}),
    ("post", "/api/transfers/remote/media/preview", {"url": "https://youtu.be/x"}),
    ("post", "/api/transfers/remote/instagram/preview", {"url": "https://instagram.com/p/x"}),
    ("post", "/api/cloud/gdrive/auth-url", {}),
    ("get", "/api/cloud/acc1/files", None),
])
def test_cloud_features_are_refused_when_not_allowed(client, signed_in, method, path, body):
    signed_in(cloud=False)
    res = getattr(client, method)(path, json=body) if body is not None else getattr(client, method)(path)
    assert res.status_code == 403
    assert "owner" in res.json()["detail"]


def test_they_can_still_see_and_cancel_what_they_started(client, signed_in):
    signed_in(cloud=False)
    with patch("telestore.api.routes.remote_transfer.remote_transfer_manager") as manager:
        manager.get_user_tasks.return_value = {"tasks": [], "groups": []}
        assert client.get("/api/transfers/remote/tasks").status_code == 200
        manager.cancel_task.return_value = True
        assert client.post("/api/transfers/remote/cancel", json={"task_id": "t1"}).status_code == 200
    assert client.get("/api/cloud/accounts").json() == {"accounts": []}


def test_the_owner_sets_a_users_cloud_features(client, server_switch):
    app.dependency_overrides[require_auth] = lambda: User(username="admin")
    stored = {"_id": "u2", "username": "family"}
    try:
        with patch("telestore.api.routes.user.database") as db:
            db.Users.get_user_by_identifier.side_effect = lambda _id: stored
            db.Users.update_user_by_identifier.side_effect = lambda _id, data: stored.update(data) or True
            res = client.put("/user/u2", json={"cloud": "allow"})
            assert (res.json()["cloud"], res.json()["cloud_allowed"]) == ("allow", True)
            res = client.put("/user/u2", json={"cloud": "default"})
            assert (res.json()["cloud"], res.json()["cloud_allowed"]) == ("default", False)
            assert client.put("/user/u2", json={"cloud": "maybe"}).status_code == 400
    finally:
        app.dependency_overrides.pop(require_auth, None)


class Coll:
    def __init__(self, docs=None):
        self.docs = [dict(d) for d in docs or []]

    @staticmethod
    def _ok(doc, flt):
        for k, want in flt.items():
            have = doc.get(k)
            if isinstance(want, dict):
                if "$in" in want and have not in want["$in"]:
                    return False
                if "$exists" in want and (k in doc) != want["$exists"]:
                    return False
            elif have != want:
                return False
        return True

    def find_one(self, flt):
        return next((d for d in self.docs if self._ok(d, flt)), None)

    def find(self, flt):
        return [d for d in self.docs if self._ok(d, flt)]

    def update_one(self, flt, upd, upsert=False):
        doc = self.find_one(flt)
        if doc is None and upsert:
            doc = {k: v for k, v in flt.items() if not isinstance(v, dict)}
            self.docs.append(doc)
        if doc is not None:
            doc.update(upd.get("$set", {}))
        return SimpleNamespace(modified_count=1 if doc else 0)

    def update_many(self, flt, upd):
        hit = [d for d in self.docs if self._ok(d, flt)]
        for d in hit:
            d.update(upd.get("$set", {}))
            for k in upd.get("$unset", {}):
                d.pop(k, None)
        return SimpleNamespace(modified_count=len(hit))

    def aggregate(self, pipeline):
        docs = self.find(pipeline[0]["$match"])
        counts = {}
        for d in docs:
            counts[d["claimed_by"]] = counts.get(d["claimed_by"], 0) + 1
        return [{"_id": k, "n": v} for k, v in counts.items()]


@pytest.fixture
def db(monkeypatch):
    now = datetime.now(timezone.utc)
    data = {
        "WorkerNodes": Coll([{"worker_id": "phone-redmi", "last_seen": now},
                             {"worker_id": "vm2-mumbai", "last_seen": now - timedelta(minutes=5)}]),
        "RemoteTransfers": Coll([{"task_id": "a", "status": "downloading", "claimed_by": "phone-redmi"},
                                 {"task_id": "b", "status": "uploading_tg", "claimed_by": "phone-redmi"},
                                 {"task_id": "c", "status": "downloading", "claimed_by": "master-vm1"},
                                 {"task_id": "d", "status": "queued"}]),
        "Users": Coll([{"username": "bob", "telegram_user_id": 42, "cloud": "allow"}, {"username": "eve"}]),
    }
    monkeypatch.setattr(worker_control, "_db", lambda: data)
    monkeypatch.setattr(cloud_access, "_db", lambda: data)
    worker_control._cache.clear()
    return data


def test_the_overview_lists_every_machine_main_first(db):
    rows = worker_control.overview()
    assert [r["worker_id"] for r in rows] == ["master-vm1", "phone-redmi", "vm2-mumbai"]
    assert [r["running"] for r in rows] == [1, 2, 0]
    assert [r["online"] for r in rows] == [True, True, False]


def test_pausing_and_handing_back(db):
    worker_control.set_paused("phone-redmi", True)
    assert worker_control.is_paused("phone-redmi") and not worker_control.is_paused("vm2-mumbai")
    assert worker_control.hand_back("phone-redmi") == 2
    a = db["RemoteTransfers"].find_one({"task_id": "a"})
    assert a["status"] == "queued" and "claimed_by" not in a
    assert db["RemoteTransfers"].find_one({"task_id": "c"})["claimed_by"] == "master-vm1"  # others untouched
    worker_control.set_paused("phone-redmi", False)
    assert not worker_control.is_paused("phone-redmi")


def test_a_paused_machine_gets_no_new_transfers(client, db, test_secrets):
    worker_control.set_paused("phone-redmi", True)
    with patch("telestore.api.routes.worker.get_remote_db", return_value=db):
        res = client.post("/api/worker/claim-task", json={"worker_id": "phone-redmi", "skills": []},
                          headers={"X-Worker-Key": test_secrets["worker_secret"]})
    assert res.json()["has_task"] is False and res.json()["paused"] is True


def test_only_the_owner_pauses_machines(client, db):
    app.dependency_overrides[require_auth] = lambda: User(username="bob", telegram_user_id=42)
    try:
        assert client.get("/api/worker/machines").status_code == 403
        assert client.post("/api/worker/machines/phone-redmi/pause", json={}).status_code == 403
        app.dependency_overrides[require_auth] = lambda: User(username="admin")
        with patch("telestore.api.routes.worker.get_remote_db", return_value=db):
            res = client.post("/api/worker/machines/phone-redmi/pause", json={"stop_now": True})
            assert res.json() == {"paused": True, "handed_back": 2}
            assert client.post("/api/worker/machines/nobody/pause", json={}).status_code == 404
            assert client.post("/api/worker/machines/phone-redmi/resume").json() == {"paused": False}
        assert [r["paused"] for r in client.get("/api/worker/machines").json()["machines"]] == [False, False, False]
    finally:
        app.dependency_overrides.pop(require_auth, None)


def test_pausing_the_main_server_with_stop_now_stops_its_own_tasks(client, db):
    app.dependency_overrides[require_auth] = lambda: User(username="admin")
    try:
        with patch("telestore.services.remote_transfer_manager.remote_transfer_manager.stop_local_tasks") as stop:
            async def stopped():
                return 1
            stop.side_effect = stopped
            res = client.post("/api/worker/machines/master-vm1/pause", json={"stop_now": True})
        assert res.json() == {"paused": True, "handed_back": 1}
        stop.assert_called_once()
    finally:
        app.dependency_overrides.pop(require_auth, None)


def test_stopping_local_tasks_hands_them_back_quietly():
    from telestore.services.remote_transfer_manager.manager import RemoteTransferManager

    async def go():
        m = RemoteTransferManager()

        async def forever():
            await asyncio.sleep(3600)
        m.active_tasks["t1"] = asyncio.create_task(forever())
        assert await m.stop_local_tasks(wait_s=1) == 1
        assert "t1" in m._handed_back
        with patch("telestore.services.remote_transfer_manager.manager.get_remote_db") as gdb:
            m._update_task("t1", {"status": "cancelled"})  # late news is dropped
            gdb.assert_not_called()
    asyncio.run(go())


def test_synced_playlists_follow_the_permission(db, monkeypatch):
    monkeypatch.setattr(server_settings, "get", lambda: {"archives_enabled": True, "cloud_enabled": False})
    assert cloud_access.allowed_for_owner_id("42") is True    # bob: allowed, kept under his Telegram id
    assert cloud_access.allowed_for_owner_id("eve") is False  # follows the server: off
    assert cloud_access.allowed_for_owner_id("admin") is True
