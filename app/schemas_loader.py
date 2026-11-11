"""Carga de los JSON Schemas canónicos y validación."""
import json

from jsonschema import Draft202012Validator

from .config import SCHEMAS_DIR

ENTITY_TYPES = [
    "session",
    "device",
    "asset",
    "asset-identifier",
    "media-item",
    "thermal-capture",
    "observation",
    "transcript",
    "form-template",
    "form-response",
    "sync-event",
]


def _load_schemas():
    schemas = {}
    for path in sorted(SCHEMAS_DIR.glob("*.schema.json")):
        stem = path.name.split(".")[0]
        schemas[stem] = json.loads(path.read_text(encoding="utf-8"))
    return schemas


SCHEMAS = _load_schemas()


def validate(entity_type: str, doc: dict) -> dict:
    schema = SCHEMAS.get(entity_type)
    if schema is None:
        raise KeyError(f"entity_type desconocido: {entity_type}")
    Draft202012Validator(schema).validate(doc)
    return doc
