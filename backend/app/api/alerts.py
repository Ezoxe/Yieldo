"""GET /api/alerts and PUT /api/alerts/settings. Design §12, phase 4 Task 10.

Every query below filters on `user_id`, via `get_current_user`. The clock is
read HERE, at the boundary, and handed to `engines/alert.py` as a parameter --
no engine in this project imports `date.today`.

**Which "today" each half of this route uses, and why they differ.** The same
distinction `api/cashflow.py` documents for its own two routes:

* recurrences and the cash-flow projection are handed the LEDGER's own last
  transaction date. `detect_recurrences` marks a recurrence `ended` once its
  last occurrence is old enough relative to whatever `today` it receives, and
  it cannot tell "cancelled" from "no recent import". The operator's ledger
  stops 2026-01-09, months before the real calendar date; passing the real
  clock would mark every live subscription "ended", and there would be no
  missing-debit condition left to measure at all.
* budgets are handed the real `date.today()`, exactly like `api/budgets.py`,
  which reserves the ledger's own date for picking which MONTH to display and
  never for the computation. A month already in the past is fully elapsed,
  which is the honest reading.

**The import-gap gate lives in the engine, not here.** This module's only job
on that front is to measure the coverage truthfully -- from every transaction
this user actually has, transfers included, because a month holding nothing
but an internal transfer is still a month that was imported -- and hand it to
`evaluate_alerts`. See `engines/alert.py` for why a debit "missing" in a month
no statement covers is a hole in the data and not a missed payment.

One consequence of the ledger-anchored clock above is worth stating, since it
is not obvious: because `status == "missing"` requires
`expected_next_on + grace < today` and `today` here IS the ledger's last day,
an expected charge can never fall AFTER the last imported day on this route.
`engines/alert.py` still guards that case -- it is reachable from any caller
passing a real clock, and the two gaps carry two different French causes.
"""

from datetime import date

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.common import (
    anomaly_points,
    liquid_balance_cents,
    period_range,
    recurrence_points,
    rolled_budget_spend,
    tx_points,
)
from app.api.history import user_history
from app.db import get_db
from app.engines.aggregate import aggregate_by_category
from app.engines.alert import (
    SEVERITY_LABELS,
    AlertReport,
    AnomalyInput,
    AnomalySubject,
    BalanceFloorInput,
    BudgetInput,
    BudgetSubject,
    LedgerCoverage,
    evaluate_alerts,
    measure_coverage,
)
from app.engines.anomaly import detect_anomalies
from app.engines.budget import BudgetEntry, days_in_month, evaluate_budgets
from app.engines.forecast import (
    DEFAULT_HORIZON_MONTHS,
    ForecastReport,
    LedgerEntry,
    build_observations,
    project_cashflow,
)
from app.engines.recurrence import Recurrence, detect_recurrences
from app.models import AlertSettings, Category, Transaction, User
from app.schemas.alerts import (
    AlertOut,
    AlertReportOut,
    AlertSettingsIn,
    AlertSettingsOut,
    ConditionStateOut,
    CoverageOut,
)
from app.security.deps import get_current_user

router = APIRouter(prefix="/alerts", tags=["alerts"])


def _fetch_settings(db: Session, user_id: int) -> AlertSettings | None:
    return db.query(AlertSettings).filter(AlertSettings.user_id == user_id).first()


def _coverage(db: Session, user_id: int) -> LedgerCoverage:
    """Every transaction date this user has, transfers included.

    Transfers are counted here and nowhere else in this module, for the same
    reason `liquid_balance_cents` counts them: this is not a measure of
    spending, it is a measure of whether a statement was imported at all, and
    a month whose only row is an internal transfer WAS imported.
    """
    rows = db.query(Transaction.date).filter(Transaction.user_id == user_id).all()
    return measure_coverage(row[0] for row in rows)


def _recurrences(db: Session, user_id: int, ledger_last: date) -> list[Recurrence]:
    return detect_recurrences(recurrence_points(db, user_id), ledger_last).recurrences


def _forecast(
    db: Session, user_id: int, ledger_last: date, floor_cents: int, start: date, end: date
) -> ForecastReport:
    points = recurrence_points(db, user_id)
    detected = detect_recurrences(points, ledger_last)
    observations = build_observations(
        entries=[
            LedgerEntry(on=p.on, amount_cents=p.amount_cents, label_key=p.label_key)
            for p in points
        ],
        recurrences=detected.recurrences,
        ledger_start=start,
        ledger_end=end,
    )
    return project_cashflow(
        balance_cents=liquid_balance_cents(db, user_id),
        history=observations,
        recurrences=detected.recurrences,
        today=ledger_last,
        horizon_months=DEFAULT_HORIZON_MONTHS,
        # The stored floor, and never a default: the engine refuses a
        # projection built against a threshold other than the one being
        # tested, which is what stops a 0 sneaking in as "no floor".
        threshold_cents=floor_cents,
    )


