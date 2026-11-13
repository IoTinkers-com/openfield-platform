"""Edición y borrado de capturas (ADR-0021): PATCH/DELETE /documents/{id}."""
import uuid

TENANT = "tenant-cor"


def _ingest(client, entity, doc):
    r = client.post(f"/ingest/{entity}", json=doc)
    assert r.status_code == 201, r.text
    return doc


def _asset(client, aid, status="in_service"):
    doc = {
        "schema_version": "1.0", "tenant_id": TENANT, "id": aid,
        "name": f"Activo {aid}", "status": status,
        "created_at": "2026-11-13T10:00:00Z",
    }
    return _ingest(client, "asset", doc)


def _media(client, mid, asset_id, session_id="sess-cor"):
    doc = {
        "schema_version": "1.0", "tenant_id": TENANT, "id": mid,
        "session_id": session_id, "asset_id": asset_id, "type": "image",
        "captured_at": "2026-11-13T10:05:00Z",
        "geometry": {"type": "Point", "coordinates": [-70.65, -33.45]},
        "assets": {"primary": {"href": "/media/x.jpg", "media_type": "image/jpeg"}},
        "thermal_capture_id": None, "transcript_id": None,
        "created_at": "2026-11-13T10:05:00Z",
    }
    return _ingest(client, "media-item", doc)


def _transcript(client, tid, asset_id):
    doc = {
        "schema_version": "1.0", "tenant_id": TENANT, "id": tid,
        "media_item_id": None, "session_id": None, "asset_id": asset_id,
        "text": "vibración anómala", "language": "es", "engine": "stub",
        "confidence": 0.9, "created_at": "2026-11-13T10:06:00Z",
    }
    return _ingest(client, "transcript", doc)


