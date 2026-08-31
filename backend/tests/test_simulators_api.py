"""POST /api/simulators/{credit,epargne,immobilier} and GET /api/simulators/context.

Figures are the ones hand-verified in Tasks 1, 2 and 17
(`test_amortization.py`, `test_savings.py`, `test_property.py`); they are
reused here, not re-derived, so a wire-shape bug cannot hide behind a number
that happens to agree with itself.
"""

from datetime import date

from app.models import Account, Transaction, User


def _register(client, email="simulateurs@example.fr"):
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


def _tx(db, user_id, account_id, on, amount, label="TX"):
    row = Transaction(user_id=user_id, account_id=account_id, date=on,
                      amount_cents=amount, label_raw=label, label_clean=label.lower(),
                      category_id=None, category_source="uncategorized",
                      is_transfer=False, dedup_hash=f"{on}{amount}{label}{account_id}",
                      tags=[])
    db.add(row)
    return row


PROPERTY_REQUEST = {
    "price_cents": 30_000_000, "down_payment_cents": 6_000_000, "notary_bps": 750,
    "loan_rate_bps": 350, "loan_months": 240, "insurance_bps_per_year": 36,
    "monthly_charges_cents": 15_000, "annual_property_tax_cents": 120_000,
}


# --------------------------------------------------------------------------
# Credit.
# --------------------------------------------------------------------------


def test_a_credit_schedule_matches_the_engine_to_the_cent(client):
    headers = _register(client)
    body = client.post("/api/simulators/credit", headers=headers, json={
        "principal_cents": 10_000_000, "annual_rate_bps": 300, "months": 240}).json()
    assert body["monthly_payment_cents"] == 55_460
    assert body["total_interest_cents"] == 3_310_324
    assert len(body["rows"]) == 240
    # The yearly roll-up is what the chart draws: 20 bars, and the parts sum
    # back to the whole.
    assert len(body["years"]) == 20
    assert sum(y["interest_cents"] for y in body["years"]) == body["total_interest_cents"]
    assert sum(y["principal_cents"] for y in body["years"]) == 10_000_000
    # Each year's remaining balance is the schedule's own row at that point.
    assert body["years"][-1]["remaining_cents"] == 0
    assert body["years"][0]["remaining_cents"] == body["rows"][11]["remaining_cents"]


def test_a_credit_of_zero_months_is_refused_in_french(client):
    headers = _register(client)
    response = client.post("/api/simulators/credit", headers=headers, json={
        "principal_cents": 10_000_000, "annual_rate_bps": 300, "months": 0})
    assert response.status_code == 422
    assert "durée" in response.json()["detail"]


def test_a_credit_longer_than_forty_years_is_refused_in_french(client):
    headers = _register(client)
    response = client.post("/api/simulators/credit", headers=headers, json={
        "principal_cents": 10_000_000, "annual_rate_bps": 300, "months": 481})
    assert response.status_code == 422
    assert "480" in response.json()["detail"]


def test_a_credit_at_exactly_forty_years_is_accepted(client):
    """The bound is inclusive: 480 months is forty years and a real term,
    not an off-by-one past it."""
    headers = _register(client)
    response = client.post("/api/simulators/credit", headers=headers, json={
        "principal_cents": 10_000_000, "annual_rate_bps": 300, "months": 480})
    assert response.status_code == 200
    assert len(response.json()["rows"]) == 480


def test_a_credit_of_zero_principal_borrows_nothing(client):
    """Borrowing nothing is a real answer, not an invalid input -- see
    `amortization.build_schedule`'s own docstring."""
    headers = _register(client)
    body = client.post("/api/simulators/credit", headers=headers, json={
        "principal_cents": 0, "annual_rate_bps": 300, "months": 12}).json()
    assert body["monthly_payment_cents"] == 0
    assert body["rows"] == []
    assert body["years"] == []


def test_a_credit_unpriceable_at_its_own_rate_and_term_refuses_in_french(client):
    """A level payment that would not cover the first month's interest: a
    tiny capital spread over a long term at a punitive rate."""
    headers = _register(client)
    response = client.post("/api/simulators/credit", headers=headers, json={
        "principal_cents": 100, "annual_rate_bps": 3000, "months": 480})
    assert response.status_code == 422
    assert "intérêts" in response.json()["detail"]


