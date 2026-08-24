# Task 11 report — Import service (preview, atomic commit, rollback)

## Fix round 1 (post-review)

Two Important findings from review; both fixed in `backend/app/importers/service.py`,
with covering tests added to `backend/tests/test_import_service.py`.

### Important 1 — coarse-hint exclusion went too far

My original fix for "coarse CSV hints must not outrank precise rules" excluded every
category with children from `by_name` entirely, which threw away the CSV hint whenever
no rule fired at all — and the reviewer confirmed the whole `loisirs-*` subtree has zero
`BUILTIN_RULES` coverage (same hole exists for ride-hailing under `transport-*`), so a
bank-tagged "Loisirs" expense would silently end up uncategorized despite the file
naming its category.

Fixed per the reviewer's exact prescription: `by_name` is restored to include every
category (parents and leaves). `_resolve_category` now applies an explicit three-step
precedence instead of an implicit lookup-first-then-rule:

1. If the CSV hint names a **leaf** category (`parent_id is not None`), it wins outright
   — a leaf hint is at least as precise as anything a rule could infer.
2. Otherwise (hint absent, or hint names a parent bucket), try the rule library.
3. Only if no rule fires, fall back to the hint even if it names a bucket — a coarse
   answer beats no answer.

Traced `test_preview_categorizes_using_the_rule_library` against the new code to confirm
it still passes: all four Boursorama hints ("Alimentation", "Revenus", "Loisirs",
"Transport") name top-level buckets (`parent_id is None`), so step 1 never fires for any
of them, and step 2's rule match wins in all four cases exactly as before.

New covering tests in `test_import_service.py`:

- `test_bucket_hint_used_when_no_rule_matches` — a `"CINEMA PATHE"` row tagged
  `Loisirs` (a bucket with no built-in rule coverage) resolves to
  `categories["loisirs"]` with `category_source == "csv"`, instead of falling through
  to `uncategorized`.
- `test_leaf_hint_wins_over_a_conflicting_rule` — a `"CARREFOUR MARKET..."` row tagged
  `Cadeaux` (a leaf under `achats-cadeaux`) resolves to `achats-cadeaux` with
  `category_source == "csv"`, even though the label would otherwise match the
  `alimentation-courses` rule.

### Important 2 — forced-duplicate suffix could collide across commits

The original `fingerprint = f"{fingerprint}:{candidate.row_number}"` assumed the
row number alone made the suffix unique, but it never checked the suffixed value
against `seen`. Forcing the same row through `keep_duplicates` on a second import
reused the exact same `"<hash>:<row>"` string a second time and would raise an
unhandled `IntegrityError` on `db.commit()` (unique constraint on
`(user_id, dedup_hash)`).

Fixed per the reviewer's exact prescription: search forward from the row number for
a suffix not already in `seen`:

```python
suffix = candidate.row_number
while f"{fingerprint}:{suffix}" in seen:
    suffix += 1
fingerprint = f"{fingerprint}:{suffix}"
```

New covering test: `test_forcing_the_same_duplicate_through_repeatedly_does_not_collide`
— commits the Boursorama fixture three times, forcing row 1 through via
`keep_duplicates=[1]` on the second and third commits. Asserts all three calls return
successfully (no `IntegrityError`), with `rows_imported`/`rows_duplicate` of `4`/`0`,
`1`/`3`, `1`/`3` respectively, and a final `Transaction` count of `6`
(4 originals + row 1 forced through twice with distinct suffixes `"...:1"` and
`"...:2"`).

### Test command and output

```
cd backend && .venv/Scripts/pytest.exe tests/ -v
```

Full output tail:

