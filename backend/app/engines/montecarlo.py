"""Monte Carlo projection of an investment balance under randomised monthly
returns.

Phase 3 plan Task 11. Pure: no session, no network, no implicit clock --
`today` is a parameter, exactly like every other engine in this codebase.
Randomness is the one place this module looks different from its neighbours,
and it is deliberately NOT implicit either: `seed` is a required parameter,
never generated internally from OS entropy or the clock, and it is echoed
back on `MonteCarloProjection.assumptions.seed`. A run whose seed nobody
wrote down cannot be reproduced, and "trust me, that is what it showed" is
not evidence this project accepts -- see `test_a_seeded_run_is_exactly_
reproducible`, which runs the identical call twice and asserts the two
results are equal down to every field.

**Percentile bands, never a single number.** Every point of `MonteCarloProjection.
points` carries several percentiles (`percentiles_cents`, by default P10/P50/
P90) computed EMPIRICALLY across the simulated trials at that month --
`percentile_cents` on the sorted sample, never a formula band derived from a
theoretical distribution's shape. The trials themselves ARE the distribution
this module is asked to describe, compounding and randomness both included,
so nothing here re-derives a band from a mean and a standard deviation the
way `engines.robust.quantile_offset_cents` does for a MEASURED expense rate --
that shortcut would silently discard the skew compounding introduces.

**A percentile that goes negative stays negative.** Phase 2A shipped a
forecast band anchored at zero -- a floor that read as "you cannot go
negative" and silently erased the very overdraft risk the band existed to
show. That defect is on the record and nothing here repeats it: no `max(0,
...)`, no clamp, on a trial's balance, on a percentile, or on the growth
applied to a negative balance. A portfolio drawn down by a withdrawal larger
than it can sustain (this module's `monthly_cents` takes its sign like
`savings.project_savings`'s does, so a retirement drawdown is a negative
`monthly_cents`) exhausts itself and keeps going, and a P10 trajectory
reading -12 345,67 EUR at month 240 is the correct, honest answer, not a
bug to hide.

**This is where this module deliberately diverges from `engines.savings`.**
`project_savings` credits interest to a positive balance only -- a bank
deposit cannot earn a return on an overdraft it does not hold, and that is a
correct model of a SAVINGS ACCOUNT. This module models an INVESTED balance
instead, and applies the SAME randomised monthly return to it regardless of
sign, unconditionally, every month, for every trial. There is no branch on
`balance > 0` anywhere below, on purpose: adding one would silently
reintroduce the exact zero-floor defect the paragraph above describes, just
moved one level down from the band into the per-trial mechanics that produce
it.

**`annual_return_bps` may be negative, and is never refused for it** --
the other deliberate divergence from `engines.savings._validate_rate`, which
DOES refuse a negative rate because a savings account's stated rate cannot
sensibly be negative. A Monte Carlo run exists specifically to explore
scenarios a household did not choose, including a sustained bear market;
refusing to model one would defeat half the reason this module exists.
`annual_volatility_bps`, by contrast, IS refused when negative: a standard
deviation is a magnitude, and a negative one is not a stricter assumption,
it is a nonsense one.

**Monthly returns are drawn from a normal distribution** whose mean and
standard deviation are both stated by the caller (`annual_return_bps`,
`annual_volatility_bps`) -- never measured, exactly like `savings.
DEFAULT_ANNUAL_RETURN_BPS`: this module has no ledger to measure a real
portfolio's volatility from. Both travel back out on `MonteCarloAssumptions`
so a screen can print them beside every figure they produced (design §10).
The annual volatility is scaled to a monthly one by `sqrt(12)`, the standard
assumption for an uncorrelated monthly random walk; `annual_volatility_bps
== 0` skips the random draw entirely and uses the exact monthly rate
`amortization.monthly_rate` computes, so a zero-volatility run is bit-exact
and reproducible independent of Python's `random.gauss` implementation, and
identical, verifiably by hand, to what `savings.project_savings` computes
over the same never-negative balance (see `test_zero_volatility_matches_
the_deterministic_savings_projection`).

Pure: no session, no network, no implicit clock.
"""

