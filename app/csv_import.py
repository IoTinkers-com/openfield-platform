"""Importación de activos por CSV con vista previa (dry-run) y verificación (ADR-0022).

Reglas clave:
- dry_run por defecto (la vista previa no escribe nada);
- emparejamiento por TAG (o `serial_number`); celda vacía = "sin cambio";
- re-import idempotente; nunca pisa atributos `confirmed`/`corrected` (conflicto);
- activos `decommissioned` o eliminados no se actualizan por CSV.
"""
import copy
import csv
import io

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session

from .assets_domain import (
    STATUSES,
    STATUS_LABELS_ES,
    TERMINAL,
    active_attrs,
    assert_transition,
    compute_verification_status,
    new_doc_id,
    parse_value,
    reset_attr_verification,
    utcnow_iso,
)
from .config import DEFAULT_TENANT, MAX_CSV_BYTES, MAX_CSV_ROWS
from .db import SessionLocal
from .models import Document, ImportBatch
from .registry import _insert_document, _new_identifier
from .revisions import save_update

router = APIRouter()

BASE_COLUMNS = {
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
}
CRITICALITIES = {"A", "B", "C"}
_STATUS_BY_LABEL = {v.lower(): k for k, v in STATUS_LABELS_ES.items()}


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _parse_status(raw: str):
    s = raw.strip().lower()
    if s in STATUSES:
        return s
    return _STATUS_BY_LABEL.get(s)


def _decode(raw: bytes) -> tuple[str, str]:
    try:
        return raw.decode("utf-8-sig"), "utf-8"
    except UnicodeDecodeError:
        return raw.decode("latin-1"), "latin-1"


def _num(raw: str, column: str):
    s = raw.strip().replace(",", ".") if ("," in raw and "." not in raw) else raw.strip()
    try:
        return float(s)
    except ValueError:
        raise ValueError(f"'{raw}' no es un número en {column}") from None


