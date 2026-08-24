# Task 6 Report — Transaction model and deduplication fingerprint

## Status: DONE

## What was implemented

Following the brief in `task-6-brief.md` verbatim, step by step:

1. **`backend/app/importers/__init__.py`** — empty package marker.
2. **`backend/app/importers/dedup.py`** — `normalize_label(raw: str) -> str` and
   `compute_dedup_hash(user_id, account_id, on, amount_cents, label_raw) -> str`,
   copied exactly from the brief's snippet (regex order: date fragments → card
   markers → long digit runs → non-alnum → collapse whitespace).
3. **`backend/app/models/transaction.py`** — `Transaction` model and
   `TRANSACTION_CATEGORY_SOURCES` tuple, copied exactly from the brief. Unique
   constraint `uq_transaction_user_dedup` on `(user_id, dedup_hash)` (not on
   `dedup_hash` alone, per the brief's explicit note that two users may hold an
   identical transaction). Composite indexes `ix_transaction_user_date` and
   `ix_transaction_user_category`. `tags` uses `default=list` (never `default=[]`).
4. **`backend/app/models/import_batch.py`** — `ImportBatch` and `ColumnProfile`
   models, copied exactly from the brief. `ColumnProfile` has unique constraint
   `uq_column_profile_user_name` on `(user_id, name)`.
5. **`backend/app/models/__init__.py`** — updated imports and `__all__` to export
   `ColumnProfile`, `ImportBatch`, `Transaction`, `TRANSACTION_CATEGORY_SOURCES`
   alongside the existing `ACCOUNT_KINDS`, `CATEGORY_KINDS`, `Account`, `Category`,
   `User`. This matters because `alembic/env.py` does `from app.models import *`,
   so anything not exported here would be invisible to autogenerate.
6. **`backend/tests/test_dedup.py`** — the 8 tests from the brief, copied verbatim.

## Account.transactions carry-over (required by task instructions)

Task 4's `backend/app/models/account.py` omitted the `transactions` relationship
because `Transaction` didn't exist yet (a string-based relationship to an
undefined class breaks `configure_mappers()`). Restored it exactly as specified:

```python
    user = relationship("User", back_populates="accounts")
    transactions = relationship("Transaction", back_populates="account",
                               cascade="all, delete-orphan")
```

`Transaction.account` already declares `back_populates="account"`, so both sides
now exist.

**Test added** (`backend/tests/test_models.py`,
`test_account_transactions_relationship_is_bidirectional`): creates a user, an
account, and a transaction, commits, `db.refresh(account)`, then asserts
`account.transactions == [transaction]` AND `transaction.account is account` —
so a future removal of either side of the relationship fails this test rather
than passing silently. Docstring explicitly references the Task 4 history so a
future reader understands why the test exists.

## Test commands and output

**Step 2 — confirm failure before implementation** (`cd backend`):
```
./.venv/Scripts/pytest.exe tests/test_dedup.py -v
```
Result: collection error —
`ModuleNotFoundError: No module named 'app.importers'`
— exactly as the brief predicted. Confirmed failing before writing any
implementation code.

**Step 7 — full suite after implementation**:
```
./.venv/Scripts/pytest.exe -v
```
Result: `45 passed, 26 warnings in 2.78s`
(37 pre-existing + 8 new `test_dedup.py` tests + 1 new
`test_account_transactions_relationship_is_bidirectional` in `test_models.py`).
All 8 dedup tests passed individually as listed:
- `test_normalize_label_lowercases_and_collapses_whitespace` PASSED
- `test_normalize_label_strips_punctuation_and_card_sequence_numbers` PASSED
- `test_normalize_label_is_accent_insensitive` PASSED
- `test_same_transaction_produces_same_hash` PASSED
- `test_hash_differs_when_any_component_differs` PASSED
- `test_hash_ignores_label_formatting_noise` PASSED
- `test_database_rejects_duplicate_hash_for_same_user` PASSED
- `test_transaction_defaults` PASSED

