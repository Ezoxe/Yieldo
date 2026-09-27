"""GET /api/outlook, POST /api/outlook/scenario, GET /api/outlook/reliability.

The Avenir screen's three questions: what the balance will be day by day, what
a change would do to it, and how right this method has been on the household's
own history.

The clock is read here and nowhere below: `today` only measures how stale the
statements are; the projection starts the day after the perimeter's last
statement row (`as_of`), the one span the data can speak to -- the same choice
`api/cashflow.forecast` makes, for the same reason.

Two perimeters: « Comptes courants » (the overdraft question, the default) and
« Tout le disponible » (checking, savings, cash, like the liquid balance).
Declarations and planned events without an account belong to both; with one,
to the perimeters holding it.
"""

from datetime import date, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.api.common import LIQUID_ACCOUNT_KINDS, dismissed_label_keys
from app.db import get_db
from app.engines.backtest import measure_reliability
from app.engines.forecast import residual_model
from app.engines.outlook import (
    Adjustment,
    Outlook,
    apply_adjustments,
    month_profile_bps,
    outlook_keys,
    project_outlook,
    uniform_profile_bps,
)
from app.engines.outlook_sources import Declared, FlowRow, Planned, Sources, assemble
from app.engines.schedule import Checkin, DeclaredSchedule, observed_amount
from app.importers.dedup import normalize_label
from app.models import (
    Account,
    AlertSettings,
    DeclaredRecurrence,
    PlannedEvent,
    RecurrenceCheckin,
    Transaction,
    User,
)
from app.schemas.outlook import (
    HorizonScoreOut,
    LowPointOut,
    OutlookDayOut,
    OutlookEventOut,
    OutlookMonthOut,
    OutlookOut,
    ReliabilityOut,
    ScenarioIn,
    ScenarioOut,
    SeriesOut,
    SourceCountsOut,
)
from app.security.deps import get_current_user

router = APIRouter(prefix="/outlook", tags=["avenir"])

Scope = Literal["checking", "liquid"]
_KINDS: dict[str, tuple[str, ...]] = {"checking": ("checking",), "liquid": LIQUID_ACCOUNT_KINDS}
_EMPTY = {
    "checking": "Aucun compte courant : créez-en un dans Import pour voir votre avenir.",
    "liquid": "Aucun compte disponible : créez-en un dans Import pour voir votre avenir.",
}


class _Perimeter:
    """Everything the engines need about one perimeter, read once."""

    def __init__(self, db: Session, user: User, scope: Scope, today: date) -> None:
        self.scope = scope
        self.today = today
        accounts = (
            db.query(Account)
            .filter(Account.user_id == user.id, Account.kind.in_(_KINDS[scope]),
                    Account.archived.is_(False))
            .all()
        )
        self.account_ids = {account.id for account in accounts}
        transactions = (
            db.query(Transaction)
            .filter(Transaction.user_id == user.id,
                    Transaction.account_id.in_(self.account_ids))
            .order_by(Transaction.date, Transaction.id)
            .all()
        ) if self.account_ids else []
        self.rows = [
            FlowRow(id=row.id, on=row.date, amount_cents=row.amount_cents,
                    account_id=row.account_id, label_key=normalize_label(row.label_raw),
                    label_raw=row.label_raw, category_id=row.category_id,
                    is_transfer=row.is_transfer)
            for row in transactions
        ]
        self.opening_before_rows = sum(account.opening_balance_cents for account in accounts)
        self.balance = self.opening_before_rows + sum(row.amount_cents for row in self.rows)
        self.as_of = self.rows[-1].on if self.rows else today
        self.ledger_start = self.rows[0].on if self.rows else today
        self.dismissed = dismissed_label_keys(db, user.id)
        self.declared = self._declared(db, user)
        self.planned = [
            Planned(id=row.id, label=row.label, on=row.due_on, amount_cents=row.amount_cents,
                    account_id=row.account_id, category_id=row.category_id)
            for row in db.query(PlannedEvent).filter(PlannedEvent.user_id == user.id).all()
            if row.account_id is None or row.account_id in self.account_ids
        ]
        settings_row = db.query(AlertSettings).filter(AlertSettings.user_id == user.id).first()
        floor = settings_row.balance_floor_cents if settings_row is not None else None
        self.threshold = floor if floor is not None else 0
        self.threshold_source: Literal["alert", "zero"] = "alert" if floor is not None else "zero"

    def _declared(self, db: Session, user: User) -> list[Declared]:
        rows = db.query(DeclaredRecurrence).filter(DeclaredRecurrence.user_id == user.id).all()
        checkins: dict[int, list[RecurrenceCheckin]] = {}
        for checkin in db.query(RecurrenceCheckin).filter(
                RecurrenceCheckin.user_id == user.id).all():
            checkins.setdefault(checkin.declared_recurrence_id, []).append(checkin)
        result = []
        for row in rows:
            if row.account_id is not None and row.account_id not in self.account_ids:
                continue
            schedule = DeclaredSchedule(
                id=row.id, label=row.label, amount_cents=row.amount_cents,
                amount_is_variable=row.amount_is_variable, periodicity=row.periodicity,
                anchor_on=row.anchor_on, ends_on=row.ends_on, active=row.active,
            )
            own = checkins.get(row.id, [])
            amount, _ = observed_amount(schedule, [
                Checkin(schedule_id=row.id, due_on=item.due_on, amount_cents=item.amount_cents,
                        paid_on=item.paid_on, transaction_id=item.transaction_id)
                for item in own
            ])
            result.append(Declared(
                schedule=schedule, amount_cents=amount, account_id=row.account_id,
                category_id=row.category_id, label_key=normalize_label(row.label),
                checkin_transaction_ids=frozenset(
                    item.transaction_id for item in own if item.transaction_id is not None),
            ))
        return result

    def sources(self, horizon_end: date) -> Sources:
        return assemble(self.rows, dismissed_keys=self.dismissed, declared=self.declared,
                        planned=self.planned, as_of=self.as_of, horizon_end=horizon_end,
                        ledger_start=self.ledger_start, ledger_end=self.as_of)


