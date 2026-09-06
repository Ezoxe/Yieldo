"""Applying `engines/transfer.py` to real rows.

An orchestration layer, like `importers/service.py` and
`categorization/seed.py`: it takes a `Session`, resolves the two facts the pure
rule needs -- what kind the row's category is, what kind its account is -- and
calls the engine. It carries no decision of its own. Every branch that decides
anything lives in `engines/transfer.py`, so the API, the importer and the
migration cannot drift apart.

One resolver is built per request and reused across the rows it touches: the
category and account tables are small, read once, and a per-row query would
turn an import of two thousand lines into four thousand round trips.
"""

from datetime import date

from sqlalchemy.orm import Session

from app.engines.transfer import SetAsideRow, is_internal_transfer
from app.models import Account, Category, Transaction


class TransferResolver:
    """This user's category and account tables, read once."""

    def __init__(self, db: Session, user_id: int) -> None:
        categories = db.query(Category).filter(Category.user_id == user_id).all()
        self._kind = {row.id: row.kind for row in categories}
        parents = {row.id: row.parent_id for row in categories}
        slugs = {row.id: row.slug for row in categories}
        self._root_slug = {
            category_id: slugs[_root(category_id, parents)] for category_id in slugs
        }
        self._account_kind = {
            row.id: row.kind
            for row in db.query(Account).filter(Account.user_id == user_id).all()
        }

    def category_kind(self, category_id: int | None) -> str | None:
        return None if category_id is None else self._kind.get(category_id)

    def category_root_slug(self, category_id: int | None) -> str | None:
        return None if category_id is None else self._root_slug.get(category_id)

    def account_kind(self, account_id: int) -> str:
        return self._account_kind[account_id]

    def decide(self, *, account_id: int, category_id: int | None) -> bool:
        """What the automatic rules say about a row on this account, in this
        category. Never called for a row marked by hand -- see `apply`."""
        return is_internal_transfer(
            category_kind=self.category_kind(category_id),
            account_kind=self.account_kind(account_id),
            transfer_source="auto",
        )

    def apply(self, transaction: Transaction) -> None:
        """Re-run the rule over a row, unless a human already answered.

        The `manual` guard is the whole point of `transfer_source`: a row the
        user marked -- or unmarked -- stays as they left it through every later
        recategorisation, account move and re-import.
        """
        if transaction.transfer_source == "manual":
            return
        transaction.is_transfer = self.decide(
            account_id=transaction.account_id, category_id=transaction.category_id
        )

    def set_aside_row(self, transaction: Transaction) -> SetAsideRow:
        return SetAsideRow(
            on=transaction.date,
            amount_cents=transaction.amount_cents,
            account_kind=self.account_kind(transaction.account_id),
            category_root_slug=self.category_root_slug(transaction.category_id),
            category_kind=self.category_kind(transaction.category_id),
        )


def _root(category_id: int, parents: dict[int, int | None]) -> int:
    """The top of a category's parent chain.

    Bounded by the number of categories rather than by trusting the tree to be
    acyclic: a cycle would otherwise hang the request, and a hang is a worse
    answer than an arbitrary one from inside the cycle.
    """
    seen: set[int] = set()
    current = category_id
    while True:
        parent = parents.get(current)
        if parent is None or parent in seen:
            return current
        seen.add(current)
        current = parent


def set_aside_rows(
    db: Session, user_id: int, date_from: date | None, date_to: date | None
) -> list[SetAsideRow]:
    """Every row a set-aside measure could care about, in one query.

    Deliberately unfiltered on `is_transfer`: the measure is ABOUT the
    transfers, and reading only the rows the flow engines keep would return
    nothing at all.
    """
    resolver = TransferResolver(db, user_id)
    query = db.query(Transaction).filter(Transaction.user_id == user_id)
    if date_from is not None:
        query = query.filter(Transaction.date >= date_from)
    if date_to is not None:
        query = query.filter(Transaction.date <= date_to)
    return [resolver.set_aside_row(row) for row in query.all()]
