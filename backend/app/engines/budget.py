"""Consumption of a declared monthly budget, and whether the month is on pace.

A budget is the one figure in this phase that is *declared* rather than
measured, so there is no statistics module here and no minimum sample: the user
said 300 EUR, and the only question is how much of it is gone.

Sign convention, unchanged from the rest of the codebase: an outflow is
negative, zero is no spend yet, and a positive `spent_cents` is refused
rather than coerced (see `_evaluate_budget`) -- a category netting positive
is income, not a spend, and turning it into one by `abs()` would be exactly
the misleading-but-true number CLAUDE.md rules out. `budget_cents` and
`remaining_cents` are the two exceptions to the negative-outflow convention
and are positive, because a ceiling is not a flow -- `remaining_cents`
reaches zero once the ceiling is reached and goes negative once it is
exceeded; reaching zero already counts as the ceiling being breached
(`status` becomes `"over"` at that same instant), which is the safer
reading.

Pure: no session, no network, no implicit clock -- `today` is a parameter.
"""

import calendar
from dataclasses import dataclass
from datetime import date
from typing import Literal

BudgetStatus = Literal["ok", "at_risk", "over"]

# A pace projection needs enough of the month behind it to mean anything: two
# days into January, one large grocery run projects to a fifteen-fold overrun
# and would raise an alert about nothing. A fifth of the month is the floor --
# seven days in a 31-day month.
PACE_MIN_ELAPSED_DENOMINATOR = 5


@dataclass(frozen=True)
class BudgetEntry:
    category_id: int
    # The ceiling the user set, positive.
    budget_cents: int
    # What went out of this category this month: negative for an outflow,
    # zero for no spend yet. Positive (net income, e.g. a refund exceeding
    # this month's spend) is rejected by `evaluate_budgets` rather than
    # silently coerced.
    spent_cents: int


@dataclass(frozen=True)
class BudgetLine:
    category_id: int
    budget_cents: int
    spent_cents: int
    # Positive while under the ceiling; zero once the ceiling is reached,
    # negative once it is exceeded. Zero already counts as breached (see
    # `status`), the safer reading of a budget.
    remaining_cents: int
    # A ratio, not money: 0.83 means 83 % of the budget is gone. Can exceed 1.
    consumed_ratio: float
    # Where the month lands at the current pace, negative like `spent_cents`.
    # None whenever a projection would be dishonest: too early in the month, or
    # the month is finished (it *is* its own result) or has not started.
    projected_cents: int | None
    status: BudgetStatus


def days_in_month(month_start: date) -> int:
    return calendar.monthrange(month_start.year, month_start.month)[1]


def elapsed_days(month_start: date, today: date) -> int:
    """How much of `month_start`'s month has been lived, counting today.

    Clamped at both ends: a month in the past is fully elapsed, a month in the
    future has nothing elapsed. Without the clamp, a January budget viewed in
    August would report 224 days elapsed and project a thirtieth of the truth.
    """
    total = days_in_month(month_start)
    if today < month_start:
        return 0
    return min((today - month_start).days + 1, total)


def _evaluate_budget(entry: BudgetEntry, elapsed: int, total_days: int) -> BudgetLine:
    """Internal: shared by `evaluate_budgets`, which computes `elapsed` and
    `total_days` once and passes them to every entry. Not part of the public
    API -- use `evaluate_budgets`."""
    if entry.budget_cents <= 0:
        raise ValueError("Un budget mensuel doit être strictement positif")
    if entry.spent_cents > 0:
        # A category netting positive is income (refunds exceeding this
        # month's spend), not a spend. Coercing it through abs() would
        # silently turn that income into a "spent" figure and feed a false
        # number into remaining/consumed/projected/status -- refuse it
        # instead of guessing. Zero (no spend yet) is the ordinary case and
        # is not rejected here.
        raise ValueError(
            "Le montant dépensé d'une catégorie ne peut pas être positif : "
            "un remboursement net doit être comptabilisé comme un revenu, "
            "pas comme une dépense"
        )

    spent = -entry.spent_cents
    remaining = entry.budget_cents - spent
    consumed = spent / entry.budget_cents

    projected: int | None = None
    if 0 < elapsed < total_days and elapsed * PACE_MIN_ELAPSED_DENOMINATOR >= total_days:
        # Integer arithmetic end to end -- the projection is an amount in cents
        # and never passes through a float.
        projected = -(spent * total_days // elapsed)

    if spent >= entry.budget_cents:
        status: BudgetStatus = "over"
    elif projected is not None and abs(projected) > entry.budget_cents:
        status = "at_risk"
    else:
        status = "ok"

    return BudgetLine(
        category_id=entry.category_id,
        budget_cents=entry.budget_cents,
        spent_cents=entry.spent_cents,
        remaining_cents=remaining,
        consumed_ratio=consumed,
        projected_cents=projected,
        status=status,
    )


def evaluate_budgets(
    entries: list[BudgetEntry], month_start: date, today: date
) -> list[BudgetLine]:
    """Every budget line for one month, in the order it was given."""
    total_days = days_in_month(month_start)
    elapsed = elapsed_days(month_start, today)
    return [_evaluate_budget(entry, elapsed, total_days) for entry in entries]
