"""The calendar a household declares, and what it costs.

`engines/recurrence.py` reads rhythms off the past. This is the other half: the
charges the household KNOWS it has, whether or not a statement has ever shown
them, laid on a calendar so each due date can be ticked off.
"""

from datetime import date

import pytest

from app.engines.schedule import (
    MIN_OBSERVATIONS_FOR_AVERAGE,
    Checkin,
    DeclaredSchedule,
    build_calendar,
    due_dates,
    observed_amount,
)


def _schedule(**overrides) -> DeclaredSchedule:
    payload = dict(
        id=1,
        label="Netflix",
        amount_cents=-1_599,
        amount_is_variable=False,
        periodicity="monthly",
        anchor_on=date(2025, 1, 15),
        ends_on=None,
        active=True,
    )
    payload.update(overrides)
    return DeclaredSchedule(**payload)


# --- The dates a declaration falls on ---------------------------------------

def test_a_monthly_charge_falls_on_its_own_day_every_month():
    dates = due_dates(_schedule(), date(2025, 1, 1), date(2025, 4, 30))
    assert dates == [date(2025, 1, 15), date(2025, 2, 15), date(2025, 3, 15),
                     date(2025, 4, 15)]


def test_a_charge_anchored_on_the_31st_lands_on_the_last_day_of_a_short_month():
    """February has no 31st and the charge does not skip February: a rent due
    on the last day is due on the last day there is."""
    dates = due_dates(_schedule(anchor_on=date(2025, 1, 31)),
                      date(2025, 1, 1), date(2025, 4, 30))
    assert dates == [date(2025, 1, 31), date(2025, 2, 28), date(2025, 3, 31),
                     date(2025, 4, 30)]


def test_a_leap_february_takes_the_29th():
    dates = due_dates(_schedule(anchor_on=date(2024, 1, 31)),
                      date(2024, 2, 1), date(2024, 2, 29))
    assert dates == [date(2024, 2, 29)]


def test_clamping_never_drifts_the_day_permanently():
    """February pulls the 31st back to the 28th; March must return to the 31st.
    Stepping from the previous OCCURRENCE instead of from the anchor would walk
    a rent payment backwards through the year."""
    dates = due_dates(_schedule(anchor_on=date(2025, 1, 31)),
                      date(2025, 3, 1), date(2025, 3, 31))
    assert dates == [date(2025, 3, 31)]


@pytest.mark.parametrize("periodicity,expected", [
    ("weekly", [date(2025, 1, 15), date(2025, 1, 22), date(2025, 1, 29)]),
    ("biweekly", [date(2025, 1, 15), date(2025, 1, 29)]),
])
def test_week_based_rhythms_step_from_the_anchor(periodicity, expected):
    dates = due_dates(_schedule(periodicity=periodicity),
                      date(2025, 1, 1), date(2025, 1, 31))
    assert dates == expected


def test_a_quarterly_charge_falls_four_times_a_year():
    dates = due_dates(_schedule(periodicity="quarterly", anchor_on=date(2025, 2, 10)),
                      date(2025, 1, 1), date(2025, 12, 31))
    assert dates == [date(2025, 2, 10), date(2025, 5, 10), date(2025, 8, 10),
                     date(2025, 11, 10)]


def test_a_yearly_charge_falls_once():
    dates = due_dates(_schedule(periodicity="yearly", anchor_on=date(2025, 6, 3)),
                      date(2025, 1, 1), date(2026, 12, 31))
    assert dates == [date(2025, 6, 3), date(2026, 6, 3)]


def test_nothing_falls_before_the_anchor():
    dates = due_dates(_schedule(anchor_on=date(2025, 3, 15)),
                      date(2025, 1, 1), date(2025, 4, 30))
    assert dates == [date(2025, 3, 15), date(2025, 4, 15)]


def test_nothing_falls_after_the_end_date():
    dates = due_dates(_schedule(ends_on=date(2025, 2, 20)),
                      date(2025, 1, 1), date(2025, 4, 30))
    assert dates == [date(2025, 1, 15), date(2025, 2, 15)]


def test_an_inactive_declaration_falls_nowhere():
    assert due_dates(_schedule(active=False), date(2025, 1, 1), date(2025, 4, 30)) == []


# --- What a variable charge actually costs ----------------------------------

def test_a_variable_charge_costs_what_its_checkins_actually_say():
    """Water and electricity are declared as an estimate and billed as
    something else. Once enough real amounts have been ticked off, the estimate
    stops being the figure."""
    checkins = [
        Checkin(schedule_id=1, due_on=date(2025, 1, 15), amount_cents=-6_200,
                paid_on=date(2025, 1, 16), transaction_id=None),
        Checkin(schedule_id=1, due_on=date(2025, 2, 15), amount_cents=-7_400,
                paid_on=date(2025, 2, 16), transaction_id=None),
        Checkin(schedule_id=1, due_on=date(2025, 3, 15), amount_cents=-6_800,
                paid_on=date(2025, 3, 16), transaction_id=None),
    ]
    amount, basis = observed_amount(_schedule(amount_is_variable=True), checkins)
    assert amount == -6_800  # the median, not the declared -1 599
    assert basis == "observed"


def test_a_variable_charge_with_too_few_checkins_says_it_is_still_an_estimate():
    checkins = [
        Checkin(schedule_id=1, due_on=date(2025, 1, 15), amount_cents=-6_200,
                paid_on=date(2025, 1, 16), transaction_id=None),
    ]
    amount, basis = observed_amount(_schedule(amount_is_variable=True), checkins)
    assert amount == -1_599
    assert basis == "declared"
    assert MIN_OBSERVATIONS_FOR_AVERAGE > 1


