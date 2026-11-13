"""Siembra datos de demostración (Fase 0) contra la API local.

Uso: python scripts/seed.py   (con la API corriendo en http://localhost:8000)
     OPENFIELD_BASE_URL=http://localhost:8012 python scripts/seed.py

Además de los documentos de captura, crea 2 tipos de activo con atributos
configurables (ejemplos ilustrativos; no son el Anexo A de ISO 14224) y asigna
tipo/estado al activo de demo.
"""
import os

import httpx

BASE = os.environ.get("OPENFIELD_BASE_URL", "http://localhost:8000")

ASSET_TYPES = [
    {
        "tenant_id": "tenant-001",
        "id": "atype-motor",
        "name": "Motor eléctrico",
        "equipment_class": "rotating/motor",
        "description": "Motor eléctrico trifásico de inducción.",
        "active": True,
        "attributes": [
            {"key": "potencia_kw", "label": "Potencia", "type": "number", "unit": "kW", "required": True, "order": 0},
            {"key": "tension_v", "label": "Tensión", "type": "number", "unit": "V", "required": False, "order": 1},
            {"key": "corriente_a", "label": "Corriente", "type": "number", "unit": "A", "required": False, "order": 2},
            {"key": "rpm", "label": "Velocidad", "type": "number", "unit": "rpm", "required": False, "order": 3},
            {"key": "grado_ip", "label": "Grado IP", "type": "select", "options": ["IP54", "IP55", "IP65"], "required": False, "order": 4},
            {"key": "anio_fabricacion", "label": "Año de fabricación", "type": "number", "required": False, "order": 5},
            {"key": "observaciones", "label": "Observaciones", "type": "text", "required": False, "order": 6, "verify_in_field": False},
        ],
    },
    {
        "tenant_id": "tenant-001",
        "id": "atype-tablero",
        "name": "Tablero eléctrico",
        "equipment_class": "electrical/panel",
        "description": "Tablero de distribución eléctrica.",
        "active": True,
        "attributes": [
            {"key": "tension_nominal_v", "label": "Tensión nominal", "type": "number", "unit": "V", "required": True, "order": 0},
            {"key": "corriente_nominal_a", "label": "Corriente nominal", "type": "number", "unit": "A", "required": False, "order": 1},
            {"key": "n_circuitos", "label": "N.º de circuitos", "type": "number", "required": False, "order": 2},
            {"key": "tipo_montaje", "label": "Tipo de montaje", "type": "select", "options": ["mural", "autosoportado"], "required": False, "order": 3},
            {"key": "grado_ip", "label": "Grado IP", "type": "select", "options": ["IP20", "IP54", "IP55", "IP65"], "required": False, "order": 4},
        ],
    },
]

DOCS = [
    (
        "asset",
        {
            "schema_version": "1.0",
            "tenant_id": "tenant-001",
            "id": "asset-001",
            "name": "Tablero eléctrico TB-01",
            "category": "electrical",
            "location": {"type": "Point", "coordinates": [-70.65, -33.45]},
            "created_at": "2026-11-11T10:00:00Z",
            "updated_at": None,
        },
    ),
    (
        "asset-identifier",
        {
            "schema_version": "1.0",
            "tenant_id": "tenant-001",
            "id": "id-001",
            "asset_id": "asset-001",
            "type": "qr",
            "value": "https://iotinkers.com/a/asset-001",
            "source": "platform-qr",
            "confidence": None,
            "created_at": "2026-11-11T10:00:00Z",
        },
    ),
    (
        "device",
        {
            "schema_version": "1.0",
            "tenant_id": "tenant-001",
            "id": "dev-001",
            "name": "Simulador Fase 0",
            "device_capabilities": {
                "model": "simulator",
                "os": "n/a",
                "thermal_level": "T0",
                "thermal_sensor_model": None,
                "thermal_resolution": None,
                "gps": True,
                "audio": True,
                "offline": True,
            },
            "created_at": "2026-11-11T10:00:00Z",
        },
    ),
    (
        "session",
        {
            "schema_version": "1.0",
            "tenant_id": "tenant-001",
            "id": "sess-001",
            "device_id": "dev-001",
            "operator": "Simulador",
            "asset_id": "asset-001",
            "started_at": "2026-11-11T10:00:00Z",
            "ended_at": None,
            "location": {"type": "Point", "coordinates": [-70.65, -33.45]},
            "device_capabilities": {"thermal_level": "T0", "gps": True, "audio": True},
            "consent": {"recorded": True, "method": "simulado"},
            "created_at": "2026-11-11T10:00:00Z",
        },
    ),
    (
        "media-item",
        {
            "schema_version": "1.0",
            "tenant_id": "tenant-001",
            "id": "media-001",
            "session_id": "sess-001",
            "asset_id": "asset-001",
            "type": "image",
            "captured_at": "2026-11-11T10:05:00Z",
            "geometry": {"type": "Point", "coordinates": [-70.65, -33.45]},
            "assets": {
                "primary": {
                    "href": "https://picsum.photos/seed/openfield1/400/300",
                    "media_type": "image/jpeg",
                    "roles": ["visual"],
                }
            },
            "thermal_capture_id": None,
            "transcript_id": None,
            "created_at": "2026-11-11T10:05:00Z",
        },
    ),
    (
        "media-item",
        {
            "schema_version": "1.0",
            "tenant_id": "tenant-001",
            "id": "media-002",
            "session_id": "sess-001",
            "asset_id": "asset-001",
            "type": "image",
            "captured_at": "2026-11-11T10:06:00Z",
            "geometry": {"type": "Point", "coordinates": [-70.66, -33.44]},
            "assets": {
                "primary": {
                    "href": "https://picsum.photos/seed/openfield2/400/300",
                    "media_type": "image/jpeg",
                    "roles": ["visual"],
                }
            },
            "thermal_capture_id": None,
            "transcript_id": None,
            "created_at": "2026-11-11T10:06:00Z",
        },
    ),
]


def main():
    for entity, doc in DOCS:
        r = httpx.post(f"{BASE}/ingest/{entity}", json=doc, timeout=10)
        print(f"{entity:16s} {r.status_code} {r.json()}")

    # Tipos de activo (panel /admin/).
    for t in ASSET_TYPES:
        r = httpx.get(f"{BASE}/admin/asset-types/{t['id']}", timeout=10)
        if r.status_code == 200:
            print(f"asset-type       200 {t['id']} (ya existe)")
            continue
        r = httpx.post(f"{BASE}/admin/asset-types", json=t, timeout=10)
        print(f"asset-type       {r.status_code} {r.json()}")

    # El activo de demo pasa a ser un Tablero en servicio.
    r = httpx.patch(
        f"{BASE}/assets/asset-001",
        json={
            "asset_type_id": "atype-tablero",
            "attributes": {"tension_nominal_v": 400, "n_circuitos": 12},
            "functional_location": "Planta 1 / Sala eléctrica",
            "manufacturer": "ABB",
            "criticality": "A",
        },
        timeout=10,
    )
    print(f"patch asset-001  {r.status_code}")


if __name__ == "__main__":
    main()
