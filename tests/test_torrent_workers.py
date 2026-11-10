"""Torrents on every machine (November 2026).

The main server reads a torrent (a magnet's file list comes from its peers first) and splits it
into one transfer per file, as one group. The main server and worker machines that have aria2c
each take files from the queue, so a torrent with several files downloads on two machines at once.
Every machine runs aria2c with the same settings: uploads to other peers kept to a trickle, no
seeding after a download.
"""

import asyncio
import importlib
import os
import stat
import sys
import textwrap
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from telestore import transfer_core
from telestore.db import database
from telestore.services.remote_transfer_manager import manager as manager_module
from telestore.services.remote_transfer_manager.manager import remote_transfer_manager
from test_transfer_server import Coll as _Coll


class Coll(_Coll):
    def update_one(self, flt, update, upsert=False):
        res = super().update_one(flt, update, upsert)
        hit = self.find_one(flt) if update.get("$push") else None
        if hit:
            for d in self.docs:
                if d["_id"] == hit["_id"]:
                    for key, value in update["$push"].items():
                        d.setdefault(key, []).append(value)
        return res

    def delete_one(self, flt):
        hit = self.find_one(flt)
        if hit:
            self.docs = [d for d in self.docs if d["_id"] != hit["_id"]]

    def delete_many(self, flt):
        gone = self.find(flt)
        ids = {d["_id"] for d in gone}
        self.docs = [d for d in self.docs if d["_id"] not in ids]
        return MagicMock(deleted_count=len(gone))


# ── The same aria2c settings everywhere ─────────────────────────────────────

class TestAria2Settings:
    def test_no_seeding_and_a_trickle_of_uploads(self):
        args = transfer_core.aria2_args("/data")
        assert args[0] == "aria2c"
        assert "--seed-time=0" in args
        assert "--max-overall-upload-limit=1K" in args
        assert "--dht-file-path=/data/dht.dat" in args

    def test_one_file_resumes_where_it_was(self):
        args = transfer_core.aria2_file_args("/data", "/t/x.torrent", 3, "/w")
        assert args[-5:] == ["--select-file=3", "--dir=/w", "--summary-interval=1", "--continue=true", "/t/x.torrent"]

    def test_progress_lines(self):
        line = "[#2089b0 400.0KiB/33.2MiB(1%) CN:18 SD:6 DL:4.2MiB ETA:4m20s]"
        info = transfer_core.parse_aria2_line(line)
        assert info["done"] == 400 * 1024 and info["total"] == int(33.2 * 1024 ** 2)
        assert info["progress"] == 1.0 and info["peers"] == 18 and info["seeders"] == 6
        assert info["speed_bps"] == int(4.2 * 1024 ** 2)
        assert transfer_core.parse_aria2_line("[NOTICE] Download complete: /w/a.bin") is None

    def test_finding_the_downloaded_file(self, tmp_path):
        (tmp_path / "Game" / "Extras").mkdir(parents=True)
        (tmp_path / "Game" / "Extras" / "a.bin").write_bytes(b"x")
        assert transfer_core.torrent_file_path(str(tmp_path), "Game/Extras/a.bin", "a.bin").endswith("Game/Extras/a.bin")
        # Somewhere else under the folder: found by its name
        assert transfer_core.torrent_file_path(str(tmp_path), "Other/a.bin", "a.bin").endswith("a.bin")
        assert transfer_core.torrent_file_path(str(tmp_path), "b.bin", "b.bin") is None

    def test_the_main_server_uses_them(self):
        from telestore.services.torrent_manager import torrent_manager
        assert torrent_manager._get_base_aria_args() == transfer_core.aria2_args("/app/cache")


# ── Splitting a torrent into files ──────────────────────────────────────────

GAME = {
    "name": "SimRail", "is_multi_file": True, "total_size": 30,
    "files": [
        {"index": 1, "name": "fg-01.bin", "rel_path": "fg-01.bin", "full_rel_path": "SimRail/fg-01.bin", "size": 20},
        {"index": 2, "name": "readme.txt", "rel_path": "MD5/readme.txt", "full_rel_path": "SimRail/MD5/readme.txt", "size": 10},
        {"index": 3, "name": "empty.ini", "rel_path": "empty.ini", "full_rel_path": "SimRail/empty.ini", "size": 0},
    ],
}


@pytest.fixture
def split(tmp_path):
    coll = Coll([{"task_id": "rt_parent", "user_id": "7", "chat_id": -100, "source_type": "magnet",
                  "source_url": "magnet:?xt=urn:btih:abc", "destination_path": "/Home/Games", "is_vault": False}])
    torrent = tmp_path / "meta.torrent"
    torrent.write_bytes(b"d4:infod4:name7:SimRailee")
    files = MagicMock()
    with patch("telestore.services.remote_transfer_manager.manager.get_remote_db", return_value={"RemoteTransfers": coll}), \
            patch.object(manager_module, "TORRENT_DIR", str(tmp_path / "torrents")), \
            patch.object(database, "Files", files), \
            patch("telestore.services.remote_transfer_manager.manager.event_service.task_finished"):
        yield SimpleNamespace(coll=coll, torrent=str(torrent), files=files, dir=tmp_path / "torrents")


