from datetime import date

import pytest

from app.engines.amortization import HCSF_DEBT_RATIO_BPS, monthly_payment_cents
from app.engines.capacity import MeasuredRate
from app.engines.feasibility import Assumptions, PurchaseRequest, assess_feasibility
from app.engines.levers import (
    LEVER_KINDS,
    MAX_SEARCHED_RATE_BPS,
    CategoryHistory,
    LoaTerms,
    build_levers,
    compare_financing,
)
from app.engines.savings import project_savings

TODAY = date(2026, 8, 25)
HEALTHY = MeasuredRate(months=12, median_cents=400_000, spread_cents=78_000,
                       low_cents=300_000, high_cents=500_000)
BURN = MeasuredRate(months=12, median_cents=250_000, spread_cents=30_000,
                    low_cents=200_000, high_cents=300_000)
OPERATOR_CAPACITY = MeasuredRate(months=3, median_cents=-74_619, spread_cents=213_078,
                                 low_cents=-347_690, high_cents=198_452)
OPERATOR_BURN = MeasuredRate(months=3, median_cents=265_449, spread_cents=221_457,
                             low_cents=-18_360, high_cents=549_258)
ASSUMPTIONS = Assumptions(annual_return_bps=300, loan_rate_bps=500, loan_months=60,
                          ownership_years=5, monthly_income_cents=250_000,
                          existing_debt_payments_cents=0)
# The operator's measured income median is 47 111 c -- three complete months.
OPERATOR_ASSUMPTIONS = Assumptions(annual_return_bps=300, loan_rate_bps=500,
                                   loan_months=60, ownership_years=5,
                                   monthly_income_cents=47_111,
                                   existing_debt_payments_cents=0)

GROCERIES = CategoryHistory(category_id=7, name="Alimentation",
                            monthly_cents=[60_000, 55_000, 70_000, 58_000])
RESTAURANTS = CategoryHistory(category_id=9, name="Restaurants",
                              monthly_cents=[20_000, 12_000, 30_000, 18_000])

# What the healthy household actually reaches in twelve months at 400 000 c/month
# and a 3,00 % return. Every "all five levers are feasible" fixture below is
# built by asking for a little more than this.
HEALTHY_REACH = 4_866_555


def _report(target, capacity, burn, assumptions, horizon=12, down=0, balance=1_000_000):
    return assess_feasibility(
        PurchaseRequest(target_cents=target, horizon_months=horizon,
                        down_payment_cents=down, nature="vehicle"),
        capacity, burn, balance, assumptions, TODAY,
    )


def _by_kind(levers):
    return {lever.kind: lever for lever in levers}


def _operator_levers(categories=()):
    return _by_kind(build_levers(
        _report(4_000_000, OPERATOR_CAPACITY, OPERATOR_BURN, OPERATOR_ASSUMPTIONS,
                balance=-220_963), list(categories)))


# --------------------------------------------------------------------------
# The five levers
# --------------------------------------------------------------------------


def test_every_lever_kind_is_returned_exactly_once():
    levers = build_levers(_report(6_000_000, HEALTHY, BURN, ASSUMPTIONS),
                          [GROCERIES, RESTAURANTS])
    assert sorted(lever.kind for lever in levers) == sorted(LEVER_KINDS)


def test_feasible_levers_come_first_and_the_rest_keep_the_documented_order():
    """No synthetic ranking score: the five levers are incommensurable -- euros
    per month, months, euros of target, a ratio -- and reducing them to one
    number means dividing by a quantity the data controls, the exact failure
    phase 2A ruled against after two rejected metrics."""
    levers = build_levers(_report(4_000_000, OPERATOR_CAPACITY, OPERATOR_BURN,
                                  OPERATOR_ASSUMPTIONS, balance=-220_963),
                          [GROCERIES, RESTAURANTS])
    flags = [lever.feasible for lever in levers]
    assert flags == sorted(flags, reverse=True)


def test_the_documented_order_survives_inside_each_feasibility_group():
    """`flags == sorted(flags, reverse=True)` above holds for ANY ordering that
    puts the feasible ones first -- including one that shuffles the five kinds.
    This pins the order itself, on the operator's own mixed case (save_more and
    borrow feasible, the other three not) and on a case where all five are
    feasible and the list must therefore come back in exactly `LEVER_KINDS`."""
    mixed = build_levers(_report(4_000_000, OPERATOR_CAPACITY, OPERATOR_BURN,
                                 OPERATOR_ASSUMPTIONS, balance=-220_963),
                         [GROCERIES, RESTAURANTS])
    assert [lever.kind for lever in mixed] == [
        "save_more", "borrow", "delay", "reduce_target", "cut_category",
    ]

    every = build_levers(_report(HEALTHY_REACH + 180_000, HEALTHY, BURN, ASSUMPTIONS),
                         [GROCERIES, RESTAURANTS])
    assert all(lever.feasible for lever in every)
    assert [lever.kind for lever in every] == list(LEVER_KINDS)


