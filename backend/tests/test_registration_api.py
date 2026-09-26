"""Registration closes after the first account unless the administrator opens it.

`conftest.registration_open_for_tests` opens it for every other test file, which
registers several households to prove isolation; here it is closed again, as it
is on a fresh installation.
"""

import pytest

from app.config import settings


@pytest.fixture
def closed(monkeypatch):
    monkeypatch.setattr(settings, "registration_open", False)


def _register(client, email):
    return client.post("/api/auth/register", json={
        "name": "X", "email": email, "password": "motdepasse123"})


def _bearer(response):
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def test_the_first_account_is_always_possible(client, closed):
    response = _register(client, "admin@example.com")
    assert response.status_code == 201
    assert response.json()["user"]["role"] == "admin"


def test_a_second_account_is_refused_by_default(client, closed):
    _register(client, "admin@example.com")
    response = _register(client, "autre@example.com")
    assert response.status_code == 403
    assert response.json()["detail"] == "Les inscriptions sont fermées"


def test_the_status_says_so_before_anyone_tries(client, closed):
    assert client.get("/api/auth/registration").json() == {"open": True, "first_account": True}
    _register(client, "admin@example.com")
    assert client.get("/api/auth/registration").json() == {"open": False, "first_account": False}


def test_the_admin_opens_registration(client, closed):
    admin = _bearer(_register(client, "admin@example.com"))

    response = client.patch("/api/admin/settings", headers=admin, json={"registration_open": True})

    assert response.status_code == 200
    assert response.json() == {"registration_open": True, "source": "instance"}
    assert client.get("/api/auth/registration").json()["open"] is True
    assert _register(client, "autre@example.com").status_code == 201


def test_the_admin_closes_it_again(client, monkeypatch):
    admin = _bearer(_register(client, "admin@example.com"))
    client.patch("/api/admin/settings", headers=admin, json={"registration_open": False})

    assert _register(client, "autre@example.com").status_code == 403


def test_the_setting_follows_the_environment_until_the_admin_decides(client, closed):
    admin = _bearer(_register(client, "admin@example.com"))
    assert client.get("/api/admin/settings", headers=admin).json() == {
        "registration_open": False, "source": "environment"}


def test_a_member_cannot_read_or_change_the_installation(client, closed, monkeypatch):
    _register(client, "admin@example.com")
    monkeypatch.setattr(settings, "registration_open", True)
    member = _bearer(_register(client, "membre@example.com"))

    read = client.get("/api/admin/settings", headers=member)
    write = client.patch("/api/admin/settings", headers=member, json={"registration_open": True})

    assert read.status_code == 403
    assert write.status_code == 403
    assert write.json()["detail"] == "Droits administrateur requis"


def test_an_agent_key_cannot_open_registration(client, closed):
    admin = _bearer(_register(client, "admin@example.com"))
    key = client.get("/api/access-key", headers=admin).json()["key"]

    response = client.patch("/api/admin/settings",
                            headers={"Authorization": f"Bearer {key}"},
                            json={"registration_open": True})

    assert response.status_code == 401
    assert _register(client, "autre@example.com").status_code == 403


def test_registration_closed_is_the_shipped_default():
    from app.config import Settings

    assert Settings.model_fields["registration_open"].default is False
