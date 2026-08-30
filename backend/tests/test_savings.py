import pytest

from app.engines.savings import (
    MAX_PROJECTION_MONTHS,
    months_to_target,
    opportunity_cost_cents,
    project_savings,
    required_monthly_cents,
)


def test_a_zero_rate_projection_is_the_contributions_and_nothing_else():
    projection = project_savings(100_000, 50_000, 0, 12)
    assert projection.final_cents == 700_000
    assert projection.contributed_cents == 600_000
    assert projection.interest_cents == 0


def test_interest_compounds_monthly_on_the_running_balance():
    """100 000 c at 12 %/an, no contribution: 1 000 c then 1 010 c."""
    projection = project_savings(100_000, 0, 1200, 2)
    assert [point.balance_cents for point in projection.points] == [101_000, 102_010]
    assert projection.interest_cents == 2_010
    assert projection.final_cents == 102_010


def test_a_contribution_earns_nothing_in_the_month_it_is_made():
    """End-of-month contributions (annuité de fin de période). Month 1 earns no
    interest on a zero opening balance, and the first contribution starts
    earning in month 2. 0 / 100 000 c per month / 12 %/an over three months:
    100 000, then 201 000, then 303 010."""
    projection = project_savings(0, 100_000, 1200, 3)
    assert [point.balance_cents for point in projection.points] == [100_000, 201_000, 303_010]
    assert projection.contributed_cents == 300_000
    assert projection.interest_cents == 3_010


def test_a_negative_balance_earns_no_interest():
    """A savings pot that has gone negative is an overdraft, not an investment.
    Crediting it a return would manufacture money out of a debt -- and this is
    not a hypothetical branch: the operator's measured savings capacity is
    -74 619 c/month and his liquid balance is -220 963 c, so every feasibility
    projection run on his real data lives here."""
    projection = project_savings(0, -100_000, 1200, 3)
    assert projection.final_cents == -300_000
    assert projection.interest_cents == 0


def test_a_negative_contribution_draws_the_pot_down_without_clamping():
    """Withdrawals are how the credit-versus-cash comparison is modelled, and
    how a negative measured capacity is projected. Nothing is floored at zero:
    a pot that runs out keeps going negative, which is the honest answer."""
    projection = project_savings(250_000, -100_000, 0, 3)
    assert [point.balance_cents for point in projection.points] == [150_000, 50_000, -50_000]


def test_the_operators_own_case_projects_to_the_hand_verified_figure():
    """Twelve months of the operator's measured capacity from a zero pot. The
    savings capacity is negative, so the pot shrinks and no interest accrues.
    This exact number is asserted again by the feasibility engine's test."""
    assert project_savings(0, -74_619, 300, 12).final_cents == -895_428


def test_the_projection_accounts_for_every_cent_it_moves():
    """final_cents is not an independent field: it must equal initial plus
    every cumulative cent this module reports moving, on a case that mixes a
    nonzero initial pot with real compounding (so `initial_cents == final_cents`
    or `interest_cents == 0` can't make this hold by accident)."""
    projection = project_savings(100_000, 20_000, 1200, 6)
    assert (
        projection.final_cents
        == projection.initial_cents + projection.contributed_cents + projection.interest_cents
    )
    assert projection.interest_cents > 0


def test_required_monthly_is_the_smallest_contribution_that_reaches_the_target():
    """Exact boundary, not an approximation: one cent less falls short."""
    required = required_monthly_cents(4_000_000, 0, 300, 12)
    assert required == 328_775
    assert project_savings(0, required, 300, 12).final_cents >= 4_000_000
    assert project_savings(0, required - 1, 300, 12).final_cents < 4_000_000


def test_required_monthly_does_not_overshoot_when_the_target_lands_exactly():
    """A fixture where the minimal contribution makes the projection land on
    the target EXACTLY (final_cents == target_cents), not past it -- unlike
    the compounding case above, whose 328 775 c overshoots to 4 000 002 c and
    so cannot tell `>=` and `>` apart in the search's stopping condition. Zero
    rate makes the arithmetic exact: 100 000 c initial + 50 000 c/month over
    12 months lands on 700 000 c to the cent at contribution 50 000, and one
    cent less (49 999 c) falls 12 c short. A search using `>` instead of `>=`
    would not recognise 50 000 c as sufficient and return 50 001 c instead."""
    required = required_monthly_cents(700_000, 100_000, 0, 12)
    assert required == 50_000
    assert project_savings(100_000, required, 0, 12).final_cents == 700_000
    assert project_savings(100_000, required - 1, 0, 12).final_cents < 700_000


def test_required_monthly_is_zero_when_the_target_is_already_covered():
    """Not a negative contribution, and not an error: nothing more is needed."""
    assert required_monthly_cents(100_000, 200_000, 300, 12) == 0


def test_months_to_target_counts_whole_months():
    assert months_to_target(700_000, 100_000, 50_000, 0) == 12
    assert months_to_target(100_000, 100_000, 50_000, 0) == 0


def test_months_to_target_refuses_when_the_pot_can_never_grow():
    """The operator's branch again. A non-positive capacity on a non-positive
    balance never reaches anything, and returning a large number here would put
    a date on screen that will never arrive. None, never a sentinel integer."""
    assert months_to_target(4_000_000, 0, -74_619, 300) is None
    assert months_to_target(4_000_000, 0, 0, 300) is None


def test_months_to_target_refuses_past_the_fifty_year_bound():
    assert months_to_target(100_000_000, 0, 1, 0) is None


def test_months_to_target_also_rejects_a_negative_rate():
    """`months_to_target` validates the rate itself rather than delegating to
    `project_savings` -- it walks the balance with its own loop, never calling
    `project_savings`, so nothing else in this function would catch a negative
    rate before it reached `monthly_rate` and produced a nonsense Decimal."""
    with pytest.raises(ValueError, match="rendement"):
        months_to_target(100_000, 0, 1_000, -1)


def test_months_to_target_reaches_it_on_interest_alone_with_zero_contribution():
    """Growth need not come from a contribution: a lump sum earning a positive
    rate with nothing added each month still counts up towards the target, and
    the loop must not mistake "no contribution" for "never grows" when the
    balance is positive and actually compounding. 100 000 c at 12 %/an (1 %/
    month) reaches 101 000 c in exactly one month on interest alone."""
    assert months_to_target(101_000, 100_000, 0, 1200) == 1


def test_opportunity_cost_is_the_forgone_gain_not_the_final_value():
    """Design §6.3 item 4: "ce que la somme aurait produit". The gain, not the
    amount plus the gain -- printing the latter under "coût d'opportunité"
    would overstate it by the whole purchase price."""
    assert opportunity_cost_cents(100_000, 1200, 2) == 2_010


def test_opportunity_cost_of_nothing_is_nothing():
    assert opportunity_cost_cents(0, 300, 60) == 0
    assert opportunity_cost_cents(-500, 300, 60) == 0


def test_invalid_inputs_raise_in_french():
    with pytest.raises(ValueError, match="durée"):
        project_savings(0, 1000, 300, 0)
    with pytest.raises(ValueError, match="durée"):
        project_savings(0, 1000, 300, MAX_PROJECTION_MONTHS + 1)
    with pytest.raises(ValueError, match="rendement"):
        project_savings(0, 1000, -1, 12)