class TestSplit:
    def test_one_transfer_per_file_as_one_group(self, split):
        queued, empty = remote_transfer_manager._split_torrent(split.coll.find_one({"task_id": "rt_parent"}), split.torrent, GAME)
        assert (queued, empty) == (2, 1)
        items = split.coll.find({"source_type": "torrent_item"})
        assert {i["filename"]: i["destination_path"] for i in items} == {
            "fg-01.bin": "/Home/Games/SimRail", "readme.txt": "/Home/Games/SimRail/MD5"}
        assert {i["torrent_file_index"] for i in items} == {1, 2}
        assert all(i["status"] == "queued" and i["group_type"] == "torrent" and i["group_name"] == "SimRail" for i in items)
        assert len({i["group_id"] for i in items}) == 1
        # Every machine reads the same kept copy of the torrent
        kept = items[0]["torrent_path"]
        assert os.path.isfile(kept) and kept.startswith(str(split.dir))
        # The torrent itself is now its files
        assert split.coll.find_one({"task_id": "rt_parent"}) is None
        # The empty file is saved straight away
        assert split.files.save_empty.call_args.args[:3] == ("empty.ini", "/Home/Games/SimRail", "7")

    def test_a_single_file_torrent_goes_into_the_destination(self, split):
        single = {"name": "movie.mkv", "is_multi_file": False, "total_size": 5,
                  "files": [{"index": 1, "name": "movie.mkv", "rel_path": "movie.mkv", "full_rel_path": "movie.mkv", "size": 5}]}
        remote_transfer_manager._split_torrent(split.coll.find_one({"task_id": "rt_parent"}), split.torrent, single)
        item = split.coll.find_one({"source_type": "torrent_item"})
        assert item["destination_path"] == "/Home/Games" and item["torrent_rel_path"] == "movie.mkv"

    def test_only_empty_files_finishes_straight_away(self, split):
        empties = {"name": "x", "is_multi_file": True, "total_size": 0,
                   "files": [{"index": 1, "name": "a", "rel_path": "a", "full_rel_path": "x/a", "size": 0}]}
        assert remote_transfer_manager._split_torrent(split.coll.find_one({"task_id": "rt_parent"}), split.torrent, empties) == (0, 1)
        assert split.coll.find_one({"task_id": "rt_parent"})["status"] == "completed"
        assert not any(split.dir.iterdir())

    def test_clearing_finished_files_removes_the_torrent_once_none_is_left(self, split, tmp_path):
        remote_transfer_manager._split_torrent(split.coll.find_one({"task_id": "rt_parent"}), split.torrent, GAME)
        first, second = split.coll.find({"source_type": "torrent_item"})
        kept = first["torrent_path"]
        split.coll.update_one({"task_id": first["task_id"]}, {"$set": {"status": "completed"}})
        remote_transfer_manager.clear_completed("7")
        assert os.path.isfile(kept)  # the other file still needs it
        split.coll.update_one({"task_id": second["task_id"]}, {"$set": {"status": "completed"}})
        remote_transfer_manager.clear_completed("7")
        assert not os.path.exists(kept)


# ── Worker machines ─────────────────────────────────────────────────────────

class TestClaim:
    def _claim(self, client, secrets, coll, skills=None):
        body = {"worker_id": "w1"}
        if skills is not None:
            body["skills"] = skills
        with patch("telestore.api.routes.worker.get_remote_db", return_value={"RemoteTransfers": coll}):
            return client.post("/api/worker/claim-task", json=body, headers={"X-Worker-Key": secrets["worker_secret"]})

    def test_a_worker_with_aria2c_takes_torrent_files(self, client, test_secrets):
        coll = MagicMock()
        coll.find_one_and_update.return_value = {"task_id": "rt_1", "source_url": "magnet:?x", "source_type": "torrent_item",
                                                 "filename": "fg-01.bin", "filesize": 20, "torrent_file_index": 1,
                                                 "torrent_rel_path": "SimRail/fg-01.bin", "chat_id": -1, "user_id": "7"}
        res = self._claim(client, test_secrets, coll, ["torrent", "torrent_parts"])
        assert coll.find_one_and_update.call_args.args[0]["source_type"] == {"$nin": ["instagram", "media", "magnet", "torrent_file"]}
        task = res.json()["task"]
        assert task["torrent_file_index"] == 1 and task["torrent_rel_path"] == "SimRail/fg-01.bin"

    def test_with_aria2c_only_no_parts_of_big_files(self, client, test_secrets):
        coll = MagicMock()
        coll.find_one_and_update.return_value = None
        self._claim(client, test_secrets, coll, ["torrent"])
        nin = coll.find_one_and_update.call_args.args[0]["source_type"]["$nin"]
        assert "torrent_part" in nin and "torrent_item" not in nin

    def test_a_worker_without_it_never_does(self, client, test_secrets):
        coll = MagicMock()
        coll.find_one_and_update.return_value = None
        self._claim(client, test_secrets, coll, [])
        assert "torrent_item" in coll.find_one_and_update.call_args.args[0]["source_type"]["$nin"]


class TestTorrentDetails:
    def _get(self, client, secrets, doc, worker="w1"):
        coll = MagicMock()
        coll.find_one.return_value = doc
        with patch("telestore.api.routes.worker.get_remote_db", return_value={"RemoteTransfers": coll}):
            return client.get("/api/worker/torrent/rt_1", params={"worker_id": worker}, headers={"X-Worker-Key": secrets["worker_secret"]})

    def test_the_claiming_worker_gets_it(self, client, test_secrets, tmp_path):
        path = tmp_path / "g.torrent"
        path.write_bytes(b"d4:infoe")
        doc = {"task_id": "rt_1", "source_type": "torrent_item", "claimed_by": "w1", "torrent_path": str(path)}
        res = self._get(client, test_secrets, doc)
        assert res.status_code == 200 and res.content == b"d4:infoe"
        assert self._get(client, test_secrets, doc, worker="w2").status_code == 404
        assert self._get(client, test_secrets, {**doc, "source_type": "direct"}).status_code == 404
        assert self._get(client, test_secrets, {**doc, "torrent_path": str(tmp_path / "gone")}).status_code == 410

    def test_needs_the_worker_key(self, client):
        assert client.get("/api/worker/torrent/rt_1", params={"worker_id": "w1"}).status_code == 401


