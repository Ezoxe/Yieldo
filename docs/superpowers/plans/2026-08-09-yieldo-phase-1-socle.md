# Yieldo Phase 1 — Socle : Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un utilisateur installe Yieldo en une commande, crée son compte, dépose un CSV bancaire en taggant lui-même les colonnes, et voit son historique financier catégorisé et navigable au jour, au mois et à l'année.

**Architecture:** Backend FastAPI + SQLAlchemy 2.0 sur SQLite en mode WAL, découpé en couches sans dépendance circulaire : `models` (ORM) → `engines` / `importers` (calcul pur, sans I/O) → `api` (routeurs REST). Frontend React 19 + TypeScript servi en statique par le même processus FastAPI. Un container Docker unique, piloté par `install.sh`.

**Tech Stack:** Python 3.12, FastAPI, SQLAlchemy 2.0, Alembic, Pydantic v2, argon2-cffi, PyJWT, cryptography, pytest. React 19, TypeScript 5.7, Vite 6, Tailwind CSS 4, Motion, ECharts 5, TanStack Query 5, React Router 7, Zustand, Vitest, Playwright.

## Global Constraints

- **Langue** : toute l'interface et tous les messages d'erreur destinés à l'utilisateur sont en français. Le code, les noms de variables, les commentaires et les messages de commit sont en anglais.
- **Montants** : stockés en **entiers de centimes** (`amount_cents: int`). Jamais de `float` sur une valeur monétaire, à aucun étage. La conversion en `Decimal` se fait uniquement à la frontière d'affichage.
- **Dates** : `datetime.date` en base, ISO-8601 (`YYYY-MM-DD`) dans tout JSON.
- **Isolation** : chaque requête sur une table métier filtre sur `user_id` via la dépendance `get_current_user`. Aucune route ne lit sans ce filtre.
- **Moteurs purs** : `app/engines/` et les modules d'analyse de fichier `app/importers/{dialect,mapping,parser,dedup}.py` sont constitués de fonctions pures — ni session de base de données, ni appel réseau, ni horloge implicite ; la date courante est toujours un paramètre. **Seule exception, explicite :** `app/importers/service.py` et `app/categorization/{seed,learning}.py` sont des couches d'orchestration et reçoivent une `Session`. Elles ne portent aucune règle de calcul : elles assemblent des fonctions pures et persistent le résultat.
- **Aucun échec silencieux** : pas de `except: pass`, pas de valeur de repli qui se ferait passer pour une donnée réelle.
- **Couleurs Abysse** : accent `#7ee2d6`, positif `#4fd6a8`, info `#3b82f6`, alerte `#f4a261`, négatif `#e5606b`.
- **Commits** : un par tâche, format Conventional Commits, en anglais.
- **Python 3.12 minimum**, **Node 22 minimum**.

## Notes d'exécution

**Ce que ce plan spécifie littéralement, et ce qu'il laisse au metteur en œuvre.**
Toute la logique — moteurs, importateurs, catégorisation, API, client HTTP,
formatage monétaire, cycle de vie ECharts — est donnée en code complet, avec
ses tests. Les composants purement présentationnels (`FilterBar`, `DropZone`,
`PreviewTable`, `DialectPanel`, `AppShell`, `OverviewPage`, `LoginPage`) sont
spécifiés par leurs tests et par une description de comportement plutôt que par
leur JSX intégral : leur rendu exact relève des compétences de design invoquées
au lot D, et figer leur balisage ici le contredirait. Le contrat que ces
composants doivent honorer est celui de leurs tests, qui sont, eux, écrits en
entier.

**Écran Réglages en phase 1.** La route `/reglages` existe dès la tâche 17 mais
ne contient que le strict nécessaire : changement de thème, densité
d'affichage, bascule des animations, déconnexion, et — pour un administrateur —
l'ouverture ou la fermeture des inscriptions. La gestion des clés API arrive en
phase 3, avec les intégrations de marché qu'elles servent.

**Ordre d'exécution.** Les tâches 1 à 14 forment une chaîne : chacune consomme
la précédente. Les tâches 15 à 20 dépendent du backend mais peuvent démarrer dès
la tâche 14. Les tâches 21 à 23 supposent les deux moitiés terminées.

---

## Structure des fichiers

**Backend** — `backend/app/`

| Fichier | Responsabilité |
|---|---|
| `config.py` | Réglages issus de l'environnement, instance `settings` unique |
| `db.py` | Moteur SQLAlchemy, `SessionLocal`, `Base`, dépendance `get_db` |
| `main.py` | Application FastAPI, montage des routeurs, service du SPA |
| `models/user.py` | `User` |
| `models/account.py` | `Account` |
| `models/category.py` | `Category` |
| `models/rule.py` | `CategoryRule` |
| `models/transaction.py` | `Transaction` |
| `models/import_batch.py` | `ImportBatch`, `ColumnProfile` |
| `security/passwords.py` | Hachage Argon2id |
| `security/tokens.py` | Émission et vérification JWT |
| `security/crypto.py` | Chiffrement Fernet des secrets |
| `security/deps.py` | `get_current_user`, `require_admin` |
| `importers/dialect.py` | Détection encodage, séparateur, décimale, format de date |
| `importers/mapping.py` | Rôles de colonnes, validation d'un mapping |
| `importers/parser.py` | Lignes brutes → transactions candidates |
| `importers/dedup.py` | Calcul de `dedup_hash` |
| `importers/service.py` | Orchestration prévisualisation / validation / annulation |
| `categorization/engine.py` | Application des règles, priorités |
| `categorization/seed.py` | Catégories et règles françaises préinstallées |
| `categorization/learning.py` | Création de règles depuis les corrections manuelles |
| `engines/aggregate.py` | Agrégation temporelle et par dimension |
| `api/*.py` | Un routeur par domaine |

**Frontend** — `frontend/src/`

| Dossier | Responsabilité |
|---|---|
| `design/tokens.css` | Variables CSS Abysse, clair et sombre |
| `design/glass/` | Primitives de surface : `GlassCard`, `GlassPanel`, `Sheen` |
| `design/motion/` | Variantes Motion partagées, respect de `prefers-reduced-motion` |
| `charts/` | Encapsulation ECharts : `<Chart>`, thème, hooks |
| `lib/api.ts` | Client HTTP typé, gestion du rafraîchissement de jeton |
| `features/auth/` | Connexion, inscription, garde de route |
| `features/import/` | Assistant d'import en quatre étapes |
| `features/transactions/` | Table, filtres, édition de catégorie |
| `features/overview/` | Tableau de bord |
| `app/` | Routage, layout, fournisseurs |

---

# Lot A — Fondations backend

### Task 1: Squelette backend, configuration, contrôle de santé

**Files:**
- Create: `backend/pyproject.toml`
- Create: `backend/app/__init__.py`
- Create: `backend/app/config.py`
- Create: `backend/app/main.py`
- Create: `backend/tests/__init__.py`
- Create: `backend/tests/conftest.py`
- Create: `backend/tests/test_health.py`

**Interfaces:**
- Consumes: rien.
- Produces: `app.config.settings` (instance `Settings`) avec les attributs `secret_key: str`, `database_url: str`, `data_dir: Path`, `access_token_minutes: int`, `refresh_token_days: int`, `registration_open: bool`, `cors_origins: list[str]`. `app.main.app` (instance `FastAPI`). Fixture pytest `client` renvoyant un `TestClient`.

- [ ] **Step 1: Créer `backend/pyproject.toml`**

```toml
[project]
name = "yieldo-backend"
version = "0.1.0"
requires-python = ">=3.12"
dependencies = [
    "fastapi>=0.115",
    "uvicorn[standard]>=0.34",
    "sqlalchemy>=2.0.36",
    "alembic>=1.14",
    "pydantic>=2.10",
    "pydantic-settings>=2.7",
    "argon2-cffi>=23.1",
    "pyjwt>=2.10",
    "cryptography>=44.0",
    "python-multipart>=0.0.20",
    "charset-normalizer>=3.4",
]

[project.optional-dependencies]
dev = ["pytest>=8.3", "pytest-cov>=6.0", "httpx>=0.28", "ruff>=0.9"]

[tool.pytest.ini_options]
testpaths = ["tests"]
pythonpath = ["."]

[tool.ruff]
line-length = 100
target-version = "py312"

[tool.ruff.lint]
select = ["E", "F", "I", "UP", "B", "SIM"]

[tool.ruff.lint.per-file-ignores]
# Alembic writes these; hand-editing generated migrations to satisfy a linter
# risks breaking a schema change for cosmetics.
"alembic/versions/*.py" = ["E501", "I001", "UP035", "UP007"]
# FastAPI's dependency injection is expressed through call defaults by design.
"app/api/*.py" = ["B008"]
```

- [ ] **Step 2: Écrire le test qui échoue**

Créer `backend/tests/test_health.py` :

```python
def test_health_returns_ok(client):
    response = client.get("/api/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["version"] == "0.1.0"


def test_unknown_api_route_returns_404(client):
    assert client.get("/api/does-not-exist").status_code == 404
```

Créer `backend/tests/conftest.py` :

```python
import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)
```

- [ ] **Step 3: Lancer le test pour vérifier qu'il échoue**

Run: `cd backend && pytest tests/test_health.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app'`

- [ ] **Step 4: Écrire `backend/app/config.py`**

```python
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings, sourced from environment variables."""

    model_config = SettingsConfigDict(env_prefix="YIELDO_", env_file=".env", extra="ignore")

    secret_key: str = "dev-insecure-key-change-me"
    data_dir: Path = Path("./data")
    access_token_minutes: int = 30
    refresh_token_days: int = 30
    registration_open: bool = True
    cors_origins: list[str] = ["http://localhost:5173"]
    version: str = "0.1.0"

    @property
    def database_url(self) -> str:
        return f"sqlite:///{self.data_dir / 'yieldo.db'}"

    @property
    def uploads_dir(self) -> Path:
        return self.data_dir / "uploads"


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    settings.uploads_dir.mkdir(parents=True, exist_ok=True)
    return settings


settings = get_settings()
```

- [ ] **Step 5: Écrire `backend/app/main.py`**

```python
from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings

app = FastAPI(title="Yieldo", version=settings.version, docs_url="/api/docs",
              openapi_url="/api/openapi.json")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

api = APIRouter(prefix="/api")


@api.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "version": settings.version}


app.include_router(api)
```

Créer `backend/app/__init__.py` et `backend/tests/__init__.py` vides.

- [ ] **Step 6: Lancer les tests**

Run: `cd backend && pip install -e ".[dev]" && pytest -v`
Expected: 2 tests PASS

- [ ] **Step 7: Commit**

```bash
git add backend/
git commit -m "feat(backend): scaffold FastAPI app with settings and health endpoint"
```

---

### Task 2: Base de données, session, migrations Alembic

**Files:**
- Create: `backend/app/db.py`
- Create: `backend/alembic.ini`
- Create: `backend/alembic/env.py`
- Create: `backend/alembic/script.py.mako`
- Modify: `backend/tests/conftest.py`
- Create: `backend/tests/test_db.py`

**Interfaces:**
- Consumes: `app.config.settings`.
- Produces: `app.db.Base` (classe de base déclarative avec `id: Mapped[int]` primaire auto-incrémentée), `app.db.engine`, `app.db.SessionLocal`, `app.db.get_db` (dépendance FastAPI produisant une `Session`). Fixture pytest `db` (session sur base en mémoire, annulée après chaque test) et fixture `client` reconfigurée pour surcharger `get_db`.

- [ ] **Step 1: Écrire le test qui échoue**

Créer `backend/tests/test_db.py` :

```python
from sqlalchemy import text


def test_wal_mode_is_enabled(db):
    mode = db.execute(text("PRAGMA journal_mode")).scalar()
    assert mode.lower() in ("wal", "memory")


def test_foreign_keys_are_enforced(db):
    assert db.execute(text("PRAGMA foreign_keys")).scalar() == 1
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `cd backend && pytest tests/test_db.py -v`
Expected: FAIL — fixture `db` introuvable

- [ ] **Step 3: Écrire `backend/app/db.py`**

```python
from collections.abc import Generator

from sqlalchemy import Engine, create_engine, event
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker

from app.config import settings


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
```

- [ ] **Step 4: Remplacer `backend/tests/conftest.py`**

```python
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.db import Base, get_db
from app.main import app


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
```

- [ ] **Step 5: Initialiser Alembic**

Run: `cd backend && alembic init -t generic alembic`

Puis remplacer la section `target_metadata` de `backend/alembic/env.py` :

```python
from app.config import settings
from app.db import Base
from app.models import *  # noqa: F401,F403 — import registers every model on Base

config.set_main_option("sqlalchemy.url", settings.database_url)
target_metadata = Base.metadata
```

Et dans `alembic.ini`, vider la ligne `sqlalchemy.url =` (elle est fournie par `env.py`).

- [ ] **Step 6: Lancer les tests**

Run: `cd backend && pytest -v`
Expected: 4 tests PASS

- [ ] **Step 7: Commit**

```bash
git add backend/
git commit -m "feat(backend): add SQLAlchemy engine, session factory, and Alembic setup"
```

---

### Task 3: Sécurité — mots de passe, jetons, chiffrement des secrets

**Files:**
- Create: `backend/app/security/__init__.py`
- Create: `backend/app/security/passwords.py`
- Create: `backend/app/security/tokens.py`
- Create: `backend/app/security/crypto.py`
- Create: `backend/tests/test_security.py`

**Interfaces:**
- Consumes: `app.config.settings`.
- Produces:
  - `hash_password(plain: str) -> str`
  - `verify_password(plain: str, hashed: str) -> bool`
  - `needs_rehash(hashed: str) -> bool`
  - `create_access_token(user_id: int) -> str`
  - `create_refresh_token(user_id: int) -> str`
  - `decode_token(token: str, expected_type: str) -> int` — renvoie l'identifiant utilisateur, lève `TokenError` si invalide, expiré, ou du mauvais type
  - `TokenError(Exception)`
  - `encrypt_secret(plain: str) -> str`, `decrypt_secret(blob: str) -> str`

- [ ] **Step 1: Écrire le test qui échoue**

Créer `backend/tests/test_security.py` :

```python
import time

import pytest

from app.security.crypto import decrypt_secret, encrypt_secret
from app.security.passwords import hash_password, verify_password
from app.security.tokens import TokenError, create_access_token, create_refresh_token, decode_token


def test_password_hash_is_argon2id_and_verifies():
    hashed = hash_password("correct horse battery staple")
    assert hashed.startswith("$argon2id$")
    assert verify_password("correct horse battery staple", hashed) is True
    assert verify_password("wrong password", hashed) is False


def test_password_hash_is_salted_per_call():
    assert hash_password("same") != hash_password("same")


def test_access_token_round_trips_user_id():
    token = create_access_token(42)
    assert decode_token(token, expected_type="access") == 42


def test_access_token_rejected_when_used_as_refresh():
    token = create_access_token(42)
    with pytest.raises(TokenError):
        decode_token(token, expected_type="refresh")


def test_refresh_token_round_trips_user_id():
    assert decode_token(create_refresh_token(7), expected_type="refresh") == 7


def test_tampered_token_is_rejected():
    token = create_access_token(1)
    with pytest.raises(TokenError):
        decode_token(token[:-3] + "aaa", expected_type="access")


def test_expired_token_is_rejected(monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "access_token_minutes", 0)
    token = create_access_token(1)
    time.sleep(1.1)
    with pytest.raises(TokenError):
        decode_token(token, expected_type="access")


def test_secret_round_trips_and_ciphertext_differs_from_plaintext():
    blob = encrypt_secret("finnhub-key-abc123")
    assert blob != "finnhub-key-abc123"
    assert decrypt_secret(blob) == "finnhub-key-abc123"
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `cd backend && pytest tests/test_security.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.security'`

- [ ] **Step 3: Écrire `backend/app/security/passwords.py`**

```python
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError

# Tuned for interactive login on a modest self-hosted machine: ~64 MiB, ~50 ms.
_hasher = PasswordHasher(time_cost=2, memory_cost=65536, parallelism=2)


def hash_password(plain: str) -> str:
    return _hasher.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    """Return False for a wrong password and for an unusable stored hash alike.

    VerificationError covers VerifyMismatchError plus the generic failures argon2
    raises when a hash has a valid prefix but a damaged body — truncation in the
    database, an encoding accident. Those must refuse the login, not raise a 500.
    """
    try:
        return _hasher.verify(hashed, plain)
    except (VerificationError, InvalidHashError):
        return False


def needs_rehash(hashed: str) -> bool:
    """True when the stored hash was made with weaker parameters than the current ones."""
    return _hasher.check_needs_rehash(hashed)
```

- [ ] **Step 4: Écrire `backend/app/security/tokens.py`**

```python
from datetime import UTC, datetime, timedelta

import jwt

from app.config import settings

_ALGORITHM = "HS256"


class TokenError(Exception):
    """Raised when a token is missing, malformed, expired, or of the wrong type."""


def _create(user_id: int, token_type: str, lifetime: timedelta) -> str:
    now = datetime.now(UTC)
    payload = {
        "sub": str(user_id),
        "type": token_type,
        "iat": int(now.timestamp()),
        "exp": int((now + lifetime).timestamp()),
    }
    return jwt.encode(payload, settings.secret_key, algorithm=_ALGORITHM)


def create_access_token(user_id: int) -> str:
    return _create(user_id, "access", timedelta(minutes=settings.access_token_minutes))


def create_refresh_token(user_id: int) -> str:
    return _create(user_id, "refresh", timedelta(days=settings.refresh_token_days))


def decode_token(token: str, expected_type: str) -> int:
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[_ALGORITHM])
    except jwt.PyJWTError as exc:
        raise TokenError("Jeton invalide ou expiré") from exc
    if payload.get("type") != expected_type:
        raise TokenError("Type de jeton inattendu")
    try:
        return int(payload["sub"])
    except (KeyError, TypeError, ValueError) as exc:
        raise TokenError("Jeton sans identifiant utilisateur exploitable") from exc
```

- [ ] **Step 5: Écrire `backend/app/security/crypto.py`**

```python
import base64
import hashlib

from cryptography.fernet import Fernet, InvalidToken

from app.config import settings


class SecretDecryptionError(Exception):
    """Raised when a stored secret cannot be decrypted with the current SECRET_KEY."""


def _fernet() -> Fernet:
    """Derive a stable Fernet key from SECRET_KEY.

    Changing SECRET_KEY makes every previously stored secret unreadable — this is
    documented in the spec and surfaced to the operator by install.sh.
    """
    digest = hashlib.sha256(settings.secret_key.encode()).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def encrypt_secret(plain: str) -> str:
    return _fernet().encrypt(plain.encode()).decode()


def decrypt_secret(blob: str) -> str:
    try:
        return _fernet().decrypt(blob.encode()).decode()
    except InvalidToken as exc:
        raise SecretDecryptionError(
            "Secret illisible — la clé de chiffrement a probablement changé"
        ) from exc
```

Créer `backend/app/security/__init__.py` vide.

- [ ] **Step 6: Lancer les tests**

Run: `cd backend && pytest tests/test_security.py -v`
Expected: 8 tests PASS

- [ ] **Step 7: Commit**

```bash
git add backend/
git commit -m "feat(backend): add Argon2id hashing, JWT tokens, and Fernet secret encryption"
```

---

### Task 4: Modèles utilisateur, compte, catégorie — et catégories françaises préinstallées

**Files:**
- Create: `backend/app/models/__init__.py`
- Create: `backend/app/models/user.py`
- Create: `backend/app/models/account.py`
- Create: `backend/app/models/category.py`
- Create: `backend/app/categorization/__init__.py`
- Create: `backend/app/categorization/seed.py`
- Create: `backend/tests/test_models.py`
- Create: `backend/tests/test_seed_categories.py`

**Interfaces:**
- Consumes: `app.db.Base`.
- Produces:
  - `User(id, email, name, password_hash, role, is_active, created_at)` — `role` vaut `"admin"` ou `"user"`, `email` unique et insensible à la casse
  - `Account(id, user_id, name, kind, currency, opening_balance_cents, opened_on, include_in_net_worth, archived)` — `kind` ∈ `checking, savings, pea, life_insurance, per, brokerage, crypto, real_estate, loan, cash`
  - `Category(id, user_id, parent_id, name, slug, color, icon, monthly_budget_cents, kind, position)` — `kind` ∈ `expense, income, transfer`
  - `seed_categories(db: Session, user_id: int) -> dict[str, Category]` — crée l'arborescence française et renvoie un index par `slug`

- [ ] **Step 1: Écrire les tests qui échouent**

Créer `backend/tests/test_models.py` :

```python
import pytest
from sqlalchemy.exc import IntegrityError

from app.models import Account, Category, User


def test_user_email_is_unique_case_insensitively(db):
    db.add(User(email="max@example.com", name="Max", password_hash="x"))
    db.commit()
    db.add(User(email="MAX@EXAMPLE.COM", name="Autre", password_hash="y"))
    with pytest.raises(IntegrityError):
        db.commit()


def test_user_defaults_to_non_admin_active(db):
    user = User(email="a@b.c", name="A", password_hash="x")
    db.add(user)
    db.commit()
    assert user.role == "user"
    assert user.is_active is True
    assert user.created_at is not None


def test_account_belongs_to_user_and_defaults_to_euro(db):
    user = User(email="a@b.c", name="A", password_hash="x")
    db.add(user)
    db.commit()
    account = Account(user_id=user.id, name="Compte courant", kind="checking")
    db.add(account)
    db.commit()
    assert account.currency == "EUR"
    assert account.opening_balance_cents == 0
    assert account.include_in_net_worth is True


def test_category_supports_two_level_hierarchy(db):
    user = User(email="a@b.c", name="A", password_hash="x")
    db.add(user)
    db.commit()
    parent = Category(user_id=user.id, name="Logement", slug="logement", kind="expense")
    db.add(parent)
    db.commit()
    child = Category(user_id=user.id, parent_id=parent.id, name="Loyer",
                     slug="logement-loyer", kind="expense")
    db.add(child)
    db.commit()
    db.refresh(parent)
    assert [c.name for c in parent.children] == ["Loyer"]
    assert child.parent.name == "Logement"


def test_category_slug_is_unique_per_user_not_globally(db):
    first = User(email="a@b.c", name="A", password_hash="x")
    second = User(email="d@e.f", name="B", password_hash="y")
    db.add_all([first, second])
    db.commit()
    db.add(Category(user_id=first.id, name="Loyer", slug="loyer", kind="expense"))
    db.add(Category(user_id=second.id, name="Loyer", slug="loyer", kind="expense"))
    db.commit()  # must not raise — slugs are scoped to a user
```

Créer `backend/tests/test_seed_categories.py` :

```python
from app.categorization.seed import seed_categories
from app.models import Category, User


def test_seed_creates_french_tree_scoped_to_user(db):
    user = User(email="a@b.c", name="A", password_hash="x")
    db.add(user)
    db.commit()

    index = seed_categories(db, user.id)

    assert "alimentation" in index
    assert "alimentation-courses" in index
    assert index["alimentation-courses"].parent_id == index["alimentation"].id
    assert index["revenus-salaire"].kind == "income"
    assert index["virement-interne"].kind == "transfer"
    assert all(c.user_id == user.id for c in db.query(Category).all())


def test_seed_is_idempotent(db):
    user = User(email="a@b.c", name="A", password_hash="x")
    db.add(user)
    db.commit()

    seed_categories(db, user.id)
    count_after_first = db.query(Category).count()
    seed_categories(db, user.id)

    assert db.query(Category).count() == count_after_first
```

- [ ] **Step 2: Lancer les tests pour vérifier qu'ils échouent**

Run: `cd backend && pytest tests/test_models.py tests/test_seed_categories.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.models'`

- [ ] **Step 3: Écrire `backend/app/models/user.py`**

```python
from datetime import UTC, datetime

from sqlalchemy import Boolean, DateTime, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


class User(Base):
    __tablename__ = "users"

    email: Mapped[str] = mapped_column(String(320), unique=True, index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(16), default="user", nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False
    )

    accounts = relationship("Account", back_populates="user", cascade="all, delete-orphan")
    categories = relationship("Category", back_populates="user", cascade="all, delete-orphan")
```

Le caractère insensible à la casse vient de la collation `NOCASE` posée par la migration. Pour que le test en mémoire passe sans migration, ajouter dans le même fichier :

```python
from sqlalchemy import event


@event.listens_for(User.__table__, "after_parent_attach")
def _use_nocase_email(table, _parent):
    table.c.email.type = String(320, collation="NOCASE")
```

- [ ] **Step 4: Écrire `backend/app/models/account.py`**

```python
from datetime import date

from sqlalchemy import Boolean, Date, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base

ACCOUNT_KINDS = (
    "checking", "savings", "pea", "life_insurance", "per",
    "brokerage", "crypto", "real_estate", "loan", "cash",
)


class Account(Base):
    __tablename__ = "accounts"

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    currency: Mapped[str] = mapped_column(String(3), default="EUR", nullable=False)
    opening_balance_cents: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    opened_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    include_in_net_worth: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    archived: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    user = relationship("User", back_populates="accounts")
    transactions = relationship("Transaction", back_populates="account",
                               cascade="all, delete-orphan")
```

- [ ] **Step 5: Écrire `backend/app/models/category.py`**

```python
from sqlalchemy import ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base

CATEGORY_KINDS = ("expense", "income", "transfer")


class Category(Base):
    __tablename__ = "categories"
    __table_args__ = (UniqueConstraint("user_id", "slug", name="uq_category_user_slug"),)

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    parent_id: Mapped[int | None] = mapped_column(
        ForeignKey("categories.id", ondelete="CASCADE"), nullable=True
    )
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    slug: Mapped[str] = mapped_column(String(80), nullable=False)
    kind: Mapped[str] = mapped_column(String(16), default="expense", nullable=False)
    color: Mapped[str] = mapped_column(String(9), default="#7ee2d6", nullable=False)
    icon: Mapped[str] = mapped_column(String(40), default="circle", nullable=False)
    monthly_budget_cents: Mapped[int | None] = mapped_column(Integer, nullable=True)
    position: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    user = relationship("User", back_populates="categories")
    parent = relationship("Category", remote_side="Category.id", back_populates="children")
    children = relationship("Category", back_populates="parent", cascade="all, delete-orphan")
```

Écrire `backend/app/models/__init__.py` :

```python
from app.models.account import ACCOUNT_KINDS, Account
from app.models.category import CATEGORY_KINDS, Category
from app.models.user import User

__all__ = ["ACCOUNT_KINDS", "CATEGORY_KINDS", "Account", "Category", "User"]
```

- [ ] **Step 6: Écrire `backend/app/categorization/seed.py`**

```python
from sqlalchemy.orm import Session

from app.models import Category

# (slug, name, kind, color, icon, [(child_slug, child_name), ...])
CATEGORY_TREE: list[tuple[str, str, str, str, str, list[tuple[str, str]]]] = [
    ("logement", "Logement", "expense", "#8ab4f8", "home", [
        ("logement-loyer", "Loyer"),
        ("logement-credit", "Crédit immobilier"),
        ("logement-charges", "Charges et copropriété"),
        ("logement-energie", "Énergie"),
        ("logement-internet", "Internet et téléphone"),
        ("logement-assurance", "Assurance habitation"),
        ("logement-travaux", "Travaux et entretien"),
    ]),
    ("alimentation", "Alimentation", "expense", "#4fd6a8", "shopping-cart", [
        ("alimentation-courses", "Courses"),
        ("alimentation-restaurant", "Restaurants"),
        ("alimentation-livraison", "Livraison"),
        ("alimentation-cafe", "Cafés et bars"),
    ]),
    ("transport", "Transport", "expense", "#f4a261", "car", [
        ("transport-carburant", "Carburant"),
        ("transport-entretien", "Entretien véhicule"),
        ("transport-assurance", "Assurance véhicule"),
        ("transport-peage", "Péage et stationnement"),
        ("transport-commun", "Transports en commun"),
        ("transport-voyage", "Billets et voyages"),
    ]),
    ("sante", "Santé", "expense", "#e5606b", "heart", [
        ("sante-medecin", "Consultations"),
        ("sante-pharmacie", "Pharmacie"),
        ("sante-mutuelle", "Mutuelle"),
        ("sante-optique", "Optique et dentaire"),
    ]),
    ("loisirs", "Loisirs", "expense", "#a78bfa", "sparkles", [
        ("loisirs-sorties", "Sorties et culture"),
        ("loisirs-sport", "Sport"),
        ("loisirs-vacances", "Vacances"),
        ("loisirs-hobbies", "Loisirs et hobbies"),
    ]),
    ("abonnements", "Abonnements", "expense", "#7ee2d6", "repeat", [
        ("abonnements-streaming", "Streaming"),
        ("abonnements-logiciels", "Logiciels et services"),
        ("abonnements-presse", "Presse"),
        ("abonnements-salle", "Salle de sport"),
    ]),
    ("achats", "Achats", "expense", "#fb7185", "bag", [
        ("achats-vetements", "Vêtements"),
        ("achats-equipement", "Équipement et high-tech"),
        ("achats-maison", "Maison et décoration"),
        ("achats-cadeaux", "Cadeaux"),
    ]),
    ("famille", "Famille", "expense", "#f472b6", "users", [
        ("famille-garde", "Garde d'enfants"),
        ("famille-scolarite", "Scolarité"),
        ("famille-animaux", "Animaux"),
    ]),
    ("impots", "Impôts et taxes", "expense", "#94a3b8", "receipt", [
        ("impots-revenu", "Impôt sur le revenu"),
        ("impots-fonciere", "Taxe foncière"),
        ("impots-habitation", "Taxe d'habitation"),
        ("impots-autres", "Autres prélèvements"),
    ]),
    ("frais", "Frais bancaires", "expense", "#64748b", "bank", [
        ("frais-tenue", "Frais de tenue de compte"),
        ("frais-agios", "Agios et incidents"),
        ("frais-carte", "Cotisation carte"),
    ]),
    ("divers", "Divers", "expense", "#64748b", "dots", []),
    ("revenus", "Revenus", "income", "#4fd6a8", "trending-up", [
        ("revenus-salaire", "Salaire"),
        ("revenus-primes", "Primes"),
        ("revenus-freelance", "Activité indépendante"),
        ("revenus-allocations", "Allocations et aides"),
        ("revenus-loyers", "Loyers perçus"),
        ("revenus-placements", "Revenus de placements"),
        ("revenus-remboursements", "Remboursements"),
        ("revenus-autres", "Autres revenus"),
    ]),
    ("epargne", "Épargne et investissement", "transfer", "#3b82f6", "piggy-bank", [
        ("epargne-livret", "Versement livret"),
        ("epargne-bourse", "Versement titres"),
        ("epargne-assurance-vie", "Versement assurance-vie"),
        ("epargne-per", "Versement PER"),
    ]),
    ("virement-interne", "Virement interne", "transfer", "#64748b", "arrows", []),
]


def seed_categories(db: Session, user_id: int) -> dict[str, Category]:
    """Create the default French category tree for a user. Safe to call twice."""
    existing = {c.slug: c for c in db.query(Category).filter(Category.user_id == user_id).all()}
    index: dict[str, Category] = dict(existing)

    for position, (slug, name, kind, color, icon, children) in enumerate(CATEGORY_TREE):
        parent = index.get(slug)
        if parent is None:
            parent = Category(user_id=user_id, name=name, slug=slug, kind=kind,
                              color=color, icon=icon, position=position)
            db.add(parent)
            db.flush()
            index[slug] = parent

        for child_position, (child_slug, child_name) in enumerate(children):
            if child_slug in index:
                continue
            child = Category(user_id=user_id, parent_id=parent.id, name=child_name,
                             slug=child_slug, kind=kind, color=color, icon=icon,
                             position=child_position)
            db.add(child)
            db.flush()
            index[child_slug] = child

    db.commit()
    return index
```

Créer `backend/app/categorization/__init__.py` vide.

- [ ] **Step 7: Lancer les tests**

Run: `cd backend && pytest -v`
Expected: tous PASS (7 nouveaux tests)

- [ ] **Step 8: Générer la migration initiale**

Run: `cd backend && alembic revision --autogenerate -m "users, accounts, categories"`

Ouvrir le fichier généré sous `alembic/versions/` et vérifier que la colonne `email` porte bien `sa.String(320, collation="NOCASE")`. La corriger à la main sinon.

Run: `cd backend && alembic upgrade head`
Expected: la table `users` existe dans `data/yieldo.db`

- [ ] **Step 9: Commit**

```bash
git add backend/
git commit -m "feat(backend): add user, account, category models with French category seed"
```

---

### Task 5: API d'authentification et isolation par utilisateur

**Files:**
- Create: `backend/app/schemas/__init__.py`
- Create: `backend/app/schemas/auth.py`
- Create: `backend/app/security/deps.py`
- Create: `backend/app/api/__init__.py`
- Create: `backend/app/api/auth.py`
- Modify: `backend/app/main.py`
- Create: `backend/tests/test_auth_api.py`

**Interfaces:**
- Consumes: `User`, `hash_password`, `verify_password`, `create_access_token`, `create_refresh_token`, `decode_token`, `TokenError`, `seed_categories`, `get_db`.
- Produces:
  - `get_current_user(request, db) -> User` — dépendance FastAPI ; lit `Authorization: Bearer <access>` ; lève 401 sinon
  - `require_admin(user = Depends(get_current_user)) -> User`
  - Routes : `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/refresh`, `POST /api/auth/logout`, `GET /api/auth/me`
  - Schémas : `RegisterIn(name, email, password)`, `LoginIn(email, password)`, `TokenOut(access_token, token_type, user)`, `UserOut(id, email, name, role)`
- Le jeton de rafraîchissement voyage en cookie `HttpOnly`, `SameSite=Strict`, nommé `yieldo_refresh`. Le jeton d'accès n'est jamais stocké côté navigateur autrement qu'en mémoire.

- [ ] **Step 1: Écrire les tests qui échouent**

Créer `backend/tests/test_auth_api.py` :

