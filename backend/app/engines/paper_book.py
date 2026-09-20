"""Simulated execution: the sandbox's fills, and the position arithmetic every
mode shares.

Pure. Two jobs, deliberately kept in one module because they are two halves of
one truth:

1. **`simulate_fill`** decides what a given order would have done against a
   given quote. Only the paper venue calls it.
2. **`apply_fill`** folds a fill into a position -- new unit count, new average
   price, realised profit or loss. *Every* venue's result goes through it,
   paper and live alike, so a real fill and a simulated one are accounted for
   by the same arithmetic. A sandbox that counted money differently from
   production would be a sandbox that taught the wrong lesson.

**Slippage is charged, never waived.** A market buy pays the ask plus the
venue's slippage, a market sell receives the bid minus it. A simulator that
fills at the mid price flatters every strategy that ever runs in it, and a
household would carry that flattery into a live mandate. The figure is the
venue's own (`models/trading_venue.slippage_bps`), so it can be set from
observed live fills rather than guessed forever.

**A limit order that is not marketable does not fill.** It is reported as
`pending`, not as a fill at the limit, and not silently as a market order.

**Never a float**: prices in integer cents, quantities as
`engines.quantity.Quantity`, and the one rounding -- a quantity times a price
-- happens in `value_cents`, once, exactly as `engines/quantity.py` requires.
"""

from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Context, Decimal

from app.engines.quantity import SCALE, Quantity, value_cents

_CONTEXT = Context(prec=100, rounding=ROUND_HALF_UP)
_UNIT_QUANTUM = Decimal(1).scaleb(-SCALE)

BPS_WHOLE = 10_000

FILL_STATES = ("filled", "pending", "rejected")


@dataclass(frozen=True)
class Quote:
    """One instrument's two-sided price, in integer cents.

    `bid` and `ask` rather than a single price because the spread is half of
    what execution actually costs, and a simulator that cannot see it cannot
    charge it. A venue with no order book (a daily close, a price index)
    passes the same figure for both and pays only the slippage.
    """

    symbol: str
    bid_cents: int
    ask_cents: int

    @property
    def mid_cents(self) -> int:
        return _round_half_up((Decimal(self.bid_cents) + Decimal(self.ask_cents)) / 2)


@dataclass(frozen=True)
class PositionState:
    """A position as held: how many units, and what they cost on average.

    `average_price_cents` is the *cost basis per unit*, which is what makes a
    realised profit computable at all. Zero units means zero basis -- a closed
    position keeps no memory of its price.
    """

    quantity: Quantity
    average_price_cents: int

    @classmethod
    def empty(cls) -> "PositionState":
        return cls(quantity=Quantity(Decimal(0)), average_price_cents=0)


@dataclass(frozen=True)
class Fill:
    state: str  # one of FILL_STATES
    quantity: Quantity
    price_cents: int
    # What the venue charged beyond the price: the spread crossed plus the
    # slippage, expressed in cents, so the sandbox can show the cost of
    # trading rather than hiding it inside the fill price.
    cost_cents: int
    # French, and set if and only if `state` is not "filled".
    reason: str | None = None


@dataclass(frozen=True)
class FillOutcome:
    """A fill and everything it changed, together -- so no caller can apply one
    without the other."""

    fill: Fill
    position: PositionState
    cash_cents: int
    realised_pnl_cents: int


def _round_half_up(exact: Decimal) -> int:
    return int(_CONTEXT.quantize(exact, Decimal(1)))


def _apply_bps(price_cents: int, bps: int) -> int:
    """`price_cents` moved by `bps`, rounded half up. A negative `bps` moves it
    down."""
    delta = _CONTEXT.divide(
        _CONTEXT.multiply(Decimal(price_cents), Decimal(bps)), Decimal(BPS_WHOLE)
    )
    return _round_half_up(_CONTEXT.add(Decimal(price_cents), delta))