# ── The worker program (worker/worker.py) with a stand-in aria2c ────────────

FAKE_ARIA2C = textwrap.dedent('''\
    #!{python}
    import os, sys, time
    args = dict(a[2:].split("=", 1) for a in sys.argv[1:] if a.startswith("--") and "=" in a)
    print("[#1 0B/10B(0%) CN:3 SD:1 DL:0B]", flush=True)
    print("[#1 5B/10B(50%) CN:3 SD:1 DL:5B]", flush=True)
    path = os.path.join(args["dir"], "Game", "a.bin")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    open(path, "wb").write(b"0123456789")
    print("[NOTICE] Download complete: " + path, flush=True)
    sys.exit(int(os.environ.get("FAKE_EXIT", "0")))
''')


@pytest.fixture
def worker(tmp_path):
    with patch.dict("os.environ", {"WORKER_KEY": "test", "WORK_DIR": str(tmp_path / "work")}):
        sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "worker"))
        try:
            mod = importlib.import_module("worker")
            mod.WORK_DIR = str(tmp_path / "work")
            yield mod
        finally:
            sys.path.pop(0)


@pytest.fixture
def aria2c(tmp_path):
    script = tmp_path / "aria2c"
    script.write_text(FAKE_ARIA2C.format(python=sys.executable))
    script.chmod(script.stat().st_mode | stat.S_IEXEC)
    return str(script)


def _run_item(worker, aria2c, tmp_path, part_max=None):
    w = worker.DistributedWorker()
    w.fetch_torrent = AsyncMock()
    w.report_progress = AsyncMock()
    w.report_complete = AsyncMock()
    sent = []

    async def send_document(chat_id, document, caption, file_name, force_document, progress):
        sent.append((file_name, open(document, "rb").read()))
        return SimpleNamespace(id=len(sent), document=SimpleNamespace(file_unique_id=f"u{len(sent)}"), video=None, audio=None, photo=None)
    bot = SimpleNamespace(send_document=send_document)
    task = {"task_id": "rt_1", "filename": "a.bin", "filesize": 10, "chat_id": -1, "user_id": "7",
            "destination_path": "/Home/Game", "torrent_file_index": 2, "torrent_rel_path": "Game/a.bin", "source_type": "torrent_item"}
    task_dir = tmp_path / "task"
    task_dir.mkdir()
    # The aria2c fallback (a machine without libtorrent)
    with patch.object(worker, "ARIA2C", aria2c), patch.object(worker, "TORRENT_REPORT_SECONDS", 0), \
            patch.object(worker.torrent_engine, "AVAILABLE", False):
        if part_max:
            with patch.object(worker, "PART_MAX_SIZE", part_max):
                asyncio.run(w.process_torrent_item(task, bot, str(task_dir)))
        else:
            asyncio.run(w.process_torrent_item(task, bot, str(task_dir)))
    return w, sent


class TestWorkerProgram:
    def test_says_it_can_do_torrents_with_libtorrent_or_aria2c(self, worker):
        expected = (["torrent"] if (worker.torrent_engine.AVAILABLE or worker.ARIA2C) else []) + \
            (["torrent_parts"] if worker.torrent_engine.AVAILABLE else [])
        assert worker.SKILLS == expected

    def test_downloads_its_file_and_sends_it(self, worker, aria2c, tmp_path):
        w, sent = _run_item(worker, aria2c, tmp_path)
        assert sent == [("a.bin", b"0123456789")]
        done = w.report_complete.call_args.args[0]
        assert done["is_multipart"] is False and done["file_size"] == 10 and done["destination_path"] == "/Home/Game"
        # It kept telling the master how it's going while downloading
        phases = [c.args[6] for c in w.report_progress.call_args_list]
        assert any("Leeching a.bin" in p for p in phases)

    def test_a_big_file_goes_in_parts(self, worker, aria2c, tmp_path):
        w, sent = _run_item(worker, aria2c, tmp_path, part_max=4)
        assert [s[1] for s in sent] == [b"0123", b"4567", b"89"]
        done = w.report_complete.call_args.args[0]
        assert done["is_multipart"] is True and [p["start_byte"] for p in done["parts"]] == [0, 4, 8]

    def test_a_failed_download_is_an_error(self, worker, aria2c, tmp_path):
        with patch.dict("os.environ", {"FAKE_EXIT": "7"}), pytest.raises(RuntimeError, match="exit code 7"):
            _run_item(worker, aria2c, tmp_path)


# ── The main server takes torrent files too ─────────────────────────────────