```python
def test_first_registered_user_becomes_admin(client):
    response = client.post("/api/auth/register", json={
        "name": "Max", "email": "max@example.com", "password": "motdepasse123"})
    assert response.status_code == 201
    assert response.json()["user"]["role"] == "admin"


def test_second_registered_user_is_not_admin(client):
    client.post("/api/auth/register", json={
        "name": "Max", "email": "max@example.com", "password": "motdepasse123"})
    response = client.post("/api/auth/register", json={
        "name": "Lea", "email": "lea@example.com", "password": "motdepasse123"})
    assert response.json()["user"]["role"] == "user"


def test_register_seeds_categories_for_the_new_user(client, db):
    from app.models import Category, User

    client.post("/api/auth/register", json={
        "name": "Max", "email": "max@example.com", "password": "motdepasse123"})
    user = db.query(User).filter(User.email == "max@example.com").one()
    slugs = {c.slug for c in db.query(Category).filter(Category.user_id == user.id).all()}
    assert {"alimentation", "alimentation-courses", "revenus-salaire"} <= slugs


def test_register_rejects_duplicate_email(client):
    payload = {"name": "Max", "email": "max@example.com", "password": "motdepasse123"}
    client.post("/api/auth/register", json=payload)
    response = client.post("/api/auth/register", json=payload)
    assert response.status_code == 409
    assert "existe déjà" in response.json()["detail"]


def test_register_rejects_short_password(client):
    response = client.post("/api/auth/register", json={
        "name": "Max", "email": "max@example.com", "password": "court"})
    assert response.status_code == 422


def test_login_returns_access_token_and_refresh_cookie(client):
    client.post("/api/auth/register", json={
        "name": "Max", "email": "max@example.com", "password": "motdepasse123"})
    response = client.post("/api/auth/login", json={
        "email": "MAX@example.com", "password": "motdepasse123"})
    assert response.status_code == 200
    assert response.json()["access_token"]
    assert "yieldo_refresh" in response.cookies


def test_login_rejects_wrong_password_without_leaking_which_field(client):
    client.post("/api/auth/register", json={
        "name": "Max", "email": "max@example.com", "password": "motdepasse123"})
    response = client.post("/api/auth/login", json={
        "email": "max@example.com", "password": "mauvais-mot-de-passe"})
    assert response.status_code == 401
    assert response.json()["detail"] == "Identifiants invalides"


def test_login_rejects_unknown_email_with_identical_message(client):
    response = client.post("/api/auth/login", json={
        "email": "inconnu@example.com", "password": "motdepasse123"})
    assert response.status_code == 401
    assert response.json()["detail"] == "Identifiants invalides"


def test_me_requires_authentication(client):
    assert client.get("/api/auth/me").status_code == 401


def test_me_returns_the_authenticated_user(client):
    registered = client.post("/api/auth/register", json={
        "name": "Max", "email": "max@example.com", "password": "motdepasse123"}).json()
    response = client.get("/api/auth/me", headers={
        "Authorization": f"Bearer {registered['access_token']}"})
    assert response.json()["email"] == "max@example.com"


def test_refresh_token_cannot_be_used_as_access_token(client):
    client.post("/api/auth/register", json={
        "name": "Max", "email": "max@example.com", "password": "motdepasse123"})
    login = client.post("/api/auth/login", json={
        "email": "max@example.com", "password": "motdepasse123"})
    refresh = login.cookies["yieldo_refresh"]
    response = client.get("/api/auth/me", headers={"Authorization": f"Bearer {refresh}"})
    assert response.status_code == 401


def test_refresh_issues_a_new_access_token(client):
    client.post("/api/auth/register", json={
        "name": "Max", "email": "max@example.com", "password": "motdepasse123"})
    client.post("/api/auth/login", json={
        "email": "max@example.com", "password": "motdepasse123"})
    response = client.post("/api/auth/refresh")
    assert response.status_code == 200
    assert response.json()["access_token"]


def test_registration_can_be_closed(client, monkeypatch):
    from app.config import settings

    client.post("/api/auth/register", json={
        "name": "Max", "email": "max@example.com", "password": "motdepasse123"})
    monkeypatch.setattr(settings, "registration_open", False)
    response = client.post("/api/auth/register", json={
        "name": "Lea", "email": "lea@example.com", "password": "motdepasse123"})
    assert response.status_code == 403
```

- [ ] **Step 2: Lancer les tests pour vérifier qu'ils échouent**

Run: `cd backend && pytest tests/test_auth_api.py -v`
Expected: FAIL — 404 sur toutes les routes

- [ ] **Step 3: Écrire `backend/app/schemas/auth.py`**

```python
from pydantic import BaseModel, ConfigDict, EmailStr, Field


class RegisterIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    email: EmailStr
    password: str = Field(min_length=8, max_length=200)


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    email: str
    name: str
    role: str


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut
```

Créer `backend/app/schemas/__init__.py` :

```python
from app.schemas.auth import LoginIn, RegisterIn, TokenOut, UserOut

__all__ = ["LoginIn", "RegisterIn", "TokenOut", "UserOut"]
```

- [ ] **Step 4: Écrire `backend/app/security/deps.py`**

```python
from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import User
from app.security.tokens import TokenError, decode_token

_UNAUTHORIZED = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Authentification requise",
    headers={"WWW-Authenticate": "Bearer"},
)


def get_current_user(request: Request, db: Session = Depends(get_db)) -> User:
    header = request.headers.get("Authorization", "")
    scheme, _, token = header.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise _UNAUTHORIZED
    try:
        user_id = decode_token(token, expected_type="access")
    except TokenError as exc:
        raise _UNAUTHORIZED from exc
    user = db.get(User, user_id)
    if user is None or not user.is_active:
        raise _UNAUTHORIZED
    return user


def require_admin(user: User = Depends(get_current_user)) -> User:
    if user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                            detail="Droits administrateur requis")
    return user
```

- [ ] **Step 5: Écrire `backend/app/api/auth.py`**

```python
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.categorization.seed import seed_categories
from app.config import settings
from app.db import get_db
from app.models import User
from app.schemas.auth import LoginIn, RegisterIn, TokenOut, UserOut
from app.security.deps import get_current_user
from app.security.passwords import hash_password, verify_password
from app.security.tokens import TokenError, create_access_token, create_refresh_token, decode_token

router = APIRouter(prefix="/auth", tags=["auth"])

REFRESH_COOKIE = "yieldo_refresh"


def _invalid_credentials() -> HTTPException:
    """A fresh exception per call — a shared instance would have its __cause__
    rewritten by concurrent requests."""
    return HTTPException(status_code=status.HTTP_401_UNAUTHORIZED,
                         detail="Identifiants invalides")


# Hashed once at import. Verifying against this costs the same as verifying against
# a real hash, so an unknown email and a wrong password take the same work. Hashing
# per request instead would cost an EXTRA Argon2 operation on the unknown-email path
# and hand an attacker a timing oracle for enumerating accounts.
_DUMMY_HASH = hash_password("timing-equalizer")


def _set_refresh_cookie(response: Response, user_id: int) -> None:
    response.set_cookie(
        REFRESH_COOKIE,
        create_refresh_token(user_id),
        httponly=True,
        samesite="strict",
        secure=False,  # self-hosted deployments often run behind plain HTTP on a LAN
        max_age=settings.refresh_token_days * 86400,
        path="/api/auth",
    )


@router.post("/register", response_model=TokenOut, status_code=status.HTTP_201_CREATED)
def register(payload: RegisterIn, response: Response, db: Session = Depends(get_db)) -> TokenOut:
    # BEGIN IMMEDIATE takes SQLite's write lock before the count, so two concurrent
    # registrations cannot both observe an empty table and both become admin.
    db.execute(text("BEGIN IMMEDIATE"))
    is_first_user = db.query(User).count() == 0
    if not is_first_user and not settings.registration_open:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                            detail="Les inscriptions sont fermées")

    email = payload.email.strip().lower()
    if db.query(User).filter(User.email == email).first() is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                            detail="Un compte avec cet email existe déjà")

    user = User(
        email=email,
        name=payload.name.strip(),
        password_hash=hash_password(payload.password),
        role="admin" if is_first_user else "user",
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    seed_categories(db, user.id)

    _set_refresh_cookie(response, user.id)
    return TokenOut(access_token=create_access_token(user.id), user=UserOut.model_validate(user))


@router.post("/login", response_model=TokenOut)
def login(payload: LoginIn, response: Response, db: Session = Depends(get_db)) -> TokenOut:
    user = db.query(User).filter(User.email == payload.email.strip().lower()).first()
    # Exactly one Argon2 verification on every path, against a precomputed dummy
    # when the account does not exist, so the two failures are indistinguishable
    # from the outside.
    stored_hash = user.password_hash if user else _DUMMY_HASH
    password_ok = verify_password(payload.password, stored_hash)
    if user is None or not user.is_active or not password_ok:
        raise _invalid_credentials()

    _set_refresh_cookie(response, user.id)
    return TokenOut(access_token=create_access_token(user.id), user=UserOut.model_validate(user))


@router.post("/refresh", response_model=TokenOut)
def refresh(request: Request, response: Response, db: Session = Depends(get_db)) -> TokenOut:
    token = request.cookies.get(REFRESH_COOKIE)
    if not token:
        raise _invalid_credentials()
    try:
        user_id = decode_token(token, expected_type="refresh")
    except TokenError as exc:
        raise _invalid_credentials() from exc
    user = db.get(User, user_id)
    if user is None or not user.is_active:
        raise _invalid_credentials()

    _set_refresh_cookie(response, user.id)
    return TokenOut(access_token=create_access_token(user.id), user=UserOut.model_validate(user))


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(response: Response) -> None:
    response.delete_cookie(REFRESH_COOKIE, path="/api/auth")


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)) -> UserOut:
    return UserOut.model_validate(user)
```

- [ ] **Step 6: Monter le routeur dans `backend/app/main.py`**

Ajouter après la définition de `api` :

```python
from app.api import auth as auth_routes

api.include_router(auth_routes.router)
```

Créer `backend/app/api/__init__.py` vide.

- [ ] **Step 7: Lancer les tests**

Run: `cd backend && pytest tests/test_auth_api.py -v`
Expected: 13 tests PASS

- [ ] **Step 8: Commit**

```bash
git add backend/
git commit -m "feat(backend): add registration, login, refresh, and per-user isolation dependency"
```

---

### Task 6: Modèle transaction et empreinte de dédoublonnage

**Files:**
- Create: `backend/app/models/transaction.py`
- Create: `backend/app/models/import_batch.py`
- Create: `backend/app/importers/__init__.py`
- Create: `backend/app/importers/dedup.py`
- Modify: `backend/app/models/__init__.py`
- Create: `backend/tests/test_dedup.py`

**Interfaces:**
- Consumes: `Base`, `User`, `Account`, `Category`.
- Produces:
  - `Transaction(id, user_id, account_id, date, value_date, amount_cents, label_raw, label_clean, merchant, category_id, category_source, is_transfer, is_recurring, recurrence_id, import_batch_id, dedup_hash, notes, tags)` — contrainte d'unicité `(user_id, dedup_hash)`
  - `ImportBatch(id, user_id, account_id, filename, file_sha256, mapping_json, rows_total, rows_imported, rows_duplicate, rows_failed, created_at)`
  - `ColumnProfile(id, user_id, name, dialect_json, mapping_json, created_at)` — unicité `(user_id, name)`
  - `normalize_label(raw: str) -> str`
  - `compute_dedup_hash(user_id: int, account_id: int, on: date, amount_cents: int, label_raw: str) -> str`
  - `# "builtin" and "rule" both mean "matched a rule"; "builtin" additionally says the
# rule shipped with Yieldo rather than being written by the user. classify() returns
# the rule's origin verbatim, so every origin value must be listed here.
TRANSACTION_CATEGORY_SOURCES = (
    "builtin", "rule", "learned", "manual", "csv", "uncategorized",
)`

- [ ] **Step 1: Écrire les tests qui échouent**

Créer `backend/tests/test_dedup.py` :

```python
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
```

- [ ] **Step 2: Lancer les tests pour vérifier qu'ils échouent**

Run: `cd backend && pytest tests/test_dedup.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.importers'`

- [ ] **Step 3: Écrire `backend/app/importers/dedup.py`**

```python
import hashlib
import re
import unicodedata
from datetime import date

# Bank statement labels carry noise that is not part of the transaction's identity:
# embedded dates, card numbers, terminal ids. Stripping them keeps re-imports idempotent.
_DATE_FRAGMENT = re.compile(r"\b\d{1,2}[/.-]\d{1,2}(?:[/.-]\d{2,4})?\b")
# Six digits and up: transaction references, IBAN fragments, terminal ids — the
# volatile parts that would otherwise make a re-import look like a new row. The
# threshold deliberately spares shorter runs that carry merchant identity
# ("PHARMACIE 2000", "STATION 24", numbered branches); collapsing those would let
# two genuinely different merchants share a fingerprint.
_LONG_DIGITS = re.compile(r"\b\d{6,}\b")
_CARD_MARKER = re.compile(r"\bcarte\s*\d*\b")
_NON_ALNUM = re.compile(r"[^a-z0-9]+")
_SPACES = re.compile(r"\s+")


def normalize_label(raw: str) -> str:
    """Reduce a statement label to its stable identifying core."""
    text = unicodedata.normalize("NFKD", raw or "")
    text = "".join(ch for ch in text if not unicodedata.combining(ch)).lower()
    text = _DATE_FRAGMENT.sub(" ", text)
    text = _CARD_MARKER.sub(" ", text)
    text = _LONG_DIGITS.sub(" ", text)
    text = _NON_ALNUM.sub(" ", text)
    return _SPACES.sub(" ", text).strip()


def compute_dedup_hash(
    user_id: int, account_id: int, on: date, amount_cents: int, label_raw: str
) -> str:
    """Stable fingerprint identifying one transaction within one user's data."""
    payload = "|".join([
        str(user_id), str(account_id), on.isoformat(),
        str(amount_cents), normalize_label(label_raw),
    ])
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()
```

- [ ] **Step 4: Écrire `backend/app/models/transaction.py`**

```python
from datetime import date

from sqlalchemy import JSON, Boolean, Date, ForeignKey, Index, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base

# "builtin" and "rule" both mean "matched a rule"; "builtin" additionally says the
# rule shipped with Yieldo rather than being written by the user. classify() returns
# the rule's origin verbatim, so every origin value must be listed here.
TRANSACTION_CATEGORY_SOURCES = (
    "builtin", "rule", "learned", "manual", "csv", "uncategorized",
)


class Transaction(Base):
    __tablename__ = "transactions"
    __table_args__ = (
        UniqueConstraint("user_id", "dedup_hash", name="uq_transaction_user_dedup"),
        Index("ix_transaction_user_date", "user_id", "date"),
        Index("ix_transaction_user_category", "user_id", "category_id"),
    )

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    account_id: Mapped[int] = mapped_column(
        ForeignKey("accounts.id", ondelete="CASCADE"), index=True, nullable=False)
    date: Mapped[date] = mapped_column(Date, nullable=False)
    value_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    amount_cents: Mapped[int] = mapped_column(Integer, nullable=False)
    label_raw: Mapped[str] = mapped_column(String(500), nullable=False)
    label_clean: Mapped[str] = mapped_column(String(500), nullable=False)
    merchant: Mapped[str | None] = mapped_column(String(200), nullable=True)
    category_id: Mapped[int | None] = mapped_column(
        ForeignKey("categories.id", ondelete="SET NULL"), nullable=True)
    category_source: Mapped[str] = mapped_column(
        String(16), default="uncategorized", nullable=False)
    is_transfer: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_recurring: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    recurrence_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    import_batch_id: Mapped[int | None] = mapped_column(
        ForeignKey("import_batches.id", ondelete="SET NULL"), index=True, nullable=True)
    dedup_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    notes: Mapped[str | None] = mapped_column(String(2000), nullable=True)
    tags: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)

    account = relationship("Account", back_populates="transactions")
    category = relationship("Category")
```

- [ ] **Step 5: Écrire `backend/app/models/import_batch.py`**

```python
from datetime import UTC, datetime

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class ImportBatch(Base):
    __tablename__ = "import_batches"

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    account_id: Mapped[int] = mapped_column(
        ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    file_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    stored_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    dialect_json: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    mapping_json: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    rows_total: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    rows_imported: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    rows_duplicate: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    rows_failed: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False)


class ColumnProfile(Base):
    __tablename__ = "column_profiles"
    __table_args__ = (UniqueConstraint("user_id", "name", name="uq_column_profile_user_name"),)

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    dialect_json: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    mapping_json: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False)
```

- [ ] **Step 6: Mettre à jour `backend/app/models/__init__.py`**

```python
from app.models.account import ACCOUNT_KINDS, Account
from app.models.category import CATEGORY_KINDS, Category
from app.models.import_batch import ColumnProfile, ImportBatch
from app.models.transaction import TRANSACTION_CATEGORY_SOURCES, Transaction
from app.models.user import User

__all__ = [
    "ACCOUNT_KINDS", "CATEGORY_KINDS", "TRANSACTION_CATEGORY_SOURCES",
    "Account", "Category", "ColumnProfile", "ImportBatch", "Transaction", "User",
]
```

Créer `backend/app/importers/__init__.py` vide.

- [ ] **Step 7: Lancer les tests**

Run: `cd backend && pytest -v`
Expected: tous PASS (8 nouveaux tests)

- [ ] **Step 8: Migration**

Run: `cd backend && alembic revision --autogenerate -m "transactions, import batches, column profiles" && alembic upgrade head`

- [ ] **Step 9: Commit**

```bash
git add backend/
git commit -m "feat(backend): add transaction model with idempotent dedup fingerprint"
```

---

# Lot B — Import CSV

### Task 7: Détection du dialecte d'un fichier CSV

**Files:**
- Create: `backend/app/importers/dialect.py`
- Create: `backend/tests/fixtures/boursorama.csv`
- Create: `backend/tests/fixtures/credit_agricole_latin1.csv`
- Create: `backend/tests/fixtures/generic_iso.csv`
- Create: `backend/tests/test_dialect.py`

**Interfaces:**
- Consumes: rien (fonction pure sur des octets).
- Produces:
  - `@dataclass CsvDialect(encoding: str, delimiter: str, decimal_separator: str, date_format: str, header_row: int, preamble_rows: int, quotechar: str)`
  - `detect_dialect(raw: bytes) -> CsvDialect`
  - `read_rows(raw: bytes, dialect: CsvDialect) -> tuple[list[str], list[list[str]]]` — renvoie `(headers, rows)`
  - `parse_date(text: str, date_format: str) -> date` — lève `ValueError`
  - `parse_amount(text: str, decimal_separator: str) -> int` — renvoie des **centimes**, lève `ValueError`
  - `DATE_FORMATS = ("%d/%m/%Y", "%d/%m/%y", "%Y-%m-%d", "%m/%d/%Y", "%d-%m-%Y", "%d.%m.%Y")`

- [ ] **Step 1: Créer les fichiers d'exemple**

`backend/tests/fixtures/boursorama.csv` — point-virgule, virgule décimale, dates françaises, deux lignes de préambule :

```
Exportation des opérations du compte
Compte courant - 00012345678

dateOp;dateVal;label;category;amount
01/03/2025;03/03/2025;CARREFOUR MARKET CB 01/03;Alimentation;-47,32
03/03/2025;03/03/2025;VIR SALAIRE ACME SAS;Revenus;2450,00
05/03/2025;05/03/2025;PRLV NETFLIX.COM;Loisirs;-13,49
07/03/2025;07/03/2025;TOTALENERGIES ACCESS 4589;Transport;-68,10
```

`backend/tests/fixtures/credit_agricole_latin1.csv` — encodé en Latin-1, colonnes débit et crédit séparées, à écrire avec `Path(...).write_bytes("...".encode("latin-1"))` :

```
Date;Libellé;Débit euros;Crédit euros
01/03/2025;PÉAGE VINCI AUTOROUTES;12,40;
03/03/2025;VIREMENT SALAIRE;;2450,00
04/03/2025;PHARMACIE DU CENTRE;23,90;
```

`backend/tests/fixtures/generic_iso.csv` — virgule séparatrice, point décimal, dates ISO :

```
date,description,amount
2025-03-01,AMAZON.FR MARKETPLACE,-89.90
2025-03-02,SPOTIFY P0F3A1,-11.99
2025-03-03,SALARY PAYMENT,3100.00
```

- [ ] **Step 2: Écrire les tests qui échouent**

Créer `backend/tests/test_dialect.py` :

```python
from datetime import date
from pathlib import Path

import pytest

from app.importers.dialect import detect_dialect, parse_amount, parse_date, read_rows

FIXTURES = Path(__file__).parent / "fixtures"


def test_detects_boursorama_semicolon_comma_decimal_french_dates():
    dialect = detect_dialect((FIXTURES / "boursorama.csv").read_bytes())
    assert dialect.delimiter == ";"
    assert dialect.decimal_separator == ","
    assert dialect.date_format == "%d/%m/%Y"
    assert dialect.preamble_rows == 3
    assert dialect.encoding.lower().startswith("utf")


def test_detects_latin1_encoding_without_mojibake():
    raw = (FIXTURES / "credit_agricole_latin1.csv").read_bytes()
    dialect = detect_dialect(raw)
    headers, rows = read_rows(raw, dialect)
    assert "Libellé" in headers
    assert rows[0][1] == "PÉAGE VINCI AUTOROUTES"


def test_detects_comma_delimiter_and_iso_dates():
    dialect = detect_dialect((FIXTURES / "generic_iso.csv").read_bytes())
    assert dialect.delimiter == ","
    assert dialect.decimal_separator == "."
    assert dialect.date_format == "%Y-%m-%d"
    assert dialect.preamble_rows == 0


def test_read_rows_skips_preamble_and_returns_headers():
    raw = (FIXTURES / "boursorama.csv").read_bytes()
    headers, rows = read_rows(raw, detect_dialect(raw))
    assert headers == ["dateOp", "dateVal", "label", "category", "amount"]
    assert len(rows) == 4
    assert rows[0][2] == "CARREFOUR MARKET CB 01/03"


@pytest.mark.parametrize(("text", "fmt", "expected"), [
    ("01/03/2025", "%d/%m/%Y", date(2025, 3, 1)),
    ("2025-03-01", "%Y-%m-%d", date(2025, 3, 1)),
    ("01/03/25", "%d/%m/%y", date(2025, 3, 1)),
    (" 01/03/2025 ", "%d/%m/%Y", date(2025, 3, 1)),
])
def test_parse_date_accepts_supported_formats(text, fmt, expected):
    assert parse_date(text, fmt) == expected


def test_parse_date_rejects_unparseable_text():
    with pytest.raises(ValueError, match="Date illisible"):
        parse_date("pas une date", "%d/%m/%Y")


@pytest.mark.parametrize(("text", "sep", "expected"), [
    ("-47,32", ",", -4732),
    ("2450,00", ",", 245000),
    ("-89.90", ".", -8990),
    ("1 234,56", ",", 123456),
    ("1 234,56", ",", 123456),
    ("1.234,56", ",", 123456),
    ("1,234.56", ".", 123456),
    ("(47,32)", ",", -4732),
    ("47,32 €", ",", 4732),
    ("+120,00", ",", 12000),
    ("0", ",", 0),
])
def test_parse_amount_returns_cents(text, sep, expected):
    assert parse_amount(text, sep) == expected


def test_parse_amount_rejects_empty_and_garbage():
    with pytest.raises(ValueError, match="Montant illisible"):
        parse_amount("", ",")
    with pytest.raises(ValueError, match="Montant illisible"):
        parse_amount("abc", ",")


def test_parse_amount_rounds_half_up_on_extra_decimals():
    assert parse_amount("1,005", ",") == 101
    assert parse_amount("1,004", ",") == 100
```

- [ ] **Step 3: Lancer les tests pour vérifier qu'ils échouent**

Run: `cd backend && pytest tests/test_dialect.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.importers.dialect'`

- [ ] **Step 4: Écrire `backend/app/importers/dialect.py`**

```python
import codecs
import csv
import io
import re
from collections import Counter
from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

DATE_FORMATS = ("%d/%m/%Y", "%d/%m/%y", "%Y-%m-%d", "%m/%d/%Y", "%d-%m-%Y", "%d.%m.%Y")
_CANDIDATE_DELIMITERS = (";", ",", "\t", "|")
_AMOUNT_CLEANUP = re.compile(r"[^\d,.\-+()]")
_THOUSAND_SPACES = re.compile(r"[\s  ]")


@dataclass
class CsvDialect:
    """Everything needed to turn a byte blob into a table of strings."""

    encoding: str = "utf-8"
    delimiter: str = ";"
    decimal_separator: str = ","
    date_format: str = "%d/%m/%Y"
    header_row: int = 0
    preamble_rows: int = 0
    quotechar: str = '"'
    sample_headers: list[str] = field(default_factory=list)


# Ordered by how likely a French bank export is to use them. Tried strictly, in
# order, so the choice is reproducible.
_CANDIDATE_ENCODINGS = ("utf-8-sig", "cp1252", "latin-1")


def _decode(raw: bytes) -> tuple[str, str]:
    """Decode a statement with an explicit candidate list, not a statistical guess.

    Statistical detection is unsafe here: on a short French statement it reports
    cp1250, which agrees with cp1252 on e-acute but turns 0xE0, 0xE8, 0xEA, 0xF9 and
    0xFB into Central European letters — so "Prelevement" with its grave accent comes
    back mangled. Neither codepage ever raises, because both map all 256 bytes, so the
    corruption is silent. And the label is exactly what gets hashed for deduplication
    and shown to the user. The user can still override the encoding in the wizard.
    """
    if raw.startswith((codecs.BOM_UTF16_LE, codecs.BOM_UTF16_BE)):
        return raw.decode("utf-16"), "utf-16"
    for encoding in _CANDIDATE_ENCODINGS:
        try:
            return raw.decode(encoding), encoding
        except UnicodeDecodeError:
            continue
    # latin-1 maps every byte, so the loop above always returns before here.
    return raw.decode("latin-1", errors="replace"), "latin-1"


def _pick_delimiter(lines: list[str]) -> str:
    """The delimiter is the candidate producing the most consistent column count."""
    best_delimiter, best_score = ";", -1.0
    for candidate in _CANDIDATE_DELIMITERS:
        counts = [line.count(candidate) for line in lines if line.strip()]
        if not counts or max(counts) == 0:
            continue
        most_common, occurrences = Counter(counts).most_common(1)[0]
        if most_common == 0:
            continue
        score = occurrences * most_common
        if score > best_score:
            best_delimiter, best_score = candidate, score
    return best_delimiter


def _find_header_row(rows: list[list[str]], delimiter: str) -> int:
    """The header is the first row whose column count matches the table's dominant width."""
    widths = Counter(len(row) for row in rows if any(cell.strip() for cell in row))
    if not widths:
        return 0
    dominant, _ = widths.most_common(1)[0]
    for index, row in enumerate(rows):
        if len(row) == dominant and any(cell.strip() for cell in row):
            return index
    return 0


def _detect_date_format(samples: list[str]) -> str:
    for fmt in DATE_FORMATS:
        matched = 0
        for sample in samples:
            try:
                datetime.strptime(sample.strip(), fmt)
                matched += 1
            except ValueError:
                continue
        if samples and matched >= max(1, len(samples) // 2):
            return fmt
    return "%d/%m/%Y"


def _detect_decimal_separator(samples: list[str]) -> str:
    comma_decimal = sum(1 for s in samples if re.search(r",\d{1,2}\b", s))
    dot_decimal = sum(1 for s in samples if re.search(r"\.\d{1,2}\b", s))
    return "," if comma_decimal >= dot_decimal else "."


def detect_dialect(raw: bytes) -> CsvDialect:
    """Infer how to read a CSV. Every field is a proposal the user may override."""
    text, encoding = _decode(raw)
    lines = text.splitlines()[:40]
    delimiter = _pick_delimiter(lines)

    reader = csv.reader(io.StringIO("\n".join(lines)), delimiter=delimiter)
    rows = list(reader)
    header_row = _find_header_row(rows, delimiter)
    headers = rows[header_row] if rows else []
    body = rows[header_row + 1:]

    date_samples: list[str] = []
    amount_samples: list[str] = []
    for row in body[:20]:
        for cell in row:
            stripped = cell.strip()
            if re.fullmatch(r"\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4}", stripped):
                date_samples.append(stripped)
            elif re.fullmatch(r"[-+(]?[\d\s .,]+\)?\s*€?", stripped) and any(
                ch.isdigit() for ch in stripped
            ):
                amount_samples.append(stripped)

    return CsvDialect(
        encoding=encoding,
        delimiter=delimiter,
        decimal_separator=_detect_decimal_separator(amount_samples),
        date_format=_detect_date_format(date_samples),
        header_row=header_row,
        preamble_rows=header_row,
        quotechar='"',
        sample_headers=[h.strip() for h in headers],
    )


def read_rows(raw: bytes, dialect: CsvDialect) -> tuple[list[str], list[list[str]]]:
    """Decode and split a CSV according to a dialect. Returns (headers, data rows)."""
    text = raw.decode(dialect.encoding, errors="replace")
    reader = csv.reader(io.StringIO(text), delimiter=dialect.delimiter,
                        quotechar=dialect.quotechar)
    rows = [row for row in reader]
    if dialect.header_row >= len(rows):
        return [], []
    headers = [cell.strip() for cell in rows[dialect.header_row]]
    body = [row for row in rows[dialect.header_row + 1:] if any(c.strip() for c in row)]
    return headers, body


def parse_date(text: str, date_format: str) -> date:
    """Parse strictly against the chosen format — no fallback to other formats.

    Falling back would silently swap day and month whenever both are 12 or under:
    01/03/2025 read as US format becomes 3 January instead of 1 March, with nothing
    to signal it. A row that does not match belongs in the preview's error list,
    where the user can see it and correct the format in step 1.
    """
    stripped = (text or "").strip()
    try:
        return datetime.strptime(stripped, date_format).date()
    except ValueError as exc:
        raise ValueError(f"Date illisible : {text!r}") from exc


def parse_amount(text: str, decimal_separator: str) -> int:
    """Parse a monetary string into an exact number of cents."""
    stripped = (text or "").strip()
    if not stripped:
        raise ValueError("Montant illisible : valeur vide")

    negative = stripped.startswith("(") and stripped.endswith(")")
    cleaned = _AMOUNT_CLEANUP.sub("", stripped).replace("(", "").replace(")", "")
    cleaned = _THOUSAND_SPACES.sub("", cleaned)

    thousands = "." if decimal_separator == "," else ","
    cleaned = cleaned.replace(thousands, "").replace(decimal_separator, ".")

    if cleaned in ("", "-", "+", "."):
        raise ValueError(f"Montant illisible : {text!r}")
    try:
        value = Decimal(cleaned)
    except InvalidOperation as exc:
        raise ValueError(f"Montant illisible : {text!r}") from exc

    if negative:
        value = -abs(value)
    cents = (value * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
    return int(cents)
```

- [ ] **Step 5: Lancer les tests**

Run: `cd backend && pytest tests/test_dialect.py -v`
Expected: 23 tests PASS

- [ ] **Step 6: Commit**

```bash
git add backend/
git commit -m "feat(importers): detect CSV encoding, delimiter, decimal and date formats"
```

---

### Task 8: Rôles de colonnes et transformation des lignes en transactions candidates

**Files:**
- Create: `backend/app/importers/mapping.py`
- Create: `backend/app/importers/parser.py`
- Create: `backend/tests/test_mapping.py`
- Create: `backend/tests/test_parser.py`

**Interfaces:**
- Consumes: `CsvDialect`, `parse_date`, `parse_amount`, `normalize_label`.
- Produces:
  - `COLUMN_ROLES` — tuple des rôles : `date, value_date, amount, debit, credit, label, category, account, currency, balance, notes, reference, ignore`
  - `ROLE_LABELS: dict[str, str]` — libellés français affichés dans l'interface
  - `suggest_mapping(headers: list[str]) -> dict[int, str]` — index de colonne → rôle proposé
  - `validate_mapping(mapping: dict[int, str], column_count: int) -> list[str]` — renvoie la liste des erreurs en français, vide si valide
  - `@dataclass CandidateRow(row_number, date, value_date, amount_cents, label_raw, label_clean, category_hint, notes, reference, error)`
  - `parse_rows(rows, mapping, dialect) -> list[CandidateRow]` — jamais d'exception ; une ligne fautive porte son `error`

- [ ] **Step 1: Écrire les tests qui échouent**

Créer `backend/tests/test_mapping.py` :

```python
from app.importers.mapping import suggest_mapping, validate_mapping


def test_suggests_roles_for_french_bank_headers():
    mapping = suggest_mapping(["dateOp", "dateVal", "label", "category", "amount"])
    assert mapping == {0: "date", 1: "value_date", 2: "label", 3: "category", 4: "amount"}


def test_suggests_debit_and_credit_columns():
    mapping = suggest_mapping(["Date", "Libellé", "Débit euros", "Crédit euros"])
    assert mapping == {0: "date", 1: "label", 2: "debit", 3: "credit"}


def test_suggests_roles_for_english_headers():
    mapping = suggest_mapping(["date", "description", "amount"])
    assert mapping == {0: "date", 1: "label", 2: "amount"}


def test_unknown_headers_default_to_ignore():
    assert suggest_mapping(["date", "colonne mystère"])[1] == "ignore"


def test_validation_accepts_date_label_amount():
    assert validate_mapping({0: "date", 1: "label", 2: "amount"}, 3) == []


def test_validation_accepts_debit_credit_instead_of_amount():
    assert validate_mapping({0: "date", 1: "label", 2: "debit", 3: "credit"}, 4) == []


def test_validation_requires_a_date_column():
    errors = validate_mapping({0: "label", 1: "amount"}, 2)
    assert any("date" in e.lower() for e in errors)


def test_validation_requires_a_label_column():
    errors = validate_mapping({0: "date", 1: "amount"}, 2)
    assert any("libellé" in e.lower() for e in errors)


def test_validation_requires_an_amount_or_a_debit_credit_pair():
    errors = validate_mapping({0: "date", 1: "label"}, 2)
    assert any("montant" in e.lower() for e in errors)


def test_validation_rejects_duplicated_single_use_roles():
    errors = validate_mapping({0: "date", 1: "date", 2: "label", 3: "amount"}, 4)
    assert any("plusieurs fois" in e.lower() for e in errors)


def test_validation_rejects_out_of_range_column_index():
    assert validate_mapping({0: "date", 9: "label"}, 3) != []
```

