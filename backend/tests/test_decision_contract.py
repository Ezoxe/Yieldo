"""The typed decision: the type is enforced, not hoped for.

This file holds the property that makes a model safe to put in front of money:
an answer outside its own type is REFUSED, never coerced into range.
"""

import pytest

from app.decision.contract import (
    PROVIDER_LABELS,
    PROVIDERS,
    ChoiceQuestion,
    Decision,
    DecisionError,
    DecisionFailureCause,
    ProbabilityQuestion,
    ScoreQuestion,
    failure_message,
    json_schema_for,
    parse_answer,
)
from app.decision.replay import ReplayProvider
from app.decision.strategy import BUY, CONTINUATION, CONVICTION, DIRECTION, HOLD, SELL

DIRECTION_Q = ChoiceQuestion(key="d", prompt="?", options=("acheter", "vendre", "ne rien faire"))
SCORE_Q = ScoreQuestion(key="s", prompt="?", minimum=0, maximum=10)
PROBABILITY_Q = ProbabilityQuestion(key="p", statement="?")


# --- the contract refuses what it was not offered --------------------------

def test_a_choice_inside_the_options_is_accepted():
    assert parse_answer(DIRECTION_Q, '{"answer": "acheter"}', "local")["choice"] == "acheter"


def test_a_choice_outside_the_options_is_refused_not_matched_to_the_nearest():
    with pytest.raises(DecisionError) as caught:
        parse_answer(DIRECTION_Q, '{"answer": "ACHETER MAINTENANT"}', "local")
    assert caught.value.cause is DecisionFailureCause.OFF_CONTRACT


def test_a_choice_is_never_case_folded():
    """"Acheter" is not "acheter": a model that could not reproduce the option
    exactly did not pick it."""
    with pytest.raises(DecisionError):
        parse_answer(DIRECTION_Q, '{"answer": "Acheter"}', "local")


def test_prose_around_the_json_is_refused_rather_than_unwrapped():
    with pytest.raises(DecisionError) as caught:
        parse_answer(DIRECTION_Q, 'Je pense qu\'il faut {"answer": "acheter"}', "local")
    assert caught.value.cause is DecisionFailureCause.OFF_CONTRACT


def test_a_score_outside_the_scale_is_refused_not_clamped():
    with pytest.raises(DecisionError) as caught:
        parse_answer(SCORE_Q, '{"answer": 14}', "local")
    assert "14" in caught.value.message or "sort de l'échelle" in caught.value.message
    assert caught.value.cause is DecisionFailureCause.OFF_CONTRACT


def test_a_fractional_score_is_refused_not_rounded():
    with pytest.raises(DecisionError):
        parse_answer(SCORE_Q, '{"answer": 7.4}', "local")


def test_a_boolean_is_not_a_score():
    """`True` is an `int` in Python and would otherwise sail through as 1."""
    with pytest.raises(DecisionError):
        parse_answer(SCORE_Q, '{"answer": true}', "local")


def test_a_probability_is_carried_in_basis_points():
    parsed = parse_answer(PROBABILITY_Q, '{"answer": 65}', "local")
    assert parsed["probability_bps"] == 6_500


def test_a_probability_outside_zero_to_a_hundred_is_refused():
    with pytest.raises(DecisionError):
        parse_answer(PROBABILITY_Q, '{"answer": 140}', "local")


def test_a_missing_answer_key_is_refused():
    with pytest.raises(DecisionError):
        parse_answer(DIRECTION_Q, '{"choice": "acheter"}', "local")


# --- the schema that stops it happening in the first place -----------------

def test_a_choice_schema_pins_the_options_as_an_enum():
    schema = json_schema_for(DIRECTION_Q)
    assert schema["properties"]["answer"]["enum"] == list(DIRECTION_Q.options)
    assert schema["additionalProperties"] is False


def test_a_score_schema_pins_both_ends_of_the_scale():
    schema = json_schema_for(SCORE_Q)
    assert schema["properties"]["answer"]["minimum"] == 0
    assert schema["properties"]["answer"]["maximum"] == 10


# --- five causes, five remedies --------------------------------------------

