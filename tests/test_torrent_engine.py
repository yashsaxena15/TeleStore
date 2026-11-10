"""The libtorrent engine (telestore/torrent_engine.py), against a real local seeder.

A small torrent is made here and shared by a second libtorrent session on 127.0.0.1; the engine
downloads one of its files in parts whose edges fall inside pieces (as 1.95 GB parts do in real
torrents), with at most two parts on disk at once.
"""

import os
import threading
import time
import warnings

import pytest

from telestore import torrent_engine as te

lt = pytest.importorskip("libtorrent")

PIECE = 16 * 1024
LOCAL = {"listen_interfaces": "127.0.0.1:0", "enable_dht": False, "enable_lsd": False,
         "allow_multiple_connections_per_ip": True}


@pytest.fixture(scope="module")
def swarm(tmp_path_factory):
    """A torrent with two files (one of 300 000 bytes), seeded locally."""
    src = tmp_path_factory.mktemp("seed")
    (src / "Game").mkdir()
    big = os.urandom(300_000)
    (src / "Game" / "big.bin").write_bytes(big)
    (src / "Game" / "notes.txt").write_bytes(b"hello" * 1000)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", DeprecationWarning)
        fs = lt.file_storage()
        lt.add_files(fs, str(src / "Game"))
        ct = lt.create_torrent(fs, PIECE)
        lt.set_piece_hashes(ct, str(src))
        data = lt.bencode(ct.generate())
    # Lets the downloader in at once (libtorrent reconsiders who it serves every 15 s by default)
    seeder = lt.session({**LOCAL, "upload_rate_limit": 0, "unchoke_interval": 1, "unchoke_slots_limit": -1})
    params = lt.add_torrent_params()
    params.ti = lt.torrent_info(lt.bdecode(data))
    params.save_path = str(src)
    params.flags |= lt.torrent_flags.seed_mode
    handle = seeder.add_torrent(params)
    ti = params.ti
    layout = ti.layout()
    index = next(i for i in range(layout.num_files()) if layout.file_path(i).endswith("big.bin"))
    yield {"data": data, "big": big, "index": index + 1, "port": seeder.listen_port(),
           "magnet": lt.make_magnet_uri(ti), "handle": handle, "session": seeder}
    seeder.remove_torrent(handle)


class Slots:
    """Two parts at a time, like the server's disk budget."""

    def __init__(self, per_job=2):
        self.sem = threading.Semaphore(per_job)
        self.held = 0
        self.most = 0
        self.lock = threading.Lock()

    def acquire(self, blocking=True, timeout=None):
        ok = self.sem.acquire(blocking, timeout)
        if ok:
            with self.lock:
                self.held += 1
                self.most = max(self.most, self.held)
        return ok

    def release(self):
        with self.lock:
            self.held -= 1
        self.sem.release()


@pytest.fixture
def engine():
    return te.TorrentEngine(LOCAL)


def _download(engine, swarm, tmp_path, part_size=50_000, done_parts=(), cancel_after=None, upload_delay=0.0):
    slots = Slots()
    got = {}
    uploads = []

    def upload(part):
        time.sleep(upload_delay)  # Telegram taking its time: the next part downloads meanwhile
        got[part.index] = open(part.path, "rb").read()
        os.remove(part.path)
        slots.release()

    def on_part(part):
        t = threading.Thread(target=upload, args=(part,))
        t.start()
        uploads.append(t)

    seen = []
    size = engine.download_file(
        swarm["data"], swarm["index"], str(tmp_path / "dl"), str(tmp_path / "parts"),
        slots=slots, on_part=on_part, part_size=part_size, done_parts=done_parts,
        cancelled=lambda: cancel_after is not None and len(got) >= cancel_after,
        on_progress=seen.append, peers=[("127.0.0.1", swarm["port"])])
    for t in uploads:
        t.join()
    return size, got, slots, seen


