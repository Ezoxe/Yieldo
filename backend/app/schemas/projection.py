"""Wire shapes for `GET /api/projection` (phase 3 plan Task 15): Monte Carlo,
FIRE, French tax and the three historical stress tests, over the requesting
user's own portfolio and own measured savings capacity.

**Every `*Out` below mirrors an engine dataclass field for field**
(`from_attributes=True` validates straight off `engines.montecarlo`,
`engines.fire`, `engines.tax_fr` and `engines.stress`), so each figure is
named in exactly one place and a schema can never quietly rename or drop one.

**The refused shape is the primary shape, not an afterthought.** The operator
holds zero positions and his measured savings capacity is -746,19 EUR/month,
so all four engines refuse on his real data. Every panel therefore comes in a
`<panel> | None` + `<panel>_unavailable_reason: str | None` pair: exactly one
of the two is set, always, and the sentence is CONTENT on a 200 -- the same
shape `PortfolioAllocationOut.unavailable_reason`,
`FeasibilityOut.capacity_unavailable_reason` and `engagement`'s
`outcome_unavailable_reason` already use. An engine refusing is an answer,
not an error.

**`StressOut` is the one deliberate exception to that pairing.** Its
`shocks` list -- the three episodes with their periods and their published
sources -- is present even when `stress_unavailable_reason` is set, because
those citations are facts about market history rather than about this
household's portfolio, and a screen must be able to print them regardless.
Only `scenarios` (the euro figures applying a shock to a real allocation)
empties out. See `engines.stress`'s own docstring: none of this is a
forecast, and the screen says so.

**Every tax figure carries `regime`.** PFU, barème, PEA exemption and
assurance-vie's reduced rate are four different answers to the same
question, and a euro amount whose treatment the reader has to infer from
context is the defect `engines.tax_fr`'s own docstring was written against.
`regime` is `None` only where `total_tax_cents` is `None` too -- a refusal,
carrying `unavailable_reason`, never a figure without its regime.
"""

from datetime import date

from pydantic import BaseModel, ConfigDict

from app.schemas.cashflow import MeasuredRateOut
from app.schemas.portfolio import WeightedGroupOut

# --- The assumptions, republished whole so a screen prints them beside every
# --- figure they produced (design §10).


class ProjectionAssumptionsOut(BaseModel):
    """`seed` has no everyday French label and is printed as-is: it is the
    number a support conversation or a bug report quotes to reproduce the
    exact same Monte Carlo run. It is a REQUIRED query parameter -- this API
    never generates one."""

    seed: int
    months: int
    annual_return_bps: int
    annual_volatility_bps: int
    trials: int
    withdrawal_rate_bps: int
    # None means the barème option was not priced at all -- never 0, which is
    # a real (and very low) income-tax bracket.
    marginal_rate_bps: int | None
    joint_taxation: bool
    reporting_currency: str
    horizon_end_on: date


class ProjectionPortfolioOut(BaseModel):
    """The valuation this whole response is projected from, in the counts
    `engines.portfolio.PortfolioTotal` already publishes -- so a screen can
    say "3 positions sur 5 valorisées" rather than presenting a partial total
    as a complete one."""

    market_value_cents: int
    cost_basis_cents: int
    unrealised_gain_cents: int
    positions_total: int
    positions_valued: int
    positions_missing_price: int
    positions_missing_fx: int
    weight_by_asset_class: list[WeightedGroupOut]


# --- Monte Carlo (engines.montecarlo).


class MonteCarloAssumptionsOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    annual_return_bps: int
    annual_volatility_bps: int
    # Signed, exactly as measured: a household spending more than it earns
    # contributes a NEGATIVE amount every month, and the band goes down.
    monthly_cents: int
    trials: int
    seed: int
    percentiles: list[int]


class MonteCarloPointOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    month: int
    # The calendar month this point falls on, so a chart has a real x-axis
    # rather than an integer the browser has to date itself.
    on: date
    # Keyed by percentile. JSON turns the integer keys into strings ("10",
    # "50", "90"); `MonteCarloAssumptionsOut.percentiles` states the order.
    # **Never a single figure** -- see `engines.montecarlo`'s docstring.
    percentiles_cents: dict[int, int]


class MonteCarloOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    initial_cents: int
    months: int
    assumptions: MonteCarloAssumptionsOut
    points: list[MonteCarloPointOut]
    horizon_end_on: date


# --- FIRE (engines.fire).


class TargetCapitalOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    annual_expenses_cents: int
    withdrawal_rate_bps: int
    target_capital_cents: int


class IndependenceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    target_capital_cents: int
    current_capital_cents: int
    withdrawal_rate_bps: int
    annual_return_bps: int
    # Republished with its sign untouched -- no abs(), no clamp, anywhere
    # between the ledger and here.
    capacity: MeasuredRateOut | None
    months_to_independence: int | None
    independent_on: date | None
    # Set exactly when `months_to_independence` is None, and names WHICH of
    # the engine's three causes applies. Never two at once.
    unavailable_reason: str | None


class RetirementPointOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    month: int
    balance_cents: int
    gross_withdrawal_cents: int
    taxable_gain_cents: int
    tax_cents: int
    net_withdrawal_cents: int


class RetirementOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    initial_cents: int
    annual_return_bps: int
    withdrawal_rate_bps: int
    # "pfu" or "bareme" -- which regime taxed every withdrawal's gain portion.
    tax_regime: str
    marginal_rate_bps: int | None
    months: int
    points: list[RetirementPointOut]
    exhausted_at_month: int | None
    horizon_end_on: date


class FireOut(BaseModel):
    """`target` and `independence` are always both present here: this panel
    only exists at all once the expense rate is measurable (otherwise the
    whole `fire` field is None with its own sentence). `independence` carries
    the engine's OWN refusal on its own `unavailable_reason`; `retirement`
    has its own, because a drawdown needs a constituted capital that a
    reachable timeline does not."""

    target: TargetCapitalOut
    independence: IndependenceOut
    retirement: RetirementOut | None
    retirement_unavailable_reason: str | None


# --- French tax (engines.tax_fr).


class TaxRegimeResultOut(BaseModel):
    """One regime's answer on one gain. `regime` is never absent."""

    model_config = ConfigDict(from_attributes=True)

    regime: str
    regime_label: str  # French, printed beside the figure.
    gross_gain_cents: int
    income_tax_cents: int
    social_levies_cents: int
    total_tax_cents: int
    net_gain_cents: int


class TaxAccountOut(BaseModel):
    """The latent gain inside ONE envelope, taxed under the regime that
    envelope's own `kind` and `opened_on` select.

    Per account and never merged into one number: a PEA past five years, a
    CTO and an eight-year assurance-vie owe three different amounts on the
    same gain, and a single total would name none of the three.
    """

    account_id: int
    account_name: str
    account_kind: str
    opened_on: date | None
    positions_total: int
    positions_valued: int
    # All None together when `unavailable_reason` is set.
    unrealised_gain_cents: int | None
    regime: str | None
    regime_label: str | None
    income_tax_cents: int | None
    social_levies_cents: int | None
    total_tax_cents: int | None
    net_gain_cents: int | None
    # PEA only: whether article 157, 5° bis CGI's exemption applied.
    exempt: bool | None
    # PEA and assurance-vie only: whole years since `opened_on`.
    years_held: int | None
    # Assurance-vie only: article 125-0 A, I CGI's allowance, against the
    # INCOME TAX base alone.
    abatement_applied_cents: int | None
    # The barème priced on the identical gain, when a marginal rate was
    # supplied. None means it was never asked for -- never that it costs zero.
    alternative: TaxRegimeResultOut | None
    unavailable_reason: str | None


class TaxOut(BaseModel):
    total_unrealised_gain_cents: int
    # Summed over the accounts that could be taxed. `accounts_unavailable`
    # counts those that could not, so a screen never presents a partial total
    # as a complete bill.
    total_tax_cents: int
    accounts_unavailable: int
    accounts: list[TaxAccountOut]
    # "pfu" | "bareme" on the aggregate ordinary gain, or None when no
    # marginal rate was supplied. Facts side by side, never a recommendation
    # Yieldo is not licensed to make.
    cheaper: str | None


# --- Stress tests (engines.stress).


class StressShockOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    key: str
    label: str
    period: str
    source: str
    impact_bps_by_asset_class: dict[str, int]


class StressClassImpactOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    asset_class: str
    current_value_cents: int
    # Both None together when this shock has no data for `asset_class` --
    # Bitcoin in 2008, an ETF in any of the three. Never folded in at 0 %.
    impact_bps: int | None
    stressed_value_cents: int | None


class StressScenarioOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    shock: StressShockOut
    portfolio_value_cents: int
    stressable_value_cents: int
    stressed_value_cents: int
    impact_cents: int
    impact_bps: int
    by_class: list[StressClassImpactOut]
    classes_without_data: list[str]


class StressOut(BaseModel):
    """`shocks` is always the three episodes, with their periods and their
    published sources, even when `scenarios` is empty -- see the module
    docstring."""

    shocks: list[StressShockOut]
    scenarios: list[StressScenarioOut]


# --- The whole answer.


class ProjectionOut(BaseModel):
    as_of: date
    reporting_currency: str
    assumptions: ProjectionAssumptionsOut
    months_observed: int
    # Signed. None when fewer than three complete months were observed.
    capacity: MeasuredRateOut | None
    capacity_unavailable_reason: str | None
    expense_rate: MeasuredRateOut | None
    portfolio: ProjectionPortfolioOut

    monte_carlo: MonteCarloOut | None
    monte_carlo_unavailable_reason: str | None

    fire: FireOut | None
    fire_unavailable_reason: str | None

    tax: TaxOut | None
    tax_unavailable_reason: str | None

    stress: StressOut
    stress_unavailable_reason: str | None
