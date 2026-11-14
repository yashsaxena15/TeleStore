"""Fixes from the 2026-11-14 security audit: each test is one hole that must stay closed."""

import io
import tarfile
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from bson import ObjectId

from telestore.api.app import app
from telestore.db import database
from telestore.security import content_safety, public_url
from telestore.security.credentials import User, require_auth


@pytest.fixture
def as_user():
    def use(**kwargs):
        app.dependency_overrides[require_auth] = lambda: User(**kwargs)
    yield use
    app.dependency_overrides.pop(require_auth, None)


# ── A link can't run script on the site ────────────────────────────────────

def test_the_drive_callback_page_escapes_what_is_in_the_link(client):
    res = client.get("/api/cloud/gdrive/callback", params={"error": "<script>alert(1)</script>'};x=1;//"})
    assert res.status_code == 400
    assert "<script>alert(1)" not in res.text
    assert "&lt;script&gt;" in res.text
    assert "'*'" not in res.text  # the message only goes to this site
    csp = res.headers["content-security-policy"]
    assert "script-src 'nonce-" in csp and "default-src 'none'" in csp


# ── Cancelling an upload can't delete other folders ────────────────────────

@pytest.mark.parametrize("bad", ["../../cache", "abc/../..", "", "A" * 24, "0" * 23])
def test_abort_refuses_anything_but_an_upload_id(client, as_user, bad):
    as_user(username="bob", telegram_user_id=42)
    with patch("telestore.api.routes.files.chunked_upload.shutil.rmtree") as rmtree:
        res = client.post("/files/upload/abort", json={"upload_id": bad})
    assert res.status_code == 400
    rmtree.assert_not_called()


# ── People's files are never pages of the site ─────────────────────────────

@pytest.mark.parametrize("mime, inline, disposition, sandbox", [
    ("text/html", True, "attachment", True),
    ("application/xhtml+xml", True, "attachment", True),
    ("image/svg+xml", True, "inline", True),  # shows in <img>; opened directly it can't run script
    ("video/mp4", True, "inline", True),
    ("application/pdf", True, "inline", False),  # browsers refuse sandboxed PDFs
    ("text/plain; charset=utf-8", True, "inline", True),
    ("image/png", False, "attachment", True),
])
def test_file_responses_are_sandboxed(mime, inline, disposition, sandbox):
    assert content_safety.disposition(inline, mime) == disposition
    headers = content_safety.file_headers(mime)
    assert headers["X-Content-Type-Options"] == "nosniff"
    assert ("sandbox" in headers.get("Content-Security-Policy", "")) is sandbox


# ── The vault needs its PIN for move, copy and zip too ─────────────────────

def test_a_locked_vault_item_cant_be_moved_or_copied_out(client, as_user):
    as_user(username="bob", telegram_user_id=42)
    oid = ObjectId()
    doc = {"_id": oid, "file_name": "secret.jpg", "file_path": "/Vault", "is_vault": True, "owner_id": "42"}
    with patch.object(database.Files, "check_file_owner", return_value=True), \
            patch.object(database.Files, "find_one", return_value=doc), \
            patch.object(database.Files, "update_one") as update, \
            patch.object(database.Files, "insert_one") as insert, \
            patch("telestore.api.routes.files.manage.is_vault_unlocked", return_value=False):
        assert client.post("/files/move", json={"file_id": str(oid), "target_path": "/Home"}).status_code == 403
        assert client.post("/files/copy", json={"file_id": str(oid), "target_path": "/Home"}).status_code == 403
    update.assert_not_called()
    insert.assert_not_called()


def test_a_locked_vault_cant_be_zipped(client, as_user):
    as_user(username="bob", telegram_user_id=42)
    with patch("telestore.api.routes.folders.resolve_folder_info", return_value=(None, "Vault", "/Vault")), \
            patch("telestore.api.routes.folders.is_vault_unlocked", return_value=False), \
            patch.object(database.Files, "find", return_value=[]) as find:
        assert client.get("/folders/download-info", params={"path": "/Vault"}).status_code == 403
        assert client.get("/folders/download-zip", params={"path": "/Vault"}).status_code == 403
    find.assert_not_called()


