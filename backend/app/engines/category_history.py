"""What one category cost, month by month, over the household's whole ledger.

The universe page of a budget answers two questions the Budgets screen cannot:
what did this cost THIS month, and what does it cost in an ordinary month --
« en moyenne durant ces années ». The second is only honest over months the
ledger covers from the first day to the last:

* a month the statements only half cover (the first import started on the
  12th, or the month in progress) would pull the mean down with spending that
  is simply not in the file yet, so it is kept out of every mean;
* a covered month with nothing spent is a real zero and is counted: not
  buying fuel in August is part of what fuel costs a year;
* under three covered months there is no mean at all -- one or two months are
  an anecdote, not a habit.

An outflow is negative, and so is every total and mean built from outflows.
Means are integer cents rounded half away from zero; money never passes
through a float here.

Pure: no session, no clock. The ledger's span is a parameter.
"""

import calendar
from dataclasses import dataclass
from datetime import date

from app.engines.aggregate import TxPoint

MIN_MONTHS_FOR_AVERAGE = 3


@dataclass(frozen=True)
class CategoryNode:
    id: int
    parent_id: int | None


@dataclass(frozen=True)
class MonthSpend:
    key: str
    spent_cents: int
    count: int
    complete: bool


@dataclass(frozen=True)
class Average:
    average_cents: int | None
    months_counted: int


@dataclass(frozen=True)
class YearSpend:
    year: int
    spent_cents: int
    months_counted: int
    monthly_average_cents: int | None


def subtree_ids(nodes: list[CategoryNode], root_id: int) -> frozenset[int]:
    """The category and every descendant. A cycle in the tree ends the walk
    instead of hanging it, like `api.common.budget_owner`."""
    children: dict[int, list[int]] = {}
    for node in nodes:
        if node.parent_id is not None:
            children.setdefault(node.parent_id, []).append(node.id)
    seen: set[int] = set()
    stack = [root_id]
    while stack:
        current = stack.pop()
        if current in seen:
            continue
        seen.add(current)
        stack.extend(children.get(current, ()))
    return frozenset(seen)


def _month_key(on: date) -> str:
    return f"{on.year}-{on.month:02d}"


def _month_keys(first: date, last: date) -> list[str]:
    keys: list[str] = []
    year, month = first.year, first.month
    while (year, month) <= (last.year, last.month):
        keys.append(f"{year}-{month:02d}")
        month += 1
        if month == 13:
            year, month = year + 1, 1
    return keys


def is_complete(key: str, covered_from: date, covered_to: date) -> bool:
    """Whether the ledger covers the month `key` from its first day to its last."""
    year, month = (int(part) for part in key.split("-"))
    first = date(year, month, 1)
    last = date(year, month, calendar.monthrange(year, month)[1])
    return covered_from <= first and last <= covered_to


def _outflows(points: list[TxPoint], ids: frozenset[int]) -> list[TxPoint]:
    # The Budgets screen's own reading (`aggregate_by_category`): outflows
    # only, internal transfers excluded.
    return [p for p in points
            if not p.is_transfer and p.amount_cents < 0 and p.category_id in ids]


def spend(points: list[TxPoint], ids: frozenset[int]) -> tuple[int, int]:
    """What the subtree `ids` spent over `points`, and in how many operations."""
    rows = _outflows(points, ids)
    return sum(p.amount_cents for p in rows), len(rows)


def monthly_series(
    points: list[TxPoint], ids: frozenset[int], covered_from: date, covered_to: date
) -> list[MonthSpend]:
    """One entry per month of the ledger's span, oldest first, empty months included."""
    totals: dict[str, tuple[int, int]] = {}
    for point in _outflows(points, ids):
        key = _month_key(point.on)
        cents, count = totals.get(key, (0, 0))
        totals[key] = (cents + point.amount_cents, count + 1)
    series: list[MonthSpend] = []
    for key in _month_keys(covered_from, covered_to):
        cents, count = totals.get(key, (0, 0))
        series.append(MonthSpend(key=key, spent_cents=cents, count=count,
                                 complete=is_complete(key, covered_from, covered_to)))
    return series


def mean_cents(total_cents: int, count: int) -> int:
    """`total_cents / count` in integer cents, rounded half away from zero."""
    if count <= 0:
        raise ValueError("Une moyenne demande au moins une valeur")
    magnitude = (abs(total_cents) * 2 + count) // (2 * count)
    return -magnitude if total_cents < 0 else magnitude


def average_ticket(total_cents: int, count: int) -> int | None:
    """What one operation cost on average; None when there was none."""
    return mean_cents(total_cents, count) if count > 0 else None


def monthly_average(months: list[MonthSpend]) -> Average:
    """The mean over the complete months, or None under `MIN_MONTHS_FOR_AVERAGE`."""
    complete = [m for m in months if m.complete]
    if len(complete) < MIN_MONTHS_FOR_AVERAGE:
        return Average(average_cents=None, months_counted=len(complete))
    total = sum(m.spent_cents for m in complete)
    return Average(average_cents=mean_cents(total, len(complete)), months_counted=len(complete))


def yearly(months: list[MonthSpend]) -> list[YearSpend]:
    """Each calendar year over its complete months, oldest first."""
    by_year: dict[int, list[MonthSpend]] = {}
    for month in months:
        if month.complete:
            by_year.setdefault(int(month.key[:4]), []).append(month)
    years: list[YearSpend] = []
    for year in sorted(by_year):
        rows = by_year[year]
        total = sum(m.spent_cents for m in rows)
        years.append(YearSpend(
            year=year, spent_cents=total, months_counted=len(rows),
            monthly_average_cents=(mean_cents(total, len(rows))
                                   if len(rows) >= MIN_MONTHS_FOR_AVERAGE else None),
        ))
    return years