def _budgets(db: Session, user: User, ledger_last: date | None, today: date) -> BudgetInput:
    """Budget lines for the month of the ledger's LAST transaction.

    The month is picked exactly as `api/budgets.resolve_month` picks its
    default: the operator's statements stop months before the real calendar
    date, and evaluating the current month would report every budget as
    untouched on a permanently empty month.
    """
    if ledger_last is None:
        return BudgetInput(month_start=None, lines=())

    month_start = ledger_last.replace(day=1)
    month_end = date(month_start.year, month_start.month, days_in_month(month_start))

    categories = (
        db.query(Category)
        .filter(Category.user_id == user.id)
        .order_by(Category.position, Category.name)
        .all()
    )
    budgeted = [c for c in categories if c.monthly_budget_cents and c.monthly_budget_cents > 0]
    if not budgeted:
        return BudgetInput(month_start=month_start, lines=())

    spent = {
        total.category_id: total.total_cents
        for total in aggregate_by_category(tx_points(db, user.id, month_start, month_end))
    }
    # The same roll-up `api/budgets.py` applies, through the same helper: a
    # budget crossed on that screen has to be the budget this alert fires on,
    # and two copies of the walk would eventually disagree about which.
    rolled = rolled_budget_spend(spent, categories, {c.id for c in budgeted})
    entries = [
        BudgetEntry(
            category_id=category.id,
            budget_cents=category.monthly_budget_cents,
            # A category netting positive this month is income, not a spend,
            # and `evaluate_budgets` refuses it outright. Clamped to 0 here --
            # "nothing went out" -- rather than allowed to raise a 500 on a
            # screen whose whole job is to be readable.
            spent_cents=min(0, rolled[category.id]),
        )
        for category in budgeted
    ]
    by_id = {category.id: category for category in budgeted}
    lines = evaluate_budgets(entries, month_start, today)
    return BudgetInput(
        month_start=month_start,
        lines=tuple(
            BudgetSubject(category_name=by_id[line.category_id].name, line=line)
            for line in lines
        ),
    )


def _anomalies(db: Session, user: User) -> AnomalyInput:
    """Anomalies over the user's whole ledger span.

    The reported window is the same one `GET /api/analysis/anomalies` reports
    by default -- `period_range` with no bounds, which means "as far as there
    is data" and never the current calendar year. The statistics behind it
    still read the WHOLE ledger, per `detect_anomalies`' own contract.
    """
    start, end, history = period_range(db, user.id, None, None)
    if history is None:
        return AnomalyInput(window=None, scored_groups=0, anomalies=())

    report = detect_anomalies(anomaly_points(db, user.id), start, end)
    names = {
        row.id: row.name
        for row in db.query(Category).filter(Category.user_id == user.id).all()
    }
    return AnomalyInput(
        window=(start, end),
        scored_groups=report.scored_groups,
        anomalies=tuple(
            AnomalySubject(
                anomaly=item,
                category_name=names.get(item.category_id, "Non catégorisé"),
            )
            for item in report.anomalies
        ),
    )


def _build(db: Session, user: User, today: date) -> tuple[AlertReport, AlertSettings | None]:
    settings_row = _fetch_settings(db, user.id)
    floor_cents = None if settings_row is None else settings_row.balance_floor_cents

    history = user_history(db, user.id)
    coverage = _coverage(db, user.id)
    ledger_last = history.date_to if history is not None else None

    recurrences: list[Recurrence] = []
    forecast: ForecastReport | None = None
    if ledger_last is not None:
        recurrences = _recurrences(db, user.id, ledger_last)
        if floor_cents is not None:
            forecast = _forecast(
                db, user.id, ledger_last, floor_cents, history.date_from, history.date_to
            )

    report = evaluate_alerts(
        today=today,
        coverage=coverage,
        balance=BalanceFloorInput(floor_cents=floor_cents, forecast=forecast),
        recurrences=recurrences,
        budgets=_budgets(db, user, ledger_last, today),
        anomalies=_anomalies(db, user),
    )
    return report, settings_row


def _out(report: AlertReport, settings_row: AlertSettings | None) -> AlertReportOut:
    return AlertReportOut(
        alerts=[
            AlertOut(
                kind=alert.kind, severity=alert.severity,
                severity_label=SEVERITY_LABELS[alert.severity], key=alert.key,
                title=alert.title, measured=alert.measured, period=alert.period,
                clears_when=alert.clears_when, amount_cents=alert.amount_cents,
                on=alert.on,
            )
            for alert in report.alerts
        ],
        conditions=[
            ConditionStateOut(
                kind=item.kind, label=item.label, measured=item.measured,
                detail=item.detail, alert_count=item.alert_count,
                withheld=list(item.withheld),
            )
            for item in report.conditions
        ],
        coverage=CoverageOut(
            first_on=report.coverage.first_on,
            last_on=report.coverage.last_on,
            covered_months=sorted(report.coverage.covered_months),
            missing_months=list(report.coverage.missing_months),
        ),
        settings=AlertSettingsOut(
            balance_floor_cents=(
                None if settings_row is None else settings_row.balance_floor_cents
            )
        ),
        notice=report.notice,
        ledger_last_on=report.coverage.last_on,
    )


@router.get("", response_model=AlertReportOut)
def list_alerts(
    user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> AlertReportOut:
    report, settings_row = _build(db, user, date.today())
    return _out(report, settings_row)


@router.put("/settings", response_model=AlertSettingsOut)
def set_alert_settings(
    payload: AlertSettingsIn,
    user: User = Depends(get_current_user), db: Session = Depends(get_db),
) -> AlertSettingsOut:
    """Store, change, or clear the projected-balance floor.

    An explicit `null` CLEARS the floor -- back to "Yieldo watches no
    plancher" -- and is never written as 0. The row itself survives, holding a
    real `NULL`, so the distinction the whole table exists for is preserved on
    disk and not only in this function.
    """
    row = _fetch_settings(db, user.id)
    if row is None:
        row = AlertSettings(user_id=user.id, balance_floor_cents=payload.balance_floor_cents)
        db.add(row)
    else:
        row.balance_floor_cents = payload.balance_floor_cents
    db.commit()
    db.refresh(row)
    return AlertSettingsOut(balance_floor_cents=row.balance_floor_cents)
