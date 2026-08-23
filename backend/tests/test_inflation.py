from datetime import date

import pytest

from app.engines.inflation import (
    MIN_MONTHS_PER_WINDOW,
    CategorySpend,
    Window,
    compute_inflation,
    previous_year_window,
    reference_ratio_from_index,
)

CURRENT = Window(start=date(2026, 1, 1), end=date(2026, 6, 30))


def _spend(year: int, month: int, category_id: int, amount: int) -> CategorySpend:
    return CategorySpend(on=date(year, month, 12), amount_cents=amount, category_id=category_id)


def _six_months(year: int, category_id: int, amount: int, first_month: int = 1):
    return [_spend(year, first_month + index, category_id, amount) for index in range(6)]


def test_the_previous_window_is_the_same_span_a_year_earlier():
    previous = previous_year_window(CURRENT)
    assert previous.start == date(2025, 1, 1)
    assert previous.end == date(2025, 6, 30)


def test_a_leap_day_window_does_not_crash_on_a_non_leap_year():
    previous = previous_year_window(Window(start=date(2024, 2, 29), end=date(2024, 8, 29)))
    assert previous.start == date(2023, 2, 28)
    assert previous.end == date(2023, 8, 29)


def test_a_category_that_costs_more_reports_a_positive_ratio():
    entries = _six_months(2026, 1, -30_000) + _six_months(2025, 1, -25_000)
    report = compute_inflation(entries, CURRENT, [])
    line = next(line for line in report.lines if line.category_id == 1)

    assert line.comparable is True
    assert line.current_cost_cents == 30_000
    assert line.previous_cost_cents == 25_000
    assert line.delta_cents == 5_000
    assert line.ratio == pytest.approx(0.2)


def test_a_category_that_costs_less_reports_a_negative_ratio():
    entries = _six_months(2026, 1, -20_000) + _six_months(2025, 1, -25_000)
    lines = compute_inflation(entries, CURRENT, []).lines
    line = next(item for item in lines if item.category_id == 1)
    assert line.ratio == pytest.approx(-0.2)
    assert line.delta_cents == -5_000


def test_the_comparison_is_per_month_not_per_total():
    """Six months of data against three months of data. Comparing totals would
    report a 50 % fall; comparing the median month reports no change, which is
    what the ledger actually says. This is the test that would fail if someone
    "simplified" the engine back to comparing window totals: at 180 000 c
    against 90 000 c a total-based ratio would read +100 %, not 0."""
    entries = _six_months(2026, 1, -30_000) + [
        _spend(2025, month, 1, -30_000) for month in (1, 2, 3)
    ]
    lines = compute_inflation(entries, CURRENT, []).lines
    line = next(item for item in lines if item.category_id == 1)
    assert line.ratio == pytest.approx(0.0)
    assert line.months_current == 6
    assert line.months_previous == 3


def test_a_window_with_too_few_months_is_not_comparable_and_says_why():
    """The operator's own case: everything twelve months back is empty. The line
    must appear with a reason, not silently vanish and not report -100 %."""
    entries = _six_months(2026, 1, -30_000)
    lines = compute_inflation(entries, CURRENT, []).lines
    line = next(item for item in lines if item.category_id == 1)

    assert line.comparable is False
    assert line.ratio is None
    assert line.months_previous == 0
    assert line.reason is not None
    assert "3 mois" in line.reason
    assert MIN_MONTHS_PER_WINDOW == 3


def test_a_category_dropped_entirely_is_not_reported_as_deflation():
    """A category bought every month a year ago and never since is a different
    fact from a category whose price fell to zero -- it is not a -100 % line,
    it is an incomparable one. `current_cost_cents` reads 0 only because there
    is nothing to take a median of, never because a real price was measured at
    zero."""
    entries = _six_months(2025, 1, -20_000)
    lines = compute_inflation(entries, CURRENT, []).lines
    line = next(item for item in lines if item.category_id == 1)
    assert line.comparable is False
    assert line.ratio is None
    assert line.current_cost_cents == 0
    assert line.months_current == 0
    assert line.months_previous == 6


