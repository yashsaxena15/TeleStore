"""Tests for /files endpoints."""

from src.Backend.security.credentials import User, require_auth
from src.Database import database


class TestFilesRoutes:
    """Tests for files listing and management endpoints."""

    def test_list_files_unauthenticated(self, client):
        """Unauthenticated requests to /files must return 401."""
        response = client.get("/files")
        assert response.status_code == 401

    def test_list_files_authenticated_empty(self, client):
        """Authenticated requests with no files return empty items list."""
        from src.Backend.web import app

        app.dependency_overrides[require_auth] = lambda: User(
            username="admin", telegram_user_id=123456
        )
        database.Files.get_files_by_folder.return_value = []
        database.Files.count_files_by_folder.return_value = 0

        try:
            response = client.get("/files?path=/")
            assert response.status_code == 200
            data = response.json()
            assert "files" in data or "items" in data or isinstance(data, list)
        finally:
            app.dependency_overrides.pop(require_auth, None)

    def test_list_files_authenticated_with_items(self, client):
        """Authenticated requests return formatted files list."""
        from src.Backend.web import app

        app.dependency_overrides[require_auth] = lambda: User(
            username="admin", telegram_user_id=123456
        )
        sample_file = {
            "file_name": "document.pdf",
            "file_size": 2048,
            "file_type": "document",
            "file_path": "/",
            "owner_id": "123456",
        }
        database.Files.get_files_by_folder.return_value = [sample_file]
        database.Files.count_files_by_folder.return_value = 1

        try:
            response = client.get("/files?path=/")
            assert response.status_code == 200
        finally:
            app.dependency_overrides.pop(require_auth, None)