Créer `backend/tests/test_parser.py` :

```python
from datetime import date

from app.importers.dialect import CsvDialect
from app.importers.parser import parse_rows


def _dialect(**overrides) -> CsvDialect:
    return CsvDialect(delimiter=";", decimal_separator=",",
                      date_format="%d/%m/%Y", **overrides)


def test_parses_single_signed_amount_column():
    rows = [["01/03/2025", "CARREFOUR MARKET", "-47,32"]]
    mapping = {0: "date", 1: "label", 2: "amount"}
    candidates = parse_rows(rows, mapping, _dialect())
    assert candidates[0].date == date(2025, 3, 1)
    assert candidates[0].amount_cents == -4732
    assert candidates[0].label_raw == "CARREFOUR MARKET"
    assert candidates[0].label_clean == "carrefour market"
    assert candidates[0].error is None


def test_debit_column_yields_a_negative_amount():
    rows = [["01/03/2025", "PEAGE VINCI", "12,40", ""]]
    mapping = {0: "date", 1: "label", 2: "debit", 3: "credit"}
    assert parse_rows(rows, mapping, _dialect())[0].amount_cents == -1240


def test_credit_column_yields_a_positive_amount():
    rows = [["03/03/2025", "VIREMENT SALAIRE", "", "2450,00"]]
    mapping = {0: "date", 1: "label", 2: "debit", 3: "credit"}
    assert parse_rows(rows, mapping, _dialect())[0].amount_cents == 245000


def test_debit_already_signed_is_not_double_negated():
    rows = [["01/03/2025", "ACHAT", "-12,40", ""]]
    mapping = {0: "date", 1: "label", 2: "debit", 3: "credit"}
    assert parse_rows(rows, mapping, _dialect())[0].amount_cents == -1240


def test_row_with_both_debit_and_credit_empty_is_flagged():
    rows = [["01/03/2025", "LIGNE VIDE", "", ""]]
    mapping = {0: "date", 1: "label", 2: "debit", 3: "credit"}
    candidate = parse_rows(rows, mapping, _dialect())[0]
    assert candidate.error is not None
    assert "montant" in candidate.error.lower()


def test_unparseable_date_is_reported_without_stopping_the_batch():
    rows = [["pas une date", "X", "-10,00"], ["02/03/2025", "Y", "-20,00"]]
    mapping = {0: "date", 1: "label", 2: "amount"}
    candidates = parse_rows(rows, mapping, _dialect())
    assert candidates[0].error is not None and "date" in candidates[0].error.lower()
    assert candidates[1].error is None
    assert candidates[1].amount_cents == -2000


def test_row_numbers_are_one_based_and_stable():
    rows = [["01/03/2025", "A", "-1,00"], ["02/03/2025", "B", "-2,00"]]
    mapping = {0: "date", 1: "label", 2: "amount"}
    candidates = parse_rows(rows, mapping, _dialect())
    assert [c.row_number for c in candidates] == [1, 2]


def test_optional_columns_are_captured():
    rows = [["01/03/2025", "05/03/2025", "ACHAT", "Alimentation", "note", "REF9", "-10,00"]]
    mapping = {0: "date", 1: "value_date", 2: "label", 3: "category",
               4: "notes", 5: "reference", 6: "amount"}
    candidate = parse_rows(rows, mapping, _dialect())[0]
    assert candidate.value_date == date(2025, 3, 5)
    assert candidate.category_hint == "Alimentation"
    assert candidate.notes == "note"
    assert candidate.reference == "REF9"


def test_short_row_is_flagged_rather_than_crashing():
    rows = [["01/03/2025"]]
    mapping = {0: "date", 1: "label", 2: "amount"}
    assert parse_rows(rows, mapping, _dialect())[0].error is not None
```

- [ ] **Step 2: Lancer les tests pour vérifier qu'ils échouent**

Run: `cd backend && pytest tests/test_mapping.py tests/test_parser.py -v`
Expected: FAIL — modules introuvables

- [ ] **Step 3: Écrire `backend/app/importers/mapping.py`**

```python
import re
import unicodedata

COLUMN_ROLES = (
    "date", "value_date", "amount", "debit", "credit", "label", "category",
    "account", "currency", "balance", "notes", "reference", "ignore",
)

ROLE_LABELS: dict[str, str] = {
    "date": "Date",
    "value_date": "Date de valeur",
    "amount": "Montant",
    "debit": "Débit",
    "credit": "Crédit",
    "label": "Libellé",
    "category": "Catégorie",
    "account": "Compte",
    "currency": "Devise",
    "balance": "Solde",
    "notes": "Notes",
    "reference": "Référence",
    "ignore": "Ignorer",
}

# Roles that may appear at most once in a mapping.
SINGLE_USE_ROLES = frozenset(COLUMN_ROLES) - {"ignore"}

# Ordered: the first pattern that matches a header wins, so put the most
# specific ones first (value date before date, debit before amount).
_HEADER_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    # "Date de comptabilisation" is the booking date, i.e. the operation date — not
    # the value date. Several French banks ship both columns, so putting
    # "comptabilis" on the wrong pattern swaps the two roles silently.
    ("value_date", re.compile(r"date\s*(de\s*)?val|dateval|value\s*date")),
    ("date", re.compile(
        r"^date|dateop|date\s*op|operation\s*date|transaction\s*date|jour|comptabilis"
    )),
    ("debit", re.compile(r"debit|sortie|retrait|withdrawal")),
    ("credit", re.compile(r"credit|entree|depot|deposit")),
    ("amount", re.compile(r"montant|amount|somme|valeur|mouvement")),
    ("balance", re.compile(r"solde|balance")),
    ("label", re.compile(r"libell|label|description|intitul|nature|designation|motif|detail")),
    ("category", re.compile(r"categor|rubrique|type")),
    ("account", re.compile(r"compte|account|iban")),
    ("currency", re.compile(r"devise|currency|monnaie")),
    ("reference", re.compile(r"ref|numero|number|piece")),
    ("notes", re.compile(r"note|commentaire|memo|remarque")),
]


def _normalize_header(header: str) -> str:
    text = unicodedata.normalize("NFKD", header or "")
    text = "".join(ch for ch in text if not unicodedata.combining(ch)).lower()
    return re.sub(r"[^a-z0-9]+", " ", text).strip()


def suggest_mapping(headers: list[str]) -> dict[int, str]:
    """Propose a role per column. The user always sees and can override this."""
    mapping: dict[int, str] = {}
    taken: set[str] = set()
    for index, header in enumerate(headers):
        normalized = _normalize_header(header)
        role = "ignore"
        for candidate, pattern in _HEADER_PATTERNS:
            if candidate in taken:
                continue
            if pattern.search(normalized):
                role = candidate
                break
        if role != "ignore":
            taken.add(role)
        mapping[index] = role
    return mapping


def validate_mapping(mapping: dict[int, str], column_count: int) -> list[str]:
    """Return user-facing French error messages. Empty list means the mapping is usable."""
    errors: list[str] = []
    roles = list(mapping.values())

    for index in mapping:
        if index < 0 or index >= column_count:
            errors.append(f"La colonne n°{index + 1} n'existe pas dans le fichier.")

    for role in SINGLE_USE_ROLES:
        if roles.count(role) > 1:
            errors.append(f"Le rôle « {ROLE_LABELS[role]} » est attribué plusieurs fois.")

    for role in roles:
        if role not in COLUMN_ROLES:
            errors.append(f"Rôle de colonne inconnu : {role}.")

    if "date" not in roles:
        errors.append("Aucune colonne n'est taggée comme Date.")
    if "label" not in roles:
        errors.append("Aucune colonne n'est taggée comme Libellé.")
    if "amount" not in roles and not ("debit" in roles or "credit" in roles):
        errors.append(
            "Aucune colonne de Montant, ni de couple Débit / Crédit, n'est taggée."
        )
    return errors
```

- [ ] **Step 4: Écrire `backend/app/importers/parser.py`**

```python
from dataclasses import dataclass
from datetime import date

from app.importers.dedup import normalize_label
from app.importers.dialect import CsvDialect, parse_amount, parse_date


@dataclass
class CandidateRow:
    """One CSV line turned into a would-be transaction. `error` set means it is rejected."""

    row_number: int
    date: date | None = None
    value_date: date | None = None
    amount_cents: int | None = None
    label_raw: str = ""
    label_clean: str = ""
    category_hint: str | None = None
    notes: str | None = None
    reference: str | None = None
    error: str | None = None


def _cell(row: list[str], mapping: dict[int, str], role: str) -> str | None:
    for index, mapped_role in mapping.items():
        if mapped_role == role:
            if index >= len(row):
                return None
            return row[index].strip()
    return None


def _resolve_amount(row: list[str], mapping: dict[int, str], dialect: CsvDialect) -> int:
    """Single signed column, or a debit/credit pair. Debits are always stored negative."""
    single = _cell(row, mapping, "amount")
    if single is not None and single != "":
        return parse_amount(single, dialect.decimal_separator)

    debit = _cell(row, mapping, "debit")
    credit = _cell(row, mapping, "credit")
    if debit:
        return -abs(parse_amount(debit, dialect.decimal_separator))
    if credit:
        return abs(parse_amount(credit, dialect.decimal_separator))
    raise ValueError("Montant absent : ni montant, ni débit, ni crédit renseigné")


def parse_rows(
    rows: list[list[str]], mapping: dict[int, str], dialect: CsvDialect
) -> list[CandidateRow]:
    """Turn raw cells into candidates. Never raises: a bad line carries its own error."""
    candidates: list[CandidateRow] = []
    for offset, row in enumerate(rows, start=1):
        candidate = CandidateRow(row_number=offset)
        try:
            raw_date = _cell(row, mapping, "date")
            if raw_date is None or raw_date == "":
                raise ValueError("Date absente")
            candidate.date = parse_date(raw_date, dialect.date_format)

            raw_value_date = _cell(row, mapping, "value_date")
            if raw_value_date:
                try:
                    candidate.value_date = parse_date(raw_value_date, dialect.date_format)
                except ValueError:
                    candidate.value_date = None

            label = _cell(row, mapping, "label")
            if label is None or label == "":
                raise ValueError("Libellé absent")
            candidate.label_raw = label
            candidate.label_clean = normalize_label(label)

            candidate.amount_cents = _resolve_amount(row, mapping, dialect)

            candidate.category_hint = _cell(row, mapping, "category") or None
            candidate.notes = _cell(row, mapping, "notes") or None
            candidate.reference = _cell(row, mapping, "reference") or None
        except ValueError as exc:
            candidate.error = str(exc)
        candidates.append(candidate)
    return candidates
```

- [ ] **Step 5: Lancer les tests**

Run: `cd backend && pytest tests/test_mapping.py tests/test_parser.py -v`
Expected: 20 tests PASS

- [ ] **Step 6: Commit**

```bash
git add backend/
git commit -m "feat(importers): add column role mapping and row-to-candidate parser"
```

---

### Task 9: Moteur de catégorisation par règles et règles françaises préinstallées

**Files:**
- Create: `backend/app/models/rule.py`
- Create: `backend/app/categorization/engine.py`
- Modify: `backend/app/categorization/seed.py`
- Modify: `backend/app/models/__init__.py`
- Create: `backend/tests/test_categorization.py`

**Interfaces:**
- Consumes: `Category`, `normalize_label`, `seed_categories`.
- Produces:
  - `CategoryRule(id, user_id, pattern, is_regex, category_id, priority, origin, hit_count, created_at)` — `origin` ∈ `builtin, learned, manual`
  - `@dataclass RuleMatch(category_id: int, source: str, rule_id: int | None)`
  - `compile_rules(rules: list[CategoryRule]) -> list[CompiledRule]` — trie par priorité décroissante puis par longueur de motif décroissante
  - `classify(label_clean: str, amount_cents: int, compiled: list[CompiledRule]) -> RuleMatch | None`
  - `seed_rules(db: Session, user_id: int, categories: dict[str, Category]) -> int` — renvoie le nombre de règles créées, idempotent
- Règle de priorité : `manual` (300) > `learned` (200) > `builtin` (100). À priorité égale, le motif le plus long gagne — « carrefour market » l'emporte sur « carrefour ».

- [ ] **Step 1: Écrire les tests qui échouent**

Créer `backend/tests/test_categorization.py` :

```python
import pytest

from app.categorization.engine import classify, compile_rules
from app.categorization.seed import seed_categories, seed_rules
from app.models import CategoryRule, User


@pytest.fixture
def user_with_categories(db):
    user = User(email="a@b.c", name="A", password_hash="x")
    db.add(user)
    db.commit()
    categories = seed_categories(db, user.id)
    return user, categories


def test_seed_rules_are_idempotent(db, user_with_categories):
    user, categories = user_with_categories
    first = seed_rules(db, user.id, categories)
    assert first > 0
    assert seed_rules(db, user.id, categories) == 0


def test_builtin_rules_classify_common_french_merchants(db, user_with_categories):
    user, categories = user_with_categories
    seed_rules(db, user.id, categories)
    compiled = compile_rules(db.query(CategoryRule).filter(
        CategoryRule.user_id == user.id).all())

    # Amount sign matters: a rule carrying direction="credit" must not match a debit,
    # so the income case is asserted with a positive amount. Asserting them all with
    # one negative amount would contradict test_income_rules_only_match_positive_amounts.
    debit_cases = {
        "carrefour market": "alimentation-courses",
        "leclerc drive": "alimentation-courses",
        "netflix com": "abonnements-streaming",
        "totalenergies access": "transport-carburant",
        "sncf connect": "transport-voyage",
        "pharmacie du centre": "sante-pharmacie",
        "edf clients": "logement-energie",
        "free mobile": "logement-internet",
    }
    credit_cases = {
        "vir salaire acme sas": "revenus-salaire",
    }
    for label, expected_slug in debit_cases.items():
        match = classify(label, -1000, compiled)
        assert match is not None, f"aucune règle pour {label!r}"
        assert match.category_id == categories[expected_slug].id, label
    for label, expected_slug in credit_cases.items():
        match = classify(label, 245000, compiled)
        assert match is not None, f"aucune règle pour {label!r}"
        assert match.category_id == categories[expected_slug].id, label


def test_unknown_label_returns_no_match(db, user_with_categories):
    user, categories = user_with_categories
    seed_rules(db, user.id, categories)
    compiled = compile_rules(db.query(CategoryRule).filter(
        CategoryRule.user_id == user.id).all())
    assert classify("zzz commerce inconnu 4711", -500, compiled) is None


def test_longer_pattern_wins_at_equal_priority(db, user_with_categories):
    user, categories = user_with_categories
    db.add_all([
        CategoryRule(user_id=user.id, pattern="carrefour",
                     category_id=categories["alimentation-courses"].id,
                     priority=100, origin="builtin"),
        CategoryRule(user_id=user.id, pattern="carrefour station",
                     category_id=categories["transport-carburant"].id,
                     priority=100, origin="builtin"),
    ])
    db.commit()
    compiled = compile_rules(db.query(CategoryRule).filter(
        CategoryRule.user_id == user.id).all())
    match = classify("carrefour station service", -6000, compiled)
    assert match.category_id == categories["transport-carburant"].id


def test_manual_rule_beats_builtin_rule(db, user_with_categories):
    user, categories = user_with_categories
    seed_rules(db, user.id, categories)
    db.add(CategoryRule(user_id=user.id, pattern="carrefour",
                        category_id=categories["achats-maison"].id,
                        priority=300, origin="manual"))
    db.commit()
    compiled = compile_rules(db.query(CategoryRule).filter(
        CategoryRule.user_id == user.id).all())
    match = classify("carrefour market", -4732, compiled)
    assert match.category_id == categories["achats-maison"].id
    assert match.source == "manual"


def test_regex_rule_is_supported(db, user_with_categories):
    user, categories = user_with_categories
    db.add(CategoryRule(user_id=user.id, pattern=r"^vir\s+.*salaire",
                        is_regex=True,
                        category_id=categories["revenus-salaire"].id,
                        priority=200, origin="learned"))
    db.commit()
    compiled = compile_rules(db.query(CategoryRule).filter(
        CategoryRule.user_id == user.id).all())
    assert classify("vir de acme salaire mars", 245000, compiled) is not None
    assert classify("prelevement salaire urssaf", -1000, compiled) is None


def test_invalid_regex_is_skipped_not_fatal(db, user_with_categories):
    user, categories = user_with_categories
    db.add(CategoryRule(user_id=user.id, pattern="[unclosed", is_regex=True,
                        category_id=categories["divers"].id,
                        priority=200, origin="learned"))
    db.commit()
    compiled = compile_rules(db.query(CategoryRule).filter(
        CategoryRule.user_id == user.id).all())
    assert compiled == []


def test_income_rules_only_match_positive_amounts(db, user_with_categories):
    user, categories = user_with_categories
    seed_rules(db, user.id, categories)
    compiled = compile_rules(db.query(CategoryRule).filter(
        CategoryRule.user_id == user.id).all())
    assert classify("vir salaire acme sas", 245000, compiled) is not None
    # A debit that happens to contain "salaire" must not be booked as income.
    assert classify("vir salaire acme sas", -245000, compiled) is None
```

- [ ] **Step 2: Lancer les tests pour vérifier qu'ils échouent**

Run: `cd backend && pytest tests/test_categorization.py -v`
Expected: FAIL — `ImportError: cannot import name 'CategoryRule'`

- [ ] **Step 3: Écrire `backend/app/models/rule.py`**

```python
from datetime import UTC, datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base

RULE_ORIGINS = ("builtin", "learned", "manual")
RULE_PRIORITIES = {"builtin": 100, "learned": 200, "manual": 300}


class CategoryRule(Base):
    __tablename__ = "category_rules"
    __table_args__ = (
        UniqueConstraint("user_id", "pattern", "category_id", name="uq_rule_user_pattern_cat"),
    )

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    pattern: Mapped[str] = mapped_column(String(200), nullable=False)
    is_regex: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    category_id: Mapped[int] = mapped_column(
        ForeignKey("categories.id", ondelete="CASCADE"), nullable=False)
    priority: Mapped[int] = mapped_column(Integer, default=100, nullable=False)
    origin: Mapped[str] = mapped_column(String(16), default="builtin", nullable=False)
    direction: Mapped[str] = mapped_column(String(8), default="any", nullable=False)
    hit_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False)
```

`direction` vaut `any`, `debit` ou `credit` : c'est ce qui empêche une règle de revenu de capturer un débit portant le même libellé.

- [ ] **Step 4: Écrire `backend/app/categorization/engine.py`**

```python
import logging
import re
from dataclasses import dataclass

from app.models.rule import CategoryRule

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class CompiledRule:
    rule_id: int | None
    category_id: int
    origin: str
    priority: int
    direction: str
    matcher: re.Pattern[str]
    weight: int


@dataclass(frozen=True)
class RuleMatch:
    category_id: int
    source: str
    rule_id: int | None


def compile_rules(rules: list[CategoryRule]) -> list[CompiledRule]:
    """Compile rules once, ordered so the first match is the right one.

    Sort key: priority descending, then pattern length descending — a longer
    pattern is more specific, so "carrefour station" must be tried before
    "carrefour". An invalid regex is dropped with a warning rather than
    breaking every import that follows.
    """
    compiled: list[CompiledRule] = []
    for rule in rules:
        try:
            pattern = rule.pattern if rule.is_regex else re.escape(rule.pattern)
            matcher = re.compile(pattern, re.IGNORECASE)
        except re.error:
            logger.warning("Skipping rule %s: invalid regex %r", rule.id, rule.pattern)
            continue
        compiled.append(CompiledRule(
            rule_id=rule.id,
            category_id=rule.category_id,
            origin=rule.origin,
            priority=rule.priority,
            direction=rule.direction,
            matcher=matcher,
            weight=len(rule.pattern),
        ))
    compiled.sort(key=lambda r: (r.priority, r.weight), reverse=True)
    return compiled


def classify(
    label_clean: str, amount_cents: int, compiled: list[CompiledRule]
) -> RuleMatch | None:
    """First matching rule wins. Returns None when nothing matches."""
    for rule in compiled:
        if rule.direction == "credit" and amount_cents <= 0:
            continue
        if rule.direction == "debit" and amount_cents >= 0:
            continue
        if rule.matcher.search(label_clean):
            return RuleMatch(category_id=rule.category_id, source=rule.origin,
                             rule_id=rule.rule_id)
    return None
```

- [ ] **Step 5: Ajouter `seed_rules` à `backend/app/categorization/seed.py`**

Ajouter en fin de fichier :

```python
from app.models.rule import CategoryRule

# (category slug, direction, [patterns])
BUILTIN_RULES: list[tuple[str, str, list[str]]] = [
    ("alimentation-courses", "debit", [
        "carrefour", "leclerc", "intermarche", "auchan", "lidl", "aldi", "monoprix",
        "franprix", "casino", "super u", "hyper u", "cora", "grand frais", "picard",
        "biocoop", "naturalia", "g20", "spar", "netto", "match", "colruyt",
    ]),
    ("alimentation-restaurant", "debit", [
        "restaurant", "brasserie", "pizzeria", "mcdonald", "burger king", "kfc",
        "subway", "quick", "sushi", "bistrot", "creperie", "traiteur",
    ]),
    ("alimentation-livraison", "debit", [
        "uber eats", "deliveroo", "just eat", "frichti",
    ]),
    ("alimentation-cafe", "debit", ["starbucks", "columbus cafe", "bar tabac"]),
    ("logement-loyer", "debit", ["loyer", "quittance"]),
    ("logement-energie", "debit", [
        # One word, no space: normalize_label strips punctuation but never inserts
        # separators, so the brand arrives as "totalenergies". Written with a space
        # this pattern can never match, and gas bills fall through to the fuel rule.
        # Longer pattern wins at equal priority, so this beats plain "totalenergies".
        "edf", "engie", "totalenergies gaz", "eni gas", "veolia", "suez",
        "saur", "primeo energie", "vattenfall",
    ]),
    ("logement-internet", "debit", [
        "free mobile", "free haut debit", "orange", "sfr", "bouygues telecom",
        "sosh", "red by sfr", "bouygues",
    ]),
    ("logement-assurance", "debit", [
        "maif", "macif", "matmut", "gmf", "axa habitation", "allianz habitation",
    ]),
    ("logement-charges", "debit", ["syndic", "copropriete", "charges locatives"]),
    ("transport-carburant", "debit", [
        "totalenergies", "total access", "esso", "bp france", "shell", "avia",
        "station service", "carrefour station",
    ]),
    ("transport-peage", "debit", [
        "vinci autoroutes", "sanef", "aprr", "escota", "cofiroute", "peage",
        "parking", "indigo park", "effia",
    ]),
    ("transport-commun", "debit", [
        "ratp", "navigo", "tcl", "tisseo", "transpole", "keolis", "bibus",
    ]),
    ("transport-voyage", "debit", [
        "sncf", "ouigo", "trainline", "blablacar", "flixbus", "air france",
        "easyjet", "ryanair", "transavia", "booking com", "airbnb",
    ]),
    ("transport-entretien", "debit", [
        "norauto", "feu vert", "midas", "speedy", "euromaster", "controle technique",
    ]),
    ("transport-assurance", "debit", ["assurance auto", "direct assurance"]),
    ("sante-pharmacie", "debit", ["pharmacie", "parapharmacie"]),
    ("sante-medecin", "debit", [
        "cabinet medical", "docteur", "dr ", "laboratoire", "biogroup", "cerballiance",
        "kinesitherapeute", "hopital", "clinique",
    ]),
    ("sante-mutuelle", "debit", [
        "mutuelle", "harmonie mutuelle", "malakoff", "alan sante", "mgen",
    ]),
    ("sante-optique", "debit", ["optic", "krys", "afflelou", "grand optical", "dentaire"]),
    ("abonnements-streaming", "debit", [
        "netflix", "spotify", "deezer", "disney plus", "canal", "prime video",
        "apple tv", "youtube premium", "max com",
    ]),
    ("abonnements-logiciels", "debit", [
        "google one", "google storage", "icloud", "dropbox", "adobe", "microsoft 365",
        "openai", "anthropic", "github", "notion", "figma",
    ]),
    ("abonnements-salle", "debit", [
        "basic fit", "fitness park", "keep cool", "neoness", "on air",
    ]),
    ("abonnements-presse", "debit", ["le monde", "mediapart", "telerama", "les echos"]),
    ("achats-equipement", "debit", [
        "fnac", "darty", "boulanger", "ldlc", "materiel net", "apple store",
        "cdiscount", "back market",
    ]),
    ("achats-vetements", "debit", [
        "zara", "h m", "uniqlo", "decathlon", "kiabi", "celio", "jules",
        "vinted", "zalando", "asos",
    ]),
    ("achats-maison", "debit", [
        "ikea", "leroy merlin", "castorama", "bricorama", "maisons du monde",
        "conforama", "but ",
    ]),
    ("achats-cadeaux", "debit", ["amazon", "etsy", "aliexpress", "temu"]),
    ("famille-animaux", "debit", ["veterinaire", "maxi zoo", "animalis"]),
    ("impots-revenu", "debit", ["dgfip impot", "impots gouv", "prelevement a la source"]),
    ("impots-fonciere", "debit", ["taxe fonciere"]),
    ("impots-habitation", "debit", ["taxe habitation", "redevance audiovisuel"]),
    ("frais-tenue", "debit", ["frais tenue de compte", "cotisation compte"]),
    ("frais-agios", "debit", ["agios", "commission intervention", "frais incident"]),
    ("frais-carte", "debit", ["cotisation carte", "cotisation visa", "cotisation mastercard"]),
    ("epargne-livret", "any", ["vir livret", "versement livret", "livret a"]),
    ("epargne-bourse", "any", ["trade republic", "boursorama pea", "degiro", "saxo"]),
    ("epargne-assurance-vie", "any", ["linxea", "assurance vie", "spirica", "suravenir"]),
    ("revenus-salaire", "credit", ["salaire", "paie", "remuneration", "vir sepa employeur"]),
    ("revenus-allocations", "credit", ["caf ", "pole emploi", "france travail", "apl"]),
    ("revenus-remboursements", "credit", [
        "cpam", "ameli", "remboursement", "secu", "assurance maladie",
    ]),
    ("revenus-loyers", "credit", ["loyer percu", "vir locataire"]),
    ("virement-interne", "any", ["virement interne", "vir compte a compte"]),
]


def seed_rules(db: Session, user_id: int, categories: dict[str, Category]) -> int:
    """Install the built-in French rule library. Returns how many rules were created."""
    existing = {
        (r.pattern, r.category_id)
        for r in db.query(CategoryRule).filter(CategoryRule.user_id == user_id).all()
    }
    created = 0
    for slug, direction, patterns in BUILTIN_RULES:
        category = categories.get(slug)
        if category is None:
            continue
        for pattern in patterns:
            if (pattern, category.id) in existing:
                continue
            db.add(CategoryRule(
                user_id=user_id, pattern=pattern, is_regex=False,
                category_id=category.id, priority=100, origin="builtin",
                direction=direction,
            ))
            created += 1
    db.commit()
    return created
```

- [ ] **Step 6: Exporter `CategoryRule` depuis `backend/app/models/__init__.py`**

Ajouter `from app.models.rule import RULE_ORIGINS, RULE_PRIORITIES, CategoryRule` et compléter `__all__`.

- [ ] **Step 7: Appeler `seed_rules` à l'inscription**

Dans `backend/app/api/auth.py`, remplacer `seed_categories(db, user.id)` par :

```python
from app.categorization.seed import seed_categories, seed_rules

categories = seed_categories(db, user.id)
seed_rules(db, user.id, categories)
```

- [ ] **Step 8: Lancer les tests**

Run: `cd backend && pytest -v`
Expected: tous PASS (8 nouveaux tests)

- [ ] **Step 9: Migration et commit**

```bash
cd backend && alembic revision --autogenerate -m "category rules" && alembic upgrade head
git add backend/
git commit -m "feat(categorization): add rule engine with built-in French merchant library"
```

---

### Task 10: Apprentissage des corrections manuelles

**Files:**
- Create: `backend/app/categorization/learning.py`
- Create: `backend/tests/test_learning.py`

**Interfaces:**
- Consumes: `CategoryRule`, `Transaction`, `normalize_label`.
- Produces:
  - `extract_pattern(label_clean: str) -> str | None` — extrait le noyau marchand stable d'un libellé ; `None` s'il est trop court ou trop générique pour faire une règle sûre
  - `learn_from_correction(db, user_id: int, transaction: Transaction, category_id: int) -> CategoryRule | None` — crée ou renforce une règle apprise ; renvoie `None` si aucun motif exploitable
  - `apply_learned_rule(db, user_id: int, rule: CategoryRule, only_uncategorized: bool) -> int` — réapplique la règle aux transactions existantes, renvoie le nombre mis à jour
  - `STOPWORDS: frozenset[str]` — mots trop génériques pour constituer une règle à eux seuls

- [ ] **Step 1: Écrire les tests qui échouent**

Créer `backend/tests/test_learning.py` :

```python
from datetime import date

import pytest

from app.categorization.learning import apply_learned_rule, extract_pattern, learn_from_correction
from app.categorization.seed import seed_categories
from app.models import Account, CategoryRule, Transaction, User


@pytest.fixture
def fixture_user(db):
    user = User(email="a@b.c", name="A", password_hash="x")
    db.add(user)
    db.commit()
    categories = seed_categories(db, user.id)
    account = Account(user_id=user.id, name="Courant", kind="checking")
    db.add(account)
    db.commit()
    return user, account, categories


def _transaction(db, user, account, label_clean: str, cents: int = -1000) -> Transaction:
    transaction = Transaction(
        user_id=user.id, account_id=account.id, date=date(2025, 3, 1),
        amount_cents=cents, label_raw=label_clean.upper(), label_clean=label_clean,
        dedup_hash=f"h-{label_clean}-{cents}",
    )
    db.add(transaction)
    db.commit()
    return transaction


def test_extract_pattern_keeps_the_merchant_core():
    assert extract_pattern("boulangerie du coin") == "boulangerie du coin"
    assert extract_pattern("cb boulangerie marie") == "boulangerie marie"


def test_extract_pattern_drops_generic_payment_words():
    assert extract_pattern("paiement cb prelevement") is None
    assert extract_pattern("vir") is None


def test_extract_pattern_rejects_too_short_a_core():
    assert extract_pattern("ab") is None


def test_extract_pattern_caps_length_to_stay_specific_but_reusable():
    pattern = extract_pattern("cb societe generale de distribution alimentaire du nord est")
    assert pattern is not None
    assert len(pattern.split()) <= 4


def test_learning_creates_a_rule_with_learned_priority(db, fixture_user):
    user, account, categories = fixture_user
    transaction = _transaction(db, user, account, "boulangerie du coin")
    rule = learn_from_correction(db, user.id, transaction,
                                 categories["alimentation-courses"].id)
    assert rule is not None
    assert rule.origin == "learned"
    assert rule.priority == 200
    assert rule.direction == "debit"


def test_learning_twice_reinforces_instead_of_duplicating(db, fixture_user):
    user, account, categories = fixture_user
    first = _transaction(db, user, account, "boulangerie du coin")
    second = _transaction(db, user, account, "boulangerie du coin", cents=-1200)
    learn_from_correction(db, user.id, first, categories["alimentation-courses"].id)
    learn_from_correction(db, user.id, second, categories["alimentation-courses"].id)
    rules = db.query(CategoryRule).filter(CategoryRule.origin == "learned").all()
    assert len(rules) == 1
    assert rules[0].hit_count == 2


def test_correcting_to_a_different_category_repoints_the_rule(db, fixture_user):
    user, account, categories = fixture_user
    transaction = _transaction(db, user, account, "boulangerie du coin")
    learn_from_correction(db, user.id, transaction, categories["alimentation-courses"].id)
    learn_from_correction(db, user.id, transaction, categories["alimentation-restaurant"].id)
    rules = db.query(CategoryRule).filter(CategoryRule.origin == "learned").all()
    assert len(rules) == 1
    assert rules[0].category_id == categories["alimentation-restaurant"].id


def test_learning_returns_none_when_no_usable_pattern(db, fixture_user):
    user, account, categories = fixture_user
    transaction = _transaction(db, user, account, "cb")
    assert learn_from_correction(db, user.id, transaction, categories["divers"].id) is None


def test_apply_learned_rule_updates_only_uncategorized_by_default(db, fixture_user):
    user, account, categories = fixture_user
    untouched = _transaction(db, user, account, "boulangerie du coin", cents=-500)
    untouched.category_id = categories["divers"].id
    untouched.category_source = "manual"
    pending = _transaction(db, user, account, "boulangerie du coin", cents=-900)
    db.commit()

    source = _transaction(db, user, account, "boulangerie du coin", cents=-1000)
    rule = learn_from_correction(db, user.id, source, categories["alimentation-courses"].id)
    updated = apply_learned_rule(db, user.id, rule, only_uncategorized=True)

    db.refresh(untouched)
    db.refresh(pending)
    assert updated >= 1
    assert untouched.category_id == categories["divers"].id
    assert pending.category_id == categories["alimentation-courses"].id
    assert pending.category_source == "learned"
```

- [ ] **Step 2: Lancer les tests pour vérifier qu'ils échouent**

Run: `cd backend && pytest tests/test_learning.py -v`
Expected: FAIL — module `app.categorization.learning` introuvable

- [ ] **Step 3: Écrire `backend/app/categorization/learning.py`**

