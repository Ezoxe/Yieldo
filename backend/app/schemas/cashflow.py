"""Wire shapes for the cash-flow forecast and runway endpoints.

Both engines are measured, never asserted: `ForecastOut` carries a band
(P10/P50/P90), never a single line -- see `app.engines.forecast` -- and
`RunwayOut` carries two independently-measured scenarios, each with its own
unavailability reason -- see `app.engines.runway`.
"""

from datetime import date

from pydantic import BaseModel


class ForecastMonthOut(BaseModel):
    key: str
    start: date
    end: date
    recurring_cents: int
    residual_cents: int
    net_p50_cents: int
    balance_p10_cents: int
    balance_p50_cents: int
    balance_p90_cents: int
    below_threshold: bool
    # True when this month's estimate came from observations of the same
    # calendar month rather than from the pooled median.
    seasonal: bool


class ForecastOut(BaseModel):
    months: list[ForecastMonthOut]
    # Months carrying residual (non-recurring) activity -- what the band was
    # actually measured over.
    months_observed: int
    # Complete months the ledger itself covers, independent of whether any of
    # them carried residual activity. Not the same number as `months_observed`
    # -- a month whose whole activity was recurring carries no residual and is
    # absent from it. `ForecastReport`'s own docstring: the screen needs both
    # to say "12 mois de relevés, 3 exploitables" rather than conflating them.
    ledger_months_observed: int
    seasonality_used: bool
    threshold_cents: int
    first_breach_key: str | None
    opening_balance_cents: int
    # French. Non-null exactly when `months` is empty.
    insufficient_reason: str | None
    # The ledger's own last transaction date, or null on an empty ledger. The
    # projection is anchored on this date rather than on the real calendar --
    # see `api/cashflow.py`'s module docstring for why -- so the screen must
    # say "à partir du 9 janvier 2026" and never imply the horizon starts from
    # today's real date.
    ledger_last_on: date | None


class RunwayScenarioOut(BaseModel):
    name: str
    monthly_burn_cents: int
    # A duration in months, not a monetary value. Fractional on purpose: a
    # runway of 0,4 mois is a real and important answer.
    months: float
    # null when the runway is longer than fifty years, where a calendar date
    # would be noise.
    depleted_on: date | None


class RunwayOut(BaseModel):
    balance_cents: int
    months_observed: int
    normal: RunwayScenarioOut | None
    essentials: RunwayScenarioOut | None
    # French. Set exactly when `normal` is None: too few observed months, or a
    # burn that is not measurably positive. Never a month-count complaint when
    # the month count was in fact sufficient -- see `runway.py`'s own two
    # reasons, kept separate on purpose after a fix that once conflated them.
    normal_unavailable_reason: str | None
    # Same contract, for `essentials`. `essentials` is measured over its own
    # set of months and can fail on its own even when `normal` succeeds -- the
    # screen needs a reason to show next to it, not a blank next to a working
    # `normal`.
    essentials_unavailable_reason: str | None
    # How many categories the reduced scenario rests on. The screen states it,
    # because a scenario built on an empty essential list is not a scenario.
    essential_category_count: int
    # The ledger's own last transaction date, or null on an empty ledger. The
    # burn rate behind both scenarios is only as fresh as this date, even
    # though `depleted_on` counts forward from the real calendar -- see
    # `api/cashflow.py`'s module docstring.
    ledger_last_on: date | None
