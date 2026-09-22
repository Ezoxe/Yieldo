"""The training set a simulated day yields.

The sandbox market is deterministic, so a decision's future is knowable: for
every state the model was shown, Yieldo can say what the right answer turned
out to be. That is the only thing standing between Laya and a fine-tune —
measured on this sandbox, its answers correlate 0,003 with what happened
next, and an encoder learns a domain by training, not by prompting.
"""

from app.engines.training_set import Example, label_examples


def state(step: int) -> dict:
    return {"instrument": "AAPL", "dernier_cours": "30,86 €", "etape": step}


def test_a_rise_after_the_state_labels_the_example_acheter():
    examples = label_examples([
        (state(1), 10_000, ["acheter", "ne rien faire"]),
        (state(2), 10_400, ["acheter", "ne rien faire"]),
    ], horizon=1, dead_band_bps=100)
    assert len(examples) == 1
    assert examples[0].direction == "acheter"
    # 4 % on a 1 % dead band: as clear as this scale goes.
    assert examples[0].conviction == 10
    assert examples[0].continuation is True


def test_a_fall_labels_vendre_only_when_the_sale_was_on_the_table():
    with_sale = label_examples([
        (state(1), 10_000, ["acheter", "vendre", "ne rien faire"]),
        (state(2), 9_600, ["acheter", "vendre", "ne rien faire"]),
    ], horizon=1, dead_band_bps=100)
    assert with_sale[0].direction == "vendre"

    # Nothing held: the fall is real, but the only honest label is « ne rien
    # faire » — the answer the pipeline could have executed.
    without = label_examples([
        (state(1), 10_000, ["acheter", "ne rien faire"]),
        (state(2), 9_600, ["acheter", "ne rien faire"]),
    ], horizon=1, dead_band_bps=100)
    assert without[0].direction == "ne rien faire"


def test_a_move_inside_the_dead_band_is_ne_rien_faire():
    examples = label_examples([
        (state(1), 10_000, ["acheter", "vendre", "ne rien faire"]),
        (state(2), 10_030, ["acheter", "vendre", "ne rien faire"]),
    ], horizon=1, dead_band_bps=100)
    assert examples[0].direction == "ne rien faire"
    assert examples[0].conviction == 0


def test_the_last_states_have_no_future_and_are_left_out():
    examples = label_examples([
        (state(i), 10_000 + i * 50, ["acheter", "ne rien faire"]) for i in range(5)
    ], horizon=2, dead_band_bps=100)
    assert len(examples) == 3


def test_an_example_serialises_to_the_jsonl_a_trainer_reads():
    example = label_examples([
        (state(1), 10_000, ["acheter", "ne rien faire"]),
        (state(2), 10_400, ["acheter", "ne rien faire"]),
    ], horizon=1, dead_band_bps=100)[0]
    row = example.canonical()
    assert row["state"]["instrument"] == "AAPL"
    assert row["questions"]["direction"]["type"] == "choice"
    assert set(row["questions"]["direction"]["criteria"]) == {"acheter", "ne rien faire"}
    assert row["questions"]["conviction"]["type"] == "score"
    assert row["questions"]["continuation"]["type"] == "noul"
    assert row["answers"] == {"direction": "acheter", "conviction": 10, "continuation": True}


def test_nothing_is_labelled_from_a_single_state():
    assert label_examples([(state(1), 10_000, ["acheter"])], horizon=1, dead_band_bps=100) == ()


def test_examples_are_deterministic():
    rows = [(state(i), 10_000 + (i % 3) * 120, ["acheter", "vendre", "ne rien faire"])
            for i in range(12)]
    assert label_examples(rows, horizon=2, dead_band_bps=100) == \
        label_examples(rows, horizon=2, dead_band_bps=100)


def test_the_example_type_is_frozen():
    example = Example(state={}, options=("acheter",), direction="acheter", conviction=5,
                      continuation=True, move_bps=250)
    assert example.move_bps == 250