def test_the_save_more_lever_is_the_shortfall_per_month():
    """6 000 000 c in 12 months needs 493 163 c/month; the household measures
    400 000 c. The lever is the difference, and the effort is expressed against
    the MEASURED capacity, not against an invented budget."""
    levers = _by_kind(build_levers(_report(6_000_000, HEALTHY, BURN, ASSUMPTIONS), []))
    lever = levers["save_more"]
    assert lever.feasible is True
    assert lever.extra_monthly_cents == 93_163
    assert lever.effort_ratio == 93_163 / 400_000


def test_the_save_more_lever_on_a_deficit_says_what_it_really_costs():
    """THE OPERATOR. 4 000 000 c in 12 months needs 328 775 c/month against a
    measured capacity of -74 619: the swing is 403 394 c/month, and it includes
    closing the deficit first. `effort_ratio` is None -- a ratio against a
    negative denominator is not an effort, it is a sign error waiting to be
    printed -- and the reason says so."""
    lever = _operator_levers()["save_more"]
    assert lever.extra_monthly_cents == 403_394
    assert lever.effort_ratio is None
    assert lever.feasible is True
    assert "déficit" in (lever.note or "")


def test_the_save_more_lever_refuses_when_the_capacity_already_suffices():
    lever = _by_kind(build_levers(_report(3_500_000, HEALTHY, BURN, ASSUMPTIONS), []))[
        "save_more"]
    assert lever.feasible is False
    assert lever.extra_monthly_cents == 0
    assert lever.effort_ratio is None
    assert "suffit" in lever.unavailable_reason


def test_the_delay_lever_counts_the_extra_months():
    """At 400 000 c/month, 6 000 000 c is reached in 15 months against a
    12-month horizon: three months later."""
    levers = _by_kind(build_levers(_report(6_000_000, HEALTHY, BURN, ASSUMPTIONS), []))
    lever = levers["delay"]
    assert lever.feasible is True
    assert lever.delay_months == 3
    assert lever.reached_in_months == 15


def test_the_delay_lever_refuses_on_a_capacity_that_never_gets_there():
    """THE OPERATOR AGAIN. `savings.months_to_target` returns None at a
    non-positive rate: no delay ever reaches the target, and quoting one would
    put a date on screen that will never arrive."""
    lever = _operator_levers()["delay"]
    assert lever.feasible is False
    assert lever.delay_months is None
    assert "négative" in lever.unavailable_reason


def test_the_delay_lever_refuses_a_zero_capacity_for_the_same_stated_cause():
    """Exactly zero, not negative: the pot does not shrink, it simply never
    grows, and the branch is `<= 0` rather than `< 0`. A `< 0` guard would send
    this case into `months_to_target`, which returns None, and the screen would
    then read the fifty-year sentence -- the wrong cause for a household whose
    capacity is nil rather than distant."""
    flat = MeasuredRate(months=12, median_cents=0, spread_cents=0,
                        low_cents=0, high_cents=0)
    lever = _by_kind(build_levers(_report(6_000_000, flat, BURN, ASSUMPTIONS), []))["delay"]
    assert lever.feasible is False
    assert lever.delay_months is None
    assert "négative ou nulle" in lever.unavailable_reason


def test_the_delay_lever_separates_never_from_not_within_fifty_years():
    """A positive capacity that would need more than `MAX_PROJECTION_MONTHS` is
    a DIFFERENT refusal from a capacity that never grows, and the two sentences
    must not be swapped: one household is saving and is simply too far away,
    the other is not saving at all."""
    lever = _by_kind(build_levers(_report(600_000_000, HEALTHY, BURN, ASSUMPTIONS), []))[
        "delay"]
    assert lever.feasible is False
    assert lever.reached_in_months is None
    assert "cinquante ans" in lever.unavailable_reason
    assert "négative" not in lever.unavailable_reason


def test_the_delay_lever_refuses_when_the_horizon_already_holds():
    lever = _by_kind(build_levers(_report(3_500_000, HEALTHY, BURN, ASSUMPTIONS), []))[
        "delay"]
    assert lever.feasible is False
    assert lever.delay_months == 0
    assert "rien à reporter" in lever.unavailable_reason


