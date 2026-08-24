# Task 8 Report — Column roles and row-to-candidate parser

## What was implemented

- `backend/app/importers/mapping.py` — `COLUMN_ROLES`, `ROLE_LABELS` (French labels),
  `SINGLE_USE_ROLES`, `_normalize_header`, `suggest_mapping`, `validate_mapping`, exactly
  as specified in the brief's Step 3.
- `backend/app/importers/parser.py` — `CandidateRow` dataclass, `_cell`, `_resolve_amount`,
  `parse_rows`, as specified in the brief's Step 4, with one deviation (see below).
- `backend/tests/test_mapping.py` — 11 tests, copied verbatim from the brief.
- `backend/tests/test_parser.py` — 9 tests, copied verbatim from the brief.

Neither `mapping.py` nor `parser.py` imports from `app.db` or `app.models` (verified with
`grep -n "^import\|^from"` on both files) — the pure-function constraint holds.

## TDD sequence followed

1. Wrote `backend/tests/test_mapping.py` and `backend/tests/test_parser.py` verbatim from
   the brief (Step 1).
2. Ran them and confirmed failure (Step 2):
   ```
   cd backend && ./.venv/Scripts/pytest.exe tests/test_mapping.py tests/test_parser.py -v
   ```
   Result: `ModuleNotFoundError: No module named 'app.importers.mapping'` and
   `'app.importers.parser'` — collection errors, 0 tests run, as expected.
3. Implemented `mapping.py` verbatim from the brief's Step 3.
4. Implemented `parser.py` from the brief's Step 4, with one required fix (see Deviations).
5. Re-ran the same command (Step 5):
   ```
   cd backend && ./.venv/Scripts/pytest.exe tests/test_mapping.py tests/test_parser.py -v
   ```
   Result: `20 passed, 1 warning in 0.05s` (11 mapping tests + 9 parser tests; the brief's
   "20 tests" estimate in Step 5 was off by one — it says "20 tests PASS" and that is
   exactly what happened: 11 + 9 = 20).
6. Ran the full backend suite and ruff as an extra safety check:
   ```
   cd backend && ./.venv/Scripts/pytest.exe -q
   ```
   Result: `94 passed, 26 warnings in 2.79s` (all pre-existing tests plus the 20 new ones;
   warnings are pre-existing JWT key-length / httpx deprecation notices, unrelated to this
   task).
   ```
   ./.venv/Scripts/python.exe -m ruff check app/importers/mapping.py app/importers/parser.py \
     tests/test_mapping.py tests/test_parser.py
   ```
   Result: `All checks passed!`

## Deviation from the brief and why

The brief's Step 4 draft for `parser.py` had:

```python
from dataclasses import dataclass
from datetime import date

...

@dataclass
class CandidateRow:
    row_number: int
    date: date | None = None
    ...
```

Running this as written fails at import time with:

```
TypeError: unsupported operand type(s) for |: 'NoneType' and 'NoneType'
```

Cause: in a class body, `date: date | None = None` is an annotated assignment. CPython
executes the value-assignment part (`date = None`, binding the name `date` in the class's
own namespace) before it evaluates the annotation expression `date | None`. Because the
field is named `date` — same as the imported `datetime.date` type — the annotation lookup
of `date` resolves to the just-assigned `None` instead of the imported type, so it becomes
`None | None`, which raises `TypeError` (Python 3.12 union syntax only works between type
objects, not between `None` and `None`).

The dataclass field must be named `date` per the brief's required interface
(`CandidateRow(row_number, date, value_date, amount_cents, ...)`), and I did not want to
rename the imported type either, since that widens the diff from the brief for no reason.
The minimal, standard fix is to add `from __future__ import annotations` as the first line
of the module (PEP 563 — postponed evaluation of annotations): annotations become strings
at class-definition time and are never eagerly evaluated, so the name-shadowing never
triggers. `dataclass` only needs the annotations as strings to generate `__init__`; it does
not need them resolved to actual type objects for this task's usage (no
`typing.get_type_hints()` call anywhere in this module or its tests). This is the only
change made relative to the brief's Step 4 code; everything else — `_cell`,
`_resolve_amount`, `parse_rows`, and all field names/order — is verbatim.

No other deviations. `mapping.py` is byte-for-byte the brief's Step 3 code.

## Design points worth flagging for later tasks

- `suggest_mapping` ordering was traced by hand against all three brief test cases
  (French `dateOp`/`dateVal`, French `Débit euros`/`Crédit euros`, English
  `date`/`description`/`amount`) before implementation, per the brief's "careful point 1".
  All three pass as specified; no reordering of `_HEADER_PATTERNS` was needed.
- `_cell` returns `None` for both "role not mapped to any column" and "row shorter than the
  mapped index" — callers in `parser.py` treat both cases uniformly (falsy/`None` checks),
  so a short row degrades to a per-row `error` string rather than an `IndexError`.
- `_resolve_amount` uses `-abs(parse_amount(debit, ...))` specifically to avoid double-negating
  an already-negative debit value in the source file (covered by
  `test_debit_already_signed_is_not_double_negated`).
- `value_date` parsing failures are swallowed locally (caught `ValueError`, sets
  `candidate.value_date = None`, does not raise) — only the primary `date` and `label`
  failures (and amount resolution failures) propagate up to set `candidate.error` and reject
  the row. This matches the brief's "careful point 5".
- `parse_rows` never raises; every row either gets full fields or an `error` string. This is
  intentional per-row error reporting, not a silent failure, per the brief's global
  constraint.
