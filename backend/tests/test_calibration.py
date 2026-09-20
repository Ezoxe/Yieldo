"""Was the model right as often as it said it would be?"""

from app.engines.calibration import (
    COIN_FLIP_BRIER_BPS,
    Observation,
    evaluate_calibration,
)


def observations(pairs):
    return tuple(Observation(probability_bps=p, happened=h) for p, h in pairs)


def test_an_empty_record_says_so_rather_than_scoring_zero():
    report = evaluate_calibration(())
    assert report.observations == 0
    assert report.buckets == ()
    assert "Aucune" in report.verdict


def test_a_perfectly_confident_and_correct_model_scores_zero():
    report = evaluate_calibration(observations([(10_000, True)] * 30))
    assert report.brier_bps == 0


def test_a_perfectly_confident_and_wrong_model_scores_the_worst_possible():
    report = evaluate_calibration(observations([(10_000, False)] * 30))
    assert report.brier_bps == 10_000


def test_a_coin_flipping_model_scores_the_coin_flip_line():
    report = evaluate_calibration(observations([(5_000, True), (5_000, False)] * 15))
    assert report.brier_bps == COIN_FLIP_BRIER_BPS
    assert "pièce" in report.verdict


def test_buckets_compare_what_was_stated_against_what_happened():
    # Stated 70 % twenty times, right fourteen: perfectly calibrated band.
    record = [(7_000, True)] * 14 + [(7_000, False)] * 6
    report = evaluate_calibration(observations(record))
    bucket = next(b for b in report.buckets if b.lower_bps == 7_000)
    assert bucket.count == 20
    assert bucket.stated_bps == 7_000
    assert bucket.observed_bps == 7_000
    assert bucket.gap_bps == 0


def test_an_overconfident_band_shows_a_negative_gap():
    record = [(9_000, True)] * 10 + [(9_000, False)] * 10
    report = evaluate_calibration(observations(record))
    bucket = next(b for b in report.buckets if b.lower_bps == 9_000)
    assert bucket.observed_bps == 5_000
    assert bucket.gap_bps == -4_000


def test_a_stated_certainty_lands_in_the_last_band_rather_than_one_of_its_own():
    report = evaluate_calibration(observations([(10_000, True)] * 25))
    assert [b.lower_bps for b in report.buckets] == [9_000]


def test_too_few_observations_refuse_to_judge():
    report = evaluate_calibration(observations([(7_000, True)] * 5))
    assert "trop peu" in report.verdict
