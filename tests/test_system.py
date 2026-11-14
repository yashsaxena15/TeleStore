"""Tests for /system endpoints (the old GitHub webhook is gone)."""

from unittest.mock import MagicMock
from telestore.security.credentials import User, require_auth


class TestGithubWebhook:
    """Tests for GitHub webhook auto-update endpoint."""

    def test_the_old_github_webhook_is_gone(self, client):
        assert client.post("/system/github", json={}).status_code in (404, 405)

    def test_get_workloads_unauthenticated(self, client):
        """Unauthenticated requests must be rejected with 401."""
        response = client.get("/system/workloads")
        assert response.status_code == 401

    def test_get_workloads_authenticated_sorted_busiest_first(self, client):
        """Authenticated requests return bot workloads sorted by busiest first."""
        from telestore.api.app import app

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
