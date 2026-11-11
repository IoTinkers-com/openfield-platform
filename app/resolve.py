"""Resolución de identificadores (QR/TAG/OCR) al Asset canónico (D3 · ADR-0017)."""
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


@router.get("/resolve")
def resolve(value: str, db: Session = Depends(get_db)):
    stmt = select(Document).where(Document.entity_type == "asset-identifier")
    matches = [r.body for r in db.execute(stmt).scalars().all() if r.body.get("value") == value]
    if not matches:
        raise HTTPException(status_code=404, detail="identificador no encontrado")
    result = []
    for ident in matches:
        asset_id = ident.get("asset_id")
        asset_row = db.get(Document, asset_id) if asset_id else None
        result.append(
            {
                "asset_id": asset_id,
                "identifier_type": ident.get("type"),
                "identifier_value": ident.get("value"),
                "asset": asset_row.body if asset_row and asset_row.entity_type == "asset" else None,
            }
        )
    return result
