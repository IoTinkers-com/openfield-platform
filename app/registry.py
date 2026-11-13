"""Registro de activos: tipos configurables, enrolamiento, ciclo de vida,
verificación en terreno, baja lógica e historial (ADR-0020/0021/0022).

Las mutaciones van por estos endpoints dedicados; la ingesta (`/ingest`) sigue
siendo solo de creación (ADR-0021). Sin autenticación todavía (D13): H-AUTH.
"""
import copy
import re
from pathlib import Path
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from .assets_domain import (
    REASON_REQUIRED,
    TERMINAL,
    assert_transition,
    apply_verification,
    attr_map,
    compute_verification_status,
    new_doc_id,
    reset_attr_verification,
    active_attrs,
    utcnow_iso,
    validate_attributes,
)
from .config import DEFAULT_TENANT
from .db import SessionLocal
from .models import Document, DocumentRevision
from .revisions import (
    op_applied,
    record_revision,
    restore as restore_doc,
    save_update,
    soft_delete,
)

router = APIRouter()

_STATIC = Path(__file__).parent / "static"

StatusCode = Literal["planned", "in_service", "standby", "out_of_service", "decommissioned"]
AttrType = Literal["text", "number", "boolean", "select", "date"]


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Modelos de entrada (extra=forbid: el cliente no fija estado/verificación/fechas)
# ---------------------------------------------------------------------------


class AttributeDefIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    key: str = Field(min_length=1, max_length=50, pattern=r"^[a-z][a-z0-9_]{0,49}$")
    label: str = Field(min_length=1, max_length=100)
    type: AttrType
    unit: str | None = Field(default=None, max_length=20)
    required: bool = False
    options: list[str] | None = Field(default=None, max_length=100)
    active: bool = True
    order: int = Field(default=0, ge=0)
    verify_in_field: bool = True


class AssetTypeIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tenant_id: str = Field(default=DEFAULT_TENANT, min_length=1, max_length=80)
    id: str | None = Field(default=None, min_length=1, max_length=80)
    name: str = Field(min_length=1, max_length=200)
    equipment_class: str | None = Field(default=None, max_length=100)
    description: str | None = Field(default=None, max_length=2000)
    active: bool = True
    attributes: list[AttributeDefIn] = Field(default_factory=list, max_length=200)


class AssetIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tenant_id: str = Field(default=DEFAULT_TENANT, min_length=1, max_length=80)
    id: str | None = Field(default=None, min_length=1, max_length=80)
    name: str = Field(min_length=1, max_length=200)
    category: str | None = Field(default=None, max_length=100)
    asset_type_id: str | None = Field(default=None, max_length=80)
    status: StatusCode = "in_service"
    reason: str | None = Field(default=None, max_length=500)
    attributes: dict[str, Any] = Field(default_factory=dict)
    tag: str | None = Field(default=None, max_length=100)
    parent_id: str | None = Field(default=None, max_length=80)
    functional_location: str | None = Field(default=None, max_length=200)
    manufacturer: str | None = Field(default=None, max_length=200)
    model: str | None = Field(default=None, max_length=200)
    serial_number: str | None = Field(default=None, max_length=200)
    criticality: Literal["A", "B", "C"] | None = None
    lon: float | None = Field(default=None, ge=-180, le=180)
    lat: float | None = Field(default=None, ge=-90, le=90)
    data_source: Literal["manual", "field", "csv_import"] = "manual"


class AssetPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=200)
    category: str | None = Field(default=None, max_length=100)
    asset_type_id: str | None = Field(default=None, max_length=80)
    attributes: dict[str, Any] | None = None
    parent_id: str | None = Field(default=None, max_length=80)
    functional_location: str | None = Field(default=None, max_length=200)
    manufacturer: str | None = Field(default=None, max_length=200)
    model: str | None = Field(default=None, max_length=200)
    serial_number: str | None = Field(default=None, max_length=200)
    criticality: Literal["A", "B", "C"] | None = None
    lon: float | None = Field(default=None, ge=-180, le=180)
    lat: float | None = Field(default=None, ge=-90, le=90)
    reason: str | None = Field(default=None, max_length=500)


class StatusIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: StatusCode
    reason: str | None = Field(default=None, max_length=500)


class VerifyResultIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    key: str = Field(min_length=1, max_length=50)
    action: Literal["confirm", "correct", "unverifiable"]
    value: Any = None


class VerifyIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    op_id: str | None = Field(default=None, max_length=100)
    session_id: str | None = Field(default=None, max_length=80)
    results: list[VerifyResultIn] = Field(default_factory=list, max_length=200)
    asset_not_found: bool = False
    note: str | None = Field(default=None, max_length=2000)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _get_doc(db: Session, doc_id: str, entity_type: str | None = None) -> Document:
    row = db.get(Document, doc_id)
    if (
        row is None
        or row.deleted_at is not None
        or (entity_type and row.entity_type != entity_type)
    ):
        raise HTTPException(status_code=404, detail="no encontrado")
    return row


def _get_asset(db: Session, asset_id: str) -> Document:
    return _get_doc(db, asset_id, "asset")


def _get_type(db: Session, type_id: str) -> Document:
    return _get_doc(db, type_id, "asset-type")


def _insert_document(
    db: Session,
    doc: dict,
    entity_type: str,
    *,
    action: str = "create",
    source: str = "manual",
    batch_id: str | None = None,
    op_id: str | None = None,
) -> Document:
    row = Document(
        id=doc["id"],
        tenant_id=doc["tenant_id"],
        entity_type=entity_type,
        schema_version=doc.get("schema_version", ""),
        body=doc,
    )
    db.add(row)
    record_revision(
        db, row, action, source, None, copy.deepcopy(doc), batch_id=batch_id, op_id=op_id
    )
    return row


def _new_identifier(tenant_id: str, asset_id: str, value: str, source: str) -> dict:
    return {
        "schema_version": "1.0",
        "tenant_id": tenant_id,
        "id": new_doc_id("ident"),
        "asset_id": asset_id,
        "type": "tag",
        "value": value,
        "source": source,
        "created_at": utcnow_iso(),
    }


def _tag_owner(db: Session, tenant_id: str, tag: str) -> str | None:
    """asset_id dueño de un `tag` dentro del tenant (identificadores no eliminados)."""
    stmt = select(Document).where(
        Document.entity_type == "asset-identifier",
        Document.tenant_id == tenant_id,
        Document.deleted_at.is_(None),
    )
    for row in db.execute(stmt).scalars().all():
        if row.body.get("type") == "tag" and row.body.get("value") == tag:
            return row.body.get("asset_id")
    return None


def _asset_tags(db: Session, tenant_id: str, asset_id: str) -> list[str]:
    stmt = select(Document).where(
        Document.entity_type == "asset-identifier",
        Document.tenant_id == tenant_id,
        Document.deleted_at.is_(None),
    )
    return [
        r.body.get("value")
        for r in db.execute(stmt).scalars().all()
        if r.body.get("asset_id") == asset_id and r.body.get("type") == "tag"
    ]


def _check_no_cycle(db: Session, asset_id: str, parent_id: str | None) -> None:
    seen = {asset_id}
    cur = parent_id
    while cur:
        if cur in seen:
            raise HTTPException(status_code=422, detail="jerarquía cíclica")
        seen.add(cur)
        row = db.get(Document, cur)
        if row is None or row.entity_type != "asset" or row.deleted_at is not None:
            break
        cur = row.body.get("parent_id")


def _has_children(db: Session, tenant_id: str, asset_id: str) -> bool:
    stmt = select(Document).where(
        Document.entity_type == "asset",
        Document.tenant_id == tenant_id,
        Document.deleted_at.is_(None),
    )
    return any(
        r.body.get("parent_id") == asset_id for r in db.execute(stmt).scalars().all()
    )


def _meta(db: Session, row: Document) -> dict:
    return {
        "revision": row.revision,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
        "deleted_at": row.deleted_at.isoformat() if row.deleted_at else None,
        "tags": _asset_tags(db, row.tenant_id, row.id) if row.entity_type == "asset" else [],
    }


def _type_doc_for(db: Session, asset: dict, tenant_id: str) -> dict | None:
    type_id = asset.get("asset_type_id")
    if not type_id:
        return None
    row = db.get(Document, type_id)
    if row is None or row.entity_type != "asset-type" or row.tenant_id != tenant_id:
        return None
    return row.body


# ---------------------------------------------------------------------------
# Panel de administración
# ---------------------------------------------------------------------------


@router.get("/admin/")
def admin_page():
    return FileResponse(_STATIC / "admin.html")


# ---------------------------------------------------------------------------
# Tipos de activo
# ---------------------------------------------------------------------------


