from datetime import date, timedelta

import pytest

from app.engines.recurrence import (
    MIN_ANNUALISATION_SPAN_DAYS,
    MIN_OCCURRENCES,
    RecurringTx,
    classify_period,
    detect_recurrences,
    find_price_change,
)
from app.importers.dedup import normalize_label

TODAY = date(2026, 8, 12)


def _monthly(label: str, amount: int, start: date, count: int, category_id: int | None = None):
    """`count` charges roughly a month apart, with the two-day drift a real
    direct debit has when the due date falls on a weekend."""
    drift = [0, 1, -1, 2, 0, -2, 1, 0, -1, 1, 0, 2]
    rows = []
    for index in range(count):
        month = start.month - 1 + index
        year = start.year + month // 12
        on = date(year, month % 12 + 1, start.day) + timedelta(days=drift[index % len(drift)])
        rows.append(RecurringTx(on=on, amount_cents=amount, label_key=label,
                                label_raw=label.upper(), category_id=category_id))
    return rows


def test_classify_period_recognises_the_five_shapes():
    assert classify_period(7) == "weekly"
    assert classify_period(14) == "biweekly"
    assert classify_period(30) == "monthly"
    assert classify_period(28) == "monthly"
    assert classify_period(31) == "monthly"
    assert classify_period(91) == "quarterly"
    assert classify_period(365) == "yearly"


def test_classify_period_refuses_what_matches_nothing():
    """A 20-day rhythm is not a periodicity anyone bills on. Returning the
    nearest match would invent a monthly subscription out of noise."""
    assert classify_period(20) is None
    assert classify_period(60) is None
    assert classify_period(0) is None


def test_a_monthly_subscription_is_detected():
    rows = _monthly("netflix", -1549, date(2025, 9, 10), 8)
    report = detect_recurrences(rows, TODAY)

    assert len(report.recurrences) == 1
    found = report.recurrences[0]
    assert found.periodicity == "monthly"
    assert found.occurrences == 8
    assert found.amount_cents == -1549
    assert found.confidence == "confirmed"
    assert found.annual_cents == -1549 * 12


def test_two_occurrences_are_never_a_recurrence():
    """Two points define one interval, and one interval has no regularity to
    test. Calling that a subscription is exactly the confident-from-nothing
    answer this phase exists to prevent."""
    rows = _monthly("netflix", -1549, date(2026, 6, 10), 2)
    report = detect_recurrences(rows, TODAY)
    assert report.recurrences == []
    assert report.rejected_thin == 1
    assert MIN_OCCURRENCES == 3


def test_three_occurrences_are_reported_as_probable_not_confirmed():
    rows = _monthly("netflix", -1549, date(2026, 5, 10), 3)
    report = detect_recurrences(rows, TODAY)
    assert [r.confidence for r in report.recurrences] == ["probable"]


def test_irregular_shopping_at_the_same_shop_is_not_a_recurrence():
    """Seven visits to the same supermarket, at irregular gaps and varying
    amounts. The label groups them; the interval test throws them out."""
    days = [1, 3, 9, 10, 22, 23, 40]
    rows = [
        RecurringTx(on=date(2025, 2, 1) + timedelta(days=offset),
                    amount_cents=-2000 - offset * 37, label_key="carrefour",
                    label_raw="CARREFOUR", category_id=None)
        for offset in days
    ]
    report = detect_recurrences(rows, TODAY)
    assert report.recurrences == []
    assert report.rejected_irregular == 1


def test_the_operators_shape_yields_almost_nothing_and_says_so():
    """Two dense months, a nine-month hole, then two more. Intervals of 30, 30,
    275, 30 are not a rhythm, and the engine must decline rather than average
    them into a "quarterly" subscription."""
    rows = [
        RecurringTx(on=on, amount_cents=-1549, label_key="netflix",
                    label_raw="NETFLIX", category_id=None)
        for on in (date(2025, 1, 25), date(2025, 2, 24), date(2025, 3, 26),
                   date(2025, 12, 26), date(2026, 1, 5))
    ]
    report = detect_recurrences(rows, TODAY)
    assert report.recurrences == []
    assert report.notice is not None
    assert "3" in report.notice


