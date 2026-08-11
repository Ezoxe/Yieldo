from pathlib import Path

import pytest

from app.categorization.seed import seed_categories, seed_rules
from app.importers.dialect import detect_dialect
from app.importers.mapping import suggest_mapping
from app.importers.service import (
    UnknownCategoryError,
    build_preview,
    commit_import,
    rollback_import,
)
from app.models import Account, ImportBatch, Transaction, User

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture
def account_ready(db):
    user = User(email="a@b.c", name="A", password_hash="x")
    db.add(user)
    db.commit()
    categories = seed_categories(db, user.id)
    seed_rules(db, user.id, categories)
    account = Account(user_id=user.id, name="Courant", kind="checking")
    db.add(account)
    db.commit()
    return user, account, categories


def _boursorama() -> bytes:
    return (FIXTURES / "boursorama.csv").read_bytes()


def test_preview_reports_a_usable_summary(db, account_ready):
    user, account, _ = account_ready
    preview = build_preview(db, user.id, account.id, _boursorama(), None, None)
    assert preview.summary["total"] == 4
    assert preview.summary["importable"] == 4
    assert preview.summary["failed"] == 0
    assert preview.summary["date_from"].isoformat() == "2025-03-01"
    assert preview.summary["date_to"].isoformat() == "2025-03-07"
    assert preview.summary["inflow_cents"] == 245000
    assert preview.summary["outflow_cents"] == -12891


def test_preview_categorizes_using_the_rule_library(db, account_ready):
    user, account, categories = account_ready
    preview = build_preview(db, user.id, account.id, _boursorama(), None, None)
    by_row = {row.row_number: row for row in preview.rows}
    assert by_row[1].category_id == categories["alimentation-courses"].id
    assert by_row[1].category_source == "builtin"
    assert by_row[2].category_id == categories["revenus-salaire"].id
    assert by_row[3].category_id == categories["abonnements-streaming"].id
    assert by_row[4].category_id == categories["transport-carburant"].id


def test_bucket_hint_used_when_no_rule_matches(db, account_ready):
    # The seeded Loisirs subtree carries no built-in rules at all, so a
    # bank-tagged leisure expense must fall back to the CSV bucket hint
    # rather than land uncategorized despite the file naming its category.
    user, account, categories = account_ready
    raw = (
        b"dateOp;dateVal;label;category;amount\r\n"
        b"01/03/2025;01/03/2025;CINEMA PATHE;Loisirs;-12,50\r\n"
    )
    dialect = detect_dialect(raw)
    mapping = suggest_mapping(dialect.sample_headers)
    preview = build_preview(db, user.id, account.id, raw, dialect, mapping)
    row = preview.rows[0]
    assert row.category_id == categories["loisirs"].id
    assert row.category_source == "csv"


def test_leaf_hint_wins_over_a_conflicting_rule(db, account_ready):
    # "carrefour" would normally match the alimentation-courses rule, but a
    # CSV hint naming a specific leaf category is at least as precise as any
    # rule, so it must win outright.
    user, account, categories = account_ready
    raw = (
        b"dateOp;dateVal;label;category;amount\r\n"
        b"01/03/2025;01/03/2025;CARREFOUR MARKET CB 01/03;Cadeaux;-47,32\r\n"
    )
    dialect = detect_dialect(raw)
    mapping = suggest_mapping(dialect.sample_headers)
    preview = build_preview(db, user.id, account.id, raw, dialect, mapping)
    row = preview.rows[0]
    assert row.category_id == categories["achats-cadeaux"].id
    assert row.category_source == "csv"


def test_preview_does_not_write_anything(db, account_ready):
    user, account, _ = account_ready
    build_preview(db, user.id, account.id, _boursorama(), None, None)
    assert db.query(Transaction).count() == 0


def test_commit_creates_transactions_and_a_batch(db, account_ready):
    user, account, _ = account_ready
    raw = _boursorama()
    dialect = detect_dialect(raw)
    mapping = suggest_mapping(dialect.sample_headers)
    batch = commit_import(db, user.id, account.id, raw, "boursorama.csv",
                          dialect, mapping, {}, [])
    assert batch.rows_imported == 4
    assert batch.rows_duplicate == 0
    assert db.query(Transaction).count() == 4
    assert all(t.import_batch_id == batch.id for t in db.query(Transaction).all())


def test_reimporting_the_same_file_imports_nothing_new(db, account_ready):
    user, account, _ = account_ready
    raw = _boursorama()
    dialect = detect_dialect(raw)
    mapping = suggest_mapping(dialect.sample_headers)
    commit_import(db, user.id, account.id, raw, "b.csv", dialect, mapping, {}, [])
    second = commit_import(db, user.id, account.id, raw, "b.csv", dialect, mapping, {}, [])
    assert second.rows_imported == 0
    assert second.rows_duplicate == 4
    assert db.query(Transaction).count() == 4


def test_preview_flags_rows_already_present(db, account_ready):
    user, account, _ = account_ready
    raw = _boursorama()
    dialect = detect_dialect(raw)
    mapping = suggest_mapping(dialect.sample_headers)
    commit_import(db, user.id, account.id, raw, "b.csv", dialect, mapping, {}, [])
    preview = build_preview(db, user.id, account.id, raw, dialect, mapping)
    assert all(row.is_duplicate for row in preview.rows)
    assert preview.summary["duplicates"] == 4
    assert preview.summary["importable"] == 0


