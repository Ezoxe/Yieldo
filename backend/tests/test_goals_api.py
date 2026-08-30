"""GET/POST/PATCH/DELETE /api/goals.

Mirrors `tests/test_debts_api.py`'s shape (registration helper, `_create`
helper, isolation both ways) since `api/goals.py` mirrors `api/debts.py`.
Adds coverage the brief's own six tests do not reach: the shared
`not_nullable` guard on every NOT NULL column, a negative measured capacity
end-to-end (the operator's own state per the phase's Global Constraints), and
a due date in the past.
"""

from datetime import date

from app.models import Account, Transaction, User


def _register(client, email="objectifs@example.fr"):
    body = client.post("/api/auth/register", json={
        "name": "Max", "email": email, "password": "motdepasse123"}).json()
    return {"Authorization": f"Bearer {body['access_token']}"}


def _create(client, headers, **overrides):
    payload = {"name": "Fonds d'urgence", "target_cents": 600_000, "saved_cents": 100_000,
               "due_on": None, "priority": 1}
    payload.update(overrides)
    return client.post("/api/goals", headers=headers, json=payload)


def test_a_goal_round_trips_and_archives(client):
    headers = _register(client)
    created = _create(client, headers)
    assert created.status_code == 201
    goal_id = created.json()["id"]
    assert client.delete(f"/api/goals/{goal_id}", headers=headers).status_code == 204
    assert client.get("/api/goals", headers=headers).json()["goals"] == []


def test_a_goal_target_must_be_strictly_positive(client):
    headers = _register(client)
    assert _create(client, headers, target_cents=0).status_code == 422


def test_progress_refuses_without_enough_history(client):
    """A brand-new user has no transactions, so `measure_savings_capacity`
    returns None and every goal says so -- with the month-count reason, not
    the negative-capacity one."""
    headers = _register(client)
    _create(client, headers)
    body = client.get("/api/goals", headers=headers).json()
    assert body["capacity"] is None
    progress = body["goals"][0]
    assert progress["months_to_completion"] is None
    assert "trois mois complets" in progress["projection_unavailable_reason"]
    assert body["months_observed"] == 0


def test_progress_is_measured_from_real_transactions(client, imported):
    """`imported` seeds the Boursorama sample. Whatever it measures, the
    payload must state the sample size beside the figure -- a rate quoted
    without its provenance invites the reader to treat it as a certainty."""
    headers, _account_id = imported
    _create(client, headers)
    body = client.get("/api/goals", headers=headers).json()
    assert body["months_observed"] >= 0
    if body["capacity"] is not None:
        assert body["capacity"]["months"] == body["months_observed"]
        assert body["capacity"]["low_cents"] <= body["capacity"]["median_cents"]
        assert body["capacity"]["median_cents"] <= body["capacity"]["high_cents"]


def test_goals_are_returned_in_funding_order_with_their_wait(client):
    headers = _register(client)
    _create(client, headers, name="Voyage", target_cents=300_000, saved_cents=0, priority=200)
    _create(client, headers, name="Urgence", target_cents=500_000, saved_cents=0, priority=1)
    body = client.get("/api/goals", headers=headers).json()
    assert [g["name"] for g in body["goals"]] == ["Urgence", "Voyage"]
    assert body["goals"][0]["funding_starts_in_months"] == 0


def test_the_milestones_are_the_four_the_engagement_phase_will_read(client):
    headers = _register(client)
    _create(client, headers)
    [progress] = client.get("/api/goals", headers=headers).json()["goals"]
    assert [m["percent"] for m in progress["milestones"]] == [25, 50, 75, 100]
    assert [m["threshold_cents"] for m in progress["milestones"]] == [
        150_000, 300_000, 450_000, 600_000]


def test_goals_never_cross_users(client):
    alice = _register(client, "alice2@example.fr")
    bob = _register(client, "bob2@example.fr")
    _create(client, alice, name="Alice")
    bob_goal = _create(client, bob, name="Bob").json()
    assert [g["name"] for g in client.get("/api/goals", headers=alice).json()["goals"]] == ["Alice"]
    assert [g["name"] for g in client.get("/api/goals", headers=bob).json()["goals"]] == ["Bob"]
    assert client.patch(f"/api/goals/{bob_goal['id']}", headers=alice,
                        json={"name": "volé"}).status_code == 404
    assert client.get("/api/goals", headers=bob).json()["goals"][0]["name"] == "Bob"


# --- Self-review additions beyond the brief's six tests -------------------


def test_a_malformed_payload_is_refused_in_french(client):
    headers = _register(client)
    response = client.post("/api/goals", headers=headers, json={"name": "Sans cible"})
    assert response.status_code == 422
    detail = response.json()["detail"]
    assert any("cible" in str(item).lower() for item in detail)


