"""Position valuation: quantities from lots, market value against a fetched
price, unrealised gain, and weights over what could actually be valued.

Phase 3 plan Task 7. Pure: this module never calls a network or reads a
session -- every price, FX rate and "why not" reason it uses was already
resolved by the caller (`/api/portfolio`, Task 9, through the quota-aware
market client) and is handed in as a parameter, exactly like `today` is a
parameter everywhere else in this codebase.

**A position whose price could not be fetched is valued at `None`, never at
cost and never at zero.** See `PositionValuation.market_value_cents` and the
one exception below. **A stale price is a real answer, not a missing one**:
`PriceQuote.is_stale` travels alongside the value it qualifies, and a stale
position still contributes to every total and every weight; only a
genuinely MISSING price (`PositionInput.price is None`) is excluded.

**The one exception: a position whose lots sum to a total quantity of
exactly zero -- no lots recorded yet, or (defensively) a lot recorded with a
zero quantity -- is valued at 0, unconditionally, regardless of whether a
price could be fetched for it at all.** Zero units times any price is zero,
a real computed answer, not a fallback; treating an unpriceable zero-quantity
position as "missing" would overstate how many positions this portfolio
genuinely could not value, exactly the wrong direction for a number whose
entire job is to say what is actually unknown.

**Currency.** Every position's own market value and cost basis are computed
in the INSTRUMENT'S OWN currency -- `Lot.unit_cost_cents` and a fetched
`Quote.price_cents` are never in any other currency. Turning many positions
into ONE portfolio total needs a common `reporting_currency` (design §12:
"Euro par défaut, autres devises converties à l'affichage" -- EUR by
default, other currencies converted at display time). Where a position's own
currency already IS the reporting currency, no rate is needed. Where it
differs, the caller hands in the already-fetched `fx_rate_to_reporting`
(`market.client.FxRate.rate`, Decimal text); when none was fetched or
available, this position's contribution to every reporting-currency total
and weight is excluded -- exactly like a missing price -- while its OWN
currency's market value is still reported, because that part genuinely is
known. This is `positions_missing_fx`, a cause distinct from
`positions_missing_price`: a price can be known while its conversion is not.
"""

from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import ROUND_HALF_UP, Context, Decimal, InvalidOperation

from app.engines.quantity import Quantity, total_value_cents, value_cents

# Same headroom as engines.quantity._CONTEXT, and for the identical reason:
# an FX rate multiplied against a large market value must never hit the
# default 28-significant-digit context's silent-truncation-or-crash trap.
_CONTEXT = Context(prec=100, rounding=ROUND_HALF_UP)

DEFAULT_REPORTING_CURRENCY = "EUR"


@dataclass(frozen=True)
class LotHolding:
    """One lot's contribution to a position -- quantity and unit cost, both
    already validated (`engines.quantity.parse`, `schemas.portfolio.LotIn`).
    """

    quantity: Quantity
    unit_cost_cents: int


@dataclass(frozen=True)
class PriceQuote:
    """A price actually resolved for a position, in the instrument's own
    currency -- the fields of `market.client.Quote` this module needs; the
    caller already knows the symbol and currency from the position itself.
    """

    price_cents: int
    as_of: date
    fetched_at: datetime
    source: str
    is_stale: bool


@dataclass(frozen=True)
class PositionInput:
    position_id: int
    account_id: int
    symbol: str
    name: str
    asset_class: str
    currency: str
    is_fractionable: bool
    lots: list[LotHolding]
    # None means no price could be fetched for this position at all -- the
    # caller already tried and failed.
    price: PriceQuote | None
    # French. Set iff `price` is None -- the already-built sentence
    # (`market.client.failure_message`), threaded through opaquely: this
    # module never invents its own market-failure wording, so the five
    # causes can never drift from their one source.
    price_unavailable_reason: str | None
    # The rate to convert ONE unit of `currency` into the reporting
    # currency (`FxRate.rate`, Decimal text). Ignored when `currency`
    # already equals the reporting currency. None when a conversion is
    # needed but was not available.
    fx_rate_to_reporting: str | None
    # French. Set iff a conversion was needed and `fx_rate_to_reporting`
    # is None.
    fx_unavailable_reason: str | None


