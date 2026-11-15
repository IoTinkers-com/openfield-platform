"""Consentimiento versionado: ingesta append-only de consent-record (ADR-0026)."""
T = "tenant-cons"

GRANT = {
    "schema_version": "1.0",
    "tenant_id": T,
    "id": "cons-t-001",
    "subject": {"type": "operator", "id": "Ana", "display_name": "Ana"},
    "device_id": "dev-cons-1",
    "policy_id": "captura-terreno",
    "policy_version": "1.0",
    "action": "grant",
    "scopes": ["image", "audio", "location", "text"],
    "method": "checkbox",
    "occurred_at": "2026-11-15T10:00:00Z",
    "expires_at": "2027-11-15T10:00:00Z",
    "created_at": "2026-11-15T10:00:00Z",
}


def test_ingest_consent_record_created_and_deduped(client):
    r = client.post("/ingest/consent-record", json=GRANT)
    assert r.status_code == 201, r.json()
    assert r.json()["status"] == "created"
    again = client.post("/ingest/consent-record", json=GRANT)
    assert again.status_code == 201
    assert again.json()["status"] == "already_exists"


def test_ingest_consent_record_invalid_action_422(client):
    bad = {**GRANT, "id": "cons-t-002", "action": "maybe"}
    assert client.post("/ingest/consent-record", json=bad).status_code == 422


def test_ingest_consent_record_without_tenant_422(client):
    bad = {k: v for k, v in GRANT.items() if k != "tenant_id"}
    bad["id"] = "cons-t-003"
    assert client.post("/ingest/consent-record", json=bad).status_code == 422


def test_consent_record_is_append_only(client):
    client.post("/ingest/consent-record", json={**GRANT, "id": "cons-t-004"})
    patch = client.patch(
        "/documents/cons-t-004",
        json={"changes": {"action": "revoke"}, "reason": "prueba"},
    )
    assert patch.status_code == 409
    delete = client.delete("/documents/cons-t-004", params={"reason": "prueba"})
    assert delete.status_code == 409


def test_consent_records_listed_by_entity_type(client):
    client.post("/ingest/consent-record", json={**GRANT, "id": "cons-t-005"})
    docs = client.get("/documents", params={"entity_type": "consent-record", "tenant_id": T}).json()
    assert any(d["id"] == "cons-t-005" for d in docs)
