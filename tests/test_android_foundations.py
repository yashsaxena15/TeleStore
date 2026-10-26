"""Server changes for the Android app: app logins, sign-out, search, own-file media, thumbnails."""

from datetime import datetime, timedelta
from unittest.mock import MagicMock, PropertyMock, patch

import pytest
from bson import ObjectId

from telestore.api import state
from telestore.api.app import app
from telestore.api.routes import auth as auth_routes
from telestore.api.routes import media as media_routes
from telestore.db import database
from telestore.db.repositories.files import Files
from telestore.security.credentials import User, require_auth


@pytest.fixture(autouse=True)
def clean_tokens():
    state._auth_tokens.clear()
    yield
    state._auth_tokens.clear()


class TestAppTokens:
    def test_android_gets_a_90_day_token(self):
        auth_routes._issue_token("bob", "local", None, device="Android")
        args, kwargs = database.Users.save_auth_token.call_args
        assert kwargs == {"ttl_hours": 90 * 24, "device": "android"}

    def test_website_keeps_24_hours(self):
        auth_routes._issue_token("bob", "local", None)
        assert database.Users.save_auth_token.call_args.kwargs == {}
        auth_routes._issue_token("bob", "local", None, device="toaster")
        assert database.Users.save_auth_token.call_args.kwargs == {}

    def test_login_passes_the_device(self, client):
        with patch.object(auth_routes, "check_login", return_value="bob"), \
                patch.object(auth_routes, "_issue_token", return_value="tok") as issue:
            database.Users.getUser.return_value = {"username": "bob"}
            res = client.post("/auth/login", json={"username": "bob", "password": "pw", "device": "android"})
        assert res.status_code == 200 and res.json()["auth_token"] == "tok"
        assert issue.call_args.args[3] == "android"

    def test_saved_expiry(self):
        from telestore.db.repositories.users import Users
        repo = Users.__new__(Users)
        db = MagicMock()
        with patch.object(Users, "database", new_callable=PropertyMock, return_value=db):
            repo.save_auth_token("bob", "t", "local", ttl_hours=2160, device="android")
        doc = db.AuthTokens.update_one.call_args.args[1]["$set"]
        assert doc["device"] == "android"
        assert timedelta(days=89) < doc["expires_at"] - datetime.now() <= timedelta(days=90)


class TestSignOutAndExpiry:
    def test_sign_out_ends_the_token_now(self, client):
        state._auth_tokens["tok"] = {"authenticated": True, "username": "bob", "auth_method": "local", "expires_at": datetime.now() + timedelta(days=1)}
        assert client.get("/auth/check", headers={"X-Auth-Token": "tok"}).json()["authenticated"] is True
        client.post("/auth/logout", headers={"X-Auth-Token": "tok"})
        assert "tok" not in state._auth_tokens
        database.Users.get_auth_token.return_value = None
        assert client.get("/auth/check", headers={"X-Auth-Token": "tok"}).json()["authenticated"] is False

    def test_expired_token_stops_working(self, client):
        state._auth_tokens["old"] = {"authenticated": True, "username": "bob", "auth_method": "local", "expires_at": datetime.now() - timedelta(seconds=1)}
        database.Users.get_auth_token.return_value = None
        assert client.get("/auth/check", headers={"X-Auth-Token": "old"}).json()["authenticated"] is False
        assert "old" not in state._auth_tokens


class TestSearch:
    def test_searches_all_folders_but_not_trash_or_vault(self):
        repo = Files.__new__(Files)
        with patch.object(Files, "find", return_value=[]) as find:
            repo.get_files_by_path(path="/Home/Movies", owner_id="42", q="dune (2024)")
        query = find.call_args.args[0]
        assert query["owner_id"] == "42"
        assert query["file_name"] == {"$regex": r"dune\ \(2024\)", "$options": "i"}  # typed text, not a pattern
        assert query["trashed"] == {"$ne": True} and query["is_vault"] == {"$ne": True}
        assert "file_path" in query and "$not" in query["file_path"]

    def test_route_passes_q(self, client):
        app.dependency_overrides[require_auth] = lambda: User(username="bob", telegram_user_id=42)
        try:
            with patch.object(database.Files, "get_files_by_path", return_value=([], 0)) as listing:
                res = client.get("/files", params={"q": "dune", "page": 1, "page_size": 20})
            assert res.status_code == 200
            assert listing.call_args.kwargs["q"] == "dune"
        finally:
            app.dependency_overrides.clear()


