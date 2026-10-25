"""/api/rules -- the household's own categorisation rules.

Until now a rule was written only by learning (`categorization/learning.py`)
or by applying an agent proposal. This router lets the household -- and the
connector on its behalf -- write one directly.

A `builtin` row is never edited here. The library is copied into each account
and kept current by data migrations that rewrite `origin = 'builtin'` rows
(see CLAUDE.md, "Database and migrations"); a household's edit to one of them
would be silently overwritten by the next one. A rule of its own outranks the
library anyway (`RULE_PRIORITIES`).
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import RULE_PRIORITIES, Category, CategoryRule, User
from app.schemas.rules import RuleIn, RuleOut, RulePatch
from app.security.deps import get_current_user

router = APIRouter(prefix="/rules", tags=["rules"])

_BUILTIN_REFUSAL = (
    "Une règle intégrée ne se modifie pas : créez la vôtre, elle passe avant."
)


def _out(rule: CategoryRule, category: Category) -> RuleOut:
    return RuleOut(
        id=rule.id, pattern=rule.pattern, category_id=rule.category_id,
        category_name=category.name, origin=rule.origin, direction=rule.direction,
        priority=rule.priority, hit_count=rule.hit_count,
    )


def _owned_category(db: Session, user: User, category_id: int) -> Category:
    category = (
        db.query(Category)
        .filter(Category.id == category_id, Category.user_id == user.id)
        .first()
    )
    if category is None:
        raise HTTPException(status_code=404, detail="Catégorie introuvable")
    return category


def _owned_rule(db: Session, user: User, rule_id: int) -> CategoryRule:
    rule = (
        db.query(CategoryRule)
        .filter(CategoryRule.id == rule_id, CategoryRule.user_id == user.id)
        .first()
    )
    if rule is None:
        raise HTTPException(status_code=404, detail="Règle introuvable")
    if rule.origin == "builtin":
        raise HTTPException(status_code=409, detail=_BUILTIN_REFUSAL)
    return rule


def _refuse_duplicate(
    db: Session, user: User, pattern: str, category_id: int, except_id: int | None = None
) -> None:
    query = db.query(CategoryRule).filter(
        CategoryRule.user_id == user.id,
        CategoryRule.pattern == pattern,
        CategoryRule.category_id == category_id,
    )
    if except_id is not None:
        query = query.filter(CategoryRule.id != except_id)
    if query.first() is not None:
        raise HTTPException(
            status_code=409, detail=f"La règle « {pattern} » envoie déjà vers cette catégorie."
        )


@router.get("", response_model=list[RuleOut])
def list_rules(
    user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> list[RuleOut]:
    rows = (
        db.query(CategoryRule, Category)
        .join(Category, Category.id == CategoryRule.category_id)
        .filter(CategoryRule.user_id == user.id)
        .order_by(CategoryRule.priority.desc(), CategoryRule.pattern)
        .all()
    )
    return [_out(rule, category) for rule, category in rows]


@router.post("", response_model=RuleOut, status_code=status.HTTP_201_CREATED)
def create_rule(
    payload: RuleIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> RuleOut:
    category = _owned_category(db, user, payload.category_id)
    _refuse_duplicate(db, user, payload.pattern, category.id)
    rule = CategoryRule(
        user_id=user.id, pattern=payload.pattern, is_regex=False, category_id=category.id,
        priority=RULE_PRIORITIES["manual"], origin="manual", direction=payload.direction,
    )
    db.add(rule)
    db.commit()
    db.refresh(rule)
    return _out(rule, category)


@router.patch("/{rule_id}", response_model=RuleOut)
def patch_rule(
    rule_id: int,
    payload: RulePatch,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> RuleOut:
    rule = _owned_rule(db, user, rule_id)
    changes = payload.model_dump(exclude_unset=True)
    category = _owned_category(db, user, changes.get("category_id", rule.category_id))
    _refuse_duplicate(db, user, changes.get("pattern", rule.pattern), category.id, rule.id)
    for field, value in changes.items():
        setattr(rule, field, value)
    db.commit()
    db.refresh(rule)
    return _out(rule, category)


@router.delete("/{rule_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_rule(
    rule_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> None:
    db.delete(_owned_rule(db, user, rule_id))
    db.commit()