def test_a_zip_of_everything_leaves_out_a_locked_vault(client, as_user):
    as_user(username="bob", telegram_user_id=42)
    with patch("telestore.api.routes.folders.resolve_folder_info", return_value=(None, "", "/")), \
            patch("telestore.api.routes.folders.is_vault_unlocked", return_value=False), \
            patch("telestore.api.routes.vault.is_vault_unlocked", return_value=False), \
            patch.object(database.Files, "find", return_value=[]) as find:
        client.get("/folders/download-info", params={"path": "/"})
    query = find.call_args.args[0]
    assert query["$nor"] == [{"is_vault": True}, {"file_path": {"$regex": "^/Vault(/|$)"}}]


# ── Leech links only reach the public internet ─────────────────────────────

@pytest.mark.parametrize("url", ["http://127.0.0.1:9000/api", "http://169.254.169.254/opc/v1/instance/",
                                 "http://10.0.0.5/", "http://[::1]/", "file:///etc/passwd", "http://localhost/"])
def test_private_addresses_are_refused(url):
    with pytest.raises(ValueError):
        public_url.check_url(url)


def test_redirects_to_private_addresses_are_refused_before_connecting():
    session = public_url.session()
    with pytest.raises(ValueError):
        session.get("http://127.0.0.1:1/never")  # refused by the adapter, nothing is contacted


def test_a_leech_of_a_private_address_is_refused(client, as_user):
    as_user(username="bob", telegram_user_id=42)
    with patch.object(database.Users, "find_one", return_value={"telegram_user_id": 42, "index_chat_id": -100}), \
            patch("telestore.api.routes.remote_transfer.remote_transfer_manager") as manager:
        res = client.post("/api/transfers/remote/add", json={"url": "http://169.254.169.254/latest/meta-data/"})
    assert res.status_code == 400 and "private" in res.json()["detail"]
    manager.enqueue_transfer.assert_not_called()


# ── Other websites can't use someone's sign-in ─────────────────────────────

def test_other_websites_get_no_cors(client):
    res = client.get("/auth/check", headers={"Origin": "https://evil.example"})
    assert "access-control-allow-origin" not in res.headers
    res = client.get("/auth/check", headers={"Origin": "tauri://localhost"})
    assert res.headers.get("access-control-allow-origin") == "tauri://localhost"


def test_pages_carry_security_headers(client):
    res = client.get("/auth/check", headers={"X-Forwarded-Proto": "https"})
    assert res.headers["x-content-type-options"] == "nosniff"
    assert res.headers["referrer-policy"] == "same-origin"
    assert res.headers["x-frame-options"] == "SAMEORIGIN"
    assert "max-age" in res.headers["strict-transport-security"]


# ── Server errors don't show their insides ─────────────────────────────────

def test_server_errors_keep_their_details_in_the_log(client, as_user):
    as_user(username="bob", telegram_user_id=42)
    with patch("telestore.api.routes.folders.resolve_folder_info", side_effect=RuntimeError("mongo at 10.0.0.3 said no")):
        res = client.get("/folders/stats", params={"path": "/Home"})
    assert res.status_code == 500
    assert "10.0.0.3" not in res.text


# ── Sign-ins ───────────────────────────────────────────────────────────────

def test_wrong_passwords_lock_only_the_address_guessing():
    from telestore.security import credentials
    from telestore.security.attempt_limiter import address_limiter, password_limiter, TooManyAttempts
    password_limiter._state.clear()
    address_limiter._state.clear()
    with patch.object(credentials, "canonical_username", return_value="admin"), \
            patch.object(credentials, "verify_credentials", side_effect=lambda n, p: p == "right"):
        with pytest.raises(TooManyAttempts):
            for _ in range(10):
                credentials.check_login("admin", "wrong", ip="203.0.113.9")
        # The owner, from their own address, still gets in
        assert credentials.check_login("admin", "right", ip="198.51.100.7") == "admin"
    password_limiter._state.clear()
    address_limiter._state.clear()


