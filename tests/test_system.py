"""Tests for /system/github webhook and /system/workloads endpoints."""

import hashlib
import hmac
import json
from unittest.mock import MagicMock, patch
import pytest
from src.Backend.security.credentials import User, require_auth


class TestGithubWebhook:
    """Tests for GitHub webhook auto-update endpoint."""

    def test_github_webhook_rejects_missing_signature(self, client):
        """Unsigned calls must be rejected with 401."""
        response = client.post(
            "/system/github",
            content=json.dumps({"ref": "refs/heads/main"}),
            headers={"Content-Type": "application/json", "X-GitHub-Event": "push"},
        )
        assert response.status_code == 401
        assert response.json()["detail"] == "Invalid signature"

    def test_github_webhook_rejects_invalid_signature(self, client):
        """Calls with forged or wrong signatures must be rejected with 401."""
        response = client.post(
            "/system/github",
            content=json.dumps({"ref": "refs/heads/main"}),
            headers={
                "Content-Type": "application/json",
                "X-GitHub-Event": "push",
                "X-Hub-Signature-256": "sha256=0000000000000000000000000000000000000000000000000000000000000000",
            },
        )
        assert response.status_code == 401
        assert response.json()["detail"] == "Invalid signature"

    @patch("subprocess.run")
    def test_github_webhook_accepts_valid_signature_with_mocked_subprocess(
        self, mock_subprocess, client, test_secrets
    ):
        """Valid HMAC signature triggers git pull with subprocess completely mocked (no real git)."""
        mock_proc = MagicMock()
        mock_proc.returncode = 0
        mock_proc.stdout = "Already up to date."
        mock_proc.stderr = ""
        mock_subprocess.return_value = mock_proc

        payload = json.dumps({"ref": "refs/heads/main"}).encode("utf-8")
        secret = test_secrets["github_secret"].encode("utf-8")
        signature = "sha256=" + hmac.new(secret, payload, hashlib.sha256).hexdigest()

        response = client.post(
            "/system/github",
            content=payload,
            headers={
                "Content-Type": "application/json",
                "X-GitHub-Event": "push",
                "X-Hub-Signature-256": signature,
            },
        )
        assert response.status_code == 200
        # Verify subprocess was called and no real git process ran
        assert mock_subprocess.called

    def test_github_webhook_disabled_when_secret_unset(self, client):
        """When GITHUB_WEBHOOK_SECRET is empty/unset, webhook responds with 503."""
        with patch("src.Config.GITHUB_WEBHOOK_SECRET", ""):
            response = client.post(
                "/system/github",
                content=json.dumps({"ref": "refs/heads/main"}),
                headers={"Content-Type": "application/json"},
            )
            assert response.status_code == 503
            assert "Webhook disabled" in response.json()["detail"]


class TestSystemWorkloads:
    """Tests for /system/workloads endpoint."""

    def test_get_workloads_unauthenticated(self, client):
        """Unauthenticated requests must be rejected with 401."""
        response = client.get("/system/workloads")
        assert response.status_code == 401

    def test_get_workloads_authenticated_sorted_busiest_first(self, client):
        """Authenticated requests return bot workloads sorted by busiest first."""
        from src.Backend.web import app

        # Create mock bot manager with mock clients having get_workload()
        mock_bot1 = MagicMock()
        mock_bot1.name = "bot_alpha"
        mock_bot1.get_workload.return_value = 5

        mock_bot2 = MagicMock()
        mock_bot2.name = "bot_beta"
        mock_bot2.get_workload.return_value = 18

        mock_bot3 = MagicMock()
        mock_bot3.name = "bot_gamma"
        mock_bot3.get_workload.return_value = 2

        mock_manager = MagicMock()
        mock_manager.work_load = [
            {mock_bot1: 5},
            {mock_bot2: 18},
            {mock_bot3: 2},
        ]
        app.state.bot_manager = mock_manager

        # Authenticate via dependency override
        app.dependency_overrides[require_auth] = lambda: User(username="admin")
        try:
            response = client.get("/system/workloads")
            assert response.status_code == 200
            data = response.json()
            assert data["bots_count"] == 3
            # Check sorting: busiest first (bot_beta=18, bot_alpha=5, bot_gamma=2)
            loads_keys = list(data["loads"].keys())
            assert loads_keys == ["bot_beta", "bot_alpha", "bot_gamma"]
            assert data["loads"]["bot_beta"] == 18
            assert data["loads"]["bot_alpha"] == 5
            assert data["loads"]["bot_gamma"] == 2
        finally:
            app.dependency_overrides.pop(require_auth, None)
            app.state.bot_manager = None
