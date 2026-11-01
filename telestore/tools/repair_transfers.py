# telestore/tools/repair_transfers.py
"""Repairs transfers saved wrongly before the integrity fixes of November 2026.

Run inside the app container:

    python -m telestore.tools.repair_transfers scan    # changes nothing: writes the report and a summary
    python -m telestore.tools.repair_transfers apply   # does what the last scan found, nothing else

What it looks for:
1. Misplaced: a finished transfer whose file isn't in its folder, because the Telegram Inbox
   listener took it first. Its Inbox copy (same owner and name, same size when known, saved
   within half an hour of the transfer finishing) moves to the folder.
2. Fake: a small file that is really a web page the source sent instead (Google Drive's
   download limit notice). Every file of 256 B to 64 KB in the library is read back from
   Telegram to check. Fakes go to Trash; the transfer that made one is queued again.
3. Transfers of the given folder copies (--group) that failed or were cancelled are queued again.
"""

import argparse
import asyncio
import json
import os
import re
import sys
import time
from datetime import datetime, timedelta, timezone

from telestore.services.download_check import HEAD_BYTES, HTML_NAMES, looks_like_html

REPORT = os.path.join(os.getenv("MEDIA_CACHE_DIR", "/app/cache/media").rsplit("/", 1)[0], "repair_report.json")
INBOX = "/Telegram Inbox"
WINDOW = timedelta(minutes=30)
SMALLEST, LARGEST = 256, 64 * 1024
QUOTA_TEXT = re.compile(r"too many users have (viewed or )?downloaded|download quota|quota (was |has been )?exceeded", re.I)


def _db():
    # Connected the way the app connects (its MONGO_DB_NAME database), not get_remote_db's fallback
    from telestore.config import APP_NAME, DATABASE_URL
    from telestore.db import database
    from telestore.services.remote_transfer_manager.helpers import get_remote_db
    if getattr(database, "db", None) is None:
        database.connect(APP_NAME, DATABASE_URL)
    return get_remote_db()


def _utc(value):
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    return None


# ── 1. Misplaced ────────────────────────────────────────────────────────────

def find_misplaced(db) -> dict:
    files, tasks = db["Files"], db["RemoteTransfers"]
    moves, unsure, taken = [], [], set()
    for task in tasks.find({"status": "completed", "is_range_part": {"$ne": True}},
                           {"task_id": 1, "user_id": 1, "filename": 1, "destination_path": 1, "filesize": 1, "updated_at": 1}):
        name, folder, owner = task.get("filename"), task.get("destination_path"), str(task.get("user_id") or "")
        if not name or not folder or not owner or folder == INBOX:
            continue
        if files.find_one({"owner_id": owner, "file_path": folder, "file_name": name, "trashed": {"$ne": True}}, {"_id": 1}):
            continue
        size = int(task.get("filesize") or 0)
        finished = _utc(task.get("updated_at"))
        candidates = []
        for f in files.find({"owner_id": owner, "file_path": INBOX, "file_name": name, "trashed": {"$ne": True}},
                            {"_id": 1, "file_size": 1, "chat_id": 1, "message_id": 1}):
            if str(f["_id"]) in taken or (size and int(f.get("file_size") or 0) != size):
                continue
            if finished and abs(f["_id"].generation_time - finished) > WINDOW:
                continue
            candidates.append(f)
        entry = {"task_id": task["task_id"], "name": name, "to": folder, "owner": owner}
        if len(candidates) == 1:
            f = candidates[0]
            taken.add(str(f["_id"]))
            moves.append({**entry, "file_id": str(f["_id"]), "chat_id": f.get("chat_id"), "message_id": f.get("message_id")})
        else:
            unsure.append({**entry, "inbox_matches": len(candidates)})
    return {"moves": moves, "unsure": unsure}


# ── 2. Fake files ───────────────────────────────────────────────────────────