def test_the_reduce_target_lever_is_what_the_horizon_actually_reaches():
    levers = _by_kind(build_levers(_report(6_000_000, HEALTHY, BURN, ASSUMPTIONS), []))
    lever = levers["reduce_target"]
    assert lever.feasible is True
    assert lever.reduced_target_cents == 4_866_555


def test_the_reduce_target_lever_refuses_when_nothing_is_reachable():
    """A reachable amount of -895 428 c is not a smaller car. Offering it would
    print "ramenez votre cible à -8 954,28 EUR"."""
    lever = _operator_levers()["reduce_target"]
    assert lever.feasible is False
    assert lever.reduced_target_cents is None
    assert "aucune cible" in lever.unavailable_reason.lower()


def test_the_reduce_target_lever_refuses_when_the_target_already_fits():
    lever = _by_kind(build_levers(_report(3_500_000, HEALTHY, BURN, ASSUMPTIONS), []))[
        "reduce_target"]
    assert lever.feasible is False
    assert lever.reduced_target_cents == 4_866_555
    assert "rien à réduire" in lever.unavailable_reason


def test_the_borrow_lever_prices_the_gap_and_the_debt_ratio():
    """1 133 445 c over 60 months at 5,00 %: 21 390 c/month, 149 924 c of
    interest, 856 bps of debt ratio against 250 000 c of measured income."""
    levers = _by_kind(build_levers(_report(6_000_000, HEALTHY, BURN, ASSUMPTIONS), []))
    lever = levers["borrow"]
    assert lever.borrow_cents == 1_133_445
    assert lever.loan_payment_cents == 21_390
    assert lever.loan_total_interest_cents == 149_924
    assert lever.debt_ratio_bps == 856
    assert lever.debt_ratio_exceeded is False


def test_the_borrow_lever_raises_the_thirty_five_percent_alarm():
    """THE OPERATOR: 4 895 428 c over 60 months at 5,00 % is 92 383 c/month
    against a measured income of 47 111 c -- 19 610 basis points, 196 % of what
    he earns. Design §6.3 item 5 asks for the alert at 3 500."""
    lever = _operator_levers()["borrow"]
    assert lever.borrow_cents == 4_895_428
    assert lever.loan_payment_cents == 92_383
    assert lever.loan_total_interest_cents == 647_532
    assert lever.debt_ratio_bps == 19_610
    assert lever.debt_ratio_bps > HCSF_DEBT_RATIO_BPS
    assert lever.debt_ratio_exceeded is True
    # Printed as measured: no clamp at the HCSF threshold, no cap at 10 000 bps,
    # no "environ". A 196 % ratio is the verdict.
    assert lever.note is None


def test_the_borrow_lever_counts_the_debts_already_being_paid():
    """The HCSF ratio is on ALL of a household's instalments, not only the new
    one. Dropping `existing_debt_payments_cents` would understate every ratio in
    the application by whatever the household already owes."""
    with_debts = Assumptions(annual_return_bps=300, loan_rate_bps=500, loan_months=60,
                             ownership_years=5, monthly_income_cents=250_000,
                             existing_debt_payments_cents=60_000)
    lever = _by_kind(build_levers(_report(6_000_000, HEALTHY, BURN, with_debts), []))[
        "borrow"]
    assert lever.loan_payment_cents == 21_390
    # (60 000 + 21 390) / 250 000 -> 3 256 bps, still under the threshold.
    assert lever.debt_ratio_bps == 3_256
    assert lever.debt_ratio_exceeded is False


def test_the_borrow_lever_has_no_ratio_without_a_measured_income():
    no_income = Assumptions(annual_return_bps=300, loan_rate_bps=500, loan_months=60,
                            ownership_years=5, monthly_income_cents=None,
                            existing_debt_payments_cents=0)
    levers = _by_kind(build_levers(_report(6_000_000, HEALTHY, BURN, no_income), []))
    lever = levers["borrow"]
    assert lever.debt_ratio_bps is None
    # Not "0 % d'endettement", and not "seuil dépassé" either.
    assert lever.debt_ratio_exceeded is False
    assert "revenu" in (lever.note or "")


def test_the_borrow_lever_is_not_offered_when_there_is_no_gap():
    levers = _by_kind(build_levers(_report(3_500_000, HEALTHY, BURN, ASSUMPTIONS), []))
    lever = levers["borrow"]
    assert lever.feasible is False
    assert "déjà" in lever.unavailable_reason


