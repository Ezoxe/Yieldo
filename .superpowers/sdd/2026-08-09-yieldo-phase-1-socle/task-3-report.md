# Task 3 report — Sécurité : mots de passe, jetons, chiffrement des secrets

## Status: DONE

## What was implemented

Created a new, DB-free `app/security` package under `backend/app/security/`:

- `backend/app/security/__init__.py` — empty package marker.
- `backend/app/security/passwords.py` — Argon2id password hashing via `argon2-cffi`.
  - `_hasher = PasswordHasher(time_cost=2, memory_cost=65536, parallelism=2)` (~64 MiB, ~50 ms,
    tuned for interactive login on a modest self-hosted machine).
  - `hash_password(plain: str) -> str`
  - `verify_password(plain: str, hashed: str) -> bool` — catches `VerifyMismatchError` and
    `InvalidHashError`, returns `False` rather than raising.
  - `needs_rehash(hashed: str) -> bool`
- `backend/app/security/tokens.py` — JWT access/refresh tokens via `pyjwt`, HS256, signed with
  `settings.secret_key`.
  - `TokenError(Exception)` — user-facing messages in French, exactly as specified in the brief.
  - `create_access_token(user_id: int) -> str` — reads `settings.access_token_minutes` at call
    time (not import time), which is what makes the monkeypatch-based expiry test work.
  - `create_refresh_token(user_id: int) -> str` — reads `settings.refresh_token_days` at call time.
  - `decode_token(token: str, expected_type: str) -> int` — raises `TokenError` on any
    `jwt.PyJWTError` (malformed, tampered, expired, bad signature), on a `type` claim mismatch, and
    on a missing/non-integer `sub` claim.
- `backend/app/security/crypto.py` — Fernet symmetric encryption for stored third-party API keys,
  via `cryptography`.
  - `SecretDecryptionError(Exception)` — user-facing message in French, exactly as specified.
  - `_fernet()` derives a stable 32-byte Fernet key from `sha256(settings.secret_key)`, so the key
    used for encryption always matches the key implied by the current `SECRET_KEY` env var.
  - `encrypt_secret(plain: str) -> str`
  - `decrypt_secret(blob: str) -> str` — catches `InvalidToken` and re-raises as
    `SecretDecryptionError`.
- `backend/tests/test_security.py` — the 8 tests specified verbatim in the brief.

All four implementation files were copied verbatim from the code blocks in
`task-3-brief.md` (Steps 3–5) with no changes — the brief's code was already correct and complete
for a Python 3.12 target using `datetime.UTC`.

No file outside `app/security/` and `tests/test_security.py` was created or modified. No import
from `app.db` or `app.models` was introduced, per the task's DB-free constraint.

## Exact commands run and their output

### Step 2 — confirm the test fails first

```
cd backend && ./.venv/Scripts/pytest.exe tests/test_security.py -v
```

Result (before implementation existed):

```
ERROR collecting tests/test_security.py
ImportError while importing test module 'E:\Projet\Github\Yieldo\backend\tests\test_security.py'.
...
E   ModuleNotFoundError: No module named 'app.security'
=========================== short test summary info ===========================
ERROR tests/test_security.py
!!!!!!!!!!!!!!!!!!! Interrupted: 1 error during collection !!!!!!!!!!!!!!!!!!!!
========================= 1 warning, 1 error in 0.22s =========================
```

This matches the brief's expected failure exactly.

### Step 6 — confirm the tests pass after implementation

```
cd backend && ./.venv/Scripts/pytest.exe tests/test_security.py -v
```

Result:

```
tests/test_security.py::test_password_hash_is_argon2id_and_verifies PASSED [ 12%]
tests/test_security.py::test_password_hash_is_salted_per_call PASSED     [ 25%]
tests/test_security.py::test_access_token_round_trips_user_id PASSED     [ 37%]
tests/test_security.py::test_access_token_rejected_when_used_as_refresh PASSED [ 50%]
tests/test_security.py::test_refresh_token_round_trips_user_id PASSED    [ 62%]
tests/test_security.py::test_tampered_token_is_rejected PASSED           [ 75%]
tests/test_security.py::test_expired_token_is_rejected PASSED            [ 87%]
tests/test_security.py::test_secret_round_trips_and_ciphertext_differs_from_plaintext PASSED [100%]

======================= 8 passed, 11 warnings in 1.43s ========================
```

The 11 warnings are `StarletteDeprecationWarning` (pre-existing, from `conftest.py` importing
`TestClient` — unrelated to this task) and `jwt.exceptions.InsecureKeyLengthWarning` (the dev
default `secret_key = "dev-insecure-key-change-me"` is 26 bytes, below the 32-byte recommendation
for HS256). This warning is expected in dev/test and not a defect introduced by this task — it
will disappear once a real 32+ byte `SECRET_KEY` is configured, which is an install-time concern
covered elsewhere in the phase-1 plan, not part of this task's scope.

