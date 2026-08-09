from datetime import date

import pytest
from sqlalchemy.exc import IntegrityError

from app.models import Account, Category, Transaction, User


def test_user_email_is_unique_case_insensitively(db):
    db.add(User(email="max@example.com", name="Max", password_hash="x"))
    db.commit()
    db.add(User(email="MAX@EXAMPLE.COM", name="Autre", password_hash="y"))
    with pytest.raises(IntegrityError):
        db.commit()


def test_user_defaults_to_non_admin_active(db):
    user = User(email="a@b.c", name="A", password_hash="x")
    db.add(user)
    db.commit()
    assert user.role == "user"
    assert user.is_active is True
    assert user.created_at is not None


def test_account_belongs_to_user_and_defaults_to_euro(db):
    user = User(email="a@b.c", name="A", password_hash="x")
    db.add(user)
    db.commit()
    account = Account(user_id=user.id, name="Compte courant", kind="checking")
    db.add(account)
    db.commit()
    assert account.currency == "EUR"
    assert account.opening_balance_cents == 0
    assert account.include_in_net_worth is True


def test_category_supports_two_level_hierarchy(db):
    user = User(email="a@b.c", name="A", password_hash="x")
    db.add(user)
    db.commit()
    parent = Category(user_id=user.id, name="Logement", slug="logement", kind="expense")
    db.add(parent)
    db.commit()
    child = Category(user_id=user.id, parent_id=parent.id, name="Loyer",
                     slug="logement-loyer", kind="expense")
    db.add(child)
    db.commit()
    db.refresh(parent)
    assert [c.name for c in parent.children] == ["Loyer"]
    assert child.parent.name == "Logement"


def test_category_slug_is_unique_per_user_not_globally(db):
    first = User(email="a@b.c", name="A", password_hash="x")
    second = User(email="d@e.f", name="B", password_hash="y")
    db.add_all([first, second])
    db.commit()
    db.add(Category(user_id=first.id, name="Loyer", slug="loyer", kind="expense"))
    db.add(Category(user_id=second.id, name="Loyer", slug="loyer", kind="expense"))
    db.commit()  # must not raise — slugs are scoped to a user


def test_account_transactions_relationship_is_bidirectional(db):
    """Guards against a regression of the Account.transactions relationship.

    Task 4 originally omitted this relationship because Transaction did not exist
    yet — a string-based relationship to an undefined class breaks configure_mappers()
    for every test. Task 6 restored it; this test ensures it cannot silently disappear
    again.
    """
    user = User(email="a@b.c", name="A", password_hash="x")
    db.add(user)
    db.commit()
    account = Account(user_id=user.id, name="Courant", kind="checking")
    db.add(account)
    db.commit()
    transaction = Transaction(user_id=user.id, account_id=account.id, date=date(2025, 1, 1),
                              amount_cents=-100, label_raw="X", label_clean="x",
                              dedup_hash="abc")
    db.add(transaction)
    db.commit()
    db.refresh(account)
    assert account.transactions == [transaction]
    assert transaction.account is account
