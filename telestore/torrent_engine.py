# telestore/torrent_engine.py
"""Torrents with libtorrent: one file at a time, in parts of 1.95 GB, never the whole file on disk.

Shared by the main server and the worker machines (copied next to worker.py, like transfer_core.py).
aria2c could only fetch a whole file before any of it went to Telegram (torrent pieces arrive in
any order), so a 46 GB file took 46 GB of disk. Here each part is fetched on its own:

1. only the pieces that cover part 1 of the file are wanted;
2. when they're all here, part 1 is copied out to its own file (sent to Telegram by the caller)
   and its space in the torrent's file is given back to the disk (a "hole": the file is sparse);
3. part 2 is fetched while part 1 is being sent, and so on.

The caller's slots (two parts at a time, from the server's disk budget) say when the next part may
start, so at most two parts (about 3.9 GB) are on disk whatever the file's size.

No seeding: a torrent is removed as soon as its file is done. While it downloads, uploads to other
peers are capped at TORRENT_UPLOAD_LIMIT_KB: 1 KB/s by default, as little as possible (the owner's
bandwidth is limited). libtorrent's own protocol messages aren't counted against the cap, or it
would also hold back our requests for data. The cost, measured on a real swarm (Ubuntu's ISO,
November 2026): about five times slower than with a 64 KB/s cap (28 MB vs 128 MB a minute), since
peers serve a peer that shares nothing last. Set TORRENT_UPLOAD_LIMIT_KB=64 for full speed (only
~190 KB went up per 128 MB down).

libtorrent is a Python package (pip install libtorrent): inside the Docker image on the main server,
inside the worker's virtual environment on worker machines.
"""

import ctypes
import os
import threading
import time
import warnings
from typing import Callable, Iterable, NamedTuple, Optional

try:  # optional: without it, machines fall back to aria2c (or don't take torrents)
    import libtorrent as lt
except ImportError:  # pragma: no cover - depends on the machine
    lt = None

try:
    from telestore.transfer_core import TORRENT_TRACKERS
except ImportError:  # on a worker machine the two files sit side by side
    from transfer_core import TORRENT_TRACKERS

AVAILABLE = lt is not None
PART_SIZE = 1950 * 1024 * 1024  # Telegram's limit for a bot upload
UPLOAD_LIMIT = max(1, int(os.getenv("TORRENT_UPLOAD_LIMIT_KB", "1"))) * 1024  # bytes per second while downloading
POLL_SECONDS = 0.5
COPY_CHUNK = 8 * 1024 * 1024


class PartReady(NamedTuple):
    """One part of a file, copied out to [path] and ready to send."""
    index: int        # 1-based
    start: int        # where it starts in the file
    length: int
    path: str
    is_single: bool   # the whole file in one part
    total_parts: int


