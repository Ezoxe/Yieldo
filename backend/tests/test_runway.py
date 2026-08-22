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
    assert report.normal_unavailable_reason is not None
    assert "3 mois" in report.normal_unavailable_reason
    assert report.essentials_unavailable_reason is not None
    assert "3 mois" in report.essentials_unavailable_reason
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
    assert report.normal_unavailable_reason is not None
    # Three months WERE observed here -- the failure is that nothing was spent,
    # not that history is short. The message must name the actual cause and
    # must not claim a month-count shortfall it does not have -- the exact
    # self-contradiction the code review flagged: "il faut au moins 3 mois
    # ... et l'historique en compte 3", produced on this very branch before
    # the fix (3 months were observed, yet the message demanded 3 months).
    assert "il faut au moins" not in report.normal_unavailable_reason
    assert "déficitaire" in report.normal_unavailable_reason


def test_essentials_gets_its_own_reason_when_only_it_is_unmeasurable():
    """`essentials` is measured over its own, self-selected set of months --
    it can fail on its own even when `normal` succeeds, and the screen needs
    a reason to display next to it rather than a blank next to a working
    `normal` scenario."""
    all_months = _months((2025, 2, -190_000), (2025, 3, -190_000), (2025, 4, -190_000))
    essential_months = _months((2025, 2, -80_000), (2025, 3, -80_000))  # only 2 months
    report = compute_runway(600_000, all_months, essential_months, TODAY)
    assert report.normal is not None
    assert report.normal_unavailable_reason is None
    assert report.essentials is None
    assert report.essentials_unavailable_reason is not None
    assert "3 mois" in report.essentials_unavailable_reason


def test_each_scenario_exposes_its_own_measured_rate_and_sample_size():
    """A screen wanting the band ("entre 5 et 7,5 mois") must not have to call
    `measure_expense_rate` a second time on the same months, and since
    `essentials` is measured over a different, self-selected set of months
    than `normal`, its own sample size has to be visible on the scenario
    itself rather than only on the report's single `months_observed`."""
    # Varied amounts, not constant ones: a constant sample has zero MAD by
    # construction (see robust.py), which would collapse low/median/high to
    # the same point and prove nothing about the band being exposed.
    all_months = _months((2025, 2, -90_000), (2025, 3, -100_000), (2025, 4, -110_000))
    essential_months = _months(
        (2025, 2, -45_000), (2025, 3, -50_000), (2025, 4, -50_000), (2025, 5, -55_000)
    )
    report = compute_runway(600_000, all_months, essential_months, TODAY)
    assert report.normal.rate.months == 3
    band = report.normal.rate
    assert band.low_cents < band.median_cents < band.high_cents
    assert report.essentials.rate.months == 4
    assert report.essentials.rate.months != report.normal.rate.months


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
