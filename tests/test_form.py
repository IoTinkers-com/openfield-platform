TEMPLATE = {
    "schema_version": "1.0",
    "tenant_id": "tenant-001",
    "id": "tpl-test-001",
    "name": "Inventario",
    "version": "1",
    "asset_category": "electrical",
    "fields": [
        {"key": "estado", "label": "Estado", "type": "select", "required": True, "options": ["ok", "revisar"], "unit": None},
        {"key": "temp_max", "label": "Temp máx", "type": "number", "required": False, "options": None, "unit": "degC"},
    ],
    "created_at": "2026-11-11T10:00:00Z",
}


def _response(doc_id, values, template_id="tpl-test-001"):
    return {
        "schema_version": "1.0",
        "tenant_id": "tenant-001",
        "id": doc_id,
        "template_id": template_id,
        "asset_id": "asset-001",
        "session_id": None,
        "values": values,
        "completed_by": None,
        "submitted_at": "2026-11-11T10:00:00Z",
        "created_at": "2026-11-11T10:00:00Z",
    }


def _setup(client):
    client.post("/ingest/form-template", json=TEMPLATE)


def test_form_response_valid(client):
    _setup(client)
    r = client.post("/ingest/form-response", json=_response("resp-1", {"estado": "ok", "temp_max": 45.5}))
    assert r.status_code == 201


def test_form_response_unknown_field(client):
    _setup(client)
    r = client.post("/ingest/form-response", json=_response("resp-2", {"estado": "ok", "foo": 1}))
    assert r.status_code == 422


def test_form_response_missing_required(client):
    _setup(client)
    r = client.post("/ingest/form-response", json=_response("resp-3", {"temp_max": 45.5}))
    assert r.status_code == 422


def test_form_response_wrong_type(client):
    _setup(client)
    r = client.post("/ingest/form-response", json=_response("resp-4", {"estado": "ok", "temp_max": "caliente"}))
    assert r.status_code == 422


def test_form_response_missing_template(client):
    r = client.post("/ingest/form-response", json=_response("resp-5", {"estado": "ok"}, template_id="no-existe"))
    assert r.status_code == 422
