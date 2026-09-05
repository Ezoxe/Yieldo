"""`app/engines/plan.py` — the forecast plan, expanded and reconciled.

Pure functions, so every test here is a call and an assertion: no session, no
client, no clock. The two behaviours worth reading first are
`test_a_fixed_line_disappears_once_its_payment_is_in_the_ledger` (all or
nothing) and `test_an_envelope_contributes_only_what_is_left_of_it` (by
subtraction) — the distinction the module exists to draw.
"""

from datetime import date

import pytest

from app.engines.plan import (
    PlanLine,
    RealPoint,
    as_tx_points,
    occurrences,
    unrealised,
)


def line(**overrides) -> PlanLine:
    base = dict(
        id=1, label="Loyer", label_key="loyer", amount_cents=-90000, kind="fixed",
        category_id=10, account_id=None, periodicity="monthly", day_of_month=5,
        start_on=date(2026, 1, 1), end_on=None, active=True,
    )
    base.update(overrides)
    return PlanLine(**base)


def real(on: str, amount_cents: int, label_key: str = "", category_id: int | None = None):
    return RealPoint(on=date.fromisoformat(on), amount_cents=amount_cents,
                     label_key=label_key, category_id=category_id)


def days(produced) -> list[str]:
    return [occurrence.on.isoformat() for occurrence in produced]


# --- expansion ------------------------------------------------------------


def test_a_monthly_line_falls_on_its_day_every_month():
    assert days(occurrences([line()], date(2026, 3, 1), date(2026, 5, 31))) == [
        "2026-03-05", "2026-04-05", "2026-05-05",
    ]


# A rent due on the 31st is due on the 28th of February, not on the 3rd of March.
def test_a_day_no_month_has_falls_on_that_months_last_day():
    produced = occurrences(
        [line(day_of_month=31, start_on=date(2026, 1, 1))], date(2026, 2, 1), date(2026, 4, 30),
    )
    assert days(produced) == ["2026-02-28", "2026-03-31", "2026-04-30"]


def test_february_of_a_leap_year_keeps_its_twenty_ninth():
    produced = occurrences(
        [line(day_of_month=31, start_on=date(2028, 1, 1))], date(2028, 2, 1), date(2028, 2, 29),
    )
    assert days(produced) == ["2028-02-29"]


# Anchored on the month it was declared in, not on the calendar quarters: a
# quarterly premium signed in February is due in February, May, August, November.
def test_a_quarterly_line_is_anchored_on_its_own_start_month():
    produced = occurrences(
        [line(periodicity="quarterly", start_on=date(2026, 2, 1), day_of_month=10)],
        date(2026, 1, 1), date(2026, 12, 31),
    )
    assert days(produced) == ["2026-02-10", "2026-05-10", "2026-08-10", "2026-11-10"]


def test_a_yearly_line_falls_once():
    produced = occurrences(
        [line(periodicity="yearly", start_on=date(2026, 6, 1), day_of_month=15)],
        date(2026, 1, 1), date(2027, 12, 31),
    )
    assert days(produced) == ["2026-06-15", "2027-06-15"]


def test_a_weekly_line_steps_seven_days_from_its_start():
    produced = occurrences(
        [line(periodicity="weekly", start_on=date(2026, 3, 2))], date(2026, 3, 1), date(2026, 3, 31),
    )
    assert days(produced) == ["2026-03-02", "2026-03-09", "2026-03-16", "2026-03-23", "2026-03-30"]


def test_a_fortnightly_line_steps_fourteen():
    produced = occurrences(
        [line(periodicity="biweekly", start_on=date(2026, 3, 2))],
        date(2026, 3, 1), date(2026, 4, 30),
    )
    assert days(produced) == ["2026-03-02", "2026-03-16", "2026-03-30", "2026-04-13", "2026-04-27"]


def test_a_one_off_line_falls_on_its_own_date_and_never_again():
    produced = occurrences(
        [line(periodicity="one_off", start_on=date(2026, 4, 20))],
        date(2026, 1, 1), date(2027, 12, 31),
    )
    assert days(produced) == ["2026-04-20"]


