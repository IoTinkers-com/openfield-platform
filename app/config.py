"""Configuración de OpenField Platform (agnóstica: SQLite en Maker, PostgreSQL en Pro)."""
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent  # raíz del repo

DATABASE_URL = os.environ.get("DATABASE_URL", f"sqlite:///{BASE_DIR / 'openfield.db'}")
SCHEMAS_DIR = Path(os.environ.get("SCHEMAS_DIR", BASE_DIR / "schemas"))
MEDIA_DIR = Path(os.environ.get("MEDIA_DIR", BASE_DIR / "data" / "media"))
