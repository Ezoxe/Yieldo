"""Frankfurter: FX rates, `GET /latest?base=...&symbols=...`. No key, ever.

**The one provider in this lot with neither a `key_rejected` nor a
`quota_exhausted` path.** It has no authentication at all -- `requires_key
= False`, and `api_key` is accepted but never used or checked, so a missing
key can never raise `NO_KEY` here. It is also unlimited
(`market/quota.py`'s `frankfurter` spec has `limit=None`), so the
orchestration layer that consults the quota pool before calling this
provider never refuses it either; this module has no opinion on quota at
all, exactly like every other provider.
"""

from datetime import UTC, date, datetime

import httpx

from app.market.client import FxRate, MarketFailureCause, call_with_retry, market_error
from app.market.providers._shared import get_json

NAME = "frankfurter"
BASE_URL = "https://api.frankfurter.dev/v1"


class FrankfurterProvider:
    name = NAME
    requires_key = False

    def __init__(self, transport: httpx.BaseTransport | None = None) -> None:
        self._transport = transport

    def validate_key(self, api_key: str) -> None:
        """Frankfurter has nothing to validate a key against -- this proves
        reachability only, with the same one-real-call shape every other
        provider's `validate_key` has."""
        self.fetch_rate("EUR", "USD", api_key, now=datetime.now(UTC))

    def fetch_rate(
        self, base_currency: str, quote_currency: str, api_key: str | None, *, now: datetime
    ) -> FxRate:
        pair = f"{base_currency}/{quote_currency}"

        def _call() -> FxRate:
            status, body = get_json(
                NAME, f"{BASE_URL}/latest",
                params={"base": base_currency, "symbols": quote_currency},
                transport=self._transport,
            )
            if status == 404:
                raise market_error(MarketFailureCause.UNKNOWN_SYMBOL, NAME, symbol=pair)
            if status != 200 or not isinstance(body, dict):
                raise market_error(MarketFailureCause.SERVICE_UNREACHABLE, NAME)

            rates = body.get("rates")
            as_of_text = body.get("date")
            if not isinstance(rates, dict) or quote_currency not in rates or not as_of_text:
                raise market_error(MarketFailureCause.UNKNOWN_SYMBOL, NAME, symbol=pair)

            return FxRate(
                base_currency=base_currency, quote_currency=quote_currency,
                rate=str(rates[quote_currency]), as_of=date.fromisoformat(as_of_text),
                fetched_at=now, source=NAME,
            )

        return call_with_retry(_call)
