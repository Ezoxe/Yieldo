"""What « puis-je m'offrir cette voiture ? » must answer, and what it must refuse.

Every expected figure below was produced by running the shipped engines
(`savings.project_savings`, `savings.opportunity_cost_cents`,
`period.month_end`) on the stated inputs, and every operator figure was
re-measured from the seeded fixture database by phase 2A's own
`capacity.measure_savings_capacity` / `measure_expense_rate` before being
written here.
"""

import dataclasses
from datetime import date

import pytest

from app.engines.capacity import MeasuredRate
from app.engines.feasibility import (
    LIQUID_HORIZON_MONTHS,
    MAX_HORIZON_MONTHS,
    NATURES,
    VERDICTS,
    Assumptions,
    PurchaseRequest,
    assess_feasibility,
)

TODAY = date(2026, 8, 25)

# A healthy household: 4 000 EUR/month of measured savings capacity, band
# 3 000 - 5 000. Used for the three verdicts, because one rate against three
# targets is the fixture that can actually tell them apart.
#
# `spread_cents` is deliberately NOT the value that would regenerate this band
# (78 000 c of sigma gives a half-width of 99 961 c, not 100 000 c): an
# implementation reaching for `spread_cents` instead of `low_cents` /
# `high_cents` therefore produces different numbers here rather than the same
# ones by coincidence.
HEALTHY = MeasuredRate(months=12, median_cents=400_000, spread_cents=78_000,
                       low_cents=300_000, high_cents=500_000)
BURN = MeasuredRate(months=12, median_cents=250_000, spread_cents=30_000,
                    low_cents=200_000, high_cents=300_000)

# Twelve months of HEALTHY from a zero down payment, at 300 bps.
HEALTHY_AT_LOW = 3_649_916
HEALTHY_AT_MEDIAN = 4_866_555
HEALTHY_AT_HIGH = 6_083_191

# THE OPERATOR, measured from his real ledger by phase 2A's own engines. Both
# bands are exact: median -/+ round(spread * robust.P90_SIGMAS).
OPERATOR_CAPACITY = MeasuredRate(months=3, median_cents=-74_619, spread_cents=213_078,
                                 low_cents=-347_690, high_cents=198_452)
OPERATOR_BURN = MeasuredRate(months=3, median_cents=265_449, spread_cents=221_457,
                             low_cents=-18_360, high_cents=549_258)
OPERATOR_BALANCE = -220_963

# Enough complete months to be measured, and a household whose median month
# neither saves nor overspends. Not a refusal: a down payment can still reach a
# target at this rate, so `evaluate_goals`' "capacity <= 0 means nothing
# progresses" rule must NOT be imported into this engine.
FLAT = MeasuredRate(months=6, median_cents=0, spread_cents=0,
                    low_cents=0, high_cents=0)

ASSUMPTIONS = Assumptions(annual_return_bps=300, loan_rate_bps=500, loan_months=60,
                          ownership_years=5, monthly_income_cents=250_000,
                          existing_debt_payments_cents=0)


def _request(target, horizon=12, down=0, nature="vehicle") -> PurchaseRequest:
    return PurchaseRequest(target_cents=target, horizon_months=horizon,
                           down_payment_cents=down, nature=nature)


def _assumptions(**overrides) -> Assumptions:
    fields = {
        "annual_return_bps": ASSUMPTIONS.annual_return_bps,
        "loan_rate_bps": ASSUMPTIONS.loan_rate_bps,
        "loan_months": ASSUMPTIONS.loan_months,
        "ownership_years": ASSUMPTIONS.ownership_years,
        "monthly_income_cents": ASSUMPTIONS.monthly_income_cents,
        "existing_debt_payments_cents": ASSUMPTIONS.existing_debt_payments_cents,
    }
    fields.update(overrides)
    return Assumptions(**fields)


# --------------------------------------------------------------------------
# The three verdicts
# --------------------------------------------------------------------------


def test_a_target_the_bad_months_still_reach_is_comfortable():
    """"Atteignable confortablement" is defined by the measured BAND, not by an
    invented margin: even a month at the low end of the observed variability
    gets there. 12 months at 3 000 EUR reaches 36 499,16 EUR."""
    report = assess_feasibility(_request(3_500_000), HEALTHY, BURN, 1_000_000,
                                ASSUMPTIONS, TODAY)
    assert report.verdict == "comfortable"
    assert report.saved_at_horizon_low_cents == HEALTHY_AT_LOW
    assert report.saved_at_horizon_cents == HEALTHY_AT_MEDIAN
    assert report.saved_at_horizon_high_cents == HEALTHY_AT_HIGH


