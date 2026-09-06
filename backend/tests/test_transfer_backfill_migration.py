"""The one pass that finally poses `is_transfer`, run against real rows.

Every other test in the suite builds its schema with `create_all()`, so a
migration's backfill is never executed anywhere unless a test like this one
runs it. The harness is `test_migrations.py`'s, reused: a throwaway SQLite file
under pytest's `tmp_path`, brought to the revision *before* this one, seeded the
way an operator's database actually is, then upgraded.

The property under test is the whole rule, on rows that already existed:

* a category of kind `transfer` marks the row;
* a savings account with no category marks the row;
* a savings account with an income category -- the livret's interest -- does
  NOT, because that is a real gain and the account rule only ever speaks where
  no category has;
* a row already flagged before the migration comes out `manual` and untouched.
"""

import sqlite3
from pathlib import Path

import pytest
from alembic.config import Config

from alembic import command
from app.config import settings
from app.engines.transfer import SAVINGS_ACCOUNT_KINDS

ALEMBIC_DIR = Path(__file__).resolve().parent.parent / "alembic"

# The revision immediately before c8e2f1a54d90.
PREVIOUS_REVISION = "b7d41e9c2a68"


@pytest.fixture
def migration_db(tmp_path, monkeypatch) -> Config:
    monkeypatch.setattr(settings, "data_dir", tmp_path)
    cfg = Config()
    cfg.set_main_option("script_location", str(ALEMBIC_DIR))
    cfg.attributes["db_path"] = tmp_path / "yieldo.db"
    return cfg


def _seed(conn: sqlite3.Connection) -> None:
    """A user, two accounts, three categories and six transactions, written
    against the pre-migration schema -- no `transfer_source` column exists yet.
    """
    conn.execute(
        "INSERT INTO users (id, email, name, password_hash, role, is_active, created_at) "
        "VALUES (1, 'operator@example.com', 'Operator', 'x', 'user', 1, '2026-01-01 00:00:00')"
    )
    for account_id, name, kind in (
        (1, "Compte courant", "checking"),
        (2, "Livret A", "savings"),
    ):
        conn.execute(
            "INSERT INTO accounts (id, user_id, name, kind, currency, "
            "opening_balance_cents, include_in_net_worth, archived) "
            "VALUES (?, 1, ?, ?, 'EUR', 0, 1, 0)",
            (account_id, name, kind),
        )
    for category_id, slug, name, kind in (
        (1, "epargne", "Epargne et investissement", "transfer"),
        (2, "courses", "Courses", "expense"),
        (3, "interets", "Interets", "income"),
    ):
        conn.execute(
            "INSERT INTO categories (id, user_id, parent_id, name, slug, kind, color, "
            "icon, monthly_budget_cents, position, is_essential) "
            "VALUES (?, 1, NULL, ?, ?, ?, '#000000', 'circle', NULL, 0, 0)",
            (category_id, name, slug, kind),
        )

    rows = (
        # (id, account, category, amount, label, is_transfer)
        (1, 1, 1, -30_000, "virement livret", 0),      # category rule fires
        (2, 1, 2, -8_450, "supermarche", 0),           # an expense, untouched
        (3, 2, None, 30_000, "versement recu", 0),     # account rule fires
        (4, 2, 3, 1_250, "interets annuels", 0),       # income on a livret: a flow
        (5, 1, None, -4_000, "retrait dab", 0),        # no rule fires
        (6, 1, 2, -60_000, "loyer garage", 1),         # already marked by hand
    )
    for row_id, account_id, category_id, amount, label, flag in rows:
        conn.execute(
            "INSERT INTO transactions (id, user_id, account_id, date, amount_cents, "
            "label_raw, label_clean, category_id, category_source, is_transfer, "
            "is_recurring, dedup_hash, tags) "
            "VALUES (?, 1, ?, '2025-03-05', ?, ?, ?, ?, 'manual', ?, 0, ?, '[]')",
            (row_id, account_id, amount, label, label, category_id, flag, f"hash{row_id}"),
        )
    conn.commit()


def _state(db_path: Path) -> dict[int, tuple[int, str]]:
    conn = sqlite3.connect(db_path)
    rows = conn.execute(
        "SELECT id, is_transfer, transfer_source FROM transactions ORDER BY id"
    ).fetchall()
    conn.close()
    return {row[0]: (row[1], row[2]) for row in rows}


def test_the_backfill_applies_both_rules_and_keeps_every_manual_mark(migration_db):
    db_path = migration_db.attributes["db_path"]
    command.upgrade(migration_db, PREVIOUS_REVISION)

    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA foreign_keys = ON")
    _seed(conn)
    total_before = conn.execute("SELECT COUNT(*) FROM transactions").fetchone()[0]
    conn.close()

    command.upgrade(migration_db, "head")
    state = _state(db_path)

    assert len(state) == total_before  # no row created or destroyed

    assert state[1] == (1, "auto")     # a transfer-kind category marks the row
    assert state[2] == (0, "auto")     # an expense stays an expense
    assert state[3] == (1, "auto")     # a savings account with no category
    assert state[4] == (0, "auto")     # interest called income stays a flow
    assert state[5] == (0, "auto")     # a cash withdrawal is not a transfer
    assert state[6] == (1, "manual")   # a pre-existing mark is kept, as manual


def test_the_account_rule_covers_every_kind_the_engine_names(migration_db):
    """A kind added to `SAVINGS_ACCOUNT_KINDS` and forgotten in the migration's
    IN clause would silently stop marking a whole account type."""
    db_path = migration_db.attributes["db_path"]
    command.upgrade(migration_db, PREVIOUS_REVISION)

    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute(
        "INSERT INTO users (id, email, name, password_hash, role, is_active, created_at) "
        "VALUES (1, 'operator@example.com', 'Operator', 'x', 'user', 1, '2026-01-01 00:00:00')"
    )
    for index, kind in enumerate(sorted(SAVINGS_ACCOUNT_KINDS), start=1):
        conn.execute(
            "INSERT INTO accounts (id, user_id, name, kind, currency, "
            "opening_balance_cents, include_in_net_worth, archived) "
            "VALUES (?, 1, ?, ?, 'EUR', 0, 1, 0)",
            (index, kind, kind),
        )
        conn.execute(
            "INSERT INTO transactions (id, user_id, account_id, date, amount_cents, "
            "label_raw, label_clean, category_id, category_source, is_transfer, "
            "is_recurring, dedup_hash, tags) "
            "VALUES (?, 1, ?, '2025-03-05', 10000, 'versement', 'versement', NULL, "
            "'uncategorized', 0, 0, ?, '[]')",
            (index, index, f"hash{index}"),
        )
    conn.commit()
    conn.close()

    command.upgrade(migration_db, "head")

    assert all(flag == 1 for flag, _ in _state(db_path).values())


def test_downgrade_drops_the_column_and_keeps_every_row(migration_db):
    db_path = migration_db.attributes["db_path"]
    command.upgrade(migration_db, PREVIOUS_REVISION)

    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA foreign_keys = ON")
    _seed(conn)
    conn.close()

    command.upgrade(migration_db, "head")
    command.downgrade(migration_db, PREVIOUS_REVISION)

    conn = sqlite3.connect(db_path)
    columns = {row[1] for row in conn.execute("PRAGMA table_info(transactions)")}
    total = conn.execute("SELECT COUNT(*) FROM transactions").fetchone()[0]
    conn.close()

    assert "transfer_source" not in columns
    assert total == 6
