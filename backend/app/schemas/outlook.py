"""The wire shape of Avenir: cents, ISO dates, French sentences."""

from datetime import date
from typing import Literal

from pydantic import BaseModel, Field

Scope = Literal["checking", "liquid"]
SourceName = Literal["detected", "declared", "planned", "scenario"]

# Ten million euros: past that an « Et si… » amount is a typing slip.
MAX_SCENARIO_CENTS = 1_000_000_000
MAX_ADJUSTMENTS = 20


class OutlookDayOut(BaseModel):
    on: date
    p10_cents: int
    p50_cents: int
    p90_cents: int


class OutlookEventOut(BaseModel):
    on: date
    amount_cents: int
    label: str
    source: SourceName
    series: str
    category_id: int | None
    # The median balance at the end of that day.
    balance_after_cents: int


class OutlookMonthOut(BaseModel):
    key: str
    p10_cents: int
    p50_cents: int
    p90_cents: int
    low_on: date
    low_p50_cents: int


class LowPointOut(BaseModel):
    on: date
    p50_cents: int
    p10_cents: int


class SeriesOut(BaseModel):
    id: str
    label: str
    source: SourceName
    amount_cents: int
    periodicity: str


class SourceCountsOut(BaseModel):
    detected: int
    declared: int
    planned: int
    # Declarations that replaced the detection they matched.
    reconciled: int


class OutlookOut(BaseModel):
    scope: Scope
    # The last day of the perimeter's statements: the projection starts after it.
    as_of: date
    today: date
    # Days between the statements' end and today. Past a week the screen says so.
    stale_days: int
    horizon_end: date
    opening_balance_cents: int
    threshold_cents: int
    # "alert" when the floor set in Alertes is the threshold, "zero" otherwise.
    threshold_source: Literal["alert", "zero"]
    days: list[OutlookDayOut]
    events: list[OutlookEventOut]
    months: list[OutlookMonthOut]
    low_point: LowPointOut | None
    risk: Literal["none", "possible", "probable"]
    first_breach_on: date | None
    variable_daily_cents: int | None
    band: bool
    band_unavailable_reason: str | None
    # Months of variable spending the band and the profile were measured on.
    residual_months: int
    profile_measured: bool
    warnings: list[str]
    series: list[SeriesOut]
    counts: SourceCountsOut
    # French, non-null exactly when the perimeter holds no account at all.
    empty_reason: str | None = None


class AdjustmentIn(BaseModel):
    kind: Literal["one_off", "cancel", "change_amount"]
    on: date
    label: str | None = Field(default=None, max_length=120)
    amount_cents: int | None = Field(default=None, ge=-MAX_SCENARIO_CENTS, le=MAX_SCENARIO_CENTS)
    series: str | None = Field(default=None, max_length=600)


class ScenarioIn(BaseModel):
    scope: Scope = "checking"
    horizon_days: int = Field(default=90, ge=1, le=730)
    adjustments: list[AdjustmentIn] = Field(max_length=MAX_ADJUSTMENTS)


class ScenarioOut(BaseModel):
    base: OutlookOut
    scenario: OutlookOut


class HorizonScoreOut(BaseModel):
    horizon_months: int
    replays: int
    mean_abs_error_cents: int
    median_abs_error_cents: int
    bias_cents: int
    inside_band: int


class ReliabilityOut(BaseModel):
    scope: Scope
    horizons: list[HorizonScoreOut]
    refusal: str | None
