"""GET /api/engagement, and POST .../challenges/{id}/accept|reject.

Assembles design §6.2's four engagement mechanics from the requesting user's
own ledger: the follow-up streak (`engines/streak.py`), milestones across
every active goal (`engines/goal.py`, consumed exactly as phase 2B built it),
the financial-health score with its history (`engines/health.py` plus the
`health_snapshots` table), and data-derived challenges
(`engines/challenge.py` plus the `challenges` table).

**The clock.** `date.today()` is read once, here, for everything this module
computes -- streak, goals, health, snapshot dates, challenge decisions --
matching `api/goals.py` and `api/debts.py`'s own reasoning: nothing here
classifies a RECURRENCE by staleness the way `api/cashflow.py`'s forecast
route must. The one exception is `detect_recurrences` itself, called inside
`_propose_and_persist_challenges` for subscription proposals: it DOES
classify by staleness, so it is handed the ledger's own last transaction date
-- exactly `api/cashflow.py`'s forecast route's reasoning -- never the real
clock, which would mark every subscription "ended" on the operator's own
ledger (stopped January 2026) and silently propose nothing.

**A refusal from any engine here is a 200 carrying a French sentence, never a
422.** Reading one's own engagement state cannot itself be a malformed
request; `EngagementOut`'s `unavailable_reason` fields carry every refusal.
`422` is reserved for the one thing that IS a bad request on this router:
accepting or rejecting a challenge that has already left the `proposed`
state.
"""

import json
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.common import anomaly_points, liquid_balance_cents, recurrence_points, tx_points
from app.api.goals import observed_months
from app.api.history import user_history
from app.db import get_db
from app.engines.aggregate import aggregate_by_category, bucket_bounds, bucket_key
from app.engines.anomaly import detect_anomalies
from app.engines.budget import BudgetEntry, evaluate_budgets
from app.engines.capacity import (
    MonthlyEntry,
    MonthObservation,
    complete_months,
    measure_expense_rate,
    measure_income_rate,
    measure_savings_capacity,
)
from app.engines.challenge import (
    BudgetMonthOutcome,
    ChallengeContext,
    ChallengeProposal,
    MonthSpend,
    measure_outcome,
    propose_anomaly_challenges,
    propose_budget_overrun_challenges,
    propose_category_level_challenges,
    propose_subscription_challenges,
)
from app.engines.goal import GoalInput, GoalProgress, evaluate_goals
from app.engines.health import HealthComponent, HealthScore, compute_health_score
from app.engines.inflation import CategorySpend, Window, compute_inflation, previous_year_window
from app.engines.period import month_end
from app.engines.recurrence import detect_recurrences
from app.engines.runway import compute_runway
from app.engines.streak import ImportedTx, compute_streak
from app.models import Category, Challenge, Goal, HealthSnapshot, Transaction, User
from app.schemas.engagement import (
    ChallengeOut,
    EngagementOut,
    HealthComponentOut,
    HealthOut,
    HealthSnapshotOut,
    MonthCoveredOut,
    StreakOut,
)
from app.schemas.goals import GoalProgressOut, MilestoneOut
from app.schemas.history import HistoryOut
from app.security.deps import get_current_user

router = APIRouter(prefix="/engagement", tags=["engagement"])

CHALLENGE_STATE_ORDER = {"proposed": 0, "accepted": 1, "rejected": 2}


# ---------------------------------------------------------------------------
# Streak
# ---------------------------------------------------------------------------


def _streak_out(db: Session, user_id: int, today: date) -> StreakOut:
    rows = (
        db.query(Transaction.date, Transaction.import_batch_id)
        .filter(Transaction.user_id == user_id)
        .all()
    )
    report = compute_streak(
        [ImportedTx(on=on, batch_id=batch_id) for on, batch_id in rows], today
    )
    return StreakOut(
        current=report.current, longest=report.longest,
        last_complete_month=report.last_complete_month,
        months=[
            MonthCoveredOut(key=m.key, covered=m.covered,
                            transaction_count=m.transaction_count, imported=m.imported)
            for m in report.months
        ],
        broken_reason=report.broken_reason,
    )


