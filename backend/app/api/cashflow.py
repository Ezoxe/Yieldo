"""GET /api/cashflow/forecast and GET /api/cashflow/runway.

Both routes read the clock here, at the boundary, and hand it to the pure
engines as a parameter -- never `date.today()` inside `app.engines`.

The two routes make different use of "today", and the difference is
deliberate rather than an oversight:

* `forecast` hands `detect_recurrences` and `project_cashflow` the ledger's
  own last transaction date, exactly like `api/recurrences.py` does (task 8).
  `detect_recurrences` marks a recurrence `ended` once its last occurrence is
  old enough relative to whatever `today` it receives, and it cannot tell
  "cancelled" from "no recent import" -- it only ever sees the clock it is
  given. The operator's ledger stops 2026-01-09, months before the real
  calendar date; passing the real clock here would silently mark every live
  subscription "ended", drop it from `_is_projected`, and understate every
  projected month's recurring charges by however much rent and subscriptions
  actually cost. The horizon itself starts the month after "today"
  (`_future_month_keys`), so this same choice also decides which calendar
  months get projected: the months following where the imported history
  actually stops, which is the only span the data can honestly speak to.
* `runway` hands `compute_runway` the real `date.today()`. Nothing in that
  engine classifies a recurrence by staleness -- `today` only anchors
  `depleted_on`, a forward calendar date, and the "already at zero" branch.
  Anchoring that date to a stale ledger date would land `depleted_on` in the
  past whenever the runway is shorter than the gap since the last import: an
  already-passed depletion date is a strictly worse answer than the
  (disclosed, via `ledger_last_on`) fact that the burn rate itself was last
  measured on an old statement. This mirrors `api/budgets.py`, which also
  always passes the real clock into its engine and reserves `history.date_to`
  for picking a display default, never for the computation itself.

Both payloads carry `ledger_last_on` so the screen can say honestly how fresh
the data behind the figures is -- the same contract `api/recurrences.py`
established for its own stale-ledger case.
"""

from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.common import liquid_balance_cents, recurrence_points
from app.api.history import user_history
from app.db import get_db
from app.engines.capacity import MeasuredRate, MonthlyEntry, MonthObservation, complete_months
from app.engines.forecast import (
    DEFAULT_HORIZON_MONTHS,
    MAX_HORIZON_MONTHS,
    LedgerEntry,
    build_observations,
    project_cashflow,
)
from app.engines.recurrence import RecurringTx, detect_recurrences
from app.engines.runway import RunwayScenario, compute_runway
from app.models import Category, User
from app.schemas.cashflow import (
    ForecastMonthOut,
    ForecastOut,
    MeasuredRateOut,
    RunwayOut,
    RunwayScenarioOut,
)
from app.schemas.history import HistoryOut
from app.security.deps import get_current_user

router = APIRouter(prefix="/cashflow", tags=["cashflow"])


def _ledger_bounds(history: HistoryOut | None, today: date) -> tuple[date, date]:
    """The span the statements actually cover -- never a requested window.

    `complete_months` cannot tell a genuine ledger extent from a display
    window: bounds wider than the data really covers silently admit a partial
    month as complete (the "quarter of the truth" failure `capacity.py`
    exists to prevent). A user with no rows gets an empty single-day span,
    which yields zero observed months and an honest refusal rather than a
    crash.
    """
    if history is None:
        return today, today
    return history.date_from, history.date_to


def _months(points: list[RecurringTx], start: date, end: date) -> list[MonthObservation]:
    return complete_months(
        [MonthlyEntry(on=point.on, amount_cents=point.amount_cents) for point in points],
        start,
        end,
    )


def _ledger_span_months(history: HistoryOut | None) -> int:
    """The number of distinct calendar months between the ledger's first and
    last transaction, inclusive -- complete or partial, with or without a
    hole in between. Deliberately not `complete_months`' notion of
    "observed": this is raw calendar arithmetic on the ledger's own bounds, so
    a screen can tell "3 complete months out of a dense 3-month ledger" apart
    from "3 complete months out of a ledger spanning thirteen calendar months
    with a nine-month import gap" -- the operator's actual situation.
    """
    if history is None:
        return 0
    start, end = history.date_from, history.date_to
    return (end.year - start.year) * 12 + (end.month - start.month) + 1


