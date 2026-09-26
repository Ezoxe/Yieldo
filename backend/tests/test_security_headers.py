"""Headers every response carries, and the policy the interface runs under."""

from app import main
from app.security.headers import INTERFACE_POLICY, headers_for


def test_an_api_answer_carries_the_base_headers_and_no_policy(client):
    response = client.get("/api/health")
    assert response.headers["X-Content-Type-Options"] == "nosniff"
    assert response.headers["X-Frame-Options"] == "DENY"
    assert response.headers["Referrer-Policy"] == "same-origin"
    assert response.headers["Permissions-Policy"] == "camera=(), microphone=(), geolocation=()"
    assert "Content-Security-Policy" not in response.headers


def test_an_api_error_carries_them_too(client):
    response = client.get("/api/nulle-part")
    assert response.status_code == 404
    assert response.headers["X-Content-Type-Options"] == "nosniff"
    assert response.headers["X-Frame-Options"] == "DENY"


def test_the_interface_runs_under_the_policy(client, tmp_path, monkeypatch):
    (tmp_path / "index.html").write_text("<!doctype html><title>Yieldo</title>")
    monkeypatch.setattr(main, "STATIC_DIR", tmp_path)

    response = client.get("/transactions")

    assert response.status_code == 200
    assert response.headers["Content-Security-Policy"] == INTERFACE_POLICY
    assert response.headers["X-Frame-Options"] == "DENY"


def test_the_policy_forbids_foreign_scripts_and_framing():
    directives = dict(
        part.strip().split(" ", 1) for part in INTERFACE_POLICY.split(";")
    )
    assert directives["script-src"] == "'self'"
    assert directives["frame-ancestors"] == "'none'"
    assert directives["object-src"] == "'none'"
    assert "unsafe-eval" not in INTERFACE_POLICY


def test_the_policy_is_decided_by_the_path():
    assert "Content-Security-Policy" not in headers_for("/api/transactions")
    assert "Content-Security-Policy" not in headers_for("/api")
    assert headers_for("/")["Content-Security-Policy"] == INTERFACE_POLICY
    # A screen whose path merely starts with the three letters is still the interface.
    assert headers_for("/apiculture")["Content-Security-Policy"] == INTERFACE_POLICY