def test_the_cut_category_lever_names_a_category_and_checks_its_history():
    """Alimentation's monthly spends are 60 000 / 55 000 / 70 000 / 58 000, so
    the median is 59 000. Freeing 93 163 c/month from it is impossible; the
    lever must say which category comes closest rather than proposing a cut the
    history says has never happened."""
    levers = _by_kind(build_levers(
        _report(6_000_000, HEALTHY, BURN, ASSUMPTIONS), [GROCERIES, RESTAURANTS]))
    lever = levers["cut_category"]
    assert lever.feasible is False
    assert lever.category_name == "Alimentation"
    assert lever.category_median_cents == 59_000
    assert "93" in lever.unavailable_reason or "Alimentation" in lever.unavailable_reason


def test_the_cut_category_lever_uses_the_history_to_say_whether_it_is_realistic():
    """A cut the household has already achieved in some months is a different
    proposition from one it never has. 14 795 c off Alimentation's 59 000 c
    median leaves 44 205 c, and the history holds no month at or below that --
    so `months_at_or_below` is 0 out of 4, and the copy can say so."""
    levers = _by_kind(build_levers(
        _report(HEALTHY_REACH + 180_000, HEALTHY, BURN, ASSUMPTIONS),
        [GROCERIES, RESTAURANTS]))
    lever = levers["cut_category"]
    assert lever.feasible is True
    assert lever.category_name == "Alimentation"
    assert lever.months_observed == 4
    assert lever.months_at_or_below is not None
    assert lever.cut_monthly_cents == 14_795
    assert lever.months_at_or_below == 0


def test_the_cut_category_lever_counts_the_months_that_already_sat_low_enough():
    """The control for the test above, which a `months_at_or_below = 0` constant
    would pass just as well. A smaller target needs only 3 946 c/month freed,
    which leaves Alimentation at 55 054 c -- and one of the four observed months,
    the 55 000 c one, already sat under that line."""
    levers = _by_kind(build_levers(
        _report(HEALTHY_REACH + 48_000, HEALTHY, BURN, ASSUMPTIONS),
        [GROCERIES, RESTAURANTS]))
    lever = levers["cut_category"]
    assert lever.feasible is True
    assert lever.cut_monthly_cents == 3_946
    assert lever.category_median_cents == 59_000
    assert lever.months_at_or_below == 1


def test_the_cut_category_lever_picks_the_heaviest_category_not_the_first():
    """Restaurants is listed first and Alimentation second; the lever must still
    name Alimentation, whose median is 59 000 against 19 000."""
    levers = _by_kind(build_levers(
        _report(6_000_000, HEALTHY, BURN, ASSUMPTIONS), [RESTAURANTS, GROCERIES]))
    assert levers["cut_category"].category_name == "Alimentation"


def test_the_cut_category_lever_refuses_when_no_category_history_exists():
    levers = _by_kind(build_levers(_report(6_000_000, HEALTHY, BURN, ASSUMPTIONS), []))
    lever = levers["cut_category"]
    assert lever.feasible is False
    assert lever.category_name is None
    assert "catégorie" in lever.unavailable_reason


def test_the_cut_category_lever_ignores_a_category_with_no_observed_month():
    """An empty history is not a category worth naming, and `median_cents`
    raises on an empty sample rather than returning zero."""
    empty = CategoryHistory(category_id=3, name="Loisirs", monthly_cents=[])
    levers = _by_kind(build_levers(_report(6_000_000, HEALTHY, BURN, ASSUMPTIONS), [empty]))
    lever = levers["cut_category"]
    assert lever.feasible is False
    assert lever.category_name is None
    assert "catégorie" in lever.unavailable_reason


def test_the_cut_category_lever_refuses_when_nothing_needs_freeing():
    lever = _by_kind(build_levers(_report(3_500_000, HEALTHY, BURN, ASSUMPTIONS),
                                  [GROCERIES]))["cut_category"]
    assert lever.feasible is False
    assert lever.category_name is None
    assert "libér" in lever.unavailable_reason


def test_no_levers_at_all_when_the_capacity_could_not_be_measured():
    """Nothing to change, because nothing was measured. The screen shows the
    capacity refusal instead -- an empty lever list is not a lever list of
    refusals, which would print five sentences all saying the same thing."""
    assert build_levers(_report(6_000_000, None, BURN, ASSUMPTIONS), [GROCERIES]) == []


def test_a_refusal_carries_a_reason_and_a_feasible_lever_never_does():
    """`unavailable_reason` is set EXACTLY when `feasible` is False, on every
    branch of all five levers. `note` is the other way round: it only ever
    annotates a lever that IS feasible."""
    reports = [
        _report(6_000_000, HEALTHY, BURN, ASSUMPTIONS),
        _report(3_500_000, HEALTHY, BURN, ASSUMPTIONS),
        _report(600_000_000, HEALTHY, BURN, ASSUMPTIONS),
        _report(HEALTHY_REACH + 180_000, HEALTHY, BURN, ASSUMPTIONS),
        _report(4_000_000, OPERATOR_CAPACITY, OPERATOR_BURN, OPERATOR_ASSUMPTIONS,
                balance=-220_963),
    ]
    seen = 0
    for report in reports:
        for categories in ([], [GROCERIES, RESTAURANTS]):
            for lever in build_levers(report, categories):
                seen += 1
                assert (lever.unavailable_reason is None) is lever.feasible
                if lever.note is not None:
                    assert lever.feasible is True
    assert seen == 50


