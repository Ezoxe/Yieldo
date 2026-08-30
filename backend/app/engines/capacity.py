"""What a month actually costs, and what it actually saves, measured.

The design brief's purchase-feasibility engine (§6.3) opens on "Capacité
d'épargne réelle, mesurée sur les transactions des douze derniers mois, pas
déclarée. Avec sa variabilité." `measure_savings_capacity` is that figure, and
phase 2B consumes it directly -- its shape is settled here.

Everything is measured over *complete observed months*, and both halves of that
phrase matter:

* complete -- a ledger opening on 24 January holds a week of that month, and
  counting it as a month would make the measured rate a quarter of the truth;
* observed -- a month with no transactions inside a sparse ledger means "no
  statement was imported", not "nothing was spent". Counting those as
  zero-spend months would halve every rate in this module.

Pure: no session, no network, no implicit clock.
"""

from dataclasses import dataclass
from datetime import date

from app.engines.aggregate import bucket_bounds
from app.engines.robust import describe, quantile_offset_cents

# Three months is the floor at which a median means anything at all. Below it
# the "rate" is one or two numbers wearing a statistic's clothes, and the
# caller is told nothing could be measured rather than handed a figure.
MIN_MONTHS_FOR_RATE = 3


@dataclass(frozen=True)
class MonthlyEntry:
    """The minimal input: when, and how much. Callers build these from whatever
    row shape they already hold."""

    on: date
    amount_cents: int


@dataclass(frozen=True)
class MonthObservation:
    key: str
    start: date
    end: date
    inflow_cents: int
    # Negative, like every outflow in this codebase.
    outflow_cents: int
    net_cents: int
    count: int


@dataclass(frozen=True)
class MeasuredRate:
    """A rate measured from history, with its variability -- never a bare number.

    `low_cents` / `high_cents` are the P10 / P90 equivalents derived from the
    robust scale. A rate quoted without them invites the reader to treat a
    median as a certainty.
    """

    months: int
    median_cents: int
    spread_cents: int
    low_cents: int
    high_cents: int


def complete_months(
    entries: list[MonthlyEntry], ledger_start: date, ledger_end: date
) -> list[MonthObservation]:
    """Every whole calendar month inside the ledger that actually holds activity.

    Precondition on `ledger_start` / `ledger_end`: they must be the *actual*
    extent of the caller's data -- the minimum and maximum date genuinely
    covered by imported statements -- never a requested display window (a
    "last 12 months" filter, a custom date-range picker, etc). This function
    has no way to tell the two apart: it only checks whether a month's
    calendar bounds fall inside [ledger_start, ledger_end], so passing bounds
    wider than what the data actually covers silently defeats the
    partial-month guard below and admits a month holding only a week of real
    statements as "complete". Widening the bounds can only ever *admit* extra,
    partial months this way -- it can never drop a genuine one -- which is
    exactly the module docstring's "quarter of the truth" failure,
    reintroduced from the caller's side. See
    `test_ledger_bounds_must_reflect_actual_data_coverage_not_a_requested_window`
    in `test_capacity.py` for both sides of this side by side.
    """
    buckets: dict[str, list[int]] = {}
    for entry in entries:
        if entry.on < ledger_start or entry.on > ledger_end:
            continue
        buckets.setdefault(f"{entry.on.year}-{entry.on.month:02d}", []).append(
            entry.amount_cents
        )

    observations: list[MonthObservation] = []
    for key in sorted(buckets):
        start, end = bucket_bounds(key, "month")
        # A month straddling either edge of the ledger is only partly covered by
        # the statements that exist, so it is not an observation of a month.
        if start < ledger_start or end > ledger_end:
            continue
        amounts = buckets[key]
        inflow = sum(amount for amount in amounts if amount > 0)
        outflow = sum(amount for amount in amounts if amount < 0)
        observations.append(MonthObservation(
            key=key, start=start, end=end,
            inflow_cents=inflow, outflow_cents=outflow,
            net_cents=inflow + outflow, count=len(amounts),
        ))
    return observations


def _measure(values: list[int]) -> MeasuredRate | None:
    if len(values) < MIN_MONTHS_FOR_RATE:
        return None
    spread = describe(values)
    offset = quantile_offset_cents(spread.sigma)
    return MeasuredRate(
        months=len(values),
        median_cents=spread.median,
        spread_cents=spread.sigma,
        low_cents=spread.median - offset,
        high_cents=spread.median + offset,
    )


def measure_expense_rate(months: list[MonthObservation]) -> MeasuredRate | None:
    """What a month costs, as a positive magnitude. None when unmeasurable."""
    return _measure([abs(month.outflow_cents) for month in months])


def measure_income_rate(months: list[MonthObservation]) -> MeasuredRate | None:
    """What a month brings in. None when unmeasurable.

    The third sibling of `measure_expense_rate` and `measure_savings_capacity`,
    over the same complete observed months and with the same floor. Phase 2B's
    purchase-feasibility engine needs it for the taux d'endettement of design
    §6.3 item 5 -- a ratio whose denominator must be measured from real
    statements rather than declared, like everything else in this module.

    `inflow_cents`, not `net_cents`: a household paying its rent out of its
    salary has not been paid less. The three functions answer three different
    questions and their medians do not generally agree.

    `None`, never 0: a household whose income could not be measured has no debt
    ratio at all, and `amortization.debt_ratio_bps` refuses in the same way for
    the same reason.
    """
    return _measure([month.inflow_cents for month in months])


def measure_savings_capacity(months: list[MonthObservation]) -> MeasuredRate | None:
    """What a month saves, signed. None when unmeasurable.

    **Phase 2B's purchase-feasibility engine consumes this function.** The sign
    is kept: a household that spends more than it earns has a negative capacity,
    and clamping that to zero would let a feasibility verdict read "atteignable
    en serrant" for someone who is going backwards every month.
    """
    return _measure([month.net_cents for month in months])
