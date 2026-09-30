import re
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.api.common import budget_owner, rolled_budget_spend, tx_points
from app.api.history import user_history
from app.db import get_db
from app.engines.aggregate import aggregate_by_category
from app.engines.budget import BudgetEntry, days_in_month, elapsed_days, evaluate_budgets
from app.engines.category_history import (
    CategoryNode,
    MonthSpend,
    average_ticket,
    monthly_average,
    monthly_series,
    spend,
    subtree_ids,
    yearly,
)
from app.models import Category, User
from app.schemas.budgets import (
    BudgetDetailOut,
    BudgetHistoryLineOut,
    BudgetHistoryOut,
    BudgetHistoryPointOut,
    BudgetLineOut,
    BudgetReadingOut,
    BudgetReportOut,
    CategoryRefOut,
    DetailCategoryOut,
    DetailMonthOut,
    DetailPartOut,
    DetailYearOut,
    UnbudgetedOut,
)
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
        # `_MONTH_KEY` accepts any four digits, including "0000": without this
        # guard, date(0, 5, 1) reaches datetime's constructor and raises
        # "year 0 is out of range" (MINYEAR is 1) as an unhandled, untranslated
        # 500 -- no handler in this app catches a bare ValueError. date.max.year
        # (9999) is the other end, for the same reason.
        if not 1 <= year <= 9999 or not 1 <= month <= 12:
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
    budgeted_ids = {category.id for category in budgeted}
    counted_by = budget_owner(categories, budgeted_ids)
    rolled = rolled_budget_spend(spent_by_category, categories, budgeted_ids)

    entries = [
        BudgetEntry(
            category_id=category.id,
            budget_cents=category.monthly_budget_cents,
            spent_cents=rolled[category.id],
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
        # budget on, so offering one here would lead nowhere. And a child
        # already folded into its parent's line HAS been budgeted, through that
        # parent -- listing it again under "hors budget" would say the opposite.
        if category_id is not None and counted_by.get(category_id) is None
        and category_id in known
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
        budgeted_spent_cents=sum(line.spent_cents for line in lines),
        history=history,
    )


def _previous_months(month_start: date, count: int) -> list[date]:
    """`count` first-of-month dates ending on `month_start`, oldest first."""
    months: list[date] = []
    year, month = month_start.year, month_start.month
    for _ in range(count):
        months.append(date(year, month, 1))
        month -= 1
        if month == 0:
            month, year = 12, year - 1
    months.reverse()
    return months


@router.get("/history", response_model=BudgetHistoryOut)
def budget_history(
    month: str | None = None,
    months: int = Query(default=6, ge=1, le=24),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> BudgetHistoryOut:
    """Each budgeted line's spend over the last `months` months, ending on
    `month` (resolved like the report's). Same rollup as the report --
    `rolled_budget_spend`, children folded into the parent that carries the
    budget -- so the sparkline under a line is the same figure the line
    prints for the month on screen."""
    today = date.today()
    history = user_history(db, user.id)
    month_start = resolve_month(month, history, today)
    window = _previous_months(month_start, months)

    categories = (
        db.query(Category)
        .filter(Category.user_id == user.id)
        .order_by(Category.position, Category.name)
        .all()
    )
    budgeted = [c for c in categories if c.monthly_budget_cents and c.monthly_budget_cents > 0]
    budgeted_ids = {category.id for category in budgeted}

    per_month: dict[str, dict[int, int]] = {}
    for start in window:
        end = date(start.year, start.month, days_in_month(start))
        points = tx_points(db, user.id, start, end)
        spent = {t.category_id: t.total_cents for t in aggregate_by_category(points)}
        per_month[f"{start.year}-{start.month:02d}"] = rolled_budget_spend(
            spent, categories, budgeted_ids
        )

    keys = list(per_month)
    return BudgetHistoryOut(
        months=keys,
        lines=[
            BudgetHistoryLineOut(
                category_id=category.id,
                name=category.name,
                color=category.color,
                budget_cents=category.monthly_budget_cents or 0,
                points=[
                    BudgetHistoryPointOut(month=key, spent_cents=per_month[key][category.id])
                    for key in keys
                ],
            )
            for category in budgeted
        ],
    )


@router.get("/{category_id}/detail", response_model=BudgetDetailOut)
def budget_detail(
    category_id: int,
    month: str | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> BudgetDetailOut:
    """The universe page of one category: the month, the mean over the
    ledger's complete months, year by year and month by month, and the same
    figures for each child -- and for each sibling, on a child's page, so the
    scene can show the rest of the family around it.

    The month's spend and every ceiling are read exactly as `/budgets` reads
    them (`tx_points`, `rolled_budget_spend`): the page and the Budgets screen
    can never disagree about one month."""
    today = date.today()
    categories = (
        db.query(Category)
        .filter(Category.user_id == user.id)
        .order_by(Category.position, Category.name)
        .all()
    )
    by_id = {category.id: category for category in categories}
    category = by_id.get(category_id)
    if category is None:
        raise HTTPException(status_code=404, detail="Catégorie introuvable")

    history = user_history(db, user.id)
    month_start = resolve_month(month, history, today)
    total_days = days_in_month(month_start)
    month_end = date(month_start.year, month_start.month, total_days)
    month_points = tx_points(db, user.id, month_start, month_end)
    ledger_points = (
        tx_points(db, user.id, history.date_from, history.date_to) if history else []
    )

    nodes = [CategoryNode(id=c.id, parent_id=c.parent_id) for c in categories]
    budgeted_ids = {
        c.id for c in categories if c.monthly_budget_cents and c.monthly_budget_cents > 0
    }
    spent_by_category = {
        total.category_id: total.total_cents for total in aggregate_by_category(month_points)
    }
    rolled = rolled_budget_spend(spent_by_category, categories, budgeted_ids)

    def reading(node: Category) -> BudgetReadingOut | None:
        if node.id not in budgeted_ids:
            return None
        line = evaluate_budgets(
            [BudgetEntry(category_id=node.id, budget_cents=node.monthly_budget_cents,
                         spent_cents=rolled[node.id])],
            month_start, today,
        )[0]
        return BudgetReadingOut(
            budget_cents=line.budget_cents, spent_cents=line.spent_cents,
            remaining_cents=line.remaining_cents, consumed_ratio=line.consumed_ratio,
            projected_cents=line.projected_cents, status=line.status,
        )

    def series_of(ids: frozenset[int]) -> list[MonthSpend]:
        if history is None:
            return []
        return monthly_series(ledger_points, ids, history.date_from, history.date_to)

    def part(node: Category) -> DetailPartOut:
        ids = subtree_ids(nodes, node.id)
        spent, count = spend(month_points, ids)
        average = monthly_average(series_of(ids))
        return DetailPartOut(
            category_id=node.id, name=node.name, slug=node.slug, color=node.color,
            spent_cents=spent, count=count, average_ticket_cents=average_ticket(spent, count),
            average_cents=average.average_cents, months_counted=average.months_counted,
            budget=reading(node),
        )

    def children_of(parent_id: int) -> list[Category]:
        return [c for c in categories if c.parent_id == parent_id]

    ids = subtree_ids(nodes, category.id)
    spent, count = spend(month_points, ids)
    series = series_of(ids)
    average = monthly_average(series)
    parent = by_id.get(category.parent_id) if category.parent_id is not None else None

    return BudgetDetailOut(
        category=DetailCategoryOut(
            id=category.id, name=category.name, slug=category.slug, color=category.color,
            is_essential=category.is_essential,
            parent=(CategoryRefOut(id=parent.id, name=parent.name, slug=parent.slug)
                    if parent else None),
        ),
        month=f"{month_start.year}-{month_start.month:02d}",
        month_start=month_start,
        month_end=month_end,
        days_elapsed=elapsed_days(month_start, today),
        days_in_month=total_days,
        is_current_month=(month_start.year, month_start.month) == (today.year, today.month),
        spent_cents=spent,
        count=count,
        average_ticket_cents=average_ticket(spent, count),
        budget=reading(category),
        average_cents=average.average_cents,
        months_counted=average.months_counted,
        years=[
            DetailYearOut(year=y.year, spent_cents=y.spent_cents,
                          months_counted=y.months_counted,
                          monthly_average_cents=y.monthly_average_cents)
            for y in yearly(series)
        ],
        series=[
            DetailMonthOut(month=m.key, spent_cents=m.spent_cents, count=m.count,
                           complete=m.complete)
            for m in series
        ],
        parts=[part(child) for child in children_of(category.id)],
        siblings=[part(sibling) for sibling in children_of(parent.id)] if parent else [],
        history=history,
    )
