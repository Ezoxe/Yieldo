"""GET/POST/PATCH/DELETE /api/debts and GET /api/debts/payoff.

The clock is read here, at the boundary, and handed to `compare_strategies` as
a parameter -- no engine imports `date.today`.

**This route uses the real calendar date, and the reasoning is its own, not
borrowed.** `api/cashflow.py`'s forecast anchors on the ledger's last
transaction because `detect_recurrences` classifies a subscription as `ended`
by staleness and would mark every live one dead on a ledger that stops in
January. Nothing in `engines/debt.py` classifies anything by staleness: `today`
only anchors `cleared_on`, a forward calendar date. Anchoring that to a stale
ledger date would land every payoff date months in the past. A debt is declared
by the user, not read from statements, so its freshness is not a property of
the ledger at all -- which is why, unlike `/api/cashflow/*`, this payload
carries no `ledger_last_on`.

`/payoff` is declared before the `/{debt_id}` routes. FastAPI matches in
declaration order, and although no `GET /{debt_id}` exists today, adding one
later above this line would silently swallow `/payoff` into a 422 on an
integer path parameter.
"""

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.db import get_db
from app.engines.debt import DebtInput, PayoffPlan, compare_strategies
from app.models import DEBT_KINDS, Debt, User
from app.schemas.debts import (
    BalancePointOut,
    DebtIn,
    DebtOut,
    DebtPatch,
    DebtPayoffOut,
    PayoffPlanOut,
    StrategyComparisonOut,
)
from app.security.deps import get_current_user

router = APIRouter(prefix="/debts", tags=["debts"])


def _owned(db: Session, user: User, debt_id: int) -> Debt:
    debt = db.query(Debt).filter(Debt.id == debt_id, Debt.user_id == user.id).first()
    if debt is None:
        raise HTTPException(status_code=404, detail="Dette introuvable")
    return debt


def _check_kind(kind: str | None) -> None:
    if kind is not None and kind not in DEBT_KINDS:
        raise HTTPException(status_code=422, detail=f"Type de dette inconnu : {kind}")


def _active_debts(db: Session, user_id: int) -> list[Debt]:
    return (
        db.query(Debt)
        .filter(Debt.user_id == user_id, Debt.archived.is_(False))
        .order_by(Debt.id)
        .all()
    )


@router.get("/payoff", response_model=StrategyComparisonOut)
def payoff(
    extra_cents: int = Query(default=0, ge=0, le=100_000_000),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> StrategyComparisonOut:
    """Both strategies over the same constant budget. See the module docstring
    for why this route reads the real clock."""
    debts = [
        DebtInput(id=row.id, name=row.name, principal_cents=row.principal_cents,
                  annual_rate_bps=row.annual_rate_bps,
                  minimum_payment_cents=row.minimum_payment_cents)
        for row in _active_debts(db, user.id)
    ]
    try:
        comparison = compare_strategies(debts, extra_cents, date.today())
    except ValueError as exc:
        # `compare_strategies` raises in French already (see its own guards) --
        # the same catch-and-forward idiom `api/analysis.py` uses for an engine
        # error that is already user-facing prose, not a stack trace to hide.
        # `extra_cents` is Query-validated (`ge=0`) so this only fires if a row
        # already in the database somehow carries a negative field -- a defence
        # against a future bypass of the create/patch schemas, not dead code.
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return StrategyComparisonOut(
        snowball=_plan_out(comparison.snowball),
        avalanche=_plan_out(comparison.avalanche),
        interest_saved_cents=comparison.interest_saved_cents,
        months_saved=comparison.months_saved,
    )


def _plan_out(plan: PayoffPlan) -> PayoffPlanOut:
    return PayoffPlanOut(
        strategy=plan.strategy,
        monthly_budget_cents=plan.monthly_budget_cents,
        first_month_interest_cents=plan.first_month_interest_cents,
        months=plan.months,
        cleared_on=plan.cleared_on,
        total_interest_cents=plan.total_interest_cents,
        total_paid_cents=plan.total_paid_cents,
        order=plan.order,
        payoffs=[
            DebtPayoffOut(debt_id=p.debt_id, name=p.name,
                          cleared_in_months=p.cleared_in_months, cleared_on=p.cleared_on,
                          interest_cents=p.interest_cents, paid_cents=p.paid_cents)
            for p in plan.payoffs
        ],
        points=[
            BalancePointOut(
                month=point.month, on=point.on,
                # JSON object keys are strings. Converted here, once, rather
                # than left for the frontend to discover.
                balances_cents={str(k): v for k, v in point.balances_cents.items()},
                total_cents=point.total_cents,
            )
            for point in plan.points
        ],
        unavailable_reason=plan.unavailable_reason,
    )


@router.get("", response_model=list[DebtOut])
def list_debts(user: User = Depends(get_current_user),
               db: Session = Depends(get_db)) -> list[Debt]:
    return _active_debts(db, user.id)


@router.post("", response_model=DebtOut, status_code=status.HTTP_201_CREATED)
def create_debt(payload: DebtIn, user: User = Depends(get_current_user),
                db: Session = Depends(get_db)) -> Debt:
    _check_kind(payload.kind)
    debt = Debt(user_id=user.id, **payload.model_dump())
    db.add(debt)
    db.commit()
    db.refresh(debt)
    return debt


@router.patch("/{debt_id}", response_model=DebtOut)
def patch_debt(debt_id: int, payload: DebtPatch, user: User = Depends(get_current_user),
               db: Session = Depends(get_db)) -> Debt:
    debt = _owned(db, user, debt_id)
    _check_kind(payload.kind)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(debt, field, value)
    db.commit()
    db.refresh(debt)
    return debt


@router.delete("/{debt_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_debt(debt_id: int, user: User = Depends(get_current_user),
                db: Session = Depends(get_db)) -> None:
    """Archiving, not deleting: a repaid debt is part of the household's history."""
    debt = _owned(db, user, debt_id)
    debt.archived = True
    db.commit()