def _check_attr_defs(attrs: list[AttributeDefIn]) -> None:
    keys = [a.key for a in attrs]
    if len(set(keys)) != len(keys):
        raise HTTPException(status_code=422, detail="claves de atributo duplicadas")
    for a in attrs:
        if a.type == "select":
            if not a.options:
                raise HTTPException(
                    status_code=422,
                    detail=f"el atributo '{a.key}' es select y exige options",
                )
            for opt in a.options:
                if not opt or len(opt) > 100:
                    raise HTTPException(
                        status_code=422,
                        detail=f"opción inválida en '{a.key}' (máx. 100 caracteres)",
                    )
        elif a.options:
            raise HTTPException(
                status_code=422,
                detail=f"el atributo '{a.key}' no es select y no admite options",
            )


@router.get("/admin/asset-types")
def list_asset_types(
    tenant_id: str = Query(default=DEFAULT_TENANT, max_length=80),
    include_inactive: bool = False,
    db: Session = Depends(get_db),
):
    stmt = select(Document).where(
        Document.entity_type == "asset-type",
        Document.tenant_id == tenant_id,
        Document.deleted_at.is_(None),
    )
    rows = db.execute(stmt).scalars().all()
    docs = [r.body for r in rows]
    if not include_inactive:
        docs = [d for d in docs if d.get("active", True)]
    return docs


@router.post("/admin/asset-types", status_code=201)
def create_asset_type(payload: AssetTypeIn, db: Session = Depends(get_db)):
    _check_attr_defs(payload.attributes)
    doc_id = payload.id or new_doc_id("atype")
    if db.get(Document, doc_id) is not None:
        raise HTTPException(status_code=409, detail="id ya existe")
    now = utcnow_iso()
    attributes = []
    for i, a in enumerate(payload.attributes):
        d = a.model_dump()
        if "order" not in a.model_fields_set:
            d["order"] = i
        attributes.append(d)
    doc = {
        "schema_version": "1.0",
        "tenant_id": payload.tenant_id,
        "id": doc_id,
        "name": payload.name,
        "equipment_class": payload.equipment_class,
        "description": payload.description,
        "active": payload.active,
        "attributes": attributes,
        "created_at": now,
        "updated_at": None,
    }
    _insert_document(db, doc, "asset-type")
    db.commit()
    return doc


@router.get("/admin/asset-types/{type_id}")
def get_asset_type(type_id: str, db: Session = Depends(get_db)):
    return _get_type(db, type_id).body


@router.put("/admin/asset-types/{type_id}")
def update_asset_type(type_id: str, payload: AssetTypeIn, db: Session = Depends(get_db)):
    row = _get_type(db, type_id)
    if payload.tenant_id != row.tenant_id:
        raise HTTPException(status_code=422, detail="tenant_id no coincide")
    _check_attr_defs(payload.attributes)

    # No se permite quitar (ni cambiar el tipo de) un atributo que ya tiene valores.
    used = _used_attribute_keys(db, row.tenant_id, type_id)
    new_keys = {a.key for a in payload.attributes}
    new_types = {a.key: a.type for a in payload.attributes}
    old_types = {a["key"]: a["type"] for a in row.body.get("attributes", [])}
    removed_with_data = used - new_keys
    if removed_with_data:
        raise HTTPException(
            status_code=422,
            detail=(
                "los atributos con datos no se eliminan; desactívalos: "
                + ", ".join(sorted(removed_with_data))
            ),
        )
    changed_type = {
        k for k in used if k in new_types and old_types.get(k) != new_types[k]
    }
    if changed_type:
        raise HTTPException(
            status_code=422,
            detail=(
                "no se puede cambiar el tipo de un atributo con datos: "
                + ", ".join(sorted(changed_type))
            ),
        )

    now = utcnow_iso()
    doc = copy.deepcopy(row.body)
    doc.update(
        {
            "name": payload.name,
            "equipment_class": payload.equipment_class,
            "description": payload.description,
            "active": payload.active,
            "updated_at": now,
        }
    )
    doc["attributes"] = [
        {**a.model_dump(), "order": i if "order" not in a.model_fields_set else a.order}
        for i, a in enumerate(payload.attributes)
    ]
    save_update(db, row, doc, action="update", source="manual")
    db.commit()
    return row.body


def _used_attribute_keys(db: Session, tenant_id: str, type_id: str) -> set:
    stmt = select(Document).where(
        Document.entity_type == "asset",
        Document.tenant_id == tenant_id,
        Document.deleted_at.is_(None),
    )
    used = set()
    for r in db.execute(stmt).scalars().all():
        if r.body.get("asset_type_id") == type_id:
            used |= {k for k, v in (r.body.get("attributes") or {}).items() if v is not None}
    return used


