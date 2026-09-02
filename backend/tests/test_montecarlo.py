from datetime import date

import pytest

from app.engines.montecarlo import (
    MAX_PROJECTION_MONTHS,
    MAX_TRIALS,
    percentile_cents,
    project_monte_carlo,
)
from app.engines.savings import project_savings

TODAY = date(2026, 8, 12)


# --- percentile_cents: the empirical-band primitive, tested in isolation
# --- from any randomness so a wrong FORMULA is caught independent of a
# --- wrong random draw.


def test_percentile_cents_interpolates_between_the_two_bracketing_values():
    """[100, 200, 300, 400, 500] c. P0 and P100 land exactly on the ends;
    P50 lands exactly on the middle element; P10 does NOT land on a sample
    member at all -- rank = 0.10 * 4 = 0.4, so the true answer is 40 % of
    the way from 100 to 200, i.e. 140. An implementation that used
    nearest-rank would answer 100 here, and one that returned the sample
    MEAN regardless of `p` would answer 300 for every call in this test --
    both are caught by asserting three different `p` values against three
    different, hand-computed answers."""
    sample = [100, 200, 300, 400, 500]
    assert percentile_cents(sample, 0) == 100
    assert percentile_cents(sample, 100) == 500
    assert percentile_cents(sample, 50) == 300
    assert percentile_cents(sample, 10) == 140


def test_percentile_cents_of_a_single_value_ignores_the_requested_percentile():
    assert percentile_cents([500], 10) == 500
    assert percentile_cents([500], 90) == 500


def test_percentile_cents_refuses_an_empty_sample():
    with pytest.raises(ValueError, match="échantillon vide"):
        percentile_cents([], 50)


# --- Reproducibility: the seed is the whole point.


def test_a_seeded_run_is_exactly_reproducible():
    kwargs = dict(
        initial_cents=1_000_000, monthly_cents=20_000, annual_return_bps=600,
        annual_volatility_bps=1500, months=24, today=TODAY, seed=42, trials=200,
    )
    first = project_monte_carlo(**kwargs)
    second = project_monte_carlo(**kwargs)
    assert first == second


def test_the_seed_is_carried_in_the_output():
    result = project_monte_carlo(
        initial_cents=100_000, monthly_cents=0, annual_return_bps=500,
        annual_volatility_bps=1000, months=6, today=TODAY, seed=12345, trials=50,
    )
    assert result.assumptions.seed == 12345


def test_two_different_seeds_diverge_when_volatility_is_positive():
    """A single trial each: the whole trajectory is decided by the one
    seed. If the RNG were silently ignored (e.g. a bug that always used the
    mean return), both runs would produce the identical figure and this
    would fail -- proving the seed is actually consumed, not just echoed."""
    common = dict(
        initial_cents=1_000_000, monthly_cents=10_000, annual_return_bps=700,
        annual_volatility_bps=2000, months=36, today=TODAY, trials=1,
    )
    a = project_monte_carlo(seed=1, **common)
    b = project_monte_carlo(seed=2, **common)
    assert a.points[-1].percentiles_cents[50] != b.points[-1].percentiles_cents[50]


def test_reproducibility_holds_across_a_larger_multi_trial_run():
    kwargs = dict(
        initial_cents=5_000_000, monthly_cents=-30_000, annual_return_bps=400,
        annual_volatility_bps=1800, months=60, today=TODAY, seed=777, trials=300,
    )
    assert project_monte_carlo(**kwargs) == project_monte_carlo(**kwargs)


# --- Zero volatility: deterministic, verified against `savings.py` itself.


def test_zero_volatility_matches_the_deterministic_savings_projection():
    """The self-review's own scenario: zero volatility, and (via `trials=1`)
    one trajectory. While the balance never goes negative, this module's
    per-month growth formula is IDENTICAL to `savings.project_savings`'s --
    both compute `cents(Decimal(balance) * rate)` on the opening balance --
    so the two engines must agree exactly, month by month. This is a
    cross-engine anchor no synthetic fixture could provide: it kills any
    accidental drift in the growth formula itself, not just a wrong
    aggregation of it."""
    savings_reference = project_savings(100_000, 0, 1200, 2)
    result = project_monte_carlo(
        initial_cents=100_000, monthly_cents=0, annual_return_bps=1200,
        annual_volatility_bps=0, months=2, today=TODAY, seed=1, trials=1,
    )
    assert [point.percentiles_cents[50] for point in result.points] == [
        point.balance_cents for point in savings_reference.points
    ]
    # All three requested percentiles must agree too, on a single trial --
    # a wrong percentile formula could produce three different answers even
    # from an already-correct single trajectory.
    assert result.points[-1].percentiles_cents[10] == savings_reference.final_cents
    assert result.points[-1].percentiles_cents[90] == savings_reference.final_cents


