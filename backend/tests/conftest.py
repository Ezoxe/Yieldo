from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.config import settings
from app.db import Base, get_db
from app.main import app

FIXTURES = Path(__file__).parent / "fixtures"


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
