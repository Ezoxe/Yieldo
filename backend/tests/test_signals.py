"""Market features: the arithmetic, the refusals, and the determinism the
oversight replay depends on."""

import pytest

from app.engines.signals import (
    FeatureWindows,
    PriceSeries,
    compute_features,
)
from app.trading import sandbox

WINDOWS = FeatureWindows(short=3, long=5, rsi=4, momentum=3, volatility=4)


def series(*closes: int, symbol: str = "TEST") -> PriceSeries:
    return PriceSeries(symbol=symbol, closes=tuple(closes))


def test_a_rising_series_reads_as_a_rising_trend():
    features = compute_features(series(100, 110, 120, 130, 140, 150), WINDOWS)
    assert features.trend_bps > 0
    assert features.momentum_bps > 0
    assert features.rsi_bps == 10_000  # nothing fell at all
    assert features.drawdown_bps == 0
    assert features.range_position_bps == 10_000


def test_a_falling_series_reads_as_a_falling_trend():
    features = compute_features(series(150, 140, 130, 120, 110, 100), WINDOWS)
    assert features.trend_bps < 0
    assert features.momentum_bps < 0
    assert features.rsi_bps == 0
    assert features.drawdown_bps > 0
    assert features.range_position_bps == 0


def test_a_flat_series_reads_as_neutral_rather_than_as_a_division_by_zero():
    features = compute_features(series(100, 100, 100, 100, 100, 100), WINDOWS)
    assert features.trend_bps == 0
    assert features.momentum_bps == 0
    assert features.rsi_bps == 5_000
    assert features.volatility_bps == 0
    assert features.range_position_bps == 5_000


def test_momentum_is_measured_over_its_own_window():
    # Last is 150, three periods back is 120: +25 %.
    features = compute_features(series(100, 110, 120, 130, 140, 150), WINDOWS)
    assert features.momentum_bps == 2_500


def test_drawdown_is_measured_from_the_window_high():
    features = compute_features(series(100, 110, 200, 150, 160, 100), WINDOWS)
    # Window high over the long window (5) is 200, last is 100: half of it gone.
    assert features.drawdown_bps == 5_000


def test_a_series_too_short_is_refused_with_a_sentence_naming_what_is_missing():
    with pytest.raises(ValueError) as caught:
        compute_features(series(100, 101, 102, symbol="CW8"), WINDOWS)
    message = str(caught.value)
    assert "CW8" in message
    assert "3 cours" in message
    assert "au moins" in message


def test_a_zero_price_is_refused_rather_than_divided_by():
    with pytest.raises(ValueError) as caught:
        compute_features(series(100, 0, 102, 103, 104, 105), WINDOWS)
    assert "nul ou négatif" in str(caught.value)


def test_features_are_deterministic():
    """The property `POST /oversight/replay` is built on."""
    prices = series(*sandbox.closes("AAPL", end_index=300, count=60))
    first = compute_features(prices)
    for _ in range(10):
        assert compute_features(prices) == first


def test_canonical_is_ordered_and_all_integers_but_the_symbol():
    features = compute_features(series(100, 110, 120, 130, 140, 150), WINDOWS)
    canonical = features.canonical()
    assert list(canonical)[0] == "symbol"
    assert all(isinstance(value, int) for key, value in canonical.items() if key != "symbol")


def test_cutler_rsi_depends_only_on_its_own_window():
    """Wilder's smoothing would make these two differ; Cutler's must not, or
    a replay could not recompute the RSI from the stored window."""
    tail = (100, 105, 103, 108, 110, 109)
    short = compute_features(series(*tail), WINDOWS)
    long = compute_features(series(50, 60, 70, 80, 90, *tail), WINDOWS)
    assert short.rsi_bps == long.rsi_bps
