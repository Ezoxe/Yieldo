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
    total_spent_cents: int
    # The whole ledger's span, so an empty month can tell "you have no data" from
    # "you are looking at the wrong month" -- the same contract as SummaryOut.
    history: HistoryOut | None
