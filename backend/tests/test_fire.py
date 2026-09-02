from datetime import date

import pytest

from app.engines.capacity import MeasuredRate
from app.engines.fire import (
    MAX_PROJECTION_MONTHS,
    compute_target_capital,
    project_independence,
    project_retirement,
)
from app.engines.savings import months_to_target
from app.engines.tax_fr import compute_bareme, compute_pfu

TODAY = date(2026, 8, 12)


def _rate(median_cents: int) -> MeasuredRate:
    return MeasuredRate(months=12, median_cents=median_cents, spread_cents=5_000,
                        low_cents=median_cents - 5_000, high_cents=median_cents + 5_000)


# --- Target capital: annual expenses / withdrawal rate.


def test_target_capital_is_annual_expenses_over_the_withdrawal_rate():
    """The classic "règle des 4 %" (25x expenses), at a stated rate: 40 000
    EUR/an at 4 % is 1 000 000 EUR."""
    result = compute_target_capital(4_000_000_00, withdrawal_rate_bps=400)
    assert result.target_capital_cents == 100_000_000_00
    assert result.withdrawal_rate_bps == 400  # the assumption travels with the figure
    assert result.annual_expenses_cents == 4_000_000_00


def test_a_withdrawal_rate_of_zero_is_refused():
    """Self-review's own scenario. Dividing by a zero rate would be an
    infinite target capital, not a real answer."""
    with pytest.raises(ValueError, match="strictement positif"):
        compute_target_capital(4_000_000_00, withdrawal_rate_bps=0)


def test_a_negative_withdrawal_rate_is_refused():
    with pytest.raises(ValueError, match="strictement positif"):
        compute_target_capital(4_000_000_00, withdrawal_rate_bps=-1)


def test_a_withdrawal_rate_over_a_hundred_percent_is_refused():
    with pytest.raises(ValueError, match="100"):
        compute_target_capital(4_000_000_00, withdrawal_rate_bps=10_001)


def test_negative_annual_expenses_are_refused():
    with pytest.raises(ValueError, match="dépenses annuelles"):
        compute_target_capital(-1, withdrawal_rate_bps=400)


# --- Years to independence: three distinct refusals, and the operator's own
# --- negative-capacity case as the primary scenario, not an edge case.


def test_independence_refuses_with_its_own_sentence_when_capacity_is_unmeasurable():
    result = project_independence(
        target_capital_cents=100_000_000_00, current_capital_cents=0, capacity=None,
        annual_return_bps=500, withdrawal_rate_bps=400, today=TODAY,
    )
    assert result.months_to_independence is None
    assert result.independent_on is None
    assert "n'a pas pu être mesurée" in result.unavailable_reason


def test_independence_is_no_answer_on_the_operators_own_negative_capacity():
    """Self-review's own scenario: -74 619 c/month, the operator's actual
    measured figure. `abs()` would read this as a healthy positive rate;
    `max(0, ...)` would read it as standing still. Neither happens: the
    capacity travels back out with its sign untouched, and the months figure
    is `None` with its own sentence -- not a very large number of months."""
    capacity = _rate(-74_619)
    result = project_independence(
        target_capital_cents=100_000_000_00, current_capital_cents=0, capacity=capacity,
        annual_return_bps=500, withdrawal_rate_bps=400, today=TODAY,
    )
    assert result.months_to_independence is None
    assert result.independent_on is None
    assert result.capacity.median_cents == -74_619  # untouched -- no abs(), no clamp
    assert "recule ou stagne" in result.unavailable_reason


def test_independence_is_no_answer_on_a_capacity_of_exactly_zero():
    """Self-review's other scenario: zero, not negative -- the SAME refusal,
    since standing still never reaches a target either."""
    result = project_independence(
        target_capital_cents=100_000_000_00, current_capital_cents=0, capacity=_rate(0),
        annual_return_bps=500, withdrawal_rate_bps=400, today=TODAY,
    )
    assert result.months_to_independence is None
    assert "recule ou stagne" in result.unavailable_reason