# ---------------------------------------------------------------------------
# Goal milestones -- `Milestone` consumed exactly as phase 2B built it.
# ---------------------------------------------------------------------------


def _goal_progress_out(item: GoalProgress) -> GoalProgressOut:
    return GoalProgressOut(
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


def _goals_out(db: Session, user: User, today: date) -> list[GoalProgressOut]:
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
        None if capacity is None else capacity.median_cents,
        today,
    )
    return [_goal_progress_out(item) for item in progress]


# ---------------------------------------------------------------------------
# Budget outcomes -- shared by the health score's adherence component and
# challenge.py's budget-overrun proposals, so both read the identical figures.
# ---------------------------------------------------------------------------


def _essential_ids(db: Session, user_id: int) -> set[int]:
    return {
        row.id for row in db.query(Category.id)
        .filter(Category.user_id == user_id, Category.is_essential.is_(True)).all()
    }


def _budget_month_outcomes(
    db: Session, user_id: int, months: list[MonthObservation], today: date
) -> list[BudgetMonthOutcome]:
    """Every (budgeted category, complete PAST month) outcome. Never the live
    month -- see `health.py`'s own docstring for why an in-progress month's
    near-universal "ok" would say nothing. `months` is already restricted to
    complete, OBSERVED months over the ledger's own bounds (`observed_months`),
    so this only adds the "not the real current month" guard on top.
    """
    budgeted = (
        db.query(Category)
        .filter(Category.user_id == user_id, Category.monthly_budget_cents.isnot(None),
                Category.monthly_budget_cents > 0)
        .all()
    )
    if not budgeted:
        return []

    outcomes: list[BudgetMonthOutcome] = []
    for month in months:
        if (month.start.year, month.start.month) == (today.year, today.month):
            continue
        points = tx_points(db, user_id, month.start, month.end)
        spent_by_category = {
            total.category_id: total.total_cents for total in aggregate_by_category(points)
        }
        entries = [
            BudgetEntry(category_id=category.id, budget_cents=category.monthly_budget_cents,
                       spent_cents=spent_by_category.get(category.id, 0))
            for category in budgeted
        ]
        for line in evaluate_budgets(entries, month.start, today):
            outcomes.append(BudgetMonthOutcome(
                category_id=line.category_id, month_key=month.key,
                budget_cents=line.budget_cents, spent_cents=abs(line.spent_cents),
            ))
    return outcomes


# ---------------------------------------------------------------------------
# Health score -- one snapshot as `engines/health.py` measures it today.
# ---------------------------------------------------------------------------


def _health_score(
    db: Session, user: User, today: date
) -> tuple[HealthScore, list[BudgetMonthOutcome]]:
    """The four components, exactly as `health.py`'s own module docstring
    prescribes each caller-built input -- essential months filtered the same
    way `api/cashflow.py`'s runway route builds them, runway's `.normal` taken
    from `compute_runway` rather than re-derived, and one `evaluate_budgets`
    call per complete past month via `_budget_month_outcomes`."""
    months = observed_months(db, user.id)
    savings_capacity = measure_savings_capacity(months)
    income_rate = measure_income_rate(months)

    history = user_history(db, user.id)
    points = recurrence_points(db, user.id)
    essential_ids = _essential_ids(db, user.id)
    essential_points = [p for p in points if p.category_id in essential_ids]
    start, end = (
        (history.date_from, history.date_to) if history is not None else (today, today)
    )
    essential_months = complete_months(
        [MonthlyEntry(on=p.on, amount_cents=p.amount_cents) for p in essential_points],
        start, end,
    )
    essential_expense_rate = measure_expense_rate(essential_months)

    runway_report = compute_runway(
        balance_cents=liquid_balance_cents(db, user.id),
        all_months=months, essential_months=essential_months, today=today,
        essential_category_count=len(essential_ids),
    )

    budget_outcomes_rows = _budget_month_outcomes(db, user.id, months, today)

    score = compute_health_score(
        savings_capacity=savings_capacity, income_rate=income_rate,
        essential_expense_rate=essential_expense_rate,
        essential_category_count=len(essential_ids),
        essential_months_observed=len(essential_months),
        runway_normal_months=(
            None if runway_report.normal is None else runway_report.normal.months
        ),
        runway_unavailable_reason=runway_report.normal_unavailable_reason,
        budget_outcomes=[
            row.spent_cents / row.budget_cents for row in budget_outcomes_rows
        ],
    )
    return score, budget_outcomes_rows


