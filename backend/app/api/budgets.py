import re
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.common import tx_points
from app.api.history import user_history
from app.db import get_db
from app.engines.aggregate import aggregate_by_category
from app.engines.budget import BudgetEntry, days_in_month, elapsed_days, evaluate_budgets
from app.models import Category, User
from app.schemas.budgets import BudgetLineOut, BudgetReportOut, UnbudgetedOut
from app.schemas.history import HistoryOut
from app.security.deps import get_current_user

router = APIRouter(prefix="/budgets", tags=["budgets"])

_MONTH_KEY = re.compile(r"^(\d{4})-(\d{2})$")


def resolve_month(value: str | None, history: HistoryOut | None, today: date) -> date:
    """The first day of the month this request is about.

    An absent `month` resolves to the month of the user's *latest transaction*,
    not to today's. The operator's statements stop months before today, and
    defaulting to the current month would open this screen on a permanently
    empty one -- the same class of defect as the "Tout" range bug in phase 1.5.
    A user with no data at all falls back to today's month, which is honest and
    empty rather than absent.
    """
    if value is not None:
        match = _MONTH_KEY.match(value)
        if match is None:
            raise HTTPException(status_code=422, detail="Mois invalide : format attendu AAAA-MM")
        year, month = int(match.group(1)), int(match.group(2))
        if not 1 <= month <= 12:
            raise HTTPException(status_code=422, detail="Mois invalide : format attendu AAAA-MM")
        return date(year, month, 1)
    if history is not None:
        return history.date_to.replace(day=1)
    return today.replace(day=1)


@router.get("", response_model=BudgetReportOut)
def budget_report(
    month: str | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> BudgetReportOut:
    today = date.today()
    history = user_history(db, user.id)
    month_start = resolve_month(month, history, today)
    total_days = days_in_month(month_start)
    month_end = date(month_start.year, month_start.month, total_days)

    points = tx_points(db, user.id, month_start, month_end)
    spent_by_category = {
        total.category_id: total.total_cents for total in aggregate_by_category(points)
    }

    categories = (
        db.query(Category)
        .filter(Category.user_id == user.id)
        .order_by(Category.position, Category.name)
        .all()
    )

    budgeted = [c for c in categories if c.monthly_budget_cents and c.monthly_budget_cents > 0]
    entries = [
        BudgetEntry(
            category_id=category.id,
            budget_cents=category.monthly_budget_cents,
            spent_cents=spent_by_category.get(category.id, 0),
        )
        for category in budgeted
    ]
    evaluated = evaluate_budgets(entries, month_start, today)
    by_id = {category.id: category for category in budgeted}
    lines = [
        BudgetLineOut(
            category_id=line.category_id,
            name=by_id[line.category_id].name,
            color=by_id[line.category_id].color,
            is_essential=by_id[line.category_id].is_essential,
            budget_cents=line.budget_cents,
            spent_cents=line.spent_cents,
            remaining_cents=line.remaining_cents,
            consumed_ratio=line.consumed_ratio,
            projected_cents=line.projected_cents,
            status=line.status,
        )
        for line in evaluated
    ]
    # Worst first: the reader opens this screen to find out what went wrong.
    lines.sort(key=lambda line: line.consumed_ratio, reverse=True)

    budgeted_ids = set(by_id)
    known = {category.id: category for category in categories}
    unbudgeted = [
        UnbudgetedOut(
            category_id=category_id,
            name=known[category_id].name,
            color=known[category_id].color,
            spent_cents=total_cents,
        )
        for category_id, total_cents in spent_by_category.items()
        # `None` is the uncategorized bucket: there is no category to hang a
        # budget on, so offering one here would lead nowhere.
        if category_id is not None and category_id not in budgeted_ids and category_id in known
    ]
    unbudgeted.sort(key=lambda entry: entry.spent_cents)

    return BudgetReportOut(
        month=f"{month_start.year}-{month_start.month:02d}",
        month_start=month_start,
        month_end=month_end,
        days_elapsed=elapsed_days(month_start, today),
        days_in_month=total_days,
        is_current_month=(month_start.year, month_start.month) == (today.year, today.month),
        lines=lines,
        unbudgeted=unbudgeted,
        total_budget_cents=sum(line.budget_cents for line in lines),
        total_spent_cents=sum(total for total in spent_by_category.values()),
        history=history,
    )
