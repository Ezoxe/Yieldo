"""Declaring a recurrence, putting it on a calendar, and ticking it off.

The half of the recurrences screen the household writes itself.
`engines/recurrence.py` can only describe what statements already show; these
routes let a household state what it knows it pays, including the water and
electricity bills whose amounts wander too much to ever be detected.
"""

from datetime import date, timedelta


def _register(client, email: str = "max@example.com") -> dict[str, str]:
    body = client.post("/api/auth/register", json={
        "name": "Max", "email": email, "password": "motdepasse123"}).json()
    return {"Authorization": f"Bearer {body['access_token']}"}


def _declare(client, headers, **overrides) -> dict:
    payload = {
        "label": "Netflix",
        "amount_cents": -1_599,
        "periodicity": "monthly",
        "anchor_on": "2025-01-15",
    }
    payload.update(overrides)
    response = client.post("/api/recurrences/declared", headers=headers, json=payload)
    assert response.status_code == 201, response.json()
    return response.json()


def _calendar(client, headers, start: str, end: str) -> dict:
    return client.get(
        f"/api/recurrences/calendar?date_from={start}&date_to={end}", headers=headers
    ).json()


# --- Declaring ---------------------------------------------------------------

def test_a_household_can_declare_a_charge_it_knows_it_has(client):
    headers = _register(client)
    row = _declare(client, headers)

    assert row["label"] == "Netflix"
    assert row["amount_cents"] == -1_599
    assert row["active"] is True
    assert client.get("/api/recurrences/declared", headers=headers).json() == [row]


def test_a_declaration_refuses_a_zero_amount(client):
    headers = _register(client)
    response = client.post("/api/recurrences/declared", headers=headers, json={
        "label": "Rien", "amount_cents": 0, "periodicity": "monthly",
        "anchor_on": "2025-01-15"})
    assert response.status_code == 422
    # `api/errors` keeps FastAPI's list shape and rewrites only `msg`, in French.
    assert response.json()["detail"][0]["msg"] == "Le montant n'est pas valide."


def test_a_declaration_refuses_a_rhythm_nobody_bills_on(client):
    headers = _register(client)
    response = client.post("/api/recurrences/declared", headers=headers, json={
        "label": "Bizarre", "amount_cents": -100, "periodicity": "fortnightly",
        "anchor_on": "2025-01-15"})
    assert response.status_code == 422
    assert response.json()["detail"][0]["msg"] == (
        "La périodicité ne fait pas partie des valeurs acceptées.")


def test_a_declaration_refuses_another_household_s_category(client):
    headers = _register(client)
    other = _register(client, "autre@example.com")
    stranger = client.get("/api/categories", headers=other).json()[0]["id"]

    response = client.post("/api/recurrences/declared", headers=headers, json={
        "label": "Netflix", "amount_cents": -1_599, "periodicity": "monthly",
        "anchor_on": "2025-01-15", "category_id": stranger})
    assert response.status_code == 404


def test_a_declaration_can_be_corrected_and_removed(client):
    headers = _register(client)
    row = _declare(client, headers)

    patched = client.patch(f"/api/recurrences/declared/{row['id']}", headers=headers,
                           json={"amount_cents": -1_999}).json()
    assert patched["amount_cents"] == -1_999

    assert client.delete(f"/api/recurrences/declared/{row['id']}",
                         headers=headers).status_code == 204
    assert client.get("/api/recurrences/declared", headers=headers).json() == []


def test_one_household_never_sees_another_s_declarations(client):
    headers = _register(client)
    _declare(client, headers)
    other = _register(client, "autre@example.com")

    assert client.get("/api/recurrences/declared", headers=other).json() == []


# --- The calendar ------------------------------------------------------------

def test_the_calendar_lays_every_due_date_of_the_window_out(client):
    headers = _register(client)
    _declare(client, headers)

    body = _calendar(client, headers, "2025-01-01", "2025-03-31")

    assert [o["due_on"] for o in body["occurrences"]] == [
        "2025-01-15", "2025-02-15", "2025-03-15"]
    assert body["annual_charges_cents"] == -19_188
    assert body["monthly_charges_cents"] == -1_599


