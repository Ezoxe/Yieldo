from datetime import date

from app.models import Account, Transaction


def _category(client, headers, slug: str):
    categories = client.get("/api/categories", headers=headers).json()
    return next(c for c in categories if c["slug"] == slug)


def test_the_default_month_is_the_month_of_the_last_transaction(client, imported):
    """Not today's month. The operator's statements stop months before today, and
    defaulting to today would open this screen on a permanently empty month."""
    headers, _ = imported
    body = client.get("/api/budgets", headers=headers).json()
    history = client.get("/api/analytics/summary", headers=headers).json()["history"]
    assert body["month"] == history["date_to"][:7]


def test_a_category_with_no_budget_produces_no_line(client, imported):
    headers, _ = imported
    body = client.get("/api/budgets?month=2025-03", headers=headers).json()
    assert body["lines"] == []


def test_a_budget_set_through_the_categories_endpoint_shows_up(client, imported):
    headers, _ = imported
    carburant = _category(client, headers, "transport-carburant")
    client.patch(f"/api/categories/{carburant['id']}", headers=headers,
                 json={"monthly_budget_cents": 10_000})

    body = client.get("/api/budgets?month=2025-03", headers=headers).json()
    line = next(line for line in body["lines"] if line["category_id"] == carburant["id"])
    assert line["budget_cents"] == 10_000
    assert line["spent_cents"] < 0
    assert line["name"] == "Carburant"
    assert line["color"].startswith("#")
    assert line["status"] in {"ok", "at_risk", "over"}


def test_a_budgeted_category_with_no_spending_still_reports_a_line(client, imported):
    """Silence is a result: a 200 EUR budget with nothing spent is the best
    possible month, and dropping the row would hide it."""
    headers, _ = imported
    vacances = _category(client, headers, "loisirs-vacances")
    client.patch(f"/api/categories/{vacances['id']}", headers=headers,
                 json={"monthly_budget_cents": 20_000})

    body = client.get("/api/budgets?month=2025-03", headers=headers).json()
    line = next(line for line in body["lines"] if line["category_id"] == vacances["id"])
    assert line["spent_cents"] == 0
    assert line["remaining_cents"] == 20_000
    assert line["status"] == "ok"


def test_unbudgeted_lists_what_was_spent_with_no_ceiling_set(client, imported):
    headers, _ = imported
    body = client.get("/api/budgets?month=2025-03", headers=headers).json()
    assert body["unbudgeted"]
    assert all(entry["spent_cents"] < 0 for entry in body["unbudgeted"])
    # Most spent first: the reader is being offered a budget to set.
    magnitudes = [abs(entry["spent_cents"]) for entry in body["unbudgeted"]]
    assert magnitudes == sorted(magnitudes, reverse=True)


def test_setting_a_budget_moves_a_category_out_of_unbudgeted(client, imported):
    headers, _ = imported
    carburant = _category(client, headers, "transport-carburant")
    client.patch(f"/api/categories/{carburant['id']}", headers=headers,
                 json={"monthly_budget_cents": 10_000})

    body = client.get("/api/budgets?month=2025-03", headers=headers).json()
    assert carburant["id"] not in [entry["category_id"] for entry in body["unbudgeted"]]


def test_the_month_calendar_facts_are_reported(client, imported):
    headers, _ = imported
    body = client.get("/api/budgets?month=2025-02", headers=headers).json()
    assert body["month_start"] == "2025-02-01"
    assert body["month_end"] == "2025-02-28"
    assert body["days_in_month"] == 28
    assert body["is_current_month"] is False
    assert body["days_elapsed"] == 28


def test_a_malformed_month_is_refused_in_french(client, imported):
    headers, _ = imported
    response = client.get("/api/budgets?month=mars-2025", headers=headers)
    assert response.status_code == 422
    assert "AAAA-MM" in response.json()["detail"]


def test_a_month_number_out_of_range_is_refused(client, imported):
    headers, _ = imported
    assert client.get("/api/budgets?month=2025-13", headers=headers).status_code == 422


def test_budgets_require_authentication(client, imported):
    assert client.get("/api/budgets").status_code == 401


def test_a_user_with_no_transactions_at_all_defaults_to_todays_month(client):
    """No ledger, no last transaction to anchor on -- the only honest fallback
    left is today's (empty) month, the same as SummaryOut.history being null."""
    registered = client.post("/api/auth/register", json={
        "name": "Lea", "email": "lea-budgets@example.com",
        "password": "motdepasse123"}).json()
    headers = {"Authorization": f"Bearer {registered['access_token']}"}
    body = client.get("/api/budgets", headers=headers).json()
    assert body["month"] == date.today().strftime("%Y-%m")
    assert body["history"] is None
    assert body["lines"] == []
    assert body["unbudgeted"] == []


def test_budgets_never_cross_users(client, imported):
    headers, _ = imported
    carburant = _category(client, headers, "transport-carburant")
    client.patch(f"/api/categories/{carburant['id']}", headers=headers,
                 json={"monthly_budget_cents": 10_000})

    other = client.post("/api/auth/register", json={
        "name": "Autre", "email": "autre@example.com", "password": "motdepasse123"}).json()
    other_headers = {"Authorization": f"Bearer {other['access_token']}"}

    body = client.get("/api/budgets?month=2025-03", headers=other_headers).json()
    assert body["lines"] == []
    assert body["unbudgeted"] == []
    assert body["total_spent_cents"] == 0


def test_a_category_with_both_spend_and_refund_excludes_income_rather_than_nets_it(
    client, db, imported,
):
    """CLAUDE.md rules out a fallback value standing in for real data, and the
    engine (`app/engines/budget.py`) enforces that by refusing a positive
    `spent_cents` outright rather than coercing it through `abs()`. This
    router must therefore never *hand* it a positive figure.

    The correct behaviour, matching the precedent already set by
    `aggregate_by_category` (`app/engines/aggregate.py:157-158`, which skips
    any row with `amount_cents >= 0`): a refund landing in the same category
    and month as a spend is EXCLUDED from that category's total, never
    NETTED against it. So even a refund larger than the spend must leave
    `spent_cents` at the pure (negative) outflow total -- never flip it
    positive, and never make this endpoint 500.
    """
    headers, account_id = imported
    carburant = _category(client, headers, "transport-carburant")
    client.patch(f"/api/categories/{carburant['id']}", headers=headers,
                 json={"monthly_budget_cents": 10_000})

    account = db.query(Account).filter(Account.id == account_id).first()
    # The fixture's only March fuel purchase is -68.10 EUR (07/03/2025). This
    # refund is larger than that spend, landed in the same category and month.
    db.add(Transaction(
        user_id=account.user_id, account_id=account_id,
        date=date(2025, 3, 20), value_date=date(2025, 3, 20),
        amount_cents=50_000, label_raw="REMBOURSEMENT ASSURANCE AUTO",
        label_clean="remboursement assurance auto", category_id=carburant["id"],
        category_source="manual", is_transfer=False,
        dedup_hash="refund-carburant-2025-03", tags=[],
    ))
    db.commit()

    response = client.get("/api/budgets?month=2025-03", headers=headers)
    assert response.status_code == 200
    line = next(line for line in response.json()["lines"]
                if line["category_id"] == carburant["id"])
    assert line["spent_cents"] == -6_810
