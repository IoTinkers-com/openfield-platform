"""Registro de activos: tipos, enrolamiento, ciclo de vida, baja lógica (ADR-0020/0021)."""
import itertools

import pytest

T = "tenant-reg"
_counter = itertools.count()

MOTOR = {
    "tenant_id": T,
    "name": "Motor",
    "attributes": [
        {"key": "potencia_kw", "label": "Potencia", "type": "number", "unit": "kW", "required": True},
        {"key": "grado_ip", "label": "IP", "type": "select", "options": ["IP54", "IP55"], "required": False},
    ],
}


def _type(client):
    r = client.post("/admin/asset-types", json={**MOTOR, "id": f"atype-reg-{next(_counter)}"})
    assert r.status_code == 201, r.json()
    return r.json()


def _asset(client, type_id, **kw):
    payload = {
        "tenant_id": T,
        "name": kw.pop("name", "Motor 1"),
        "asset_type_id": type_id,
        "attributes": {"potencia_kw": 10},
        "tag": kw.pop("tag", None),
    }
    payload.update(kw)
    r = client.post("/assets", json=payload)
    assert r.status_code == 201, r.json()
    return r.json()


def test_create_type_ok(client):
    doc = _type(client)
    assert doc["id"].startswith("atype-reg-")
    assert doc["attributes"][0]["key"] == "potencia_kw"


def test_type_select_without_options_422(client):
    r = client.post("/admin/asset-types", json={
        "tenant_id": T, "name": "X",
        "attributes": [{"key": "sel", "label": "s", "type": "select"}],
    })
    assert r.status_code == 422


def test_type_duplicate_keys_422(client):
    r = client.post("/admin/asset-types", json={
        "tenant_id": T, "name": "X",
        "attributes": [
            {"key": "a", "label": "a", "type": "text"},
            {"key": "a", "label": "a2", "type": "text"},
        ],
    })
    assert r.status_code == 422


def test_type_extra_field_422(client):
    r = client.post("/admin/asset-types", json={**MOTOR, "id": "atype-x1", "hack": True})
    assert r.status_code == 422


def test_name_too_long_422(client):
    r = client.post("/admin/asset-types", json={**MOTOR, "id": "atype-x2", "name": "x" * 201})
    assert r.status_code == 422


def test_put_remove_attr_with_data_422(client):
    t = _type(client)
    _asset(client, t["id"], attributes={"potencia_kw": 10, "grado_ip": "IP54"})
    r = client.put(f"/admin/asset-types/{t['id']}", json={
        "tenant_id": T, "name": "Motor",
        "attributes": [{"key": "potencia_kw", "label": "Potencia", "type": "number", "required": True}],
    })
    assert r.status_code == 422
    # desactivar sí funciona
    r2 = client.put(f"/admin/asset-types/{t['id']}", json={
        "tenant_id": T, "name": "Motor",
        "attributes": [
            {"key": "potencia_kw", "label": "Potencia", "type": "number", "required": True},
            {"key": "grado_ip", "label": "IP", "type": "select", "options": ["IP54", "IP55"], "active": False},
        ],
    })
    assert r2.status_code == 200


def test_enroll_asset_ok(client):
    t = _type(client)
    doc = _asset(client, t["id"], tag="TAG-1")
    assert doc["status"] == "in_service"
    assert doc["verification_status"] == "pending"
    # identificador creado
    r = client.get("/resolve", params={"value": "TAG-1"})
    assert r.status_code == 200
    assert r.json()[0]["asset_id"] == doc["id"]


def test_missing_required_attr_422(client):
    t = _type(client)
    r = client.post("/assets", json={
        "tenant_id": T, "name": "M", "asset_type_id": t["id"], "attributes": {},
    })
    assert r.status_code == 422


def test_invalid_select_value_422(client):
    t = _type(client)
    r = client.post("/assets", json={
        "tenant_id": T, "name": "M", "asset_type_id": t["id"],
        "attributes": {"potencia_kw": 1, "grado_ip": "IP99"},
    })
    assert r.status_code == 422


def test_duplicate_tag_409(client):
    t = _type(client)
    _asset(client, t["id"], tag="TAG-DUP")
    r = client.post("/assets", json={
        "tenant_id": T, "name": "Otro", "asset_type_id": t["id"],
        "attributes": {"potencia_kw": 1}, "tag": "TAG-DUP",
    })
    assert r.status_code == 409


