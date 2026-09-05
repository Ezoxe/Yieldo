from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.history import user_history
from app.categorization.engine import classify, compile_rules
from app.categorization.learning import apply_learned_rule, learn_from_correction
from app.db import get_db
from app.importers.dedup import compute_dedup_hash, normalize_label
from app.models import Account, Category, CategoryRule, Transaction, User
from app.schemas.transactions import (
    TransactionIn,
    TransactionOut,
    TransactionPage,
    TransactionPatch,
    TransactionPatchOut,
)
from app.security.deps import get_current_user

router = APIRouter(prefix="/transactions", tags=["transactions"])


def _owned_category(db: Session, user: User, category_id: int) -> Category:
    category = (
        db.query(Category)
        .filter(Category.id == category_id, Category.user_id == user.id)
        .first()
    )
    if category is None:
        raise HTTPException(status_code=404, detail="Catégorie introuvable")
    return category


def _owned_account(db: Session, user: User, account_id: int) -> Account:
    account = (
        db.query(Account)
        .filter(Account.id == account_id, Account.user_id == user.id)
        .first()
    )
    if account is None:
        raise HTTPException(status_code=404, detail="Compte introuvable")
    return account


def _free_fingerprint(
    db: Session, user_id: int, base: str, exclude_id: int | None = None
) -> str:
    """A fingerprint no row of this user already holds.

    Two identical purchases on the same day are two purchases -- the same
    coffee bought twice in an afternoon, two identical bus tickets -- and the
    unique `(user_id, dedup_hash)` constraint would reject the second. The
    ":n" suffix convention is `importers/service.py`'s, reused rather than
    reinvented: a real fingerprint is a bare sha256 digest and never contains
    ':', so a suffixed value can never collide with one computed later from a
    statement row.
    """
    query = db.query(Transaction.dedup_hash).filter(
        Transaction.user_id == user_id, Transaction.dedup_hash.startswith(base)
    )
    # `exclude_id` is what makes this reusable for an edit: a row being
    # re-fingerprinted is not a duplicate of itself, and without this a PATCH
    # that changed nothing about the row's identity would still push its
    # fingerprint to ":1", then ":2", once per save.
    if exclude_id is not None:
        query = query.filter(Transaction.id != exclude_id)
    taken = {row[0] for row in query.all()}
    if base not in taken:
        return base
    suffix = 1
    while f"{base}:{suffix}" in taken:
        suffix += 1
    return f"{base}:{suffix}"


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


@router.post("", response_model=TransactionOut, status_code=status.HTTP_201_CREATED)
def create_transaction(
    payload: TransactionIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Transaction:
    """One operation typed in by hand: cash, a purchase made before the
    statement arrives, a reimbursement between two people.

    The row is identical to an imported one in every respect but its origin --
    same table, same categorisation, same dedup fingerprint -- except that it
    carries no `import_batch_id`, which is exactly what `Transaction.manual`
    reports. Nothing here is a second kind of transaction: the ledger has one
    kind, with two ways in.

    A category left out is NOT a category refused. The household's own rules
    are run over the label, exactly as the importer runs them, so a hand-typed
    "NETFLIX.COM" lands in the same place as the imported one. Only when no
    rule matches does the line stay uncategorised.
    """
    account = _owned_account(db, user, payload.account_id)

    label_clean = normalize_label(payload.label_raw)

    if payload.category_id is not None:
        category_id = _owned_category(db, user, payload.category_id).id
        source = "manual"
    else:
        rules = db.query(CategoryRule).filter(CategoryRule.user_id == user.id).all()
        match = classify(label_clean, payload.amount_cents, compile_rules(rules))
        category_id = None if match is None else match.category_id
        source = "uncategorized" if match is None else match.source

    fingerprint = _free_fingerprint(db, user.id, compute_dedup_hash(
        user.id, account.id, payload.date, payload.amount_cents, payload.label_raw,
    ))

    transaction = Transaction(
        user_id=user.id,
        account_id=account.id,
        date=payload.date,
        value_date=payload.value_date,
        amount_cents=payload.amount_cents,
        label_raw=payload.label_raw,
        label_clean=label_clean,
        category_id=category_id,
        category_source=source,
        is_transfer=payload.is_transfer,
        import_batch_id=None,
        dedup_hash=fingerprint,
        notes=payload.notes,
        tags=payload.tags,
    )
    db.add(transaction)
    db.commit()
    db.refresh(transaction)
    return transaction


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
        transaction.category_id = _owned_category(db, user, changes["category_id"]).id
        transaction.category_source = "manual"
    elif clearing_category:
        # An explicit null clears the category outright. There is no category left
        # to learn a rule from, so this path must never reach learn_from_correction.
        transaction.category_id = None
        transaction.category_source = "uncategorized"

    # The row's own identity -- who it belongs to, when it happened, how much,
    # and what it says. Editable because a ledger line can be wrong in ways no
    # recategorisation reaches, and editable on an imported row too: the fix
    # belongs where the reader saw the mistake, not behind a re-import.
    if "account_id" in changes:
        transaction.account_id = _owned_account(db, user, changes["account_id"]).id
    for field in ("date", "value_date", "amount_cents"):
        if field in changes:
            setattr(transaction, field, changes[field])
    if "label_raw" in changes:
        transaction.label_raw = changes["label_raw"]
        # Derived, never sent: search filters on label_clean, and leaving it
        # behind would keep matching a label the row no longer carries.
        transaction.label_clean = normalize_label(changes["label_raw"])

    for field in ("notes", "is_transfer", "tags"):
        if field in changes:
            setattr(transaction, field, changes[field])

    # The fingerprint is computed from exactly those four fields, so once any
    # of them moves the stored hash describes a transaction that no longer
    # exists -- and a later import of the same statement line would no longer
    # recognise it as already present.
    if any(field in changes for field in ("account_id", "date", "amount_cents", "label_raw")):
        transaction.dedup_hash = _free_fingerprint(
            db,
            user.id,
            compute_dedup_hash(
                user.id,
                transaction.account_id,
                transaction.date,
                transaction.amount_cents,
                transaction.label_raw,
            ),
            exclude_id=transaction.id,
        )

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
