"""Modelos ORM."""
import datetime

from sqlalchemy import JSON, Column, DateTime, Integer, String

from .db import Base


def _utcnow():
    return datetime.datetime.now(datetime.timezone.utc)


class Document(Base):
    """Documento canónico ingerido (validado contra JSON Schema)."""

    __tablename__ = "documents"

    id = Column(String, primary_key=True)
    tenant_id = Column(String, nullable=False, index=True)
    entity_type = Column(String, nullable=False, index=True)
    schema_version = Column(String, nullable=False)
    body = Column(JSON, nullable=False)
    created_at = Column(DateTime(timezone=True), default=_utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), nullable=True)
    deleted_at = Column(DateTime(timezone=True), nullable=True, index=True)
    revision = Column(Integer, nullable=False, default=1, server_default="1")


class DocumentRevision(Base):
    """Historial de cambios de un documento (ADR-0021): antes/después por acción."""

    __tablename__ = "document_revisions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    document_id = Column(String, nullable=False, index=True)
    tenant_id = Column(String, nullable=False, index=True)
    entity_type = Column(String, nullable=False)
    revision = Column(Integer, nullable=False)
    action = Column(String, nullable=False)  # create|update|status|verify|delete|restore|import
    source = Column(String, nullable=False)  # manual|csv_import|field|api
    batch_id = Column(String, nullable=True, index=True)
    op_id = Column(String, nullable=True, unique=True)  # idempotencia de reintentos (ADR-0021)
    reason = Column(String, nullable=True)
    actor = Column(String, nullable=False, default="admin")
    before = Column(JSON, nullable=True)
    after = Column(JSON, nullable=True)
    created_at = Column(DateTime(timezone=True), default=_utcnow, nullable=False)


class ImportBatch(Base):
    """Lote de importación CSV de activos (ADR-0022)."""

    __tablename__ = "import_batches"

    id = Column(String, primary_key=True)
    tenant_id = Column(String, nullable=False, index=True)
    asset_type_id = Column(String, nullable=True)
    filename = Column(String, nullable=True)
    rows_total = Column(Integer, nullable=False, default=0)
    created = Column(Integer, nullable=False, default=0)
    updated = Column(Integer, nullable=False, default=0)
    unchanged = Column(Integer, nullable=False, default=0)
    errors = Column(Integer, nullable=False, default=0)
    conflicts = Column(Integer, nullable=False, default=0)
    report = Column(JSON, nullable=True)
    created_at = Column(DateTime(timezone=True), default=_utcnow, nullable=False)
