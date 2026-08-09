from app.categorization.seed import seed_categories
from app.models import Category, User


def test_seed_creates_french_tree_scoped_to_user(db):
    user = User(email="a@b.c", name="A", password_hash="x")
    db.add(user)
    db.commit()

    index = seed_categories(db, user.id)

    assert "alimentation" in index
    assert "alimentation-courses" in index
    assert index["alimentation-courses"].parent_id == index["alimentation"].id
    assert index["revenus-salaire"].kind == "income"
    assert index["virement-interne"].kind == "transfer"
    assert all(c.user_id == user.id for c in db.query(Category).all())


def test_seed_is_idempotent(db):
    user = User(email="a@b.c", name="A", password_hash="x")
    db.add(user)
    db.commit()

    seed_categories(db, user.id)
    count_after_first = db.query(Category).count()
    seed_categories(db, user.id)

    assert db.query(Category).count() == count_after_first
