# Task 12 report — API d'import et gestion des comptes

Commit: `a0a584b5610ecda12c59ab1913ac20f5a95ac730` — `feat(api): add account management and CSV import endpoints`

## What was implemented

Files created:
- `backend/app/schemas/accounts.py` — `AccountIn`, `AccountPatch`, `AccountOut`, exactly as the brief specifies.
- `backend/app/schemas/imports.py` — `DialectOut`, `PreviewRowOut`, `PreviewOut`, `CommitIn`, `BatchOut`, `ProfileIn`, `ProfileOut`, exactly as the brief specifies.
- `backend/app/api/accounts.py` — `GET/POST /api/accounts`, `PATCH/DELETE /api/accounts/{id}`, as the brief specifies. `_owned_account` filters on `user_id` and returns 404 (not 403) for accounts belonging to another user. `DELETE` archives (`archived = True`) rather than hard-deleting, so transactions never lose their account.
- `backend/app/api/imports.py` — `POST /api/imports/analyze`, `POST /api/imports/commit`, `GET /api/imports`, `DELETE /api/imports/{batch_id}`, `GET/POST /api/imports/profiles`, `DELETE /api/imports/profiles/{id}`. Deviates from the brief's sketch in two places (see below).
- `backend/tests/test_import_api.py` — the brief's 11 tests verbatim, plus 4 extra tests (path traversal, delete-by-another-user, delete-unknown-id, oversized upload) and a local `autouse` fixture that isolates `settings.uploads_dir` per test.

File modified:
- `backend/app/main.py` — imports `account_routes` and `import_routes`, and calls `api.include_router(account_routes.router)` / `api.include_router(import_routes.router)` before `app.include_router(api)`, following the same placement as the existing `auth_routes` mount.

No migration needed; no schema files touched.

## Test commands and output

Step 2 (write tests, confirm they fail) — ran before any implementation code existed:

```
cd backend && .venv/Scripts/pytest.exe tests/test_import_api.py -v
```
Result: `4 failed, 1 passed, 15 warnings, 10 errors in 1.59s` — every route that should require auth/data instead 404'd (routers not mounted), confirming the tests actually exercise the new endpoints and were not vacuously green.

Step 8 (after implementation) — new test file alone:

```
cd backend && .venv/Scripts/pytest.exe tests/test_import_api.py -v
```
Result: `15 passed, 30 warnings in 1.88s`

Full backend suite:

```
cd backend && .venv/Scripts/pytest.exe -q
```
Result: `148 passed, 54 warnings in 6.83s`

Lint:

```
cd backend && .venv/Scripts/python.exe -m ruff check app/schemas/accounts.py app/schemas/imports.py app/api/accounts.py app/api/imports.py app/main.py tests/test_import_api.py
```
Result: `All checks passed!`

## How the batch filename question was handled

The brief's sketch for `commit()` sets:
```python
filename=payload.upload_token.split(".")[0] + ".csv",
...
batch.filename = payload.upload_token if not batch.filename else batch.filename
```
`payload.upload_token` is the server-generated random token (`secrets.token_urlsafe(24) + ".csv"`), not the client's original filename — that value only ever existed as `file.filename` inside the `analyze` handler and was never threaded through to `commit`. Following the sketch literally would have set `ImportBatch.filename` to something like `"PtT8NhbMQdD.csv"`, failing the brief's own assertion `batches[0]["filename"] == "b.csv"`.

