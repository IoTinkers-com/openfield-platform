"""Migración idempotente de `documents` (ADR-0021): columnas nuevas por ALTER."""
import sqlalchemy

from app.db import _migrate


def test_migrate_adds_columns(tmp_path):
    url = f"sqlite:///{tmp_path / 'old.db'}"
    eng = sqlalchemy.create_engine(url)
    with eng.begin() as conn:
        conn.execute(sqlalchemy.text(
            "CREATE TABLE documents (id VARCHAR PRIMARY KEY, tenant_id VARCHAR NOT NULL,"
            " entity_type VARCHAR NOT NULL, schema_version VARCHAR NOT NULL,"
            " body JSON NOT NULL, created_at TIMESTAMP NOT NULL)"
        ))
    _migrate(eng)
    cols = {c["name"] for c in sqlalchemy.inspect(eng).get_columns("documents")}
    assert {"updated_at", "deleted_at", "revision"} <= cols
    # idempotente: segunda ejecución no falla
    _migrate(eng)
