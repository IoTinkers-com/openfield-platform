
"""Categorías de foto configurables por tipo de activo (ADR-0024)."""
T = "tenant-cats"


def _type(client, **kw):
    payload = {"tenant_id": T, "name": "Motor", "attributes": [], **kw}
    r = client.post("/admin/asset-types", json=payload)
    assert r.status_code == 201, r.json()
    return r.json()


def test_create_type_with_categories(client):
    doc = _type(client, photo_categories=[
        {"key": "rodamiento", "label": "Rodamientos"},
        {"key": "acople", "label": "Acople", "active": False},
    ])
    assert doc["photo_categories"][0]["key"] == "rodamiento"
    assert doc["photo_categories"][1]["active"] is False


def test_create_type_without_categories(client):
    doc = _type(client)
    assert "photo_categories" not in doc


def test_duplicate_category_key_422(client):
    r = client.post("/admin/asset-types", json={
        "tenant_id": T, "name": "X",
        "photo_categories": [
            {"key": "a", "label": "A"},
            {"key": "a", "label": "A2"},
        ],
    })
    assert r.status_code == 422


def test_bad_category_key_422(client):
    r = client.post("/admin/asset-types", json={
        "tenant_id": T, "name": "X",
        "photo_categories": [{"key": "Con Mayuscula!", "label": "X"}],
    })
    assert r.status_code == 422


def test_too_many_categories_422(client):
    r = client.post("/admin/asset-types", json={
        "tenant_id": T, "name": "X",
        "photo_categories": [{"key": f"cat_{i}", "label": f"C{i}"} for i in range(31)],
    })
    assert r.status_code == 422


def test_put_preserves_categories_when_omitted(client):
    t = _type(client, photo_categories=[{"key": "rodamiento", "label": "Rodamientos"}])
    r = client.put(f"/admin/asset-types/{t['id']}", json={
        "tenant_id": T, "name": "Motor v2", "attributes": [],
    })
    assert r.status_code == 200
    assert r.json()["photo_categories"][0]["key"] == "rodamiento"


def test_put_replaces_categories(client):
    t = _type(client, photo_categories=[{"key": "a", "label": "A"}])
    r = client.put(f"/admin/asset-types/{t['id']}", json={
        "tenant_id": T, "name": "Motor", "attributes": [],
        "photo_categories": [{"key": "b", "label": "B"}],
    })
    assert r.status_code == 200
    assert [c["key"] for c in r.json()["photo_categories"]] == ["b"]
    # limpiar con lista vacía
    r2 = client.put(f"/admin/asset-types/{t['id']}", json={
        "tenant_id": T, "name": "Motor", "attributes": [],
        "photo_categories": [],
    })
    assert r2.status_code == 200
    assert r2.json()["photo_categories"] == []