def test_a_target_only_the_median_reaches_is_tight():
    report = assess_feasibility(_request(4_000_000), HEALTHY, BURN, 1_000_000,
                                ASSUMPTIONS, TODAY)
    assert report.verdict == "tight"
    assert report.saved_at_horizon_low_cents < 4_000_000 <= report.saved_at_horizon_cents
    # Negative gap: a surplus, not a shortfall. The screen must not print it
    # as "il vous manque -866,55 EUR".
    assert report.gap_cents == -866_555


def test_a_target_the_median_misses_is_out_of_reach_with_the_figure():
    report = assess_feasibility(_request(6_000_000), HEALTHY, BURN, 1_000_000,
                                ASSUMPTIONS, TODAY)
    assert report.verdict == "out_of_reach"
    assert report.gap_cents == 6_000_000 - HEALTHY_AT_MEDIAN


def test_the_verdict_ladder_turns_on_the_band_at_the_exact_cent():
    """One capacity, four targets straddling the two boundaries.

    Kills three wrong implementations at once: reading `median` where the
    comfortable branch must read `low` (target 3 649 917 would come back
    "comfortable"), reading `high` there (the same), and testing the boundary
    with `>` instead of `>=` (a target landing exactly ON a projected figure
    would drop a rung).
    """
    verdicts = {
        target: assess_feasibility(_request(target), HEALTHY, BURN, 1_000_000,
                                   ASSUMPTIONS, TODAY).verdict
        for target in (HEALTHY_AT_LOW, HEALTHY_AT_LOW + 1,
                       HEALTHY_AT_MEDIAN, HEALTHY_AT_MEDIAN + 1)
    }
    assert verdicts == {
        HEALTHY_AT_LOW: "comfortable",
        HEALTHY_AT_LOW + 1: "tight",
        HEALTHY_AT_MEDIAN: "tight",
        HEALTHY_AT_MEDIAN + 1: "out_of_reach",
    }


def test_the_verdict_is_always_one_of_the_three_published_values():
    for capacity in (HEALTHY, OPERATOR_CAPACITY, FLAT):
        for target in (1, 4_000_000, 900_000_000):
            report = assess_feasibility(_request(target), capacity, BURN, 1_000_000,
                                        ASSUMPTIONS, TODAY)
            assert report.verdict in VERDICTS


# --------------------------------------------------------------------------
# The one refusal
# --------------------------------------------------------------------------


def test_an_unmeasurable_capacity_refuses_rather_than_guessing():
    """`measure_savings_capacity` returns None below three complete observed
    months. The engine refuses where its input refuses: no verdict, no gap, no
    projection -- and a reason that names the month floor."""
    report = assess_feasibility(_request(4_000_000), None, BURN, 1_000_000,
                                ASSUMPTIONS, TODAY)
    assert report.verdict is None
    assert report.gap_cents is None
    assert report.saved_at_horizon_cents is None
    assert report.saved_at_horizon_low_cents is None
    assert report.saved_at_horizon_high_cents is None
    assert report.capacity is None
    assert report.capacity_unavailable_reason is not None
    assert "trois mois complets" in report.capacity_unavailable_reason


def test_the_capacity_refusal_does_not_silence_the_panels_that_do_not_need_it():
    """The emergency fund, the opportunity cost and the horizon date depend on
    the price, the balance and the expense rate -- not on the capacity. A
    refusal that blanked them would refuse three answers the engine holds."""
    report = assess_feasibility(_request(4_000_000), None, BURN, 1_000_000,
                                ASSUMPTIONS, TODAY)
    assert report.impact.emergency.runway_months_before == pytest.approx(4.0)
    assert report.impact.emergency.unavailable_reason is None
    assert report.opportunity_cost_cents == 646_466
    assert report.horizon_end_on == date(2027, 8, 31)


