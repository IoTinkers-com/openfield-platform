VALID_MEDIA = {
    "schema_version": "1.0",
    "tenant_id": "tenant-001",
    "id": "media-test-001",
    "session_id": "sess-001",
    "asset_id": "asset-001",
    "type": "image",
    "captured_at": "2026-11-11T10:05:00Z",
    "geometry": {"type": "Point", "coordinates": [-70.65, -33.45]},
    "assets": {"primary": {"href": "/media/seed.png", "media_type": "image/png"}},
}


def test_ingest_valid(client):
    r = client.post("/ingest/media-item", json=VALID_MEDIA)
    assert r.status_code == 201
    assert r.json()["status"] == "created"


def test_ingest_dedupe(client):
    client.post("/ingest/media-item", json=VALID_MEDIA)
    r = client.post("/ingest/media-item", json=VALID_MEDIA)
    assert r.status_code == 201
    assert r.json()["status"] == "already_exists"


def test_ingest_missing_tenant(client):
    doc = {k: v for k, v in VALID_MEDIA.items() if k != "tenant_id"}
    doc["id"] = "media-test-002"
    r = client.post("/ingest/media-item", json=doc)
    assert r.status_code == 422


def test_ingest_invalid_schema(client):
    doc = {**VALID_MEDIA, "id": "media-test-003", "assets": {}}
    r = client.post("/ingest/media-item", json=doc)
    assert r.status_code == 422


def test_ingest_unknown_entity(client):
    r = client.post("/ingest/foo", json=VALID_MEDIA)
    assert r.status_code == 404