def test_a_price_rise_is_found_and_measured():
    """The spec's own example: Netflix 13,49 EUR -> 15,99 EUR, +18,5 %."""
    old = _monthly("netflix", -1349, date(2025, 9, 10), 4)
    new = _monthly("netflix", -1599, date(2026, 1, 10), 4)
    report = detect_recurrences(old + new, TODAY)

    change = report.recurrences[0].price_change
    assert change is not None
    assert change.previous_cents == -1349
    assert change.current_cents == -1599
    assert change.changed_on.year == 2026 and change.changed_on.month == 1
    assert change.ratio == pytest.approx(0.185, abs=0.002)


def test_after_a_price_rise_the_current_level_is_the_new_price():
    """The annual cost has to be built on what is billed now, not on the median
    of the whole history -- which would understate every raised subscription."""
    rows = (_monthly("netflix", -1349, date(2025, 9, 10), 4)
            + _monthly("netflix", -1599, date(2026, 1, 10), 4))
    found = detect_recurrences(rows, TODAY).recurrences[0]
    assert found.amount_cents == -1599
    assert found.annual_cents == -1599 * 12


def test_a_one_cent_wobble_is_not_a_price_rise():
    amounts = [-1549, -1549, -1550, -1549, -1550, -1549]
    dates = [date(2025, 9, 10) + timedelta(days=30 * i) for i in range(6)]
    assert find_price_change(amounts, dates) is None


def test_a_change_needs_two_occurrences_on_each_side():
    """One 15,99 EUR charge after five at 13,49 EUR could be a one-off
    adjustment. Two makes it a level."""
    dates = [date(2025, 9, 10) + timedelta(days=30 * i) for i in range(6)]
    assert find_price_change([-1349] * 5 + [-1599], dates) is None
    assert find_price_change([-1349] * 4 + [-1599] * 2, dates) is not None


def test_a_debit_that_stopped_arriving_is_flagged_missing():
    """Monthly until March, nothing since, and today is August. Expected on the
    10th of April and never came."""
    rows = _monthly("salle de sport", -3990, date(2026, 1, 10), 3)
    report = detect_recurrences(rows, date(2026, 4, 25))
    assert report.recurrences[0].status == "missing"
    assert report.recurrences[0].expected_next_on.month == 4


def test_a_debit_missing_for_two_whole_periods_is_ended_not_missing():
    """"Missing" is an alert worth acting on; a subscription cancelled six
    months ago is not. Two periods of silence is the line."""
    rows = _monthly("salle de sport", -3990, date(2025, 9, 10), 4)
    report = detect_recurrences(rows, TODAY)
    assert report.recurrences[0].status == "ended"


def test_a_debit_still_within_its_window_is_active():
    rows = _monthly("netflix", -1549, date(2026, 3, 10), 6)
    report = detect_recurrences(rows, date(2026, 8, 12))
    assert report.recurrences[0].status == "active"


def test_the_annual_subscription_total_covers_only_live_expenses():
    """Income is a recurrence too and belongs in the list, but a salary is not
    a subscription cost. Neither is a cancelled gym membership."""
    live = _monthly("netflix", -1549, date(2026, 3, 10), 6)
    salary = _monthly("salaire", 220000, date(2026, 3, 5), 6)
    dead = _monthly("salle de sport", -3990, date(2025, 2, 10), 4)
    report = detect_recurrences(live + salary + dead, TODAY)

    assert report.annual_subscription_cents == -1549 * 12
    assert report.monthly_subscription_cents == -1549
    assert {r.label_key for r in report.recurrences} >= {"netflix", "salaire"}


def test_the_recurring_key_set_is_exposed_for_the_forecast():
    rows = _monthly("netflix", -1549, date(2026, 3, 10), 6)
    report = detect_recurrences(rows, TODAY)
    assert report.recurring_keys == frozenset({"netflix"})


def test_the_most_expensive_recurrence_comes_first():
    cheap = _monthly("spotify", -1199, date(2026, 3, 10), 6)
    dear = _monthly("loyer", -78000, date(2026, 3, 5), 6)
    report = detect_recurrences(cheap + dear, TODAY)
    assert [r.label_key for r in report.recurrences] == ["loyer", "spotify"]


