"""A value declared on an envelope, and an envelope deleted for good.

Two gaps the household hit on the Patrimoine screen.

**Nothing could be declared.** An assurance-vie holding a fonds euros has a real
amount in it and no quoted instrument to hang it on, and the only way into an
`InvestmentAccount` was a `Position`, which needs an `Instrument`. So the screen
said "Aucune position dans cette enveloppe pour l'instant" over an envelope
worth thousands.

**Nothing could be removed.** `DELETE /portfolio/accounts/{id}` archived, which
is right for an account that carries history and wrong for one created by
mistake: it stayed in the list for ever with no way out.

The properties held here:

* a declared amount is added to the portfolio total and to nothing else. It has
  no cost basis, so it is kept out of `cost_basis_cents` and out of
  `unrealised_gain_cents` -- a figure a household read off a statement is not a
  gain, and folding it in would invent one;
* it is reported separately, never merged into the positions, so the screen can
  always say which part of the total was measured from prices and which part was
  declared;
* a purge is explicit and total. It takes the envelope, its positions and their
  lots; anything short of that leaves rows pointing at an account that is gone.
"""

from datetime import date

from app.models import InvestmentAccount, Lot, Position


def _register(client, email: str = "max@example.com") -> dict[str, str]:
    body = client.post("/api/auth/register", json={
        "name": "Max", "email": email, "password": "motdepasse123"}).json()
    return {"Authorization": f"Bearer {body['access_token']}"}


def _envelope(client, headers, **overrides) -> dict:
    payload = {"name": "MACIF", "kind": "assurance_vie", "opened_on": "2001-08-30"}
    payload.update(overrides)
    return client.post("/api/portfolio/accounts", headers=headers, json=payload).json()


def test_an_envelope_can_carry_a_declared_amount(client):
    headers = _register(client)
    envelope = _envelope(client, headers)

    body = client.patch(f"/api/portfolio/accounts/{envelope['id']}", headers=headers, json={
        "declared_value_cents": 1_450_000, "declared_value_on": "2026-08-31"}).json()

    assert body["declared_value_cents"] == 1_450_000
    assert body["declared_value_on"] == "2026-08-31"


def test_an_envelope_can_be_created_with_one(client):
    headers = _register(client)
    envelope = _envelope(client, headers, declared_value_cents=1_450_000,
                         declared_value_on="2026-08-31")
    assert envelope["declared_value_cents"] == 1_450_000


def test_the_declared_amount_can_be_taken_back_off(client):
    """Nullable on purpose: an envelope whose positions now cover everything it
    holds must be able to stop declaring a second figure, or the two would be
    counted together for ever."""
    headers = _register(client)
    envelope = _envelope(client, headers, declared_value_cents=1_450_000)

    body = client.patch(f"/api/portfolio/accounts/{envelope['id']}", headers=headers,
                        json={"declared_value_cents": None}).json()

    assert body["declared_value_cents"] is None


def test_a_negative_declared_amount_is_refused(client):
    headers = _register(client)
    envelope = _envelope(client, headers)

    response = client.patch(f"/api/portfolio/accounts/{envelope['id']}", headers=headers,
                            json={"declared_value_cents": -1})

    assert response.status_code == 422


def test_the_valuation_reports_the_declared_amounts_apart_from_the_positions(client):
    headers = _register(client)
    envelope = _envelope(client, headers, declared_value_cents=1_450_000,
                         declared_value_on="2026-08-31")

    body = client.get("/api/portfolio/valuation", headers=headers).json()

    assert body["declared_total_cents"] == 1_450_000
    declared = body["declared"][0]
    assert declared["account_id"] == envelope["id"]
    assert declared["name"] == "MACIF"
    assert declared["value_cents"] == 1_450_000
    assert declared["declared_on"] == "2026-08-31"


