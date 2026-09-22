"""The three ready-made mandates: prudent, équilibré, offensif.

They are a starting point a household can read and change, not a hidden
policy: every figure they set is a field of the mandate form, and nothing is
saved until the household presses « Enregistrer le mandat ».
"""

import pytest

from app.engines.risk_profiles import PROFILES, profile_for, profile_names


def test_the_three_profiles_are_named_and_described_in_french():
    assert profile_names() == ("prudent", "equilibre", "offensif")
    for profile in PROFILES:
        assert profile.label
        assert profile.summary.endswith(".")
        assert profile.cash_cents > 0


def test_each_profile_is_stricter_than_the_next_on_every_axis_that_orders_risk():
    prudent, equilibre, offensif = (profile_for(name) for name in profile_names())
    # Thresholds fall as risk rises: an offensive mandate acts on a weaker
    # signal, a prudent one waits for a clearer one.
    assert prudent.minimum_conviction > equilibre.minimum_conviction > \
        offensif.minimum_conviction
    assert prudent.minimum_probability_bps > equilibre.minimum_probability_bps > \
        offensif.minimum_probability_bps
    # Room rises with risk.
    assert prudent.max_position_bps < equilibre.max_position_bps < offensif.max_position_bps
    assert prudent.max_orders_per_day < equilibre.max_orders_per_day < \
        offensif.max_orders_per_day
    assert prudent.max_daily_loss_bps < equilibre.max_daily_loss_bps < \
        offensif.max_daily_loss_bps


def test_no_profile_can_produce_a_mandate_that_refuses_everything():
    """Zero anywhere on these four is a mandate that refuses every order --
    the trap the operator fell into by hand."""
    for profile in PROFILES:
        mandate = profile.mandate(1_000_000)
        assert mandate["max_orders_per_day"] >= 5
        assert mandate["max_daily_loss_cents"] > 0
        assert mandate["max_position_cents"] > mandate["min_order_notional_cents"]
        assert mandate["max_order_notional_cents"] > mandate["min_order_notional_cents"]
        assert mandate["autonomy"] == "paper"
        assert mandate["allow_short"] is False


def test_the_amounts_follow_the_capital_they_are_asked_for():
    small = profile_for("equilibre").mandate(100_000)
    large = profile_for("equilibre").mandate(1_000_000)
    assert large["max_position_cents"] == small["max_position_cents"] * 10
    assert large["max_exposure_cents"] == small["max_exposure_cents"] * 10
    # A tenth of the ceiling, never a fraction of a cent.
    assert all(isinstance(value, int) for key, value in large.items()
               if key.endswith("_cents") or key.endswith("_bps"))


def test_an_unknown_profile_is_refused_by_name():
    with pytest.raises(KeyError):
        profile_for("agressif")
