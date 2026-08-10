from datetime import date

from pydantic import BaseModel


class SeriesBucketOut(BaseModel):
    key: str
    start: date
    end: date
    inflow_cents: int
    outflow_cents: int
    net_cents: int
    count: int


class CategoryBreakdownOut(BaseModel):
    category_id: int | None
    name: str
    color: str
    total_cents: int
    count: int
    share: float


class ComparisonOut(BaseModel):
    delta_cents: int
    delta_ratio: float | None


class PeriodTotalsOut(BaseModel):
    date_from: date
    date_to: date
    inflow_cents: int
    outflow_cents: int
    net_cents: int
    transaction_count: int
    # A savings rate without income is undefined, not zero -- null when inflow is 0.
    savings_rate: float | None


class SummaryOut(PeriodTotalsOut):
    previous: PeriodTotalsOut
    comparison: ComparisonOut


class CalendarPointOut(BaseModel):
    date: str
    inflow_cents: int
    outflow_cents: int
    net_cents: int
    count: int
