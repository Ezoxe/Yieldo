"""Wire shapes for /api/feasibility.

Design §6.3. Every measured input travels beside the verdict it produced --
the capacity with its band and its sample size, the ledger's span, the liquid
balance -- because a verdict quoted without its provenance invites the reader
to treat a median of three months as a certainty.
"""

from datetime import date, datetime

from pydantic import BaseModel, Field

from app.engines.feasibility import NATURES
from app.engines.ownership import DEFAULT_OWNERSHIP_YEARS, MAX_OWNERSHIP_YEARS
from app.engines.savings import DEFAULT_ANNUAL_RETURN_BPS
from app.schemas.cashflow import MeasuredRateOut
from app.schemas.history import HistoryOut

# Bounded far below `amortization.MAX_LOAN_MONTHS` (480), and this bound is
# deliberate, not copied from that ceiling. Task 12 flagged the reason: both
# `levers._borrow` and `levers.compare_financing` price a loan at the caller's
# OWN `loan_rate_bps` via `amortization.build_schedule`, with no per-lever
# guard -- a refusal there is an uncaught `ValueError` that aborts
# `build_levers` entirely, costing all FIVE levers over a failure that only
# concerns one of them (`borrow`) or the financing comparison.
#
# `amortization.monthly_payment_cents` refuses whenever the rounded instalment
# would not even cover the first month's interest, and how much capital that
# takes to avoid grows sharply with the term: `levers.
# _priceable_across_the_searched_range`'s own docstring puts the guaranteed-safe
# floor at 2 901,30 EUR over 360 months and 56 171,02 EUR over 480 months, at
# the ceiling rate this application ever searches (`levers.
# MAX_SEARCHED_RATE_BPS`, 30 %/an -- the same ceiling `loan_rate_bps` is bounded
# to below). A shortfall of a few tens of thousands of euros is not a
# contrived input; it is the kind of gap this very screen exists to report.
#
# At 180 months the same floor is 33,67 EUR (verified below in
# `test_the_loan_months_bound_keeps_amortisations_refusal_unreachable`), far
# below any purchase gap this feature is built to answer, while the bound
# still spans a realistic vehicle or personal-loan term. `DEFAULT_LOAN_MONTHS`
# (60, in `api/feasibility.py`) sits comfortably inside it.
MAX_LOAN_MONTHS = 180


class CostItemIn(BaseModel):
    key: str = Field(min_length=1, max_length=40)
    label: str = Field(min_length=1, max_length=80)
    # Exactly one of the two. Both, or neither, raises in the engine and comes
    # back as a French 422 -- validated there rather than here so there is one
    # rule, in one place, in one language.
    monthly_cents: int | None = Field(default=None, ge=0)
    annual_bps_of_value: int | None = Field(default=None, ge=0, le=10_000)


class LoaIn(BaseModel):
    deposit_cents: int = Field(ge=0)
    monthly_cents: int = Field(ge=0)
    months: int = Field(ge=1, le=120)
    residual_cents: int = Field(ge=0)


class FeasibilityIn(BaseModel):
    """The question. Nothing here is measured -- it is what the user asks."""

    target_cents: int = Field(gt=0, le=100_000_000_00)
    horizon_months: int = Field(ge=1, le=600)
    down_payment_cents: int = Field(default=0, ge=0)
    nature: str = Field(default="vehicle")
    # Assumption overrides. Absent means the declared default, which the
    # response echoes back so the screen can print what was actually used.
    annual_return_bps: int | None = Field(default=None, ge=0, le=3_000)
    loan_rate_bps: int | None = Field(default=None, ge=0, le=3_000)
    # See `MAX_LOAN_MONTHS` above for why this is not `amortization.
    # MAX_LOAN_MONTHS`.
    loan_months: int | None = Field(default=None, ge=1, le=MAX_LOAN_MONTHS)
    ownership_years: int | None = Field(default=None, ge=1, le=MAX_OWNERSHIP_YEARS)
    # Absent means "use the French defaults for `nature`". An EMPTY LIST means
    # "no running costs at all", which is a different statement and is honoured.
    ownership_items: list[CostItemIn] | None = None
    loa: LoaIn | None = None