```python
from sqlalchemy.orm import Session

from app.categorization.engine import compile_rules
from app.models import Transaction
from app.models.rule import CategoryRule

# Words that appear on nearly every French bank line: on their own they identify
# nothing, so a rule built from them would mislabel unrelated transactions.
STOPWORDS = frozenset({
    "cb", "carte", "paiement", "achat", "vir", "virement", "prlv", "prelevement",
    "sepa", "retrait", "dab", "facture", "web", "internet", "france", "fr",
    "sarl", "sas", "eurl", "sa", "ste", "societe", "du", "de", "des", "le",
    "la", "les", "et", "au", "aux", "chez", "pour", "par", "sur", "com",
})

_MAX_PATTERN_WORDS = 4
_MIN_PATTERN_LENGTH = 3
_LEARNED_PRIORITY = 200


def extract_pattern(label_clean: str) -> str | None:
    """Reduce a normalized label to a reusable merchant core.

    Stopwords are trimmed from the EDGES only, never from the middle. compile_rules
    matches a literal pattern with re.escape + search, so the pattern has to stay a
    contiguous substring of the label. Dropping an interior word would turn
    "restaurant de la gare" into "restaurant gare", which no longer matches the very
    transaction the rule was learned from — a rule that silently never fires.

    Returns None when nothing specific enough survives: a rule made of generic
    payment words would match unrelated transactions, so refusing is the right
    outcome, not a fallback.
    """
    words = (label_clean or "").split()
    start, end = 0, len(words)
    while start < end and (words[start] in STOPWORDS or words[start].isdigit()):
        start += 1
    while end > start and (words[end - 1] in STOPWORDS or words[end - 1].isdigit()):
        end -= 1

    core_words = words[start:end]
    if not core_words:
        return None
    # Taking a prefix keeps the result contiguous.
    core = " ".join(core_words[:_MAX_PATTERN_WORDS])
    if len(core) < _MIN_PATTERN_LENGTH:
        return None
    return core


def learn_from_correction(
    db: Session, user_id: int, transaction: Transaction, category_id: int
) -> CategoryRule | None:
    """Turn a manual recategorization into a rule that will apply to future imports."""
    pattern = extract_pattern(transaction.label_clean)
    if pattern is None:
        return None

    direction = "credit" if transaction.amount_cents > 0 else "debit"
    rule = (
        db.query(CategoryRule)
        .filter(
            CategoryRule.user_id == user_id,
            CategoryRule.pattern == pattern,
            CategoryRule.origin == "learned",
        )
        .first()
    )

    if rule is None:
        rule = CategoryRule(
            user_id=user_id, pattern=pattern, is_regex=False, category_id=category_id,
            priority=_LEARNED_PRIORITY, origin="learned", direction=direction, hit_count=1,
        )
        db.add(rule)
    else:
        rule.category_id = category_id
        rule.direction = direction
        rule.hit_count += 1

    db.commit()
    db.refresh(rule)
    return rule


def apply_learned_rule(
    db: Session, user_id: int, rule: CategoryRule, only_uncategorized: bool = True
) -> int:
    """Backfill existing transactions with a freshly learned rule.

    Manual assignments are never overwritten: the user's explicit choice outranks
    anything inferred.
    """
    compiled = compile_rules([rule])
    if not compiled:
        return 0

    query = db.query(Transaction).filter(Transaction.user_id == user_id)
    if only_uncategorized:
        query = query.filter(
            Transaction.category_source.in_(("uncategorized", "builtin", "rule", "csv"))
        )
    else:
        query = query.filter(Transaction.category_source != "manual")

    updated = 0
    for transaction in query.all():
        if transaction.category_id == rule.category_id:
            continue
        compiled_rule = compiled[0]
        if compiled_rule.direction == "credit" and transaction.amount_cents <= 0:
            continue
        if compiled_rule.direction == "debit" and transaction.amount_cents >= 0:
            continue
        if compiled_rule.matcher.search(transaction.label_clean):
            transaction.category_id = rule.category_id
            transaction.category_source = "learned"
            updated += 1

    db.commit()
    return updated
```

- [ ] **Step 4: Lancer les tests**

Run: `cd backend && pytest tests/test_learning.py -v`
Expected: 9 tests PASS

- [ ] **Step 5: Commit**

```bash
git add backend/
git commit -m "feat(categorization): learn reusable rules from manual recategorizations"
```

---

### Task 11: Service d'import — prévisualisation, validation atomique, annulation

**Files:**
- Create: `backend/app/importers/service.py`
- Create: `backend/tests/test_import_service.py`

**Interfaces:**
- Consumes: `detect_dialect`, `read_rows`, `parse_rows`, `compute_dedup_hash`, `compile_rules`, `classify`, `CandidateRow`, `Transaction`, `ImportBatch`, `Category`, `CategoryRule`.
- Produces:
  - `@dataclass PreviewRow(row_number, date, amount_cents, label_raw, category_id, category_name, category_source, is_duplicate, error)`
  - `@dataclass ImportPreview(dialect, headers, sample_rows, suggested_mapping, rows, summary)` où `summary` est un `dict` avec `total, importable, duplicates, failed, date_from, date_to, inflow_cents, outflow_cents`
  - `build_preview(db, user_id, account_id, raw: bytes, dialect: CsvDialect | None, mapping: dict[int, str] | None) -> ImportPreview`
  - `commit_import(db, user_id, account_id, raw: bytes, filename: str, dialect: CsvDialect, mapping: dict[int, str], overrides: dict[int, int], keep_duplicates: list[int]) -> ImportBatch`
  - `rollback_import(db, user_id, batch_id: int) -> int` — renvoie le nombre de transactions supprimées
- `overrides` associe un numéro de ligne à un identifiant de catégorie choisi par l'utilisateur dans l'écran de prévisualisation. `keep_duplicates` liste les numéros de ligne que l'utilisateur veut importer malgré la détection de doublon.

- [ ] **Step 1: Écrire les tests qui échouent**

Créer `backend/tests/test_import_service.py` :

```python
from pathlib import Path

import pytest

from app.categorization.seed import seed_categories, seed_rules
from app.importers.dialect import detect_dialect
from app.importers.mapping import suggest_mapping
from app.importers.service import build_preview, commit_import, rollback_import
from app.models import Account, Transaction, User

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
```

- [ ] **Step 2: Lancer les tests pour vérifier qu'ils échouent**

Run: `cd backend && pytest tests/test_import_service.py -v`
Expected: FAIL — module `app.importers.service` introuvable

- [ ] **Step 3: Écrire `backend/app/importers/service.py`**

```python
import hashlib
from dataclasses import dataclass, field
from datetime import date

from sqlalchemy.orm import Session

from app.categorization.engine import compile_rules, classify
from app.importers.dedup import compute_dedup_hash
from app.importers.dialect import CsvDialect, detect_dialect, read_rows
from app.importers.mapping import suggest_mapping, validate_mapping
from app.importers.parser import CandidateRow, parse_rows
from app.models import Category, ImportBatch, Transaction
from app.models.rule import CategoryRule


class MappingError(ValueError):
    """Raised when a column mapping cannot produce transactions."""


@dataclass
class PreviewRow:
    row_number: int
    date: date | None
    amount_cents: int | None
    label_raw: str
    category_id: int | None
    category_name: str | None
    category_source: str
    is_duplicate: bool
    error: str | None


@dataclass
class ImportPreview:
    dialect: CsvDialect
    headers: list[str]
    sample_rows: list[list[str]]
    suggested_mapping: dict[int, str]
    rows: list[PreviewRow] = field(default_factory=list)
    summary: dict = field(default_factory=dict)


def _load_categorizer(db: Session, user_id: int):
    rules = db.query(CategoryRule).filter(CategoryRule.user_id == user_id).all()
    compiled = compile_rules(rules)
    categories = {c.id: c for c in db.query(Category).filter(Category.user_id == user_id).all()}
    by_name = {c.name.casefold(): c for c in categories.values()}
    return compiled, categories, by_name


def _resolve_category(
    candidate: CandidateRow, compiled, by_name: dict[str, Category]
) -> tuple[int | None, str]:
    """Precise hint, then rules, then coarse hint. Never discard information.

    A CSV category naming a leaf is as specific as anything a rule could infer, so it
    wins outright. A CSV category naming a parent bucket is coarser than a rule match,
    so the rule wins there — but when no rule fires, the bucket still beats leaving
    the row uncategorized. That last branch is not hypothetical: the seeded Loisirs
    subtree carries no built-in rules at all, so a bank-tagged leisure expense would
    otherwise always land uncategorized despite the file naming its category.

    Neither source is a guess dressed up as fact: the origin travels with the result.
    """
    hinted = None
    if candidate.category_hint:
        hinted = by_name.get(candidate.category_hint.strip().casefold())

    # parent_id set means the hint names a leaf.
    if hinted is not None and hinted.parent_id is not None:
        return hinted.id, "csv"

    match = classify(candidate.label_clean, candidate.amount_cents or 0, compiled)
    if match is not None:
        return match.category_id, match.source

    if hinted is not None:
        return hinted.id, "csv"
    return None, "uncategorized"


def _existing_hashes(db: Session, user_id: int) -> set[str]:
    rows = db.query(Transaction.dedup_hash).filter(Transaction.user_id == user_id).all()
    return {row[0] for row in rows}


def build_preview(
    db: Session,
    user_id: int,
    account_id: int,
    raw: bytes,
    dialect: CsvDialect | None,
    mapping: dict[int, str] | None,
) -> ImportPreview:
    """Analyse a file and show what would happen. Writes nothing."""
    resolved_dialect = dialect or detect_dialect(raw)
    headers, rows = read_rows(raw, resolved_dialect)
    resolved_mapping = mapping or suggest_mapping(headers)

    preview = ImportPreview(
        dialect=resolved_dialect,
        headers=headers,
        sample_rows=rows[:20],
        suggested_mapping=resolved_mapping,
    )

    errors = validate_mapping(resolved_mapping, len(headers))
    if errors:
        preview.summary = {
            "total": len(rows), "importable": 0, "duplicates": 0, "failed": len(rows),
            "date_from": None, "date_to": None, "inflow_cents": 0, "outflow_cents": 0,
            "mapping_errors": errors,
        }
        return preview

    compiled, categories, by_name = _load_categorizer(db, user_id)
    seen = _existing_hashes(db, user_id)
    within_file: set[str] = set()

    dates: list[date] = []
    inflow = outflow = 0
    duplicates = failed = importable = 0

    for candidate in parse_rows(rows, resolved_mapping, resolved_dialect):
        if candidate.error is not None:
            failed += 1
            preview.rows.append(PreviewRow(
                row_number=candidate.row_number, date=None, amount_cents=None,
                label_raw=candidate.label_raw, category_id=None, category_name=None,
                category_source="uncategorized", is_duplicate=False, error=candidate.error,
            ))
            continue

        fingerprint = compute_dedup_hash(user_id, account_id, candidate.date,
                                         candidate.amount_cents, candidate.label_raw)
        is_duplicate = fingerprint in seen or fingerprint in within_file
        within_file.add(fingerprint)

        category_id, source = _resolve_category(candidate, compiled, by_name)
        category = categories.get(category_id) if category_id else None

        if is_duplicate:
            duplicates += 1
        else:
            importable += 1
            dates.append(candidate.date)
            if candidate.amount_cents >= 0:
                inflow += candidate.amount_cents
            else:
                outflow += candidate.amount_cents

        preview.rows.append(PreviewRow(
            row_number=candidate.row_number, date=candidate.date,
            amount_cents=candidate.amount_cents, label_raw=candidate.label_raw,
            category_id=category_id, category_name=category.name if category else None,
            category_source=source, is_duplicate=is_duplicate, error=None,
        ))

    preview.summary = {
        "total": len(rows), "importable": importable, "duplicates": duplicates,
        "failed": failed,
        "date_from": min(dates) if dates else None,
        "date_to": max(dates) if dates else None,
        "inflow_cents": inflow, "outflow_cents": outflow,
        "mapping_errors": [],
    }
    return preview


def commit_import(
    db: Session,
    user_id: int,
    account_id: int,
    raw: bytes,
    filename: str,
    dialect: CsvDialect,
    mapping: dict[int, str],
    overrides: dict[int, int],
    keep_duplicates: list[int],
) -> ImportBatch:
    """Write the import in a single transaction. Either all of it lands, or none."""
    headers, rows = read_rows(raw, dialect)

    errors = validate_mapping(mapping, len(headers))
    if errors:
        raise MappingError(" ".join(errors))

    compiled, _categories, by_name = _load_categorizer(db, user_id)
    seen = _existing_hashes(db, user_id)
    forced = set(keep_duplicates)

    batch = ImportBatch(
        user_id=user_id, account_id=account_id, filename=filename,
        file_sha256=hashlib.sha256(raw).hexdigest(),
        dialect_json=dialect.__dict__ | {"sample_headers": headers},
        mapping_json={str(k): v for k, v in mapping.items()},
        rows_total=len(rows),
    )
    db.add(batch)
    db.flush()

    imported = duplicate = failed = 0
    for candidate in parse_rows(rows, mapping, dialect):
        if candidate.error is not None:
            failed += 1
            continue

        fingerprint = compute_dedup_hash(user_id, account_id, candidate.date,
                                         candidate.amount_cents, candidate.label_raw)
        if fingerprint in seen and candidate.row_number not in forced:
            duplicate += 1
            continue
        if fingerprint in seen:
            # Forced through by the user: find a free suffix so a deliberate duplicate
            # cannot trip the (user_id, dedup_hash) constraint — including when the
            # same row is forced through again in a later import.
            suffix = candidate.row_number
            while f"{fingerprint}:{suffix}" in seen:
                suffix += 1
            fingerprint = f"{fingerprint}:{suffix}"

        override = overrides.get(candidate.row_number)
        if override is not None:
            category_id, source = override, "manual"
        else:
            category_id, source = _resolve_category(candidate, compiled, by_name)

        db.add(Transaction(
            user_id=user_id, account_id=account_id, date=candidate.date,
            value_date=candidate.value_date, amount_cents=candidate.amount_cents,
            label_raw=candidate.label_raw, label_clean=candidate.label_clean,
            category_id=category_id, category_source=source,
            import_batch_id=batch.id, dedup_hash=fingerprint,
            notes=candidate.notes, tags=[],
        ))
        seen.add(fingerprint)
        imported += 1

    batch.rows_imported = imported
    batch.rows_duplicate = duplicate
    batch.rows_failed = failed
    db.commit()
    db.refresh(batch)
    return batch


def rollback_import(db: Session, user_id: int, batch_id: int) -> int:
    """Undo an entire import. Refuses to touch another user's batch."""
    batch = db.get(ImportBatch, batch_id)
    if batch is None:
        raise LookupError("Lot d'import introuvable")
    if batch.user_id != user_id:
        raise PermissionError("Ce lot d'import appartient à un autre utilisateur")

    removed = (
        db.query(Transaction)
        .filter(Transaction.user_id == user_id, Transaction.import_batch_id == batch_id)
        .delete(synchronize_session=False)
    )
    db.delete(batch)
    db.commit()
    return removed
```

- [ ] **Step 4: Lancer les tests**

Run: `cd backend && pytest tests/test_import_service.py -v`
Expected: 11 tests PASS

- [ ] **Step 5: Commit**

```bash
git add backend/
git commit -m "feat(importers): add preview, atomic commit, and rollback for CSV imports"
```

---

### Task 12: API d'import et gestion des comptes

**Files:**
- Create: `backend/app/schemas/imports.py`
- Create: `backend/app/schemas/accounts.py`
- Create: `backend/app/api/accounts.py`
- Create: `backend/app/api/imports.py`
- Modify: `backend/app/main.py`
- Create: `backend/tests/test_import_api.py`

**Interfaces:**
- Consumes: `build_preview`, `commit_import`, `rollback_import`, `get_current_user`, `Account`, `ColumnProfile`.
- Produces les routes :
  - `GET /api/accounts`, `POST /api/accounts`, `PATCH /api/accounts/{id}`, `DELETE /api/accounts/{id}`
  - `POST /api/imports/analyze` — `multipart/form-data` : `file`, `account_id`, `mapping` (JSON facultatif), `dialect` (JSON facultatif). Renvoie l'aperçu et un `upload_token`
  - `POST /api/imports/commit` — JSON : `upload_token`, `account_id`, `dialect`, `mapping`, `overrides`, `keep_duplicates`
  - `GET /api/imports` — historique des lots
  - `DELETE /api/imports/{batch_id}` — annulation
  - `GET /api/imports/profiles`, `POST /api/imports/profiles`, `DELETE /api/imports/profiles/{id}`
- Le fichier téléversé est écrit sous `settings.uploads_dir / "pending" / <user_id> / <token>`, où `<token>` est aléatoire. **Le répertoire porte l'identifiant de l'utilisateur, et `_upload_path` le reconstruit à partir de l'utilisateur authentifié — jamais à partir d'une valeur fournie par le client.** Un jeton ne peut donc désigner que le propre dépôt de son émetteur, quoi qu'il contienne.
- À la validation, le fichier est déplacé vers `settings.uploads_dir / "archive" / <user_id> / batch-<id>.csv`. **L'archive n'est jamais adressable par un jeton** : `_upload_path` ne regarde que `pending/`. Sans cette séparation, `batch-<id>.csv` — dont l'identifiant est un auto-incrément global — se devine, et un utilisateur peut réimporter le relevé d'un autre puis déplacer son fichier.
- Le nom d'origine du fichier voyage dans un champ dédié (`original_filename` renvoyé par `analyze`, réémis par le client dans `CommitIn`), jamais encodé dans le jeton : rien de contrôlé par le client ne doit se retrouver dans un composant de chemin.
- Un dépôt non validé est purgé au bout de 24 h. Le balayage tourne au début de chaque `analyze` — pas de tâche planifiée à maintenir, et un utilisateur actif suffit à nettoyer.
- Limite de téléversement : 20 Mo. Au-delà, 413 avec un message français.

- [ ] **Step 1: Écrire les tests qui échouent**

Créer `backend/tests/test_import_api.py` :

```python
from pathlib import Path

import pytest

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture
def auth(client):
    registered = client.post("/api/auth/register", json={
        "name": "Max", "email": "max@example.com", "password": "motdepasse123"}).json()
    return {"Authorization": f"Bearer {registered['access_token']}"}


@pytest.fixture
def account_id(client, auth) -> int:
    response = client.post("/api/accounts", headers=auth,
                           json={"name": "Compte courant", "kind": "checking"})
    return response.json()["id"]


def test_accounts_require_authentication(client):
    assert client.get("/api/accounts").status_code == 401


def test_account_creation_and_listing(client, auth):
    client.post("/api/accounts", headers=auth, json={"name": "Livret A", "kind": "savings"})
    listed = client.get("/api/accounts", headers=auth).json()
    assert [a["name"] for a in listed] == ["Livret A"]
    assert listed[0]["currency"] == "EUR"


def test_account_rejects_unknown_kind(client, auth):
    response = client.post("/api/accounts", headers=auth,
                           json={"name": "X", "kind": "not-a-kind"})
    assert response.status_code == 422


def test_analyze_returns_preview_with_suggested_mapping(client, auth, account_id):
    with (FIXTURES / "boursorama.csv").open("rb") as handle:
        response = client.post("/api/imports/analyze", headers=auth,
                               files={"file": ("boursorama.csv", handle, "text/csv")},
                               data={"account_id": str(account_id)})
    assert response.status_code == 200
    body = response.json()
    assert body["upload_token"]
    assert body["headers"] == ["dateOp", "dateVal", "label", "category", "amount"]
    assert body["suggested_mapping"]["0"] == "date"
    assert body["summary"]["importable"] == 4
    assert len(body["rows"]) == 4


def test_analyze_rejects_a_non_csv_extension(client, auth, account_id):
    response = client.post("/api/imports/analyze", headers=auth,
                           files={"file": ("photo.png", b"\x89PNG", "image/png")},
                           data={"account_id": str(account_id)})
    assert response.status_code == 400
    assert "CSV" in response.json()["detail"]


def test_analyze_rejects_an_account_owned_by_someone_else(client, auth, account_id):
    other = client.post("/api/auth/register", json={
        "name": "Lea", "email": "lea@example.com", "password": "motdepasse123"}).json()
    headers = {"Authorization": f"Bearer {other['access_token']}"}
    with (FIXTURES / "boursorama.csv").open("rb") as handle:
        response = client.post("/api/imports/analyze", headers=headers,
                               files={"file": ("b.csv", handle, "text/csv")},
                               data={"account_id": str(account_id)})
    assert response.status_code == 404


def test_commit_flow_creates_transactions(client, auth, account_id):
    with (FIXTURES / "boursorama.csv").open("rb") as handle:
        preview = client.post("/api/imports/analyze", headers=auth,
                              files={"file": ("b.csv", handle, "text/csv")},
                              data={"account_id": str(account_id)}).json()

    response = client.post("/api/imports/commit", headers=auth, json={
        "upload_token": preview["upload_token"],
        "account_id": account_id,
        "dialect": preview["dialect"],
        "mapping": preview["suggested_mapping"],
        "overrides": {},
        "keep_duplicates": [],
    })
    assert response.status_code == 201
    assert response.json()["rows_imported"] == 4

    batches = client.get("/api/imports", headers=auth).json()
    assert len(batches) == 1
    assert batches[0]["filename"] == "b.csv"


def test_commit_rejects_a_mapping_without_a_date_column(client, auth, account_id):
    with (FIXTURES / "boursorama.csv").open("rb") as handle:
        preview = client.post("/api/imports/analyze", headers=auth,
                              files={"file": ("b.csv", handle, "text/csv")},
                              data={"account_id": str(account_id)}).json()
    broken = dict(preview["suggested_mapping"])
    broken["0"] = "ignore"
    response = client.post("/api/imports/commit", headers=auth, json={
        "upload_token": preview["upload_token"], "account_id": account_id,
        "dialect": preview["dialect"], "mapping": broken,
        "overrides": {}, "keep_duplicates": [],
    })
    assert response.status_code == 422
    assert "Date" in response.json()["detail"]


def test_delete_batch_rolls_back_its_transactions(client, auth, account_id):
    with (FIXTURES / "boursorama.csv").open("rb") as handle:
        preview = client.post("/api/imports/analyze", headers=auth,
                              files={"file": ("b.csv", handle, "text/csv")},
                              data={"account_id": str(account_id)}).json()
    batch = client.post("/api/imports/commit", headers=auth, json={
        "upload_token": preview["upload_token"], "account_id": account_id,
        "dialect": preview["dialect"], "mapping": preview["suggested_mapping"],
        "overrides": {}, "keep_duplicates": [],
    }).json()

    assert client.delete(f"/api/imports/{batch['id']}", headers=auth).status_code == 200
    assert client.get("/api/imports", headers=auth).json() == []


def test_column_profile_can_be_saved_and_recalled(client, auth, account_id):
    with (FIXTURES / "boursorama.csv").open("rb") as handle:
        preview = client.post("/api/imports/analyze", headers=auth,
                              files={"file": ("b.csv", handle, "text/csv")},
                              data={"account_id": str(account_id)}).json()
    created = client.post("/api/imports/profiles", headers=auth, json={
        "name": "Boursorama", "dialect": preview["dialect"],
        "mapping": preview["suggested_mapping"],
    })
    assert created.status_code == 201
    profiles = client.get("/api/imports/profiles", headers=auth).json()
    assert profiles[0]["name"] == "Boursorama"
    assert profiles[0]["mapping"]["0"] == "date"


def test_saving_two_profiles_with_the_same_name_is_rejected(client, auth):
    payload = {"name": "Boursorama", "dialect": {}, "mapping": {"0": "date"}}
    client.post("/api/imports/profiles", headers=auth, json=payload)
    assert client.post("/api/imports/profiles", headers=auth, json=payload).status_code == 409
```

- [ ] **Step 2: Lancer les tests pour vérifier qu'ils échouent**

Run: `cd backend && pytest tests/test_import_api.py -v`
Expected: FAIL — 404 sur toutes les routes

- [ ] **Step 3: Écrire `backend/app/schemas/accounts.py`**

```python
from datetime import date
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.models import ACCOUNT_KINDS

AccountKind = Literal[ACCOUNT_KINDS]  # type: ignore[valid-type]


class AccountIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    kind: str
    currency: str = Field(default="EUR", min_length=3, max_length=3)
    opening_balance_cents: int = 0
    opened_on: date | None = None
    include_in_net_worth: bool = True


class AccountPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    include_in_net_worth: bool | None = None
    archived: bool | None = None


class AccountOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    kind: str
    currency: str
    opening_balance_cents: int
    opened_on: date | None
    include_in_net_worth: bool
    archived: bool
```

Le champ `kind` est validé dans le routeur contre `ACCOUNT_KINDS` afin de renvoyer un message français plutôt que l'erreur brute de Pydantic.

- [ ] **Step 4: Écrire `backend/app/api/accounts.py`**

```python
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import ACCOUNT_KINDS, Account, User
from app.schemas.accounts import AccountIn, AccountOut, AccountPatch
from app.security.deps import get_current_user

router = APIRouter(prefix="/accounts", tags=["accounts"])


def _owned_account(db: Session, user: User, account_id: int) -> Account:
    account = (
        db.query(Account)
        .filter(Account.id == account_id, Account.user_id == user.id)
        .first()
    )
    if account is None:
        raise HTTPException(status_code=404, detail="Compte introuvable")
    return account


@router.get("", response_model=list[AccountOut])
def list_accounts(user: User = Depends(get_current_user),
                  db: Session = Depends(get_db)) -> list[Account]:
    return (
        db.query(Account)
        .filter(Account.user_id == user.id, Account.archived.is_(False))
        .order_by(Account.id)
        .all()
    )


@router.post("", response_model=AccountOut, status_code=status.HTTP_201_CREATED)
def create_account(payload: AccountIn, user: User = Depends(get_current_user),
                   db: Session = Depends(get_db)) -> Account:
    if payload.kind not in ACCOUNT_KINDS:
        raise HTTPException(status_code=422,
                            detail=f"Type de compte inconnu : {payload.kind}")
    account = Account(user_id=user.id, **payload.model_dump())
    db.add(account)
    db.commit()
    db.refresh(account)
    return account


@router.patch("/{account_id}", response_model=AccountOut)
def patch_account(account_id: int, payload: AccountPatch,
                  user: User = Depends(get_current_user),
                  db: Session = Depends(get_db)) -> Account:
    account = _owned_account(db, user, account_id)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(account, field, value)
    db.commit()
    db.refresh(account)
    return account


@router.delete("/{account_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_account(account_id: int, user: User = Depends(get_current_user),
                   db: Session = Depends(get_db)) -> None:
    """Archiving, not deleting: transactions must never lose their account."""
    account = _owned_account(db, user, account_id)
    account.archived = True
    db.commit()
```

- [ ] **Step 5: Écrire `backend/app/schemas/imports.py`**

```python
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field


class DialectOut(BaseModel):
    encoding: str
    delimiter: str
    decimal_separator: str
    date_format: str
    header_row: int
    preamble_rows: int
    quotechar: str
    sample_headers: list[str] = Field(default_factory=list)


class PreviewRowOut(BaseModel):
    row_number: int
    date: date | None
    amount_cents: int | None
    label_raw: str
    category_id: int | None
    category_name: str | None
    category_source: str
    is_duplicate: bool
    error: str | None


class PreviewOut(BaseModel):
    upload_token: str
    dialect: DialectOut
    headers: list[str]
    sample_rows: list[list[str]]
    suggested_mapping: dict[str, str]
    rows: list[PreviewRowOut]
    summary: dict


class CommitIn(BaseModel):
    upload_token: str
    account_id: int
    dialect: DialectOut
    mapping: dict[str, str]
    overrides: dict[str, int] = Field(default_factory=dict)
    keep_duplicates: list[int] = Field(default_factory=list)


class BatchOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    account_id: int
    filename: str
    rows_total: int
    rows_imported: int
    rows_duplicate: int
    rows_failed: int
    created_at: datetime


class ProfileIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    dialect: dict
    mapping: dict[str, str]


class ProfileOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    dialect: dict
    mapping: dict[str, str]
    created_at: datetime
```

- [ ] **Step 6: Écrire `backend/app/api/imports.py`**

```python
import json
import secrets
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_db
from app.importers.dialect import CsvDialect
from app.importers.service import MappingError, build_preview, commit_import, rollback_import
from app.models import Account, ColumnProfile, ImportBatch, User
from app.schemas.imports import (
    BatchOut, CommitIn, PreviewOut, ProfileIn, ProfileOut,
)
from app.security.deps import get_current_user

router = APIRouter(prefix="/imports", tags=["imports"])

MAX_UPLOAD_BYTES = 20 * 1024 * 1024
ALLOWED_SUFFIXES = {".csv", ".txt", ".tsv"}


def _require_account(db: Session, user: User, account_id: int) -> Account:
    account = (
        db.query(Account)
        .filter(Account.id == account_id, Account.user_id == user.id)
        .first()
    )
    if account is None:
        raise HTTPException(status_code=404, detail="Compte introuvable")
    return account


def _pending_dir(user_id: int) -> Path:
    """Where this user's not-yet-committed uploads live. Derived from the
    authenticated user, never from client input."""
    directory = settings.uploads_dir / "pending" / str(user_id)
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def _upload_path(user_id: int, token: str) -> Path:
    """Resolve a token inside this user's pending directory, and nowhere else.

    The user segment comes from the session, so a token cannot reach another user's
    uploads however it is crafted. The containment check then catches traversal
    within the segment itself.
    """
    if not token or " " in token:
        raise HTTPException(status_code=400, detail="Jeton de téléversement invalide")
    base = _pending_dir(user_id).resolve()
    candidate = (base / token).resolve()
    if candidate.parent != base:
        raise HTTPException(status_code=400, detail="Jeton de téléversement invalide")
    return candidate


def _int_keys(mapping: dict[str, str]) -> dict[int, str]:
    try:
        return {int(k): v for k, v in mapping.items()}
    except ValueError as exc:
        raise HTTPException(status_code=422,
                            detail="Index de colonne invalide dans le mapping") from exc


@router.post("/analyze", response_model=PreviewOut)
async def analyze(
    file: UploadFile = File(...),
    account_id: int = Form(...),
    mapping: str | None = Form(None),
    dialect: str | None = Form(None),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PreviewOut:
    _require_account(db, user, account_id)

    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in ALLOWED_SUFFIXES:
        raise HTTPException(status_code=400,
                            detail="Format non pris en charge : déposez un fichier CSV.")

    # Read in chunks and stop at the cap. Reading the whole body first and checking
    # its length afterwards lets an authenticated client exhaust memory before the
    # limit is ever consulted.
    chunks: list[bytes] = []
    received = 0
    while chunk := await file.read(64 * 1024):
        received += len(chunk)
        if received > MAX_UPLOAD_BYTES:
            raise HTTPException(status_code=413,
                                detail="Fichier trop volumineux (20 Mo maximum).")
        chunks.append(chunk)
    raw = b"".join(chunks)
    if not raw.strip():
        raise HTTPException(status_code=400, detail="Le fichier est vide.")

    parsed_dialect = CsvDialect(**json.loads(dialect)) if dialect else None
    parsed_mapping = _int_keys(json.loads(mapping)) if mapping else None

    preview = build_preview(db, user.id, account_id, raw, parsed_dialect, parsed_mapping)

    token = f"{secrets.token_urlsafe(24)}.csv"
    _upload_path(token).write_bytes(raw)

    return PreviewOut(
        upload_token=token,
        dialect=preview.dialect.__dict__,
        headers=preview.headers,
        sample_rows=preview.sample_rows,
        suggested_mapping={str(k): v for k, v in preview.suggested_mapping.items()},
        rows=[r.__dict__ for r in preview.rows],
        summary=preview.summary,
    )


@router.post("/commit", response_model=BatchOut, status_code=status.HTTP_201_CREATED)
def commit(payload: CommitIn, user: User = Depends(get_current_user),
           db: Session = Depends(get_db)) -> ImportBatch:
    _require_account(db, user, payload.account_id)

    path = _upload_path(payload.upload_token)
    if not path.is_file():
        raise HTTPException(status_code=410,
                            detail="Le fichier téléversé a expiré. Recommencez l'import.")

    try:
        batch = commit_import(
            db, user.id, payload.account_id, path.read_bytes(),
            filename=payload.upload_token.split(".")[0] + ".csv",
            dialect=CsvDialect(**payload.dialect.model_dump()),
            mapping=_int_keys(payload.mapping),
            overrides={int(k): v for k, v in payload.overrides.items()},
            keep_duplicates=payload.keep_duplicates,
        )
    except MappingError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    # Keep the original file next to the batch so an import can be replayed later.
    archived = settings.uploads_dir / f"batch-{batch.id}.csv"
    path.rename(archived)
    batch.stored_path = str(archived)
    batch.filename = payload.upload_token if not batch.filename else batch.filename
    db.commit()
    db.refresh(batch)
    return batch


@router.get("", response_model=list[BatchOut])
def list_batches(user: User = Depends(get_current_user),
                 db: Session = Depends(get_db)) -> list[ImportBatch]:
    return (
        db.query(ImportBatch)
        .filter(ImportBatch.user_id == user.id)
        .order_by(ImportBatch.created_at.desc())
        .all()
    )


@router.delete("/{batch_id}")
def delete_batch(batch_id: int, user: User = Depends(get_current_user),
                 db: Session = Depends(get_db)) -> dict[str, int]:
    try:
        removed = rollback_import(db, user.id, batch_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=404, detail="Lot d'import introuvable") from exc
    return {"removed": removed}


@router.get("/profiles", response_model=list[ProfileOut])
def list_profiles(user: User = Depends(get_current_user),
                  db: Session = Depends(get_db)) -> list[ProfileOut]:
    profiles = (
        db.query(ColumnProfile)
        .filter(ColumnProfile.user_id == user.id)
        .order_by(ColumnProfile.name)
        .all()
    )
    return [
        ProfileOut(id=p.id, name=p.name, dialect=p.dialect_json,
                   mapping=p.mapping_json, created_at=p.created_at)
        for p in profiles
    ]


@router.post("/profiles", response_model=ProfileOut, status_code=status.HTTP_201_CREATED)
def create_profile(payload: ProfileIn, user: User = Depends(get_current_user),
                   db: Session = Depends(get_db)) -> ProfileOut:
    exists = (
        db.query(ColumnProfile)
        .filter(ColumnProfile.user_id == user.id, ColumnProfile.name == payload.name)
        .first()
    )
    if exists is not None:
        raise HTTPException(status_code=409, detail="Un profil porte déjà ce nom")

    profile = ColumnProfile(user_id=user.id, name=payload.name,
                            dialect_json=payload.dialect, mapping_json=payload.mapping)
    db.add(profile)
    db.commit()
    db.refresh(profile)
    return ProfileOut(id=profile.id, name=profile.name, dialect=profile.dialect_json,
                      mapping=profile.mapping_json, created_at=profile.created_at)


@router.delete("/profiles/{profile_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_profile(profile_id: int, user: User = Depends(get_current_user),
                   db: Session = Depends(get_db)) -> None:
    profile = (
        db.query(ColumnProfile)
        .filter(ColumnProfile.id == profile_id, ColumnProfile.user_id == user.id)
        .first()
    )
    if profile is None:
        raise HTTPException(status_code=404, detail="Profil introuvable")
    db.delete(profile)
    db.commit()
```

