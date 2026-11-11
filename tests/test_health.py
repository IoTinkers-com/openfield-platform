def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_index(client):
    r = client.get("/")
    assert r.status_code == 200
    assert "OpenField" in r.text
