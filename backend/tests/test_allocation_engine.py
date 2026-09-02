"""`engines/allocation.py`: target allocation per asset class, current
drift, and the trades that would close it -- whole units where an
instrument is not fractionable, refused rather than rounded to a fraction
or a zero-unit no-op when it cannot be sized."""

from decimal import Decimal

import pytest

from app.engines import quantity
from app.engines.allocation import (
    AllocationTarget,
    HoldingInput,
    Trade,
    TradeRefusal,
    evaluate_allocation,
)


def _holding(
    symbol: str, asset_class: str, *, quantity_text: str = "1", price_cents: int | None,
    value_cents: int | None, is_fractionable: bool = True, name: str | None = None,
) -> HoldingInput:
    return HoldingInput(
        symbol=symbol, name=name or symbol, asset_class=asset_class,
        is_fractionable=is_fractionable, quantity=quantity.parse(quantity_text),
        price_reporting_cents=price_cents, market_value_reporting_cents=value_cents,
    )


def _target(asset_class: str, bps: int) -> AllocationTarget:
    return AllocationTarget(asset_class=asset_class, target_bps=bps)


class TestTargetsMustSumToOneHundredPercent:
    def test_targets_summing_to_less_than_100_percent_are_refused(self):
        """Kills an implementation that silently rescales the targets to
        sum to 100 % -- a household who mistyped their allocation would get
        a DIFFERENT allocation applied than the one they typed, with no
        warning at all."""
        with pytest.raises(ValueError, match="100 %"):
            evaluate_allocation([], [_target("equity", 5_000), _target("bond", 4_000)])

    def test_targets_summing_to_more_than_100_percent_are_refused(self):
        with pytest.raises(ValueError, match="100 %"):
            evaluate_allocation([], [_target("equity", 8_000), _target("bond", 3_000)])

    def test_a_single_target_of_exactly_100_percent_is_accepted(self):
        report = evaluate_allocation([], [_target("equity", 10_000)])
        assert report.drifts[0].target_bps == 10_000

    def test_an_out_of_range_target_is_refused(self):
        with pytest.raises(ValueError):
            evaluate_allocation([], [_target("equity", -1), _target("bond", 10_001)])

    def test_a_duplicate_asset_class_is_refused(self):
        with pytest.raises(ValueError):
            evaluate_allocation(
                [], [_target("equity", 5_000), _target("equity", 5_000)]
            )


class TestDrift:
    def test_current_and_target_bps_are_computed_over_what_could_be_valued(self):
        """Kills an implementation that folds an unpriced holding into the
        denominator as though it were worth zero -- C's cost basis is not
        even modelled here (this engine never sees cost), so a wrong
        implementation could only get the total right by actually excluding
        C, exactly like Task 7's own weights."""
        holdings = [
            _holding("A", "equity", price_cents=100_00, value_cents=100_00 * 60),
            _holding("B", "bond", price_cents=100_00, value_cents=100_00 * 40),
            _holding("C", "crypto", price_cents=None, value_cents=None),
        ]
        targets = [_target("equity", 6_000), _target("bond", 4_000)]
        report = evaluate_allocation(holdings, targets)

        assert report.total_value_cents == 100_00 * 100
        equity = next(d for d in report.drifts if d.asset_class == "equity")
        bond = next(d for d in report.drifts if d.asset_class == "bond")
        assert equity.current_bps == 6_000
        assert bond.current_bps == 4_000
        assert equity.drift_cents == 0
        assert bond.drift_cents == 0
        assert report.holdings_total == 3
        assert report.holdings_valued == 2

    def test_an_overweight_class_has_a_negative_drift_and_a_positive_drift_bps(self):
        holdings = [
            _holding("A", "equity", price_cents=100_00, value_cents=100_00 * 80),
            _holding("B", "bond", price_cents=100_00, value_cents=100_00 * 20),
        ]
        report = evaluate_allocation(
            holdings, [_target("equity", 5_000), _target("bond", 5_000)]
        )
        equity = next(d for d in report.drifts if d.asset_class == "equity")
        assert equity.current_bps == 8_000
        assert equity.drift_bps == 3_000  # 30 points overweight
        assert equity.drift_cents < 0  # needs to shrink

    def test_zero_total_value_produces_zero_drift_everywhere_without_crashing(self):
        holdings = [_holding("A", "equity", price_cents=None, value_cents=None)]
        report = evaluate_allocation(holdings, [_target("equity", 10_000)])
        assert report.total_value_cents == 0
        assert report.drifts[0].current_bps == 0
        assert report.drifts[0].drift_cents == 0
        assert report.trades == []
        assert report.refusals == []