def test_an_empty_ledger_produces_an_empty_report_not_a_crash():
    report = detect_recurrences([], TODAY)
    assert report.recurrences == []
    assert report.annual_subscription_cents == 0
    assert report.notice is not None


# --- Beyond the brief: the edges a fresh reader would poke at -----------------


def test_the_change_is_dated_at_the_first_charge_of_the_new_level():
    """Four at 13,49 EUR then four at 15,99 EUR: every split between the second
    and the sixth charge shows the same 250-cent step, because the median of a
    six-value slice ignores two contaminating values. The split actually chosen
    must be the one that leaves no scatter behind -- index 4, the first charge
    at the new price -- not the earliest one that happens to tie."""
    amounts = [-1349] * 4 + [-1599] * 4
    dates = [date(2025, 9, 10) + timedelta(days=30 * i) for i in range(8)]
    change = find_price_change(amounts, dates)
    assert change is not None
    assert change.occurrence_index == 4
    assert change.changed_on == dates[4]


def test_a_rise_on_an_income_is_reported_as_a_rise_too():
    """The ratio measures the level, not the sign: a salary going from 2 200 EUR
    to 2 400 EUR is +9 %, the same way an expense growing is +9 %."""
    amounts = [220000] * 4 + [240000] * 4
    dates = [date(2025, 9, 5) + timedelta(days=30 * i) for i in range(8)]
    change = find_price_change(amounts, dates)
    assert change is not None
    assert change.ratio == pytest.approx(0.0909, abs=0.001)


def test_a_fall_is_reported_as_a_negative_ratio():
    amounts = [-1599] * 4 + [-1349] * 4
    dates = [date(2025, 9, 10) + timedelta(days=30 * i) for i in range(8)]
    change = find_price_change(amounts, dates)
    assert change is not None
    assert change.ratio == pytest.approx(-0.156, abs=0.002)
    assert change.current_cents == -1349


def test_a_group_that_flips_sign_has_no_price_level():
    """Charges followed by refunds of the same size are not a price rise of
    200 %; they are two different things sharing a label."""
    amounts = [-1599] * 3 + [1599] * 3
    dates = [date(2025, 9, 10) + timedelta(days=30 * i) for i in range(6)]
    assert find_price_change(amounts, dates) is None


def test_a_zero_level_is_never_a_percentage_baseline():
    amounts = [0, 0, -1599, -1599]
    dates = [date(2025, 9, 10) + timedelta(days=30 * i) for i in range(4)]
    assert find_price_change(amounts, dates) is None


def test_a_row_without_a_grouping_key_is_ignored():
    """`normalize_label` returns an empty string for a label made only of noise.
    Bucketing those together would merge unrelated merchants under one heading."""
    rows = [
        RecurringTx(on=date(2026, 1, 10) + timedelta(days=30 * i), amount_cents=-1549,
                    label_key="", label_raw="CARTE 123456", category_id=None)
        for i in range(4)
    ]
    report = detect_recurrences(rows, TODAY)
    assert report.recurrences == []
    assert report.analysed_groups == 0


def test_the_most_frequent_category_of_the_group_is_carried():
    rows = _monthly("netflix", -1549, date(2026, 3, 10), 6)
    rows = [
        RecurringTx(on=row.on, amount_cents=row.amount_cents, label_key=row.label_key,
                    label_raw=row.label_raw, category_id=(7 if index else None))
        for index, row in enumerate(rows)
    ]
    report = detect_recurrences(rows, TODAY)
    assert report.recurrences[0].category_id == 7


