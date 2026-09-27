"""The balance of one perimeter, day by day, with its band and its low point.

`outlook_sources` says what is known about the future; `forecast.residual_model`
says what the variable part costs each month and how uncertain that is. This
module lays both over the days:

* the **median** of day *d* is the opening balance, plus every known event up
  to *d*, plus the share of each month's variable centre spent by *d*;
* that share follows the **household's own month**: the median, over its
  observed months, of how much of the month's variable spending is gone by
  each point of the month (`month_profile_bps`). A household that shops the
  weekend after payday is not drawn as one that spends evenly;
* the **band** interpolates each month's variance by the same profile, so it
  widens the way the month is spent and never narrows;
* the month `as_of` falls in is projected only for what is left of it.

From the days come the answers the screen leads with: the **low point** (the
lowest median day), the **risk** of going under the threshold (`probable` when
the median does, `possible` when only the low edge does), and the month ends.

Ratios are integer basis points; every figure is integer cents. Pure: no
session, no network, no clock.
"""

from calendar import monthrange
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, timedelta
from math import sqrt
from typing import Literal

from app.engines.capacity import MonthlyEntry, MonthObservation
from app.engines.forecast import MIN_MONTHS_FOR_FORECAST, ResidualModel
from app.engines.outlook_sources import KnownEvent
from app.engines.robust import P90_SIGMAS, quantile_offset_cents

BPS_WHOLE = 10_000
# The profile is read on a 31-point scale whatever the month's length: point p
# is "p/31 of the month gone", so February and August share one curve.
PROFILE_POINTS = 31
MAX_HORIZON_DAYS = 730

Risk = Literal["none", "possible", "probable"]


@dataclass(frozen=True)
class OutlookDay:
    on: date
    p10_cents: int
    p50_cents: int
    p90_cents: int


@dataclass(frozen=True)
class PlacedEvent:
    event: KnownEvent
    # The median balance at the end of the event's day.
    balance_after_cents: int


@dataclass(frozen=True)
class MonthEnd:
    key: str
    p10_cents: int
    p50_cents: int
    p90_cents: int
    low_on: date
    low_p50_cents: int


@dataclass(frozen=True)
class LowPoint:
    on: date
    p50_cents: int
    p10_cents: int


@dataclass(frozen=True)
class Outlook:
    as_of: date
    horizon_end: date
    opening_balance_cents: int
    threshold_cents: int
    days: list[OutlookDay]
    events: list[PlacedEvent]
    months: list[MonthEnd]
    low_point: LowPoint
    risk: Risk
    first_breach_on: date | None
    # The variable part of the first full month, per day. None when it could
    # not be measured.
    variable_daily_cents: int | None
    band: bool
    # French, non-null exactly when `band` is False.
    band_unavailable_reason: str | None


@dataclass(frozen=True)
class Adjustment:
    """One « Et si… » change, applied to the known events before projection.

    * `one_off` -- an expense or an income on `on` (`amount_cents` signed);
    * `cancel` -- the `series` charges from `on` onwards stop;
    * `change_amount` -- the `series` charges from `on` onwards cost `amount_cents`.
    """

    kind: Literal["one_off", "cancel", "change_amount"]
    on: date
    label: str | None = None
    amount_cents: int | None = None
    series: str | None = None


def outlook_keys(as_of: date, horizon_end: date) -> list[str]:
    """Every month from `as_of`'s to `horizon_end`'s, inclusive: the months a
    residual model must cover for `project_outlook`."""
    keys: list[str] = []
    year, month = as_of.year, as_of.month
    while (year, month) <= (horizon_end.year, horizon_end.month):
        keys.append(f"{year}-{month:02d}")
        month += 1
        if month == 13:
            year, month = year + 1, 1
    return keys


def uniform_profile_bps() -> tuple[int, ...]:
    """A month spent evenly: point p is p/31 of it."""
    return tuple(point * BPS_WHOLE // PROFILE_POINTS for point in range(PROFILE_POINTS)) + (
        BPS_WHOLE,
    )


