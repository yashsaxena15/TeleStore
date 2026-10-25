"""The Transfers list stays small for a folder leech with tens of thousands of files."""

from unittest.mock import MagicMock, patch

from telestore.services.remote_transfer_manager import manager as manager_module
from telestore.services.remote_transfer_manager.manager import GROUP_PREVIEW_SIZE, remote_transfer_manager


class _Cursor(list):
    def sort(self, *a, **kw):
        return self

    def limit(self, n):
        self.limit_used = n
        return _Cursor(self[:n])


def _coll():
    single = {"_id": 1, "task_id": "rt_single", "status": "queued", "user_id": "42"}
    running = {"_id": 2, "task_id": "rt_run", "status": "downloading", "group_id": "grp", "user_id": "42"}
    waiting = [{"_id": 10 + i, "task_id": f"rt_q{i}", "status": "queued", "group_id": "grp", "user_id": "42"} for i in range(500)]
    done = {"_id": 3, "task_id": "rt_done", "status": "completed", "group_id": "grp", "user_id": "42"}
    coll = MagicMock()

    def find(query):
        status = query["status"]["$in"]
        if "group_id" in query and query["group_id"] is None:
            return _Cursor([single])
        if status == manager_module.RUNNING_STATUSES:
            return _Cursor([running])
        if "completed" in status:
            return _Cursor([done])
        return _Cursor(waiting)
    coll.find.side_effect = find
    coll.distinct.return_value = ["grp"]
    coll.aggregate.return_value = iter([
        {"_id": {"group": "grp", "status": "queued"}, "count": 31000, "filesize": 0, "transferred": 0, "speed": 0},
        {"_id": {"group": "grp", "status": "completed"}, "count": 7000, "filesize": 9000, "transferred": 9000, "speed": 0},
        {"_id": {"group": "grp", "status": "downloading"}, "count": 1, "filesize": 100, "transferred": 40, "speed": 5},
    ])
    return coll


def test_a_big_folder_sends_a_few_rows_and_a_summary():
    coll = _coll()
    with patch.object(manager_module, "get_remote_db", return_value={"RemoteTransfers": coll}):
        result = remote_transfer_manager.get_user_tasks("42")
    ids = [t["task_id"] for t in result["tasks"]]
    assert "rt_single" in ids and "rt_run" in ids and "rt_done" in ids
    assert sum(1 for i in ids if i.startswith("rt_q")) == GROUP_PREVIEW_SIZE
    assert result["groups"]["grp"] == {
        "total": 38001,
        "counts": {"queued": 31000, "completed": 7000, "downloading": 1},
        "filesize": 9100, "transferred_bytes": 9040, "speed_bps": 5,
    }


def test_no_groups_means_no_summary_query():
    coll = _coll()
    coll.distinct.return_value = []
    coll.find.side_effect = lambda q: _Cursor([])
    with patch.object(manager_module, "get_remote_db", return_value={"RemoteTransfers": coll}):
        assert remote_transfer_manager.get_user_tasks("42") == {"tasks": [], "groups": {}}
    coll.aggregate.assert_not_called()
