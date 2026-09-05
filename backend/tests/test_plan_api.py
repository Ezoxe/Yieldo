"""`/api/plan` — the declarations, and the reading every other screen answers in.

The tests that matter most are the last two groups: `the three readings` proves
`/api/analytics/summary` answers differently under each mode, and `what stays
real whatever the mode` proves the three helpers deliberately left out of the
switch really are left out — a recurrence detected from a forecast of itself,
or an anomaly scored against a declared amount, would each be a circle.
"""

from datetime import date

from app.models import PlanLine


def _categories(client, headers) -> list[dict]:
    return client.get("/api/categories", headers=headers).json()


def _line(account_id: int | None = None, **overrides) -> dict:
    base = {
        "label": "Loyer",
        "amount_cents": -90000,
        "kind": "fixed",
        "periodicity": "monthly",
        "day_of_month": 5,
        "start_on": "2025-01-01",
        "match_label": "Loyer",
    }
    if account_id is not None:
        base["account_id"] = account_id
    base.update(overrides)
    return base


def _create(client, headers, **overrides) -> dict:
    response = client.post("/api/plan", headers=headers, json=_line(**overrides))
    assert response.status_code == 201, response.text
    return response.json()


# --- the declarations ------------------------------------------------------


def test_a_declared_line_comes_back(client, imported):
    headers, _ = imported
    created = _create(client, headers)

    assert created["label"] == "Loyer"
    assert created["amount_cents"] == -90000
    assert created["origin"] == "manual"
    assert client.get("/api/plan", headers=headers).json() == [created]


# The whole point of the feature: a forecast is not a movement.
def test_declaring_a_line_writes_no_transaction(client, imported):
    headers, _ = imported
    before = client.get("/api/transactions", headers=headers).json()["total"]
    _create(client, headers)
    assert client.get("/api/transactions", headers=headers).json()["total"] == before


def test_the_plan_is_scoped_to_its_own_household(client, imported):
    headers, _ = imported
    _create(client, headers)
    other = client.post("/api/auth/register", json={
        "name": "Lea", "email": "lea@example.com", "password": "motdepasse123"}).json()
    other_headers = {"Authorization": f"Bearer {other['access_token']}"}

    assert client.get("/api/plan", headers=other_headers).json() == []


def test_a_line_can_be_edited(client, imported):
    headers, _ = imported
    created = _create(client, headers)
    patched = client.patch(f"/api/plan/{created['id']}", headers=headers,
                           json={"amount_cents": -95000}).json()
    assert patched["amount_cents"] == -95000


def test_a_line_can_be_removed(client, imported):
    headers, _ = imported
    created = _create(client, headers)
    assert client.delete(f"/api/plan/{created['id']}", headers=headers).status_code == 204
    assert client.get("/api/plan", headers=headers).json() == []


def test_another_households_line_is_not_reachable(client, imported):
    headers, _ = imported
    created = _create(client, headers)
    other = client.post("/api/auth/register", json={
        "name": "Lea", "email": "lea@example.com", "password": "motdepasse123"}).json()
    other_headers = {"Authorization": f"Bearer {other['access_token']}"}

    assert client.patch(f"/api/plan/{created['id']}", headers=other_headers,
                        json={"amount_cents": -1}).status_code == 404
    assert client.delete(f"/api/plan/{created['id']}",
                         headers=other_headers).status_code == 404


def test_an_envelope_without_a_category_is_refused(client, imported):
    headers, _ = imported
    response = client.post("/api/plan", headers=headers,
                           json=_line(kind="envelope", match_label=None))
    assert response.status_code == 422


def test_an_envelope_is_monthly(client, imported):
    headers, _ = imported
    category = _categories(client, headers)[0]
    response = client.post("/api/plan", headers=headers, json=_line(
        kind="envelope", category_id=category["id"], periodicity="quarterly"))
    assert response.status_code == 422


# The same rule holds after an edit as on creation: a patch must not be able to
# produce a line the creation route would have refused.
def test_a_patch_cannot_turn_a_line_into_an_envelope_without_a_category(client, imported):
    headers, _ = imported
    created = _create(client, headers)
    response = client.patch(f"/api/plan/{created['id']}", headers=headers,
                            json={"kind": "envelope"})
    assert response.status_code == 422
    assert response.json()["detail"] == "Une enveloppe doit porter une catégorie"


def test_an_end_before_the_start_is_refused(client, imported):
    headers, _ = imported
    response = client.post("/api/plan", headers=headers,
                           json=_line(start_on="2025-06-01", end_on="2025-01-01"))
    assert response.status_code == 422


def test_a_zero_amount_is_refused(client, imported):
    headers, _ = imported
    assert client.post("/api/plan", headers=headers,
                       json=_line(amount_cents=0)).status_code == 422


