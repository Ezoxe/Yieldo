"""Le modèle appris : ce qu'il apprend, et ce qu'il refuse.

Les chiffres visés sont ceux mesurés sur le bac à sable, protocole à deux
fenêtres : 63 à 66 % d'exactitude hors échantillon, contre 51 % pour Laya en
zero-shot, et un avantage net positif sur les deux fenêtres.
"""

import pytest

from app.engines.logistic import COLUMNS, LearnedModel, fit, vector_of
from app.engines.signals import MarketFeatures


def features(**overrides) -> MarketFeatures:
    base = dict(
        symbol="AAPL", closes_seen=120, last_price_cents=10_000,
        sma_short_cents=10_100, sma_long_cents=10_000, trend_bps=100,
        momentum_bps=200, rsi_bps=6_000, volatility_bps=90, drawdown_bps=50,
        range_position_bps=7_000,
    )
    base.update(overrides)
    return MarketFeatures(**base)


def samples(count: int = 200):
    """Un jeu où la vérité est lisible : le mouvement suit la tendance."""
    out = []
    for index in range(count):
        trend = (index % 40) - 20
        row = features(trend_bps=trend * 10, momentum_bps=trend * 5,
                       rsi_bps=5_000 + trend * 50)
        out.append((vector_of(row), trend * 8))
    return out


def test_the_vector_carries_seven_columns_centred_where_the_middle_means_something():
    vector = vector_of(features(rsi_bps=5_000, range_position_bps=5_000))
    assert len(vector) == len(COLUMNS) == 7
    # Un RSI à 50 % et un cours au milieu du canal valent zéro, pas 50.
    assert vector[2] == 0
    assert vector[5] == 0


def test_a_model_learns_a_signal_that_is_actually_there():
    model = fit(samples())
    rising = model.probability(vector_of(features(trend_bps=1_500, momentum_bps=800,
                                                  rsi_bps=7_000)))
    falling = model.probability(vector_of(features(trend_bps=-1_500, momentum_bps=-800,
                                                   rsi_bps=3_000)))
    assert rising > 0.6
    assert falling < 0.4
    assert model.trained_on == 200


def test_the_same_samples_give_the_same_weights_on_any_machine():
    first, second = fit(samples()), fit(samples())
    assert first.weights == second.weights
    assert first.bias == second.bias


def test_a_model_survives_being_written_down_and_read_back():
    model = fit(samples())
    again = LearnedModel.from_canonical(model.canonical())
    assert again.weights == model.weights
    vector = vector_of(features())
    assert again.probability(vector) == model.probability(vector)


def test_a_vector_of_the_wrong_width_is_refused_rather_than_padded():
    model = fit(samples())
    with pytest.raises(ValueError):
        model.probability([1.0, 2.0])


def test_learning_from_nothing_is_refused():
    with pytest.raises(ValueError):
        fit([])


def test_a_constant_column_does_not_divide_by_zero():
    flat = [(vector_of(features(volatility_bps=90)), index * 5) for index in range(-20, 20)]
    model = fit(flat)
    assert all(stdev > 0 for stdev in model.stdevs)
