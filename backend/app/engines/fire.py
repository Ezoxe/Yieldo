"""FIRE (Financial Independence, Retire Early): the target capital a stated
withdrawal rate implies, how many months of the measured savings capacity it
takes to reach it, and a retirement drawdown projection net of tax.

Phase 3 plan Task 13. Pure: no session, no network, no implicit clock --
`today` is a parameter, exactly like every other engine in this codebase.

**The withdrawal rate is an assumption, not a measurement, and it is
displayed beside every figure it produced.** Design §10's own rule, taken
literally: `compute_target_capital`, `project_independence` and
`project_retirement` each republish `withdrawal_rate_bps` (and, where it
applies, `annual_return_bps`) on their own result, so no figure in this
module is ever read on a screen without the assumption that produced it
sitting right beside it.

**The operator's measured savings capacity is -74 619 c/month. Negative.**
`project_independence` is built around that fact, not as an edge case bolted
on afterward. **No `abs()` and no clamp is applied to `capacity.median_cents`
anywhere in this module** -- a standing prohibition carried over from
`engines.feasibility` and `engines.goal`, which make the identical promise
for the identical reason: `abs()` would report the operator's shrinking
capacity as a healthy positive rate, and `max(0, ...)` would report a
household standing still when it is in fact going backwards. Both are the
kind of confident-looking falsehood this project keeps finding in review.

**Years to independence is `None`, never a number, when it has no answer.**
Three genuinely different causes share that `None`, exactly like `engines.
goal.evaluate_goals`'s four-cause refusal does, and each gets its OWN French
sentence rather than a generic "aucune donnée" -- the capacity could not be
measured at all (fewer than three complete months), the capacity IS measured
and is negative or zero (the operator's own case: independence is not
approaching slowly, it is receding), or the capacity is measured and
positive but the target lies beyond `savings.MAX_PROJECTION_MONTHS`. A
household told the wrong one of these three would take the wrong action.

**The retirement projection tracks a cost basis, so only the GAIN portion of
each withdrawal is taxed -- never the whole withdrawal.** French tax law
never taxes the return of one's own principal, only the gain realised on
top of it; taxing every euro withdrawn would overstate the bill on every
single month of retirement. This module has no per-lot history for the
retirement pot as a whole (it is the OUTPUT of a plan, not a `Position`), so
it makes one stated, simplifying assumption: the ENTIRE starting balance is
treated as contributed capital (cost basis) on day one, and each
withdrawal's gain fraction is `(balance - cost_basis) / balance` at the
moment it is drawn -- the same pro-rata principle article 150-0 D CGI
applies across a fungible holding's lots (`engines.tax_fr.compute_capital_
gain`), carried forward month by month as the pot itself shrinks. The gain
is then taxed through `engines.tax_fr.compute_pfu` / `compute_bareme`
directly, so a change to either module's rates is felt here automatically
rather than duplicated.

**The pot cannot go negative, and this is not the montecarlo-class
prohibition on clamping.** `engines.montecarlo` forbids clamping because a
clamped RISK BAND would hide how bad an outcome could be. Here there is no
band and no risk being hidden: a withdrawal is capped at whatever remains
(`min(target_withdrawal, balance)`), exactly the way `amortization.
build_schedule` resizes a loan's final instalment rather than letting the
remaining balance overshoot below zero -- a household cannot spend a euro
its account does not hold, and the projection stops (`exhausted_at_month`)
rather than reporting a fictitious negative balance a real account could
never reach.

Pure: no session, no network, no implicit clock.
"""

from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from app.engines.amortization import cents, monthly_rate
from app.engines.capacity import MeasuredRate
from app.engines.period import month_end
from app.engines.savings import MAX_PROJECTION_MONTHS, months_to_target
from app.engines.tax_fr import compute_bareme, compute_pfu

_BPS = Decimal(10_000)
_MONTHS_PER_YEAR = Decimal(12)

__all__ = [
    "MAX_PROJECTION_MONTHS",
    "IndependenceProjection",
    "RetirementPoint",
    "RetirementProjection",
    "TargetCapital",
    "compute_target_capital",
    "project_independence",
    "project_retirement",
]