@router.get("/admin/asset-types/{type_id}/csv-template")
def csv_template(type_id: str, db: Session = Depends(get_db)):
    row = _get_type(db, type_id)
    cols = [
        "tag",
        "name",
        "functional_location",
        "parent_tag",
        "manufacturer",
        "model",
        "serial_number",
        "criticality",
        "status",
        "lat",
        "lon",
    ]
    cols += [f"attr:{a['key']}" for a in active_attrs(row.body)]
    content = "\ufeff" + ";".join(cols) + "\r\n"
    slug = re.sub(r"[^a-z0-9]+", "-", (row.body.get("name") or "tipo").lower()).strip("-")
    return Response(
        content=content,
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="plantilla-{slug or "tipo"}.csv"'
        },
    )


# ---------------------------------------------------------------------------
# Activos
# ---------------------------------------------------------------------------


@router.get("/admin/assets")
def list_assets(
    tenant_id: str = Query(default=DEFAULT_TENANT, max_length=80),
    status: str | None = Query(default=None, max_length=30),
    asset_type_id: str | None = Query(default=None, max_length=80),
    verification_status: str | None = Query(default=None, max_length=30),
    import_batch_id: str | None = Query(default=None, max_length=80),
    q: str | None = Query(default=None, max_length=100),
    include_deleted: bool = False,
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
):
    stmt = select(Document).where(
        Document.entity_type == "asset", Document.tenant_id == tenant_id
    )
    if not include_deleted:
        stmt = stmt.where(Document.deleted_at.is_(None))
    rows = db.execute(stmt).scalars().all()

    def keep(r: Document) -> bool:
        b = r.body
        if status and b.get("status") != status:
            return False
        if asset_type_id and b.get("asset_type_id") != asset_type_id:
            return False
        if verification_status and b.get("verification_status") != verification_status:
            return False
        if import_batch_id and b.get("import_batch_id") != import_batch_id:
            return False
        return True

    rows = [r for r in rows if keep(r)]

    if q:
        needle = q.strip().lower()
        rows = [
            r
            for r in rows
            if needle in (r.body.get("name") or "").lower()
            or needle in (r.body.get("serial_number") or "").lower()
            or needle in (r.body.get("functional_location") or "").lower()
            or any(needle in t.lower() for t in _asset_tags(db, tenant_id, r.id))
        ]

    rows.sort(key=lambda r: (r.body.get("name") or "").lower())
    total = len(rows)
    items = [{**r.body, "_meta": _meta(db, r)} for r in rows[offset : offset + limit]]
    return {"items": items, "total": total}


