from datetime import date

from app.engines.capacity import (
    MIN_MONTHS_FOR_RATE,
    MonthlyEntry,
    complete_months,
    measure_expense_rate,
    measure_savings_capacity,
)

LEDGER_START = date(2025, 1, 24)
LEDGER_END = date(2026, 1, 9)


def _month(year: int, month: int, *amounts: int) -> list[MonthlyEntry]:
    return [MonthlyEntry(on=date(year, month, 5), amount_cents=amount) for amount in amounts]


def test_a_month_wholly_inside_the_ledger_with_activity_is_observed():
    entries = _month(2025, 2, 220_000, -180_000)
    months = complete_months(entries, LEDGER_START, LEDGER_END)
    assert [m.key for m in months] == ["2025-02"]
    assert months[0].inflow_cents == 220_000
    assert months[0].outflow_cents == -180_000
    assert months[0].net_cents == 40_000
    assert months[0].count == 2


def test_a_partial_month_at_either_end_of_the_ledger_is_not_observed():
    """The operator's ledger opens on 24 January and closes on 9 January. Those
    two months hold a week of statements each; counting them as months would
    make the measured rate a quarter of the truth."""
    entries = _month(2025, 1, -50_000) + _month(2026, 1, -50_000) + _month(2025, 2, -180_000)
    months = complete_months(entries, LEDGER_START, LEDGER_END)
    assert [m.key for m in months] == ["2025-02"]


def test_a_month_inside_the_ledger_with_no_activity_is_not_observed():
    """April to November 2025 are empty in the operator's data -- because no
    statement was imported, not because nothing was spent. Counting them as
    zero-spend months would halve every measured rate."""
    entries = _month(2025, 2, -180_000) + _month(2025, 12, -200_000)
    months = complete_months(entries, LEDGER_START, LEDGER_END)
    assert [m.key for m in months] == ["2025-02", "2025-12"]


def test_the_operators_shape_yields_exactly_three_observed_months():
    entries = (
        _month(2025, 1, -50_000)     # partial, dropped
        + _month(2025, 2, -180_000)
        + _month(2025, 3, -90_000)
        + _month(2025, 12, -210_000)
        + _month(2026, 1, -60_000)   # partial, dropped
    )
    assert len(complete_months(entries, LEDGER_START, LEDGER_END)) == 3


def test_the_expense_rate_is_a_positive_magnitude_with_a_band():
    entries = _month(2025, 2, -180_000) + _month(2025, 3, -200_000) + _month(2025, 12, -190_000)
    rate = measure_expense_rate(complete_months(entries, LEDGER_START, LEDGER_END))
    assert rate is not None
    assert rate.months == 3
    assert rate.median_cents == 190_000
    assert rate.low_cents < rate.median_cents < rate.high_cents


def test_one_extravagant_month_does_not_redefine_the_rate():
    entries = (
        _month(2025, 2, -180_000) + _month(2025, 3, -190_000)
        + _month(2025, 4, -185_000) + _month(2025, 5, -1_800_000)
    )
    rate = measure_expense_rate(complete_months(entries, date(2025, 2, 1), date(2025, 5, 31)))
    assert rate is not None
    # The median sits between the three ordinary months, not between them and
    # the outlier -- which is the whole reason the method is robust.
    assert 180_000 <= rate.median_cents <= 190_000


def test_fewer_than_three_months_measures_nothing():
    entries = _month(2025, 2, -180_000) + _month(2025, 3, -200_000)
    assert measure_expense_rate(complete_months(entries, LEDGER_START, LEDGER_END)) is None
    assert MIN_MONTHS_FOR_RATE == 3


def test_savings_capacity_is_the_signed_monthly_net():
    """Phase 2B's purchase-feasibility engine reads exactly this. A household
    that overspends has a negative capacity, and that must survive to the
    caller rather than being clamped to zero."""
    entries = (
        _month(2025, 2, 220_000, -180_000)
        + _month(2025, 3, 220_000, -240_000)
        + _month(2025, 12, 220_000, -200_000)
    )
    capacity = measure_savings_capacity(complete_months(entries, LEDGER_START, LEDGER_END))
    assert capacity is not None
    assert capacity.median_cents == 20_000
    assert capacity.months == 3


def test_savings_capacity_reports_a_negative_median_rather_than_zero():
    entries = (
        _month(2025, 2, 200_000, -240_000)
        + _month(2025, 3, 200_000, -230_000)
        + _month(2025, 12, 200_000, -250_000)
    )
    capacity = measure_savings_capacity(complete_months(entries, LEDGER_START, LEDGER_END))
    assert capacity is not None and capacity.median_cents < 0


def test_measuring_nothing_returns_none_not_a_zero_rate():
    assert measure_expense_rate([]) is None
    assert measure_savings_capacity([]) is None


def test_the_operators_eight_empty_months_are_excluded_not_zeroed():
    """The operator's real ledger: statements only exist for February, March
    and December 2025 -- April through November hold nothing because no
    statement was imported for those eight months, not because the household
    spent nothing. If those eight silently became zero-spend observations,
    the sample would be eleven months wide with eight zeros in it and the
    median expense would collapse toward zero instead of reflecting what a
    covered month actually costs."""
    entries = (
        _month(2025, 2, -180_000)
        + _month(2025, 3, -90_000)
        + _month(2025, 12, -210_000)
    )
    empty_months = [f"2025-{m:02d}" for m in range(4, 12)]  # April .. November
    assert empty_months == [
        "2025-04", "2025-05", "2025-06", "2025-07",
        "2025-08", "2025-09", "2025-10", "2025-11",
    ]

    months = complete_months(entries, LEDGER_START, LEDGER_END)

    # None of the eight silent months made it into the observation -- there is
    # no MonthObservation with an empty-month key and no key with count == 0.
    observed_keys = {m.key for m in months}
    assert observed_keys.isdisjoint(empty_months)
    assert all(m.count > 0 for m in months)
    assert observed_keys == {"2025-02", "2025-03", "2025-12"}

    rate = measure_expense_rate(months)
    assert rate is not None
    assert rate.months == 3
    # The three covered months alone: 90 000 / 180 000 / 210 000 -> median 180 000.
    assert rate.median_cents == 180_000

    # Had the eight silent months instead been folded in as zero-spend
    # observations (11 months, 8 of them 0), the median would collapse to 0 --
    # exactly the corruption this design guards against.
    naive_outflows_with_zeros = [180_000, 90_000, 210_000] + [0] * len(empty_months)
    naive_outflows_with_zeros.sort()
    naive_median = naive_outflows_with_zeros[len(naive_outflows_with_zeros) // 2]
    assert naive_median == 0
    assert rate.median_cents > naive_median
