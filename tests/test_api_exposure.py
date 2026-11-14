"""What the API shows to someone who isn't signed in."""

from unittest.mock import patch

from telestore.services.email_service import generate_otp


def test_the_api_reference_is_not_public(client):
    for path in ("/docs", "/redoc", "/openapi.json"):
        assert client.get(path).status_code == 404


def test_the_worker_list_is_for_the_owner_only(client):
    from telestore.api.app import app
    from telestore.security.credentials import User, require_auth
    assert client.get("/api/worker/nodes").status_code == 401
    app.dependency_overrides[require_auth] = lambda: User(username="family")  # any other signed-in user
    try:
        assert client.get("/api/worker/nodes").status_code == 403
    finally:
        app.dependency_overrides.pop(require_auth, None)


def test_reset_codes_are_six_digits_from_a_secure_source():
    with patch("telestore.services.email_service.secrets.randbelow", return_value=0) as draw:
        assert generate_otp() == "100000"
    draw.assert_called_once_with(900000)
    codes = {generate_otp() for _ in range(200)}
    assert all(len(c) == 6 and c.isdigit() for c in codes) and len(codes) > 150