@router.post("/assets", status_code=201)
def create_asset(payload: AssetIn, db: Session = Depends(get_db)):
    doc_id = payload.id or new_doc_id("asset")
    if db.get(Document, doc_id) is not None:
        raise HTTPException(status_code=409, detail="id ya existe")

    type_row = None
    if payload.asset_type_id:
        type_row = _get_type(db, payload.asset_type_id)
        if type_row.tenant_id != payload.tenant_id:
            raise HTTPException(status_code=422, detail="el tipo pertenece a otro tenant")
        try:
            validate_attributes(type_row.body, payload.attributes)
        except ValueError as e:
            raise HTTPException(status_code=422, detail=str(e))

    if payload.status in REASON_REQUIRED and not (payload.reason or "").strip():
        raise HTTPException(status_code=422, detail=f"el estado '{payload.status}' exige un motivo")

    if payload.parent_id:
        parent = _get_asset(db, payload.parent_id)
        if parent.tenant_id != payload.tenant_id:
            raise HTTPException(status_code=422, detail="el padre pertenece a otro tenant")
        _check_no_cycle(db, doc_id, payload.parent_id)

    if (payload.lon is None) != (payload.lat is None):
        raise HTTPException(status_code=422, detail="lon y lat van juntos")

    if payload.tag:
        owner = _tag_owner(db, payload.tenant_id, payload.tag)
        if owner:
            raise HTTPException(status_code=409, detail=f"tag ya asignado a {owner}")

    now = utcnow_iso()
    attributes = dict(payload.attributes)
    av: dict[str, dict] = {}
    type_doc = type_row.body if type_row else None
    for key, value in attributes.items():
        if value is None:
            continue
        verify = True
        if type_doc and key in attr_map(type_doc):
            verify = attr_map(type_doc)[key].get("verify_in_field", True)
        if payload.data_source == "field":
            av[key] = {
                "status": "confirmed",
                "previous_value": None,
                "verified_at": now,
                "session_id": None,
            }
        elif verify:
            av[key] = {
                "status": "pending",
                "previous_value": None,
                "verified_at": None,
                "session_id": None,
            }

    doc = {
        "schema_version": "1.0",
        "tenant_id": payload.tenant_id,
        "id": doc_id,
        "name": payload.name,
        "category": payload.category,
        "location": (
            {"type": "Point", "coordinates": [payload.lon, payload.lat]}
            if payload.lon is not None
            else None
        ),
        "asset_type_id": payload.asset_type_id,
        "status": payload.status,
        "status_reason": payload.reason,
        "status_changed_at": now,
        "attributes": attributes,
        "parent_id": payload.parent_id,
        "functional_location": payload.functional_location,
        "manufacturer": payload.manufacturer,
        "model": payload.model,
        "serial_number": payload.serial_number,
        "criticality": payload.criticality,
        "commissioned_at": now if payload.status == "in_service" else None,
        "decommissioned_at": now if payload.status == "decommissioned" else None,
        "data_source": payload.data_source,
        "import_batch_id": None,
        "verification_status": (
            "verified" if payload.data_source == "field" else "pending"
        ),
        "verified_at": now if payload.data_source == "field" else None,
        "attribute_verification": av,
        "created_at": now,
        "updated_at": None,
    }
    _insert_document(db, doc, "asset")
    if payload.tag:
        ident = _new_identifier(payload.tenant_id, doc_id, payload.tag, "manual")
        _insert_document(db, ident, "asset-identifier")
    db.commit()
    return doc


@router.patch("/assets/{asset_id}")
def update_asset(asset_id: str, payload: AssetPatch, db: Session = Depends(get_db)):
    row = _get_asset(db, asset_id)
    asset = copy.deepcopy(row.body)
    if asset.get("status") in TERMINAL:
        raise HTTPException(status_code=409, detail="activo desincorporado (terminal)")

    fields = payload.model_fields_set
    tenant_id = row.tenant_id

    # Tipo de activo
    type_doc = _type_doc_for(db, asset, tenant_id)
    if "asset_type_id" in fields:
        if payload.asset_type_id is None:
            asset["asset_type_id"] = None
            type_doc = None
        else:
            t = _get_type(db, payload.asset_type_id)
            if t.tenant_id != tenant_id:
                raise HTTPException(status_code=422, detail="el tipo pertenece a otro tenant")
            asset["asset_type_id"] = payload.asset_type_id
            type_doc = t.body

    # Atributos (merge; null borra la clave)
    if "attributes" in fields and payload.attributes is not None:
        merged = dict(asset.get("attributes") or {})
        for k, v in payload.attributes.items():
            if v is None:
                merged.pop(k, None)
            else:
                merged[k] = v
        if type_doc:
            try:
                validate_attributes(type_doc, merged)
            except ValueError as e:
                raise HTTPException(status_code=422, detail=str(e))
        old_attrs = asset.get("attributes") or {}
        for k, v in merged.items():
            if old_attrs.get(k) != v:
                reset_attr_verification(asset, k, old_attrs.get(k))
        for k in set(old_attrs) - set(merged):
            reset_attr_verification(asset, k, old_attrs.get(k))
        asset["attributes"] = merged
        asset["verification_status"] = compute_verification_status(asset, type_doc)
    elif "asset_type_id" in fields and type_doc:
        # Cambió el tipo sin tocar atributos: revalidar lo existente.
        try:
            validate_attributes(type_doc, asset.get("attributes") or {})
        except ValueError as e:
            raise HTTPException(status_code=422, detail=str(e))
        asset["verification_status"] = compute_verification_status(asset, type_doc)

    for f in (
        "name",
        "category",
        "functional_location",
        "manufacturer",
        "model",
        "serial_number",
        "criticality",
    ):
        if f in fields:
            asset[f] = getattr(payload, f)

    if "parent_id" in fields:
        if payload.parent_id:
            parent = _get_asset(db, payload.parent_id)
            if parent.tenant_id != tenant_id:
                raise HTTPException(status_code=422, detail="el padre pertenece a otro tenant")
            _check_no_cycle(db, asset_id, payload.parent_id)
        asset["parent_id"] = payload.parent_id

    if ("lon" in fields) != ("lat" in fields):
        raise HTTPException(status_code=422, detail="lon y lat van juntos")
    if "lon" in fields:
        asset["location"] = (
            {"type": "Point", "coordinates": [payload.lon, payload.lat]}
            if payload.lon is not None
            else None
        )

    asset["updated_at"] = utcnow_iso()
    save_update(
        db, row, asset, action="update", source="manual", reason=payload.reason
    )
    db.commit()
    return row.body


