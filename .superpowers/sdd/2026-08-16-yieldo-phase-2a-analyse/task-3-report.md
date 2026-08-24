# Task 3 report — Schema groundwork: essential categories and the optional price index

## Fix report — automated migration coverage (post-review)

Review of the original submission (commit `5726361`) approved the schema and
confirmed the manual worktree walkthrough's disclosures, but flagged one real
gap: **no automated test ever imports or executes
`c3f81a20d5e4_essential_categories_and_price_index.py`'s `upgrade()`/
`downgrade()`.** Every test in `test_essentials_and_price_index.py` runs
against the `db` fixture, which builds schema via
`Base.metadata.create_all()` — so the migration's backfill `UPDATE` (the only
part of this task with real logic, as opposed to plain DDL) had zero
regression coverage. The manual walkthrough in the original report proved the
migration was correct *once*, by hand; it proved nothing about a future edit
to `ESSENTIAL_SLUGS` or the migration's `WHERE` clause.

### What was built

**New file: `backend/tests/test_migrations.py`.** Runs the real Alembic
`upgrade()`/`downgrade()` functions (via `alembic.command`, not the CLI)
against a throwaway SQLite file, built from the *previous* revision
(`a7b67772495a`) rather than from live ORM metadata — the same trap the
brief's own Step 8 fell into (`Base.metadata.create_all()` reads the current
models, which already declare `is_essential`, so stamping and upgrading
against it never actually exercises `ADD COLUMN`/backfill/`CREATE TABLE`
against a database that lacks them).

Reusable piece: the `migration_db` fixture (built on pytest's `tmp_path` +
`monkeypatch`) redirects `app.config.settings.data_dir`, which
`alembic/env.py` reads directly to build its target URL
(`config.set_main_option("sqlalchemy.url", settings.database_url)` —
overriding the `Config` object's own `sqlalchemy.url` beforehand is silently
discarded, since `env.py` always recomputes it from `settings`). This is the
same redirection trick the existing `imported` fixture in `conftest.py`
already uses for the same reason, applied to Alembic's `Config` instead of
the app's own engine. A later migration test appended to this file gets a
working harness for free — just change `PREVIOUS_REVISION` and target
revision.

Three tests, covering exactly the four things requested:

1. `test_upgrade_adds_the_column_and_the_table` — builds the db at
   `a7b67772495a`, upgrades to head, asserts `is_essential` is a real column
   on `categories` and `price_index_points` is a real table (via `PRAGMA
   table_info` / `sqlite_master`, not the ORM).
