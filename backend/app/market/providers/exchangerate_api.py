"""ExchangeRate-API: FX rates, `GET /v6/{key}/latest/{base}`.

**The key travels in the URL PATH**, unlike every other keyed provider in
this lot (Finnhub and Alpha Vantage both use a query parameter). **Every
failure is a 200** whose body carries `"result": "error"` and an
`"error-type"` string -- there is no HTTP status to read at all; the
`error-type` value is the only signal, and it is read literally rather than
inferred from the HTTP status, which stays 200 no matter which of the three
known error types comes back.
"""

from datetime import UTC, datetime

import httpx

from app.market.client import FxRate, MarketFailureCause, call_with_retry, market_error
from app.market.providers._shared import get_json

NAME = "exchangerate_api"
BASE_URL = "https://v6.exchangerate-api.com/v6"

# error-type -> cause. Anything else this API might return (e.g.
# "malformed-request", a bug in the request Yieldo itself built) has no
# clean home among the five and falls through to SERVICE_UNREACHABLE below --
# it is neither the key, the quota, nor the symbol that a user could act on.
_ERROR_TYPE_CAUSES: dict[str, MarketFailureCause] = {
    "invalid-key": MarketFailureCause.KEY_REJECTED,
    "inactive-account": MarketFailureCause.KEY_REJECTED,
    "quota-reached": MarketFailureCause.QUOTA_EXHAUSTED,
    "unsupported-code": MarketFailureCause.UNKNOWN_SYMBOL,
}


class ExchangeRateApiProvider:
    name = NAME
    requires_key = True

    def __init__(self, transport: httpx.BaseTransport | None = None) -> None:
        self._transport = transport

    def validate_key(self, api_key: str) -> None:
        self.fetch_rate("EUR", "USD", api_key, now=datetime.now(UTC))

    def fetch_rate(
        self, base_currency: str, quote_currency: str, api_key: str | None, *, now: datetime
    ) -> FxRate:
        if not api_key:
            raise market_error(MarketFailureCause.NO_KEY, NAME)
        pair = f"{base_currency}/{quote_currency}"

        def _call() -> FxRate:
            status, body = get_json(
                NAME, f"{BASE_URL}/{api_key}/latest/{base_currency}",
                transport=self._transport,
            )
            if not isinstance(body, dict):
                raise market_error(MarketFailureCause.SERVICE_UNREACHABLE, NAME)

            if body.get("result") == "error":
                error_type = body.get("error-type")
                cause = _ERROR_TYPE_CAUSES.get(error_type)
                if cause is MarketFailureCause.UNKNOWN_SYMBOL:
                    raise market_error(cause, NAME, symbol=pair)
                if cause is not None:
                    raise market_error(cause, NAME)
                raise market_error(MarketFailureCause.SERVICE_UNREACHABLE, NAME)

            if status != 200:
                raise market_error(MarketFailureCause.SERVICE_UNREACHABLE, NAME)

            rates = body.get("conversion_rates")
            if not isinstance(rates, dict) or quote_currency not in rates:
                raise market_error(MarketFailureCause.UNKNOWN_SYMBOL, NAME, symbol=pair)

            # The API reports only when it last refreshed server-side, not
            # a trading date for this specific rate -- the fetch date is
            # the best "as of" this shape actually supports.
            return FxRate(
                base_currency=base_currency, quote_currency=quote_currency,
                rate=str(rates[quote_currency]), as_of=now.date(), fetched_at=now, source=NAME,
            )

        return call_with_retry(_call)
