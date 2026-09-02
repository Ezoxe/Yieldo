"""Exercises Alembic migrations themselves, against a throwaway SQLite file.

Every other test in this suite runs against a database built by
`Base.metadata.create_all()` (see the `db` fixture in conftest.py), which
means the migration files under `alembic/versions/` are never actually
imported or executed anywhere in CI. That is fine for a migration that is
pure DDL, but it is not fine for a migration with backfill logic against
live data -- the only thing that can catch a future typo in a slug list or a
broken WHERE clause is a test that runs the real `upgrade()`/`downgrade()`
functions against a database seeded the way an operator's actually is:
built at the *previous* revision, with rows already in it.

The `migration_db` fixture below is written to be reusable by later
migrations: point a new test at a different revision pair and it works the
same way. It never touches `backend/data/yieldo.db` -- it redirects
`settings.data_dir` (which `alembic/env.py` reads to build the migration's
target URL) to pytest's per-test `tmp_path`, so the whole thing is
self-contained and leaves nothing behind.
"""

import sqlite3
from dataclasses import dataclass
from pathlib import Path

import pytest
from alembic.config import Config
from sqlalchemy import create_engine

from alembic import command
from app.categorization.seed import CATEGORY_TREE, ESSENTIAL_SLUGS
from app.config import settings
from app.db import Base

ALEMBIC_DIR = Path(__file__).resolve().parent.parent / "alembic"

# The revision immediately before c3f81a20d5e4 ("essential categories and
# price index") -- i.e. the schema an operator's database was actually at
# before this migration existed.
PREVIOUS_REVISION = "a7b67772495a"


@dataclass
class MigrationHarness:
    config: Config
    db_path: Path


@pytest.fixture
def migration_db(tmp_path, monkeypatch) -> MigrationHarness:
    """An Alembic Config wired to a fresh, empty SQLite file.

    `alembic/env.py` builds its target URL from `app.config.settings.database_url`
    directly (`config.set_main_option("sqlalchemy.url", settings.database_url)`),
    ignoring whatever URL a caller sets on the Config object beforehand -- so the
    only way to redirect where migrations run is to redirect `settings.data_dir`,
    exactly as the `imported` fixture in conftest.py already does for the same
    reason.
    """
    monkeypatch.setattr(settings, "data_dir", tmp_path)
    cfg = Config()
    cfg.set_main_option("script_location", str(ALEMBIC_DIR))
    return MigrationHarness(config=cfg, db_path=tmp_path / "yieldo.db")


def _connect(harness: MigrationHarness) -> sqlite3.Connection:
    conn = sqlite3.connect(harness.db_path)
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def _seed_preexisting_user_and_full_category_tree(conn: sqlite3.Connection) -> None:
    """Insert rows the way an operator's database actually held them *before*
    this migration ever ran: a user, then the full seeded category tree,
    written directly against the old (pre-`is_essential`) `categories` schema.

    Mirrors `seed_categories`' own traversal of `CATEGORY_TREE` so the fixture
    reflects the real 69-category shape without depending on the ORM model
    (which now declares a column this schema doesn't have yet).
    """
    conn.execute(
        "INSERT INTO users (id, email, name, password_hash, role, is_active, created_at) "
        "VALUES (1, 'operator@example.com', 'Operator', 'x', 'user', 1, '2026-01-01 00:00:00')"
    )

    next_id = 1
    for position, (slug, name, kind, color, icon, children) in enumerate(CATEGORY_TREE):
        parent_id = next_id
        conn.execute(
            "INSERT INTO categories (id, user_id, parent_id, name, slug, kind, color, icon, "
            "monthly_budget_cents, position) VALUES (?, 1, NULL, ?, ?, ?, ?, ?, NULL, ?)",
            (parent_id, name, slug, kind, color, icon, position),
        )
        next_id += 1
        for child_position, (child_slug, child_name) in enumerate(children):
            conn.execute(
                "INSERT INTO categories (id, user_id, parent_id, name, slug, kind, color, icon, "
                "monthly_budget_cents, position) VALUES (?, 1, ?, ?, ?, ?, ?, ?, NULL, ?)",
                (next_id, parent_id, child_name, child_slug, kind, color, icon, child_position),
            )
            next_id += 1
    conn.commit()


