# AGENTS.md — openfield-platform

Backend de OpenField (IoTinkers): ingesta, almacenamiento, estructuración, UI e informes.
El contrato de datos vive en `schemas/` (fuente de verdad).

## Reglas
- Los JSON Schemas de `schemas/` son la fuente de verdad; solo se agregan campos, nunca se rompen (D9).
- Toda ingesta valida contra el esquema, exige `tenant_id` (D13) y hace dedupe por `id` (D4).
- `asset_id` determinista en `media-item`, `observation` y `form-response` (ADR-0017).
- Estructuración: plantillas primero, IA después con validación humana (D6).
- Despliegue: Docker Compose (D5). Medios tras interfaz S3-compatible (05).

## Terminado
- `python scripts/validate_schemas.py` pasa.
- `pytest` pasa.

## Referencias del plan
Paquete de planificación en `../openfield-planning/`: `AGENTS.md`, `DECISIONS.md`,
`03-adr/`, `04-esquemas/`, `06-backlog-mvp.md`.
