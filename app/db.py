"""Conexión a base de datos."""
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import declarative_base, sessionmaker

from .config import DATABASE_URL

_connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}

engine = create_engine(DATABASE_URL, connect_args=_connect_args)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
Base = declarative_base()

# Columnas añadidas a `documents` en la Tanda A de gestión de activos (ADR-0021).
# Migración idempotente hasta que exista Alembic (H-ALEMBIC).
_DOCUMENTS_NEW_COLUMNS = {
    "updated_at": "updated_at {ts}",
    "deleted_at": "deleted_at {ts}",
    "revision": "revision INTEGER NOT NULL DEFAULT 1",
}


def _migrate(eng):
    """Aplica los ALTER TABLE que falten en `documents`. Idempotente."""
    ts = "TIMESTAMP" if eng.dialect.name == "sqlite" else "TIMESTAMP WITH TIME ZONE"
    existing = {c["name"] for c in inspect(eng).get_columns("documents")}
    with eng.begin() as conn:
        for name, ddl in _DOCUMENTS_NEW_COLUMNS.items():
            if name not in existing:
                conn.execute(text(f"ALTER TABLE documents ADD COLUMN {ddl.format(ts=ts)}"))


def init_db():
    from . import models  # noqa: F401  # registra los modelos

    Base.metadata.create_all(bind=engine)
    _migrate(engine)
