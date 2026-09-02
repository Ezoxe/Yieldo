"""`market/providers/finnhub.py`, against recorded responses only.

Finnhub prices equities: `/quote?symbol=...&token=...`. Its own quirk is
that an unknown symbol is not an HTTP error at all -- it is a 200 with
every field zeroed out, which is why `test_an_unknown_symbol_is_a_200_with_
every_field_zeroed` exists rather than assuming every provider signals
"unknown" the same way.
"""

import os
from datetime import UTC, datetime

import httpx
import pytest

from app.market.client import MarketError, MarketFailureCause
from app.market.providers.finnhub import FinnhubProvider
from tests.market_support import flaky_then_ok_transport, json_transport


def test_fetching_a_quote_with_no_key_at_all_refuses_before_any_network_call():
    """The precondition, not a provider error shape: never even attempts a
    request. A transport that raises on any call proves this -- if the
    provider tried to call out, the test would fail on the transport
    itself, not just on the wrong cause."""
    def _unreachable(_request):
        raise AssertionError("must not make a network call with no key")

    provider = FinnhubProvider(transport=httpx.MockTransport(_unreachable))
    with pytest.raises(MarketError) as excinfo:
        provider.fetch_quote("AAPL", None, now=datetime(2026, 9, 2, tzinfo=UTC))
    assert excinfo.value.cause is MarketFailureCause.NO_KEY


def test_a_successful_quote_is_parsed_into_cents_never_a_float():
    provider = FinnhubProvider(transport=json_transport("finnhub", "quote_ok"))
    quote = provider.fetch_quote("AAPL", "a-real-key", now=datetime(2026, 9, 2, tzinfo=UTC))
    # 195.89 EUR/USD -> 19589 cents, exactly -- not 19588 or 19590, which a
    # float round-trip could produce.
    assert quote.price_cents == 19_589
    assert quote.symbol == "AAPL"
    assert quote.source == "finnhub"
    assert quote.as_of.isoformat() == "2024-05-30"


def test_an_unknown_symbol_is_a_200_with_every_field_zeroed():
    provider = FinnhubProvider(transport=json_transport("finnhub", "unknown_symbol"))
    with pytest.raises(MarketError) as excinfo:
        provider.fetch_quote("ZZZZ", "a-real-key", now=datetime(2026, 9, 2, tzinfo=UTC))
    assert excinfo.value.cause is MarketFailureCause.UNKNOWN_SYMBOL
    assert "ZZZZ" in excinfo.value.message


def test_an_invalid_key_is_a_401():
    provider = FinnhubProvider(transport=json_transport("finnhub", "key_rejected", status=401))
    with pytest.raises(MarketError) as excinfo:
        provider.fetch_quote("AAPL", "a-bad-key", now=datetime(2026, 9, 2, tzinfo=UTC))
    assert excinfo.value.cause is MarketFailureCause.KEY_REJECTED


def test_finnhubs_own_rate_limit_is_a_429():
    """Distinct from our own pre-emptive quota pool (market/quota.py) --
    this is Finnhub's OWN 429, mapped to the same cause for the rare case
    our 80% ceiling undershot."""
    provider = FinnhubProvider(
        transport=json_transport("finnhub", "quota_exhausted", status=429)
    )
    with pytest.raises(MarketError) as excinfo:
        provider.fetch_quote("AAPL", "a-real-key", now=datetime(2026, 9, 2, tzinfo=UTC))
    assert excinfo.value.cause is MarketFailureCause.QUOTA_EXHAUSTED


def test_a_connection_failure_is_service_unreachable():
    from tests.market_support import failing_transport

    transport = failing_transport(lambda request: httpx.ConnectError("refused", request=request))
    provider = FinnhubProvider(transport=transport)
    with pytest.raises(MarketError) as excinfo:
        provider.fetch_quote("AAPL", "a-real-key", now=datetime(2026, 9, 2, tzinfo=UTC))
    assert excinfo.value.cause is MarketFailureCause.SERVICE_UNREACHABLE


def test_a_transient_failure_is_retried_and_can_still_succeed():
    transport, calls = flaky_then_ok_transport("finnhub", "quote_ok")
    provider = FinnhubProvider(transport=transport)
    quote = provider.fetch_quote("AAPL", "a-real-key", now=datetime(2026, 9, 2, tzinfo=UTC))
    assert quote.price_cents == 19_589
    assert calls["n"] == 2


def test_validate_key_makes_one_real_call_and_raises_on_rejection():
    provider = FinnhubProvider(transport=json_transport("finnhub", "key_rejected", status=401))
    with pytest.raises(MarketError) as excinfo:
        provider.validate_key("a-bad-key")
    assert excinfo.value.cause is MarketFailureCause.KEY_REJECTED


def test_validate_key_returns_none_on_success():
    provider = FinnhubProvider(transport=json_transport("finnhub", "quote_ok"))
    assert provider.validate_key("a-real-key") is None


def test_the_provider_declares_its_name_and_that_it_requires_a_key():
    provider = FinnhubProvider()
    assert provider.name == "finnhub"
    assert provider.requires_key is True


@pytest.mark.skipif(
    not os.environ.get("YIELDO_LIVE_FINNHUB_KEY"),
    reason="Set YIELDO_LIVE_FINNHUB_KEY to opt into one real call against Finnhub.",
)
def test_live_finnhub_quote():
    provider = FinnhubProvider()
    quote = provider.fetch_quote(
        "AAPL", os.environ["YIELDO_LIVE_FINNHUB_KEY"], now=datetime.now(UTC)
    )
    assert quote.price_cents > 0
