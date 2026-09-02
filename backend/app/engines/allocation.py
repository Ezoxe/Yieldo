"""Target allocation per asset class, current drift, and the trades that
would close it.

Phase 3 plan Task 8. Pure: no session, no network, no implicit clock --
every holding this module sees was already valued in one reporting currency
by `engines.portfolio.value_portfolio` (Task 7), and every price it trades
against is that same reporting-currency figure, so a drift in EUR is never
compared against a price in USD.

**Only what could be valued drifts at all.** A holding whose reporting-
currency value is unknown (`market_value_reporting_cents is None` -- Task
7's own "missing price" or "missing FX" causes) is excluded from the current
allocation exactly like it is excluded from Task 7's own weights: this
module has no opinion on a value it was never given, and folding an unknown
into "currently zero" would understate how overweight or underweight the
rest of that asset class actually is.

**Targets must sum to exactly 100 %.** A set of targets that does not is
refused outright (`ValueError`, the same idiom every other engine in this
codebase uses for a malformed structural input -- `amortization.cents`,
`assess_feasibility`'s own preconditions) rather than silently rescaled: a
household that mistyped 45/45/20 as summing to 110 % did not mean "scale
everyone down by 10 %", and guessing would replace a real mistake with an
invented one.

**Trades are whole units where the instrument is not fractionable, and a
trade that would round to zero whole units is refused rather than
proposed** -- see `_size_trade`. A drift that cannot be corrected without a
fractional share of a non-fractionable instrument is not corrected at all;
proposing a zero-unit "trade" would be silently wrong in the opposite
direction, looking like an actionable order that changes nothing.

**One trade per drifted asset class, against its single largest
currently-held instrument** -- a deliberate scoping decision, not an
oversight. Splitting a correction proportionally across every instrument in
a class is a legitimate design too, but it turns one clear, reviewable order
into several small ones for a household to execute by hand; this module
picks the simpler shape. Nothing here forecloses a future, more granular
strategy -- `HoldingInput` already carries everything a proportional
allocator would need.
"""

from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Context, Decimal

from app.engines.quantity import SCALE, Quantity, value_cents

# Same headroom and rounding rule as engines.quantity._CONTEXT and
# engines.portfolio._CONTEXT, for the identical reason: a large monetary
# value divided by a price must never hit the default context's silent
# truncation or crash.
_CONTEXT = Context(prec=100, rounding=ROUND_HALF_UP)

# A division (`trade_value_cents / price`) routinely has far more than
# SCALE decimal places -- 1000/3 does not terminate at all. `Quantity`
# itself REFUSES more than SCALE places rather than silently rounding one
# away, by design (see its module docstring): that guard exists to catch a
# caller silently losing precision it was HANDED. Here the precision was
# never handed to us -- it is a genuine remainder of dividing two integers
# -- so quantising to SCALE before construction is this module's own
# one-time rounding of a fresh computation, not a discarded input.
_UNIT_QUANTUM = Decimal(1).scaleb(-SCALE)

BPS_WHOLE = 10_000  # 100.00%, in basis points -- CLAUDE.md's rates convention.

# U+202F, the narrow no-break space French uses to group thousands -- the same
# one the frontend's own `formatCents` emits. Spelt as an escape so this source
# file carries no invisible character.
_NARROW_NBSP = "\u202f"


def _french_hundredths(value: int) -> str:
    """An integer number of hundredths as a French decimal: 123456 -> "1 234,56".

    Covers both of the quantities this module writes into a sentence -- cents
    and basis points -- because both are integers whose last two digits ARE
    the fractional part. Integer arithmetic throughout: `value / 100` would
    put a float on a monetary value, which CLAUDE.md forbids at every layer.

    This exists because Python's `:.2f` writes "1234.56", which is not French.
    Every sentence built below is shown to the user verbatim -- `/patrimoine`
    prints a refusal exactly as it was handed one -- so a decimal point here
    is a defect on screen, not a formatting preference.
    """
    sign = "−" if value < 0 else ""  # typographic minus, like formatCents
    whole, fraction = divmod(abs(value), 100)
    grouped = f"{whole:,}".replace(",", _NARROW_NBSP)
    return f"{sign}{grouped},{fraction:02d}"


@dataclass(frozen=True)
class AllocationTarget:
    asset_class: str
    target_bps: int  # 0..BPS_WHOLE


