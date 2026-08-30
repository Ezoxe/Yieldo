"""GET/POST/PATCH/DELETE /api/goals.

The clock is read here and handed to `evaluate_goals` as a parameter. This
route uses the real `date.today()`: nothing in `engines/goal.py` classifies
anything by staleness, and `today` only anchors forward projection dates, which
must count from now. That is the same reasoning `api/cashflow.py`'s runway
route sets out, and NOT the ledger-anchored clock its forecast route uses --
the two are different decisions for different reasons, and citing the wrong
precedent has already misled one reader in this codebase.

The measured capacity comes from the same pipeline `/api/cashflow/runway` uses:
`recurrence_points` (this user's rows, transfers excluded) → `complete_months`
over the LEDGER'S OWN bounds → `measure_savings_capacity`. The bounds must be
the actual extent of the imported statements and never a requested window;
`capacity.complete_months` cannot tell the two apart and wider bounds silently
admit a partial month as complete.
"""

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.common import recurrence_points
from app.api.history import user_history
from app.db import get_db
from app.engines.capacity import (
    MeasuredRate,
    MonthlyEntry,
    MonthObservation,
    complete_months,
    measure_savings_capacity,
)
from app.engines.goal import GoalInput, evaluate_goals
from app.models import Goal, User
from app.schemas.cashflow import MeasuredRateOut
from app.schemas.goals import (
    GoalIn,
    GoalOut,
    GoalPatch,
    GoalProgressOut,
    GoalReportOut,
    MilestoneOut,
)
from app.security.deps import get_current_user

router = APIRouter(prefix="/goals", tags=["goals"])


def _owned(db: Session, user: User, goal_id: int) -> Goal:
    goal = db.query(Goal).filter(Goal.id == goal_id, Goal.user_id == user.id).first()
    if goal is None:
        raise HTTPException(status_code=404, detail="Objectif introuvable")
    return goal


def observed_months(db: Session, user_id: int) -> list[MonthObservation]:
    """Complete months of this user's own ledger, over the ledger's own bounds.

    Shared with `api/feasibility.py`, which needs exactly the same measurement
    -- one definition rather than two that drift.
    """
    history = user_history(db, user_id)
    if history is None:
        return []
    points = recurrence_points(db, user_id)
    return complete_months(
        [MonthlyEntry(on=point.on, amount_cents=point.amount_cents) for point in points],
        history.date_from,
        history.date_to,
    )


def rate_out(rate: MeasuredRate | None) -> MeasuredRateOut | None:
    if rate is None:
        return None
    return MeasuredRateOut(months=rate.months, median_cents=rate.median_cents,
                           spread_cents=rate.spread_cents, low_cents=rate.low_cents,
                           high_cents=rate.high_cents)


@router.get("", response_model=GoalReportOut)
def list_goals(user: User = Depends(get_current_user),
               db: Session = Depends(get_db)) -> GoalReportOut:
    rows = (
        db.query(Goal)
        .filter(Goal.user_id == user.id, Goal.archived.is_(False))
        .order_by(Goal.priority, Goal.id)
        .all()
    )
    months = observed_months(db, user.id)
    capacity = measure_savings_capacity(months)
    progress = evaluate_goals(
        [GoalInput(id=row.id, name=row.name, target_cents=row.target_cents,
                   saved_cents=row.saved_cents, due_on=row.due_on, priority=row.priority)
         for row in rows],
        # The sign is kept. A negative median is the operator's own state and
        # the engine has a distinct refusal for it; clamping to 0 here would
        # route him to the wrong one.
        None if capacity is None else capacity.median_cents,
        date.today(),
    )
    return GoalReportOut(
        goals=[
            GoalProgressOut(
                goal_id=item.goal_id, name=item.name, target_cents=item.target_cents,
                saved_cents=item.saved_cents, remaining_cents=item.remaining_cents,
                progress_ratio=item.progress_ratio,
                milestones=[
                    MilestoneOut(percent=m.percent, threshold_cents=m.threshold_cents,
                                 reached=m.reached, months_away=m.months_away,
                                 projected_on=m.projected_on)
                    for m in item.milestones
                ],
                funding_starts_in_months=item.funding_starts_in_months,
                months_to_completion=item.months_to_completion,
                projected_completion_on=item.projected_completion_on,
                projection_unavailable_reason=item.projection_unavailable_reason,
                due_on=item.due_on, months_until_due=item.months_until_due,
                on_track=item.on_track,
            )
            for item in progress
        ],
        capacity=rate_out(capacity),
        months_observed=len(months),
        history=user_history(db, user.id),
    )


@router.post("", response_model=GoalOut, status_code=status.HTTP_201_CREATED)
def create_goal(payload: GoalIn, user: User = Depends(get_current_user),
                db: Session = Depends(get_db)) -> Goal:
    goal = Goal(user_id=user.id, **payload.model_dump())
    db.add(goal)
    db.commit()
    db.refresh(goal)
    return goal


@router.patch("/{goal_id}", response_model=GoalOut)
def patch_goal(goal_id: int, payload: GoalPatch, user: User = Depends(get_current_user),
               db: Session = Depends(get_db)) -> Goal:
    goal = _owned(db, user, goal_id)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(goal, field, value)
    db.commit()
    db.refresh(goal)
    return goal


@router.delete("/{goal_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_goal(goal_id: int, user: User = Depends(get_current_user),
                db: Session = Depends(get_db)) -> None:
    """Archiving, not deleting: a goal that was reached is worth keeping."""
    goal = _owned(db, user, goal_id)
    goal.archived = True
    db.commit()