def test_independence_refuses_beyond_the_fifty_year_bound_with_its_own_sentence():
    """A positive but tiny capacity against a huge target: reachable in
    principle, not within any horizon this engine will project."""
    result = project_independence(
        target_capital_cents=100_000_000_000_00, current_capital_cents=0,
        capacity=_rate(1), annual_return_bps=0, withdrawal_rate_bps=400, today=TODAY,
    )
    assert result.months_to_independence is None
    assert f"{MAX_PROJECTION_MONTHS // 12} ans" in result.unavailable_reason
    # Distinct wording from the negative-capacity case -- the two must never
    # be conflated into "aucune donnée".
    assert "recule" not in result.unavailable_reason


def test_independence_computes_through_savings_months_to_target_directly():
    """A reachable case: the month count must agree EXACTLY with
    `savings.months_to_target` on the identical inputs, since
    `project_independence` is a direct pass-through and must never drift
    from the engine that already owns this arithmetic."""
    capacity = _rate(50_000)
    expected_months = months_to_target(10_000_000, 1_000_000, 50_000, 600)
    result = project_independence(
        target_capital_cents=10_000_000, current_capital_cents=1_000_000, capacity=capacity,
        annual_return_bps=600, withdrawal_rate_bps=400, today=TODAY,
    )
    assert expected_months is not None
    assert result.months_to_independence == expected_months
    assert result.unavailable_reason is None
    from app.engines.period import month_end
    assert result.independent_on == month_end(TODAY, expected_months)


def test_the_assumptions_travel_with_the_independence_figure():
    result = project_independence(
        target_capital_cents=10_000_000, current_capital_cents=1_000_000, capacity=_rate(50_000),
        annual_return_bps=600, withdrawal_rate_bps=350, today=TODAY,
    )
    assert result.withdrawal_rate_bps == 350
    assert result.annual_return_bps == 600


# --- Retirement drawdown: only the gain portion of each withdrawal is
# --- taxed, and the pot cannot go negative.


def test_zero_growth_means_every_withdrawal_is_pure_principal_and_owes_no_tax():
    """No growth at all: every withdrawal is a straight return of the
    household's own capital, never a gain, so `engines.tax_fr` has nothing
    to tax. 1 200 000 c at a 12 %/an withdrawal rate draws 12 000 c/month --
    exactly 100 months to exhaust, to the cent, entirely hand-computable
    since there is no rounding anywhere in this fixture."""
    result = project_retirement(
        initial_cents=1_200_000, annual_return_bps=0, withdrawal_rate_bps=1_200,
        months=120, today=TODAY,
    )
    assert result.exhausted_at_month == 100
    assert len(result.points) == 100  # stops early, never padded -- like amortization.py
    for point in result.points:
        assert point.taxable_gain_cents == 0
        assert point.tax_cents == 0
        assert point.gross_withdrawal_cents == point.net_withdrawal_cents == 12_000
    assert result.points[-1].balance_cents == 0


def test_the_first_months_taxable_gain_and_tax_are_exact_to_the_cent():
    """10 000 000 c at 12 %/an return AND 12 %/an withdrawal (monthly rate
    exactly 1 %). Month 1: growth = 100 000 c, balance = 10 100 000 c,
    withdrawal = 100 000 c. The gain fraction of that withdrawal is
    100 000 / 10 100 000 = 1/101 = 0,0990099...; taxable gain =
    100 000 * 1/101 = 990,0990... c, rounding HALF UP to 990 c. PFU on
    990 c: income tax = round(990 * 12,80 %) = 127 c, social levies =
    round(990 * 17,20 %) = 170 c, total 297 c -- so net withdrawal is
    100 000 - 297 = 99 703 c."""
    result = project_retirement(
        initial_cents=10_000_000, annual_return_bps=1_200, withdrawal_rate_bps=1_200,
        months=1, today=TODAY,
    )
    [point] = result.points
    assert point.gross_withdrawal_cents == 100_000
    assert point.taxable_gain_cents == 990
    assert point.tax_cents == 297
    assert point.net_withdrawal_cents == 99_703
    assert point.balance_cents == 10_000_000