def test_french_card_noise_still_groups_into_one_recurrence():
    """A card label carries the payment date and a fresh reference every month.
    The pipeline keys on `normalize_label(label_raw)`, which strips both, so the
    three charges stay one subscription."""
    labels = [
        "CARTE 12/03 NETFLIX.COM 47829103",
        "CARTE 11/04 NETFLIX.COM 51002934",
        "CARTE 10/05 NETFLIX.COM 63118820",
    ]
    days = [date(2026, 3, 12), date(2026, 4, 11), date(2026, 5, 10)]
    rows = [
        RecurringTx(on=on, amount_cents=-1549, label_key=normalize_label(label),
                    label_raw=label, category_id=None)
        for on, label in zip(days, labels, strict=True)
    ]
    report = detect_recurrences(rows, date(2026, 5, 20))
    assert report.analysed_groups == 1
    assert [r.periodicity for r in report.recurrences] == ["monthly"]


def test_a_short_varying_reference_fragments_the_group_and_nothing_is_claimed():
    """The documented limitation, asserted rather than hidden: `normalize_label`
    deliberately spares runs of fewer than six digits ("PHARMACIE 2000"), so a
    bank that appends a four-digit reference splits one subscription into
    singletons. The engine then reports nothing -- never something wrong."""
    labels = ["SEPA GYM 4521", "SEPA GYM 4977", "SEPA GYM 5310"]
    days = [date(2026, 3, 10), date(2026, 4, 10), date(2026, 5, 10)]
    rows = [
        RecurringTx(on=on, amount_cents=-3990, label_key=normalize_label(label),
                    label_raw=label, category_id=None)
        for on, label in zip(days, labels, strict=True)
    ]
    report = detect_recurrences(rows, date(2026, 5, 20))
    assert report.analysed_groups == 3
    assert report.rejected_thin == 3
    assert report.recurrences == []
    assert report.notice is not None


def test_a_dense_burst_on_each_side_of_an_empty_year_is_not_a_weekly_rhythm():
    """The operator's seeded fixture, transcribed exactly: thirteen Navigo
    charges bunched inside his two dense months, with a 264-day hole between
    them where the ledger holds nothing at all.

    The median gap is five days and the MAD is two, so the interval test alone
    waves this through -- a median absolute deviation ignores a minority of
    outliers however enormous they are, and eight of these twelve gaps are
    small. Left at that, the engine announces a *confirmed* weekly subscription
    of 86 EUR a week, built across nine months in which nothing was recorded.
    A rhythm is a claim about every gap, not about the middle one.

    Cutting at the last hole does not rescue it either, and should not: what
    follows the 264-day gap is a December burst four days apart on median, and
    `classify_period(4)` matches no rhythm anyone bills on.
    """
    days = [date(2025, 1, 24), date(2025, 1, 29), date(2025, 2, 3), date(2025, 2, 10),
            date(2025, 3, 15), date(2025, 12, 4), date(2025, 12, 11), date(2025, 12, 11),
            date(2025, 12, 15), date(2025, 12, 16), date(2025, 12, 20), date(2025, 12, 23),
            date(2025, 12, 30)]
    rows = [
        RecurringTx(on=on, amount_cents=-8600, label_key="x1234 ratp navigo",
                    label_raw="CARTE X1234 RATP NAVIGO", category_id=None)
        for on in days
    ]
    report = detect_recurrences(rows, TODAY)
    assert report.recurrences == []
    assert report.rejected_irregular == 1


def test_a_series_that_never_settles_is_refused_even_with_no_hole_in_it():
    """The wobble gate, pinned on its own.

    Gaps of 30, 45, 18, 42 and 20 days: the median is 30 so the rhythm reads
    monthly, and the longest gap is 45, well inside the 65 days that would make
    it a hole -- so the hole gate stays silent and only the MAD test stands
    between this and a "monthly subscription". Its MAD is 12 against an allowed
    8, and it is refused.

    Without this case every test that once depended on the wobble test is now
    also caught by the hole test, and the wobble condition could be deleted with
    the suite still green.
    """
    offsets = [0, 30, 75, 93, 135, 155]
    rows = [
        RecurringTx(on=date(2026, 1, 5) + timedelta(days=offset), amount_cents=-4500,
                    label_key="assurance", label_raw="ASSURANCE", category_id=None)
        for offset in offsets
    ]
    report = detect_recurrences(rows, date(2026, 6, 20))
    assert report.recurrences == []
    assert report.rejected_irregular == 1


