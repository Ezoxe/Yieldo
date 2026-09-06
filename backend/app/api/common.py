"""Fetch helpers shared by every analytics-shaped router.

Two rules hold in every function here, without exception:

* every query filters on `user_id`. There is no read path without it;
* the clock is read *here*, at the route boundary, and passed into the engines
  as a parameter. No engine imports `date.today`.

The engines never see an ORM object: each helper converts rows into the frozen
dataclass its engine declares.

**This module is also the ONE place the forecast plan meets the ledger.** The
three readings a household can choose between (`app/engines/plan.LEDGER_MODES`)
are resolved by `ledger_mode` below and applied by `tx_points` -- and by
`tx_points` alone. That boundary is deliberate, and the three helpers left out
of it are the argument for it:

* `recurrence_points` stays real, always. Detecting a subscription from a
  forecast of that same subscription is circular: the plan would confirm
  itself, and "Yieldo found your Netflix" would mean "you told Yieldo about
  your Netflix";
* `anomaly_points` stays real, always. An anomaly is a transaction that
  actually happened and was unusual. A declared amount is never a surprise --
  scoring the plan against itself would report nothing, for ever;
* `liquid_balance_cents` stays real, always. A balance is a fact about an
  account, not a reading of a period. A runway computed from an estimated
  monthly spend over a real balance is a coherent figure; one computed over an
  imagined balance is not.
"""

from datetime import date

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.history import user_history
from app.engines.aggregate import TxPoint
from app.engines.anomaly import AnomalyTx
from app.engines.period import resolve_range
from app.engines.plan import (
    LedgerMode,
    RealPoint,
    as_tx_points,
    occurrences,
    unrealised,
)
from app.engines.plan import PlanLine as PlanLinePoint
from app.engines.recurrence import RecurringTx
from app.importers.dedup import normalize_label
from app.models import Account, Category, PlanLine, PlanSettings, Transaction
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


def ledger_mode(db: Session, user_id: int) -> LedgerMode:
    """Which of the three readings this household is in.

    No row means `real`, which is what every screen did before the plan
    existed: a household that has never opened the plan screen must keep
    reading the ledger it always read.
    """
    row = db.query(PlanSettings).filter(PlanSettings.user_id == user_id).first()
    return "real" if row is None else row.ledger_mode


def plan_lines(db: Session, user_id: int) -> list[PlanLinePoint]:
    """This user's whole plan, in the engine's input shape.

    Always the whole plan, never a window: `engines/plan.occurrences` needs
    every line to work out which of them fall inside the range asked about,
    and a line declared two years ago is exactly the one still producing this
    month's rent.

    `label_key` is normalised here from `match_label`, with the same function
    the importer and `recurrence_points` use -- so a line declared "Netflix"
    matches a statement saying "PRLV NETFLIX INTERNATIONAL BV" by the same
    rule everything else in the application matches labels by.
    """
    rows = db.query(PlanLine).filter(PlanLine.user_id == user_id).all()
    return [
        PlanLinePoint(
            id=row.id,
            label=row.label,
            label_key=normalize_label(row.match_label) if row.match_label else "",
            amount_cents=row.amount_cents,
            kind=row.kind,
            category_id=row.category_id,
            account_id=row.account_id,
            periodicity=row.periodicity,
            day_of_month=row.day_of_month,
            start_on=row.start_on,
            end_on=row.end_on,
            active=row.active,
        )
        for row in rows
    ]


def main_account_id(db: Session, user_id: int) -> int:
    """Where a plan line that names no account is placed.

    The household's first live current account, then any live account, then 0
    -- an id no account has, which every "group by account" reads as a bucket
    of its own rather than silently joining someone's savings.
    """
    checking = (
        db.query(Account.id)
        .filter(Account.user_id == user_id, Account.kind == "checking",
                Account.archived.is_(False))
        .order_by(Account.id)
        .first()
    )
    if checking is not None:
        return int(checking[0])
    any_account = (
        db.query(Account.id)
        .filter(Account.user_id == user_id, Account.archived.is_(False))
        .order_by(Account.id)
        .first()
    )
    return int(any_account[0]) if any_account is not None else 0


def real_points(db: Session, user_id: int) -> list[RealPoint]:
    """The whole ledger, in the shape plan realisation matches against.

    The whole ledger and not the window, on purpose: `unrealised` decides month
    by month, and a window that clipped a month in half would hide a payment
    from its own occurrence.
    """
    rows = db.query(Transaction).filter(Transaction.user_id == user_id).all()
    return [
        RealPoint(on=row.date, amount_cents=row.amount_cents,
                  label_key=normalize_label(row.label_raw), category_id=row.category_id)
        for row in rows
    ]