def _perimeter(db: Session, user: User, scope: Scope) -> _Perimeter:
    return _Perimeter(db, user, scope, date.today())


def _project(perimeter: _Perimeter, horizon_days: int,
             adjustments: list[Adjustment] | None = None) -> tuple[Outlook, Sources, bool]:
    horizon_end = perimeter.as_of + timedelta(days=horizon_days)
    sources = perimeter.sources(horizon_end)
    model = residual_model(sources.history, outlook_keys(perimeter.as_of, horizon_end))
    profile = month_profile_bps(sources.residual_rows, sources.history.observations)
    events = apply_adjustments(sources.events, adjustments) if adjustments else sources.events
    outlook = project_outlook(
        opening_balance_cents=perimeter.balance, as_of=perimeter.as_of,
        horizon_days=horizon_days, events=events, model=model, profile_bps=profile,
        threshold_cents=perimeter.threshold,
    )
    return outlook, sources, profile != uniform_profile_bps()


def _out(perimeter: _Perimeter, outlook: Outlook, sources: Sources,
         profile_measured: bool) -> OutlookOut:
    return OutlookOut(
        scope=perimeter.scope, as_of=perimeter.as_of, today=perimeter.today,
        stale_days=max(0, (perimeter.today - perimeter.as_of).days),
        horizon_end=outlook.horizon_end, opening_balance_cents=outlook.opening_balance_cents,
        threshold_cents=outlook.threshold_cents, threshold_source=perimeter.threshold_source,
        days=[OutlookDayOut(on=day.on, p10_cents=day.p10_cents, p50_cents=day.p50_cents,
                            p90_cents=day.p90_cents) for day in outlook.days],
        events=[
            OutlookEventOut(on=placed.event.on, amount_cents=placed.event.amount_cents,
                            label=placed.event.label, source=placed.event.source,
                            series=placed.event.series, category_id=placed.event.category_id,
                            balance_after_cents=placed.balance_after_cents)
            for placed in outlook.events
        ],
        months=[OutlookMonthOut(key=month.key, p10_cents=month.p10_cents,
                                p50_cents=month.p50_cents, p90_cents=month.p90_cents,
                                low_on=month.low_on, low_p50_cents=month.low_p50_cents)
                for month in outlook.months],
        low_point=LowPointOut(on=outlook.low_point.on, p50_cents=outlook.low_point.p50_cents,
                              p10_cents=outlook.low_point.p10_cents),
        risk=outlook.risk, first_breach_on=outlook.first_breach_on,
        variable_daily_cents=outlook.variable_daily_cents, band=outlook.band,
        band_unavailable_reason=outlook.band_unavailable_reason,
        residual_months=len(sources.history.observations), profile_measured=profile_measured,
        warnings=sources.warnings,
        series=[SeriesOut(id=item.id, label=item.label, source=item.source,
                          amount_cents=item.amount_cents, periodicity=item.periodicity)
                for item in sources.series],
        counts=SourceCountsOut(detected=sources.detected_projected,
                               declared=sources.declared_projected,
                               planned=sources.planned_projected,
                               reconciled=sources.reconciled),
    )


