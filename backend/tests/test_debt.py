from datetime import date

import pytest

from app.engines.debt import (
    DebtInput,
    build_payoff,
    compare_strategies,
)

TODAY = date(2026, 8, 25)


def _debt(id_, principal, minimum, rate=0, name=None) -> DebtInput:
    return DebtInput(id=id_, name=name or f"Dette {id_}", principal_cents=principal,
                     annual_rate_bps=rate, minimum_payment_cents=minimum)


def test_the_freed_minimum_rolls_onto_the_next_debt():
    """The whole point of a snowball, and the only thing that makes it faster
    than paying each debt separately. Hand-computed, zero rate so every cent is
    checkable, budget 30 000 c held constant:

      m1  A 30 000 -> 20 000   B 100 000 -> 80 000
      m2  A 20 000 -> 10 000   B  80 000 -> 60 000
      m3  A 10 000 ->      0   B  60 000 -> 40 000   (A cleared)
      m4  A cleared            B  40 000 -> 10 000   (A's 10 000 rolls onto B)
      m5                       B  10 000 ->      0
    """
    plan = build_payoff([_debt(1, 30_000, 10_000), _debt(2, 100_000, 20_000)],
                        0, "snowball", TODAY)
    assert plan.months == 5
    assert plan.total_interest_cents == 0
    assert plan.total_paid_cents == 130_000
    assert plan.order == [1, 2]
    assert {p.debt_id: p.cleared_in_months for p in plan.payoffs} == {1: 3, 2: 5}
    assert plan.points[3].balances_cents == {1: 0, 2: 10_000}


def test_interest_accrues_before_the_payment_each_month():
    """Single debt, 100 000 c at 12 %/an, 60 000 c/month.
      m1 interest 1 000 -> 101 000, pay 60 000 -> 41 000
      m2 interest   410 ->  41 410, pay 41 410 ->      0
    """
    plan = build_payoff([_debt(1, 100_000, 60_000, rate=1200)], 0, "avalanche", TODAY)
    assert plan.months == 2
    assert plan.total_interest_cents == 1_410
    assert plan.total_paid_cents == 101_410
    assert plan.first_month_interest_cents == 1_000


def test_the_two_strategies_attack_in_different_orders():
    """Smallest balance first versus highest rate first. The fixture is built so
    the two orders genuinely differ -- a fixture where they coincide proves
    nothing, which is how phase 2A's single-category ordering test passed for
    the wrong reason."""
    debts = [_debt(1, 200_000, 5_000, rate=2000), _debt(2, 50_000, 5_000, rate=500)]
    comparison = compare_strategies(debts, 20_000, TODAY)
    assert comparison.snowball.order == [2, 1]
    assert comparison.avalanche.order == [1, 2]


def test_avalanche_costs_no_more_interest_than_snowball():
    """Attacking the dearest debt first cannot cost more. Asserted as an
    inequality plus a strict check on this fixture, because `<=` alone would
    pass if the implementation ignored the strategy entirely."""
    debts = [_debt(1, 200_000, 5_000, rate=2000), _debt(2, 50_000, 5_000, rate=500)]
    comparison = compare_strategies(debts, 20_000, TODAY)
    assert comparison.avalanche.total_interest_cents <= comparison.snowball.total_interest_cents
    assert comparison.interest_saved_cents > 0
    assert comparison.interest_saved_cents == (
        comparison.snowball.total_interest_cents - comparison.avalanche.total_interest_cents
    )


def test_a_budget_that_cannot_cover_the_first_month_of_interest_refuses():
    """500 c/month against 1 000 c of monthly interest: the capital would grow
    for ever. Refused with its OWN reason, before the loop -- never with the
    fifty-year message, which would name the wrong cause."""
    plan = build_payoff([_debt(1, 100_000, 500, rate=1200)], 0, "snowball", TODAY)
    assert plan.months is None
    assert plan.cleared_on is None
    assert plan.unavailable_reason is not None
    assert "intérêts" in plan.unavailable_reason
    assert "ans" not in plan.unavailable_reason
    # The two figures the screen needs to state the shortfall itself, in euros.
    assert plan.monthly_budget_cents == 500
    assert plan.first_month_interest_cents == 1_000