class AssumptionsOut(BaseModel):
    """Every hypothesis actually used, echoed back. Design §10: "Les hypothèses
    sont toujours affichées à côté du résultat.\""""

    annual_return_bps: int
    loan_rate_bps: int
    loan_months: int
    ownership_years: int
    # MEASURED, unlike the four above. null when it could not be measured over
    # three complete months -- in which case there is no debt ratio either.
    monthly_income_cents: int | None
    existing_debt_payments_cents: int


class CostLineOut(BaseModel):
    key: str
    label: str
    total_cents: int
    monthly_average_cents: int


class OwnershipOut(BaseModel):
    price_cents: int
    years: int
    lines: list[CostLineOut]
    depreciation_cents: int
    residual_value_cents: int
    # Running costs only. Depreciation is NOT included here: it is value
    # leaving the asset, not money leaving the account, and adding the two
    # without saying so compares different things. `total_cost_cents` is the
    # sum a buyer should weigh.
    running_cost_cents: int
    total_cost_cents: int
    monthly_average_cents: int


class EmergencyImpactOut(BaseModel):
    runway_months_before: float | None
    runway_months_after: float | None
    # The measured burn the two months above divide by. Design §10: a runway of
    # "4 mois" says nothing without the rate behind it. Null exactly when the
    # months are, for the same reason.
    monthly_burn_cents: int | None
    # Both months are null exactly when this is set, and it names WHICH of two
    # causes applies: no measurable expense rate, or a rate that is not a
    # positive burn.
    unavailable_reason: str | None


class ImpactOut(BaseModel):
    emergency: EmergencyImpactOut
    liquid_in_five_years_before_cents: int | None
    liquid_in_five_years_after_cents: int | None
    liquid_unavailable_reason: str | None
    # There is deliberately NO net-worth field and NO health-score field.
    # Design §6.3 item 7 names both; neither exists in this codebase yet (net
    # worth is phase 3, the evolving health score is phase 2C). The screen says
    # so in French. Do not add a field here with a zero in it.


class LeverOut(BaseModel):
    kind: str
    feasible: bool
    # French. Set exactly when `feasible` is false.
    unavailable_reason: str | None
    # An extra remark on a FEASIBLE lever. Never a substitute for the above.
    note: str | None
    extra_monthly_cents: int | None
    # null when the measured capacity is not positive: a ratio against a
    # negative denominator is not an effort.
    effort_ratio: float | None
    reached_in_months: int | None
    delay_months: int | None
    reduced_target_cents: int | None
    borrow_cents: int | None
    loan_payment_cents: int | None
    loan_total_interest_cents: int | None
    # null when no income could be measured. Read this BEFORE
    # `debt_ratio_exceeded`, which is false both under the threshold and when
    # there is no ratio at all.
    debt_ratio_bps: int | None
    debt_ratio_exceeded: bool
    category_id: int | None
    category_name: str | None
    category_median_cents: int | None
    cut_monthly_cents: int | None
    months_at_or_below: int | None
    months_observed: int | None


class FinancingOptionOut(BaseModel):
    kind: str
    available: bool
    unavailable_reason: str | None
    out_of_pocket_cents: int | None
    monthly_cents: int | None
    total_paid_cents: int | None
    interest_cents: int | None
    # Always null on the LOA option, with `wealth_unavailable_reason` saying
    # why. Never render a null here as zero.
    wealth_at_end_cents: int | None
    wealth_unavailable_reason: str | None


class FinancingOut(BaseModel):
    horizon_months: int
    options: list[FinancingOptionOut]
    break_even_rate_bps: int | None
    break_even_reason: str | None
    # Compares ONLY cash and credit -- the LOA line is not in the running.
    # None when the credit option could not be priced at all: with one side
    # left, naming it "the better" is a preference nobody established.
    better_kind: str | None
    # Credit's end wealth minus cash's, signed. Read this BEFORE `better_kind`:
    # a zero here is a tie, which `better_kind` reports as "cash" and cannot
    # distinguish from a win. None exactly when `better_kind` is None.
    wealth_gap_cents: int | None


