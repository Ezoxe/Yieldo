"""`market/providers/coingecko.py`, against recorded responses only.

CoinGecko's own quirk: it needs no key at all on the free tier, so a demo
key is optional (`requires_key = False`), sent as a header when present
rather than a query parameter -- unlike every keyed provider in this lot.
An unknown coin id on `/simple/price` is not an error either: it is a 200
with the requested id simply absent from the body.
"""

import os
from datetime import UTC, datetime

import httpx
import pytest

from app.market.client import MarketError, MarketFailureCause
from app.market.providers.coingecko import CoinGeckoProvider
from tests.market_support import failing_transport, flaky_then_ok_transport, json_transport


def test_fetching_a_quote_with_no_key_still_makes_the_call_coingecko_needs_none():
    """The opposite proof from the keyed providers: CoinGecko's free tier
    must NOT refuse for lack of a key -- a fixture that only tried the
    keyed providers could not catch a `requires_key` regression here."""
    provider = CoinGeckoProvider(transport=json_transport("coingecko", "quote_ok"))
    quote = provider.fetch_quote("bitcoin", None, now=datetime(2026, 9, 2, tzinfo=UTC))
    assert quote.price_cents == 6_500_012


def test_a_successful_quote_is_parsed_into_cents_never_a_float():
    provider = CoinGeckoProvider(transport=json_transport("coingecko", "quote_ok"))
    quote = provider.fetch_quote("bitcoin", "a-demo-key", now=datetime(2026, 9, 2, tzinfo=UTC))
    assert quote.price_cents == 6_500_012
    assert quote.symbol == "bitcoin"
    assert quote.source == "coingecko"


def test_an_id_absent_from_the_response_body_is_unknown_symbol():
    provider = CoinGeckoProvider(transport=json_transport("coingecko", "unknown_symbol"))
    with pytest.raises(MarketError) as excinfo:
        provider.fetch_quote("not-a-real-coin", None, now=datetime(2026, 9, 2, tzinfo=UTC))
    assert excinfo.value.cause is MarketFailureCause.UNKNOWN_SYMBOL
    assert "not-a-real-coin" in excinfo.value.message


def test_an_invalid_demo_key_is_a_401():
    provider = CoinGeckoProvider(
        transport=json_transport("coingecko", "key_rejected", status=401)
    )
    with pytest.raises(MarketError) as excinfo:
        provider.fetch_quote("bitcoin", "a-bad-key", now=datetime(2026, 9, 2, tzinfo=UTC))
    assert excinfo.value.cause is MarketFailureCause.KEY_REJECTED


def test_coingeckos_own_rate_limit_is_a_429():
    provider = CoinGeckoProvider(
        transport=json_transport("coingecko", "quota_exhausted", status=429)
    )
    with pytest.raises(MarketError) as excinfo:
        provider.fetch_quote("bitcoin", None, now=datetime(2026, 9, 2, tzinfo=UTC))
    assert excinfo.value.cause is MarketFailureCause.QUOTA_EXHAUSTED


def test_a_connection_failure_is_service_unreachable():
    transport = failing_transport(lambda request: httpx.ConnectError("refused", request=request))
    provider = CoinGeckoProvider(transport=transport)
    with pytest.raises(MarketError) as excinfo:
        provider.fetch_quote("bitcoin", None, now=datetime(2026, 9, 2, tzinfo=UTC))
    assert excinfo.value.cause is MarketFailureCause.SERVICE_UNREACHABLE


def test_a_transient_failure_is_retried_and_can_still_succeed():
    transport, calls = flaky_then_ok_transport("coingecko", "quote_ok")
    provider = CoinGeckoProvider(transport=transport)
    quote = provider.fetch_quote("bitcoin", None, now=datetime(2026, 9, 2, tzinfo=UTC))
    assert quote.price_cents == 6_500_012
    assert calls["n"] == 2


def test_the_provider_declares_its_name_and_that_it_does_not_require_a_key():
    provider = CoinGeckoProvider()
    assert provider.name == "coingecko"
    assert provider.requires_key is False


@pytest.mark.skipif(
    not os.environ.get("YIELDO_LIVE_COINGECKO_TESTS"),
    reason="Set YIELDO_LIVE_COINGECKO_TESTS=1 to opt into one real call against CoinGecko.",
)
def test_live_coingecko_quote():
    provider = CoinGeckoProvider()
    quote = provider.fetch_quote(
        "bitcoin", os.environ.get("YIELDO_LIVE_COINGECKO_KEY"), now=datetime.now(UTC)
    )
    assert quote.price_cents > 0
