import re
import unicodedata

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import CATEGORY_KINDS, Category, Transaction, User
from app.schemas.transactions import CategoryIn, CategoryOut, CategoryPatch
from app.security.deps import get_current_user

router = APIRouter(prefix="/categories", tags=["categories"])


def _slugify(name: str) -> str:
    text = unicodedata.normalize("NFKD", name)
    text = "".join(ch for ch in text if not unicodedata.combining(ch)).lower()
    return re.sub(r"[^a-z0-9]+", "-", text).strip("-")


def _owned_category(db: Session, user: User, category_id: int) -> Category:
    category = (
        db.query(Category)
        .filter(Category.id == category_id, Category.user_id == user.id)
        .first()
    )
    if category is None:
        raise HTTPException(status_code=404, detail="Catégorie introuvable")
    return category


@router.get("", response_model=list[CategoryOut])
def list_categories(
    user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> list[Category]:
    return (
        db.query(Category)
        .filter(Category.user_id == user.id)
        .order_by(Category.parent_id.nulls_first(), Category.position, Category.name)
        .all()
    )


@router.post("", response_model=CategoryOut, status_code=status.HTTP_201_CREATED)
def create_category(
    payload: CategoryIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> Category:
    if payload.kind not in CATEGORY_KINDS:
        raise HTTPException(status_code=422, detail=f"Type inconnu : {payload.kind}")
    if payload.parent_id is not None:
        parent = _owned_category(db, user, payload.parent_id)
        if parent.parent_id is not None:
            raise HTTPException(status_code=422,
                                detail="La hiérarchie est limitée à deux niveaux")

    slug = _slugify(payload.name)
    if db.query(Category).filter(Category.user_id == user.id,
                                 Category.slug == slug).first() is not None:
        raise HTTPException(status_code=409, detail="Une catégorie porte déjà ce nom")

    category = Category(user_id=user.id, slug=slug, **payload.model_dump())
    db.add(category)
    db.commit()
    db.refresh(category)
    return category


@router.patch("/{category_id}", response_model=CategoryOut)
def patch_category(
    category_id: int,
    payload: CategoryPatch,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Category:
    category = _owned_category(db, user, category_id)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(category, field, value)
    db.commit()
    db.refresh(category)
    return category


@router.delete("/{category_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_category(
    category_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> None:
    """Transactions are never deleted with their category -- they become uncategorized.

    Deleting a parent cascades to its children, so the transactions filed under
    those children have to be uncategorized too. Leaving them to the database's
    ON DELETE SET NULL would null category_id while leaving category_source saying
    "manual" -- a row claiming a hand-picked category it no longer has.
    """
    category = _owned_category(db, user, category_id)

    doomed = [category.id] + [
        child.id
        for child in db.query(Category)
        .filter(Category.user_id == user.id, Category.parent_id == category.id)
        .all()
    ]
    (
        db.query(Transaction)
        .filter(Transaction.user_id == user.id, Transaction.category_id.in_(doomed))
        .update({"category_id": None, "category_source": "uncategorized"},
                synchronize_session=False)
    )
    db.delete(category)
    db.commit()