def test_the_verdict_refusal_and_the_five_year_refusal_each_name_their_own_panel():
    """Same cause, two panels, two consequences.

    The verdict panel cannot render a verdict; the five-year panel cannot
    render a trajectory. Printing the verdict's sentence under the trajectory
    would tell the reader "aucun verdict ne peut être rendu" beside a chart
    that was never about a verdict -- the wrong-consequence half of the
    wrong-cause defect this project has now been fixed for ten times.
    """
    report = assess_feasibility(_request(4_000_000), None, BURN, 1_000_000,
                                ASSUMPTIONS, TODAY)
    verdict_reason = report.capacity_unavailable_reason
    liquid_reason = report.impact.liquid_unavailable_reason
    assert report.impact.liquid_in_five_years_before_cents is None
    assert report.impact.liquid_in_five_years_after_cents is None
    assert liquid_reason != verdict_reason
    # Both name the same cause...
    assert "trois mois complets" in verdict_reason
    assert "trois mois complets" in liquid_reason
    # ...and each names its own consequence.
    assert "verdict" in verdict_reason
    assert "verdict" not in liquid_reason
    assert "cinq ans" in liquid_reason


@pytest.mark.parametrize("capacity", [None, HEALTHY, OPERATOR_CAPACITY, FLAT])
def test_the_capacity_dependent_fields_are_all_set_or_all_absent(capacity):
    report = assess_feasibility(_request(4_000_000), capacity, BURN, 1_000_000,
                                ASSUMPTIONS, TODAY)
    dependent = (report.verdict, report.saved_at_horizon_cents,
                 report.saved_at_horizon_low_cents, report.saved_at_horizon_high_cents,
                 report.gap_cents, report.impact.liquid_in_five_years_before_cents,
                 report.impact.liquid_in_five_years_after_cents)
    refused = report.capacity_unavailable_reason is not None
    assert refused == (capacity is None)
    assert all(field is None for field in dependent) == refused
    assert (report.impact.liquid_unavailable_reason is not None) == refused


# --------------------------------------------------------------------------
# The operator: a negative capacity is a verdict, not a refusal
# --------------------------------------------------------------------------


def test_the_operators_own_case_is_answered_not_refused():
    """HIS MEASURED CAPACITY IS NEGATIVE. That is a verdict, not a refusal: the
    engine has a figure and the figure says the pot shrinks. Every number here
    was produced by running phase 2A's shipped engines against the seeded
    fixture, then this engine's own arithmetic on top."""
    report = assess_feasibility(_request(4_000_000), OPERATOR_CAPACITY, OPERATOR_BURN,
                                OPERATOR_BALANCE, ASSUMPTIONS, TODAY)
    assert report.verdict == "out_of_reach"
    # Twelve months of a -746,19 EUR/month rate from a zero down payment. No
    # interest accrues: `savings.project_savings` credits nothing to a
    # non-positive balance, because a shrinking pot is an overdraft.
    assert report.saved_at_horizon_cents == -895_428
    assert report.saved_at_horizon_low_cents == -4_172_280
    # EVEN THE OPTIMISTIC END OF THE BAND FALLS SHORT. The screen must not
    # offer "dans un bon mois, c'est jouable".
    assert report.saved_at_horizon_high_cents == 2_414_442
    # The gap is LARGER than the target, and that is the honest figure.
    assert report.gap_cents == 4_895_428
    assert report.gap_cents > report.request.target_cents
    assert report.capacity_unavailable_reason is None


def test_a_negative_capacity_is_never_flipped_positive():
    """Phase 2A's review verified this trap is structurally absent from
    `capacity.py`; it must not be reintroduced one layer up. An `abs()` here
    would turn the operator's deficit into 8 954,28 EUR of savings and report
    a household going backwards as one making progress. A `max(0, ...)` on the
    rate or on the projected balance would report 0,00 EUR, which is just as
    false and reads as "you stood still"."""
    report = assess_feasibility(_request(4_000_000), OPERATOR_CAPACITY, OPERATOR_BURN,
                                OPERATOR_BALANCE, ASSUMPTIONS, TODAY)
    assert report.saved_at_horizon_cents < 0
    assert report.saved_at_horizon_low_cents < 0
    assert report.capacity is not None and report.capacity.median_cents < 0
    # The republished band is the one that was measured, untouched.
    assert report.capacity == OPERATOR_CAPACITY


