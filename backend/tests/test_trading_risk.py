"""The mandate. Every rule it can invoke, and the two families it splits into.

The most consequential test file in this feature: `engines/trading_risk` is the
only thing standing between a model's answer and a real order, and a rule that
silently stopped firing would not show up anywhere else.
"""

from decimal import Decimal

import pytest

from app.engines.quantity import Quantity
from app.engines.quantity import parse as parse_quantity
from app.engines.trading_risk import (
    AccountState,
    Mandate,
    OrderIntent,
    evaluate_order,
)


def mandate(**overrides) -> Mandate:
    base = {
        "max_position_cents": 200_000,
        "max_exposure_cents": 500_000,
        "max_order_notional_cents": 200_000,
        "max_daily_loss_cents": 50_000,
        "max_drawdown_bps": 1_000,
        "max_orders_per_day": 10,
        "min_cash_buffer_cents": 0,
        "allowed_symbols": ("AAPL",),
    }
    return Mandate(**{**base, **overrides})


def state(**overrides) -> AccountState:
    base = {
        "equity_cents": 1_000_000,
        "cash_cents": 1_000_000,
        "peak_equity_cents": 1_000_000,
        "exposure_cents": 0,
        "position_cents": 0,
        "position_quantity": parse_quantity("0"),
        "realised_pnl_today_cents": 0,
        "orders_today": 0,
    }
    return AccountState(**{**base, **overrides})


def buy(quantity: str = "10", price: int = 10_000, symbol: str = "AAPL") -> OrderIntent:
    return OrderIntent(
        symbol=symbol, side="buy", quantity=parse_quantity(quantity),
        order_type="market", reference_price_cents=price,
    )


# --- the happy path -------------------------------------------------------

def test_an_order_inside_every_ceiling_is_allowed_untouched():
    verdict = evaluate_order(mandate(), state(), buy("10", 10_000))
    assert verdict.decision == "allowed"
    assert verdict.quantity == parse_quantity("10")
    assert verdict.notional_cents == 100_000
    assert verdict.breaches == ()


# --- permission rules refuse, they never reduce ---------------------------

def test_a_halt_refuses_and_names_its_reason():
    verdict = evaluate_order(
        mandate(), state(halted=True, halted_reason="arrêt demandé par la supervision"),
        buy(),
    )
    assert verdict.decision == "refused"
    assert verdict.breaches[0].rule == "halted"
    assert "supervision" in verdict.breaches[0].message
    assert verdict.quantity.value == 0


def test_an_unarmed_account_refuses_and_points_at_the_screen():
    verdict = evaluate_order(mandate(), state(armed=False), buy())
    assert verdict.decision == "refused"
    assert verdict.breaches[0].rule == "not_armed"
    assert "Mandat" in verdict.breaches[0].message


def test_a_symbol_off_the_whitelist_is_refused_not_reduced():
    verdict = evaluate_order(mandate(), state(), buy(symbol="TSLA"))
    assert verdict.decision == "refused"
    assert verdict.breaches[0].rule == "symbol_not_allowed"


def test_an_empty_whitelist_authorises_nothing():
    """The single most dangerous default this feature could have got wrong."""
    verdict = evaluate_order(mandate(allowed_symbols=()), state(), buy())
    assert verdict.decision == "refused"
    assert verdict.breaches[0].rule == "symbol_not_allowed"


def test_a_short_sale_is_refused_when_the_mandate_forbids_it():
    verdict = evaluate_order(
        mandate(), state(position_quantity=parse_quantity("2")),
        OrderIntent(symbol="AAPL", side="sell", quantity=parse_quantity("5"),
                    order_type="market", reference_price_cents=10_000),
    )
    assert verdict.decision == "refused"
    assert verdict.breaches[0].rule == "sell_exceeds_position"


def test_buying_beyond_the_cash_is_refused_when_leverage_is_forbidden():
    verdict = evaluate_order(mandate(), state(cash_cents=50_000), buy("10", 10_000))
    assert verdict.decision == "refused"
    assert verdict.breaches[0].rule == "leverage_not_allowed"


def test_a_limit_order_without_a_limit_is_refused():
    verdict = evaluate_order(
        mandate(), state(),
        OrderIntent(symbol="AAPL", side="buy", quantity=parse_quantity("1"),
                    order_type="limit", reference_price_cents=10_000),
    )
    assert verdict.decision == "refused"
    assert verdict.breaches[0].rule == "limit_price_missing"


def test_an_order_type_outside_the_mandate_is_refused():
    verdict = evaluate_order(
        mandate(allowed_order_types=("market",)), state(),
        OrderIntent(symbol="AAPL", side="buy", quantity=parse_quantity("1"),
                    order_type="limit", reference_price_cents=10_000,
                    limit_price_cents=9_900),
    )
    assert verdict.decision == "refused"
    assert verdict.breaches[0].rule == "order_type_not_allowed"


# --- standing conditions close the account to NEW risk only ---------------

def test_the_daily_loss_ceiling_stops_buying():
    verdict = evaluate_order(
        mandate(), state(realised_pnl_today_cents=-50_000), buy()
    )
    assert verdict.decision == "refused"
    assert verdict.breaches[0].rule == "daily_loss_ceiling"
    assert verdict.breaches[0].limit == 50_000
    assert verdict.breaches[0].observed == 50_000


