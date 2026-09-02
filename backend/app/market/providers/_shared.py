"""Shared plumbing for the five providers -- the HTTP call itself and the
one place a provider's decimal-looking price text becomes an integer cent
count.

`app/market/providers/` and the router (`api/connections.py`, Task 6) are
the only code in this application allowed to touch the network at all
(CLAUDE.md / the phase 3 plan). This module is where every provider's
actual `httpx` call lives, so that decision is enforced by having only one
place that imports `httpx` for a real request.

A network-level failure (refused connection, DNS failure, timeout, TLS
error) and a genuine 5xx are the ONE thing turned into a `MarketError`
here, uniformly for every provider: `service_unreachable` means the same
thing regardless of which provider was being called. Everything else about
the response -- its status code, its JSON shape -- is each provider's own
business to interpret: a 401 means something different to Finnhub than it
does to CoinGecko, and an empty object means "unknown symbol" to one
provider and "field not populated yet" to another.
"""

from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

import httpx

from app.market.client import MarketFailureCause, market_error

DEFAULT_TIMEOUT_SECONDS = 10.0


def get_json(
    provider: str,
    url: str,
    *,
    params: dict[str, str] | None = None,
    headers: dict[str, str] | None = None,
    transport: httpx.BaseTransport | None = None,
) -> tuple[int, object]:
    """One GET call -- real when `transport` is `None`, against a recorded
    `httpx.MockTransport` in every test -- returning the status code and
    the parsed JSON body.

    Floats in the body are parsed as `str`
    (`response.json(parse_float=str)`), never as a Python `float`: the one
    place a provider's numeric text would otherwise silently lose precision
    before a caller ever gets the chance to route it through `Decimal`,
    which is exactly the float-on-a-monetary-value CLAUDE.md forbids.
    """
    client = httpx.Client(transport=transport, timeout=DEFAULT_TIMEOUT_SECONDS)
    try:
        response = client.get(url, params=params, headers=headers)
    except httpx.HTTPError as exc:
        raise market_error(MarketFailureCause.SERVICE_UNREACHABLE, provider) from exc
    finally:
        client.close()

    # A 5xx carries no provider-specific meaning by definition -- it is
    # always "the service is unreachable", decided here so no provider has
    # to repeat the check.
    if response.status_code >= 500:
        raise market_error(MarketFailureCause.SERVICE_UNREACHABLE, provider)
    try:
        body = response.json(parse_float=str)
    except ValueError as exc:
        raise market_error(MarketFailureCause.SERVICE_UNREACHABLE, provider) from exc
    return response.status_code, body


def cents_from_decimal_text(provider: str, text: str) -> int:
    """A provider's price, as decimal text, to an integer cent count.

    Rounds once, `ROUND_HALF_UP`, on the exact product -- the same rule
    `engines.quantity.value_cents` follows and for the same reason: never a
    `float` on the way to a monetary value. A shape that cannot even parse
    as a number is not a price at all, and is treated as the provider
    having answered with something unusable -- `service_unreachable`, since
    it is neither the key, the quota, nor the symbol at fault.
    """
    try:
        value = Decimal(text)
    except InvalidOperation as exc:
        raise market_error(MarketFailureCause.SERVICE_UNREACHABLE, provider) from exc
    return int((value * 100).quantize(Decimal(1), rounding=ROUND_HALF_UP))