def test_the_calendar_defaults_to_the_month_the_reader_is_in(client):
    """Not to the span of the imported ledger. A declared calendar is about what
    falls due, including in months no statement was ever imported for."""
    headers = _register(client)
    today = date.today()
    _declare(client, headers, anchor_on=today.replace(day=1).isoformat())

    body = client.get("/api/recurrences/calendar", headers=headers).json()

    assert body["date_from"] == today.replace(day=1).isoformat()
    assert body["date_to"] >= body["date_from"]
    assert len(body["occurrences"]) == 1


def test_charges_and_income_are_totalled_apart(client):
    headers = _register(client)
    _declare(client, headers, label="Loyer", amount_cents=-95_000)
    _declare(client, headers, label="Salaire", amount_cents=250_000)

    body = _calendar(client, headers, "2025-01-01", "2025-01-31")

    assert body["annual_charges_cents"] == -1_140_000
    assert body["annual_income_cents"] == 3_000_000


def test_an_empty_calendar_says_why_rather_than_showing_a_zero(client):
    headers = _register(client)
    body = _calendar(client, headers, "2025-01-01", "2025-01-31")

    assert body["occurrences"] == []
    assert body["notice"] is not None
    assert "déclar" in body["notice"]


def test_a_backwards_window_is_refused_in_french(client):
    headers = _register(client)
    response = client.get(
        "/api/recurrences/calendar?date_from=2025-03-01&date_to=2025-01-01",
        headers=headers)
    assert response.status_code == 422
    assert "précède" in response.json()["detail"]


# --- Pointing ----------------------------------------------------------------

def test_ticking_off_a_due_date_marks_it_and_keeps_the_declared_amount(client):
    headers = _register(client)
    row = _declare(client, headers)

    response = client.post(f"/api/recurrences/declared/{row['id']}/checkins",
                           headers=headers, json={"due_on": "2025-01-15"})
    assert response.status_code == 201
    assert response.json()["amount_cents"] == -1_599
    assert response.json()["paid_on"] == "2025-01-15"

    body = _calendar(client, headers, "2025-01-01", "2025-01-31")
    assert body["occurrences"][0]["status"] == "pointed"
    assert body["pointed_count"] == 1


def test_ticking_off_a_variable_bill_records_what_it_actually_cost(client):
    headers = _register(client)
    row = _declare(client, headers, label="Électricité", amount_is_variable=True,
                   amount_cents=-6_000)

    for month, amount in ((1, -6_200), (2, -7_400), (3, -6_800)):
        client.post(f"/api/recurrences/declared/{row['id']}/checkins", headers=headers,
                    json={"due_on": f"2025-0{month}-15", "amount_cents": amount})

    body = _calendar(client, headers, "2025-01-01", "2025-03-31")
    cost = body["schedules"][0]

    # Once three real amounts exist, the estimate stops being the figure -- and
    # the payload says so rather than leaving the screen to guess.
    assert cost["amount_basis"] == "observed"
    assert cost["amount_cents"] == -6_800
    assert cost["observations"] == 3


def test_a_variable_bill_with_too_few_checkins_still_says_it_is_an_estimate(client):
    headers = _register(client)
    row = _declare(client, headers, label="Eau", amount_is_variable=True,
                   amount_cents=-4_000)
    client.post(f"/api/recurrences/declared/{row['id']}/checkins", headers=headers,
                json={"due_on": "2025-01-15", "amount_cents": -9_900})

    body = _calendar(client, headers, "2025-01-01", "2025-03-31")
    cost = body["schedules"][0]

    assert cost["amount_basis"] == "declared"
    assert cost["amount_cents"] == -4_000


