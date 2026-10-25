"""What a broker says the household holds, in one shape for every broker.

Read only. `holdings()` on an adapter is one or two GET calls to the broker's
account endpoints and never touches an order route. A quantity is kept as the
broker's own decimal text (normalised), never a float: 0.00123 BTC is not a
number to round. A value is in cents of `currency` when the broker gives one
(Alpaca's `market_value`) and None when it does not (Kraken, Binance report
quantities only) -- an absent value says so rather than standing in for zero.
"""

from dataclasses import dataclass
from decimal import Decimal, InvalidOperation

# Fiat currencies a crypto broker can hold as cash. Kraken prefixes its own
# fiat codes with Z (ZEUR); the prefix is dropped for the household.
FIAT = frozenset({"EUR", "USD", "GBP", "CHF", "CAD", "JPY", "AUD"})
KRAKEN_FIAT = {f"Z{code}": code for code in FIAT} | {code: code for code in FIAT}


@dataclass(frozen=True)
class CashBalance:
    currency: str
    amount_cents: int


@dataclass(frozen=True)
class HeldAsset:
    symbol: str
    quantity: str
    value_cents: int | None
    currency: str | None


@dataclass(frozen=True)
class VenueHoldings:
    cash: tuple[CashBalance, ...]
    assets: tuple[HeldAsset, ...]


def decimal_text(value: object) -> Decimal | None:
    try:
        number = Decimal(str(value))
    except (InvalidOperation, ValueError):
        return None
    return number if number.is_finite() else None


def quantity_text(number: Decimal) -> str:
    """« 0.0123 » for 0.0123000000, « 10 » for 10.000 -- never an exponent."""
    text = format(number.normalize(), "f")
    return text if "." not in text else text.rstrip("0").rstrip(".")


def cents_of(number: Decimal) -> int:
    return int((number * 100).to_integral_value())
