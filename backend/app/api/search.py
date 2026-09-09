"""One box that reaches the whole ledger.

Read-only, and filtered on `user_id` at every single query -- this route can
see more of a household's data at once than any other, which is exactly why it
gets no exception to the isolation rule.

It answers with GROUPS rather than one ranked list. A category named "Loisirs"
and a transaction labelled "LOISIRS" are not competing for the same slot: the
reader knows which of the two they were after, and a mixed list would make them
read both to find out. Every group is returned even when empty, so the screen
can say what it looked in rather than showing a blank.
"""

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.db import get_db
from app.engines.search import QueryTerms, like_pattern, parse_query
from app.importers.dedup import normalize_label
from app.models import (
    Account,
    Category,
    Debt,
    DeclaredRecurrence,
    Goal,
    Transaction,
    User,
)
from app.schemas.search import SearchGroup, SearchHit, SearchResults
from app.security.deps import get_current_user

router = APIRouter(prefix="/search", tags=["search"])

# The order the groups are read in: what the household looks at daily first,
# what they set up once last.
GROUP_LABELS: list[tuple[str, str]] = [
    ("transaction", "Transactions"),
    ("account", "Comptes"),
    ("category", "Catégories"),
    ("recurrence", "Récurrences"),
    ("goal", "Objectifs"),
    ("debt", "Dettes"),
]


def _transactions(db: Session, user: User, terms: QueryTerms, limit: int) -> list[SearchHit]:
    clauses = [Transaction.label_raw.ilike(like_pattern(terms.text), escape="\\")]
    normalized = normalize_label(terms.text)
    if normalized:
        clauses.append(Transaction.label_clean.contains(normalized))
    if terms.amount_cents is not None:
        clauses.append(func.abs(Transaction.amount_cents) == terms.amount_cents)
    if terms.on_date is not None:
        clauses.append(Transaction.date == terms.on_date)

    rows = (
        db.query(Transaction)
        .filter(Transaction.user_id == user.id, or_(*clauses))
        .order_by(Transaction.date.desc(), Transaction.id.desc())
        .limit(limit)
        .all()
    )
    names = {
        row[0]: row[1]
        for row in db.query(Category.id, Category.name)
        .filter(Category.user_id == user.id).all()
    }
    return [
        SearchHit(
            kind="transaction", id=row.id, label=row.label_raw,
            detail=names.get(row.category_id) if row.category_id else None,
            amount_cents=row.amount_cents, date=row.date.isoformat(),
            # There is no screen for a single transaction, so the hit leads to
            # the list. The screen it lands on seeds its own search box from
            # the query, which is what puts this row at the top of it.
            route="/transactions",
        )
        for row in rows
    ]


def _accounts(db: Session, user: User, terms: QueryTerms, limit: int) -> list[SearchHit]:
    rows = (
        db.query(Account)
        .filter(
            Account.user_id == user.id,
            Account.name.ilike(like_pattern(terms.text), escape="\\"),
        )
        .order_by(Account.name)
        .limit(limit)
        .all()
    )
    return [
        # `detail` names the figure beside it. A bare amount under a search hit
        # would be a number claiming to be a measurement without saying which:
        # this one is the opening balance, not the balance.
        SearchHit(kind="account", id=row.id, label=row.name,
                  detail="Solde d'ouverture",
                  amount_cents=row.opening_balance_cents, route="/reglages")
        for row in rows
    ]


def _categories(db: Session, user: User, terms: QueryTerms, limit: int) -> list[SearchHit]:
    rows = (
        db.query(Category)
        .filter(
            Category.user_id == user.id,
            Category.name.ilike(like_pattern(terms.text), escape="\\"),
        )
        .order_by(Category.name)
        .limit(limit)
        .all()
    )
    parents = {
        row[0]: row[1]
        for row in db.query(Category.id, Category.name)
        .filter(Category.user_id == user.id).all()
    }
    return [
        SearchHit(
            kind="category", id=row.id, label=row.name,
            # The parent, which is what places a category. Deliberately no
            # figure: a category's monthly budget is a different question, it
            # has its own screen, and printing it here unlabelled would read as
            # "this is what you spent".
            detail=parents.get(row.parent_id) if row.parent_id else None,
            route="/categories",
        )
        for row in rows
    ]


def _recurrences(db: Session, user: User, terms: QueryTerms, limit: int) -> list[SearchHit]:
    clauses = [DeclaredRecurrence.label.ilike(like_pattern(terms.text), escape="\\")]
    if terms.amount_cents is not None:
        clauses.append(func.abs(DeclaredRecurrence.amount_cents) == terms.amount_cents)
    rows = (
        db.query(DeclaredRecurrence)
        .filter(DeclaredRecurrence.user_id == user.id, or_(*clauses))
        .order_by(DeclaredRecurrence.label)
        .limit(limit)
        .all()
    )
    return [
        SearchHit(kind="recurrence", id=row.id, label=row.label,
                  detail="Montant déclaré",
                  amount_cents=row.amount_cents, route="/recurrences")
        for row in rows
    ]


def _goals(db: Session, user: User, terms: QueryTerms, limit: int) -> list[SearchHit]:
    clauses = [Goal.name.ilike(like_pattern(terms.text), escape="\\")]
    if terms.amount_cents is not None:
        clauses.append(Goal.target_cents == terms.amount_cents)
    rows = (
        db.query(Goal)
        .filter(Goal.user_id == user.id, or_(*clauses))
        .order_by(Goal.priority, Goal.name)
        .limit(limit)
        .all()
    )
    return [
        SearchHit(kind="goal", id=row.id, label=row.name,
                  detail="Objectif",
                  amount_cents=row.target_cents,
                  date=row.due_on.isoformat() if row.due_on else None,
                  route="/objectifs")
        for row in rows
    ]


def _debts(db: Session, user: User, terms: QueryTerms, limit: int) -> list[SearchHit]:
    clauses = [Debt.name.ilike(like_pattern(terms.text), escape="\\")]
    if terms.amount_cents is not None:
        clauses.append(Debt.principal_cents == terms.amount_cents)
    rows = (
        db.query(Debt)
        .filter(Debt.user_id == user.id, or_(*clauses))
        .order_by(Debt.name)
        .limit(limit)
        .all()
    )
    return [
        SearchHit(kind="debt", id=row.id, label=row.name,
                  detail="Capital restant dû",
                  amount_cents=row.principal_cents, route="/dettes")
        for row in rows
    ]


_FINDERS = {
    "transaction": _transactions,
    "account": _accounts,
    "category": _categories,
    "recurrence": _recurrences,
    "goal": _goals,
    "debt": _debts,
}


@router.get("", response_model=SearchResults)
def search_everything(
    q: str = Query(default=""),
    limit: int = Query(default=5, ge=1, le=25),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> SearchResults:
    terms = parse_query(q)
    # An empty box is not an error, and not a match-everything either. The
    # groups come back declared and empty, and the database is never touched.
    if not terms.text:
        return SearchResults(
            query="",
            groups=[SearchGroup(kind=kind, label=label, items=[])
                    for kind, label in GROUP_LABELS],
        )
    return SearchResults(
        query=terms.text,
        groups=[
            SearchGroup(kind=kind, label=label,
                        items=_FINDERS[kind](db, user, terms, limit))
            for kind, label in GROUP_LABELS
        ],
    )