def _empty(perimeter: _Perimeter) -> OutlookOut:
    return OutlookOut(
        scope=perimeter.scope, as_of=perimeter.as_of, today=perimeter.today, stale_days=0,
        horizon_end=perimeter.as_of, opening_balance_cents=0, threshold_cents=perimeter.threshold,
        threshold_source=perimeter.threshold_source, days=[], events=[], months=[],
        low_point=None, risk="none", first_breach_on=None, variable_daily_cents=None,
        band=False, band_unavailable_reason=None, residual_months=0, profile_measured=False,
        warnings=[], series=[],
        counts=SourceCountsOut(detected=0, declared=0, planned=0, reconciled=0),
        empty_reason=_EMPTY[perimeter.scope],
    )


@router.get("", response_model=OutlookOut)
def read_outlook(
    scope: Scope = "checking",
    horizon_days: int = Query(default=90, ge=1, le=730),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> OutlookOut:
    perimeter = _perimeter(db, user, scope)
    if not perimeter.account_ids:
        return _empty(perimeter)
    outlook, sources, measured = _project(perimeter, horizon_days)
    return _out(perimeter, outlook, sources, measured)


@router.post("/scenario", response_model=ScenarioOut)
def scenario(
    payload: ScenarioIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ScenarioOut:
    """The same projection twice: as the household's data stand, and with the
    adjustments applied. Nothing is written."""
    perimeter = _perimeter(db, user, payload.scope)
    if not perimeter.account_ids:
        raise HTTPException(status_code=422, detail=_EMPTY[payload.scope])
    base, sources, measured = _project(perimeter, payload.horizon_days)
    known_series = {item.id for item in sources.series}
    adjustments: list[Adjustment] = []
    for item in payload.adjustments:
        if not perimeter.as_of < item.on <= base.horizon_end:
            raise HTTPException(status_code=422, detail=(
                "La date d'un scénario doit tomber dans l'horizon affiché, après le "
                f"{perimeter.as_of.strftime('%d/%m/%Y')}."))
        if item.kind in ("cancel", "change_amount") and item.series not in known_series:
            raise HTTPException(status_code=422, detail=(
                "Cette échéance n'est plus projetée : rechargez l'écran puis choisissez-la "
                "à nouveau."))
        if item.kind in ("one_off", "change_amount") and item.amount_cents is None:
            raise HTTPException(status_code=422,
                                detail="Indiquez le montant de ce scénario.")
        if item.kind == "one_off" and item.amount_cents == 0:
            raise HTTPException(status_code=422, detail=(
                "Un montant nul ne change rien : indiquez ce qui entre ou ce qui sort."))
        adjustments.append(Adjustment(kind=item.kind, on=item.on, label=item.label,
                                      amount_cents=item.amount_cents, series=item.series))
    changed, _, _ = _project(perimeter, payload.horizon_days, adjustments)
    return ScenarioOut(base=_out(perimeter, base, sources, measured),
                       scenario=_out(perimeter, changed, sources, measured))


@router.get("/reliability", response_model=ReliabilityOut)
def reliability(
    scope: Scope = "checking",
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ReliabilityOut:
    perimeter = _perimeter(db, user, scope)
    measured = measure_reliability(
        perimeter.rows, opening_balance_cents=perimeter.opening_before_rows,
        dismissed_keys=perimeter.dismissed, ledger_start=perimeter.ledger_start,
        ledger_end=perimeter.as_of,
    )
    return ReliabilityOut(
        scope=scope,
        horizons=[HorizonScoreOut(horizon_months=score.horizon_months, replays=score.replays,
                                  mean_abs_error_cents=score.mean_abs_error_cents,
                                  median_abs_error_cents=score.median_abs_error_cents,
                                  bias_cents=score.bias_cents, inside_band=score.inside_band)
                  for score in measured.horizons],
        refusal=measured.refusal,
    )
