"""How well the Avenir method would have done, on this household's own history.

A forecast that cannot say how wrong it usually is asks to be believed. This
replays `engines/outlook` at every past month end the history allows -- using
only the statements up to that day -- and compares what it would have
predicted one and three months later with the balance that actually came:

* the mean and median absolute error, in cents;
* the bias -- the mean of (actual - predicted): negative means the method was
  too optimistic;
* how many times the actual balance fell inside the announced band (80 % of
  the time is what the band claims).

**Declarations and planned events are not replayed**: they are statements
made now, with no record of when the household knew them, and replaying them
on the past would lend the method a foresight it never had. The screen says so.

A replay needs `MIN_MONTHS_FOR_FORECAST` complete months of variable spending
before its cut-off, so the first one comes at month seven and three replays of
the one-month horizon need nine months. Below that the answer is a refusal
that counts the months, not a score built on one or two points.

Pure: no session, no network, no clock.
"""

from dataclasses import dataclass
from datetime import date, timedelta

from app.engines.capacity import MonthlyEntry, complete_months
from app.engines.forecast import MIN_MONTHS_FOR_FORECAST, residual_model
from app.engines.outlook import month_profile_bps, outlook_keys, project_outlook
from app.engines.outlook_sources import FlowRow, assemble
from app.engines.robust import median_cents

HORIZONS_MONTHS = (1, 3)
MIN_REPLAYS = 3
# The first replay needs six months before it and one after it; three replays
# of the one-month horizon therefore need this many complete months.
MIN_MONTHS_TO_REPLAY = MIN_MONTHS_FOR_FORECAST + MIN_REPLAYS


@dataclass(frozen=True)
class HorizonScore:
    horizon_months: int
    replays: int
    mean_abs_error_cents: int
    median_abs_error_cents: int
    # Mean of (actual - predicted). Negative: the method was too optimistic.
    bias_cents: int
    inside_band: int


@dataclass(frozen=True)
class Reliability:
    horizons: list[HorizonScore]
    # French, non-null exactly when `horizons` is empty.
    refusal: str | None


def _month_end(year: int, month: int) -> date:
    following = date(year + (month == 12), month % 12 + 1, 1)
    return following - timedelta(days=1)


def _add_months(on: date, months: int) -> date:
    index = on.year * 12 + on.month - 1 + months
    return _month_end(index // 12, index % 12 + 1)


def _divide(total: int, count: int) -> int:
    quotient, remainder = divmod(abs(total), count)
    if 2 * remainder >= count:
        quotient += 1
    return quotient if total >= 0 else -quotient


def _refusal(months: int) -> Reliability:
    return Reliability(
        horizons=[],
        refusal=(
            f"Il faut au moins {MIN_MONTHS_TO_REPLAY} mois complets de relevés pour rejouer "
            f"la prévision : vos relevés en comptent {months}."
        ),
    )


def measure_reliability(
    rows: list[FlowRow],
    *,
    opening_balance_cents: int,
    dismissed_keys: frozenset[str],
    ledger_start: date,
    ledger_end: date,
) -> Reliability:
    """Replay the Avenir method at every month end the history allows.

    `opening_balance_cents` is the perimeter's balance before its first row;
    the balance on any day is that plus every row up to it.
    """
    months_held = len(complete_months(
        [MonthlyEntry(on=row.on, amount_cents=row.amount_cents) for row in rows],
        ledger_start, ledger_end,
    )) if rows else 0
    if months_held < MIN_MONTHS_TO_REPLAY:
        return _refusal(months_held)

    ordered = sorted(rows, key=lambda row: (row.on, row.id))

    def balance_on(day: date) -> int:
        return opening_balance_cents + sum(row.amount_cents for row in ordered if row.on <= day)

    errors: dict[int, list[int]] = {horizon: [] for horizon in HORIZONS_MONTHS}
    inside: dict[int, int] = dict.fromkeys(HORIZONS_MONTHS, 0)

    cut = _month_end(ledger_start.year, ledger_start.month)
    while cut < ledger_end:
        reach = [horizon for horizon in HORIZONS_MONTHS if _add_months(cut, horizon) <= ledger_end]
        if not reach:
            break
        horizon_end = _add_months(cut, max(reach))
        known = [row for row in ordered if row.on <= cut]
        sources = assemble(known, dismissed_keys=dismissed_keys, declared=[], planned=[],
                           as_of=cut, horizon_end=horizon_end, ledger_start=ledger_start,
                           ledger_end=cut)
        if len(sources.history.observations) >= MIN_MONTHS_FOR_FORECAST:
            model = residual_model(sources.history, outlook_keys(cut, horizon_end))
            outlook = project_outlook(
                opening_balance_cents=balance_on(cut), as_of=cut,
                horizon_days=(horizon_end - cut).days, events=sources.events, model=model,
                profile_bps=month_profile_bps(sources.residual_rows,
                                              sources.history.observations),
                threshold_cents=0,
            )
            by_day = {day.on: day for day in outlook.days}
            for horizon in reach:
                target = _add_months(cut, horizon)
                predicted = by_day[target]
                actual = balance_on(target)
                errors[horizon].append(actual - predicted.p50_cents)
                if predicted.p10_cents <= actual <= predicted.p90_cents:
                    inside[horizon] += 1
        cut = _add_months(cut, 1)

    if len(errors[1]) < MIN_REPLAYS:
        return _refusal(months_held)

    scores = [
        HorizonScore(
            horizon_months=horizon,
            replays=len(found),
            mean_abs_error_cents=_divide(sum(abs(error) for error in found), len(found)),
            median_abs_error_cents=median_cents([abs(error) for error in found]),
            bias_cents=_divide(sum(found), len(found)),
            inside_band=inside[horizon],
        )
        for horizon, found in errors.items()
        if found
    ]
    return Reliability(horizons=scores, refusal=None)