`CommitIn` (per the brief's own test payloads) carries no `filename` field, so the fix had to recover the name without the client resending it. The implementation embeds the sanitized original filename into the upload token itself at analyze time:

- `_safe_original_name(filename)` takes `Path(filename).name` (strips any directory component regardless of `/` or `\`) and keeps only `[A-Za-z0-9._-]`, capped at 80 chars, falling back to `"import.csv"`.
- `_build_upload_token(name)` returns `f"{secrets.token_urlsafe(24)}~{name}"`. `~` never appears in `secrets.token_urlsafe`'s output (URL-safe base64 alphabet is `[A-Za-z0-9_-]`), so the first `~` unambiguously marks the boundary.
- `_token_original_name(token)` extracts the part after `~` (falls back to the whole token if absent).
- `commit()` now calls `commit_import(..., filename=_token_original_name(payload.upload_token), ...)` — `ImportBatch.filename` is set correctly by `commit_import` itself; the brief's post-hoc `batch.filename = ...` reassignment line was dropped as dead/wrong logic.

The full token — including the embedded name — still passes through `_upload_path()`'s traversal guard before ever touching the filesystem, so this does not create a new injection surface; it only affects what filename displays for the batch.

## Deviations from the brief, and why

1. **Filename recovery** (above) — the brief's own sketch loses the filename; fixed as described. This was explicitly flagged as a thing to check in the task instructions.

2. **`Path.rename` → `Path.replace` on archive** — surfaced only when running the *full* test suite (multiple tests each commit a file and each gets `ImportBatch.id == 1` from their own fresh in-memory DB). `path.rename(archived)` where `archived = settings.uploads_dir / f"batch-{batch.id}.csv"` raises `FileExistsError` on Windows when the target already exists (POSIX `rename()` silently replaces; Windows `os.rename` does not). Changed to `path.replace(archived)`, which is atomic and overwrites deterministically on every platform. In production `batch.id` is monotonic for the life of the database so this path is never actually exercised, but the OS-dependent crash was worth removing rather than leaving latent.

3. **Test isolation for `uploads_dir`** — added an `autouse` fixture in `test_import_api.py` (not in `conftest.py`, which I was told not to touch) that does `monkeypatch.setattr(settings, "data_dir", tmp_path)` and creates `settings.uploads_dir`. Without it, every test run wrote real files into `backend/data/uploads` (gitignored, but real and un-cleaned), and — combined with point 2 — two tests that each commit a batch with `id == 1` collided on `batch-1.csv`. This is a `Settings.data_dir` field reassignment (plain pydantic attribute, not the `uploads_dir` property, which is read-only and cannot be monkeypatched directly).

4. **Extra tests beyond the brief's 11** (per the task's "careful points"):
   - `test_commit_rejects_a_path_traversal_upload_token` — verifies `_upload_path` 400s on `"../evil.csv"`, `"..\\evil.csv"`, `"sub/evil.csv"`, `"sub\\evil.csv"`, all with the French `"Jeton de téléversement invalide"` message. This was explicitly required by the task brief ("the brief does not include one... add a test for that").
   - `test_delete_batch_owned_by_someone_else_returns_404` — confirms `rollback_import`'s `PermissionError` surfaces as 404, not 403 (already handled correctly in the brief's sketch; added the test to lock in the behavior).
   - `test_delete_batch_unknown_id_returns_404` — confirms the `LookupError` branch.
   - `test_analyze_rejects_a_file_over_20mb` — confirms the 20 MB cap returns 413 with a French message containing `"Mo"`.

5. **Dropped the unused `AccountKind = Literal[ACCOUNT_KINDS]` type alias** from `schemas/accounts.py`. The brief defines it but never references it (`AccountIn.kind` stays a plain `str`, validated in the router against `ACCOUNT_KINDS` to produce a French error). Kept `ACCOUNT_KINDS` import only where actually used (in `app/api/accounts.py`).

## Anything later tasks need to know

- `ImportBatch.filename` is now reliably the client's original filename (sanitized to a safe charset, basename only, 80-char cap), not a token fragment. Any later task reading `batches[i]["filename"]` from `GET /api/imports` can rely on this.
- `settings.uploads_dir` is a real directory shared across the whole process (`backend/data/uploads` by default) with **no automatic purge**. The brief's prose says unvalidated uploads are purged after 24h, but no cron/background task implements that in this task (not in the Steps checklist, no test covers it) — this is still open for a later task if not already planned elsewhere.
- The `~`-embedding scheme for upload tokens (`{random}~{safe_original_name}`) is an internal implementation detail of `app/api/imports.py` (`_build_upload_token` / `_token_original_name`), not part of any documented contract — token format should be treated as opaque by any client/consumer.
- Archived import files land at `settings.uploads_dir / f"batch-{batch.id}.csv"` (via `Path.replace`, not `Path.rename` — deliberate, see deviation 2 above). `ImportBatch.stored_path` holds that path but is not exposed through `BatchOut`.
- Any new test file that calls `/api/imports/analyze` or `/api/imports/commit` should isolate `settings.uploads_dir` the same way `test_import_api.py` does (`monkeypatch.setattr(settings, "data_dir", tmp_path)` + `mkdir`), or it will write into the real `backend/data/uploads` directory.

## Fix round 1 of 5

A review of the round above found three problems: (1) CRITICAL — `commit` never checked that an `upload_token` was issued to the calling user, only that it was structurally safe and pointed at an existing file, so any user could guess `batch-<id>.csv` (or replay another user's real token) and import that user's bank statement into their own ledger; (2) IMPORTANT — the 20 MB cap in `analyze` was checked after `await file.read()` had already buffered the whole body, so it did nothing against memory exhaustion; (3) MISSING — the brief's "a file not committed is purged after 24h" requirement had no implementation.

### What was already staged when this round started

A previous implementer's process had been stopped mid-fix, but had in fact completed working, self-consistent changes to all three files (`backend/app/api/imports.py`, `backend/app/schemas/imports.py`, `backend/tests/test_import_api.py`) — staged but uncommitted, nothing of it in git history. On inspection the staged diff already:

- Replaced the single global `_upload_path(token)` with `_pending_dir(user_id)` / `_upload_path(user_id, token)`, so a token only ever resolves under `uploads_dir/pending/<user_id>/…`, derived from the authenticated session and never from client input.
- Added `_archive_dir(user_id)` and archived committed files at `uploads_dir/archive/<user_id>/batch-<id>.csv`, outside the tree `_upload_path` ever looks in, so no token can address an archive. `Path.replace` retained.
- Dropped the `{random}~{filename}` token-embedding scheme. `analyze` now returns a plain random `upload_token` plus a separate `original_filename` field; `CommitIn` gained `original_filename: str | None = None`; `commit` now calls `commit_import(..., filename=_clean_filename(payload.original_filename), ...)`, falling back to `"import.csv"` when absent.
- Explicit null-byte / empty-token rejection in `_upload_path` before any filesystem call (`if not token or "\x00" in token: raise HTTPException(400, ...)`), so a crafted token can no longer reach `os.stat`/`resolve()` and crash as an unhandled `ValueError`.
- Rewrote the `analyze` upload read as a chunked loop (`UPLOAD_CHUNK_BYTES = 64 * 1024`) that checks `received > MAX_UPLOAD_BYTES` after every chunk and raises 413 mid-stream, instead of buffering the whole body first.
- Added `_purge_stale_pending_uploads()` (24h cutoff via `PENDING_MAX_AGE_SECONDS`), called at the top of `analyze`; it walks `uploads_dir/pending`, deletes files older than the cutoff, logs the removed count at debug level, and logs (not swallows) any per-file `OSError` at warning level without failing the request.
- Added the three covering tests: `test_cross_tenant_upload_token_cannot_be_committed`, `test_commit_rejects_a_token_containing_a_null_byte`, `test_stale_pending_uploads_are_purged_after_24h`, plus updated the four existing commit-flow tests to pass `original_filename` through and updated the path-traversal test's docstring to reference the per-user pending directory.

This was a complete, coherent implementation of all three findings — nothing was half-applied. No production code changes were needed this round.

### What I changed

Nothing in `backend/app/api/imports.py`, `backend/app/schemas/imports.py`, or `backend/tests/test_import_api.py` — the staged diff already satisfied all three findings and every acceptance detail in the fix brief (structural per-user path resolution, `original_filename` field replacing the token-embedding scheme, `batches[0]["filename"] == "b.csv"` still holding, streamed 20 MB cap, 24h purge sweep with debug/warning logging). I verified this by reading the full diff and current file contents rather than assuming the report was accurate, then proved it empirically (see below) before staging anything further.

### Verification performed

1. Ran the full backend suite against the staged code: `151 passed`.
2. Ran ruff against the three changed files: `All checks passed!`.
3. Empirically confirmed each of the three covering tests actually fails against the pre-fix (committed, `a0a584b`) source — not just by inspection. Temporarily overwrote the working tree's `app/api/imports.py` and `app/schemas/imports.py` with the `HEAD` versions (keeping the new test file), reran the three new tests, then restored the staged versions and confirmed `git diff` on both files was empty afterward (zero drift from the restore):
   - `test_cross_tenant_upload_token_cannot_be_committed` → `KeyError: 'original_filename'` (pre-fix `PreviewOut`/`CommitIn` has no such field; the underlying token-guessing attack this test targets is exactly the CRITICAL finding — `_upload_path` pre-fix resolves `"batch-1.csv"` straight to the real archived path in the shared `uploads_dir`).
   - `test_commit_rejects_a_token_containing_a_null_byte` → unhandled `ValueError: stat: embedded null character in path` propagating out of `pathlib`, i.e. an uncontrolled 500 exactly as the IMPORTANT-adjacent finding describes.
   - `test_stale_pending_uploads_are_purged_after_24h` → `ImportError: cannot import name '_purge_stale_pending_uploads'` (function does not exist pre-fix).
4. After restoring the fixed files, reran the full suite and ruff once more to confirm nothing regressed: `151 passed`, `All checks passed!`.

### Exact commands and output

```
cd backend && ./.venv/Scripts/pytest.exe -q
```
```
151 passed, 58 warnings in 7.27s
```

```
cd backend && ./.venv/Scripts/python.exe -m ruff check app/api/imports.py app/schemas/imports.py tests/test_import_api.py
```
```
All checks passed!
```

Covering tests, run individually and confirmed green post-fix / red pre-fix as detailed above:
- `test_cross_tenant_upload_token_cannot_be_committed`
- `test_commit_rejects_a_token_containing_a_null_byte`
- `test_stale_pending_uploads_are_purged_after_24h`

### Staging and commit

Staged only the three backend files already under review (`backend/app/api/imports.py`, `backend/app/schemas/imports.py`, `backend/tests/test_import_api.py`); did not touch `docs/superpowers/plans/2026-08-09-yieldo-phase-1-socle.md`, which carries unrelated coordinator edits.
