"""GET /api/engagement, and POST .../challenges/{id}/accept|reject.

Mirrors `tests/test_feasibility_api.py`'s isolation pattern (a second user
with a real ledger, checked first so the seeding cannot pass vacuously) and
`tests/test_patch_nulls.py`'s directness about the exact refusal each branch
must produce.
"""

from datetime import date, timedelta

from app.api.engagement import _insert_snapshot_ignoring_conflict
from app.engines.health import HealthScore
from app.models import Account, Challenge, HealthSnapshot, Transaction, User


def _register(client, email="engagement@example.fr"):
    body = client.post("/api/auth/register", json={
        "name": "Max", "email": email, "password": "motdepasse123"}).json()
    return {"Authorization": f"Bearer {body['access_token']}"}


def _user_id(db, email: str) -> int:
    return db.query(User).filter(User.email == email).one().id


def _account(db, user_id: int, opening_balance_cents: int = 2_000_000) -> Account:
    account = Account(user_id=user_id, name="Courant", kind="checking", currency="EUR",
                      opening_balance_cents=opening_balance_cents,
                      include_in_net_worth=True, archived=False)
    db.add(account)
    db.flush()
    return account


def _tx(db, user_id, account_id, on, amount, label="TX", category_id=None):
    row = Transaction(user_id=user_id, account_id=account_id, date=on,
                      amount_cents=amount, label_raw=label, label_clean=label.lower(),
                      category_id=category_id, category_source="uncategorized",
                      is_transfer=False, dedup_hash=f"{on}{amount}{label}{account_id}",
                      tags=[])
    db.add(row)
    return row


def _category(client, headers, slug: str) -> dict:
    categories = client.get("/api/categories", headers=headers).json()
    return next(c for c in categories if c["slug"] == slug)


def _seed_bobs_ledger(client, db, headers, user_id: int) -> dict:
    """Five months (Jan-May 2025) producing, deterministically:

    * three complete observed months (Feb, Mar, Apr -- the ledger opens on
      10 January and closes on 25 May, so both edge months are partial);
    * a positive, measurable savings capacity and income rate;
    * three complete months of essential spend (`alimentation-courses`);
    * a category (`loisirs-vacances`) over its own 20 000 c budget in all
      three complete months -- `MIN_OVERRUN_MONTHS` exactly;
    * a monthly, annualisable, still-active subscription (`NETFLIX.COM`),
      five occurrences 30 days apart.

    Returns the two category dicts the tests key off.
    """
    account = _account(db, user_id)
    essential = _category(client, headers, "alimentation-courses")
    loisirs = _category(client, headers, "loisirs-vacances")
    client.patch(f"/api/categories/{loisirs['id']}", headers=headers,
                json={"monthly_budget_cents": 20_000})

    for month in (1, 2, 3, 4, 5):
        _tx(db, user_id, account.id, date(2025, month, 15), 300_000, f"SALAIRE {month}")
        _tx(db, user_id, account.id, date(2025, month, 10), -50_000, f"COURSES {month}",
            category_id=essential["id"])
        _tx(db, user_id, account.id, date(2025, month, 20), -25_000, f"LOISIRS {month}",
            category_id=loisirs["id"])
        _tx(db, user_id, account.id, date(2025, month, 25), -3_400, "NETFLIX.COM")
    # One extra, one-off charge in April only, on the budgeted category --
    # this is what gives the accept/measure test below a genuine, non-zero
    # before/after delta to observe.
    _tx(db, user_id, account.id, date(2025, 4, 5), -8_000, "CINE AVRIL", category_id=loisirs["id"])
    db.commit()
    return {"essential": essential, "loisirs": loisirs}


# ---------------------------------------------------------------------------
# A user with no transactions at all
# ---------------------------------------------------------------------------


def test_a_user_with_no_transactions_gets_honest_refusals_everywhere(client):
    headers = _register(client)
    body = client.get("/api/engagement", headers=headers).json()

    assert body["streak"]["current"] == 0
    assert body["streak"]["broken_reason"] == (
        "Aucun relevé n'a encore été importé : le suivi n'a pas commencé."
    )
    assert body["goals"] == []
    assert body["health"]["score"] is None
    assert body["health"]["unavailable_reason"] is not None
    assert body["health"]["history"] == []
    assert body["health"]["previous_taken_on"] is None
    assert body["health"]["score_delta"] is None
    assert body["challenges"] == []


# ---------------------------------------------------------------------------
# Isolation: Bob's real ledger must never leak into Alice's empty one.
# ---------------------------------------------------------------------------