def test_no_interest_is_credited_to_a_shrinking_pot_while_a_growing_one_earns_it():
    """The two halves are one test on purpose.

    Alone, "the operator's projection is exactly twelve times his rate" would
    also pass on an engine that credits no interest to anybody -- a projection
    with the compounding quietly removed. The second half is the control: at
    the same 300 bps, on a positive pot, the projection is strictly ABOVE the
    contributions. So the zero on the first half is the non-positive-balance
    guard doing its job, not a missing feature.
    """
    shrinking = assess_feasibility(_request(4_000_000), OPERATOR_CAPACITY, OPERATOR_BURN,
                                   OPERATOR_BALANCE, ASSUMPTIONS, TODAY)
    assert shrinking.saved_at_horizon_cents == 12 * OPERATOR_CAPACITY.median_cents

    growing = assess_feasibility(_request(4_000_000), HEALTHY, BURN, 1_000_000,
                                 ASSUMPTIONS, TODAY)
    assert growing.saved_at_horizon_cents > 12 * HEALTHY.median_cents


def test_an_optimistic_band_that_reaches_and_one_that_does_not_are_both_out_of_reach():
    """`out_of_reach` is one verdict, not two, and it never becomes a refusal.

    The difference a screen needs -- "dans un bon mois c'est jouable" versus
    "même un bon mois n'y suffit pas" -- is readable from
    `saved_at_horizon_high_cents`, which is why that field is published rather
    than folded into a fourth verdict value.
    """
    reachable = assess_feasibility(_request(5_000_000), HEALTHY, BURN, 1_000_000,
                                   ASSUMPTIONS, TODAY)
    assert reachable.verdict == "out_of_reach"
    assert reachable.saved_at_horizon_high_cents >= 5_000_000

    hopeless = assess_feasibility(_request(4_000_000), OPERATOR_CAPACITY, OPERATOR_BURN,
                                  OPERATOR_BALANCE, ASSUMPTIONS, TODAY)
    assert hopeless.verdict == "out_of_reach"
    assert hopeless.saved_at_horizon_high_cents < 4_000_000


def test_a_flat_capacity_is_a_verdict_and_a_down_payment_can_still_reach():
    """A measured capacity of exactly zero is measurable, so it is answered.

    `goal.evaluate_goals` refuses on a non-positive capacity, and importing
    that rule here would be wrong: a goal has no down payment, a purchase does,
    and 45 000 EUR already set aside reaches a 40 000 EUR target on its own
    growth alone. The refusal contract of this engine is the capacity being
    `None`, and nothing else.
    """
    empty_handed = assess_feasibility(_request(4_000_000), FLAT, BURN, 1_000_000,
                                      ASSUMPTIONS, TODAY)
    assert empty_handed.verdict == "out_of_reach"
    assert empty_handed.capacity_unavailable_reason is None
    assert empty_handed.saved_at_horizon_cents == 0
    assert empty_handed.gap_cents == 4_000_000

    with_a_pot = assess_feasibility(_request(4_000_000, down=4_500_000), FLAT, BURN,
                                    1_000_000, ASSUMPTIONS, TODAY)
    assert with_a_pot.verdict == "comfortable"
    assert with_a_pot.saved_at_horizon_cents == 4_636_871


def test_money_already_set_aside_is_still_judged_at_the_horizon_not_today():
    """A down payment covering the price today is not the question asked.

    The horizon is, and a household drawing down 746,19 EUR a month spends part
    of it before the horizon arrives. Reporting "comfortable" on the strength
    of the balance available today would be the verdict answering a different
    question from the one the gap answers.
    """
    eroded = assess_feasibility(_request(4_000_000, down=4_000_000), OPERATOR_CAPACITY,
                                OPERATOR_BURN, OPERATOR_BALANCE, ASSUMPTIONS, TODAY)
    assert eroded.verdict == "out_of_reach"
    assert eroded.saved_at_horizon_cents == 3_213_820
    assert eroded.gap_cents == 786_180
    # The low end of the band drives the pot below zero part-way through, so it
    # earns interest only while it is positive.
    assert eroded.saved_at_horizon_low_cents == -108_465

    held = assess_feasibility(_request(4_000_000, down=4_000_000), HEALTHY, BURN,
                              1_000_000, ASSUMPTIONS, TODAY)
    assert held.verdict == "comfortable"
    assert held.gap_cents < 0


# --------------------------------------------------------------------------
# §6.3 item 7 -- the emergency fund
# --------------------------------------------------------------------------


