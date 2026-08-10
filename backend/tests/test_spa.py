def test_api_404_stays_a_json_404_and_does_not_fall_back_to_the_spa(client):
    response = client.get("/api/inconnu")
    assert response.status_code == 404
    assert response.headers["content-type"].startswith("application/json")


def test_unknown_frontend_route_serves_the_spa_when_it_is_built(client, tmp_path,
                                                                monkeypatch):
    from app import main

    (tmp_path / "index.html").write_text("<!doctype html><div id=root></div>")
    monkeypatch.setattr(main, "STATIC_DIR", tmp_path)

    response = client.get("/transactions")
    assert response.status_code == 200
    assert "id=root" in response.text


def test_path_traversal_is_refused(client, tmp_path, monkeypatch):
    from app import main

    (tmp_path / "index.html").write_text("ok")
    monkeypatch.setattr(main, "STATIC_DIR", tmp_path)

    # httpx's TestClient normalizes literal ".." dot-segments client-side (RFC 3986)
    # before the request ever reaches the app, so a literal "/../../etc/passwd" would
    # arrive at the server already collapsed to "/etc/passwd" — never exercising the
    # server-side guard. Percent-encoding the separator ("%2f") survives that client-side
    # normalization and reaches app.main.serve_spa's is_relative_to check unmangled,
    # the way a raw request through a non-normalizing client or proxy would in production.
    assert client.get("/..%2f..%2fetc/passwd").status_code in (400, 403, 404)


def test_a_clear_message_when_the_frontend_is_not_built(client, tmp_path, monkeypatch):
    from app import main

    monkeypatch.setattr(main, "STATIC_DIR", tmp_path / "absent")
    response = client.get("/")
    assert response.status_code == 503
    assert "interface" in response.json()["detail"].lower()