# Types where a file of a few KB is almost never real: checked first, so their results come early
SUSPECT = re.compile(r"\.(mp4|mkv|webm|avi|mov|m4v|ts|flv|3gp|mp3|m4a|flac|wav|ogg|opus|aac|zip|rar|7z|tar|gz|tgz|xz|bz2|zst|iso|img|bin|"
                     r"apk|exe|msi|dmg|pdf|epub|docx?|xlsx?|pptx?|win\d*|tgz)$", re.I)


async def find_fakes(db, limit: int = 0, bots: int = 4) -> dict:
    """Reads every small file's first bytes back from Telegram (with [bots] spare bots in parallel,
    each in its own short-lived session, so the running app isn't disturbed)."""
    from pyrogram import Client
    from telestore.config import API_HASH, API_ID, TOKENS

    files = db["Files"]
    query = {"file_type": {"$ne": "folder"}, "trashed": {"$ne": True}, "is_split": {"$ne": True},
             "message_id": {"$ne": None}, "file_size": {"$gte": SMALLEST, "$lte": LARGEST}}
    todo = [f for f in files.find(query, {"_id": 1, "chat_id": 1, "message_id": 1, "file_name": 1, "file_path": 1, "owner_id": 1, "file_size": 1})
            if f.get("chat_id") and not (f.get("file_name") or "").lower().endswith(HTML_NAMES)]
    todo.sort(key=lambda f: (not SUSPECT.search(f.get("file_name") or ""), int(f["chat_id"]), f["message_id"]))
    if limit:
        todo = todo[:limit]
    # Batches of up to 200 messages from one chat, dealt out to the bots in turn
    batches = []
    for f in todo:
        if batches and len(batches[-1]) < 200 and batches[-1][0]["chat_id"] == f["chat_id"]:
            batches[-1].append(f)
        else:
            batches.append([f])
    bots = max(1, min(bots, len(TOKENS)))
    print(f"Reading {len(todo)} small files back from Telegram with {bots} bots to look for web pages…", flush=True)

    fakes, state = [], {"done": 0, "unreadable": 0}
    started = time.monotonic()

    async def run_bot(index: int, token: str):
        async with Client(f"repair_scan_{index}", api_id=API_ID, api_hash=API_HASH, bot_token=token,
                          in_memory=True, no_updates=True, sleep_threshold=300) as client:
            gate = asyncio.Semaphore(4)

            async def read(msg, f):
                async with gate:
                    try:
                        head = b""
                        async for chunk in client.stream_media(msg, limit=1):
                            head = bytes(chunk[:HEAD_BYTES])
                            break
                    except Exception:
                        state["unreadable"] += 1
                        return
                if looks_like_html(head):
                    text = re.sub(rb"<[^>]+>", b" ", head).decode("utf-8", "ignore")
                    fakes.append({"file_id": str(f["_id"]), "name": f["file_name"], "path": f["file_path"], "owner": str(f.get("owner_id") or ""),
                                  "size": f.get("file_size"), "google_limit": bool(QUOTA_TEXT.search(text))})

            for batch in batches[index::bots]:
                chat_id = int(batch[0]["chat_id"])
                try:
                    msgs = await client.get_messages(chat_id, [d["message_id"] for d in batch])
                except Exception as e:
                    print(f"  bot {index}: couldn't read messages in chat {chat_id}: {e}", flush=True)
                    state["unreadable"] += len(batch)
                    continue
                pairs = [(m, d) for m, d in zip(msgs, batch) if m and not getattr(m, "empty", False) and m.media]
                state["unreadable"] += len(batch) - len(pairs)
                await asyncio.gather(*(read(m, d) for m, d in pairs))
                state["done"] += len(batch)
                print(f"  {state['done']}/{len(todo)} checked, {len(fakes)} fake so far ({time.monotonic() - started:.0f} s)", flush=True)

    # The spare bots at the end of the list
    await asyncio.gather(*(run_bot(i, token) for i, token in enumerate(TOKENS[-bots:])))
    return {"fakes": fakes, "checked": state["done"], "unreadable": state["unreadable"]}


def _task_for(db, fake):
    return db["RemoteTransfers"].find_one({"user_id": fake["owner"], "destination_path": fake["path"], "filename": fake["name"]},
                                          {"task_id": 1}, sort=[("updated_at", -1)])


