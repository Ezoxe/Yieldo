def _register(client, email="dettes@example.fr"):
    body = client.post("/api/auth/register", json={
        "name": "Max", "email": email, "password": "motdepasse123"}).json()
    return {"Authorization": f"Bearer {body['access_token']}"}


def _create(client, headers, **overrides):
    payload = {"name": "Crédit auto", "kind": "auto", "principal_cents": 850_000,
               "annual_rate_bps": 490, "minimum_payment_cents": 21_500,
               "term_months": 48}
    payload.update(overrides)
    return client.post("/api/debts", headers=headers, json=payload)


def test_a_debt_round_trips(client):
    headers = _register(client)
    created = _create(client, headers)
    assert created.status_code == 201
    body = created.json()
    assert body["principal_cents"] == 850_000
    assert body["archived"] is False

    listed = client.get("/api/debts", headers=headers).json()
    assert [item["id"] for item in listed] == [body["id"]]


def test_deleting_a_debt_archives_it_rather_than_erasing_it(client):
    headers = _register(client)
    debt_id = _create(client, headers).json()["id"]
    assert client.delete(f"/api/debts/{debt_id}", headers=headers).status_code == 204
    assert client.get("/api/debts", headers=headers).json() == []


def test_an_unknown_debt_kind_is_refused_in_french(client):
    headers = _register(client)
    response = _create(client, headers, kind="hypothèque-martienne")
    assert response.status_code == 422
    assert "Type de dette inconnu" in response.json()["detail"]


def test_a_negative_capital_is_refused_in_french(client):
    """`Debt.principal_cents` is a positive magnitude by contract. Pydantic
    enforces it, and `french_request_validation_error` translates the message --
    the frontend renders `detail` verbatim."""
    headers = _register(client)
    response = _create(client, headers, principal_cents=-1)
    assert response.status_code == 422
    assert "capital" in str(response.json()["detail"]).lower()


def test_the_payoff_compares_both_strategies(client):
    headers = _register(client)
    _create(client, headers, name="Conso", kind="consumer", principal_cents=200_000,
            annual_rate_bps=2000, minimum_payment_cents=5_000, term_months=None)
    _create(client, headers, name="Carte", kind="credit_card", principal_cents=50_000,
            annual_rate_bps=500, minimum_payment_cents=5_000, term_months=None)

    body = client.get("/api/debts/payoff", headers=headers,
                      params={"extra_cents": 20_000}).json()
    assert body["snowball"]["order"] != body["avalanche"]["order"]
    assert body["interest_saved_cents"] > 0
    assert body["snowball"]["monthly_budget_cents"] == 30_000
    assert len(body["snowball"]["points"]) == body["snowball"]["months"]


def test_the_payoff_of_a_user_with_no_debts_is_an_answer_not_an_error(client):
    headers = _register(client)
    body = client.get("/api/debts/payoff", headers=headers).json()
    assert body["snowball"]["months"] == 0
    assert body["snowball"]["unavailable_reason"] is None
    assert body["interest_saved_cents"] == 0


def test_an_unpayable_budget_returns_a_refusal_not_a_500(client):
    headers = _register(client)
    _create(client, headers, principal_cents=100_000, annual_rate_bps=1200,
            minimum_payment_cents=500, term_months=None)
    body = client.get("/api/debts/payoff", headers=headers).json()
    assert body["snowball"]["months"] is None
    assert "intérêts" in body["snowball"]["unavailable_reason"]
    assert body["interest_saved_cents"] is None


def test_a_negative_extra_payment_is_refused(client):
    headers = _register(client)
    response = client.get("/api/debts/payoff", headers=headers, params={"extra_cents": -1})
    assert response.status_code == 422


def test_debts_never_cross_users(client):
    """Both directions. Phase 2A shipped a cross-tenant test proving exclusion
    only from the empty side; this one seeds both users and checks each sees
    exactly their own."""
    alice = _register(client, "alice@example.fr")
    bob = _register(client, "bob@example.fr")
    _create(client, alice, name="Auto Alice")
    bob_debt = _create(client, bob, name="Auto Bob").json()

    assert [d["name"] for d in client.get("/api/debts", headers=alice).json()] == ["Auto Alice"]
    assert [d["name"] for d in client.get("/api/debts", headers=bob).json()] == ["Auto Bob"]
    assert client.delete(f"/api/debts/{bob_debt['id']}", headers=alice).status_code == 404
    assert client.patch(f"/api/debts/{bob_debt['id']}", headers=alice,
                        json={"name": "volé"}).status_code == 404
    # And Bob's debt is untouched by the two refused attempts.
    assert client.get("/api/debts", headers=bob).json()[0]["name"] == "Auto Bob"


def test_debts_never_cross_users_on_payoff(client):
    """The brief calls out isolation on the payoff comparison explicitly: a
    debt belonging to another user must not appear in the budget or the
    schedule -- a leak here would silently overstate the caller's own budget
    (their minimums summed with a stranger's) and reveal a stranger's debt
    name and balance in the response body."""
    alice = _register(client, "alice2@example.fr")
    bob = _register(client, "bob2@example.fr")
    _create(client, bob, name="Auto Bob", principal_cents=999_999_00,
            minimum_payment_cents=50_000)

    body = client.get("/api/debts/payoff", headers=alice).json()
    assert body["snowball"]["months"] == 0
    assert body["snowball"]["order"] == []
    assert body["snowball"]["monthly_budget_cents"] == 0


def test_an_archived_debt_drops_out_of_the_payoff(client):
    headers = _register(client)
    debt_id = _create(client, headers).json()["id"]
    client.delete(f"/api/debts/{debt_id}", headers=headers)

    body = client.get("/api/debts/payoff", headers=headers).json()
    assert body["snowball"]["months"] == 0
    assert body["snowball"]["order"] == []


def test_patching_a_debt_updates_only_the_given_fields(client):
    headers = _register(client)
    debt_id = _create(client, headers).json()["id"]
    patched = client.patch(f"/api/debts/{debt_id}", headers=headers,
                           json={"minimum_payment_cents": 30_000}).json()
    assert patched["minimum_payment_cents"] == 30_000
    assert patched["name"] == "Crédit auto"


def test_patching_to_an_unknown_kind_is_refused_in_french(client):
    headers = _register(client)
    debt_id = _create(client, headers).json()["id"]
    response = client.patch(f"/api/debts/{debt_id}", headers=headers,
                            json={"kind": "extraterrestre"})
    assert response.status_code == 422
    assert "Type de dette inconnu" in response.json()["detail"]


def test_a_malformed_payload_is_refused_in_french(client):
    headers = _register(client)
    response = client.post("/api/debts", headers=headers, json={"name": "Sans capital"})
    assert response.status_code == 422
    detail = response.json()["detail"]
    assert any("capital" in str(item).lower() for item in detail)


def test_an_unknown_debt_id_is_a_404_not_found(client):
    headers = _register(client)
    assert client.patch("/api/debts/999999", headers=headers,
                        json={"name": "fantôme"}).status_code == 404
    assert client.delete("/api/debts/999999", headers=headers).status_code == 404
