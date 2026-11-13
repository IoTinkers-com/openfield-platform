def test_upload_media(client):
    r = client.post("/uploads", files={"file": ("test.png", b"fake-image-bytes", "image/png")})
    assert r.status_code == 201
    href = r.json()["href"]
    assert href.startswith("/media/")

    # el archivo se sirve de vuelta
    r2 = client.get(href)
    assert r2.status_code == 200
    assert r2.content == b"fake-image-bytes"


def test_upload_disallowed_content_type_415(client):
    r = client.post("/uploads", files={"file": ("x.exe", b"MZ", "application/x-msdownload")})
    assert r.status_code == 415
