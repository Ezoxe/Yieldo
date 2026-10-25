"""What a broker says the household holds: cash and assets, read and never traded.

Each adapter's `holdings()` is one or two read calls. Nothing here places,
cancels or prepares an order; the tests pin the parsing of each broker's
answer, with `request` replaced by the broker's recorded reply.
"""

import json

import pytest

from app.trading.venues import alpaca, binance, kraken
from app.trading.venues.alpaca import AlpacaVenue
from app.trading.venues.base import VenueError
from app.trading.venues.binance import BinanceVenue
from app.trading.venues.kraken import KrakenVenue


def replying(monkeypatch, module, replies: dict[str, object]):
    """Answer each call by the first key found in its URL; record every call."""
    calls: list[tuple[str, str]] = []

    def fake_request(method, url, **_kwargs):
        calls.append((method, url))
        for fragment, body in replies.items():
            if fragment in url:
                return json.dumps(body)
        raise AssertionError(f"unexpected call {method} {url}")

    monkeypatch.setattr(module, "request", fake_request)
    return calls


def test_alpaca_reads_cash_and_positions_with_their_value(monkeypatch):
    calls = replying(monkeypatch, alpaca, {
        "/v2/account": {"cash": "1520.35", "currency": "USD", "status": "ACTIVE"},
        "/v2/positions": [
            {"symbol": "AAPL", "qty": "3.5", "market_value": "805.70"},
            {"symbol": "VTI", "qty": "10", "market_value": "2650"},
        ],
    })

    held = AlpacaVenue(mode="live", api_key="k", api_secret="s").holdings()

    assert [(c.currency, c.amount_cents) for c in held.cash] == [("USD", 152035)]
    assert [(a.symbol, a.quantity, a.value_cents, a.currency) for a in held.assets] == [
        ("AAPL", "3.5", 80570, "USD"), ("VTI", "10", 265000, "USD"),
    ]
    assert all(method == "GET" for method, _ in calls)


def test_kraken_separates_fiat_from_crypto_and_skips_empty_balances(monkeypatch):
    replying(monkeypatch, kraken, {
        "/0/private/Balance": {"error": [], "result": {
            "ZEUR": "250.5000", "XXBT": "0.0123000000", "XETH": "0.0000000000", "DOT": "12.5",
        }},
    })
    monkeypatch.setattr(KrakenVenue, "_private", lambda self, path, data: {
        "ZEUR": "250.5000", "XXBT": "0.0123000000", "XETH": "0.0000000000", "DOT": "12.5",
    })

    held = KrakenVenue(mode="live", api_key="k", api_secret="c2VjcmV0").holdings()

    assert [(c.currency, c.amount_cents) for c in held.cash] == [("EUR", 25050)]
    assert [(a.symbol, a.quantity, a.value_cents) for a in held.assets] == [
        ("DOT", "12.5", None), ("XXBT", "0.0123", None),
    ]


def test_binance_adds_free_and_locked_and_reads_fiat_as_cash(monkeypatch):
    replying(monkeypatch, binance, {
        "/api/v3/account": {"canTrade": True, "balances": [
            {"asset": "EUR", "free": "100.00000000", "locked": "20.00000000"},
            {"asset": "BTC", "free": "0.00100000", "locked": "0.00050000"},
            {"asset": "ETH", "free": "0.00000000", "locked": "0.00000000"},
        ]},
    })

    held = BinanceVenue(mode="live", api_key="k", api_secret="s").holdings()

    assert [(c.currency, c.amount_cents) for c in held.cash] == [("EUR", 12000)]
    assert [(a.symbol, a.quantity) for a in held.assets] == [("BTC", "0.0015")]


def test_a_refused_key_is_a_named_refusal(monkeypatch):
    def refused(*_args, **_kwargs):
        from app.trading.venues.base import VenueFailureCause, venue_error

        raise venue_error(VenueFailureCause.CREDENTIALS_REJECTED, "Alpaca", "HTTP 401")

    monkeypatch.setattr(alpaca, "request", refused)

    with pytest.raises(VenueError) as caught:
        AlpacaVenue(mode="live", api_key="k", api_secret="s").holdings()
    assert "Alpaca" in caught.value.message