class TestMainServer:
    def _item(self, torrent):
        return {"task_id": "rt_9", "user_id": "7", "chat_id": -100, "source_type": "torrent_item",
                "source_url": "magnet:?x", "torrent_path": torrent, "torrent_file_index": 2,
                "torrent_rel_path": "Game/a.bin", "filename": "a.bin", "filesize": 10,
                "destination_path": "/Home/Game", "is_vault": False}

    def test_runs_one_file_and_saves_it(self, tmp_path, monkeypatch):
        monkeypatch.chdir(tmp_path)
        torrent = tmp_path / "g.torrent"
        torrent.write_bytes(b"d4:infoe")
        seen = {}

        def download(path, index, work_dir, cancel_event, progress, on_pause):
            seen["index"] = index
            progress({"progress": 50.0, "speed_bps": 5, "peers": 3, "done": 5})
            os.makedirs(os.path.join(work_dir, "Game"), exist_ok=True)
            open(os.path.join(work_dir, "Game", "a.bin"), "wb").write(b"0123456789")
        upload = AsyncMock(return_value={"message_id": 7, "file_unique_id": "u7", "thumbnail": None})
        mgr = manager_module.RemoteTransferManager()
        mgr._bot_manager = MagicMock()
        files = MagicMock()
        with patch.object(manager_module.torrent_manager, "download_file_selective", download), \
                patch.object(manager_module.torrent_engine, "AVAILABLE", False), \
                patch.object(manager_module, "upload_part_task", upload), \
                patch.object(database, "Files", files), \
                patch.object(mgr, "_update_task") as update:
            asyncio.run(mgr._run_download_and_upload(self._item(str(torrent)), MagicMock(is_set=lambda: False)))
        assert seen["index"] == 2
        kwargs = files.claim_upload.call_args.kwargs
        assert kwargs["file_path"] == "/Home/Game" and kwargs["file_name"] == "a.bin" and kwargs["file_size"] == 10
        statuses = [c.args[1].get("status") for c in update.call_args_list]
        assert "downloading" in statuses and statuses[-1] == "completed"
        assert not (tmp_path / "tg_files" / "remote_rt_9").exists()

    def test_a_magnet_is_split_after_reading_it(self, tmp_path, monkeypatch):
        monkeypatch.chdir(tmp_path)
        meta_file = tmp_path / "found.torrent"
        meta_file.write_bytes(b"x")
        mgr = manager_module.RemoteTransferManager()
        mgr._bot_manager = MagicMock()
        task = {"task_id": "rt_m", "user_id": "7", "chat_id": -100, "source_type": "magnet",
                "source_url": "magnet:?xt=urn:btih:abc", "destination_path": "/Home"}
        with patch.object(manager_module.torrent_manager, "resolve_magnet_metadata", return_value=str(meta_file)), \
                patch.object(manager_module.torrent_engine, "AVAILABLE", False), \
                patch.object(manager_module, "parse_torrent_bytes", return_value=GAME), \
                patch.object(mgr, "_split_torrent", return_value=(2, 1)) as split, \
                patch.object(mgr, "_update_task"):
            asyncio.run(mgr._run_download_and_upload(task, MagicMock(is_set=lambda: False)))
        assert split.call_args.args[1] == str(meta_file) and split.call_args.args[2] is GAME

    def test_details_gone_is_a_clear_error(self, tmp_path, monkeypatch):
        monkeypatch.chdir(tmp_path)
        mgr = manager_module.RemoteTransferManager()
        mgr._bot_manager = MagicMock()
        with patch.object(mgr, "_update_task"), pytest.raises(FileNotFoundError, match="Add the torrent again"):
            asyncio.run(mgr._run_download_and_upload(self._item(str(tmp_path / "gone.torrent")), MagicMock(is_set=lambda: False)))


# ── What a torrent had already downloaded is kept ───────────────────────────

class TestKeptProgress:
    def test_the_partial_download_becomes_the_torrents_folder(self, split, tmp_path, monkeypatch):
        monkeypatch.chdir(tmp_path)
        partial = tmp_path / "old" / "dl"
        (partial / "SimRail").mkdir(parents=True)
        (partial / "SimRail" / "fg-01.bin").write_bytes(b"x" * 5)
        (partial / "SimRail.aria2").write_bytes(b"control")
        remote_transfer_manager._split_torrent(split.coll.find_one({"task_id": "rt_parent"}), split.torrent, GAME, partial_dir=str(partial))
        items = {i["filename"]: i for i in split.coll.find({"source_type": "torrent_item"})}
        folder = Path(manager_module.torrent_work_dir(items["fg-01.bin"]["group_id"]))
        assert (folder / "SimRail" / "fg-01.bin").exists() and (folder / "SimRail.aria2").exists()
        assert not partial.exists()
        # The file with data stays on the main server and goes first; the rest any machine takes
        assert items["fg-01.bin"].get("main_only") is True
        assert items["fg-01.bin"]["created_at"] < items["readme.txt"]["created_at"]
        assert not items["readme.txt"].get("main_only")

    def test_nothing_downloaded_yet_changes_nothing(self, split, tmp_path, monkeypatch):
        monkeypatch.chdir(tmp_path)
        remote_transfer_manager._split_torrent(split.coll.find_one({"task_id": "rt_parent"}), split.torrent, GAME,
                                               partial_dir=str(tmp_path / "missing"))
        assert not any(i.get("main_only") for i in split.coll.find({"source_type": "torrent_item"}))

    def test_workers_leave_those_files_to_the_main_server(self, client, test_secrets):
        coll = MagicMock()
        coll.find_one_and_update.return_value = None
        with patch("telestore.api.routes.worker.get_remote_db", return_value={"RemoteTransfers": coll}):
            client.post("/api/worker/claim-task", json={"worker_id": "w1", "skills": ["torrent"]},
                        headers={"X-Worker-Key": test_secrets["worker_secret"]})
        assert coll.find_one_and_update.call_args.args[0]["main_only"] == {"$ne": True}

    def test_the_cleanup_job_keeps_a_torrents_folder_while_files_are_left(self, tmp_path, monkeypatch):
        from telestore.api import state
        monkeypatch.chdir(tmp_path)
        (tmp_path / "tg_files" / "torrent_grp_a").mkdir(parents=True)
        (tmp_path / "tg_files" / "torrent_grp_b").mkdir(parents=True)
        old = 0  # untouched for decades
        for d in ("torrent_grp_a", "torrent_grp_b"):
            os.utime(tmp_path / "tg_files" / d, (old, old))
        coll = Coll([{"task_id": "t1", "group_id": "grp_a", "source_type": "torrent_item", "status": "queued"},
                     {"task_id": "t2", "group_id": "grp_b", "source_type": "torrent_item", "status": "completed"}])
        coll.distinct = lambda key, flt: list({d[key] for d in coll.find(flt)})
        with patch("telestore.services.remote_transfer_manager.manager.get_remote_db", return_value={"RemoteTransfers": coll}):
            state.cleanup_stale_upload_files(max_age_seconds=60)
        assert (tmp_path / "tg_files" / "torrent_grp_a").exists()
        assert not (tmp_path / "tg_files" / "torrent_grp_b").exists()

    def test_main_server_downloads_into_the_torrents_folder(self, tmp_path, monkeypatch):
        monkeypatch.chdir(tmp_path)
        torrent = tmp_path / "g.torrent"
        torrent.write_bytes(b"d4:infoe")
        dirs = []

        def download(path, index, work_dir, cancel_event, progress, on_pause):
            dirs.append(work_dir)
            os.makedirs(os.path.join(work_dir, "Game"), exist_ok=True)
            open(os.path.join(work_dir, "Game", "a.bin"), "wb").write(b"0123456789")
            open(os.path.join(work_dir, "Game.aria2"), "wb").write(b"control")
        coll = Coll([{"task_id": "rt_other", "group_id": "grp_t", "status": "queued", "source_type": "torrent_item"}])
        mgr = manager_module.RemoteTransferManager()
        mgr._bot_manager = MagicMock()
        item = {**TestMainServer()._item(str(torrent)), "group_id": "grp_t"}
        with patch.object(manager_module.torrent_manager, "download_file_selective", download), \
                patch.object(manager_module.torrent_engine, "AVAILABLE", False), \
                patch.object(manager_module, "upload_part_task", AsyncMock(return_value={"message_id": 1, "file_unique_id": "u"})), \
                patch.object(database, "Files", MagicMock()), \
                patch("telestore.services.remote_transfer_manager.manager.get_remote_db", return_value={"RemoteTransfers": coll}), \
                patch.object(mgr, "_update_task"):
            asyncio.run(mgr._run_download_and_upload(item, MagicMock(is_set=lambda: False)))
            folder = Path(manager_module.torrent_work_dir("grp_t"))
            assert dirs == [str(folder)]
            # The sent file is gone; the shared control file stays while another file is left
            assert not (folder / "Game" / "a.bin").exists() and (folder / "Game.aria2").exists()
            coll.docs.clear()
            asyncio.run(mgr._run_download_and_upload(item, MagicMock(is_set=lambda: False)))
            assert not folder.exists()  # the last file: the folder goes


