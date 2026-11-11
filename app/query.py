"""Consulta de documentos."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from .db import SessionLocal
from .models import Document

router = APIRouter()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@router.get("/documents")
def list_documents(
    tenant_id: str | None = None,
    entity_type: str | None = None,
    db: Session = Depends(get_db),
):
    stmt = select(Document).order_by(Document.created_at)
    if tenant_id:
        stmt = stmt.where(Document.tenant_id == tenant_id)
    if entity_type:
        stmt = stmt.where(Document.entity_type == entity_type)
    return [row.body for row in db.execute(stmt).scalars().all()]


@router.get("/documents/{doc_id}")
def get_document(doc_id: str, db: Session = Depends(get_db)):
    row = db.get(Document, doc_id)
    if row is None:
        raise HTTPException(status_code=404, detail="no encontrado")
    return row.body