def _serialize_components(components: list[HealthComponent]) -> str:
    return json.dumps([
        {"key": c.key, "label": c.label, "weight": c.weight, "score": c.score,
         "measured_value": c.measured_value, "unavailable_reason": c.unavailable_reason}
        for c in components
    ])


def _insert_snapshot_ignoring_conflict(
    db: Session, user_id: int, today: date, score: HealthScore
) -> None:
    """Always attempts the insert. The unique constraint on
    `(user_id, taken_on)` is the real guard against two rows landing for the
    same user on the same day -- a conflicting commit here, another request's
    write racing this one between `_write_snapshot_if_missing`'s own
    existence check and this call, is caught and dropped rather than
    crashing the request. Losing that race is harmless: at most one snapshot
    per day either way.
    """
    db.add(HealthSnapshot(user_id=user_id, taken_on=today, score=score.score,
                          components=_serialize_components(score.components)))
    try:
        db.commit()
    except IntegrityError:
        db.rollback()


def _write_snapshot_if_missing(
    db: Session, user_id: int, today: date, score: HealthScore
) -> None:
    """At most one row per user per day. Nothing is written on a day the
    score could not be measured -- see `models.HealthSnapshot`'s own
    docstring for why a nullable `score` column would be the identical "None
    as a fallback" failure this project already fixed once.
    """
    if score.score is None:
        return
    existing = db.query(HealthSnapshot).filter(
        HealthSnapshot.user_id == user_id, HealthSnapshot.taken_on == today
    ).first()
    if existing is not None:
        return
    _insert_snapshot_ignoring_conflict(db, user_id, today, score)


def _health_out(db: Session, user_id: int, today: date, score: HealthScore) -> HealthOut:
    _write_snapshot_if_missing(db, user_id, today, score)

    rows = (
        db.query(HealthSnapshot)
        .filter(HealthSnapshot.user_id == user_id)
        .order_by(HealthSnapshot.taken_on)
        .all()
    )
    # The most recent STORED row strictly before today -- never today's own
    # row, even when one already exists from an earlier read this same day,
    # and never a recomputation of today's inputs at another date. See the
    # module docstring: "ce qui l'a fait bouger" only exists because a real
    # past measurement was persisted.
    previous = next((row for row in reversed(rows) if row.taken_on < today), None)
    previous_components: dict[str, dict] = (
        {c["key"]: c for c in json.loads(previous.components)} if previous is not None else {}
    )

    components_out = []
    for component in score.components:
        prev = previous_components.get(component.key)
        delta = None
        if component.score is not None and prev is not None and prev.get("score") is not None:
            delta = component.score - prev["score"]
        components_out.append(HealthComponentOut(
            key=component.key, label=component.label, weight=component.weight,
            score=component.score, measured_value=component.measured_value,
            unavailable_reason=component.unavailable_reason, delta_score=delta,
        ))

    score_delta = (
        score.score - previous.score
        if score.score is not None and previous is not None else None
    )

    return HealthOut(
        score=score.score, components=components_out,
        unavailable_reason=score.unavailable_reason,
        previous_taken_on=None if previous is None else previous.taken_on,
        score_delta=score_delta,
        history=[HealthSnapshotOut(taken_on=row.taken_on, score=row.score) for row in rows],
    )