def test_engagement_isolation_holds_on_every_measured_field(client, db):
    """Bob's own report is asserted first, so this test cannot pass
    vacuously: if the seeding below had silently written nothing, Alice's
    report would look identical to what it is asserted to be regardless."""
    alice = _register(client, "alice-eng@example.fr")
    bob = _register(client, "bob-eng@example.fr")
    bob_id = _user_id(db, "bob-eng@example.fr")
    _seed_bobs_ledger(client, db, bob, bob_id)
    client.post("/api/goals", headers=bob, json={
        "name": "Fonds d'urgence", "target_cents": 600_000, "saved_cents": 0, "priority": 1})

    bob_body = client.get("/api/engagement", headers=bob).json()
    # `current` reads 0 honestly: Bob's ledger stops in May 2025, and today
    # is real -- a household that stopped importing eighteen months ago has
    # a broken streak, not a live one. `longest` still proves the five
    # consecutive months the seeding actually built.
    assert bob_body["streak"]["longest"] >= 5
    assert bob_body["streak"]["broken_reason"] is not None
    assert bob_body["goals"][0]["name"] == "Fonds d'urgence"
    assert bob_body["health"]["score"] is not None
    kinds = {c["kind"] for c in bob_body["challenges"]}
    assert "unused_subscription" in kinds
    assert "budget_overrun" in kinds

    alice_body = client.get("/api/engagement", headers=alice).json()
    assert alice_body["streak"]["current"] == 0
    assert alice_body["goals"] == []
    assert alice_body["health"]["score"] is None
    assert alice_body["challenges"] == []


# ---------------------------------------------------------------------------
# Accept / reject state machine
# ---------------------------------------------------------------------------


def _first_challenge_id(body: dict) -> int:
    return body["challenges"][0]["id"]


def test_accepting_a_challenge_twice_is_refused_the_second_time(client, db):
    headers = _register(client, "accept-twice@example.fr")
    user_id = _user_id(db, "accept-twice@example.fr")
    _seed_bobs_ledger(client, db, headers, user_id)
    body = client.get("/api/engagement", headers=headers).json()
    challenge_id = _first_challenge_id(body)

    first = client.post(f"/api/engagement/challenges/{challenge_id}/accept", headers=headers)
    assert first.status_code == 200
    assert first.json()["state"] == "accepted"

    second = client.post(f"/api/engagement/challenges/{challenge_id}/accept", headers=headers)
    assert second.status_code == 422
    assert "déjà été accepté" in second.json()["detail"]


def test_rejecting_an_already_accepted_challenge_is_refused(client, db):
    headers = _register(client, "reject-after-accept@example.fr")
    user_id = _user_id(db, "reject-after-accept@example.fr")
    _seed_bobs_ledger(client, db, headers, user_id)
    body = client.get("/api/engagement", headers=headers).json()
    challenge_id = _first_challenge_id(body)

    client.post(f"/api/engagement/challenges/{challenge_id}/accept", headers=headers)
    response = client.post(f"/api/engagement/challenges/{challenge_id}/reject", headers=headers)
    assert response.status_code == 422
    assert "déjà été accepté" in response.json()["detail"]


def test_accepting_another_users_challenge_is_a_404_not_a_leak(client, db):
    headers_a = _register(client, "owner@example.fr")
    user_a = _user_id(db, "owner@example.fr")
    _seed_bobs_ledger(client, db, headers_a, user_a)
    body = client.get("/api/engagement", headers=headers_a).json()
    challenge_id = _first_challenge_id(body)

    headers_b = _register(client, "intruder@example.fr")
    response = client.post(f"/api/engagement/challenges/{challenge_id}/accept",
                           headers=headers_b)
    assert response.status_code == 404

    # And the challenge is untouched -- still available to its real owner.
    still_proposed = next(
        c for c in client.get("/api/engagement", headers=headers_a).json()["challenges"]
        if c["id"] == challenge_id
    )
    assert still_proposed["state"] == "proposed"


# ---------------------------------------------------------------------------
# Health snapshots: at most once a day, and never a duplicate row.
# ---------------------------------------------------------------------------


def test_two_reads_the_same_day_write_exactly_one_snapshot(client, db):
    headers = _register(client, "same-day@example.fr")
    user_id = _user_id(db, "same-day@example.fr")
    _seed_bobs_ledger(client, db, headers, user_id)

    first = client.get("/api/engagement", headers=headers).json()
    second = client.get("/api/engagement", headers=headers).json()
    assert first["health"]["score"] == second["health"]["score"]

    rows = db.query(HealthSnapshot).filter(HealthSnapshot.user_id == user_id).all()
    assert len(rows) == 1
    assert rows[0].taken_on == date.today()
    assert rows[0].score == first["health"]["score"]

    # And the challenge list did not grow a duplicate set on the second read.
    challenge_rows = db.query(Challenge).filter(Challenge.user_id == user_id).count()
    assert challenge_rows == len(second["challenges"])


