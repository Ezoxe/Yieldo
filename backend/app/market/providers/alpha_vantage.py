"""Alpha Vantage: equities quotes, `GET ?function=GLOBAL_QUOTE&symbol=...&apikey=...`.

**Alpha Vantage's own quirk: it never uses HTTP error codes.** Every
failure -- an unknown symbol, a rejected key, a spent daily rate limit --
comes back as a 200 whose JSON carries a different top-level key instead:
`"Error Message"` (ambiguous between a bad key and a bad symbol, resolved
below by reading the wording), `"Information"` (the daily rate limit), or
an empty `"Global Quote"` object (an otherwise well-formed request for a
symbol it has nothing for).
"""

from datetime import UTC, date, datetime

import httpx

from app.market.client import MarketFailureCause, Quote, call_with_retry, market_error
from app.market.providers._shared import cents_from_decimal_text, get_json

NAME = "alpha_vantage"
BASE_URL = "https://www.alphavantage.co/query"
CURRENCY = "USD"


class AlphaVantageProvider:
    name = NAME
    requires_key = True

    def __init__(self, transport: httpx.BaseTransport | None = None) -> None:
        self._transport = transport

    def validate_key(self, api_key: str) -> None:
        self.fetch_quote("AAPL", api_key, now=datetime.now(UTC))

    def fetch_quote(self, symbol: str, api_key: str | None, *, now: datetime) -> Quote:
        if not api_key:
            raise market_error(MarketFailureCause.NO_KEY, NAME)

        def _call() -> Quote:
            status, body = get_json(
                NAME, BASE_URL,
                params={"function": "GLOBAL_QUOTE", "symbol": symbol, "apikey": api_key},
                transport=self._transport,
            )
            if status != 200 or not isinstance(body, dict):
                raise market_error(MarketFailureCause.SERVICE_UNREACHABLE, NAME)

            information = body.get("Information")
            if isinstance(information, str) and "rate limit" in information.lower():
                raise market_error(MarketFailureCause.QUOTA_EXHAUSTED, NAME)

            error_message = body.get("Error Message")
            if isinstance(error_message, str):
                # The wording is the only signal Alpha Vantage gives: a
                # message about "apikey" is the key, anything else here is
                # this call's symbol or shape being rejected.
                if "apikey" in error_message.lower():
                    raise market_error(MarketFailureCause.KEY_REJECTED, NAME)
                raise market_error(MarketFailureCause.UNKNOWN_SYMBOL, NAME, symbol=symbol)

            quote = body.get("Global Quote")
            if not quote:
                raise market_error(MarketFailureCause.UNKNOWN_SYMBOL, NAME, symbol=symbol)

            price_text = quote.get("05. price")
            as_of_text = quote.get("07. latest trading day")
            if not price_text or not as_of_text:
                raise market_error(MarketFailureCause.UNKNOWN_SYMBOL, NAME, symbol=symbol)

            return Quote(
                symbol=symbol, price_cents=cents_from_decimal_text(NAME, price_text),
                currency=CURRENCY, as_of=date.fromisoformat(as_of_text), fetched_at=now,
                source=NAME,
            )

        return call_with_retry(_call)
