"""Wire shapes for /api/simulators: credit, épargne, immobilier.

Every duration field (`months`, `loan_months`, `years`) is left unbounded here
on purpose and validated by the engine instead: `amortization.build_schedule`
and `savings.project_savings` already refuse an out-of-range duration with
their own precise French sentence -- "comprise entre 1 et 480 mois", "entre 1
et 600 mois" -- and duplicating a different bound here would risk the two
disagreeing on which value is actually rejected. `api/simulators.py` forwards
every engine `ValueError` as a 422, the same catch-and-forward idiom
`/api/feasibility` already uses.
"""

from pydantic import BaseModel, Field

from app.engines.property import (
    DEFAULT_APPRECIATION_BPS_PER_YEAR,
    DEFAULT_INSURANCE_BPS_PER_YEAR,
    NOTARY_BPS_EXISTING,
)
from app.engines.savings import DEFAULT_ANNUAL_RETURN_BPS

# A generous sanity ceiling on a rate typed into a simulator -- 1 000 %/an.
# Neither `amortization` nor `savings` carries a rate ceiling of its own (see
# their docstrings): each prices whatever it is handed. This bound exists only
# so a wildly mistyped rate fails fast on a cheap Decimal power rather than
# reaching `(1 + rate) ** months` with a rate large enough to make that
# computation slow.
MAX_SIMULATOR_RATE_BPS = 100_000

# A monetary field's sanity ceiling, matching `FeasibilityIn.target_cents`:
# 100 000 000,00 EUR.
_MAX_AMOUNT_CENTS = 100_000_000_00


class ScheduleRowOut(BaseModel):
    month: int
    payment_cents: int
    interest_cents: int
    principal_cents: int
    remaining_cents: int


class ScheduleYearOut(BaseModel):
    """One bar of the amortisation chart: twelve rows rolled up. Computed in
    the router, not the engine -- see `api/simulators.py`."""

    year: int
    interest_cents: int
    principal_cents: int
    remaining_cents: int


class ScheduleOut(BaseModel):
    principal_cents: int
    annual_rate_bps: int
    months: int
    monthly_payment_cents: int
    total_paid_cents: int
    total_interest_cents: int
    # Empty exactly when `principal_cents == 0`.
    rows: list[ScheduleRowOut]


class CreditIn(BaseModel):
    principal_cents: int = Field(ge=0, le=_MAX_AMOUNT_CENTS)
    annual_rate_bps: int = Field(ge=0, le=MAX_SIMULATOR_RATE_BPS)
    months: int


class CreditOut(ScheduleOut):
    # The yearly roll-up `charts/AmortizationChart.tsx` draws.
    years: list[ScheduleYearOut]


class SavingsIn(BaseModel):
    # May be negative: a projection starting from an existing deficit, the
    # same figure `capacity.measure_savings_capacity` can hand this simulator.
    initial_cents: int = Field(ge=-_MAX_AMOUNT_CENTS, le=_MAX_AMOUNT_CENTS)
    # May be negative: a withdrawal plan. See `savings.project_savings`'s
    # module docstring.
    monthly_cents: int = Field(ge=-_MAX_AMOUNT_CENTS, le=_MAX_AMOUNT_CENTS)
    annual_rate_bps: int = Field(ge=0, le=MAX_SIMULATOR_RATE_BPS)
    months: int


class SavingsPointOut(BaseModel):
    month: int
    contributed_cents: int
    interest_cents: int
    balance_cents: int


class SavingsOut(BaseModel):
    initial_cents: int
    monthly_cents: int
    annual_rate_bps: int
    months: int
    final_cents: int
    contributed_cents: int
    interest_cents: int
    points: list[SavingsPointOut]


class PropertyIn(BaseModel):
    """`monthly_income_cents` and `existing_debt_payments_cents` are
    deliberately NOT fields here: the router measures both itself from the
    requesting user's own ledger, so the debt ratio this endpoint prints is
    measured rather than typed. See `api/simulators.py`'s module docstring."""

    price_cents: int = Field(gt=0, le=_MAX_AMOUNT_CENTS)
    down_payment_cents: int = Field(ge=0, le=_MAX_AMOUNT_CENTS)
    notary_bps: int = Field(default=NOTARY_BPS_EXISTING, ge=0, le=10_000)
    loan_rate_bps: int = Field(ge=0, le=MAX_SIMULATOR_RATE_BPS)
    loan_months: int
    insurance_bps_per_year: int = Field(
        default=DEFAULT_INSURANCE_BPS_PER_YEAR, ge=0, le=10_000)
    monthly_charges_cents: int = Field(default=0, ge=0, le=_MAX_AMOUNT_CENTS)
    annual_property_tax_cents: int = Field(default=0, ge=0, le=_MAX_AMOUNT_CENTS)

    # The rent comparison. Absent `monthly_rent_cents` means no comparison is
    # computed at all -- `PropertyOut.rent_comparison` is then null, not a
    # comparison against a rent of zero.
    monthly_rent_cents: int | None = Field(default=None, ge=0, le=_MAX_AMOUNT_CENTS)
    # Bounded to 50 years so `years * 12` can never exceed `savings.
    # MAX_PROJECTION_MONTHS` (600): `engines.property.rent_comparison` refuses
    # past it on a purchase with no loan to cap the horizon first, and this
    # bound keeps that refusal unreachable from the API rather than relied on.
    years: int = Field(default=10, ge=1, le=50)
    annual_return_bps: int = Field(default=DEFAULT_ANNUAL_RETURN_BPS, ge=0, le=3_000)
    appreciation_bps_per_year: int = Field(
        default=DEFAULT_APPRECIATION_BPS_PER_YEAR, ge=0, le=10_000)


class PropertySimulationOut(BaseModel):
    price_cents: int
    notary_fees_cents: int
    acquisition_cost_cents: int
    down_payment_cents: int
    # 0 when the down payment covers the frais de notaire. A positive figure
    # is a fact about the plan, reported rather than refused.
    down_payment_short_cents: int
    borrowed_cents: int
    schedule: ScheduleOut
    monthly_insurance_cents: int
    monthly_charges_cents: int
    monthly_property_tax_cents: int
    monthly_effort_cents: int
    total_interest_cents: int
    total_cost_cents: int
    # null when no income could be measured. Read this BEFORE
    # `debt_ratio_exceeded`, which is false both under the threshold and when
    # there is no ratio at all.
    debt_ratio_bps: int | None
    debt_ratio_exceeded: bool


class RentComparisonOut(BaseModel):
    horizon_months: int
    # French, set exactly when the requested horizon was cut back to the loan
    # term.
    capped_reason: str | None
    monthly_rent_cents: int
    buyer_property_value_cents: int
    buyer_remaining_loan_cents: int
    buyer_wealth_cents: int
    renter_wealth_cents: int
    difference_cents: int
    better_kind: str


class PropertyOut(BaseModel):
    simulation: PropertySimulationOut
    # null exactly when the request carried no `monthly_rent_cents`.
    rent_comparison: RentComparisonOut | None
    # Echoed so the screen can show what fed the debt ratio above. null when
    # income could not be measured over three complete months.
    measured_monthly_income_cents: int | None
    existing_debt_payments_cents: int


class SimulatorContextOut(BaseModel):
    """What the property simulator measures itself, published so a form can
    show it before the user submits anything."""

    monthly_income_cents: int | None
    existing_debt_payments_cents: int
    months_observed: int
