"""What the API shows to someone who isn't signed in."""

from unittest.mock import patch

from telestore.services.email_service import generate_otp


def test_the_api_reference_is_not_public(client):
    for path in ("/docs", "/redoc", "/openapi.json"):
        assert client.get(path).status_code == 404


def test_the_worker_list_needs_an_admin(client):
    assert client.get("/api/worker/nodes").status_code == 401
    with patch("telestore.security.credentials.is_authenticated", return_value=True), \
            patch("telestore.security.credentials.is_admin", return_value=False):
        assert client.get("/api/worker/nodes").status_code == 403


def test_reset_codes_are_six_digits_from_a_secure_source():
    with patch("telestore.services.email_service.secrets.randbelow", return_value=0) as draw:
        assert generate_otp() == "100000"
    draw.assert_called_once_with(900000)
    codes = {generate_otp() for _ in range(200)}
    assert all(len(c) == 6 and c.isdigit() for c in codes) and len(codes) > 150