def test_patch_transcript_ok_with_history(client):
    n = uuid.uuid4().hex[:8]
    _asset(client, f"a-cor-{n}")
    _transcript(client, f"tr-cor-{n}", f"a-cor-{n}")

    r = client.patch(
        f"/documents/tr-cor-{n}",
        json={"changes": {"text": "ruido de rodamiento", "language": "en"}, "reason": "corrección en terreno"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["text"] == "ruido de rodamiento"
    assert r.json()["language"] == "en"

    hist = client.get(f"/documents/tr-cor-{n}/history").json()
    upd = [h for h in hist if h["action"] == "update"]
    assert upd and "text" in upd[0]["changed_keys"]
    assert upd[0]["reason"] == "corrección en terreno"


def test_patch_non_editable_field(client):
    n = uuid.uuid4().hex[:8]
    _asset(client, f"a-cor-{n}")
    _transcript(client, f"tr-cor-{n}", f"a-cor-{n}")
    r = client.patch(f"/documents/tr-cor-{n}", json={"changes": {"engine": "otro"}})
    assert r.status_code == 422
    assert "campo no editable" in r.json()["detail"]


def test_patch_asset_rejected(client):
    n = uuid.uuid4().hex[:8]
    _asset(client, f"a-cor-{n}")
    r = client.patch(f"/documents/a-cor-{n}", json={"changes": {"name": "x"}})
    assert r.status_code == 409


def test_patch_form_response_revalidates_template(client):
    n = uuid.uuid4().hex[:8]
    _asset(client, f"a-cor-{n}")
    _ingest(client, "form-template", {
        "schema_version": "1.0", "tenant_id": TENANT, "id": f"tpl-{n}",
        "name": "Inspección", "fields": [
            {"key": "fugas", "label": "Fugas", "type": "boolean", "required": True},
        ],
    })
    _ingest(client, "form-response", {
        "schema_version": "1.0", "tenant_id": TENANT, "id": f"fr-{n}",
        "template_id": f"tpl-{n}", "asset_id": f"a-cor-{n}",
        "values": {"fugas": True}, "completed_by": "op",
        "session_id": None, "submitted_at": "2026-11-13T10:00:00Z",
        "created_at": "2026-11-13T10:00:00Z",
    })
    # tipo inválido según la plantilla → 422
    r = client.patch(f"/documents/fr-{n}", json={"changes": {"values": {"fugas": "quizá"}}})
    assert r.status_code == 422
    # valor válido → 200
    r2 = client.patch(f"/documents/fr-{n}", json={"changes": {"values": {"fugas": False}}})
    assert r2.status_code == 200, r2.text
    assert r2.json()["values"]["fugas"] is False


def test_media_reassign_moves_between_dossiers(client):
    n = uuid.uuid4().hex[:8]
    _asset(client, f"a-orig-{n}")
    _asset(client, f"a-dest-{n}")
    _media(client, f"m-cor-{n}", f"a-orig-{n}")

    r = client.patch(f"/documents/m-cor-{n}", json={"changes": {"asset_id": f"a-dest-{n}"}})
    assert r.status_code == 200, r.text

    orig = client.get(f"/assets/a-orig-{n}").json()
    dest = client.get(f"/assets/a-dest-{n}").json()
    assert f"m-cor-{n}" not in [m["id"] for m in orig["media_items"]]
    assert f"m-cor-{n}" in [m["id"] for m in dest["media_items"]]


def test_media_reassign_to_decommissioned_rejected(client):
    n = uuid.uuid4().hex[:8]
    _asset(client, f"a-orig-{n}")
    _asset(client, f"a-decom-{n}", status="decommissioned")
    _media(client, f"m-cor-{n}", f"a-orig-{n}")
    r = client.patch(f"/documents/m-cor-{n}", json={"changes": {"asset_id": f"a-decom-{n}"}})
    assert r.status_code == 409


def test_soft_delete_hides_from_dossier_and_restore(client):
    n = uuid.uuid4().hex[:8]
    _asset(client, f"a-cor-{n}")
    _media(client, f"m-cor-{n}", f"a-cor-{n}")

    r = client.delete(f"/documents/m-cor-{n}?reason=duplicada")
    assert r.status_code == 200, r.text

    body = client.get(f"/assets/a-cor-{n}").json()
    assert f"m-cor-{n}" not in [m["id"] for m in body["media_items"]]

    body_del = client.get(f"/assets/a-cor-{n}?include_deleted=true").json()
    gone = [m for m in body_del["media_items"] if m["id"] == f"m-cor-{n}"]
    assert gone and gone[0]["_deleted_at"]

    rr = client.post(f"/documents/m-cor-{n}/restore")
    assert rr.status_code == 200
    body2 = client.get(f"/assets/a-cor-{n}").json()
    assert f"m-cor-{n}" in [m["id"] for m in body2["media_items"]]


def test_delete_already_deleted(client):
    n = uuid.uuid4().hex[:8]
    _asset(client, f"a-cor-{n}")
    _media(client, f"m-cor-{n}", f"a-cor-{n}")
    assert client.delete(f"/documents/m-cor-{n}").status_code == 200
    r = client.delete(f"/documents/m-cor-{n}")
    assert r.status_code == 409


def test_patch_deleted_document_rejected(client):
    n = uuid.uuid4().hex[:8]
    _asset(client, f"a-cor-{n}")
    _transcript(client, f"tr-cor-{n}", f"a-cor-{n}")
    client.delete(f"/documents/tr-cor-{n}")
    r = client.patch(f"/documents/tr-cor-{n}", json={"changes": {"text": "x"}})
    assert r.status_code == 409


def test_op_id_idempotent(client):
    n = uuid.uuid4().hex[:8]
    _asset(client, f"a-cor-{n}")
    _transcript(client, f"tr-cor-{n}", f"a-cor-{n}")
    op = f"op-{n}"
    r1 = client.patch(f"/documents/tr-cor-{n}", json={"changes": {"text": "v1"}, "op_id": op})
    assert r1.status_code == 200
    r2 = client.patch(f"/documents/tr-cor-{n}", json={"changes": {"text": "v2"}, "op_id": op})
    assert r2.status_code == 200
    assert r2.json()["status"] == "already_applied"
    # el primer cambio quedó, no el segundo
    assert client.get(f"/documents/tr-cor-{n}").json()["text"] == "v1"
    hist = client.get(f"/documents/tr-cor-{n}/history").json()
    assert len([h for h in hist if h["action"] == "update"]) == 1


def test_session_end_editable(client):
    n = uuid.uuid4().hex[:8]
    _ingest(client, "session", {
        "schema_version": "1.0", "tenant_id": TENANT, "id": f"s-cor-{n}",
        "device_id": "dev-1", "operator": "op1", "asset_id": None,
        "started_at": "2026-11-13T10:00:00Z", "ended_at": None,
        "location": None, "device_capabilities": {}, "consent": {"recorded": True, "method": "checkbox"},
        "created_at": "2026-11-13T10:00:00Z",
    })
    r = client.patch(f"/documents/s-cor-{n}", json={"changes": {"operator": "op2", "ended_at": "2026-11-13T11:00:00Z"}})
    assert r.status_code == 200, r.text
    assert r.json()["operator"] == "op2"
    r2 = client.patch(f"/documents/s-cor-{n}", json={"changes": {"ended_at": "2026-11-13T09:00:00Z"}})
    assert r2.status_code == 422


def test_identifier_value_unique(client):
    n = uuid.uuid4().hex[:8]
    _asset(client, f"a-cor-{n}")
    _ingest(client, "asset-identifier", {
        "schema_version": "1.0", "tenant_id": TENANT, "id": f"id1-{n}",
        "asset_id": f"a-cor-{n}", "type": "tag", "value": f"TAG-1-{n}",
        "source": "manual", "confidence": None, "created_at": "2026-11-13T10:00:00Z",
    })
    _ingest(client, "asset-identifier", {
        "schema_version": "1.0", "tenant_id": TENANT, "id": f"id2-{n}",
        "asset_id": f"a-cor-{n}", "type": "tag", "value": f"TAG-2-{n}",
        "source": "manual", "confidence": None, "created_at": "2026-11-13T10:00:00Z",
    })
    r = client.patch(f"/documents/id2-{n}", json={"changes": {"value": f"TAG-1-{n}"}})
    assert r.status_code == 409
    r2 = client.patch(f"/documents/id2-{n}", json={"changes": {"value": f"TAG-3-{n}"}})
    assert r2.status_code == 200