def test_each_distinct_cause_gets_its_own_sentence():
    """A French sentence naming the wrong cause is this project's most repeated
    defect. Ten refusals live in this module; no two of them may share a
    wording, or a screen would blame one cause for another."""
    reports = [
        _report(6_000_000, HEALTHY, BURN, ASSUMPTIONS),
        _report(3_500_000, HEALTHY, BURN, ASSUMPTIONS),
        _report(600_000_000, HEALTHY, BURN, ASSUMPTIONS),
        _report(4_000_000, OPERATOR_CAPACITY, OPERATOR_BURN, OPERATOR_ASSUMPTIONS,
                balance=-220_963),
    ]
    reasons = set()
    for report in reports:
        for categories in ([], [GROCERIES, RESTAURANTS]):
            for lever in build_levers(report, categories):
                if lever.unavailable_reason is not None:
                    reasons.add((lever.kind, lever.unavailable_reason))
    wordings = [reason for _kind, reason in reasons]
    assert len(wordings) == len(set(wordings))
    # Ten distinct refusals across the five levers, all reached by the fixtures
    # above. If a branch is added without its own sentence, this count is what
    # notices.
    assert len(wordings) == 10


# --------------------------------------------------------------------------
# Comptant vs crédit vs LOA
# --------------------------------------------------------------------------


def _difference(borrowed_cents, assumptions, rate_bps):
    """The quantity `compare_financing` searches over, recomputed here from the
    two engines directly, so a test never asks the implementation to grade its
    own homework."""
    credit = project_savings(borrowed_cents, 0, assumptions.annual_return_bps,
                             assumptions.loan_months).final_cents
    payment = monthly_payment_cents(borrowed_cents, rate_bps, assumptions.loan_months)
    cash = project_savings(0, payment, assumptions.annual_return_bps,
                           assumptions.loan_months).final_cents
    return credit - cash


def _prices(principal_cents, rate_bps, months):
    """Whether `amortization` can quote an instalment at all. It refuses a
    payment that would not cover the first month's interest, and the whole
    point of the priceability guard is that the break-even search never hands
    it a rate it would refuse."""
    try:
        monthly_payment_cents(principal_cents, rate_bps, months)
    except ValueError:
        return False
    return True


def test_borrowing_beats_cash_below_the_break_even_rate_and_loses_above_it():
    """20 000 EUR, 4 000 EUR down, 60 months, savings at 3,00 %/an. Both paths
    end owning the same thing and spending the same monthly euros; the only
    difference is where the money sits. Break-even lands at 299 bps -- one
    basis point under the 3,00 % return, the whole gap being the cent-rounding
    in the two projections."""
    comparison = compare_financing(2_000_000, 400_000, ASSUMPTIONS, None)
    assert comparison.break_even_rate_bps == 299
    assert comparison.break_even_reason is None
    by_kind = {option.kind: option for option in comparison.options}
    # ASSUMPTIONS carries loan_rate_bps=500, above the break-even, so cash wins.
    assert by_kind["cash"].wealth_at_end_cents > by_kind["credit"].wealth_at_end_cents
    assert comparison.better_kind == "cash"
    assert comparison.wealth_gap_cents < 0


def test_credit_wins_below_the_break_even_rate():
    cheap = Assumptions(annual_return_bps=300, loan_rate_bps=100, loan_months=48,
                        ownership_years=5, monthly_income_cents=250_000,
                        existing_debt_payments_cents=0)
    comparison = compare_financing(2_000_000, 400_000, cheap, None)
    by_kind = {option.kind: option for option in comparison.options}
    assert by_kind["credit"].wealth_at_end_cents > by_kind["cash"].wealth_at_end_cents
    assert comparison.better_kind == "credit"
    assert comparison.wealth_gap_cents > 0