def test_a_malformed_credit_payload_is_refused_in_french(client):
    headers = _register(client)
    response = client.post("/api/simulators/credit", headers=headers,
                           json={"principal_cents": "pas un nombre"})
    assert response.status_code == 422
    assert response.json()["detail"]


def test_credit_requires_authentication(client):
    response = client.post("/api/simulators/credit", json={
        "principal_cents": 10_000_000, "annual_rate_bps": 300, "months": 240})
    assert response.status_code == 401


# --------------------------------------------------------------------------
# Épargne.
# --------------------------------------------------------------------------


def test_a_savings_projection_returns_its_points(client):
    headers = _register(client)
    body = client.post("/api/simulators/epargne", headers=headers, json={
        "initial_cents": 0, "monthly_cents": 100_000, "annual_rate_bps": 1200,
        "months": 3}).json()
    assert [p["balance_cents"] for p in body["points"]] == [100_000, 201_000, 303_010]
    assert body["interest_cents"] == 3_010


def test_a_savings_withdrawal_plan_is_allowed_and_goes_negative(client):
    """A negative monthly contribution is a withdrawal, and the pot is not
    floored at zero. This is the same branch the operator's own feasibility
    projection uses."""
    headers = _register(client)
    body = client.post("/api/simulators/epargne", headers=headers, json={
        "initial_cents": 250_000, "monthly_cents": -100_000, "annual_rate_bps": 0,
        "months": 3}).json()
    assert body["final_cents"] == -50_000


def test_a_savings_projection_of_zero_months_is_refused_in_french(client):
    headers = _register(client)
    response = client.post("/api/simulators/epargne", headers=headers, json={
        "initial_cents": 0, "monthly_cents": 10_000, "annual_rate_bps": 300, "months": 0})
    assert response.status_code == 422
    assert "durée" in response.json()["detail"]


def test_a_savings_projection_past_fifty_years_is_refused_in_french(client):
    headers = _register(client)
    response = client.post("/api/simulators/epargne", headers=headers, json={
        "initial_cents": 0, "monthly_cents": 10_000, "annual_rate_bps": 300, "months": 601})
    assert response.status_code == 422
    assert "600" in response.json()["detail"]


def test_a_savings_projection_at_exactly_fifty_years_is_accepted(client):
    headers = _register(client)
    response = client.post("/api/simulators/epargne", headers=headers, json={
        "initial_cents": 0, "monthly_cents": 10_000, "annual_rate_bps": 300, "months": 600})
    assert response.status_code == 200
    assert len(response.json()["points"]) == 600


def test_a_negative_savings_rate_is_refused_in_french(client):
    headers = _register(client)
    response = client.post("/api/simulators/epargne", headers=headers, json={
        "initial_cents": 0, "monthly_cents": 10_000, "annual_rate_bps": -1, "months": 12})
    assert response.status_code == 422


# --------------------------------------------------------------------------
# Immobilier.
# --------------------------------------------------------------------------


def test_the_property_simulation_matches_the_engine(client):
    headers = _register(client)
    body = client.post("/api/simulators/immobilier", headers=headers,
                       json=PROPERTY_REQUEST).json()
    simulation = body["simulation"]
    assert simulation["notary_fees_cents"] == 2_250_000
    assert simulation["acquisition_cost_cents"] == 32_250_000
    assert simulation["borrowed_cents"] == 26_250_000
    assert simulation["schedule"]["monthly_payment_cents"] == 152_239
    assert simulation["monthly_insurance_cents"] == 7_875
    assert simulation["monthly_effort_cents"] == 185_114
    assert simulation["total_interest_cents"] == 10_287_523
    # No income has been imported: the debt ratio is measured, and nothing
    # was measured.
    assert simulation["debt_ratio_bps"] is None
    assert simulation["debt_ratio_exceeded"] is False
    assert body["measured_monthly_income_cents"] is None
    assert body["rent_comparison"] is None


