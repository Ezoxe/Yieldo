from datetime import date

from pydantic import BaseModel

from app.engines.budget import BudgetStatus
from app.schemas.history import HistoryOut


class BudgetLineOut(BaseModel):
    category_id: int
    name: str
    color: str
    is_essential: bool
    # A ceiling, positive.
    budget_cents: int
    # An outflow, negative -- the same convention as every other amount in the
    # API. The screen takes the magnitude for display.
    spent_cents: int
    # Positive while under the ceiling, negative once past it.
    remaining_cents: int
    consumed_ratio: float
    # null whenever a projection would be dishonest (too early in the month, or
    # the month is over). Never a zero standing in for "we did not compute it".
    projected_cents: int | None
    status: BudgetStatus


class UnbudgetedOut(BaseModel):
    category_id: int
    name: str
    color: str
    spent_cents: int


class BudgetReportOut(BaseModel):
    # "AAAA-MM", the same key shape aggregate.bucket_key emits for a month.
    month: str
    month_start: date
    month_end: date
    days_elapsed: int
    days_in_month: int
    is_current_month: bool
    lines: list[BudgetLineOut]
    unbudgeted: list[UnbudgetedOut]
    total_budget_cents: int
    # The WHOLE month's spend, budgeted or not: what the donut shows.
    total_spent_cents: int
    # The spend on the budgeted lines alone -- the same perimeter as
    # `total_budget_cents`, so the two can be printed side by side and compared.
    # The audit of 2026-09-06 found the first pair compared two different
    # things under one name.
    budgeted_spent_cents: int
    # The whole ledger's span, so an empty month can tell "you have no data" from
    # "you are looking at the wrong month" -- the same contract as SummaryOut.
    history: HistoryOut | None


# --- GET /budgets/history: each budgeted line, month by month ------------------


class BudgetHistoryPointOut(BaseModel):
    month: str
    spent_cents: int


class BudgetHistoryLineOut(BaseModel):
    category_id: int
    name: str
    color: str
    # The ceiling as it stands today. Budgets carry no history of their own,
    # so a line changed last month is drawn against today's ceiling for every
    # month -- said here rather than pretended otherwise.
    budget_cents: int
    points: list[BudgetHistoryPointOut]


class BudgetHistoryOut(BaseModel):
    months: list[str]
    lines: list[BudgetHistoryLineOut]


# --- GET /budgets/{category_id}/detail: the universe page of one category -----


class BudgetReadingOut(BaseModel):
    budget_cents: int
    # What the Budgets screen counts against this ceiling: the category and
    # the descendants that carry no budget of their own (`rolled_budget_spend`).
    spent_cents: int
    remaining_cents: int
    consumed_ratio: float
    projected_cents: int | None
    status: BudgetStatus


class CategoryRefOut(BaseModel):
    id: int
    name: str
    slug: str


class DetailCategoryOut(BaseModel):
    id: int
    name: str
    slug: str
    color: str
    is_essential: bool
    parent: CategoryRefOut | None


class DetailPartOut(BaseModel):
    category_id: int
    name: str
    slug: str
    color: str
    spent_cents: int
    count: int
    average_ticket_cents: int | None
    average_cents: int | None
    months_counted: int
    budget: BudgetReadingOut | None


class DetailMonthOut(BaseModel):
    month: str
    spent_cents: int
    count: int
    # The ledger covers the whole month; only complete months enter a mean.
    complete: bool


class DetailYearOut(BaseModel):
    year: int
    spent_cents: int
    months_counted: int
    monthly_average_cents: int | None


class BudgetDetailOut(BaseModel):
    category: DetailCategoryOut
    month: str
    month_start: date
    month_end: date
    days_elapsed: int
    days_in_month: int
    is_current_month: bool
    # The category and ALL its descendants: what the whole family cost.
    spent_cents: int
    count: int
    average_ticket_cents: int | None
    budget: BudgetReadingOut | None
    average_cents: int | None
    months_counted: int
    years: list[DetailYearOut]
    series: list[DetailMonthOut]
    parts: list[DetailPartOut]
    siblings: list[DetailPartOut]
    history: HistoryOut | None