@router.get("/forecast", response_model=ForecastOut)
def forecast(
    months: int = Query(default=DEFAULT_HORIZON_MONTHS, ge=1, le=MAX_HORIZON_MONTHS),
    threshold_cents: int = 0,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ForecastOut:
    """Twelve months of projected balance, as a P10/P50/P90 band.

    See the module docstring for the `today` decision. The recurring and
    residual halves are kept disjoint by `forecast.build_observations`, which
    windows the subtraction per recurrence -- filtering on bare
    `recurring_keys` would strip a lapsed-and-resumed subscription's pre-lapse
    rows from the residual on the authority of a run that excluded them.
    """
    history = user_history(db, user.id)
    today = history.date_to if history is not None else date.today()

    points = recurrence_points(db, user.id)
    detected = detect_recurrences(points, today)
    start, end = _ledger_bounds(history, today)

    observations = build_observations(
        entries=[
            LedgerEntry(on=p.on, amount_cents=p.amount_cents, label_key=p.label_key)
            for p in points
        ],
        recurrences=detected.recurrences,
        ledger_start=start,
        ledger_end=end,
    )
    report = project_cashflow(
        balance_cents=liquid_balance_cents(db, user.id),
        history=observations,
        recurrences=detected.recurrences,
        today=today,
        horizon_months=months,
        threshold_cents=threshold_cents,
    )

    return ForecastOut(
        months=[
            ForecastMonthOut(
                key=m.key, start=m.start, end=m.end,
                recurring_cents=m.recurring_cents,
                residual_cents=m.residual_cents,
                net_p50_cents=m.net_p50_cents,
                balance_p10_cents=m.balance_p10_cents,
                balance_p50_cents=m.balance_p50_cents,
                balance_p90_cents=m.balance_p90_cents,
                below_threshold=m.below_threshold,
                seasonal=m.seasonal,
            )
            for m in report.months
        ],
        months_observed=report.months_observed,
        ledger_months_observed=report.ledger_months_observed,
        seasonality_used=report.seasonality_used,
        recurrences_projected=report.recurrences_projected,
        pooled_scale_cents=report.pooled_scale_cents,
        seasonal_scale_cents=report.seasonal_scale_cents,
        threshold_cents=report.threshold_cents,
        first_breach_key=report.first_breach_key,
        opening_balance_cents=report.opening_balance_cents,
        insufficient_reason=report.insufficient_reason,
        band_unavailable_reason=report.band_unavailable_reason,
        recurring_only=report.recurring_only,
        projected_from=today,
        ledger_last_on=history.date_to if history is not None else None,
    )


def _rate_out(rate: MeasuredRate) -> MeasuredRateOut:
    return MeasuredRateOut(
        months=rate.months,
        median_cents=rate.median_cents,
        spread_cents=rate.spread_cents,
        low_cents=rate.low_cents,
        high_cents=rate.high_cents,
    )


def _scenario_out(scenario: RunwayScenario | None) -> RunwayScenarioOut | None:
    if scenario is None:
        return None
    return RunwayScenarioOut(
        name=scenario.name,
        monthly_burn_cents=scenario.monthly_burn_cents,
        rate=_rate_out(scenario.rate),
        months=scenario.months,
        depleted_on=scenario.depleted_on,
    )


@router.get("/runway", response_model=RunwayOut)
def runway(
    user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> RunwayOut:
    """How many months the liquid balance lasts with no income at all.

    See the module docstring for why this route uses the real clock, unlike
    `forecast`.
    """
    today = date.today()
    history = user_history(db, user.id)
    points = recurrence_points(db, user.id)
    start, end = _ledger_bounds(history, today)

    essential_ids = {
        row.id
        for row in db.query(Category.id)
        .filter(Category.user_id == user.id, Category.is_essential.is_(True))
        .all()
    }
    # A transaction with `category_id IS NULL` (the operator has 26 such rows)
    # matches no id in `essential_ids` and is excluded here, while staying in
    # `points` for `all_months` -- the conservative default `runway.py`'s
    # docstring fixes: an uncategorised row can only shorten the essentials
    # runway, never inflate it on the strength of a row nobody has reviewed.
    essential_points = [p for p in points if p.category_id in essential_ids]

    report = compute_runway(
        balance_cents=liquid_balance_cents(db, user.id),
        all_months=_months(points, start, end),
        essential_months=_months(essential_points, start, end),
        today=today,
        # So the engine can tell "nothing is flagged essential" from "flagged
        # categories carry no spending in any complete month". Both leave
        # `essential_months` empty; only one of them is about the history.
        essential_category_count=len(essential_ids),
    )

    return RunwayOut(
        balance_cents=report.balance_cents,
        months_observed=report.months_observed,
        ledger_span_months=_ledger_span_months(history),
        normal=_scenario_out(report.normal),
        essentials=_scenario_out(report.essentials),
        normal_unavailable_reason=report.normal_unavailable_reason,
        essentials_unavailable_reason=report.essentials_unavailable_reason,
        essential_category_count=len(essential_ids),
        projected_from=today,
        ledger_last_on=history.date_to if history is not None else None,
    )
