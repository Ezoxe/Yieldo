from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.history import user_history
from app.categorization.learning import apply_learned_rule, learn_from_correction
from app.db import get_db
from app.importers.dedup import normalize_label
from app.models import Category, Transaction, User
from app.schemas.transactions import (
    TransactionOut,
    TransactionPage,
    TransactionPatch,
    TransactionPatchOut,
)
from app.security.deps import get_current_user

router = APIRouter(prefix="/transactions", tags=["transactions"])


def _owned_transaction(db: Session, user: User, transaction_id: int) -> Transaction:
    transaction = (
        db.query(Transaction)
        .filter(Transaction.id == transaction_id, Transaction.user_id == user.id)
        .first()
    )
    if transaction is None:
        raise HTTPException(status_code=404, detail="Transaction introuvable")
    return transaction


@router.get("", response_model=TransactionPage)
def list_transactions(
    date_from: date | None = None,
    date_to: date | None = None,
    category_id: int | None = None,
    account_id: int | None = None,
    search: str | None = None,
    uncategorized_only: bool = False,
    min_cents: int | None = None,
    max_cents: int | None = None,
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TransactionPage:
    # No default range here, deliberately: absent dates already mean the whole
    # ledger on this route, and that is what they now mean on /analytics too.
    query = db.query(Transaction).filter(Transaction.user_id == user.id)

    if date_from is not None:
        query = query.filter(Transaction.date >= date_from)
    if date_to is not None:
        query = query.filter(Transaction.date <= date_to)

    # Branched off before the other filters are applied: this is the count of
    # the period alone, which is what tells an empty list apart from a list
    # emptied by a filter.
    period_query = query
    if category_id is not None:
        query = query.filter(Transaction.category_id == category_id)
    if account_id is not None:
        query = query.filter(Transaction.account_id == account_id)
    if uncategorized_only:
        query = query.filter(Transaction.category_id.is_(None))
    if min_cents is not None:
        query = query.filter(Transaction.amount_cents >= min_cents)
    if max_cents is not None:
        query = query.filter(Transaction.amount_cents <= max_cents)
    if search:
        query = query.filter(Transaction.label_clean.contains(normalize_label(search)))

    total = query.with_entities(func.count(Transaction.id)).scalar() or 0
    period_total = period_query.with_entities(func.count(Transaction.id)).scalar() or 0
    items = (
        query.order_by(Transaction.date.desc(), Transaction.id.desc())
        .limit(limit).offset(offset).all()
    )
    return TransactionPage(
        items=items, total=total, limit=limit, offset=offset,
        period_total=period_total, history=user_history(db, user.id),
    )


@router.patch("/{transaction_id}", response_model=TransactionPatchOut)
def patch_transaction(
    transaction_id: int,
    payload: TransactionPatch,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TransactionPatchOut:
    transaction = _owned_transaction(db, user, transaction_id)
    # model_dump(exclude_unset=True) distinguishes "field not provided" from "field
    # explicitly set to null": Pydantic v2 only excludes keys that never appeared in
    # the request body, so an explicit `{"category_id": null}` still shows up here
    # with value None, while an omitted `category_id` does not appear at all.
    changes = payload.model_dump(exclude_unset=True)
    category_id_provided = "category_id" in changes
    recategorizing = category_id_provided and changes["category_id"] is not None
    clearing_category = category_id_provided and changes["category_id"] is None

    if recategorizing:
        category = (
            db.query(Category)
            .filter(Category.id == changes["category_id"], Category.user_id == user.id)
            .first()
        )
        if category is None:
            raise HTTPException(status_code=404, detail="Catégorie introuvable")
        transaction.category_id = category.id
        transaction.category_source = "manual"
    elif clearing_category:
        # An explicit null clears the category outright. There is no category left
        # to learn a rule from, so this path must never reach learn_from_correction.
        transaction.category_id = None
        transaction.category_source = "uncategorized"

    for field in ("notes", "is_transfer", "tags"):
        if field in changes:
            setattr(transaction, field, changes[field])
    db.commit()
    db.refresh(transaction)

    learned_rule_id: int | None = None
    backfilled = 0
    if recategorizing:
        rule = learn_from_correction(db, user.id, transaction, transaction.category_id)
        if rule is not None:
            learned_rule_id = rule.id
            backfilled = apply_learned_rule(db, user.id, rule, only_uncategorized=True)
            db.refresh(transaction)

    return TransactionPatchOut(
        **TransactionOut.model_validate(transaction).model_dump(),
        learned_rule_id=learned_rule_id,
        backfilled=backfilled,
    )


@router.delete("/{transaction_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_transaction(
    transaction_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    db.delete(_owned_transaction(db, user, transaction_id))
    db.commit()
