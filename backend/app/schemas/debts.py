"""Wire shapes for /api/debts.

`principal_cents` is a positive magnitude on every shape here, matching
`models.Debt` and `engines.debt.DebtInput` -- the deliberate exception to the
negative-outflow convention, restated at the boundary so a frontend author
reading only this file does not negate it.
"""

from datetime import date

from pydantic import BaseModel, ConfigDict, Field


class DebtIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    kind: str
    # ge=0 rather than gt=0: a debt whose capital has just reached zero is a
    # real row the user may not have archived yet.
    principal_cents: int = Field(ge=0)
    annual_rate_bps: int = Field(default=0, ge=0, le=10_000)
    minimum_payment_cents: int = Field(ge=0)
    term_months: int | None = Field(default=None, ge=1, le=480)
    opened_on: date | None = None


class DebtPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    kind: str | None = None
    principal_cents: int | None = Field(default=None, ge=0)
    annual_rate_bps: int | None = Field(default=None, ge=0, le=10_000)
    minimum_payment_cents: int | None = Field(default=None, ge=0)
    term_months: int | None = Field(default=None, ge=1, le=480)
    opened_on: date | None = None
    archived: bool | None = None


class DebtOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    kind: str
    principal_cents: int
    annual_rate_bps: int
    minimum_payment_cents: int
    term_months: int | None
    opened_on: date | None
    archived: bool


class DebtPayoffOut(BaseModel):
    debt_id: int
    name: str
    cleared_in_months: int
    cleared_on: date
    interest_cents: int
    paid_cents: int


class BalancePointOut(BaseModel):
    month: int
    on: date
    # Keys are debt ids as strings -- JSON object keys are always strings, and
    # saying so here stops a frontend author expecting numbers. EVERY debt in
    # the plan appears at EVERY point, cleared ones as 0, so a stacked chart
    # has a value for every series at every x.
    balances_cents: dict[str, int]
    total_cents: int


class PayoffPlanOut(BaseModel):
    strategy: str
    monthly_budget_cents: int
    # What the debts cost in interest in month one, together. The screen states
    # the shortfall behind a budget refusal from this and `monthly_budget_cents`
    # -- the engine names causes, the display boundary formats euros.
    first_month_interest_cents: int
    # null exactly when `unavailable_reason` is set. 0 -- with a null reason --
    # on a user with no debts, which is an answer, not a refusal.
    months: int | None
    cleared_on: date | None
    total_interest_cents: int
    total_paid_cents: int
    order: list[int]
    payoffs: list[DebtPayoffOut]
    # Empty on both refusal branches and on an empty debt list. Never render a
    # chart from it without checking `months` first.
    points: list[BalancePointOut]
    # French. Set exactly when `months` is null, and it names WHICH of the two
    # causes applies: a budget below the first month's interest, or a plan
    # running past fifty years. Print it verbatim; do not paraphrase.
    unavailable_reason: str | None


class StrategyComparisonOut(BaseModel):
    snowball: PayoffPlanOut
    avalanche: PayoffPlanOut
    # Snowball's interest minus avalanche's, so positive means avalanche is
    # cheaper. **null when either plan refused** -- the difference between a
    # number and a refusal is not a saving. 0 is a real answer (both strategies
    # cost the same, e.g. a single debt); null is not.
    interest_saved_cents: int | None
    months_saved: int | None