def test_the_credit_paths_wealth_does_not_move_with_the_loan_rate():
    """The whole model in one assertion. Under the income-constant framing the
    instalment leaves the household's INCOME, not the invested pot, so the
    credit path's end wealth is a function of the capital alone. Double-count
    the instalments -- subtract them from the pot as well as from the income --
    and this goes red, the difference stops being monotone, and the break-even
    collapses toward zero."""
    rates = (0, 100, 500, 1_200, 3_000)
    credit_wealths, cash_wealths = set(), []
    for rate in rates:
        comparison = compare_financing(2_000_000, 400_000,
                                       Assumptions(300, rate, 60, 5, 250_000, 0), None)
        by_kind = {option.kind: option for option in comparison.options}
        credit_wealths.add(by_kind["credit"].wealth_at_end_cents)
        cash_wealths.append(by_kind["cash"].wealth_at_end_cents)
    assert len(credit_wealths) == 1
    # The control, and the source of the monotonicity: the CASH path's wealth
    # does move with the rate, and strictly upward -- a dearer instalment is a
    # bigger sum invested every month by the buyer who does not owe it.
    assert cash_wealths == sorted(cash_wealths)
    assert len(set(cash_wealths)) == len(rates)


def test_the_break_even_is_the_last_rate_at_which_borrowing_still_wins():
    """The DEFINING property, checked against a difference recomputed in the
    test from `savings` and `amortization` directly: at the returned rate credit
    is still at least as good, and one basis point higher it is not. An
    off-by-one in either direction of the search fails this on every fixture."""
    for price, down, ret, months in [
        (2_000_000, 400_000, 300, 60),
        (2_000_000, 400_000, 300, 48),
        (4_000_000, 0, 250, 84),
        (25_000_000, 5_000_000, 175, 300),
        (1_600_000, 0, 1, 60),
    ]:
        assumptions = Assumptions(ret, 500, months, 5, 250_000, 0)
        comparison = compare_financing(price, down, assumptions, None)
        rate = comparison.break_even_rate_bps
        assert rate is not None, (price, down, ret, months)
        borrowed = price - down
        assert _difference(borrowed, assumptions, rate) >= 0
        if rate < MAX_SEARCHED_RATE_BPS:
            assert _difference(borrowed, assumptions, rate + 1) < 0


def test_the_searched_difference_is_monotone_over_the_whole_range():
    """What makes the binary search legitimate is not that `difference` is
    strictly decreasing -- it is NOT: on a small loan it is flat across
    thousands of basis points, because the instalment only moves a cent at a
    time -- but that the predicate `difference >= 0` is true on a prefix and
    false on a suffix. This walks all 3 001 rates and checks exactly that, on a
    normal loan and on one small enough to be flat almost everywhere."""
    for price, down, ret, months, expect_flat in [
        (2_000_000, 400_000, 300, 60, False),
        (20_000, 0, 300, 60, True),
    ]:
        assumptions = Assumptions(ret, 500, months, 5, 250_000, 0)
        borrowed = price - down
        values = [_difference(borrowed, assumptions, rate)
                  for rate in range(MAX_SEARCHED_RATE_BPS + 1)]
        assert all(a >= b for a, b in zip(values, values[1:], strict=False)), (price, months)
        flat = any(a == b for a, b in zip(values, values[1:], strict=False))
        assert flat is expect_flat
        # The predicate is a prefix of Trues followed by a suffix of Falses.
        signs = [value >= 0 for value in values]
        assert signs == sorted(signs, reverse=True)
        expected = max(index for index, sign in enumerate(signs) if sign)
        assert compare_financing(price, down, assumptions, None).break_even_rate_bps \
            == expected


def test_a_break_even_of_zero_is_reported_as_zero():
    """The lower bound of the search, and a fixture where an off-by-one would
    change the answer: 3 000 EUR over twelve months at a 0 % return breaks even
    at exactly 0 bps -- credit and cash tie at a free loan and credit loses at
    one basis point. A search opening at `low = 1` would answer 1."""
    assumptions = Assumptions(0, 500, 12, 5, 250_000, 0)
    comparison = compare_financing(300_000, 0, assumptions, None)
    assert comparison.break_even_rate_bps == 0
    assert _difference(300_000, assumptions, 0) == 0
    assert _difference(300_000, assumptions, 1) < 0


def test_a_break_even_on_the_ceiling_is_reported_as_the_ceiling():
    """The upper bound, and the other off-by-one fixture: here the difference is
    exactly zero AT `MAX_SEARCHED_RATE_BPS` and still zero one basis point
    below, so a search closing at `high = MAX - 1` would answer 2 999 and a
    `difference(MAX) > 0` guard reading `>= 0` would refuse outright."""
    assumptions = Assumptions(2_950, 500, 2, 5, 250_000, 0)
    comparison = compare_financing(3_000, 0, assumptions, None)
    assert comparison.break_even_rate_bps == MAX_SEARCHED_RATE_BPS
    assert comparison.break_even_reason is None
    assert _difference(3_000, assumptions, MAX_SEARCHED_RATE_BPS) == 0


