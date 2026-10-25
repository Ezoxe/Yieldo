"""GET /api/invest/avoirs -- the brokers read, the simulated book left out."""

import pytest

from app.models import TradingVenue
from app.trading.venues import factory
from app.trading.venues.base import VenueFailureCause, venue_error
from app.trading.venues.holdings import CashBalance, HeldAsset, VenueHoldings


@pytest.fixture
def household(client):
    registered = client.post("/api/auth/register", json={
        "name": "Max", "email": "max@example.com", "password": "motdepasse123",
    }).json()
    return {"Authorization": f"Bearer {registered['access_token']}"}


def user_id_of(client, headers) -> int:
    return client.get("/api/auth/me", headers=headers).json()["id"]


def add_venue(db, user_id, venue, mode="live", label=None, enabled=True):
    row = TradingVenue(user_id=user_id, venue=venue, mode=mode, label=label or venue,
                       api_key_encrypted="x", api_secret_encrypted="y", slippage_bps=10,
                       price_source="venue", enabled=enabled)
    db.add(row)
    db.commit()
    return row


class FakeAdapter:
    def __init__(self, row):
        self.row = row

    def holdings(self):
        if self.row.venue == "kraken":
            raise venue_error(VenueFailureCause.CREDENTIALS_REJECTED, "Kraken", "HTTP 401")
        return VenueHoldings(
            cash=(CashBalance("USD", 152035),),
            assets=(HeldAsset("AAPL", "3.5", 80570, "USD"),),
        )


def test_every_broker_is_read_and_a_refusal_stays_on_its_card(
    client, household, db, monkeypatch
):
    user_id = user_id_of(client, household)
    add_venue(db, user_id, "alpaca", label="Alpaca réel")
    add_venue(db, user_id, "kraken", label="Kraken")
    add_venue(db, user_id, "internal", mode="paper", label="Bac à sable")
    add_venue(db, user_id, "binance", label="Éteint", enabled=False)
    monkeypatch.setattr(factory, "build", lambda row, **_: FakeAdapter(row))

    answer = client.get("/api/invest/avoirs", headers=household).json()
    cards = {card["label"]: card for card in answer}

    assert set(cards) == {"Alpaca réel", "Kraken"}
    assert cards["Alpaca réel"]["ok"] is True
    assert cards["Alpaca réel"]["cash"] == [{"currency": "USD", "amount_cents": 152035}]
    assert cards["Alpaca réel"]["assets"][0] == {
        "symbol": "AAPL", "quantity": "3.5", "value_cents": 80570, "currency": "USD"}
    assert cards["Kraken"]["ok"] is False
    assert "Kraken" in cards["Kraken"]["message"]
    assert cards["Kraken"]["cash"] == [] and cards["Kraken"]["assets"] == []


def test_no_broker_means_an_empty_list(client, household):
    assert client.get("/api/invest/avoirs", headers=household).json() == []


def test_the_connector_reads_them_and_another_household_does_not(
    client, household, db, monkeypatch
):
    add_venue(db, user_id_of(client, household), "alpaca")
    monkeypatch.setattr(factory, "build", lambda row, **_: FakeAdapter(row))
    key = client.post("/api/connector-key", headers=household).json()["key"]
    stranger = client.post("/api/auth/register", json={
        "name": "Eve", "email": "eve@example.com", "password": "motdepasse123",
    }).json()

    via_connector = client.post("/api/connector/call", headers={"Authorization": f"Bearer {key}"},
                                json={"tool": "yieldo_invest_avoirs", "args": {}})
    theirs = client.get("/api/invest/avoirs",
                        headers={"Authorization": f"Bearer {stranger['access_token']}"})

    assert via_connector.json()["body"][0]["assets"][0]["symbol"] == "AAPL"
    assert theirs.json() == []
