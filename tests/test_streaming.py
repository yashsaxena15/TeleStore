"""Tests for range-request streaming, HTTP 206 partial content, and Content-Range headers."""

from unittest.mock import AsyncMock, MagicMock, patch
import pytest
from starlette.requests import Request
from starlette.responses import StreamingResponse
from src.Backend.routes.stream_routes import media_streamer, router
from src.Backend.security.credentials import User, require_auth


async def dummy_byte_generator(*args, **kwargs):
    """Async generator yielding dummy media bytes."""
    yield b"a" * 100
    yield b"b" * 100


class TestRangeRequestStreaming:
    """Verify HTTP range requests return 206 Partial Content with proper Content-Range."""

    @pytest.mark.anyio
    async def test_media_streamer_range_request_returns_206(self):
        """When a Range header is sent, media_streamer returns 206 with Content-Range."""
        from src.Backend.web import app
        scope = {
            "type": "http",
            "method": "GET",
            "path": "/dl/test_video.mp4",
            "headers": [
                (b"range", b"bytes=100-299"),
                (b"user-agent", b"pytest"),
            ],
            "query_string": b"",
            "app": app,
        }
        request = Request(scope)

        mock_file = MagicMock()
        mock_file.file_unique_id = "test_unique_id"
        mock_file.file_size = 1000
        mock_file.mime_type = "video/mp4"

        mock_client = MagicMock()
        mock_tg_connect = MagicMock()
        mock_tg_connect.yield_parts = dummy_byte_generator

        with patch("src.Backend.routes.stream_routes.get_byte_streamer", return_value=mock_tg_connect):
            response = await media_streamer(
                request=request,
                client=mock_client,
                chat_id=-1001234567,
                id=42,
                file=mock_file,
                secure_hash="abcd12",
                total_file_size=1000,
                file_name="test_video.mp4",
            )

            assert isinstance(response, StreamingResponse)
            assert response.status_code == 206
            assert response.headers["Content-Range"] == "bytes 100-299/1000"
            assert response.headers["Content-Length"] == "200"
            assert response.headers["Accept-Ranges"] == "bytes"
            assert response.headers["Content-Type"] == "video/mp4"

    @pytest.mark.anyio
    async def test_media_streamer_full_request_returns_200(self):
        """When no Range header is sent, media_streamer returns 200 without Content-Range."""
        from src.Backend.web import app
        scope = {
            "type": "http",
            "method": "GET",
            "path": "/dl/test_video.mp4",
            "headers": [(b"user-agent", b"pytest")],
            "query_string": b"",
            "app": app,
        }
        request = Request(scope)

        mock_file = MagicMock()
        mock_file.file_unique_id = "test_unique_id"
        mock_file.file_size = 1000
        mock_file.mime_type = "video/mp4"

        mock_client = MagicMock()
        mock_tg_connect = MagicMock()
        mock_tg_connect.yield_parts = dummy_byte_generator

        with patch("src.Backend.routes.stream_routes.get_byte_streamer", return_value=mock_tg_connect):
            response = await media_streamer(
                request=request,
                client=mock_client,
                chat_id=-1001234567,
                id=42,
                file=mock_file,
                secure_hash="abcd12",
                total_file_size=1000,
                file_name="test_video.mp4",
            )

            assert response.status_code == 200
            assert "Content-Range" not in response.headers
            assert response.headers["Content-Length"] == "1000"
            assert response.headers["Accept-Ranges"] == "bytes"

    def test_dl_route_unauthenticated(self, client):
        """Unauthenticated requests to download/stream endpoints must return 401."""
        response = client.get("/dl/sample.mp4")
        assert response.status_code == 401
        assert response.json()["detail"] == "Authentication required"

    def test_dl_route_with_range_header_integration(self, client):
        """Integration test: GET /dl/file with Range header returns 206 via TestClient."""
        from src.Backend.web import app
        from src.Database import database

        test_user = User(username="testuser", telegram_user_id=123456)

        # Setup mock file in database
        database.Files.find_one.return_value = {
            "file_name": "movie.mp4",
            "file_size": 5000,
            "file_unique_id": "file_uniq_123",
            "chat_id": -1001234567,
            "message_id": 99,
            "is_split": False,
        }

        # Setup mock bot client
        mock_bot = MagicMock()
        mock_bot.is_connected = True
        mock_message = MagicMock()
        mock_video = MagicMock()
        mock_video.file_unique_id = "file_uniq_123"
        mock_video.file_size = 5000
        mock_video.mime_type = "video/mp4"
        mock_video.file_name = "movie.mp4"
        mock_message.video = mock_video
        mock_message.document = None
        mock_message.photo = None
        mock_message.audio = None
        mock_message.voice = None
        mock_bot.get_messages = AsyncMock(return_value=mock_message)

        mock_manager = MagicMock()
        mock_manager.get_least_busy_client.return_value = mock_bot
        mock_manager.client_list = [mock_bot]
        app.state.bot_manager = mock_manager

        mock_streamer = MagicMock()
        mock_streamer.yield_parts = dummy_byte_generator

        try:
            with patch("src.Backend.routes.stream_routes.require_auth", return_value=test_user), \
                 patch("src.Backend.routes.stream_routes.get_byte_streamer", return_value=mock_streamer):
                response = client.get(
                    "/dl/movie.mp4?file_id=file_uniq_123",
                    headers={"Range": "bytes=0-499"},
                )
                assert response.status_code == 206
                assert response.headers["Content-Range"] == "bytes 0-499/5000"
                assert response.headers["Content-Length"] == "500"
                assert response.headers["Accept-Ranges"] == "bytes"
        finally:
            app.state.bot_manager = None