def test_saved_cents_may_exceed_the_target_and_still_reads_overfunded(client):
    """`remaining_cents` is floored at 0, but `progress_ratio` is deliberately
    NOT clamped -- an overfunded goal must still read above 1.0 rather than
    being silently rejected at creation."""
    headers = _register(client)
    created = _create(client, headers, target_cents=100_000, saved_cents=150_000)
    assert created.status_code == 201
    [progress] = client.get("/api/goals", headers=headers).json()["goals"]
    assert progress["remaining_cents"] == 0
    assert progress["progress_ratio"] > 1.0


def test_a_due_date_in_the_past_is_accepted_and_reads_off_track(client):
    """No validator forbids a past due date -- a goal can genuinely be
    overdue, and the engine's `on_track` verdict is what tells the user, not
    a 422 at creation time."""
    headers = _register(client)
    _create(client, headers, due_on="2020-01-01")
    [progress] = client.get("/api/goals", headers=headers).json()["goals"]
    assert progress["due_on"] == "2020-01-01"
    assert progress["months_until_due"] < 0


def test_two_goals_sharing_a_priority_are_ordered_by_id(client):
    headers = _register(client)
    first = _create(client, headers, name="Premier", priority=5).json()
    second = _create(client, headers, name="Second", priority=5).json()
    assert first["priority"] == second["priority"]
    body = client.get("/api/goals", headers=headers).json()
    assert [g["name"] for g in body["goals"]] == ["Premier", "Second"]


def test_an_unknown_goal_id_is_a_404_not_found(client):
    headers = _register(client)
    assert client.patch("/api/goals/999999", headers=headers,
                        json={"name": "fantôme"}).status_code == 404
    assert client.delete("/api/goals/999999", headers=headers).status_code == 404


def test_patching_a_goal_updates_only_the_given_fields(client):
    headers = _register(client)
    goal_id = _create(client, headers).json()["id"]
    patched = client.patch(f"/api/goals/{goal_id}", headers=headers,
                           json={"saved_cents": 200_000}).json()
    assert patched["saved_cents"] == 200_000
    assert patched["name"] == "Fonds d'urgence"


def test_patch_clearing_the_due_date_is_a_legitimate_edit(client):
    """`due_on` is the one nullable column: an explicit null must succeed,
    unlike every other patchable field on this schema."""
    headers = _register(client)
    goal_id = _create(client, headers, due_on="2030-01-01").json()["id"]
    patched = client.patch(f"/api/goals/{goal_id}", headers=headers,
                           json={"due_on": None}).json()
    assert patched["due_on"] is None


def test_an_explicit_null_on_each_not_nullable_field_is_a_french_422_not_a_500(client):
    headers = _register(client)
    goal_id = _create(client, headers).json()["id"]
    for field in ("name", "target_cents", "saved_cents", "priority", "archived"):
        response = client.patch(f"/api/goals/{goal_id}", headers=headers,
                                json={field: None})
        assert response.status_code == 422, field
        detail = response.json()["detail"]
        assert any("vidé" in item["msg"].lower() for item in detail), field


def test_an_archived_goal_drops_out_of_the_progress_queue_too(client):
    """DELETE archives. An archived goal must not still absorb capacity and
    push every other goal's funding start back."""
    headers = _register(client)
    urgent = _create(client, headers, name="Urgence", priority=1).json()
    _create(client, headers, name="Voyage", priority=2)
    client.delete(f"/api/goals/{urgent['id']}", headers=headers)

    body = client.get("/api/goals", headers=headers).json()
    assert [g["name"] for g in body["goals"]] == ["Voyage"]
    assert body["goals"][0]["funding_starts_in_months"] == 0


def _user_id(db, email: str) -> int:
    return db.query(User).filter(User.email == email).one().id


def _tx(db, user_id, account_id, on, amount, label="TX"):
    row = Transaction(user_id=user_id, account_id=account_id, date=on,
                      amount_cents=amount, label_raw=label, label_clean=label.lower(),
                      category_id=None, category_source="uncategorized",
                      is_transfer=False, dedup_hash=f"{on}{amount}{label}{account_id}",
                      tags=[])
    db.add(row)
    return row


def test_progress_against_a_negative_measured_capacity_names_the_right_cause(client, db):
    """Three complete months, each spending more than it earns: a real,
    negative `measure_savings_capacity`. The goal must not progress, and the
    reason must name the negative capacity, not the month count -- the
    distinction `engines/goal.py`'s module docstring calls out by name."""
    email = "negatif@example.fr"
    headers = _register(client, email)
    user_id = _user_id(db, email)
    account = Account(user_id=user_id, name="Courant", kind="checking", currency="EUR",
                      opening_balance_cents=0, include_in_net_worth=True, archived=False)
    db.add(account)
    db.flush()

    # Feb, Mar, Apr 2025 are the three complete months (Jan is partial at the
    # ledger's start, May is partial at its end) -- same reasoning
    # `capacity.complete_months`'s own docstring walks through.
    for month in (1, 2, 3, 4, 5):
        _tx(db, user_id, account.id, date(2025, month, 15), -50_000, f"DEPENSE {month}")
    db.commit()

    _create(client, headers, target_cents=600_000, saved_cents=0)
    body = client.get("/api/goals", headers=headers).json()
    assert body["months_observed"] == 3
    assert body["capacity"]["median_cents"] < 0
    progress = body["goals"][0]
    assert progress["months_to_completion"] is None
    assert "négative ou nulle" in progress["projection_unavailable_reason"]


