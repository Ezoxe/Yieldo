import calendar
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Literal

Granularity = Literal["day", "week", "month", "quarter", "year"]


@dataclass(frozen=True)
class TxPoint:
    """The minimal shape the aggregation engine needs. Deliberately not an ORM object."""

    on: date
    amount_cents: int
    category_id: int | None
    account_id: int
    is_transfer: bool = False


@dataclass(frozen=True)
class BucketTotals:
    key: str
    start: date
    end: date
    inflow_cents: int
    outflow_cents: int
    net_cents: int
    count: int


@dataclass(frozen=True)
class CategoryTotal:
    category_id: int | None
    total_cents: int
    count: int
    share: float


@dataclass(frozen=True)
class PeriodComparison:
    delta_cents: int
    delta_ratio: float | None


def bucket_key(on: date, granularity: Granularity) -> str:
    if granularity == "day":
        return on.isoformat()
    if granularity == "week":
        iso_year, iso_week, _ = on.isocalendar()
        return f"{iso_year}-W{iso_week:02d}"
    if granularity == "month":
        return f"{on.year}-{on.month:02d}"
    if granularity == "quarter":
        return f"{on.year}-Q{(on.month - 1) // 3 + 1}"
    if granularity == "year":
        return str(on.year)
    raise ValueError(f"Granularité inconnue : {granularity}")


def bucket_bounds(key: str, granularity: Granularity) -> tuple[date, date]:
    if granularity == "day":
        day = date.fromisoformat(key)
        return day, day
    if granularity == "week":
        year, week = key.split("-W")
        monday = date.fromisocalendar(int(year), int(week), 1)
        return monday, monday + timedelta(days=6)
    if granularity == "month":
        year, month = (int(part) for part in key.split("-"))
        return date(year, month, 1), date(year, month, calendar.monthrange(year, month)[1])
    if granularity == "quarter":
        year, quarter = key.split("-Q")
        first_month = (int(quarter) - 1) * 3 + 1
        last_month = first_month + 2
        return (
            date(int(year), first_month, 1),
            date(int(year), last_month, calendar.monthrange(int(year), last_month)[1]),
        )
    if granularity == "year":
        return date(int(key), 1, 1), date(int(key), 12, 31)
    raise ValueError(f"Granularité inconnue : {granularity}")


def _next_bucket_start(current: date, granularity: Granularity) -> date:
    if granularity == "day":
        return current + timedelta(days=1)
    if granularity == "week":
        return current + timedelta(days=7)
    if granularity == "month":
        return date(current.year + (current.month == 12), current.month % 12 + 1, 1)
    if granularity == "quarter":
        month = current.month + 3
        return date(current.year + (month > 12), (month - 1) % 12 + 1, 1)
    if granularity == "year":
        return date(current.year + 1, 1, 1)
    raise ValueError(f"Granularité inconnue : {granularity}")


def aggregate_series(
    points: list[TxPoint], granularity: Granularity, include_transfers: bool = False
) -> list[BucketTotals]:
    """Group transactions into time buckets.

    Internal transfers are excluded unless asked for: moving money to a savings
    account is not spending, and counting it would double-book the same euro.
    """
    accumulator: dict[str, dict[str, int]] = {}
    for point in points:
        if point.is_transfer and not include_transfers:
            continue
        key = bucket_key(point.on, granularity)
        bucket = accumulator.setdefault(key, {"inflow": 0, "outflow": 0, "count": 0})
        if point.amount_cents >= 0:
            bucket["inflow"] += point.amount_cents
        else:
            bucket["outflow"] += point.amount_cents
        bucket["count"] += 1

    result: list[BucketTotals] = []
    for key in sorted(accumulator):
        start, end = bucket_bounds(key, granularity)
        bucket = accumulator[key]
        result.append(BucketTotals(
            key=key, start=start, end=end,
            inflow_cents=bucket["inflow"], outflow_cents=bucket["outflow"],
            net_cents=bucket["inflow"] + bucket["outflow"], count=bucket["count"],
        ))
    return result


def fill_missing_buckets(
    series: list[BucketTotals], granularity: Granularity, start: date, end: date
) -> list[BucketTotals]:
    """Insert zero buckets so a chart shows a flat month rather than skipping it."""
    by_key = {bucket.key: bucket for bucket in series}
    filled: list[BucketTotals] = []
    cursor = bucket_bounds(bucket_key(start, granularity), granularity)[0]
    while cursor <= end:
        key = bucket_key(cursor, granularity)
        bucket_start, bucket_end = bucket_bounds(key, granularity)
        filled.append(by_key.get(key, BucketTotals(
            key=key, start=bucket_start, end=bucket_end,
            inflow_cents=0, outflow_cents=0, net_cents=0, count=0,
        )))
        cursor = _next_bucket_start(cursor, granularity)
    return filled


def aggregate_by_category(
    points: list[TxPoint], include_transfers: bool = False
) -> list[CategoryTotal]:
    """Expense totals per category, with each category's share of total spending."""
    totals: dict[int | None, dict[str, int]] = {}
    for point in points:
        if point.is_transfer and not include_transfers:
            continue
        if point.amount_cents >= 0:
            continue
        entry = totals.setdefault(point.category_id, {"total": 0, "count": 0})
        entry["total"] += point.amount_cents
        entry["count"] += 1

    grand_total = sum(abs(entry["total"]) for entry in totals.values())
    result = [
        CategoryTotal(
            category_id=category_id,
            total_cents=entry["total"],
            count=entry["count"],
            share=(abs(entry["total"]) / grand_total) if grand_total else 0.0,
        )
        for category_id, entry in totals.items()
    ]
    result.sort(key=lambda c: abs(c.total_cents), reverse=True)
    return result


def compare_periods(current_cents: int, previous_cents: int) -> PeriodComparison:
    """Delta and relative change. Ratio is None when there is no baseline to divide by."""
    delta = current_cents - previous_cents
    ratio = abs(delta) / abs(previous_cents) if previous_cents != 0 else None
    return PeriodComparison(delta_cents=delta, delta_ratio=ratio)


def moving_average(values: list[int] | list[float], window: int) -> list[float]:
    """Trailing moving average. Early points average over what is available."""
    if window <= 0:
        raise ValueError("La fenêtre doit être strictement positive")
    averages: list[float] = []
    for index in range(len(values)):
        slice_start = max(0, index - window + 1)
        chunk = values[slice_start: index + 1]
        averages.append(sum(chunk) / len(chunk))
    return averages
