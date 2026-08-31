"""POST /api/feasibility and GET /api/feasibility/context.

Mirrors `tests/test_goals_api.py`'s isolation pattern -- a second user with a
real ledger, checked both ways, so a `None`/zero on the first user's side
cannot pass vacuously if the seeding silently wrote nothing.
"""

from datetime import date

import pytest

from app.engines.amortization import monthly_payment_cents
from app.models import Account, Category, Transaction, User
from app.schemas.feasibility import MAX_LOAN_MONTHS, FinancingOptionOut, LeverOut


def _register(client, email="faisabilite@example.fr"):
    body = client.post("/api/auth/register", json={
        "name": "Max", "email": email, "password": "motdepasse123"}).json()
    return {"Authorization": f"Bearer {body['access_token']}"}


def _user_id(db, email: str) -> int:
    return db.query(User).filter(User.email == email).one().id


def _account(db, user_id: int, opening_balance_cents: int = 0) -> Account:
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


REQUEST = {"target_cents": 4_000_000, "horizon_months": 12,
           "down_payment_cents": 0, "nature": "vehicle"}


# --------------------------------------------------------------------------
# The brief's own scenarios.
# --------------------------------------------------------------------------


def test_a_household_with_no_history_gets_a_refusal_not_a_verdict(client):
    headers = _register(client)
    body = client.post("/api/feasibility", headers=headers, json=REQUEST).json()
    assert body["verdict"] is None
    assert body["capacity"] is None
    assert "trois mois complets" in body["capacity_unavailable_reason"]
    # And no levers at all -- five refusals repeating one sentence is not five
    # options.
    assert body["levers"] == []
    # The cost of ownership does NOT depend on the capacity and is still there.
    assert body["ownership"]["total_cost_cents"] > 0


def test_the_context_route_prefills_only_what_it_measured(client):
    headers = _register(client)
    body = client.get("/api/feasibility/context", headers=headers).json()
    assert body["capacity"] is None
    assert body["expense_rate"] is None
    assert body["income_rate"] is None
    assert body["months_observed"] == 0
    assert body["balance_cents"] == 0
    assert body["existing_debt_payments_cents"] == 0
    # The assumptions ARE prefilled -- they are declared defaults, not
    # measurements, and the screen prints them as such.
    assert body["assumptions"]["annual_return_bps"] == 300


def test_existing_debt_instalments_feed_the_debt_ratio(client):
    headers = _register(client)
    client.post("/api/debts", headers=headers, json={
        "name": "Conso", "kind": "consumer", "principal_cents": 500_000,
        "annual_rate_bps": 600, "minimum_payment_cents": 15_000, "term_months": 36})
    body = client.get("/api/feasibility/context", headers=headers).json()
    assert body["existing_debt_payments_cents"] == 15_000


def test_an_archived_debt_no_longer_counts(client):
    headers = _register(client)
    debt = client.post("/api/debts", headers=headers, json={
        "name": "Conso", "kind": "consumer", "principal_cents": 500_000,
        "annual_rate_bps": 600, "minimum_payment_cents": 15_000,
        "term_months": 36}).json()
    client.delete(f"/api/debts/{debt['id']}", headers=headers)
    assert client.get("/api/feasibility/context",
                      headers=headers).json()["existing_debt_payments_cents"] == 0


def test_the_full_answer_is_produced_from_real_transactions(client, imported):
    headers, _account_id = imported
    body = client.post("/api/feasibility", headers=headers, json=REQUEST).json()
    assert set(body) >= {"verdict", "capacity", "gap_cents", "levers", "financing",
                         "ownership", "impact", "opportunity_cost_cents"}
    if body["capacity"] is None:
        assert body["verdict"] is None and body["levers"] == []
    else:
        assert body["verdict"] in ("comfortable", "tight", "out_of_reach")
        assert len(body["levers"]) == 5
        # Feasible levers first -- the documented ordering, on the wire.
        flags = [lever["feasible"] for lever in body["levers"]]
        assert flags == sorted(flags, reverse=True)


