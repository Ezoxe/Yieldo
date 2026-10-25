"""The connector key: the long-lived credential EZLink's Yieldo agent holds.

Unlike the `yld_` key it never expires and is never shown twice, so it is
stored as a hash. What makes a key that does not expire acceptable is pinned
below: it is revocable at once, it is replaced rather than multiplied, and it
stops at exactly the same wall as the agent key -- the account's own
credentials, the brokers and the mandate.
"""

import pytest

from app.api.invest_common import actor_of
from app.models import ConnectorKey


def register(client, email="max@example.com"):
    response = client.post("/api/auth/register", json={
        "name": "Max", "email": email, "password": "motdepasse123"})
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def create_key(client, headers) -> str:
    response = client.post("/api/connector-key", headers=headers)
    assert response.status_code == 201
    return response.json()["key"]


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_there_is_no_key_until_one_is_asked_for(client):
    headers = register(client)
    body = client.get("/api/connector-key", headers=headers).json()
    assert body == {"exists": False, "created_at": None, "last_used_at": None}


def test_creating_a_key_shows_it_once_and_never_again(client):
    headers = register(client)
    token = create_key(client, headers)

    assert token.startswith("ycn_")
    status = client.get("/api/connector-key", headers=headers).json()
    assert status["exists"] is True
    assert status["created_at"] is not None
    assert token not in str(status)


def test_the_secret_is_stored_as_a_hash(client, db):
    headers = register(client)
    token = create_key(client, headers)

    stored = db.query(ConnectorKey).one()
    secret = token.split("_")[2]
    assert secret not in stored.secret_hash
    assert len(stored.secret_hash) == 64


def test_a_key_reads_the_ledger(client):
    headers = register(client)
    token = create_key(client, headers)

    response = client.get("/api/accounts", headers=bearer(token))

    assert response.status_code == 200


def test_using_the_key_records_its_last_use(client):
    headers = register(client)
    token = create_key(client, headers)
    client.get("/api/accounts", headers=bearer(token))

    assert client.get("/api/connector-key", headers=headers).json()["last_used_at"] is not None


def test_creating_again_replaces_the_previous_key(client):
    headers = register(client)
    first = create_key(client, headers)
    second = create_key(client, headers)

    assert first != second
    assert client.get("/api/accounts", headers=bearer(first)).status_code == 401
    assert client.get("/api/accounts", headers=bearer(second)).status_code == 200


def test_revoking_stops_the_key_at_once(client):
    headers = register(client)
    token = create_key(client, headers)

    assert client.delete("/api/connector-key", headers=headers).status_code == 204

    assert client.get("/api/accounts", headers=bearer(token)).status_code == 401
    assert client.get("/api/connector-key", headers=headers).json()["exists"] is False


def test_a_forged_secret_is_refused(client):
    headers = register(client)
    token = create_key(client, headers)
    prefix, selector, _ = token.split("_")

    forged = f"{prefix}_{selector}_{'0' * 64}"

    assert client.get("/api/accounts", headers=bearer(forged)).status_code == 401


@pytest.mark.parametrize(("method", "path"), [
    ("get", "/api/connector-key"),
    ("post", "/api/connector-key"),
    ("delete", "/api/connector-key"),
    ("get", "/api/access-key"),
    ("post", "/api/auth/password"),
    ("get", "/api/connections"),
    ("get", "/api/invest/venues"),
    ("put", "/api/invest/policy"),
])
def test_the_key_stops_at_the_session_wall(client, method, path):
    headers = register(client)
    token = create_key(client, headers)

    response = getattr(client, method)(path, headers=bearer(token))

    assert response.status_code == 401
    assert "session" in response.json()["detail"]


def test_one_household_key_never_opens_another(client):
    first = register(client, "un@example.com")
    second = register(client, "deux@example.com")
    client.post("/api/accounts", headers=second, json={"name": "Secret", "kind": "checking"})
    token = create_key(client, first)

    names = [row["name"] for row in client.get("/api/accounts", headers=bearer(token)).json()]

    assert "Secret" not in names


def test_the_investment_journal_names_the_connector():
    class FakeRequest:
        headers = {"Authorization": "Bearer ycn_abc_def"}

    assert actor_of(FakeRequest()) == "connector"


def test_the_connector_cannot_start_a_live_cycle(client):
    headers = register(client)
    token = create_key(client, headers)
    client.put("/api/invest/policy", headers=headers, json={
        "max_position_cents": 200_000, "max_exposure_cents": 1_000_000,
        "max_order_notional_cents": 200_000, "max_daily_loss_cents": 50_000,
        "min_cash_buffer_cents": 0, "min_order_notional_cents": 1_000,
        "max_drawdown_bps": 2_000, "max_orders_per_day": 20,
        "allowed_symbols": ["AAPL"], "allow_short": False,
        "allow_leverage": False, "allow_limit_orders": True,
        "minimum_conviction": 0, "minimum_probability_bps": 0,
        "max_volatility_bps": 10_000, "full_conviction_share_bps": 10_000,
        "autonomy": "live",
    })

    response = client.post("/api/invest/run", headers=bearer(token))

    assert response.status_code == 403
    assert "exécution réelle" in response.json()["detail"]