def test_a_concurrent_snapshot_write_is_dropped_not_a_crash(db):
    """Exercises the true race directly: a row for today already committed
    -- as if another request won -- before this call ever runs, bypassing
    `_write_snapshot_if_missing`'s own existence check entirely. The insert
    must be caught and rolled back, never raise, and the winning row must
    survive untouched."""
    user = User(email="race@example.fr", name="Race", password_hash="x",
               role="user", is_active=True)
    db.add(user)
    db.flush()
    today = date.today()
    db.add(HealthSnapshot(user_id=user.id, taken_on=today, score=99, components="[]"))
    db.commit()

    _insert_snapshot_ignoring_conflict(
        db, user.id, today, HealthScore(score=55, components=[], unavailable_reason=None)
    )

    rows = db.query(HealthSnapshot).filter(HealthSnapshot.user_id == user.id).all()
    assert len(rows) == 1
    assert rows[0].score == 99  # the already-committed row, untouched


# ---------------------------------------------------------------------------
# "Ce qui l'a fait bouger": the delta against a real STORED snapshot.
# ---------------------------------------------------------------------------


def test_the_health_delta_is_against_the_previous_stored_snapshot(client, db):
    """A snapshot is seeded for yesterday with a score this ledger's live
    recomputation would never produce on its own (0, with every component
    unmeasured) -- if the delta were instead computed by recomputing today's
    inputs at yesterday's date, it would silently ignore this row and this
    assertion would fail."""
    headers = _register(client, "delta@example.fr")
    user_id = _user_id(db, "delta@example.fr")
    _seed_bobs_ledger(client, db, headers, user_id)

    yesterday = date.today() - timedelta(days=1)
    db.add(HealthSnapshot(
        user_id=user_id, taken_on=yesterday, score=0,
        components='[{"key": "savings_rate", "label": "Taux d\'épargne", "weight": 30, '
                    '"score": 0, "measured_value": 0.0, "unavailable_reason": null}]',
    ))
    db.commit()

    body = client.get("/api/engagement", headers=headers).json()
    assert body["health"]["previous_taken_on"] == yesterday.isoformat()
    assert body["health"]["score_delta"] == body["health"]["score"] - 0

    savings = next(c for c in body["health"]["components"] if c["key"] == "savings_rate")
    assert savings["score"] is not None
    assert savings["delta_score"] == savings["score"] - 0


# ---------------------------------------------------------------------------
# measure_outcome, end to end through acceptance and a later read.
# ---------------------------------------------------------------------------


def test_a_freshly_accepted_challenge_reports_not_enough_time_elapsed(client, db):
    headers = _register(client, "fresh-accept@example.fr")
    user_id = _user_id(db, "fresh-accept@example.fr")
    _seed_bobs_ledger(client, db, headers, user_id)
    challenge_id = _first_challenge_id(client.get("/api/engagement", headers=headers).json())
    client.post(f"/api/engagement/challenges/{challenge_id}/accept", headers=headers)

    body = client.get("/api/engagement", headers=headers).json()
    accepted = next(c for c in body["challenges"] if c["id"] == challenge_id)
    assert accepted["measured_cents"] is None
    assert "Pas assez de temps écoulé" in accepted["outcome_unavailable_reason"]


def test_an_accepted_challenges_outcome_is_measured_and_persisted(client, db):
    """Accept the budget-overrun challenge on `loisirs-vacances`, then
    backdate its acceptance (as if it had been accepted back in March 2025 --
    the real `date.today()` the accept route reads cannot itself be moved in
    a test) so that both the complete month before (February) and the
    complete month after (April) sit inside Bob's own seeded ledger. April
    carries one extra 8 000 c charge on the same category the March data
    does not, so the measured outcome must be exactly -8 000 c -- spent MORE
    afterward, not a zero."""
    headers = _register(client, "measured@example.fr")
    user_id = _user_id(db, "measured@example.fr")
    seeded = _seed_bobs_ledger(client, db, headers, user_id)
    loisirs_id = seeded["loisirs"]["id"]

    body = client.get("/api/engagement", headers=headers).json()
    overrun = next(c for c in body["challenges"] if c["kind"] == "budget_overrun")
    client.post(f"/api/engagement/challenges/{overrun['id']}/accept", headers=headers)

    db.query(Challenge).filter(Challenge.id == overrun["id"]).update(
        {"decided_on": date(2025, 3, 10)}
    )
    db.commit()

    measured_body = client.get("/api/engagement", headers=headers).json()
    result = next(c for c in measured_body["challenges"] if c["id"] == overrun["id"])
    assert result["category_id"] == loisirs_id
    assert result["outcome_unavailable_reason"] is None
    assert result["measured_cents"] == -8_000
    assert result["measured_on"] == "2025-04-30"

    row = db.query(Challenge).filter(Challenge.id == overrun["id"]).one()
    assert row.measured_cents == -8_000
    assert row.measured_on == date(2025, 4, 30)

    # A further read must not recompute or drift.
    again = client.get("/api/engagement", headers=headers).json()
    again_result = next(c for c in again["challenges"] if c["id"] == overrun["id"])
    assert again_result["measured_cents"] == -8_000