def test_a_payoff_longer_than_fifty_years_refuses_with_a_different_reason():
    """One cent above the interest: the capital does shrink, so the budget
    guard does not fire, but not within a lifetime. A distinct cause needs a
    distinct message -- the failure mode that cost phase 2A five fix rounds."""
    plan = build_payoff([_debt(1, 1_000_000, 10_001, rate=1200)], 0, "snowball", TODAY)
    assert plan.months is None
    assert plan.unavailable_reason is not None
    assert "ans" in plan.unavailable_reason
    assert "intérêts du premier mois" not in plan.unavailable_reason


def test_an_empty_debt_list_is_answered_not_refused():
    """Nobody with no debts has a payoff problem. Zero months, no reason: a
    refusal here would put an error on a screen whose real message is "vous
    n'avez aucune dette"."""
    plan = build_payoff([], 0, "snowball", TODAY)
    assert plan.months == 0
    assert plan.unavailable_reason is None
    assert plan.payoffs == []
    assert plan.points == []


def test_the_clearing_date_is_the_end_of_the_month_the_last_payment_lands_in():
    plan = build_payoff([_debt(1, 30_000, 10_000)], 0, "snowball", TODAY)
    assert plan.months == 3
    # August 2026 + 3 months -> end of November 2026.
    assert plan.cleared_on == date(2026, 11, 30)


def test_extra_money_shortens_the_plan():
    slow = build_payoff([_debt(1, 100_000, 10_000)], 0, "snowball", TODAY)
    fast = build_payoff([_debt(1, 100_000, 10_000)], 10_000, "snowball", TODAY)
    assert slow.months == 10
    assert fast.months == 5


def test_an_unknown_strategy_raises_in_french():
    with pytest.raises(ValueError, match="stratégie"):
        build_payoff([_debt(1, 1000, 100)], 0, "waterfall", TODAY)


def test_a_negative_principal_raises_rather_than_being_absorbed():
    """`Debt.principal_cents` is a positive magnitude by contract. A negative
    one is a caller bug, and silently treating it as zero would hide a debt."""
    with pytest.raises(ValueError, match="capital"):
        build_payoff([_debt(1, -1000, 100)], 0, "snowball", TODAY)


def test_a_zero_minimum_debt_is_only_paid_from_the_surplus_pass():
    """A debt with no contractual minimum (a 0 %, interest-free family loan,
    say) gets nothing in the minimum pass -- `min(0, owed, left)` is 0 -- and
    is fed only once the minimum pass has placed every other debt's minimum.
    Zero rate so every cent is checkable:

      m1  minimum pass: A(min 0) -> 0 paid.  B(min 5 000) -> 5 000, left 5 000.
          surplus pass:  A -> 5 000 (all that is left)         -> A cleared
      m2  minimum pass: A cleared, skipped.  B(min 5 000) -> 5 000 -> cleared
    """
    plan = build_payoff([_debt(1, 5_000, 0), _debt(2, 10_000, 5_000)], 5_000, "snowball", TODAY)
    assert plan.months == 2
    assert plan.total_interest_cents == 0
    assert plan.total_paid_cents == 15_000
    assert plan.order == [1, 2]
    assert {p.debt_id: p.cleared_in_months for p in plan.payoffs} == {1: 1, 2: 2}


def test_comparing_strategies_when_the_budget_refuses_both():
    """`compare_strategies` must not compute a saving out of two refusals: the
    difference between "no answer" and "no answer" is not a number of cents."""
    debts = [_debt(1, 100_000, 500, rate=1200)]
    comparison = compare_strategies(debts, 0, TODAY)
    assert comparison.snowball.months is None
    assert comparison.avalanche.months is None
    assert comparison.interest_saved_cents is None
    assert comparison.months_saved is None


