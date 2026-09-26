from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.config import settings
from app.db import Base, get_db
from app.main import app
from app.security import throttle

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture(autouse=True)
def secret_key_of_production_length(monkeypatch):
    """The configured default is 26 characters: PyJWT warns on every token
    signed with it, and `security.secret_guard` would refuse it in production.
    Tests sign with a key of the length `install.sh` generates."""
    monkeypatch.setattr(settings, "secret_key", "test-" + "0" * 59)


@pytest.fixture(autouse=True)
def fresh_login_throttle(monkeypatch):
    """The throttle is module state; a test must never inherit another's failures."""
    monkeypatch.setattr(throttle, "login_throttle", throttle.LoginThrottle())


@pytest.fixture(autouse=True)
def registration_open_for_tests(monkeypatch):
    """Most tests register several households to prove isolation. Registration
    ships closed after the first account; `test_registration_api` sets it back
    to False to test exactly that."""
    monkeypatch.setattr(settings, "registration_open", True)


@pytest.fixture
def db():
    """In-memory database, rebuilt for each test so tests never share state.

    StaticPool is mandatory here, not a tuning knob. An in-memory SQLite database
    lives inside its connection, and SQLAlchemy's default SingletonThreadPool gives
    each thread a different one — so a route running in TestClient's threadpool
    would see an empty database. StaticPool keeps a single connection for everyone.
    """
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    session: Session = factory()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(engine)
        engine.dispose()


@pytest.fixture
def client(db) -> TestClient:
    app.dependency_overrides[get_db] = lambda: db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


@pytest.fixture
def imported(client, tmp_path, monkeypatch):
    """A registered user with one account and the Boursorama sample already imported.

    Redirects settings.data_dir to a throwaway directory first: the import commit
    flow writes the uploaded file to disk, and tests must never touch the real
    backend/data/uploads directory.
    """
    monkeypatch.setattr(settings, "data_dir", tmp_path)
    settings.uploads_dir.mkdir(parents=True, exist_ok=True)

    registered = client.post("/api/auth/register", json={
        "name": "Max", "email": "max@example.com", "password": "motdepasse123"}).json()
    headers = {"Authorization": f"Bearer {registered['access_token']}"}
    account = client.post("/api/accounts", headers=headers,
                          json={"name": "Courant", "kind": "checking"}).json()
    with (FIXTURES / "boursorama.csv").open("rb") as handle:
        preview = client.post("/api/imports/analyze", headers=headers,
                              files={"file": ("b.csv", handle, "text/csv")},
                              data={"account_id": str(account["id"])}).json()
    client.post("/api/imports/commit", headers=headers, json={
        "upload_token": preview["upload_token"], "account_id": account["id"],
        "dialect": preview["dialect"], "mapping": preview["suggested_mapping"],
        "overrides": {}, "keep_duplicates": [],
    })
    return headers, account["id"]
