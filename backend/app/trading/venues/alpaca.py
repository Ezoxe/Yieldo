"""Alpaca: US equities and ETFs, with a paper endpoint identical to the live
one.

The reason this adapter is the one to start with. Alpaca's paper API is the
same API at a different host -- same routes, same payloads, same rejections --
so a strategy that works against `paper-api.alpaca.markets` meets no surprise
at `api.alpaca.markets` beyond the money being real. `mode` picks the host and
nothing else changes, which is exactly the property a graduation path needs.

Credentials are a key id and a secret, sent as `APCA-API-KEY-ID` and
`APCA-API-SECRET-KEY`. Both are Fernet ciphertext at rest and are decrypted
only in `trading/venues/factory.py`, on the way into this object.

**`client_order_id` is the idempotency key.** Alpaca rejects a second order
carrying an id it has already seen, which is what makes a lost response
survivable: `trading/service.py` never retries, but an operator replaying a
cycle by hand cannot double an order either.
"""

from app.engines.paper_book import Quote
from app.engines.quantity import Quantity
from app.engines.quantity import parse as parse_quantity
from app.trading.venues._shared import format_quantity, parse_json, to_cents
from app.trading.venues.base import (
    VenueFailureCause,
    VenueOrderResult,
    venue_error,
)
from app.trading.venues.http import request

NAME = "alpaca"
LABEL = "Alpaca"

LIVE_HOST = "https://api.alpaca.markets"
PAPER_HOST = "https://paper-api.alpaca.markets"
DATA_HOST = "https://data.alpaca.markets"

# Alpaca accepts fractional shares to nine decimal places.
_QUANTITY_DECIMALS = 9


class AlpacaVenue:
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
        self.base_url = (base_url or (LIVE_HOST if mode == "live" else PAPER_HOST)).rstrip("/")

    def _headers(self) -> dict[str, str]:
        return {
            "APCA-API-KEY-ID": self._key,
            "APCA-API-SECRET-KEY": self._secret,
            "Content-Type": "application/json",
        }

    def check(self) -> str:
        body = parse_json(
            request(
                "GET", f"{self.base_url}/v2/account", headers=self._headers(), label=LABEL
            )
        )
        status = body.get("status")
        currency = body.get("currency", "USD")
        blocked = body.get("trading_blocked")
        if blocked is True:
            raise venue_error(
                VenueFailureCause.REJECTED_BY_VENUE, LABEL,
                "le compte est bloqué en négociation chez Alpaca",
            )
        where = "réel" if self.mode == "live" else "papier"
        return (
            f"Compte Alpaca {where} joignable : statut « {status} », devise {currency}."
        )

    def closes(self, symbol: str, count: int) -> tuple[int, ...]:
        body = parse_json(
            request(
                "GET",
                f"{DATA_HOST}/v2/stocks/{symbol}/bars",
                headers=self._headers(),
                params={"timeframe": "1Day", "limit": str(count), "feed": "iex"},
                label=LABEL,
            )
        )
        bars = body.get("bars") or []
        if not bars:
            raise venue_error(VenueFailureCause.UNKNOWN_SYMBOL, LABEL, symbol)
        return tuple(to_cents(bar["c"]) for bar in bars)

    def quote(self, symbol: str) -> Quote:
        body = parse_json(
            request(
                "GET",
                f"{DATA_HOST}/v2/stocks/{symbol}/quotes/latest",
                headers=self._headers(),
                params={"feed": "iex"},
                label=LABEL,
            )
        )
        quote = body.get("quote")
        if not quote:
            raise venue_error(VenueFailureCause.UNKNOWN_SYMBOL, LABEL, symbol)
        bid = to_cents(quote["bp"])
        ask = to_cents(quote["ap"])
        if bid <= 0 or ask <= 0:
            raise venue_error(
                VenueFailureCause.UNKNOWN_SYMBOL, LABEL,
                f"aucun cours coté pour « {symbol} » en ce moment",
            )
        return Quote(symbol=symbol, bid_cents=bid, ask_cents=ask)

    def place_order(
        self, *, symbol: str, side: str, quantity: Quantity, order_type: str,
        limit_price_cents: int | None, idempotency_key: str,
    ) -> VenueOrderResult:
        payload: dict[str, object] = {
            "symbol": symbol,
            "qty": format_quantity(quantity, _QUANTITY_DECIMALS),
            "side": side,
            "type": order_type,
            "time_in_force": "day",
            "client_order_id": idempotency_key,
        }
        if order_type == "limit":
            if limit_price_cents is None:
                raise venue_error(
                    VenueFailureCause.REJECTED_BY_VENUE, LABEL,
                    "un ordre à cours limité sans limite",
                )
            payload["limit_price"] = f"{limit_price_cents // 100}.{limit_price_cents % 100:02d}"

        body = parse_json(
            request(
                "POST", f"{self.base_url}/v2/orders", headers=self._headers(),
                json_body=payload, label=LABEL,
            )
        )
        status = str(body.get("status") or "")
        filled_qty = body.get("filled_qty")
        filled = (
            parse_quantity(str(filled_qty)) if filled_qty is not None
            else parse_quantity("0")
        )
        average = body.get("filled_avg_price")
        return VenueOrderResult(
            state="filled" if status in ("filled", "partially_filled") else "pending",
            external_id=str(body.get("id") or idempotency_key),
            filled_quantity=filled,
            average_price_cents=to_cents(average) if average is not None else 0,
            cost_cents=0,
            reason=(
                None if status in ("filled", "partially_filled")
                else f"Alpaca a accepté l'ordre, statut « {status} » : il n'est pas encore exécuté."
            ),
        )
