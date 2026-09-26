"""A new password, or « Déconnecter les autres appareils », ends every session
opened before it -- except the one that asked."""

import jwt

from app.config import settings
from app.models import AgentKey, User


def _register(client):
    response = client.post("/api/auth/register", json={
        "name": "Max", "email": "max@example.com", "password": "motdepasse123"})
    return response.json()["access_token"]


def _bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _change_password(client, token):
    return client.post("/api/auth/password", headers=_bearer(token), json={
        "current_password": "motdepasse123", "new_password": "nouveaumotdepasse"})


def test_a_password_change_hands_back_a_session_that_works(client):
    old = _register(client)

    response = _change_password(client, old)

    assert response.status_code == 200
    fresh = response.json()["access_token"]
    assert client.get("/api/auth/me", headers=_bearer(fresh)).status_code == 200
    assert "yieldo_refresh" in response.cookies


def test_a_password_change_ends_the_old_access_token(client):
    old = _register(client)
    _change_password(client, old)

    assert client.get("/api/auth/me", headers=_bearer(old)).status_code == 401


def test_a_password_change_ends_the_old_refresh_cookie(client):
    old = _register(client)
    stolen = client.cookies.get("yieldo_refresh")
    _change_password(client, old)

    client.cookies.clear()
    client.cookies.set("yieldo_refresh", stolen)
    assert client.post("/api/auth/refresh").status_code == 401


def test_the_refresh_cookie_handed_back_keeps_this_tab_signed_in(client):
    old = _register(client)
    _change_password(client, old)

    assert client.post("/api/auth/refresh").status_code == 200


def test_a_password_change_ends_the_agent_key(client, db):
    token = _register(client)
    key = client.get("/api/access-key", headers=_bearer(token)).json()["key"]
    _change_password(client, token)

    assert db.query(AgentKey).count() == 0
    assert client.get("/api/transactions", headers=_bearer(key)).status_code == 401


def test_revoking_the_other_sessions_keeps_the_one_that_asked(client, db):
    old = _register(client)

    response = client.post("/api/auth/sessions/revoke-others", headers=_bearer(old))

    assert response.status_code == 200
    fresh = response.json()["access_token"]
    assert client.get("/api/auth/me", headers=_bearer(fresh)).status_code == 200
    assert client.get("/api/auth/me", headers=_bearer(old)).status_code == 401
    assert db.query(User).one().session_version == 1


def test_an_agent_key_cannot_revoke_sessions(client):
    token = _register(client)
    key = client.get("/api/access-key", headers=_bearer(token)).json()["key"]

    response = client.post("/api/auth/sessions/revoke-others", headers=_bearer(key))

    assert response.status_code == 401
    assert "session" in response.json()["detail"].lower()


def test_a_token_issued_before_versions_existed_still_opens_version_zero(client, db):
    _register(client)
    user = db.query(User).one()
    legacy = jwt.encode(
        {"sub": str(user.id), "type": "access", "iat": 1, "exp": 9_999_999_999},
        settings.secret_key, algorithm="HS256")

    assert client.get("/api/auth/me", headers=_bearer(legacy)).status_code == 200


def test_a_token_with_a_malformed_version_is_refused(client, db):
    _register(client)
    user = db.query(User).one()
    forged = jwt.encode(
        {"sub": str(user.id), "type": "access", "sv": "0", "iat": 1, "exp": 9_999_999_999},
        settings.secret_key, algorithm="HS256")

    assert client.get("/api/auth/me", headers=_bearer(forged)).status_code == 401
