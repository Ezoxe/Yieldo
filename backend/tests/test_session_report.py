"""The balance sheet of a simulated day: a pure engine over the capital
curve, the decisions and the orders."""

from app.engines.session_report import (
    DecisionSummary,
    OrderSummary,
    Point,
    report,
)


def point(step: int, equity: int, cash: int | None = None) -> Point:
    return Point(step=step, equity_cents=equity, cash_cents=cash if cash is not None else equity,
                 exposure_cents=equity - (cash if cash is not None else equity), orders=0)


def decision(step, symbol, outcome, choice, *, mass=None, confidence=None, act=None,
             latency=100, rules=None) -> DecisionSummary:
    return DecisionSummary(step=step, symbol=symbol, outcome=outcome, choice=choice,
                           mass_bps=mass, confidence_bps=confidence, act_bps=act,
                           latency_ms=latency, rules_choice=rules)


def test_return_and_drawdown_are_read_off_the_curve():
    points = [point(1, 100_000), point(2, 104_000), point(3, 98_800), point(4, 102_000)]
    out = report(points, [], [], initial_cash_cents=100_000)
    assert out.return_bps == 200
    # 104 000 → 98 800 is a 5 % fall from the peak.
    assert out.max_drawdown_bps == 500
    assert out.final_equity_cents == 102_000


def test_winners_and_losers_are_counted_on_filled_sells():
    orders = [
        OrderSummary(step=2, symbol="AAPL", side="buy", status="filled", realised_pnl_cents=0),
        OrderSummary(step=5, symbol="AAPL", side="sell", status="filled", realised_pnl_cents=1_250),
        OrderSummary(step=7, symbol="BTC-EUR", side="sell", status="filled",
                     realised_pnl_cents=-400),
        OrderSummary(step=8, symbol="BTC-EUR", side="sell", status="failed",
                     realised_pnl_cents=0),
    ]
    out = report([point(1, 100_000)], [], orders, initial_cash_cents=100_000)
    assert out.orders == 4
    assert out.filled == 3
    assert out.winning == 1
    assert out.losing == 1
    assert out.realised_pnl_cents == 850


def test_the_model_is_scored_against_the_rules_and_its_means_ignore_gaps():
    decisions = [
        decision(1, "AAPL", "held", "ne rien faire", mass={"acheter": 3_000, "vendre": 2_000,
                 "ne rien faire": 5_000}, confidence=400, act=10_000, latency=800,
                 rules="ne rien faire"),
        decision(1, "BTC-EUR", "ordered", "acheter", mass={"acheter": 6_000, "vendre": 1_000,
                 "ne rien faire": 3_000}, confidence=2_000, act=None, latency=900,
                 rules="ne rien faire"),
        decision(2, "AAPL", "failed", None, latency=0),
    ]
    out = report([point(1, 100_000)], decisions, [], initial_cash_cents=100_000)
    assert out.decisions == 3
    assert out.held == 1 and out.ordered == 1 and out.failed == 1 and out.refused == 0
    assert out.compared == 2
    assert out.agreement_bps == 5_000
    assert out.mean_confidence_bps == 1_200
    assert out.mean_act_bps == 10_000
    # The upper median, the same convention as the overview.
    assert out.latency_p50_ms == 900


def test_the_mass_series_is_per_symbol_in_step_order_and_only_where_a_mass_exists():
    decisions = [
        decision(2, "AAPL", "held", "ne rien faire",
                 mass={"acheter": 1_000, "vendre": 2_000, "ne rien faire": 7_000}),
        decision(1, "AAPL", "ordered", "acheter",
                 mass={"acheter": 5_000, "vendre": 2_500, "ne rien faire": 2_500}),
        decision(1, "BTC-EUR", "failed", None),
    ]
    out = report([point(1, 100_000)], decisions, [], initial_cash_cents=100_000)
    series = out.mass_series["AAPL"]
    assert [row.step for row in series] == [1, 2]
    assert (series[0].buy_bps, series[0].sell_bps, series[0].hold_bps) == (5_000, 2_500, 2_500)
    assert "BTC-EUR" not in out.mass_series


def test_an_empty_day_is_all_zeros_not_a_division_error():
    out = report([], [], [], initial_cash_cents=100_000)
    assert out.return_bps == 0
    assert out.max_drawdown_bps == 0
    assert out.final_equity_cents == 100_000
    assert out.agreement_bps == 0
    assert out.mean_confidence_bps is None
    assert out.latency_p50_ms is None
    assert out.mass_series == {}
