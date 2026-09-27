"""GET/POST/PATCH/DELETE /api/planned-events: the one-off events a household
knows are coming -- a tax balance, a holiday, a bonus."""


def _register(client, email="avenir@example.fr"):
    body = client.post("/api/auth/register", json={
        "name": "Max", "email": email, "password": "motdepasse123"}).json()
    return {"Authorization": f"Bearer {body['access_token']}"}


def _create(client, headers, **overrides):
    payload = {"label": "Solde d'impôt", "due_on": "2026-09-15", "amount_cents": -31_000}
    payload.update(overrides)
    return client.post("/api/planned-events", headers=headers, json=payload)


def test_an_event_round_trips_in_date_order(client):
    headers = _register(client)
    _create(client, headers, label="Vacances", due_on="2026-11-10", amount_cents=-180_000)
    created = _create(client, headers)
    assert created.status_code == 201
    assert created.json()["label"] == "Solde d'impôt"

    listed = client.get("/api/planned-events", headers=headers).json()
    assert [row["label"] for row in listed] == ["Solde d'impôt", "Vacances"]


def test_an_event_is_edited_and_deleted(client):
    headers = _register(client)
    event = _create(client, headers).json()

    patched = client.patch(f"/api/planned-events/{event['id']}", headers=headers,
                           json={"amount_cents": -35_000, "notes": "Avis reçu"})
    assert patched.status_code == 200
    assert patched.json()["amount_cents"] == -35_000
    assert patched.json()["notes"] == "Avis reçu"

    assert client.delete(f"/api/planned-events/{event['id']}", headers=headers).status_code == 204
    assert client.get("/api/planned-events", headers=headers).json() == []


def test_a_zero_amount_is_not_an_event(client):
    headers = _register(client)
    response = _create(client, headers, amount_cents=0)
    assert response.status_code == 422
    assert "montant nul" in response.json()["detail"]


def test_a_blank_label_is_refused(client):
    headers = _register(client)
    assert _create(client, headers, label="   ").status_code == 422


def test_a_null_on_a_required_field_is_refused_in_french(client):
    headers = _register(client)
    event = _create(client, headers).json()
    response = client.patch(f"/api/planned-events/{event['id']}", headers=headers,
                            json={"amount_cents": None})
    assert response.status_code == 422


def test_another_households_account_is_not_found(client):
    owner = _register(client, "proprietaire@example.fr")
    account = client.post("/api/accounts", headers=owner,
                          json={"name": "Courant", "kind": "checking"}).json()
    intruder = _register(client, "intrus@example.fr")

    response = _create(client, intruder, account_id=account["id"])

    assert response.status_code == 404
    assert response.json()["detail"] == "Compte introuvable"


def test_events_never_cross_households(client):
    owner = _register(client, "proprietaire@example.fr")
    event = _create(client, owner).json()
    intruder = _register(client, "intrus@example.fr")

    assert client.get("/api/planned-events", headers=intruder).json() == []
    assert client.patch(f"/api/planned-events/{event['id']}", headers=intruder,
                        json={"label": "x"}).status_code == 404
    assert client.delete(f"/api/planned-events/{event['id']}",
                         headers=intruder).status_code == 404


def test_the_routes_need_a_session(client):
    assert client.get("/api/planned-events").status_code == 401
