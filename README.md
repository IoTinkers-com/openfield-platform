# openfield-platform

Backend de OpenField (IoTinkers): ingesta, almacenamiento, estructuración, UI e informes.
**Fase 0 (Maker):** API + base de datos (SQLite local / PostgreSQL en Docker) + dashboard con mapa.

## Arranque rápido

### Local (SQLite, sin Docker)
```sh
pip install -r requirements.txt
uvicorn app.main:app --reload
```
- Salud: `http://localhost:8000/health`
- Dashboard: `http://localhost:8000/`

### Docker (PostgreSQL + PostGIS)
```sh
docker compose up --build
```

### Demo (con la API corriendo)
```sh
python scripts/seed.py
```

## Tests
```sh
pytest
```

## Validar esquemas
```sh
python scripts/validate_schemas.py
```

## Endpoints
- `POST /ingest/{entity_type}` — valida contra el esquema y dedupe por `id`
  (idempotente, solo creación, ADR-0021).
- `GET /documents?tenant_id=&entity_type=&include_deleted=` — lista documentos.
- `GET /documents/{id}` — documento.
- `GET /assets/{id}` — expediente del activo (identificadores, sesiones, medios,
  observaciones, transcripciones, respuestas de formulario, ficha técnica e historial);
  HTML para navegadores, JSON para el resto (content negotiation por `Accept`, ADR-0019).
- `GET /sessions/{id}` — vista de sesión (medios, observaciones, transcripciones + resumen del
  activo); misma negociación de contenido que `/assets/{id}`.
- `GET /health` — salud.

### Registro y ciclo de vida de activos (ADR-0020/0021/0022)
- `GET/POST/PUT /admin/asset-types` — tipos de activo con atributos configurables.
- `GET /admin/asset-types/{id}/csv-template` — plantilla CSV del tipo (`;`, UTF-8 BOM).
- `GET /admin/assets` — lista con filtros (`status`, `asset_type_id`, `verification_status`,
  `import_batch_id`, `q`, `include_deleted`, paginación).
- `POST /assets` — enrolar activo (valida atributos contra el tipo; `tag` crea el identificador).
- `PATCH /assets/{id}` — editar (sin `status` ni verificación: vía dedicada).
- `POST /assets/{id}/status` — transición de ciclo de vida con motivo; `decommissioned` terminal.
- `POST /assets/{id}/verify` — verificación por atributo (`confirm`/`correct`/`unverifiable`,
  `asset_not_found`), idempotente por `op_id`.
- `DELETE /assets/{id}` — baja lógica (con motivo); `POST /documents/{id}/restore` — restaura.
- `GET /documents/{id}/history` — historial de revisiones (antes/después por acción).
- `POST /admin/assets/import` — precarga CSV (multipart; `dry_run` por defecto → vista previa
  con errores por fila/columna y conflictos).
- `GET /admin/import-batches` — lotes con avance de verificación.
- `GET /admin/` — panel de administración (tipos, activos, importar, estados).
- `POST /uploads` — subida de medios (content-type permitido, máx. 25 MB).

## Contrato
Los 12 JSON Schemas canónicos están en `schemas/` (fuente de verdad, copiados del paquete
de planificación). Todo documento lleva `schema_version` y `tenant_id`. Las mutaciones no
cambian el contrato: se registran en `document_revisions` y la baja es lógica (`deleted_at`).

## Precarga CSV (flujo)
1. `GET /admin/asset-types/{id}/csv-template` → plantilla con `attr:<key>` por atributo activo.
2. `POST /admin/assets/import` con `dry_run=true` (defecto) → reporte sin escribir nada.
3. Reenviar con `dry_run=false` → crea/actualiza activos + `AssetIdentifier` por tag + lote
   (`import_batches`). Emparejamiento por `tag` o `serial_number`; re-import idempotente;
   un atributo ya verificado en terreno nunca se pisa (queda como conflicto).
4. En terreno, `POST /assets/{id}/verify` marca cada atributo como confirmado/corregido/no
   verificable; el activo pasa `pending` → `in_progress` → `verified`.
`scripts/sample_assets.csv` tiene 10 motores de ejemplo (incluye 1 fila con error intencional).