def test_zero_volatility_with_many_trials_still_agrees_trial_to_trial():
    """With no randomness at all, every trial follows the identical path --
    so P10, P50 and P90 must coincide at every month, not merely at the
    last one."""
    result = project_monte_carlo(
        initial_cents=200_000, monthly_cents=5_000, annual_return_bps=300,
        annual_volatility_bps=0, months=12, today=TODAY, seed=9, trials=50,
    )
    for point in result.points:
        values = set(point.percentiles_cents.values())
        assert len(values) == 1


def test_a_negative_annual_return_is_accepted_not_refused():
    """`savings.project_savings` refuses a negative rate outright -- a
    savings account's rate cannot sensibly be negative. This module MUST
    accept one: a Monte Carlo run exists to explore a bear market the
    household did not choose. Zero volatility keeps the trajectory
    hand-verifiable: -5 %/an on 100 000 c compounds monthly, so month 1's
    exact rate is -500/10000/12 = -0.0041666..., giving `cents(100_000 *
    -0.0041666...) == -417`, and the balance actually falls."""
    result = project_monte_carlo(
        initial_cents=100_000, monthly_cents=0, annual_return_bps=-500,
        annual_volatility_bps=0, months=3, today=TODAY, seed=1, trials=1,
    )
    balances = [point.percentiles_cents[50] for point in result.points]
    assert balances[0] == 100_000 - 417
    assert balances[0] > balances[1] > balances[2]


# --- No clamp: the phase 2A defect, on the record, never repeated.


def test_a_percentile_that_goes_negative_stays_negative():
    """100 000 c initial, a 50 000 c/month WITHDRAWAL (negative
    contribution), no growth at all: the balance is 100 000, then 50 000,
    then 0, then -50 000, then -100 000, then -150 000 -- hand-computable
    exactly since there is no randomness to interpolate around. A clamp
    (`max(0, balance)`) would report 0 for the last three months instead of
    the true, negative shortfall -- exactly the phase 2A defect this
    module's docstring is written against."""
    result = project_monte_carlo(
        initial_cents=100_000, monthly_cents=-50_000, annual_return_bps=0,
        annual_volatility_bps=0, months=6, today=TODAY, seed=1, trials=1,
    )
    balances = [point.percentiles_cents[50] for point in result.points]
    assert balances == [50_000, 0, -50_000, -100_000, -150_000, -200_000]


def test_growth_still_applies_to_an_already_negative_balance():
    """Once a trial's balance has gone negative, it must keep compounding
    at the SAME rate -- never freeze, and never earn nothing the way
    `savings.project_savings` deliberately does for a non-positive balance.
    Month 1: 0 - 10 000 (assumption: no growth on a starting balance of
    exactly 0) = -10 000. Month 2's growth is then `cents(-10_000 * rate)`
    with rate = 1200/10000/12 = 0.01 exactly: growth = -100, so the balance
    becomes -10_000 - 100 - 10_000 = -20_100, NOT a flat -20_000 a
    zero-floor-on-growth bug would produce."""
    result = project_monte_carlo(
        initial_cents=0, monthly_cents=-10_000, annual_return_bps=1200,
        annual_volatility_bps=0, months=2, today=TODAY, seed=1, trials=1,
    )
    balances = [point.percentiles_cents[50] for point in result.points]
    assert balances == [-10_000, -20_100]


# --- Bands are genuine bands, not a repeated median.


def test_percentile_bands_are_genuinely_distinct_when_volatility_is_positive():
    """Real dispersion, many trials: a wrong implementation that returns the
    mean (or the median) for every requested percentile -- collapsing the
    band into a single repeated number -- fails this immediately, since a
    real empirical P10/P50/P90 over 400 independent trials with meaningful
    volatility essentially never tie."""
    result = project_monte_carlo(
        initial_cents=2_000_000, monthly_cents=50_000, annual_return_bps=600,
        annual_volatility_bps=1800, months=60, today=TODAY, seed=2024, trials=400,
    )
    last = result.points[-1].percentiles_cents
    assert last[10] < last[50] < last[90]


# --- Validation.