class TestTradesCloseTheDrift:
    def test_an_underweight_fractionable_holding_gets_a_buy_sized_to_the_price(self):
        holdings = [
            _holding("A", "equity", price_cents=100_00, value_cents=100_00 * 60),
            _holding("B", "bond", price_cents=50_00, value_cents=50_00 * 40, quantity_text="40"),
        ]
        # Target 50/50 on an 8 000,00 EUR total: bond needs to grow from
        # 2 000,00 to 4 000,00 EUR -- a 2 000,00 EUR buy at 50,00 EUR/unit
        # is exactly 40 units. Equity drifts the OTHER way by construction
        # (target and current values always balance across classes), so
        # this looks up B's own trade rather than assuming it is the only
        # one in the report.
        report = evaluate_allocation(
            holdings, [_target("equity", 5_000), _target("bond", 5_000)]
        )
        trade = next(t for t in report.trades if t.symbol == "B")
        assert trade.action == "buy"
        assert quantity.parse(trade.quantity) == quantity.parse("40")
        assert trade.estimated_value_cents == 200_000

    def test_a_fractional_buy_is_allowed_for_a_fractionable_instrument(self):
        holdings = [
            _holding("A", "equity", price_cents=100_00, value_cents=100_00 * 90),
            _holding(
                "BTC", "crypto", price_cents=300_00, value_cents=300_00 * 1,
                quantity_text="1", is_fractionable=True,
            ),
        ]
        # Target crypto to 20 % -- current 300,00 / 9 300,00 total.
        report = evaluate_allocation(
            holdings, [_target("equity", 8_000), _target("crypto", 2_000)]
        )
        trade = next(t for t in report.trades if t.symbol == "BTC")
        assert trade.action == "buy"
        # The exact quantity is not integral -- the whole point of allowing
        # a fraction here.
        assert quantity.parse(trade.quantity).value % 1 != 0

    def test_a_non_fractionable_holding_trades_in_whole_units_only(self):
        holdings = [
            _holding("A", "equity", price_cents=100_00, value_cents=100_00 * 60),
            _holding(
                "MSFT", "bond", price_cents=333_00, value_cents=333_00 * 3,
                quantity_text="3", is_fractionable=False,
            ),
        ]
        report = evaluate_allocation(
            holdings, [_target("equity", 5_000), _target("bond", 5_000)]
        )
        trade = next(t for t in report.trades if t.symbol == "MSFT")
        assert quantity.parse(trade.quantity).value % 1 == 0

    def test_a_drift_too_small_for_one_whole_unit_is_refused_not_rounded_to_zero(self):
        """The headline behaviour: kills an implementation that proposes a
        fractional share of a non-fractionable instrument, AND kills one
        that silently proposes a zero-quantity trade instead of refusing.
        Bond needs to grow by only 1 000,00 EUR but costs 10 000,00 EUR/unit
        -- well under half a share, so it must round to zero and be refused
        rather than rounded up to a whole unit it was never asked to buy."""
        holdings = [
            _holding("A", "equity", price_cents=100_00, value_cents=990_000),
            _holding(
                "BRK", "bond", price_cents=1_000_000, value_cents=10_000,
                quantity_text="0", is_fractionable=False,
            ),
        ]
        report = evaluate_allocation(
            holdings, [_target("equity", 8_900), _target("bond", 1_100)]
        )
        assert not any(t.symbol == "BRK" for t in report.trades)
        refusal = next(r for r in report.refusals if r.symbol == "BRK")
        assert "fractionnable" in refusal.reason
        assert "part fractionnée" in refusal.reason

    def test_an_underweight_class_with_no_held_instrument_is_refused_by_class(self):
        """There is no instrument to size a buy against at all -- this
        engine never invents a new one to purchase."""
        holdings = [_holding("A", "equity", price_cents=100_00, value_cents=100_00 * 100)]
        report = evaluate_allocation(
            holdings, [_target("equity", 5_000), _target("crypto", 5_000)]
        )
        [refusal] = report.refusals
        assert refusal.asset_class == "crypto"
        assert refusal.symbol == ""
        assert "crypto" in refusal.reason

    def test_a_sell_never_exceeds_what_is_actually_held(self):
        """Overweight class needs to shrink by more than the holding is
        even worth -- the trade is capped at the full position, not a
        negative or over-sized quantity."""
        holdings = [
            _holding(
                "A", "equity", price_cents=100_00, value_cents=100_00 * 5,
                quantity_text="5",
            ),
            _holding("B", "bond", price_cents=100_00, value_cents=100_00 * 95, quantity_text="95"),
        ]
        report = evaluate_allocation(
            holdings, [_target("equity", 5_000), _target("bond", 5_000)]
        )
        sell = next(t for t in report.trades if t.symbol == "B")
        assert sell.action == "sell"
        assert quantity.parse(sell.quantity).value <= Decimal("95")

    def test_only_the_largest_holding_in_a_drifted_class_is_traded(self):
        holdings = [
            _holding("A", "equity", price_cents=100_00, value_cents=100_00 * 70),
            _holding(
                "BIG", "bond", price_cents=100_00, value_cents=100_00 * 25, quantity_text="25",
            ),
            _holding(
                "SMALL", "bond", price_cents=100_00, value_cents=100_00 * 5, quantity_text="5",
            ),
        ]
        report = evaluate_allocation(
            holdings, [_target("equity", 5_000), _target("bond", 5_000)]
        )
        bond_trades = [t for t in report.trades if t.asset_class == "bond"]
        assert [t.symbol for t in bond_trades] == ["BIG"]

    def test_a_holding_with_an_unknown_price_cannot_be_traded_and_is_refused(self):
        holdings = [
            _holding("A", "equity", price_cents=100_00, value_cents=100_00 * 60),
            _holding("B", "bond", price_cents=None, value_cents=None),
        ]
        report = evaluate_allocation(
            holdings, [_target("equity", 5_000), _target("bond", 5_000)]
        )
        # B is unvalued, so it never enters the current allocation at all;
        # equity alone is 100 % of what could be valued and bond has no
        # held (valued) instrument to correct against.
        assert report.total_value_cents == 100_00 * 60
        [refusal] = report.refusals
        assert refusal.asset_class == "bond"

    def test_no_drift_produces_no_trade_and_no_refusal(self):
        holdings = [_holding("A", "equity", price_cents=100_00, value_cents=100_00 * 100)]
        report = evaluate_allocation(holdings, [_target("equity", 10_000)])
        assert report.trades == []
        assert report.refusals == []


class TestSchemaShapes:
    def test_trade_and_refusal_are_distinct_types(self):
        assert Trade is not TradeRefusal
