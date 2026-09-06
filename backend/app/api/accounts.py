from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.common import LIQUID_ACCOUNT_KINDS
from app.db import get_db
from app.models import ACCOUNT_KINDS, Account, Transaction, User
from app.schemas.accounts import (
    AccountBalanceOut,
    AccountIn,
    AccountOut,
    AccountPatch,
    BalanceBreakdownOut,
    TransferAuditOut,
)
from app.security.deps import get_current_user

router = APIRouter(prefix="/accounts", tags=["accounts"])


def _owned_account(db: Session, user: User, account_id: int) -> Account:
    account = (
        db.query(Account)
        .filter(Account.id == account_id, Account.user_id == user.id)
        .first()
    )
    if account is None:
        raise HTTPException(status_code=404, detail="Compte introuvable")
    return account


@router.get("", response_model=list[AccountOut])
def list_accounts(user: User = Depends(get_current_user),
                  db: Session = Depends(get_db)) -> list[Account]:
    return (
        db.query(Account)
        .filter(Account.user_id == user.id, Account.archived.is_(False))
        .order_by(Account.id)
        .all()
    )


# Declared before "/{account_id}" so the literal segment is matched first.
@router.get("/balance", response_model=BalanceBreakdownOut)
def balance_breakdown(user: User = Depends(get_current_user),
                      db: Session = Depends(get_db)) -> BalanceBreakdownOut:
    """Where the solde comes from, account by account.

    `common.liquid_balance_cents` answers one number over every liquid account
    at once, which is the right answer to give an engine and the wrong one to
    show a household that says "je n'ai pas ça sur mes comptes". Every way that
    figure can be wrong -- a statement imported twice under two accounts, an
    opening balance typed as today's balance on top of a backfilled history, a
    savings account declared but never imported -- looks identical from the
    outside. Split into its parts it does not.

    The liquid total is asserted equal to `liquid_balance_cents` by a test:
    this route shows that balance, it does not compute a second one.
    """
    accounts = (
        db.query(Account)
        .filter(Account.user_id == user.id, Account.archived.is_(False))
        .order_by(Account.id)
        .all()
    )
    movements = dict(
        db.query(Transaction.account_id, func.coalesce(func.sum(Transaction.amount_cents), 0))
        .filter(Transaction.user_id == user.id)
        .group_by(Transaction.account_id)
        .all()
    )
    counts = dict(
        db.query(Transaction.account_id, func.count(Transaction.id))
        .filter(Transaction.user_id == user.id)
        .group_by(Transaction.account_id)
        .all()
    )

    rows: list[AccountBalanceOut] = []
    liquid_total = 0
    for account in accounts:
        moved = int(movements.get(account.id, 0))
        liquid = account.kind in LIQUID_ACCOUNT_KINDS
        balance = account.opening_balance_cents + moved
        if liquid:
            liquid_total += balance
        rows.append(AccountBalanceOut(
            id=account.id, name=account.name, kind=account.kind, liquid=liquid,
            opening_balance_cents=account.opening_balance_cents,
            movements_cents=moved,
            transaction_count=int(counts.get(account.id, 0)),
            balance_cents=balance,
        ))

    flagged = (
        db.query(Transaction.amount_cents)
        .filter(Transaction.user_id == user.id, Transaction.is_transfer.is_(True))
        .all()
    )
    received = sum(row[0] for row in flagged if row[0] > 0)
    sent = sum(row[0] for row in flagged if row[0] < 0)

    return BalanceBreakdownOut(
        accounts=rows,
        liquid_total_cents=liquid_total,
        transfers=TransferAuditOut(
            count=len(flagged), received_cents=received, sent_cents=sent,
            # The two legs of a transfer cancel; whatever is left over is a leg
            # flagged without its counterpart.
            unmatched_cents=received + sent,
        ),
    )


@router.post("", response_model=AccountOut, status_code=status.HTTP_201_CREATED)
def create_account(payload: AccountIn, user: User = Depends(get_current_user),
                   db: Session = Depends(get_db)) -> Account:
    if payload.kind not in ACCOUNT_KINDS:
        raise HTTPException(status_code=422,
                            detail=f"Type de compte inconnu : {payload.kind}")
    account = Account(user_id=user.id, **payload.model_dump())
    db.add(account)
    db.commit()
    db.refresh(account)
    return account


@router.patch("/{account_id}", response_model=AccountOut)
def patch_account(account_id: int, payload: AccountPatch,
                  user: User = Depends(get_current_user),
                  db: Session = Depends(get_db)) -> Account:
    account = _owned_account(db, user, account_id)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(account, field, value)
    db.commit()
    db.refresh(account)
    return account


@router.delete("/{account_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_account(account_id: int, user: User = Depends(get_current_user),
                   db: Session = Depends(get_db)) -> None:
    """Archiving, not deleting: transactions must never lose their account."""
    account = _owned_account(db, user, account_id)
    account.archived = True
    db.commit()
