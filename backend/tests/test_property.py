import pytest

from app.engines.amortization import HCSF_DEBT_RATIO_BPS
from app.engines.property import (
    NOTARY_BPS_EXISTING,
    PropertyRequest,
    rent_comparison,
    simulate_property,
)

# 300 000 EUR in the existing market, 60 000 EUR down, 3,50 % over 20 years,
# 150 EUR of charges, 1 200 EUR of taxe foncière, 4 000 EUR of measured income.
REQUEST = PropertyRequest(
    price_cents=30_000_000, down_payment_cents=6_000_000,
    notary_bps=NOTARY_BPS_EXISTING, loan_rate_bps=350, loan_months=240,
    insurance_bps_per_year=36, monthly_charges_cents=15_000,
    annual_property_tax_cents=120_000, monthly_income_cents=400_000,
    existing_debt_payments_cents=0,
)


def test_the_notary_fees_are_added_to_the_price_before_the_loan_is_sized():
    """A French buyer borrows the price PLUS the frais de notaire minus the
    down payment. Sizing the loan on the price alone understates it by 22 500
    EUR here."""
    simulation = simulate_property(REQUEST)
    assert simulation.notary_fees_cents == 2_250_000
    assert simulation.acquisition_cost_cents == 32_250_000
    assert simulation.borrowed_cents == 26_250_000


def test_the_monthly_effort_is_every_recurring_euro_not_just_the_instalment():
    """1 522,39 instalment + 78,75 insurance + 150 charges + 100 taxe foncière."""
    simulation = simulate_property(REQUEST)
    assert simulation.schedule.monthly_payment_cents == 152_239
    assert simulation.monthly_insurance_cents == 7_875
    assert simulation.monthly_property_tax_cents == 10_000
    assert simulation.monthly_effort_cents == 185_114
    assert simulation.total_interest_cents == 10_287_523


def test_the_debt_ratio_uses_the_instalment_and_the_insurance():
    """A French bank counts the assurance emprunteur inside the taux
    d'endettement. Leaving it out understates the ratio on every loan."""
    simulation = simulate_property(REQUEST)
    assert simulation.debt_ratio_bps == 4003
    assert simulation.debt_ratio_bps > HCSF_DEBT_RATIO_BPS
    assert simulation.debt_ratio_exceeded is True


def test_the_debt_ratio_is_absent_without_a_measured_income():
    simulation = simulate_property(
        PropertyRequest(**{**REQUEST.__dict__, "monthly_income_cents": None}))
    assert simulation.debt_ratio_bps is None
    assert simulation.debt_ratio_exceeded is False


def test_a_down_payment_below_the_notary_fees_is_flagged():
    """French banks lend the price, not the fees: the frais de notaire come out
    of the buyer's own money. Reported, not refused -- it is a fact about the
    plan, not an invalid input."""
    simulation = simulate_property(
        PropertyRequest(**{**REQUEST.__dict__, "down_payment_cents": 1_000_000}))
    assert simulation.down_payment_short_cents == 1_250_000
    simulation_ok = simulate_property(REQUEST)
    assert simulation_ok.down_payment_short_cents == 0


def test_a_cash_purchase_borrows_nothing_and_still_has_a_monthly_effort():
    simulation = simulate_property(
        PropertyRequest(**{**REQUEST.__dict__, "down_payment_cents": 32_250_000}))
    assert simulation.borrowed_cents == 0
    assert simulation.schedule.rows == []
    assert simulation.monthly_insurance_cents == 0
    assert simulation.monthly_effort_cents == 15_000 + 10_000
    assert simulation.debt_ratio_bps == 0


def test_renting_and_investing_can_win_and_the_engine_says_so():
    """Ten years, 1 % a year of appreciation, savings at 3 %, 1 100 EUR of rent
    against a 1 851,14 EUR monthly effort. The renter invests the 60 000 EUR
    down payment plus the 22 500 EUR of fees, and the 751,14 EUR of monthly
    difference. Hand-verified: buyer 177 582,08 EUR, renter 216 287,06 EUR."""
    simulation = simulate_property(REQUEST)
    comparison = rent_comparison(simulation, 110_000, 10, 300, 100)
    assert comparison.horizon_months == 120
    assert comparison.capped_reason is None
    assert comparison.buyer_property_value_cents == 33_153_745
    assert comparison.buyer_remaining_loan_cents == 15_395_537
    assert comparison.buyer_wealth_cents == 17_758_208
    assert comparison.renter_wealth_cents == 21_628_706
    assert comparison.better_kind == "rent"
    assert comparison.difference_cents == 17_758_208 - 21_628_706


def test_the_comparison_is_capped_at_the_loan_term_and_says_so():
    """Past the last instalment the buyer's monthly effort drops and the
    comparison changes shape. Rather than modelling a second regime silently,
    the horizon is capped and the cap is stated in French."""
    simulation = simulate_property(REQUEST)
    comparison = rent_comparison(simulation, 110_000, 30, 300, 100)
    assert comparison.horizon_months == 240
    assert comparison.capped_reason is not None
    assert "crédit" in comparison.capped_reason


def test_invalid_inputs_raise_in_french():
    with pytest.raises(ValueError, match="prix"):
        simulate_property(PropertyRequest(**{**REQUEST.__dict__, "price_cents": 0}))
    with pytest.raises(ValueError, match="apport"):
        simulate_property(PropertyRequest(**{**REQUEST.__dict__,
                                             "down_payment_cents": -1}))
    with pytest.raises(ValueError, match="loyer"):
        rent_comparison(simulate_property(REQUEST), -1, 10, 300, 100)
    with pytest.raises(ValueError, match="durée"):
        rent_comparison(simulate_property(REQUEST), 110_000, 0, 300, 100)


def test_a_cash_purchase_over_fifty_years_refuses_about_the_comparison():
    """A cash purchase borrows nothing, so it has no loan term to cap the
    horizon at. Without its own guard, a long comparison would instead raise
    `savings.project_savings`'s "durée d'une projection" refusal -- a true
    fact, but naming the wrong thing: the user asked for a rent comparison,
    not a savings projection. Found by the price x rate x term x horizon
    invariant sweep, not by a brief-supplied test."""
    simulation = simulate_property(
        PropertyRequest(**{**REQUEST.__dict__, "down_payment_cents": 32_250_000}))
    assert simulation.borrowed_cents == 0
    with pytest.raises(ValueError, match="comparaison"):
        rent_comparison(simulation, 50_000, 100, 300, 100)
