"""Workers keep the line busy both ways, each with a bot of its own (November 2026).

- A worker starts downloading its next task as soon as the current one's download is over, while
  that one is still uploading to Telegram (at most WORKER_MAX_TASKS tasks, default 2; only one
  downloads at a time).
- The server gives each worker its own bot from the bots set aside for workers, so two workers
  don't send through the same bot. Workers send with the first bot they're given, so older workers
  get theirs without an update.
"""

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from test_torrent_workers import aria2c, worker  # noqa: F401  (fixtures)

from telestore.api.routes import worker as routes

TOKENS = [f"{i}:bot{i}" for i in range(12)]
WORKER_BOTS = TOKENS[6:]


class Nodes:
    """WorkerNodes in memory."""

    def __init__(self):
        self.docs = {}

    def find_one(self, flt):
        return self.docs.get(flt["worker_id"])

    def find(self, flt):
        return [d for w, d in self.docs.items() if w != flt["worker_id"]["$ne"] and "bot_slot" in d]

    def update_one(self, flt, update, upsert=False):
        self.docs.setdefault(flt["worker_id"], {}).update(update["$set"])


def _tokens(nodes, worker_id, tokens=TOKENS):
    with patch.object(routes, "TOKENS", tokens), patch.object(routes, "get_remote_db", return_value={"WorkerNodes": nodes}):
        return routes.tokens_for_worker(worker_id)


class TestOwnBot:
    def test_two_workers_get_different_bots(self):
        nodes = Nodes()
        assert _tokens(nodes, "vm2-mumbai")[0] == WORKER_BOTS[0]
        assert _tokens(nodes, "phone-redmi")[0] == WORKER_BOTS[1]
        # all the workers' bots are still there, its own first
        assert sorted(_tokens(nodes, "phone-redmi")) == sorted(WORKER_BOTS)

    def test_a_worker_keeps_its_bot(self):
        nodes = Nodes()
        _tokens(nodes, "a")
        first = _tokens(nodes, "b")[0]
        for _ in range(3):
            assert _tokens(nodes, "b")[0] == first

    def test_more_workers_than_bots_share_the_least_used(self):
        nodes = Nodes()
        two = TOKENS[:6] + ["x:1", "y:2"]
        firsts = [_tokens(nodes, w, two)[0] for w in ("a", "b", "c", "d")]
        assert firsts == ["x:1", "y:2", "x:1", "y:2"]

    def test_with_one_bot_everyone_uses_it(self):
        assert _tokens(Nodes(), "a", ["only:1"]) == ["only:1"]

    def test_a_database_problem_never_stops_a_claim(self):
        broken = MagicMock()
        broken.find_one.side_effect = RuntimeError("down")
        assert _tokens(broken, "a") == WORKER_BOTS

    def test_the_claim_sends_its_own_bot_first(self, client, test_secrets):
        nodes = Nodes()
        nodes.docs["phone-redmi"] = {"worker_id": "phone-redmi", "bot_slot": 1}
        coll = MagicMock()
        coll.find_one_and_update.return_value = {"task_id": "rt_1", "source_url": "https://x/a.bin", "chat_id": -1, "user_id": "7"}
        with patch.object(routes, "TOKENS", TOKENS), \
                patch.object(routes, "get_remote_db", return_value={"RemoteTransfers": coll, "WorkerNodes": nodes}):
            res = client.post("/api/worker/claim-task", json={"worker_id": "phone-redmi"},
                              headers={"X-Worker-Key": test_secrets["worker_secret"]})
        assert res.json()["telegram_config"]["tokens"][0] == WORKER_BOTS[1]


