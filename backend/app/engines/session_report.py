"""The balance sheet of a simulated trading day.

Pure: it is handed the capital curve (one point per step), a summary of every
decision the day took and every order it sent, and returns the figures the
« La journée » screen prints -- return, drawdown, winners and losers, how
often the model agreed with the built-in rules, how sure it said it was,
how fast it answered, and the mass it put on each direction step by step.

Ratios go through `Decimal` and come out as integer basis points; a mean is
taken only over the rows that carry the figure, and is None when none does
-- an average of nothing is not zero.
"""

from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from decimal import ROUND_HALF_UP, Decimal

from app.decision.contract import BPS_WHOLE
from app.decision.strategy import BUY, HOLD, SELL


@dataclass(frozen=True)
class Point:
    step: int
    equity_cents: int
    cash_cents: int
    exposure_cents: int
    orders: int


@dataclass(frozen=True)
class DecisionSummary:
    step: int
    symbol: str
    outcome: str
    choice: str | None
    mass_bps: dict[str, int] | None = None
    confidence_bps: int | None = None
    act_bps: int | None = None
    latency_ms: int = 0
    rules_choice: str | None = None


@dataclass(frozen=True)
class OrderSummary:
    step: int
    symbol: str
    side: str
    status: str
    realised_pnl_cents: int


@dataclass(frozen=True)
class MassPoint:
    step: int
    buy_bps: int
    sell_bps: int
    hold_bps: int


@dataclass(frozen=True)
class SessionReport:
    final_equity_cents: int
    return_bps: int
    max_drawdown_bps: int
    decisions: int
    held: int
    refused: int
    ordered: int
    failed: int
    orders: int
    filled: int
    winning: int
    losing: int
    realised_pnl_cents: int
    compared: int
    agreement_bps: int
    mean_confidence_bps: int | None
    mean_act_bps: int | None
    latency_p50_ms: int | None
    mass_series: dict[str, tuple[MassPoint, ...]] = field(default_factory=dict)


def _bps(numerator: int, denominator: int) -> int:
    if denominator == 0:
        return 0
    return int(
        (Decimal(numerator) * BPS_WHOLE / Decimal(denominator)).quantize(
            Decimal(1), rounding=ROUND_HALF_UP
        )
    )


def _mean(values: Sequence[int]) -> int | None:
    if not values:
        return None
    return int(
        (Decimal(sum(values)) / Decimal(len(values))).quantize(Decimal(1), rounding=ROUND_HALF_UP)
    )


def max_drawdown_bps(equities: Sequence[int]) -> int:
    """The deepest fall from a running peak, in bps of that peak."""
    peak = 0
    worst = 0
    for equity in equities:
        peak = max(peak, equity)
        if peak > 0:
            worst = max(worst, _bps(peak - equity, peak))
    return worst


def report(
    points: Iterable[Point],
    decisions: Iterable[DecisionSummary],
    orders: Iterable[OrderSummary],
    *,
    initial_cash_cents: int,
) -> SessionReport:
    curve = sorted(points, key=lambda row: row.step)
    rows = sorted(decisions, key=lambda row: (row.step, row.symbol))
    sent = list(orders)

    final_equity = curve[-1].equity_cents if curve else initial_cash_cents
    equities = [initial_cash_cents, *(row.equity_cents for row in curve)]

    filled = [row for row in sent if row.status == "filled"]
    sells = [row for row in filled if row.side == "sell"]

    compared = [row for row in rows if row.choice is not None and row.rules_choice is not None]
    agreed = sum(1 for row in compared if row.choice == row.rules_choice)

    series: dict[str, list[MassPoint]] = {}
    for row in rows:
        if not row.mass_bps:
            continue
        series.setdefault(row.symbol, []).append(MassPoint(
            step=row.step,
            buy_bps=row.mass_bps.get(BUY, 0),
            sell_bps=row.mass_bps.get(SELL, 0),
            hold_bps=row.mass_bps.get(HOLD, 0),
        ))

    latencies = sorted(row.latency_ms for row in rows if row.choice is not None)

    return SessionReport(
        final_equity_cents=final_equity,
        return_bps=_bps(final_equity - initial_cash_cents, initial_cash_cents),
        max_drawdown_bps=max_drawdown_bps(equities),
        decisions=len(rows),
        held=sum(1 for row in rows if row.outcome == "held"),
        refused=sum(1 for row in rows if row.outcome == "refused"),
        ordered=sum(1 for row in rows if row.outcome == "ordered"),
        failed=sum(1 for row in rows if row.outcome == "failed"),
        orders=len(sent),
        filled=len(filled),
        winning=sum(1 for row in sells if row.realised_pnl_cents > 0),
        losing=sum(1 for row in sells if row.realised_pnl_cents < 0),
        realised_pnl_cents=sum(row.realised_pnl_cents for row in filled),
        compared=len(compared),
        agreement_bps=_bps(agreed, len(compared)),
        mean_confidence_bps=_mean([
            row.confidence_bps for row in rows if row.confidence_bps is not None
        ]),
        mean_act_bps=_mean([row.act_bps for row in rows if row.act_bps is not None]),
        latency_p50_ms=latencies[len(latencies) // 2] if latencies else None,
        mass_series={symbol: tuple(rows) for symbol, rows in series.items()},
    )