- [ ] **Step 7: Monter les routeurs dans `backend/app/main.py`**

```python
from app.api import accounts as account_routes
from app.api import imports as import_routes

api.include_router(account_routes.router)
api.include_router(import_routes.router)
```

- [ ] **Step 8: Lancer les tests**

Run: `cd backend && pytest -v`
Expected: tous PASS (11 nouveaux tests)

- [ ] **Step 9: Commit**

```bash
git add backend/
git commit -m "feat(api): add account management and CSV import endpoints"
```

---

# Lot C — Agrégation temporelle et API de lecture

### Task 13: Moteur d'agrégation jour / semaine / mois / trimestre / année

**Files:**
- Create: `backend/app/engines/__init__.py`
- Create: `backend/app/engines/aggregate.py`
- Create: `backend/tests/test_aggregate.py`

**Interfaces:**
- Consumes: rien d'autre que la bibliothèque standard — le moteur reçoit des tuples, pas une session.
- Produces:
  - `@dataclass TxPoint(on: date, amount_cents: int, category_id: int | None, account_id: int, is_transfer: bool)`
  - `Granularity = Literal["day", "week", "month", "quarter", "year"]`
  - `bucket_key(on: date, granularity: Granularity) -> str` — `2025-03-04`, `2025-W10`, `2025-03`, `2025-Q1`, `2025`
  - `bucket_bounds(key: str, granularity: Granularity) -> tuple[date, date]`
  - `aggregate_series(points, granularity, include_transfers=False) -> list[BucketTotals]` où `BucketTotals(key, start, end, inflow_cents, outflow_cents, net_cents, count)`
  - `aggregate_by_category(points, include_transfers=False) -> list[CategoryTotal]` avec `CategoryTotal(category_id, total_cents, count, share)`
  - `fill_missing_buckets(series, granularity, start, end) -> list[BucketTotals]` — insère des seaux à zéro pour que les graphiques n'aient pas de trous
  - `compare_periods(current, previous) -> PeriodComparison(delta_cents, delta_ratio | None)`
  - `moving_average(series, window) -> list[float]`
- Convention : les virements internes (`is_transfer`) sont **exclus par défaut** de toutes les agrégations, sinon un virement d'épargne compterait à la fois comme dépense et comme revenu.

- [ ] **Step 1: Écrire les tests qui échouent**

Créer `backend/tests/test_aggregate.py` :

```python
from datetime import date

import pytest

from app.engines.aggregate import (
    TxPoint, aggregate_by_category, aggregate_series, bucket_bounds, bucket_key,
    compare_periods, fill_missing_buckets, moving_average,
)


def _points() -> list[TxPoint]:
    return [
        TxPoint(date(2025, 1, 5), -1000, 1, 1, False),
        TxPoint(date(2025, 1, 20), -2000, 2, 1, False),
        TxPoint(date(2025, 1, 31), 300000, 3, 1, False),
        TxPoint(date(2025, 2, 3), -1500, 1, 1, False),
        TxPoint(date(2025, 2, 28), 300000, 3, 1, False),
        TxPoint(date(2025, 4, 2), -500, 1, 1, False),
        TxPoint(date(2025, 4, 2), -50000, None, 1, True),  # internal transfer
    ]


@pytest.mark.parametrize(("on", "granularity", "expected"), [
    (date(2025, 3, 4), "day", "2025-03-04"),
    (date(2025, 3, 4), "week", "2025-W10"),
    (date(2025, 3, 4), "month", "2025-03"),
    (date(2025, 3, 4), "quarter", "2025-Q1"),
    (date(2025, 3, 4), "year", "2025"),
    (date(2025, 12, 29), "week", "2026-W01"),  # ISO week rollover
])
def test_bucket_key(on, granularity, expected):
    assert bucket_key(on, granularity) == expected


@pytest.mark.parametrize(("key", "granularity", "start", "end"), [
    ("2025-03", "month", date(2025, 3, 1), date(2025, 3, 31)),
    ("2025-Q1", "quarter", date(2025, 1, 1), date(2025, 3, 31)),
    ("2025", "year", date(2025, 1, 1), date(2025, 12, 31)),
    ("2025-W10", "week", date(2025, 3, 3), date(2025, 3, 9)),
    ("2024-02", "month", date(2024, 2, 1), date(2024, 2, 29)),  # leap year
])
def test_bucket_bounds(key, granularity, start, end):
    assert bucket_bounds(key, granularity) == (start, end)


def test_monthly_series_splits_inflow_and_outflow():
    series = {b.key: b for b in aggregate_series(_points(), "month")}
    assert series["2025-01"].outflow_cents == -3000
    assert series["2025-01"].inflow_cents == 300000
    assert series["2025-01"].net_cents == 297000
    assert series["2025-01"].count == 3
    assert series["2025-02"].net_cents == 298500


def test_transfers_are_excluded_by_default():
    series = {b.key: b for b in aggregate_series(_points(), "month")}
    assert series["2025-04"].outflow_cents == -500
    with_transfers = {b.key: b for b in aggregate_series(_points(), "month",
                                                         include_transfers=True)}
    assert with_transfers["2025-04"].outflow_cents == -50500


def test_series_is_sorted_chronologically():
    keys = [b.key for b in aggregate_series(_points(), "month")]
    assert keys == sorted(keys)


def test_yearly_and_quarterly_rollups():
    # Q1 (595500) + Q2 (-500). The yearly total must equal the sum of the quarters.
    assert aggregate_series(_points(), "year")[0].net_cents == 595000
    quarters = {b.key: b for b in aggregate_series(_points(), "quarter")}
    assert quarters["2025-Q1"].net_cents == 595500
    assert quarters["2025-Q2"].net_cents == -500


def test_fill_missing_buckets_inserts_empty_months():
    series = aggregate_series(_points(), "month")
    filled = fill_missing_buckets(series, "month", date(2025, 1, 1), date(2025, 4, 30))
    assert [b.key for b in filled] == ["2025-01", "2025-02", "2025-03", "2025-04"]
    march = next(b for b in filled if b.key == "2025-03")
    assert march.net_cents == 0
    assert march.count == 0


def test_category_totals_and_shares_use_expenses_only():
    totals = {c.category_id: c for c in aggregate_by_category(_points())}
    assert totals[1].total_cents == -3000
    assert totals[2].total_cents == -2000
    assert 3 not in totals  # income category is not an expense share
    assert totals[1].share == pytest.approx(0.6)
    assert totals[2].share == pytest.approx(0.4)


def test_category_totals_are_sorted_by_magnitude():
    assert [c.category_id for c in aggregate_by_category(_points())] == [1, 2]


def test_compare_periods_returns_delta_and_ratio():
    comparison = compare_periods(-1500, -1000)
    assert comparison.delta_cents == -500
    assert comparison.delta_ratio == pytest.approx(0.5)


def test_compare_periods_handles_a_zero_baseline():
    assert compare_periods(-1500, 0).delta_ratio is None


def test_moving_average_uses_a_trailing_window():
    values = [b.net_cents for b in aggregate_series(_points(), "month")]
    assert moving_average(values, window=2)[0] == pytest.approx(values[0])
    assert moving_average(values, window=2)[1] == pytest.approx((values[0] + values[1]) / 2)


def test_moving_average_rejects_a_non_positive_window():
    with pytest.raises(ValueError):
        moving_average([1.0, 2.0], window=0)
```

- [ ] **Step 2: Lancer les tests pour vérifier qu'ils échouent**

Run: `cd backend && pytest tests/test_aggregate.py -v`
Expected: FAIL — module `app.engines.aggregate` introuvable

- [ ] **Step 3: Écrire `backend/app/engines/aggregate.py`**

```python
import calendar
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Literal

Granularity = Literal["day", "week", "month", "quarter", "year"]


@dataclass(frozen=True)
class TxPoint:
    """The minimal shape the aggregation engine needs. Deliberately not an ORM object."""

    on: date
    amount_cents: int
    category_id: int | None
    account_id: int
    is_transfer: bool = False


@dataclass(frozen=True)
class BucketTotals:
    key: str
    start: date
    end: date
    inflow_cents: int
    outflow_cents: int
    net_cents: int
    count: int


@dataclass(frozen=True)
class CategoryTotal:
    category_id: int | None
    total_cents: int
    count: int
    share: float


@dataclass(frozen=True)
class PeriodComparison:
    delta_cents: int
    delta_ratio: float | None


def bucket_key(on: date, granularity: Granularity) -> str:
    if granularity == "day":
        return on.isoformat()
    if granularity == "week":
        iso_year, iso_week, _ = on.isocalendar()
        return f"{iso_year}-W{iso_week:02d}"
    if granularity == "month":
        return f"{on.year}-{on.month:02d}"
    if granularity == "quarter":
        return f"{on.year}-Q{(on.month - 1) // 3 + 1}"
    if granularity == "year":
        return str(on.year)
    raise ValueError(f"Granularité inconnue : {granularity}")


def bucket_bounds(key: str, granularity: Granularity) -> tuple[date, date]:
    if granularity == "day":
        day = date.fromisoformat(key)
        return day, day
    if granularity == "week":
        year, week = key.split("-W")
        monday = date.fromisocalendar(int(year), int(week), 1)
        return monday, monday + timedelta(days=6)
    if granularity == "month":
        year, month = (int(part) for part in key.split("-"))
        return date(year, month, 1), date(year, month, calendar.monthrange(year, month)[1])
    if granularity == "quarter":
        year, quarter = key.split("-Q")
        first_month = (int(quarter) - 1) * 3 + 1
        last_month = first_month + 2
        return (
            date(int(year), first_month, 1),
            date(int(year), last_month, calendar.monthrange(int(year), last_month)[1]),
        )
    if granularity == "year":
        return date(int(key), 1, 1), date(int(key), 12, 31)
    raise ValueError(f"Granularité inconnue : {granularity}")


def _next_bucket_start(current: date, granularity: Granularity) -> date:
    if granularity == "day":
        return current + timedelta(days=1)
    if granularity == "week":
        return current + timedelta(days=7)
    if granularity == "month":
        return date(current.year + (current.month == 12), current.month % 12 + 1, 1)
    if granularity == "quarter":
        month = current.month + 3
        return date(current.year + (month > 12), (month - 1) % 12 + 1, 1)
    if granularity == "year":
        return date(current.year + 1, 1, 1)
    raise ValueError(f"Granularité inconnue : {granularity}")


def aggregate_series(
    points: list[TxPoint], granularity: Granularity, include_transfers: bool = False
) -> list[BucketTotals]:
    """Group transactions into time buckets.

    Internal transfers are excluded unless asked for: moving money to a savings
    account is not spending, and counting it would double-book the same euro.
    """
    accumulator: dict[str, dict[str, int]] = {}
    for point in points:
        if point.is_transfer and not include_transfers:
            continue
        key = bucket_key(point.on, granularity)
        bucket = accumulator.setdefault(key, {"inflow": 0, "outflow": 0, "count": 0})
        if point.amount_cents >= 0:
            bucket["inflow"] += point.amount_cents
        else:
            bucket["outflow"] += point.amount_cents
        bucket["count"] += 1

    result: list[BucketTotals] = []
    for key in sorted(accumulator):
        start, end = bucket_bounds(key, granularity)
        bucket = accumulator[key]
        result.append(BucketTotals(
            key=key, start=start, end=end,
            inflow_cents=bucket["inflow"], outflow_cents=bucket["outflow"],
            net_cents=bucket["inflow"] + bucket["outflow"], count=bucket["count"],
        ))
    return result


def fill_missing_buckets(
    series: list[BucketTotals], granularity: Granularity, start: date, end: date
) -> list[BucketTotals]:
    """Insert zero buckets so a chart shows a flat month rather than skipping it."""
    by_key = {bucket.key: bucket for bucket in series}
    filled: list[BucketTotals] = []
    cursor = bucket_bounds(bucket_key(start, granularity), granularity)[0]
    while cursor <= end:
        key = bucket_key(cursor, granularity)
        bucket_start, bucket_end = bucket_bounds(key, granularity)
        filled.append(by_key.get(key, BucketTotals(
            key=key, start=bucket_start, end=bucket_end,
            inflow_cents=0, outflow_cents=0, net_cents=0, count=0,
        )))
        cursor = _next_bucket_start(cursor, granularity)
    return filled


def aggregate_by_category(
    points: list[TxPoint], include_transfers: bool = False
) -> list[CategoryTotal]:
    """Expense totals per category, with each category's share of total spending."""
    totals: dict[int | None, dict[str, int]] = {}
    for point in points:
        if point.is_transfer and not include_transfers:
            continue
        if point.amount_cents >= 0:
            continue
        entry = totals.setdefault(point.category_id, {"total": 0, "count": 0})
        entry["total"] += point.amount_cents
        entry["count"] += 1

    grand_total = sum(abs(entry["total"]) for entry in totals.values())
    result = [
        CategoryTotal(
            category_id=category_id,
            total_cents=entry["total"],
            count=entry["count"],
            share=(abs(entry["total"]) / grand_total) if grand_total else 0.0,
        )
        for category_id, entry in totals.items()
    ]
    result.sort(key=lambda c: abs(c.total_cents), reverse=True)
    return result


def compare_periods(current_cents: int, previous_cents: int) -> PeriodComparison:
    """Delta and relative change. Ratio is None when there is no baseline to divide by."""
    delta = current_cents - previous_cents
    ratio = abs(delta) / abs(previous_cents) if previous_cents != 0 else None
    return PeriodComparison(delta_cents=delta, delta_ratio=ratio)


def moving_average(values: list[int] | list[float], window: int) -> list[float]:
    """Trailing moving average. Early points average over what is available."""
    if window <= 0:
        raise ValueError("La fenêtre doit être strictement positive")
    averages: list[float] = []
    for index in range(len(values)):
        slice_start = max(0, index - window + 1)
        chunk = values[slice_start: index + 1]
        averages.append(sum(chunk) / len(chunk))
    return averages
```

Créer `backend/app/engines/__init__.py` vide.

- [ ] **Step 4: Lancer les tests**

Run: `cd backend && pytest tests/test_aggregate.py -v`
Expected: 24 tests PASS

- [ ] **Step 5: Commit**

```bash
git add backend/
git commit -m "feat(engines): add time and category aggregation engine"
```

---

### Task 14: API transactions, catégories et analytics

**Files:**
- Create: `backend/app/schemas/transactions.py`
- Create: `backend/app/schemas/analytics.py`
- Create: `backend/app/api/transactions.py`
- Create: `backend/app/api/categories.py`
- Create: `backend/app/api/analytics.py`
- Modify: `backend/app/main.py`
- Create: `backend/tests/test_transactions_api.py`
- Create: `backend/tests/test_analytics_api.py`

**Interfaces:**
- Consumes: `aggregate_series`, `aggregate_by_category`, `fill_missing_buckets`, `compare_periods`, `learn_from_correction`, `apply_learned_rule`, `get_current_user`.
- Produces les routes :
  - `GET /api/transactions` — filtres `date_from`, `date_to`, `category_id`, `account_id`, `search`, `uncategorized_only`, `min_cents`, `max_cents` ; pagination `limit` (défaut 50, max 500) et `offset` ; renvoie `{items, total, limit, offset}`
  - `PATCH /api/transactions/{id}` — corps `{category_id?, notes?, is_transfer?, tags?}` ; un changement de catégorie déclenche l'apprentissage et renvoie `learned_rule_id` et `backfilled`
  - `DELETE /api/transactions/{id}`
  - `GET /api/categories` — liste plate ordonnée parents d'abord ; le frontend reconstruit l'arbre à deux niveaux depuis `parent_id`, ce dont `CategoryPicker` et `TransactionRow` ont besoin de toute façon. Pas de totaux ici : `GET /api/analytics/categories` les fournit déjà.
  - `POST /api/categories`, `PATCH /api/categories/{id}`, `DELETE /api/categories/{id}`
  - `GET /api/analytics/series?granularity=&date_from=&date_to=&account_id=` → seaux remplis
  - `GET /api/analytics/categories?date_from=&date_to=` → totaux et parts, avec nom et couleur
  - `GET /api/analytics/summary?date_from=&date_to=` → `{inflow_cents, outflow_cents, net_cents, transaction_count, savings_rate, previous: {...}, comparison: {...}}`
  - `GET /api/analytics/calendar?year=` → un point par jour, pour la heatmap
- `savings_rate` = `net_cents / inflow_cents` quand `inflow_cents > 0`, sinon `null`. Jamais 0 — une valeur indéfinie ne se déguise pas en zéro.

- [ ] **Step 1: Écrire les tests qui échouent**

Créer `backend/tests/test_transactions_api.py` :

```python
from pathlib import Path

import pytest

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture
def imported(client):
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


def test_listing_returns_transactions_newest_first(client, imported):
    headers, _ = imported
    body = client.get("/api/transactions", headers=headers).json()
    assert body["total"] == 4
    assert body["items"][0]["date"] == "2025-03-07"
    assert body["items"][0]["amount_cents"] == -6810


def test_listing_is_scoped_to_the_authenticated_user(client, imported):
    headers, _ = imported
    other = client.post("/api/auth/register", json={
        "name": "Lea", "email": "lea@example.com", "password": "motdepasse123"}).json()
    other_headers = {"Authorization": f"Bearer {other['access_token']}"}
    assert client.get("/api/transactions", headers=other_headers).json()["total"] == 0


def test_date_range_filter(client, imported):
    headers, _ = imported
    body = client.get("/api/transactions?date_from=2025-03-03&date_to=2025-03-05",
                      headers=headers).json()
    assert body["total"] == 2


def test_search_filter_matches_the_normalized_label(client, imported):
    headers, _ = imported
    assert client.get("/api/transactions?search=netflix", headers=headers).json()["total"] == 1
    assert client.get("/api/transactions?search=NETFLIX", headers=headers).json()["total"] == 1


def test_amount_range_filter(client, imported):
    headers, _ = imported
    body = client.get("/api/transactions?max_cents=-5000", headers=headers).json()
    assert body["total"] == 1


def test_pagination_reports_the_full_total(client, imported):
    headers, _ = imported
    body = client.get("/api/transactions?limit=2&offset=0", headers=headers).json()
    assert len(body["items"]) == 2
    assert body["total"] == 4


def test_limit_is_capped(client, imported):
    headers, _ = imported
    assert client.get("/api/transactions?limit=99999", headers=headers).status_code == 422


def test_recategorizing_creates_a_learned_rule(client, imported):
    headers, _ = imported
    listed = client.get("/api/transactions?search=netflix", headers=headers).json()
    categories = client.get("/api/categories", headers=headers).json()
    target = next(c for c in categories if c["slug"] == "abonnements-logiciels")

    response = client.patch(f"/api/transactions/{listed['items'][0]['id']}",
                            headers=headers, json={"category_id": target["id"]})
    assert response.status_code == 200
    assert response.json()["category_source"] == "manual"
    assert response.json()["learned_rule_id"] is not None


def test_patching_someone_elses_transaction_returns_404(client, imported):
    headers, _ = imported
    transaction_id = client.get("/api/transactions", headers=headers).json()["items"][0]["id"]
    other = client.post("/api/auth/register", json={
        "name": "Lea", "email": "lea@example.com", "password": "motdepasse123"}).json()
    other_headers = {"Authorization": f"Bearer {other['access_token']}"}
    response = client.patch(f"/api/transactions/{transaction_id}",
                            headers=other_headers, json={"notes": "vu"})
    assert response.status_code == 404


def test_patch_rejects_a_category_belonging_to_another_user(client, imported):
    headers, _ = imported
    transaction_id = client.get("/api/transactions", headers=headers).json()["items"][0]["id"]
    other = client.post("/api/auth/register", json={
        "name": "Lea", "email": "lea@example.com", "password": "motdepasse123"}).json()
    other_headers = {"Authorization": f"Bearer {other['access_token']}"}
    foreign = client.get("/api/categories", headers=other_headers).json()[0]
    response = client.patch(f"/api/transactions/{transaction_id}",
                            headers=headers, json={"category_id": foreign["id"]})
    assert response.status_code == 404


def test_marking_a_transaction_as_transfer_removes_it_from_spending(client, imported):
    headers, _ = imported
    transaction_id = client.get("/api/transactions?search=netflix",
                                headers=headers).json()["items"][0]["id"]
    client.patch(f"/api/transactions/{transaction_id}", headers=headers,
                 json={"is_transfer": True})
    summary = client.get("/api/analytics/summary?date_from=2025-01-01&date_to=2025-12-31",
                         headers=headers).json()
    assert summary["outflow_cents"] == -11542
```

**Déplacer d'abord la fixture `imported` dans `backend/tests/conftest.py`** — une
fixture importée d'un module de test à l'autre est fragile sous pytest. Retirer la
fixture locale de `test_transactions_api.py` et l'ajouter à `conftest.py` :

```python
from pathlib import Path

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture
def imported(client):
    """A registered user with one account and the Boursorama sample already imported."""
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
```

Créer `backend/tests/test_analytics_api.py` :

```python
import pytest


def test_monthly_series_is_gap_filled(client, imported):
    headers, _ = imported
    body = client.get(
        "/api/analytics/series?granularity=month&date_from=2025-01-01&date_to=2025-04-30",
        headers=headers).json()
    assert [b["key"] for b in body] == ["2025-01", "2025-02", "2025-03", "2025-04"]
    march = next(b for b in body if b["key"] == "2025-03")
    assert march["inflow_cents"] == 245000
    assert march["outflow_cents"] == -12891


def test_daily_granularity_is_supported(client, imported):
    headers, _ = imported
    body = client.get(
        "/api/analytics/series?granularity=day&date_from=2025-03-01&date_to=2025-03-07",
        headers=headers).json()
    assert len(body) == 7
    assert body[0]["outflow_cents"] == -4732


def test_unknown_granularity_is_rejected(client, imported):
    headers, _ = imported
    assert client.get("/api/analytics/series?granularity=fortnight",
                      headers=headers).status_code == 422


def test_category_breakdown_carries_names_and_colors(client, imported):
    headers, _ = imported
    body = client.get("/api/analytics/categories?date_from=2025-01-01&date_to=2025-12-31",
                      headers=headers).json()
    top = body[0]
    assert top["name"] == "Carburant"
    assert top["total_cents"] == -6810
    assert top["color"].startswith("#")
    assert 0 < top["share"] <= 1


def test_summary_reports_savings_rate(client, imported):
    headers, _ = imported
    body = client.get("/api/analytics/summary?date_from=2025-03-01&date_to=2025-03-31",
                      headers=headers).json()
    assert body["inflow_cents"] == 245000
    assert body["outflow_cents"] == -12891
    assert body["net_cents"] == 232109
    assert body["savings_rate"] == pytest.approx(232109 / 245000)


def test_summary_savings_rate_is_null_without_income(client, imported):
    headers, _ = imported
    body = client.get("/api/analytics/summary?date_from=2025-03-05&date_to=2025-03-07",
                      headers=headers).json()
    assert body["inflow_cents"] == 0
    assert body["savings_rate"] is None


def test_summary_compares_with_the_preceding_period(client, imported):
    headers, _ = imported
    body = client.get("/api/analytics/summary?date_from=2025-03-01&date_to=2025-03-31",
                      headers=headers).json()
    assert body["previous"]["date_from"] == "2025-01-29"
    assert body["comparison"]["delta_cents"] == 232109


def test_calendar_returns_one_point_per_day_with_activity(client, imported):
    headers, _ = imported
    body = client.get("/api/analytics/calendar?year=2025", headers=headers).json()
    by_day = {point["date"]: point for point in body}
    assert by_day["2025-03-01"]["outflow_cents"] == -4732
    assert "2025-03-02" not in by_day


def test_analytics_require_authentication(client):
    assert client.get("/api/analytics/summary").status_code == 401
```

- [ ] **Step 2: Lancer les tests pour vérifier qu'ils échouent**

Run: `cd backend && pytest tests/test_transactions_api.py tests/test_analytics_api.py -v`
Expected: FAIL — 404 sur toutes les routes

- [ ] **Step 3: Écrire `backend/app/schemas/transactions.py`**

```python
from datetime import date

from pydantic import BaseModel, ConfigDict, Field


class TransactionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    account_id: int
    date: date
    value_date: date | None
    amount_cents: int
    label_raw: str
    label_clean: str
    category_id: int | None
    category_source: str
    is_transfer: bool
    is_recurring: bool
    notes: str | None
    tags: list[str]


class TransactionPage(BaseModel):
    items: list[TransactionOut]
    total: int
    limit: int
    offset: int


class TransactionPatch(BaseModel):
    category_id: int | None = None
    notes: str | None = Field(default=None, max_length=2000)
    is_transfer: bool | None = None
    tags: list[str] | None = None


class TransactionPatchOut(TransactionOut):
    learned_rule_id: int | None = None
    backfilled: int = 0


class CategoryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    parent_id: int | None
    name: str
    slug: str
    kind: str
    color: str
    icon: str
    monthly_budget_cents: int | None


class CategoryIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    parent_id: int | None = None
    kind: str = "expense"
    color: str = "#7ee2d6"
    icon: str = "circle"
    monthly_budget_cents: int | None = None


class CategoryPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    color: str | None = None
    icon: str | None = None
    monthly_budget_cents: int | None = None
```

- [ ] **Step 4: Écrire `backend/app/api/transactions.py`**

```python
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.categorization.learning import apply_learned_rule, learn_from_correction
from app.db import get_db
from app.importers.dedup import normalize_label
from app.models import Category, Transaction, User
from app.schemas.transactions import (
    TransactionPage, TransactionPatch, TransactionPatchOut, TransactionOut,
)
from app.security.deps import get_current_user

router = APIRouter(prefix="/transactions", tags=["transactions"])


def _owned_transaction(db: Session, user: User, transaction_id: int) -> Transaction:
    transaction = (
        db.query(Transaction)
        .filter(Transaction.id == transaction_id, Transaction.user_id == user.id)
        .first()
    )
    if transaction is None:
        raise HTTPException(status_code=404, detail="Transaction introuvable")
    return transaction


@router.get("", response_model=TransactionPage)
def list_transactions(
    date_from: date | None = None,
    date_to: date | None = None,
    category_id: int | None = None,
    account_id: int | None = None,
    search: str | None = None,
    uncategorized_only: bool = False,
    min_cents: int | None = None,
    max_cents: int | None = None,
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TransactionPage:
    query = db.query(Transaction).filter(Transaction.user_id == user.id)

    if date_from is not None:
        query = query.filter(Transaction.date >= date_from)
    if date_to is not None:
        query = query.filter(Transaction.date <= date_to)
    if category_id is not None:
        query = query.filter(Transaction.category_id == category_id)
    if account_id is not None:
        query = query.filter(Transaction.account_id == account_id)
    if uncategorized_only:
        query = query.filter(Transaction.category_id.is_(None))
    if min_cents is not None:
        query = query.filter(Transaction.amount_cents >= min_cents)
    if max_cents is not None:
        query = query.filter(Transaction.amount_cents <= max_cents)
    if search:
        query = query.filter(Transaction.label_clean.contains(normalize_label(search)))

    total = query.with_entities(func.count(Transaction.id)).scalar() or 0
    items = (
        query.order_by(Transaction.date.desc(), Transaction.id.desc())
        .limit(limit).offset(offset).all()
    )
    return TransactionPage(items=items, total=total, limit=limit, offset=offset)


@router.patch("/{transaction_id}", response_model=TransactionPatchOut)
def patch_transaction(
    transaction_id: int,
    payload: TransactionPatch,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TransactionPatchOut:
    transaction = _owned_transaction(db, user, transaction_id)
    changes = payload.model_dump(exclude_unset=True)

    learned_rule_id: int | None = None
    backfilled = 0

    if "category_id" in changes and changes["category_id"] is not None:
        category = (
            db.query(Category)
            .filter(Category.id == changes["category_id"], Category.user_id == user.id)
            .first()
        )
        if category is None:
            raise HTTPException(status_code=404, detail="Catégorie introuvable")
        transaction.category_id = category.id
        transaction.category_source = "manual"

    for field in ("notes", "is_transfer", "tags"):
        if field in changes:
            setattr(transaction, field, changes[field])
    db.commit()
    db.refresh(transaction)

    if "category_id" in changes and changes["category_id"] is not None:
        rule = learn_from_correction(db, user.id, transaction, transaction.category_id)
        if rule is not None:
            learned_rule_id = rule.id
            backfilled = apply_learned_rule(db, user.id, rule, only_uncategorized=True)
            db.refresh(transaction)

    return TransactionPatchOut(
        **TransactionOut.model_validate(transaction).model_dump(),
        learned_rule_id=learned_rule_id,
        backfilled=backfilled,
    )


@router.delete("/{transaction_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_transaction(transaction_id: int, user: User = Depends(get_current_user),
                       db: Session = Depends(get_db)) -> None:
    db.delete(_owned_transaction(db, user, transaction_id))
    db.commit()
```

- [ ] **Step 5: Écrire `backend/app/api/categories.py`**

```python
import re
import unicodedata

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import CATEGORY_KINDS, Category, Transaction, User
from app.schemas.transactions import CategoryIn, CategoryOut, CategoryPatch
from app.security.deps import get_current_user

router = APIRouter(prefix="/categories", tags=["categories"])


def _slugify(name: str) -> str:
    text = unicodedata.normalize("NFKD", name)
    text = "".join(ch for ch in text if not unicodedata.combining(ch)).lower()
    return re.sub(r"[^a-z0-9]+", "-", text).strip("-")


def _owned_category(db: Session, user: User, category_id: int) -> Category:
    category = (
        db.query(Category)
        .filter(Category.id == category_id, Category.user_id == user.id)
        .first()
    )
    if category is None:
        raise HTTPException(status_code=404, detail="Catégorie introuvable")
    return category


@router.get("", response_model=list[CategoryOut])
def list_categories(user: User = Depends(get_current_user),
                    db: Session = Depends(get_db)) -> list[Category]:
    return (
        db.query(Category)
        .filter(Category.user_id == user.id)
        .order_by(Category.parent_id.nulls_first(), Category.position, Category.name)
        .all()
    )


@router.post("", response_model=CategoryOut, status_code=status.HTTP_201_CREATED)
def create_category(payload: CategoryIn, user: User = Depends(get_current_user),
                    db: Session = Depends(get_db)) -> Category:
    if payload.kind not in CATEGORY_KINDS:
        raise HTTPException(status_code=422, detail=f"Type inconnu : {payload.kind}")
    if payload.parent_id is not None:
        parent = _owned_category(db, user, payload.parent_id)
        if parent.parent_id is not None:
            raise HTTPException(status_code=422,
                                detail="La hiérarchie est limitée à deux niveaux")

    slug = _slugify(payload.name)
    if db.query(Category).filter(Category.user_id == user.id,
                                 Category.slug == slug).first() is not None:
        raise HTTPException(status_code=409, detail="Une catégorie porte déjà ce nom")

    category = Category(user_id=user.id, slug=slug, **payload.model_dump())
    db.add(category)
    db.commit()
    db.refresh(category)
    return category


@router.patch("/{category_id}", response_model=CategoryOut)
def patch_category(category_id: int, payload: CategoryPatch,
                   user: User = Depends(get_current_user),
                   db: Session = Depends(get_db)) -> Category:
    category = _owned_category(db, user, category_id)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(category, field, value)
    db.commit()
    db.refresh(category)
    return category


@router.delete("/{category_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_category(category_id: int, user: User = Depends(get_current_user),
                    db: Session = Depends(get_db)) -> None:
    """Transactions are never deleted with their category — they become uncategorized.

    Deleting a parent cascades to its children, so the transactions filed under
    those children have to be uncategorized too. Leaving them to the database's
    ON DELETE SET NULL would null category_id while leaving category_source saying
    "manual" — a row claiming a hand-picked category it no longer has.
    """
    category = _owned_category(db, user, category_id)

    doomed = [category.id] + [
        child.id
        for child in db.query(Category)
        .filter(Category.user_id == user.id, Category.parent_id == category.id)
        .all()
    ]
    (
        db.query(Transaction)
        .filter(Transaction.user_id == user.id, Transaction.category_id.in_(doomed))
        .update({"category_id": None, "category_source": "uncategorized"},
                synchronize_session=False)
    )
    db.delete(category)
    db.commit()
```

- [ ] **Step 6: Écrire `backend/app/api/analytics.py`**

