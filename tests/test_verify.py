"""Verificación en terreno por atributo (ADR-0022)."""
import itertools

import pytest

T = "tenant-verif"
_counter = itertools.count()


@pytest.fixture()
def asset_id(client):
    n = next(_counter)
    r = client.post("/admin/asset-types", json={
        "tenant_id": T, "id": f"atype-verif-{n}",
        "name": "Motor",
        "attributes": [
            {"key": "kw", "label": "kW", "type": "number", "required": True},
            {"key": "ip", "label": "IP", "type": "select", "options": ["IP54", "IP55"]},
        ],
    })
    assert r.status_code == 201, r.json()
    aid = f"asset-verif-{n}"
    r = client.post("/assets", json={
        "tenant_id": T, "id": aid, "name": "M1",
        "asset_type_id": f"atype-verif-{n}",
        "attributes": {"kw": 10, "ip": "IP54"},
    })
    assert r.status_code == 201, r.json()
    return aid


def test_confirm_without_value_422(client, asset_id):
    r = client.post(f"/assets/{asset_id}/verify", json={
        "results": [{"key": "kw", "action": "confirm"}, {"key": "nuevo", "action": "confirm"}],
    })
    assert r.status_code == 422


def test_correct_invalid_value_422(client, asset_id):
    r = client.post(f"/assets/{asset_id}/verify", json={
        "results": [{"key": "ip", "action": "correct", "value": "IP99"}],
    })
    assert r.status_code == 422


def test_verify_flow_to_verified(client, asset_id):
    r = client.post(f"/assets/{asset_id}/verify", json={
        "results": [{"key": "kw", "action": "confirm"}],
    })
    assert r.status_code == 200
    assert r.json()["asset"]["verification_status"] == "in_progress"

    r = client.post(f"/assets/{asset_id}/verify", json={
        "results": [{"key": "ip", "action": "correct", "value": "IP55"}],
    })
    assert r.status_code == 200
    body = r.json()["asset"]
    assert body["verification_status"] == "verified"
    assert body["verified_at"]
    assert body["attributes"]["ip"] == "IP55"
    assert body["attribute_verification"]["ip"]["status"] == "corrected"
    assert body["attribute_verification"]["ip"]["previous_value"] == "IP54"


def test_unverifiable_counts_as_done(client, asset_id):
    client.post(f"/assets/{asset_id}/verify", json={
        "results": [{"key": "kw", "action": "confirm"}],
    })
    r = client.post(f"/assets/{asset_id}/verify", json={
        "results": [{"key": "ip", "action": "unverifiable"}],
    })
    assert r.json()["asset"]["verification_status"] == "verified"


def test_asset_not_found(client, asset_id):
    r = client.post(f"/assets/{asset_id}/verify", json={
        "asset_not_found": True, "note": "no estaba en sitio",
    })
    assert r.status_code == 200
    assert r.json()["asset"]["verification_status"] == "not_found"


def test_op_id_idempotent(client, asset_id):
    payload = {"op_id": "op-verif-1", "results": [{"key": "kw", "action": "confirm"}]}
    r1 = client.post(f"/assets/{asset_id}/verify", json=payload)
    assert r1.json()["status"] == "applied"
    r2 = client.post(f"/assets/{asset_id}/verify", json=payload)
    assert r2.json()["status"] == "already_applied"
    hist = client.get(f"/documents/{asset_id}/history").json()
    assert len([h for h in hist if h["action"] == "verify"]) == 1