def test_upgrade_adds_the_column_and_the_table(migration_db):
    command.upgrade(migration_db.config, PREVIOUS_REVISION)
    command.upgrade(migration_db.config, "head")

    conn = sqlite3.connect(migration_db.db_path)
    columns = {row[1] for row in conn.execute("PRAGMA table_info(categories)")}
    tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    conn.close()

    assert "is_essential" in columns
    assert "price_index_points" in tables


def test_the_backfill_flags_exactly_the_preexisting_essential_categories(migration_db):
    """The assertion that matters: rows that existed *before* the upgrade --
    not freshly-seeded ones -- come out with the right `is_essential` value,
    and only the right ones. This is the one no other test in the suite can
    make, because every other test builds its schema via `create_all()` and
    never runs the migration's own backfill `UPDATE`.
    """
    command.upgrade(migration_db.config, PREVIOUS_REVISION)

    conn = _connect(migration_db)
    _seed_preexisting_user_and_full_category_tree(conn)
    total_before = conn.execute("SELECT COUNT(*) FROM categories").fetchone()[0]
    conn.close()

    command.upgrade(migration_db.config, "head")

    conn = sqlite3.connect(migration_db.db_path)
    rows = conn.execute("SELECT slug, is_essential FROM categories").fetchall()
    total_after = conn.execute("SELECT COUNT(*) FROM categories").fetchone()[0]
    conn.close()

    assert total_after == total_before  # no row created or destroyed by the migration
    flagged = {slug for slug, is_essential in rows if is_essential == 1}
    not_flagged = {slug for slug, is_essential in rows if is_essential == 0}

    # The set of pre-existing rows the backfill actually marked true must be
    # exactly ESSENTIAL_SLUGS -- not a superset, not a subset. A typo in the
    # migration's WHERE clause, or a slug dropped from the list, shows up here.
    assert flagged == ESSENTIAL_SLUGS
    assert not_flagged == {slug for slug, *_ in rows} - ESSENTIAL_SLUGS
    # Sanity: every known non-essential example from the seed really is one.
    assert "loisirs-vacances" in not_flagged
    assert "abonnements-streaming" in not_flagged


def test_downgrade_then_upgrade_again_is_clean_and_loses_no_rows(migration_db):
    command.upgrade(migration_db.config, PREVIOUS_REVISION)

    conn = _connect(migration_db)
    _seed_preexisting_user_and_full_category_tree(conn)
    total = conn.execute("SELECT COUNT(*) FROM categories").fetchone()[0]
    conn.close()

    command.upgrade(migration_db.config, "head")

    conn = sqlite3.connect(migration_db.db_path)
    essential_after_first_upgrade = {
        slug for slug, flag in conn.execute("SELECT slug, is_essential FROM categories")
        if flag == 1
    }
    conn.close()
    assert essential_after_first_upgrade == ESSENTIAL_SLUGS

    command.downgrade(migration_db.config, PREVIOUS_REVISION)

    conn = sqlite3.connect(migration_db.db_path)
    columns = {row[1] for row in conn.execute("PRAGMA table_info(categories)")}
    tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    count_after_downgrade = conn.execute("SELECT COUNT(*) FROM categories").fetchone()[0]
    conn.close()

    assert "is_essential" not in columns
    assert "price_index_points" not in tables
    assert count_after_downgrade == total

    command.upgrade(migration_db.config, "head")

    conn = sqlite3.connect(migration_db.db_path)
    essential_after_second_upgrade = {
        slug for slug, flag in conn.execute("SELECT slug, is_essential FROM categories")
        if flag == 1
    }
    count_after_second_upgrade = conn.execute("SELECT COUNT(*) FROM categories").fetchone()[0]
    conn.close()

    assert count_after_second_upgrade == total
    assert essential_after_second_upgrade == ESSENTIAL_SLUGS


PHASE_2B_REVISION = "d1a4c9e77b02"
PHASE_2B_PREVIOUS = "c3f81a20d5e4"