@dataclass(frozen=True)
class HoldingInput:
    """One instrument's current, valued position, in the SAME reporting
    currency `engines.portfolio.value_portfolio` already blended everything
    into -- not the position's native currency."""

    symbol: str
    name: str
    asset_class: str
    is_fractionable: bool
    quantity: Quantity
    # The reporting-currency value of ONE unit -- needed to SIZE a trade.
    # None exactly when `market_value_reporting_cents` is also None.
    price_reporting_cents: int | None
    # None means this holding's value is unknown (Task 7's "missing price"
    # or "missing FX") -- excluded from current allocation entirely, like
    # Task 7's own weights. 0 is a real, known value (e.g. sold to nothing),
    # distinct from unknown.
    market_value_reporting_cents: int | None


@dataclass(frozen=True)
class Trade:
    symbol: str
    asset_class: str
    action: str  # "buy" | "sell"
    quantity: str  # Quantity as text -- whole units when not fractionable
    estimated_value_cents: int  # reporting currency


@dataclass(frozen=True)
class TradeRefusal:
    # Empty when the refusal is about the asset class as a whole (no
    # instrument to trade at all), never about one specific instrument.
    symbol: str
    asset_class: str
    reason: str  # French


@dataclass(frozen=True)
class AssetClassDrift:
    asset_class: str
    target_bps: int
    current_bps: int
    current_value_cents: int
    target_value_cents: int
    # target_value - current_value: positive means underweight (buy),
    # negative means overweight (sell).
    drift_cents: int
    # current_bps - target_bps: positive means overweight.
    drift_bps: int


@dataclass(frozen=True)
class AllocationReport:
    total_value_cents: int  # reporting currency, over holdings that could be valued
    holdings_total: int
    holdings_valued: int
    drifts: list[AssetClassDrift]
    trades: list[Trade]
    refusals: list[TradeRefusal]


def validate_targets(targets: list[AllocationTarget]) -> None:
    """The 100 %-sum and no-duplicate guard, on its own.

    Public because `/api/portfolio`'s own `PUT /targets` (Task 10) has to
    apply exactly this rule at the moment a set is STORED, not only when it
    is later read: a set persisted un-validated would make every subsequent
    `GET /allocation` refuse, with nothing in the write path having said so.
    `evaluate_allocation` calls it too, so there is one rule in one place.
    """
    seen: set[str] = set()
    for target in targets:
        if target.asset_class in seen:
            raise ValueError(
                f"La classe d'actifs « {target.asset_class} » a plus d'une allocation cible."
            )
        seen.add(target.asset_class)
        if not (0 <= target.target_bps <= BPS_WHOLE):
            raise ValueError(
                f"L'allocation cible de la classe « {target.asset_class} » doit être "
                "comprise entre 0 % et 100 %."
            )
    total_bps = sum(t.target_bps for t in targets)
    if total_bps != BPS_WHOLE:
        raise ValueError(
            "La somme des allocations cibles doit être égale à 100 % : elle vaut "
            f"{_french_hundredths(total_bps)} %."
        )


def _round_half_up_int(exact: Decimal) -> int:
    return int(_CONTEXT.quantize(exact, Decimal(1)))


def _bps(part_cents: int, whole_cents: int) -> int:
    if whole_cents == 0:
        return 0
    numerator = _CONTEXT.multiply(Decimal(part_cents), Decimal(BPS_WHOLE))
    return _round_half_up_int(_CONTEXT.divide(numerator, Decimal(whole_cents)))


def _share_of(whole_cents: int, share_bps: int) -> int:
    numerator = _CONTEXT.multiply(Decimal(whole_cents), Decimal(share_bps))
    return _round_half_up_int(_CONTEXT.divide(numerator, Decimal(BPS_WHOLE)))


def _refuse(symbol: str, asset_class: str, reason: str) -> TradeRefusal:
    return TradeRefusal(symbol=symbol, asset_class=asset_class, reason=reason)