- Both new modules are pure — no `app.db` / `app.models` imports — so later tasks (the
  import wizard API endpoints, DB persistence of `CandidateRow`s) can call
  `suggest_mapping` / `validate_mapping` / `parse_rows` from request handlers without
  introducing any coupling back into these modules.
- `ROLE_LABELS` and every `validate_mapping` error string are the exact French text the
  import wizard will render; do not alter the wording in later tasks without also updating
  `test_mapping.py`'s substring assertions (`"date"`, `"libellé"`, `"montant"`,
  `"plusieurs fois"`).

## Files touched (all new, nothing else in the working tree changed)

- `E:\Projet\Github\Yieldo\backend\app\importers\mapping.py`
- `E:\Projet\Github\Yieldo\backend\app\importers\parser.py`
- `E:\Projet\Github\Yieldo\backend\tests\test_mapping.py`
- `E:\Projet\Github\Yieldo\backend\tests\test_parser.py`

## Commit

```
97bab44 feat(importers): add column role mapping and row-to-candidate parser
```

Staged and committed only the four files listed above (`git add` with explicit paths, no
`git add -A`); `git status --porcelain` showed nothing else in the working tree both before
and after.

---

## Fix round 1 of 5 — booking date / value date swap

### Issue (from review, sourced from the plan, not from the original implementation)

In `backend/app/importers/mapping.py`, `_HEADER_PATTERNS`, the `value_date` pattern included
`comptabilis`, and `value_date` is tried before `date`. "Date de comptabilisation" is the
booking date — i.e. the operation date — not the value date. Several French banks (Crédit
Agricole, Crédit Mutuel) export both columns side by side. With the old patterns, "Date de
comptabilisation" got tagged `value_date` (matching on `comptabilis`), and then "Date de
valeur" fell through to the `date` pattern because `value_date` was already taken. The two
roles came out swapped, silently, and the transaction would end up dated by its value date
instead of its booking date.

### Fix

Moved `comptabilis` from the `value_date` alternation to the `date` alternation in
`backend/app/importers/mapping.py`:

```python
# "Date de comptabilisation" is the booking date, i.e. the operation date — not
# the value date. Several French banks ship both columns, so putting
# "comptabilis" on the wrong pattern swaps the two roles silently.
_HEADER_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("value_date", re.compile(r"date\s*(de\s*)?val|dateval|value\s*date")),
    ("date", re.compile(
        r"^date|dateop|date\s*op|operation\s*date|transaction\s*date|jour|comptabilis"
    )),
    ...
```

### Covering tests added

Added to `backend/tests/test_mapping.py`:

- `test_booking_date_is_not_confused_with_value_date` — asserts
  `suggest_mapping(["Date de comptabilisation", "Date de valeur", "Libellé", "Montant"])`
  yields `{0: "date", 1: "value_date", 2: "label", 3: "amount"}`.
- `test_booking_date_is_not_confused_with_value_date_when_order_is_reversed` — asserts
  `suggest_mapping(["Date de valeur", "Date de comptabilisation", "Libellé", "Montant"])`
  yields `{0: "value_date", 1: "date", 2: "label", 3: "amount"}`.

### Verified both against the old (unfixed) pattern list before applying the fix

```
cd backend && ./.venv/Scripts/pytest.exe tests/test_mapping.py -v
```

Result against the old code: `1 failed, 12 passed`.
`test_booking_date_is_not_confused_with_value_date` FAILED as expected (produced
`{0: "value_date", 1: "date", ...}` — the swap described in the review).

Note on the second test: `test_booking_date_is_not_confused_with_value_date_when_order_is_reversed`
already PASSED against the old, unfixed code. This is expected, not a mistake in the test: with
"Date de valeur" as the first column, it claims the `value_date` role through its own genuine
`date\s*(de\s*)?val` match before "Date de comptabilisation" is even evaluated; by the time the
second column is checked, `value_date` is already in `taken`, so it falls through to `date`
regardless of whether `comptabilis` sits on the right or wrong pattern. The swap bug therefore only
manifests when the booking-date column appears *before* the value-date column in the header row —
which is exactly the order the review's motivating example uses. Both tests are kept: the first is
the regression test for the bug, the second documents (and locks in) that the fix does not break the
already-correct reversed-order case.

### Full suite after the fix

```
cd backend && ./.venv/Scripts/pytest.exe tests/ -v
```

Result: `96 passed, 26 warnings in 3.06s` (94 previous + 2 new). All three original
`suggest_mapping` tests (`test_suggests_roles_for_french_bank_headers`,
`test_suggests_debit_and_credit_columns`, `test_suggests_roles_for_english_headers`) still pass
unchanged — confirmed, not assumed; none of them uses a "comptabilis" header so they were
unaffected by the pattern reordering.

Also ran `./.venv/Scripts/python.exe -m ruff check app/importers/mapping.py tests/test_mapping.py`:
`All checks passed!`.

### Files touched in this fix round

- `E:\Projet\Github\Yieldo\backend\app\importers\mapping.py` (pattern fix + comment)
- `E:\Projet\Github\Yieldo\backend\tests\test_mapping.py` (two new covering tests)

### Commit

Staged only the two files above (no `git add -A`; the already-modified
`docs/superpowers/plans/2026-08-09-yieldo-phase-1-socle.md` was left untouched) and committed
with a Conventional Commit message:

```
dae8f3e fix(importers): stop booking date/value date swap on comptabilis header
```