def test_the_phase_2b_migration_adds_three_tables_to_a_populated_database(migration_db):
    """Run the real `upgrade()` against a database built at the PREVIOUS
    revision with rows already in it -- the shape an operator's database
    actually has. The suite's `db` fixture builds schema from
    `Base.metadata`, so without this the migration file is never executed
    anywhere."""
    command.upgrade(migration_db.config, PHASE_2B_PREVIOUS)
    conn = _connect(migration_db)
    conn.execute(
        "INSERT INTO users (id, email, name, password_hash, role, is_active, created_at) "
        "VALUES (1, 'a@b.fr', 'Max', 'x', 'user', 1, '2026-01-01T00:00:00')"
    )
    conn.commit()
    conn.close()

    command.upgrade(migration_db.config, PHASE_2B_REVISION)

    conn = _connect(migration_db)
    tables = {
        row[0]
        for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
    }
    assert {"debts", "goals", "scenarios"} <= tables
    # The pre-existing user survived, and the new tables really do enforce the
    # foreign key -- a table created without it would accept this insert.
    assert conn.execute("SELECT COUNT(*) FROM users").fetchone()[0] == 1
    conn.execute(
        "INSERT INTO goals (id, user_id, name, target_cents, saved_cents, priority, archived) "
        "VALUES (1, 1, 'Fonds', 600000, 0, 100, 0)"
    )
    conn.commit()
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute(
            "INSERT INTO goals (id, user_id, name, target_cents, saved_cents, priority, archived) "
            "VALUES (2, 4242, 'Orphelin', 1, 0, 100, 0)"
        )
    conn.close()


def test_the_phase_2b_migration_rolls_back_cleanly(migration_db):
    command.upgrade(migration_db.config, PHASE_2B_REVISION)
    command.downgrade(migration_db.config, PHASE_2B_PREVIOUS)
    conn = _connect(migration_db)
    tables = {
        row[0]
        for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
    }
    assert not ({"debts", "goals", "scenarios"} & tables)
    # The tables the previous revision owns are untouched.
    assert "price_index_points" in tables
    conn.close()


PHASE_2C_REVISION = "4aa48828b2cb"
PHASE_2C_PREVIOUS = "d1a4c9e77b02"


def _table_columns(conn: sqlite3.Connection, table: str) -> set[tuple[str, int]]:
    """(name, notnull) pairs for every column of `table`. Enough to catch a
    column the hand-written migration dropped, renamed, or gave a different
    nullability than the ORM model declares."""
    return {(row[1], row[3]) for row in conn.execute(f"PRAGMA table_info({table})")}


def _index_names(conn: sqlite3.Connection, table: str) -> set[str]:
    return {row[1] for row in conn.execute(f"PRAGMA index_list({table})")}


def _reference_schema(table: str) -> tuple[set[tuple[str, int]], set[str]]:
    """The SAME table, built directly from `Base.metadata.create_all` rather
    than through Alembic -- the independent source of truth the migration's
    own DDL must agree with. Nothing in the rest of this suite ever runs the
    migration file (see the module docstring), so without this comparison a
    typo'd column name or a nullability mismatch between `models/
    health_snapshot.py` / `models/challenge.py` and the hand-written
    `alembic/versions/4aa48828b2cb_*.py` would pass every other test."""
    engine = create_engine("sqlite://")
    try:
        Base.metadata.create_all(engine, tables=[Base.metadata.tables[table]])
        with engine.connect() as conn:
            columns = {
                (row[1], row[3])
                for row in conn.exec_driver_sql(f"PRAGMA table_info({table})")
            }
            indexes = {row[1] for row in conn.exec_driver_sql(f"PRAGMA index_list({table})")}
    finally:
        engine.dispose()
    return columns, indexes


@pytest.mark.parametrize("table", ["health_snapshots", "challenges"])
def test_the_phase_2c_migration_matches_base_metadata_exactly(migration_db, table):
    """Verified against `Base.metadata`, as the task requires -- not just
    "the table exists", but that its columns and indexes are exactly what the
    ORM models declare, independently derived."""
    command.upgrade(migration_db.config, PHASE_2C_PREVIOUS)
    command.upgrade(migration_db.config, PHASE_2C_REVISION)

    conn = _connect(migration_db)
    migrated_columns = _table_columns(conn, table)
    migrated_indexes = _index_names(conn, table)
    conn.close()

    reference_columns, reference_indexes = _reference_schema(table)
    assert migrated_columns == reference_columns
    assert migrated_indexes == reference_indexes


