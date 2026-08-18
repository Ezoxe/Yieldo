from datetime import date

from pydantic import BaseModel


class PriceChangeOut(BaseModel):
    previous_cents: int
    current_cents: int
    changed_on: date
    # Signed ratio, not money: 0.185 renders as "+18,5 %". A fall is negative
    # and is a real, reportable result.
    ratio: float


class RecurrenceOut(BaseModel):
    label: str
    label_key: str
    category_id: int | None
    category_name: str | None
    category_color: str | None
    periodicity: str
    occurrences: int
    first_on: date
    last_on: date
    median_interval_days: int
    # The level billed now, signed. After a rise this is the new price.
    amount_cents: int
    amount_spread_cents: int
    annual_cents: int
    # How much of the calendar the analysed run actually covers. After a lapse
    # this is the trailing run's span, not the whole group's.
    observed_span_days: int
    # Whether `annual_cents` may be treated as a yearly cost. False when the
    # run spans less than the engine's quarter-year floor: `annual_cents` is
    # still carried (the rate is a fact about what was seen) but the screen
    # must present it as "observé sur N jours", not as an annual figure, and
    # must not fold it into any total -- the report's own totals already
    # exclude it, but recurrences stay sorted on the un-gated `annual_cents`,
    # so a large non-annualisable figure can still sort to the top of a list
    # it takes no part in.
    annualisable: bool
    expected_next_on: date
    status: str
    confidence: str
    price_change: PriceChangeOut | None


class RecurrenceReportOut(BaseModel):
    recurrences: list[RecurrenceOut]
    # Live expense recurrences only, signed (negative). Annualisable ones only.
    annual_subscription_cents: int
    monthly_subscription_cents: int
    analysed_groups: int
    rejected_thin: int
    rejected_irregular: int
    # French, non-null whenever nothing was detected, or detected but nothing
    # cleared the annualisation bar. The screen prints it instead of an
    # unexplained empty list or an unexplained zero total.
    notice: str | None
    missing_count: int
    price_change_count: int
    # The most recent date in this user's whole ledger, or null when it holds
    # no transaction at all. This is exactly the `today` the router hands the
    # engine (see `list_recurrences`'s docstring): a recurrence whose
    # `last_on` sits at or near this date has simply run out of imported
    # statements, not necessarily been cancelled. The screen must phrase a
    # `missing`/`ended` status against this date -- "aucun prélèvement depuis
    # le 9 janvier 2026, dernière date de votre historique" -- rather than
    # asserting a cancellation the data does not support.
    ledger_last_on: date | None
