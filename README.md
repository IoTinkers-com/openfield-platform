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
- `POST /ingest/{entity_type}` — valida contra el esquema y dedupe por `id`.
- `GET /documents?tenant_id=&entity_type=` — lista documentos.
- `GET /documents/{id}` — documento.
- `GET /assets/{id}` — expediente del activo (identificadores, sesiones, medios,
  observaciones, transcripciones, respuestas de formulario); HTML para navegadores, JSON para
  el resto (content negotiation por `Accept`, ADR-0019).
- `GET /sessions/{id}` — vista de sesión (medios, observaciones, transcripciones + resumen del
  activo); misma negociación de contenido que `/assets/{id}`.
- `GET /health` — salud.

## Contrato
Los 11 JSON Schemas canónicos están en `schemas/` (fuente de verdad, copiados del paquete
de planificación). Todo documento lleva `schema_version` y `tenant_id`.
