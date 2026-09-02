from collections.abc import Generator
from pathlib import Path

from sqlalchemy import Engine, create_engine, event
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker

from app.config import settings

# `backend/alembic/`, the same directory `tests/test_migrations.py` points its
# own Config at. Resolved from this file rather than from the working
# directory: `create_schema` below is called by scripts run from anywhere.
ALEMBIC_DIR = Path(__file__).resolve().parent.parent / "alembic"


class Base(DeclarativeBase):
    """Declarative base for all ORM models."""

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)


@event.listens_for(Engine, "connect")
def _configure_sqlite(dbapi_connection, _connection_record) -> None:
    """SQLite needs WAL and foreign key enforcement turned on per connection."""
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.execute("PRAGMA synchronous=NORMAL")
    cursor.close()


engine = create_engine(
    settings.database_url,
    connect_args={"check_same_thread": False},
    pool_pre_ping=True,
)

SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_db() -> Generator[Session, None, None]:
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


def stamp_alembic_head(target: Engine) -> str:
    """Write `target`'s `alembic_version` row at the current head, and return
    the revision written.

    **Stamps the engine it is given, never `settings.database_url`.**
    `alembic/env.py` overrides whatever URL a caller sets on the Config object
    (`config.set_main_option("sqlalchemy.url", settings.database_url)`), so
    driving this through `alembic.command.stamp` would silently stamp the
    configured database instead of the one just built -- which is a different
    database the moment a script or a test builds its own. Going through
    `MigrationContext` on an explicit connection is Alembic's own supported
    way to do exactly this and skips `env.py` entirely.

    The revision comes from the script directory, never from a constant here:
    a head hard-coded in Python goes stale the day the next migration lands,
    and stamping a database at a revision that is no longer the last one is
    the same unmigratable state by a slower route.

    Alembic is imported inside the function on purpose: it is migration
    tooling, and nothing in the serving path should pay for importing it.
    """
    from alembic.config import Config
    from alembic.runtime.migration import MigrationContext
    from alembic.script import ScriptDirectory

    config = Config()
    config.set_main_option("script_location", str(ALEMBIC_DIR))
    script = ScriptDirectory.from_config(config)
    head = script.get_current_head()
    if head is None:
        raise RuntimeError(
            f"Aucune révision Alembic n'a été trouvée dans {ALEMBIC_DIR} : "
            "impossible de marquer la base."
        )

    with target.begin() as connection:
        MigrationContext.configure(connection).stamp(script, "head")
    return head


def create_schema(target: Engine) -> str:
    """Build every table on `target` from the ORM models, then stamp it at the
    Alembic head -- and return that revision.

    `Base.metadata.create_all()` on its own leaves a database Alembic cannot
    migrate: no `alembic_version` row means Alembic reads it as being at
    revision zero and replays the entire history onto tables that already
    exist, so the next `alembic upgrade head` fails on the first CREATE TABLE.
    A database built outside the migrations still has to be one the migrations
    can take over, so the two steps belong together and this function is the
    only place they are done separately.

    For the local dev fixture and for tests. The deployed instance builds its
    schema through `alembic upgrade head` alone (`docker/entrypoint.sh`) and
    never calls this.
    """
    Base.metadata.create_all(target)
    return stamp_alembic_head(target)
