from datetime import date

import pytest

from app.engines.budget import (
    BudgetEntry,
    days_in_month,
    elapsed_days,
    evaluate_budgets,
)

# 300 EUR of groceries a month.
BUDGET = 30_000


def _line(spent_cents: int, today: date, month_start: date = date(2026, 1, 1)):
    entries = [BudgetEntry(category_id=1, budget_cents=BUDGET, spent_cents=spent_cents)]
    return evaluate_budgets(entries, month_start, today)[0]


def test_days_in_month_handles_a_leap_february():
    assert days_in_month(date(2024, 2, 1)) == 29
    assert days_in_month(date(2026, 2, 1)) == 28


def test_elapsed_days_counts_today_and_never_exceeds_the_month():
    assert elapsed_days(date(2026, 1, 1), date(2026, 1, 1)) == 1
    assert elapsed_days(date(2026, 1, 1), date(2026, 1, 15)) == 15
    # A month long finished is fully elapsed, not 220 days elapsed.
    assert elapsed_days(date(2026, 1, 1), date(2026, 8, 12)) == 31
    # A month not yet started has nothing elapsed.
    assert elapsed_days(date(2026, 9, 1), date(2026, 8, 12)) == 0


def test_a_finished_month_under_budget_is_ok_and_projects_nothing():
    """A month that is over does not need projecting: it *is* its own result."""
    line = _line(-25_000, date(2026, 8, 12))
    assert line.status == "ok"
    assert line.remaining_cents == 5_000
    assert line.projected_cents is None
    assert line.consumed_ratio == pytest.approx(25_000 / 30_000)


def test_spending_past_the_budget_is_over_and_remaining_goes_negative():
    line = _line(-34_500, date(2026, 8, 12))
    assert line.status == "over"
    assert line.remaining_cents == -4_500


def test_a_month_on_pace_to_overrun_is_at_risk_before_it_overruns():
    """Half of January gone, 20 000 spent of a 30 000 budget: still under, but
    the month lands at 40 000. Saying "ok" here is the alert arriving too late."""
    line = _line(-20_000, date(2026, 1, 15))
    assert line.status == "at_risk"
    assert line.projected_cents == -(20_000 * 31 // 15)
    assert line.remaining_cents == 10_000


def test_a_month_on_pace_to_land_inside_the_budget_is_ok():
    line = _line(-10_000, date(2026, 1, 15))
    assert line.status == "ok"
    assert line.projected_cents == -(10_000 * 31 // 15)


def test_two_days_into_the_month_no_pace_is_claimed():
    """One grocery run on the 2nd projects to a fifteen-fold overrun. Below a
    fifth of the month, the projection is not made at all rather than made
    badly -- and no "at_risk" is raised on the strength of it."""
    line = _line(-8_000, date(2026, 1, 2))
    assert line.projected_cents is None
    assert line.status == "ok"


def test_the_pace_floor_is_exactly_one_fifth_of_the_month():
    # 31-day month: 6 days elapsed is 6*5 = 30 < 31, still too early; 7 is enough.
    assert _line(-20_000, date(2026, 1, 6)).projected_cents is None
    assert _line(-20_000, date(2026, 1, 7)).projected_cents is not None


def test_a_month_not_yet_started_projects_nothing():
    line = _line(0, date(2026, 8, 12), month_start=date(2026, 9, 1))
    assert line.projected_cents is None
    assert line.status == "ok"


def test_overspending_wins_over_pace():
    """Already past the ceiling on the 15th: "over" is the fact, "at_risk" would
    be a softer word for the same thing."""
    line = _line(-31_000, date(2026, 1, 15))
    assert line.status == "over"


def test_a_budget_of_zero_is_rejected_rather_than_divided_by():
    with pytest.raises(ValueError):
        evaluate_budgets(
            [BudgetEntry(category_id=1, budget_cents=0, spent_cents=-100)],
            date(2026, 1, 1),
            date(2026, 1, 15),
        )


def test_lines_come_back_in_the_order_they_were_given():
    entries = [
        BudgetEntry(category_id=7, budget_cents=10_000, spent_cents=-1_000),
        BudgetEntry(category_id=3, budget_cents=10_000, spent_cents=-9_000),
    ]
    lines = evaluate_budgets(entries, date(2026, 1, 1), date(2026, 8, 12))
    assert [line.category_id for line in lines] == [7, 3]
