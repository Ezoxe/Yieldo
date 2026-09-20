"""Simulated execution and the position arithmetic every mode shares."""

import pytest

from app.engines.paper_book import (
    Fill,
    PositionState,
    Quote,
    apply_fill,
    simulate_fill,
    unrealised_pnl_cents,
)
from app.engines.quantity import parse as parse_quantity


def quote(bid: int = 9_900, ask: int = 10_100) -> Quote:
    return Quote(symbol="AAPL", bid_cents=bid, ask_cents=ask)


def test_a_market_buy_pays_the_ask_plus_slippage():
    fill = simulate_fill(
        side="buy", quantity=parse_quantity("1"), order_type="market",
        quote=quote(), slippage_bps=100,
    )
    assert fill.state == "filled"
    assert fill.price_cents == 10_201  # 10 100 + 1 %


def test_a_market_sell_receives_the_bid_minus_slippage():
    fill = simulate_fill(
        side="sell", quantity=parse_quantity("1"), order_type="market",
        quote=quote(), slippage_bps=100,
    )
    assert fill.price_cents == 9_801  # 9 900 − 1 %


def test_the_cost_of_crossing_the_spread_is_reported_not_hidden():
    fill = simulate_fill(
        side="buy", quantity=parse_quantity("2"), order_type="market",
        quote=quote(), slippage_bps=0,
    )
    # Mid is 10 000, ask is 10 100: 100 cents per unit, twice.
    assert fill.cost_cents == 200


def test_a_limit_order_away_from_the_market_stays_pending_rather_than_filling():
    fill = simulate_fill(
        side="buy", quantity=parse_quantity("1"), order_type="limit",
        quote=quote(), slippage_bps=0, limit_price_cents=9_000,
    )
    assert fill.state == "pending"
    assert fill.quantity.value == 0
    assert "limite" in (fill.reason or "")


def test_a_marketable_limit_order_never_pays_more_than_the_limit():
    fill = simulate_fill(
        side="buy", quantity=parse_quantity("1"), order_type="limit",
        quote=quote(), slippage_bps=0, limit_price_cents=10_500,
    )
    assert fill.state == "filled"
    assert fill.price_cents == 10_100


def test_an_unquotable_instrument_is_rejected_rather_than_filled_at_zero():
    fill = simulate_fill(
        side="buy", quantity=parse_quantity("1"), order_type="market",
        quote=quote(bid=0, ask=0), slippage_bps=0,
    )
    assert fill.state == "rejected"


# --- position arithmetic ---------------------------------------------------

def test_a_buy_raises_the_average_price_and_spends_cash():
    outcome = apply_fill(
        position=PositionState.empty(), cash_cents=100_000, side="buy",
        fill=Fill(state="filled", quantity=parse_quantity("2"), price_cents=10_000,
                  cost_cents=0),
    )
    assert outcome.position.quantity == parse_quantity("2")
    assert outcome.position.average_price_cents == 10_000
    assert outcome.cash_cents == 80_000
    assert outcome.realised_pnl_cents == 0


def test_a_second_buy_averages_the_two_prices():
    first = apply_fill(
        position=PositionState.empty(), cash_cents=100_000, side="buy",
        fill=Fill("filled", parse_quantity("1"), 10_000, 0),
    )
    second = apply_fill(
        position=first.position, cash_cents=first.cash_cents, side="buy",
        fill=Fill("filled", parse_quantity("1"), 20_000, 0),
    )
    assert second.position.average_price_cents == 15_000


def test_a_sale_realises_the_difference_against_the_cost_basis():
    held = PositionState(quantity=parse_quantity("2"), average_price_cents=10_000)
    outcome = apply_fill(
        position=held, cash_cents=0, side="sell",
        fill=Fill("filled", parse_quantity("1"), 12_000, 0),
    )
    assert outcome.realised_pnl_cents == 2_000
    assert outcome.cash_cents == 12_000
    assert outcome.position.quantity == parse_quantity("1")
    # A partial sale does not change what the remaining units cost.
    assert outcome.position.average_price_cents == 10_000


def test_a_closed_position_keeps_no_cost_basis():
    held = PositionState(quantity=parse_quantity("1"), average_price_cents=10_000)
    outcome = apply_fill(
        position=held, cash_cents=0, side="sell",
        fill=Fill("filled", parse_quantity("1"), 9_000, 0),
    )
    assert outcome.position.quantity.value == 0
    assert outcome.position.average_price_cents == 0
    assert outcome.realised_pnl_cents == -1_000


def test_selling_more_than_is_held_raises_rather_than_inventing_a_short():
    held = PositionState(quantity=parse_quantity("1"), average_price_cents=10_000)
    with pytest.raises(ValueError):
        apply_fill(
            position=held, cash_cents=0, side="sell",
            fill=Fill("filled", parse_quantity("5"), 10_000, 0),
        )


def test_an_unfilled_order_changes_nothing():
    held = PositionState(quantity=parse_quantity("1"), average_price_cents=10_000)
    outcome = apply_fill(
        position=held, cash_cents=500, side="buy",
        fill=Fill("pending", parse_quantity("0"), 0, 0, reason="en attente"),
    )
    assert outcome.position == held
    assert outcome.cash_cents == 500


def test_unrealised_is_zero_on_an_empty_position():
    assert unrealised_pnl_cents(PositionState.empty(), 10_000) == 0


def test_a_fractional_crypto_quantity_survives_the_round_trip():
    outcome = apply_fill(
        position=PositionState.empty(), cash_cents=10_000_000, side="buy",
        fill=Fill("filled", parse_quantity("0.000000015"), 6_000_000_00, 0),
    )
    assert str(outcome.position.quantity).startswith("0.000000015")
