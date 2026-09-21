"""The synthetic market, and the one property that makes it useful.

`trading/sandbox.py` exists so a household can watch the pipeline think at
22 h on a Sunday. It only earns that if the market it produces actually moves
enough for the pipeline to do something — a sandbox that answers « ne rien
faire » a hundred and fifty times running teaches nothing and cannot be the
baseline `decision/replay.py` is meant to provide.

That is not a hypothetical. The first tuning of the cycles produced exactly
that, and it got through the whole suite because the one test that asserted on
an order was passing vacuously. This file is the guard.
"""

from app.decision.replay import ReplayProvider
from app.decision.strategy import BUY, CONTINUATION, CONVICTION, DIRECTION, SELL, build_context
from app.engines.signals import PriceSeries, compute_features
from app.trading import sandbox

SYMBOLS = ("BTC-EUR", "ETH-EUR", "CW8", "AAPL", "TSLA")


def features_at(symbol: str, step: int):
    return compute_features(PriceSeries(symbol, sandbox.closes(symbol, end_index=step, count=120)))


def test_the_same_symbol_and_step_always_give_the_same_close():
    """Determinism, on any machine and any Python version: the difference
    between two sandbox runs must be the mandate, never the market."""
    first = sandbox.closes("BTC-EUR", end_index=400, count=60)
    for _ in range(5):
        assert sandbox.closes("BTC-EUR", end_index=400, count=60) == first


def test_two_instruments_do_not_move_together():
    """A sandbox whose instruments were one instrument would make every
    diversification rule untestable."""
    left = sandbox.closes("BTC-EUR", end_index=400, count=60)
    right = sandbox.closes("AAPL", end_index=400, count=60)
    assert left != right


def test_instruments_span_several_orders_of_magnitude():
    """A rounding defect that only shows on a 40 000 € instrument is one a
    sandbox of 100 € instruments would never surface."""
    prices = [sandbox.base_price_cents(symbol) for symbol in SYMBOLS]
    assert max(prices) / min(prices) > 50


def test_a_close_is_never_zero_or_negative():
    for symbol in SYMBOLS:
        for step in range(0, 2_000, 37):
            assert sandbox.close_cents(symbol, step) > 0


def test_the_book_always_has_a_spread():
    for symbol in SYMBOLS:
        bid, ask = sandbox.quote_cents(symbol, 400)
        assert 0 < bid < ask


def test_the_market_moves_enough_for_the_indicators_to_mean_something():
    """Over a long stretch every indicator must actually travel: a flat market
    makes the whole pipeline untestable and the calibration meaningless."""
    steps = range(150, 1_500, 11)
    trends = [features_at("AAPL", step).trend_bps for step in steps]
    rsis = [features_at("AAPL", step).rsi_bps for step in steps]
    assert min(trends) < -50 and max(trends) > 50
    # The RSI must reach both the oversold and the overbought side.
    assert min(rsis) < 3_500 and max(rsis) > 6_500


def test_the_deterministic_provider_finds_both_sides_of_the_market():
    """The regression this file exists for. If neither a buy nor a sell is
    ever proposed across a long stretch, the sandbox is decorative."""
    provider = ReplayProvider()
    chosen = set()
    for step in range(150, 1_200, 7):
        for symbol in SYMBOLS:
            context = build_context(features_at(symbol, step), None)
            chosen.add(provider.decide(DIRECTION, context).choice)
    assert BUY in chosen, "le marché synthétique ne déclenche jamais d'achat"
    assert SELL in chosen, "le marché synthétique ne déclenche jamais de vente"


def test_conviction_and_probability_are_not_stuck_on_one_value():
    """A model whose conviction never varies gives a mandate nothing to size
    against, and a calibration curve of one point."""
    provider = ReplayProvider()
    convictions = set()
    probabilities = set()
    for step in range(150, 1_200, 7):
        for symbol in SYMBOLS:
            context = build_context(features_at(symbol, step), None)
            convictions.add(provider.decide(CONVICTION, context).score_value)
            probabilities.add(provider.decide(CONTINUATION, context).probability_bps)
    assert len(convictions) >= 3
    assert len(probabilities) >= 3
