import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")


@pytest.fixture(autouse=True)
def home(tmp_path, monkeypatch):
    """Each test keeps the app's data in its own folder."""
    monkeypatch.setenv("TELESTORE_DESKTOP_HOME", str(tmp_path / "appdata"))
    return tmp_path