def test_a_subscription_that_lapsed_and_resumed_is_read_on_its_trailing_run():
    """An expired card in the summer of 2024, a re-subscription in October, and
    nine clean months since. Discarding the whole label over a hole that closed
    two years ago would report nothing at all, forever, about a subscription
    that is plainly running -- so the engine describes the stretch since the
    lapse, and says so by dating `first_on` at the resumption rather than at the
    original sign-up."""
    lapsed = _monthly("netflix", -1549, date(2024, 1, 10), 6)
    resumed = _monthly("netflix", -1549, date(2024, 10, 10), 9)
    report = detect_recurrences(lapsed + resumed, date(2025, 7, 1))

    assert len(report.recurrences) == 1
    found = report.recurrences[0]
    assert found.periodicity == "monthly"
    assert found.status == "active"
    assert found.occurrences == 9
    assert found.first_on == date(2024, 10, 10)
    assert found.last_on == date(2025, 6, 9)


def test_the_price_search_stops_at_the_hole_too():
    """13,49 EUR before the lapse, 15,99 EUR after. The engine never saw the
    subscription cross between the two, so it must not report a price rise it
    cannot place -- and the current level is the one it did observe."""
    lapsed = _monthly("netflix", -1349, date(2024, 1, 10), 6)
    resumed = _monthly("netflix", -1599, date(2024, 10, 10), 9)
    found = detect_recurrences(lapsed + resumed, date(2025, 7, 1)).recurrences[0]

    assert found.price_change is None
    assert found.amount_cents == -1599
    assert found.occurrences == 9


def test_one_skipped_month_does_not_disqualify_a_subscription():
    """The other side of that line. A failed payment in March, resumed in April,
    is still one monthly subscription -- the gap is a cycle missed, not a hole
    the rhythm cannot be claimed across."""
    days = [date(2026, 1, 10), date(2026, 2, 10), date(2026, 4, 10),
            date(2026, 5, 10), date(2026, 6, 10), date(2026, 7, 10)]
    rows = [
        RecurringTx(on=on, amount_cents=-1549, label_key="netflix",
                    label_raw="NETFLIX", category_id=None)
        for on in days
    ]
    report = detect_recurrences(rows, date(2026, 7, 20))
    assert [r.periodicity for r in report.recurrences] == ["monthly"]
    assert report.recurrences[0].occurrences == 6


def test_a_weekly_charge_is_held_to_a_two_day_wobble_not_one_and_three_quarters():
    """A quarter of seven days is 1.75, which no real Monday-ish charge meets.
    The two-day floor is what keeps a weekly rhythm detectable at all."""
    days = [0, 7, 15, 21, 29, 35]
    rows = [
        RecurringTx(on=date(2026, 6, 1) + timedelta(days=offset), amount_cents=-1200,
                    label_key="cantine", label_raw="CANTINE", category_id=None)
        for offset in days
    ]
    report = detect_recurrences(rows, date(2026, 7, 8))
    assert [r.periodicity for r in report.recurrences] == ["weekly"]
    assert report.recurrences[0].annual_cents == -1200 * 52


# --- The annualisation bar: you may not multiply to a year what you watched
# --- for less than a quarter.


def test_the_operators_december_burst_is_listed_but_never_annualised():
    """The FNAC vector from the operator's own fixture, transcribed exactly: six
    card purchases between 13 December and 4 January, 41 EUR to 236 EUR apiece,
    five days apart on median. It is a real weekly-shaped series and the engine
    detects it -- but 22 days of December shopping is not evidence of anything
    yearly, and `annual_cents` here would be 8 365,76 EUR of "abonnement".

    `today` is the ledger's own last day, so the recurrence is `active` and
    nothing but the span bar stands between it and the total.
    """
    days = [date(2025, 12, 13), date(2025, 12, 15), date(2025, 12, 22),
            date(2025, 12, 23), date(2025, 12, 28), date(2026, 1, 4)]
    amounts = [-13625, -19362, -4108, -18551, -23655, -11000]
    rows = [
        RecurringTx(on=on, amount_cents=amount, label_key="x1234 fnac darty",
                    label_raw="CARTE X1234 FNAC DARTY", category_id=None)
        for on, amount in zip(days, amounts, strict=True)
    ]
    report = detect_recurrences(rows, date(2026, 1, 9))

    assert len(report.recurrences) == 1
    found = report.recurrences[0]
    assert found.status == "active"
    assert found.observed_span_days == 22
    assert found.annualisable is False
    # Still published on the recurrence -- it is a fact about what was seen --
    # but it must not reach any total.
    assert found.annual_cents == -16088 * 52
    assert report.annual_subscription_cents == 0
    assert report.monthly_subscription_cents == 0
    assert report.recurring_keys == frozenset()
    assert report.notice is not None


