"""Binance: crypto, with a complete testnet.

What Binance adds over Kraken is `testnet.binance.vision` -- a full copy of the
exchange, order book included, where an order is really matched and really
rejected without any money existing. It is the closest thing to a live
rehearsal this feature can offer, and it is why `mode="paper"` here means "the
testnet host", not "the simulated book".

**Signed requests.** Every private call appends `timestamp` and a `signature`
holding HMAC-SHA256 of the whole query string, keyed on the secret, and carries
the key in `X-MBX-APIKEY`. Computed in `_signed` and nowhere else; the secret
is Fernet ciphertext at rest.

**`newClientOrderId` is the idempotency key.** Binance rejects a duplicate,
which is what makes a lost response survivable.

**A clock difference is a real failure mode here**, not a theoretical one:
Binance refuses a request whose `timestamp` is outside `recvWindow`. That
rejection carries its own message through `http.request`, so an operator whose
VPS clock has drifted reads Binance's own words rather than a generic refusal.
"""

import hashlib
import hmac
import time
import urllib.parse
from decimal import ROUND_HALF_UP, Context, Decimal

from app.engines.paper_book import Quote
from app.engines.quantity import Quantity
from app.engines.quantity import parse as parse_quantity
from app.french import counted
from app.trading.venues._shared import format_quantity, parse_json, to_cents
from app.trading.venues.base import (
    VenueFailureCause,
    VenueOrderResult,
    venue_error,
)
from app.trading.venues.http import request

NAME = "binance"
LABEL = "Binance"

LIVE_HOST = "https://api.binance.com"
TESTNET_HOST = "https://testnet.binance.vision"

_CONTEXT = Context(prec=60, rounding=ROUND_HALF_UP)

_QUANTITY_DECIMALS = 8
# How far this machine's clock may be from Binance's before a request is
# refused. Their default is 5 000 ms; this is deliberately not raised, because
# a wider window hides a drifting clock instead of reporting it.
_RECV_WINDOW_MS = 5_000


class BinanceVenue:
    name = NAME
    label = LABEL

    def __init__(
        self, *, mode: str, api_key: str | None, api_secret: str | None,
        base_url: str | None = None,
    ) -> None:
        self.mode = mode
        if not api_key or not api_secret:
            raise venue_error(VenueFailureCause.NO_CREDENTIALS, LABEL)
        self._key = api_key
        self._secret = api_secret
        self.base_url = (base_url or (LIVE_HOST if mode == "live" else TESTNET_HOST)).rstrip("/")

    def _signed(self, params: dict[str, str]) -> str:
        payload = {
            **params,
            "timestamp": str(int(time.time() * 1000)),
            "recvWindow": str(_RECV_WINDOW_MS),
        }
        query = urllib.parse.urlencode(payload)
        signature = hmac.new(
            self._secret.encode("utf-8"), query.encode("utf-8"), hashlib.sha256
        ).hexdigest()
        return f"{query}&signature={signature}"

    def check(self) -> str:
        body = parse_json(
            request(
                "GET", f"{self.base_url}/api/v3/account?{self._signed({})}",
                headers={"X-MBX-APIKEY": self._key}, label=LABEL,
            )
        )
        can_trade = body.get("canTrade")
        if can_trade is False:
            raise venue_error(
                VenueFailureCause.REJECTED_BY_VENUE, LABEL,
                "la clé n'a pas la permission de négocier",
            )
        where = "réel" if self.mode == "live" else "testnet"
        balances = [
            balance for balance in (body.get("balances") or [])
            if str(balance.get("free")) not in ("0", "0.00000000")
        ]
        return (
            f"Compte Binance {where} joignable, négociation autorisée, "
            f"{counted(len(balances), 'avoir non nul', 'avoirs non nuls')}."
        )

    def closes(self, symbol: str, count: int) -> tuple[int, ...]:
        body = parse_json(
            request(
                "GET", f"{self.base_url}/api/v3/klines",
                params={"symbol": symbol, "interval": "1d", "limit": str(count)},
                label=LABEL,
            )
        )
        if not body:
            raise venue_error(VenueFailureCause.UNKNOWN_SYMBOL, LABEL, symbol)
        # Index 4 of a kline is its close.
        return tuple(to_cents(candle[4]) for candle in body)

    def quote(self, symbol: str) -> Quote:
        body = parse_json(
            request(
                "GET", f"{self.base_url}/api/v3/ticker/bookTicker",
                params={"symbol": symbol}, label=LABEL,
            )
        )
        if "bidPrice" not in body:
            raise venue_error(VenueFailureCause.UNKNOWN_SYMBOL, LABEL, symbol)
        return Quote(
            symbol=symbol,
            bid_cents=to_cents(body["bidPrice"]),
            ask_cents=to_cents(body["askPrice"]),
        )

    def place_order(
        self, *, symbol: str, side: str, quantity: Quantity, order_type: str,
        limit_price_cents: int | None, idempotency_key: str,
    ) -> VenueOrderResult:
        params = {
            "symbol": symbol,
            "side": side.upper(),
            "type": order_type.upper(),
            "quantity": format_quantity(quantity, _QUANTITY_DECIMALS),
            "newClientOrderId": idempotency_key[:36],
        }
        if order_type == "limit":
            if limit_price_cents is None:
                raise venue_error(
                    VenueFailureCause.REJECTED_BY_VENUE, LABEL,
                    "un ordre à cours limité sans limite",
                )
            params["price"] = f"{limit_price_cents // 100}.{limit_price_cents % 100:02d}"
            params["timeInForce"] = "GTC"

        body = parse_json(
            request(
                "POST", f"{self.base_url}/api/v3/order?{self._signed(params)}",
                headers={"X-MBX-APIKEY": self._key}, label=LABEL,
            )
        )
        status = str(body.get("status") or "")
        executed = body.get("executedQty")
        filled = parse_quantity(str(executed)) if executed is not None else parse_quantity("0")
        # `cummulativeQuoteQty` is Binance's own spelling, not a typo here.
        quote_spent = body.get("cummulativeQuoteQty")
        average = 0
        if quote_spent is not None and filled.value > 0:
            # The average paid per unit, in cents: what was spent divided by
            # what was received. Through a Context, half-up, like every other
            # monetary division in this codebase.
            average = int(
                _CONTEXT.quantize(
                    _CONTEXT.divide(Decimal(to_cents(quote_spent)), filled.value), Decimal(1)
                )
            )
        return VenueOrderResult(
            state="filled" if status == "FILLED" else (
                "failed" if status in ("REJECTED", "EXPIRED") else "pending"
            ),
            external_id=str(body.get("orderId") or idempotency_key),
            filled_quantity=filled,
            average_price_cents=average,
            cost_cents=0,
            reason=(
                None if status == "FILLED"
                else f"Binance a répondu « {status} » : l'ordre n'est pas exécuté."
            ),
        )