def test_a_declared_amount_adds_to_the_total_and_to_no_other_figure(client):
    headers = _register(client)
    _envelope(client, headers, declared_value_cents=1_450_000)

    total = client.get("/api/portfolio/valuation", headers=headers).json()["total"]

    assert total["market_value_cents"] == 1_450_000
    # No price was read and no cost was paid through this application: a figure
    # copied off a statement is not a gain.
    assert total["cost_basis_cents"] == 0
    assert total["unrealised_gain_cents"] == 0
    assert total["positions_total"] == 0


def test_an_archived_envelope_stops_being_counted(client):
    headers = _register(client)
    envelope = _envelope(client, headers, declared_value_cents=1_450_000)
    client.patch(f"/api/portfolio/accounts/{envelope['id']}", headers=headers,
                 json={"archived": True})

    body = client.get("/api/portfolio/valuation", headers=headers).json()

    assert body["declared_total_cents"] == 0
    assert body["declared"] == []


def test_an_envelope_is_archived_by_default(client):
    headers = _register(client)
    envelope = _envelope(client, headers)

    assert client.delete(f"/api/portfolio/accounts/{envelope['id']}",
                         headers=headers).status_code == 204
    row = client.get("/api/portfolio/accounts?archived=true", headers=headers).json()
    assert [account["archived"] for account in row] == [True]


def test_a_purge_takes_the_envelope_its_positions_and_their_lots(client, db):
    headers = _register(client)
    envelope = _envelope(client, headers)
    instrument = client.post("/api/portfolio/instruments", headers=headers, json={
        "symbol": "AAPL", "name": "Apple Inc.", "asset_class": "equity",
        "currency": "USD", "is_fractionable": False}).json()
    position = client.post("/api/portfolio/positions", headers=headers, json={
        "investment_account_id": envelope["id"], "instrument_id": instrument["id"]}).json()
    client.post("/api/portfolio/lots", headers=headers, json={
        "position_id": position["id"], "quantity": "10", "unit_cost_cents": 15_000,
        "acquired_on": "2024-01-05"})

    response = client.delete(f"/api/portfolio/accounts/{envelope['id']}?purge=true",
                             headers=headers)

    assert response.status_code == 204
    assert db.query(InvestmentAccount).count() == 0
    assert db.query(Position).count() == 0
    assert db.query(Lot).count() == 0


def test_a_purge_leaves_another_envelope_alone(client, db):
    headers = _register(client)
    doomed = _envelope(client, headers)
    kept = _envelope(client, headers, name="PEA")

    client.delete(f"/api/portfolio/accounts/{doomed['id']}?purge=true", headers=headers)

    assert [row.id for row in db.query(InvestmentAccount).all()] == [kept["id"]]


def test_another_users_envelope_cannot_be_purged(client, db):
    headers = _register(client)
    envelope = _envelope(client, headers)
    other = _register(client, "lea@example.com")

    response = client.delete(f"/api/portfolio/accounts/{envelope['id']}?purge=true",
                             headers=other)

    assert response.status_code == 404
    assert db.query(InvestmentAccount).count() == 1


def test_the_declared_date_is_not_required(client):
    """An amount without a date is still an amount. The screen says how old it
    is when it knows, and says nothing when it does not -- it never invents
    today."""
    headers = _register(client)
    envelope = _envelope(client, headers, declared_value_cents=1_450_000)

    assert envelope["declared_value_on"] is None


def test_a_declared_date_can_be_cleared(client):
    headers = _register(client)
    envelope = _envelope(client, headers, declared_value_cents=1_450_000,
                         declared_value_on="2026-08-31")

    body = client.patch(f"/api/portfolio/accounts/{envelope['id']}", headers=headers,
                        json={"declared_value_on": None}).json()

    assert body["declared_value_on"] is None
    assert body["declared_value_cents"] == 1_450_000


def test_a_declared_date_in_the_future_is_refused(client):
    headers = _register(client)
    envelope = _envelope(client, headers)

    response = client.patch(f"/api/portfolio/accounts/{envelope['id']}", headers=headers,
                            json={"declared_value_on": str(date(2999, 1, 1))})

    assert response.status_code == 422