def test_a_fixed_charge_keeps_its_declared_amount_however_many_checkins_exist():
    """A fixed subscription is fixed. One statement that happened to carry a
    proration must not silently redefine what Netflix costs."""
    checkins = [
        Checkin(schedule_id=1, due_on=date(2025, m, 15), amount_cents=-1_000,
                paid_on=date(2025, m, 15), transaction_id=None)
        for m in (1, 2, 3, 4)
    ]
    amount, basis = observed_amount(_schedule(), checkins)
    assert amount == -1_599
    assert basis == "declared"


# --- The calendar -----------------------------------------------------------

def test_every_due_date_in_the_window_becomes_an_occurrence():
    report = build_calendar([_schedule()], [], date(2025, 1, 1), date(2025, 3, 31),
                            today=date(2025, 3, 20))
    assert [o.due_on for o in report.occurrences] == [
        date(2025, 1, 15), date(2025, 2, 15), date(2025, 3, 15)]


def test_an_occurrence_that_was_ticked_off_is_pointed_and_carries_its_real_amount():
    checkin = Checkin(schedule_id=1, due_on=date(2025, 1, 15), amount_cents=-1_699,
                      paid_on=date(2025, 1, 17), transaction_id=42)
    report = build_calendar([_schedule()], [checkin], date(2025, 1, 1),
                            date(2025, 1, 31), today=date(2025, 1, 20))
    occurrence = report.occurrences[0]
    assert occurrence.status == "pointed"
    assert occurrence.amount_cents == -1_699
    assert occurrence.paid_on == date(2025, 1, 17)
    assert occurrence.transaction_id == 42


def test_a_due_date_that_has_passed_unticked_is_late():
    report = build_calendar([_schedule()], [], date(2025, 1, 1), date(2025, 1, 31),
                            today=date(2025, 1, 25))
    assert report.occurrences[0].status == "late"
    assert report.late_count == 1


def test_a_due_date_still_ahead_is_upcoming():
    report = build_calendar([_schedule()], [], date(2025, 1, 1), date(2025, 1, 31),
                            today=date(2025, 1, 5))
    assert report.occurrences[0].status == "upcoming"
    assert report.late_count == 0


def test_a_due_date_within_the_grace_window_is_neither_late_nor_upcoming():
    """A direct debit due today is not late today, and a rhythm's own grace is
    not a fixed number of days: a weekly charge two days late is nothing."""
    report = build_calendar([_schedule()], [], date(2025, 1, 1), date(2025, 1, 31),
                            today=date(2025, 1, 16))
    assert report.occurrences[0].status == "due"


def test_the_totals_count_charges_and_income_apart():
    """Rent and a salary are both declared here and they are not the same
    figure. A single net total would let a salary hide a rent."""
    report = build_calendar(
        [
            _schedule(id=1, label="Loyer", amount_cents=-95_000),
            _schedule(id=2, label="Salaire", amount_cents=250_000),
        ],
        [], date(2025, 1, 1), date(2025, 1, 31), today=date(2025, 1, 20),
    )
    assert report.monthly_charges_cents == -95_000
    assert report.monthly_income_cents == 250_000
    assert report.annual_charges_cents == -1_140_000


def test_a_yearly_charge_is_spread_over_twelve_months_in_the_monthly_total():
    report = build_calendar(
        [_schedule(periodicity="yearly", amount_cents=-24_000)],
        [], date(2025, 1, 1), date(2025, 12, 31), today=date(2025, 6, 1),
    )
    assert report.annual_charges_cents == -24_000
    assert report.monthly_charges_cents == -2_000


def test_an_inactive_declaration_takes_no_part_in_any_total():
    report = build_calendar([_schedule(active=False)], [], date(2025, 1, 1),
                            date(2025, 12, 31), today=date(2025, 6, 1))
    assert report.occurrences == []
    assert report.annual_charges_cents == 0


def test_a_declaration_that_has_ended_takes_no_part_in_the_annual_total():
    """It fell due in the window and it will not fall due again. Counting it in
    a forward-looking yearly cost would bill the household for a cancelled
    subscription."""
    report = build_calendar([_schedule(ends_on=date(2025, 3, 20))], [],
                            date(2025, 1, 1), date(2025, 12, 31),
                            today=date(2025, 6, 1))
    assert len(report.occurrences) == 3
    assert report.annual_charges_cents == 0


def test_a_variable_charge_is_annualised_on_what_was_actually_paid():
    checkins = [
        Checkin(schedule_id=1, due_on=date(2025, m, 15), amount_cents=-6_000,
                paid_on=date(2025, m, 15), transaction_id=None)
        for m in (1, 2, 3)
    ]
    report = build_calendar([_schedule(amount_is_variable=True)], checkins,
                            date(2025, 1, 1), date(2025, 3, 31),
                            today=date(2025, 3, 31))
    assert report.annual_charges_cents == -72_000
    assert report.schedules[0].amount_basis == "observed"


def test_an_empty_declaration_list_says_so_rather_than_showing_a_zero():
    report = build_calendar([], [], date(2025, 1, 1), date(2025, 1, 31),
                            today=date(2025, 1, 20))
    assert report.occurrences == []
    assert report.notice is not None
    assert "déclar" in report.notice