# ---------------------------------------------------------------------------
# Challenges -- propose from today's measurements, persist what is new,
# accept/reject, and measure the outcome of what was accepted.
# ---------------------------------------------------------------------------


def _twelve_month_window(history: HistoryOut, today: date) -> Window:
    """Mirrors `api.analysis._default_current_window` in miniature: the last
    twelve complete calendar months of the ledger, anchored on its own last
    transaction, so `compute_inflation`'s own overlap guard is never tripped
    by a ledger spanning more than a year. Duplicated rather than imported --
    the original is private to its own module -- see it for the full
    reasoning behind anchoring on the ledger rather than on `today`.
    """
    anchor = history.date_to.replace(day=1)
    total = anchor.year * 12 + (anchor.month - 1) - 11
    year, month = divmod(total, 12)
    start = date(year, month + 1, 1)
    end = bucket_bounds(bucket_key(anchor, "month"), "month")[1]
    return Window(start=start, end=end)


def _category_names(db: Session, user_id: int) -> dict[int, str]:
    return {c.id: c.name for c in db.query(Category).filter(Category.user_id == user_id).all()}


def _propose_and_persist_challenges(
    db: Session, user: User, today: date, budget_outcomes_rows: list[BudgetMonthOutcome]
) -> None:
    history = user_history(db, user.id)
    category_names = _category_names(db, user.id)

    proposals: list[ChallengeProposal] = []

    recurrence_clock = history.date_to if history is not None else today
    recurrences = detect_recurrences(recurrence_points(db, user.id), recurrence_clock).recurrences
    proposals += propose_subscription_challenges(recurrences)

    if history is not None:
        current = _twelve_month_window(history, today)
        previous = previous_year_window(current)
        points = [
            CategorySpend(on=p.on, amount_cents=p.amount_cents, category_id=p.category_id)
            for p in tx_points(db, user.id, previous.start, current.end)
            if not p.is_transfer
        ]
        inflation_report = compute_inflation(points, current, [])
        proposals += propose_category_level_challenges(inflation_report.lines, category_names)

        history_txs = anomaly_points(db, user.id)
        anomaly_report = detect_anomalies(history_txs, history.date_from, history.date_to)
        proposals += propose_anomaly_challenges(anomaly_report.anomalies, history_txs)

    proposals += propose_budget_overrun_challenges(budget_outcomes_rows, category_names)

    existing = {
        (row.kind, row.category_id, row.title)
        for row in db.query(Challenge).filter(Challenge.user_id == user.id).all()
    }
    added = False
    for proposal in proposals:
        key = (proposal.kind, proposal.category_id, proposal.title)
        if key in existing:
            continue
        db.add(Challenge(
            user_id=user.id, kind=proposal.kind, title=proposal.title, detail=proposal.detail,
            target_cents=proposal.target_cents, category_id=proposal.category_id,
            proposed_on=today, state="proposed",
        ))
        existing.add(key)
        added = True
    if added:
        db.commit()


def _month_bounds_around(decided_on: date, offset: int) -> tuple[date, date]:
    end = month_end(decided_on, offset)
    return bucket_bounds(bucket_key(end, "month"), "month")


def _category_month_spend(
    db: Session, user_id: int, category_id: int, start: date, end: date,
    history: HistoryOut | None,
) -> MonthSpend | None:
    """This category's total spend in the complete calendar month
    `[start, end]`, or `None` when that month is not (fully) covered by this
    user's own imported statements -- `capacity.complete_months`'s identical
    "observed" guard, applied to one category and one month rather than to
    the whole ledger.
    """
    if history is None or start < history.date_from or end > history.date_to:
        return None
    points = tx_points(db, user_id, start, end)
    total = sum(
        -p.amount_cents for p in points
        if p.category_id == category_id and not p.is_transfer and p.amount_cents < 0
    )
    return MonthSpend(key=bucket_key(start, "month"), spent_cents=total)


