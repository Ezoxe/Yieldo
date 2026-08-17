"""Fetch helpers shared by every analytics-shaped router.

Two rules hold in every function here, without exception:

* every query filters on `user_id`. There is no read path without it;
* the clock is read *here*, at the route boundary, and passed into the engines
  as a parameter. No engine imports `date.today`.

The engines never see an ORM object: each helper converts rows into the frozen
dataclass its engine declares.
"""

from datetime import date

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.history import user_history
from app.engines.aggregate import TxPoint
from app.engines.anomaly import AnomalyTx
from app.engines.period import resolve_range
from app.engines.recurrence import RecurringTx
from app.importers.dedup import normalize_label
from app.models import Account, Transaction
from app.schemas.history import HistoryOut

# What "the money you could actually spend next month" is made of. A PEA or a
# life-insurance contract is wealth, not runway: selling it is a decision, not a
# withdrawal, and counting it here would tell someone they can survive eleven
# months when they can survive two.
LIQUID_ACCOUNT_KINDS = ("checking", "savings", "cash")


def period_range(
    db: Session, user_id: int, date_from: date | None, date_to: date | None
) -> tuple[date, date, HistoryOut | None]:
    """The range this request actually covers, plus the user's whole ledger span.

    An absent bound means all of *this user's* data, not the current calendar
    year. `date.today()` is read here and handed to `resolve_range` as a
    parameter, so the engine stays pure and testable at any date.
    """
    history = user_history(db, user_id)
    start, end = resolve_range(
        date_from,
        date_to,
        history.date_from if history else None,
        history.date_to if history else None,
        date.today(),
    )
    return start, end, history


def tx_points(
    db: Session,
    user_id: int,
    date_from: date | None,
    date_to: date | None,
    account_id: int | None = None,
) -> list[TxPoint]:
    """This user's transactions in the aggregation engine's input shape."""
    query = db.query(Transaction).filter(Transaction.user_id == user_id)
    if date_from is not None:
        query = query.filter(Transaction.date >= date_from)
    if date_to is not None:
        query = query.filter(Transaction.date <= date_to)
    if account_id is not None:
        query = query.filter(Transaction.account_id == account_id)
    return [
        TxPoint(on=t.date, amount_cents=t.amount_cents, category_id=t.category_id,
                account_id=t.account_id, is_transfer=t.is_transfer)
        for t in query.all()
    ]


def recurrence_points(db: Session, user_id: int) -> list[RecurringTx]:
    """The whole ledger, keyed for recurrence grouping.

    Always the whole ledger, never a period: a monthly charge cannot be
    recognised from one month of statements, and a period-scoped detection
    would report a different set of subscriptions on every date filter.

    Internal transfers are excluded -- a standing order to a savings account is
    regular by construction and is not a subscription.

    The key is recomputed from `label_raw` rather than read from `label_clean`:
    what is stored there depends on which importer version wrote the row (the
    phase 1.5 verification fixture writes a bare lowercase), and a grouping key
    that changes with the writer would silently split one subscription in two.
    """
    rows = (
        db.query(Transaction)
        .filter(Transaction.user_id == user_id, Transaction.is_transfer.is_(False))
        .order_by(Transaction.date)
        .all()
    )
    return [
        RecurringTx(
            on=row.date,
            amount_cents=row.amount_cents,
            label_key=normalize_label(row.label_raw),
            label_raw=row.label_raw,
            category_id=row.category_id,
        )
        for row in rows
    ]


def anomaly_points(db: Session, user_id: int) -> list[AnomalyTx]:
    """The whole ledger, for scoring against each category's own history.

    Always the whole ledger for the same reason as above: an amount is unusual
    relative to everything the user has ever spent in that category, not
    relative to the fortnight currently on screen. The *reported* window is
    narrowed by the engine, not by this query.
    """
    rows = (
        db.query(Transaction)
        .filter(Transaction.user_id == user_id, Transaction.is_transfer.is_(False))
        .order_by(Transaction.date)
        .all()
    )
    return [
        AnomalyTx(id=row.id, on=row.date, amount_cents=row.amount_cents,
                  label=row.label_raw, category_id=row.category_id)
        for row in rows
    ]


def liquid_balance_cents(db: Session, user_id: int) -> int:
    """Opening balances plus every movement, over this user's liquid accounts.

    Transfers are counted here, unlike everywhere else: moving money between two
    of the user's own accounts is not spending, but it does change what sits in
    each of them, and this figure is a balance rather than a flow.
    """
    account_ids = [
        row.id
        for row in db.query(Account.id)
        .filter(
            Account.user_id == user_id,
            Account.kind.in_(LIQUID_ACCOUNT_KINDS),
            Account.archived.is_(False),
        )
        .all()
    ]
    if not account_ids:
        return 0

    opening = (
        db.query(func.coalesce(func.sum(Account.opening_balance_cents), 0))
        .filter(Account.user_id == user_id, Account.id.in_(account_ids))
        .scalar()
    )
    movements = (
        db.query(func.coalesce(func.sum(Transaction.amount_cents), 0))
        .filter(Transaction.user_id == user_id, Transaction.account_id.in_(account_ids))
        .scalar()
    )
    return int(opening) + int(movements)
