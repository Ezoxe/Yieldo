# Task 5 report: API d'authentification et isolation par utilisateur

## Status: DONE

## What was implemented

Followed the brief in `task-5-brief.md` verbatim, TDD order (failing tests first, then implementation).

Files created:
- `backend/app/schemas/auth.py` — `RegisterIn`, `LoginIn`, `UserOut`, `TokenOut` Pydantic models, exactly as specified in the brief.
- `backend/app/schemas/__init__.py` — re-exports the four schema classes.
- `backend/app/security/deps.py` — `get_current_user(request, db) -> User` (reads `Authorization: Bearer <access>`, raises 401 "Authentification requise" on any failure) and `require_admin(user = Depends(get_current_user)) -> User` (raises 403 "Droits administrateur requis" for non-admins).
- `backend/app/api/__init__.py` — empty package marker.
- `backend/app/api/auth.py` — `APIRouter(prefix="/auth", tags=["auth"])` with:
  - `POST /register` (201) — first user becomes `admin`, rejects duplicate email (409, "Un compte avec cet email existe déjà"), enforces `registration_open` for all but the first user (403, "Les inscriptions sont fermées"), seeds default categories via `seed_categories(db, user.id)` right after the user is committed, sets the refresh cookie, returns `TokenOut`.
  - `POST /login` (200) — always calls `verify_password` even when the account is missing (hashes a `"timing-equalizer"` dummy password in that case) so unknown-email and wrong-password paths are timing-indistinguishable; both return the identical 401 detail `"Identifiants invalides"`.
  - `POST /refresh` (200) — reads the `yieldo_refresh` cookie, decodes it as a `refresh`-typed token, issues a new access token + rotated refresh cookie.
  - `POST /logout` (204) — clears the `yieldo_refresh` cookie (same path).
  - `GET /me` (200) — returns the authenticated user via `get_current_user`.
  - Refresh cookie: `HttpOnly`, `SameSite=Strict`, `secure=False` (documented as intentional for LAN/plain-HTTP self-hosted deployments), `path="/api/auth"`, name `yieldo_refresh`, max-age from `settings.refresh_token_days`.
- `backend/tests/test_auth_api.py` — the 13 tests exactly as given in the brief, unmodified.

Files modified:
- `backend/app/main.py` — imports `app.api.auth` as `auth_routes` and calls `api.include_router(auth_routes.router)` **before** `app.include_router(api)`, per the brief's ordering requirement (otherwise routes silently 404 since `app.include_router(api)` runs at import time).
- `backend/pyproject.toml` — added `email-validator>=2.2` to `[project.dependencies]` (see Deviations below).

## Test commands and output

Step 2 — confirm the new tests fail before implementation existed:

```
cd backend && ./.venv/Scripts/pytest.exe tests/test_auth_api.py -v
```
Result: **13 failed** (routes 404 / KeyError on missing cookies / etc.), exactly as the brief predicted ("FAIL — 404 sur toutes les routes").

Step 7 — after implementing schemas, deps, routes, and mounting the router:

