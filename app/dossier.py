"""Presentación centrada en el activo (D19 · ADR-0019): expediente de un Asset y vista de
Session. Agregación de LECTURA sobre los documentos ya ingeridos en la tabla `documents`;
no cambia el contrato de datos (`04-esquemas/`).

Content negotiation por encabezado `Accept` en la MISMA ruta (sin introducir un prefijo
`/api` ni un framework de frontend, D8 · ADR-0018):
- Navegación de un navegador (`Accept: text/html, ...`) recibe la vista HTML.
- `fetch()`/clientes JSON (`Accept: */*` o `application/json`, sin `text/html`) reciben el
  expediente agregado en JSON.

Las respuestas llevan `Vary: Accept` y `Cache-Control: no-store` para que ninguna caché
entregue la representación equivocada o un expediente obsoleto.
Los documentos eliminados (baja lógica, ADR-0021) quedan fuera del expediente.
"""
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from .db import SessionLocal
from .models import Document, DocumentRevision

router = APIRouter()

_STATIC = Path(__file__).parent / "static"
_HEADERS = {"Vary": "Accept", "Cache-Control": "no-store"}


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def wants_html(request: Request) -> bool:
    return "text/html" in request.headers.get("accept", "")


def _by_entity(db: Session, entity_type: str, tenant_id: str, include_deleted: bool = False) -> list[dict]:
    stmt = select(Document).where(
        Document.entity_type == entity_type,
        Document.tenant_id == tenant_id,
    )
    if not include_deleted:
        stmt = stmt.where(Document.deleted_at.is_(None))
    out = []
    for row in db.execute(stmt).scalars().all():
        if row.deleted_at is None:
            out.append(row.body)
        else:
            out.append({**row.body, "_deleted_at": row.deleted_at.isoformat()})
    return out


def _history(db: Session, document_id: str, limit: int = 50) -> list[dict]:
    stmt = (
        select(DocumentRevision)
        .where(DocumentRevision.document_id == document_id)
        .order_by(DocumentRevision.revision.desc())
        .limit(limit)
    )
    out = []
    for r in db.execute(stmt).scalars().all():
        before = r.before or {}
        after = r.after or {}
        changed = sorted(
            k
            for k in set(before) | set(after)
            if before.get(k, object()) != after.get(k, object())
        )
        out.append(
            {
                "revision": r.revision,
                "action": r.action,
                "source": r.source,
                "batch_id": r.batch_id,
                "reason": r.reason,
                "actor": r.actor,
                "created_at": r.created_at.isoformat() if r.created_at else None,
                "changed_keys": changed,
            }
        )
    return out


def _asset_dossier(db: Session, asset_id: str, include_deleted: bool = False) -> dict:
    asset_row = db.get(Document, asset_id)
    if (
        asset_row is None
        or asset_row.entity_type != "asset"
        or asset_row.deleted_at is not None
    ):
        raise HTTPException(status_code=404, detail="activo no encontrado")
    tenant_id = asset_row.tenant_id
    asset = asset_row.body

    identifiers = [d for d in _by_entity(db, "asset-identifier", tenant_id, include_deleted) if d.get("asset_id") == asset_id]
    sessions = [d for d in _by_entity(db, "session", tenant_id, include_deleted) if d.get("asset_id") == asset_id]
    session_ids = {s["id"] for s in sessions}

    def related(entity_type: str) -> list[dict]:
        return [
            d
            for d in _by_entity(db, entity_type, tenant_id, include_deleted)
            if d.get("asset_id") == asset_id or d.get("session_id") in session_ids
        ]

    media_items = related("media-item")
    media_ids = {m["id"] for m in media_items}
    thermal_captures = [d for d in _by_entity(db, "thermal-capture", tenant_id, include_deleted) if d.get("media_item_id") in media_ids]

    # Tipo de activo, padre e hijos (ADR-0020).
    asset_type = None
    type_id = asset.get("asset_type_id")
    if type_id:
        type_row = db.get(Document, type_id)
        if type_row is not None and type_row.entity_type == "asset-type":
            asset_type = type_row.body

    parent = None
    parent_id = asset.get("parent_id")
    if parent_id:
        parent_row = db.get(Document, parent_id)
        if (
            parent_row is not None
            and parent_row.entity_type == "asset"
            and parent_row.deleted_at is None
        ):
            parent = {"id": parent_row.body["id"], "name": parent_row.body.get("name")}

    children = [
        {"id": d["id"], "name": d.get("name"), "status": d.get("status")}
        for d in _by_entity(db, "asset", tenant_id)
        if d.get("parent_id") == asset_id
    ]

    return {
        "asset": asset,
        "asset_type": asset_type,
        "parent": parent,
        "children": children,
        "identifiers": identifiers,
        "sessions": sessions,
        "media_items": media_items,
        "observations": related("observation"),
        "transcripts": related("transcript"),
        "form_responses": related("form-response"),
        "thermal_captures": thermal_captures,
        "history": _history(db, asset_id),
    }


def _session_dossier(db: Session, session_id: str, include_deleted: bool = False) -> dict:
    session_row = db.get(Document, session_id)
    if (
        session_row is None
        or session_row.entity_type != "session"
        or session_row.deleted_at is not None
    ):
        raise HTTPException(status_code=404, detail="sesión no encontrada")
    tenant_id = session_row.tenant_id
    session = session_row.body

    asset_summary = None
    asset_id = session.get("asset_id")
    if asset_id:
        asset_row = db.get(Document, asset_id)
        if (
            asset_row is not None
            and asset_row.entity_type == "asset"
            and asset_row.deleted_at is None
        ):
            asset_summary = {"id": asset_row.body["id"], "name": asset_row.body.get("name")}

    def related(entity_type: str) -> list[dict]:
        return [d for d in _by_entity(db, entity_type, tenant_id, include_deleted) if d.get("session_id") == session_id]

    return {
        "session": session,
        "asset": asset_summary,
        "media_items": related("media-item"),
        "observations": related("observation"),
        "transcripts": related("transcript"),
    }


@router.get("/assets/{asset_id}")
def asset_view_or_dossier(
    asset_id: str,
    request: Request,
    include_deleted: bool = False,
    db: Session = Depends(get_db),
):
    data = _asset_dossier(db, asset_id, include_deleted)
    if wants_html(request):
        return FileResponse(_STATIC / "asset.html", headers=_HEADERS)
    return JSONResponse(data, headers=_HEADERS)


@router.get("/sessions/{session_id}")
def session_view_or_dossier(
    session_id: str,
    request: Request,
    include_deleted: bool = False,
    db: Session = Depends(get_db),
):
    data = _session_dossier(db, session_id, include_deleted)
    if wants_html(request):
        return FileResponse(_STATIC / "session.html", headers=_HEADERS)
    return JSONResponse(data, headers=_HEADERS)