### Full backend suite (regression check)

```
cd backend && ./.venv/Scripts/pytest.exe -v
```

Result: `13 passed` (5 pre-existing from tasks 1–2: `test_db.py` x3, `test_health.py` x2, plus the
8 new `test_security.py` tests). No pre-existing test broke.

### Lint check

```
cd backend && ./.venv/Scripts/ruff.exe check app/security/ tests/test_security.py
```

Result: `All checks passed!`

## Deviations from the brief

None. The brief's code blocks were used verbatim for all four implementation files and the test
file. Dependencies (`argon2-cffi`, `pyjwt`, `cryptography`) were already installed in
`backend/.venv` — no `pip install` was needed.

## Git

Staged only the files created for this task, per the staging-discipline instruction:

```
git add backend/app/security/ backend/tests/test_security.py
```

`git status --porcelain` before staging showed only these two untracked paths — no stray edits
from the coordinating session were present in the working tree, so nothing else needed to be
excluded.

Commit:

```
feat(backend): add Argon2id hashing, JWT tokens, and Fernet secret encryption
```

SHA: `4d9275ea946a02a19de00870cb78beb8235f64f7` (branch `phase-1-socle`).

5 files changed, 152 insertions(+):
- `backend/app/security/__init__.py`
- `backend/app/security/crypto.py`
- `backend/app/security/passwords.py`
- `backend/app/security/tokens.py`
- `backend/tests/test_security.py`

## Notes for later tasks

- Task 5 (API layer) can import directly: `from app.security.passwords import hash_password,
  verify_password, needs_rehash`, `from app.security.tokens import TokenError,
  create_access_token, create_refresh_token, decode_token`, `from app.security.crypto import
  encrypt_secret, decrypt_secret, SecretDecryptionError`.
- `decode_token` raises `TokenError` for every failure mode (malformed, tampered, expired, wrong
  `type` claim, missing/non-integer `sub`) — the API layer only needs to catch this one exception
  type and map it to HTTP 401, no need to distinguish sub-cases unless finer-grained error
  messages are wanted later.
- `TokenError` and `SecretDecryptionError` messages are French and user-facing, verbatim as
  specified: `"Jeton invalide ou expiré"`, `"Type de jeton inattendu"`, `"Jeton sans identifiant
  utilisateur exploitable"`, `"Secret illisible — la clé de chiffrement a probablement changé"`.
- `create_access_token`/`create_refresh_token` read `settings.access_token_minutes` /
  `settings.refresh_token_days` at call time, not import time — safe to monkeypatch `settings` in
  tests (as `test_expired_token_is_rejected` does) or reconfigure at runtime.
- `encrypt_secret`/`decrypt_secret` derive their Fernet key from `sha256(settings.secret_key)` on
  every call (no caching) — changing `SECRET_KEY` at runtime (e.g., in tests via monkeypatch) is
  immediately reflected, but it also means any secret encrypted under one `SECRET_KEY` becomes
  permanently unreadable (`SecretDecryptionError`) if `SECRET_KEY` changes — this is by design per
  the brief's own docstring, and should be called out to the user by `install.sh` when it exists.
- The `app/security` package has zero dependency on `app.db` or `app.models`, confirmed by
  inspection of imports in all three modules — safe to import from anywhere without pulling in the
  database layer.

---

## Fix round 1 of 5 — review finding (Important)

### Issue

`verify_password` in `backend/app/security/passwords.py` caught only `VerifyMismatchError` and
`InvalidHashError`. `PasswordHasher.verify()` can also raise the broader
`argon2.exceptions.VerificationError`: the header-prefix check raises `InvalidHashError` only when
the `$argon2id$`-style prefix itself is unrecognized, but a hash with a *valid* prefix and a
corrupted or truncated body (database truncation, encoding damage, bad salt or tag) reaches the C
binding and raises the generic `VerificationError`, which was not caught. No authentication bypass
existed — nothing returned `True` for a bad hash — but a corrupted stored hash raised out of
`verify_password` instead of returning the `False` its signature promises, which would surface as
an HTTP 500 on the login route in Task 5 rather than a clean refusal.

### Exception hierarchy — verified, not taken on faith

Checked directly against the installed `argon2-cffi` in `backend/.venv`:

```
VerifyMismatchError.__mro__ = (VerifyMismatchError, VerificationError, Argon2Error, Exception, BaseException, object)
issubclass(VerifyMismatchError, VerificationError) == True
InvalidHashError.__mro__ = (InvalidHashError, ValueError, Exception, BaseException, object)
```

