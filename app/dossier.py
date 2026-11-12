"""Presentación centrada en el activo (D19 · ADR-0019): expediente de un Asset y vista de
Session. Agregación de LECTURA sobre los documentos ya ingeridos en la tabla `documents`;
no cambia el contrato de datos (`04-esquemas/`).

Content negotiation por encabezado `Accept` en la MISMA ruta (sin introducir un prefijo
`/api` ni un framework de frontend, D8 · ADR-0018):
- Navegación de un navegador (`Accept: text/html, ...`) recibe la vista HTML.
- `fetch()`/clientes JSON (`Accept: */*` o `application/json`, sin `text/html`) reciben el
  expediente agregado en JSON.
"""
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from .db import SessionLocal
from .models import Document

router = APIRouter()

_STATIC = Path(__file__).parent / "static"


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def wants_html(request: Request) -> bool:
    return "text/html" in request.headers.get("accept", "")


def _by_entity(db: Session, entity_type: str, tenant_id: str) -> list[dict]:
    stmt = select(Document).where(Document.entity_type == entity_type, Document.tenant_id == tenant_id)
    return [row.body for row in db.execute(stmt).scalars().all()]


def _asset_dossier(db: Session, asset_id: str) -> dict:
    asset_row = db.get(Document, asset_id)
    if asset_row is None or asset_row.entity_type != "asset":
        raise HTTPException(status_code=404, detail="activo no encontrado")
    tenant_id = asset_row.tenant_id

    identifiers = [d for d in _by_entity(db, "asset-identifier", tenant_id) if d.get("asset_id") == asset_id]
    sessions = [d for d in _by_entity(db, "session", tenant_id) if d.get("asset_id") == asset_id]
    session_ids = {s["id"] for s in sessions}

    def related(entity_type: str) -> list[dict]:
        return [
            d
            for d in _by_entity(db, entity_type, tenant_id)
            if d.get("asset_id") == asset_id or d.get("session_id") in session_ids
        ]

    media_items = related("media-item")
    media_ids = {m["id"] for m in media_items}
    thermal_captures = [d for d in _by_entity(db, "thermal-capture", tenant_id) if d.get("media_item_id") in media_ids]

    return {
        "asset": asset_row.body,
        "identifiers": identifiers,
        "sessions": sessions,
        "media_items": media_items,
        "observations": related("observation"),
        "transcripts": related("transcript"),
        "form_responses": related("form-response"),
        "thermal_captures": thermal_captures,
    }


def _session_dossier(db: Session, session_id: str) -> dict:
    session_row = db.get(Document, session_id)
    if session_row is None or session_row.entity_type != "session":
        raise HTTPException(status_code=404, detail="sesión no encontrada")
    tenant_id = session_row.tenant_id
    session = session_row.body

    asset_summary = None
    asset_id = session.get("asset_id")
    if asset_id:
        asset_row = db.get(Document, asset_id)
        if asset_row is not None and asset_row.entity_type == "asset":
            asset_summary = {"id": asset_row.body["id"], "name": asset_row.body.get("name")}

    def related(entity_type: str) -> list[dict]:
        return [d for d in _by_entity(db, entity_type, tenant_id) if d.get("session_id") == session_id]

    return {
        "session": session,
        "asset": asset_summary,
        "media_items": related("media-item"),
        "observations": related("observation"),
        "transcripts": related("transcript"),
    }


@router.get("/assets/{asset_id}")
def asset_view_or_dossier(asset_id: str, request: Request, db: Session = Depends(get_db)):
    data = _asset_dossier(db, asset_id)
    if wants_html(request):
        return FileResponse(_STATIC / "asset.html")
    return data


@router.get("/sessions/{session_id}")
def session_view_or_dossier(session_id: str, request: Request, db: Session = Depends(get_db)):
    data = _session_dossier(db, session_id)
    if wants_html(request):
        return FileResponse(_STATIC / "session.html")
    return data
