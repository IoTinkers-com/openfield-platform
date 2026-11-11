"""Ingesta: validación contra esquema, tenant_id obligatorio, dedupe por id."""
from fastapi import APIRouter, Depends, HTTPException
from jsonschema import ValidationError
from sqlalchemy.orm import Session

from .db import SessionLocal
from .models import Document
from .schemas_loader import ENTITY_TYPES, validate

router = APIRouter()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _check_field_type(field: dict, value) -> bool:
    t = field.get("type")
    if t == "number":
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    if t == "boolean":
        return isinstance(value, bool)
    if t == "text":
        return isinstance(value, str)
    if t == "select":
        if not isinstance(value, str):
            return False
        options = field.get("options")
        return not options or value in options
    if t == "checklist":
        return isinstance(value, list) and all(isinstance(x, str) for x in value)
    if t in ("photo", "thermal"):
        return isinstance(value, str)
    return True


def _validate_form_response(db: Session, doc: dict):
    """Valida una form-response contra su plantilla (D6 · ADR-0006)."""
    template_id = doc.get("template_id")
    if not template_id:
        raise HTTPException(status_code=422, detail="falta 'template_id'")
    row = db.get(Document, template_id)
    if row is None or row.entity_type != "form-template":
        raise HTTPException(status_code=422, detail=f"plantilla no encontrada: {template_id}")
    fields = {f["key"]: f for f in row.body.get("fields", [])}
    values = doc.get("values") or {}
    for key in values:
        if key not in fields:
            raise HTTPException(status_code=422, detail=f"campo desconocido: {key}")
    for key, field in fields.items():
        if field.get("required") and key not in values:
            raise HTTPException(status_code=422, detail=f"campo requerido faltante: {key}")
    for key, value in values.items():
        if not _check_field_type(fields[key], value):
            raise HTTPException(status_code=422, detail=f"tipo inválido para el campo '{key}'")


@router.post("/ingest/{entity_type}", status_code=201)
def ingest(entity_type: str, doc: dict, db: Session = Depends(get_db)):
    if entity_type not in ENTITY_TYPES:
        raise HTTPException(status_code=404, detail=f"entity_type desconocido: {entity_type}")

    # 1) validar contra el esquema canónico (D9)
    try:
        validate(entity_type, doc)
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=f"documento inválido: {exc.message}")

    # 1b) validación cruzada: form-response contra su plantilla (D6 · ADR-0006)
    if entity_type == "form-response":
        _validate_form_response(db, doc)

    # 2) defensa en profundidad: id y tenant_id obligatorios (D13)
    doc_id = doc.get("id")
    tenant_id = doc.get("tenant_id")
    if not doc_id:
        raise HTTPException(status_code=422, detail="falta 'id'")
    if not tenant_id:
        raise HTTPException(status_code=422, detail="falta 'tenant_id'")

    # 3) dedupe por id (idempotente, D4)
    if db.get(Document, doc_id) is not None:
        return {"status": "already_exists", "id": doc_id}

    db.add(
        Document(
            id=doc_id,
            tenant_id=tenant_id,
            entity_type=entity_type,
            schema_version=doc.get("schema_version", ""),
            body=doc,
        )
    )
    db.commit()
    return {"status": "created", "id": doc_id}
