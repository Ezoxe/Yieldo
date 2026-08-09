from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import ACCOUNT_KINDS, Account, User
from app.schemas.accounts import AccountIn, AccountOut, AccountPatch
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