def _position(day: int, length: int) -> int:
    """Day `day` of a `length`-day month, on the 31-point scale (0 = not begun)."""
    return -(-day * PROFILE_POINTS // length)


def month_profile_bps(
    residual_rows: list[MonthlyEntry], months: list[MonthObservation]
) -> tuple[int, ...]:
    """How much of a month's variable spending is gone by each point of it.

    Measured on the variable part's own OUTFLOWS, month by month, then the
    median at every point -- a single month of Christmas shopping does not bend
    the curve. Forced to rise from 0 to 10 000 and never to fall. Below
    `MIN_MONTHS_FOR_FORECAST` usable months there is no shape to claim, and the
    month is spent evenly.
    """
    by_key: dict[str, list[MonthlyEntry]] = defaultdict(list)
    for row in residual_rows:
        by_key[f"{row.on.year}-{row.on.month:02d}"].append(row)

    curves: list[list[int]] = []
    for month in months:
        outflows = [row for row in by_key.get(month.key, []) if row.amount_cents < 0]
        total = sum(-row.amount_cents for row in outflows)
        if total == 0:
            continue
        length = monthrange(month.start.year, month.start.month)[1]
        spent = [0] * (PROFILE_POINTS + 1)
        for row in outflows:
            spent[_position(row.on.day, length)] += -row.amount_cents
        curve, running = [], 0
        for point in range(PROFILE_POINTS + 1):
            running += spent[point]
            curve.append(running * BPS_WHOLE // total)
        curves.append(curve)

    if len(curves) < MIN_MONTHS_FOR_FORECAST:
        return uniform_profile_bps()

    profile: list[int] = []
    highest = 0
    for point in range(PROFILE_POINTS + 1):
        values = sorted(curve[point] for curve in curves)
        middle = len(values) // 2
        median = values[middle] if len(values) % 2 else (values[middle - 1] + values[middle]) // 2
        highest = max(highest, median)
        profile.append(highest)
    profile[0] = 0
    profile[-1] = BPS_WHOLE
    return tuple(profile)


def apply_adjustments(events: list[KnownEvent], adjustments: list[Adjustment]) -> list[KnownEvent]:
    """The known events as a scenario changes them. Never mutates `events`."""
    result = list(events)
    for index, adjustment in enumerate(adjustments):
        if adjustment.kind == "one_off":
            result.append(KnownEvent(
                on=adjustment.on, amount_cents=adjustment.amount_cents or 0,
                label=adjustment.label or "Scénario", source="scenario",
                series=f"scenario:{index}", category_id=None,
            ))
        elif adjustment.kind == "cancel":
            result = [
                event for event in result
                if not (event.series == adjustment.series and event.on >= adjustment.on)
            ]
        elif adjustment.kind == "change_amount":
            result = [
                KnownEvent(on=event.on, amount_cents=adjustment.amount_cents or 0,
                           label=event.label, source=event.source, series=event.series,
                           category_id=event.category_id)
                if event.series == adjustment.series and event.on >= adjustment.on
                else event
                for event in result
            ]
    return sorted(result, key=lambda event: event.on)


def _share(cents: int, bps: int) -> int:
    """`cents × bps / 10 000`, rounded half away from zero."""
    quotient, remainder = divmod(abs(cents) * bps, BPS_WHOLE)
    if 2 * remainder >= BPS_WHOLE:
        quotient += 1
    return quotient if cents >= 0 else -quotient


def _divide(cents: int, divisor: int) -> int:
    """Integer division rounded half away from zero. Money never goes float."""
    quotient, remainder = divmod(abs(cents), divisor)
    if 2 * remainder >= divisor:
        quotient += 1
    return quotient if cents >= 0 else -quotient


_REASON_UNMEASURED = (
    "Pas assez d'historique pour mesurer vos dépenses courantes : il faut "
    f"{MIN_MONTHS_FOR_FORECAST} mois complets de relevés. Seules vos échéances connues "
    "sont projetées, sans fourchette ; importez des relevés plus anciens pour ajouter la "
    "part variable."
)
_REASON_FLAT = (
    "Vos dépenses courantes ne varient pas d'un mois à l'autre : la projection est exacte "
    "au regard de vos relevés, mais aucune fourchette ne l'entoure."
)


def project_outlook(
    *,
    opening_balance_cents: int,
    as_of: date,
    horizon_days: int,
    events: list[KnownEvent],
    model: ResidualModel | None,
    profile_bps: tuple[int, ...],
    threshold_cents: int,
) -> Outlook:
    """The perimeter's balance from the day after `as_of` to `as_of + horizon_days`.

    `model` covers `outlook_keys(as_of, as_of + horizon_days)`; None (or an
    `insufficient` model) projects the known events alone.
    """
    if not 1 <= horizon_days <= MAX_HORIZON_DAYS:
        raise ValueError(
            f"L'horizon de l'avenir doit être compris entre 1 et {MAX_HORIZON_DAYS} jours "
            f"(reçu : {horizon_days})."
        )
    horizon_end = as_of + timedelta(days=horizon_days)
    keys = outlook_keys(as_of, horizon_end)
    usable = model is not None and model.status in ("measured", "flat")
    months_by_key = {month.key: month for month in model.months} if usable else {}
    band = usable and model.status == "measured"
    reason = None if band else (_REASON_FLAT if usable else _REASON_UNMEASURED)

    # Per month: where the projection starts inside it (bps of the month already
    # gone), the variable part and variance spent before it, and its own
    # variance increment.
    start_bps: dict[str, int] = {}
    residual_before: dict[str, int] = {}
    variance_before: dict[str, float] = {}
    increment: dict[str, float] = {}
    residual_acc, variance_acc, previous_cumulative = 0, 0.0, 0.0
    for key in keys:
        year, month = int(key[:4]), int(key[5:])
        length = monthrange(year, month)[1]
        begun = profile_bps[_position(as_of.day, length)] if key == keys[0] else 0
        start_bps[key] = begun
        residual_before[key] = residual_acc
        variance_before[key] = variance_acc
        modelled = months_by_key.get(key)
        centre = modelled.centre_cents if modelled else 0
        cumulative = modelled.cumulative_variance if (modelled and band) else previous_cumulative
        increment[key] = cumulative - previous_cumulative
        previous_cumulative = cumulative
        residual_acc += _share(centre, BPS_WHOLE - begun)
        variance_acc += increment[key] * (BPS_WHOLE - begun) / BPS_WHOLE

    per_day: dict[date, int] = defaultdict(int)
    for event in events:
        if as_of < event.on <= horizon_end:
            per_day[event.on] += event.amount_cents

    days: list[OutlookDay] = []
    events_acc = 0
    for offset in range(1, horizon_days + 1):
        on = as_of + timedelta(days=offset)
        key = f"{on.year}-{on.month:02d}"
        length = monthrange(on.year, on.month)[1]
        gone = profile_bps[_position(on.day, length)] - start_bps[key]
        modelled = months_by_key.get(key)
        centre = modelled.centre_cents if modelled else 0
        events_acc += per_day.get(on, 0)
        median = (opening_balance_cents + events_acc + residual_before[key]
                  + _share(centre, gone))
        variance = variance_before[key] + increment[key] * gone / BPS_WHOLE
        half_width = quantile_offset_cents(round(sqrt(max(variance, 0.0))), P90_SIGMAS)
        days.append(OutlookDay(on=on, p10_cents=median - half_width, p50_cents=median,
                               p90_cents=median + half_width))

    by_day = {day.on: day for day in days}
    placed = [
        PlacedEvent(event=event, balance_after_cents=by_day[event.on].p50_cents)
        for event in sorted(events, key=lambda item: item.on)
        if as_of < event.on <= horizon_end
    ]

    lowest = min(days, key=lambda day: (day.p50_cents, day.on))
    low_point = LowPoint(on=lowest.on, p50_cents=lowest.p50_cents, p10_cents=lowest.p10_cents)
    first_breach = next((day.on for day in days if day.p10_cents < threshold_cents), None)
    if low_point.p50_cents < threshold_cents:
        risk: Risk = "probable"
    elif first_breach is not None:
        risk = "possible"
    else:
        risk = "none"

    month_ends: list[MonthEnd] = []
    for key in keys:
        in_month = [day for day in days if f"{day.on.year}-{day.on.month:02d}" == key]
        if not in_month:
            continue
        year, month = int(key[:4]), int(key[5:])
        if in_month[-1].on.day != monthrange(year, month)[1]:
            continue
        low = min(in_month, key=lambda day: (day.p50_cents, day.on))
        last = in_month[-1]
        month_ends.append(MonthEnd(key=key, p10_cents=last.p10_cents, p50_cents=last.p50_cents,
                                   p90_cents=last.p90_cents, low_on=low.on,
                                   low_p50_cents=low.p50_cents))

    variable_daily: int | None = None
    if usable:
        first_full = keys[1] if len(keys) > 1 else keys[0]
        modelled = months_by_key.get(first_full)
        if modelled is not None:
            year, month = int(first_full[:4]), int(first_full[5:])
            variable_daily = _divide(modelled.centre_cents, monthrange(year, month)[1])

    return Outlook(
        as_of=as_of, horizon_end=horizon_end, opening_balance_cents=opening_balance_cents,
        threshold_cents=threshold_cents, days=days, events=placed, months=month_ends,
        low_point=low_point, risk=risk, first_breach_on=first_breach,
        variable_daily_cents=variable_daily, band=band, band_unavailable_reason=reason,
    )
