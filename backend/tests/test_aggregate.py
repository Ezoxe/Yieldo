from datetime import date

import pytest

from app.engines.aggregate import (
    TxPoint,
    aggregate_by_category,
    aggregate_series,
    bucket_bounds,
    bucket_key,
    compare_periods,
    fill_missing_buckets,
    moving_average,
)


def _points() -> list[TxPoint]:
    return [
        TxPoint(date(2025, 1, 5), -1000, 1, 1, False),
        TxPoint(date(2025, 1, 20), -2000, 2, 1, False),
        TxPoint(date(2025, 1, 31), 300000, 3, 1, False),
        TxPoint(date(2025, 2, 3), -1500, 1, 1, False),
        TxPoint(date(2025, 2, 28), 300000, 3, 1, False),
        TxPoint(date(2025, 4, 2), -500, 1, 1, False),
        TxPoint(date(2025, 4, 2), -50000, None, 1, True),  # internal transfer
    ]


@pytest.mark.parametrize(("on", "granularity", "expected"), [
    (date(2025, 3, 4), "day", "2025-03-04"),
    (date(2025, 3, 4), "week", "2025-W10"),
    (date(2025, 3, 4), "month", "2025-03"),
    (date(2025, 3, 4), "quarter", "2025-Q1"),
    (date(2025, 3, 4), "year", "2025"),
    (date(2025, 12, 29), "week", "2026-W01"),  # ISO week rollover
])
def test_bucket_key(on, granularity, expected):
    assert bucket_key(on, granularity) == expected


@pytest.mark.parametrize(("key", "granularity", "start", "end"), [
    ("2025-03", "month", date(2025, 3, 1), date(2025, 3, 31)),
    ("2025-Q1", "quarter", date(2025, 1, 1), date(2025, 3, 31)),
    ("2025", "year", date(2025, 1, 1), date(2025, 12, 31)),
    ("2025-W10", "week", date(2025, 3, 3), date(2025, 3, 9)),
    ("2024-02", "month", date(2024, 2, 1), date(2024, 2, 29)),  # leap year
])
def test_bucket_bounds(key, granularity, start, end):
    assert bucket_bounds(key, granularity) == (start, end)


def test_monthly_series_splits_inflow_and_outflow():
    series = {b.key: b for b in aggregate_series(_points(), "month")}
    assert series["2025-01"].outflow_cents == -3000
    assert series["2025-01"].inflow_cents == 300000
    assert series["2025-01"].net_cents == 297000
    assert series["2025-01"].count == 3
    assert series["2025-02"].net_cents == 298500


def test_transfers_are_excluded_by_default():
    series = {b.key: b for b in aggregate_series(_points(), "month")}
    assert series["2025-04"].outflow_cents == -500
    with_transfers = {b.key: b for b in aggregate_series(_points(), "month",
                                                         include_transfers=True)}
    assert with_transfers["2025-04"].outflow_cents == -50500


def test_series_is_sorted_chronologically():
    keys = [b.key for b in aggregate_series(_points(), "month")]
    assert keys == sorted(keys)


def test_yearly_and_quarterly_rollups():
    # The year total must equal the sum of its quarters for the same
    # transaction set: 595500 (Q1) + -500 (Q2) = 595000.
    assert aggregate_series(_points(), "year")[0].net_cents == 595000
    quarters = {b.key: b for b in aggregate_series(_points(), "quarter")}
    assert quarters["2025-Q1"].net_cents == 595500
    assert quarters["2025-Q2"].net_cents == -500


def test_fill_missing_buckets_inserts_empty_months():
    series = aggregate_series(_points(), "month")
    filled = fill_missing_buckets(series, "month", date(2025, 1, 1), date(2025, 4, 30))
    assert [b.key for b in filled] == ["2025-01", "2025-02", "2025-03", "2025-04"]
    march = next(b for b in filled if b.key == "2025-03")
    assert march.net_cents == 0
    assert march.count == 0


def test_category_totals_and_shares_use_expenses_only():
    totals = {c.category_id: c for c in aggregate_by_category(_points())}
    assert totals[1].total_cents == -3000
    assert totals[2].total_cents == -2000
    assert 3 not in totals  # income category is not an expense share
    assert totals[1].share == pytest.approx(0.6)
    assert totals[2].share == pytest.approx(0.4)


def test_category_totals_are_sorted_by_magnitude():
    assert [c.category_id for c in aggregate_by_category(_points())] == [1, 2]


def test_compare_periods_returns_delta_and_ratio():
    comparison = compare_periods(-1500, -1000)
    assert comparison.delta_cents == -500
    assert comparison.delta_ratio == pytest.approx(0.5)


def test_compare_periods_handles_a_zero_baseline():
    assert compare_periods(-1500, 0).delta_ratio is None


def test_moving_average_uses_a_trailing_window():
    values = [b.net_cents for b in aggregate_series(_points(), "month")]
    assert moving_average(values, window=2)[0] == pytest.approx(values[0])
    assert moving_average(values, window=2)[1] == pytest.approx((values[0] + values[1]) / 2)


def test_moving_average_rejects_a_non_positive_window():
    with pytest.raises(ValueError):
        moving_average([1.0, 2.0], window=0)