def test_the_visitor_cant_pick_their_own_address():
    from telestore.security.client_ip import client_ip
    direct = SimpleNamespace(client=SimpleNamespace(host="8.8.8.8"), headers={"x-real-ip": "1.2.3.4"})
    proxied = SimpleNamespace(client=SimpleNamespace(host="172.18.0.1"), headers={"x-real-ip": "1.2.3.4"})
    assert client_ip(direct) == "8.8.8.8"
    assert client_ip(proxied) == "1.2.3.4"


class Tokens:
    def __init__(self, docs):
        self.docs = docs

    def find(self, flt, projection=None):
        def ok(d):
            if d["username"] != flt["username"]:
                return False
            ne = (flt.get("auth_token") or {}).get("$ne")
            return d["auth_token"] != ne
        return [d for d in self.docs if ok(d)]

    def delete_one(self, flt):
        self.docs[:] = [d for d in self.docs if d["_id"] != flt["_id"]]


def test_a_new_password_signs_out_the_other_devices():
    from telestore.api import state
    from telestore.services import device_service
    key = device_service.token_key
    docs = [{"_id": i, "username": "bob", "auth_token": key(t), "token_id": device_service.token_id(t)}
            for i, t in enumerate(["phone", "laptop", "stolen"])] + [{"_id": 9, "username": "eve", "auth_token": key("eve")}]
    for t in ("phone", "laptop", "stolen"):
        state.remember_token(t, {"username": "bob", "expires_at": None})
    with patch.object(device_service, "_tokens", return_value=Tokens(docs)):
        assert device_service.sign_out_all("bob", keep_token="phone") == 2
    assert [d["auth_token"] for d in docs] == [key("phone"), key("eve")]
    assert state.cached_token_valid("stolen") is None and state.cached_token_valid("phone")
    state._auth_tokens.clear()


def test_tokens_are_stored_hashed():
    from unittest.mock import MagicMock
    from telestore.db.repositories.users import Users
    from telestore.services import device_service
    repo = SimpleNamespace(database=MagicMock())
    Users.save_auth_token(repo, "bob", "raw-token", "local")
    stored = repo.database.AuthTokens.update_one.call_args.args[1]["$set"]["auth_token"]
    assert stored == device_service.token_key("raw-token") and "raw-token" not in stored


# ── Workers ────────────────────────────────────────────────────────────────

def test_a_wrong_worker_key_is_refused(client):
    res = client.post("/api/worker/heartbeat", json={"worker_id": "x"}, headers={"X-Worker-Key": "nope"})
    assert res.status_code == 401


# ── Archives ───────────────────────────────────────────────────────────────

def test_a_tar_cant_write_outside_its_folder(tmp_path):
    import asyncio
    from telestore.services import cloud_archive
    evil = tmp_path / "evil.tar"
    with tarfile.open(evil, "w") as tf:
        data = b"pwned"
        info = tarfile.TarInfo("../outside.txt")
        info.size = len(data)
        tf.addfile(info, io.BytesIO(data))
    out = tmp_path / "out"
    out.mkdir()

    async def no_7z(*a, **k):
        raise FileNotFoundError("7z")
    with patch.object(cloud_archive.asyncio, "create_subprocess_exec", side_effect=no_7z):
        with pytest.raises(Exception):
            asyncio.run(cloud_archive.extract_with_7z_or_fallback(str(evil), str(out)))
    assert not (tmp_path / "outside.txt").exists()


# ── Shared cache ───────────────────────────────────────────────────────────

def test_only_the_owner_clears_the_shared_cache(client):
    with patch("telestore.api.routes.media.require_auth", return_value=User(username="family")):
        assert client.post("/media/cache/clear").status_code == 403