def plan_parts(file_size: int, part_size: int = PART_SIZE) -> list:
    """[(index, start, length)] for a file cut into parts of part_size (the last one shorter)."""
    count = max(1, -(-file_size // part_size))
    return [(i + 1, i * part_size, min(part_size, file_size - i * part_size)) for i in range(count)]


def pieces_for(file_offset: int, start: int, length: int, piece_length: int) -> range:
    """The torrent pieces holding bytes [start, start+length) of a file that begins at file_offset.
    A piece on the edge between two parts belongs to both (each needs its own bytes from it)."""
    first = (file_offset + start) // piece_length
    last = (file_offset + start + max(length, 1) - 1) // piece_length
    return range(first, last + 1)


_FALLOC_FL_KEEP_SIZE = 0x01
_FALLOC_FL_PUNCH_HOLE = 0x02
_BLOCK = 4096
_libc = None


def punch_hole(fd: int, offset: int, length: int) -> bool:
    """Gives the disk space of bytes [offset, offset+length) of an open file back (Linux; the file
    keeps its size and reads zeros there). Only whole 4 KB blocks inside the range are freed, so
    bytes just outside it are never touched. False when the system can't (the space stays used)."""
    global _libc
    begin = -(-offset // _BLOCK) * _BLOCK
    end = (offset + length) // _BLOCK * _BLOCK
    if end <= begin:
        return True
    try:
        if _libc is None:
            _libc = ctypes.CDLL(None, use_errno=True)
            _libc.fallocate.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_longlong, ctypes.c_longlong]
        return _libc.fallocate(fd, _FALLOC_FL_KEEP_SIZE | _FALLOC_FL_PUNCH_HOLE, begin, end - begin) == 0
    except (OSError, AttributeError):
        return False


def copy_out(src_path: str, start: int, length: int, dest_path: str, free_source: bool = True) -> None:
    """Copies bytes [start, start+length) of src to their own file, giving the source's space back
    a chunk at a time, so the part takes its size on disk once, not twice."""
    with open(src_path, "rb+") as src, open(dest_path, "wb") as dest:
        src.seek(start)
        done = 0
        while done < length:
            chunk = src.read(min(COPY_CHUNK, length - done))
            if not chunk:
                raise IOError(f"The torrent's file ended early (at {start + done} of {start + length} bytes)")
            dest.write(chunk)
            if free_source:
                dest.flush()
                punch_hole(src.fileno(), start + done, len(chunk))
            done += len(chunk)


class TorrentEngine:
    """One libtorrent session for the process (thread-safe); each download runs in a caller's thread."""

    def __init__(self, extra_settings: Optional[dict] = None):
        if not AVAILABLE:
            raise RuntimeError("libtorrent is not installed")
        settings = {
            "user_agent": "TeleStore",
            "listen_interfaces": "0.0.0.0:0,[::]:0",
            "upload_rate_limit": UPLOAD_LIMIT,
            # The cap is on the data others get from us, not on our requests for data
            "rate_limit_ip_overhead": False,
            "enable_dht": True,
            "enable_lsd": False,
            "enable_upnp": False,
            "enable_natpmp": False,
            "connections_limit": 200,
            # Between two parts nothing is wanted for a moment ("finished"): keep the seeders
            # connected instead of dropping them, or the next part waits to find peers again
            "close_redundant_connections": False,
            "active_downloads": 8,
            "active_seeds": 0,
            # Small buffers: worker machines can have 1 GB of memory
            "max_queued_disk_bytes": 8 * 1024 * 1024,
            "send_buffer_watermark": 512 * 1024,
            "alert_mask": 0,
        }
        settings.update(extra_settings or {})
        self.session = lt.session(settings)
        self._lock = threading.Lock()

    # ── Magnets ──────────────────────────────────────────────────────────

    def fetch_metadata(self, magnet: str, work_dir: str, cancelled: Callable[[], bool],
                       on_status: Optional[Callable[[str], None]] = None, timeout: float = 180,
                       peers: Iterable[tuple] = ()) -> bytes:
        """A magnet's .torrent (its file list), from its peers; nothing else is downloaded."""
        os.makedirs(work_dir, exist_ok=True)
        params = lt.parse_magnet_uri(magnet)
        params.save_path = work_dir
        params.trackers = list(params.trackers) + list(TORRENT_TRACKERS)
        params.flags |= lt.torrent_flags.upload_mode  # metadata only
        # Not left to libtorrent's queue (which would decide when to start it): running now
        params.flags &= ~lt.torrent_flags.auto_managed
        params.flags &= ~lt.torrent_flags.paused
        handle = self.session.add_torrent(params)
        for peer in peers:
            handle.connect_peer(peer)
        started, last = time.monotonic(), 0.0
        try:
            while not handle.status().has_metadata:
                if cancelled():
                    raise InterruptedError("Cancelled by user")
                if time.monotonic() - started > timeout:
                    raise TimeoutError(f"Couldn't get the torrent's file list from its peers within {int(timeout)} seconds. "
                                       "It may have no seeders right now.")
                if on_status and time.monotonic() - last >= 2:
                    last = time.monotonic()
                    on_status(f"Connecting to peers: {handle.status().num_peers} connected...")
                time.sleep(POLL_SECONDS)
            with warnings.catch_warnings():
                warnings.simplefilter("ignore", DeprecationWarning)
                return lt.bencode(lt.create_torrent(handle.torrent_file()).generate())
        finally:
            self.session.remove_torrent(handle)

    # ── One file, part by part ───────────────────────────────────────────

    def download_file(
        self,
        torrent_bytes: bytes,
        file_index: int,
        save_dir: str,
        parts_dir: str,
        *,
        slots,
        on_part: Callable[[PartReady], None],
        cancelled: Callable[[], bool],
        on_progress: Optional[Callable[[dict], None]] = None,
        should_pause: Callable[[], bool] = lambda: False,
        done_parts: Iterable[int] = (),
        part_size: int = PART_SIZE,
        peers: Iterable[tuple] = (),
    ) -> int:
        """Fetches file [file_index] (1-based, its place in the torrent's file list) part by part.

        Before each part: slots.acquire(timeout=...) (two at a time; the caller releases one when a
        part has been sent and its copy deleted). Each finished part is copied to parts_dir and
        handed to on_part, which must not block (it starts the upload elsewhere). Parts in
        done_parts (already in Telegram, before a restart) are skipped. Returns the file's size.
        """
        ti = lt.torrent_info(lt.bdecode(torrent_bytes))
        layout = ti.layout()
        idx = file_index - 1
        if idx < 0 or idx >= layout.num_files():
            raise ValueError(f"The torrent has no file #{file_index}")
        file_size = layout.file_size(idx)
        file_offset = layout.file_offset(idx)
        piece_length = ti.piece_length()
        file_path = os.path.join(save_dir, layout.file_path(idx))
        parts = plan_parts(file_size, part_size)
        skip = set(done_parts)
        os.makedirs(save_dir, exist_ok=True)
        os.makedirs(parts_dir, exist_ok=True)

        params = lt.add_torrent_params()
        params.ti = ti
        params.save_path = save_dir
        params.trackers = list(TORRENT_TRACKERS)
        params.flags &= ~lt.torrent_flags.auto_managed
        params.flags &= ~lt.torrent_flags.paused
        # Only this file is wanted (so its data goes into the file itself, not libtorrent's side
        # storage for unwanted files), but none of its pieces until a part asks for them: piece
        # priorities given here take precedence over file priorities
        file_priorities = [0] * layout.num_files()
        file_priorities[idx] = 1
        params.file_priorities = file_priorities
        params.piece_priorities = [0] * ti.num_pieces()
        params.upload_limit = UPLOAD_LIMIT
        handle = self.session.add_torrent(params)
        peers = list(peers)
        for peer in peers:
            handle.connect_peer(peer)

        done_bytes = sum(length for index, _, length in parts if index in skip)
        try:
            for index, start, length in parts:
                if index in skip:
                    continue
                self._take_slot(slots, cancelled)
                wanted = pieces_for(file_offset, start, length, piece_length)
                priorities = [0] * ti.num_pieces()
                for piece in wanted:
                    priorities[piece] = 7
                handle.prioritize_pieces(priorities)
                # Wanting pieces again: ask the trackers and DHT for peers now, not at the next round
                handle.force_reannounce()
                handle.force_dht_announce()
                for peer in peers:
                    handle.connect_peer(peer)
                self._wait_for(handle, wanted, piece_length, file_offset, start, length, done_bytes, file_size,
                               index, len(parts), cancelled, on_progress, should_pause)
                part_path = os.path.join(parts_dir, f"part{index}")
                copy_out(file_path, start, length, part_path)
                done_bytes += length
                on_part(PartReady(index, start, length, part_path, len(parts) == 1, len(parts)))
            return file_size
        finally:
            # No seeding: the torrent goes as soon as its file is done (or the download stops)
            self.session.remove_torrent(handle, lt.options_t.delete_files)

    @staticmethod
    def _take_slot(slots, cancelled: Callable[[], bool]) -> None:
        while not slots.acquire(timeout=POLL_SECONDS):
            if cancelled():
                raise InterruptedError("Cancelled by user")

    @staticmethod
    def _wait_for(handle, wanted: range, piece_length: int, file_offset: int, start: int, length: int,
                  done_before: int, file_size: int, index: int, total: int, cancelled, on_progress, should_pause) -> None:
        paused = False
        while True:
            if cancelled():
                raise InterruptedError("Cancelled by user")
            if should_pause():
                if not paused:
                    handle.pause()
                    paused = True
            elif paused:
                handle.resume()
                paused = False
            have = [p for p in wanted if handle.have_piece(p)]
            if len(have) == len(wanted):
                return
            if on_progress:
                status = handle.status()
                # Bytes of this part that are here (whole pieces, clipped to the part)
                part_start, part_end = file_offset + start, file_offset + start + length
                here = sum(max(0, min(part_end, (p + 1) * piece_length) - max(part_start, p * piece_length)) for p in have)
                on_progress({
                    "done": done_before + here,
                    "total": file_size,
                    "progress": round((done_before + here) / (file_size or 1) * 100, 1),
                    "speed_bps": int(status.download_payload_rate),
                    "peers": int(status.num_peers),
                    "part": index,
                    "parts": total,
                    "part_done": here,
                    "part_total": length,
                    "paused": paused,
                })
            time.sleep(POLL_SECONDS)


_engine: Optional[TorrentEngine] = None
_engine_lock = threading.Lock()


def get_engine() -> TorrentEngine:
    """The process's engine, made on first use."""
    global _engine
    with _engine_lock:
        if _engine is None:
            _engine = TorrentEngine()
        return _engine
