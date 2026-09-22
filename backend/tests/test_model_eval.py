"""Le protocole qui décide si un modèle décide.

Les chiffres de ces tests sont ceux mesurés sur Laya en zero-shot : 51,1 %
d'exactitude pour 41,0 % de hasard (p = 0,001) sur une fenêtre, et un edge
qui s'inverse sur la suivante.
"""

import pytest

from app.engines.model_eval import compare_windows, evaluate

BUY, HOLD = "acheter", "ne rien faire"


def test_a_model_that_answers_at_random_is_named_as_such():
    # Une réponse sur deux, sans rapport avec l'étiquette.
    predictions = [BUY, HOLD] * 40
    labels = [BUY, BUY, HOLD, HOLD] * 20
    verdict = evaluate(predictions, labels, [0] * 80, draws=400)
    assert verdict.p_value_bps > 500
    assert not verdict.significant


def test_a_model_that_reads_the_state_beats_the_permutations():
    labels = [BUY if index % 3 else HOLD for index in range(90)]
    predictions = [label if index % 5 else HOLD for index, label in enumerate(labels)]
    verdict = evaluate(predictions, labels, [0] * 90, draws=400)
    assert verdict.accuracy_bps > verdict.chance_accuracy_bps
    assert verdict.significant


def test_the_edge_is_measured_against_the_market_not_against_zero():
    # Le marché monte de 100 bps partout : acheter partout n'est pas une
    # compétence, et l'edge doit le dire.
    verdict = evaluate([BUY] * 20, [BUY] * 20, [100] * 20)
    assert verdict.buy_move_bps == 100
    assert verdict.market_move_bps == 100
    assert verdict.edge_bps == 0
    assert verdict.net_edge_bps == -20
    assert not verdict.profitable


def test_an_edge_below_the_cost_of_a_round_trip_is_not_profitable():
    moves = [200 if index % 2 else 0 for index in range(40)]
    predictions = [BUY if index % 2 else HOLD for index in range(40)]
    verdict = evaluate(predictions, predictions, moves, cost_bps=200)
    assert verdict.edge_bps == 100
    assert verdict.net_edge_bps == -100
    assert not verdict.profitable


def test_two_windows_are_required_and_the_refusal_names_which_failed():
    strong = evaluate([BUY] * 30, [BUY] * 30, [300] * 15 + [0] * 15, draws=200)
    weak = evaluate([BUY, HOLD] * 15, [BUY, BUY, HOLD, HOLD] * 7 + [BUY, HOLD],
                    [0] * 30, draws=200)
    held, why = compare_windows(strong, weak)
    assert held is False
    assert "hasard" in why


def test_a_signal_that_holds_on_both_windows_is_accepted():
    labels = [BUY if index % 2 else HOLD for index in range(40)]
    moves = [400 if index % 2 else -100 for index in range(40)]
    verdict = evaluate(labels, labels, moves, draws=400)
    held, why = compare_windows(verdict, verdict)
    assert held is True
    assert "paie l'exécution" in why


def test_mismatched_lengths_are_refused_rather_than_truncated():
    with pytest.raises(ValueError):
        evaluate([BUY], [BUY, HOLD], [0, 0])
