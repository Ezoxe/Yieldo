import concurrent.futures

from sqlalchemy import text


def test_wal_mode_is_enabled(db):
    mode = db.execute(text("PRAGMA journal_mode")).scalar()
    assert mode.lower() in ("wal", "memory")


def test_foreign_keys_are_enforced(db):
    assert db.execute(text("PRAGMA foreign_keys")).scalar() == 1


def test_db_fixture_is_visible_from_worker_threads(db):
    """Regression test for the `db` fixture's engine needing poolclass=StaticPool.

    FastAPI's TestClient dispatches sync path operations through anyio's
    threadpool — a different thread from the one pytest runs the test body on.
    For an in-memory SQLite database, the database lives inside its connection.
    SQLAlchemy's default SingletonThreadPool hands each thread a *different*
    raw connection, so a route running in the worker thread would see an empty
    database ("no such table"). poolclass=StaticPool keeps a single connection
    shared by every thread, which is what this test exercises directly instead
    of relying on a DB-backed route (none exist yet).
    """
    db.execute(text("CREATE TABLE regression_probe (id INTEGER PRIMARY KEY, value TEXT)"))
    db.execute(text("INSERT INTO regression_probe (value) VALUES ('present')"))
    db.commit()

    engine = db.get_bind()

    def read_from_worker_thread() -> str:
        with engine.connect() as connection:
            return connection.execute(text("SELECT value FROM regression_probe")).scalar()

    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
        value = executor.submit(read_from_worker_thread).result()

    assert value == "present"
