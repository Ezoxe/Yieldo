"""Boule de neige and avalanche, over one constant monthly budget.

Design §6.1 lists "analyse de dettes avec échéancier boule de neige et
avalanche" among the engines carried over from FinVest. This is that engine,
rebuilt: integer cents throughout, both refusals named separately, and a
budget that stays constant as debts clear -- which is the entire mechanism.

**The budget is fixed at the start and never shrinks.** It is the sum of every
debt's contractual minimum plus whatever extra the household commits. When a
debt clears, its minimum does not disappear; it rolls onto the next debt in the
attack order. A model that let the budget fall as debts cleared would describe
paying each debt separately, which is neither strategy and is slower than both.

**Two refusals, mutually exclusive by construction:**

* the budget does not cover the first month's interest, so the capital would
  grow for ever. Checked before the loop, so its message can never be emitted
  on a plan that merely takes a long time;
* the plan runs past `MAX_PAYOFF_MONTHS`. Only reachable after the first check
  has passed.

The reasons name causes, not amounts: the two figures a screen needs to state
the shortfall in euros (`monthly_budget_cents`, `first_month_interest_cents`)
are published as fields, and formatting money is the display boundary's job.

Pure: no session, no network, no implicit clock -- `today` is a parameter.
"""

from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from app.engines.amortization import cents, monthly_rate
from app.engines.period import month_end

STRATEGIES = ("snowball", "avalanche")

# Fifty years, matching `runway.MAX_DATED_MONTHS` and
# `savings.MAX_PROJECTION_MONTHS`. Past it a payoff date is not an answer.
MAX_PAYOFF_MONTHS = 600


@dataclass(frozen=True)
class DebtInput:
    """One debt, at the engine boundary.

    `principal_cents` is a POSITIVE magnitude -- capital restant dû -- matching
    `models.Debt`. This is the deliberate exception to the negative-outflow
    convention, restated here so an engine reader does not have to go looking.
    """

    id: int
    name: str
    principal_cents: int
    annual_rate_bps: int
    minimum_payment_cents: int


@dataclass(frozen=True)
class DebtPayoff:
    debt_id: int
    name: str
    cleared_in_months: int
    cleared_on: date
    interest_cents: int
    paid_cents: int


@dataclass(frozen=True)
class BalancePoint:
    month: int
    on: date
    # debt_id -> capital still owed at the END of this month. Every debt in the
    # input appears in every point, cleared ones included with a 0, so a
    # stacked chart has a value for every series at every x.
    balances_cents: dict[int, int]
    total_cents: int


@dataclass(frozen=True)
class PayoffPlan:
    strategy: str
    # Constant for the whole plan. See the module docstring.
    monthly_budget_cents: int
    # What every debt costs in interest in month one, together. Published so a
    # screen can state the shortfall behind a budget refusal in euros without
    # recomputing it, and so a healthy plan can show what the budget is up
    # against. 0 on an empty debt list.
    first_month_interest_cents: int
    # None exactly when `unavailable_reason` is set. 0 on an empty debt list,
    # which is an answer rather than a refusal.
    months: int | None
    cleared_on: date | None
    total_interest_cents: int
    total_paid_cents: int
    # Debt ids in attack order. Populated even on a refusal -- the order is a
    # property of the strategy and the debts, not of whether the plan converged.
    order: list[int]
    payoffs: list[DebtPayoff]
    points: list[BalancePoint]
    # French. Set exactly when `months` is None, and it names WHICH of the two
    # causes applies. Never both.
    unavailable_reason: str | None


@dataclass(frozen=True)
class StrategyComparison:
    snowball: PayoffPlan
    avalanche: PayoffPlan
    # Snowball's interest minus avalanche's: positive when avalanche is cheaper,
    # which it is whenever the two orders differ. None when either plan refused
    # -- a difference between a number and a refusal is not a saving.
    interest_saved_cents: int | None
    months_saved: int | None


def _ordered(debts: list[DebtInput], strategy: str) -> list[DebtInput]:
    """Attack order.

    Snowball: smallest capital first -- the motivational strategy, one debt
    visibly gone as early as possible. Avalanche: highest rate first -- the
    cheapest strategy. Both fall back to the smallest capital and then the id,
    so the order is total and a tie never depends on dictionary insertion.
    """
    if strategy == "snowball":
        return sorted(debts, key=lambda d: (d.principal_cents, d.id))
    if strategy == "avalanche":
        return sorted(debts, key=lambda d: (-d.annual_rate_bps, d.principal_cents, d.id))
    raise ValueError(f"La stratégie de remboursement « {strategy} » est inconnue.")


def _reason_budget_too_small() -> str:
    return (
        "La mensualité totale disponible ne couvre pas les intérêts du premier "
        "mois : le capital augmenterait au lieu de diminuer, et aucun échéancier "
        "ne peut être établi. Augmentez le versement mensuel, ou renégociez le "
        "taux de la dette la plus chère."
    )


def _reason_too_long() -> str:
    return (
        f"Au rythme actuel, ces dettes ne seraient pas soldées avant "
        f"{MAX_PAYOFF_MONTHS // 12} ans. Aucune échéance n'est avancée au-delà : "
        "elle ne voudrait rien dire."
    )


