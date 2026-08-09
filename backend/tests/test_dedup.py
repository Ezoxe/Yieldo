from datetime import date

import pytest
from sqlalchemy.exc import IntegrityError

from app.importers.dedup import compute_dedup_hash, normalize_label
from app.models import Account, Transaction, User


def test_normalize_label_lowercases_and_collapses_whitespace():
    assert normalize_label("  CARREFOUR   MARKET  ") == "carrefour market"


def test_normalize_label_strips_punctuation_and_card_sequence_numbers():
    assert normalize_label("CB*CARREFOUR MARKET 12/03 CARTE 4589") == "cb carrefour market"
    assert normalize_label("PAIEMENT CB 03/01 AMAZON.FR") == "paiement cb amazon fr"


def test_normalize_label_is_accent_insensitive():
    assert normalize_label("PÉAGE VINCI") == normalize_label("PEAGE VINCI")


def test_same_transaction_produces_same_hash():
    args = (1, 2, date(2025, 3, 1), -4732, "CARREFOUR MARKET")
    assert compute_dedup_hash(*args) == compute_dedup_hash(*args)


def test_hash_differs_when_any_component_differs():
    base = compute_dedup_hash(1, 2, date(2025, 3, 1), -4732, "CARREFOUR")
    assert base != compute_dedup_hash(2, 2, date(2025, 3, 1), -4732, "CARREFOUR")
    assert base != compute_dedup_hash(1, 3, date(2025, 3, 1), -4732, "CARREFOUR")
    assert base != compute_dedup_hash(1, 2, date(2025, 3, 2), -4732, "CARREFOUR")
    assert base != compute_dedup_hash(1, 2, date(2025, 3, 1), -4733, "CARREFOUR")
    assert base != compute_dedup_hash(1, 2, date(2025, 3, 1), -4732, "MONOPRIX")


def test_hash_ignores_label_formatting_noise():
    assert (compute_dedup_hash(1, 2, date(2025, 3, 1), -4732, "CARREFOUR  MARKET")
            == compute_dedup_hash(1, 2, date(2025, 3, 1), -4732, "carrefour market"))


def test_database_rejects_duplicate_hash_for_same_user(db):
    user = User(email="a@b.c", name="A", password_hash="x")
    db.add(user)
    db.commit()
    account = Account(user_id=user.id, name="Courant", kind="checking")
    db.add(account)
    db.commit()

    def make() -> Transaction:
        return Transaction(
            user_id=user.id, account_id=account.id, date=date(2025, 3, 1),
            amount_cents=-4732, label_raw="CARREFOUR MARKET",
            label_clean="carrefour market",
            dedup_hash=compute_dedup_hash(user.id, account.id, date(2025, 3, 1),
                                          -4732, "CARREFOUR MARKET"),
        )

    db.add(make())
    db.commit()
    db.add(make())
    with pytest.raises(IntegrityError):
        db.commit()


def test_transaction_defaults(db):
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
    assert transaction.category_source == "uncategorized"
    assert transaction.is_transfer is False
    assert transaction.is_recurring is False
    assert transaction.tags == []