def test_the_vehicle_defaults_are_returned_and_are_overridable(client):
    headers = _register(client)
    default = client.post("/api/feasibility", headers=headers, json=REQUEST).json()
    assert {line["key"] for line in default["ownership"]["lines"]} == {
        "insurance", "maintenance", "fuel"}

    custom = client.post("/api/feasibility", headers=headers, json={
        **REQUEST,
        "ownership_items": [
            {"key": "insurance", "label": "Assurance", "monthly_cents": 9_000,
             "annual_bps_of_value": None}],
    }).json()
    assert {line["key"] for line in custom["ownership"]["lines"]} == {"insurance"}
    assert custom["ownership"]["lines"][0]["total_cents"] == 9_000 * 60


def test_an_engine_refusal_arrives_as_a_french_422_not_a_500(client):
    headers = _register(client)
    response = client.post("/api/feasibility", headers=headers, json={
        **REQUEST, "ownership_items": [
            {"key": "x", "label": "Assurance", "monthly_cents": 100,
             "annual_bps_of_value": 100}]})
    assert response.status_code == 422
    assert "Assurance" in response.json()["detail"]


def test_a_target_of_zero_is_refused_in_french(client):
    headers = _register(client)
    response = client.post("/api/feasibility", headers=headers,
                           json={**REQUEST, "target_cents": 0})
    assert response.status_code == 422


def test_loa_terms_travel_through_to_the_comparison(client):
    headers = _register(client)
    body = client.post("/api/feasibility", headers=headers, json={
        **REQUEST, "loa": {"deposit_cents": 300_000, "monthly_cents": 25_000,
                           "months": 48, "residual_cents": 800_000}}).json()
    loa = {option["kind"]: option for option in body["financing"]["options"]}["loa"]
    assert loa["available"] is True
    assert loa["total_paid_cents"] == 300_000 + 25_000 * 48 + 800_000
    assert loa["wealth_at_end_cents"] is None


def test_feasibility_never_reads_another_users_data(client):
    """Both directions, and on the MEASURED inputs specifically: a second
    user's statements must not widen this user's capacity."""
    alice = _register(client, "alice3@example.fr")
    bob = _register(client, "bob3@example.fr")
    client.post("/api/debts", headers=bob, json={
        "name": "Bob", "kind": "consumer", "principal_cents": 500_000,
        "annual_rate_bps": 600, "minimum_payment_cents": 15_000, "term_months": 36})
    alice_context = client.get("/api/feasibility/context", headers=alice).json()
    bob_context = client.get("/api/feasibility/context", headers=bob).json()
    assert alice_context["existing_debt_payments_cents"] == 0
    assert bob_context["existing_debt_payments_cents"] == 15_000


def test_every_lever_field_survives_the_wire(client, imported):
    """`LeverOut(**lever.__dict__)` in the router only works while the
    dataclass fields and the schema fields are identical in name -- a drift
    between the two would raise a `TypeError` at runtime on whichever lever
    kind carries the extra field, not at import time."""
    headers, _account_id = imported
    body = client.post("/api/feasibility", headers=headers, json=REQUEST).json()
    if not body["levers"]:
        return
    expected = set(LeverOut.model_fields)
    for lever in body["levers"]:
        assert set(lever) == expected


def test_every_financing_option_field_survives_the_wire(client, imported):
    """The same `**dataclass.__dict__` spread the router uses for levers is
    also used for `FinancingOptionOut` -- the same drift risk, the same guard."""
    headers, _account_id = imported
    body = client.post("/api/feasibility", headers=headers, json=REQUEST).json()
    expected = set(FinancingOptionOut.model_fields)
    for option in body["financing"]["options"]:
        assert set(option) == expected


# --------------------------------------------------------------------------
# Isolation, beyond the debts-only case above: capacity, income and expense
# rate, and the liquid balance must all come from the requesting user's own
# ledger.
# --------------------------------------------------------------------------


