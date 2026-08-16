from datetime import date

from pydantic import BaseModel

from app.schemas.history import HistoryOut


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
    # The span of the whole ledger, not of this period -- what tells an empty
    # dashboard whether the user has no data or is simply looking elsewhere.
    # null when they have no transactions at all.
    history: HistoryOut | None


class CalendarPointOut(BaseModel):
    date: str
    inflow_cents: int
    outflow_cents: int
    net_cents: int
    count: int