def test_progress_isolation_uses_only_the_requesting_users_own_capacity(client, db):
    """Alice's goal progress must be measured from Alice's own transactions,
    never Bob's -- even though `evaluate_goals` runs once per request with
    whatever `monthly_capacity_cents` the router hands it."""
    alice_email, bob_email = "alice3@example.fr", "bob3@example.fr"
    alice = _register(client, alice_email)
    bob = _register(client, bob_email)
    bob_id = _user_id(db, bob_email)
    bob_account = Account(user_id=bob_id, name="Courant", kind="checking", currency="EUR",
                          opening_balance_cents=0, include_in_net_worth=True, archived=False)
    db.add(bob_account)
    db.flush()
    for month in (1, 2, 3, 4, 5):
        _tx(db, bob_id, bob_account.id, date(2025, month, 15), -50_000, f"BOB {month}")
    db.commit()

    _create(client, alice)
    body = client.get("/api/goals", headers=alice).json()
    assert body["months_observed"] == 0
    assert body["capacity"] is None
    # Bob's side, so Alice's `None` cannot pass vacuously: if the seeding above
    # had written nothing, her report would look identical.
    _create(client, bob)
    bob_body = client.get("/api/goals", headers=bob).json()
    assert bob_body["months_observed"] == 3
    assert bob_body["capacity"]["median_cents"] < 0


def _three_positive_months(db, client, email: str) -> dict[str, str]:
    """A user with a real, small, POSITIVE measured capacity.

    The mirror of `test_progress_against_a_negative_measured_capacity...`:
    Feb, Mar and Apr 2025 are the three complete months, January and May bound
    the ledger. 100 c a month is deliberately tiny, so a large target runs past
    the fifty-year cap without needing an absurd target.
    """
    headers = _register(client, email)
    user_id = _user_id(db, email)
    account = Account(user_id=user_id, name="Courant", kind="checking", currency="EUR",
                      opening_balance_cents=0, include_in_net_worth=True, archived=False)
    db.add(account)
    db.flush()
    for month in (1, 2, 3, 4, 5):
        _tx(db, user_id, account.id, date(2025, month, 10), 100_100, f"SALAIRE {month}")
        _tx(db, user_id, account.id, date(2025, month, 15), -100_000, f"DEPENSE {month}")
    db.commit()
    return headers


def test_a_target_past_the_fifty_year_cap_says_so_over_the_wire(client, db):
    """The third of the engine's four refusals, exercised end to end. It was
    only ever covered at the engine level, and task 9's screen has to render
    what the API actually sends -- an assumed shape is how a screen ends up
    printing a spinner where a sentence belongs.
    """
    headers = _three_positive_months(db, client, "trop-loin@example.fr")
    _create(client, headers, name="Château", target_cents=500_000_000, saved_cents=0)
    body = client.get("/api/goals", headers=headers).json()

    assert body["capacity"]["median_cents"] > 0
    progress = body["goals"][0]
    assert progress["months_to_completion"] is None
    assert progress["projected_completion_on"] is None
    assert "50 ans" in progress["projection_unavailable_reason"]
    assert "trois mois complets" not in progress["projection_unavailable_reason"]


def test_a_goal_queued_behind_an_unreachable_one_says_which_one(client, db):
    """The fourth refusal, end to end. Sequential funding means a goal behind
    an unreachable one never starts either, and the sentence must name the
    BLOCKER rather than blaming this goal's own size -- here a 20 EUR goal
    stuck behind a 5 000 000 EUR one.
    """
    headers = _three_positive_months(db, client, "bloque@example.fr")
    _create(client, headers, name="Château", target_cents=500_000_000,
            saved_cents=0, priority=1)
    _create(client, headers, name="Casque", target_cents=2_000, saved_cents=0, priority=2)
    body = client.get("/api/goals", headers=headers).json()

    chateau, casque = body["goals"]
    assert chateau["name"] == "Château"
    assert casque["name"] == "Casque"
    assert casque["months_to_completion"] is None
    assert "Château" in casque["projection_unavailable_reason"]
    assert "plus urgent" in casque["projection_unavailable_reason"]
    # The blocker's own horizon is named, so "50 ans" legitimately appears --
    # what must NOT appear is the sentence blaming this goal's own size.
    assert "ne serait pas atteint" not in casque["projection_unavailable_reason"]