def test_negative_volatility_is_refused():
    with pytest.raises(ValueError, match="volatilité"):
        project_monte_carlo(
            initial_cents=0, monthly_cents=0, annual_return_bps=500,
            annual_volatility_bps=-1, months=12, today=TODAY, seed=1,
        )


def test_months_outside_the_bound_are_refused():
    with pytest.raises(ValueError, match="durée"):
        project_monte_carlo(
            initial_cents=0, monthly_cents=0, annual_return_bps=500,
            annual_volatility_bps=1000, months=0, today=TODAY, seed=1,
        )
    with pytest.raises(ValueError, match="durée"):
        project_monte_carlo(
            initial_cents=0, monthly_cents=0, annual_return_bps=500,
            annual_volatility_bps=1000, months=MAX_PROJECTION_MONTHS + 1, today=TODAY, seed=1,
        )


def test_trials_outside_the_bound_are_refused():
    with pytest.raises(ValueError, match="trajectoires"):
        project_monte_carlo(
            initial_cents=0, monthly_cents=0, annual_return_bps=500,
            annual_volatility_bps=1000, months=12, today=TODAY, seed=1, trials=0,
        )
    with pytest.raises(ValueError, match="trajectoires"):
        project_monte_carlo(
            initial_cents=0, monthly_cents=0, annual_return_bps=500,
            annual_volatility_bps=1000, months=12, today=TODAY, seed=1,
            trials=MAX_TRIALS + 1,
        )


def test_a_single_trial_is_a_valid_projection_not_a_refusal():
    """One trajectory is a legitimate, if uninformative, Monte Carlo run --
    the self-review's own scenario. It must not be refused."""
    result = project_monte_carlo(
        initial_cents=100_000, monthly_cents=0, annual_return_bps=500,
        annual_volatility_bps=1000, months=6, today=TODAY, seed=1, trials=1,
    )
    assert len(result.points) == 6


def test_empty_percentiles_are_refused():
    with pytest.raises(ValueError, match="centile"):
        project_monte_carlo(
            initial_cents=0, monthly_cents=0, annual_return_bps=500,
            annual_volatility_bps=1000, months=12, today=TODAY, seed=1, percentiles=(),
        )


def test_duplicate_percentiles_are_refused():
    with pytest.raises(ValueError, match="distincts"):
        project_monte_carlo(
            initial_cents=0, monthly_cents=0, annual_return_bps=500,
            annual_volatility_bps=1000, months=12, today=TODAY, seed=1,
            percentiles=(50, 50),
        )


def test_percentiles_out_of_order_are_refused():
    with pytest.raises(ValueError, match="croissant"):
        project_monte_carlo(
            initial_cents=0, monthly_cents=0, annual_return_bps=500,
            annual_volatility_bps=1000, months=12, today=TODAY, seed=1,
            percentiles=(90, 10),
        )


def test_a_percentile_outside_zero_to_a_hundred_is_refused():
    with pytest.raises(ValueError, match="0 et 100"):
        project_monte_carlo(
            initial_cents=0, monthly_cents=0, annual_return_bps=500,
            annual_volatility_bps=1000, months=12, today=TODAY, seed=1,
            percentiles=(10, 101),
        )


# --- The assumptions travel back out whole, for the screen.


def test_every_assumption_is_republished_on_the_result():
    result = project_monte_carlo(
        initial_cents=1_000_000, monthly_cents=25_000, annual_return_bps=550,
        annual_volatility_bps=1400, months=18, today=TODAY, seed=99, trials=150,
        percentiles=(5, 50, 95),
    )
    assert result.assumptions.annual_return_bps == 550
    assert result.assumptions.annual_volatility_bps == 1400
    assert result.assumptions.monthly_cents == 25_000
    assert result.assumptions.trials == 150
    assert result.assumptions.percentiles == (5, 50, 95)
    assert set(result.points[0].percentiles_cents) == {5, 50, 95}


def test_horizon_end_on_is_the_last_day_of_the_final_month():
    """`month_end`'s own convention, shared with `feasibility.assess_
    feasibility`: month 1 of a projection anchored on 15 January is the
    month AFTER January, since a fraction of the anchor month has already
    elapsed -- so a one-month projection from 15 January ends 28 February,
    not 31 January."""
    result = project_monte_carlo(
        initial_cents=0, monthly_cents=0, annual_return_bps=500,
        annual_volatility_bps=1000, months=1, today=date(2026, 1, 15), seed=1,
    )
    assert result.horizon_end_on == date(2026, 2, 28)