def test_the_emergency_fund_impact_is_measured_from_the_expense_rate():
    """40 000 EUR out of a 10 000 EUR liquid balance at 2 500 EUR/month."""
    report = assess_feasibility(_request(4_000_000), HEALTHY, BURN, 1_000_000,
                                ASSUMPTIONS, TODAY)
    assert report.impact.emergency.runway_months_before == pytest.approx(4.0)
    # The balance goes below zero, so there is no autonomy left -- 0.0, never a
    # negative duration.
    assert report.impact.emergency.runway_months_after == 0.0
    assert report.impact.emergency.unavailable_reason is None
    assert report.impact.emergency.monthly_burn_cents == 250_000


def test_the_emergency_impact_refuses_when_the_burn_is_unmeasurable():
    """Two causes, two sentences, and neither may be the other's.

    Asserting only that the two strings differ would pass unchanged if the two
    were swapped, which is a test passing for the wrong reason. Each is pinned
    on the words that make it true of ITS branch.
    """
    no_rate = assess_feasibility(_request(4_000_000), HEALTHY, None, 1_000_000,
                                 ASSUMPTIONS, TODAY)
    assert no_rate.impact.emergency.runway_months_before is None
    assert no_rate.impact.emergency.runway_months_after is None
    assert no_rate.impact.emergency.monthly_burn_cents is None
    assert "mesuré" in no_rate.impact.emergency.unavailable_reason
    assert "trois mois complets" in no_rate.impact.emergency.unavailable_reason

    flat = MeasuredRate(months=12, median_cents=0, spread_cents=0,
                        low_cents=0, high_cents=0)
    no_burn = assess_feasibility(_request(4_000_000), HEALTHY, flat, 1_000_000,
                                 ASSUMPTIONS, TODAY)
    assert no_burn.impact.emergency.runway_months_before is None
    # A DIFFERENT cause needs a DIFFERENT sentence.
    assert no_burn.impact.emergency.unavailable_reason != \
        no_rate.impact.emergency.unavailable_reason
    # The history is long enough on THIS branch: the sentence must not send a
    # household with twelve complete months to the import screen.
    assert "trois mois complets" not in no_burn.impact.emergency.unavailable_reason
    assert "médiane" in no_burn.impact.emergency.unavailable_reason


def test_the_burn_refusal_does_not_call_a_gross_expense_rate_a_net_deficit():
    """`measure_expense_rate` is the median of `abs(outflow_cents)`.

    It is a GROSS rate and cannot be negative, so `<= 0` means exactly "the
    median month spends nothing" -- never "the net balance is not in deficit".
    `runway._reason_no_measurable_burn` carries this same correction in its
    docstring after phase 2A shipped the wrong wording here first; the sibling
    sentence must not reintroduce it.
    """
    flat = MeasuredRate(months=12, median_cents=0, spread_cents=0,
                        low_cents=0, high_cents=0)
    reason = assess_feasibility(_request(4_000_000), HEALTHY, flat, 1_000_000,
                                ASSUMPTIONS, TODAY).impact.emergency.unavailable_reason
    assert "solde net" not in reason
    assert "déficitaire" not in reason
    assert "nulle" in reason


def test_the_operators_emergency_fund_is_exhausted_before_and_after():
    """His liquid balance is already -2 209,63 EUR. There is no autonomy to
    lose, and 0.0 on both sides is the truthful reading -- not a negative
    duration, which renders as a depletion date in the past."""
    report = assess_feasibility(_request(4_000_000), OPERATOR_CAPACITY, OPERATOR_BURN,
                                OPERATOR_BALANCE, ASSUMPTIONS, TODAY)
    assert report.impact.emergency.runway_months_before == 0.0
    assert report.impact.emergency.runway_months_after == 0.0
    assert report.impact.emergency.unavailable_reason is None


def test_a_down_payment_does_not_soften_the_hit_to_the_emergency_fund():
    """The full price leaves the liquid balance, whatever the down payment is.

    `down_payment_cents` is a DECLARED figure with no account behind it (see
    `PurchaseRequest`), so netting it off the liquid balance would assume it
    sits somewhere the balance does not already count. Removing the whole price
    can only understate the remaining autonomy, never inflate it -- the same
    direction `runway.py` takes with uncategorised rows.
    """
    without = assess_feasibility(_request(2_000_000), HEALTHY, BURN, 3_000_000,
                                 ASSUMPTIONS, TODAY).impact.emergency
    with_down = assess_feasibility(_request(2_000_000, down=1_500_000), HEALTHY, BURN,
                                   3_000_000, ASSUMPTIONS, TODAY).impact.emergency
    assert without.runway_months_before == with_down.runway_months_before
    assert without.runway_months_after == with_down.runway_months_after == pytest.approx(4.0)


