import pytest

from app.engines.ownership import (
    DEFAULT_OWNERSHIP_YEARS,
    VEHICLE_DEFAULTS,
    VEHICLE_DEPRECIATION_BPS_PER_YEAR,
    CostItem,
    defaults_for,
    total_cost_of_ownership,
)


def test_flat_and_value_proportional_costs_are_both_handled():
    """20 000 EUR over 2 years, 15 %/an declining depreciation, 65 EUR/month of
    insurance and 1 %/an of maintenance. Hand-computed:
      insurance    65 * 24                                   = 1 560,00 EUR
      maintenance  1 % of 20 000 then 1 % of 17 000          =   370,00 EUR
      depreciation 3 000 then 2 550                          = 5 550,00 EUR
      residual     20 000 - 5 550                            = 14 450,00 EUR
      total        1 560 + 370 + 5 550                       = 7 480,00 EUR
      monthly      748 000 c / 24                            =   311,67 EUR
    """
    report = total_cost_of_ownership(
        2_000_000, 2,
        [CostItem("insurance", "Assurance", monthly_cents=6_500, annual_bps_of_value=None),
         CostItem("maintenance", "Entretien", monthly_cents=None, annual_bps_of_value=100)],
        1500,
    )
    assert {line.key: line.total_cents for line in report.lines} == {
        "insurance": 156_000, "maintenance": 37_000}
    assert report.depreciation_cents == 555_000
    assert report.residual_value_cents == 1_445_000
    assert report.running_cost_cents == 193_000
    assert report.total_cost_cents == 748_000
    assert report.monthly_average_cents == 31_167


def test_a_value_proportional_cost_follows_the_declining_value():
    """The second year's maintenance is 1 % of 17 000, not of 20 000. Charging
    it on the purchase price would overstate the cost of every old car."""
    report = total_cost_of_ownership(
        2_000_000, 2,
        [CostItem("maintenance", "Entretien", monthly_cents=None, annual_bps_of_value=100)],
        1500,
    )
    assert report.lines[0].total_cents == 20_000 + 17_000


def test_depreciation_is_declining_balance_never_straight_line():
    """A car does not lose the same euros every year. Straight-line would put
    the residual value at zero after seven years at 15 %, which is false."""
    report = total_cost_of_ownership(2_000_000, 7, [], 1500)
    assert report.residual_value_cents > 0
    assert report.depreciation_cents + report.residual_value_cents == 2_000_000


def test_a_property_does_not_depreciate_by_default():
    items, depreciation = defaults_for("property")
    assert depreciation == 0
    report = total_cost_of_ownership(30_000_000, 5, list(items), depreciation)
    assert report.depreciation_cents == 0
    assert report.residual_value_cents == 30_000_000


def test_the_vehicle_defaults_are_the_ones_the_screen_prefills():
    items, depreciation = defaults_for("vehicle")
    assert items == VEHICLE_DEFAULTS
    assert depreciation == VEHICLE_DEPRECIATION_BPS_PER_YEAR
    assert {item.key for item in items} == {"insurance", "maintenance", "fuel"}
    # Every default carries a French label -- the screen prints these verbatim.
    assert all(item.label and item.label[0].isupper() for item in items)


def test_an_unknown_nature_has_no_prefilled_costs_rather_than_a_car_s():
    """"other" is a category, not a car. Prefilling a fuel budget for a sofa
    would be a fabricated figure presented as a French average."""
    items, depreciation = defaults_for("other")
    assert items == ()
    assert depreciation == 0


def test_a_cost_item_must_be_exactly_one_of_the_two_kinds():
    with pytest.raises(ValueError, match="Assurance"):
        total_cost_of_ownership(100_000, 1, [
            CostItem("insurance", "Assurance", monthly_cents=100, annual_bps_of_value=100)], 0)
    with pytest.raises(ValueError, match="Assurance"):
        total_cost_of_ownership(100_000, 1, [
            CostItem("insurance", "Assurance", monthly_cents=None, annual_bps_of_value=None)], 0)


def test_invalid_horizons_raise_in_french():
    with pytest.raises(ValueError, match="durée"):
        total_cost_of_ownership(100_000, 0, [], 0)
    with pytest.raises(ValueError, match="prix"):
        total_cost_of_ownership(-1, DEFAULT_OWNERSHIP_YEARS, [], 0)


def test_a_depreciation_rate_outside_0_to_100_percent_raises_in_french():
    """Above 10 000 bps the loss would exceed what is left, sending the
    residual value negative -- a car cannot be worth less than nothing here.
    Below zero would model the asset APPRECIATING, which this engine
    deliberately never bakes in (see the module docstring)."""
    with pytest.raises(ValueError, match="décote"):
        total_cost_of_ownership(100_000, 1, [], 10_001)
    with pytest.raises(ValueError, match="décote"):
        total_cost_of_ownership(100_000, 1, [], -1)


def test_a_hundred_percent_depreciation_leaves_the_value_at_nothing_not_negative():
    """The declared boundary case: the value goes to nothing after year one
    and stays there -- 0 % of 0 is still 0, not a negative residual."""
    report = total_cost_of_ownership(2_000_000, 3, [], 10_000)
    assert report.residual_value_cents == 0
    assert report.depreciation_cents == 2_000_000
