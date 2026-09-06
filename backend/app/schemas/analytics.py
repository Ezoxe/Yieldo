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
    # What actually left the spendable perimeter for a savings account, from
    # `engines/transfer.measure_set_aside`. NEVER add it to `net_cents`: the
    # euro moved to a livret is already counted as saved there, because nothing
    # spends it any more. The two stand side by side.
    set_aside_cents: int
    # `net_cents - set_aside_cents`: the surplus the period produced and left
    # sitting on the current account. Negative means the savings were funded by
    # drawing the balance down.
    set_aside_gap_cents: int


class SummaryOut(PeriodTotalsOut):
    # Both null when the range was not asked for: a defaulted start is the
    # user's first transaction, so no period precedes it and any comparison
    # would be against a window that cannot hold data.
    previous: PeriodTotalsOut | None
    comparison: ComparisonOut | None
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
