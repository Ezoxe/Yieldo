"""`market/providers/exchangerate_api.py`, against recorded responses only.

ExchangeRate-API's own quirk: the key travels IN THE URL PATH
(`/v6/{key}/latest/{base}`), not as a query parameter or header, and every
failure -- bad key, spent quota, unsupported currency -- is a 200 whose
body carries `"result": "error"` and an `"error-type"` string. The mapping
from `error-type` to one of the five causes is the whole of this provider's
logic.
"""

import os
from datetime import UTC, datetime

import httpx
import pytest

from app.market.client import MarketError, MarketFailureCause
from app.market.providers.exchangerate_api import ExchangeRateApiProvider
from tests.market_support import failing_transport, flaky_then_ok_transport, json_transport


def test_fetching_a_rate_with_no_key_at_all_refuses_before_any_network_call():
    def _unreachable(_request):
        raise AssertionError("must not make a network call with no key")

    provider = ExchangeRateApiProvider(transport=httpx.MockTransport(_unreachable))
    with pytest.raises(MarketError) as excinfo:
        provider.fetch_rate("EUR", "USD", None, now=datetime(2026, 9, 2, tzinfo=UTC))
    assert excinfo.value.cause is MarketFailureCause.NO_KEY


def test_a_successful_rate_is_parsed_as_text_never_a_float():
    provider = ExchangeRateApiProvider(
        transport=json_transport("exchangerate_api", "rate_ok")
    )
    rate = provider.fetch_rate("EUR", "USD", "a-real-key", now=datetime(2026, 9, 2, tzinfo=UTC))
    assert isinstance(rate.rate, str)
    assert rate.rate == "1.0842"
    assert rate.source == "exchangerate_api"


def test_error_type_invalid_key_is_key_rejected():
    provider = ExchangeRateApiProvider(
        transport=json_transport("exchangerate_api", "key_rejected")
    )
    with pytest.raises(MarketError) as excinfo:
        provider.fetch_rate("EUR", "USD", "a-bad-key", now=datetime(2026, 9, 2, tzinfo=UTC))
    assert excinfo.value.cause is MarketFailureCause.KEY_REJECTED


def test_error_type_quota_reached_is_quota_exhausted_not_key_rejected():
    """Both come back with the same top-level shape (`result: error`,
    `error-type: <string>`) -- only the string itself tells the two apart.
    A mapping that only checked `result == "error"` would collapse every
    ExchangeRate-API failure into one cause, exactly the defect this lot
    exists to close."""
    provider = ExchangeRateApiProvider(
        transport=json_transport("exchangerate_api", "quota_exhausted")
    )
    with pytest.raises(MarketError) as excinfo:
        provider.fetch_rate("EUR", "USD", "a-real-key", now=datetime(2026, 9, 2, tzinfo=UTC))
    assert excinfo.value.cause is MarketFailureCause.QUOTA_EXHAUSTED


def test_error_type_unsupported_code_is_unknown_symbol():
    provider = ExchangeRateApiProvider(
        transport=json_transport("exchangerate_api", "unknown_symbol")
    )
    with pytest.raises(MarketError) as excinfo:
        provider.fetch_rate("EUR", "ZZZ", "a-real-key", now=datetime(2026, 9, 2, tzinfo=UTC))
    assert excinfo.value.cause is MarketFailureCause.UNKNOWN_SYMBOL
    assert "ZZZ" in excinfo.value.message


def test_a_connection_failure_is_service_unreachable():
    transport = failing_transport(lambda request: httpx.ConnectError("refused", request=request))
    provider = ExchangeRateApiProvider(transport=transport)
    with pytest.raises(MarketError) as excinfo:
        provider.fetch_rate("EUR", "USD", "a-real-key", now=datetime(2026, 9, 2, tzinfo=UTC))
    assert excinfo.value.cause is MarketFailureCause.SERVICE_UNREACHABLE


def test_a_transient_failure_is_retried_and_can_still_succeed():
    transport, calls = flaky_then_ok_transport("exchangerate_api", "rate_ok")
    provider = ExchangeRateApiProvider(transport=transport)
    rate = provider.fetch_rate("EUR", "USD", "a-real-key", now=datetime(2026, 9, 2, tzinfo=UTC))
    assert rate.rate == "1.0842"
    assert calls["n"] == 2


def test_the_provider_declares_its_name_and_that_it_requires_a_key():
    provider = ExchangeRateApiProvider()
    assert provider.name == "exchangerate_api"
    assert provider.requires_key is True


@pytest.mark.skipif(
    not os.environ.get("YIELDO_LIVE_EXCHANGERATE_API_KEY"),
    reason="Set YIELDO_LIVE_EXCHANGERATE_API_KEY to opt into one real call.",
)
def test_live_exchangerate_api_rate():
    provider = ExchangeRateApiProvider()
    rate = provider.fetch_rate(
        "EUR", "USD", os.environ["YIELDO_LIVE_EXCHANGERATE_API_KEY"], now=datetime.now(UTC)
    )
    assert float(rate.rate) > 0
