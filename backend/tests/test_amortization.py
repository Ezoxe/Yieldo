from decimal import Decimal

import pytest

from app.engines.amortization import (
    HCSF_DEBT_RATIO_BPS,
    build_schedule,
    cents,
    debt_ratio_bps,
    monthly_payment_cents,
    monthly_rate,
)


def test_monthly_rate_is_an_exact_decimal_never_a_float():
    """A float rate multiplied into a cents value smuggles a float into money,
    so the TYPE is the contract, not the value: 1 200 bps happens to be exactly
    0,01 a month in binary float too, and a fixture that only checks the number
    would pass against an implementation returning a float.

    350 bps is the honest case: 0,035/12 does not terminate in base 10 either,
    and Decimal carries it to context precision rather than to infinity. What
    is guaranteed is that it agrees with the same division done in Decimal --
    not that it is exact.
    """
    rate = monthly_rate(1200)
    assert isinstance(rate, Decimal)
    assert rate == Decimal("0.01")
    assert isinstance(monthly_rate(350), Decimal)
    assert monthly_rate(350) == Decimal(350) / Decimal(10_000) / Decimal(12)


def test_a_zero_rate_loan_divides_the_capital_evenly():
    assert monthly_payment_cents(120_000, 0, 12) == 10_000


def test_a_zero_rate_loan_rounds_a_half_cent_up_not_down():
    """5 c over 2 months at 0 % is 2,5 c/month exactly: round-half-up gives 3,
    floor division gives 2. `test_a_zero_rate_loan_divides_the_capital_evenly`
    (120 000 / 12) cannot distinguish the two -- it divides evenly -- and
    `test_an_indivisible_capital_leaves_its_residue_on_the_last_instalment`
    (100 000 / 3 = 33 333,33...) can't either, because its fractional part is
    under one half and floors and rounds to the same integer either way. Only
    a fixture whose fractional part is exactly or past one half tells a
    flooring zero-rate branch apart from a correctly rounding one."""
    assert monthly_payment_cents(5, 0, 2) == 3


def test_an_indivisible_capital_leaves_its_residue_on_the_last_instalment():
    """100 000 c over 3 months at 0 % is 33 333,33 c. The level payment rounds
    half up to 33 333 and the final instalment carries the residue, so the
    capital is repaid to the cent and never one cent short."""
    assert monthly_payment_cents(100_000, 0, 3) == 33_333
    schedule = build_schedule(100_000, 0, 3)
    assert [row.payment_cents for row in schedule.rows] == [33_333, 33_333, 33_334]
    assert schedule.rows[-1].remaining_cents == 0


def test_a_one_month_loan_repays_capital_plus_one_month_of_interest():
    """The formula's simplest closed case: P*i/(1-(1+i)^-1) = P*(1+i)."""
    assert monthly_payment_cents(100_000, 1200, 1) == 101_000


def test_the_payment_matches_the_hand_computed_annuity():
    """100 000 c at 12 %/an over 2 months: 1000 * 1.0201 / 0.0201 = 50 751,24 c,
    which rounds half up to 50 751."""
    assert monthly_payment_cents(100_000, 1200, 2) == 50_751


def test_a_real_mortgage_matches_the_published_figure():
    """100 000 EUR over 20 years at 3,00 % is 554,60 EUR/month and 33 103,24 EUR
    of interest -- the standard reference figure for this loan."""
    schedule = build_schedule(10_000_000, 300, 240)
    assert schedule.monthly_payment_cents == 55_460
    assert schedule.total_interest_cents == 3_310_324
    assert schedule.total_paid_cents == 13_310_324


def test_the_schedule_is_exact_to_the_cent():
    """The invariant the integer-cents rule exists for: principal repaid sums to
    the capital, and total paid is capital plus interest. No residue anywhere."""
    schedule = build_schedule(100_000, 1200, 3)
    assert sum(row.principal_cents for row in schedule.rows) == 100_000
    assert sum(row.interest_cents for row in schedule.rows) == schedule.total_interest_cents
    assert schedule.total_paid_cents == 100_000 + schedule.total_interest_cents
    assert schedule.rows[-1].remaining_cents == 0


def test_the_last_payment_absorbs_the_rounding_residue():
    """Rounding each month's interest leaves a residue the level payment cannot
    clear. It is absorbed by the final instalment -- never left as a remaining
    balance of one cent, and never smeared silently across the schedule.

    Hand-computed at 100 000 c, 12 %/an, 3 months, payment 34 002:
      m1 interest 1 000, principal 33 002, remaining 66 998
      m2 interest   670, principal 33 332, remaining 33 666
      m3 interest   337, principal 33 666, remaining      0  <- payment 34 003
    """
    schedule = build_schedule(100_000, 1200, 3)
    assert [row.payment_cents for row in schedule.rows] == [34_002, 34_002, 34_003]
    assert [row.interest_cents for row in schedule.rows] == [1_000, 670, 337]
    assert [row.remaining_cents for row in schedule.rows] == [66_998, 33_666, 0]
    assert schedule.total_interest_cents == 2_007