def test_the_break_even_includes_the_rate_where_the_two_paths_tie():
    """`>=`, not `>`: the break-even is the LAST rate at which borrowing is still
    at least as good, and at 300 EUR over twelve months with no return the two
    paths are exactly level from 0 to 3 bps. A `> 0` search predicate answers 0
    here instead of 3."""
    assumptions = Assumptions(0, 500, 12, 5, 250_000, 0)
    comparison = compare_financing(30_000, 0, assumptions, None)
    assert comparison.break_even_rate_bps == 3
    assert _difference(30_000, assumptions, 3) == 0
    assert _difference(30_000, assumptions, 4) < 0


def test_when_cash_wins_even_at_a_free_loan_the_reason_says_which_side():
    """No crossing below the range. `break_even_rate_bps` is None and the reason
    names the cause -- not the ceiling sentence, which would claim the opposite."""
    assumptions = Assumptions(0, 500, 60, 5, 250_000, 0)
    comparison = compare_financing(2_000_000, 400_000, assumptions, None)
    assert comparison.break_even_rate_bps is None
    assert "quel que soit le taux" in comparison.break_even_reason
    assert comparison.better_kind == "cash"


def test_when_credit_still_wins_at_the_ceiling_the_reason_says_so():
    """No crossing above the range, and a different sentence from the one
    below it."""
    assumptions = Assumptions(3_000, 500, 60, 5, 250_000, 0)
    comparison = compare_financing(2_000_000, 400_000, assumptions, None)
    assert comparison.break_even_rate_bps is None
    assert "30 %" in comparison.break_even_reason
    assert "quel que soit le taux" not in comparison.break_even_reason


def test_nothing_borrowed_has_no_break_even_and_no_loan():
    """An apport equal to the price. There is no loan, so there is no rate at
    which one would start to pay -- and a third distinct sentence says that
    rather than reusing either of the two above."""
    comparison = compare_financing(2_000_000, 2_000_000, ASSUMPTIONS, None)
    assert comparison.break_even_rate_bps is None
    assert "apport couvre" in comparison.break_even_reason
    by_kind = {option.kind: option for option in comparison.options}
    assert by_kind["credit"].monthly_cents == 0
    assert by_kind["credit"].interest_cents == 0
    assert by_kind["credit"].total_paid_cents == 2_000_000
    assert comparison.wealth_gap_cents == 0


def test_a_loan_too_small_for_its_term_refuses_the_break_even_in_its_own_words():
    """Left alone, the search would ask `amortization` to price a 16 000 EUR
    loan over forty years at 30 %/an, where the instalment no longer covers the
    month's interest, and the ValueError raised there would surface as "la
    mensualité ne couvrirait même pas les intérêts" -- a sentence about a rate
    the user never quoted. The break-even refuses instead, naming the real
    cause, and the rest of the comparison is still answered."""
    assumptions = Assumptions(300, 500, 480, 5, 250_000, 0)
    comparison = compare_financing(1_600_000, 0, assumptions, None)
    assert comparison.break_even_rate_bps is None
    assert "trop faible" in comparison.break_even_reason
    assert "durée" in comparison.break_even_reason
    by_kind = {option.kind: option for option in comparison.options}
    assert by_kind["credit"].wealth_at_end_cents is not None
    assert comparison.better_kind in ("cash", "credit")


def test_the_priceability_guard_really_does_clear_the_whole_range():
    """The guard evaluates ONE rate -- the ceiling -- and claims that clears all
    3 001 of them. This walks every one, at the smallest capital it lets through
    over 240 months: 149,50 EUR. Nothing in the range refuses, so the search is
    safe wherever the guard says yes.

    The control is a capital the guard rejects on which a rate in the range
    really does refuse -- 2,50 EUR over the same term, which `amortization`
    prices happily at the user's own 5,00 % and refuses at 26,99 %. Without it
    a guard that simply answered False everywhere would pass the first half."""
    assumptions = Assumptions(300, 500, 240, 5, 250_000, 0)

    for rate in range(MAX_SEARCHED_RATE_BPS + 1):
        monthly_payment_cents(14_950, rate, 240)
    assert compare_financing(14_950, 0, assumptions, None).break_even_rate_bps is not None

    refused = [rate for rate in range(MAX_SEARCHED_RATE_BPS + 1)
               if not _prices(250, rate, 240)]
    assert refused
    assert monthly_payment_cents(250, 500, 240) > 0
    comparison = compare_financing(250, 0, assumptions, None)
    assert comparison.break_even_rate_bps is None
    assert "trop faible" in comparison.break_even_reason


