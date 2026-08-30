"""POST/GET/DELETE /api/feasibility/scenarios.

A scenario stores the QUESTION, never the computed answer -- see
`models.Scenario`'s docstring. Every read recomputes the feasibility answer
against the CURRENT ledger, which is the entire point of the feature: a
verdict measured on last winter's statements must not replay as though it
were current. `test_a_saved_scenario_follows_the_ledger_rather_than_freezing_it`
is the test that proves it, by changing the ledger between write and read.
"""

from datetime import date

from app.models import Account, Transaction, User


def _register(client, email="scenarios@example.fr"):
    body = client.post("/api/auth/register", json={
        "name": "Max", "email": email, "password": "motdepasse123"}).json()
    return {"Authorization": f"Bearer {body['access_token']}"}


def _user_id(db, email: str) -> int:
    return db.query(User).filter(User.email == email).one().id


def _account(db, user_id: int) -> Account:
    account = Account(user_id=user_id, name="Courant", kind="checking", currency="EUR",
                      opening_balance_cents=0, include_in_net_worth=True, archived=False)
    db.add(account)
    db.flush()
    return account


def _tx(db, user_id, account_id, on, amount, label):
    row = Transaction(user_id=user_id, account_id=account_id, date=on,
                      amount_cents=amount, label_raw=label, label_clean=label.lower(),
                      category_id=None, category_source="uncategorized",
                      is_transfer=False, dedup_hash=f"{on}{amount}{label}{account_id}",
                      tags=[])
    db.add(row)
    return row


REQUEST = {"target_cents": 4_000_000, "horizon_months": 12,
           "down_payment_cents": 0, "nature": "vehicle"}


def test_a_scenario_round_trips_with_its_result_recomputed(client):
    headers = _register(client)
    created = client.post("/api/feasibility/scenarios", headers=headers,
                          json={"name": "Voiture 2027", "request": REQUEST})
    assert created.status_code == 201
    listed = client.get("/api/feasibility/scenarios", headers=headers).json()
    assert [item["name"] for item in listed] == ["Voiture 2027"]
    assert listed[0]["request"]["target_cents"] == 4_000_000
    # The RESULT is present and was computed now, not stored.
    assert "verdict" in listed[0]["result"]


def test_a_saved_scenario_follows_the_ledger_rather_than_freezing_it(client, db):
    """The whole reason the payload holds the question and not the answer. A
    verdict measured on last winter's statements, replayed months later as
    though it were current, is exactly the staleness `api/cashflow.py` documents
    for its clock -- and worse here, because the capacity input is measured.

    The brief's own version of this test used the shared `imported` fixture
    (the Boursorama sample), which holds transactions from a single month --
    `months_observed` (complete months only) is 0 both before and after the
    deletion below, so `before != after` could never distinguish a real
    recomputation from a frozen cache; it would have passed either way. Seeded
    here instead, the same way `test_feasibility_api.py` seeds its own
    isolation tests: three complete, profitable months, so `before` carries a
    genuine positive capacity and verdict that `after` must lose."""
    headers = _register(client)
    user_id = _user_id(db, "scenarios@example.fr")
    account = _account(db, user_id)
    for month in (1, 2, 3, 4, 5):
        _tx(db, user_id, account.id, date(2025, month, 15), 300_000, f"SALAIRE {month}")
        _tx(db, user_id, account.id, date(2025, month, 20), -100_000, f"DEPENSE {month}")
    db.commit()

    client.post("/api/feasibility/scenarios", headers=headers,
                json={"name": "Voiture", "request": REQUEST})
    before = client.get("/api/feasibility/scenarios", headers=headers).json()[0]["result"]
    assert before["months_observed"] == 3
    assert before["capacity"]["median_cents"] == 200_000
    assert before["verdict"] is not None

    # Delete every transaction just seeded, so the measurement changes.
    for tx in client.get("/api/transactions", headers=headers,
                         params={"limit": 500}).json()["items"]:
        client.delete(f"/api/transactions/{tx['id']}", headers=headers)

    after = client.get("/api/feasibility/scenarios", headers=headers).json()[0]["result"]
    assert after["months_observed"] == 0
    assert after["capacity"] is None
    assert after["verdict"] is None
    assert before["months_observed"] != after["months_observed"]


def test_a_stored_payload_is_validated_on_the_way_back_out(client, db):
    """The database is not an input this code controls. A row whose payload no
    longer parses must surface as a French 422 naming the scenario, not as an
    untranslated 500 that takes the whole list down with it.

    The corruption is applied through the session directly, because that is the
    only way to reach the state -- writing it through the API is impossible by
    construction, which is exactly why the read path needs its own guard.
    """
    from app.models import Scenario

    headers = _register(client)
    client.post("/api/feasibility/scenarios", headers=headers,
                json={"name": "Cassé", "request": REQUEST})
    row = db.query(Scenario).one()
    row.payload = '{"target_cents": "quarante mille euros"}'
    db.commit()

    response = client.get("/api/feasibility/scenarios", headers=headers)
    assert response.status_code == 422
    assert "Cassé" in response.json()["detail"]


