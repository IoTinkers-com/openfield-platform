"""Dominio del registro de activos (ADR-0020/0022): ciclo de vida, atributos
configurables por tipo y verificación en terreno.

Las funciones de valor puro (parse/validate) no tocan la BD: las usan la API, la
importación CSV y la ingesta.
"""
import re
import uuid
from datetime import datetime, timezone

from fastapi import HTTPException

STATUSES = ["planned", "in_service", "standby", "out_of_service", "decommissioned"]
STATUS_LABELS_ES = {
    "planned": "Planificado",
    "in_service": "En servicio",
    "standby": "En reserva",
    "out_of_service": "Fuera de servicio",
    "decommissioned": "Desincorporado",
}
TERMINAL = {"decommissioned"}
REASON_REQUIRED = {"out_of_service", "decommissioned"}
VERIFY_ACTIONS = {"confirm", "correct", "unverifiable"}
ATTR_VERIFY_DONE = {"confirmed", "corrected", "unverifiable"}
ATTR_TYPES = {"text", "number", "boolean", "select", "date"}

MAX_ATTR_TEXT = 2000
MAX_ATTR_KEYS = 200

_DATE_ISO = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_DATE_DMY = re.compile(r"^(\d{2})-(\d{2})-(\d{4})$")
_TRUE_WORDS = {"si", "sí", "true", "1", "x", "yes"}
_FALSE_WORDS = {"no", "false", "0"}


def utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def new_doc_id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:12]}"


# ---------------------------------------------------------------------------
# Tipos de activo / atributos
# ---------------------------------------------------------------------------


def attr_map(type_doc: dict) -> dict:
    return {a["key"]: a for a in (type_doc.get("attributes") or [])}


def active_attrs(type_doc: dict) -> list:
    """Atributos activos del tipo, ordenados por `order`."""
    attrs = sorted(type_doc.get("attributes") or [], key=lambda a: a.get("order", 0))
    return [a for a in attrs if a.get("active", True)]


def relevant_attrs(type_doc: dict) -> list:
    """Atributos que deben verificarse en terreno (verify_in_field, por defecto true)."""
    return [a for a in active_attrs(type_doc) if a.get("verify_in_field", True)]


def parse_value(attr_def: dict, raw):
    """Convierte un valor (string CSV/UI o ya tipado) al tipo del atributo.

    Devuelve el valor convertido; `None` para celda vacía. Lanza ValueError con
    mensaje en español si no se puede convertir.
    """
    t = attr_def.get("type")
    if raw is None:
        return None
    if isinstance(raw, str):
        raw = raw.strip()
        if raw == "":
            return None
    if t == "number":
        if isinstance(raw, bool):
            raise ValueError(f"'{raw}' no es un número")
        if isinstance(raw, (int, float)):
            return raw
        s = raw.replace(",", ".") if ("," in raw and "." not in raw) else raw
        try:
            v = float(s)
        except ValueError:
            raise ValueError(f"'{raw}' no es un número") from None
        return int(v) if v.is_integer() else v
    if t == "boolean":
        if isinstance(raw, bool):
            return raw
        if not isinstance(raw, str):
            raise ValueError(f"'{raw}' no es sí/no")
        w = raw.lower()
        if w in _TRUE_WORDS:
            return True
        if w in _FALSE_WORDS:
            return False
        raise ValueError(f"'{raw}' no es sí/no")
    if t == "date":
        if not isinstance(raw, str):
            raise ValueError("la fecha debe ser texto")
        if _DATE_ISO.match(raw):
            return raw
        m = _DATE_DMY.match(raw)
        if m:
            return f"{m.group(3)}-{m.group(2)}-{m.group(1)}"
        raise ValueError(f"'{raw}' no es una fecha válida (YYYY-MM-DD o DD-MM-YYYY)")
    if t == "select":
        if not isinstance(raw, str):
            raise ValueError("el valor debe ser una opción")
        options = attr_def.get("options") or []
        for opt in options:
            if isinstance(opt, str) and opt.lower() == raw.lower():
                return opt
        raise ValueError(f"'{raw}' no está entre las opciones: {', '.join(options)}")
    # text (y cualquier tipo futuro se trata como texto acotado)
    if not isinstance(raw, str):
        raise ValueError("el valor debe ser texto")
    if len(raw) > MAX_ATTR_TEXT:
        raise ValueError(f"texto demasiado largo (máx. {MAX_ATTR_TEXT})")
    return raw


def validate_typed_value(attr_def: dict, value) -> None:
    """Valida un valor ya tipado (JSON). Lanza ValueError con mensaje en español."""
    t = attr_def.get("type")
    if t == "number":
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise ValueError("debe ser un número")
    elif t == "boolean":
        if not isinstance(value, bool):
            raise ValueError("debe ser sí/no")
    elif t == "select":
        options = attr_def.get("options") or []
        if not isinstance(value, str) or value not in options:
            raise ValueError(f"debe ser una de: {', '.join(options)}")
    elif t == "date":
        if not isinstance(value, str) or not _DATE_ISO.match(value):
            raise ValueError("debe ser fecha YYYY-MM-DD")
    else:
        if not isinstance(value, str):
            raise ValueError("debe ser texto")
        if len(value) > MAX_ATTR_TEXT:
            raise ValueError(f"texto demasiado largo (máx. {MAX_ATTR_TEXT})")