def _size_trade(
    holding: HoldingInput, action: str, trade_value_cents: int, reporting_currency: str
) -> Trade | TradeRefusal:
    """One trade, sized against `holding`'s reporting-currency price --
    whole units when `holding.is_fractionable` is False, refused rather
    than rounded to a fractional share when the drift is too small relative
    to the price to represent as even one whole unit."""
    price = holding.price_reporting_cents
    if price is None or price <= 0:
        return _refuse(
            holding.symbol, holding.asset_class,
            f"Le prix de « {holding.symbol} » est inconnu : impossible de dimensionner un ordre.",
        )

    raw_units = _CONTEXT.divide(Decimal(trade_value_cents), Decimal(price))

    if holding.is_fractionable:
        quantity = Quantity(_CONTEXT.quantize(raw_units, _UNIT_QUANTUM))
        if quantity.value == 0:
            return _refuse(
                holding.symbol, holding.asset_class,
                f"L'écart à corriger sur « {holding.symbol} » est trop faible pour être "
                "représenté.",
            )
    else:
        whole_units = _round_half_up_int(raw_units)
        if whole_units == 0:
            return _refuse(
                holding.symbol, holding.asset_class,
                f"« {holding.symbol} » n'est pas fractionnable : l'écart à corriger "
                f"({_french_hundredths(trade_value_cents)} {reporting_currency}) représente "
                f"moins d'une unité au prix actuel ({_french_hundredths(price)} "
                f"{reporting_currency}). Aucun ordre n'est proposé plutôt qu'une part "
                "fractionnée.",
            )
        quantity = Quantity(Decimal(whole_units))

    if action == "sell":
        # Never propose selling more than is actually held.
        if quantity.value > holding.quantity.value:
            quantity = holding.quantity
        if quantity.value == 0:
            return _refuse(
                holding.symbol, holding.asset_class,
                f"« {holding.symbol} » : aucune quantité détenue à vendre.",
            )

    return Trade(
        symbol=holding.symbol, asset_class=holding.asset_class, action=action,
        quantity=str(quantity), estimated_value_cents=value_cents(quantity, price),
    )


def evaluate_allocation(
    holdings: list[HoldingInput], targets: list[AllocationTarget],
    reporting_currency: str = "EUR",
) -> AllocationReport:
    validate_targets(targets)

    valued = [h for h in holdings if h.market_value_reporting_cents is not None]
    total_value_cents = sum((h.market_value_reporting_cents for h in valued), start=0)

    by_class: dict[str, list[HoldingInput]] = {}
    for holding in valued:
        by_class.setdefault(holding.asset_class, []).append(holding)

    drifts: list[AssetClassDrift] = []
    for target in targets:
        class_holdings = by_class.get(target.asset_class, [])
        current_value_cents = sum(
            (h.market_value_reporting_cents for h in class_holdings), start=0
        )
        current_bps = _bps(current_value_cents, total_value_cents)
        target_value_cents = _share_of(total_value_cents, target.target_bps)
        drift_cents = target_value_cents - current_value_cents
        drifts.append(AssetClassDrift(
            asset_class=target.asset_class, target_bps=target.target_bps,
            current_bps=current_bps, current_value_cents=current_value_cents,
            target_value_cents=target_value_cents, drift_cents=drift_cents,
            drift_bps=current_bps - target.target_bps,
        ))

    trades: list[Trade] = []
    refusals: list[TradeRefusal] = []
    for drift in drifts:
        if drift.drift_cents == 0:
            continue
        action = "buy" if drift.drift_cents > 0 else "sell"
        # Only instruments with a known price can size a trade at all --
        # see the module docstring on "what could be valued".
        candidates = [
            h for h in by_class.get(drift.asset_class, [])
            if h.price_reporting_cents is not None and h.price_reporting_cents > 0
        ]
        if not candidates:
            refusals.append(_refuse(
                "", drift.asset_class,
                f"Aucun instrument avec un prix connu n'est détenu dans la classe "
                f"« {drift.asset_class} » : impossible de proposer un ordre pour "
                "corriger l'écart.",
            ))
            continue

        # The single largest current holding in this class -- ties broken
        # by symbol, ascending, so the choice is deterministic.
        largest = min(
            candidates, key=lambda h: (-(h.market_value_reporting_cents or 0), h.symbol)
        )

        outcome = _size_trade(largest, action, abs(drift.drift_cents), reporting_currency)
        if isinstance(outcome, Trade):
            trades.append(outcome)
        else:
            refusals.append(outcome)

    return AllocationReport(
        total_value_cents=total_value_cents, holdings_total=len(holdings),
        holdings_valued=len(valued), drifts=drifts, trades=trades, refusals=refusals,
    )