def test_the_property_debt_ratio_uses_the_measured_income(client, db):
    """4 000 EUR/month, salaried, over three complete months -- the same
    income the engine test hand-verifies a 4003 bps ratio against.

    Five months are seeded, not three: `capacity.complete_months` drops the
    first and last as partial (the ledger's own bounds, from the earliest and
    latest transaction, fall inside their calendar month), leaving exactly
    the middle three complete -- the same pattern
    `test_feasibility_api.py::test_context_isolation_holds_on_every_measured_field`
    relies on."""
    headers = _register(client, "immo1@example.fr")
    user_id = _user_id(db, "immo1@example.fr")
    account = _account(db, user_id)
    for month in (1, 2, 3, 4, 5):
        _tx(db, user_id, account.id, date(2025, month, 5), 400_000, f"SALAIRE {month}")
        _tx(db, user_id, account.id, date(2025, month, 20), -50_000, f"DEPENSE {month}")
    db.commit()

    body = client.post("/api/simulators/immobilier", headers=headers,
                       json=PROPERTY_REQUEST).json()
    assert body["measured_monthly_income_cents"] == 400_000
    simulation = body["simulation"]
    assert simulation["debt_ratio_bps"] == 4003
    assert simulation["debt_ratio_exceeded"] is True


def test_existing_debt_instalments_widen_the_property_debt_ratio(client):
    headers = _register(client, "immo2@example.fr")
    client.post("/api/debts", headers=headers, json={
        "name": "Conso", "kind": "consumer", "principal_cents": 500_000,
        "annual_rate_bps": 600, "minimum_payment_cents": 15_000, "term_months": 36})
    body = client.post("/api/simulators/immobilier", headers=headers,
                       json=PROPERTY_REQUEST).json()
    assert body["existing_debt_payments_cents"] == 15_000


def test_the_rent_comparison_is_returned_only_when_a_rent_is_given(client):
    headers = _register(client, "immo3@example.fr")

    without_rent = client.post("/api/simulators/immobilier", headers=headers,
                               json=PROPERTY_REQUEST).json()
    assert without_rent["rent_comparison"] is None

    with_rent = client.post("/api/simulators/immobilier", headers=headers, json={
        **PROPERTY_REQUEST, "monthly_rent_cents": 110_000, "years": 10,
        "annual_return_bps": 300, "appreciation_bps_per_year": 100}).json()
    comparison = with_rent["rent_comparison"]
    assert comparison is not None
    assert comparison["horizon_months"] == 120
    assert comparison["buyer_wealth_cents"] == 17_758_208
    assert comparison["renter_wealth_cents"] == 21_628_706
    assert comparison["better_kind"] == "rent"


def test_the_property_comparison_is_capped_at_the_loan_term_and_says_so(client):
    headers = _register(client, "immo4@example.fr")
    body = client.post("/api/simulators/immobilier", headers=headers, json={
        **PROPERTY_REQUEST, "monthly_rent_cents": 110_000, "years": 30}).json()
    comparison = body["rent_comparison"]
    assert comparison["horizon_months"] == 240
    assert comparison["capped_reason"] is not None
    assert "crédit" in comparison["capped_reason"]


def test_a_down_payment_above_the_price_plus_fees_is_still_a_valid_cash_purchase(client):
    """Reported (`down_payment_short_cents == 0`), not refused: a cash buyer
    with money to spare is a real plan, not a validation error."""
    headers = _register(client, "immo5@example.fr")
    body = client.post("/api/simulators/immobilier", headers=headers, json={
        **PROPERTY_REQUEST, "down_payment_cents": 40_000_000}).json()
    simulation = body["simulation"]
    assert simulation["borrowed_cents"] == 0
    assert simulation["down_payment_short_cents"] == 0
    assert simulation["schedule"]["rows"] == []


def test_a_property_price_of_zero_is_refused_in_french(client):
    headers = _register(client, "immo6@example.fr")
    response = client.post("/api/simulators/immobilier", headers=headers, json={
        **PROPERTY_REQUEST, "price_cents": 0})
    assert response.status_code == 422