```python
from datetime import date, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.db import get_db
from app.engines.aggregate import (
    TxPoint, aggregate_by_category, aggregate_series, bucket_key, compare_periods,
    fill_missing_buckets,
)
from app.models import Category, Transaction, User
from app.security.deps import get_current_user

router = APIRouter(prefix="/analytics", tags=["analytics"])

Granularity = Literal["day", "week", "month", "quarter", "year"]


def _points(db: Session, user_id: int, date_from: date | None, date_to: date | None,
            account_id: int | None = None) -> list[TxPoint]:
    query = db.query(Transaction).filter(Transaction.user_id == user_id)
    if date_from is not None:
        query = query.filter(Transaction.date >= date_from)
    if date_to is not None:
        query = query.filter(Transaction.date <= date_to)
    if account_id is not None:
        query = query.filter(Transaction.account_id == account_id)
    return [
        TxPoint(on=t.date, amount_cents=t.amount_cents, category_id=t.category_id,
                account_id=t.account_id, is_transfer=t.is_transfer)
        for t in query.all()
    ]


def _default_range(date_from: date | None, date_to: date | None) -> tuple[date, date]:
    end = date_to or date.today()
    start = date_from or date(end.year, 1, 1)
    return start, end


@router.get("/series")
def series(
    granularity: Granularity = "month",
    date_from: date | None = None,
    date_to: date | None = None,
    account_id: int | None = None,
    include_transfers: bool = False,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[dict]:
    start, end = _default_range(date_from, date_to)
    points = _points(db, user.id, start, end, account_id)
    buckets = aggregate_series(points, granularity, include_transfers)
    filled = fill_missing_buckets(buckets, granularity, start, end)
    return [
        {
            "key": b.key, "start": b.start.isoformat(), "end": b.end.isoformat(),
            "inflow_cents": b.inflow_cents, "outflow_cents": b.outflow_cents,
            "net_cents": b.net_cents, "count": b.count,
        }
        for b in filled
    ]


@router.get("/categories")
def categories_breakdown(
    date_from: date | None = None,
    date_to: date | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[dict]:
    start, end = _default_range(date_from, date_to)
    totals = aggregate_by_category(_points(db, user.id, start, end))
    names = {c.id: c for c in db.query(Category).filter(Category.user_id == user.id).all()}
    return [
        {
            "category_id": total.category_id,
            "name": names[total.category_id].name if total.category_id in names
            else "Non catégorisé",
            "color": names[total.category_id].color if total.category_id in names
            else "#64748b",
            "total_cents": total.total_cents,
            "count": total.count,
            "share": total.share,
        }
        for total in totals
    ]


@router.get("/summary")
def summary(
    date_from: date | None = None,
    date_to: date | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    start, end = _default_range(date_from, date_to)
    span = (end - start).days + 1
    previous_end = start - timedelta(days=1)
    previous_start = previous_end - timedelta(days=span - 1)

    def totals(from_: date, to_: date) -> dict:
        points = _points(db, user.id, from_, to_)
        inflow = sum(p.amount_cents for p in points
                     if p.amount_cents > 0 and not p.is_transfer)
        outflow = sum(p.amount_cents for p in points
                      if p.amount_cents < 0 and not p.is_transfer)
        net = inflow + outflow
        return {
            "date_from": from_.isoformat(), "date_to": to_.isoformat(),
            "inflow_cents": inflow, "outflow_cents": outflow, "net_cents": net,
            "transaction_count": len([p for p in points if not p.is_transfer]),
            # A savings rate without income is undefined, not zero.
            "savings_rate": (net / inflow) if inflow > 0 else None,
        }

    current = totals(start, end)
    previous = totals(previous_start, previous_end)
    comparison = compare_periods(current["net_cents"], previous["net_cents"])
    return {
        **current,
        "previous": previous,
        "comparison": {"delta_cents": comparison.delta_cents,
                       "delta_ratio": comparison.delta_ratio},
    }


@router.get("/calendar")
def calendar_heatmap(
    year: int = Query(..., ge=1970, le=2200),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[dict]:
    points = _points(db, user.id, date(year, 1, 1), date(year, 12, 31))
    buckets = aggregate_series(points, "day")
    return [
        {"date": b.key, "inflow_cents": b.inflow_cents,
         "outflow_cents": b.outflow_cents, "net_cents": b.net_cents, "count": b.count}
        for b in buckets
    ]
```

- [ ] **Step 7: Monter les routeurs dans `backend/app/main.py`**

```python
from app.api import analytics as analytics_routes
from app.api import categories as category_routes
from app.api import transactions as transaction_routes

api.include_router(transaction_routes.router)
api.include_router(category_routes.router)
api.include_router(analytics_routes.router)
```

- [ ] **Step 8: Lancer toute la suite**

Run: `cd backend && pytest -v --cov=app --cov-report=term-missing`
Expected: tous PASS, couverture ≥ 80 % sur `app/engines` et `app/importers`

- [ ] **Step 9: Commit**

```bash
git add backend/
git commit -m "feat(api): add transaction, category, and analytics endpoints"
```

---

# Lot D — Frontend

> **Compétences à invoquer avant d'attaquer ce lot :** `ecc:liquid-glass-design` pour le matériau verre, `ui-ux-pro-max:design-system` pour la cohérence des composants, `ecc:motion-ui` pour les animations, `dataviz` avant d'écrire la moindre ligne de graphique. Elles cadrent le rendu ; les tâches ci-dessous cadrent le comportement.

### Task 15: Squelette frontend, jetons Abysse, thèmes clair et sombre

**Files:**
- Create: `frontend/package.json`
- Create: `frontend/vite.config.ts`
- Create: `frontend/tsconfig.json`
- Create: `frontend/index.html`
- Create: `frontend/src/main.tsx`
- Create: `frontend/src/design/tokens.css`
- Create: `frontend/src/design/theme.ts`
- Create: `frontend/src/index.css`
- Create: `frontend/vitest.config.ts`
- Create: `frontend/src/design/theme.test.ts`

**Interfaces:**
- Produces:
  - `readStoredTheme()`, `storeTheme(preference)`, `resolveTheme(preference, prefersDark)` — la préférence est persistée dans `localStorage` sous `yieldo.theme`, et `system` suit `prefers-color-scheme`. Le hook React `useTheme()` qui les enveloppe appartient au `ThemeProvider` de la tâche 16, pas à celle-ci.
  - `formatCents(cents: number, options?) -> string` — `-4732` devient `−47,32 €` avec un signe moins typographique et des espaces insécables
  - `formatCompactCents(cents: number) -> string` — `184320000` devient `1,8 M€`
  - Jetons CSS : `--yd-bg`, `--yd-surface`, `--yd-surface-strong`, `--yd-border`, `--yd-text`, `--yd-text-muted`, `--yd-accent`, `--yd-positive`, `--yd-negative`, `--yd-warning`, `--yd-info`, `--yd-glass-blur`, `--yd-radius`, `--yd-shadow`
- Le proxy Vite renvoie `/api` vers `http://localhost:8000` en développement.

- [ ] **Step 1: Créer `frontend/package.json`**

```json
{
  "name": "yieldo-frontend",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22" },
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "eslint src --max-warnings 0"
  },
  "dependencies": {
    "@tanstack/react-query": "^5.62.0",
    "echarts": "^5.5.1",
    "motion": "^11.15.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "react-router": "^7.1.0",
    "zustand": "^5.0.2"
  },
  "devDependencies": {
    "@tailwindcss/vite": "^4.0.0",
    "@testing-library/jest-dom": "^6.6.3",
    "@testing-library/react": "^16.1.0",
    "@testing-library/user-event": "^14.5.2",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.3.4",
    "jsdom": "^26.0.0",
    "tailwindcss": "^4.0.0",
    "typescript": "^5.7.0",
    "vite": "^6.0.0",
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 2: Écrire le test qui échoue**

Créer `frontend/src/design/theme.test.ts` :

```ts
import { beforeEach, describe, expect, it } from "vitest";

import { formatCents, formatCompactCents, readStoredTheme, resolveTheme } from "./theme";

describe("formatCents", () => {
  beforeEach(() => localStorage.clear());

  it("formats a debit with a typographic minus and a euro sign", () => {
    expect(formatCents(-4732)).toBe("−47,32 €");
  });

  it("formats a credit without a plus sign by default", () => {
    expect(formatCents(245000)).toBe("2 450,00 €");
  });

  it("can force an explicit sign for deltas", () => {
    expect(formatCents(4180, { signed: true })).toBe("+41,80 €");
    expect(formatCents(-4180, { signed: true })).toBe("−41,80 €");
  });

  it("formats zero without a sign", () => {
    expect(formatCents(0)).toBe("0,00 €");
  });

  it("can omit decimals for dense tables", () => {
    expect(formatCents(-4732, { decimals: 0 })).toBe("−47 €");
  });
});

describe("formatCompactCents", () => {
  it("shortens large amounts", () => {
    expect(formatCompactCents(18432000)).toBe("184,3 k€");
    expect(formatCompactCents(18432000000)).toBe("184,3 M€");
  });

  it("keeps small amounts readable", () => {
    expect(formatCompactCents(4732)).toBe("47 €");
  });
});

describe("theme resolution", () => {
  beforeEach(() => localStorage.clear());

  it("defaults to system when nothing is stored", () => {
    expect(readStoredTheme()).toBe("system");
  });

  it("reads a stored preference", () => {
    localStorage.setItem("yieldo.theme", "light");
    expect(readStoredTheme()).toBe("light");
  });

  it("ignores a corrupted stored value rather than crashing", () => {
    localStorage.setItem("yieldo.theme", "neon");
    expect(readStoredTheme()).toBe("system");
  });

  it("resolves system against the media query result", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
  });
});
```

- [ ] **Step 3: Lancer le test pour vérifier qu'il échoue**

Run: `cd frontend && npm install && npm test`
Expected: FAIL — `Cannot find module './theme'`

- [ ] **Step 4: Écrire `frontend/src/design/theme.ts`**

```ts
export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "yieldo.theme";
const NARROW_NBSP = " "; // French thousands separator, non-breaking
const NBSP = " ";
const MINUS = "−"; // typographic minus, aligns with digit width

export function readStoredTheme(): ThemePreference {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") return stored;
  } catch {
    // Private browsing can deny localStorage entirely — fall through to the default.
  }
  return "system";
}

export function storeTheme(preference: ThemePreference): void {
  try {
    localStorage.setItem(STORAGE_KEY, preference);
  } catch {
    // Persisting a preference is a convenience, not a requirement.
  }
}

export function resolveTheme(preference: ThemePreference, prefersDark: boolean): ResolvedTheme {
  if (preference === "system") return prefersDark ? "dark" : "light";
  return preference;
}

interface FormatOptions {
  signed?: boolean;
  decimals?: 0 | 2;
  currency?: string;
}

export function formatCents(cents: number, options: FormatOptions = {}): string {
  const { signed = false, decimals = 2, currency = "€" } = options;
  const absolute = Math.abs(cents) / 100;
  const body = absolute
    .toLocaleString("fr-FR", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })
    .replace(/\s/g, NARROW_NBSP);

  const sign = cents < 0 ? MINUS : signed && cents > 0 ? "+" : "";
  return `${sign}${body}${NBSP}${currency}`;
}

export function formatCompactCents(cents: number, currency = "€"): string {
  const units = Math.abs(cents) / 100;
  const sign = cents < 0 ? MINUS : "";

  const scale = (value: number, suffix: string) =>
    `${sign}${value.toLocaleString("fr-FR", { maximumFractionDigits: 1 })}${NBSP}${suffix}${currency}`;

  if (units >= 1_000_000) return scale(units / 1_000_000, "M");
  if (units >= 1_000) return scale(units / 1_000, "k");
  return `${sign}${Math.round(units).toLocaleString("fr-FR")}${NBSP}${currency}`;
}
```

- [ ] **Step 5: Écrire `frontend/src/design/tokens.css`**

```css
/* Abysse — deep navy, teal accent. Both themes carry the same token names so
   every component stays theme-agnostic. */
:root {
  --yd-radius: 14px;
  --yd-radius-sm: 9px;
  --yd-glass-blur: 18px;
  --yd-glass-saturate: 155%;

  --yd-accent: #7ee2d6;
  --yd-accent-strong: #4dc9ba;
  --yd-positive: #4fd6a8;
  --yd-negative: #e5606b;
  --yd-warning: #f4a261;
  --yd-info: #3b82f6;

  --yd-font: "Geist", ui-sans-serif, system-ui, sans-serif;
  --yd-font-mono: "Geist Mono", ui-monospace, "SF Mono", monospace;

  /* Overlay behind the mobile drawer. A token, not an inline rgba, so a theme can
     tune it — a 40% black scrim is too heavy over the light theme. */
  --yd-scrim: rgba(4, 14, 22, 0.52);

  --yd-motion-fast: 140ms;
  --yd-motion-base: 260ms;
  --yd-motion-slow: 520ms;
  --yd-ease: cubic-bezier(0.22, 1, 0.36, 1);
}

:root,
:root[data-theme="dark"] {
  color-scheme: dark;
  --yd-bg: #060d15;
  --yd-bg-mesh-a: #123044;
  --yd-bg-mesh-b: #0a1622;
  --yd-surface: rgba(24, 58, 79, 0.38);
  --yd-surface-strong: #0f1c28;
  --yd-surface-raised: rgba(30, 70, 94, 0.5);
  --yd-border: rgba(126, 226, 214, 0.18);
  --yd-border-strong: rgba(126, 226, 214, 0.34);
  --yd-text: #eef6f8;
  --yd-text-muted: #93a9b8;
  --yd-shadow: 0 10px 34px rgba(0, 0, 0, 0.45);
  --yd-sheen: linear-gradient(160deg, rgba(255, 255, 255, 0.22), rgba(255, 255, 255, 0) 44%);
}

:root[data-theme="light"] {
  color-scheme: light;
  --yd-bg: #f2f7f9;
  --yd-bg-mesh-a: #d8eef0;
  --yd-bg-mesh-b: #eaf3f6;
  --yd-surface: rgba(255, 255, 255, 0.66);
  --yd-surface-strong: #ffffff;
  --yd-surface-raised: rgba(255, 255, 255, 0.86);
  --yd-border: rgba(15, 60, 74, 0.14);
  --yd-border-strong: rgba(15, 60, 74, 0.26);
  --yd-text: #0d2029;
  --yd-text-muted: #557184;
  /* Darkened until each clears 4.5:1 against --yd-bg. The dark theme's teals and
     ambers look right on light backgrounds but sit near 3.5:1, which is not
     readable for the figures this app exists to show. --yd-info needs its own
     value here too: the :root default is tuned for a dark background. */
  --yd-accent: #0b6d63;
  --yd-accent-strong: #085951;
  --yd-positive: #0e7150;
  --yd-negative: #b3232d;
  --yd-warning: #8a4d08;
  --yd-info: #1d4ed8;
  --yd-shadow: 0 10px 30px rgba(13, 45, 60, 0.12);
  --yd-sheen: linear-gradient(160deg, rgba(255, 255, 255, 0.8), rgba(255, 255, 255, 0) 46%);
}

@media (prefers-reduced-motion: reduce) {
  :root {
    --yd-motion-fast: 0ms;
    --yd-motion-base: 0ms;
    --yd-motion-slow: 0ms;
  }
}
```

- [ ] **Step 6: Écrire `frontend/src/index.css`**

```css
@import "tailwindcss";
@import "./design/tokens.css";

@theme {
  --color-accent: var(--yd-accent);
  --color-positive: var(--yd-positive);
  --color-negative: var(--yd-negative);
  --font-sans: var(--yd-font);
  --font-mono: var(--yd-font-mono);
}

html,
body,
#root {
  height: 100%;
}

body {
  margin: 0;
  background: var(--yd-bg);
  color: var(--yd-text);
  font-family: var(--yd-font);
  -webkit-font-smoothing: antialiased;
}

/* Slow mesh gradient behind everything — the only always-on animation. */
body::before {
  content: "";
  position: fixed;
  inset: -20%;
  z-index: -1;
  background:
    radial-gradient(45% 40% at 18% 12%, var(--yd-bg-mesh-a) 0%, transparent 70%),
    radial-gradient(40% 45% at 82% 78%, var(--yd-bg-mesh-b) 0%, transparent 72%);
  animation: yd-drift 34s var(--yd-ease) infinite alternate;
  pointer-events: none;
}

@keyframes yd-drift {
  to {
    transform: translate3d(2.5%, -2%, 0) scale(1.06);
  }
}

@media (prefers-reduced-motion: reduce) {
  body::before {
    animation: none;
  }
}

/* Money always uses tabular figures so columns line up. */
.yd-num {
  font-family: var(--yd-font-mono);
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.01em;
}
```

- [ ] **Step 7: Écrire `frontend/vite.config.ts` et `frontend/vitest.config.ts`**

```ts
// vite.config.ts
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: { "/api": { target: "http://localhost:8000", changeOrigin: true } },
  },
  build: { outDir: "dist", sourcemap: false },
});
```

```ts
// vitest.config.ts
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test-setup.ts"],
  },
});
```

Créer `frontend/src/test-setup.ts` :

```ts
import "@testing-library/jest-dom/vitest";
```

- [ ] **Step 8: Lancer les tests**

Run: `cd frontend && npm test`
Expected: 12 tests PASS

- [ ] **Step 9: Commit**

```bash
git add frontend/
git commit -m "feat(frontend): scaffold Vite app with Abysse design tokens and money formatting"
```

---

### Task 16: Primitives de verre, animations, coquille applicative

**Files:**
- Create: `frontend/src/design/glass/GlassCard.tsx`
- Create: `frontend/src/design/glass/GlassCard.css`
- Create: `frontend/src/design/motion/variants.ts`
- Create: `frontend/src/design/motion/useReducedMotion.ts`
- Create: `frontend/src/design/CountUp.tsx`
- Create: `frontend/src/app/AppShell.tsx`
- Create: `frontend/src/app/ThemeProvider.tsx`
- Create: `frontend/src/design/glass/GlassCard.test.tsx`
- Create: `frontend/src/design/CountUp.test.tsx`

**Interfaces:**
- Consumes: `useTheme`, jetons CSS.
- Produces:
  - `<GlassCard as?, tone?: "default" | "raised" | "solid", interactive?, className?>` — surface en verre ; `tone="solid"` désactive le flou pour les zones de données
  - `<Sheen />` — reflet spéculaire qui suit le curseur, monté seulement si `interactive`
  - `<CountUp value: number, format: (n: number) => string, duration?>` — anime la valeur ; affiche immédiatement la valeur finale si `prefers-reduced-motion`
  - `useReducedMotion() -> boolean`
  - `fadeInUp`, `staggerChildren`, `slideOver` — variantes Motion partagées
  - `<AppShell>` — barre latérale, en-tête, zone de contenu, sélecteur de thème
  - `<ThemeProvider>` — applique `data-theme` sur `<html>`

- [ ] **Step 1: Écrire les tests qui échouent**

Créer `frontend/src/design/glass/GlassCard.test.tsx` :

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { GlassCard } from "./GlassCard";

describe("GlassCard", () => {
  it("renders its children", () => {
    render(<GlassCard>Patrimoine</GlassCard>);
    expect(screen.getByText("Patrimoine")).toBeInTheDocument();
  });

  it("uses a blurred surface by default", () => {
    const { container } = render(<GlassCard>x</GlassCard>);
    expect(container.firstChild).toHaveClass("yd-glass");
    expect(container.firstChild).not.toHaveClass("yd-glass--solid");
  });

  it("drops the blur for data surfaces", () => {
    const { container } = render(<GlassCard tone="solid">x</GlassCard>);
    expect(container.firstChild).toHaveClass("yd-glass--solid");
  });

  it("only mounts the sheen when interactive", () => {
    const { container: plain } = render(<GlassCard>x</GlassCard>);
    expect(plain.querySelector(".yd-sheen")).toBeNull();
    const { container: interactive } = render(<GlassCard interactive>x</GlassCard>);
    expect(interactive.querySelector(".yd-sheen")).not.toBeNull();
  });

  it("renders as the requested element for correct semantics", () => {
    render(<GlassCard as="section" aria-label="Résumé">x</GlassCard>);
    expect(screen.getByRole("region", { name: "Résumé" })).toBeInTheDocument();
  });

  it("keeps caller classes", () => {
    const { container } = render(<GlassCard className="p-6">x</GlassCard>);
    expect(container.firstChild).toHaveClass("p-6");
  });
});
```

Créer `frontend/src/design/CountUp.test.tsx` :

```tsx
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CountUp } from "./CountUp";

function mockReducedMotion(reduced: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: reduced && query.includes("reduced-motion"),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
}

describe("CountUp", () => {
  beforeEach(() => vi.useRealTimers());

  it("shows the final value immediately when motion is reduced", () => {
    mockReducedMotion(true);
    render(<CountUp value={18432000} format={(n) => `${Math.round(n / 100)} €`} />);
    expect(screen.getByText("184320 €")).toBeInTheDocument();
  });

  it("exposes the final value to assistive technology while animating", () => {
    mockReducedMotion(false);
    render(<CountUp value={4180} format={(n) => `${Math.round(n)}`} />);
    expect(screen.getByRole("status")).toHaveAttribute("aria-label", "4180");
  });
});
```

- [ ] **Step 2: Lancer les tests pour vérifier qu'ils échouent**

Run: `cd frontend && npm test`
Expected: FAIL — modules introuvables

- [ ] **Step 3: Écrire `frontend/src/design/glass/GlassCard.css`**

```css
.yd-glass {
  position: relative;
  border-radius: var(--yd-radius);
  border: 1px solid var(--yd-border);
  background: var(--yd-surface);
  box-shadow: var(--yd-shadow);
  backdrop-filter: blur(var(--yd-glass-blur)) saturate(var(--yd-glass-saturate));
  -webkit-backdrop-filter: blur(var(--yd-glass-blur)) saturate(var(--yd-glass-saturate));
  overflow: hidden;
  transition:
    border-color var(--yd-motion-base) var(--yd-ease),
    transform var(--yd-motion-base) var(--yd-ease);
}

/* The lit top edge is what makes the surface read as a physical pane. */
.yd-glass::before {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: inherit;
  pointer-events: none;
  background: var(--yd-sheen);
  opacity: 0.7;
}

.yd-glass--raised {
  background: var(--yd-surface-raised);
  border-color: var(--yd-border-strong);
}

/* Data surfaces are opaque: figures must not be read through blur. */
.yd-glass--solid {
  background: var(--yd-surface-strong);
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}

.yd-glass--interactive:hover {
  border-color: var(--yd-border-strong);
  transform: translateY(-2px);
}

.yd-glass--interactive:focus-visible {
  outline: 2px solid var(--yd-accent);
  outline-offset: 2px;
}

.yd-sheen {
  position: absolute;
  inset: 0;
  border-radius: inherit;
  pointer-events: none;
  opacity: 0;
  transition: opacity var(--yd-motion-base) var(--yd-ease);
  background: radial-gradient(
    220px circle at var(--yd-sheen-x, 50%) var(--yd-sheen-y, 0%),
    color-mix(in srgb, var(--yd-accent) 26%, transparent),
    transparent 62%
  );
}

.yd-glass--interactive:hover .yd-sheen {
  opacity: 1;
}

@media (prefers-reduced-motion: reduce) {
  .yd-glass,
  .yd-sheen {
    transition: none;
  }
  .yd-glass--interactive:hover {
    transform: none;
  }
}
```

- [ ] **Step 4: Écrire `frontend/src/design/glass/GlassCard.tsx`**

```tsx
import { type ElementType, type HTMLAttributes, type MouseEvent, useCallback } from "react";

import "./GlassCard.css";

type Tone = "default" | "raised" | "solid";

interface GlassCardProps extends HTMLAttributes<HTMLElement> {
  as?: ElementType;
  tone?: Tone;
  interactive?: boolean;
}

const TONE_CLASS: Record<Tone, string> = {
  default: "",
  raised: "yd-glass--raised",
  solid: "yd-glass--solid",
};

export function GlassCard({
  as: Component = "div",
  tone = "default",
  interactive = false,
  className = "",
  children,
  ...rest
}: GlassCardProps) {
  const trackPointer = useCallback((event: MouseEvent<HTMLElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    event.currentTarget.style.setProperty(
      "--yd-sheen-x",
      `${((event.clientX - bounds.left) / bounds.width) * 100}%`,
    );
    event.currentTarget.style.setProperty(
      "--yd-sheen-y",
      `${((event.clientY - bounds.top) / bounds.height) * 100}%`,
    );
  }, []);

  const classes = [
    "yd-glass",
    TONE_CLASS[tone],
    interactive ? "yd-glass--interactive" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <Component
      className={classes}
      onMouseMove={interactive ? trackPointer : undefined}
      {...rest}
    >
      {interactive ? <span className="yd-sheen" aria-hidden="true" /> : null}
      {children}
    </Component>
  );
}
```

- [ ] **Step 5: Écrire `frontend/src/design/motion/useReducedMotion.ts` et `variants.ts`**

```ts
// useReducedMotion.ts
import { useEffect, useState } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia(QUERY).matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const media = window.matchMedia(QUERY);
    const update = (event: MediaQueryListEvent) => setReduced(event.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  return reduced;
}
```

```ts
// variants.ts
import type { Variants } from "motion/react";

export const fadeInUp: Variants = {
  hidden: { opacity: 0, y: 14 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.34, ease: [0.22, 1, 0.36, 1] } },
};

export const staggerChildren: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.05, delayChildren: 0.04 } },
};

export const slideOver: Variants = {
  hidden: { opacity: 0, x: 28 },
  visible: { opacity: 1, x: 0, transition: { duration: 0.28, ease: [0.22, 1, 0.36, 1] } },
  exit: { opacity: 0, x: 28, transition: { duration: 0.18 } },
};
```

- [ ] **Step 6: Écrire `frontend/src/design/CountUp.tsx`**

```tsx
import { animate } from "motion";
import { useEffect, useRef, useState } from "react";

import { useReducedMotion } from "./motion/useReducedMotion";

interface CountUpProps {
  value: number;
  format: (value: number) => string;
  duration?: number;
  className?: string;
}

export function CountUp({ value, format, duration = 0.9, className = "" }: CountUpProps) {
  const reducedMotion = useReducedMotion();
  const [displayed, setDisplayed] = useState(reducedMotion ? value : 0);
  const previous = useRef(reducedMotion ? value : 0);

  useEffect(() => {
    if (reducedMotion) {
      setDisplayed(value);
      previous.current = value;
      return;
    }
    const controls = animate(previous.current, value, {
      duration,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (latest) => setDisplayed(latest),
      onComplete: () => {
        previous.current = value;
      },
    });
    return () => controls.stop();
  }, [value, duration, reducedMotion]);

  // The animated digits are decorative noise for a screen reader; the label is the truth.
  return (
    <span role="status" aria-label={format(value)} className={`yd-num ${className}`}>
      <span aria-hidden="true">{format(displayed)}</span>
    </span>
  );
}
```

- [ ] **Step 7: Écrire `frontend/src/app/ThemeProvider.tsx` et `AppShell.tsx`**

```tsx
// ThemeProvider.tsx
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import {
  type ResolvedTheme, type ThemePreference, readStoredTheme, resolveTheme, storeTheme,
} from "../design/theme";

interface ThemeContextValue {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  setPreference: (next: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(readStoredTheme);
  const [prefersDark, setPrefersDark] = useState(
    () => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? true,
  );

  useEffect(() => {
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!media) return;
    const update = (event: MediaQueryListEvent) => setPrefersDark(event.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  const resolved = resolveTheme(preference, prefersDark);

  useEffect(() => {
    document.documentElement.dataset.theme = resolved;
  }, [resolved]);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    storeTheme(next);
  }, []);

  const value = useMemo(
    () => ({ preference, resolved, setPreference }),
    [preference, resolved, setPreference],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme doit être utilisé dans un ThemeProvider");
  return context;
}
```

`AppShell.tsx` rend une barre latérale avec les liens **Vue d'ensemble**, **Transactions**, **Catégories**, **Import**, **Réglages**, un en-tête portant le nom de l'utilisateur, un sélecteur de thème, et `<Outlet />` de React Router dans une zone `<main>`. Le lien actif porte `aria-current="page"`. Sur mobile, la barre latérale devient un tiroir animé avec `slideOver`.

Le tiroir est animé en JavaScript, donc la mise à zéro des durées CSS ne l'atteint pas : il doit consulter `useReducedMotion()` lui-même et sauter la transition. Il se ferme à la touche Échap comme au clic sur le voile, le voile utilise `--yd-scrim`, et le contenu masqué derrière lui reçoit `inert` pour ne pas rester accessible au clavier.

- [ ] **Step 8: Lancer les tests**

Run: `cd frontend && npm test`
Expected: 20 tests PASS

- [ ] **Step 9: Commit**

```bash
git add frontend/
git commit -m "feat(frontend): add glass primitives, motion variants, and app shell"
```

---

### Task 17: Client API typé, session, écrans de connexion

**Files:**
- Create: `frontend/src/lib/api.ts`
- Create: `frontend/src/lib/types.ts`
- Create: `frontend/src/features/auth/session.ts`
- Create: `frontend/src/features/auth/LoginPage.tsx`
- Create: `frontend/src/features/auth/RegisterPage.tsx`
- Create: `frontend/src/features/auth/RequireAuth.tsx`
- Create: `frontend/src/app/routes.tsx`
- Modify: `frontend/src/main.tsx`
- Create: `frontend/src/lib/api.test.ts`
- Create: `frontend/src/features/auth/LoginPage.test.tsx`

**Interfaces:**
- Consumes: routes backend de la tâche 5.
- Produces:
  - `api.get<T>(path, params?)`, `api.post<T>(body)`, `api.patch<T>`, `api.delete<T>`, `api.upload<T>(path, formData)`
  - `ApiError extends Error { status: number; detail: string }` — `detail` porte le message français du backend
  - `useSession()` (store Zustand) → `{ user, accessToken, isAuthenticated, login, register, logout, hydrate }`
  - `<RequireAuth>` — redirige vers `/connexion` si non authentifié
  - Rafraîchissement automatique : sur un 401, le client tente **une** fois `POST /api/auth/refresh` puis rejoue la requête ; un second échec déconnecte.

- [ ] **Step 1: Écrire les tests qui échouent**

Créer `frontend/src/lib/api.test.ts` :

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, api, setAccessToken } from "./api";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  setAccessToken(null);
});

afterEach(() => vi.unstubAllGlobals());

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("api client", () => {
  it("sends the bearer token when one is set", async () => {
    setAccessToken("token-123");
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
    await api.get("/health");
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toBe("Bearer token-123");
  });

  it("serializes query parameters and drops empty ones", async () => {
    fetchMock.mockResolvedValue(jsonResponse([]));
    await api.get("/transactions", { search: "netflix", category_id: undefined, limit: 50 });
    expect(fetchMock.mock.calls[0][0]).toBe("/api/transactions?search=netflix&limit=50");
  });

  it("raises ApiError carrying the French detail from the backend", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ detail: "Compte introuvable" }, 404));
    await expect(api.get("/accounts/9")).rejects.toMatchObject({
      status: 404,
      detail: "Compte introuvable",
    });
  });

  it("falls back to a generic French message when the body has no detail", async () => {
    fetchMock.mockResolvedValue(new Response("boom", { status: 500 }));
    await expect(api.get("/x")).rejects.toBeInstanceOf(ApiError);
    await expect(api.get("/x")).rejects.toMatchObject({
      detail: "Une erreur inattendue est survenue.",
    });
  });

  it("retries once through refresh after a 401, then replays the request", async () => {
    setAccessToken("stale");
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ detail: "Authentification requise" }, 401))
      .mockResolvedValueOnce(jsonResponse({ access_token: "fresh", user: { id: 1 } }))
      .mockResolvedValueOnce(jsonResponse({ total: 0, items: [] }));

    const result = await api.get<{ total: number }>("/transactions");

    expect(result.total).toBe(0);
    expect(fetchMock.mock.calls[1][0]).toBe("/api/auth/refresh");
    expect(fetchMock.mock.calls[2][1].headers.Authorization).toBe("Bearer fresh");
  });

  it("does not loop when the refresh itself fails", async () => {
    setAccessToken("stale");
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ detail: "Authentification requise" }, 401))
      .mockResolvedValueOnce(jsonResponse({ detail: "Identifiants invalides" }, 401));

    await expect(api.get("/transactions")).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns undefined for a 204 rather than choking on an empty body", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(api.delete("/transactions/1")).resolves.toBeUndefined();
  });
});
```

Créer `frontend/src/features/auth/LoginPage.test.tsx` :

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LoginPage } from "./LoginPage";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

function renderPage() {
  return render(
    <MemoryRouter>
      <LoginPage />
    </MemoryRouter>,
  );
}

describe("LoginPage", () => {
  it("labels both fields in French", () => {
    renderPage();
    expect(screen.getByLabelText("Adresse email")).toBeInTheDocument();
    expect(screen.getByLabelText("Mot de passe")).toBeInTheDocument();
  });

  it("shows the backend error message on invalid credentials", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ detail: "Identifiants invalides" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
    );
    renderPage();
    await userEvent.type(screen.getByLabelText("Adresse email"), "max@example.com");
    await userEvent.type(screen.getByLabelText("Mot de passe"), "mauvais");
    await userEvent.click(screen.getByRole("button", { name: "Se connecter" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Identifiants invalides");
  });

  it("disables the button while the request is in flight", async () => {
    let release: (value: Response) => void = () => {};
    fetchMock.mockReturnValue(new Promise<Response>((resolve) => (release = resolve)));
    renderPage();
    await userEvent.type(screen.getByLabelText("Adresse email"), "max@example.com");
    await userEvent.type(screen.getByLabelText("Mot de passe"), "motdepasse123");
    await userEvent.click(screen.getByRole("button", { name: "Se connecter" }));

    expect(screen.getByRole("button", { name: /connexion/i })).toBeDisabled();
    release(
      new Response(JSON.stringify({ access_token: "t", user: { id: 1, name: "Max" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  });
});
```

- [ ] **Step 2: Lancer les tests pour vérifier qu'ils échouent**

Run: `cd frontend && npm test`
Expected: FAIL — modules introuvables

- [ ] **Step 3: Écrire `frontend/src/lib/api.ts`**

```ts
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
  ) {
    super(detail);
    this.name = "ApiError";
  }
}

type QueryValue = string | number | boolean | undefined | null;

let accessToken: string | null = null;
let onSessionLost: (() => void) | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function onUnauthorized(handler: () => void): void {
  onSessionLost = handler;
}

function buildUrl(path: string, params?: Record<string, QueryValue>): string {
  const url = `/api${path}`;
  if (!params) return url;
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `${url}?${query}` : url;
}

async function readError(response: Response): Promise<string> {
  try {
    const body = await response.clone().json();
    if (typeof body?.detail === "string") return body.detail;
    if (Array.isArray(body?.detail) && body.detail[0]?.msg) return body.detail[0].msg;
  } catch {
    // Not JSON — fall through to the generic message below.
  }
  return "Une erreur inattendue est survenue.";
}

async function parse<T>(response: Response): Promise<T> {
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

async function refreshSession(): Promise<boolean> {
  const response = await fetch("/api/auth/refresh", {
    method: "POST",
    credentials: "include",
  });
  if (!response.ok) return false;
  const body = (await response.json()) as { access_token: string };
  accessToken = body.access_token;
  return true;
}

async function request<T>(
  method: string,
  path: string,
  options: { params?: Record<string, QueryValue>; body?: unknown; form?: FormData } = {},
  isRetry = false,
): Promise<T> {
  const headers: Record<string, string> = {};
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  if (options.body !== undefined) headers["Content-Type"] = "application/json";

  const response = await fetch(buildUrl(path, options.params), {
    method,
    headers,
    credentials: "include",
    body: options.form ?? (options.body !== undefined ? JSON.stringify(options.body) : undefined),
  });

  if (response.status === 401 && !isRetry && !path.startsWith("/auth/")) {
    // One refresh attempt, then give up: retrying a failed refresh would loop.
    if (await refreshSession()) return request<T>(method, path, options, true);
    onSessionLost?.();
  }

  if (!response.ok) throw new ApiError(response.status, await readError(response));
  return parse<T>(response);
}

export const api = {
  get: <T>(path: string, params?: Record<string, QueryValue>) =>
    request<T>("GET", path, { params }),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, { body }),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, { body }),
  delete: <T>(path: string) => request<T>("DELETE", path),
  upload: <T>(path: string, form: FormData) => request<T>("POST", path, { form }),
};
```

