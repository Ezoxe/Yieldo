"""Finnhub: equities quotes, `GET /quote?symbol=...&token=...`.

**Finnhub's own quirk: an unknown symbol is not an HTTP error at all.** It
answers 200 with every field zeroed (`{"c":0,...,"t":0}`) -- the ONLY
provider in this lot that signals "unknown" this way rather than an empty
object, a 404, or an explicit error field. Detected on `c` (current price)
being zero rather than on `t` (timestamp) being zero, because `c` is the
field this provider actually needs.
"""

from datetime import UTC, datetime

import httpx

from app.market.client import MarketFailureCause, Quote, call_with_retry, market_error
from app.market.providers._shared import cents_from_decimal_text, get_json

NAME = "finnhub"
BASE_URL = "https://finnhub.io/api/v1"
# Finnhub's free tier prices US-listed equities; the quote endpoint itself
# names no currency, so this is the one place that assumption is written
# down rather than repeated at every call site.
CURRENCY = "USD"


class FinnhubProvider:
    name = NAME
    requires_key = True

    def __init__(self, transport: httpx.BaseTransport | None = None) -> None:
        self._transport = transport

    def validate_key(self, api_key: str) -> None:
        """One cheap, well-known symbol -- proves the key without pricing
        anything the caller actually asked for."""
        self.fetch_quote("AAPL", api_key, now=datetime.now(UTC))

    def fetch_quote(self, symbol: str, api_key: str | None, *, now: datetime) -> Quote:
        if not api_key:
            raise market_error(MarketFailureCause.NO_KEY, NAME)

        def _call() -> Quote:
            status, body = get_json(
                NAME,
                f"{BASE_URL}/quote",
                params={"symbol": symbol, "token": api_key},
                transport=self._transport,
            )
            if status in (401, 403):
                raise market_error(MarketFailureCause.KEY_REJECTED, NAME)
            if status == 429:
                raise market_error(MarketFailureCause.QUOTA_EXHAUSTED, NAME)
            if status != 200 or not isinstance(body, dict):
                raise market_error(MarketFailureCause.SERVICE_UNREACHABLE, NAME)

            price_text = body.get("c")
            if price_text is None:
                raise market_error(MarketFailureCause.UNKNOWN_SYMBOL, NAME, symbol=symbol)
            price_cents = cents_from_decimal_text(NAME, str(price_text))
            # A zeroed price is Finnhub's own signal for "unknown symbol" --
            # see the module docstring.
            if price_cents == 0:
                raise market_error(MarketFailureCause.UNKNOWN_SYMBOL, NAME, symbol=symbol)

            timestamp = body.get("t")
            as_of = (
                datetime.fromtimestamp(int(timestamp), tz=UTC).date()
                if timestamp else now.date()
            )
            return Quote(
                symbol=symbol, price_cents=price_cents, currency=CURRENCY,
                as_of=as_of, fetched_at=now, source=NAME,
            )

        return call_with_retry(_call)