# ── Scan and apply ──────────────────────────────────────────────────────────

def scan(groups, limit: int = 0, bots: int = 4) -> dict:
    db = _db()
    report = {"scanned_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), **find_misplaced(db)}
    report.update(asyncio.run(find_fakes(db, limit, bots)))
    # A fake that was misplaced too: its transfer is found by the folder it belongs in
    moved_to = {m["file_id"]: m["to"] for m in report["moves"]}
    requeue, no_source = [], []
    for fake in report["fakes"]:
        lookup = {**fake, "path": moved_to.get(fake["file_id"], fake["path"])}
        task = _task_for(db, lookup)
        (requeue if task else no_source).append({**fake, "task_id": task["task_id"]} if task else fake)
    report["requeue_fakes"], report["fakes_without_source"] = requeue, no_source
    report["requeue_group"] = [
        {"task_id": t["task_id"], "name": t.get("filename"), "was": t["status"]}
        for t in db["RemoteTransfers"].find({"group_id": {"$in": groups}, "status": {"$in": ["failed", "cancelled"]}}, {"task_id": 1, "filename": 1, "status": 1})
    ]
    with open(REPORT, "w") as out:
        json.dump(report, out, indent=1, default=str)
    return report


def apply() -> dict:
    from telestore.db import database
    from telestore.services import event_service

    with open(REPORT) as f:
        report = json.load(f)
    db = _db()
    files, tasks = db["Files"], db["RemoteTransfers"]
    from bson import ObjectId
    moved = trashed = queued = 0
    for m in report["moves"]:
        database.Files.create_folder_path(m["to"], owner_id=m["owner"])
        res = files.update_one({"_id": ObjectId(m["file_id"]), "file_path": INBOX},
                               {"$set": {"file_path": m["to"], "file_caption": f"Uploaded file: {m['name']}"}})
        if res.modified_count:
            moved += 1
            event_service.forget_inbox_file(m.get("chat_id"), m.get("message_id"))
    for fake in report["fakes"]:
        trashed += bool(database.Files.move_to_trash(fake["file_id"], fake["owner"]))
    now = datetime.now(timezone.utc)
    for t in report["requeue_fakes"] + report["requeue_group"]:
        res = tasks.update_one({"task_id": t["task_id"], "status": {"$in": ["completed", "failed", "cancelled"]}}, {
            "$set": {"status": "queued", "phase": "Queued (repair: copying again)", "progress": 0, "transferred_bytes": 0,
                     "speed_bps": 0, "error_message": None, "updated_at": now},
            "$unset": {"cooldown_until": "", "claimed_by": "", "claimed_at": "", "error_detail": ""},
        })
        queued += res.modified_count
    return {"moved": moved, "trashed": trashed, "queued": queued}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("command", choices=["scan", "apply"])
    parser.add_argument("--group", action="append", default=[], help="a folder copy whose failed and cancelled files are copied again")
    parser.add_argument("--limit", type=int, default=0, help="scan: check only this many small files (a quick trial)")
    parser.add_argument("--bots", type=int, default=4, help="scan: spare bots reading in parallel (the last ones in the list)")
    args = parser.parse_args(argv)
    if args.command == "scan":
        r = scan(args.group, args.limit, args.bots)
        print(json.dumps({
            "misplaced (move to their folder)": len(r["moves"]), "misplaced, no single match (left)": len(r["unsure"]),
            "small files checked": r["checked"], "couldn't read": r["unreadable"],
            "fake (to Trash)": len(r["fakes"]), "  of them Google's limit page": sum(f["google_limit"] for f in r["fakes"]),
            "  copied again": len(r["requeue_fakes"]), "  no transfer to copy from": len(r["fakes_without_source"]),
            "failed/cancelled copied again": len(r["requeue_group"]), "report": REPORT,
        }, indent=1))
    else:
        print(json.dumps(apply(), indent=1))


if __name__ == "__main__":
    sys.exit(main())
