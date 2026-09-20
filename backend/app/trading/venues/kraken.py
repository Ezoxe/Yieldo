"""Kraken: crypto, open every hour of every day.

The complement to Alpaca, and the reason to have both. A market that never
closes is how a household accumulates enough decisions to judge a model in a
week rather than a quarter -- `engines/calibration.py` needs observations, and
an equity market gives six and a half hours a day, five days a week.

**Kraken's private API is signed, not bearer-authenticated.** Every private
call carries an `API-Key` header and an `API-Sign` header holding
HMAC-SHA512(uri_path + SHA256(nonce + postdata), base64-decoded secret). The
signature is computed in `_sign` below and nowhere else. The secret is Fernet
ciphertext at rest, decrypted only in `trading/venues/factory.py`.

**The nonce must never go backwards**, per Kraken's own rule, so it is
microseconds since the epoch: monotonic in practice, and far enough apart that
two calls in the same cycle cannot collide.

**`cl_ord_id` is the idempotency key.** Kraken deduplicates on it, which is
what makes a lost response survivable -- see `base.py` on why nothing here
retries.
"""

import base64
import hashlib
import hmac
import time
import urllib.parse

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

NAME = "kraken"
LABEL = "Kraken"

HOST = "https://api.kraken.com"

# Kraken accepts eight decimal places on volume for every pair it lists.
_QUANTITY_DECIMALS = 8

# Daily candles, matching the other venues' `closes` so an indicator computed
# on Kraken data means the same thing as one computed on Alpaca data.
_DAILY_INTERVAL_MINUTES = 1440


class KrakenVenue:
    name = NAME
    label = LABEL

    def __init__(
        self, *, mode: str, api_key: str | None, api_secret: str | None,
        base_url: str | None = None,
    ) -> None:
        self.mode = mode
        self.base_url = (base_url or HOST).rstrip("/")
        # Kraken has no testnet. A `paper` Kraken venue therefore reads real
        # prices and executes nowhere: `trading/service.py` routes a paper
        # order to the simulated book. That is stated here rather than left
        # implicit, because a household seeing "Kraken (papier)" on screen
        # deserves to know its orders are simulated against Kraken's real book.
        self._key = api_key
        self._secret = api_secret

    # -- signing ---------------------------------------------------------
    def _sign(self, path: str, data: dict[str, str]) -> tuple[str, str]:
        if not self._key or not self._secret:
            raise venue_error(VenueFailureCause.NO_CREDENTIALS, LABEL)
        post = urllib.parse.urlencode(data)
        encoded = (data["nonce"] + post).encode("utf-8")
        message = path.encode("utf-8") + hashlib.sha256(encoded).digest()
        try:
            secret = base64.b64decode(self._secret)
        except (ValueError, TypeError) as exc:
            raise venue_error(
                VenueFailureCause.CREDENTIALS_REJECTED, LABEL,
                "le secret enregistré n'est pas du base64 : Kraken en fournit un encodé",
            ) from exc
        signature = hmac.new(secret, message, hashlib.sha512).digest()
        return post, base64.b64encode(signature).decode()

    def _private(self, path: str, data: dict[str, str]) -> dict:
        data = {**data, "nonce": str(int(time.time() * 1_000_000))}
        post, signature = self._sign(path, data)
        body = parse_json(
            request(
                "POST", f"{self.base_url}{path}",
                headers={
                    "API-Key": self._key or "",
                    "API-Sign": signature,
                    "Content-Type": "application/x-www-form-urlencoded",
                },
                content=post, label=LABEL,
            )
        )
        return self._unwrap(body)

    @staticmethod
    def _unwrap(body: dict) -> dict:
        """Kraken answers 200 with an `error` list. A 200 carrying an error is
        still a failure, and reading only the status code is how a rejected
        order gets recorded as sent."""
        errors = body.get("error") or []
        if errors:
            joined = ", ".join(str(error) for error in errors)
            if any("Invalid key" in str(e) or "Permission denied" in str(e) for e in errors):
                raise venue_error(VenueFailureCause.CREDENTIALS_REJECTED, LABEL, joined)
            if any("Unknown asset pair" in str(e) for e in errors):
                raise venue_error(VenueFailureCause.UNKNOWN_SYMBOL, LABEL, joined)
            raise venue_error(VenueFailureCause.REJECTED_BY_VENUE, LABEL, joined)
        return body.get("result") or {}

    # -- contract --------------------------------------------------------
    def check(self) -> str:
        result = self._private("/0/private/Balance", {})
        held = ", ".join(sorted(result)[:6]) or "aucun solde"
        return f"Compte Kraken joignable. Avoirs déclarés : {held}."

    def closes(self, symbol: str, count: int) -> tuple[int, ...]:
        body = parse_json(
            request(
                "GET", f"{self.base_url}/0/public/OHLC",
                params={"pair": symbol, "interval": str(_DAILY_INTERVAL_MINUTES)},
                label=LABEL,
            )
        )
        result = self._unwrap(body)
        series = next(
            (value for key, value in result.items() if key != "last"), None
        )
        if not series:
            raise venue_error(VenueFailureCause.UNKNOWN_SYMBOL, LABEL, symbol)
        # Each candle is [time, open, high, low, close, vwap, volume, count].
        return tuple(to_cents(candle[4]) for candle in series[-count:])

    def quote(self, symbol: str) -> Quote:
        body = parse_json(
            request(
                "GET", f"{self.base_url}/0/public/Ticker", params={"pair": symbol},
                label=LABEL,
            )
        )
        result = self._unwrap(body)
        ticker = next(iter(result.values()), None)
        if not ticker:
            raise venue_error(VenueFailureCause.UNKNOWN_SYMBOL, LABEL, symbol)
        return Quote(
            symbol=symbol,
            bid_cents=to_cents(ticker["b"][0]),
            ask_cents=to_cents(ticker["a"][0]),
        )

    def place_order(
        self, *, symbol: str, side: str, quantity: Quantity, order_type: str,
        limit_price_cents: int | None, idempotency_key: str,
    ) -> VenueOrderResult:
        data = {
            "pair": symbol,
            "type": side,
            "ordertype": order_type,
            "volume": format_quantity(quantity, _QUANTITY_DECIMALS),
            # Kraken's own deduplication handle. 18 characters at most.
            "cl_ord_id": idempotency_key[:18],
        }
        if order_type == "limit":
            if limit_price_cents is None:
                raise venue_error(
                    VenueFailureCause.REJECTED_BY_VENUE, LABEL,
                    "un ordre à cours limité sans limite",
                )
            data["price"] = f"{limit_price_cents // 100}.{limit_price_cents % 100:02d}"

        result = self._private("/0/private/AddOrder", data)
        transaction_ids = result.get("txid") or []
        # AddOrder acknowledges; it does not report a fill. The order is
        # `pending` until a later read says otherwise -- claiming a fill here
        # would put an invented average price into the ledger.
        return VenueOrderResult(
            state="pending",
            external_id=str(transaction_ids[0]) if transaction_ids else idempotency_key,
            filled_quantity=parse_quantity("0"),
            average_price_cents=0,
            cost_cents=0,
            reason=(
                "Kraken a accepté l'ordre. Son exécution est confirmée séparément : "
                "l'ordre reste « en attente » jusque-là."
            ),
        )