class OwnershipDefaultsOut(BaseModel):
    """What a nature prefills, in the shape `FeasibilityIn` accepts back.

    Published so a screen can render the running-cost items as an EDITABLE form
    (design §6.3 item 3: "préremplis par des moyennes françaises et
    ajustables") rather than taking on trust whatever the server applied. These
    are averages, not measurements, and every screen showing them says so.
    """

    items: list[CostItemIn]
    depreciation_bps_per_year: int
    # French, from `ownership.NATURE_PROFILES`. What this nature assumes and
    # what it deliberately does not, so the reader chooses knowing which.
    label: str
    note: str
    # How long this kind of thing is assumed to be kept: five years for a car,
    # three for a laptop, one for a trip. Editable, like every assumption here.
    ownership_years: int


class FeasibilityContextOut(BaseModel):
    """Everything measured, so the form prefills from data rather than guesses."""

    capacity: MeasuredRateOut | None
    expense_rate: MeasuredRateOut | None
    income_rate: MeasuredRateOut | None
    months_observed: int
    history: HistoryOut | None
    balance_cents: int
    existing_debt_payments_cents: int
    assumptions: AssumptionsOut
    # Keyed by nature. Four of the seven prefill no running cost at all -- see
    # `ownership.NATURE_PROFILES`, which says so in French, per nature.
    ownership_defaults: dict[str, OwnershipDefaultsOut]
    natures: list[str] = Field(default_factory=lambda: list(NATURES))
    default_ownership_years: int = DEFAULT_OWNERSHIP_YEARS
    default_annual_return_bps: int = DEFAULT_ANNUAL_RETURN_BPS


class FeasibilityOut(BaseModel):
    target_cents: int
    horizon_months: int
    down_payment_cents: int
    nature: str
    horizon_end_on: date
    assumptions: AssumptionsOut

    # The measured capacity behind the verdict, with its band and sample size.
    # null when fewer than three complete months could be observed. **Signed**:
    # a negative median is a household spending more than it earns, and it
    # produces a verdict rather than a refusal.
    capacity: MeasuredRateOut | None
    # French. Set exactly when `capacity` is null, and it is the ONLY reason
    # this endpoint refuses to give a verdict.
    capacity_unavailable_reason: str | None
    months_observed: int
    history: HistoryOut | None
    balance_cents: int

    # All null exactly when `capacity_unavailable_reason` is set.
    verdict: str | None
    saved_at_horizon_cents: int | None
    saved_at_horizon_low_cents: int | None
    saved_at_horizon_high_cents: int | None
    # POSITIVE means short, NEGATIVE means a surplus. Branch on the sign; never
    # print "il vous manque -866,55 €".
    gap_cents: int | None

    opportunity_cost_cents: int
    opportunity_horizon_months: int
    # What has to go aside every month to reach the target by the horizon.
    # Never null: it depends on the price, the down payment, the rate and the
    # horizon, none of which the measured capacity touches -- so a household
    # whose ledger is too short for a verdict still gets this one.
    required_monthly_cents: int
    # How long the target takes at the capacity actually measured. Null when
    # there is no measured capacity, when it is non-positive, or when the
    # answer lies beyond fifty years. Never a sentinel integer.
    months_at_measured_capacity: int | None
    ownership: OwnershipOut
    impact: ImpactOut
    # EMPTY when `capacity` is null. Otherwise exactly five, feasible first.
    levers: list[LeverOut]
    financing: FinancingOut


class ScenarioIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    # The QUESTION, not the answer. See `models.Scenario`'s docstring: the
    # payload stored from this is re-validated through THIS SAME model on every
    # read, never trusted straight from the row.
    request: FeasibilityIn


class ScenarioOut(BaseModel):
    id: int
    name: str
    created_at: datetime
    # Exactly what was saved, echoed back so the screen can reopen it in the
    # form.
    request: FeasibilityIn
    # Recomputed against the CURRENT ledger on every read -- never stored. Two
    # scenarios listed side by side are therefore always answered from the same
    # statements, which is what makes them comparable at all.
    result: FeasibilityOut
