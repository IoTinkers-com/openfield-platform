def _ingest(client, doc_id="media-stac-001"):
    doc = {
        "schema_version": "1.0",
        "tenant_id": "tenant-001",
        "id": doc_id,
        "session_id": "sess-001",
        "asset_id": "asset-001",
        "type": "image",
        "captured_at": "2026-11-11T10:05:00Z",
        "geometry": {"type": "Point", "coordinates": [-70.65, -33.45]},
        "assets": {
            "primary": {
                "href": "https://picsum.photos/seed/x/400/300",
                "media_type": "image/jpeg",
                "roles": ["visual"],
            }
        },
    }
    return client.post("/ingest/media-item", json=doc)


def test_stac_items(client):
    _ingest(client)
    r = client.get("/stac/items")
    assert r.status_code == 200
    body = r.json()
    assert body["type"] == "FeatureCollection"
    item = next(f for f in body["features"] if f["id"] == "media-stac-001")
    assert item["stac_version"] == "1.0.0"
    assert item["properties"]["datetime"] == "2026-11-11T10:05:00Z"
    assert item["bbox"] == [-70.65, -33.45, -70.65, -33.45]


def test_stac_item_by_id(client):
    _ingest(client)
    r = client.get("/stac/items/media-stac-001")
    assert r.status_code == 200
    assert r.json()["type"] == "Feature"


def test_collections_items(client):
    _ingest(client)
    r = client.get("/collections/media-item/items")
    assert r.status_code == 200
    body = r.json()
    assert body["type"] == "FeatureCollection"
    f = next(x for x in body["features"] if x["id"] == "media-stac-001")
    assert f["geometry"]["type"] == "Point"
    assert f["properties"]["media_type"] == "image"