def _validate_withdrawal_rate_bps(withdrawal_rate_bps: int) -> None:
    if not 0 < withdrawal_rate_bps <= 10_000:
        raise ValueError(
            "Le taux de retrait doit être strictement positif et ne peut pas "
            "dépasser 100 % (10 000 points de base)."
        )


@dataclass(frozen=True)
class TargetCapital:
    annual_expenses_cents: int
    withdrawal_rate_bps: int
    target_capital_cents: int


def compute_target_capital(annual_expenses_cents: int, withdrawal_rate_bps: int) -> TargetCapital:
    """The capital a stated withdrawal rate implies for a given annual
    spend: `annual_expenses / withdrawal_rate` -- the "règle des 4 %"
    generalised to whatever rate the household actually states, never a
    rate this module invents on their behalf. A rate of exactly 0 is refused
    rather than producing an infinite target."""
    _validate_withdrawal_rate_bps(withdrawal_rate_bps)
    if annual_expenses_cents < 0:
        raise ValueError("Les dépenses annuelles ne peuvent pas être négatives.")
    target = cents(Decimal(annual_expenses_cents) * _BPS / Decimal(withdrawal_rate_bps))
    return TargetCapital(
        annual_expenses_cents=annual_expenses_cents, withdrawal_rate_bps=withdrawal_rate_bps,
        target_capital_cents=target,
    )


def _reason_capacity_unmeasurable() -> str:
    return (
        "Votre capacité d'épargne n'a pas pu être mesurée : il faut au moins "
        "trois mois complets de relevés. Sans elle, aucun délai vers "
        "l'indépendance financière ne peut être avancé."
    )


def _reason_capacity_not_positive() -> str:
    """The operator's own state: -74 619 c/month. Worded so it is true of
    EVERY non-positive capacity, zero included -- a household saving exactly
    nothing every month is not "one month away", it is in the identical
    position as one going backwards: neither is approaching independence at
    all."""
    return (
        "Votre capacité d'épargne mesurée est négative ou nulle : à ce rythme, "
        "l'indépendance financière ne se rapproche pas, elle recule ou stagne. "
        "Aucun délai ne peut être avancé tant que la capacité n'est pas "
        "redevenue positive."
    )


def _reason_too_far() -> str:
    return (
        f"Au rythme mesuré, le capital cible ne serait pas atteint avant "
        f"{MAX_PROJECTION_MONTHS // 12} ans. Aucun délai n'est avancé "
        "au-delà : il ne voudrait rien dire."
    )


@dataclass(frozen=True)
class IndependenceProjection:
    target_capital_cents: int
    current_capital_cents: int
    withdrawal_rate_bps: int
    annual_return_bps: int
    # Republished untouched -- see the module docstring on why its sign is
    # never altered here.
    capacity: MeasuredRate | None
    months_to_independence: int | None
    independent_on: date | None
    # French. Set exactly when `months_to_independence` is None, and names
    # WHICH of three causes applies. Never two at once.
    unavailable_reason: str | None


def project_independence(
    target_capital_cents: int, current_capital_cents: int, capacity: MeasuredRate | None,
    annual_return_bps: int, withdrawal_rate_bps: int, today: date,
) -> IndependenceProjection:
    """How many months of `capacity.median_cents`, compounding at
    `annual_return_bps`, it takes `current_capital_cents` to reach
    `target_capital_cents` -- through `savings.months_to_target` directly,
    so this module's growth arithmetic can never drift from that one's.
    """
    reason: str | None
    months: int | None

    if capacity is None:
        reason, months = _reason_capacity_unmeasurable(), None
    elif capacity.median_cents <= 0:
        reason, months = _reason_capacity_not_positive(), None
    else:
        computed = months_to_target(
            target_capital_cents, current_capital_cents, capacity.median_cents,
            annual_return_bps,
        )
        if computed is None:
            reason, months = _reason_too_far(), None
        else:
            reason, months = None, computed

    return IndependenceProjection(
        target_capital_cents=target_capital_cents, current_capital_cents=current_capital_cents,
        withdrawal_rate_bps=withdrawal_rate_bps, annual_return_bps=annual_return_bps,
        capacity=capacity, months_to_independence=months,
        independent_on=None if months is None else month_end(today, months),
        unavailable_reason=reason,
    )


