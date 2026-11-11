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


@router.post("/ingest/{entity_type}", status_code=201)
def ingest(entity_type: str, doc: dict, db: Session = Depends(get_db)):
    if entity_type not in ENTITY_TYPES:
        raise HTTPException(status_code=404, detail=f"entity_type desconocido: {entity_type}")

    # 1) validar contra el esquema canónico (D9)
    try:
        validate(entity_type, doc)
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=f"documento inválido: {exc.message}")

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
