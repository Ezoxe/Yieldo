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
    # How many recurrences were actually projected forward -- not how many
    # were detected. `ForecastReport`'s own docstring: the screen needs the
    # difference to explain what is in the chart, since an ended or
    # too-young recurrence is deliberately absent from it.
    recurrences_projected: int
    # The two scales the band is built from, published so the screen can
    # explain a band without re-measuring it -- see `ForecastReport`'s own
    # docstring for what each answers. 0 on a refusal (`months` empty); read
    # `insufficient_reason` first, never this field on its own in that case.
    pooled_scale_cents: int
    # None means no projected month used a seasonal estimate -- every month
    # was priced from the pooled centre and scale instead. Not a reason to
    # refuse on its own.
    seasonal_scale_cents: int | None
    threshold_cents: int
    first_breach_key: str | None
    opening_balance_cents: int
    # French. Non-null exactly when `months` is empty.
    insufficient_reason: str | None
    # French. Non-null exactly when the months were projected with NO band --
    # every one carries `balance_p10 == balance_p50 == balance_p90`. A screen
    # reading it must draw a LINE, never a ribbon: there is no interval, and a
    # zero-width band presented as one would be a claim of certainty.
    band_unavailable_reason: str | None = None
    # Whether those months carry the recurring charges alone, the variable part
    # being absent rather than estimated at zero.
    recurring_only: bool = False
    # The date this projection actually starts counting from -- `today` as
    # handed to `project_cashflow`, which for `forecast` is the ledger's own
    # last transaction date, not the real calendar date. See
    # `api/cashflow.py`'s module docstring for why. The screen must read this
    # field rather than assume "today" means the real date: on the operator's
    # data the projected months are 2026-02..2027-01 while the real calendar
    # is already at 2026-08, and only this field lets the screen say so.
    projected_from: date
    # The ledger's own last transaction date, or null on an empty ledger. The
    # projection is anchored on this date rather than on the real calendar --
    # see `api/cashflow.py`'s module docstring for why -- so the screen must
    # say "à partir du 9 janvier 2026" and never imply the horizon starts from
    # today's real date.
    ledger_last_on: date | None


class MeasuredRateOut(BaseModel):
    """A rate measured from history, with its variability -- mirrors
    `capacity.MeasuredRate`. `low_cents` / `high_cents` are the P10 / P90
    equivalents derived from the robust scale: a rate quoted without them
    invites the reader to treat a median as a certainty, and `RunwayOut`'s own
    module docstring says both engines here are measured, never asserted.
    """

    # How many months THIS rate was measured over -- not the same as
    # `RunwayOut.months_observed`, which is `normal`'s own sample size.
    # `essentials` is measured over its own, self-selected set of months
    # (only those carrying essential-tagged spending), which can be narrower.
    months: int
    median_cents: int
    spread_cents: int
    low_cents: int
    high_cents: int


class RunwayScenarioOut(BaseModel):
    name: str
    monthly_burn_cents: int
    # The full measured rate this scenario's burn was derived from: its band
    # and, via `rate.months`, exactly how many months it was measured over.
    rate: MeasuredRateOut
    # A duration in months, not a monetary value. Fractional on purpose: a
    # runway of 0,4 mois is a real and important answer.
    months: float
    # null when the runway is longer than fifty years, where a calendar date
    # would be noise.
    depleted_on: date | None


class RunwayOut(BaseModel):
    balance_cents: int
    # Complete months the whole ledger covers -- `normal`'s own sample size.
    # `essentials`' own sample size lives on `essentials.rate.months` instead,
    # since it is measured over a different, self-selected set of months.
    months_observed: int
    # The number of distinct calendar months the ledger's dates touch, from
    # its first transaction's month to its last's, inclusive -- complete or
    # partial, with or without activity in between. Not the same claim as
    # `months_observed`: a ledger that spans thirteen calendar months but
    # measured only three complete ones (a nine-month import hole, the
    # operator's actual situation) looks identical to a dense three-month
    # ledger unless this field is read alongside it. 0 on an empty ledger.
    ledger_span_months: int
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
    # The date `depleted_on` actually counts forward from -- the real
    # `date.today()`, unlike `forecast`'s `projected_from`. See
    # `api/cashflow.py`'s module docstring for why the two routes differ.
    projected_from: date
    # The ledger's own last transaction date, or null on an empty ledger. The
    # burn rate behind both scenarios is only as fresh as this date, even
    # though `depleted_on` counts forward from the real calendar -- see
    # `api/cashflow.py`'s module docstring.
    ledger_last_on: date | None
