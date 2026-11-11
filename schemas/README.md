# 04 · Esquemas de datos (JSON Schema)

> Estado: Tanda C · OpenField (IoTinkers)

Esquema canónico propio, simple y versionado. Draft **JSON Schema 2020-12**.

## Regla de evolución (D9 · ADR-0009)
- Todo documento lleva `schema_version`.
- **Solo se agregan campos, nunca se rompen.** No se usa `additionalProperties: false`
  precisamente para permitir la evolución aditiva sin invalidar documentos antiguos.
- Un cambio que rompa compatibilidad no es una versión: es un esquema nuevo con otro nombre.

## Campos comunes en todo documento
`tenant_id` (D13 · multiempresa) y `schema_version` (D9) aparecen en los 11 esquemas, además
de un `id` único (UUID generado en el dispositivo cuando aplica, D4).

## Esquemas
| Archivo | Documento | Compatibilidad |
| --- | --- | --- |
| `session.schema.json` | Sesión de captura | — |
| `device.schema.json` | Dispositivo + `device_capabilities` | — |
| `asset.schema.json` | Activo (identidad canónica) | — |
| `asset-identifier.schema.json` | Identificador externo (QR/TAG/OCR) | D3 |
| `media-item.schema.json` | Medio capturado | STAC Item (id, geometry, datetime, assets) |
| `thermal-capture.schema.json` | Térmica T0–T3 | D1 (matriz °C + imagen + JSON) |
| `observation.schema.json` | Observación | OGC SensorThings (phenomenonTime, result) |
| `transcript.schema.json` | Audio→texto | D7 (motor `engine`) |
| `form-template.schema.json` | Plantilla configurable | D6 |
| `form-response.schema.json` | Respuesta a plantilla | D6, ADR-0017 (`asset_id`) |
| `sync-event.schema.json` | Evento de sincronización | D4 (tus, reloj) |

## Convención de nombres de archivos
- Esquema: `<stem>.schema.json`.
- Ejemplo válido: `examples/valid/<stem>.<desc>.json`.
- Ejemplo inválido: `examples/invalid/<stem>.<desc>.json`.
- `validate_schemas.py` deriva el `stem` del primer segmento del nombre (antes del primer `.`).

## Validar
```sh
pip install jsonschema
python scripts/validate_schemas.py
```
Cada ejemplo válido debe validar; cada inválido debe fallar; cada esquema tiene ≥1 de cada uno.
