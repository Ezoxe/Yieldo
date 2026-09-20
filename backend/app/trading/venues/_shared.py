"""What the three real adapters have in common: decimals on the wire, and
quantities a venue will actually accept.

Every venue quotes in its own units -- dollars as a JSON number (Alpaca),
strings in the quote currency (Kraken, Binance) -- and every one of them has to
become an integer number of cents before it touches anything in this codebase.
That conversion happens here, once, and it goes through `Decimal`: a price read
as a Python `float` and multiplied by 100 is a monetary value derived from a
float, which CLAUDE.md forbids at every layer and which really does lose cents
at crypto magnitudes.
"""

import json
from decimal import ROUND_HALF_UP, Context, Decimal, InvalidOperation
from typing import Any

from app.engines.quantity import Quantity

_CONTEXT = Context(prec=60, rounding=ROUND_HALF_UP)


def parse_json(text: str) -> Any:
    """JSON with every number as `Decimal`, never `float`."""
    return json.loads(text, parse_float=Decimal, parse_int=Decimal)


def to_cents(value: Any) -> int:
    """A price in a venue's own units as integer cents. Raises `ValueError` on
    anything that is not a number -- never a zero standing in for an
    unreadable price."""
    if isinstance(value, str):
        try:
            value = Decimal(value)
        except InvalidOperation as exc:
            raise ValueError(f"prix illisible : {value!r}") from exc
    if not isinstance(value, Decimal):
        raise ValueError(f"prix illisible : {value!r}")
    return int(_CONTEXT.quantize(_CONTEXT.multiply(value, Decimal(100)), Decimal(1)))


def format_quantity(quantity: Quantity, max_decimals: int) -> str:
    """A quantity as the venue wants to read it.

    `engines.quantity.Quantity` carries eighteen decimal places; no venue
    accepts eighteen. Truncates -- never rounds up -- to `max_decimals` and
    strips trailing zeros, because rounding a quantity up at the wire would
    send an order fractionally larger than the mandate allowed.
    """
    quantum = Decimal(1).scaleb(-max_decimals)
    trimmed = quantity.value.quantize(quantum, rounding="ROUND_DOWN")
    text = format(trimmed.normalize(), "f")
    return text


def bearer_or_none(value: str | None) -> str | None:
    return value or None