def test_a_previous_window_with_only_zero_amount_rows_is_not_comparable():
    """Amount-zero rows are not spending -- the same exclusion
    `test_income_is_not_part_of_the_basket` pins for positive amounts -- so a
    category paid nothing (rather than a real, measured zero) in every month of
    the previous window has ZERO qualifying months there, not three months
    whose median happens to be zero. `months_previous == 0` is what actually
    stops the ratio from ever dividing by zero: a month only enters the
    per-month totals this engine's median is taken over when it holds at least
    one negative-amount row, so that total -- and therefore the median -- can
    never come out to exactly zero. The `previous_cost_cents > 0` guard on
    `comparable` is consequently defensive rather than reachable through this
    module's own filtering: it is kept in case that filtering is ever loosened
    to admit zero-amount rows."""
    entries = _six_months(2026, 1, -30_000) + [_spend(2025, month, 1, 0) for month in range(1, 7)]
    lines = compute_inflation(entries, CURRENT, []).lines
    line = next(item for item in lines if item.category_id == 1)
    assert line.ratio is None
    assert line.comparable is False
    assert line.months_previous == 0


def test_income_is_not_part_of_the_basket():
    """"Where is my money going more than before" is about spending. A salary
    rise is a real fact but it is not inflation."""
    entries = _six_months(2026, 1, 220_000) + _six_months(2025, 1, 200_000)
    assert compute_inflation(entries, CURRENT, []).lines == []


def test_the_basket_total_is_reported_when_enough_categories_are_comparable():
    entries = (
        _six_months(2026, 1, -30_000) + _six_months(2025, 1, -25_000)
        + _six_months(2026, 2, -10_000) + _six_months(2025, 2, -10_000)
    )
    report = compute_inflation(entries, CURRENT, [])
    assert report.comparable is True
    assert report.basket_current_cost_cents == 40_000
    assert report.basket_previous_cost_cents == 35_000
    assert report.basket_ratio == pytest.approx(5_000 / 35_000)


def test_the_basket_refuses_when_nothing_is_comparable():
    report = compute_inflation(_six_months(2026, 1, -30_000), CURRENT, [])
    assert report.comparable is False
    assert report.basket_ratio is None
    assert report.reason is not None


def test_the_worst_increase_comes_first():
    entries = (
        _six_months(2026, 1, -11_000) + _six_months(2025, 1, -10_000)   # +10 %
        + _six_months(2026, 2, -15_000) + _six_months(2025, 2, -10_000)  # +50 %
    )
    lines = [line for line in compute_inflation(entries, CURRENT, []).lines if line.comparable]
    assert [line.category_id for line in lines] == [2, 1]


def test_incomparable_lines_sort_after_comparable_ones():
    entries = (
        _six_months(2026, 1, -11_000) + _six_months(2025, 1, -10_000)
        + _six_months(2026, 2, -15_000)
    )
    lines = compute_inflation(entries, CURRENT, []).lines
    assert lines[-1].comparable is False


def test_a_reference_index_is_used_when_it_covers_both_windows():
    """User-supplied, never fetched. 118.42 is stored as 11842 hundredths."""
    points = [(date(2025, month, 1), 11_842) for month in range(1, 7)]
    points += [(date(2026, month, 1), 12_078) for month in range(1, 7)]
    ratio = reference_ratio_from_index(points, CURRENT, previous_year_window(CURRENT))
    assert ratio == pytest.approx((12_078 - 11_842) / 11_842)


def test_no_reference_index_is_no_reference_ratio_not_zero():
    assert reference_ratio_from_index([], CURRENT, previous_year_window(CURRENT)) is None


def test_a_reference_index_covering_only_one_window_is_unusable():
    points = [(date(2026, month, 1), 12_078) for month in range(1, 7)]
    assert reference_ratio_from_index(points, CURRENT, previous_year_window(CURRENT)) is None


def test_the_reference_ratio_reaches_the_report():
    entries = _six_months(2026, 1, -30_000) + _six_months(2025, 1, -25_000)
    points = [(date(2025, m, 1), 11_842) for m in range(1, 7)]
    points += [(date(2026, m, 1), 12_078) for m in range(1, 7)]
    report = compute_inflation(entries, CURRENT, points)
    assert report.reference_ratio is not None
    assert report.basket_ratio > report.reference_ratio


def test_an_empty_ledger_refuses_with_a_reason():
    report = compute_inflation([], CURRENT, [])
    assert report.lines == []
    assert report.comparable is False
    assert report.reason is not None