class TestOwnMedia:
    def _user(self):
        return User(username="bob", telegram_user_id=42)

    def test_another_users_file_of_the_same_name_is_not_found(self):
        database.Files.find_one.return_value = None
        assert media_routes._find_own_file(self._user(), "movie.mkv", None) is None
        for call in database.Files.find_one.call_args_list:
            assert set(call.args[0]["owner_id"]["$in"]) == {"42", "bob"}

    def test_found_by_id_with_owner(self):
        oid = ObjectId()
        database.Files.find_one.return_value = {"_id": oid, "file_name": "movie.mkv"}
        assert media_routes._find_own_file(self._user(), "movie.mkv", str(oid))["_id"] == oid
        query = database.Files.find_one.call_args_list[0].args[0]
        assert query["_id"] == oid and set(query["owner_id"]["$in"]) == {"42", "bob"}

    def test_session_users_get_their_own_short_token_not_the_admins(self):
        request = MagicMock()
        request.query_params = {}
        request.headers = {}
        token = media_routes._caller_token(request, None, self._user())
        assert state._auth_tokens[token]["username"] == "bob"
        assert state._auth_tokens[token]["expires_at"] > datetime.now()
        database.Users.db.__getitem__.assert_not_called()

    def test_app_token_is_used_as_is(self):
        request = MagicMock()
        request.query_params = {"token": "apptoken"}
        request.headers = {}
        assert media_routes._caller_token(request, None, self._user()) == "apptoken"

    def test_stream_of_someone_elses_file_is_404(self, client):
        state._auth_tokens["tok"] = {"authenticated": True, "username": "bob", "auth_method": "local", "expires_at": datetime.now() + timedelta(days=1)}
        database.Users.getUser.return_value = {"username": "bob", "telegram_user_id": 42}
        database.Files.find_one.return_value = None
        res = client.get("/media/stream/other.mp4", params={"token": "tok"}, follow_redirects=False)
        assert res.status_code == 404

    def test_stream_redirect_carries_the_callers_token_and_file_id(self, client):
        oid = ObjectId()
        state._auth_tokens["tok"] = {"authenticated": True, "username": "bob", "auth_method": "local", "expires_at": datetime.now() + timedelta(days=1)}
        database.Users.getUser.return_value = {"username": "bob", "telegram_user_id": 42}
        database.Files.find_one.return_value = {"_id": oid, "file_name": "clip.mp4"}
        res = client.get("/media/stream/clip.mp4", params={"token": "tok"}, follow_redirects=False)
        assert res.status_code == 307
        assert res.headers["location"] == f"/dl/clip.mp4?inline=1&file_id={oid}&token=tok"


class TestThumbnails:
    def test_missing_thumbnail_is_404(self, client):
        state._auth_tokens["tok"] = {"authenticated": True, "username": "bob", "auth_method": "local", "expires_at": datetime.now() + timedelta(days=1)}
        bot = MagicMock()
        bot.get_least_busy_client.return_value.download_media.side_effect = ValueError("FILE_ID_INVALID")
        app.state.bot_manager = bot
        res = client.get("/files/thumbnail/AAAbad", params={"auth_token": "tok"})
        assert res.status_code == 404

    def test_signed_out_token_cant_load_thumbnails(self, client):
        database.Users.get_auth_token.return_value = None
        res = client.get("/files/thumbnail/AAA", params={"auth_token": "gone"})
        assert res.status_code == 401


class TestCopyVideoArgs:
    def test_only_hevc_gets_the_hvc1_tag(self):
        assert media_routes.copy_video_args({"media_info": {"video_codec": "hevc"}}) == ["-c:v", "copy", "-tag:v", "hvc1"]
        assert media_routes.copy_video_args({"media_info": {"video_codec": "h264"}}) == ["-c:v", "copy"]
        assert media_routes.copy_video_args({}) == ["-c:v", "copy"]
        assert media_routes.copy_video_args(None) == ["-c:v", "copy"]


class TestKindListing:
    def test_all_of_one_kind_matches_type_or_extension(self):
        repo = Files.__new__(Files)
        with patch.object(Files, "find", return_value=[]) as find:
            repo.get_files_by_path(path="all", owner_id="42", kind="video")
        query = find.call_args.args[0]
        assert query["owner_id"] == "42" and query["trashed"] == {"$ne": True}
        assert query["$or"][0] == {"file_type": "video"}
        import re
        pattern = re.compile(query["$or"][1]["file_name"]["$regex"], re.I)
        assert pattern.search("Movie.MKV") and not pattern.search("notes.mkv.txt")

    def test_documents_match_by_extension_only(self):
        repo = Files.__new__(Files)
        with patch.object(Files, "find", return_value=[]) as find:
            repo.get_files_by_path(path="all", owner_id="42", kind="document")
        query = find.call_args.args[0]
        assert "$or" not in query
        import re
        pattern = re.compile(query["file_name"]["$regex"], re.I)
        assert pattern.search("Report.PDF") and not pattern.search("app.apk")

    def test_unknown_kind_is_ignored(self):
        repo = Files.__new__(Files)
        with patch.object(Files, "find", return_value=[]) as find:
            repo.get_files_by_path(path="all", owner_id="42", kind="nonsense")
        assert "$or" not in find.call_args.args[0]

    def test_route_passes_kind(self, client):
        app.dependency_overrides[require_auth] = lambda: User(username="bob", telegram_user_id=42)
        try:
            with patch.object(database.Files, "get_files_by_path", return_value=([], 0)) as listing:
                res = client.get("/files", params={"path": "all", "kind": "photo", "page": 1, "page_size": 50})
            assert res.status_code == 200
            assert listing.call_args.kwargs["kind"] == "photo"
        finally:
            app.dependency_overrides.clear()
