from sqlalchemy import text


def test_wal_mode_is_enabled(db):
    mode = db.execute(text("PRAGMA journal_mode")).scalar()
    assert mode.lower() in ("wal", "memory")


def test_foreign_keys_are_enforced(db):
    assert db.execute(text("PRAGMA foreign_keys")).scalar() == 1
