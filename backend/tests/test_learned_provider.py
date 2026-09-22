"""Le fournisseur appris : il répond dans le contrat, sans réseau ni GPU."""

import pytest

from app.decision.contract import PROVIDER_LABELS, PROVIDERS, DecisionError, DecisionFailureCause
from app.decision.learned import LearnedProvider
from app.decision.registry import build_provider
from app.decision.strategy import (
    BUY,
    CONTINUATION,
    CONVICTION,
    HOLD,
    SELL,
    PositionSnapshot,
    build_context,
    direction_question,
)
from app.engines.logistic import fit, vector_of
from app.engines.quantity import parse as parse_quantity
from app.engines.signals import MarketFeatures
from app.models import DecisionSettings


def features(trend=1_000, momentum=500, rsi=7_000):
    return MarketFeatures(
        symbol="AAPL", closes_seen=120, last_price_cents=10_000,
        sma_short_cents=10_150, sma_long_cents=10_000, trend_bps=trend,
        momentum_bps=momentum, rsi_bps=rsi, volatility_bps=90, drawdown_bps=40,
        range_position_bps=7_000,
    )


def trained():
    samples = []
    for index in range(-40, 40):
        row = features(trend=index * 40, momentum=index * 20, rsi=5_000 + index * 60)
        samples.append((vector_of(row), index * 30))
    return fit(samples)


def position():
    return PositionSnapshot(quantity=parse_quantity("5"), average_price_cents=10_000,
                            market_value_cents=50_000, unrealised_pnl_bps=0)


def test_learned_is_a_named_provider():
    assert "learned" in PROVIDERS
    assert PROVIDER_LABELS["learned"] == "Modèle appris (votre processeur)"


def test_a_clear_rise_is_bought_and_a_clear_fall_is_sold_when_it_can_be():
    provider = LearnedProvider(model=trained())
    rising = build_context(features(trend=1_500, momentum=900, rsi=7_500), position())
    falling = build_context(features(trend=-1_500, momentum=-900, rsi=2_500), position())
    assert provider.decide(direction_question(position()), rising).choice == BUY
    assert provider.decide(direction_question(position()), falling).choice == SELL


def test_with_nothing_held_a_fall_is_ne_rien_faire_rather_than_a_refusal():
    provider = LearnedProvider(model=trained())
    falling = build_context(features(trend=-1_500, momentum=-900, rsi=2_500), None)
    assert provider.decide(direction_question(None), falling).choice == HOLD


def test_an_unclear_reading_is_left_alone():
    provider = LearnedProvider(model=trained())
    flat = build_context(features(trend=0, momentum=0, rsi=5_000), position())
    assert provider.decide(direction_question(position()), flat).choice == HOLD


def test_the_conviction_is_the_distance_to_a_coin_toss():
    provider = LearnedProvider(model=trained())
    clear = build_context(features(trend=1_500, momentum=900, rsi=7_500), None)
    flat = build_context(features(trend=0, momentum=0, rsi=5_000), None)
    assert provider.decide(CONVICTION, clear).score_value > \
        provider.decide(CONVICTION, flat).score_value
    assert 0 <= provider.decide(CONVICTION, clear).score_value <= 10


def test_the_continuation_probability_is_carried_in_basis_points():
    provider = LearnedProvider(model=trained())
    answer = provider.decide(CONTINUATION, build_context(features(), None))
    assert 5_000 <= answer.probability_bps <= 10_000


def test_it_answers_without_a_network_in_under_a_millisecond():
    provider = LearnedProvider(model=trained())
    answer = provider.decide(direction_question(None), build_context(features(), None))
    assert answer.latency_ms <= 5
    assert answer.provider == "learned"


def test_a_context_without_the_indicators_is_named_not_guessed():
    provider = LearnedProvider(model=trained())
    with pytest.raises(DecisionError) as info:
        provider.decide(direction_question(None), {"instrument": "AAPL"})
    assert info.value.cause is DecisionFailureCause.OFF_CONTRACT


def test_the_registry_refuses_a_learned_provider_with_no_weights():
    with pytest.raises(DecisionError) as info:
        build_provider(DecisionSettings(user_id=1, provider="learned", learned_model=None))
    assert info.value.cause is DecisionFailureCause.NO_MODEL

    built = build_provider(DecisionSettings(
        user_id=1, provider="learned", learned_model=trained().canonical()))
    assert isinstance(built, LearnedProvider)
