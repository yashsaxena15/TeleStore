"""The one-off repair moves a finished transfer's file out of Telegram Inbox only when exactly one
Inbox file fits it (owner, name, size, saved around when the transfer finished)."""

from datetime import datetime, timedelta, timezone

from bson import ObjectId

from telestore.tools import repair_transfers

FINISHED = datetime(2026, 10, 31, 11, 0, tzinfo=timezone.utc)


def oid(at):
    return ObjectId.from_datetime(at)


class Coll:
    def __init__(self, docs):
        self.docs = docs

    @staticmethod
    def _ok(doc, flt):
        for k, v in flt.items():
            have = doc.get(k)
            if isinstance(v, dict):
                if "$ne" in v and have == v["$ne"]:
                    return False
                if "$in" in v and have not in v["$in"]:
                    return False
            elif have != v:
                return False
        return True

    def find(self, flt, *_):
        return [d for d in self.docs if self._ok(d, flt)]

    def find_one(self, flt, *_ , **__):
        found = self.find(flt)
        return found[0] if found else None


def task(name, size=100, folder="/Home/Tools"):
    return {"task_id": f"t-{name}", "status": "completed", "user_id": "42", "filename": name, "destination_path": folder,
            "filesize": size, "updated_at": FINISHED.replace(tzinfo=None)}


_seconds = iter(range(1, 1000))


def inbox(name, size=100, at=FINISHED):
    # Each record its own ID (an ID made from a time alone repeats for the same time)
    return {"_id": oid(at + timedelta(seconds=next(_seconds))), "owner_id": "42", "file_path": "/Telegram Inbox", "file_name": name, "file_size": size, "chat_id": -100, "message_id": 1}


def test_only_a_single_fitting_inbox_file_is_moved():
    db = {
        "RemoteTransfers": Coll([task("a.bin"), task("b.bin"), task("c.bin"), task("d.bin"), task("ok.bin")]),
        "Files": Coll([
            inbox("a.bin"),                                            # fits: moves
            inbox("b.bin"), inbox("b.bin", at=FINISHED + timedelta(minutes=5)),  # two fit: left alone
            inbox("c.bin", size=2040),                                 # wrong size
            inbox("d.bin", at=FINISHED - timedelta(days=2)),           # saved long before
            {"_id": oid(FINISHED), "owner_id": "42", "file_path": "/Home/Tools", "file_name": "ok.bin"},  # already in place
        ]),
    }
    result = repair_transfers.find_misplaced(db)
    assert [m["name"] for m in result["moves"]] == ["a.bin"]
    assert {u["name"]: u["inbox_matches"] for u in result["unsure"]} == {"b.bin": 2, "c.bin": 0, "d.bin": 0}