def test_a_perfectly_stable_amount_does_not_buy_its_way_past_the_span_bar():
    """The account-fee vector from the same fixture: five charges of exactly
    2,00 EUR over 32 days. Its `amount_spread_cents` is zero -- flawless amount
    stability -- so a filter built on the spread alone would wave it straight
    through into "vos abonnements". The span is what refuses it."""
    days = [date(2025, 12, 4), date(2025, 12, 20), date(2025, 12, 26),
            date(2026, 1, 1), date(2026, 1, 5)]
    rows = [
        RecurringTx(on=on, amount_cents=-200, label_key="frais de tenue de compte",
                    label_raw="FRAIS DE TENUE DE COMPTE", category_id=None)
        for on in days
    ]
    found = detect_recurrences(rows, date(2026, 1, 9)).recurrences[0]

    assert found.amount_spread_cents == 0
    assert found.status == "active"
    assert found.observed_span_days == 32
    assert found.annualisable is False


def test_a_run_spanning_exactly_a_quarter_is_annualised():
    """The bar is inclusive. Four monthly charges from 13 May to 12 August span
    91 days to the day, which is `MIN_ANNUALISATION_SPAN_DAYS`, and a full
    quarter of observation is the agreed price of an annual claim."""
    days = [date(2026, 5, 13), date(2026, 6, 12), date(2026, 7, 12), date(2026, 8, 12)]
    rows = [
        RecurringTx(on=on, amount_cents=-1549, label_key="netflix",
                    label_raw="NETFLIX", category_id=None)
        for on in days
    ]
    report = detect_recurrences(rows, date(2026, 8, 12))
    found = report.recurrences[0]

    assert found.observed_span_days == MIN_ANNUALISATION_SPAN_DAYS == 91
    assert found.annualisable is True
    assert report.annual_subscription_cents == -1549 * 12
    assert report.monthly_subscription_cents == -1549
    assert report.recurring_keys == frozenset({"netflix"})
    assert report.notice is None


def test_a_run_one_day_short_of_a_quarter_is_not_annualised():
    """The same subscription observed a single day less. Nothing about it is
    different except that the bar is not met, and the total says nothing rather
    than something unearned."""
    days = [date(2026, 5, 14), date(2026, 6, 13), date(2026, 7, 13), date(2026, 8, 12)]
    rows = [
        RecurringTx(on=on, amount_cents=-1549, label_key="netflix",
                    label_raw="NETFLIX", category_id=None)
        for on in days
    ]
    report = detect_recurrences(rows, date(2026, 8, 12))
    found = report.recurrences[0]

    assert found.observed_span_days == 90
    assert found.annualisable is False
    assert report.annual_subscription_cents == 0
    assert report.recurring_keys == frozenset()


def test_a_short_run_beside_a_long_one_is_listed_but_not_totalled():
    """The mixed case, which is what a real ledger looks like. Both are
    returned, both are true; only the one with a quarter behind it is allowed to
    speak about a year, and the notice stays silent because something did."""
    long_run = _monthly("netflix", -1549, date(2026, 3, 10), 6)
    burst = [
        RecurringTx(on=on, amount_cents=-16088, label_key="fnac",
                    label_raw="FNAC", category_id=None)
        for on in (date(2026, 7, 15), date(2026, 7, 22), date(2026, 7, 29), date(2026, 8, 5))
    ]
    report = detect_recurrences(long_run + burst, TODAY)

    assert {r.label_key for r in report.recurrences} == {"netflix", "fnac"}
    assert {r.label_key for r in report.recurrences if r.annualisable} == {"netflix"}
    assert report.annual_subscription_cents == -1549 * 12
    assert report.recurring_keys == frozenset({"netflix"})
    assert report.notice is None