def test_a_stored_payload_with_a_retired_field_still_recomputes(client, db):
    """A payload written by an older schema version can carry a field the
    current `FeasibilityIn` no longer declares. Pydantic's default is to
    ignore unknown fields on validation rather than reject them, so a scenario
    saved before a field was retired keeps working -- it is not treated as
    corrupt, unlike `test_a_stored_payload_is_validated_on_the_way_back_out`
    where the SHAPE of a still-known field is wrong."""
    from app.models import Scenario

    headers = _register(client)
    client.post("/api/feasibility/scenarios", headers=headers,
                json={"name": "Ancien format", "request": REQUEST})
    row = db.query(Scenario).one()
    row.payload = (
        '{"target_cents": 4000000, "horizon_months": 12, '
        '"down_payment_cents": 0, "nature": "vehicle", '
        '"retired_field_no_longer_supported": true}'
    )
    db.commit()

    response = client.get("/api/feasibility/scenarios", headers=headers)
    assert response.status_code == 200
    assert response.json()[0]["request"]["target_cents"] == 4_000_000


def test_deleting_a_scenario_removes_it(client):
    headers = _register(client)
    created = client.post("/api/feasibility/scenarios", headers=headers,
                          json={"name": "Voiture", "request": REQUEST}).json()
    assert client.delete(f"/api/feasibility/scenarios/{created['id']}",
                         headers=headers).status_code == 204
    assert client.get("/api/feasibility/scenarios", headers=headers).json() == []


def test_the_number_of_saved_scenarios_is_bounded(client):
    """Each read recomputes a full feasibility answer, which walks the ledger.
    An unbounded list turns one page load into arbitrarily many computations."""
    headers = _register(client)
    response = None
    for index in range(20):
        response = client.post("/api/feasibility/scenarios", headers=headers,
                               json={"name": f"S{index}", "request": REQUEST})
    assert response.status_code == 422
    assert "scénarios" in response.json()["detail"]


def test_scenarios_never_cross_users(client):
    alice = _register(client, "alice4@example.fr")
    bob = _register(client, "bob4@example.fr")
    client.post("/api/feasibility/scenarios", headers=alice,
                json={"name": "Alice", "request": REQUEST})
    bob_scenario = client.post("/api/feasibility/scenarios", headers=bob,
                               json={"name": "Bob", "request": REQUEST}).json()

    # Bob's own read proves the seeding above actually landed, so the assertion
    # below (that Alice sees none of it) cannot pass vacuously.
    assert len(client.get("/api/feasibility/scenarios", headers=bob).json()) == 1

    assert [s["name"] for s in client.get("/api/feasibility/scenarios",
                                          headers=alice).json()] == ["Alice"]
    assert client.delete(f"/api/feasibility/scenarios/{bob_scenario['id']}",
                         headers=alice).status_code == 404
    assert len(client.get("/api/feasibility/scenarios", headers=bob).json()) == 1


def test_saving_an_invalid_request_is_refused_before_it_is_stored(client):
    """The `request` field is validated by `FeasibilityIn` on the way in, same
    as `POST /api/feasibility` itself -- a scenario is never created from a
    payload that would not have produced an answer."""
    headers = _register(client)
    response = client.post("/api/feasibility/scenarios", headers=headers,
                           json={"name": "Invalide",
                                 "request": {**REQUEST, "target_cents": 0}})
    assert response.status_code == 422
    assert client.get("/api/feasibility/scenarios", headers=headers).json() == []


def test_a_scenario_of_a_different_kind_never_surfaces_here(client, db):
    """`/api/feasibility/scenarios` is scoped to `kind="feasibility"`, the only
    kind this router ever writes. A row of some other or unrecognised kind
    (a future simulator's own scenario, or manual DB tampering) must not be
    listed here and parsed as a feasibility request -- that would either 500
    on a payload shaped for a different question, or silently answer a
    question that was never asked."""
    from app.models import Scenario

    headers = _register(client)
    user_id = client.get("/api/feasibility/scenarios", headers=headers)
    assert user_id.status_code == 200  # sanity: route works before we tamper

    from app.models import User
    uid = db.query(User).one().id
    row = Scenario(user_id=uid, name="Autre nature", kind="unknown_kind", payload="{}")
    db.add(row)
    db.commit()

    listed = client.get("/api/feasibility/scenarios", headers=headers).json()
    assert listed == []