Confirmed: `VerifyMismatchError` is a subclass of `VerificationError` (both descend from the
package's `Argon2Error`), so catching `(VerificationError, InvalidHashError)` still covers the
wrong-password path — nothing was lost by dropping the more specific `VerifyMismatchError` from
the `except` tuple. `InvalidHashError` is a separate branch (subclasses `ValueError`, not
`VerificationError`), so it still needs to be listed explicitly — confirmed by reproducing the
malformed-prefix case (`"garbage"` as a hash) still raises `InvalidHashError`, not
`VerificationError`.

Also empirically reproduced the corrupted-body case that motivated the fix: truncating the last 5
characters off a real `hash_password()` output (prefix intact, tag/body damaged) raises a bare
`argon2.exceptions.VerificationError: Decoding failed` — not `VerifyMismatchError`, not
`InvalidHashError` — confirming this exact case fell through the old two-exception `except` clause.

### Fix applied

`backend/app/security/passwords.py` — replaced `VerifyMismatchError` with the broader
`VerificationError` in the `except` clause (which still covers `VerifyMismatchError` via
inheritance) and added the docstring explaining why, exactly as given in the corrected plan:

```python
from argon2.exceptions import InvalidHashError, VerificationError

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
```

### Covering test added

`backend/tests/test_security.py::test_verify_password_returns_false_for_corrupted_hash_body`:

```python
def test_verify_password_returns_false_for_corrupted_hash_body():
    """A hash with a valid $argon2id$ prefix but a damaged body (e.g. truncated by
    the database) must refuse the login, not raise — argon2-cffi surfaces this as
    the generic VerificationError rather than VerifyMismatchError or InvalidHashError.
    """
    hashed = hash_password("correct horse battery staple")
    corrupted = hashed[:-5]
    assert corrupted.startswith("$argon2id$")
    assert verify_password("correct horse battery staple", corrupted) is False
```

The test builds the corrupted hash by taking a real `hash_password()` output and slicing off its
last 5 characters — the `$argon2id$` prefix and parameters stay intact, only the base64 body/tag is
damaged, which is exactly the "valid prefix, damaged body" case the review described.

**Verified against both versions, as required:**

- Against the *old* two-exception `verify_password` (temporarily restored via `git stash`): the new
  test **failed** with an uncaught exception —
  `argon2.exceptions.VerificationError: Decoding failed` propagating out of `verify_password`,
  confirming the bug is real and the test catches it.
- Against the *fixed* `verify_password` (`git stash pop` to restore the fix): the new test
  **passes**.

### Test run — command and output

```
cd backend && ./.venv/Scripts/pytest.exe tests/test_security.py -v
```

```
tests/test_security.py::test_password_hash_is_argon2id_and_verifies PASSED [ 11%]
tests/test_security.py::test_password_hash_is_salted_per_call PASSED     [ 22%]
tests/test_security.py::test_verify_password_returns_false_for_corrupted_hash_body PASSED [ 33%]
tests/test_security.py::test_access_token_round_trips_user_id PASSED     [ 44%]
tests/test_security.py::test_access_token_rejected_when_used_as_refresh PASSED [ 55%]
tests/test_security.py::test_refresh_token_round_trips_user_id PASSED    [ 66%]
tests/test_security.py::test_tampered_token_is_rejected PASSED           [ 77%]
tests/test_security.py::test_expired_token_is_rejected PASSED            [ 88%]
tests/test_security.py::test_secret_round_trips_and_ciphertext_differs_from_plaintext PASSED [100%]

======================= 9 passed, 11 warnings in 1.42s ========================
```

9 passed (previous 8 plus the new covering test). Warnings are the same pre-existing
`StarletteDeprecationWarning` and `jwt.InsecureKeyLengthWarning` noted above — unrelated to this
fix.

Also re-ran the full backend suite (`./.venv/Scripts/pytest.exe -q`) as a regression check:
`14 passed` (13 previous + 1 new). `ruff check app/security/passwords.py tests/test_security.py`:
`All checks passed!`.

### Files changed in this fix round

- `backend/app/security/passwords.py` (modified)
- `backend/tests/test_security.py` (modified)

Note: the working tree also showed `docs/superpowers/plans/2026-08-09-yieldo-phase-1-socle.md` as
modified (the coordinator's plan correction mentioned in the fix-round instructions) — this file
was not touched by this fix round and was left unstaged, per the staging-discipline instruction to
stage only files genuinely changed for this task.

### Commit

```
git add backend/app/security/passwords.py backend/tests/test_security.py
git commit -m "fix(backend): catch generic VerificationError in verify_password"
```

SHA: `ebee180eeb52d256f44cedde43ef271081e88ce9` (branch `phase-1-socle`).