from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal
from math import sqrt
from random import Random

from app.engines.amortization import cents, monthly_rate
from app.engines.period import month_end
from app.engines.savings import MAX_PROJECTION_MONTHS

# A random walk's variance scales with time, so its standard deviation scales
# with the square root of time: an ANNUAL volatility is divided by this to
# reach the MONTHLY one that actually feeds a single month's draw.
_MONTHLY_VOLATILITY_SCALE = sqrt(12)

_BPS = Decimal(10_000)

# Bounds compute, not correctness: a browser's fan chart does not read
# meaning into a five-thousandth trial, and a projection past the fifty-year
# bound every other projection engine in this codebase shares is noise, not
# a longer answer. `MAX_PROJECTION_MONTHS` is re-exported from `savings`
# rather than redeclared, so the two bounds cannot drift apart.
MAX_TRIALS = 5_000
DEFAULT_TRIALS = 1_000
DEFAULT_PERCENTILES = (10, 50, 90)

__all__ = [
    "DEFAULT_PERCENTILES",
    "DEFAULT_TRIALS",
    "MAX_PROJECTION_MONTHS",
    "MAX_TRIALS",
    "MonteCarloAssumptions",
    "MonteCarloPoint",
    "MonteCarloProjection",
    "percentile_cents",
    "project_monte_carlo",
]


