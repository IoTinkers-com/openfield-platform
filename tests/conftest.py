"""Fixtures de prueba: SQLite en un directorio temporal."""
import os
import pathlib
import tempfile

import pytest

_TMP = pathlib.Path(tempfile.mkdtemp(prefix="openfield-test-"))
os.environ["DATABASE_URL"] = f"sqlite:///{_TMP / 'test.db'}"
os.environ["MEDIA_DIR"] = str(_TMP / "media")

from fastapi.testclient import TestClient  # noqa: E402

from app import main  # noqa: E402


@pytest.fixture(scope="session")
def client():
    with TestClient(main.app) as c:
        yield c