```
tests/test_import_service.py::test_preview_reports_a_usable_summary PASSED [ 50%]
tests/test_import_service.py::test_preview_categorizes_using_the_rule_library PASSED [ 51%]
tests/test_import_service.py::test_bucket_hint_used_when_no_rule_matches PASSED [ 51%]
tests/test_import_service.py::test_leaf_hint_wins_over_a_conflicting_rule PASSED [ 52%]
tests/test_import_service.py::test_preview_does_not_write_anything PASSED [ 53%]
tests/test_import_service.py::test_commit_creates_transactions_and_a_batch PASSED [ 54%]
tests/test_import_service.py::test_reimporting_the_same_file_imports_nothing_new PASSED [ 54%]
tests/test_import_service.py::test_preview_flags_rows_already_present PASSED [ 55%]
tests/test_import_service.py::test_user_can_force_a_flagged_duplicate_through PASSED [ 56%]
tests/test_import_service.py::test_forcing_the_same_duplicate_through_repeatedly_does_not_collide PASSED [ 57%]
tests/test_import_service.py::test_category_override_wins_over_rules PASSED [ 57%]
tests/test_import_service.py::test_rollback_removes_exactly_that_batch PASSED [ 58%]
tests/test_import_service.py::test_rollback_refuses_another_users_batch PASSED [ 59%]
tests/test_import_service.py::test_failed_rows_are_counted_and_skipped PASSED [ 60%]
...
====================== 133 passed, 26 warnings in 4.44s =======================
```

133 passed (was 130 before this task; 14 tests now in `test_import_service.py`, up from
11). `ruff check app/importers/service.py tests/test_import_service.py` reports
`All checks passed!`.

The two Minor findings (`mapping_errors` key, no try/except around `db.commit()`) were
left as-is per the coordinator's instruction to defer them.

## Original implementation report (pre-fix)

## What was implemented

Created `backend/app/importers/service.py`, the orchestration layer that assembles the
pure CSV pipeline (dialect detection, parsing, dedup hashing, rule-based categorization)
and the ORM models into three functions:

- `build_preview(db, user_id, account_id, raw, dialect, mapping) -> ImportPreview` —
  analyses a file and reports what would happen (row-by-row categorization, duplicate
  flags, failed-row errors, and a summary) without writing anything to the database.
- `commit_import(db, user_id, account_id, raw, filename, dialect, mapping, overrides,
  keep_duplicates) -> ImportBatch` — parses the file again and persists an `ImportBatch`
  plus its `Transaction` rows in one atomic `db.commit()`. Duplicates are skipped unless
  their row number is in `keep_duplicates`, in which case the dedup fingerprint is
  suffixed with the row number so the `(user_id, dedup_hash)` unique constraint isn't
  violated. `overrides` lets the user's explicit per-row category choice win
  (`category_source="manual"`) over both the CSV hint and the rule engine.