def test_the_phase_2c_migration_adds_two_tables_to_a_populated_database(migration_db):
    """Run the real `upgrade()` against a database built at the PREVIOUS
    revision with rows already in it -- exactly `test_the_phase_2b_migration_
    adds_three_tables_to_a_populated_database`'s pattern, for the tables this
    migration owns."""
    command.upgrade(migration_db.config, PHASE_2C_PREVIOUS)
    conn = _connect(migration_db)
    conn.execute(
        "INSERT INTO users (id, email, name, password_hash, role, is_active, created_at) "
        "VALUES (1, 'a@b.fr', 'Max', 'x', 'user', 1, '2026-01-01T00:00:00')"
    )
    conn.commit()
    conn.close()

    command.upgrade(migration_db.config, PHASE_2C_REVISION)

    conn = _connect(migration_db)
    tables = {
        row[0]
        for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
    }
    assert {"health_snapshots", "challenges"} <= tables
    assert conn.execute("SELECT COUNT(*) FROM users").fetchone()[0] == 1

    conn.execute(
        "INSERT INTO health_snapshots (id, user_id, taken_on, score, components) "
        "VALUES (1, 1, '2026-01-15', 62, '[]')"
    )
    conn.execute(
        "INSERT INTO challenges (id, user_id, kind, title, detail, proposed_on, state) "
        "VALUES (1, 1, 'anomaly', 'Titre', 'Détail', '2026-01-15', 'proposed')"
    )
    conn.commit()

    # The foreign key on user_id really is enforced, on both tables.
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute(
            "INSERT INTO health_snapshots (id, user_id, taken_on, score, components) "
            "VALUES (2, 4242, '2026-01-16', 50, '[]')"
        )
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute(
            "INSERT INTO challenges (id, user_id, kind, title, detail, proposed_on, state) "
            "VALUES (2, 4242, 'anomaly', 'Titre', 'Détail', '2026-01-16', 'proposed')"
        )
    # A second snapshot for the same user on the same day violates the unique
    # constraint -- at most one per user per calendar day.
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute(
            "INSERT INTO health_snapshots (id, user_id, taken_on, score, components) "
            "VALUES (3, 1, '2026-01-15', 70, '[]')"
        )
    conn.close()


def test_the_phase_2c_migration_rolls_back_cleanly(migration_db):
    """A downgrade must leave no table, index or row behind on the tables it
    owns, and must not touch anything the previous revision already had."""
    command.upgrade(migration_db.config, PHASE_2C_REVISION)

    conn = _connect(migration_db)
    conn.execute(
        "INSERT INTO users (id, email, name, password_hash, role, is_active, created_at) "
        "VALUES (1, 'a@b.fr', 'Max', 'x', 'user', 1, '2026-01-01T00:00:00')"
    )
    conn.execute(
        "INSERT INTO health_snapshots (id, user_id, taken_on, score, components) "
        "VALUES (1, 1, '2026-01-15', 62, '[]')"
    )
    conn.execute(
        "INSERT INTO challenges (id, user_id, kind, title, detail, proposed_on, state) "
        "VALUES (1, 1, 'anomaly', 'Titre', 'Détail', '2026-01-15', 'proposed')"
    )
    conn.commit()
    conn.close()

    command.downgrade(migration_db.config, PHASE_2C_PREVIOUS)

    conn = _connect(migration_db)
    tables = {
        row[0]
        for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
    }
    indexes = {
        row[0]
        for row in conn.execute("SELECT name FROM sqlite_master WHERE type='index'").fetchall()
    }
    assert not ({"health_snapshots", "challenges"} & tables)
    assert not any(name.startswith("ix_health_snapshots") for name in indexes)
    assert not any(name.startswith("ix_challenges") for name in indexes)
    # The previous revision's own tables and the pre-existing row survive.
    assert {"debts", "goals", "scenarios", "users"} <= tables
    assert conn.execute("SELECT COUNT(*) FROM users").fetchone()[0] == 1
    conn.close()

    # And a fresh upgrade from here works cleanly again -- the down/up cycle
    # is idempotent, not a one-way trip that happens to work once.
    command.upgrade(migration_db.config, "head")
    conn = _connect(migration_db)
    tables = {
        row[0]
        for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
    }
    assert {"health_snapshots", "challenges"} <= tables
    conn.close()