def test_context_isolation_holds_on_every_measured_field(client, db):
    """Alice must see none of Bob's ledger. Bob's own report is asserted
    first, so this test cannot pass vacuously: if the seeding below had
    silently written nothing, Alice's report would look identical to what it
    is asserted to be regardless."""
    alice = _register(client, "alice4@example.fr")
    bob = _register(client, "bob4@example.fr")
    bob_id = _user_id(db, "bob4@example.fr")
    bob_account = _account(db, bob_id, opening_balance_cents=1_000_000)
    for month in (1, 2, 3, 4, 5):
        _tx(db, bob_id, bob_account.id, date(2025, month, 15), 300_000, f"SALAIRE {month}")
        _tx(db, bob_id, bob_account.id, date(2025, month, 20), -100_000, f"DEPENSE {month}")
    db.commit()
    client.post("/api/debts", headers=bob, json={
        "name": "Conso", "kind": "consumer", "principal_cents": 500_000,
        "annual_rate_bps": 600, "minimum_payment_cents": 15_000, "term_months": 36})

    # Bob's own report proves the seeding actually landed.
    bob_context = client.get("/api/feasibility/context", headers=bob).json()
    assert bob_context["months_observed"] == 3
    assert bob_context["capacity"]["median_cents"] == 200_000
    assert bob_context["balance_cents"] == 1_000_000 + (300_000 - 100_000) * 5
    assert bob_context["existing_debt_payments_cents"] == 15_000
    assert bob_context["history"] is not None

    alice_context = client.get("/api/feasibility/context", headers=alice).json()
    assert alice_context["months_observed"] == 0
    assert alice_context["capacity"] is None
    assert alice_context["expense_rate"] is None
    assert alice_context["income_rate"] is None
    assert alice_context["balance_cents"] == 0
    assert alice_context["existing_debt_payments_cents"] == 0
    assert alice_context["history"] is None


def test_post_isolation_holds_on_the_measured_capacity(client, db):
    """The same isolation, through the POST route this time: Bob's real,
    positive capacity must never widen Alice's verdict on her own empty ledger."""
    alice = _register(client, "alice5@example.fr")
    bob = _register(client, "bob5@example.fr")
    bob_id = _user_id(db, "bob5@example.fr")
    bob_account = _account(db, bob_id)
    for month in (1, 2, 3, 4, 5):
        _tx(db, bob_id, bob_account.id, date(2025, month, 15), 300_000, f"SALAIRE {month}")
        _tx(db, bob_id, bob_account.id, date(2025, month, 20), -100_000, f"DEPENSE {month}")
    db.commit()

    bob_body = client.post("/api/feasibility", headers=bob, json=REQUEST).json()
    assert bob_body["capacity"]["median_cents"] == 200_000
    assert bob_body["verdict"] is not None

    alice_body = client.post("/api/feasibility", headers=alice, json=REQUEST).json()
    assert alice_body["capacity"] is None
    assert alice_body["verdict"] is None


# --------------------------------------------------------------------------
# Beyond the happy path.
# --------------------------------------------------------------------------


def test_a_malformed_payload_is_refused_in_french(client):
    headers = _register(client)
    response = client.post("/api/feasibility", headers=headers,
                           json={"target_cents": "pas un nombre"})
    assert response.status_code == 422
    assert response.json()["detail"]


def test_a_down_payment_above_the_price_is_refused_in_french(client):
    headers = _register(client)
    response = client.post("/api/feasibility", headers=headers, json={
        **REQUEST, "down_payment_cents": REQUEST["target_cents"] + 1})
    assert response.status_code == 422
    assert "apport" in response.json()["detail"].lower()


def test_horizon_of_one_month_and_the_maximum_are_both_accepted(client):
    headers = _register(client)
    for months in (1, 600):
        response = client.post("/api/feasibility", headers=headers,
                               json={**REQUEST, "horizon_months": months})
        assert response.status_code == 200
    response = client.post("/api/feasibility", headers=headers,
                           json={**REQUEST, "horizon_months": 601})
    assert response.status_code == 422


def test_loan_months_at_below_and_above_the_bound(client):
    headers = _register(client)
    for months in (1, 60, MAX_LOAN_MONTHS):
        response = client.post("/api/feasibility", headers=headers,
                               json={**REQUEST, "loan_months": months})
        assert response.status_code == 200, months
    response = client.post("/api/feasibility", headers=headers,
                           json={**REQUEST, "loan_months": MAX_LOAN_MONTHS + 1})
    assert response.status_code == 422


def test_a_loan_rate_of_zero_and_the_maximum_are_both_priced(client):
    headers = _register(client)
    for rate in (0, 3000):
        response = client.post("/api/feasibility", headers=headers,
                               json={**REQUEST, "loan_rate_bps": rate})
        assert response.status_code == 200, rate
    response = client.post("/api/feasibility", headers=headers,
                           json={**REQUEST, "loan_rate_bps": 3001})
    assert response.status_code == 422


def test_an_unknown_nature_is_refused_in_french(client):
    headers = _register(client)
    response = client.post("/api/feasibility", headers=headers,
                           json={**REQUEST, "nature": "bateau"})
    assert response.status_code == 422
    assert "bateau" in response.json()["detail"]


