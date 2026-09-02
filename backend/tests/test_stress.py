import pytest

from app.engines.portfolio import WeightedGroup
from app.engines.stress import (
    SHOCK_2008,
    SHOCK_2020,
    SHOCK_2022,
    SHOCKS,
    apply_shock,
    get_shock,
)


def _group(key: str, value_cents: int) -> WeightedGroup:
    return WeightedGroup(key=key, value_cents=value_cents, weight=0.0)


# --- Every scenario carries its own period and source -- the reply
# --- requirement made into a structural test.


def test_every_shock_names_its_own_period_and_source():
    for shock in SHOCKS:
        assert shock.period.strip() != ""
        assert shock.source.strip() != ""
        assert shock.label.strip() != ""


def test_get_shock_looks_up_by_key():
    assert get_shock("2008") is SHOCK_2008
    assert get_shock("2020") is SHOCK_2020
    assert get_shock("2022") is SHOCK_2022


def test_get_shock_refuses_an_unknown_key():
    with pytest.raises(ValueError, match="inconnu"):
        get_shock("1999")


def test_2008_has_no_crypto_figure_because_bitcoin_did_not_exist_yet():
    assert "crypto" not in SHOCK_2008.impact_bps_by_asset_class


def test_etf_and_other_are_never_assigned_a_historical_impact():
    """Neither class's real composition can be recovered from the label
    alone -- see the module docstring. A wrong implementation that filled
    them in with the equity figure "for convenience" would fail this."""
    for shock in SHOCKS:
        assert "etf" not in shock.impact_bps_by_asset_class
        assert "other" not in shock.impact_bps_by_asset_class


def test_cash_never_moves_in_any_shock():
    for shock in SHOCKS:
        assert shock.impact_bps_by_asset_class["cash"] == 0


def test_2008_is_not_only_losses_bonds_gained_on_the_flight_to_quality():
    """A stress test that floored every class at a loss would hide the one
    thing worth showing a household: what would have cushioned the fall."""
    assert SHOCK_2008.impact_bps_by_asset_class["bond"] > 0
    assert SHOCK_2008.impact_bps_by_asset_class["equity"] < 0


# --- apply_shock: the two self-review scenarios first.


def test_an_empty_allocation_produces_a_definite_zero_without_crashing():
    result = apply_shock([], SHOCK_2020)
    assert result.portfolio_value_cents == 0
    assert result.stressable_value_cents == 0
    assert result.stressed_value_cents == 0
    assert result.impact_cents == 0
    assert result.impact_bps == 0
    assert result.by_class == []
    assert result.classes_without_data == []


def test_a_hundred_percent_single_known_class_is_exact():
    """One class, entirely known: the blended `impact_bps` must equal that
    class's own figure exactly -- there is nothing else to blend against."""
    result = apply_shock([_group("equity", 20_000_000)], SHOCK_2020)
    assert result.impact_bps == SHOCK_2020.impact_bps_by_asset_class["equity"] == -3_400
    assert result.stressed_value_cents == 13_200_000  # 20 000 000 * 66 %
    assert result.impact_cents == -6_800_000


def test_a_hundred_percent_single_unknown_class_is_named_never_invented():
    """The self-review's other scenario, on a class with genuinely no data:
    2008, entirely in crypto. `impact_bps == 0` here must NOT be read as "no
    effect measured" -- `classes_without_data` is what actually says so."""
    result = apply_shock([_group("crypto", 5_000_000)], SHOCK_2008)
    assert result.classes_without_data == ["crypto"]
    assert result.portfolio_value_cents == 5_000_000
    assert result.stressable_value_cents == 0
    assert result.impact_bps == 0
    [impact] = result.by_class
    assert impact.impact_bps is None
    assert impact.stressed_value_cents is None
    assert impact.current_value_cents == 5_000_000


# --- A mixed allocation, and the arithmetic behind the blended figure.


def test_2008_on_a_mixed_allocation_blends_a_loss_and_a_gain():
    groups = [_group("equity", 10_000_000), _group("bond", 5_000_000), _group("cash", 1_000_000)]
    result = apply_shock(groups, SHOCK_2008)
    assert result.classes_without_data == []
    assert result.portfolio_value_cents == result.stressable_value_cents == 16_000_000
    by_key = {impact.asset_class: impact for impact in result.by_class}
    assert by_key["equity"].stressed_value_cents == 4_600_000  # 10 000 000 * 46 %
    assert by_key["bond"].stressed_value_cents == 5_250_000  # 5 000 000 * 105 %
    assert by_key["cash"].stressed_value_cents == 1_000_000  # unchanged
    assert result.stressed_value_cents == 10_850_000
    assert result.impact_cents == -5_150_000
    assert result.impact_bps == -3_219  # round(-5 150 000 / 16 000 000 * 10 000)


def test_an_unstressable_class_is_excluded_from_the_blended_percentage():
    """The blended `impact_bps` must be computed over `stressable_value_cents`
    (what could actually be tested), never over `portfolio_value_cents` (the
    whole household total) -- a wrong implementation that divided by the
    latter would report -3 600 here instead of the correct -5 400, diluting
    a real loss with an asset class that was never actually measured."""
    groups = [_group("equity", 10_000_000), _group("crypto", 5_000_000)]
    result = apply_shock(groups, SHOCK_2008)
    assert result.classes_without_data == ["crypto"]
    assert result.portfolio_value_cents == 15_000_000
    assert result.stressable_value_cents == 10_000_000
    assert result.impact_bps == SHOCK_2008.impact_bps_by_asset_class["equity"] == -5_400
    assert result.impact_bps != -3_600  # the wrong, diluted figure


def test_2022_hits_bonds_and_equities_together_the_defining_fact_of_that_year():
    result = apply_shock(
        [_group("equity", 10_000_000), _group("bond", 10_000_000)], SHOCK_2022,
    )
    by_key = {impact.asset_class: impact for impact in result.by_class}
    assert by_key["equity"].impact_bps < 0
    assert by_key["bond"].impact_bps < 0  # unlike 2008 -- both fell together in 2022
