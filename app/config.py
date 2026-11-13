"""Configuración de OpenField Platform (agnóstica: SQLite en Maker, PostgreSQL en Pro)."""
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent  # raíz del repo

DATABASE_URL = os.environ.get("DATABASE_URL", f"sqlite:///{BASE_DIR / 'openfield.db'}")
SCHEMAS_DIR = Path(os.environ.get("SCHEMAS_DIR", BASE_DIR / "schemas"))
MEDIA_DIR = Path(os.environ.get("MEDIA_DIR", BASE_DIR / "data" / "media"))

DEFAULT_TENANT = os.environ.get("OPENFIELD_DEFAULT_TENANT", "tenant-001")
MAX_UPLOAD_BYTES = int(os.environ.get("OPENFIELD_MAX_UPLOAD_BYTES", 25 * 1024 * 1024))
MAX_CSV_BYTES = int(os.environ.get("OPENFIELD_MAX_CSV_BYTES", 5 * 1024 * 1024))
MAX_CSV_ROWS = int(os.environ.get("OPENFIELD_MAX_CSV_ROWS", 5000))