def test_fewer_than_three_months_of_transactions_still_refuses(client, db):
    """Two complete months -- real history, one short of the floor -- must
    refuse exactly like the zero-history case, not read as a longer ledger."""
    headers = _register(client, "peu@example.fr")
    user_id = _user_id(db, "peu@example.fr")
    account = _account(db, user_id)
    # Jan is partial at the ledger's own start, Apr partial at its own end:
    # Feb and Mar are the only two COMPLETE months.
    for month in (1, 2, 3, 4):
        _tx(db, user_id, account.id, date(2025, month, 15), -50_000, f"DEPENSE {month}")
    db.commit()
    body = client.post("/api/feasibility", headers=headers, json=REQUEST).json()
    assert body["months_observed"] == 2
    assert body["capacity"] is None
    assert "trois mois complets" in body["capacity_unavailable_reason"]


def test_a_user_whose_measured_capacity_is_negative_gets_out_of_reach(client, db):
    """The operator's own state, reproduced directly: three complete months,
    each spending more than it earns. The verdict must be a real answer, not a
    refusal, and the gap must be printed larger than the price -- never
    clamped, never `abs()`'d. See `engines/feasibility.py`'s module docstring."""
    headers = _register(client, "negatif@example.fr")
    user_id = _user_id(db, "negatif@example.fr")
    account = _account(db, user_id)
    for month in (1, 2, 3, 4, 5):
        _tx(db, user_id, account.id, date(2025, month, 15), -50_000, f"DEPENSE {month}")
    db.commit()
    body = client.post("/api/feasibility", headers=headers, json=REQUEST).json()
    assert body["months_observed"] == 3
    assert body["capacity"]["median_cents"] == -50_000
    assert body["verdict"] == "out_of_reach"
    # The pot shrinks over the horizon, so the gap is LARGER than the price --
    # never clamped, never flipped positive-looking-comfortable.
    assert body["gap_cents"] > body["target_cents"]

    save_more = next(lever for lever in body["levers"] if lever["kind"] == "save_more")
    assert save_more["feasible"] is True
    # A ratio against a negative measured capacity is not an effort.
    assert save_more["effort_ratio"] is None

    delay = next(lever for lever in body["levers"] if lever["kind"] == "delay")
    assert delay["feasible"] is False

    reduce_target = next(lever for lever in body["levers"] if lever["kind"] == "reduce_target")
    assert reduce_target["feasible"] is False

    borrow = next(lever for lever in body["levers"] if lever["kind"] == "borrow")
    assert borrow["feasible"] is True
    assert borrow["borrow_cents"] == body["gap_cents"]


def test_the_cut_category_lever_names_a_real_category_from_the_ledger(client, db):
    """`_category_history` -- the router's own per-category aggregation, built
    from real transactions -- only runs when a household both has a measured
    capacity AND categorized spending. Every other test in this file leaves
    every transaction uncategorized, which never exercises the accumulation
    loop at all; this one does, end to end, through the `cut_category` lever."""
    headers = _register(client, "categorise@example.fr")
    user_id = _user_id(db, "categorise@example.fr")
    account = _account(db, user_id)
    # Registration auto-seeds a French category tree (`categorization/seed.py`),
    # which already owns the "loisirs" slug -- a distinct name/slug here avoids
    # the unique constraint on (user_id, slug).
    category = Category(user_id=user_id, parent_id=None, name="Croisieres",
                        slug="croisieres-test", kind="expense", color="#7ee2d6",
                        icon="circle", monthly_budget_cents=None, position=0,
                        is_essential=False)
    db.add(category)
    db.flush()
    for month in (1, 2, 3, 4, 5):
        _tx(db, user_id, account.id, date(2025, month, 10), 400_000, f"SALAIRE {month}")
        _tx(db, user_id, account.id, date(2025, month, 20), -300_000, f"CROISIERE {month}",
           category_id=category.id)
    db.commit()

    body = client.post("/api/feasibility", headers=headers, json=REQUEST).json()
    assert body["capacity"]["median_cents"] == 100_000

    cut = next(lever for lever in body["levers"] if lever["kind"] == "cut_category")
    assert cut["category_name"] == "Croisieres"
    assert cut["months_observed"] == 3
    assert cut["category_median_cents"] == 300_000
    assert cut["feasible"] is True