def test_every_failure_cause_has_its_own_french_sentence():
    sentences = {
        failure_message(cause, "local") for cause in DecisionFailureCause
    }
    assert len(sentences) == len(DecisionFailureCause)


def test_no_model_points_at_the_screen_that_fixes_it():
    assert "Modèle de décision" in failure_message(DecisionFailureCause.NO_MODEL, "local")


def test_too_slow_explains_why_a_late_answer_is_dropped_rather_than_used():
    message = failure_message(DecisionFailureCause.TOO_SLOW, "local")
    assert "trop tard" in message


# --- the deterministic provider --------------------------------------------

def test_the_deterministic_provider_answers_inside_the_contract():
    provider = ReplayProvider()
    rising = {
        "tendance_points_de_base": 400, "momentum_points_de_base": 800,
        "rsi_points_de_base": 5_500, "position_dans_le_canal_points_de_base": 6_000,
    }
    assert provider.decide(DIRECTION, rising).choice in (BUY, SELL, HOLD)
    score = provider.decide(CONVICTION, rising).score_value
    assert score is not None and CONVICTION.minimum <= score <= CONVICTION.maximum
    probability = provider.decide(CONTINUATION, rising).probability_bps
    assert probability is not None and 0 <= probability <= 10_000


def test_the_deterministic_provider_buys_a_rising_market_and_sells_a_falling_one():
    provider = ReplayProvider()
    rising = {
        "tendance_points_de_base": 400, "momentum_points_de_base": 800,
        "rsi_points_de_base": 5_500, "position_dans_le_canal_points_de_base": 6_000,
    }
    falling = {
        "tendance_points_de_base": -400, "momentum_points_de_base": -800,
        "rsi_points_de_base": 4_500, "position_dans_le_canal_points_de_base": 4_000,
    }
    assert provider.decide(DIRECTION, rising).choice == BUY
    assert provider.decide(DIRECTION, falling).choice == SELL


def test_the_deterministic_provider_never_claims_certainty():
    """A rule engine that answered 100 % would be lying about itself."""
    provider = ReplayProvider()
    context = {
        "tendance_points_de_base": 9_999, "momentum_points_de_base": 9_999,
        "rsi_points_de_base": 100, "position_dans_le_canal_points_de_base": 0,
    }
    probability = provider.decide(CONTINUATION, context).probability_bps
    assert probability is not None and 0 < probability < 10_000


def test_the_deterministic_provider_is_deterministic():
    provider = ReplayProvider()
    context = {
        "tendance_points_de_base": 120, "momentum_points_de_base": -300,
        "rsi_points_de_base": 2_900, "position_dans_le_canal_points_de_base": 1_500,
    }
    first = provider.decide(DIRECTION, context).canonical()
    for _ in range(10):
        assert provider.decide(DIRECTION, context).canonical() == first


def test_latency_is_not_part_of_what_a_replay_compares():
    """Two runs of the same question differ in latency and must still compare
    equal, or every replay would report drift."""
    provider = ReplayProvider()
    context = {"tendance_points_de_base": 0, "momentum_points_de_base": 0,
               "rsi_points_de_base": 5_000, "position_dans_le_canal_points_de_base": 5_000}
    first = provider.decide(DIRECTION, context)
    second = provider.decide(DIRECTION, context)
    assert first.canonical() == second.canonical()
    assert "latency" not in first.canonical()


def test_mass_and_act_probability_stay_out_of_the_canonical_form():
    # Laya returns its whole distribution and an act probability. Both
    # describe this run's output, like confidence and latency: a replay must
    # not differ from the run it replays because a mass moved a little.
    decision = Decision(
        question_key="direction", kind="choice", choice="acheter", score_value=None,
        probability_bps=None, latency_ms=12, provider="laya", model="m", raw="{}",
        confidence_bps=40,
        mass_bps={"acheter": 6_000, "vendre": 1_000, "ne rien faire": 3_000},
        act_bps=10_000,
    )
    assert "mass_bps" not in decision.canonical()
    assert "act_bps" not in decision.canonical()
    assert decision.mass_bps["acheter"] == 6_000
    assert decision.act_bps == 10_000


def test_laya_is_a_named_provider():
    assert "laya" in PROVIDERS
    assert PROVIDER_LABELS["laya"] == "Laya (auto-hébergé)"