def test_the_taxable_gain_fraction_grows_as_the_cost_basis_is_drawn_down():
    """A wrong implementation that forgets to reduce the cost basis on each
    withdrawal (or that floors a shrinking basis without ever applying it)
    would report the IDENTICAL taxable gain every month here, since this
    fixture's balance itself returns to the exact same figure at the start
    of every cycle (withdrawal rate equals the return rate) -- only the
    cost basis moves. A correct implementation must show the taxable gain
    strictly increasing, month over month, as more and more of the
    original principal is drawn out from under it."""
    result = project_retirement(
        initial_cents=10_000_000, annual_return_bps=1_200, withdrawal_rate_bps=1_200,
        months=6, today=TODAY,
    )
    gains = [point.taxable_gain_cents for point in result.points]
    assert gains == sorted(gains)
    assert len(set(gains)) == len(gains)  # strictly increasing, no ties
    assert gains[0] == 990  # anchored to the hand-verified month 1 above


def test_tax_is_computed_through_the_shared_pfu_regime_not_reinvented():
    result = project_retirement(
        initial_cents=10_000_000, annual_return_bps=800, withdrawal_rate_bps=500,
        months=24, today=TODAY,
    )
    for point in result.points:
        assert point.tax_cents == compute_pfu(point.taxable_gain_cents).total_tax_cents
        assert point.net_withdrawal_cents == point.gross_withdrawal_cents - point.tax_cents
    assert result.tax_regime == "pfu"
    assert result.marginal_rate_bps is None


def test_electing_bareme_taxes_every_withdrawals_gain_at_the_marginal_rate():
    result = project_retirement(
        initial_cents=10_000_000, annual_return_bps=800, withdrawal_rate_bps=500,
        months=24, today=TODAY, marginal_rate_bps=3_000,
    )
    assert result.tax_regime == "bareme"
    assert result.marginal_rate_bps == 3_000
    for point in result.points:
        expected = compute_bareme(point.taxable_gain_cents, 3_000).total_tax_cents
        assert point.tax_cents == expected


def test_the_pot_never_goes_negative_the_projection_stops_when_exhausted():
    result = project_retirement(
        initial_cents=1_200_000, annual_return_bps=0, withdrawal_rate_bps=1_200,
        months=600, today=TODAY,
    )
    assert all(point.balance_cents >= 0 for point in result.points)
    assert result.exhausted_at_month is not None
    assert len(result.points) == result.exhausted_at_month


def test_a_pot_that_survives_the_whole_horizon_reports_no_exhaustion():
    result = project_retirement(
        initial_cents=100_000_000, annual_return_bps=1_200, withdrawal_rate_bps=100,
        months=12, today=TODAY,
    )
    assert result.exhausted_at_month is None
    assert len(result.points) == 12


def test_the_assumptions_travel_with_the_retirement_projection():
    result = project_retirement(
        initial_cents=10_000_000, annual_return_bps=800, withdrawal_rate_bps=500,
        months=3, today=TODAY,
    )
    assert result.initial_cents == 10_000_000
    assert result.annual_return_bps == 800
    assert result.withdrawal_rate_bps == 500
    from app.engines.period import month_end
    assert result.horizon_end_on == month_end(TODAY, 3)


def test_retirement_refuses_a_negative_initial_capital():
    with pytest.raises(ValueError, match="capital de départ"):
        project_retirement(
            initial_cents=-1, annual_return_bps=500, withdrawal_rate_bps=400,
            months=12, today=TODAY,
        )


def test_retirement_refuses_a_negative_return_rate():
    with pytest.raises(ValueError, match="rendement"):
        project_retirement(
            initial_cents=1_000_000, annual_return_bps=-1, withdrawal_rate_bps=400,
            months=12, today=TODAY,
        )


def test_retirement_refuses_months_outside_the_bound():
    with pytest.raises(ValueError, match="durée"):
        project_retirement(
            initial_cents=1_000_000, annual_return_bps=500, withdrawal_rate_bps=400,
            months=0, today=TODAY,
        )
    with pytest.raises(ValueError, match="durée"):
        project_retirement(
            initial_cents=1_000_000, annual_return_bps=500, withdrawal_rate_bps=400,
            months=MAX_PROJECTION_MONTHS + 1, today=TODAY,
        )


def test_retirement_refuses_a_withdrawal_rate_of_zero():
    with pytest.raises(ValueError, match="strictement positif"):
        project_retirement(
            initial_cents=1_000_000, annual_return_bps=500, withdrawal_rate_bps=0,
            months=12, today=TODAY,
        )