def test_patch_attribute_resets_verification(client):
    t = _type(client)
    doc = _asset(client, t["id"])
    # verificar el atributo primero
    client.post(f"/assets/{doc['id']}/verify", json={
        "results": [{"key": "potencia_kw", "action": "confirm"}],
    })
    r = client.patch(f"/assets/{doc['id']}", json={"attributes": {"potencia_kw": 20}})
    assert r.status_code == 200
    assert r.json()["attribute_verification"]["potencia_kw"]["status"] == "pending"
    assert r.json()["attribute_verification"]["potencia_kw"]["previous_value"] == 10


def test_patch_status_forbidden_422(client):
    t = _type(client)
    doc = _asset(client, t["id"])
    r = client.patch(f"/assets/{doc['id']}", json={"status": "standby"})
    assert r.status_code == 422


def test_status_reason_required_422(client):
    t = _type(client)
    doc = _asset(client, t["id"])
    r = client.post(f"/assets/{doc['id']}/status", json={"status": "out_of_service"})
    assert r.status_code == 422


def test_decommissioned_terminal_409(client):
    t = _type(client)
    doc = _asset(client, t["id"])
    r = client.post(f"/assets/{doc['id']}/status", json={"status": "decommissioned", "reason": "baja"})
    assert r.status_code == 200
    assert r.json()["decommissioned_at"]
    r2 = client.post(f"/assets/{doc['id']}/status", json={"status": "in_service"})
    assert r2.status_code == 409
    r3 = client.patch(f"/assets/{doc['id']}", json={"name": "x"})
    assert r3.status_code == 409


def test_ingest_capture_to_decommissioned_409(client):
    t = _type(client)
    doc = _asset(client, t["id"])
    client.post(f"/assets/{doc['id']}/status", json={"status": "decommissioned", "reason": "baja"})
    r = client.post("/ingest/media-item", json={
        "schema_version": "1.0", "tenant_id": T, "id": "media-reg-001",
        "session_id": "sess-reg-001", "asset_id": doc["id"], "type": "image",
        "captured_at": "2026-11-13T10:00:00Z",
        "geometry": {"type": "Point", "coordinates": [-70.65, -33.45]},
        "assets": {"primary": {"href": "/media/x.png", "media_type": "image/png"}},
    })
    assert r.status_code == 409


def test_soft_delete_and_restore(client):
    t = _type(client)
    doc = _asset(client, t["id"], tag="TAG-DEL")
    r = client.delete(f"/assets/{doc['id']}", params={"reason": "alta errónea"})
    assert r.status_code == 200
    # fuera de listados, documentos, resolve y expediente
    assert all(a["id"] != doc["id"] for a in client.get("/admin/assets", params={"tenant_id": T}).json()["items"])
    assert all(d["id"] != doc["id"] for d in client.get("/documents", params={"entity_type": "asset", "tenant_id": T}).json())
    assert client.get("/resolve", params={"value": "TAG-DEL"}).status_code == 404
    assert client.get(f"/assets/{doc['id']}").status_code == 404
    # visible con include_deleted
    incl = client.get("/admin/assets", params={"tenant_id": T, "include_deleted": "true"}).json()["items"]
    assert any(a["id"] == doc["id"] for a in incl)
    # restaurar
    r2 = client.post(f"/documents/{doc['id']}/restore")
    assert r2.status_code == 200
    assert client.get("/resolve", params={"value": "TAG-DEL"}).status_code == 200


def test_delete_parent_with_children_409(client):
    t = _type(client)
    parent = _asset(client, t["id"], name="Padre")
    _asset(client, t["id"], name="Hijo", parent_id=parent["id"])
    r = client.delete(f"/assets/{parent['id']}", params={"reason": "x"})
    assert r.status_code == 409


def test_history_records_actions(client):
    t = _type(client)
    doc = _asset(client, t["id"])
    client.patch(f"/assets/{doc['id']}", json={"manufacturer": "WEG"})
    client.post(f"/assets/{doc['id']}/status", json={"status": "out_of_service", "reason": "falla"})
    hist = client.get(f"/documents/{doc['id']}/history").json()
    actions = [h["action"] for h in hist]
    assert actions == ["status", "update", "create"]


def test_tenant_isolation(client):
    t = _type(client)
    doc = _asset(client, t["id"])
    items = client.get("/admin/assets", params={"tenant_id": "otro-tenant"}).json()["items"]
    assert all(a["id"] != doc["id"] for a in items)


def test_ingest_asset_with_invalid_attr_422(client):
    t = _type(client)
    r = client.post("/ingest/asset", json={
        "schema_version": "1.0", "tenant_id": T, "id": "asset-ing-001",
        "name": "Motor ingesta", "asset_type_id": t["id"],
        "attributes": {"potencia_kw": "no-es-numero"},
        "created_at": "2026-11-13T10:00:00Z", "updated_at": None,
    })
    assert r.status_code == 422
