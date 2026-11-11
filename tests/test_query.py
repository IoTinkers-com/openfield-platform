def _ingest(client, doc_id="media-query-001"):
    doc = {
        "schema_version": "1.0",
        "tenant_id": "tenant-001",
        "id": doc_id,
        "session_id": "sess-001",
        "asset_id": "asset-001",
        "type": "image",
        "captured_at": "2026-11-11T10:05:00Z",
        "geometry": {"type": "Point", "coordinates": [-70.65, -33.45]},
        "assets": {"primary": {"href": "/media/x.png", "media_type": "image/png"}},
    }
    return client.post("/ingest/media-item", json=doc)


def test_list_documents(client):
    _ingest(client)
    r = client.get("/documents?tenant_id=tenant-001&entity_type=media-item")
    assert r.status_code == 200
    assert any(d["id"] == "media-query-001" for d in r.json())


def test_get_document(client):
    _ingest(client)
    r = client.get("/documents/media-query-001")
    assert r.status_code == 200
    assert r.json()["id"] == "media-query-001"


def test_get_document_404(client):
    r = client.get("/documents/does-not-exist")
    assert r.status_code == 404