- [ ] **Step 4: Écrire `frontend/src/lib/types.ts`**

Déclarer les types miroirs des schémas backend : `User`, `Account`, `Category`, `Transaction`, `TransactionPage`, `ImportPreview`, `PreviewRow`, `CsvDialect`, `ColumnRole`, `ImportBatch`, `ColumnProfile`, `SeriesBucket`, `CategoryBreakdown`, `Summary`, `CalendarPoint`. Les noms de champs reproduisent exactement le JSON du backend, `amount_cents` compris — aucune conversion implicite en cours de route.

```ts
export const COLUMN_ROLES = [
  "date", "value_date", "amount", "debit", "credit", "label", "category",
  "account", "currency", "balance", "notes", "reference", "ignore",
] as const;

export type ColumnRole = (typeof COLUMN_ROLES)[number];

export const ROLE_LABELS: Record<ColumnRole, string> = {
  date: "Date",
  value_date: "Date de valeur",
  amount: "Montant",
  debit: "Débit",
  credit: "Crédit",
  label: "Libellé",
  category: "Catégorie",
  account: "Compte",
  currency: "Devise",
  balance: "Solde",
  notes: "Notes",
  reference: "Référence",
  ignore: "Ignorer",
};
```

- [ ] **Step 5: Écrire `frontend/src/features/auth/session.ts`**

Store Zustand exposant `user`, `accessToken`, `status` (`"idle" | "loading" | "authenticated" | "anonymous"`), et les actions `login`, `register`, `logout`, `hydrate`. `hydrate` appelle `POST /api/auth/refresh` au démarrage : le cookie de rafraîchissement survit au rechargement de page alors que le jeton d'accès, gardé en mémoire seule, non. Chaque action appelle `setAccessToken` pour tenir le client à jour, et `onUnauthorized` réinitialise le store.

- [ ] **Step 6: Écrire `LoginPage.tsx`, `RegisterPage.tsx`, `RequireAuth.tsx`**

`LoginPage` : `<GlassCard tone="raised">` centrée, champs `Adresse email` et `Mot de passe` correctement associés par `htmlFor`/`id`, bouton `Se connecter` qui passe à `Connexion…` et se désactive pendant la requête, erreur rendue dans un `role="alert"`, lien vers l'inscription. Animation d'entrée `fadeInUp`.

`RegisterPage` : idem plus `Nom` et confirmation du mot de passe, avec un indicateur de robustesse. Le premier compte créé affiche un bandeau expliquant qu'il devient administrateur.

`RequireAuth` : affiche un squelette tant que `status === "loading"`, redirige vers `/connexion` quand `anonymous`, rend `<Outlet />` sinon.

- [ ] **Step 7: Écrire `frontend/src/app/routes.tsx` et brancher `main.tsx`**

