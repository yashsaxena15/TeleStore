"""Your devices: the list of sign-ins, and signing one out from another device."""

from datetime import datetime, timedelta
from unittest.mock import patch

import pytest
from bson import ObjectId

from telestore.api.app import app
from telestore.api.state import _auth_tokens, cached_token
from telestore.db import database
from telestore.security.credentials import User, require_auth
from telestore.services import device_service

CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/128.0 Safari/537.36"


class Tokens:
    """The AuthTokens collection: find by username (with an expiry filter), update and delete."""

    def __init__(self):
        self.docs = []

    def add(self, token, username="bob", **extra):
        now = datetime.now()
        doc = {"_id": ObjectId(), "auth_token": token, "username": username, "auth_method": "local",
               "created_at": now - timedelta(days=1), "expires_at": now + timedelta(days=1), **extra}
        self.docs.append(doc)
        return doc

    def find(self, flt):
        return [d for d in self.docs if d["username"] == flt["username"] and d["expires_at"] >= flt["expires_at"]["$gte"]]

    def find_one(self, flt):
        return next((d for d in self.docs if d["auth_token"] == flt["auth_token"]), None)

    def update_one(self, flt, update):
        doc = self.find_one(flt)
        if doc:
            doc.update(update["$set"])

    def delete_one(self, flt):
        self.docs = [d for d in self.docs if d["_id"] != flt["_id"]]


@pytest.fixture
def tokens():
    store = Tokens()
    device_service._session_checks.clear()
    with patch.object(device_service, "_tokens", return_value=store), \
            patch.object(database.Users, "get_auth_token", side_effect=lambda t: store.find_one({"auth_token": t})), \
            patch.object(database.Users, "save_auth_token", side_effect=lambda u, t, m, **k: store.add(t, u, auth_method=m, token_id=device_service.token_id(t), **{x: y for x, y in k.items() if x != "ttl_hours" and y})):
        yield store
    _auth_tokens.clear()


def test_names_this_device_first_and_old_sign_ins(tokens):
    tokens.add("phone", device="android", device_name="Android app", last_seen=datetime.now() - timedelta(hours=2))
    tokens.add("laptop", device_name="Chrome on Windows", last_seen=datetime.now() - timedelta(minutes=5))
    tokens.add("old")
    tokens.add("someone-else", username="eve")
    devices = device_service.listing("bob", device_service.token_id("phone"))
    assert [(d["name"], d["kind"], d["current"]) for d in devices] == [
        ("Android app", "app", True),
        ("Chrome on Windows", "browser", False),
        ("Unknown device (signed in before this update)", "browser", False),
    ]
    assert "phone" not in str(devices)  # tokens never leave the server


def test_first_use_is_saved_even_just_after_the_server_machine_started(tokens):
    tokens.add("laptop")
    with patch.object(device_service.time, "monotonic", return_value=12.0):
        device_service.touch("laptop", {})
    assert "last_seen" in tokens.docs[0]


def test_last_use_is_saved_now_and_then(tokens):
    tokens.add("laptop")
    cached = {}
    device_service.touch("laptop", cached)
    first = tokens.docs[0]["last_seen"]
    device_service.touch("laptop", cached)
    assert tokens.docs[0]["last_seen"] == first


class TestApi:
    @pytest.fixture(autouse=True)
    def signed_in(self, tokens):
        app.dependency_overrides[require_auth] = lambda: User(username="bob")
        yield
        app.dependency_overrides.pop(require_auth, None)

    def test_sign_out_another_device(self, client, tokens):
        tokens.add("phone")
        tokens.add("laptop")
        _auth_tokens["laptop"] = cached_token(tokens.docs[1])
        laptop = device_service.token_id("laptop")
        got = client.get("/auth/devices", headers={"X-Auth-Token": "phone"}).json()["devices"]
        assert [d["current"] for d in got] == [True, False]
        assert client.delete(f"/auth/devices/{laptop}", headers={"X-Auth-Token": "phone"}).status_code == 200
        assert [d["auth_token"] for d in tokens.docs] == ["phone"]
        assert "laptop" not in _auth_tokens  # stops working at once
        assert client.delete(f"/auth/devices/{laptop}", headers={"X-Auth-Token": "phone"}).status_code == 404

    def test_not_this_device(self, client, tokens):
        tokens.add("phone")
        res = client.delete(f"/auth/devices/{device_service.token_id('phone')}", headers={"X-Auth-Token": "phone"})
        assert res.status_code == 400

    def test_sign_out_all_others(self, client, tokens):
        for t in ("phone", "laptop", "tablet"):
            tokens.add(t)
        assert client.post("/auth/devices/sign-out-others", headers={"X-Auth-Token": "phone"}).json() == {"signed_out": 2}
        assert [d["auth_token"] for d in tokens.docs] == ["phone"]


def test_a_browser_signed_out_elsewhere_loses_its_cookie_too(client, tokens):
    with patch("telestore.api.routes.auth.check_login", return_value="bob"), \
            patch("telestore.api.routes.auth.account_flags", return_value=(True, True)), \
            patch("telestore.services.event_service.sign_in"):
        res = client.post("/auth/login", json={"username": "bob", "password": "x"}, headers={"user-agent": CHROME})
    token = res.json()["auth_token"]
    assert tokens.docs[0]["device_name"] == "Chrome on Windows"
    assert client.get("/auth/check").json()["authenticated"] is True  # by cookie alone
    device_service.sign_out("bob", device_service.token_id(token))
    assert client.get("/auth/check").json()["authenticated"] is False


def test_the_app_is_named_as_the_app(client, tokens):
    with patch("telestore.api.routes.auth.check_login", return_value="bob"), \
            patch("telestore.api.routes.auth.account_flags", return_value=(True, True)), \
            patch("telestore.services.event_service.sign_in"):
        client.post("/auth/login", json={"username": "bob", "password": "x", "device": "android"}, headers={"user-agent": "okhttp/4.12"})
    assert (tokens.docs[0]["device"], tokens.docs[0]["device_name"]) == ("android", "Android app")
