from datetime import date

import pytest

from app.engines.aggregate import TxPoint
from app.engines.category_history import (
    Average,
    CategoryNode,
    MonthSpend,
    YearSpend,
    average_ticket,
    is_complete,
    mean_cents,
    monthly_average,
    monthly_series,
    spend,
    subtree_ids,
    yearly,
)


def _pt(on: date, cents: int, category: int = 1, transfer: bool = False) -> TxPoint:
    return TxPoint(on=on, amount_cents=cents, category_id=category, account_id=1,
                   is_transfer=transfer)


def test_the_subtree_holds_the_category_and_every_descendant():
    nodes = [CategoryNode(1, None), CategoryNode(2, 1), CategoryNode(3, 2), CategoryNode(4, None)]
    assert subtree_ids(nodes, 1) == frozenset({1, 2, 3})


def test_the_subtree_survives_a_cycle():
    assert subtree_ids([CategoryNode(1, 2), CategoryNode(2, 1)], 1) == frozenset({1, 2})


def test_a_month_is_complete_only_when_the_ledger_covers_both_ends():
    assert is_complete("2026-02", date(2026, 2, 1), date(2026, 2, 28))
    assert not is_complete("2026-02", date(2026, 2, 2), date(2026, 3, 31))
    assert not is_complete("2026-09", date(2025, 1, 1), date(2026, 9, 24))


def test_the_series_covers_every_month_and_counts_outflows_of_the_subtree_only():
    points = [
        _pt(date(2026, 1, 5), -5000),
        _pt(date(2026, 1, 20), -2500),
        _pt(date(2026, 1, 21), 1200),                  # a refund is not a spend
        _pt(date(2026, 3, 2), -4000),
        _pt(date(2026, 3, 3), -900, category=9),        # another category
        _pt(date(2026, 3, 4), -3000, transfer=True),    # an internal transfer
    ]
    series = monthly_series(points, frozenset({1}), date(2026, 1, 1), date(2026, 3, 31))
    assert [m.key for m in series] == ["2026-01", "2026-02", "2026-03"]
    assert [m.spent_cents for m in series] == [-7500, 0, -4000]
    assert [m.count for m in series] == [2, 0, 1]
    assert all(m.complete for m in series)


def test_a_covered_month_with_nothing_spent_counts_as_zero():
    series = [MonthSpend("2026-01", -9000, 3, True), MonthSpend("2026-02", 0, 0, True),
              MonthSpend("2026-03", -6000, 2, True)]
    assert monthly_average(series) == Average(average_cents=-5000, months_counted=3)


def test_incomplete_months_stay_out_of_the_average():
    series = [MonthSpend("2025-12", -100000, 9, False),
              MonthSpend("2026-01", -3000, 1, True), MonthSpend("2026-02", -3000, 1, True),
              MonthSpend("2026-03", -3000, 1, True), MonthSpend("2026-04", -500, 1, False)]
    assert monthly_average(series) == Average(average_cents=-3000, months_counted=3)


def test_fewer_than_three_complete_months_give_no_average():
    series = [MonthSpend("2026-01", -3000, 1, True), MonthSpend("2026-02", -3000, 1, True)]
    assert monthly_average(series) == Average(average_cents=None, months_counted=2)


def test_means_are_integer_cents_rounded_half_away_from_zero():
    assert mean_cents(-5, 2) == -3
    assert mean_cents(-4, 3) == -1
    assert mean_cents(0, 4) == 0
    with pytest.raises(ValueError):
        mean_cents(-100, 0)


def test_each_year_is_summed_over_its_complete_months():
    series = [MonthSpend(f"2025-{m:02d}", -1000, 1, True) for m in (10, 11, 12)]
    series += [MonthSpend("2026-01", -4000, 2, True), MonthSpend("2026-02", -2000, 1, False)]
    assert yearly(series) == [YearSpend(2025, -3000, 3, -1000), YearSpend(2026, -4000, 1, None)]


def test_the_average_ticket_needs_an_operation():
    assert average_ticket(0, 0) is None
    assert average_ticket(-11800, 2) == -5900


def test_spend_sums_the_outflows_of_the_subtree():
    points = [_pt(date(2026, 9, 1), -5000, category=2), _pt(date(2026, 9, 2), -1000, category=3),
              _pt(date(2026, 9, 3), -700, category=7)]
    assert spend(points, frozenset({2, 3})) == (-6000, 2)