Re-ran the full suite again after `alembic upgrade head` — still `45 passed`.

**Lint**: `./.venv/Scripts/ruff.exe check` on all files created/modified for
this task (app/importers/, app/models/transaction.py, app/models/import_batch.py,
app/models/__init__.py, app/models/account.py, tests/test_dedup.py,
tests/test_models.py) — `All checks passed!`.

## Migration

Ran from `backend/`:
```
./.venv/Scripts/alembic.exe revision --autogenerate -m "transactions, import batches, column profiles"
./.venv/Scripts/alembic.exe upgrade head
```

Generated `backend/alembic/versions/6b420f6bc70c_transactions_import_batches_column_.py`,
`down_revision = 'b4eec68677e6'` (chains correctly onto the Task 5 migration).

Read the generated file in full before committing. Confirmed present:
- **Three tables**: `column_profiles`, `import_batches`, `transactions`.
- **Unique constraint** `uq_transaction_user_dedup` on `transactions(user_id, dedup_hash)`.
- **Unique constraint** `uq_column_profile_user_name` on `column_profiles(user_id, name)`.
- **Both composite indexes**: `ix_transaction_user_category` on
  `(user_id, category_id)` and `ix_transaction_user_date` on `(user_id, date)`.
- All foreign keys with correct `ondelete` (`CASCADE` for user_id/account_id,
  `SET NULL` for category_id/import_batch_id).
- `upgrade()` and `downgrade()` are inverse and correctly ordered (children
  before parents on downgrade).

`alembic upgrade head` applied cleanly against `data/yieldo.db` (gitignored via
`*.db` in `.gitignore`, so it was not staged).

The autogenerated migration file itself fails `ruff check` with 9 style issues
(`UP035`, `I001`, `UP007`, `E501` line-too-long on the long `create_index`
calls). This is Alembic's standard autogenerate boilerplate style, not something
introduced by this task — I verified the **existing** Task 5 migration
(`b4eec68677e6_users_accounts_categories.py`) has the same category of failures
(5 errors) under the same ruff config. Left both untouched rather than hand-editing
generated migration code, consistent with precedent.

## Deviations from the brief

None. All file contents match the brief's code blocks verbatim (dedup.py,
transaction.py, import_batch.py, models/__init__.py, test_dedup.py). The only
addition beyond the brief's explicit file list was the
`test_account_transactions_relationship_is_bidirectional` test in
`test_models.py`, which was explicitly required by the task instructions
(carry-over from Task 4) rather than by the brief itself.

## Files changed

- `backend/app/importers/__init__.py` (new, empty)
- `backend/app/importers/dedup.py` (new)
- `backend/app/models/transaction.py` (new)
- `backend/app/models/import_batch.py` (new)
- `backend/app/models/__init__.py` (modified — exports)
- `backend/app/models/account.py` (modified — restored `transactions` relationship)
- `backend/tests/test_dedup.py` (new)
- `backend/tests/test_models.py` (modified — added relationship regression test)
- `backend/alembic/versions/6b420f6bc70c_transactions_import_batches_column_.py` (new)

## Commit

Single commit, Conventional Commits format:
```
cac3192 feat(backend): add transaction model with idempotent dedup fingerprint
```
9 files changed, 339 insertions(+), 2 deletions(-). Staged explicitly by path
(no `git add -A`); working tree was clean before staging and is clean after
the commit — nothing from other in-flight sessions was swept in.

## Notes for later tasks