class TestParts:
    def test_plan(self):
        assert te.plan_parts(10, 4) == [(1, 0, 4), (2, 4, 4), (3, 8, 2)]
        assert te.plan_parts(3, 4) == [(1, 0, 3)]
        assert te.plan_parts(0, 4) == [(1, 0, 0)]

    def test_a_piece_on_the_edge_belongs_to_both_parts(self):
        # A file starting at byte 1000 of the torrent, pieces of 16 KiB, parts of 50 000 bytes
        assert list(te.pieces_for(1000, 0, 50_000, PIECE)) == [0, 1, 2, 3]
        assert list(te.pieces_for(1000, 50_000, 50_000, PIECE)) == [3, 4, 5, 6]

    def test_punching_frees_whole_blocks_inside_the_range_only(self, tmp_path):
        path = tmp_path / "f"
        path.write_bytes(b"\x01" * 1_000_000)
        before = os.stat(path).st_blocks
        with open(path, "rb+") as f:
            assert te.punch_hole(f.fileno(), 5000, 600_000)
        data = path.read_bytes()
        assert len(data) == 1_000_000  # same size
        assert data[:5000] == b"\x01" * 5000 and data[605_000:] == b"\x01" * 395_000  # outside untouched
        assert data[8192:602_112] == b"\x00" * (602_112 - 8192)  # whole blocks inside are holes
        assert os.stat(path).st_blocks < before


class TestDownload:
    def test_the_file_comes_in_parts_with_two_at_most_on_disk(self, engine, swarm, tmp_path):
        size, got, slots, seen = _download(engine, swarm, tmp_path, upload_delay=0.2)
        assert size == len(swarm["big"])
        assert sorted(got) == [1, 2, 3, 4, 5, 6]
        assert b"".join(got[i] for i in sorted(got)) == swarm["big"]
        assert slots.most <= 2
        assert seen and seen[-1]["total"] == len(swarm["big"])
        # No seeding: the torrent is gone from the session, and its files from the disk
        assert engine.session.get_torrents() == []
        assert not os.path.exists(tmp_path / "dl" / "Game" / "big.bin")

    def test_one_part_when_the_file_is_small(self, engine, swarm, tmp_path):
        size, got, _, _ = _download(engine, swarm, tmp_path, part_size=te.PART_SIZE)
        assert list(got) == [1] and got[1] == swarm["big"]

    def test_parts_already_sent_are_skipped(self, engine, swarm, tmp_path):
        _, got, _, _ = _download(engine, swarm, tmp_path, done_parts={1, 2})
        assert sorted(got) == [3, 4, 5, 6]
        assert got[3] == swarm["big"][100_000:150_000]

    def test_cancel_stops_and_cleans_up(self, engine, swarm, tmp_path):
        with pytest.raises(InterruptedError):
            _download(engine, swarm, tmp_path, cancel_after=1, upload_delay=0.0)
        assert engine.session.get_torrents() == []

    def test_uploads_to_others_are_capped(self, engine):
        settings = engine.session.get_settings()
        assert settings["upload_rate_limit"] == te.UPLOAD_LIMIT == 1024  # as little as possible
        # Our own requests for data don't count against the cap (that would slow downloads)
        assert settings["rate_limit_ip_overhead"] is False

    def test_a_wrong_file_number(self, engine, swarm, tmp_path):
        with pytest.raises(ValueError):
            engine.download_file(swarm["data"], 99, str(tmp_path), str(tmp_path), slots=Slots(),
                                 on_part=lambda p: None, cancelled=lambda: False)


class TestMagnet:
    def test_file_list_from_peers(self, engine, swarm, tmp_path):
        data = engine.fetch_metadata(swarm["magnet"], str(tmp_path), cancelled=lambda: False, timeout=30,
                                     peers=[("127.0.0.1", swarm["port"])])
        assert lt.torrent_info(lt.bdecode(data)).info_hashes() == lt.torrent_info(lt.bdecode(swarm["data"])).info_hashes()
        assert engine.session.get_torrents() == []

    def test_no_peers_times_out(self, engine, tmp_path):
        magnet = "magnet:?xt=urn:btih:" + "a" * 40
        with pytest.raises(TimeoutError):
            engine.fetch_metadata(magnet, str(tmp_path), cancelled=lambda: False, timeout=1)