# --------------------------------------------------------------------------
# §6.3 item 7 -- the five-year liquid trajectory
# --------------------------------------------------------------------------


def test_the_five_year_liquid_impact_is_the_purchase_price_apart():
    """Two projections from the same rate, differing only by the price -- so
    the difference is exactly the price when nothing compounds, which is the
    operator's case (a negative balance earns nothing)."""
    report = assess_feasibility(_request(4_000_000), OPERATOR_CAPACITY, OPERATOR_BURN,
                                OPERATOR_BALANCE, ASSUMPTIONS, TODAY)
    assert report.impact.liquid_in_five_years_before_cents == -4_698_103
    assert report.impact.liquid_in_five_years_after_cents == -8_698_103


def test_the_five_year_gap_widens_past_the_price_when_the_pot_does_compound():
    """The control for the test above: on a positive pot the forgone interest
    is real, so the two trajectories separate by MORE than the price. A
    projection that skipped `project_savings` and just subtracted the price
    from one line would report exactly 40 000 EUR here too."""
    report = assess_feasibility(_request(4_000_000), HEALTHY, BURN, 1_000_000,
                                ASSUMPTIONS, TODAY)
    assert report.impact.liquid_in_five_years_before_cents == 27_020_300
    assert report.impact.liquid_in_five_years_after_cents == 22_410_713
    separation = (report.impact.liquid_in_five_years_before_cents
                  - report.impact.liquid_in_five_years_after_cents)
    assert separation > 4_000_000


def test_the_five_year_line_is_five_years_whatever_the_saving_horizon_is():
    """Design §6.3 item 7 fixes the horizon at five years. Reusing
    `request.horizon_months` would make the two panels answer at different
    dates while the screen labels both "à cinq ans"."""
    assert LIQUID_HORIZON_MONTHS == 60
    short = assess_feasibility(_request(4_000_000, horizon=12), OPERATOR_CAPACITY,
                               OPERATOR_BURN, OPERATOR_BALANCE, ASSUMPTIONS, TODAY)
    longer = assess_feasibility(_request(4_000_000, horizon=36), OPERATOR_CAPACITY,
                                OPERATOR_BURN, OPERATOR_BALANCE, ASSUMPTIONS, TODAY)
    assert short.saved_at_horizon_cents != longer.saved_at_horizon_cents
    assert (short.impact.liquid_in_five_years_before_cents
            == longer.impact.liquid_in_five_years_before_cents == -4_698_103)


def test_neither_net_worth_nor_a_health_score_is_smuggled_into_the_impact():
    """Design §6.3 item 7 names three components; this engine ships two.

    Net worth needs phase 3's investment accounts, and no health-score engine
    exists in this codebase (phase 2C owns it). `Impact` therefore carries no
    field for either, so no later task can fill one with a placeholder or a
    zero. Task 16's screen states both absences in French instead.
    """
    report = assess_feasibility(_request(4_000_000), HEALTHY, BURN, 1_000_000,
                                ASSUMPTIONS, TODAY)
    names = {field.name for field in dataclasses.fields(report.impact)}
    assert not {name for name in names if "net_worth" in name or "patrimoine" in name}
    assert not {name for name in names if "health" in name or "sante" in name}


# --------------------------------------------------------------------------
# §6.3 item 4 -- the opportunity cost
# --------------------------------------------------------------------------


def test_the_opportunity_cost_is_over_the_ownership_horizon_and_says_so():
    """Design §6.3 item 4. 40 000 EUR at 3 %/an over five years earns
    6 464,66 EUR -- the FORGONE GAIN, not the final value."""
    report = assess_feasibility(_request(4_000_000), HEALTHY, BURN, 1_000_000,
                                ASSUMPTIONS, TODAY)
    assert report.opportunity_cost_cents == 646_466
    assert report.opportunity_horizon_months == 60


def test_the_opportunity_cost_follows_the_holding_period_not_the_saving_horizon():
    """The money is tied up in the asset for as long as it is owned. Reading
    `horizon_months` instead would quote 1 216,63 EUR here -- and would change
    the answer every time the user moved the échéance slider, which is not what
    "ce que la somme aurait produit" depends on."""
    report = assess_feasibility(_request(4_000_000, horizon=12), HEALTHY, BURN, 1_000_000,
                                _assumptions(ownership_years=10), TODAY)
    assert report.opportunity_horizon_months == 120
    assert report.opportunity_cost_cents == 1_397_413