# ── libtorrent, part by part ────────────────────────────────────────────────

class FakeEngine:
    """Stands in for torrent_engine.get_engine(): hands over the file's parts like the real one,
    taking a slot for each (the real one is tested against a live seeder in test_torrent_engine)."""

    def __init__(self, content: bytes, part_size: int):
        self.content, self.part_size, self.calls = content, part_size, []

    def download_file(self, torrent_bytes, file_index, save_dir, parts_dir, *, slots, on_part, cancelled,
                      on_progress=None, should_pause=lambda: False, done_parts=(), part_size=None, peers=()):
        from telestore.torrent_engine import PartReady, plan_parts
        self.calls.append({"index": file_index, "done": set(done_parts), "save_dir": save_dir})
        os.makedirs(parts_dir, exist_ok=True)
        plan = plan_parts(len(self.content), self.part_size)
        for index, start, length in plan:
            if index in set(done_parts):
                continue
            while not slots.acquire(timeout=0.5):
                pass
            if on_progress:
                on_progress({"done": start, "total": len(self.content), "progress": 10.0, "speed_bps": 5,
                             "peers": 2, "part": index, "parts": len(plan), "paused": False})
            path = os.path.join(parts_dir, f"part{index}")
            open(path, "wb").write(self.content[start:start + length])
            on_part(PartReady(index, start, length, path, len(plan) == 1, len(plan)))
        return len(self.content)


def _sent_part(**kw):
    async def upload(part_file_path, part_index, file_name, start_byte, part_size, **rest):
        data = open(part_file_path, "rb").read()
        os.remove(part_file_path)
        kw.setdefault("sent", []).append((part_index, data, rest["is_single_part"]))
        rest["semaphore"].release()
        return {"part_index": part_index, "chat_id": -100, "message_id": 100 + part_index, "file_unique_id": f"u{part_index}",
                "part_size": part_size, "start_byte": start_byte, "end_byte": start_byte + part_size - 1, "thumbnail": None}
    return upload, kw