def test_the_daily_loss_ceiling_never_traps_a_household_in_a_position():
    """A sale that reduces risk is exempt, and that exemption is the reason the
    rule can be set tightly at all."""
    verdict = evaluate_order(
        mandate(),
        state(realised_pnl_today_cents=-90_000, position_quantity=parse_quantity("10")),
        OrderIntent(symbol="AAPL", side="sell", quantity=parse_quantity("10"),
                    order_type="market", reference_price_cents=10_000),
    )
    assert verdict.decision == "allowed"


def test_the_drawdown_ceiling_stops_buying():
    verdict = evaluate_order(
        mandate(max_drawdown_bps=1_000),
        state(equity_cents=890_000, peak_equity_cents=1_000_000), buy(),
    )
    assert verdict.decision == "refused"
    assert verdict.breaches[0].rule == "drawdown_ceiling"
    assert verdict.breaches[0].observed == 1_100


def test_the_order_count_ceiling_stops_buying():
    verdict = evaluate_order(mandate(max_orders_per_day=3), state(orders_today=3), buy())
    assert verdict.decision == "refused"
    assert verdict.breaches[0].rule == "orders_per_day"


# --- size rules reduce ----------------------------------------------------

def test_an_order_above_the_position_ceiling_is_reduced_to_fit():
    verdict = evaluate_order(mandate(max_position_cents=150_000), state(), buy("20", 10_000))
    assert verdict.decision == "reduced"
    assert verdict.quantity == parse_quantity("15")
    assert verdict.notional_cents == 150_000
    assert verdict.breaches[0].rule == "position_ceiling"


def test_a_reduction_accounts_for_what_is_already_held():
    verdict = evaluate_order(
        mandate(max_position_cents=200_000),
        state(position_cents=150_000, position_quantity=parse_quantity("15")),
        buy("20", 10_000),
    )
    assert verdict.decision == "reduced"
    assert verdict.quantity == parse_quantity("5")


def test_the_tightest_of_several_ceilings_wins():
    verdict = evaluate_order(
        mandate(max_position_cents=150_000, max_exposure_cents=120_000),
        state(), buy("20", 10_000),
    )
    assert verdict.decision == "reduced"
    assert verdict.quantity == parse_quantity("12")
    assert {breach.rule for breach in verdict.breaches} == {
        "position_ceiling", "exposure_ceiling"
    }


def test_the_cash_buffer_is_respected():
    verdict = evaluate_order(
        mandate(min_cash_buffer_cents=950_000), state(cash_cents=1_000_000),
        buy("10", 10_000),
    )
    assert verdict.decision == "reduced"
    assert verdict.quantity == parse_quantity("5")


def test_a_reduction_never_rounds_up_past_the_ceiling():
    """The whole reason `_quantity_for_value` rounds down."""
    verdict = evaluate_order(mandate(max_position_cents=99_999), state(), buy("10", 10_000))
    assert verdict.notional_cents <= 99_999


def test_an_order_reduced_to_nothing_is_refused_not_sent_as_zero():
    verdict = evaluate_order(
        mandate(max_position_cents=100_000),
        state(position_cents=100_000, position_quantity=parse_quantity("10")),
        buy("10", 10_000),
    )
    assert verdict.decision == "refused"
    assert verdict.breaches[-1].rule == "reduced_to_nothing"
    assert verdict.quantity.value == 0


def test_an_order_reduced_to_dust_is_refused_rather_than_sent():
    """A fractionable instrument can always be sized down to something; the
    floor is what stops that something from being twelve cents of spread."""
    verdict = evaluate_order(
        mandate(max_position_cents=1, min_order_notional_cents=1_000),
        state(), buy("10", 10_000),
    )
    assert verdict.decision == "refused"
    assert verdict.breaches[-1].rule == "below_minimum_notional"
    assert verdict.quantity.value == 0


def test_the_floor_is_off_when_it_is_zero():
    verdict = evaluate_order(
        mandate(max_position_cents=1, min_order_notional_cents=0), state(),
        buy("10", 10_000),
    )
    assert verdict.decision == "reduced"
    assert verdict.quantity.value > 0


# --- determinism, which the oversight replay depends on --------------------

def test_the_same_inputs_give_the_same_verdict_every_time():
    args = (mandate(max_position_cents=150_000), state(), buy("20", 10_000))
    first = evaluate_order(*args)
    for _ in range(20):
        assert evaluate_order(*args) == first


def test_a_zero_reference_price_is_refused_rather_than_divided_by():
    verdict = evaluate_order(mandate(), state(), buy("10", 0))
    assert verdict.decision == "refused"
    assert verdict.breaches[0].rule == "non_positive_quantity"


@pytest.mark.parametrize("quantity", ["0", "-1"])
def test_a_non_positive_quantity_is_refused(quantity):
    intent = OrderIntent(
        symbol="AAPL", side="buy", quantity=Quantity(Decimal(quantity)),
        order_type="market", reference_price_cents=10_000,
    )
    assert evaluate_order(mandate(), state(), intent).decision == "refused"