def simulate_fill(
    *,
    side: str,
    quantity: Quantity,
    order_type: str,
    quote: Quote,
    slippage_bps: int,
    limit_price_cents: int | None = None,
) -> Fill:
    """What this order would have done, right now, against this quote."""
    if quantity.value <= 0:
        return Fill(
            state="rejected", quantity=Quantity(Decimal(0)), price_cents=0, cost_cents=0,
            reason="La quantité est nulle : il n'y a rien à exécuter.",
        )
    if quote.bid_cents <= 0 or quote.ask_cents <= 0:
        return Fill(
            state="rejected", quantity=Quantity(Decimal(0)), price_cents=0, cost_cents=0,
            reason=f"Aucun cours exploitable pour « {quote.symbol} » : "
                   "le carnet simulé ne peut pas exécuter.",
        )

    touch = quote.ask_cents if side == "buy" else quote.bid_cents
    # Slippage always works against the order: paid on top of the ask when
    # buying, taken off the bid when selling.
    executed = _apply_bps(touch, slippage_bps if side == "buy" else -slippage_bps)

    if order_type == "limit":
        if limit_price_cents is None:
            return Fill(
                state="rejected", quantity=Quantity(Decimal(0)), price_cents=0, cost_cents=0,
                reason="Un ordre à cours limité sans limite n'est pas exécutable.",
            )
        marketable = (
            executed <= limit_price_cents if side == "buy" else executed >= limit_price_cents
        )
        if not marketable:
            return Fill(
                state="pending", quantity=Quantity(Decimal(0)), price_cents=0, cost_cents=0,
                reason=f"La limite ({limit_price_cents} centimes) n'est pas atteinte : "
                       f"le marché est à {executed} centimes. L'ordre reste en attente.",
            )
        # A marketable limit order fills at the limit when the market is better
        # than it -- a household does not pay more than it asked to.
        executed = min(executed, limit_price_cents) if side == "buy" else max(
            executed, limit_price_cents
        )

    reference = quote.mid_cents
    per_unit_cost = executed - reference if side == "buy" else reference - executed
    return Fill(
        state="filled", quantity=quantity, price_cents=executed,
        cost_cents=value_cents(quantity, max(per_unit_cost, 0)),
    )


def apply_fill(
    *, position: PositionState, cash_cents: int, side: str, fill: Fill
) -> FillOutcome:
    """The position, the cash and the realised result after this fill.

    Buying raises the average price and spends cash; selling releases the
    proportional cost basis and realises the difference. A sale of more units
    than are held is refused outright rather than turned into a short: the
    mandate already forbids it in `engines/trading_risk`, and a second refusal
    here means a bug in the caller cannot invent a position out of nothing.
    """
    if fill.state != "filled":
        return FillOutcome(
            fill=fill, position=position, cash_cents=cash_cents, realised_pnl_cents=0
        )

    gross = value_cents(fill.quantity, fill.price_cents)

    if side == "buy":
        old_cost = value_cents(position.quantity, position.average_price_cents)
        new_quantity = Quantity(
            _CONTEXT.quantize(
                _CONTEXT.add(position.quantity.value, fill.quantity.value), _UNIT_QUANTUM
            )
        )
        new_average = (
            0 if new_quantity.value == 0
            else _round_half_up(
                _CONTEXT.divide(Decimal(old_cost + gross), new_quantity.value)
            )
        )
        return FillOutcome(
            fill=fill,
            position=PositionState(quantity=new_quantity, average_price_cents=new_average),
            cash_cents=cash_cents - gross,
            realised_pnl_cents=0,
        )

    if fill.quantity.value > position.quantity.value:
        raise ValueError(
            f"La vente porte sur {fill.quantity} unité(s) pour {position.quantity} "
            "détenue(s) : une position négative ne peut pas être enregistrée ici."
        )
    basis = value_cents(fill.quantity, position.average_price_cents)
    new_quantity = Quantity(
        _CONTEXT.quantize(
            _CONTEXT.subtract(position.quantity.value, fill.quantity.value), _UNIT_QUANTUM
        )
    )
    return FillOutcome(
        fill=fill,
        position=PositionState(
            quantity=new_quantity,
            # A fully closed position keeps no basis; a partial sale keeps the
            # one it had, because selling does not change what the remaining
            # units cost.
            average_price_cents=0 if new_quantity.value == 0 else position.average_price_cents,
        ),
        cash_cents=cash_cents + gross,
        realised_pnl_cents=gross - basis,
    )


def unrealised_pnl_cents(position: PositionState, price_cents: int) -> int:
    """What the position would realise if it were closed at `price_cents`.

    Separate from `apply_fill` on purpose: nothing has happened, and a figure
    that describes a hypothetical must not be produced by the function that
    records facts.
    """
    if position.quantity.value == 0:
        return 0
    return value_cents(position.quantity, price_cents) - value_cents(
        position.quantity, position.average_price_cents
    )