Routes : `/connexion`, `/inscription` publiques ; sous `RequireAuth` et `AppShell` : `/` (vue d'ensemble), `/transactions`, `/categories`, `/import`, `/reglages`. `main.tsx` monte `QueryClientProvider`, `ThemeProvider`, `RouterProvider`, et appelle `hydrate()` au démarrage.

- [ ] **Step 8: Lancer les tests**

Run: `cd frontend && npm test`
Expected: 30 tests PASS

- [ ] **Step 9: Commit**

```bash
git add frontend/
git commit -m "feat(frontend): add typed API client, session store, and auth screens"
```

---

### Task 18: Assistant d'import en quatre étapes avec taggage des colonnes

**Files:**
- Create: `frontend/src/features/import/ImportPage.tsx`
- Create: `frontend/src/features/import/DropZone.tsx`
- Create: `frontend/src/features/import/DialectPanel.tsx`
- Create: `frontend/src/features/import/ColumnTagger.tsx`
- Create: `frontend/src/features/import/PreviewTable.tsx`
- Create: `frontend/src/features/import/ImportSummary.tsx`
- Create: `frontend/src/features/import/useImportWizard.ts`
- Create: `frontend/src/features/import/ColumnTagger.test.tsx`
- Create: `frontend/src/features/import/useImportWizard.test.ts`

**Interfaces:**
- Consumes: `POST /api/imports/analyze`, `POST /api/imports/commit`, `GET/POST /api/imports/profiles`, `GET /api/accounts`, `GET /api/categories`.
- Produces:
  - `useImportWizard()` → `{ step, file, accountId, dialect, mapping, preview, overrides, keepDuplicates, errors, isBusy, actions: { selectFile, selectAccount, setRole, setDialectField, applyProfile, saveProfile, reanalyze, overrideCategory, toggleKeepDuplicate, commit, reset } }`
  - `<ColumnTagger headers, sampleRows, mapping, onRoleChange, errors>` — un `<select>` par colonne, au-dessus de l'aperçu
- **Ce que la tâche 18 garantit, et qui est le point explicitement demandé :** l'utilisateur voit toujours ses colonnes et choisit lui-même leur rôle. L'auto-détection ne fait que présélectionner. Aucun import n'est possible tant que `validate_mapping` renvoie des erreurs, et ces erreurs sont affichées en français sous le tagger.

- [ ] **Step 1: Écrire les tests qui échouent**

Créer `frontend/src/features/import/ColumnTagger.test.tsx` :

```tsx
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ColumnTagger } from "./ColumnTagger";

const headers = ["dateOp", "label", "amount"];
const sampleRows = [
  ["01/03/2025", "CARREFOUR MARKET", "-47,32"],
  ["03/03/2025", "VIR SALAIRE", "2450,00"],
];

function renderTagger(overrides = {}) {
  const onRoleChange = vi.fn();
  render(
    <ColumnTagger
      headers={headers}
      sampleRows={sampleRows}
      mapping={{ 0: "date", 1: "label", 2: "amount" }}
      onRoleChange={onRoleChange}
      errors={[]}
      {...overrides}
    />,
  );
  return { onRoleChange };
}

describe("ColumnTagger", () => {
  it("renders one role selector per column, labelled by the header", () => {
    renderTagger();
    expect(screen.getByLabelText('Rôle de la colonne "dateOp"')).toBeInTheDocument();
    expect(screen.getByLabelText('Rôle de la colonne "label"')).toBeInTheDocument();
    expect(screen.getByLabelText('Rôle de la colonne "amount"')).toBeInTheDocument();
  });

  it("preselects the suggested role without locking it", () => {
    renderTagger();
    const select = screen.getByLabelText('Rôle de la colonne "dateOp"') as HTMLSelectElement;
    expect(select.value).toBe("date");
    expect(select).toBeEnabled();
  });

  it("offers every role in French", () => {
    renderTagger();
    const select = screen.getByLabelText('Rôle de la colonne "amount"');
    expect(within(select).getByRole("option", { name: "Débit" })).toBeInTheDocument();
    expect(within(select).getByRole("option", { name: "Ignorer" })).toBeInTheDocument();
  });

  it("reports the column index and the new role when the user retags", async () => {
    const { onRoleChange } = renderTagger();
    await userEvent.selectOptions(
      screen.getByLabelText('Rôle de la colonne "amount"'),
      "debit",
    );
    expect(onRoleChange).toHaveBeenCalledWith(2, "debit");
  });

  it("shows sample values under each column so the user can check the tagging", () => {
    renderTagger();
    expect(screen.getByText("CARREFOUR MARKET")).toBeInTheDocument();
    expect(screen.getByText("-47,32")).toBeInTheDocument();
  });

  it("surfaces mapping errors in an alert", () => {
    renderTagger({ errors: ["Aucune colonne n'est taggée comme Date."] });
    expect(screen.getByRole("alert")).toHaveTextContent("Aucune colonne n'est taggée comme Date.");
  });

  it("handles a file whose header row is empty by numbering the columns", () => {
    render(
      <ColumnTagger
        headers={["", ""]}
        sampleRows={[["a", "b"]]}
        mapping={{ 0: "ignore", 1: "ignore" }}
        onRoleChange={vi.fn()}
        errors={[]}
      />,
    );
    expect(screen.getByLabelText("Rôle de la colonne 1")).toBeInTheDocument();
  });
});
```

Créer `frontend/src/features/import/useImportWizard.test.ts` :

```ts
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useImportWizard } from "./useImportWizard";

const fetchMock = vi.fn();

const previewBody = {
  upload_token: "tok.csv",
  dialect: {
    encoding: "utf-8", delimiter: ";", decimal_separator: ",", date_format: "%d/%m/%Y",
    header_row: 3, preamble_rows: 3, quotechar: '"',
    sample_headers: ["dateOp", "label", "amount"],
  },
  headers: ["dateOp", "label", "amount"],
  sample_rows: [["01/03/2025", "CARREFOUR", "-47,32"]],
  suggested_mapping: { "0": "date", "1": "label", "2": "amount" },
  rows: [
    {
      row_number: 1, date: "2025-03-01", amount_cents: -4732, label_raw: "CARREFOUR",
      category_id: 3, category_name: "Courses", category_source: "builtin",
      is_duplicate: false, error: null,
    },
  ],
  summary: {
    total: 1, importable: 1, duplicates: 0, failed: 0,
    date_from: "2025-03-01", date_to: "2025-03-01",
    inflow_cents: 0, outflow_cents: -4732, mapping_errors: [],
  },
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

describe("useImportWizard", () => {
  it("starts on the file step", () => {
    const { result } = renderHook(() => useImportWizard());
    expect(result.current.step).toBe("file");
  });

  it("moves to the mapping step once the file is analyzed", async () => {
    fetchMock.mockResolvedValue(jsonResponse(previewBody));
    const { result } = renderHook(() => useImportWizard());

    act(() => result.current.actions.selectAccount(1));
    await act(async () => {
      await result.current.actions.selectFile(new File(["x"], "b.csv", { type: "text/csv" }));
    });

    await waitFor(() => expect(result.current.step).toBe("mapping"));
    expect(result.current.mapping).toEqual({ 0: "date", 1: "label", 2: "amount" });
    expect(result.current.preview?.summary.importable).toBe(1);
  });

  it("retagging a column marks the preview stale until re-analysis", async () => {
    fetchMock.mockResolvedValue(jsonResponse(previewBody));
    const { result } = renderHook(() => useImportWizard());
    act(() => result.current.actions.selectAccount(1));
    await act(async () => {
      await result.current.actions.selectFile(new File(["x"], "b.csv", { type: "text/csv" }));
    });

    act(() => result.current.actions.setRole(2, "debit"));
    expect(result.current.mapping[2]).toBe("debit");
    expect(result.current.isPreviewStale).toBe(true);
  });

  it("blocks the commit while the mapping is invalid", async () => {
    fetchMock.mockResolvedValue(jsonResponse(previewBody));
    const { result } = renderHook(() => useImportWizard());
    act(() => result.current.actions.selectAccount(1));
    await act(async () => {
      await result.current.actions.selectFile(new File(["x"], "b.csv", { type: "text/csv" }));
    });

    act(() => result.current.actions.setRole(0, "ignore"));
    expect(result.current.canCommit).toBe(false);
    expect(result.current.errors.some((e) => e.includes("Date"))).toBe(true);
  });

  it("surfaces a rejected file without leaving the file step", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ detail: "Format non pris en charge : déposez un fichier CSV." }, 400),
    );
    const { result } = renderHook(() => useImportWizard());
    act(() => result.current.actions.selectAccount(1));
    await act(async () => {
      await result.current.actions.selectFile(new File(["x"], "photo.png"));
    });

    await waitFor(() => expect(result.current.errors[0]).toContain("Format non pris en charge"));
    expect(result.current.step).toBe("file");
  });

  it("sends overrides and forced duplicates on commit", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(previewBody))
      .mockResolvedValueOnce(jsonResponse({ id: 1, rows_imported: 1 }, 201));
    const { result } = renderHook(() => useImportWizard());
    act(() => result.current.actions.selectAccount(1));
    await act(async () => {
      await result.current.actions.selectFile(new File(["x"], "b.csv", { type: "text/csv" }));
    });

    act(() => {
      result.current.actions.overrideCategory(1, 42);
      result.current.actions.toggleKeepDuplicate(1);
    });
    await act(async () => {
      await result.current.actions.commit();
    });

    const body = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(body.overrides).toEqual({ "1": 42 });
    expect(body.keep_duplicates).toEqual([1]);
    expect(result.current.step).toBe("done");
  });
});
```

- [ ] **Step 2: Lancer les tests pour vérifier qu'ils échouent**

Run: `cd frontend && npm test`
Expected: FAIL — modules introuvables

- [ ] **Step 3: Écrire `frontend/src/features/import/ColumnTagger.tsx`**

```tsx
import { COLUMN_ROLES, ROLE_LABELS, type ColumnRole } from "../../lib/types";
import { GlassCard } from "../../design/glass/GlassCard";

interface ColumnTaggerProps {
  headers: string[];
  sampleRows: string[][];
  mapping: Record<number, ColumnRole>;
  onRoleChange: (columnIndex: number, role: ColumnRole) => void;
  errors: string[];
}

export function ColumnTagger({
  headers, sampleRows, mapping, onRoleChange, errors,
}: ColumnTaggerProps) {
  return (
    <GlassCard tone="solid" className="p-4">
      <h2 className="text-lg font-semibold">Taggez vos colonnes</h2>
      <p className="mt-1 text-sm" style={{ color: "var(--yd-text-muted)" }}>
        Yieldo a proposé un rôle pour chaque colonne. Corrigez-les si besoin&nbsp;: rien
        ne sera importé avant votre validation.
      </p>

      {errors.length > 0 && (
        <div role="alert" className="mt-3 rounded-lg p-3 text-sm"
             style={{ background: "color-mix(in srgb, var(--yd-negative) 14%, transparent)",
                      border: "1px solid var(--yd-negative)" }}>
          <ul className="list-disc pl-5">
            {errors.map((error) => <li key={error}>{error}</li>)}
          </ul>
        </div>
      )}

      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              {headers.map((header, index) => {
                const displayName = header.trim() || `colonne ${index + 1}`;
                const inputId = `column-role-${index}`;
                return (
                  <th key={index} className="min-w-40 p-2 text-left align-top">
                    <label htmlFor={inputId} className="block text-xs font-medium"
                           style={{ color: "var(--yd-text-muted)" }}>
                      {header.trim() || `Colonne ${index + 1}`}
                    </label>
                    <select
                      id={inputId}
                      aria-label={
                        header.trim()
                          ? `Rôle de la colonne "${header.trim()}"`
                          : `Rôle de la colonne ${index + 1}`
                      }
                      value={mapping[index] ?? "ignore"}
                      onChange={(event) =>
                        onRoleChange(index, event.target.value as ColumnRole)}
                      className="mt-1 w-full rounded-md px-2 py-1.5"
                      style={{ background: "var(--yd-surface-raised)",
                               border: "1px solid var(--yd-border)",
                               color: "var(--yd-text)" }}
                    >
                      {COLUMN_ROLES.map((role) => (
                        <option key={role} value={role}>{ROLE_LABELS[role]}</option>
                      ))}
                    </select>
                    <span className="sr-only">Aperçu de {displayName}</span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sampleRows.slice(0, 5).map((row, rowIndex) => (
              <tr key={rowIndex} style={{ borderTop: "1px solid var(--yd-border)" }}>
                {headers.map((_, columnIndex) => (
                  <td key={columnIndex} className="yd-num p-2"
                      style={{ color: mapping[columnIndex] === "ignore"
                        ? "var(--yd-text-muted)" : "var(--yd-text)" }}>
                    {row[columnIndex] ?? ""}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </GlassCard>
  );
}
```

- [ ] **Step 4: Écrire `frontend/src/features/import/useImportWizard.ts`**

Le hook tient l'état `step` (`"file" | "mapping" | "preview" | "done"`), garde le fichier et le `upload_token`, et applique ces règles :

```ts
// Mirror of backend validate_mapping so the user is told immediately, without a round trip.
export function validateMapping(mapping: Record<number, ColumnRole>): string[] {
  const roles = Object.values(mapping);
  const errors: string[] = [];
  const counted = new Map<string, number>();
  for (const role of roles) {
    if (role === "ignore") continue;
    counted.set(role, (counted.get(role) ?? 0) + 1);
  }
  for (const [role, count] of counted) {
    if (count > 1) errors.push(`Le rôle « ${ROLE_LABELS[role as ColumnRole]} » est attribué plusieurs fois.`);
  }
  if (!roles.includes("date")) errors.push("Aucune colonne n'est taggée comme Date.");
  if (!roles.includes("label")) errors.push("Aucune colonne n'est taggée comme Libellé.");
  if (!roles.includes("amount") && !roles.includes("debit") && !roles.includes("credit")) {
    errors.push("Aucune colonne de Montant, ni de couple Débit / Crédit, n'est taggée.");
  }
  return errors;
}
```

- `selectFile` téléverse vers `/imports/analyze` avec `account_id`, stocke l'aperçu, passe à `mapping`. Une erreur laisse `step` à `"file"` et remplit `errors`.
- `setRole` met à jour `mapping`, recalcule `errors` via `validateMapping`, et pose `isPreviewStale = true`.
- `reanalyze` renvoie le fichier avec le mapping courant et rafraîchit l'aperçu (`isPreviewStale = false`).
- `canCommit` vaut `errors.length === 0 && preview !== null && summary.importable + keepDuplicates.length > 0`.
- `commit` envoie `upload_token`, `dialect`, `mapping` (clés en chaînes), `overrides`, `keep_duplicates`, puis passe à `"done"`.

- [ ] **Step 5: Écrire les composants d'écran restants**

`DropZone` : zone de dépôt avec état de survol animé, ouverture du sélecteur au clic et à la touche Entrée, `aria-label="Déposez votre fichier CSV"`, refus visible d'une extension non gérée.

`DialectPanel` : affiche encodage, séparateur, décimale, format de date, lignes de préambule détectés, chacun modifiable ; toute modification déclenche `reanalyze`. Un bouton **Enregistrer ce profil** ouvre un champ de nom et appelle `POST /imports/profiles` ; une liste déroulante permet de rappeler un profil.

`PreviewTable` : lignes catégorisées avec la pastille de couleur de la catégorie et une puce indiquant l'origine (`règle`, `apprise`, `CSV`, `manuelle`) ; doublons grisés avec une case **Importer quand même** ; lignes en erreur en rouge avec leur numéro et le motif ; sélecteur de catégorie par ligne alimentant `overrides`.

`ImportSummary` : bandeau récapitulatif — période couverte, entrées, sorties, lignes importables, doublons, échecs — puis, après validation, le compte-rendu et un bouton **Annuler cet import**.

`ImportPage` : assemble les quatre étapes avec un fil d'Ariane animé et des transitions `fadeInUp` entre étapes.

- [ ] **Step 6: Lancer les tests**

Run: `cd frontend && npm test`
Expected: 43 tests PASS

- [ ] **Step 7: Commit**

```bash
git add frontend/
git commit -m "feat(import): add four-step wizard with explicit user-driven column tagging"
```

---

### Task 19: Vue transactions — filtres temporels, recherche, recatégorisation

**Files:**
- Create: `frontend/src/features/transactions/TransactionsPage.tsx`
- Create: `frontend/src/features/transactions/TransactionRow.tsx`
- Create: `frontend/src/features/transactions/FilterBar.tsx`
- Create: `frontend/src/features/transactions/CategoryPicker.tsx`
- Create: `frontend/src/features/transactions/usePeriod.ts`
- Create: `frontend/src/features/transactions/usePeriod.test.ts`
- Create: `frontend/src/features/transactions/TransactionRow.test.tsx`

**Interfaces:**
- Consumes: `GET /api/transactions`, `PATCH /api/transactions/{id}`, `GET /api/categories`, `GET /api/accounts`.
- Produces:
  - `usePeriod()` → `{ preset, from, to, setPreset, setRange }` avec les presets `"month" | "quarter" | "year" | "ytd" | "all" | "custom"`, synchronisés dans l'URL (`?du=2025-01-01&au=2025-12-31`) pour que la vue soit partageable et survive au rechargement
  - `periodBounds(preset, today) -> { from: string; to: string }`
  - `<CategoryPicker value, onChange, categories>` — liste groupée par catégorie parente, recherche au clavier
  - `<TransactionRow transaction, categories, onRecategorize>`
- Après une recatégorisation, si le backend renvoie `backfilled > 0`, un bandeau annonce : « Règle apprise — N autres transactions similaires ont été reclassées », avec un bouton **Annuler**.

- [ ] **Step 1: Écrire les tests qui échouent**

Créer `frontend/src/features/transactions/usePeriod.test.ts` :

```ts
import { describe, expect, it } from "vitest";

import { periodBounds } from "./usePeriod";

const today = new Date("2026-08-09T12:00:00Z");

describe("periodBounds", () => {
  it("bounds the current month", () => {
    expect(periodBounds("month", today)).toEqual({ from: "2026-08-01", to: "2026-08-31" });
  });

  it("bounds the current quarter", () => {
    expect(periodBounds("quarter", today)).toEqual({ from: "2026-07-01", to: "2026-09-30" });
  });

  it("bounds the current year", () => {
    expect(periodBounds("year", today)).toEqual({ from: "2026-01-01", to: "2026-12-31" });
  });

  it("bounds year to date", () => {
    expect(periodBounds("ytd", today)).toEqual({ from: "2026-01-01", to: "2026-08-09" });
  });

  it("returns an open range for all time", () => {
    expect(periodBounds("all", today)).toEqual({ from: "", to: "" });
  });

  it("handles a leap-year February", () => {
    expect(periodBounds("month", new Date("2028-02-15T00:00:00Z")))
      .toEqual({ from: "2028-02-01", to: "2028-02-29" });
  });

  it("handles December without rolling the year", () => {
    expect(periodBounds("month", new Date("2026-12-20T00:00:00Z")))
      .toEqual({ from: "2026-12-01", to: "2026-12-31" });
  });
});
```

Créer `frontend/src/features/transactions/TransactionRow.test.tsx` :

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { TransactionRow } from "./TransactionRow";

const categories = [
  { id: 1, parent_id: null, name: "Alimentation", slug: "alimentation",
    kind: "expense", color: "#4fd6a8", icon: "cart", monthly_budget_cents: null },
  { id: 2, parent_id: 1, name: "Courses", slug: "alimentation-courses",
    kind: "expense", color: "#4fd6a8", icon: "cart", monthly_budget_cents: null },
];

const transaction = {
  id: 10, account_id: 1, date: "2025-03-01", value_date: null, amount_cents: -4732,
  label_raw: "CARREFOUR MARKET CB 01/03", label_clean: "carrefour market",
  category_id: 2, category_source: "builtin", is_transfer: false,
  is_recurring: false, notes: null, tags: [],
};

describe("TransactionRow", () => {
  it("shows a debit in French formatting", () => {
    render(<TransactionRow transaction={transaction} categories={categories}
                           onRecategorize={vi.fn()} />);
    expect(screen.getByText("−47,32 €")).toBeInTheDocument();
  });

  it("shows the raw label so the user recognizes the line on their statement", () => {
    render(<TransactionRow transaction={transaction} categories={categories}
                           onRecategorize={vi.fn()} />);
    expect(screen.getByText("CARREFOUR MARKET CB 01/03")).toBeInTheDocument();
  });

  it("marks where the category came from", () => {
    render(<TransactionRow transaction={transaction} categories={categories}
                           onRecategorize={vi.fn()} />);
    expect(screen.getByTitle("Catégorie déduite d'une règle intégrée")).toBeInTheDocument();
  });

  it("labels an uncategorized transaction explicitly", () => {
    render(<TransactionRow
      transaction={{ ...transaction, category_id: null, category_source: "uncategorized" }}
      categories={categories} onRecategorize={vi.fn()} />);
    expect(screen.getByText("Non catégorisé")).toBeInTheDocument();
  });

  it("reports the chosen category when the user recategorizes", async () => {
    const onRecategorize = vi.fn();
    render(<TransactionRow transaction={transaction} categories={categories}
                           onRecategorize={onRecategorize} />);
    await userEvent.selectOptions(screen.getByLabelText("Catégorie"), "1");
    expect(onRecategorize).toHaveBeenCalledWith(10, 1);
  });

  it("renders a credit with the positive tone", () => {
    render(<TransactionRow transaction={{ ...transaction, amount_cents: 245000 }}
                           categories={categories} onRecategorize={vi.fn()} />);
    expect(screen.getByText("2 450,00 €")).toHaveClass("yd-amount--positive");
  });
});
```

- [ ] **Step 2: Lancer les tests pour vérifier qu'ils échouent**

Run: `cd frontend && npm test`
Expected: FAIL — modules introuvables

- [ ] **Step 3: Écrire `frontend/src/features/transactions/usePeriod.ts`**

```ts
import { useSearchParams } from "react-router";

export type PeriodPreset = "month" | "quarter" | "year" | "ytd" | "all" | "custom";

const iso = (date: Date): string => date.toISOString().slice(0, 10);

function endOfMonth(year: number, monthIndex: number): Date {
  // Day 0 of the next month is the last day of this one — handles leap years for free.
  return new Date(Date.UTC(year, monthIndex + 1, 0));
}

export function periodBounds(preset: PeriodPreset, today: Date): { from: string; to: string } {
  const year = today.getUTCFullYear();
  const month = today.getUTCMonth();

  switch (preset) {
    case "month":
      return { from: iso(new Date(Date.UTC(year, month, 1))), to: iso(endOfMonth(year, month)) };
    case "quarter": {
      const firstMonth = Math.floor(month / 3) * 3;
      return {
        from: iso(new Date(Date.UTC(year, firstMonth, 1))),
        to: iso(endOfMonth(year, firstMonth + 2)),
      };
    }
    case "year":
      return { from: iso(new Date(Date.UTC(year, 0, 1))), to: iso(endOfMonth(year, 11)) };
    case "ytd":
      return { from: iso(new Date(Date.UTC(year, 0, 1))), to: iso(today) };
    case "all":
    case "custom":
      return { from: "", to: "" };
  }
}

export function usePeriod() {
  const [params, setParams] = useSearchParams();
  const preset = (params.get("periode") as PeriodPreset) ?? "year";
  const bounds = preset === "custom"
    ? { from: params.get("du") ?? "", to: params.get("au") ?? "" }
    : periodBounds(preset, new Date());

  const setPreset = (next: PeriodPreset) => {
    const nextBounds = periodBounds(next, new Date());
    setParams({ periode: next, du: nextBounds.from, au: nextBounds.to });
  };

  const setRange = (from: string, to: string) =>
    setParams({ periode: "custom", du: from, au: to });

  return { preset, from: bounds.from, to: bounds.to, setPreset, setRange };
}
```

- [ ] **Step 4: Écrire `TransactionRow.tsx`**

```tsx
import { formatCents } from "../../design/theme";
import type { Category, Transaction } from "../../lib/types";

const SOURCE_HINTS: Record<string, string> = {
  builtin: "Catégorie déduite d'une règle intégrée",
  rule: "Catégorie déduite d'une règle intégrée",
  learned: "Catégorie déduite d'une règle apprise de vos corrections",
  manual: "Catégorie choisie par vous",
  csv: "Catégorie fournie par le fichier importé",
  uncategorized: "Aucune catégorie",
};

const SOURCE_BADGES: Record<string, string> = {
  builtin: "règle", rule: "règle", learned: "apprise",
  manual: "manuelle", csv: "CSV", uncategorized: "—",
};

interface TransactionRowProps {
  transaction: Transaction;
  categories: Category[];
  onRecategorize: (transactionId: number, categoryId: number) => void;
}

export function TransactionRow({
  transaction, categories, onRecategorize,
}: TransactionRowProps) {
  const category = categories.find((c) => c.id === transaction.category_id);
  const isCredit = transaction.amount_cents > 0;
  const parents = categories.filter((c) => c.parent_id === null);

  return (
    <tr style={{ borderTop: "1px solid var(--yd-border)" }}>
      <td className="yd-num p-2 whitespace-nowrap">
        {new Date(transaction.date).toLocaleDateString("fr-FR")}
      </td>
      <td className="p-2">
        <span>{transaction.label_raw}</span>
      </td>
      <td className="p-2">
        <label className="sr-only" htmlFor={`category-${transaction.id}`}>Catégorie</label>
        <div className="flex items-center gap-2">
          <span aria-hidden="true" className="inline-block size-2.5 rounded-full"
                style={{ background: category?.color ?? "var(--yd-text-muted)" }} />
          <select
            id={`category-${transaction.id}`}
            aria-label="Catégorie"
            value={transaction.category_id ?? ""}
            onChange={(event) => onRecategorize(transaction.id, Number(event.target.value))}
            className="rounded-md px-2 py-1"
            style={{ background: "var(--yd-surface-raised)",
                     border: "1px solid var(--yd-border)", color: "var(--yd-text)" }}
          >
            <option value="">Non catégorisé</option>
            {parents.map((parent) => (
              <optgroup key={parent.id} label={parent.name}>
                <option value={parent.id}>{parent.name}</option>
                {categories
                  .filter((child) => child.parent_id === parent.id)
                  .map((child) => (
                    <option key={child.id} value={child.id}>{child.name}</option>
                  ))}
              </optgroup>
            ))}
          </select>
          <span className="rounded px-1.5 py-0.5 text-[11px]"
                title={SOURCE_HINTS[transaction.category_source]}
                style={{ background: "var(--yd-surface-raised)",
                         color: "var(--yd-text-muted)" }}>
            {SOURCE_BADGES[transaction.category_source]}
          </span>
        </div>
      </td>
      <td className="p-2 text-right">
        <span
          className={`yd-num ${isCredit ? "yd-amount--positive" : "yd-amount--negative"}`}
          style={{ color: isCredit ? "var(--yd-positive)" : "var(--yd-text)" }}
        >
          {formatCents(transaction.amount_cents)}
        </span>
      </td>
    </tr>
  );
}
```

- [ ] **Step 5: Écrire `FilterBar.tsx`, `CategoryPicker.tsx`, `TransactionsPage.tsx`**

`FilterBar` : boutons de préréglage de période (Mois, Trimestre, Année, Depuis janvier, Tout, Personnalisé) avec un indicateur animé glissant sous l'onglet actif ; champ de recherche debouncé à 250 ms ; filtres compte, catégorie, et bascule **Non catégorisées uniquement** avec le compte affiché.

`TransactionsPage` : `<GlassCard tone="solid">` contenant le tableau, en-têtes collants, pagination par 50 avec chargement à la demande, entrée décalée des lignes via `staggerChildren`, état vide invitant à l'import, bandeau de règle apprise avec **Annuler**.

- [ ] **Step 6: Lancer les tests**

Run: `cd frontend && npm test`
Expected: 56 tests PASS

- [ ] **Step 7: Commit**

```bash
git add frontend/
git commit -m "feat(transactions): add filterable transaction table with inline recategorization"
```

---

### Task 20: Graphiques ECharts et tableau de bord

**Files:**
- Create: `frontend/src/charts/theme.ts`
- Create: `frontend/src/charts/Chart.tsx`
- Create: `frontend/src/charts/CashflowChart.tsx`
- Create: `frontend/src/charts/CategoryTreemap.tsx`
- Create: `frontend/src/charts/SpendingCalendar.tsx`
- Create: `frontend/src/charts/WaterfallChart.tsx`
- Create: `frontend/src/features/overview/OverviewPage.tsx`
- Create: `frontend/src/features/overview/StatTile.tsx`
- Create: `frontend/src/charts/theme.test.ts`
- Create: `frontend/src/features/overview/StatTile.test.tsx`

**Interfaces:**
- Consumes: `GET /api/analytics/series`, `/categories`, `/summary`, `/calendar`.
- Produces:
  - `buildEchartsTheme(resolved: "light" | "dark") -> EChartsTheme` — couleurs Abysse, grille discrète, police monospace tabulaire sur les axes de valeurs
  - `<Chart option, height, ariaLabel, dataForExport?>` — encapsule le cycle de vie ECharts : instanciation, `resize` via `ResizeObserver`, mise à jour sans réinstanciation, destruction ; désactive l'animation si `prefers-reduced-motion` ; menu d'export PNG et CSV
  - `<CashflowChart buckets, granularity>` — barres entrées/sorties plus ligne de solde net, zoom-brosse
  - `<CategoryTreemap items>` — forable parent → enfant
  - `<SpendingCalendar points, year>` — heatmap calendaire
  - `<WaterfallChart summary>` — cascade revenus → dépenses → épargne
  - `<StatTile label, value, delta?, tone?, sparkline?>`
- Règle de couleur : une dépense n'est jamais rouge par défaut — le rouge est réservé aux anomalies et aux dépassements de budget. Les dépenses utilisent la couleur de leur catégorie.

- [ ] **Step 1: Écrire les tests qui échouent**

Créer `frontend/src/charts/theme.test.ts` :

```ts
import { describe, expect, it } from "vitest";

import { buildEchartsTheme, seriesColors } from "./theme";

describe("echarts theme", () => {
  it("uses readable text on a dark background", () => {
    const theme = buildEchartsTheme("dark");
    expect(theme.textStyle.color).toBe("#eef6f8");
    expect(theme.backgroundColor).toBe("transparent");
  });

  it("swaps to dark text on a light background", () => {
    expect(buildEchartsTheme("light").textStyle.color).toBe("#0d2029");
  });

  it("uses tabular monospace for value axes so figures align", () => {
    expect(buildEchartsTheme("dark").valueAxis.axisLabel.fontFamily).toContain("Geist Mono");
  });

  it("provides enough categorical colors before repeating", () => {
    expect(seriesColors("dark").length).toBeGreaterThanOrEqual(8);
    expect(new Set(seriesColors("dark")).size).toBe(seriesColors("dark").length);
  });
});
```

Créer `frontend/src/features/overview/StatTile.test.tsx` :

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query.includes("reduced-motion"),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
});

import { StatTile } from "./StatTile";

describe("StatTile", () => {
  it("shows the label and the formatted value", () => {
    render(<StatTile label="Solde net" valueCents={232109} />);
    expect(screen.getByText("Solde net")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveAttribute("aria-label", "2 321,09 €");
  });

  it("shows a signed delta against the previous period", () => {
    render(<StatTile label="Solde net" valueCents={232109} deltaCents={4180} />);
    expect(screen.getByText(/\+41,80 €/)).toBeInTheDocument();
  });

  it("states that there is no comparison rather than showing a fake zero", () => {
    render(<StatTile label="Taux d'épargne" valueCents={null} />);
    expect(screen.getByText("Donnée indisponible")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Lancer les tests pour vérifier qu'ils échouent**

Run: `cd frontend && npm test`
Expected: FAIL — modules introuvables

- [ ] **Step 3: Écrire `frontend/src/charts/theme.ts`**

```ts
type Resolved = "light" | "dark";

// Ordered for maximum adjacent contrast: neighbouring series stay distinguishable,
// and the ramp survives both themes.
const DARK_SERIES = [
  "#7ee2d6", "#8ab4f8", "#f4a261", "#a78bfa",
  "#4fd6a8", "#f472b6", "#38bdf8", "#fbbf24",
  "#34d399", "#fb7185",
];

const LIGHT_SERIES = [
  "#12897d", "#2563eb", "#c2610f", "#7c3aed",
  "#0f766e", "#be185d", "#0369a1", "#a16207",
  "#047857", "#be123c",
];

export function seriesColors(resolved: Resolved): string[] {
  return resolved === "dark" ? DARK_SERIES : LIGHT_SERIES;
}

export function buildEchartsTheme(resolved: Resolved) {
  const isDark = resolved === "dark";
  const text = isDark ? "#eef6f8" : "#0d2029";
  const muted = isDark ? "#93a9b8" : "#557184";
  const grid = isDark ? "rgba(126,226,214,0.12)" : "rgba(15,60,74,0.12)";

  return {
    color: seriesColors(resolved),
    backgroundColor: "transparent",
    textStyle: { color: text, fontFamily: "Geist, system-ui, sans-serif" },
    title: { textStyle: { color: text, fontWeight: 600 } },
    categoryAxis: {
      axisLine: { lineStyle: { color: grid } },
      axisTick: { show: false },
      axisLabel: { color: muted, fontSize: 11 },
      splitLine: { show: false },
    },
    valueAxis: {
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: {
        color: muted,
        fontSize: 11,
        fontFamily: "Geist Mono, ui-monospace, monospace",
      },
      splitLine: { lineStyle: { color: grid, type: "dashed" as const } },
    },
    tooltip: {
      backgroundColor: isDark ? "#0f1c28" : "#ffffff",
      borderColor: isDark ? "rgba(126,226,214,0.28)" : "rgba(15,60,74,0.18)",
      borderWidth: 1,
      textStyle: { color: text, fontSize: 12 },
      axisPointer: { lineStyle: { color: muted, type: "dashed" as const } },
    },
    legend: { textStyle: { color: muted }, icon: "roundRect" },
  };
}
```

- [ ] **Step 4: Écrire `frontend/src/charts/Chart.tsx`**

```tsx
import * as echarts from "echarts";
import { useEffect, useRef } from "react";

import { useTheme } from "../app/ThemeProvider";
import { useReducedMotion } from "../design/motion/useReducedMotion";
import { buildEchartsTheme } from "./theme";

interface ChartProps {
  option: echarts.EChartsOption;
  height?: number;
  ariaLabel: string;
  onEvents?: Record<string, (params: unknown) => void>;
}

export function Chart({ option, height = 320, ariaLabel, onEvents }: ChartProps) {
  const container = useRef<HTMLDivElement>(null);
  const instance = useRef<echarts.ECharts | null>(null);
  const { resolved } = useTheme();
  const reducedMotion = useReducedMotion();

  // The theme is baked in at init time, so a theme switch means a full re-init.
  useEffect(() => {
    if (!container.current) return;
    echarts.registerTheme("yieldo", buildEchartsTheme(resolved));
    instance.current = echarts.init(container.current, "yieldo", { renderer: "canvas" });

    const observer = new ResizeObserver(() => instance.current?.resize());
    observer.observe(container.current);

    return () => {
      observer.disconnect();
      instance.current?.dispose();
      instance.current = null;
    };
  }, [resolved]);

  useEffect(() => {
    instance.current?.setOption(
      { ...option, animation: !reducedMotion, animationDuration: 700,
        animationEasing: "cubicOut" },
      { notMerge: false, lazyUpdate: true },
    );
  }, [option, reducedMotion]);

  useEffect(() => {
    if (!instance.current || !onEvents) return;
    for (const [event, handler] of Object.entries(onEvents)) {
      instance.current.on(event, handler);
    }
    return () => {
      for (const event of Object.keys(onEvents)) instance.current?.off(event);
    };
  }, [onEvents]);

  return (
    <div ref={container} role="img" aria-label={ariaLabel}
         style={{ width: "100%", height }} />
  );
}
```

- [ ] **Step 5: Écrire les quatre composants de graphique**

`CashflowChart` : barres empilées entrées et sorties par seau, plus une ligne de solde net sur un second axe, `dataZoom` de type `inside` et `slider`, infobulle en `axis` formatant les centimes en euros, entrée animée depuis la ligne de base.

`CategoryTreemap` : `series.type = "treemap"`, niveau parent d'abord, `roam: false`, forage au clic vers les enfants, couleur reprise de `category.color`, libellé masqué sous 4 % de surface pour rester lisible.

`SpendingCalendar` : `calendar` sur une année, `series.type = "heatmap"`, `visualMap` continu du neutre vers l'accent, infobulle donnant la date en français et le total du jour. Le clic sur un jour navigue vers `/transactions?periode=custom&du=…&au=…`.

`WaterfallChart` : cascade avec une série transparente d'appui et une série visible ; revenus en positif, chaque grand poste de dépense en négatif, épargne en solde final.

- [ ] **Step 6: Écrire `StatTile.tsx` et `OverviewPage.tsx`**

`StatTile` : `<GlassCard interactive>` avec le libellé, la valeur en `<CountUp>` formatée par `formatCents`, un delta signé coloré, et une micro-sparkline facultative. Quand `valueCents` est `null`, affiche **Donnée indisponible** — jamais un zéro qui se ferait passer pour une mesure.

`OverviewPage` : grille responsive de quatre `StatTile` (revenus, dépenses, solde net, taux d'épargne), puis `CashflowChart`, `CategoryTreemap` et `SpendingCalendar`, chacun dans une `GlassCard`. Sélecteur de période partagé avec la vue transactions via `usePeriod`. Squelettes pendant le chargement, état vide avec un lien vers l'import quand aucune transaction n'existe.

- [ ] **Step 7: Lancer les tests et vérifier le build**

Run: `cd frontend && npm test && npm run build`
Expected: 63 tests PASS, build sans erreur TypeScript

- [ ] **Step 8: Commit**

```bash
git add frontend/
git commit -m "feat(overview): add ECharts wrappers and dashboard with cashflow, treemap, calendar"
```

---

# Lot E — Livraison

### Task 21: Image Docker et service du SPA

**Files:**
- Create: `docker/Dockerfile`
- Create: `docker/entrypoint.sh`
- Create: `.dockerignore`
- Create: `docker-compose.yml`
- Create: `.env.example`
- Modify: `backend/app/main.py`
- Create: `backend/tests/test_spa.py`

**Interfaces:**
- Consumes: le build frontend et l'application backend.
- Produces: une image unique. FastAPI sert `/api/*`, tout le reste renvoie `index.html` pour laisser React Router router côté client. Un fichier statique existant est servi tel quel.
- Le service tourne sous un utilisateur non privilégié `yieldo` (UID 1000). Le volume `./data` lui appartient.

- [ ] **Step 1: Écrire les tests qui échouent**

Créer `backend/tests/test_spa.py` :

```python
def test_api_404_stays_a_json_404_and_does_not_fall_back_to_the_spa(client):
    response = client.get("/api/inconnu")
    assert response.status_code == 404
    assert response.headers["content-type"].startswith("application/json")


def test_unknown_frontend_route_serves_the_spa_when_it_is_built(client, tmp_path,
                                                                monkeypatch):
    from app import main

    (tmp_path / "index.html").write_text("<!doctype html><div id=root></div>")
    monkeypatch.setattr(main, "STATIC_DIR", tmp_path)

    response = client.get("/transactions")
    assert response.status_code == 200
    assert "id=root" in response.text


def test_path_traversal_is_refused(client, tmp_path, monkeypatch):
    from app import main

    (tmp_path / "index.html").write_text("ok")
    monkeypatch.setattr(main, "STATIC_DIR", tmp_path)

    assert client.get("/../../etc/passwd").status_code in (400, 403, 404)


def test_a_clear_message_when_the_frontend_is_not_built(client, tmp_path, monkeypatch):
    from app import main

    monkeypatch.setattr(main, "STATIC_DIR", tmp_path / "absent")
    response = client.get("/")
    assert response.status_code == 503
    assert "interface" in response.json()["detail"].lower()
```

- [ ] **Step 2: Lancer les tests pour vérifier qu'ils échouent**

Run: `cd backend && pytest tests/test_spa.py -v`
Expected: FAIL — pas de route SPA

- [ ] **Step 3: Ajouter le service du SPA à `backend/app/main.py`**

```python
import os
from pathlib import Path

from fastapi import HTTPException
from fastapi.responses import FileResponse

STATIC_DIR = Path(os.environ.get("YIELDO_STATIC_DIR", "/app/static"))


@app.get("/{full_path:path}", include_in_schema=False)
def serve_spa(full_path: str) -> FileResponse:
    """Serve built assets, and hand every other path to the client-side router.

    Registered last so it never shadows /api routes.
    """
    if not STATIC_DIR.is_dir():
        raise HTTPException(
            status_code=503,
            detail="L'interface n'est pas construite. Lancez ./install.sh install.",
        )

    root = STATIC_DIR.resolve()
    candidate = (root / full_path).resolve()
    if not candidate.is_relative_to(root):
        raise HTTPException(status_code=403, detail="Chemin non autorisé")

    if full_path and candidate.is_file():
        return FileResponse(candidate)

    index = root / "index.html"
    if index.is_file():
        return FileResponse(index)
    raise HTTPException(status_code=503, detail="L'interface n'est pas construite.")
```

Cette route doit être déclarée **après** `app.include_router(api)`, sinon elle capterait `/api/...`.

- [ ] **Step 4: Écrire `docker/Dockerfile`**

```dockerfile
# syntax=docker/dockerfile:1.7

FROM node:22-alpine AS frontend
WORKDIR /build
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim AS runtime
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    YIELDO_DATA_DIR=/app/data \
    YIELDO_STATIC_DIR=/app/static

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --uid 1000 --create-home --shell /usr/sbin/nologin yieldo

WORKDIR /app
COPY backend/pyproject.toml ./
RUN pip install --no-cache-dir .

COPY backend/ ./
COPY --from=frontend /build/dist ./static
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh && mkdir -p /app/data && chown -R yieldo:yieldo /app

USER yieldo
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8000/api/health || exit 1

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

- [ ] **Step 5: Écrire `docker/entrypoint.sh`**

```sh
#!/bin/sh
# Apply pending migrations before the app accepts traffic. A failed migration
# must stop the container rather than let it serve against a stale schema.
set -eu

echo "[yieldo] applying database migrations…"
alembic upgrade head

echo "[yieldo] starting application"
exec "$@"
```

- [ ] **Step 6: Écrire `docker-compose.yml` et `.env.example`**

```yaml
services:
  yieldo:
    build:
      context: .
      dockerfile: docker/Dockerfile
    container_name: ${YIELDO_CONTAINER_NAME:-yieldo}
    restart: unless-stopped
    ports:
      - "${YIELDO_PORT:-8080}:8000"
    environment:
      YIELDO_SECRET_KEY: ${YIELDO_SECRET_KEY:?SECRET_KEY manquant — lancez ./install.sh install}
      YIELDO_REGISTRATION_OPEN: ${YIELDO_REGISTRATION_OPEN:-true}
      YIELDO_ACCESS_TOKEN_MINUTES: ${YIELDO_ACCESS_TOKEN_MINUTES:-30}
      YIELDO_REFRESH_TOKEN_DAYS: ${YIELDO_REFRESH_TOKEN_DAYS:-30}
      YIELDO_CORS_ORIGINS: ${YIELDO_CORS_ORIGINS:-[]}
    volumes:
      - ./data:/app/data
```

```sh
# .env.example — install.sh writes the real .env, never commit it
YIELDO_PORT=8080
YIELDO_SECRET_KEY=
YIELDO_REGISTRATION_OPEN=true
YIELDO_ACCESS_TOKEN_MINUTES=30
YIELDO_REFRESH_TOKEN_DAYS=30
YIELDO_CONTAINER_NAME=yieldo
```

`.dockerignore` exclut `data/`, `.env`, `node_modules/`, `.venv/`, `docs/`, `.git/`, `**/__pycache__/`, `**/.pytest_cache/`, `frontend/dist/`.

- [ ] **Step 7: Construire et vérifier**

```bash
docker compose --env-file .env.example build
```

Puis lancer avec une clé de test et vérifier :

```bash
YIELDO_SECRET_KEY=test-only docker compose --env-file .env.example up -d
curl -fsS http://localhost:8080/api/health
docker compose down
```

Expected: `{"status":"ok","version":"0.1.0"}`

- [ ] **Step 8: Lancer les tests et commit**

```bash
cd backend && pytest tests/test_spa.py -v
git add docker/ docker-compose.yml .env.example .dockerignore backend/
git commit -m "feat(docker): add multi-stage image serving API and SPA from one container"
```

---

### Task 22: install.sh — installation, port automatique, mise à jour, sauvegarde

**Files:**
- Create: `install.sh`
- Create: `tests/install/test_find_port.sh`

**Interfaces:**
- Produces les sous-commandes : `install`, `update`, `backup`, `restore <fichier>`, `start`, `stop`, `restart`, `logs`, `status`, `uninstall`, `help`.
- `find_free_port <début>` renvoie le premier port TCP libre à partir de `<début>`, en interrogeant `ss` puis `netstat`, avec un repli sur une tentative de liaison Python.
- Contrat de `update` : sauvegarder d'abord, migrer ensuite, vérifier la santé, restaurer automatiquement en cas d'échec. Les données ne sont jamais supprimées, y compris par `uninstall`.
- `SECRET_KEY` n'est généré que s'il est absent de `.env`. Un `.env` existant n'est jamais écrasé.

- [ ] **Step 1: Écrire le test qui échoue**

Créer `tests/install/test_find_port.sh` :

```sh
#!/usr/bin/env bash
# Minimal harness for the port-selection logic: no Docker required.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=/dev/null
YIELDO_LIB_ONLY=1 source "$REPO_ROOT/install.sh"

failures=0
assert_eq() {
  if [ "$1" != "$2" ]; then
    echo "FAIL: expected '$2', got '$1' ($3)"
    failures=$((failures + 1))
  else
    echo "ok: $3"
  fi
}

# A free port is returned as-is.
port="$(find_free_port 49500)"
assert_eq "$port" "49500" "returns the starting port when it is free"

# An occupied port is skipped.
python3 -c "
import socket, time
s = socket.socket(); s.bind(('127.0.0.1', 49501)); s.listen(1)
time.sleep(3)
" &
holder=$!
sleep 0.7
port="$(find_free_port 49501)"
assert_eq "$port" "49502" "skips a port that is already listening"
wait "$holder" 2>/dev/null || true

# generate_secret produces a long, non-repeating value.
first="$(generate_secret)"
second="$(generate_secret)"
assert_eq "$([ ${#first} -ge 48 ] && echo long || echo short)" "long" "secret is long enough"
assert_eq "$([ "$first" != "$second" ] && echo unique || echo repeated)" "unique" \
  "secret differs between calls"

# read_env_value reads a key from a .env file and tolerates a missing one.
tmp_env="$(mktemp)"
printf 'YIELDO_PORT=9123\nYIELDO_SECRET_KEY=abc\n' > "$tmp_env"
assert_eq "$(read_env_value "$tmp_env" YIELDO_PORT)" "9123" "reads an existing key"
assert_eq "$(read_env_value "$tmp_env" YIELDO_ABSENT)" "" "returns empty for a missing key"
rm -f "$tmp_env"

[ "$failures" -eq 0 ] && echo "All install.sh unit checks passed." || exit 1
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `bash tests/install/test_find_port.sh`
Expected: FAIL — `install.sh` n'existe pas

- [ ] **Step 3: Écrire `install.sh`**

```sh
#!/usr/bin/env bash
# Yieldo — installer and lifecycle manager.
# Usage: ./install.sh [install|update|backup|restore <file>|start|stop|restart|logs|status|uninstall]
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$REPO_ROOT/.env"
DATA_DIR="$REPO_ROOT/data"
BACKUP_DIR="$DATA_DIR/backups"
DB_FILE="$DATA_DIR/yieldo.db"
DEFAULT_PORT=8080
KEEP_BACKUPS=10

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[0;33m'; BLUE='\033[0;34m'; NC='\033[0m'
info()  { printf "${BLUE}▸${NC} %s\n" "$*"; }
ok()    { printf "${GREEN}✓${NC} %s\n" "$*"; }
warn()  { printf "${YELLOW}!${NC} %s\n" "$*"; }
fail()  { printf "${RED}✗${NC} %s\n" "$*" >&2; exit 1; }

# ── Utilities (sourced by the test harness) ─────────────────────────────

port_in_use() {
  local port="$1"
  if command -v ss >/dev/null 2>&1; then
    ss -tuln 2>/dev/null | awk '{print $5}' | grep -qE "[:.]${port}\$" && return 0
  elif command -v netstat >/dev/null 2>&1; then
    netstat -tuln 2>/dev/null | awk '{print $4}' | grep -qE "[:.]${port}\$" && return 0
  fi
  # Last resort: try to bind it. If binding succeeds, nothing else holds it.
  if command -v python3 >/dev/null 2>&1; then
    python3 - "$port" <<'PY' && return 1 || return 0
import socket, sys
port = int(sys.argv[1])
s = socket.socket()
s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
try:
    s.bind(("0.0.0.0", port))
except OSError:
    sys.exit(1)
finally:
    s.close()
PY
  fi
  return 1
}

find_free_port() {
  local candidate="${1:-$DEFAULT_PORT}"
  local attempts=0
  while [ "$attempts" -lt 200 ]; do
    if ! port_in_use "$candidate"; then
      printf '%s' "$candidate"
      return 0
    fi
    candidate=$((candidate + 1))
    attempts=$((attempts + 1))
  done
  fail "Aucun port libre trouvé à partir de ${1:-$DEFAULT_PORT}."
}

generate_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
  elif [ -r /dev/urandom ]; then
    head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'
  else
    fail "Impossible de générer une clé secrète : ni openssl ni /dev/urandom."
  fi
}

read_env_value() {
  local file="$1" key="$2"
  [ -f "$file" ] || { printf ''; return 0; }
  awk -F= -v k="$key" '$1==k {sub(/^[^=]*=/, ""); print; exit}' "$file"
}

compose() {
  if docker compose version >/dev/null 2>&1; then
    docker compose --env-file "$ENV_FILE" "$@"
  else
    docker-compose --env-file "$ENV_FILE" "$@"
  fi
}

# When sourced by tests, stop here: define functions, run nothing.
if [ "${YIELDO_LIB_ONLY:-0}" = "1" ]; then
  return 0 2>/dev/null || exit 0
fi

# ── Preflight ───────────────────────────────────────────────────────────

require_docker() {
  command -v docker >/dev/null 2>&1 \
    || fail "Docker n'est pas installé. Voir https://docs.docker.com/engine/install/debian/"
  docker info >/dev/null 2>&1 \
    || fail "Le démon Docker ne répond pas. Démarrez-le, ou ajoutez votre utilisateur au groupe docker."
  docker compose version >/dev/null 2>&1 || command -v docker-compose >/dev/null 2>&1 \
    || fail "Docker Compose est introuvable. Installez le plugin docker-compose-plugin."
}

ensure_env() {
  mkdir -p "$DATA_DIR" "$BACKUP_DIR"

  # Read every value we intend to preserve BEFORE writing: the heredoc below
  # truncates $ENV_FILE, so any read inside it would come back empty.
  local port secret registration
  registration=true
  if [ -f "$ENV_FILE" ]; then
    port="$(read_env_value "$ENV_FILE" YIELDO_PORT)"
    secret="$(read_env_value "$ENV_FILE" YIELDO_SECRET_KEY)"
    local stored_registration
    stored_registration="$(read_env_value "$ENV_FILE" YIELDO_REGISTRATION_OPEN)"
    [ -n "$stored_registration" ] && registration="$stored_registration"
  fi

  if [ -z "${port:-}" ]; then
    port="$(find_free_port "${YIELDO_PORT:-$DEFAULT_PORT}")"
    info "Port retenu : $port"
  elif port_in_use "$port" && ! compose ps --status running 2>/dev/null | grep -q yieldo; then
    warn "Le port $port est occupé par un autre service. Recherche d'un port libre…"
    port="$(find_free_port "$((port + 1))")"
    info "Nouveau port : $port"
  fi

  # The secret is generated exactly once. Regenerating it would make every
  # stored API key unreadable and log everyone out.
  if [ -z "${secret:-}" ]; then
    secret="$(generate_secret)"
    info "Clé secrète générée."
  fi

  cat > "$ENV_FILE" <<EOF
# Généré par install.sh — ne pas versionner
YIELDO_PORT=$port
YIELDO_SECRET_KEY=$secret
YIELDO_REGISTRATION_OPEN=$registration
YIELDO_ACCESS_TOKEN_MINUTES=30
YIELDO_REFRESH_TOKEN_DAYS=30
YIELDO_CONTAINER_NAME=yieldo
EOF
  chmod 600 "$ENV_FILE"
}

wait_for_health() {
  local port="$1" attempts=0
  info "Attente du démarrage…"
  while [ "$attempts" -lt 60 ]; do
    if curl -fsS "http://127.0.0.1:$port/api/health" >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
    attempts=$((attempts + 1))
  done
  return 1
}

# ── Commands ────────────────────────────────────────────────────────────

cmd_install() {
  require_docker
  ensure_env
  local port; port="$(read_env_value "$ENV_FILE" YIELDO_PORT)"

  info "Construction de l'image…"
  compose build
  info "Démarrage…"
  compose up -d

  if wait_for_health "$port"; then
    ok "Yieldo est accessible sur http://localhost:$port"
    ok "Le premier compte créé sera administrateur."
    warn "Sauvegardez $ENV_FILE : sa clé chiffre vos clés d'API."
  else
    fail "Yieldo n'a pas répondu. Diagnostic : ./install.sh logs"
  fi
}

cmd_backup() {
  mkdir -p "$BACKUP_DIR"
  [ -f "$DB_FILE" ] || { warn "Aucune base à sauvegarder."; return 0; }

  local stamp archive
  stamp="$(date +%Y%m%d-%H%M%S)"
  archive="$BACKUP_DIR/yieldo-$stamp.db"

  # sqlite3 .backup is consistent on a live database; plain cp is not.
  if command -v sqlite3 >/dev/null 2>&1; then
    sqlite3 "$DB_FILE" ".backup '$archive'"
  else
    compose exec -T yieldo sh -c "sqlite3 /app/data/yieldo.db \".backup '/app/data/backups/yieldo-$stamp.db'\"" \
      || cp "$DB_FILE" "$archive"
  fi

  cp "$ENV_FILE" "$BACKUP_DIR/env-$stamp.bak" 2>/dev/null || true
  ok "Sauvegarde : $archive"

  ls -1t "$BACKUP_DIR"/yieldo-*.db 2>/dev/null | tail -n +$((KEEP_BACKUPS + 1)) \
    | xargs -r rm -f
  printf '%s' "$archive"
}

cmd_update() {
  require_docker
  [ -f "$ENV_FILE" ] || fail "Yieldo n'est pas installé. Lancez ./install.sh install"

  local archive port
  archive="$(cmd_backup | tail -n1)"
  port="$(read_env_value "$ENV_FILE" YIELDO_PORT)"

  if [ -d "$REPO_ROOT/.git" ]; then
    info "Récupération de la dernière version…"
    git -C "$REPO_ROOT" pull --ff-only || warn "git pull impossible — poursuite avec le code local."
  fi

  info "Reconstruction…"
  compose build
  compose up -d   # migrations run in the entrypoint

  if wait_for_health "$port"; then
    ok "Mise à jour terminée. http://localhost:$port"
  else
    warn "La nouvelle version ne répond pas — restauration de la sauvegarde."
    compose down
    [ -n "$archive" ] && [ -f "$archive" ] && cp "$archive" "$DB_FILE"
    compose up -d
    fail "Mise à jour annulée, données restaurées. Diagnostic : ./install.sh logs"
  fi
}

cmd_restore() {
  local archive="${1:-}"
  [ -n "$archive" ] && [ -f "$archive" ] || fail "Usage : ./install.sh restore <fichier.db>"
  warn "Cette opération remplace la base actuelle par $archive."
  printf "Confirmer ? [oui/NON] "
  read -r answer
  [ "$answer" = "oui" ] || { info "Annulé."; return 0; }

  cmd_backup >/dev/null
  compose down
  cp "$archive" "$DB_FILE"
  compose up -d
  ok "Base restaurée."
}

cmd_uninstall() {
  warn "Le container va être supprimé. Le dossier data/ est CONSERVÉ."
  printf "Confirmer ? [oui/NON] "
  read -r answer
  [ "$answer" = "oui" ] || { info "Annulé."; return 0; }
  compose down --rmi local
  ok "Container supprimé. Vos données restent dans $DATA_DIR"
}

usage() {
  cat <<'EOF'
Yieldo — gestion du cycle de vie

  ./install.sh install          Installe et démarre (port libre détecté automatiquement)
  ./install.sh update           Sauvegarde, met à jour, migre, restaure si échec
  ./install.sh backup           Sauvegarde horodatée de la base
  ./install.sh restore <fic>    Restaure une sauvegarde
  ./install.sh start|stop|restart
  ./install.sh logs             Journaux en continu
  ./install.sh status           État du service
  ./install.sh uninstall        Supprime le container, conserve les données
EOF
}

case "${1:-help}" in
  install)   cmd_install ;;
  update)    cmd_update ;;
  backup)    cmd_backup >/dev/null ;;
  restore)   cmd_restore "${2:-}" ;;
  start)     require_docker; compose up -d; ok "Démarré." ;;
  stop)      compose down; ok "Arrêté." ;;
  restart)   compose restart; ok "Redémarré." ;;
  logs)      compose logs -f --tail=200 ;;
  status)    compose ps ;;
  uninstall) cmd_uninstall ;;
  help|--help|-h) usage ;;
  *)         usage; exit 1 ;;
esac
```

- [ ] **Step 4: Lancer les tests**

```bash
chmod +x install.sh tests/install/test_find_port.sh
bash tests/install/test_find_port.sh
```

Expected: `All install.sh unit checks passed.`

- [ ] **Step 5: Vérifier le cycle complet sur une machine avec Docker**

```bash
./install.sh install
./install.sh status
./install.sh backup
./install.sh update
```

Expected: l'application répond, la sauvegarde apparaît dans `data/backups/`, la mise à jour conserve les données.

- [ ] **Step 6: Commit**

```bash
git add install.sh tests/install/
git commit -m "feat(install): add lifecycle script with automatic port selection and safe update"
```

---

### Task 23: Test bout en bout et documentation

**Files:**
- Create: `e2e/playwright.config.ts`
- Create: `e2e/package.json`
- Create: `e2e/tests/onboarding.spec.ts`
- Create: `e2e/fixtures/releve.csv`
- Create: `README.md`
- Create: `CLAUDE.md`

**Interfaces:**
- Consumes: l'application complète servie sur `YIELDO_PORT`.
- Produces: un parcours bout en bout couvrant inscription → création de compte → import avec taggage des colonnes → tableau de bord → recatégorisation.

- [ ] **Step 1: Écrire le test bout en bout**

Créer `e2e/fixtures/releve.csv` — un relevé sur deux années, pour vérifier le filtrage temporel :

```
Date;Libelle;Debit;Credit
05/01/2025;LOYER APPARTEMENT;850,00;
06/01/2025;CARREFOUR MARKET;92,40;
31/01/2025;VIR SALAIRE ACME;;2450,00
04/02/2025;TOTALENERGIES ACCESS;68,10;
28/02/2025;VIR SALAIRE ACME;;2450,00
05/01/2026;LOYER APPARTEMENT;880,00;
31/01/2026;VIR SALAIRE ACME;;2610,00
```

Créer `e2e/tests/onboarding.spec.ts` :

```ts
import { expect, test } from "@playwright/test";
import path from "node:path";

const CSV = path.join(__dirname, "..", "fixtures", "releve.csv");

test("first run: register, create an account, import a CSV, read the dashboard", async ({
  page,
}) => {
  const email = `max-${Date.now()}@example.com`;

  await page.goto("/inscription");
  await page.getByLabel("Nom").fill("Max");
  await page.getByLabel("Adresse email").fill(email);
  await page.getByLabel("Mot de passe", { exact: true }).fill("motdepasse123");
  await page.getByLabel("Confirmer le mot de passe").fill("motdepasse123");
  await page.getByRole("button", { name: "Créer mon compte" }).click();

  await expect(page).toHaveURL(/\/$/);

  await page.getByRole("link", { name: "Import" }).click();
  await page.getByRole("button", { name: "Nouveau compte" }).click();
  await page.getByLabel("Nom du compte").fill("Compte courant");
  await page.getByLabel("Type de compte").selectOption("checking");
  await page.getByRole("button", { name: "Créer" }).click();

  await page.setInputFiles('input[type="file"]', CSV);

  // The column tagger must appear with preselected — but editable — roles.
  await expect(page.getByLabel('Rôle de la colonne "Date"')).toHaveValue("date");
  await expect(page.getByLabel('Rôle de la colonne "Libelle"')).toHaveValue("label");
  await expect(page.getByLabel('Rôle de la colonne "Debit"')).toHaveValue("debit");
  await expect(page.getByLabel('Rôle de la colonne "Credit"')).toHaveValue("credit");

  await expect(page.getByText("7 lignes")).toBeVisible();
  await page.getByRole("button", { name: "Importer" }).click();
  await expect(page.getByText("7 transactions importées")).toBeVisible();

  await page.getByRole("link", { name: "Vue d'ensemble" }).click();
  await page.getByRole("button", { name: "Tout" }).click();
  await expect(page.getByText("Revenus")).toBeVisible();

  // 2025 only: 4 900,00 € of income, not the 2026 line.
  await page.getByRole("button", { name: "Personnalisé" }).click();
  await page.getByLabel("Du").fill("2025-01-01");
  await page.getByLabel("Au").fill("2025-12-31");
  await expect(page.getByLabel("4 900,00 €")).toBeVisible();

  await page.getByRole("link", { name: "Transactions" }).click();
  await expect(page.getByText("LOYER APPARTEMENT").first()).toBeVisible();

  const row = page.getByRole("row", { name: /CARREFOUR MARKET/ });
  await row.getByLabel("Catégorie").selectOption({ label: "Courses" });
  await expect(page.getByText(/Règle apprise/)).toBeVisible();
});

test("re-importing the same file adds nothing", async ({ page }) => {
  // Assumes the previous test's session; runs serially in the same project.
  await page.goto("/import");
  await page.setInputFiles('input[type="file"]', CSV);
  await expect(page.getByText("7 doublons")).toBeVisible();
  await expect(page.getByRole("button", { name: "Importer" })).toBeDisabled();
});
```

- [ ] **Step 2: Écrire `e2e/playwright.config.ts`**

```ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 45_000,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: process.env.YIELDO_URL ?? "http://localhost:8080",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    locale: "fr-FR",
  },
  reporter: [["list"], ["html", { open: "never" }]],
});
```

- [ ] **Step 3: Lancer le test bout en bout**

```bash
./install.sh install
cd e2e && npm install && npx playwright install chromium && npx playwright test
```

Expected: 2 tests PASS

- [ ] **Step 4: Écrire `README.md`**

Sections : ce qu'est Yieldo, capture d'écran, installation en une commande sur Debian, mise à jour, sauvegarde et restauration, où vivent les données, ce qui n'est jamais envoyé à l'extérieur, format CSV attendu et taggage des colonnes, dépannage (port occupé, Docker absent, `SECRET_KEY` perdu), et la feuille de route des phases 2 à 4.

- [ ] **Step 5: Écrire `CLAUDE.md`**

Consigne le contrat du dépôt pour toute session ultérieure : montants en centimes entiers, moteurs purs sans I/O, isolation systématique par `user_id`, interface en français et code en anglais, TDD, un commit par tâche, et le rappel que le taggage des colonnes est piloté par l'utilisateur — l'auto-détection ne fait que proposer.

- [ ] **Step 6: Commit**

```bash
git add e2e/ README.md CLAUDE.md
git commit -m "test(e2e): add onboarding journey and write project documentation"
```

---

## Vérification finale de la phase 1

- [ ] `cd backend && pytest -v --cov=app --cov-report=term-missing` — tous verts, ≥ 80 % sur `app/engines` et `app/importers`
- [ ] `cd frontend && npm test && npm run build` — tous verts, build sans erreur TypeScript
- [ ] `bash tests/install/test_find_port.sh` — vert
- [ ] `./install.sh install` sur une Debian propre — l'application répond sur le port annoncé
- [ ] `./install.sh update` — les données survivent
- [ ] `cd e2e && npx playwright test` — le parcours complet passe
- [ ] Contrôle manuel : basculer le thème clair / sombre sur chaque écran ; activer « réduire les animations » dans le système et vérifier que tout reste utilisable