def test_pointing_the_same_due_date_twice_corrects_it_rather_than_doubling_it(client):
    headers = _register(client)
    row = _declare(client, headers, amount_is_variable=True)

    client.post(f"/api/recurrences/declared/{row['id']}/checkins", headers=headers,
                json={"due_on": "2025-01-15", "amount_cents": -1_000})
    second = client.post(f"/api/recurrences/declared/{row['id']}/checkins",
                         headers=headers,
                         json={"due_on": "2025-01-15", "amount_cents": -2_000})

    assert second.status_code == 201
    assert second.json()["amount_cents"] == -2_000
    body = _calendar(client, headers, "2025-01-01", "2025-01-31")
    assert body["pointed_count"] == 1


def test_a_due_date_the_declaration_does_not_fall_on_is_refused(client):
    """Accepting it would put an occurrence in the totals that no calendar
    could ever show."""
    headers = _register(client)
    row = _declare(client, headers)

    response = client.post(f"/api/recurrences/declared/{row['id']}/checkins",
                           headers=headers, json={"due_on": "2025-01-16"})
    assert response.status_code == 422
    assert "échéance" in response.json()["detail"]


def test_a_checkin_can_name_the_ledger_line_it_matches(client):
    headers = _register(client)
    account_id = client.post("/api/accounts", headers=headers, json={
        "name": "Compte courant", "kind": "checking"}).json()["id"]
    transaction = client.post("/api/transactions", headers=headers, json={
        "account_id": account_id, "date": "2025-01-15", "amount_cents": -1_599,
        "label_raw": "PRLV NETFLIX"}).json()
    row = _declare(client, headers)

    response = client.post(f"/api/recurrences/declared/{row['id']}/checkins",
                           headers=headers, json={
                               "due_on": "2025-01-15",
                               "transaction_id": transaction["id"]})
    assert response.json()["transaction_id"] == transaction["id"]


def test_a_checkin_refuses_another_household_s_transaction(client):
    headers = _register(client)
    other = _register(client, "autre@example.com")
    account_id = client.post("/api/accounts", headers=other, json={
        "name": "Compte courant", "kind": "checking"}).json()["id"]
    stranger = client.post("/api/transactions", headers=other, json={
        "account_id": account_id, "date": "2025-01-15", "amount_cents": -1_599,
        "label_raw": "PRLV NETFLIX"}).json()["id"]
    row = _declare(client, headers)

    response = client.post(f"/api/recurrences/declared/{row['id']}/checkins",
                           headers=headers,
                           json={"due_on": "2025-01-15", "transaction_id": stranger})
    assert response.status_code == 404


def test_un_ticking_puts_the_due_date_back(client):
    headers = _register(client)
    row = _declare(client, headers)
    client.post(f"/api/recurrences/declared/{row['id']}/checkins", headers=headers,
                json={"due_on": "2025-01-15"})

    assert client.delete(
        f"/api/recurrences/declared/{row['id']}/checkins/2025-01-15", headers=headers
    ).status_code == 204

    body = _calendar(client, headers, "2025-01-01", "2025-01-31")
    assert body["occurrences"][0]["status"] == "late"
    assert body["late_count"] == 1


def test_un_ticking_a_date_that_was_never_ticked_says_so(client):
    headers = _register(client)
    row = _declare(client, headers)
    response = client.delete(
        f"/api/recurrences/declared/{row['id']}/checkins/2025-01-15", headers=headers)
    assert response.status_code == 404
    assert "pointée" in response.json()["detail"]


def test_a_due_date_still_ahead_is_upcoming_rather_than_late(client):
    headers = _register(client)
    ahead = date.today() + timedelta(days=20)
    _declare(client, headers, periodicity="yearly", anchor_on=ahead.isoformat())

    body = _calendar(client, headers, ahead.isoformat(), ahead.isoformat())
    assert body["occurrences"][0]["status"] == "upcoming"
    assert body["late_count"] == 0


def test_deleting_a_declaration_takes_its_checkins_with_it(client, db):
    from app.models import RecurrenceCheckin

    headers = _register(client)
    row = _declare(client, headers)
    client.post(f"/api/recurrences/declared/{row['id']}/checkins", headers=headers,
                json={"due_on": "2025-01-15"})

    client.delete(f"/api/recurrences/declared/{row['id']}", headers=headers)

    assert db.query(RecurrenceCheckin).count() == 0
