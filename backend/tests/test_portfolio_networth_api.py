"""`GET /api/portfolio/networth`: assets minus debts, and a snapshot a day.

The Patrimoine screen printed a portfolio value and the Dettes screen a
capital restant dû, and no screen ever put the two beside each other. This
route does, writes at most one row per user per day (the same discipline as
`health_snapshots`), and returns the history so the screen can draw a line.
"""

from datetime import date

from app.models import NetWorthSnapshot


def _register(client, email: str = "max@example.com") -> dict[str, str]:
    body = client.post("/api/auth/register", json={
        "name": "Max", "email": email, "password": "motdepasse123"}).json()
    return {"Authorization": f"Bearer {body['access_token']}"}


def _account(client, headers, name: str, kind: str, **overrides) -> int:
    payload = {"name": name, "kind": kind, "opening_balance_cents": 0}
    payload.update(overrides)
    return client.post("/api/accounts", headers=headers, json=payload).json()["id"]


def _debt(client, headers, **overrides) -> int:
    payload = {"name": "Crédit auto", "kind": "auto", "principal_cents": 850_000,
               "annual_rate_bps": 390, "minimum_payment_cents": 24_500}
    payload.update(overrides)
    return client.post("/api/debts", headers=headers, json=payload).json()["id"]


def test_requires_a_session(client):
    assert client.get("/api/portfolio/networth").status_code == 401


def test_net_worth_is_the_wealth_minus_the_active_debts(client):
    headers = _register(client)
    _account(client, headers, "Livret A", "savings", opening_balance_cents=991_240)
    _debt(client, headers, principal_cents=780_000)
    _debt(client, headers, name="Conso", kind="consumer", principal_cents=315_000)

    body = client.get("/api/portfolio/networth", headers=headers).json()
    today = body["today"]
    assert today["assets_cents"] == 991_240
    assert today["debts_cents"] == 1_095_000
    assert today["net_cents"] == 991_240 - 1_095_000
    assert today["breakdown"] == [
        {"key": "positions", "amount_cents": 0},
        {"key": "declared", "amount_cents": 0},
        {"key": "cash", "amount_cents": 991_240},
        {"key": "debts", "amount_cents": -1_095_000},
    ]


def test_an_archived_debt_no_longer_weighs(client):
    headers = _register(client)
    _account(client, headers, "Livret A", "savings", opening_balance_cents=100_000)
    debt_id = _debt(client, headers, principal_cents=40_000)
    client.delete(f"/api/debts/{debt_id}", headers=headers)

    body = client.get("/api/portfolio/networth", headers=headers).json()
    assert body["today"]["debts_cents"] == 0
    assert body["today"]["net_cents"] == 100_000


def test_one_snapshot_a_day_and_the_history_comes_back_ordered(client, db):
    headers = _register(client)
    _account(client, headers, "Livret A", "savings", opening_balance_cents=100_000)

    first = client.get("/api/portfolio/networth", headers=headers).json()
    second = client.get("/api/portfolio/networth", headers=headers).json()
    rows = db.query(NetWorthSnapshot).all()
    assert len(rows) == 1
    assert rows[0].taken_on == date.today()
    assert rows[0].assets_cents == 100_000 and rows[0].debts_cents == 0

    assert first["history"] == second["history"]
    assert len(second["history"]) == 1
    point = second["history"][0]
    assert point["taken_on"] == date.today().isoformat()
    assert point["net_cents"] == 100_000


def test_history_is_this_household_s_alone(client):
    max_headers = _register(client)
    bob = _register(client, "bob@example.com")
    _account(client, max_headers, "Livret A", "savings", opening_balance_cents=100_000)
    client.get("/api/portfolio/networth", headers=max_headers)

    body = client.get("/api/portfolio/networth", headers=bob).json()
    assert body["today"]["net_cents"] == 0
    assert [p["net_cents"] for p in body["history"]] == [0]