class TestMainServerByParts:
    def _item(self, torrent, size, **extra):
        return {"task_id": "rt_p", "user_id": "7", "chat_id": -100, "source_type": "torrent_item", "source_url": "magnet:?x",
                "torrent_path": torrent, "torrent_file_index": 1, "torrent_rel_path": "G/big.bin", "filename": "big.bin",
                "filesize": size, "destination_path": "/Home/G", "group_id": "grp_p", **extra}

    def _run(self, tmp_path, content, part_size, item_extra=None):
        torrent = tmp_path / "g.torrent"
        torrent.write_bytes(b"d4:infoe")
        engine = FakeEngine(content, part_size)
        upload, sent = _sent_part()
        coll = Coll([self._item(str(torrent), len(content), **(item_extra or {}))])
        files = MagicMock()
        mgr = manager_module.RemoteTransferManager()
        mgr._bot_manager = MagicMock()
        with patch.object(manager_module.torrent_engine, "AVAILABLE", True), \
                patch.object(manager_module.torrent_engine, "get_engine", return_value=engine), \
                patch.object(manager_module.torrent_engine, "PART_SIZE", part_size), \
                patch.object(manager_module, "upload_part_task", upload), \
                patch.object(database, "Files", files), \
                patch("telestore.services.remote_transfer_manager.manager.get_remote_db", return_value={"RemoteTransfers": coll}), \
                patch.object(mgr, "_update_task") as update:
            asyncio.run(mgr._run_download_and_upload(coll.find_one({"task_id": "rt_p"}), MagicMock(is_set=lambda: False)))
        return engine, sent.get("sent", []), files, coll, update

    def test_a_big_file_becomes_one_job_per_part(self, tmp_path, monkeypatch):
        monkeypatch.chdir(tmp_path)
        engine, sent, files, coll, update = self._run(tmp_path, os.urandom(10_000), 4_000)
        assert engine.calls == [] and sent == []  # nothing fetched by this job itself
        assert coll.find_one({"task_id": "rt_p"}) is None
        jobs = sorted(coll.find({"source_type": "torrent_part"}), key=lambda d: d["part_index"])
        assert [(j["part_index"], j["part_start"], j["part_size"]) for j in jobs] == [(1, 0, 4000), (2, 4000, 4000), (3, 8000, 2000)]
        assert all(j["status"] == "queued" and j["total_parts"] == 3 and j["torrent_file_key"] == "grp_p:1" for j in jobs)
        assert jobs[0]["filename"] == "big.bin · part 1 of 3" and jobs[0]["torrent_file_name"] == "big.bin"
        assert jobs[0]["created_at"] < jobs[1]["created_at"] < jobs[2]["created_at"]

    def test_a_small_file_is_one_ordinary_file(self, tmp_path, monkeypatch):
        monkeypatch.chdir(tmp_path)
        _, sent, files, _, _ = self._run(tmp_path, b"hello", 4_000)
        assert sent == [(1, b"hello", True)]
        assert files.claim_upload.call_args.kwargs["file_size"] == 5
        files.add_multipart_file.assert_not_called()

    def test_a_file_aria2c_had_started_stays_with_aria2c(self, tmp_path, monkeypatch):
        monkeypatch.chdir(tmp_path)
        torrent = tmp_path / "g.torrent"
        torrent.write_bytes(b"d4:infoe")
        mgr = manager_module.RemoteTransferManager()
        mgr._bot_manager = MagicMock()
        item = TestMainServerByParts()._item(str(torrent), 10, main_only=True)
        # aria2c's data for it is still here
        data = Path(manager_module.torrent_work_dir("grp_p")) / "G" / "big.bin"
        data.parent.mkdir(parents=True)
        data.write_bytes(b"x" * 4)
        with patch.object(manager_module.torrent_engine, "AVAILABLE", True), \
                patch.object(manager_module.torrent_engine, "get_engine") as engine, \
                patch.object(manager_module.torrent_manager, "download_file_selective", side_effect=RuntimeError("aria2c")), \
                patch.object(mgr, "_update_task"), pytest.raises(RuntimeError, match="aria2c"):
            asyncio.run(mgr._run_download_and_upload(item, MagicMock(is_set=lambda: False)))
        engine.assert_not_called()

    def test_a_magnet_is_read_with_libtorrent(self, tmp_path, monkeypatch):
        monkeypatch.chdir(tmp_path)
        engine = MagicMock()
        engine.fetch_metadata.return_value = b"d4:infod4:name1:xee"
        mgr = manager_module.RemoteTransferManager()
        mgr._bot_manager = MagicMock()
        task = {"task_id": "rt_m", "user_id": "7", "chat_id": -100, "source_type": "magnet",
                "source_url": "magnet:?xt=urn:btih:abc", "destination_path": "/Home"}
        read = []
        with patch.object(manager_module.torrent_engine, "AVAILABLE", True), \
                patch.object(manager_module.torrent_engine, "get_engine", return_value=engine), \
                patch.object(manager_module, "parse_torrent_bytes", return_value=GAME), \
                patch.object(mgr, "_split_torrent", side_effect=lambda doc, path, meta, partial_dir=None: read.append(open(path, "rb").read()) or (2, 1)), \
                patch.object(mgr, "_update_task"):
            asyncio.run(mgr._run_download_and_upload(task, MagicMock(is_set=lambda: False)))
        assert engine.fetch_metadata.call_args.args[0] == "magnet:?xt=urn:btih:abc"
        assert read == [b"d4:infod4:name1:xee"]


class TestWorkerByParts:
    def test_parts_go_to_telegram_one_by_one(self, worker, tmp_path):
        content = os.urandom(10_000)
        engine = FakeEngine(content, 4_000)
        w = worker.DistributedWorker()
        w.fetch_torrent = AsyncMock(side_effect=lambda task_id, path: open(path, "wb").write(b"d4:infoe"))
        w.report_progress = AsyncMock()
        w.report_complete = AsyncMock()
        sent = []

        async def upload_part(bot, task_id, chat_id, filename, p_path, p_idx, s_byte, p_size, is_single):
            sent.append((p_idx, open(p_path, "rb").read(), is_single))
            os.remove(p_path)
            return {"part_index": p_idx, "chat_id": chat_id, "message_id": p_idx, "file_unique_id": f"u{p_idx}",
                    "part_size": p_size, "start_byte": s_byte, "end_byte": s_byte + p_size}
        w.upload_part = upload_part
        task = {"task_id": "rt_1", "filename": "big.bin", "filesize": len(content), "chat_id": -1, "user_id": "7",
                "destination_path": "/Home/G", "torrent_file_index": 1, "torrent_rel_path": "G/big.bin", "source_type": "torrent_item"}
        task_dir = tmp_path / "task"
        task_dir.mkdir()
        with patch.object(worker.torrent_engine, "AVAILABLE", True), \
                patch.object(worker.torrent_engine, "get_engine", return_value=engine), \
                patch.object(worker, "TORRENT_REPORT_SECONDS", 0):
            asyncio.run(w.process_torrent_item(task, SimpleNamespace(), str(task_dir)))
        assert b"".join(s[1] for s in sent) == content and not any(s[2] for s in sent)
        done = w.report_complete.call_args.args[0]
        assert done["is_multipart"] is True and [p["start_byte"] for p in done["parts"]] == [0, 4000, 8000]
        assert any("part 2 of 3" in c.args[6] for c in w.report_progress.call_args_list)