# --------------------------------------------------------------------------
# The `loan_months` bound: task 12's carry-forward.
# --------------------------------------------------------------------------


def test_the_loan_months_bound_keeps_amortisations_refusal_unreachable():
    """`levers._borrow` and `levers.compare_financing` both price a loan at
    `assumptions.loan_months` and the caller's own `loan_rate_bps`, with no
    per-lever guard: a `ValueError` there aborts `build_levers` entirely and
    costs all FIVE levers, not just `borrow`. `schemas.feasibility.
    MAX_LOAN_MONTHS` bounds `loan_months` at the wire so that refusal cannot
    fire for any gap this screen is built to report.

    Proven at the worst case the wire actually allows: the maximum searched
    rate (`loan_rate_bps`'s own ceiling, 3 000 bps), the maximum term
    (`MAX_LOAN_MONTHS`), over a sweep of gaps from the documented safe floor
    (33,67 EUR, `schemas.feasibility.MAX_LOAN_MONTHS`'s own docstring) up
    through 100 000 EUR -- spanning the scale of real purchases, including the
    operator's own 48 954,28 EUR shortfall.

    The last assertion is the mutation check: one month past the bound, at a
    capital the wire would otherwise forbid asking for, the SAME guard DOES
    fire -- confirming this test is not vacuously passing because the guard
    never fires at all.
    """
    rate_bps = 3000
    safe_floor_cents = 3367  # just above the 33,67 EUR proven-safe threshold
    for gap_cents in range(safe_floor_cents, 10_000_000, 104_729):
        monthly_payment_cents(gap_cents, rate_bps, MAX_LOAN_MONTHS)  # must not raise

    with pytest.raises(ValueError):
        monthly_payment_cents(20, rate_bps, MAX_LOAN_MONTHS + 1)


def test_an_unpriceable_credit_line_does_not_cost_the_whole_report(client):
    """`amortization` refuses a loan whose instalment would not cover the first
    month's interest. Both `levers._borrow` and `compare_financing` let that
    raise, and the router answers any `ValueError` with a 422 -- so a 20 000 €
    car bought with a 19 990 € apport, asked about over fifteen years at
    30 %/an, came back as an error with no verdict, no capacity and none of the
    five levers.

    The refusal belongs to the credit line alone. Everything else must still
    answer, and `better_kind` must be null rather than naming cash the winner
    of a race with one runner.
    """
    headers = _register(client, "reliquat@example.fr")
    body = client.post("/api/feasibility", headers=headers, json={
        "target_cents": 2_000_000, "horizon_months": 12,
        "down_payment_cents": 1_999_000, "nature": "vehicle",
        "loan_rate_bps": 3000, "loan_months": 180,
    })
    assert body.status_code == 200
    payload = body.json()
    # This user has no ledger, so the verdict itself refuses -- for its own
    # cause, stated in French. What matters here is that the refusal is the
    # CAPACITY's, not a 422 swallowing the entire answer.
    assert payload["verdict"] is None
    assert "trois mois complets" in payload["capacity_unavailable_reason"]

    financing = payload["financing"]
    assert financing["better_kind"] is None
    assert financing["wealth_gap_cents"] is None
    credit = next(o for o in financing["options"] if o["kind"] == "credit")
    assert credit["available"] is False
    assert "trop faible" in credit["unavailable_reason"]
    cash = next(o for o in financing["options"] if o["kind"] == "cash")
    assert cash["available"] is True
    assert cash["total_paid_cents"] == 2_000_000


def test_the_context_publishes_the_prefilled_ownership_items_it_expects_back(client):
    """Design §6.3 item 3 requires the running-cost items to be "préremplis par
    des moyennes françaises et ajustables". `POST /api/feasibility` already
    accepts `ownership_items`, but nothing published what the defaults ARE, so
    a screen could not prefill a form the user could then adjust — it could
    only take whatever the server silently applied.

    The defaults travel per nature, in the same shape the POST accepts back, so
    the round trip is a straight edit rather than a translation.
    """
    headers = _register(client, "postes@example.fr")
    defaults = client.get("/api/feasibility/context", headers=headers).json()[
        "ownership_defaults"]

    assert set(defaults) == {"vehicle", "property", "other"}
    vehicle = defaults["vehicle"]
    assert vehicle["depreciation_bps_per_year"] == 1500
    assert [item["key"] for item in vehicle["items"]] == ["insurance", "maintenance", "fuel"]
    # Exactly one of the two is set on every published item -- the same
    # invariant the engine enforces on the way in.
    for item in vehicle["items"]:
        assert (item["monthly_cents"] is None) != (item["annual_bps_of_value"] is None)
    # Property is not assumed to lose value; "other" prefills nothing at all.
    assert defaults["property"]["depreciation_bps_per_year"] == 0
    assert defaults["other"]["items"] == []

    # And what it publishes is accepted back verbatim.
    echoed = client.post("/api/feasibility", headers=headers, json={
        "target_cents": 4_000_000, "horizon_months": 12, "down_payment_cents": 0,
        "nature": "vehicle", "ownership_items": vehicle["items"],
    })
    assert echoed.status_code == 200


