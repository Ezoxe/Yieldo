"""The one-off events a household knows are coming. Avenir projects them."""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Account, Category, PlannedEvent, User
from app.schemas.planned_events import (
    ZERO_AMOUNT,
    PlannedEventIn,
    PlannedEventOut,
    PlannedEventPatch,
)
from app.security.deps import get_current_user

router = APIRouter(prefix="/planned-events", tags=["avenir"])


def _owned(db: Session, user: User, event_id: int) -> PlannedEvent:
    event = (
        db.query(PlannedEvent)
        .filter(PlannedEvent.id == event_id, PlannedEvent.user_id == user.id)
        .first()
    )
    if event is None:
        raise HTTPException(status_code=404, detail="Événement introuvable")
    return event


def _check_references(db: Session, user: User, account_id: int | None,
                      category_id: int | None) -> None:
    """An account or a category of this household, or none: another
    household's id is not found, never quoted."""
    if account_id is not None and db.query(Account).filter(
            Account.id == account_id, Account.user_id == user.id).first() is None:
        raise HTTPException(status_code=404, detail="Compte introuvable")
    if category_id is not None and db.query(Category).filter(
            Category.id == category_id, Category.user_id == user.id).first() is None:
        raise HTTPException(status_code=404, detail="Catégorie introuvable")


@router.get("", response_model=list[PlannedEventOut])
def list_planned_events(
    user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> list[PlannedEvent]:
    return (
        db.query(PlannedEvent)
        .filter(PlannedEvent.user_id == user.id)
        .order_by(PlannedEvent.due_on, PlannedEvent.id)
        .all()
    )


@router.post("", response_model=PlannedEventOut, status_code=status.HTTP_201_CREATED)
def create_planned_event(
    payload: PlannedEventIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PlannedEvent:
    if payload.amount_cents == 0:
        raise HTTPException(status_code=422, detail=ZERO_AMOUNT)
    _check_references(db, user, payload.account_id, payload.category_id)
    event = PlannedEvent(user_id=user.id, **payload.model_dump())
    db.add(event)
    db.commit()
    db.refresh(event)
    return event


@router.patch("/{event_id}", response_model=PlannedEventOut)
def patch_planned_event(
    event_id: int,
    payload: PlannedEventPatch,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PlannedEvent:
    event = _owned(db, user, event_id)
    changes = payload.model_dump(exclude_unset=True)
    if changes.get("amount_cents") == 0:
        raise HTTPException(status_code=422, detail=ZERO_AMOUNT)
    _check_references(db, user, changes.get("account_id"), changes.get("category_id"))
    for field, value in changes.items():
        setattr(event, field, value)
    db.commit()
    db.refresh(event)
    return event


@router.delete("/{event_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_planned_event(
    event_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    db.delete(_owned(db, user, event_id))
    db.commit()
