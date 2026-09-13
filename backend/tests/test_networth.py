"""`engines/networth.py`: what the household owns minus what it owes.

Pure: four integers in, one frozen answer out. The route is the one that
decides what counts as an asset (the valuation the Patrimoine screen
already prints) and what counts as a debt (the capital restant dû of the
active debts); the engine only refuses to let either sign lie.
"""

import pytest

from app.engines.networth import NetWorth, measure_net_worth


def test_net_worth_is_assets_minus_debts():
    result = measure_net_worth(
        positions_cents=1_150_000, declared_cents=250_000, cash_cents=1_240_000,
        debts_remaining_cents=1_157_000,
    )
    assert isinstance(result, NetWorth)
    assert result.assets_cents == 2_640_000
    assert result.debts_cents == 1_157_000
    assert result.net_cents == 1_483_000


def test_breakdown_names_every_term_with_its_sign():
    result = measure_net_worth(
        positions_cents=100, declared_cents=200, cash_cents=300, debts_remaining_cents=50,
    )
    assert result.breakdown == (
        ("positions", 100),
        ("declared", 200),
        ("cash", 300),
        ("debts", -50),
    )


def test_no_debt_leaves_net_equal_to_assets():
    result = measure_net_worth(
        positions_cents=0, declared_cents=0, cash_cents=991_240, debts_remaining_cents=0,
    )
    assert result.net_cents == 991_240
    assert result.debts_cents == 0


def test_a_household_can_owe_more_than_it_owns():
    result = measure_net_worth(
        positions_cents=0, declared_cents=0, cash_cents=50_000, debts_remaining_cents=780_000,
    )
    assert result.net_cents == -730_000


@pytest.mark.parametrize("field", ["positions_cents", "declared_cents", "cash_cents"])
def test_an_asset_term_is_never_negative(field):
    kwargs = dict(positions_cents=0, declared_cents=0, cash_cents=0, debts_remaining_cents=0)
    kwargs[field] = -1
    with pytest.raises(ValueError, match=field):
        measure_net_worth(**kwargs)


def test_a_debt_is_given_as_a_positive_capital():
    with pytest.raises(ValueError, match="debts_remaining_cents"):
        measure_net_worth(
            positions_cents=0, declared_cents=0, cash_cents=0, debts_remaining_cents=-1,
        )