@dataclass(frozen=True)
class PositionValuation:
    position_id: int
    account_id: int
    symbol: str
    name: str
    asset_class: str
    currency: str
    quantity: str  # str(Quantity) -- the wire form, like everywhere else
    cost_basis_cents: int  # native currency, always known -- needs no price
    price: PriceQuote | None
    price_unavailable_reason: str | None
    market_value_cents: int | None  # native currency
    unrealised_gain_cents: int | None  # native currency
    fx_unavailable_reason: str | None
    market_value_reporting_cents: int | None
    cost_basis_reporting_cents: int | None
    unrealised_gain_reporting_cents: int | None


@dataclass(frozen=True)
class WeightedGroup:
    key: str
    value_cents: int  # reporting currency, summed over valued positions
    # 0.0 when the portfolio's total valued value is 0 -- there is no share
    # of nothing to report, and this avoids a ZeroDivisionError rather than
    # standing in for a ratio that genuinely does not exist.
    weight: float


@dataclass(frozen=True)
class PortfolioTotal:
    """Bundled deliberately: a caller cannot render `market_value_cents`
    without the completeness counts sitting right next to it in the same
    object -- the concrete form of "the portfolio total states how many
    positions are missing a price rather than quietly summing the rest as
    though it were complete"."""

    market_value_cents: int  # reporting currency, sum over what could be valued
    cost_basis_cents: int  # reporting currency, over the same subset
    unrealised_gain_cents: int  # reporting currency, over the same subset
    positions_total: int
    positions_valued: int  # price known (or quantity == 0) AND convertible
    positions_missing_price: int
    positions_missing_fx: int


@dataclass(frozen=True)
class PortfolioValuation:
    reporting_currency: str
    positions: list[PositionValuation]
    total: PortfolioTotal
    weight_by_instrument: list[WeightedGroup] = field(default_factory=list)
    weight_by_asset_class: list[WeightedGroup] = field(default_factory=list)
    weight_by_currency: list[WeightedGroup] = field(default_factory=list)


def convert_cents(
    native_cents: int, currency: str, reporting_currency: str, fx_rate_to_reporting: str | None
) -> int | None:
    """`native_cents`, in `currency`, converted into `reporting_currency`.

    Identity when the two currencies already match -- no rate is consulted,
    so a position priced in the reporting currency is never made to depend
    on an FX fetch it never needed. Otherwise requires `fx_rate_to_reporting`
    (`FxRate.rate` -- reporting units per one unit of `currency`); returns
    `None` when it is not available, so the caller can tell "converted to
    zero" from "could not convert" apart.

    Rounds ONCE on the exact product, the same discipline
    `engines.quantity.value_cents` follows and for the same reason.
    """
    if currency == reporting_currency:
        return native_cents
    if fx_rate_to_reporting is None:
        return None
    try:
        rate = Decimal(fx_rate_to_reporting)
    except InvalidOperation as exc:
        raise ValueError(
            f"Taux de change invalide : « {fx_rate_to_reporting} » n'est pas un nombre."
        ) from exc
    exact = _CONTEXT.multiply(Decimal(native_cents), rate)
    return int(_CONTEXT.quantize(exact, Decimal(1)))


def _total_quantity(lots: list[LotHolding]) -> Quantity:
    total = Quantity(Decimal(0))
    for lot in lots:
        total = total + lot.quantity
    return total