def test_a_negative_extra_contribution_is_refused():
    """`extra_monthly_cents` is what goes on top of the minimums, so the budget
    is `sum(minimums) + extra`. A negative extra silently funds LESS than the
    contractual minimums, and nothing downstream notices: the aggregate can
    still clear the first month's interest, so neither refusal fires, and the
    plan comes back with `unavailable_reason=None` while a low-priority debt
    grows untouched for years.

    Worse, it inverts the comparison the whole screen exists to make. With two
    minimums of 50 000 c and `extra=-90 000`, the budget is 10 000 c against
    100 000 c of minimums; on some fixtures avalanche then costs MORE interest
    than snowball, contradicting `interest_saved_cents`'s own contract.
    Refusing the input is the fix -- there is no such thing as contributing a
    negative amount.
    """
    debts = [_debt(1, 1_000_000, 50_000, rate=100), _debt(2, 1_000_000, 50_000, rate=100)]
    with pytest.raises(ValueError, match="négatif"):
        build_payoff(debts, -90_000, "snowball", TODAY)


def test_a_negative_rate_is_refused():
    """A negative rate manufactures money: the balance falls without any
    payment covering it, and `total_interest_cents` comes back negative.
    `amortization._validate` and `savings._validate_rate` both refuse it; this
    engine multiplies the same rate into the same cents and must refuse it too.
    """
    with pytest.raises(ValueError, match="taux"):
        build_payoff([_debt(1, 100_000, 10_000, rate=-500)], 0, "snowball", TODAY)


def test_a_negative_minimum_payment_is_refused():
    """A negative minimum is subtracted from the shared budget, which is the
    same starvation as a negative extra, reached through the other input."""
    with pytest.raises(ValueError, match="négative"):
        build_payoff([_debt(1, 100_000, -10_000, rate=100)], 20_000, "snowball", TODAY)


def test_an_interest_only_budget_is_refused_without_claiming_the_capital_grows():
    """The refusal fires on `budget <= first_month_interest`, so it covers the
    EQUALITY too -- and at equality the capital does not increase, it stays
    flat forever. A sentence saying it "augmenterait" is false for an input
    that reaches it, which is this project's most repeated defect: a French
    sentence naming the wrong cause.
    """
    debt = _debt(1, 100_000, 1_000, rate=1200)  # 100 000 c at 12 %/an = 1 000 c/month
    plan = build_payoff([debt], 0, "snowball", TODAY)
    assert plan.months is None
    assert plan.unavailable_reason is not None
    assert "augmenterait" not in plan.unavailable_reason
    assert "ne diminuerait jamais" in plan.unavailable_reason


def test_avalanche_can_tie_or_trail_by_a_cent():
    """Avalanche is the cheaper ORDER, not a cheaper number on every fixture.
    Interest is rounded to the cent every month for every debt, and that
    rounding is enough to erase the theoretical gap: over a 4 000-fixture
    sweep with a non-negative extra, 450 pairs tied with different orders and
    one put avalanche a single cent behind. This is that one.

    Pinned so nobody "fixes" the sign later by clamping it, and so the screen
    built in task 6 is written knowing `interest_saved_cents` can be 0 or
    negative without either plan having failed.
    """
    debts = [
        _debt(1, 2_316_377, 190_529, rate=3000),
        _debt(2, 2_433_911, 163_393, rate=101),
        _debt(3, 2_004_925, 166_265, rate=500),
        _debt(4, 2_237_242, 184_798, rate=0),
    ]
    comparison = compare_strategies(debts, 1, TODAY)
    assert comparison.snowball.order != comparison.avalanche.order
    assert comparison.interest_saved_cents == -1
    assert comparison.snowball.months is not None
    assert comparison.avalanche.months is not None
