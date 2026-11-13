def test_transcribe_stub(client):
    r = client.post("/transcribe", files={"file": ("a.webm", b"fake-audio-bytes", "audio/webm")})
    assert r.status_code == 200
    body = r.json()
    assert body["engine"] == "stub"
    assert "text" in body


def test_transcribe_language_param(client):
    r = client.post(
        "/transcribe?language=en",
        files={"file": ("a.webm", b"fake-audio-bytes", "audio/webm")},
    )
    assert r.status_code == 200, r.text
    assert r.json()["engine"] == "stub"


def test_transcribe_language_too_long(client):
    r = client.post(
        "/transcribe?language=espanol-latinoamerica",
        files={"file": ("a.webm", b"fake-audio-bytes", "audio/webm")},
    )
    assert r.status_code == 422


def test_transcribe_engine_passes_language(monkeypatch):
    from app import transcription

    seen = {}

    def fake_engine(audio, language):
        seen["language"] = language
        return "ok"

    monkeypatch.setitem(transcription.ENGINES, "stub", fake_engine)
    out = transcription.transcribe(b"x", engine="stub", language="en")
    assert out["text"] == "ok"
    assert seen["language"] == "en"
