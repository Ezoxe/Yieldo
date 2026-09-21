"""The second opinion: how often the model and the built-in rules agree on
the direction, and where they did not. A pure engine over stored opinions."""

from datetime import UTC, datetime

from app.engines.second_opinion import Opinion, compare


def at(minute: int) -> datetime:
    return datetime(2026, 9, 21, 9, minute, tzinfo=UTC)


def opinion(i: int, model: str | None, rules: str | None, symbol: str = "BTC-EUR") -> Opinion:
    return Opinion(decision_id=i, symbol=symbol, created_at=at(i), model_choice=model,
                   rules_choice=rules)


def test_agreement_is_counted_on_the_direction_in_basis_points():
    report = compare([
        opinion(1, "acheter", "acheter"),
        opinion(2, "ne rien faire", "ne rien faire"),
        opinion(3, "acheter", "ne rien faire"),
    ])
    assert report.compared == 3
    assert report.agreed == 2
    assert report.agreement_bps == 6_667
    assert len(report.disagreements) == 1
    assert report.disagreements[0].decision_id == 3
    assert report.disagreements[0].model_choice == "acheter"
    assert report.disagreements[0].rules_choice == "ne rien faire"


def test_a_row_with_no_opinion_on_either_side_is_not_compared():
    # The deterministic engine as the configured model has no second opinion
    # (NULL); a failed decision has no model answer. Neither is a disagreement.
    report = compare([
        opinion(1, "acheter", None),
        opinion(2, None, "vendre"),
        opinion(3, "vendre", "vendre"),
    ])
    assert report.compared == 1
    assert report.agreed == 1
    assert report.agreement_bps == 10_000
    assert report.disagreements == ()


def test_nothing_compared_is_zero_not_a_division_error():
    report = compare([])
    assert (report.compared, report.agreed, report.agreement_bps) == (0, 0, 0)
    assert report.disagreements == ()


def test_disagreements_come_most_recent_first_and_are_capped_at_eight():
    rows = [opinion(i, "acheter", "vendre") for i in range(1, 12)]
    report = compare(rows)
    assert report.compared == 11
    assert len(report.disagreements) == 8
    assert [d.decision_id for d in report.disagreements] == list(range(11, 3, -1))