def test_a_property_loan_unpriceable_at_its_own_rate_and_term_refuses_in_french(client):
    """`simulate_property` prices the loan at the user's own rate and term via
    `amortization.build_schedule`, which is NOT bounded by `PropertyIn`'s own
    Pydantic fields the way `price_cents` and `down_payment_cents` are -- a
    tiny acquisition cost at a punitive rate over a long term still reaches
    the engine's own refusal, forwarded here as a 422 rather than a 500."""
    headers = _register(client, "immo8@example.fr")
    response = client.post("/api/simulators/immobilier", headers=headers, json={
        "price_cents": 100, "down_payment_cents": 0, "notary_bps": 0,
        "loan_rate_bps": 100_000, "loan_months": 480, "insurance_bps_per_year": 0,
        "monthly_charges_cents": 0, "annual_property_tax_cents": 0})
    assert response.status_code == 422
    assert "intérêts" in response.json()["detail"]


def test_a_malformed_property_payload_is_refused_in_french(client):
    headers = _register(client, "immo7@example.fr")
    response = client.post("/api/simulators/immobilier", headers=headers,
                           json={"price_cents": "pas un nombre"})
    assert response.status_code == 422
    assert response.json()["detail"]


# --------------------------------------------------------------------------
# GET /context.
# --------------------------------------------------------------------------


def test_the_context_route_reports_nothing_with_no_history(client):
    headers = _register(client, "ctx1@example.fr")
    body = client.get("/api/simulators/context", headers=headers).json()
    assert body["monthly_income_cents"] is None
    assert body["existing_debt_payments_cents"] == 0
    assert body["months_observed"] == 0


# --------------------------------------------------------------------------
# Isolation.
# --------------------------------------------------------------------------


def test_the_simulators_never_read_another_users_data(client, db):
    """Bob's real income and debt must never leak into Alice's context or her
    property simulation. Bob's own reads are asserted FIRST -- if the fixture
    below had silently written nothing, Alice's report would look identical
    to what it is asserted to be regardless, and this test would pass for the
    wrong reason."""
    alice = _register(client, "alice_sim@example.fr")
    bob = _register(client, "bob_sim@example.fr")
    bob_id = _user_id(db, "bob_sim@example.fr")
    bob_account = _account(db, bob_id)
    for month in (1, 2, 3, 4, 5):
        _tx(db, bob_id, bob_account.id, date(2025, month, 5), 400_000, f"SALAIRE {month}")
        _tx(db, bob_id, bob_account.id, date(2025, month, 20), -50_000, f"DEPENSE {month}")
    db.commit()
    client.post("/api/debts", headers=bob, json={
        "name": "Conso", "kind": "consumer", "principal_cents": 500_000,
        "annual_rate_bps": 600, "minimum_payment_cents": 15_000, "term_months": 36})

    # Bob's own reports prove the seeding actually landed.
    bob_context = client.get("/api/simulators/context", headers=bob).json()
    assert bob_context["monthly_income_cents"] == 400_000
    assert bob_context["existing_debt_payments_cents"] == 15_000
    assert bob_context["months_observed"] == 3  # Feb, Mar, Apr; Jan and May are partial.

    bob_property = client.post("/api/simulators/immobilier", headers=bob,
                               json=PROPERTY_REQUEST).json()
    assert bob_property["measured_monthly_income_cents"] == 400_000
    assert bob_property["existing_debt_payments_cents"] == 15_000
    # 152 239 (instalment) + 7 875 (insurance) + 15 000 (Bob's existing debt)
    # over 400 000 of measured income -- the 4003 bps `test_property.py` pins
    # with no existing debt, widened by Bob's own instalment.
    assert bob_property["simulation"]["debt_ratio_bps"] == 4378

    # Alice must see none of it.
    alice_context = client.get("/api/simulators/context", headers=alice).json()
    assert alice_context["monthly_income_cents"] is None
    assert alice_context["existing_debt_payments_cents"] == 0
    assert alice_context["months_observed"] == 0

    alice_property = client.post("/api/simulators/immobilier", headers=alice,
                                 json=PROPERTY_REQUEST).json()
    assert alice_property["measured_monthly_income_cents"] is None
    assert alice_property["existing_debt_payments_cents"] == 0
    assert alice_property["simulation"]["debt_ratio_bps"] is None
