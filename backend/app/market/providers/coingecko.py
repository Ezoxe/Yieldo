"""CoinGecko: crypto quotes, `GET /simple/price?ids=...&vs_currencies=usd`.

**The one provider in this lot that needs no key at all.** The free tier
works unauthenticated; a demo key, when the caller has one, only raises the
rate limit and is sent as a header (`x-cg-demo-api-key`) rather than a
query parameter, unlike every keyed provider here. `requires_key = False`
and `fetch_quote` never raises `NO_KEY` -- a missing key is simply the
common case, not a precondition failure.

**An unknown coin id is not an error either.** `/simple/price` silently
omits any id it does not recognise from the response body -- there is no
error field to read, only an absence.
"""

from datetime import UTC, datetime

import httpx

from app.market.client import MarketFailureCause, Quote, call_with_retry, market_error
from app.market.providers._shared import cents_from_decimal_text, get_json

NAME = "coingecko"
BASE_URL = "https://api.coingecko.com/api/v3"
CURRENCY = "USD"


class CoinGeckoProvider:
    name = NAME
    requires_key = False

    def __init__(self, transport: httpx.BaseTransport | None = None) -> None:
        self._transport = transport

    def validate_key(self, api_key: str) -> None:
        """Even though no key is required, a caller storing a demo key in
        Réglages → Connexions still gets it validated with one real call."""
        self.fetch_quote("bitcoin", api_key, now=datetime.now(UTC))

    def fetch_quote(self, symbol: str, api_key: str | None, *, now: datetime) -> Quote:
        # `symbol` here is CoinGecko's own coin id ("bitcoin"), not a ticker.
        headers = {"x-cg-demo-api-key": api_key} if api_key else None

        def _call() -> Quote:
            status, body = get_json(
                NAME, f"{BASE_URL}/simple/price",
                params={"ids": symbol, "vs_currencies": "usd"},
                headers=headers, transport=self._transport,
            )
            if status in (401, 403):
                raise market_error(MarketFailureCause.KEY_REJECTED, NAME)
            if status == 429:
                raise market_error(MarketFailureCause.QUOTA_EXHAUSTED, NAME)
            if status != 200 or not isinstance(body, dict):
                raise market_error(MarketFailureCause.SERVICE_UNREACHABLE, NAME)

            entry = body.get(symbol)
            if not isinstance(entry, dict) or "usd" not in entry:
                raise market_error(MarketFailureCause.UNKNOWN_SYMBOL, NAME, symbol=symbol)

            return Quote(
                symbol=symbol, price_cents=cents_from_decimal_text(NAME, str(entry["usd"])),
                currency=CURRENCY, as_of=now.date(), fetched_at=now, source=NAME,
            )

        return call_with_retry(_call)
