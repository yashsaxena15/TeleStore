"""One Telegram account and one storage chat per TeleStore account, and nothing lost when linking."""

from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from telestore.services import account_link


class Coll:
    """Just enough of a MongoDB collection: equality and $in filters, $set updates."""

    def __init__(self, docs=None):
        self.docs = [dict(d) for d in docs or []]

    @staticmethod
    def _ok(doc, flt):
        for key, want in flt.items():
            have = doc.get(key)
            if isinstance(want, dict) and "$in" in want:
                if have not in want["$in"]:
                    return False
            elif have != want:
                return False
        return True

    def find_one(self, flt):
        return next((d for d in self.docs if self._ok(d, flt)), None)

    def update_one(self, flt, upd, upsert=False):
        doc = self.find_one(flt)
        if doc is None and upsert:
            doc = dict(flt)
            self.docs.append(doc)
        if doc is not None:
            doc.update(upd.get("$set", {}))
        return SimpleNamespace(modified_count=1 if doc else 0)

    def update_many(self, flt, upd):
        hit = [d for d in self.docs if self._ok(d, flt)]
        for d in hit:
            d.update(upd.get("$set", {}))
        return SimpleNamespace(modified_count=len(hit))


def _db():
    return {
        "Users": Coll([{"username": "admin", "telegram_user_id": 111, "index_chat_id": -1001},
                       {"username": "yash"}, {"username": "rahul", "telegram_user_id": "222"}]),
        **{name: Coll() for name, _ in account_link.OWNED},
    }


def test_a_telegram_account_another_user_has_is_refused():
    db = _db()
    with pytest.raises(account_link.LinkRefused, match="admin"):
        account_link.link_telegram("yash", {"telegram_user_id": 111}, db)
    with pytest.raises(account_link.LinkRefused):  # stored as text or a number, the same account
        account_link.link_telegram("yash", {"telegram_user_id": 222}, db)
    assert "telegram_user_id" not in db["Users"].find_one({"username": "yash"})


def test_linking_your_own_again_is_fine():
    db = _db()
    account_link.link_telegram("admin", {"telegram_user_id": 111, "telegram_username": "me"}, db)
    assert db["Users"].find_one({"username": "admin"})["telegram_username"] == "me"


def test_linking_moves_what_the_account_had_under_its_username():
    db = _db()
    db["Files"].docs = [{"owner_id": "yash", "file_name": "a.jpg"}, {"owner_id": "111", "file_name": "admins.jpg"}]
    db["RemoteTransfers"].docs = [{"user_id": "yash"}]
    moved = account_link.link_telegram("yash", {"telegram_user_id": 333}, db)
    assert moved == {"Files": 1, "RemoteTransfers": 1}
    assert [d["owner_id"] for d in db["Files"].docs] == ["333", "111"]  # admin's files untouched
    assert db["Users"].find_one({"username": "yash"})["telegram_user_id"] == 333


def test_switching_to_another_telegram_account_brings_the_files_along():
    db = _db()
    db["Files"].docs = [{"owner_id": "222"}]
    account_link.link_telegram("rahul", {"telegram_user_id": 444}, db)
    assert db["Files"].docs[0]["owner_id"] == "444"


def test_a_storage_chat_belongs_to_one_account():
    db = _db()
    with pytest.raises(account_link.LinkRefused, match="admin"):
        account_link.check_chat_free(-1001, username="yash", db=db)
    with pytest.raises(account_link.LinkRefused):
        account_link.check_chat_free("-1001", telegram_id=222, db=db)
    account_link.check_chat_free(-1001, username="admin", db=db)  # your own: fine
    account_link.check_chat_free(-1001, telegram_id="111", db=db)
    account_link.check_chat_free(-1002, username="yash", db=db)  # nobody's: fine


def test_the_app_cant_set_another_accounts_chat(monkeypatch):
    from telestore.api.app import app
    from telestore.security.credentials import User, require_auth
    monkeypatch.setattr(account_link, "_db", _db)
    app.dependency_overrides[require_auth] = lambda: User(username="yash")
    try:
        r = TestClient(app).put("/user/index-chat", json={"index_chat_id": -1001})
        assert r.status_code == 409 and "admin" in r.json()["detail"]
    finally:
        app.dependency_overrides.clear()


class StrictDb(dict):
    """Like pymongo's Database: refuses to be used as true / false."""

    def __bool__(self):
        raise NotImplementedError("Database objects do not implement truth value testing or bool()")


def test_works_with_a_real_style_database(monkeypatch):
    db = StrictDb(_db())
    monkeypatch.setattr(account_link, "_db", lambda: db)
    db["Files"].docs = [{"owner_id": "yash"}]
    account_link.link_telegram("yash", {"telegram_user_id": 555})  # the bot calls it without a db
    assert db["Users"].find_one({"username": "yash"})["telegram_user_id"] == 555
    assert db["Files"].docs[0]["owner_id"] == "555"
    with pytest.raises(account_link.LinkRefused):
        account_link.check_chat_free(-1001, username="yash")