def build_payoff(
    debts: list[DebtInput],
    extra_monthly_cents: int,
    strategy: str,
    today: date,
) -> PayoffPlan:
    """One strategy's full schedule. See the module docstring for both refusals."""
    order = _ordered(debts, strategy)
    for debt in order:
        if debt.principal_cents < 0:
            raise ValueError(
                f"Le capital restant dû de « {debt.name} » ne peut pas être négatif."
            )
    ids = [debt.id for debt in order]
    budget = sum(debt.minimum_payment_cents for debt in debts) + extra_monthly_cents
    rates = {debt.id: monthly_rate(debt.annual_rate_bps) for debt in debts}
    first_interest = sum(
        cents(Decimal(debt.principal_cents) * rates[debt.id]) for debt in debts
    )

    if not debts:
        return PayoffPlan(
            strategy=strategy, monthly_budget_cents=budget, first_month_interest_cents=0,
            months=0, cleared_on=None, total_interest_cents=0, total_paid_cents=0,
            order=[], payoffs=[], points=[], unavailable_reason=None,
        )

    if budget <= first_interest:
        return PayoffPlan(
            strategy=strategy, monthly_budget_cents=budget,
            first_month_interest_cents=first_interest, months=None, cleared_on=None,
            total_interest_cents=0, total_paid_cents=0, order=ids, payoffs=[], points=[],
            unavailable_reason=_reason_budget_too_small(),
        )

    remaining = {debt.id: debt.principal_cents for debt in debts}
    interest_by_debt = {debt.id: 0 for debt in debts}
    paid_by_debt = {debt.id: 0 for debt in debts}
    payoffs: list[DebtPayoff] = []
    points: list[BalancePoint] = []
    total_interest = 0
    total_paid = 0

    for month in range(1, MAX_PAYOFF_MONTHS + 1):
        for debt in order:
            if remaining[debt.id] <= 0:
                continue
            interest = cents(Decimal(remaining[debt.id]) * rates[debt.id])
            remaining[debt.id] += interest
            interest_by_debt[debt.id] += interest
            total_interest += interest

        # Contractual minimums first, in attack order, then everything left over
        # cascades down the same order. Cascading rather than stopping at the
        # focus debt matters on the last month: the focus can be cleared with
        # money to spare, and that money is available to the next debt now, not
        # next month.
        left = budget
        for pass_ in ("minimum", "surplus"):
            for debt in order:
                if left <= 0:
                    break
                owed = remaining[debt.id]
                if owed <= 0:
                    continue
                ceiling = debt.minimum_payment_cents if pass_ == "minimum" else left
                payment = min(ceiling, owed, left)
                if payment <= 0:
                    continue
                remaining[debt.id] -= payment
                paid_by_debt[debt.id] += payment
                left -= payment
                total_paid += payment

        on = month_end(today, month)
        for debt in order:
            if remaining[debt.id] == 0 and debt.id not in {p.debt_id for p in payoffs}:
                payoffs.append(DebtPayoff(
                    debt_id=debt.id, name=debt.name, cleared_in_months=month, cleared_on=on,
                    interest_cents=interest_by_debt[debt.id], paid_cents=paid_by_debt[debt.id],
                ))
        points.append(BalancePoint(
            month=month, on=on,
            balances_cents={debt.id: remaining[debt.id] for debt in order},
            total_cents=sum(remaining.values()),
        ))

        if all(value == 0 for value in remaining.values()):
            return PayoffPlan(
                strategy=strategy, monthly_budget_cents=budget,
                first_month_interest_cents=first_interest, months=month, cleared_on=on,
                total_interest_cents=total_interest, total_paid_cents=total_paid,
                order=ids, payoffs=payoffs, points=points, unavailable_reason=None,
            )

    return PayoffPlan(
        strategy=strategy, monthly_budget_cents=budget,
        first_month_interest_cents=first_interest, months=None, cleared_on=None,
        total_interest_cents=total_interest, total_paid_cents=total_paid,
        order=ids, payoffs=payoffs, points=points, unavailable_reason=_reason_too_long(),
    )


def compare_strategies(
    debts: list[DebtInput], extra_monthly_cents: int, today: date
) -> StrategyComparison:
    """Both plans, and what choosing avalanche over snowball actually buys.

    `interest_saved_cents` and `months_saved` are None whenever either plan
    refused: the difference between a number and a refusal is not a saving, and
    subtracting a refusal's zeroed totals would report a spectacular fictional
    gain.
    """
    snowball = build_payoff(debts, extra_monthly_cents, "snowball", today)
    avalanche = build_payoff(debts, extra_monthly_cents, "avalanche", today)
    if snowball.months is None or avalanche.months is None:
        return StrategyComparison(snowball=snowball, avalanche=avalanche,
                                  interest_saved_cents=None, months_saved=None)
    return StrategyComparison(
        snowball=snowball, avalanche=avalanche,
        interest_saved_cents=snowball.total_interest_cents - avalanche.total_interest_cents,
        months_saved=snowball.months - avalanche.months,
    )