- `rollback_import(db, user_id, batch_id) -> int` — deletes every transaction tied to a
  batch and the batch itself, atomically, and raises `PermissionError` if the batch
  belongs to another user (`LookupError` if it doesn't exist at all).

Two dataclasses, `PreviewRow` and `ImportPreview`, carry the preview result exactly as
specified in the interface.

Created `backend/tests/test_import_service.py` with the 11 tests specified in the brief,
copied verbatim.

## Test commands and output

Step 2 (confirm failing before implementation):
```
cd backend && .venv/Scripts/python.exe -m pytest tests/test_import_service.py -v
```
Result: collection error — `ModuleNotFoundError: No module named 'app.importers.service'`
(1 error, 0 collected), as expected.

Step 4 (after implementation):
```
cd backend && .venv/Scripts/python.exe -m pytest tests/test_import_service.py -v
```
Result: `11 passed, 1 warning in 0.52s` — all 11 tests pass, including with the
categorization-priority fix described below (first run with the brief's literal
`_load_categorizer` code, before the fix, failed
`test_preview_categorizes_using_the_rule_library` — see Deviation).

Full backend suite:
```
cd backend && .venv/Scripts/python.exe -m pytest
```
Result: `130 passed, 26 warnings in 4.33s` — no regressions.

Lint:
```
cd backend && .venv/Scripts/python.exe -m ruff check app/importers/service.py tests/test_import_service.py
```
Result: one `I001` (import block un-sorted) on the first pass — `compile_rules, classify`
was not alphabetical. Fixed to `classify, compile_rules`. Second run: `All checks passed!`

## Deviation from the brief

The brief's Step 3 code for `_load_categorizer` builds `by_name` from **every** category
(`{c.name.casefold(): c for c in categories.values()}`), which is used by
`_resolve_category` to let a CSV `category` column win over the rule engine. I
implemented that literally first and it broke
`test_preview_categorizes_using_the_rule_library`.

Root cause: `boursorama.csv`'s `category` column holds coarse bank-side labels —
"Alimentation", "Revenus", "Loisirs", "Transport" — which are exactly the *names of
Yieldo's top-level (parent) categories*. With the literal brief code, "Alimentation"
matches the parent category by name and wins with `category_source="csv"`. But the test
expects row 1 (`CARREFOUR MARKET...`) to land on the **child** category
`alimentation-courses` with `category_source == "builtin"` (i.e., the rule engine's
pick) — and row 3 (`PRLV NETFLIX.COM`, CSV hint "Loisirs") is expected to land on
`abonnements-streaming`, a category under a completely different top-level branch
("Abonnements", not "Loisirs"). A parent-name CSV hint can never legitimately produce
that result under the brief's literal priority rule.

Fix: in `_load_categorizer`, I exclude from `by_name` any category that has children
(computed as `{c.parent_id for c in all_categories if c.parent_id is not None}`,
i.e. any category acting purely as an organizational bucket). The reasoning: a
transaction should only ever be filed under a leaf category — a parent like
"Alimentation" exists to group `alimentation-courses`, `alimentation-restaurant`, etc.,
not to be assigned directly. This keeps the CSV-hint-first design intent intact (it
still wins when a bank genuinely exports a name matching one of the user's specific
leaf categories) while preventing coarse bucket names from outranking the much more
precise rule library. `categories["divers"]` and `categories["virement-interne"]` (leaf
top-level categories with no children) remain valid CSV-hint targets under this rule.

All other brief pseudocode (summary math, dedup/fingerprint suffixing, atomic commit,
rollback authorization) was implemented as given and required no changes.

One additional fix on top of the brief's snippet: `from app.categorization.engine import
compile_rules, classify` had to be reordered to `classify, compile_rules` to satisfy
ruff's `I001` (import sort) rule already enforced on this repo.

## Notes for later tasks

- `_resolve_category`'s CSV-hint matching now only considers **leaf** categories (no
  children). If Task 12 (API layer) or later tasks expose category mapping/override UI,
  keep this in mind: a CSV category value that happens to match a top-level bucket name
  will *not* auto-assign that bucket — it silently falls through to the rule engine (or
  `uncategorized`). This is intentional and covered by the passing test suite, not an
  oversight.
- `MappingError` (a `ValueError` subclass) is raised by `commit_import` when
  `validate_mapping` reports errors; `build_preview` instead reports mapping errors
  softly via `summary["mapping_errors"]` and does not raise, so it never fails on a bad
  mapping — it just reports zero importable rows. No test in this task exercises the
  `commit_import` `MappingError` path directly since the brief's test list didn't
  include one, but the code path exists and both branches are exercised implicitly by
  the "no mapping/dialect provided" default-inference path in `build_preview` tests.
- `rollback_import` raises `LookupError` for a missing batch and `PermissionError` for a
  batch owned by another user — the brief only asked for the `PermissionError` case (and
  that's the one tested), but `LookupError` was added defensively per the "no silent
  failures" constraint. The brief note says the API layer (Task 12) should convert
  `PermissionError` into an HTTP 404 to avoid disclosing batch existence to a
  non-owner — worth also mapping `LookupError` to 404 there, since both should look
  identical from the outside.
- Duplicate rows forced through via `keep_duplicates` get a fingerprint suffixed
  `"<sha256 hex>:<row_number>"`. This exceeds `Transaction.dedup_hash`'s declared
  `String(64)` column width by design (SQLite does not enforce `VARCHAR` length, and
  this app runs on SQLite in both tests and production per the project brief). If a
  future task moves any part of this database to a length-enforcing engine, this column
  width will need revisiting.
- Staged for commit: only `backend/app/importers/service.py` and
  `backend/tests/test_import_service.py`. The working tree also has an unrelated,
  pre-existing modification to `docs/superpowers/plans/2026-08-09-yieldo-phase-1-socle.md`
  from the coordinating session, which was left untouched and unstaged.