def test_a_one_month_loan_still_compares():
    assumptions = Assumptions(300, 500, 1, 5, 250_000, 0)
    comparison = compare_financing(2_000_000, 400_000, assumptions, None)
    assert comparison.horizon_months == 1
    by_kind = {option.kind: option for option in comparison.options}
    assert by_kind["credit"].monthly_cents == 1_606_667
    assert comparison.break_even_rate_bps == 300


def test_the_two_cash_figures_are_the_price_and_the_down_payment():
    comparison = compare_financing(2_000_000, 400_000, ASSUMPTIONS, None)
    by_kind = {option.kind: option for option in comparison.options}
    assert by_kind["cash"].out_of_pocket_cents == 2_000_000
    assert by_kind["cash"].total_paid_cents == 2_000_000
    assert by_kind["cash"].interest_cents == 0
    assert by_kind["cash"].monthly_cents == 0
    assert by_kind["credit"].out_of_pocket_cents == 400_000
    # Down payment + capital + interest, to the cent -- the schedule's own
    # identity, not `monthly * months`, which the resized final instalment
    # makes wrong by a cent or two.
    assert by_kind["credit"].total_paid_cents == (
        400_000 + 1_600_000 + by_kind["credit"].interest_cents
    )
    assert by_kind["credit"].interest_cents > 0


def test_a_price_of_zero_or_less_is_refused():
    with pytest.raises(ValueError, match="strictement positif"):
        compare_financing(0, 0, ASSUMPTIONS, None)


def test_a_down_payment_above_the_price_is_refused():
    with pytest.raises(ValueError, match="apport"):
        compare_financing(2_000_000, 2_000_001, ASSUMPTIONS, None)


def test_a_negative_down_payment_is_refused():
    with pytest.raises(ValueError, match="apport"):
        compare_financing(2_000_000, -1, ASSUMPTIONS, None)


def test_the_loa_line_is_a_cost_comparison_and_never_a_wealth_one():
    """Whether the lessee owns anything at the end depends on a choice the
    contract leaves open, so no end-wealth figure is produced -- and the option
    says why, rather than leaving a null a screen might render as zero."""
    loa = LoaTerms(deposit_cents=300_000, monthly_cents=25_000, months=48,
                   residual_cents=800_000)
    comparison = compare_financing(2_000_000, 400_000, ASSUMPTIONS, loa)
    option = {o.kind: o for o in comparison.options}["loa"]
    assert option.available is True
    assert option.total_paid_cents == 300_000 + 25_000 * 48 + 800_000
    assert option.wealth_at_end_cents is None
    assert option.wealth_unavailable_reason is not None


def test_the_loa_never_enters_the_better_kind_verdict():
    """A LOA cheap enough to beat both on cash must still not be named the
    winner: `better_kind` compares the two options that carry a wealth figure,
    and the LOA is deliberately not in the running."""
    loa = LoaTerms(deposit_cents=0, monthly_cents=1, months=48, residual_cents=0)
    comparison = compare_financing(2_000_000, 400_000, ASSUMPTIONS, loa)
    assert comparison.better_kind in ("cash", "credit")
    assert comparison.better_kind != "loa"


def test_a_loa_with_no_months_is_refused():
    """`deposit + monthly * months + residual` on a zero or negative term would
    quietly report a total smaller than the deposit alone."""
    loa = LoaTerms(deposit_cents=300_000, monthly_cents=25_000, months=0,
                   residual_cents=800_000)
    with pytest.raises(ValueError, match="au moins un mois"):
        compare_financing(2_000_000, 400_000, ASSUMPTIONS, loa)


def test_a_loa_with_a_negative_amount_is_refused():
    loa = LoaTerms(deposit_cents=300_000, monthly_cents=-25_000, months=48,
                   residual_cents=800_000)
    with pytest.raises(ValueError, match="négatifs"):
        compare_financing(2_000_000, 400_000, ASSUMPTIONS, loa)


def test_without_loa_terms_the_option_says_so_rather_than_inventing_them():
    """Yieldo has no French average for one dealer's contract. Design §6.3's
    LOA column stays empty until the user types the quote in."""
    option = {o.kind: o for o in compare_financing(2_000_000, 400_000, ASSUMPTIONS,
                                                   None).options}["loa"]
    assert option.available is False
    assert option.total_paid_cents is None
    assert "loyer" in option.unavailable_reason.lower() or \
        "location" in option.unavailable_reason.lower()
    # An unavailable option carries no wealth refusal: there is no option to
    # refuse a wealth figure FOR. The two nulls mean different things.
    assert option.wealth_unavailable_reason is None
