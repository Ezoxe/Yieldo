from datetime import date
from decimal import Decimal

from pydantic import BaseModel, Field


class CategoryInflationOut(BaseModel):
    category_id: int | None
    name: str
    color: str
    # POSITIVE magnitudes: a basket's price is a positive number. See the note
    # in app/engines/inflation.py -- this is a deliberate, named exception to
    # the negative-outflow convention, which is why the fields say `_cost_`.
    current_cost_cents: int
    previous_cost_cents: int
    # Signed: positive when this category got more expensive.
    delta_cents: int
    # null -- never 0 -- when no honest ratio exists.
    ratio: float | None
    months_current: int
    months_previous: int
    comparable: bool
    # French. Non-null exactly when `comparable` is false.
    reason: str | None


class InflationOut(BaseModel):
    current_from: date
    current_to: date
    previous_from: date
    previous_to: date
    lines: list[CategoryInflationOut]
    basket_current_cost_cents: int
    basket_previous_cost_cents: int
    basket_ratio: float | None
    # From a user-supplied series only. Yieldo fetches nothing.
    reference_ratio: float | None
    comparable: bool
    reason: str | None


class AnomalyOut(BaseModel):
    transaction_id: int
    date: date
    # Signed, the usual convention: this one IS a transaction amount.
    amount_cents: int
    label: str
    category_id: int | None
    category_name: str | None
    category_color: str | None
    # The category's usual amount, as a magnitude.
    category_median_cents: int
    modified_z: float
    direction: str


class SkippedCategoryOut(BaseModel):
    category_id: int | None
    name: str
    direction: str
    observations: int
    reason: str


class AnomalyReportOut(BaseModel):
    anomalies: list[AnomalyOut]
    skipped: list[SkippedCategoryOut]
    scored_groups: int
    date_from: date
    date_to: date


class PriceIndexPointOut(BaseModel):
    # "AAAA-MM".
    month: str
    # An index level, not money: 118.42 is 11842. Sent as an integer so no
    # float ever touches it.
    value_hundredths: int


class PriceIndexPointIn(BaseModel):
    month: str
    # Decimal, so "118.42" arrives exact. Pydantic parses a JSON string into
    # Decimal without going through a float.
    #
    # `gt=0` is a deliberate decision, not a default: task 15's review left a
    # live gap in `inflation.reference_ratio_from_index`, whose zero-baseline
    # guard is `before == 0` rather than `before <= 0` -- a negative index
    # value would divide and return a sign-inverted ratio. An index point is
    # typed in by a human, so the schema boundary is where that is refused,
    # rather than trusting every future caller of the engine to re-derive the
    # same guard. Note `gt=0` binds the raw `Decimal` the caller sent, not the
    # rounded `value_hundredths` the router later stores -- a tiny positive
    # value (e.g. "0.004") still rounds to 0 hundredths, so the router itself
    # carries a second, post-rounding guard (see `replace_price_index`).
    #
    # `le=1_000_000` is a review fix, not an arbitrary ceiling: with no upper
    # bound, "1e30", a 29-digit literal, and "1e20" each 500'd -- two from
    # `Decimal.quantize()` raising `InvalidOperation` once the rounded result
    # needs more digits than the default 28-digit context precision, one from
    # `OverflowError` when the resulting int no longer fits SQLite's 8-byte
    # INTEGER at commit. A million is generous headroom over any real index
    # (INSEE's IPC sits around 100-140) while keeping every value this schema
    # can ever produce (<= 100_000_000 hundredths) far under both ceilings.
    value: Decimal = Field(gt=0, le=1_000_000)


class PriceIndexIn(BaseModel):
    # The WHOLE series. PUT replaces what is stored, so posting it twice is
    # idempotent and an empty list clears it.
    points: list[PriceIndexPointIn]