@router.post("/assets/{asset_id}/status")
def change_status(asset_id: str, payload: StatusIn, db: Session = Depends(get_db)):
    row = _get_asset(db, asset_id)
    asset = copy.deepcopy(row.body)
    assert_transition(asset.get("status"), payload.status, payload.reason)
    now = utcnow_iso()
    asset["status"] = payload.status
    asset["status_reason"] = payload.reason
    asset["status_changed_at"] = now
    if payload.status == "in_service" and not asset.get("commissioned_at"):
        asset["commissioned_at"] = now
    if payload.status == "decommissioned":
        asset["decommissioned_at"] = now
    asset["updated_at"] = now
    save_update(
        db, row, asset, action="status", source="manual", reason=payload.reason
    )
    db.commit()
    return row.body


@router.post("/assets/{asset_id}/verify")
def verify_asset(asset_id: str, payload: VerifyIn, db: Session = Depends(get_db)):
    row = _get_asset(db, asset_id)
    if payload.op_id and op_applied(db, payload.op_id):
        return {"status": "already_applied", "asset": row.body}
    asset = copy.deepcopy(row.body)
    if asset.get("status") in TERMINAL:
        raise HTTPException(status_code=409, detail="activo desincorporado (terminal)")

    now = utcnow_iso()
    source = "field" if payload.session_id else "manual"
    if payload.asset_not_found:
        asset["verification_status"] = "not_found"
        asset["updated_at"] = now
    else:
        type_doc = _type_doc_for(db, asset, row.tenant_id)
        try:
            apply_verification(
                asset,
                type_doc,
                [r.model_dump() for r in payload.results],
                session_id=payload.session_id,
                now=now,
            )
        except ValueError as e:
            raise HTTPException(status_code=422, detail=str(e))
    save_update(
        db,
        row,
        asset,
        action="verify",
        source=source,
        reason=payload.note,
        op_id=payload.op_id,
    )
    db.commit()
    return {"status": "applied", "asset": row.body}


@router.delete("/assets/{asset_id}")
def delete_asset(
    asset_id: str,
    reason: str | None = Query(default=None, max_length=500),
    db: Session = Depends(get_db),
):
    row = _get_asset(db, asset_id)
    if _has_children(db, row.tenant_id, asset_id):
        raise HTTPException(
            status_code=409, detail="tiene activos hijos; reasígnalos o elimínalos antes"
        )
    soft_delete(db, row, reason)
    # También se dan de baja sus identificadores (libera el tag para /resolve).
    stmt = select(Document).where(
        Document.entity_type == "asset-identifier",
        Document.deleted_at.is_(None),
    )
    for r in db.execute(stmt).scalars().all():
        if r.body.get("asset_id") == asset_id:
            soft_delete(db, r, reason)
    db.commit()
    return {"status": "deleted"}


# ---------------------------------------------------------------------------
# Restauración e historial (genérico por documento, ADR-0021)
# ---------------------------------------------------------------------------


@router.post("/documents/{doc_id}/restore")
def restore_document(doc_id: str, db: Session = Depends(get_db)):
    row = db.get(Document, doc_id)
    if row is None or row.deleted_at is None:
        raise HTTPException(status_code=404, detail="no encontrado o no eliminado")
    restore_doc(db, row)
    if row.entity_type == "asset":
        stmt = select(Document).where(Document.entity_type == "asset-identifier")
        for r in db.execute(stmt).scalars().all():
            if r.body.get("asset_id") == doc_id and r.deleted_at is not None:
                restore_doc(db, r)
    db.commit()
    return row.body


@router.get("/documents/{doc_id}/history")
def document_history(
    doc_id: str,
    limit: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
):
    if db.get(Document, doc_id) is None:
        raise HTTPException(status_code=404, detail="no encontrado")
    stmt = (
        select(DocumentRevision)
        .where(DocumentRevision.document_id == doc_id)
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
                "before": r.before,
                "after": r.after,
            }
        )
    return out
