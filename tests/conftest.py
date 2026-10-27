from pathlib import Path

import pytest

import api.recordings as recordings


@pytest.fixture(autouse=True)
def isolated_recordings_dir(tmp_path: Path, monkeypatch):
    """Every test writes recordings to its own temporary folder, never to instance/recordings."""
    monkeypatch.setattr(recordings, "RECORDINGS_DIR", tmp_path / "recordings")