def test_padding_files_are_not_files_to_fetch():
    from telestore.services.torrent_manager import parse_torrent_bytes

    def bencode(v):
        if isinstance(v, int):
            return b"i%de" % v
        if isinstance(v, bytes):
            return b"%d:%s" % (len(v), v)
        if isinstance(v, list):
            return b"l" + b"".join(bencode(x) for x in v) + b"e"
        return b"d" + b"".join(bencode(k) + bencode(v[k]) for k in sorted(v)) + b"e"
    data = bencode({b"info": {b"name": b"G", b"piece length": 16, b"files": [
        {b"length": 10, b"path": [b"a.bin"]},
        {b"attr": b"p", b"length": 6, b"path": [b".pad", b"6"]},
        {b"length": 4, b"path": [b"b.bin"]},
    ]}})
    meta = parse_torrent_bytes(data)
    assert [(f["index"], f["name"]) for f in meta["files"]] == [(1, "a.bin"), (3, "b.bin")]


# ── Parts of one big file on several machines ───────────────────────────────

def _part_job(index, total, status="queued", info=None, **extra):
    return {"task_id": f"rt_part{index}", "user_id": "7", "chat_id": -100, "source_type": "torrent_part",
            "torrent_file_key": "grp_x:1", "torrent_file_name": "huge.bin", "torrent_file_size": 10_000,
            "part_index": index, "total_parts": total, "part_start": (index - 1) * 4000, "part_size": 4000 if index < total else 2000,
            "destination_path": "/Home/T", "group_id": "grp_x", "status": status, "completed_part_info": info,
            "torrent_path": "/nowhere.torrent", "torrent_file_index": 1, "source_url": "magnet:?xt=urn:btih:abc", **extra}


def _info(index):
    return {"part_index": index, "chat_id": -100, "message_id": 10 + index, "file_unique_id": f"u{index}",
            "part_size": 4000, "start_byte": (index - 1) * 4000, "end_byte": index * 4000 - 1, "thumbnail": None}


class TestJoiningParts:
    def _finalize(self, coll, files):
        from telestore.services.remote_transfer_manager import helpers
        with patch("telestore.services.remote_transfer_manager.helpers.get_remote_db", return_value={"RemoteTransfers": coll}), \
                patch.object(database, "Files", files):
            return helpers.finalize_torrent_file_if_ready("grp_x:1")

    def test_waits_for_every_part(self):
        coll = Coll([_part_job(1, 3, "completed", _info(1)), _part_job(2, 3), _part_job(3, 3, "completed", _info(3))])
        files = MagicMock()
        assert self._finalize(coll, files) is False
        files.add_multipart_file.assert_not_called()

    def test_saves_one_file_from_every_machines_parts_once(self):
        coll = Coll([_part_job(i, 3, "completed", _info(i)) for i in (3, 1, 2)])
        files = MagicMock()
        assert self._finalize(coll, files) is True
        kwargs = files.add_multipart_file.call_args.kwargs
        assert kwargs["file_name"] == "huge.bin" and kwargs["file_size"] == 10_000 and kwargs["file_path"] == "/Home/T"
        assert [p["part_index"] for p in kwargs["parts"]] == [1, 2, 3]
        # A second machine finishing at the same moment doesn't save it twice
        assert self._finalize(coll, files) is True
        assert files.add_multipart_file.call_count == 1

    def test_split_makes_part_jobs_for_big_files(self, split, tmp_path, monkeypatch):
        monkeypatch.chdir(tmp_path)
        with patch.object(manager_module.torrent_engine, "AVAILABLE", True), \
                patch.object(manager_module.torrent_engine, "PART_SIZE", 8):
            remote_transfer_manager._split_torrent(split.coll.find_one({"task_id": "rt_parent"}), split.torrent, GAME)
        parts = [d for d in split.coll.docs if d.get("source_type") == "torrent_part"]
        items = [d["filename"] for d in split.coll.docs if d.get("source_type") == "torrent_item"]
        # fg-01.bin (20 bytes) and readme.txt (10 bytes) are bigger than a part of 8: parts
        assert sorted({p["torrent_file_name"] for p in parts}) == ["fg-01.bin", "readme.txt"]
        assert len([p for p in parts if p["torrent_file_name"] == "fg-01.bin"]) == 3 and items == []