def test_another_households_category_is_not_a_valid_target(client, imported):
    headers, _ = imported
    other = client.post("/api/auth/register", json={
        "name": "Lea", "email": "lea@example.com", "password": "motdepasse123"}).json()
    other_headers = {"Authorization": f"Bearer {other['access_token']}"}
    foreign = _categories(client, other_headers)[0]

    response = client.post("/api/plan", headers=headers, json=_line(category_id=foreign["id"]))
    assert response.status_code == 404
    assert response.json()["detail"] == "Catégorie introuvable"


# --- the preview -----------------------------------------------------------


def test_the_preview_expands_the_plan_over_the_window(client, imported):
    headers, _ = imported
    _create(client, headers)
    body = client.get("/api/plan/preview?date_from=2025-03-01&date_to=2025-05-31",
                      headers=headers).json()

    assert [item["on"] for item in body["planned"]] == ["2025-03-05", "2025-04-05", "2025-05-05"]
    assert body["planned_total_cents"] == -270000


def test_the_preview_separates_what_the_ledger_already_covers(client, imported):
    headers, account_id = imported
    # The sample ledger runs 2025-03-01 to 2025-03-07. A line matching one of
    # its own labels is settled for March and open for April.
    _create(client, headers, label="Netflix", match_label="NETFLIX",
            amount_cents=-1399, day_of_month=3, start_on="2025-03-01")
    body = client.get("/api/plan/preview?date_from=2025-03-01&date_to=2025-04-30",
                      headers=headers).json()

    assert len(body["planned"]) == 2
    assert [item["on"] for item in body["remaining"]] == ["2025-04-03"]
    assert body["remaining_total_cents"] == -1399


# --- pre-filling from what Yieldo already detected -------------------------


def test_pre_filling_from_recurrences_creates_lines_marked_as_such(client, imported, db):
    headers, _ = imported
    body = client.post("/api/plan/from-recurrences", headers=headers).json()

    # The four-row sample holds no confirmed monthly recurrence, so this is
    # the honest answer rather than a plan invented out of one statement week.
    assert body["created"] == []
    assert body["skipped"] == 0
    assert db.query(PlanLine).count() == 0


def test_pre_filling_twice_does_not_double_the_plan(client, imported):
    headers, _ = imported
    first = client.post("/api/plan/from-recurrences", headers=headers).json()
    second = client.post("/api/plan/from-recurrences", headers=headers).json()
    assert len(second["created"]) == 0
    assert second["skipped"] == first["skipped"]


# --- the reading ------------------------------------------------------------


def test_a_household_that_never_chose_reads_the_ledger(client, imported):
    headers, _ = imported
    assert client.get("/api/plan/mode", headers=headers).json() == {"mode": "real"}


def test_the_mode_survives_being_set(client, imported):
    headers, _ = imported
    assert client.put("/api/plan/mode", headers=headers,
                      json={"mode": "blended"}).json() == {"mode": "blended"}
    assert client.get("/api/plan/mode", headers=headers).json() == {"mode": "blended"}


def test_an_unknown_mode_is_refused(client, imported):
    headers, _ = imported
    assert client.put("/api/plan/mode", headers=headers,
                      json={"mode": "optimiste"}).status_code == 422


def test_the_mode_is_one_households_own(client, imported):
    headers, _ = imported
    client.put("/api/plan/mode", headers=headers, json={"mode": "estimated"})
    other = client.post("/api/auth/register", json={
        "name": "Lea", "email": "lea@example.com", "password": "motdepasse123"}).json()
    other_headers = {"Authorization": f"Bearer {other['access_token']}"}

    assert client.get("/api/plan/mode", headers=other_headers).json() == {"mode": "real"}


# --- the three readings, measured on a real figure -------------------------


def _march_summary(client, headers) -> dict:
    return client.get("/api/analytics/summary?date_from=2025-03-01&date_to=2025-03-31",
                      headers=headers).json()


def test_real_is_the_ledger_and_nothing_else(client, imported):
    headers, _ = imported
    before = _march_summary(client, headers)
    _create(client, headers, day_of_month=20)
    assert _march_summary(client, headers) == before


def test_estimated_is_the_plan_and_nothing_else(client, imported):
    headers, _ = imported
    _create(client, headers, day_of_month=20)
    client.put("/api/plan/mode", headers=headers, json={"mode": "estimated"})

    body = _march_summary(client, headers)
    assert body["outflow_cents"] == -90000
    assert body["inflow_cents"] == 0
    assert body["transaction_count"] == 1


def test_blended_is_the_ledger_plus_what_it_does_not_yet_cover(client, imported):
    headers, _ = imported
    real = _march_summary(client, headers)
    _create(client, headers, day_of_month=20)
    client.put("/api/plan/mode", headers=headers, json={"mode": "blended"})

    body = _march_summary(client, headers)
    assert body["outflow_cents"] == real["outflow_cents"] - 90000
    assert body["inflow_cents"] == real["inflow_cents"]


