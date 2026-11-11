def test_transcribe_stub(client):
    r = client.post("/transcribe", files={"file": ("a.webm", b"fake-audio-bytes", "audio/webm")})
    assert r.status_code == 200
    body = r.json()
    assert body["engine"] == "stub"
    assert "text" in body