PHASE_3_REVISION = "5fa05f976fab"
PHASE_3_PREVIOUS = "4aa48828b2cb"
PHASE_3_TABLES = {
    "instruments", "investment_accounts", "positions", "lots",
    "price_points", "api_keys", "quota_windows",
}


@pytest.mark.parametrize("table", sorted(PHASE_3_TABLES))
def test_the_phase_3_migration_matches_base_metadata_exactly(migration_db, table):
    """Same independent-source-of-truth comparison as the phase 2C test
    above, extended to all seven of this migration's tables: the hand-written
    DDL in `5fa05f976fab_*.py` must agree, column for column and index for
    index, with what `Base.metadata.create_all` derives straight from the
    ORM models -- nothing in the rest of this suite ever executes the
    migration file itself (see the module docstring), so this is the only
    test that would catch a typo'd column name or a nullability mismatch
    between e.g. `models/lot.py` and the migration.
    """
    command.upgrade(migration_db.config, PHASE_3_PREVIOUS)
    command.upgrade(migration_db.config, PHASE_3_REVISION)

    conn = _connect(migration_db)
    migrated_columns = _table_columns(conn, table)
    migrated_indexes = _index_names(conn, table)
    conn.close()

    reference_columns, reference_indexes = _reference_schema(table)
    assert migrated_columns == reference_columns
    assert migrated_indexes == reference_indexes


def test_the_phase_3_migration_adds_seven_tables_to_a_populated_database(migration_db):
    """Run the real `upgrade()` against a database built at the PREVIOUS
    revision with a pre-existing user already in it -- the shape an
    operator's database actually has, not the empty one `create_all` builds
    for every other test in this suite."""
    command.upgrade(migration_db.config, PHASE_3_PREVIOUS)
    conn = _connect(migration_db)
    conn.execute(
        "INSERT INTO users (id, email, name, password_hash, role, is_active, created_at) "
        "VALUES (1, 'a@b.fr', 'Max', 'x', 'user', 1, '2026-01-01T00:00:00')"
    )
    conn.commit()
    conn.close()

    command.upgrade(migration_db.config, PHASE_3_REVISION)

    conn = _connect(migration_db)
    tables = {
        row[0]
        for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
    }
    assert tables >= PHASE_3_TABLES
    assert conn.execute("SELECT COUNT(*) FROM users").fetchone()[0] == 1

    conn.execute(
        "INSERT INTO instruments (id, symbol, name, asset_class, currency, is_fractionable) "
        "VALUES (1, 'AAPL', 'Apple Inc.', 'equity', 'USD', 0)"
    )
    conn.execute(
        "INSERT INTO investment_accounts (id, user_id, name, kind, currency, opened_on, "
        "archived) VALUES (1, 1, 'CTO', 'cto', 'EUR', NULL, 0)"
    )
    conn.execute(
        "INSERT INTO positions (id, user_id, investment_account_id, instrument_id) "
        "VALUES (1, 1, 1, 1)"
    )
    conn.execute(
        "INSERT INTO lots (id, user_id, position_id, quantity, unit_cost_cents, acquired_on) "
        "VALUES (1, 1, 1, '12.000000000000000000', 15000, '2026-01-15')"
    )
    conn.execute(
        "INSERT INTO price_points (id, instrument_id, as_of, price_cents, source, fetched_at) "
        "VALUES (1, 1, '2026-01-15', 19034, 'finnhub', '2026-01-15T10:00:00')"
    )
    conn.execute(
        "INSERT INTO api_keys (id, provider, value, created_at, last_used_at) "
        "VALUES (1, 'finnhub', 'gAAAA...', '2026-01-15T10:00:00', NULL)"
    )
    conn.execute(
        "INSERT INTO quota_windows (id, provider, window_started_at, used) "
        "VALUES (1, 'finnhub', '2026-01-15T10:00:00', 0)"
    )
    conn.commit()

    # Foreign keys really are enforced on the user-owned tables.
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute(
            "INSERT INTO investment_accounts (id, user_id, name, kind, currency, opened_on, "
            "archived) VALUES (2, 4242, 'Orphelin', 'cto', 'EUR', NULL, 0)"
        )
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute(
            "INSERT INTO positions (id, user_id, investment_account_id, instrument_id) "
            "VALUES (2, 4242, 1, 1)"
        )
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute(
            "INSERT INTO lots (id, user_id, position_id, quantity, unit_cost_cents, "
            "acquired_on) VALUES (2, 4242, 1, '1', 100, '2026-01-15')"
        )
    # A second position on the same (account, instrument) violates the
    # unique constraint that stands in for "one holding per instrument".
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute(
            "INSERT INTO positions (id, user_id, investment_account_id, instrument_id) "
            "VALUES (3, 1, 1, 1)"
        )
    # A second key or quota window for a provider that already has one
    # violates the pool's own uniqueness.
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute(
            "INSERT INTO api_keys (id, provider, value, created_at, last_used_at) "
            "VALUES (2, 'finnhub', 'gBBBB...', '2026-01-16T10:00:00', NULL)"
        )
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute(
            "INSERT INTO quota_windows (id, provider, window_started_at, used) "
            "VALUES (2, 'finnhub', '2026-01-16T10:00:00', 0)"
        )
    # Deleting an instrument still referenced by a position is RESTRICTed,
    # not silently cascaded away.
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute("DELETE FROM instruments WHERE id = 1")
    conn.close()