def percentile_cents(sorted_values: list[int], p: int) -> int:
    """The `p`-th percentile of an already-sorted sample of integer cents,
    by linear interpolation between the two bracketing order statistics --
    the same convention `numpy.percentile`'s default ("linear") method uses,
    chosen so this module's bands do not invent a data point nearest-rank
    interpolation would (a P90 that happens to fall exactly on a sample
    member) nor understate the sample's own spread the way a coarser method
    would.

    `sorted_values` must already be sorted ascending and non-empty -- the
    caller (`project_monte_carlo`) always hands in a freshly sorted list of
    one trial per element, so re-sorting here on every one of `months` calls
    would be pure waste. A single-element sample returns that element
    regardless of `p`: there is only one order statistic to interpolate
    between, which is the `trials == 1` case `project_monte_carlo` itself
    accepts (see the module docstring on "a single trajectory").
    """
    if not sorted_values:
        raise ValueError("Le centile d'un échantillon vide n'existe pas.")
    if len(sorted_values) == 1:
        return sorted_values[0]
    rank = Decimal(p) / Decimal(100) * Decimal(len(sorted_values) - 1)
    lower_index = int(rank // 1)
    fraction = rank - lower_index
    lower = Decimal(sorted_values[lower_index])
    if fraction == 0:
        return cents(lower)
    upper = Decimal(sorted_values[lower_index + 1])
    return cents(lower + (upper - lower) * fraction)


@dataclass(frozen=True)
class MonteCarloAssumptions:
    """Every hypothesis this projection rests on, in one place, so a screen
    can print them beside the result -- design §10. `seed` is the one field
    with no everyday French label: it is printed as-is, the number a support
    conversation or a bug report can quote to reproduce the exact same run.
    """

    annual_return_bps: int
    annual_volatility_bps: int
    monthly_cents: int
    trials: int
    seed: int
    percentiles: tuple[int, ...]


@dataclass(frozen=True)
class MonteCarloPoint:
    month: int
    # Keyed by the requested percentile (10, 50, 90 by default), in the same
    # ascending order `MonteCarloAssumptions.percentiles` states them in.
    # Never a single figure -- see the module docstring.
    percentiles_cents: dict[int, int] = field(default_factory=dict)


@dataclass(frozen=True)
class MonteCarloProjection:
    initial_cents: int
    months: int
    assumptions: MonteCarloAssumptions
    points: list[MonteCarloPoint]
    horizon_end_on: date


def _validate(
    annual_volatility_bps: int, months: int, trials: int, percentiles: tuple[int, ...]
) -> None:
    # `annual_return_bps` is deliberately NOT checked here -- see the module
    # docstring on why a negative one is a legitimate scenario, not an error.
    if annual_volatility_bps < 0:
        raise ValueError("La volatilité annuelle ne peut pas être négative.")
    if not 1 <= months <= MAX_PROJECTION_MONTHS:
        raise ValueError(
            f"La durée d'une projection doit être comprise entre 1 et "
            f"{MAX_PROJECTION_MONTHS} mois."
        )
    if not 1 <= trials <= MAX_TRIALS:
        raise ValueError(
            f"Le nombre de trajectoires simulées doit être compris entre 1 et {MAX_TRIALS}."
        )
    if not percentiles:
        raise ValueError("Au moins un centile doit être demandé.")
    if len(set(percentiles)) != len(percentiles):
        raise ValueError("Les centiles demandés doivent être distincts.")
    if list(percentiles) != sorted(percentiles):
        raise ValueError("Les centiles demandés doivent être fournis dans l'ordre croissant.")
    for p in percentiles:
        if not 0 <= p <= 100:
            raise ValueError(f"Un centile doit être compris entre 0 et 100 : {p}.")


def _monthly_volatility(annual_volatility_bps: int) -> float:
    return float(annual_volatility_bps) / float(_BPS) / _MONTHLY_VOLATILITY_SCALE


def _draw_monthly_return(rng: Random, mean: Decimal, stdev: float, deterministic: bool) -> Decimal:
    """One month's randomised return for one trial. `deterministic` skips the
    draw entirely at zero volatility -- see the module docstring on why that
    makes a zero-volatility run bit-exact rather than merely "close"."""
    if deterministic:
        return mean
    # `Decimal(str(...))` funnels the one unavoidable float in this module --
    # a continuous random draw has no exact Decimal source -- through text
    # rather than through the binary float itself, the same discipline every
    # monetary computation in this codebase applies at its own float
    # boundary (`engines.robust`'s constants are the published precedent for
    # a float being fine on a RATE, never on money).
    return Decimal(str(rng.gauss(float(mean), stdev)))


def project_monte_carlo(
    initial_cents: int,
    monthly_cents: int,
    annual_return_bps: int,
    annual_volatility_bps: int,
    months: int,
    today: date,
    seed: int,
    trials: int = DEFAULT_TRIALS,
    percentiles: tuple[int, ...] = DEFAULT_PERCENTILES,
) -> MonteCarloProjection:
    """`trials` independent trajectories, each starting at `initial_cents` and
    receiving `monthly_cents` every month (signed, exactly like `savings.
    project_savings` -- a withdrawal is a negative contribution), growing by
    a randomised monthly return drawn from Normal(`annual_return_bps`/12,
    monthly volatility). Returns the empirical percentile band across all
    trials at every month -- see the module docstring for why this is a band
    and never a single number, and for why a low band is never clamped.
    """
    _validate(annual_volatility_bps, months, trials, percentiles)

    mean = monthly_rate(annual_return_bps)  # Decimal, may be negative -- exact.
    stdev = _monthly_volatility(annual_volatility_bps)
    deterministic = annual_volatility_bps == 0

    rng = Random(seed)
    balances = [initial_cents] * trials
    points: list[MonteCarloPoint] = []

    for month in range(1, months + 1):
        for trial in range(trials):
            balance = balances[trial]
            monthly_return = _draw_monthly_return(rng, mean, stdev, deterministic)
            # No `if balance > 0` guard -- see the module docstring's
            # divergence from `engines.savings`. Growth applies to whatever
            # the balance is, positive, zero or already negative.
            growth = cents(Decimal(balance) * monthly_return)
            balances[trial] = balance + growth + monthly_cents

        ordered = sorted(balances)
        points.append(MonteCarloPoint(
            month=month,
            percentiles_cents={p: percentile_cents(ordered, p) for p in percentiles},
        ))

    return MonteCarloProjection(
        initial_cents=initial_cents,
        months=months,
        assumptions=MonteCarloAssumptions(
            annual_return_bps=annual_return_bps,
            annual_volatility_bps=annual_volatility_bps,
            monthly_cents=monthly_cents,
            trials=trials,
            seed=seed,
            percentiles=percentiles,
        ),
        points=points,
        horizon_end_on=month_end(today, months),
    )
