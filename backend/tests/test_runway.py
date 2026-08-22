from datetime import date

from app.engines.capacity import MonthlyEntry, complete_months
from app.engines.runway import compute_runway

TODAY = date(2026, 8, 12)
START = date(2025, 2, 1)
END = date(2025, 12, 31)


def _months(*totals: tuple[int, int, int]):
    """(year, month, outflow) -> observations."""
    entries = [MonthlyEntry(on=date(year, month, 5), amount_cents=amount)
               for year, month, amount in totals]
    return complete_months(entries, START, END)


def test_a_measured_burn_gives_a_month_count_and_a_depletion_date():
    months = _months((2025, 2, -100_000), (2025, 3, -100_000), (2025, 4, -100_000))
    report = compute_runway(600_000, months, months, TODAY)
    assert report.normal is not None
    assert report.normal.monthly_burn_cents == 100_000
    assert report.normal.months == 6.0
    assert report.normal.depleted_on is not None
    assert report.normal.depleted_on > TODAY


def test_cutting_to_essentials_lengthens_the_runway():
    everything = _months((2025, 2, -200_000), (2025, 3, -200_000), (2025, 4, -200_000))
    essentials = _months((2025, 2, -100_000), (2025, 3, -100_000), (2025, 4, -100_000))
    report = compute_runway(600_000, everything, essentials, TODAY)
    assert report.normal.months == 3.0
    assert report.essentials.months == 6.0
    assert report.essentials.depleted_on > report.normal.depleted_on


def test_two_months_of_history_measures_nothing_and_says_so():
    """The operator has three observed months. Two would be one interval short,
    and a runway quoted off two numbers is a guess with a decimal point."""
    months = _months((2025, 2, -100_000), (2025, 3, -100_000))
    report = compute_runway(600_000, months, months, TODAY)
    assert report.normal is None
    assert report.essentials is None
    assert report.insufficient_reason is not None
    assert "3 mois" in report.insufficient_reason
    assert report.months_observed == 2


def test_the_observed_month_count_is_always_reported():
    """Three months is the floor, not comfort. The screen has to be able to say
    "mesuré sur 3 mois seulement"."""
    months = _months((2025, 2, -100_000), (2025, 3, -100_000), (2025, 4, -100_000))
    report = compute_runway(600_000, months, months, TODAY)
    assert report.months_observed == 3


def test_an_empty_balance_is_zero_months_not_an_error():
    months = _months((2025, 2, -100_000), (2025, 3, -100_000), (2025, 4, -100_000))
    report = compute_runway(0, months, months, TODAY)
    assert report.normal.months == 0.0
    assert report.normal.depleted_on == TODAY


def test_an_overdrawn_account_is_zero_months_not_a_negative_runway():
    months = _months((2025, 2, -100_000), (2025, 3, -100_000), (2025, 4, -100_000))
    report = compute_runway(-45_000, months, months, TODAY)
    assert report.normal.months == 0.0


def test_a_household_that_spends_nothing_has_no_runway_to_quote():
    """Dividing by a zero burn is infinity. Reported as "not measurable" rather
    than as a very large number that would read as a promise."""
    months = _months((2025, 2, 100_000), (2025, 3, 100_000), (2025, 4, 100_000))
    report = compute_runway(600_000, months, months, TODAY)
    assert report.normal is None
    assert report.insufficient_reason is not None


def test_an_improbably_long_runway_states_the_months_but_no_date():
    """1 000 years out, a calendar date is noise, and `date` overflows past
    year 9999 anyway."""
    months = _months((2025, 2, -100), (2025, 3, -100), (2025, 4, -100))
    report = compute_runway(10_000_000_00, months, months, TODAY)
    assert report.normal.months > 600
    assert report.normal.depleted_on is None


def test_the_operators_own_numbers_produce_a_very_short_runway():
    """197 transactions netting +93 EUR against roughly 1 900 EUR a month out.
    The honest answer is "less than a month", and it must not round to zero
    silently or crash."""
    months = _months((2025, 2, -190_000), (2025, 3, -190_000), (2025, 4, -190_000))
    report = compute_runway(9_300, months, months, TODAY)
    assert 0 < report.normal.months < 0.1
    assert report.normal.depleted_on is not None
