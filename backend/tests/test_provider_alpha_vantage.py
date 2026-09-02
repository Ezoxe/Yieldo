"""`market/providers/alpha_vantage.py`, against recorded responses only.

Alpha Vantage's own quirk: it never uses HTTP error codes. Every failure --
an unknown symbol, a bad key, a spent rate limit -- comes back as a 200
whose JSON body carries a different top-level key ("Error Message",
"Information", or an empty "Global Quote"). Each must map to a DIFFERENT
one of the five causes even though none of them is a distinct HTTP status.
"""

import os
from datetime import UTC, datetime

import httpx
import pytest

from app.market.client import MarketError, MarketFailureCause
from app.market.providers.alpha_vantage import AlphaVantageProvider
from tests.market_support import flaky_then_ok_transport, json_transport


def test_fetching_a_quote_with_no_key_at_all_refuses_before_any_network_call():
    def _unreachable(_request):
        raise AssertionError("must not make a network call with no key")

    provider = AlphaVantageProvider(transport=httpx.MockTransport(_unreachable))
    with pytest.raises(MarketError) as excinfo:
        provider.fetch_quote("AAPL", None, now=datetime(2026, 9, 2, tzinfo=UTC))
    assert excinfo.value.cause is MarketFailureCause.NO_KEY


def test_a_successful_quote_is_parsed_into_cents_never_a_float():
    provider = AlphaVantageProvider(transport=json_transport("alpha_vantage", "quote_ok"))
    quote = provider.fetch_quote("AAPL", "a-real-key", now=datetime(2026, 9, 2, tzinfo=UTC))
    assert quote.price_cents == 19_589
    assert quote.as_of.isoformat() == "2026-08-29"
    assert quote.source == "alpha_vantage"


def test_an_empty_global_quote_means_the_symbol_is_unknown():
    provider = AlphaVantageProvider(transport=json_transport("alpha_vantage", "unknown_symbol"))
    with pytest.raises(MarketError) as excinfo:
        provider.fetch_quote("ZZZZ", "a-real-key", now=datetime(2026, 9, 2, tzinfo=UTC))
    assert excinfo.value.cause is MarketFailureCause.UNKNOWN_SYMBOL
    assert "ZZZZ" in excinfo.value.message


def test_an_error_message_about_the_api_key_is_key_rejected_not_unknown_symbol():
    """The trap: both an invalid key and an unknown symbol can surface as an
    'Error Message' string in this API. The wording must be read to tell
    them apart -- collapsing both into one cause is exactly what CLAUDE.md's
    'French sentence naming the wrong cause' defect looks like here."""
    provider = AlphaVantageProvider(transport=json_transport("alpha_vantage", "key_rejected"))
    with pytest.raises(MarketError) as excinfo:
        provider.fetch_quote("AAPL", "a-bad-key", now=datetime(2026, 9, 2, tzinfo=UTC))
    assert excinfo.value.cause is MarketFailureCause.KEY_REJECTED


def test_the_daily_rate_limit_information_message_is_quota_exhausted():
    provider = AlphaVantageProvider(transport=json_transport("alpha_vantage", "quota_exhausted"))
    with pytest.raises(MarketError) as excinfo:
        provider.fetch_quote("AAPL", "a-real-key", now=datetime(2026, 9, 2, tzinfo=UTC))
    assert excinfo.value.cause is MarketFailureCause.QUOTA_EXHAUSTED


def test_a_connection_failure_is_service_unreachable():
    from tests.market_support import failing_transport

    transport = failing_transport(lambda request: httpx.ConnectError("refused", request=request))
    provider = AlphaVantageProvider(transport=transport)
    with pytest.raises(MarketError) as excinfo:
        provider.fetch_quote("AAPL", "a-real-key", now=datetime(2026, 9, 2, tzinfo=UTC))
    assert excinfo.value.cause is MarketFailureCause.SERVICE_UNREACHABLE


def test_a_transient_failure_is_retried_and_can_still_succeed():
    transport, calls = flaky_then_ok_transport("alpha_vantage", "quote_ok")
    provider = AlphaVantageProvider(transport=transport)
    quote = provider.fetch_quote("AAPL", "a-real-key", now=datetime(2026, 9, 2, tzinfo=UTC))
    assert quote.price_cents == 19_589
    assert calls["n"] == 2


def test_the_provider_declares_its_name_and_that_it_requires_a_key():
    provider = AlphaVantageProvider()
    assert provider.name == "alpha_vantage"
    assert provider.requires_key is True


@pytest.mark.skipif(
    not os.environ.get("YIELDO_LIVE_ALPHA_VANTAGE_KEY"),
    reason="Set YIELDO_LIVE_ALPHA_VANTAGE_KEY to opt into one real call against Alpha Vantage.",
)
def test_live_alpha_vantage_quote():
    provider = AlphaVantageProvider()
    quote = provider.fetch_quote(
        "AAPL", os.environ["YIELDO_LIVE_ALPHA_VANTAGE_KEY"], now=datetime.now(UTC)
    )
    assert quote.price_cents > 0
