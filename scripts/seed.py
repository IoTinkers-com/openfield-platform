"""Siembra datos de demostración (Fase 0) contra la API local.

Uso: python scripts/seed.py   (con la API corriendo en http://localhost:8000)
"""
import httpx

BASE = "http://localhost:8000"

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


if __name__ == "__main__":
    main()
