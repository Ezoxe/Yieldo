from datetime import date

import pytest
from sqlalchemy.exc import IntegrityError

from app.categorization.seed import ESSENTIAL_SLUGS, seed_categories
from app.models import Category, PriceIndexPoint, User
from app.security.passwords import hash_password


def _user(db, email: str = "e@example.com") -> User:
    user = User(email=email, name="T", password_hash=hash_password("motdepasse123"),
                role="user", is_active=True)
    db.add(user)
    db.flush()
    return user


def test_a_fresh_category_is_not_essential_until_it_is_said_to_be(db):
    user = _user(db)
    category = Category(user_id=user.id, name="Loisirs", slug="loisirs", kind="expense")
    db.add(category)
    db.commit()
    assert category.is_essential is False


def test_the_seed_marks_the_french_household_necessities_essential(db):
    user = _user(db)
    seed_categories(db, user.id)
    db.commit()

    by_slug = {c.slug: c for c in db.query(Category).filter(Category.user_id == user.id)}
    assert by_slug["logement-loyer"].is_essential is True
    assert by_slug["alimentation-courses"].is_essential is True
    assert by_slug["sante-pharmacie"].is_essential is True
    # Not essential: what a household cuts first when income stops.
    assert by_slug["loisirs-vacances"].is_essential is False
    assert by_slug["abonnements-streaming"].is_essential is False
    assert by_slug["alimentation-restaurant"].is_essential is False


def test_every_essential_slug_exists_in_the_seed_tree(db):
    """A typo in ESSENTIAL_SLUGS would silently mark nothing and quietly halve
    the reduced-spending runway."""
    user = _user(db)
    seed_categories(db, user.id)
    db.commit()
    known = {c.slug for c in db.query(Category).filter(Category.user_id == user.id)}
    assert ESSENTIAL_SLUGS <= known


def test_a_price_index_point_is_unique_per_user_and_month(db):
    user = _user(db)
    db.add(PriceIndexPoint(user_id=user.id, month=date(2025, 1, 1), value_hundredths=11842))
    db.commit()
    db.add(PriceIndexPoint(user_id=user.id, month=date(2025, 1, 1), value_hundredths=11900))
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()


def test_two_users_may_hold_the_same_month(db):
    first = _user(db, "a@example.com")
    second = _user(db, "b@example.com")
    db.add(PriceIndexPoint(user_id=first.id, month=date(2025, 1, 1), value_hundredths=11842))
    db.add(PriceIndexPoint(user_id=second.id, month=date(2025, 1, 1), value_hundredths=11842))
    db.commit()
    assert db.query(PriceIndexPoint).count() == 2


def test_the_categories_api_round_trips_is_essential(client, imported):
    headers, _ = imported
    categories = client.get("/api/categories", headers=headers).json()
    target = next(c for c in categories if c["slug"] == "loisirs-vacances")
    assert target["is_essential"] is False

    patched = client.patch(f"/api/categories/{target['id']}", headers=headers,
                           json={"is_essential": True}).json()
    assert patched["is_essential"] is True