class TestPartJobs:
    def test_main_server_fetches_only_its_part_and_saves_the_file_when_last(self, tmp_path, monkeypatch):
        monkeypatch.chdir(tmp_path)
        torrent = tmp_path / "g.torrent"
        torrent.write_bytes(b"d4:infoe")
        content = os.urandom(10_000)
        engine = FakeEngine(content, 4_000)
        upload, sent = _sent_part()
        coll = Coll([_part_job(1, 3, "completed", _info(1)), _part_job(3, 3, "completed", _info(3)),
                     _part_job(2, 3, torrent_path=str(torrent))])
        files = MagicMock()
        mgr = manager_module.RemoteTransferManager()
        mgr._bot_manager = MagicMock()
        with patch.object(manager_module.torrent_engine, "AVAILABLE", True), \
                patch.object(manager_module.torrent_engine, "get_engine", return_value=engine), \
                patch.object(manager_module, "upload_part_task", upload), \
                patch.object(database, "Files", files), \
                patch("telestore.services.remote_transfer_manager.manager.get_remote_db", return_value={"RemoteTransfers": coll}), \
                patch("telestore.services.remote_transfer_manager.helpers.get_remote_db", return_value={"RemoteTransfers": coll}), \
                patch("telestore.services.remote_transfer_manager.manager.event_service.task_finished"):
            asyncio.run(mgr._run_download_and_upload(coll.find_one({"task_id": "rt_part2"}), MagicMock(is_set=lambda: False)))
        assert engine.calls[0]["done"] == {1, 3}  # only part 2 is fetched here
        assert [(s[0], s[1], s[2]) for s in sent["sent"]] == [(2, content[4000:8000], False)]
        assert coll.find_one({"task_id": "rt_part2"})["status"] == "completed"
        assert files.add_multipart_file.call_args.kwargs["file_name"] == "huge.bin"

    def test_worker_takes_a_part(self, worker, tmp_path):
        content = os.urandom(10_000)
        engine = FakeEngine(content, 4_000)
        w = worker.DistributedWorker()
        w.fetch_torrent = AsyncMock(side_effect=lambda task_id, path: open(path, "wb").write(b"d4:infoe"))
        w.report_progress = AsyncMock()
        w.report_complete = AsyncMock()
        sent = []

        async def upload_part(bot, task_id, chat_id, filename, p_path, p_idx, s_byte, p_size, is_single):
            sent.append((p_idx, open(p_path, "rb").read(), is_single, filename))
            os.remove(p_path)
            return {"part_index": p_idx, "chat_id": chat_id, "message_id": 5, "file_unique_id": "u", "part_size": p_size,
                    "start_byte": s_byte, "end_byte": s_byte + p_size - 1}
        w.upload_part = upload_part
        task = {**_part_job(3, 3), "task_id": "rt_w3", "source_type": "torrent_part"}
        task_dir = tmp_path / "task"
        task_dir.mkdir()
        with patch.object(worker.torrent_engine, "AVAILABLE", True), \
                patch.object(worker.torrent_engine, "get_engine", return_value=engine), \
                patch.object(worker, "TORRENT_REPORT_SECONDS", 0):
            asyncio.run(w.torrent_part(task, SimpleNamespace(), str(task_dir)))
        assert engine.calls[0]["done"] == {1, 2}
        assert sent == [(3, content[8000:], False, "huge.bin")]
        done = w.report_complete.call_args.args[0]
        assert done["is_torrent_part"] is True and done["part_info"]["part_index"] == 3

    def test_worker_route_saves_the_file_after_the_last_part(self, client, test_secrets):
        coll = Coll([_part_job(1, 2, "completed", _info(1)), {**_part_job(2, 2, "downloading"), "claimed_by": "w1"}])
        files = MagicMock()
        with patch("telestore.api.routes.worker.get_remote_db", return_value={"RemoteTransfers": coll}), \
                patch("telestore.services.remote_transfer_manager.helpers.get_remote_db", return_value={"RemoteTransfers": coll}), \
                patch.object(database, "Files", files):
            res = client.post("/api/worker/complete-task", headers={"X-Worker-Key": test_secrets["worker_secret"]}, json={
                "task_id": "rt_part2", "worker_id": "w1", "user_id": "7", "chat_id": -100, "destination_path": "/Home/T",
                "file_name": "huge.bin", "file_size": 10_000, "is_torrent_part": True, "part_info": _info(2)})
        assert res.status_code == 200
        assert coll.find_one({"task_id": "rt_part2"})["status"] == "completed"
        assert [p["part_index"] for p in files.add_multipart_file.call_args.kwargs["parts"]] == [1, 2]


class TestSafety:
    def test_tests_run_in_their_own_folder(self):
        assert not os.path.exists("telestore")  # not the repo

    def test_cleanup_keeps_unfinished_and_recently_failed(self, tmp_path):
        from datetime import datetime, timezone, timedelta
        now = datetime.now(timezone.utc)
        coll = Coll([
            {"task_id": "rt_slow", "status": "downloading", "source_type": "torrent_item", "group_id": "grp_a"},
            {"task_id": "rt_fail", "status": "failed", "source_type": "torrent_item", "group_id": "grp_b", "updated_at": now - timedelta(hours=2)},
            {"task_id": "rt_old", "status": "failed", "source_type": "torrent_part", "group_id": "grp_c", "updated_at": now - timedelta(hours=30)},
        ])
        coll.distinct = lambda key, flt: list({d[key] for d in coll.find(flt) if key in d})
        _orig_match = coll.find

        def find(flt=None, *a, **k):  # the fake has no $gte: apply it here
            flt = dict(flt or {})
            ors = flt.pop("$or", None)
            docs = _orig_match(flt)
            if ors:
                docs = [d for d in docs if any(
                    (o.get("status") == d.get("status") and d.get("updated_at") and d["updated_at"] >= o["updated_at"]["$gte"])
                    if "updated_at" in o else d.get("status") in o["status"]["$in"] for o in ors)]
            return docs
        coll.find = find
        with patch("telestore.services.remote_transfer_manager.manager.get_remote_db", return_value={"RemoteTransfers": coll}):
            kept = remote_transfer_manager.torrent_dirs_in_use()
        assert {"remote_rt_slow", "torrent_grp_a", "torrent_grp_b"} <= kept
        assert "torrent_grp_c" not in kept and "remote_rt_fail" not in kept