def test_nothing_falls_before_the_line_starts():
    produced = occurrences([line(start_on=date(2026, 4, 1))], date(2026, 1, 1), date(2026, 5, 31))
    assert days(produced) == ["2026-04-05", "2026-05-05"]


# A cancelled subscription is history, not a forecast.
def test_nothing_falls_after_the_line_ends():
    produced = occurrences(
        [line(end_on=date(2026, 4, 10))], date(2026, 1, 1), date(2026, 12, 31),
    )
    assert days(produced) == [
        "2026-01-05", "2026-02-05", "2026-03-05", "2026-04-05",
    ]


def test_an_inactive_line_produces_nothing():
    assert occurrences([line(active=False)], date(2026, 1, 1), date(2026, 12, 31)) == []


def test_occurrences_come_back_in_date_order_across_lines():
    produced = occurrences(
        [line(id=1, day_of_month=20), line(id=2, day_of_month=3, label="Forfait")],
        date(2026, 3, 1), date(2026, 4, 30),
    )
    assert days(produced) == ["2026-03-03", "2026-03-20", "2026-04-03", "2026-04-20"]


# --- realisation: fixed lines ---------------------------------------------


def test_a_fixed_line_disappears_once_its_payment_is_in_the_ledger():
    ledger = [real("2026-03-04", -91000, "vir sepa loyer appartement")]
    kept = unrealised([line()], ledger, date(2026, 3, 1), date(2026, 3, 31))
    assert kept == []


# The estimate is 900, the statement says 910. The statement wins outright --
# adding the estimate beside it would charge the rent twice.
def test_the_real_amount_replaces_the_estimate_rather_than_joining_it():
    ledger = [real("2026-03-04", -91000, "loyer")]
    kept = unrealised([line()], ledger, date(2026, 3, 1), date(2026, 3, 31))
    assert sum(occurrence.amount_cents for occurrence in kept) == 0


def test_a_payment_in_another_month_does_not_settle_this_months_occurrence():
    ledger = [real("2026-02-04", -90000, "loyer")]
    kept = unrealised([line()], ledger, date(2026, 3, 1), date(2026, 3, 31))
    assert days(kept) == ["2026-03-05"]


def test_a_label_matches_as_a_substring_in_either_direction():
    declared = line(label="Netflix", label_key="netflix", amount_cents=-1399, category_id=None)
    ledger = [real("2026-03-02", -1399, "prlv netflix international bv")]
    assert unrealised([declared], ledger, date(2026, 3, 1), date(2026, 3, 31)) == []


def test_a_credit_never_settles_a_debit():
    ledger = [real("2026-03-04", 90000, "loyer")]
    kept = unrealised([line()], ledger, date(2026, 3, 1), date(2026, 3, 31))
    assert days(kept) == ["2026-03-05"]


# A line with no label of its own falls back to its category -- but a line that
# HAS one must not be settled by any old purchase in the same category.
def test_a_line_without_a_label_is_settled_by_its_category():
    declared = line(label_key="", category_id=10)
    ledger = [real("2026-03-04", -90000, "peu importe", category_id=10)]
    assert unrealised([declared], ledger, date(2026, 3, 1), date(2026, 3, 31)) == []


def test_a_named_line_is_not_settled_by_an_unrelated_purchase_in_its_category():
    ledger = [real("2026-03-04", -1200, "boulangerie", category_id=10)]
    kept = unrealised([line()], ledger, date(2026, 3, 1), date(2026, 3, 31))
    assert days(kept) == ["2026-03-05"]


# One transaction settles one occurrence. A fortnightly charge paid once still
# has its second occurrence ahead of it.
def test_one_transaction_settles_at_most_one_occurrence():
    declared = line(periodicity="biweekly", start_on=date(2026, 3, 2), label_key="salle de sport")
    ledger = [real("2026-03-02", -3000, "salle de sport")]
    kept = unrealised([declared], ledger, date(2026, 3, 1), date(2026, 3, 20))
    assert days(kept) == ["2026-03-16"]