@dataclass(frozen=True)
class RetirementPoint:
    month: int
    # AFTER this month's growth and this month's withdrawal.
    balance_cents: int
    gross_withdrawal_cents: int
    # The portion of `gross_withdrawal_cents` this module treats as a
    # realised gain -- see the module docstring's cost-basis assumption.
    taxable_gain_cents: int
    tax_cents: int
    net_withdrawal_cents: int  # gross_withdrawal_cents - tax_cents: spendable.


@dataclass(frozen=True)
class RetirementProjection:
    initial_cents: int
    annual_return_bps: int
    withdrawal_rate_bps: int
    # "pfu" or "bareme" -- which `engines.tax_fr` regime taxed every
    # withdrawal's gain portion in this projection.
    tax_regime: str
    marginal_rate_bps: int | None
    months: int
    points: list[RetirementPoint]
    # None when the pot survives the whole requested horizon.
    exhausted_at_month: int | None
    horizon_end_on: date


def _validate_retirement(initial_cents: int, annual_return_bps: int, months: int) -> None:
    if initial_cents < 0:
        raise ValueError("Le capital de départ ne peut pas être négatif.")
    if annual_return_bps < 0:
        raise ValueError("Le taux de rendement ne peut pas être négatif.")
    if not 1 <= months <= MAX_PROJECTION_MONTHS:
        raise ValueError(
            f"La durée d'une projection doit être comprise entre 1 et "
            f"{MAX_PROJECTION_MONTHS} mois."
        )


def project_retirement(
    initial_cents: int, annual_return_bps: int, withdrawal_rate_bps: int, months: int,
    today: date, marginal_rate_bps: int | None = None,
) -> RetirementProjection:
    """A monthly drawdown of `initial_cents` at `withdrawal_rate_bps`
    annually (`initial_cents * withdrawal_rate_bps / 12`, held constant --
    the classic fixed-withdrawal FIRE rule, not a moving percentage of a
    shrinking balance), growing at `annual_return_bps`, taxed month by month
    on the gain portion of what is actually withdrawn -- see the module
    docstring.

    PFU by default; supplying `marginal_rate_bps` prices the barème option
    instead, on every month's own taxable gain.
    """
    _validate_retirement(initial_cents, annual_return_bps, months)
    _validate_withdrawal_rate_bps(withdrawal_rate_bps)

    rate = monthly_rate(annual_return_bps)
    monthly_withdrawal_target = cents(
        Decimal(initial_cents) * Decimal(withdrawal_rate_bps) / _BPS / _MONTHS_PER_YEAR
    )

    balance = initial_cents
    # The whole starting pot, treated as contributed capital on day one --
    # the module docstring's stated simplifying assumption.
    cost_basis = initial_cents

    points: list[RetirementPoint] = []
    exhausted_at: int | None = None

    for month in range(1, months + 1):
        growth = cents(Decimal(balance) * rate) if balance > 0 else 0
        balance += growth

        withdrawal = min(monthly_withdrawal_target, balance) if balance > 0 else 0
        if withdrawal > 0:
            gain_fraction = Decimal(max(0, balance - cost_basis)) / Decimal(balance)
            taxable_gain = cents(Decimal(withdrawal) * gain_fraction)
            cost_withdrawn = withdrawal - taxable_gain
        else:
            taxable_gain = 0
            cost_withdrawn = 0

        tax_result = (
            compute_bareme(taxable_gain, marginal_rate_bps) if marginal_rate_bps is not None
            else compute_pfu(taxable_gain)
        )
        tax = tax_result.total_tax_cents

        balance -= withdrawal
        cost_basis = max(0, cost_basis - cost_withdrawn)

        points.append(RetirementPoint(
            month=month, balance_cents=balance, gross_withdrawal_cents=withdrawal,
            taxable_gain_cents=taxable_gain, tax_cents=tax,
            net_withdrawal_cents=withdrawal - tax,
        ))

        if balance == 0:
            exhausted_at = month
            break

    return RetirementProjection(
        initial_cents=initial_cents, annual_return_bps=annual_return_bps,
        withdrawal_rate_bps=withdrawal_rate_bps,
        tax_regime="bareme" if marginal_rate_bps is not None else "pfu",
        marginal_rate_bps=marginal_rate_bps, months=months, points=points,
        exhausted_at_month=exhausted_at, horizon_end_on=month_end(today, months),
    )