```
cd backend && ./.venv/Scripts/pytest.exe tests/test_auth_api.py -v
```
Result:
```
13 passed, 14 warnings in 1.04s
```
All 13 tests pass, including `test_refresh_issues_a_new_access_token` (relies on TestClient's cookie jar carrying `yieldo_refresh` from the preceding login call — passed without needing to touch the cookie path or `conftest.py`).

Full backend suite (regression check):
```
cd backend && ./.venv/Scripts/pytest.exe -v
```
Result:
```
34 passed, 24 warnings in 2.44s
```
No pre-existing test (test_db, test_health, test_models, test_security, test_seed_categories) was affected.

The only warnings are pre-existing/unrelated:
- `StarletteDeprecationWarning` about httpx/starlette.testclient (pre-existing, not introduced by this task).
- `InsecureKeyLengthWarning` from PyJWT because the dev `secret_key` in `Settings` is short — pre-existing from Task 3, not touched here.

## Deviations from the brief

1. **Added `email-validator>=2.2` as a project dependency and installed it into `backend/.venv`.** The brief's `schemas/auth.py` uses Pydantic's `EmailStr` (for `RegisterIn.email` and `LoginIn.email`), which requires the optional `email-validator` package. It was not yet a dependency in `pyproject.toml` (checked: only `pydantic`, `pydantic-settings`, and other unrelated packages were listed) and was not installed in the venv, so the app failed to import with `ImportError: email-validator is not installed`. This is necessary to run the code exactly as specified in the brief — no schema logic was changed, `EmailStr` is used exactly as written. Installed with `./.venv/Scripts/python.exe -m pip install "email-validator>=2.2"` (pulled in `dnspython` as its own dependency) and added the line to `[project.dependencies]` in `backend/pyproject.toml` so a fresh venv install stays reproducible.

2. **Ruff B008 findings (not fixed, not a deviation from the brief).** Running `ruff check .` on the new/changed files flags `B008 Do not perform function call \`Depends\` in argument defaults` on every `Depends(...)` default parameter in `app/api/auth.py` and `app/security/deps.py`. This is the standard, unavoidable FastAPI dependency-injection idiom and is exactly the code the brief specifies verbatim — ruff's bugbear rule doesn't special-case FastAPI's `Depends` unless `flake8-bugbear.extend-immutable-calls` is configured in `pyproject.toml`, which it currently is not. I did not add that config since it wasn't requested and touching lint configuration was out of scope for this task; flagging it here for whoever owns lint configuration. Separately, `ruff check .` on the whole repo also reports pre-existing `UP035`/`I001`/`UP007` findings in `alembic/versions/b4eec68677e6_users_accounts_categories.py` (autogenerated migration file from an earlier task) — untouched, unrelated to this task.

No other deviations. All routes, schemas, dependency behavior, cookie settings, and error strings match the brief exactly, including the literal French strings: `"Identifiants invalides"`, `"Un compte avec cet email existe déjà"`, `"Les inscriptions sont fermées"`, `"Authentification requise"`, `"Droits administrateur requis"`.

## What later tasks need to know

- **Task 9** (rules seeding): the brief calls out that `seed_rules` will be added next to `seed_categories` in the register handler. The call site is `backend/app/api/auth.py`, inside `register()`, immediately after `seed_categories(db, user.id)` (currently the last statement before `_set_refresh_cookie(...)`). It's a single clean line — add `seed_rules(db, user.id)` right after it, following the same import pattern (`from app.categorization.seed import seed_categories` → add the new import next to it, or from wherever `seed_rules` will live).
- **Per-user isolation dependency is now available**: `app.security.deps.get_current_user` and `app.security.deps.require_admin`. Every later route that touches a business table (accounts, transactions, budgets, rules, etc.) should depend on `get_current_user` and filter every query on `.filter(Model.user_id == user.id)` — this task only builds the dependency; enforcing the filter on other tables is the job of the routes that consume it.
- **Access tokens are stateless JWTs** (`app.security.tokens`), no server-side revocation list exists yet. `get_current_user` only checks `user.is_active` at request time — deactivating a user takes effect immediately for lookups but does not invalidate already-issued access tokens until they expire (default 30 minutes per `settings.access_token_minutes`). If Task 6+ needs immediate revocation semantics, that's a gap to fill deliberately, not an oversight to silently rely on.
- **Refresh cookie path is `/api/auth`.** Any future route that needs to read the refresh cookie (there shouldn't be one — only `/api/auth/refresh` and `/api/auth/logout` reference `REFRESH_COOKIE`) must live under `/api/auth` or the browser will not send the cookie.
- **`email-validator` is now a hard dependency.** If any future task or CI setup rebuilds the venv from `pyproject.toml`, it will be picked up automatically; no manual step needed going forward.
- Registration is open to everyone until `settings.registration_open` is set to `False` (env var `YIELDO_REGISTRATION_OPEN`), at which point only the very first account (the auto-promoted admin) already exists — every subsequent register attempt gets 403 "Les inscriptions sont fermées". This is enforced only in the `register` handler; there's no separate invite-code or admin-approval flow in phase 1.

## Commit

```
d3b48c5 feat(backend): add registration, login, refresh, and per-user isolation dependency
```

Staged only the files this task created/changed (`git add` with explicit paths, not `-A`):
`backend/app/api/__init__.py`, `backend/app/api/auth.py`, `backend/app/main.py`,
`backend/app/schemas/__init__.py`, `backend/app/schemas/auth.py`, `backend/app/security/deps.py`,
`backend/pyproject.toml`, `backend/tests/test_auth_api.py`.

Working tree was clean before staging (verified with `git status`) and clean again after commit.

---

## Fix round 1 of 5

Review found one Critical and one Important issue, both originating in the plan (already corrected upstream). Fixed both, added covering tests, re-ran the full suite, and committed separately.

### CRITICAL — login timing oracle (double Argon2 op on the unknown-email path)

**Problem confirmed as described:** the original `login()` called `hash_password("timing-equalizer")` inline on every request where the account didn't exist, *in addition to* the `verify_password` call both paths already run. That is two Argon2 operations (one hash, one verify) for an unknown email versus one (verify only) for a wrong password on a real account — a measurable, reproducible latency gap at `time_cost=2, memory_cost=65536` (~64 MiB), i.e. exactly the account-enumeration oracle the code's own comment claimed to prevent.

**Fix applied**, in `backend/app/api/auth.py`:
- Added a module-level `_DUMMY_HASH = hash_password("timing-equalizer")`, computed once at import time.
- `login()` now does `stored_hash = user.password_hash if user else _DUMMY_HASH` and calls `verify_password` exactly once on every path — no `hash_password` call ever happens during request handling.
- Replaced the shared `_INVALID_CREDENTIALS` `HTTPException` instance with a `_invalid_credentials()` factory function that builds a fresh exception per call, and replaced every reference (`login`, `refresh`, including the `raise ... from exc` sites) accordingly. Reason: a shared `HTTPException` instance has its `__cause__` attribute rewritten by `raise ... from exc`, which is a data race across concurrent requests sharing the same object — a second issue the reviewer's note called out as the same-shaped bug as `_UNAUTHORIZED` in `deps.py`.
- Applied the identical fix in `backend/app/security/deps.py`: `_UNAUTHORIZED` (shared instance) replaced with `_unauthorized()` (fresh instance per call), used in `get_current_user`'s three raise sites, including the `from exc` one.

### IMPORTANT — register() TOCTOU admin race

**Problem confirmed as described:** `is_first_user = db.query(User).count() == 0` is a check-then-act race; two concurrent registrations with distinct emails could both observe `count() == 0` and both become admin.

**Fix applied, with an empirical verification step first.** Before touching the code, I probed whether `db.execute(text("BEGIN IMMEDIATE"))` actually works against this app's session setup (`backend/app/db.py`'s `SessionLocal`, and the equivalent construction in `tests/conftest.py`), using a throwaway script bound to the same engine/session configuration. Findings:
- `BEGIN IMMEDIATE` as the very first statement on a session: works.
- `BEGIN IMMEDIATE` even after a prior plain `SELECT` on the same session: still works (SQLite's legacy pysqlite driver doesn't implicitly open a transaction for `SELECT`, only for DML, so a preceding read doesn't block the manual `BEGIN IMMEDIATE`).
- `BEGIN IMMEDIATE` issued a **second** time on a session that already has an open, uncommitted transaction (e.g. because the first `BEGIN IMMEDIATE` was followed by an exception with no `commit()`/`rollback()`): fails with `sqlite3.OperationalError: cannot start a transaction within a transaction`.

That third finding is a real risk here specifically because `backend/tests/conftest.py`'s `client` fixture overrides `get_db` with a plain `lambda: db` (not a generator), so the *same* `Session` object is reused across every request within a single test — there is no per-request `session.close()`/rollback the way there is in production (`app/db.py`'s `get_db` closes the session, which implicitly rolls back, in its `finally` block after every request). So in production this class of problem self-heals every request; in the test suite specifically, a `register()` call that opened `BEGIN IMMEDIATE` and then raised (duplicate email, registration closed) without rolling back would leave the shared test session stuck for any later request in the same test.

**Chosen solution:** keep `BEGIN IMMEDIATE` (it does work, per the probe above) but wrap the whole read-then-write body in `try/except Exception: db.rollback(); raise`, so every exit path other than a successful `db.commit()` explicitly releases the write lock:

```python
db.execute(text("BEGIN IMMEDIATE"))
try:
    is_first_user = db.query(User).count() == 0
    if not is_first_user and not settings.registration_open:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Les inscriptions sont fermées")
    email = payload.email.strip().lower()
    if db.query(User).filter(User.email == email).first() is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Un compte avec cet email existe déjà")
    user = User(..., role="admin" if is_first_user else "user")
    db.add(user)
    db.commit()
except Exception:
    db.rollback()
    raise
db.refresh(user)
seed_categories(db, user.id)
```
The bare `raise` inside `except Exception` re-raises the original exception (`HTTPException` included) unchanged, so status codes/details are unaffected; `db.rollback()` runs first so the write lock and the open transaction are always released before the exception propagates. Added `from sqlalchemy import text` to the imports.

This is not a deviation from the reviewer's suggested code — it is exactly what the review asked for ("if [BEGIN IMMEDIATE within the existing session] works, verify it; if a nested BEGIN would error, solve it a different way and say exactly what"). It works, so the only addition beyond the reviewer's snippet is the rollback safety net, needed because the review's snippet did not on its own address what happens to the transaction on the existing early-return/raise paths.

### Covering tests added (both in `backend/tests/test_auth_api.py`)

1. **`test_login_unknown_email_and_wrong_password_do_equal_argon2_work`** — monkeypatches `app.api.auth.hash_password` and `app.api.auth.verify_password` (the names actually referenced inside `login()`; patching `app.security.passwords.hash_password` directly would not intercept these calls, since `from ... import hash_password` binds a separate reference into `app.api.auth`'s namespace at import time) with counting wrappers. Registers one user, then issues one unknown-email login and one wrong-password login, resetting the counters between them, and asserts the total Argon2 operation count (`hash` calls + `verify` calls) is identical across both — and equal to 1.
   - **Verified this test fails against the pre-fix code**: I temporarily swapped in the pre-fix-round `auth.py` (extracted via `git show HEAD:backend/app/api/auth.py`) and re-ran just this test. It failed with `assert 2 == 1` (unknown-email path: 1 hash + 1 verify = 2; wrong-password path: 0 hash + 1 verify = 1), exactly reproducing the bug the review flagged. Then restored the fixed `auth.py` and confirmed the full suite passes again.

2. **`test_admin_role_is_granted_exactly_once_across_sequential_registrations`** — registers two users sequentially and asserts, via a direct DB query (`db.query(User).filter(User.role == "admin").count()`), that exactly one user ends up with `role == "admin"`.
   - **Did not drive this with real concurrent threads**, and the test's docstring says why: `conftest.py`'s `db`/`client` fixtures bind the entire test to a single `StaticPool` SQLite connection shared by every session (that's what lets `TestClient`'s internal worker threads see the same in-memory database — see the existing `test_db_fixture_is_visible_from_worker_threads`). `StaticPool` hands out that *same* underlying DBAPI connection object to every checkout, concurrent or not. Two Python threads calling `BEGIN IMMEDIATE` against that one shared connection object would not be exercising SQLite's real inter-connection write-lock semantics (the thing `BEGIN IMMEDIATE` actually defends against in production, where each request gets its own connection from a real pool) — it would only be probing the stdlib `sqlite3` module's own single-connection concurrent-thread handling, which is a different, flakier, and less meaningful thing to assert on, and risks CI flakiness unrelated to the fix. The sequential test instead locks in the invariant the guard exists to protect.

### Test commands and output

```
cd backend && ./.venv/Scripts/pytest.exe tests/ -v
```
Result: **36 passed, 26 warnings in 2.65s** — the original 34 tests plus the 2 new covering tests, all green. Test names in the run: all 15 tests in `test_auth_api.py` (13 original + 2 new: `test_login_unknown_email_and_wrong_password_do_equal_argon2_work`, `test_admin_role_is_granted_exactly_once_across_sequential_registrations`), plus the 21 pre-existing tests in `test_db.py`, `test_health.py`, `test_models.py`, `test_security.py`, `test_seed_categories.py` — all `PASSED`, zero failures.

Additionally ran the new Argon2-op-count test in isolation against the pre-fix `auth.py` (see above) to confirm it fails there:
```
cd backend && ./.venv/Scripts/pytest.exe tests/test_auth_api.py::test_login_unknown_email_and_wrong_password_do_equal_argon2_work -v
```
Result against pre-fix code: **1 failed** — `assert 2 == 1`. Result against fixed code (after restoring): passes as part of the full 36-passed run above.

### Files changed in this fix round

- `backend/app/api/auth.py` — `_invalid_credentials()` factory replacing shared `_INVALID_CREDENTIALS`; `_DUMMY_HASH` precomputed at import; `login()` rewritten to call `verify_password` exactly once per request with no per-request `hash_password`; `register()` wrapped with `BEGIN IMMEDIATE` + `try/except Exception: db.rollback(); raise`; added `from sqlalchemy import text`.
- `backend/app/security/deps.py` — `_unauthorized()` factory replacing shared `_UNAUTHORIZED` instance, used at all three raise sites in `get_current_user`.
- `backend/tests/test_auth_api.py` — added the two covering tests described above.

Not staged/committed: `docs/superpowers/plans/2026-08-09-yieldo-phase-1-socle.md` — this file was already modified in the working tree by the coordinator (per their message, "the plan file has been corrected") before this fix round started; I did not touch it and left it out of my commit per the staging discipline ("stage only the files you changed").

### What later tasks / reviewers need to know

- `app.api.auth._invalid_credentials()` and `app.security.deps._unauthorized()` are now **functions**, not module-level `HTTPException` constants. Any future code that imported the old `_INVALID_CREDENTIALS` / `_UNAUTHORIZED` names directly (none currently does, outside this module) would need to call the new factory instead.
- `register()` now opens a real SQLite write transaction (`BEGIN IMMEDIATE`) for its whole body. Anyone extending `register()` later (e.g. Task 9's `seed_rules` call) should keep new DB work either inside the existing `try` block (covered by the same rollback-on-failure safety net) or clearly after the `db.commit()` once the user row is durably committed — mixing the two carelessly could either lose the lock's protection or extend the write-lock hold time unnecessarily. The current `seed_categories(db, user.id)` call intentionally stays *after* the commit (unchanged from Task 5's original placement), since it does its own follow-up `db.commit()` and doesn't need to be inside the admin-race-guarded transaction.
- The admin-race fix only defends the SQLite write-lock in real multi-connection deployments (production, or any test that gives two threads their own `Session`/connection). Within this repo's current test fixtures, `BEGIN IMMEDIATE` is exercised for correctness (no exception, proper rollback-on-failure) but not for genuine lock contention, for the `StaticPool`-sharing reason explained above.

### Commit

```
4e7e1ab fix(backend): remove login timing oracle and register admin race
```
