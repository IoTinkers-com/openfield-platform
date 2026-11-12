"""Expediente de activo y vista de sesión (D19 · ADR-0019): agregación de lectura."""

TENANT = "tenant-001"


def _setup(client):
    asset = {
        "schema_version": "1.0",
        "tenant_id": TENANT,
        "id": "asset-dossier-001",
        "name": "Motor M-07",
        "category": "motor",
        "location": {"type": "Point", "coordinates": [-70.65, -33.45]},
        "created_at": "2026-11-11T10:00:00Z",
        "updated_at": None,
    }
    identifier = {
        "schema_version": "1.0",
        "tenant_id": TENANT,
        "id": "id-dossier-001",
        "asset_id": "asset-dossier-001",
        "type": "qr",
        "value": "QR-DOSSIER-001",
        "source": "platform-qr",
        "confidence": None,
        "created_at": "2026-11-11T10:00:00Z",
    }
    session = {
        "schema_version": "1.0",
        "tenant_id": TENANT,
        "id": "sess-dossier-001",
        "device_id": "dev-dossier-001",
        "operator": "Operador 1",
        "asset_id": "asset-dossier-001",
        "started_at": "2026-11-11T10:00:00Z",
        "ended_at": None,
        "location": {"type": "Point", "coordinates": [-70.65, -33.45]},
        "device_capabilities": {"thermal_level": "T0", "gps": True, "audio": True},
        "consent": {"recorded": True, "method": "checkbox"},
        "created_at": "2026-11-11T10:00:00Z",
    }
    media = {
        "schema_version": "1.0",
        "tenant_id": TENANT,
        "id": "media-dossier-001",
        "session_id": "sess-dossier-001",
        "asset_id": "asset-dossier-001",
        "type": "image",
        "captured_at": "2026-11-11T10:05:00Z",
        "geometry": {"type": "Point", "coordinates": [-70.65, -33.45]},
        "assets": {"primary": {"href": "/media/x.jpg", "media_type": "image/jpeg"}},
        "thermal_capture_id": None,
        "transcript_id": None,
        "created_at": "2026-11-11T10:05:00Z",
    }
    # Transcript ligado solo por session_id (sin asset_id propio): debe aparecer igual en el
    # expediente del activo porque la sesión pertenece al activo.
    transcript = {
        "schema_version": "1.0",
        "tenant_id": TENANT,
        "id": "tr-dossier-001",
        "media_item_id": None,
        "session_id": "sess-dossier-001",
        "asset_id": None,
        "text": "Se observa vibración anómala.",
        "language": "es",
        "engine": "stub",
        "confidence": 0.9,
        "created_at": "2026-11-11T10:06:00Z",
    }
    observation = {
        "schema_version": "1.0",
        "tenant_id": TENANT,
        "id": "obs-dossier-001",
        "asset_id": "asset-dossier-001",
        "session_id": "sess-dossier-001",
        "media_item_id": "media-dossier-001",
        "type": "visual",
        "value": "corrosión leve",
        "unit": None,
        "observed_at": "2026-11-11T10:05:30Z",
        "form_response_id": None,
        "metadata": {},
        "created_at": "2026-11-11T10:05:30Z",
    }
    for entity, doc in (
        ("asset", asset),
        ("asset-identifier", identifier),
        ("session", session),
        ("media-item", media),
        ("transcript", transcript),
        ("observation", observation),
    ):
        r = client.post(f"/ingest/{entity}", json=doc)
        assert r.status_code == 201, r.text


def test_asset_dossier_json(client):
    _setup(client)
    r = client.get("/assets/asset-dossier-001")
    assert r.status_code == 200
    body = r.json()
    assert body["asset"]["id"] == "asset-dossier-001"
    assert [i["value"] for i in body["identifiers"]] == ["QR-DOSSIER-001"]
    assert [s["id"] for s in body["sessions"]] == ["sess-dossier-001"]
    assert [m["id"] for m in body["media_items"]] == ["media-dossier-001"]
    assert [o["id"] for o in body["observations"]] == ["obs-dossier-001"]
    # El transcript no tiene asset_id propio, pero su session_id pertenece al activo.
    assert [t["id"] for t in body["transcripts"]] == ["tr-dossier-001"]


def test_asset_dossier_html_for_browser(client):
    _setup(client)
    r = client.get("/assets/asset-dossier-001", headers={"Accept": "text/html"})
    assert r.status_code == 200
    assert "text/html" in r.headers["content-type"]


def test_asset_dossier_not_found(client):
    r = client.get("/assets/no-existe")
    assert r.status_code == 404


def test_session_dossier_json(client):
    _setup(client)
    r = client.get("/sessions/sess-dossier-001")
    assert r.status_code == 200
    body = r.json()
    assert body["session"]["id"] == "sess-dossier-001"
    assert body["asset"] == {"id": "asset-dossier-001", "name": "Motor M-07"}
    assert [m["id"] for m in body["media_items"]] == ["media-dossier-001"]
    assert [o["id"] for o in body["observations"]] == ["obs-dossier-001"]
    assert [t["id"] for t in body["transcripts"]] == ["tr-dossier-001"]


def test_session_dossier_not_found(client):
    r = client.get("/sessions/no-existe")
    assert r.status_code == 404
