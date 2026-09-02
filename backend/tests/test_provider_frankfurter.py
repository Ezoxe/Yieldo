"""`market/providers/frankfurter.py`, against recorded responses only.

Frankfurter needs no key at all and is unlimited (`market/quota.py`'s
`frankfurter` spec has `limit=None`) -- the only provider with neither a
`key_rejected` nor a `quota_exhausted` path, since it never sends a key and
Yieldo's own quota pool never refuses it. `market/quota.py`'s own tests
already prove the pool never refuses Frankfurter; this file proves the
provider itself never asks for a key it does not need.
"""

import os
from datetime import UTC, datetime

import httpx
import pytest

from app.market.client import MarketError, MarketFailureCause
from app.market.providers.frankfurter import FrankfurterProvider
from tests.market_support import failing_transport, flaky_then_ok_transport, json_transport


def test_fetching_a_rate_with_no_key_at_all_still_succeeds():
    """The central proof for this provider: unlike every keyed provider in
    this lot, `None` for `api_key` must never raise `NO_KEY` here."""
    provider = FrankfurterProvider(transport=json_transport("frankfurter", "rate_ok"))
    rate = provider.fetch_rate("EUR", "USD", None, now=datetime(2026, 9, 2, tzinfo=UTC))
    assert rate.rate == "1.0842"
    assert rate.source == "frankfurter"


def test_a_successful_rate_is_parsed_as_text_never_a_float():
    provider = FrankfurterProvider(transport=json_transport("frankfurter", "rate_ok"))
    rate = provider.fetch_rate("EUR", "USD", None, now=datetime(2026, 9, 2, tzinfo=UTC))
    assert isinstance(rate.rate, str)
    assert rate.base_currency == "EUR"
    assert rate.quote_currency == "USD"
    assert rate.as_of.isoformat() == "2026-08-29"


def test_an_unsupported_currency_is_a_404():
    provider = FrankfurterProvider(
        transport=json_transport("frankfurter", "unknown_symbol", status=404)
    )
    with pytest.raises(MarketError) as excinfo:
        provider.fetch_rate("EUR", "ZZZ", None, now=datetime(2026, 9, 2, tzinfo=UTC))
    assert excinfo.value.cause is MarketFailureCause.UNKNOWN_SYMBOL
    assert "ZZZ" in excinfo.value.message


def test_a_connection_failure_is_service_unreachable():
    transport = failing_transport(lambda request: httpx.ConnectError("refused", request=request))
    provider = FrankfurterProvider(transport=transport)
    with pytest.raises(MarketError) as excinfo:
        provider.fetch_rate("EUR", "USD", None, now=datetime(2026, 9, 2, tzinfo=UTC))
    assert excinfo.value.cause is MarketFailureCause.SERVICE_UNREACHABLE


def test_a_transient_failure_is_retried_and_can_still_succeed():
    transport, calls = flaky_then_ok_transport("frankfurter", "rate_ok")
    provider = FrankfurterProvider(transport=transport)
    rate = provider.fetch_rate("EUR", "USD", None, now=datetime(2026, 9, 2, tzinfo=UTC))
    assert rate.rate == "1.0842"
    assert calls["n"] == 2


def test_the_provider_declares_its_name_and_that_it_does_not_require_a_key():
    provider = FrankfurterProvider()
    assert provider.name == "frankfurter"
    assert provider.requires_key is False


@pytest.mark.skipif(
    not os.environ.get("YIELDO_LIVE_FRANKFURTER_TESTS"),
    reason="Set YIELDO_LIVE_FRANKFURTER_TESTS=1 to opt into one real call against Frankfurter.",
)
def test_live_frankfurter_rate():
    provider = FrankfurterProvider()
    rate = provider.fetch_rate("EUR", "USD", None, now=datetime.now(UTC))
    assert float(rate.rate) > 0
