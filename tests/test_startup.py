"""Tests for configuration secret validation and startup guardrails."""

import pytest
from unittest.mock import patch
from src.Config._data import _required_secret


def test_required_secret_missing():
    """Refuse to start if required secret is completely unset or empty."""
    with patch.dict("os.environ", {}, clear=True):
        with pytest.raises(RuntimeError, match="SESSION_SECRET_KEY is not set"):
            _required_secret("SESSION_SECRET_KEY", min_length=32)


def test_required_secret_whitespace_only():
    """Refuse to start if required secret contains only whitespace."""
    with patch.dict("os.environ", {"WORKER_SECRET_KEY": "   "}):
        with pytest.raises(RuntimeError, match="WORKER_SECRET_KEY is not set"):
            _required_secret("WORKER_SECRET_KEY", min_length=24)


def test_required_secret_too_short():
    """Refuse to start if secret length is below minimum requirement."""
    with patch.dict("os.environ", {"SESSION_SECRET_KEY": "too-short"}):
        with pytest.raises(RuntimeError, match="is too weak or still the example value"):
            _required_secret("SESSION_SECRET_KEY", min_length=32)


def test_required_secret_forbidden_placeholder():
    """Refuse to start if secret matches a known default or example placeholder."""
    forbidden = ("f6d2e3b9a0f43d9a2e6a56b2d3175cd9c05bbfe31d95ed2a7306b57cb1a8b6f0",)
    with patch.dict("os.environ", {"SESSION_SECRET_KEY": forbidden[0]}):
        with pytest.raises(RuntimeError, match="is too weak or still the example value"):
            _required_secret("SESSION_SECRET_KEY", min_length=32, forbidden=forbidden)


def test_required_secret_changeme_prefix():
    """Refuse to start if secret starts with 'change-me'."""
    with patch.dict("os.environ", {"DEFAULT_ADMIN_PASSWORD": "change-me-later-123456"}):
        with pytest.raises(RuntimeError, match="is too weak or still the example value"):
            _required_secret("DEFAULT_ADMIN_PASSWORD", min_length=12)


def test_required_secret_valid():
    """Successfully return secret when it meets all strength criteria."""
    valid_secret = "a" * 32
    with patch.dict("os.environ", {"SESSION_SECRET_KEY": valid_secret}):
        result = _required_secret("SESSION_SECRET_KEY", min_length=32)
        assert result == valid_secret
