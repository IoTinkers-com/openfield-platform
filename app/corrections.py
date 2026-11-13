"""Edición y borrado de capturas (ADR-0021 · ADR-0017).

`PATCH`/`DELETE /documents/{id}` cubren las entidades de captura con lista
blanca de campos editables. Los activos y tipos de activo tienen sus rutas
dedicadas (`/assets`, `/admin`) y responden 409 aquí. Cada mutación guarda
revisión con motivo y admite `op_id` idempotente para reintentos offline.
"""
import copy
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from .assets_domain import TERMINAL
from .db import SessionLocal
from .ingest import _validate_form_response
from .models import Document
from .revisions import op_applied, save_update, soft_delete

router = APIRouter()

# Lista blanca de campos editables por entidad (ADR-0021).
_EDITABLE = {
    "transcript": {"text", "language"},
    "observation": {"type", "value", "unit", "metadata"},
    "form-response": {"values", "completed_by"},
    "media-item": {"asset_id", "metadata"},
    "session": {"operator", "ended_at"},
    "asset-identifier": {"value", "type", "source"},
}

# Entidades de captura borrables de forma lógica por esta ruta.
_DELETABLE = {
    "media-item",
    "observation",
    "transcript",
    "form-response",
    "session",
    "thermal-capture",
    "asset-identifier",
}

_REGISTRY_ENTITIES = {"asset", "asset-type"}


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


class PatchIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    changes: dict[str, Any] = Field(min_length=1, max_length=50)
    reason: str | None = Field(default=None, max_length=500)
    op_id: str | None = Field(default=None, max_length=100)


def _get_doc(db: Session, doc_id: str) -> Document:
    row = db.get(Document, doc_id)
    if row is None:
        raise HTTPException(status_code=404, detail="documento no encontrado")
    return row


def _check_transcript(changes: dict) -> None:
    if "text" in changes:
        text = changes["text"]
        if not isinstance(text, str) or not (1 <= len(text) <= 10000):
            raise HTTPException(status_code=422, detail="text debe tener entre 1 y 10000 caracteres")


def _check_media_item(db: Session, row: Document, changes: dict) -> None:
    if "asset_id" not in changes:
        return
    target = db.get(Document, changes["asset_id"])
    if target is None or target.entity_type != "asset" or target.tenant_id != row.tenant_id:
        raise HTTPException(status_code=409, detail="activo destino no encontrado")
    if target.deleted_at is not None:
        raise HTTPException(status_code=409, detail="activo destino eliminado")
    if target.body.get("status") in TERMINAL:
        raise HTTPException(status_code=409, detail="activo destino desincorporado")


def _check_session(changes: dict, body: dict) -> None:
    if "ended_at" not in changes:
        return
    ended = changes["ended_at"]
    started = body.get("started_at")
    if isinstance(ended, str) and isinstance(started, str) and ended < started:
        raise HTTPException(status_code=422, detail="ended_at no puede ser anterior a started_at")


def _check_identifier(db: Session, row: Document, changes: dict) -> None:
    if "value" not in changes and "type" not in changes:
        return
    new_type = changes.get("type", row.body.get("type"))
    new_value = changes.get("value", row.body.get("value"))
    stmt = select(Document).where(
        Document.entity_type == "asset-identifier",
        Document.tenant_id == row.tenant_id,
        Document.deleted_at.is_(None),
        Document.id != row.id,
    )
    for other in db.execute(stmt).scalars().all():
        if other.body.get("type") == new_type and other.body.get("value") == new_value:
            raise HTTPException(
                status_code=409,
                detail=f"ya existe un identificador {new_type} con valor '{new_value}'",
            )


def _check_form_response(db: Session, row: Document, changes: dict) -> None:
    if "values" not in changes:
        return
    merged = {**row.body, "values": changes["values"]}
    _validate_form_response(db, merged)  # lanza 422 con el detalle


@router.patch("/documents/{doc_id}")
def patch_document(doc_id: str, payload: PatchIn, db: Session = Depends(get_db)):
    row = _get_doc(db, doc_id)

    if payload.op_id and op_applied(db, payload.op_id):
        return {"status": "already_applied", "document": row.body}
    if row.deleted_at is not None:
        raise HTTPException(status_code=409, detail="documento eliminado; restaúralo primero")
    if row.entity_type in _REGISTRY_ENTITIES:
        raise HTTPException(
            status_code=409,
            detail="los activos y tipos se editan por /assets o /admin",
        )
    editable = _EDITABLE.get(row.entity_type)
    if editable is None:
        raise HTTPException(status_code=409, detail=f"{row.entity_type} no es editable por esta ruta")
    for key in payload.changes:
        if key not in editable:
            raise HTTPException(status_code=422, detail=f"campo no editable: {key}")

    if row.entity_type == "transcript":
        _check_transcript(payload.changes)
    elif row.entity_type == "media-item":
        _check_media_item(db, row, payload.changes)
    elif row.entity_type == "session":
        _check_session(payload.changes, row.body)
    elif row.entity_type == "asset-identifier":
        _check_identifier(db, row, payload.changes)
    elif row.entity_type == "form-response":
        _check_form_response(db, row, payload.changes)

    body = copy.deepcopy(row.body)
    body.update(payload.changes)
    save_update(db, row, body, action="update", source="manual", reason=payload.reason, op_id=payload.op_id)
    db.commit()
    return row.body


@router.delete("/documents/{doc_id}")
def delete_document(
    doc_id: str,
    reason: str | None = Query(default=None, max_length=500),
    op_id: str | None = Query(default=None, max_length=100),
    db: Session = Depends(get_db),
):
    row = _get_doc(db, doc_id)

    if op_id and op_applied(db, op_id):
        return {"status": "already_applied"}
    if row.deleted_at is not None:
        raise HTTPException(status_code=409, detail="documento ya eliminado")
    if row.entity_type in _REGISTRY_ENTITIES:
        raise HTTPException(
            status_code=409,
            detail="los activos y tipos se eliminan por sus rutas dedicadas",
        )
    if row.entity_type not in _DELETABLE:
        raise HTTPException(status_code=409, detail=f"{row.entity_type} no se puede eliminar")

    soft_delete(db, row, reason, source="manual")
    db.commit()
    return {"status": "deleted", "id": doc_id}
