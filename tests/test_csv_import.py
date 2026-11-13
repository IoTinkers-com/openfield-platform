"""Importación de activos por CSV: plantilla, dry-run, idempotencia, conflictos (ADR-0022)."""
import itertools

import pytest

T = "tenant-csv"
_counter = itertools.count()

HEADER = "tag;name;functional_location;parent_tag;manufacturer;model;serial_number;criticality;status;lat;lon;attr:kw;attr:ip"


def _csv(rows, sep=";", header=None):
    h = header or HEADER.replace(";", sep)
    body = sep.join(h.split(";")) if sep != ";" else h
    lines = [body] + [sep.join(r) for r in rows]
    return ("\ufeff" + "\r\n".join(lines) + "\r\n").encode("utf-8")


def _row(tag, name="Motor 1", kw="10", ip="IP54", **extra):
    r = {
        "tag": tag, "name": name, "functional_location": "", "parent_tag": "",
        "manufacturer": "", "model": "", "serial_number": "", "criticality": "B",
        "status": "in_service", "lat": "", "lon": "", "attr:kw": kw, "attr:ip": ip,
    }
    r.update(extra)
    return [r[c] for c in HEADER.split(";")]


@pytest.fixture()
def ctx(client):
    """Tipo de activo + prefijo de tag único por test (la BD de pruebas es compartida)."""
    n = next(_counter)
    tid = f"atype-csv-{n}"
    r = client.post("/admin/asset-types", json={
        "tenant_id": T, "id": tid, "name": "MotorCSV",
        "attributes": [
            {"key": "kw", "label": "kW", "type": "number", "required": True},
            {"key": "ip", "label": "IP", "type": "select", "options": ["IP54", "IP55"]},
        ],
    })
    assert r.status_code == 201, r.json()
    return tid, f"T{n}"


def _import(client, type_id, content, dry=True):
    return client.post(
        "/admin/assets/import",
        files={"file": ("a.csv", content, "text/csv")},
        data={"asset_type_id": type_id, "tenant_id": T, "dry_run": str(dry).lower()},
    )


def test_template(client, ctx):
    tid, _ = ctx
    r = client.get(f"/admin/asset-types/{tid}/csv-template")
    assert r.status_code == 200
    assert "text/csv" in r.headers["content-type"]
    assert "attr:kw" in r.text and "attr:ip" in r.text


def test_dry_run_writes_nothing(client, ctx):
    tid, tag = ctx
    r = _import(client, tid, _csv([_row(tag)]), dry=True)
    assert r.status_code == 200, r.json()
    body = r.json()
    assert body["created"] == 1 and body["dry_run"] is True
    items = client.get("/admin/assets", params={"tenant_id": T, "asset_type_id": tid}).json()["items"]
    assert items == []


def test_both_delimiters_accepted(client, ctx):
    tid, tag = ctx
    for sep in (";", ","):
        r = _import(client, tid, _csv([_row(f"{tag}-{ord(sep)}")], sep=sep))
        assert r.status_code == 200, r.json()
        assert r.json()["delimiter"] == sep


def test_invalid_select_value_row_error(client, ctx):
    tid, tag = ctx
    r = _import(client, tid, _csv([_row(tag, ip="IP99")]))
    body = r.json()
    assert body["error_rows"] == 1
    assert body["errors"][0]["column"] == "attr:ip"
    assert body["errors"][0]["row"] == 2


def test_duplicate_tag_in_file(client, ctx):
    tid, tag = ctx
    r = _import(client, tid, _csv([_row(tag), _row(tag, name="Otro")]))
    body = r.json()
    assert body["error_rows"] == 2


def test_import_then_reimport_idempotent(client, ctx):
    tid, tag = ctx
    r = _import(client, tid, _csv([_row(tag)]), dry=False)
    assert r.status_code == 200, r.json()
    body = r.json()
    assert body["created"] == 1 and body["batch_id"]
    # segundo envío del mismo archivo
    r2 = _import(client, tid, _csv([_row(tag)]), dry=False)
    body2 = r2.json()
    assert body2["created"] == 0
    assert body2["unchanged"] == 1


def test_batch_progress(client, ctx):
    tid, tag = ctx
    _import(client, tid, _csv([_row(tag)]), dry=False)
    batches = client.get("/admin/import-batches", params={"tenant_id": T}).json()
    mine = [b for b in batches if b["asset_type_id"] == tid]
    assert mine
    assert mine[0]["progress"]["total"] == 1
    assert mine[0]["progress"]["pending"] == 1


def test_reimport_conflict_verified_attr(client, ctx):
    tid, tag = ctx
    _import(client, tid, _csv([_row(tag, kw="10")]), dry=False)
    items = client.get("/admin/assets", params={"tenant_id": T, "asset_type_id": tid}).json()["items"]
    aid = items[0]["id"]
    client.post(f"/assets/{aid}/verify", json={"results": [{"key": "kw", "action": "confirm"}]})
    # re-import con valor distinto
    r = _import(client, tid, _csv([_row(tag, kw="99")]), dry=False)
    body = r.json()
    assert len(body["conflicts"]) == 1
    assert body["conflicts"][0]["key"] == "kw"
    doc = client.get(f"/documents/{aid}").json()
    assert doc["attributes"]["kw"] == 10  # no se pisó


def test_parent_tag_within_file(client, ctx):
    tid, tag = ctx
    rows = [_row(f"{tag}-P", name="Padre"), _row(f"{tag}-H", name="Hijo", parent_tag=f"{tag}-P")]
    r = _import(client, tid, _csv(rows), dry=False)
    assert r.status_code == 200
    docs = client.get("/documents", params={"entity_type": "asset", "tenant_id": T}).json()
    hijo = next(d for d in docs if d["name"] == "Hijo" and d["asset_type_id"] == tid)
    padre = next(d for d in docs if d["name"] == "Padre" and d["asset_type_id"] == tid)
    assert hijo["parent_id"] == padre["id"]


def test_missing_name_header_422(client, ctx):
    tid, _ = ctx
    bad = "tag;attr:kw\r\nMOT-1;10\r\n".encode()
    r = _import(client, tid, bad)
    assert r.status_code == 422


def test_too_many_rows_422(client, ctx):
    tid, tag = ctx
    rows = [_row(f"{tag}-{i}") for i in range(5001)]
    r = _import(client, tid, _csv(rows))
    assert r.status_code == 422


def test_comma_decimal(client, ctx):
    tid, tag = ctx
    r = _import(client, tid, _csv([_row(tag, kw="12,5")]), dry=False)
    assert r.status_code == 200
    docs = client.get("/documents", params={"entity_type": "asset", "tenant_id": T}).json()
    doc = next(d for d in docs if d["asset_type_id"] == tid)
    assert doc["attributes"]["kw"] == 12.5