def _challenge_out(row: Challenge, outcome_unavailable_reason: str | None) -> ChallengeOut:
    return ChallengeOut(
        id=row.id, kind=row.kind, title=row.title, detail=row.detail,
        target_cents=row.target_cents, category_id=row.category_id,
        proposed_on=row.proposed_on, state=row.state, decided_on=row.decided_on,
        measured_cents=row.measured_cents, measured_on=row.measured_on,
        outcome_unavailable_reason=outcome_unavailable_reason,
    )


def _challenges_out(
    db: Session, user: User, today: date, budget_outcomes_rows: list[BudgetMonthOutcome]
) -> list[ChallengeOut]:
    _propose_and_persist_challenges(db, user, today, budget_outcomes_rows)
    history = user_history(db, user.id)

    rows = db.query(Challenge).filter(Challenge.user_id == user.id).all()
    rows.sort(key=lambda r: (CHALLENGE_STATE_ORDER.get(r.state, 3), -(r.target_cents or 0)))

    out: list[ChallengeOut] = []
    dirty = False
    for row in rows:
        outcome_reason = None
        if row.state == "accepted" and row.measured_cents is None:
            context = ChallengeContext(category_id=row.category_id, decided_on=row.decided_on)
            if row.category_id is None:
                before = after = None
            else:
                before = _category_month_spend(
                    db, user.id, row.category_id,
                    *_month_bounds_around(row.decided_on, -1), history,
                )
                after = _category_month_spend(
                    db, user.id, row.category_id,
                    *_month_bounds_around(row.decided_on, 1), history,
                )
            outcome = measure_outcome(context, before, after, today)
            if outcome.measured_cents is not None:
                row.measured_cents = outcome.measured_cents
                row.measured_on = outcome.measured_on
                dirty = True
            else:
                outcome_reason = outcome.unavailable_reason
        out.append(_challenge_out(row, outcome_reason))
    if dirty:
        db.commit()
    return out


def _owned_challenge(db: Session, user: User, challenge_id: int) -> Challenge:
    challenge = db.query(Challenge).filter(
        Challenge.id == challenge_id, Challenge.user_id == user.id
    ).first()
    if challenge is None:
        raise HTTPException(status_code=404, detail="Défi introuvable")
    return challenge


def _reason_already_decided(challenge: Challenge) -> str:
    verb = "accepté" if challenge.state == "accepted" else "rejeté"
    return f"Ce défi a déjà été {verb} : son état ne peut plus changer."


def _decide(db: Session, user: User, challenge_id: int, new_state: str) -> ChallengeOut:
    challenge = _owned_challenge(db, user, challenge_id)
    if challenge.state != "proposed":
        raise HTTPException(status_code=422, detail=_reason_already_decided(challenge))
    challenge.state = new_state
    challenge.decided_on = date.today()
    db.commit()
    db.refresh(challenge)
    return _challenge_out(challenge, outcome_unavailable_reason=None)


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.get("", response_model=EngagementOut)
def engagement(
    user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> EngagementOut:
    today = date.today()
    score, budget_outcomes_rows = _health_score(db, user, today)
    return EngagementOut(
        streak=_streak_out(db, user.id, today),
        goals=_goals_out(db, user, today),
        health=_health_out(db, user.id, today, score),
        challenges=_challenges_out(db, user, today, budget_outcomes_rows),
    )


@router.post("/challenges/{challenge_id}/accept", response_model=ChallengeOut)
def accept_challenge(
    challenge_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> ChallengeOut:
    return _decide(db, user, challenge_id, "accepted")


@router.post("/challenges/{challenge_id}/reject", response_model=ChallengeOut)
def reject_challenge(
    challenge_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> ChallengeOut:
    return _decide(db, user, challenge_id, "rejected")