- `Transaction`, `ImportBatch`, `ColumnProfile` are now importable from
  `app.models` and registered on `Base.metadata` / exported via `__all__`, so
  Lot B (CSV import, per the brief's next section) can import them directly.
- `TRANSACTION_CATEGORY_SOURCES = ("builtin", "rule", "learned", "manual", "csv", "uncategorized")`
  is the exhaustive list of values a future `classify()` function may return for
  `Transaction.category_source`; the comment in `transaction.py` explains why
  `"builtin"` and `"rule"` are both present (rule provenance, not different
  matching mechanisms).
- `compute_dedup_hash` takes `label_raw` (not `label_clean`) and normalizes it
  internally via `normalize_label` — callers building `Transaction` rows should
  still populate `label_clean` separately (it's a plain, non-nullable column,
  not derived at read time) using the same `normalize_label` function, as
  `test_transaction_defaults` and `test_database_rejects_duplicate_hash_for_same_user`
  both do.
- `Account.transactions` uses `cascade="all, delete-orphan"`, matching the
  `ondelete="CASCADE"` on `transactions.account_id` at the DB level — deleting
  an `Account` via the ORM will delete its transactions in both layers
  consistently.
- No `stored_path` field was mentioned in the brief's `ImportBatch` interface
  list, but the brief's own code snippet for `import_batch.py` includes it
  (`stored_path: Mapped[str | None]`) — kept as specified in the code block,
  since the brief instructs following the code verbatim.

---

# Fix round 1 of 5

Review found two Important issues (both traced to the plan, which the
coordinator says has been corrected) plus one tooling-hygiene item. Addressed
all three.

## Important 1 — `_LONG_DIGITS` threshold in `backend/app/importers/dedup.py`

**Problem confirmed**: `re.compile(r"\b\d{3,}\b")` stripped any bare run of
3+ digits after the date/card passes, so `"PHARMACIE 2000"` and
`"PHARMACIE 3000"` both normalized to `"pharmacie"` — two different merchants
on the same account/date/amount would collide onto one `dedup_hash`, and the
second would be silently dropped as a duplicate on import.

**Fix**: raised the threshold to `\b\d{6,}\b` with a comment explaining why —
six digits and up covers transaction references / IBAN fragments / terminal
ids, while sparing shorter merchant-identity numbers.

```python
_LONG_DIGITS = re.compile(r"\b\d{6,}\b")
```

**Verified the existing assertion still holds, rather than assuming**: traced
`normalize_label("CB*CARREFOUR MARKET 12/03 CARTE 4589")` by hand and via the
test suite. The `4589` there is consumed by `_CARD_MARKER` (`\bcarte\s*\d*\b`
matches `"CARTE 4589"` as one token) before `_LONG_DIGITS` ever sees it, so
`test_normalize_label_strips_punctuation_and_card_sequence_numbers` is
unaffected by the threshold change and still passes unmodified — confirmed by
running it, not by inspection alone.

**Tests added** (`backend/tests/test_dedup.py`):
- `test_normalize_label_keeps_short_numeric_suffixes_that_identify_a_merchant`
  — `"PHARMACIE 2000"` and `"PHARMACIE 3000"` normalize to distinct strings.
- `test_hash_differs_for_distinct_merchants_with_short_numeric_suffix` —
  `compute_dedup_hash` for the two produces different hashes.
- `test_normalize_label_strips_long_reference_numbers` — a 12-digit reference
  embedded in a label is still removed.
- `test_hash_stable_across_reimport_despite_long_reference_number` — two
  labels differing only in a long (12-digit) reference number produce the
  *same* hash, proving the reference digits don't leak into the fingerprint
  (i.e. a re-export with a regenerated reference number still re-imports as
  a duplicate, which is the property `_LONG_DIGITS` exists to protect).

## Important 2 — missing cross-user constraint test

**Problem confirmed**: no existing test distinguished
`UniqueConstraint("user_id", "dedup_hash")` from a broken
`UniqueConstraint("dedup_hash")` alone.

**Subtlety found while writing the test**: `compute_dedup_hash` embeds
`user_id` into its SHA-256 payload. So calling it with the same date/amount/
label but two different `user_id`s already produces two different hashes —
meaning a test built that way would pass under a broken dedup_hash-only
constraint too (the hashes never collide, so no unique-constraint check is
ever exercised). To actually discriminate between the correct and broken
constraint, the test constructs two `Transaction` rows for two different
users with an **identical literal `dedup_hash` string**, bypassing
`compute_dedup_hash`'s own per-user salting, and asserts both commit without
error.

**Test added**: `test_database_allows_same_dedup_hash_for_different_users` in
`backend/tests/test_dedup.py`. Docstring explains the salting subtlety above
so a future reader doesn't "fix" the test back into a non-discriminating
form.

**Verified it actually discriminates**, as requested: temporarily changed
`backend/app/models/transaction.py`'s constraint to
`UniqueConstraint("dedup_hash", name="uq_transaction_user_dedup")` (dropping
`"user_id"`), ran the new test in isolation, and confirmed it failed with:

```
sqlalchemy.exc.IntegrityError: (sqlite3.IntegrityError) UNIQUE constraint failed: transactions.dedup_hash
```

Then reverted `transaction.py` back to
`UniqueConstraint("user_id", "dedup_hash", name="uq_transaction_user_dedup")`
(confirmed via `git diff` that the file has no net change from before this
fix round).

## Hygiene — `backend/pyproject.toml` per-file-ignores

Added the exact block from the coordinator's message. One extension was
necessary beyond the literal snippet: `ruff check .` was still not clean
after adding only `"app/api/*.py" = ["B008"]`, because
`backend/app/security/deps.py` also defines FastAPI dependency functions
using `Depends(...)` as an argument default (`get_current_user`,
`require_admin`) — the same pattern, same false positive, different
directory. Added a second entry for that file so the actual bar ("ruff check
. clean across the whole tree") is met rather than just the literal text of
the snippet:

```toml
[tool.ruff.lint.per-file-ignores]
# Alembic writes these; hand-editing generated migrations to satisfy a linter
# risks breaking a schema change for cosmetics.
"alembic/versions/*.py" = ["E501", "I001", "UP035", "UP007"]
# FastAPI's dependency injection is expressed through call defaults by design.
"app/api/*.py" = ["B008"]
"app/security/deps.py" = ["B008"]
```

Confirmed clean:
```
cd backend && ./.venv/Scripts/ruff.exe check .
All checks passed!
```

## Test run

Command (from `backend/`, as specified):
```
.venv/Scripts/pytest.exe tests/ -v
```

Output: **50 passed, 26 warnings in 2.83s**. All 13 tests in `test_dedup.py`
passed, including the 5 new ones from this fix round:
- `test_normalize_label_keeps_short_numeric_suffixes_that_identify_a_merchant` PASSED
- `test_hash_differs_for_distinct_merchants_with_short_numeric_suffix` PASSED
- `test_normalize_label_strips_long_reference_numbers` PASSED
- `test_hash_stable_across_reimport_despite_long_reference_number` PASSED
- `test_database_allows_same_dedup_hash_for_different_users` PASSED

(50 = 45 from the original task-6 commit + 5 new tests this round; no test
was removed or weakened.)

## Files changed this round

- `backend/app/importers/dedup.py` (modified — `_LONG_DIGITS` threshold 3→6, comment)
- `backend/tests/test_dedup.py` (modified — 5 new tests)
- `backend/pyproject.toml` (modified — ruff per-file-ignores)

`backend/app/models/transaction.py` was edited and reverted during
verification of Important 2; `git diff` confirms zero net change, so it is
not staged.

Not staged: `docs/superpowers/plans/2026-08-09-yieldo-phase-1-socle.md` — the
coordinator stated the plan file was already corrected on their side; this
session made no edits to it.

## Commit

```
95e79cc fix(backend): tighten dedup digit threshold and cover cross-user constraint
```
3 files changed, 79 insertions(+), 1 deletion(-). Staged explicitly by path.