def test_a_zero_rate_schedule_carries_no_interest_at_all():
    schedule = build_schedule(120_000, 0, 12)
    assert schedule.total_interest_cents == 0
    assert all(row.interest_cents == 0 for row in schedule.rows)
    assert schedule.rows[-1].remaining_cents == 0


def test_borrowing_nothing_produces_an_empty_schedule_not_a_crash():
    """A property bought outright borrows zero. That is a real answer, not an
    error -- but it must not pretend to be a loan with rows in it."""
    schedule = build_schedule(0, 300, 240)
    assert schedule.monthly_payment_cents == 0
    assert schedule.rows == []
    assert schedule.total_interest_cents == 0
    assert schedule.months == 240


def test_invalid_inputs_raise_in_french_rather_than_returning_zero():
    with pytest.raises(ValueError, match="négatif"):
        build_schedule(-1, 300, 12)
    with pytest.raises(ValueError, match="durée"):
        build_schedule(100_000, 300, 0)
    with pytest.raises(ValueError, match="durée"):
        build_schedule(100_000, 300, 481)
    with pytest.raises(ValueError, match="taux"):
        build_schedule(100_000, -1, 12)


def test_debt_ratio_is_reported_in_basis_points():
    """900 EUR of instalments against 2 500 EUR of income is 36,00 %."""
    assert debt_ratio_bps(90_000, 250_000) == 3600
    assert debt_ratio_bps(87_500, 250_000) == HCSF_DEBT_RATIO_BPS


def test_debt_ratio_is_none_without_a_measurable_income():
    """No income measured is not a ratio of zero. A zero here would render as
    "0 % d'endettement" on a household whose income could not be measured at
    all -- a fallback value standing in for real data."""
    assert debt_ratio_bps(90_000, None) is None
    assert debt_ratio_bps(90_000, 0) is None
    assert debt_ratio_bps(90_000, -100) is None


def test_cents_rounds_half_away_from_zero_on_both_signs():
    assert cents(Decimal("0.5")) == 1
    assert cents(Decimal("-0.5")) == -1
    assert cents(Decimal("2.4")) == 2


def test_an_overshooting_level_payment_does_not_go_past_zero():
    """The level payment is sized for the WHOLE term, but the tail end of a
    small loan can be cleared by it before the stated final month. Without a
    guard, the NEXT row would then subtract the level payment from an
    already-zero balance and go negative.

    7 c at 30 %/an (a realistic consumer rate, not an extreme one) over 5
    months: the level payment is 2 c/month, and 7 is not a multiple of 2, so
    month 4 pays off the remaining 1 c and a naive month 5 would go to -1 c.
    This is what the `principal > remaining` clause in `build_schedule`
    guards, independently of the `month == months` clause that only handles
    the stated final row -- deleting just that clause still passes every
    other test in this file (confirmed by mutation testing; see the task
    report), because none of them clears the balance early. `remaining_cents`
    must never go negative on ANY row, and the schedule must stop rather than
    emit rows past payoff.
    """
    schedule = build_schedule(7, 3000, 5)
    assert len(schedule.rows) == 4
    assert [row.remaining_cents for row in schedule.rows] == [5, 3, 1, 0]
    assert all(row.remaining_cents >= 0 for row in schedule.rows)


def test_a_payment_that_cannot_cover_the_first_interest_is_refused():
    """A level payment smaller than the first month's interest is not a loan
    that amortises -- the balance GROWS. Interest is highest in month 1, so
    that single comparison decides the whole schedule: pass it and the balance
    falls monotonically, fail it and it compounds.

    Left unguarded, `principal = payment - interest` goes negative, `remaining`
    grows by ~1,8x a month, and after roughly a hundred rows the running
    balance exceeds Decimal's 28-digit context and `cents()` raises
    `decimal.InvalidOperation` -- a Python traceback, in English, from an input
    `_validate` had just accepted. 2 c at 300 %/an over 360 months does exactly
    that. The refusal must be a French `ValueError`, like every other one here.
    """
    with pytest.raises(ValueError, match="mensualité"):
        build_schedule(2, 30_000, 360)


def test_a_payment_that_only_covers_the_interest_is_refused_too():
    """Shorter terms never reach the crash: they stall instead. 999 c at
    1 000 %/an over 50 months rounds to a payment exactly equal to the monthly
    interest, so 49 rows repay ZERO capital and the final-month override dumps
    the entire principal onto instalment 50 -- a balloon printed as an
    amortisation table.

    The exactness invariant cannot catch this: the principal components still
    sum to the capital, because the last row is forced to whatever is left.
    Only the payment-covers-interest bar catches it.
    """
    with pytest.raises(ValueError, match="mensualité"):
        build_schedule(999, 100_000, 50)


def test_a_zero_rate_loan_too_small_to_have_a_payment_still_amortises():
    """The guard compares the payment against the interest, and must not fire
    when there IS no interest. 1 c over 12 months at 0 % rounds to a 0 c level
    payment; nothing compounds, and the final-month override repays the cent.
    A guard written as `payment <= interest` without the `interest > 0`
    condition would refuse this legitimate schedule.
    """
    schedule = build_schedule(1, 0, 12)
    assert schedule.total_interest_cents == 0
    assert sum(row.principal_cents for row in schedule.rows) == 1
    assert schedule.rows[-1].remaining_cents == 0
