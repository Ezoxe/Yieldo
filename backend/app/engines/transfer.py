"""What counts as moving your own money, and how much of it actually left.

Two questions, one subject, so one module.

**The marking rule.** `Transaction.is_transfer` has existed since the first
migration and every flow engine in this codebase already excludes it --
`aggregate.aggregate_series`, `analytics._period_totals`,
`common.recurrence_points`, `common.anomaly_points`, `runway`, `feasibility`.
Nothing ever posed it. `is_internal_transfer` is the rule that does, and it is
the only place the decision is made: the API, the importer and the migration
all call it rather than each restating the same three lines differently.

**The figure.** `measure_set_aside` says how much a month actually moved into
the savings perimeter. It is deliberately NOT a fourth flow measure and it must
never be added to `capacity.measure_savings_capacity`: that function measures
`inflow + outflow` over NON-transfer rows, so the euro moved to a livret is
already counted as saved there -- it stays in the net because nothing takes it
out any more. Adding this figure on top would count the same euro twice. The
two stand side by side, and the number worth reading is their difference: the
surplus the month produced but never moved anywhere.

Pure: no session, no network, no clock.
"""

from collections import Counter
from dataclasses import dataclass
from datetime import date

# Where a household's savings live. `real_estate` and `loan` are deliberately
# out: neither is a place cash is moved into month by month, and a mortgage
# payment is a real outflow the reader must keep seeing.
#
# Every value here is one of `models.account.ACCOUNT_KINDS`, and
# `test_transfer.py` pins that -- a kind renamed in the model and not here
# would silently stop marking a whole account type.
SAVINGS_ACCOUNT_KINDS = frozenset(
    {"savings", "pea", "life_insurance", "per", "brokerage", "crypto"}
)

# `categorization/seed.py`'s own slugs, mirrored rather than imported: that
# module builds ORM rows, and an engine that imported it would stop being pure.
# `test_transfer.py` asserts the seed still ships both, so the two cannot drift.
#
# The distinction is the whole point of having two names. `epargne` moves money
# OUT of the spendable perimeter and is what `measure_set_aside` counts;
# `virement-interne` moves it between two current accounts and changes nothing
# a household can spend, so it is a transfer and nothing more.
SAVINGS_CATEGORY_SLUG = "epargne"
INTERNAL_CATEGORY_SLUG = "virement-interne"

TRANSFER_SOURCES = ("auto", "manual")


def is_internal_transfer(
    *, category_kind: str | None, account_kind: str, transfer_source: str
) -> bool:
    """Whether the automatic rules call this row a movement of your own money.

    Two rules, category first:

    1. A category of kind `transfer` -- `Epargne et investissement`, `Virement
       interne` -- settles it. The user said what this is.
    2. Failing a category at all, the account decides: a row on an account of
       the savings perimeter is a movement of wealth, not a flow of cash.

    The account rule fires ONLY where no category has. Interest credited on a
    livret is categorised income and stays income -- it is a real gain, and
    hiding it under "transfer" would be a different lie from the one this
    module exists to fix. Management fees on a PEA stay an expense for the same
    reason.

    `manual` is refused rather than answered. A row the user or the agent
    marked by hand is not this function's business, and returning a value for
    it invites a caller to overwrite the one decision that must never be
    overwritten.
    """
    if transfer_source not in TRANSFER_SOURCES:
        raise ValueError(f"Origine de marquage inconnue : {transfer_source}")
    if transfer_source == "manual":
        raise ValueError(
            "Une operation marquee a la main n'est jamais recalculee : "
            "is_internal_transfer ne repond que pour les lignes automatiques."
        )
    if category_kind is not None:
        return category_kind == "transfer"
    return account_kind in SAVINGS_ACCOUNT_KINDS


@dataclass(frozen=True)
class SetAsideRow:
    """The minimal shape the set-aside measure needs. Not an ORM object."""

    on: date
    amount_cents: int
    account_kind: str
    # The slug of the category's ROOT, never the leaf's. `epargne` ships four
    # children (`epargne-livret`, `epargne-bourse`, ...) and a user may add
    # more, so matching the leaf would miss every versement filed under one.
    # The caller walks the parent chain; the engine stays pure.
    category_root_slug: str | None
    # Its kind, or None when the row carries no category. Kept beside the slug
    # because the two rules need different things: the outgoing side is
    # identified by root slug (`epargne` and not `virement-interne`), the
    # savings side by kind (anything the user did not call income or expense).
    category_kind: str | None = None


def _key(on: date) -> str:
    return f"{on.year}-{on.month:02d}"


def measure_set_aside(
    rows: list[SetAsideRow], keys: list[str] | None = None
) -> dict[str, int]:
    """Cents moved into the savings perimeter, per calendar month. Signed.

    Category first, account in reserve, and never both on the same movement.

    * **The outgoing side.** Rows categorised `epargne` on an account OUTSIDE
      the savings perimeter. That is the versement seen from the side that
      pays, and it is the side certain to be imported -- everyone imports their
      current account. Counted with the sign flipped: a 300 EUR debit sets
      300 EUR aside, and a 300 EUR credit takes it back out.
    * **The savings side, in reserve.** Rows on an account INSIDE the perimeter
      that no category called income or expense. These catch the versement
      whose source account Yieldo does not hold -- and, netting against each
      other, mean a livret emptied into a PEA sets nothing new aside.

    A savings-side row is dropped when it MIRRORS an outgoing one: same month,
    exactly opposite amount, one for one. Both accounts imported means one
    movement written twice, and counting both would double every versement.
    Matching is a multiset difference within the month -- not an appariement
    engine -- so two identical 300 EUR versements in one month stay two
    movements, and a debit in March never pairs with a credit in April.

    A month appears in the result when at least one row took part in the
    measure, even if the total is zero: a livret emptied into a PEA is a
    measured nothing, not a missing measurement. `keys` adds months the caller
    knows the ledger covers, each at zero.
    """
    outgoing: dict[str, list[SetAsideRow]] = {}
    inside: dict[str, list[SetAsideRow]] = {}
    for row in rows:
        in_perimeter = row.account_kind in SAVINGS_ACCOUNT_KINDS
        if not in_perimeter and row.category_root_slug == SAVINGS_CATEGORY_SLUG:
            outgoing.setdefault(_key(row.on), []).append(row)
        elif in_perimeter and row.category_kind in (None, "transfer"):
            inside.setdefault(_key(row.on), []).append(row)

    totals = {key: 0 for key in (keys or [])}
    for key in set(outgoing) | set(inside):
        moved = sum(-row.amount_cents for row in outgoing.get(key, []))
        # What the savings side of each outgoing movement would look like.
        mirrors = Counter(-row.amount_cents for row in outgoing.get(key, []))
        for row in inside.get(key, []):
            if mirrors[row.amount_cents] > 0:
                mirrors[row.amount_cents] -= 1
                continue
            moved += row.amount_cents
        totals[key] = moved
    return totals