@router.post("/admin/assets/import")
async def import_assets(
    file: UploadFile = File(...),
    asset_type_id: str = Form(..., max_length=80),
    tenant_id: str = Form(DEFAULT_TENANT, max_length=80),
    dry_run: bool = Form(True),
    db: Session = Depends(get_db),
):
    type_row = db.get(Document, asset_type_id)
    if (
        type_row is None
        or type_row.entity_type != "asset-type"
        or type_row.tenant_id != tenant_id
        or type_row.deleted_at is not None
    ):
        raise HTTPException(status_code=404, detail="tipo de activo no encontrado")
    type_doc = type_row.body
    attr_defs = {a["key"]: a for a in active_attrs(type_doc)}

    raw = await file.read()
    if len(raw) > MAX_CSV_BYTES:
        raise HTTPException(status_code=413, detail="archivo demasiado grande (máx. 5 MB)")
    text, encoding = _decode(raw)

    try:
        delimiter = csv.Sniffer().sniff(text[:8192], delimiters=";,").delimiter
    except csv.Error:
        delimiter = ";"
    reader = csv.DictReader(io.StringIO(text), delimiter=delimiter)
    headers = {(h or "").strip().lower() for h in (reader.fieldnames or [])}

    if "name" not in headers or not ({"tag", "serial_number"} & headers):
        raise HTTPException(
            status_code=422,
            detail="el CSV debe incluir la columna 'name' y al menos 'tag' o 'serial_number'",
        )

    known = BASE_COLUMNS | {f"attr:{k}" for k in attr_defs}
    warnings = [
        {"column": h, "message": "columna desconocida; se ignorará"}
        for h in sorted(headers)
        if h and h not in known
    ]

    rows: list[tuple[int, dict]] = []
    for i, r in enumerate(reader, start=2):  # encabezado = fila 1
        if i - 1 > MAX_CSV_ROWS:
            raise HTTPException(status_code=422, detail=f"máximo {MAX_CSV_ROWS} filas")
        norm = {
            (k or "").strip().lower(): (v.strip() if isinstance(v, str) else v)
            for k, v in r.items()
        }
        if all(v in (None, "") for v in norm.values()):
            continue
        rows.append((i, norm))

    # Duplicados de identificador dentro del propio archivo.
    def _keys_of(r):
        return (r.get("tag") or r.get("serial_number") or "").lower()

    key_count: dict[str, list[int]] = {}
    for num, r in rows:
        k = _keys_of(r)
        if k:
            key_count.setdefault(k, []).append(num)
    dup_keys = {k for k, nums in key_count.items() if len(nums) > 1}

    # Estado actual: tags y seriales existentes del tenant.
    stmt = select(Document).where(
        Document.entity_type == "asset-identifier",
        Document.tenant_id == tenant_id,
        Document.deleted_at.is_(None),
    )
    tag_map = {
        r.body.get("value"): r.body.get("asset_id")
        for r in db.execute(stmt).scalars().all()
        if r.body.get("type") == "tag"
    }
    stmt = select(Document).where(
        Document.entity_type == "asset",
        Document.tenant_id == tenant_id,
        Document.deleted_at.is_(None),
    )
    asset_rows = {r.id: r for r in db.execute(stmt).scalars().all()}
    serial_map = {
        r.body.get("serial_number"): r.id
        for r in asset_rows.values()
        if r.body.get("serial_number")
    }

    errors: list[dict] = []
    conflicts: list[dict] = []
    parsed_rows: list[dict] = []
    file_tags: dict[str, dict] = {}

    # -- Paso 1: parsear y validar cada fila ---------------------------------
    for num, r in rows:
        row_errors: list[dict] = []

        def err(column, message):
            row_errors.append({"row": num, "column": column, "message": message})

        tag = r.get("tag") or ""
        serial = r.get("serial_number") or ""
        name = r.get("name") or ""
        if _keys_of(r) in dup_keys:
            err("tag", "identificador duplicado dentro del archivo")

        criticality = (r.get("criticality") or "").upper() or None
        if r.get("criticality") and criticality not in CRITICALITIES:
            err("criticality", "debe ser A, B o C")

        status = None
        if r.get("status"):
            status = _parse_status(r["status"])
            if status is None:
                err("status", "estado desconocido")

        location = None
        lat, lon = r.get("lat") or "", r.get("lon") or ""
        if bool(lat) != bool(lon):
            err("lat", "lat y lon van juntas")
        elif lat:
            try:
                flat, flon = _num(lat, "lat"), _num(lon, "lon")
                if not (-90 <= flat <= 90) or not (-180 <= flon <= 180):
                    err("lat", "coordenadas fuera de rango")
                else:
                    location = {"type": "Point", "coordinates": [flon, flat]}
            except ValueError as e:
                err("lat", str(e))

        attrs: dict = {}
        for key, adef in attr_defs.items():
            raw_val = r.get(f"attr:{key}")
            if raw_val in (None, ""):
                continue
            try:
                attrs[key] = parse_value(adef, raw_val)
            except ValueError as e:
                err(f"attr:{key}", str(e))

        # Emparejamiento: tag > serial.
        matched_id = tag_map.get(tag) if tag else None
        if matched_id is None and serial:
            matched_id = serial_map.get(serial)
        matched = asset_rows.get(matched_id) if matched_id else None

        entry = {
            "row": num,
            "tag": tag,
            "serial": serial,
            "name": name,
            "functional_location": r.get("functional_location") or None,
            "parent_tag": r.get("parent_tag") or "",
            "manufacturer": r.get("manufacturer") or None,
            "model": r.get("model") or None,
            "criticality": criticality,
            "status": status,
            "location": location,
            "attrs": attrs,
            "matched": matched,
            "errors": row_errors,
        }
        parsed_rows.append(entry)
        if tag:
            file_tags.setdefault(tag, entry)

    # -- Paso 2: reglas de emparejamiento y parentesco ------------------------
    for e in parsed_rows:
        num = e["row"]
        matched = e["matched"]

        if matched is not None:
            body = matched.body
            if body.get("status") in TERMINAL:
                e["errors"].append(
                    {"row": num, "column": "tag", "message": "activo desincorporado; no se actualiza por CSV"}
                )
            elif body.get("asset_type_id") and body.get("asset_type_id") != asset_type_id:
                e["errors"].append(
                    {"row": num, "column": "tag", "message": "el activo existente tiene otro tipo; el CSV no lo cambia"}
                )
        elif not e["name"]:
            e["errors"].append(
                {"row": num, "column": "name", "message": "name es obligatorio para altas nuevas"}
            )

        # Atributos requeridos en altas.
        if matched is None:
            for a in active_attrs(type_doc):
                if a.get("required") and a["key"] not in e["attrs"]:
                    e["errors"].append(
                        {"row": num, "column": f"attr:{a['key']}", "message": "atributo requerido faltante"}
                    )

        # Padre: por parent_tag dentro del archivo o contra existentes.
        if e["parent_tag"]:
            pt = e["parent_tag"]
            in_file = file_tags.get(pt)
            parent_id = tag_map.get(pt)
            if in_file is None and parent_id is None:
                e["errors"].append(
                    {"row": num, "column": "parent_tag", "message": f"padre '{pt}' no encontrado"}
                )
            elif in_file is e:
                e["errors"].append(
                    {"row": num, "column": "parent_tag", "message": "un activo no puede ser su propio padre"}
                )

        errors.extend(e["errors"])

    # -- Paso 3: acción por fila (create / update / unchanged / conflict) -----
    preview: list[dict] = []
    creates: list[dict] = []
    updates: list[dict] = []
    n_unchanged = 0

    for e in parsed_rows:
        num = e["row"]
        if e["errors"]:
            preview.append({"row": num, "action": "error", "tag": e["tag"], "name": e["name"]})
            continue
        matched = e["matched"]
        if matched is None:
            doc_id = new_doc_id("asset")
            e["new_id"] = doc_id
            creates.append(e)
            preview.append({"row": num, "action": "create", "tag": e["tag"], "name": e["name"]})
            continue

        body = copy.deepcopy(matched.body)
        changed = False

        # Campos base (celda vacía = sin cambio).
        simple = {
            "name": e["name"] or None,
            "functional_location": e["functional_location"],
            "manufacturer": e["manufacturer"],
            "model": e["model"],
            "serial_number": e["serial"] or None,
            "criticality": e["criticality"],
        }
        for k, v in simple.items():
            if v is not None and body.get(k) != v:
                body[k] = v
                changed = True
        if e["location"] and body.get("location") != e["location"]:
            body["location"] = e["location"]
            changed = True

        # Padre por tag (archivo o existente).
        if e["parent_tag"]:
            in_file = file_tags.get(e["parent_tag"])
            parent_id = tag_map.get(e["parent_tag"]) or (in_file or {}).get("new_id")
            if parent_id and body.get("parent_id") != parent_id:
                body["parent_id"] = parent_id
                changed = True

        # Estado del ciclo de vida.
        if e["status"] and body.get("status") != e["status"]:
            try:
                assert_transition(body.get("status"), e["status"], "importación CSV")
                body["status"] = e["status"]
                body["status_reason"] = "importación CSV"
                body["status_changed_at"] = utcnow_iso()
                if e["status"] == "decommissioned":
                    body["decommissioned_at"] = utcnow_iso()
                if e["status"] == "in_service" and not body.get("commissioned_at"):
                    body["commissioned_at"] = utcnow_iso()
                changed = True
            except HTTPException as ex:
                e["errors"].append({"row": num, "column": "status", "message": ex.detail})
                errors.extend(e["errors"])
                preview.append({"row": num, "action": "error", "tag": e["tag"], "name": e["name"]})
                continue

        # Atributos: nunca pisa lo verificado.
        attrs = dict(body.get("attributes") or {})
        av = dict(body.get("attribute_verification") or {})
        for key, new_val in e["attrs"].items():
            cur = attrs.get(key)
            ver = (av.get(key) or {}).get("status")
            if cur == new_val:
                continue
            if ver in ("confirmed", "corrected"):
                conflicts.append(
                    {
                        "row": num,
                        "tag": e["tag"],
                        "key": key,
                        "current_value": cur,
                        "csv_value": new_val,
                        "message": "atributo ya verificado en terreno; el CSV no lo pisa",
                    }
                )
                continue
            attrs[key] = new_val
            ver_entry = dict(av.get(key) or {})
            ver_entry.update(
                {"status": "pending", "previous_value": cur, "verified_at": None, "session_id": None}
            )
            av[key] = ver_entry
            changed = True
        body["attributes"] = attrs
        body["attribute_verification"] = av

        if not changed:
            n_unchanged += 1
            preview.append({"row": num, "action": "unchanged", "tag": e["tag"], "name": e["name"]})
            continue

        body["verification_status"] = compute_verification_status(body, type_doc)
        updates.append({"entry": e, "row_doc": matched, "body": body})
        preview.append({"row": num, "action": "update", "tag": e["tag"], "name": e["name"]})

    result = {
        "dry_run": dry_run,
        "batch_id": None,
        "filename": file.filename,
        "encoding": encoding,
        "delimiter": delimiter,
        "rows_total": len(parsed_rows),
        "created": 0,
        "updated": 0,
        "unchanged": n_unchanged,
        "error_rows": len({e["row"] for e in errors}),
        "conflicts": conflicts,
        "errors": errors,
        "warnings": warnings,
        "preview": preview[:50],
    }

    if dry_run:
        result["created"] = len(creates)
        result["updated"] = len(updates)
        return result

    # -- Aplicar (transacción) -------------------------------------------------
    batch = ImportBatch(
        id=new_doc_id("batch"),
        tenant_id=tenant_id,
        asset_type_id=asset_type_id,
        filename=file.filename,
    )
    now = utcnow_iso()

    # Primero crear para que los parent_tag internos al archivo resuelvan el id.
    tag_to_new: dict[str, str] = {}
    for e in creates:
        attrs = e["attrs"]
        av = {
            k: {"status": "pending", "previous_value": None, "verified_at": None, "session_id": None}
            for k in attrs
            if next((a for a in active_attrs(type_doc) if a["key"] == k), {}).get(
                "verify_in_field", True
            )
        }
        status = e["status"] or "in_service"
        parent_id = None
        if e["parent_tag"]:
            parent_id = tag_map.get(e["parent_tag"]) or tag_to_new.get(e["parent_tag"])
        doc = {
            "schema_version": "1.0",
            "tenant_id": tenant_id,
            "id": e["new_id"],
            "name": e["name"],
            "category": type_doc.get("name"),
            "location": e["location"],
            "asset_type_id": asset_type_id,
            "status": status,
            "status_reason": "importación CSV" if status in ("out_of_service", "decommissioned") else None,
            "status_changed_at": now,
            "attributes": attrs,
            "parent_id": parent_id,
            "functional_location": e["functional_location"],
            "manufacturer": e["manufacturer"],
            "model": e["model"],
            "serial_number": e["serial"] or None,
            "criticality": e["criticality"],
            "commissioned_at": now if status == "in_service" else None,
            "decommissioned_at": now if status == "decommissioned" else None,
            "data_source": "csv_import",
            "import_batch_id": batch.id,
            "verification_status": "pending",
            "verified_at": None,
            "attribute_verification": av,
            "created_at": now,
            "updated_at": None,
        }
        if e["tag"]:
            tag_to_new[e["tag"]] = e["new_id"]
        _insert_document(
            db, doc, "asset", action="import", source="csv_import", batch_id=batch.id
        )
        if e["tag"]:
            ident = _new_identifier(tenant_id, e["new_id"], e["tag"], "csv-import")
            _insert_document(
                db, ident, "asset-identifier", action="import", source="csv_import", batch_id=batch.id
            )

    for u in updates:
        u["body"]["import_batch_id"] = batch.id
        u["body"]["updated_at"] = now
        save_update(
            db, u["row_doc"], u["body"], action="import", source="csv_import", batch_id=batch.id
        )

    batch.rows_total = len(parsed_rows)
    batch.created = len(creates)
    batch.updated = len(updates)
    batch.unchanged = n_unchanged
    batch.errors = result["error_rows"]
    batch.conflicts = len(conflicts)
    batch.report = result
    db.add(batch)
    db.commit()

    result["batch_id"] = batch.id
    result["created"] = len(creates)
    result["updated"] = len(updates)
    return result