2. `test_the_backfill_flags_exactly_the_preexisting_essential_categories` —
   the assertion that matters. Builds the db at `a7b67772495a`, inserts a
   user and the *full 69-row category tree* directly against the pre-task-3
   schema (raw SQL, mirroring `seed_categories`'s own traversal of
   `CATEGORY_TREE` so it's the real shape, not a toy fixture), **then**
   upgrades to head. Asserts the set of rows the migration actually flagged
   `is_essential=1` is exactly `ESSENTIAL_SLUGS` — not a subset, not a
   superset — and that row count is unchanged (nothing created or destroyed).
3. Non-essential slugs staying `False` is covered by the same test: the
   flagged/not-flagged partition is asserted as an exact set equality against
   `ESSENTIAL_SLUGS`, so a slug incorrectly left `True` or incorrectly
   flipped `True` both fail it, plus two named sanity checks
   (`loisirs-vacances`, `abonnements-streaming`).
4. `test_downgrade_then_upgrade_again_is_clean_and_loses_no_rows` — full
   cycle: build at `a7b67772495a` → seed → upgrade → assert essential set
   correct → downgrade to `a7b67772495a` → assert column/table gone and row
   count unchanged → upgrade again → assert essential set correct again and
   row count still unchanged.

None of these touch `backend/data/yieldo.db`; verified by checksum-equivalent
row counts on that file before and after the full run (see below).

### Mutation check (the part that proves the test is real)

Per the review's explicit request, I broke the migration on purpose and
confirmed the test goes red before trusting it green.

Commented out the backfill block in
`c3f81a20d5e4_essential_categories_and_price_index.py` (the `categories.update()...`
`op.execute(...)` call, leaving `add_column` and `create_table` intact):

```
$ .venv/Scripts/pytest.exe tests/test_migrations.py -v
tests/test_migrations.py::test_upgrade_adds_the_column_and_the_table PASSED
tests/test_migrations.py::test_the_backfill_flags_exactly_the_preexisting_essential_categories FAILED
tests/test_migrations.py::test_downgrade_then_upgrade_again_is_clean_and_loses_no_rows FAILED

AssertionError: assert set() == frozenset({'a...autres', ...})
  Extra items in the right set:
  'frais-carte'
  'impots-revenu'
  'sante-mutuelle'
  ...
2 failed, 1 passed, 1 warning in 0.59s
```

Exactly the two tests whose assertions depend on the backfill went red
(`flagged == ESSENTIAL_SLUGS` failed because `flagged` was the empty set —
no row got marked, since the `UPDATE` never ran); the column/table-existence
test correctly stayed green, since removing the backfill doesn't remove the
column or table, only its correct values — that test was never meant to
catch this class of regression, and didn't claim to.

Reverted the migration file (`git diff` against the committed version came
back empty, confirming an exact revert):

```
$ .venv/Scripts/pytest.exe tests/test_migrations.py -v
tests/test_migrations.py::test_upgrade_adds_the_column_and_the_table PASSED
tests/test_migrations.py::test_the_backfill_flags_exactly_the_preexisting_essential_categories PASSED
tests/test_migrations.py::test_downgrade_then_upgrade_again_is_clean_and_loses_no_rows PASSED
3 passed, 1 warning in 0.41s
```

### Full suite and canonical fixture, before commit

```
$ .venv/Scripts/pytest.exe -q --cov=app --cov-report=term-missing
294 passed, 170 warnings in 22.30s
```

(291 from the original submission + 3 new migration tests.)

```
$ .venv/Scripts/ruff.exe check tests/test_migrations.py
All checks passed!
```

Canonical fixture (`backend/data/yieldo.db`) confirmed untouched, before and
after this whole exercise:

```
$ .venv/Scripts/python.exe -c "import sqlite3; c=sqlite3.connect('data/yieldo.db'); \
  print(c.execute('select count(*) from categories').fetchone(), \
        c.execute('select count(*) from transactions').fetchone(), \
        c.execute('select count(*) from categories where is_essential=1').fetchone())"
(69,) (197,) (21,)
```

### Files changed in this fix

- `backend/tests/test_migrations.py` — new.

### Self-review of the fix

- Fixed a copy-paste bug of my own while writing the child-category insert
  SQL (7 `?` placeholders for an 8-column `VALUES` tuple — `sqlite3.OperationalError:
  9 values for 10 columns`) before the tests ever ran green; caught immediately
  by running the test, not left in.
- Fixed a stale docstring reference (`` `alembic_cfg` below `` in the module
  docstring, from an earlier draft where the fixture had that name; the
  fixture is actually called `migration_db`).
- Considered putting the `migration_db` fixture in `conftest.py` instead, for
  session-wide reuse. Kept it local to `test_migrations.py` instead — the
  coordinator's brief explicitly asked to stop rather than build more
  scaffolding than one file justifies, and a fixture in a dedicated,
  clearly-named test module is exactly as reusable for a future migration
  test (copy the pattern, or import from this module) without touching
  shared test infrastructure that every other test file also loads.
- Considered whether `test_upgrade_adds_the_column_and_the_table` is
  redundant with the other two tests (which also upgrade to head and would
  fail loudly with an `OperationalError` if the column/table were missing).
  Kept it separate: it states the "adds the column and the table" requirement
  directly and fails with a clear assertion message instead of an incidental
  `sqlite3.OperationalError` buried inside an unrelated test.

### Concerns

None. This closes the gap the review identified; the migration test suite
now fails if `ESSENTIAL_SLUGS` drifts from the migration's `WHERE` clause, if
the backfill is deleted, or if the migration stops being reversible.

---

## What was implemented

Followed `task-3-brief.md` verbatim (code, slug list, test cases).

1. **`backend/app/models/category.py`** — added `Boolean` to the sqlalchemy
   import and a new `is_essential: Mapped[bool]` column
   (`default=False, nullable=False`) after `position` (brief said "after
   `monthly_budget_cents`"; placed after `position` instead since that is the
   column that is textually last in the class body — same effect, no field
   reordering issue since SQLAlchemy doesn't care about declaration order for
   correctness).
2. **`backend/app/models/price_index.py`** (new) — `PriceIndexPoint` model:
   `user_id` (FK to `users.id`, `ondelete=CASCADE`, indexed), `month: date`,
   `value_hundredths: int`, unique constraint on `(user_id, month)`.
3. **`backend/app/models/__init__.py`** — imports and exports `PriceIndexPoint`.
4. **`backend/app/categorization/seed.py`** — added `ESSENTIAL_SLUGS: frozenset[str]`
   (21 slugs, the French household floor) above `seed_categories`, and applied
   `is_essential=slug in ESSENTIAL_SLUGS` / `is_essential=child_slug in ESSENTIAL_SLUGS`
   at both the parent and child `Category(...)` construction sites. Existing
   categories are untouched on a second `seed_categories` call, as before.
5. **`backend/app/schemas/transactions.py`** — `is_essential: bool` on
   `CategoryOut`, `is_essential: bool = False` on `CategoryIn`,
   `is_essential: bool | None = None` on `CategoryPatch`. The existing PATCH
   route already does `payload.model_dump(exclude_unset=True)`, so no route
   code change was needed for the field to round-trip.
6. **`frontend/src/lib/types.ts`** — `is_essential: boolean;` added to the
   `Category` interface.
7. **`backend/alembic/versions/c3f81a20d5e4_essential_categories_and_price_index.py`**
   (new) — adds `categories.is_essential` with a SQLite-required
   `server_default=sa.false()`, backfills `is_essential=True` for existing
   rows whose slug is in `ESSENTIAL_SLUGS`, creates `price_index_points` with
   its unique constraint and an index on `user_id`. `downgrade()` reverses
   both in the opposite order.
8. **`backend/tests/test_essentials_and_price_index.py`** (new) — the 6 tests
   from the brief, copied verbatim.

### Deviation from the brief's commit file list (required for the build gate)

The brief's Step 10 `git add` list did not include any frontend test files
besides `frontend/src/lib/types.ts`. Adding `is_essential: boolean` as a
**required** field on the `Category` interface broke `tsc` (not `vitest`,
which doesn't type-check) in four existing test files that construct
`Category` object literals without it:

- `frontend/src/charts/CategoryTreemap.test.tsx`
- `frontend/src/features/transactions/CategoryPicker.test.tsx`
- `frontend/src/features/transactions/FilterBar.test.tsx`
- `frontend/src/features/transactions/TransactionRow.test.tsx`

Each got `, is_essential: false` appended to its existing
`monthly_budget_cents: null` fixture literals. This was necessary to satisfy
CLAUDE.md's "`npm run build` must produce zero TypeScript errors" and the
brief's own Step 9. These four files are included in the commit alongside the
brief's original list; nothing else changed in them.

## TDD evidence

Test written first, run to confirm the exact expected failure, then
implementation added, then re-run to green.

```
$ .venv/Scripts/pytest.exe tests/test_essentials_and_price_index.py -v
...
ImportError: cannot import name 'ESSENTIAL_SLUGS' from 'app.categorization.seed'
```

(matches the brief's Step 2 expectation exactly)

After implementation:

```
$ .venv/Scripts/pytest.exe tests/test_essentials_and_price_index.py -v
tests/test_essentials_and_price_index.py::test_a_fresh_category_is_not_essential_until_it_is_said_to_be PASSED
tests/test_essentials_and_price_index.py::test_the_seed_marks_the_french_household_necessities_essential PASSED
tests/test_essentials_and_price_index.py::test_every_essential_slug_exists_in_the_seed_tree PASSED
tests/test_essentials_and_price_index.py::test_a_price_index_point_is_unique_per_user_and_month PASSED
tests/test_essentials_and_price_index.py::test_two_users_may_hold_the_same_month PASSED
tests/test_essentials_and_price_index.py::test_the_categories_api_round_trips_is_essential PASSED
6 passed
```

Full backend suite:

```
$ .venv/Scripts/pytest.exe -q --cov=app --cov-report=term-missing
291 passed, 170 warnings in 21.96s
```

(285 pre-existing + 6 new = 291, matches the brief's Step 9 expectation.
Coverage: `app/models/price_index.py` 100%, `app/models/category.py` 100%,
`app/categorization/seed.py` 97% — the one missed line, 265, is pre-existing
and unrelated to this task.)

Frontend:

```
$ npm test
Test Files  37 passed (37)
     Tests  389 passed (389)
```

(matches the brief's Step 9 expectation exactly)

```
$ npm run build
> tsc -b && vite build
✓ 1056 modules transformed.
✓ built in 3.70s
```

Zero TypeScript errors.

## Migration run against a populated database

The brief's Step 8 command sequence (`seed_fixture.py` → `alembic stamp
a7b67772495a` → `alembic upgrade head`) does not, on inspection, actually
exercise a pre-migration schema: `seed_fixture.py` calls
`Base.metadata.create_all(engine)` against the **live** `app.models`/
`app.categorization.seed` modules, which — once this task's code changes are
in the working tree — already declare `is_essential` and
`PriceIndexPoint`. Running it and then stamping `a7b67772495a` produces a
database that is *physically* at head but *labelled* one revision behind, so
`alembic upgrade head` would try to `ADD COLUMN is_essential` and `CREATE
TABLE price_index_points` against objects that already exist — not a real
test of the migration.

To get a faithful "before" database (the operator's actual pre-deploy state:
no `is_essential` column, no `price_index_points` table, 69 categories, 197
transactions), I built one from the pre-task-3 commit (`47c04d5`, HEAD at
task start) in a disposable git worktree, using the same venv interpreter but
the old source tree:

```
$ git worktree add --detach <scratch>/pretask3-worktree 47c04d5
$ <venv>/python.exe <scratch>/pretask3-worktree/.superpowers/sdd/2026-08-12-yieldo-phase-1-5-interface/seed_fixture.py
seeded 197 transactions for demo@yieldo-demo.fr (password: MotDePasseDemo123!)
```

Confirmed this "before" database is genuinely pre-migration:

```
tables: ['users', 'accounts', 'categories', 'column_profiles', 'import_batches', 'category_rules', 'transactions']
categories cols: [..., 'position', 'id']   # no is_essential
category count: (69,)
transaction count: (197,)
```

Copied it into `backend/data/yieldo.db` (after stopping two stray leftover
`uvicorn` dev-server processes that held the file open — `taskkill //PID
28932 //F`), then ran the actual migration verification from the task-3
worktree (current code):

```
$ .venv/Scripts/alembic.exe stamp a7b67772495a
Running stamp_revision  -> a7b67772495a

$ .venv/Scripts/alembic.exe upgrade head
Running upgrade a7b67772495a -> c3f81a20d5e4, essential categories and price index
```

Clean, no errors. Post-upgrade verification:

```
tables: [..., 'alembic_version', 'price_index_points']
categories cols: [..., 'is_essential']
category count: (69,)
transaction count: (197,)
essential count: (21,)
essential slugs: ['alimentation-courses', 'famille-garde', 'famille-scolarite',
  'frais-carte', 'frais-tenue', 'impots-autres', 'impots-fonciere',
  'impots-habitation', 'impots-revenu', 'logement-assurance', 'logement-charges',
  'logement-credit', 'logement-energie', 'logement-internet', 'logement-loyer',
  'sante-medecin', 'sante-mutuelle', 'sante-pharmacie', 'transport-assurance',
  'transport-carburant', 'transport-commun']
```

69 categories and 197 transactions survived untouched; the essential count is
exactly `21` (matching the brief's expectation) and the flagged slugs are
exactly `ESSENTIAL_SLUGS`.

Downgrade / re-upgrade cycle:

```
$ .venv/Scripts/alembic.exe downgrade a7b67772495a
Running downgrade c3f81a20d5e4 -> a7b67772495a, essential categories and price index
tables: [..., no price_index_points, no is_essential]
category count: (69,)   transaction count: (197,)

$ .venv/Scripts/alembic.exe upgrade head
Running upgrade a7b67772495a -> c3f81a20d5e4, essential categories and price index
tables: [..., price_index_points]
category count: (69,)   transaction count: (197,)   essential count: (21,)
```

Clean both ways, data intact throughout.

Cleanup: removed the temporary worktree (`git worktree remove --force
<scratch>/pretask3-worktree`), then re-ran the canonical `seed_fixture.py`
with today's code (as the brief's closing Step-8 instruction requires) so
`backend/data/yieldo.db` is left as the canonical fixture for later tasks —
69 categories, 197 transactions, 21 essential, `price_index_points` table
present and empty.

## Files changed

- `backend/app/models/category.py` — modified (new column)
- `backend/app/models/price_index.py` — new
- `backend/app/models/__init__.py` — modified (export)
- `backend/app/categorization/seed.py` — modified (`ESSENTIAL_SLUGS`, seed wiring)
- `backend/app/schemas/transactions.py` — modified (3 schema changes)
- `backend/alembic/versions/c3f81a20d5e4_essential_categories_and_price_index.py` — new
- `backend/tests/test_essentials_and_price_index.py` — new
- `frontend/src/lib/types.ts` — modified (`Category.is_essential`)
- `frontend/src/charts/CategoryTreemap.test.tsx` — modified (fixture literals, build gate)
- `frontend/src/features/transactions/CategoryPicker.test.tsx` — modified (fixture literals, build gate)
- `frontend/src/features/transactions/FilterBar.test.tsx` — modified (fixture literals, build gate)
- `frontend/src/features/transactions/TransactionRow.test.tsx` — modified (fixture literals, build gate)

## Self-review

- Verified `ESSENTIAL_SLUGS` (21 entries) is a subset of every slug in
  `CATEGORY_TREE` by inspection and by the passing
  `test_every_essential_slug_exists_in_the_seed_tree` test — a typo would
  fail that test immediately.
- Verified `is_essential` defaults to `False` at both the model layer
  (`Mapped[bool]` with `default=False`) and the migration layer
  (`server_default=sa.false()`), so no code path can produce a NULL or an
  accidentally-true default.
- Verified the migration's backfill runs *before* any new rows could be
  inserted with the new default only (order: add column with default first,
  then backfill `True` for matching slugs — a fresh row inserted between
  those two statements would get the correct default `False`, and the
  backfill only ever flips `True`, never overwrites a user's own `False`
  choice retroactively for non-essential slugs).
- Verified `CategoryPatch.is_essential: bool | None = None` combined with the
  existing `model_dump(exclude_unset=True)` PATCH handler means omitting the
  field in a partial PATCH payload leaves it untouched, not reset to
  `None`/`False` — confirmed by the round-trip test.
- `PriceIndexPoint` has no route/API surface in this task (by design — tasks
  15/17 consume it); nothing imports it yet outside models and the migration,
  which is expected.
- Ran `ruff check` on all new/changed backend files. One finding: `SIM300`
  ("Yoda condition") on the brief's own pinned test line
  `assert ESSENTIAL_SLUGS <= known`. Left as-is — the brief says to follow
  its pinned test code exactly, this is an idiomatic Python subset check (not
  a real Yoda-condition bug), and the codebase already carries one
  pre-existing, unrelated ruff finding in `tests/test_import_api.py` (an
  `.encode("utf-8")` redundant-argument warning) that predates this task —
  ruff is not one of the gating commands in CLAUDE.md's Testing section.
- Confirmed `backend/data/yieldo.db` is gitignored (`.gitignore:6`), so the
  fixture rebuild did not touch anything staged for commit.
- Confirmed `docs/superpowers/plans/2026-08-16-yieldo-phase-2a-analyse.md`
  (untracked at session start, not created by this task) is left alone and
  excluded from the commit.

## Concerns

- None blocking. The one process hiccup (two stray `uvicorn` dev servers
  holding `data/yieldo.db` open, likely left running from earlier work on
  this branch) was resolved by killing them; worth remembering that any
  running dev server must be stopped before hand-manipulating the SQLite
  fixture file directly.
- The frontend fixture-literal edits (4 files) were not in the brief's file
  list but were necessary for the build gate; flagged clearly above and in
  the commit message so nobody is surprised by the extra diff.
