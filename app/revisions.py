"""Historial de revisiones y baja lógica (ADR-0021).

Toda mutación pasa por aquí: valida contra el esquema, sube `revision`, fija las
fechas del servidor y registra antes/después en `document_revisions`. Ninguna de
estas funciones hace `commit`: lo hace el endpoint.
"""
import copy
import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import Document, DocumentRevision
from .schemas_loader import validate as validate_schema


def _utcnow():
    return datetime.datetime.now(datetime.timezone.utc)


def record_revision(
    db: Session,
    row: Document,
    action: str,
    source: str,
    before,
    after,
    *,
    reason: str | None = None,
    batch_id: str | None = None,
    op_id: str | None = None,
    actor: str = "admin",
) -> None:
    db.add(
        DocumentRevision(
            document_id=row.id,
            tenant_id=row.tenant_id,
            entity_type=row.entity_type,
            revision=row.revision or 1,
            action=action,
            source=source,
            batch_id=batch_id,
            op_id=op_id,
            reason=reason,
            actor=actor,
            before=before,
            after=after,
        )
    )


def op_applied(db: Session, op_id: str | None) -> bool:
    """True si ya existe una revisión con este `op_id` (idempotencia de reintentos)."""
    if not op_id:
        return False
    stmt = select(DocumentRevision.id).where(DocumentRevision.op_id == op_id)
    return db.execute(stmt).first() is not None


def save_update(
    db: Session,
    row: Document,
    new_body: dict,
    *,
    action: str,
    source: str,
    reason: str | None = None,
    batch_id: str | None = None,
    op_id: str | None = None,
) -> None:
    """Valida `new_body` contra el esquema, lo guarda y registra la revisión."""
    validate_schema(row.entity_type, new_body)
    before = copy.deepcopy(row.body)
    row.body = new_body
    row.revision = (row.revision or 0) + 1
    row.updated_at = _utcnow()
    record_revision(
        db,
        row,
        action,
        source,
        before,
        copy.deepcopy(new_body),
        reason=reason,
        batch_id=batch_id,
        op_id=op_id,
    )


def soft_delete(db: Session, row: Document, reason: str | None = None, *, source: str = "manual") -> None:
    before = copy.deepcopy(row.body)
    row.deleted_at = _utcnow()
    row.revision = (row.revision or 0) + 1
    row.updated_at = _utcnow()
    record_revision(db, row, "delete", source, before, copy.deepcopy(row.body), reason=reason)


def restore(db: Session, row: Document, *, source: str = "manual") -> None:
    before = copy.deepcopy(row.body)
    row.deleted_at = None
    row.revision = (row.revision or 0) + 1
    row.updated_at = _utcnow()
    record_revision(db, row, "restore", source, before, copy.deepcopy(row.body))