def _value_position(
    position: PositionInput, reporting_currency: str
) -> PositionValuation:
    total_quantity = _total_quantity(position.lots)
    cost_basis_cents = total_value_cents(
        [(lot.quantity, lot.unit_cost_cents) for lot in position.lots]
    )

    if total_quantity.value == 0:
        # Sold down to nothing, or nothing acquired yet: zero units times
        # any price is zero, a real answer, unconditionally -- see the
        # module docstring. No price or FX rate is even consulted: lots are
        # never negative in this phase (a lot is an acquisition, never a
        # cession -- `LotIn`'s own guard), so a total quantity of zero
        # forces every lot's own contribution, and therefore the cost
        # basis, to be zero too -- 0 converted by ANY rate, known or not,
        # is unambiguously 0 in every currency.
        return PositionValuation(
            position_id=position.position_id, account_id=position.account_id,
            symbol=position.symbol, name=position.name, asset_class=position.asset_class,
            currency=position.currency, quantity=str(total_quantity),
            cost_basis_cents=cost_basis_cents, price=position.price,
            price_unavailable_reason=None,
            market_value_cents=0, unrealised_gain_cents=0 - cost_basis_cents,
            fx_unavailable_reason=None,
            market_value_reporting_cents=0,
            cost_basis_reporting_cents=0,
            unrealised_gain_reporting_cents=0,
        )

    if position.price is None:
        return PositionValuation(
            position_id=position.position_id, account_id=position.account_id,
            symbol=position.symbol, name=position.name, asset_class=position.asset_class,
            currency=position.currency, quantity=str(total_quantity),
            cost_basis_cents=cost_basis_cents, price=None,
            price_unavailable_reason=position.price_unavailable_reason,
            market_value_cents=None, unrealised_gain_cents=None,
            fx_unavailable_reason=None,
            market_value_reporting_cents=None, cost_basis_reporting_cents=None,
            unrealised_gain_reporting_cents=None,
        )

    market_value_cents = value_cents(total_quantity, position.price.price_cents)
    unrealised_gain_cents = market_value_cents - cost_basis_cents

    market_value_reporting = convert_cents(
        market_value_cents, position.currency, reporting_currency,
        position.fx_rate_to_reporting,
    )
    fx_unavailable_reason = (
        position.fx_unavailable_reason if market_value_reporting is None else None
    )
    cost_basis_reporting = convert_cents(
        cost_basis_cents, position.currency, reporting_currency,
        position.fx_rate_to_reporting,
    )
    gain_reporting = (
        None if market_value_reporting is None or cost_basis_reporting is None
        else market_value_reporting - cost_basis_reporting
    )

    return PositionValuation(
        position_id=position.position_id, account_id=position.account_id,
        symbol=position.symbol, name=position.name, asset_class=position.asset_class,
        currency=position.currency, quantity=str(total_quantity),
        cost_basis_cents=cost_basis_cents, price=position.price,
        price_unavailable_reason=None,
        market_value_cents=market_value_cents, unrealised_gain_cents=unrealised_gain_cents,
        fx_unavailable_reason=fx_unavailable_reason,
        market_value_reporting_cents=market_value_reporting,
        cost_basis_reporting_cents=cost_basis_reporting,
        unrealised_gain_reporting_cents=gain_reporting,
    )


def _weighted_groups(
    valued: list[PositionValuation], total_cents: int, key_fn
) -> list[WeightedGroup]:
    totals: dict[str, int] = {}
    for position in valued:
        key = key_fn(position)
        totals[key] = totals.get(key, 0) + position.market_value_reporting_cents
    groups = [
        WeightedGroup(
            key=key, value_cents=value,
            weight=0.0 if total_cents == 0 else value / total_cents,
        )
        for key, value in totals.items()
    ]
    groups.sort(key=lambda g: (-g.value_cents, g.key))
    return groups


def value_portfolio(
    positions: list[PositionInput], reporting_currency: str = DEFAULT_REPORTING_CURRENCY
) -> PortfolioValuation:
    """Every position, valued -- and the totals and weights computed over
    only the ones that actually could be."""
    valuations = [_value_position(position, reporting_currency) for position in positions]

    # "Valued" means the reporting-currency figure is known: either a real
    # price (and, if needed, a real FX rate) resolved, or the position is
    # genuinely worth zero. Anything else -- missing price, or a known
    # price with no way to convert it -- is excluded from every total and
    # weight below, and counted instead.
    valued = [v for v in valuations if v.market_value_reporting_cents is not None]
    missing_price = sum(
        1 for v in valuations if v.price is None and v.market_value_reporting_cents is None
    )
    missing_fx = sum(1 for v in valuations if v.fx_unavailable_reason is not None)

    total_market_value = sum((v.market_value_reporting_cents for v in valued), start=0)
    total_cost_basis = sum(
        (v.cost_basis_reporting_cents for v in valued if v.cost_basis_reporting_cents is not None),
        start=0,
    )

    total = PortfolioTotal(
        market_value_cents=total_market_value,
        cost_basis_cents=total_cost_basis,
        unrealised_gain_cents=total_market_value - total_cost_basis,
        positions_total=len(positions),
        positions_valued=len(valued),
        positions_missing_price=missing_price,
        positions_missing_fx=missing_fx,
    )

    return PortfolioValuation(
        reporting_currency=reporting_currency,
        positions=valuations,
        total=total,
        weight_by_instrument=_weighted_groups(
            valued, total_market_value, lambda v: v.symbol
        ),
        weight_by_asset_class=_weighted_groups(
            valued, total_market_value, lambda v: v.asset_class
        ),
        weight_by_currency=_weighted_groups(
            valued, total_market_value, lambda v: v.currency
        ),
    )