@router.get("/admin/import-batches")
def list_import_batches(
    tenant_id: str = Query(default=DEFAULT_TENANT, max_length=80),
    db: Session = Depends(get_db),
):
    stmt = (
        select(ImportBatch)
        .where(ImportBatch.tenant_id == tenant_id)
        .order_by(ImportBatch.created_at.desc())
        .limit(200)
    )
    batches = db.execute(stmt).scalars().all()

    stmt_assets = select(Document).where(
        Document.entity_type == "asset",
        Document.tenant_id == tenant_id,
        Document.deleted_at.is_(None),
    )
    assets = db.execute(stmt_assets).scalars().all()
    by_batch: dict[str, list] = {}
    for a in assets:
        by_batch.setdefault(a.body.get("import_batch_id"), []).append(a.body)

    out = []
    for b in batches:
        progress = {"total": 0, "verified": 0, "in_progress": 0, "pending": 0, "not_found": 0}
        for a in by_batch.get(b.id, []):
            progress["total"] += 1
            vs = a.get("verification_status") or "pending"
            progress[vs if vs in progress else "pending"] += 1
        out.append(
            {
                "id": b.id,
                "filename": b.filename,
                "asset_type_id": b.asset_type_id,
                "created_at": b.created_at.isoformat() if b.created_at else None,
                "rows_total": b.rows_total,
                "created": b.created,
                "updated": b.updated,
                "unchanged": b.unchanged,
                "errors": b.errors,
                "conflicts": b.conflicts,
                "progress": progress,
            }
        )
    return out
