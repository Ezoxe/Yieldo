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


def test_normalize_label_keeps_short_numeric_suffixes_that_identify_a_merchant():
    # "PHARMACIE 2000" and "PHARMACIE 3000" are different, real merchants (branch
    # numbers, shop numbering) — collapsing the digits would make them collide.
    assert normalize_label("PHARMACIE 2000") == "pharmacie 2000"
    assert normalize_label("PHARMACIE 3000") == "pharmacie 3000"
    assert normalize_label("PHARMACIE 2000") != normalize_label("PHARMACIE 3000")


def test_hash_differs_for_distinct_merchants_with_short_numeric_suffix():
    assert (compute_dedup_hash(1, 2, date(2025, 3, 1), -1500, "PHARMACIE 2000")
            != compute_dedup_hash(1, 2, date(2025, 3, 1), -1500, "PHARMACIE 3000"))


def test_normalize_label_strips_long_reference_numbers():
    # A transaction reference / IBAN fragment / terminal id (6+ digits) is volatile
    # noise, not merchant identity — it must not survive re-normalization, or a
    # re-import of the same statement would compute a different hash and duplicate.
    assert normalize_label("VIR SEPA REF 123456789012 LOYER") == "vir sepa ref loyer"


def test_hash_stable_across_reimport_despite_long_reference_number():
    first_import = compute_dedup_hash(1, 2, date(2025, 3, 1), -75000,
                                       "VIR SEPA REF 123456789012 LOYER")
    second_import = compute_dedup_hash(1, 2, date(2025, 3, 1), -75000,
                                        "VIR SEPA REF 987654321098 LOYER")
    # Same purchase, bank regenerated a different reference number on re-export:
    # the hash must still match so the re-import is recognized as a duplicate.
    assert first_import == second_import


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


def test_database_allows_same_dedup_hash_for_different_users(db):
    """The unique constraint is scoped to (user_id, dedup_hash), not dedup_hash
    alone: two different users may legitimately hold the identical transaction.

    compute_dedup_hash bakes user_id into its payload, so two different users'
    hashes computed the normal way would already differ and this test would pass
    even against a broken dedup_hash-only constraint (their hashes wouldn't
    collide, so no unique-constraint violation is even attempted). To actually
    exercise the (user_id, dedup_hash) constraint, both transactions below are
    given the identical literal dedup_hash directly, bypassing compute_dedup_hash's
    own per-user salting.
    """
    first_user = User(email="a@b.c", name="A", password_hash="x")
    second_user = User(email="d@e.f", name="B", password_hash="y")
    db.add_all([first_user, second_user])
    db.commit()
    first_account = Account(user_id=first_user.id, name="Courant", kind="checking")
    second_account = Account(user_id=second_user.id, name="Courant", kind="checking")
    db.add_all([first_account, second_account])
    db.commit()

    shared_hash = "shared-dedup-hash-across-two-users"
    db.add(Transaction(
        user_id=first_user.id, account_id=first_account.id, date=date(2025, 3, 1),
        amount_cents=-4732, label_raw="CARREFOUR MARKET", label_clean="carrefour market",
        dedup_hash=shared_hash,
    ))
    db.add(Transaction(
        user_id=second_user.id, account_id=second_account.id, date=date(2025, 3, 1),
        amount_cents=-4732, label_raw="CARREFOUR MARKET", label_clean="carrefour market",
        dedup_hash=shared_hash,
    ))
    db.commit()  # must not raise — the constraint is scoped per user, not global


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
