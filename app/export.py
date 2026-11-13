"""Export STAC + OGC API Features (lectura, D9 · ADR-0009).

Cada `media-item` se expone como STAC Item (id, geometry, datetime, assets) y como
GeoJSON Feature de OGC API Features. Implementación ligera de solo lectura; para escala
Pro se puede sustituir por pgSTAC + pygeoapi sin cambiar el contrato.
"""
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


def _bbox(geometry):
    if not geometry or geometry.get("type") != "Point":
        return None
    lon, lat = geometry["coordinates"]
    return [lon, lat, lon, lat]


def _stac_assets(doc):
    """Convierte assets del esquema ({media_type}) a STAC ({type})."""
    out = {}
    for key, asset in (doc.get("assets") or {}).items():
        out[key] = {
            "href": asset.get("href"),
            "type": asset.get("media_type"),
            "roles": asset.get("roles") or [],
        }
    return out


def to_stac_item(doc):
    return {
        "type": "Feature",
        "stac_version": "1.0.0",
        "stac_extensions": [],
        "id": doc["id"],
        "geometry": doc.get("geometry"),
        "bbox": _bbox(doc.get("geometry")),
        "properties": {"datetime": doc.get("captured_at")},
        "assets": _stac_assets(doc),
        "collection": "media-item",
        "links": [
            {"rel": "self", "href": f"/stac/items/{doc['id']}"},
            {"rel": "root", "href": "/stac"},
            {"rel": "collection", "href": "/stac/collections/media-item"},
        ],
    }


def to_feature(doc):
    props = {k: v for k, v in doc.items() if k not in ("geometry", "id")}
    props.pop("type", None)  # "type" en GeoJSON es "Feature"; el tipo de medio se preserva abajo
    props["media_type"] = doc.get("type")
    props["datetime"] = doc.get("captured_at")
    return {
        "type": "Feature",
        "id": doc["id"],
        "geometry": doc.get("geometry"),
        "properties": props,
    }


@router.get("/stac")
def stac_root():
    return {
        "type": "Catalog",
        "stac_version": "1.0.0",
        "id": "openfield",
        "description": "Catálogo STAC de OpenField (lectura)",
        "links": [{"rel": "root", "href": "/stac"}],
    }


@router.get("/stac/items")
def stac_items(tenant_id: str | None = None, db: Session = Depends(get_db)):
    stmt = select(Document).where(
        Document.entity_type == "media-item", Document.deleted_at.is_(None)
    )
    if tenant_id:
        stmt = stmt.where(Document.tenant_id == tenant_id)
    rows = db.execute(stmt).scalars().all()
    return {"type": "FeatureCollection", "features": [to_stac_item(r.body) for r in rows]}


@router.get("/stac/items/{doc_id}")
def stac_item(doc_id: str, db: Session = Depends(get_db)):
    row = db.get(Document, doc_id)
    if row is None or row.entity_type != "media-item" or row.deleted_at is not None:
        raise HTTPException(status_code=404, detail="no encontrado")
    return to_stac_item(row.body)


@router.get("/collections")
def collections():
    return {
        "collections": [
            {
                "id": "media-item",
                "title": "Medios capturados",
                "description": "MediaItems de OpenField",
                "itemType": "feature",
            }
        ],
        "links": [{"rel": "self", "href": "/collections"}],
    }


@router.get("/collections/media-item/items")
def collection_items(tenant_id: str | None = None, db: Session = Depends(get_db)):
    stmt = select(Document).where(
        Document.entity_type == "media-item", Document.deleted_at.is_(None)
    )
    if tenant_id:
        stmt = stmt.where(Document.tenant_id == tenant_id)
    rows = db.execute(stmt).scalars().all()
    return {"type": "FeatureCollection", "features": [to_feature(r.body) for r in rows]}