def test_the_phase_3_migration_rolls_back_cleanly_and_leaves_nothing_behind(migration_db):
    """A downgrade must leave no table, index or row behind on the tables it
    owns, must not touch anything the previous revision already had, and a
    fresh upgrade from there must work cleanly again."""
    command.upgrade(migration_db.config, PHASE_3_REVISION)

    conn = _connect(migration_db)
    conn.execute(
        "INSERT INTO users (id, email, name, password_hash, role, is_active, created_at) "
        "VALUES (1, 'a@b.fr', 'Max', 'x', 'user', 1, '2026-01-01T00:00:00')"
    )
    conn.execute(
        "INSERT INTO instruments (id, symbol, name, asset_class, currency, is_fractionable) "
        "VALUES (1, 'AAPL', 'Apple Inc.', 'equity', 'USD', 0)"
    )
    conn.execute(
        "INSERT INTO investment_accounts (id, user_id, name, kind, currency, opened_on, "
        "archived) VALUES (1, 1, 'CTO', 'cto', 'EUR', NULL, 0)"
    )
    conn.execute(
        "INSERT INTO positions (id, user_id, investment_account_id, instrument_id) "
        "VALUES (1, 1, 1, 1)"
    )
    conn.execute(
        "INSERT INTO lots (id, user_id, position_id, quantity, unit_cost_cents, acquired_on) "
        "VALUES (1, 1, 1, '12.000000000000000000', 15000, '2026-01-15')"
    )
    conn.execute(
        "INSERT INTO api_keys (id, provider, value, created_at, last_used_at) "
        "VALUES (1, 'finnhub', 'gAAAA...', '2026-01-15T10:00:00', NULL)"
    )
    conn.execute(
        "INSERT INTO quota_windows (id, provider, window_started_at, used) "
        "VALUES (1, 'finnhub', '2026-01-15T10:00:00', 0)"
    )
    conn.commit()
    conn.close()

    command.downgrade(migration_db.config, PHASE_3_PREVIOUS)

    conn = _connect(migration_db)
    tables = {
        row[0]
        for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
    }
    indexes = {
        row[0]
        for row in conn.execute("SELECT name FROM sqlite_master WHERE type='index'").fetchall()
    }
    assert not (PHASE_3_TABLES & tables)
    for table in PHASE_3_TABLES:
        assert not any(name.startswith(f"ix_{table}") for name in indexes)
    # The previous revision's own tables and the pre-existing user survive.
    assert {"debts", "goals", "scenarios", "health_snapshots", "challenges", "users"} <= tables
    assert conn.execute("SELECT COUNT(*) FROM users").fetchone()[0] == 1
    conn.close()

    command.upgrade(migration_db.config, "head")
    conn = _connect(migration_db)
    tables = {
        row[0]
        for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
    }
    assert tables >= PHASE_3_TABLES
    conn.close()