def tx_points(
    db: Session,
    user_id: int,
    date_from: date | None,
    date_to: date | None,
    account_id: int | None = None,
    mode: LedgerMode | None = None,
) -> list[TxPoint]:
    """This user's movements in the aggregation engine's input shape, under
    whichever of the three readings they have chosen.

    `real` is the ledger and nothing else -- byte for byte what this function
    returned before the plan existed. `estimated` is the plan and nothing else:
    the month as it was declared, with no statement in it. `blended` is the
    ledger plus the part of the plan the ledger does not already account for,
    which is the reading a household actually wants for the month in progress.

    A non-real mode needs a window to forecast into, and "no bounds" cannot
    mean "forecast for ever". An absent bound resolves through `period_range`,
    exactly as every analytics route already resolves one -- the ledger's own
    span, or today when there is no ledger at all.

    `mode` is a parameter rather than only a lookup so a caller that has
    already resolved it (a route answering several helpers, the assistant's
    tools) does not query for it again. Left None, it is read here.
    """
    resolved = ledger_mode(db, user_id) if mode is None else mode

    real: list[TxPoint] = []
    if resolved != "estimated":
        query = db.query(Transaction).filter(Transaction.user_id == user_id)
        if date_from is not None:
            query = query.filter(Transaction.date >= date_from)
        if date_to is not None:
            query = query.filter(Transaction.date <= date_to)
        if account_id is not None:
            query = query.filter(Transaction.account_id == account_id)
        real = [
            TxPoint(on=t.date, amount_cents=t.amount_cents, category_id=t.category_id,
                    account_id=t.account_id, is_transfer=t.is_transfer)
            for t in query.all()
        ]

    if resolved == "real":
        return real

    start, end, _ = period_range(db, user_id, date_from, date_to)
    lines = plan_lines(db, user_id)
    produced = (
        occurrences(lines, start, end)
        if resolved == "estimated"
        else unrealised(lines, real_points(db, user_id), start, end)
    )
    planned = as_tx_points(produced, main_account_id(db, user_id))
    if account_id is not None:
        planned = [point for point in planned if point.account_id == account_id]

    return sorted(real + planned, key=lambda point: point.on)


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


def budget_owner(
    categories: list[Category], budgeted_ids: set[int]
) -> dict[int, int | None]:
    """Which budget line each category's spending belongs to.

    Itself if it carries a budget, else its nearest ancestor that does, else
    `None` -- nothing budgeted covers it, and it belongs in the "hors budget"
    list rather than inside somebody else's envelope.

    A budget on a parent has to count what its children spent. The seeded tree
    files every expense on a CHILD -- "Courses", "Carburant", "Énergie" --
    while the natural place to set a budget is the parent, so reading a
    parent's own rows alone showed "42,00 € de budget, 0,00 € dépensé" to a
    household that had spent 341 € on groceries that month, and no budget alert
    could ever fire.

    The NEAREST ancestor, never every ancestor: a child with its own budget
    belongs in its own line and not also in its parent's, or the same euro sits
    in two lines and the screen's totals stop adding up to what was spent.

    Shared by `api/budgets.py` and `api/alerts.py` rather than written twice: a
    budget crossed on the screen must be the same budget the alert fires on,
    and two copies of this walk would eventually disagree.

    Bounded by the number of categories rather than by trusting the tree to be
    acyclic, for the same reason `transfers._root` is: a hang is a worse answer
    than an arbitrary one.
    """
    parents = {category.id: category.parent_id for category in categories}
    owner: dict[int, int | None] = {}
    for category_id in parents:
        seen: set[int] = set()
        current: int | None = category_id
        while current is not None and current not in seen:
            if current in budgeted_ids:
                break
            seen.add(current)
            current = parents.get(current)
        owner[category_id] = current if current in budgeted_ids else None
    return owner


def rolled_budget_spend(
    spent_by_category: dict[int | None, int],
    categories: list[Category],
    budgeted_ids: set[int],
) -> dict[int, int]:
    """Each budgeted category's spend, its descendants' included."""
    owner = budget_owner(categories, budgeted_ids)
    rolled = {category_id: 0 for category_id in budgeted_ids}
    for category_id, total_cents in spent_by_category.items():
        target = owner.get(category_id) if category_id is not None else None
        if target is not None:
            rolled[target] += total_cents
    return rolled