# --- realisation: envelopes -----------------------------------------------


def envelope(**overrides) -> PlanLine:
    base = dict(
        id=2, label="Courses", label_key="", amount_cents=-40000, kind="envelope",
        category_id=7, day_of_month=1,
    )
    base.update(overrides)
    return line(**base)


def test_an_envelope_contributes_only_what_is_left_of_it():
    ledger = [
        real("2026-03-03", -12000, "carrefour", category_id=7),
        real("2026-03-11", -8000, "lidl", category_id=7),
    ]
    kept = unrealised([envelope()], ledger, date(2026, 3, 1), date(2026, 3, 31))
    assert [occurrence.amount_cents for occurrence in kept] == [-20000]


# The mistake all-or-nothing would make in one direction.
def test_a_single_small_purchase_does_not_cancel_a_whole_envelope():
    ledger = [real("2026-03-03", -400, "boulangerie", category_id=7)]
    kept = unrealised([envelope()], ledger, date(2026, 3, 1), date(2026, 3, 31))
    assert [occurrence.amount_cents for occurrence in kept] == [-39600]


def test_an_untouched_envelope_contributes_the_whole_amount():
    kept = unrealised([envelope()], [], date(2026, 3, 1), date(2026, 3, 31))
    assert [occurrence.amount_cents for occurrence in kept] == [-40000]


# Overspent is not owed back: the real transactions are already in the total.
def test_an_overspent_envelope_contributes_nothing_rather_than_a_correction():
    ledger = [real("2026-03-03", -52000, "carrefour", category_id=7)]
    assert unrealised([envelope()], ledger, date(2026, 3, 1), date(2026, 3, 31)) == []


def test_an_envelope_is_drawn_down_month_by_month():
    ledger = [real("2026-03-03", -40000, "carrefour", category_id=7)]
    kept = unrealised([envelope()], ledger, date(2026, 3, 1), date(2026, 4, 30))
    assert days(kept) == ["2026-04-01"]
    assert [occurrence.amount_cents for occurrence in kept] == [-40000]


def test_an_income_envelope_is_drawn_down_the_same_way():
    declared = envelope(amount_cents=250000, category_id=9)
    ledger = [real("2026-03-02", 200000, "salaire", category_id=9)]
    kept = unrealised([declared], ledger, date(2026, 3, 1), date(2026, 3, 31))
    assert [occurrence.amount_cents for occurrence in kept] == [50000]


def test_spending_in_another_category_leaves_the_envelope_alone():
    ledger = [real("2026-03-03", -12000, "essence", category_id=3)]
    kept = unrealised([envelope()], ledger, date(2026, 3, 1), date(2026, 3, 31))
    assert [occurrence.amount_cents for occurrence in kept] == [-40000]


# --- the engines' own shape ------------------------------------------------


def test_occurrences_convert_to_the_shape_every_aggregation_engine_reads():
    produced = occurrences([line()], date(2026, 3, 1), date(2026, 3, 31))
    points = as_tx_points(produced, fallback_account_id=4)

    assert len(points) == 1
    assert points[0].on == date(2026, 3, 5)
    assert points[0].amount_cents == -90000
    assert points[0].category_id == 10
    # No account of its own, so the household's own main account stands in --
    # an engine grouping by account must be able to place the amount.
    assert points[0].account_id == 4
    # A forecast of moving money between one's own accounts is not a forecast.
    assert points[0].is_transfer is False


def test_a_line_naming_an_account_keeps_it():
    produced = occurrences([line(account_id=2)], date(2026, 3, 1), date(2026, 3, 31))
    assert as_tx_points(produced, fallback_account_id=4)[0].account_id == 2


@pytest.mark.parametrize("periodicity", ["monthly", "quarterly", "yearly", "weekly", "biweekly"])
def test_an_empty_window_produces_nothing_whatever_the_rhythm(periodicity):
    assert occurrences([line(periodicity=periodicity)], date(2027, 1, 1), date(2026, 12, 31)) == []