class TestNextTaskWhileUploading:
    def test_waits_while_a_task_downloads_and_starts_once_it_uploads(self, worker):  # noqa: F811
        w = worker.DistributedWorker()
        release = asyncio.Event()

        async def fake_task(task, cfg, done):
            await release.wait()
            done.set()  # downloaded; uploading now
            await asyncio.Event().wait()  # uploading until cancelled

        async def go():
            w.process_task = fake_task
            w.start_task({"task_id": "rt_1"}, {})
            waiting = asyncio.create_task(w.wait_for_room())
            await asyncio.sleep(0.05)
            assert not waiting.done()  # rt_1 is still downloading
            release.set()
            await asyncio.wait_for(waiting, 2)  # rt_1 is uploading: room for the next
            for job in w.jobs:
                job.cancel()
        with patch.object(worker.asyncio, "sleep", _fast_sleep()):
            asyncio.run(go())

    def test_never_more_than_max_tasks(self, worker):  # noqa: F811
        w = worker.DistributedWorker()

        async def uploading(task, cfg, done):
            done.set()
            await asyncio.Event().wait()  # uploading until cancelled

        async def go():
            w.process_task = uploading
            w.start_task({"task_id": "rt_1"}, {})
            w.start_task({"task_id": "rt_2"}, {})
            await asyncio.sleep(0)
            waiting = asyncio.create_task(w.wait_for_room())
            await asyncio.sleep(0.05)
            assert not waiting.done()  # two are uploading already
            next(iter(w.jobs)).cancel()  # one finishes
            await asyncio.wait_for(waiting, 2)
            for job in w.jobs:
                job.cancel()
        with patch.object(worker, "MAX_TASKS", 2), patch.object(worker.asyncio, "sleep", _fast_sleep()):
            asyncio.run(go())

    def test_one_at_a_time_when_set_to_1(self, worker):  # noqa: F811
        w = worker.DistributedWorker()

        async def uploading(task, cfg, done):
            done.set()
            await asyncio.Event().wait()  # uploading until cancelled

        async def go():
            w.process_task = uploading
            w.start_task({"task_id": "rt_1"}, {})
            await asyncio.sleep(0)
            waiting = asyncio.create_task(w.wait_for_room())
            await asyncio.sleep(0.05)
            assert not waiting.done()
            for job in w.jobs:
                job.cancel()
            waiting.cancel()
        with patch.object(worker, "MAX_TASKS", 1), patch.object(worker.asyncio, "sleep", _fast_sleep()):
            asyncio.run(go())

    def test_a_task_says_its_download_is_over_before_uploading(self, worker, aria2c, tmp_path):  # noqa: F811
        w = worker.DistributedWorker()
        w.fetch_torrent = AsyncMock()
        w.report_progress = AsyncMock()
        w.report_complete = AsyncMock()
        done = asyncio.Event()
        seen = []

        async def send_document(chat_id, document, caption, file_name, force_document, progress):
            seen.append(done.is_set())
            return SimpleNamespace(id=1, document=SimpleNamespace(file_unique_id="u1"), video=None, audio=None, photo=None)
        w.get_or_create_bot = AsyncMock(return_value=SimpleNamespace(send_document=send_document))
        task = {"task_id": "rt_1", "source_url": "magnet:?x", "filename": "a.bin", "filesize": 10, "chat_id": -1, "user_id": "7",
                "destination_path": "/Home/Game", "torrent_file_index": 2, "torrent_rel_path": "Game/a.bin",
                "source_type": "torrent_item"}
        with patch.object(worker, "ARIA2C", aria2c), patch.object(worker, "TORRENT_REPORT_SECONDS", 0), \
                patch.object(worker.torrent_engine, "AVAILABLE", False), patch.object(worker, "WORK_DIR", str(tmp_path)):
            asyncio.run(w.process_task(task, {"api_id": 1, "api_hash": "h", "tokens": ["t:1"]}, done))
        assert seen == [True]  # the next task could start while this one was uploading
        assert w.report_complete.called

    def test_a_failed_task_makes_room_too(self, worker, tmp_path):  # noqa: F811
        w = worker.DistributedWorker()
        w.report_fail = AsyncMock()
        w.get_or_create_bot = AsyncMock(return_value=SimpleNamespace())
        w.session = MagicMock()
        w.session.get.side_effect = RuntimeError("no network")
        done = asyncio.Event()
        task = {"task_id": "rt_1", "source_url": "https://x/a.bin", "filename": "a.bin", "chat_id": -1, "user_id": "7"}
        with patch.object(worker, "WORK_DIR", str(tmp_path)):
            asyncio.run(w.process_task(task, {"api_id": 1, "api_hash": "h", "tokens": ["t:1"]}, done))
        assert done.is_set() and w.report_fail.called


def _fast_sleep():
    real = asyncio.sleep

    async def sleep(seconds, *a, **k):
        return await real(min(seconds, 0.01), *a, **k)
    return sleep
