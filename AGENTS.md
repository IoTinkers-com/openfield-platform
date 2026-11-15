# AGENTS.md — openfield-platform

Backend de OpenField (IoTinkers): ingesta, almacenamiento, estructuración, UI e informes.
El contrato de datos vive en `schemas/` (fuente de verdad).

## Reglas
- Los JSON Schemas de `schemas/` son la fuente de verdad; solo se agregan campos, nunca se rompen (D9).
- Toda ingesta valida contra el esquema, exige `tenant_id` (D13) y hace dedupe por `id` (D4).
- `asset_id` determinista en `media-item`, `observation` y `form-response` (ADR-0017).
- Estructuración: plantillas primero, IA después con validación humana (D6).
- Despliegue: Docker Compose (D5). Medios tras interfaz S3-compatible (05).
- La capa de UI estática (`app/static/pwa/`, `app/static/css/openfield.css`) se duplica con
  `openfield-wearable` (ver ADR-0018): al cambiar una copia, actualiza la otra.

## Terminado
- `python scripts/validate_schemas.py` pasa.
- `pytest` pasa.
- Si se tocó la PWA (`app/static/pwa/` o `app/static/js/`), `node scripts/e2e_pwa.mjs`
  pasa contra un servidor aislado (ver README): cubre consentimiento, captura, bandeja,
  asignación, visitas, cierre y sincronización en un navegador real.

## Referencias del plan
Paquete de planificación en `../openfield-planning/`: `AGENTS.md`, `DECISIONS.md`,
`03-adr/`, `04-esquemas/`, `06-backlog-mvp.md`.
