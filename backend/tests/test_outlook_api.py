"""GET /api/outlook, POST /api/outlook/scenario, GET /api/outlook/reliability."""

from tests.test_cashflow_api import _VARIED_AMOUNTS, _import_months, _import_unique_months


def _ledger(client, headers, account_id):
    """Ten months of variable spending, a salary and a rent: enough for a band."""
    _import_unique_months(client, headers, account_id, "ACHAT DIVERS", _VARIED_AMOUNTS, (2025, 1))
    _import_months(client, headers, account_id, "VIR SALAIRE ACME", 250000, (2025, 1), 10, day=28)
    _import_months(client, headers, account_id, "PRLV LOYER FONCIA", -90000, (2025, 1), 10, day=5)


def test_the_outlook_needs_a_session(client):
    assert client.get("/api/outlook").status_code == 401


def test_the_outlook_projects_every_day_from_the_statements_end(client, imported):
    headers, account_id = imported
    _ledger(client, headers, account_id)

    body = client.get("/api/outlook?horizon_days=60", headers=headers).json()

    assert body["scope"] == "checking"
    assert body["as_of"] == "2025-10-28"
    assert len(body["days"]) == 60
    assert body["days"][0]["on"] == "2025-10-29"
    assert body["band"] is True
    assert body["threshold_source"] == "zero"
    assert {event["source"] for event in body["events"]} == {"detected"}
    labels = {event["label"] for event in body["events"]}
    assert any("SALAIRE" in label for label in labels)
    assert body["low_point"]["p50_cents"] <= body["opening_balance_cents"]
    assert body["stale_days"] > 300


def test_a_planned_event_is_projected_on_its_date(client, imported):
    headers, account_id = imported
    _ledger(client, headers, account_id)
    client.post("/api/planned-events", headers=headers, json={
        "label": "Solde d'impôt", "due_on": "2025-11-15", "amount_cents": -31000})

    body = client.get("/api/outlook", headers=headers).json()

    planned = [event for event in body["events"] if event["source"] == "planned"]
    assert [(event["on"], event["label"]) for event in planned] == [("2025-11-15", "Solde d'impôt")]
    assert body["counts"]["planned"] == 1


def test_the_floor_set_in_alertes_is_the_threshold(client, imported):
    headers, account_id = imported
    _ledger(client, headers, account_id)
    client.put("/api/alerts/settings", headers=headers, json={"balance_floor_cents": 50000})

    body = client.get("/api/outlook", headers=headers).json()

    assert body["threshold_cents"] == 50000
    assert body["threshold_source"] == "alert"


def test_a_perimeter_without_accounts_says_how_to_start(client):
    token = client.post("/api/auth/register", json={
        "name": "X", "email": "vide@example.fr", "password": "motdepasse123"}).json()
    headers = {"Authorization": f"Bearer {token['access_token']}"}

    body = client.get("/api/outlook", headers=headers).json()

    assert body["days"] == []
    assert body["empty_reason"].startswith("Aucun compte courant")


def test_the_available_perimeter_counts_the_livret(client, imported):
    headers, account_id = imported
    _ledger(client, headers, account_id)
    client.post("/api/accounts", headers=headers, json={
        "name": "Livret A", "kind": "savings", "opening_balance_cents": 400000})

    checking = client.get("/api/outlook", headers=headers).json()
    liquid = client.get("/api/outlook?scope=liquid", headers=headers).json()

    assert liquid["opening_balance_cents"] == checking["opening_balance_cents"] + 400000


def test_a_scenario_changes_the_projection_and_leaves_the_data_alone(client, imported):
    headers, account_id = imported
    _ledger(client, headers, account_id)

    response = client.post("/api/outlook/scenario", headers=headers, json={
        "horizon_days": 60,
        "adjustments": [{"kind": "one_off", "on": "2025-11-10", "label": "Vacances",
                         "amount_cents": -180000}],
    })

    assert response.status_code == 200
    body = response.json()
    base_end = body["base"]["days"][-1]["p50_cents"]
    scenario_end = body["scenario"]["days"][-1]["p50_cents"]
    assert scenario_end == base_end - 180000
    assert client.get("/api/planned-events", headers=headers).json() == []


def test_a_scenario_cancelling_an_unknown_series_is_refused_in_french(client, imported):
    headers, account_id = imported
    _ledger(client, headers, account_id)

    response = client.post("/api/outlook/scenario", headers=headers, json={
        "adjustments": [{"kind": "cancel", "on": "2025-11-10", "series": "detected:inconnu"}]})

    assert response.status_code == 422
    assert "plus projetée" in response.json()["detail"]


def test_a_scenario_dated_outside_the_horizon_is_refused(client, imported):
    headers, account_id = imported
    _ledger(client, headers, account_id)

    response = client.post("/api/outlook/scenario", headers=headers, json={
        "horizon_days": 30,
        "adjustments": [{"kind": "one_off", "on": "2027-01-01", "amount_cents": -1000}]})

    assert response.status_code == 422
    assert "horizon" in response.json()["detail"]


def test_the_reliability_refuses_a_short_history_and_says_why(client, imported):
    headers, _ = imported
    body = client.get("/api/outlook/reliability", headers=headers).json()
    assert body["horizons"] == []
    assert "Il faut au moins 9 mois complets" in body["refusal"]


def test_one_households_future_is_never_anothers(client, imported):
    headers, account_id = imported
    _ledger(client, headers, account_id)
    client.post("/api/planned-events", headers=headers, json={
        "label": "Secret", "due_on": "2025-11-15", "amount_cents": -31000})
    other = client.post("/api/auth/register", json={
        "name": "Y", "email": "autre@example.fr", "password": "motdepasse123"}).json()
    other_headers = {"Authorization": f"Bearer {other['access_token']}"}
    client.post("/api/accounts", headers=other_headers, json={"name": "C", "kind": "checking"})

    body = client.get("/api/outlook", headers=other_headers).json()

    assert body["events"] == []
    assert body["opening_balance_cents"] == 0
