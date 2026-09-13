"""Net worth: what the household owns minus what it owes.

Pure, and small on purpose. The Patrimoine screen already prints the assets
in three kinds — positions valued at a quoted price, envelopes at a declared
amount, savings accounts at the balance their movements add up to — and the
Dettes screen prints the capital restant dû of every active debt. Neither
screen ever put the two beside each other, so a household with 23 900 EUR of
assets and 11 570 EUR of loans read « Valeur du portefeuille : 23 900 » and
had to do the subtraction itself.

The route (`api/portfolio.get_net_worth`) decides what goes in each term and
passes four integers; this module refuses a sign that would lie and returns
the sum, the difference and the terms named. Nothing here reads a clock or a
session, and a snapshot of the result is the route's business.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class NetWorth:
    """The household's balance sheet on one day, in cents."""

    assets_cents: int
    # Capital restant dû, summed over the active debts. Positive: it is a
    # size, and `breakdown` carries it with its sign.
    debts_cents: int
    net_cents: int
    # Every term with the sign it enters the total with, in the order the
    # screen prints them. A tuple of pairs rather than a dict: the order is
    # part of the reading, and a frozen dataclass wants a hashable field.
    breakdown: tuple[tuple[str, int], ...]


def measure_net_worth(
    *,
    positions_cents: int,
    declared_cents: int,
    cash_cents: int,
    debts_remaining_cents: int,
) -> NetWorth:
    """Assets minus debts, with every term checked for the sign it must have.

    An asset term is a value or a balance and cannot be negative; a savings
    account overdrawn would be a current account and belongs to Trésorerie,
    which is why `SAVINGS_ACCOUNT_KINDS` is the perimeter upstream. A debt is
    given as the positive capital still owed, the way `Debt.principal_cents`
    stores it. A caller that hands over a negative term has mixed up a sign,
    and the answer would be wrong by twice that amount: refuse rather than
    print it.
    """
    for name, value in (
        ("positions_cents", positions_cents),
        ("declared_cents", declared_cents),
        ("cash_cents", cash_cents),
        ("debts_remaining_cents", debts_remaining_cents),
    ):
        if value < 0:
            raise ValueError(f"{name} must not be negative, got {value}")

    assets = positions_cents + declared_cents + cash_cents
    return NetWorth(
        assets_cents=assets,
        debts_cents=debts_remaining_cents,
        net_cents=assets - debts_remaining_cents,
        breakdown=(
            ("positions", positions_cents),
            ("declared", declared_cents),
            ("cash", cash_cents),
            ("debts", -debts_remaining_cents),
        ),
    )
