"""Cierre de sesión de campo (ADR-0023): POST /sessions/{id}/end."""
import uuid

TENANT = "tenant-001"


def _session(client, sid):
    doc = {
        "schema_version": "1.0",
        "tenant_id": TENANT,
        "id": sid,
        "device_id": "dev-end-001",
        "operator": "Operador 1",
        "asset_id": None,
        "started_at": "2026-11-11T10:00:00Z",
        "ended_at": None,
        "location": {"type": "Point", "coordinates": [-70.65, -33.45]},
        "device_capabilities": {"thermal_level": "T0", "gps": True, "audio": True},
        "consent": {"recorded": True, "method": "checkbox"},
        "created_at": "2026-11-11T10:00:00Z",
    }
    r = client.post("/ingest/session", json=doc)
    assert r.status_code == 201, r.text
    return doc


def test_end_session_ok_and_idempotent(client):
    sid = f"sess-end-{uuid.uuid4().hex[:8]}"
    _session(client, sid)

    r = client.post(f"/sessions/{sid}/end", json={"ended_at": "2026-11-11T10:30:00Z"})
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "closed"
    assert r.json()["session"]["ended_at"] == "2026-11-11T10:30:00Z"

    # Idempotente: cerrar de nuevo no cambia nada ni crea revisión extra.
    r2 = client.post(f"/sessions/{sid}/end", json={"ended_at": "2026-11-11T10:45:00Z"})
    assert r2.status_code == 200, r2.text
    assert r2.json()["status"] == "already_closed"
    assert r2.json()["session"]["ended_at"] == "2026-11-11T10:30:00Z"


def test_end_session_rejects_before_start(client):
    sid = f"sess-end-{uuid.uuid4().hex[:8]}"
    _session(client, sid)
    r = client.post(f"/sessions/{sid}/end", json={"ended_at": "2026-11-11T09:00:00Z"})
    assert r.status_code == 422
    assert "started_at" in r.json()["detail"]


def test_end_session_rejects_future(client):
    sid = f"sess-end-{uuid.uuid4().hex[:8]}"
    _session(client, sid)
    r = client.post(f"/sessions/{sid}/end", json={"ended_at": "2999-01-01T00:00:00Z"})
    assert r.status_code == 422
    assert "futuro" in r.json()["detail"]


def test_end_session_invalid_date(client):
    sid = f"sess-end-{uuid.uuid4().hex[:8]}"
    _session(client, sid)
    r = client.post(f"/sessions/{sid}/end", json={"ended_at": "no-es-fecha"})
    assert r.status_code == 422
    assert "inválido" in r.json()["detail"]


def test_end_session_not_found(client):
    r = client.post("/sessions/no-existe/end", json={"ended_at": "2026-11-11T10:00:00Z"})
    assert r.status_code == 404


def test_end_session_creates_revision(client):
    sid = f"sess-end-{uuid.uuid4().hex[:8]}"
    _session(client, sid)
    r = client.post(
        f"/sessions/{sid}/end",
        json={"ended_at": "2026-11-11T10:30:00Z", "op_id": f"op-{uuid.uuid4().hex[:8]}"},
    )
    assert r.status_code == 200
    hist = client.get(f"/documents/{sid}/history").json()
    assert any(h["action"] == "update" and h["source"] == "field" for h in hist)