def validate_attributes(type_doc: dict, attributes, *, require_required: bool = True) -> None:
    """Valida el dict `attributes` de un Asset contra su AssetType.

    Lanza ValueError con todos los errores juntos.
    """
    if not isinstance(attributes, dict) or len(attributes) > MAX_ATTR_KEYS:
        raise ValueError("atributos inválidos")
    errors = []
    attrs = attr_map(type_doc)
    active = {a["key"] for a in active_attrs(type_doc)}
    for key, value in attributes.items():
        if value is None:
            continue
        if key not in attrs:
            errors.append(f"atributo desconocido: {key}")
            continue
        if key not in active:
            errors.append(f"atributo inactivo: {key}")
            continue
        try:
            validate_typed_value(attrs[key], value)
        except ValueError as e:
            errors.append(f"{key}: {e}")
    if require_required:
        for a in active_attrs(type_doc):
            if a.get("required") and attributes.get(a["key"]) is None:
                errors.append(f"atributo requerido faltante: {a['key']}")
    if errors:
        raise ValueError("; ".join(errors))


# ---------------------------------------------------------------------------
# Ciclo de vida
# ---------------------------------------------------------------------------


def assert_transition(current: str | None, new: str, reason: str | None) -> None:
    """Valida una transición de estado. Lanza HTTPException (409/422)."""
    if new not in STATUSES:
        raise HTTPException(status_code=422, detail=f"estado desconocido: {new}")
    if current in TERMINAL:
        raise HTTPException(
            status_code=409,
            detail=f"el activo está '{current}' (estado terminal); no admite cambios",
        )
    if new in REASON_REQUIRED and not (reason or "").strip():
        raise HTTPException(status_code=422, detail=f"el estado '{new}' exige un motivo")


# ---------------------------------------------------------------------------
# Verificación en terreno (ADR-0022)
# ---------------------------------------------------------------------------


def compute_verification_status(asset: dict, type_doc: dict | None) -> str:
    """Estado agregado del activo según la verificación de sus atributos relevantes."""
    if asset.get("verification_status") == "not_found":
        return "not_found"
    if not type_doc:
        return asset.get("verification_status") or "pending"
    verification = asset.get("attribute_verification") or {}
    attributes = asset.get("attributes") or {}
    relevant = [
        a
        for a in relevant_attrs(type_doc)
        if attributes.get(a["key"]) is not None or a.get("required")
    ]
    if not relevant:
        return "verified" if asset.get("verified_at") else "pending"
    states = [
        (verification.get(a["key"]) or {}).get("status", "pending") for a in relevant
    ]
    if all(s in ATTR_VERIFY_DONE for s in states):
        return "verified"
    if any(s != "pending" for s in states):
        return "in_progress"
    return "pending"


def reset_attr_verification(asset: dict, key: str, old_value) -> None:
    """Un valor editado/importado vuelve a pendiente, conservando el valor anterior."""
    av = asset.setdefault("attribute_verification", {})
    av[key] = {
        "status": "pending",
        "previous_value": old_value,
        "verified_at": None,
        "session_id": None,
    }


def apply_verification(
    asset: dict, type_doc: dict | None, results: list, *, session_id=None, now=None
) -> None:
    """Aplica resultados de verificación sobre `asset` (mutado in situ).

    `results`: [{key, action: confirm|correct|unverifiable, value?}].
    Lanza ValueError con mensaje en español.
    """
    now = now or utcnow_iso()
    attrs = attr_map(type_doc or {})
    av = asset.setdefault("attribute_verification", {})
    attributes = asset.setdefault("attributes", {})
    for r in results:
        key = r.get("key")
        action = r.get("action")
        attr_def = attrs.get(key)
        if attr_def is None:
            raise ValueError(f"atributo desconocido: {key}")
        if not attr_def.get("active", True):
            raise ValueError(f"atributo inactivo: {key}")
        if action not in VERIFY_ACTIONS:
            raise ValueError(f"acción desconocida: {action}")
        prev = av.get(key) or {}
        if action == "confirm":
            if attributes.get(key) is None:
                raise ValueError(f"'{key}' no tiene valor que confirmar; usa corregir")
            av[key] = {
                "status": "confirmed",
                "previous_value": prev.get("previous_value"),
                "verified_at": now,
                "session_id": session_id,
            }
        elif action == "unverifiable":
            av[key] = {
                "status": "unverifiable",
                "previous_value": prev.get("previous_value"),
                "verified_at": now,
                "session_id": session_id,
            }
        else:  # correct
            if "value" not in r or r.get("value") is None:
                raise ValueError(f"'{key}': corregir exige un valor")
            raw = r["value"]
            if isinstance(raw, str):
                new_value = parse_value(attr_def, raw)
            else:
                validate_typed_value(attr_def, raw)
                new_value = raw
            old_value = attributes.get(key)
            attributes[key] = new_value
            av[key] = {
                "status": "corrected",
                "previous_value": old_value,
                "verified_at": now,
                "session_id": session_id,
            }
    asset["verification_status"] = compute_verification_status(asset, type_doc)
    if asset["verification_status"] == "verified" and not asset.get("verified_at"):
        asset["verified_at"] = now
    asset["updated_at"] = now
