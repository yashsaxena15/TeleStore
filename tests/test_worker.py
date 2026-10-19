"""Tests for distributed worker endpoints and X-Worker-Key authorization."""

from unittest.mock import MagicMock, patch
import pytest


class TestWorkerAuthentication:
    """Ensure worker endpoints strictly reject missing or invalid X-Worker-Key headers."""

    @pytest.mark.parametrize(
        "endpoint,payload",
        [
            ("/api/worker/heartbeat", {"worker_id": "node-1"}),
            ("/api/worker/claim-task", {"worker_id": "node-1"}),
            (
                "/api/worker/update-progress",
                {
                    "task_id": "task-123",
                    "worker_id": "node-1",
                    "transferred_bytes": 100,
                    "filesize": 1000,
                    "speed_bps": 50,
                    "progress": 10.0,
                    "eta_seconds": 18,
                    "phase": "downloading",
                },
            ),
            (
                "/api/worker/complete-task",
                {
                    "task_id": "task-123",
                    "worker_id": "node-1",
                    "file_id": "tg_file_abc",
                    "file_unique_id": "uniq_123",
                    "message_id": 999,
                    "chat_id": -100123456,
                    "filename": "sample.mp4",
                    "filesize": 1024,
                },
            ),
            (
                "/api/worker/fail-task",
                {
                    "task_id": "task-123",
                    "worker_id": "node-1",
                    "error": "Simulated download error",
                },
            ),
        ],
    )
    def test_worker_endpoints_reject_missing_key(self, client, endpoint, payload):
        """Worker endpoints must return 401 when X-Worker-Key header is omitted."""
        response = client.post(endpoint, json=payload)
        assert response.status_code == 401
        assert response.json()["detail"] == "Invalid or missing X-Worker-Key header"

    @pytest.mark.parametrize(
        "endpoint,payload",
        [
            ("/api/worker/heartbeat", {"worker_id": "node-1"}),
            ("/api/worker/claim-task", {"worker_id": "node-1"}),
            (
                "/api/worker/update-progress",
                {
                    "task_id": "task-123",
                    "worker_id": "node-1",
                    "transferred_bytes": 100,
                    "filesize": 1000,
                    "speed_bps": 50,
                    "progress": 10.0,
                    "eta_seconds": 18,
                    "phase": "downloading",
                },
            ),
            (
                "/api/worker/complete-task",
                {
                    "task_id": "task-123",
                    "worker_id": "node-1",
                    "file_id": "tg_file_abc",
                    "file_unique_id": "uniq_123",
                    "message_id": 999,
                    "chat_id": -100123456,
                    "filename": "sample.mp4",
                    "filesize": 1024,
                },
            ),
            (
                "/api/worker/fail-task",
                {
                    "task_id": "task-123",
                    "worker_id": "node-1",
                    "error": "Simulated download error",
                },
            ),
        ],
    )
    def test_worker_endpoints_reject_invalid_key(self, client, endpoint, payload):
        """Worker endpoints must return 401 when X-Worker-Key is incorrect."""
        response = client.post(
            endpoint,
            json=payload,
            headers={"X-Worker-Key": "wrong-and-unauthorized-key"},
        )
        assert response.status_code == 401
        assert response.json()["detail"] == "Invalid or missing X-Worker-Key header"

    @patch("telestore.api.routes.worker.get_remote_db")
    def test_worker_heartbeat_accepts_valid_key(self, mock_get_remote_db, client, test_secrets):
        """Worker endpoint accepts request when provided with valid X-Worker-Key."""
        mock_db = MagicMock()
        mock_get_remote_db.return_value = mock_db
        mock_db.__getitem__.return_value = MagicMock()

        response = client.post(
            "/api/worker/heartbeat",
            json={"worker_id": "test-node-42", "ip": "10.0.0.1"},
            headers={"X-Worker-Key": test_secrets["worker_secret"]},
        )
        assert response.status_code == 200
        assert response.json()["status"] == "ok"