def test_the_emergency_impact_names_the_burn_behind_its_months(client, db):
    """Design §10: the assumption travels beside the result it produced. A
    runway of "4 mois" is meaningless without the monthly burn it divides by,
    and `engines/feasibility.py` publishes `monthly_burn_cents` for exactly
    that reason — the wire shape dropped it.
    """
    email = "brulure@example.fr"
    headers = _register(client, email)
    user_id = _user_id(db, email)
    account = Account(user_id=user_id, name="Courant", kind="checking", currency="EUR",
                      opening_balance_cents=5_000_000, include_in_net_worth=True,
                      archived=False)
    db.add(account)
    db.flush()
    for month in (1, 2, 3, 4, 5):
        _tx(db, user_id, account.id, date(2025, month, 10), 300_000, f"SALAIRE {month}")
        _tx(db, user_id, account.id, date(2025, month, 15), -200_000, f"DEPENSE {month}")
    db.commit()

    emergency = client.post("/api/feasibility", headers=headers, json={
        "target_cents": 100_000, "horizon_months": 12, "down_payment_cents": 0,
        "nature": "other",
    }).json()["impact"]["emergency"]

    assert emergency["unavailable_reason"] is None
    assert emergency["runway_months_before"] is not None
    assert emergency["monthly_burn_cents"] == 200_000


def test_a_category_absent_from_a_month_counts_that_month_as_zero(client, db):
    """`CategoryHistory.monthly_cents` is "one entry per complete observed
    month". `_category_history` was building one entry per month the category
    HAPPENED to appear in, so a rent paid once in three months had a median of
    its single payment rather than of {0, 0, 780} -- and won "la plus lourde"
    over a category actually spent every month.

    The card then printed that figure under "Ce qu'il coûte un mois normal",
    and the refusal asserted the heaviest category "coûte moins que cela un
    mois normal" -- false for a month in which it cost nothing at all. The same
    wrong denominator fed `months_observed`, so the screen also mis-stated how
    many months it had looked at.

    `test_the_cut_category_lever_names_a_real_category_from_the_ledger` cannot
    catch this: its category is present in every month, where the two
    definitions agree.
    """
    email = "trous@example.fr"
    headers = _register(client, email)
    user_id = _user_id(db, email)
    account = Account(user_id=user_id, name="Courant", kind="checking", currency="EUR",
                      opening_balance_cents=1_000_000, include_in_net_worth=True,
                      archived=False)
    db.add(account)
    category = Category(user_id=user_id, name="Loyer", slug="loyer", kind="expense",
                        color="#7ee2d6", icon="home", position=1, is_essential=True)
    db.add(category)
    db.flush()

    # Feb, Mar and Apr 2025 are the three complete months; the rent is paid in
    # April only. Salary every month so a capacity can be measured at all.
    for month in (1, 2, 3, 4, 5):
        _tx(db, user_id, account.id, date(2025, month, 5), 300_000, f"SALAIRE {month}")
        _tx(db, user_id, account.id, date(2025, month, 20), -10_000, f"COURSES {month}")
    _tx(db, user_id, account.id, date(2025, 4, 3), -78_000, "LOYER",
        category_id=category.id)
    db.commit()

    levers = client.post("/api/feasibility", headers=headers, json={
        "target_cents": 50_000_000, "horizon_months": 12,
        "down_payment_cents": 0, "nature": "other",
    }).json()["levers"]

    cut = next(lever for lever in levers if lever["kind"] == "cut_category")
    assert cut["months_observed"] == 3
    # Median of {0, 0, 78 000}, not of {78 000}.
    assert cut["category_median_cents"] == 0