def test_user_can_force_a_flagged_duplicate_through(db, account_ready):
    user, account, _ = account_ready
    raw = _boursorama()
    dialect = detect_dialect(raw)
    mapping = suggest_mapping(dialect.sample_headers)
    commit_import(db, user.id, account.id, raw, "b.csv", dialect, mapping, {}, [])
    second = commit_import(db, user.id, account.id, raw, "b.csv", dialect, mapping, {}, [1])
    assert second.rows_imported == 1
    assert db.query(Transaction).count() == 5


def test_forcing_the_same_duplicate_through_repeatedly_does_not_collide(db, account_ready):
    # A naive "hash:row_number" suffix is not enough: forcing the same row through
    # twice would try to reuse the same suffixed fingerprint and trip the
    # (user_id, dedup_hash) unique constraint. The suffix search must skip any
    # value already on record, including ones created by an earlier forced import.
    user, account, _ = account_ready
    raw = _boursorama()
    dialect = detect_dialect(raw)
    mapping = suggest_mapping(dialect.sample_headers)

    first = commit_import(db, user.id, account.id, raw, "b.csv", dialect, mapping, {}, [])
    assert first.rows_imported == 4

    second = commit_import(db, user.id, account.id, raw, "b.csv", dialect, mapping, {}, [1])
    assert second.rows_imported == 1
    assert second.rows_duplicate == 3

    third = commit_import(db, user.id, account.id, raw, "b.csv", dialect, mapping, {}, [1])
    assert third.rows_imported == 1
    assert third.rows_duplicate == 3

    assert db.query(Transaction).count() == 6


def test_category_override_wins_over_rules(db, account_ready):
    user, account, categories = account_ready
    raw = _boursorama()
    dialect = detect_dialect(raw)
    mapping = suggest_mapping(dialect.sample_headers)
    commit_import(db, user.id, account.id, raw, "b.csv", dialect, mapping,
                  {1: categories["achats-cadeaux"].id}, [])
    transaction = db.query(Transaction).filter(
        Transaction.label_raw.like("CARREFOUR%")).one()
    assert transaction.category_id == categories["achats-cadeaux"].id
    assert transaction.category_source == "manual"


def test_commit_rejects_an_override_naming_another_users_category(db, account_ready):
    """The override dict in CommitIn comes straight from the client and is written
    as category_id with no check that the category belongs to the calling user.
    A foreign category id must be rejected before anything is written -- not just
    left to the database's foreign key, which only confirms the row exists
    somewhere, not that it is the caller's."""
    user, account, _ = account_ready
    intruder = User(email="intruder@example.com", name="Intruder", password_hash="x")
    db.add(intruder)
    db.commit()
    intruder_categories = seed_categories(db, intruder.id)

    raw = _boursorama()
    dialect = detect_dialect(raw)
    mapping = suggest_mapping(dialect.sample_headers)

    with pytest.raises(UnknownCategoryError):
        commit_import(db, user.id, account.id, raw, "b.csv", dialect, mapping,
                      {1: intruder_categories["achats-cadeaux"].id}, [])

    assert db.query(ImportBatch).count() == 0
    assert db.query(Transaction).filter(Transaction.user_id == user.id).count() == 0
    assert db.query(Transaction).filter(Transaction.user_id == intruder.id).count() == 0


def test_commit_rejects_an_override_naming_a_nonexistent_category(db, account_ready):
    user, account, _ = account_ready
    raw = _boursorama()
    dialect = detect_dialect(raw)
    mapping = suggest_mapping(dialect.sample_headers)

    with pytest.raises(UnknownCategoryError):
        commit_import(db, user.id, account.id, raw, "b.csv", dialect, mapping,
                      {1: 999999}, [])

    assert db.query(ImportBatch).count() == 0
    assert db.query(Transaction).count() == 0


def test_rollback_removes_exactly_that_batch(db, account_ready):
    user, account, _ = account_ready
    raw = _boursorama()
    dialect = detect_dialect(raw)
    mapping = suggest_mapping(dialect.sample_headers)
    first = commit_import(db, user.id, account.id, raw, "b.csv", dialect, mapping, {}, [])
    iso_raw = (FIXTURES / "generic_iso.csv").read_bytes()
    iso_dialect = detect_dialect(iso_raw)
    commit_import(db, user.id, account.id, iso_raw, "iso.csv", iso_dialect,
                  suggest_mapping(iso_dialect.sample_headers), {}, [])
    assert db.query(Transaction).count() == 7

    removed = rollback_import(db, user.id, first.id)
    assert removed == 4
    assert db.query(Transaction).count() == 3


def test_rollback_refuses_another_users_batch(db, account_ready):
    user, account, _ = account_ready
    raw = _boursorama()
    dialect = detect_dialect(raw)
    batch = commit_import(db, user.id, account.id, raw, "b.csv", dialect,
                          suggest_mapping(dialect.sample_headers), {}, [])
    intruder = User(email="x@y.z", name="X", password_hash="x")
    db.add(intruder)
    db.commit()
    with pytest.raises(PermissionError):
        rollback_import(db, intruder.id, batch.id)


def test_failed_rows_are_counted_and_skipped(db, account_ready):
    user, account, _ = account_ready
    raw = b"date;label;amount\r\n01/03/2025;OK;-10,00\r\nnimporte;KO;-20,00\r\n"
    dialect = detect_dialect(raw)
    mapping = suggest_mapping(dialect.sample_headers)
    batch = commit_import(db, user.id, account.id, raw, "mixed.csv",
                          dialect, mapping, {}, [])
    assert batch.rows_imported == 1
    assert batch.rows_failed == 1