# A rent the statement already shows must not be charged twice.
def test_blended_does_not_count_a_payment_the_ledger_already_holds(client, imported):
    headers, _ = imported
    real = _march_summary(client, headers)
    _create(client, headers, label="Netflix", match_label="NETFLIX",
            amount_cents=-1399, day_of_month=3, start_on="2025-03-01")
    client.put("/api/plan/mode", headers=headers, json={"mode": "blended"})

    assert _march_summary(client, headers)["outflow_cents"] == real["outflow_cents"]


def test_an_empty_plan_leaves_every_mode_agreeing(client, imported):
    headers, _ = imported
    real = _march_summary(client, headers)
    for mode in ("estimated", "blended"):
        client.put("/api/plan/mode", headers=headers, json={"mode": mode})
        body = _march_summary(client, headers)
        if mode == "blended":
            assert body["outflow_cents"] == real["outflow_cents"]
        else:
            assert body["transaction_count"] == 0


# --- what stays real whatever the mode -------------------------------------


def test_recurrence_detection_never_reads_the_plan(client, imported):
    """A subscription detected from a forecast of that same subscription would
    confirm itself: "Yieldo found your rent" would mean "you told Yieldo"."""
    headers, _ = imported
    before = client.get("/api/recurrences", headers=headers).json()
    _create(client, headers, start_on="2024-01-01")
    client.put("/api/plan/mode", headers=headers, json={"mode": "estimated"})

    assert client.get("/api/recurrences", headers=headers).json() == before


def test_anomaly_detection_never_reads_the_plan(client, imported):
    """A declared amount is never a surprise; scoring the plan against itself
    would report nothing, for ever."""
    headers, _ = imported
    before = client.get("/api/analysis/anomalies", headers=headers).json()
    _create(client, headers, amount_cents=-9_000_000, start_on="2025-03-01", day_of_month=3)
    client.put("/api/plan/mode", headers=headers, json={"mode": "estimated"})

    assert client.get("/api/analysis/anomalies", headers=headers).json() == before


def test_the_ledger_itself_is_never_rewritten_by_a_mode(client, imported):
    headers, _ = imported
    before = client.get("/api/transactions", headers=headers).json()
    _create(client, headers)
    for mode in ("estimated", "blended", "real"):
        client.put("/api/plan/mode", headers=headers, json={"mode": mode})
        assert client.get("/api/transactions", headers=headers).json() == before


def test_a_line_dated_out_of_the_window_changes_nothing(client, imported):
    headers, _ = imported
    real = _march_summary(client, headers)
    _create(client, headers, start_on="2026-01-01")
    client.put("/api/plan/mode", headers=headers, json={"mode": "blended"})

    assert _march_summary(client, headers)["outflow_cents"] == real["outflow_cents"]


def test_an_inactive_line_forecasts_nothing(client, imported):
    headers, _ = imported
    real = _march_summary(client, headers)
    _create(client, headers, day_of_month=20, active=False)
    client.put("/api/plan/mode", headers=headers, json={"mode": "blended"})

    assert _march_summary(client, headers)["outflow_cents"] == real["outflow_cents"]


def test_an_envelope_is_drawn_down_by_what_was_really_spent(client, imported):
    headers, _ = imported
    categories = _categories(client, headers)
    # The category the sample's biggest March expense actually landed in.
    page = client.get("/api/transactions?date_from=2025-03-01&date_to=2025-03-31",
                      headers=headers).json()
    categorised = [row for row in page["items"] if row["category_id"] is not None]
    assert categorised, "the sample import must categorise at least one row"
    category_id = categorised[0]["category_id"]
    spent = sum(
        -row["amount_cents"] for row in page["items"]
        if row["category_id"] == category_id and row["amount_cents"] < 0
    )
    assert spent > 0
    assert any(c["id"] == category_id for c in categories)

    real = _march_summary(client, headers)
    envelope_cents = -(spent + 50_000)
    client.post("/api/plan", headers=headers, json=_line(
        label="Enveloppe", kind="envelope", category_id=category_id,
        amount_cents=envelope_cents, day_of_month=1, start_on="2025-03-01",
        match_label=None,
    ))
    client.put("/api/plan/mode", headers=headers, json={"mode": "blended"})

    # Exactly the untouched part of the envelope is added, never the whole of it.
    assert _march_summary(client, headers)["outflow_cents"] == real["outflow_cents"] - 50_000


def test_the_preview_defaults_to_the_ledgers_own_span(client, imported):
    headers, _ = imported
    _create(client, headers)
    body = client.get("/api/plan/preview", headers=headers).json()
    assert body["date_from"] == "2025-03-01"
    assert body["date_to"] == "2025-03-07"
    assert date.fromisoformat(body["date_from"]) <= date.fromisoformat(body["date_to"])