def test_the_opportunity_cost_is_answered_even_when_the_capacity_refuses():
    """It depends on the price, the rate and the holding period -- none of
    which the capacity touches. It is typed `int`, never `int | None`."""
    report = assess_feasibility(_request(4_000_000), None, None, 0, ASSUMPTIONS, TODAY)
    assert report.opportunity_cost_cents == 646_466


# --------------------------------------------------------------------------
# The horizon date
# --------------------------------------------------------------------------


def test_the_horizon_end_date_is_named_so_the_screen_can_print_it():
    report = assess_feasibility(_request(4_000_000, horizon=12), HEALTHY, BURN,
                                1_000_000, ASSUMPTIONS, TODAY)
    assert report.horizon_end_on == date(2027, 8, 31)


def test_a_single_month_horizon_is_a_real_answer():
    """The shortest échéance the validator admits. No interest is earned on a
    zero opening balance, so the projection is exactly one month's saving."""
    report = assess_feasibility(_request(400_000, horizon=1), HEALTHY, BURN,
                                1_000_000, ASSUMPTIONS, TODAY)
    assert report.verdict == "tight"
    assert report.saved_at_horizon_cents == 400_000
    assert report.saved_at_horizon_low_cents == 300_000
    assert report.gap_cents == 0
    assert report.horizon_end_on == date(2026, 9, 30)


# --------------------------------------------------------------------------
# Refusals that raise
# --------------------------------------------------------------------------


def test_invalid_requests_raise_in_french():
    with pytest.raises(ValueError, match="prix"):
        assess_feasibility(_request(0), HEALTHY, BURN, 0, ASSUMPTIONS, TODAY)
    with pytest.raises(ValueError, match="prix"):
        assess_feasibility(_request(-1), HEALTHY, BURN, 0, ASSUMPTIONS, TODAY)
    with pytest.raises(ValueError, match="échéance"):
        assess_feasibility(_request(4_000_000, horizon=0), HEALTHY, BURN, 0,
                           ASSUMPTIONS, TODAY)
    with pytest.raises(ValueError, match="échéance"):
        assess_feasibility(_request(4_000_000, horizon=MAX_HORIZON_MONTHS + 1), HEALTHY,
                           BURN, 0, ASSUMPTIONS, TODAY)
    with pytest.raises(ValueError, match="apport"):
        assess_feasibility(_request(4_000_000, down=-1), HEALTHY, BURN, 0,
                           ASSUMPTIONS, TODAY)
    # Capitalised: it opens the sentence. `pytest.raises(match=...)` is a
    # case-sensitive `re.search`.
    with pytest.raises(ValueError, match="Nature de bien"):
        assess_feasibility(_request(4_000_000, nature="spaceship"), HEALTHY, BURN, 0,
                           ASSUMPTIONS, TODAY)
    with pytest.raises(ValueError, match="possession"):
        assess_feasibility(_request(4_000_000), HEALTHY, BURN, 0,
                           _assumptions(ownership_years=0), TODAY)


def test_the_longest_admissible_horizon_is_accepted():
    """The bound is inclusive, and it is `savings.MAX_PROJECTION_MONTHS`: a
    horizon this engine accepts must be one `project_savings` will project."""
    report = assess_feasibility(_request(4_000_000, horizon=MAX_HORIZON_MONTHS), HEALTHY,
                                BURN, 1_000_000, ASSUMPTIONS, TODAY)
    assert report.verdict == "comfortable"


def test_a_negative_return_assumption_surfaces_in_french_rather_than_being_absorbed():
    """`savings._validate_rate` owns this refusal and its wording. Re-raising a
    second sentence here would give one cause two messages; swallowing it would
    be the silent failure the contract forbids."""
    with pytest.raises(ValueError, match="taux de rendement"):
        assess_feasibility(_request(4_000_000), HEALTHY, BURN, 1_000_000,
                           _assumptions(annual_return_bps=-1), TODAY)


def test_every_nature_the_engine_publishes_is_accepted():
    for nature in NATURES:
        report = assess_feasibility(_request(4_000_000, nature=nature), HEALTHY, BURN,
                                    1_000_000, ASSUMPTIONS, TODAY)
        assert report.request.nature == nature
