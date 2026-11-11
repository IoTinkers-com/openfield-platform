def _setup(client):
    asset = {
        "schema_version": "1.0",
        "tenant_id": "tenant-001",
        "id": "asset-res-001",
        "name": "Tablero A",
        "category": "electrical",
        "location": None,
        "created_at": "2026-11-11T10:00:00Z",
        "updated_at": None,
    }
    ident = {
        "schema_version": "1.0",
        "tenant_id": "tenant-001",
        "id": "id-res-001",
        "asset_id": "asset-res-001",
        "type": "qr",
        "value": "QR-123",
        "source": "platform-qr",
        "confidence": None,
        "created_at": "2026-11-11T10:00:00Z",
    }
    client.post("/ingest/asset", json=asset)
    client.post("/ingest/asset-identifier", json=ident)


def test_resolve_found(client):
    _setup(client)
    r = client.get("/resolve", params={"value": "QR-123"})
    assert r.status_code == 200
    body = r.json()
    assert len(body) == 1
    assert body[0]["asset_id"] == "asset-res-001"
    assert body[0]["asset"]["name"] == "Tablero A"


def test_resolve_not_found(client):
    r = client.get("/resolve", params={"value": "NO-EXISTE"})
    assert r.status_code == 404