def test_a_recurring_key_is_only_authoritative_over_its_own_run():
    """`recurring_keys` is a set of labels, but the analysis behind each key ran
    on a *run*. Here the key says "netflix recurs" while the recurrence says the
    claim begins on 2024-10-10 -- the six charges before the lapse were
    explicitly excluded from the analysis that produced the key.

    Task 11 must therefore subtract rows inside `[first_on, last_on]` for the
    key, never every row that ever carried it. The window it needs is on the
    recurrence; this pins that it is there and that it excludes the old episode.
    """
    lapsed = _monthly("netflix", -1349, date(2024, 1, 10), 6)
    resumed = _monthly("netflix", -1599, date(2024, 10, 10), 9)
    report = detect_recurrences(lapsed + resumed, date(2025, 7, 1))

    assert report.recurring_keys == frozenset({"netflix"})
    found = report.recurrences[0]
    assert (found.first_on, found.last_on) == (date(2024, 10, 10), date(2025, 6, 9))
    assert all(row.on < found.first_on for row in lapsed)


# --- A price rise has to be worth a decision --------------------------------

def test_a_rise_too_small_to_matter_over_a_year_is_not_reported():
    """Found by the audit: the only alert an eighteen-month ledger raised was a
    sports-shop charge going from 28,07 EUR to 28,70 EUR — +2,2 %, and
    **63 centimes**. True, and worth nobody's attention.

    The 2 % floor was there to drop rounding and VAT tweaks, and it does. What
    it cannot see is that 2 % of a small charge is small in euros too, so the
    materiality is judged where it is felt: over a year.
    """
    dates = [date(2025, 1, 5) + timedelta(days=30 * index) for index in range(8)]
    amounts = [-2_807] * 4 + [-2_870] * 4  # +2,2 %, 63 centimes, 7,56 EUR/an

    report = detect_recurrences(
        [RecurringTx(on=on, amount_cents=amount, label_key="decathlon",
                     label_raw="CB DECATHLON", category_id=None)
         for on, amount in zip(dates, amounts)],
        today=date(2025, 8, 10),
    )

    assert len(report.recurrences) == 1
    assert report.recurrences[0].price_change is None
    # And the level is the whole run's, because the two levels were judged to
    # be one level -- not the post-"rise" one.
    assert report.recurrences[0].amount_cents == -2_839  # médiane des huit


def test_a_rise_that_costs_a_real_amount_over_a_year_is_still_reported():
    """The control. A monthly charge gaining 1,50 EUR costs 18 EUR a year, and
    that is a subscription worth looking at."""
    dates = [date(2025, 1, 5) + timedelta(days=30 * index) for index in range(8)]
    amounts = [-1_599] * 4 + [-1_749] * 4  # +9,4 %, 1,50 EUR, 18 EUR/an

    report = detect_recurrences(
        [RecurringTx(on=on, amount_cents=amount, label_key="netflix",
                     label_raw="PRLV NETFLIX", category_id=None)
         for on, amount in zip(dates, amounts)],
        today=date(2025, 8, 10),
    )

    change = report.recurrences[0].price_change
    assert change is not None
    assert change.previous_cents == -1_599
    assert change.current_cents == -1_749


def test_the_same_small_step_on_a_weekly_charge_is_reported():
    """Materiality is judged over a YEAR, not per instalment: 63 centimes on a
    weekly charge is 32,76 EUR a year, which is a different fact from the same
    63 centimes once a month."""
    dates = [date(2025, 1, 6) + timedelta(days=7 * index) for index in range(8)]
    amounts = [-2_807] * 4 + [-2_870] * 4

    report = detect_recurrences(
        [RecurringTx(on=on, amount_cents=amount, label_key="cafe",
                     label_raw="CB CAFE", category_id=None)
         for on, amount in zip(dates, amounts)],
        today=date(2025, 3, 5),
    )

    assert report.recurrences[0].periodicity == "weekly"
    assert report.recurrences[0].price_change is not None
