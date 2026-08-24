# Task 14 report — API transactions, catégories et analytics

## Status: DONE

Commits:
- `df8b541` — `feat(api): add transaction, category, and analytics endpoints`
- `0bbad53` — `fix(api): uncategorize children's transactions when a parent category is deleted`
  (fix round 1 of 5, see "Fix round 1" section at the end of this report)
(single commit, staged explicitly file-by-file, not `git add -A`)

## What was implemented

Files created:
- `backend/app/schemas/transactions.py` — `TransactionOut`, `TransactionPage`,
  `TransactionPatch`, `TransactionPatchOut`, `CategoryOut`, `CategoryIn`, `CategoryPatch`
  (as given in the brief, verbatim).
- `backend/app/schemas/analytics.py` — `SeriesBucketOut`, `CategoryBreakdownOut`,
  `ComparisonOut`, `PeriodTotalsOut`, `SummaryOut`, `CalendarPointOut`. The brief's
  `Files` list names this module but its Step 6 reference code returns bare
  `list[dict]`/`dict`. I built real Pydantic response models instead (deviation,
  see below) so the analytics router is consistent with every other router in the
  codebase (`response_model=...`, typed OpenAPI schema).
- `backend/app/api/transactions.py` — `GET /api/transactions` (filters: `date_from`,
  `date_to`, `category_id`, `account_id`, `search`, `uncategorized_only`, `min_cents`,
  `max_cents`; pagination `limit`/`offset`, `limit` capped at 500 via
  `Query(le=500)` → 422 on overflow, not silent clamping), `PATCH
  /api/transactions/{id}`, `DELETE /api/transactions/{id}`.
- `backend/app/api/categories.py` — `GET/POST/PATCH/DELETE /api/categories[/{id}]`.
- `backend/app/api/analytics.py` — `GET /api/analytics/series`,
  `/categories`, `/summary`, `/calendar`.
- `backend/tests/test_transactions_api.py`, `backend/tests/test_analytics_api.py` —
  brief's tests verbatim, plus extra coverage (see deviations).
- `backend/tests/test_categories_api.py` — new file, not requested by the brief's
  file list, added for coverage of POST/PATCH/DELETE (see deviations).

Files modified:
- `backend/app/main.py` — added imports and `api.include_router(...)` for
  transactions, categories, analytics, all *before* `app.include_router(api)`.
- `backend/tests/conftest.py` — added the `imported` fixture (see deviation below)
  and a `FIXTURES` path constant.

All business-table queries filter on `user_id` (`Transaction`, `Category`
listing/patch/delete, the `_owned_transaction`/`_owned_category` helpers, the
analytics `_points`/`categories_breakdown` queries). `PATCH
/api/transactions/{id}` verifies a supplied `category_id` belongs to the caller
before assigning it — a foreign category is a 404, matching the pattern already
used for foreign accounts/import batches (never 403, existence not disclosed).

`savings_rate` is computed as `net_cents / inflow_cents` only when
`inflow_cents > 0`, else `None` (`PeriodTotalsOut.savings_rate: float | None`) —
never coerced to `0`.

## Deviation 1 — the `imported` fixture did not already exist

I was told "The `imported` fixture already exists in
`backend/tests/conftest.py`... do not duplicate it, just use it as a fixture
argument." This was incorrect: I read `conftest.py` before writing anything and
it had no such fixture (confirmed with `grep -r "def imported" backend/` —
zero matches anywhere in the repo). I added it myself, following the exact
shape from the brief's Step 1, but with one necessary addition: **`data_dir`
isolation**. The brief's own version of the fixture doesn't isolate
`settings.data_dir`, but the environment note in my task instructions was
explicit that import-touching tests must do this (as `test_import_api.py`
does via its local `isolated_uploads_dir` autouse fixture). Since `imported`
now lives in `conftest.py` and is used by every test in three test files, I
isolated `data_dir` *inside* the fixture itself (via `tmp_path`/`monkeypatch`
fixture arguments) rather than adding a second autouse fixture — this keeps
the isolation scoped exactly to tests that need it, without silently changing
behavior for every other test module via a conftest-level autouse fixture.

```python
@pytest.fixture
def imported(client, tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "data_dir", tmp_path)
    settings.uploads_dir.mkdir(parents=True, exist_ok=True)
    ...
```

Verified this never touches `backend/data/uploads`: ran the suite and checked
`backend/data/uploads` was untouched (pre-existing dir, mtimes unchanged).

## Deviation 2 — `app/schemas/analytics.py` uses real response models

The brief lists this file as one to create, but its Step 6 reference
implementation for `app/api/analytics.py` returns raw `list[dict]` / `dict`
and never imports from `schemas/analytics.py` — internally inconsistent. Since
every other router in this codebase (`accounts.py`, `imports.py`, and my own
`transactions.py`/`categories.py`) uses `response_model=` with a real Pydantic
schema, I built proper models (`SeriesBucketOut`, `CategoryBreakdownOut`,
`SummaryOut` with nested `PeriodTotalsOut`/`ComparisonOut`,
`CalendarPointOut`) and wired them as `response_model` on all four analytics
routes. This gives typed OpenAPI docs and actually uses the file the brief
asked me to create. Behavior/JSON shape is identical to what the brief's
literal code would have produced — all brief tests pass unchanged.

## Deviation 3 — added `test_categories_api.py` and two delete-transaction tests

The brief's own test files never exercise `POST/PATCH/DELETE /api/categories`
or `DELETE /api/transactions/{id}`, even though "careful point 6"
(`DELETE /api/categories/{id}` must not delete transactions, only
uncategorise them) is called out explicitly as something to get right. Coverage
without a test was 39% on `categories.py`. I added
`backend/tests/test_categories_api.py` (9 tests: slug generation, duplicate-name
409, unknown-kind 422, third-hierarchy-level 422, foreign-parent 404,
patch/patch-foreign-404, and the load-bearing one —
`test_delete_category_uncategorizes_its_transactions_instead_of_deleting_them`,
which patches a transaction onto a category, deletes the category, and asserts
the transaction still exists with `category_id: null` and
`category_source: "uncategorized"`) plus two tests for
`DELETE /api/transactions/{id}` (own vs. someone else's, 404). `categories.py`
is now at 100% coverage.

## Test commands and output

Failing-first check (before implementation):
```
cd backend && .venv/Scripts/pytest.exe tests/test_transactions_api.py tests/test_analytics_api.py -v
→ 20 failed (404s / missing keys on every route) — confirmed before writing any implementation code.
```

After implementation, targeted run:
```
cd backend && .venv/Scripts/pytest.exe tests/test_transactions_api.py tests/test_analytics_api.py -v
→ 20 passed
```

Category CRUD tests (written after confirming the base implementation worked,
to close the coverage gap on already-correct code):
```
cd backend && .venv/Scripts/pytest.exe tests/test_categories_api.py -v
→ 9 passed
```

Full suite with coverage:
```
cd backend && .venv/Scripts/pytest.exe --cov=app --cov-report=term-missing -q
→ 204 passed, 120 warnings in ~19s
```

Lint:
```
cd backend && .venv/Scripts/python.exe -m ruff check .
→ All checks passed!
```

## Coverage figures (target: ≥80% on app/engines and app/importers)

```
Name                             Stmts   Miss  Cover   Missing
--------------------------------------------------------------
app\engines\aggregate.py           130      9    93%   57, 81, 88, 91-96
app\importers\dedup.py              20      0   100%
app\importers\dialect.py           121      8    93%   49, 56, 79, 84, 93, 153, 194-195
app\importers\mapping.py            45      1    98%   91
app\importers\parser.py             63      3    95%   60, 67-68
app\importers\service.py           136      5    96%   110-115, 127-133
--------------------------------------------------------------
```
`app/engines` = 93% (single module, `aggregate.py`). `app/importers` ranges
93–100% across its five modules, all above target. Both comfortably exceed the
80% target.

New code coverage:
- `app/api/transactions.py` — 94% (4 lines uncovered: individual filter
  branches `uncategorized_only`, `account_id`, `min_cents`, `max_cents` in
  isolation — each is exercised in combination via other tests but not every
  branch gets its own dedicated single-filter test; not a correctness risk,
  the same `if query = query.filter(...)` pattern is used identically to the
  already-shipped `accounts.py`/`imports.py`).
- `app/api/categories.py` — 100%.
- `app/api/analytics.py` — 98% (one line: the `account_id` filter branch in
  `_points`, used only by `/analytics/series?account_id=`, not exercised by
  any test — same category as above, not a correctness risk).
- `app/schemas/transactions.py`, `app/schemas/analytics.py` — 100%.

Overall project coverage: 95% (1534 statements, 77 missed).

## Things later tasks (frontend, Lot D) need to know

- `GET /api/transactions` returns `{items, total, limit, offset}`. Items are
  ordered newest-first (`date` desc, then `id` desc as a tiebreaker for same-day
  transactions).
- `PATCH /api/transactions/{id}` response is `TransactionOut` fields plus
  `learned_rule_id: int | None` and `backfilled: int` (count of other
  transactions retroactively recategorised by the newly learned/reinforced
  rule). `learned_rule_id` is `None` when `extract_pattern` couldn't derive a
  usable pattern from the label (e.g. label reduces to only stopwords) — this
  is a legitimate outcome, not an error.
- `GET /api/categories` returns a **flat list** ordered parent-then-children
  (parents first via `nulls_first()` on `parent_id`, then `position`, then
  `name`) — not a nested tree structure. The brief's own text says "arbre avec
  totaux facultatifs" (tree with optional totals) but its Step 4 reference
  code returns the same flat list I implemented, and no totals are computed.
  If the frontend needs a nested tree or per-category totals, that assembly
  needs to happen client-side (using `parent_id`) or in a future task — it is
  not currently server-side.
- `DELETE /api/categories/{id}` uncategorises affected transactions
  (`category_id = null`, `category_source = "uncategorized"`) rather than
  deleting them, and does **not** cascade-delete `CategoryRule` rows pointing
  at the deleted category at the ORM level (the FK has
  `ondelete="CASCADE"` at the schema level, which SQLite only enforces if
  foreign key pragmas are on for that connection — not verified as part of
  this task, out of scope).
- `GET /api/analytics/summary` compares the requested window against the
  immediately preceding window of the *same length* (inclusive day counts,
  e.g. a 31-day March compares against the 31 days ending the day before
  March 1st, i.e. 29 Jan–28 Feb). `comparison.delta_ratio` is `None` when the
  previous period's `net_cents` was exactly 0 (see `compare_periods` in
  `app/engines/aggregate.py`, unchanged from task 13).
- `GET /api/analytics/calendar` returns **only days with activity** (no
  zero-filled gap days) — unlike `/series`, which is always gap-filled via
  `fill_missing_buckets`. A frontend heatmap needs to treat missing dates as
  zero itself.
- All analytics/transactions/categories routes require `Authorization: Bearer
  <token>` and 401 without it (verified by
  `test_analytics_require_authentication`; the same `get_current_user`
  dependency is used everywhere, so this holds for all new routes).

---

## Fix round 1 of 5

Commit: `0bbad53` — `fix(api): uncategorize children's transactions when a
parent category is deleted`

### Issue (CRITICAL, from review — plan-originated, not introduced by me)

`delete_category` only uncategorised transactions filed directly under the
category being deleted. `Category.children` carries
`cascade="all, delete-orphan"` (`backend/app/models/category.py`), so deleting
a parent also deletes its child `Category` rows through the ORM. Those
children's transactions were left to the database's
`ON DELETE SET NULL` on `Transaction.category_id`
(`backend/app/models/transaction.py`), which nulls `category_id` but leaves
`category_source` exactly as it was. A transaction that had been manually
filed under a child ended up with `category_id: null` and
`category_source: "manual"` — a row claiming a hand-picked category it no
longer has. My own delete test only ever deleted a leaf category, so it never
exercised this path.

### Assumption checked before relying on it: hierarchy is capped at two levels

The coordinator's fix (`doomed = [category.id] + [direct children]`) is only
correct if a category can never have a grandchild. I re-read the code before
trusting that:
- `create_category` (`backend/app/api/categories.py`): when `payload.parent_id`
  is set, it fetches that parent and rejects the request with 422
  ("La hiérarchie est limitée à deux niveaux") if `parent.parent_id is not
  None` — so a category can never be created as a grandchild.
- `CategoryPatch` (`backend/app/schemas/transactions.py`) has no `parent_id`
  field at all — a category cannot be re-parented after creation, so nothing
  can turn a two-level tree into a three-level one later.

Both checks hold, so one level of direct children is sufficient; the fix as
given is correct without extending it further.

### Fix applied

`delete_category` in `backend/app/api/categories.py` now builds a `doomed`
list of `[category.id, *direct_child_ids]` (queried via
`Category.parent_id == category.id`, scoped to `user.id`) and uncategorises
every transaction whose `category_id` is `in_(doomed)`, before deleting the
category. Matches the coordinator-supplied patch exactly.

### Covering test

Added `test_deleting_a_parent_uncategorizes_transactions_filed_under_its_children`
in `backend/tests/test_categories_api.py`: creates a parent category, creates a
child under it, PATCHes a transaction onto the child (which sets
`category_source` to `"manual"`), deletes the parent, then asserts the
transaction still exists with `category_id is None` and
`category_source == "uncategorized"`.

Verified it fails against the pre-fix code: stashed just the `categories.py`
fix (kept the new test), ran the test in isolation:

```
cd backend && .venv/Scripts/pytest.exe tests/test_categories_api.py::test_deleting_a_parent_uncategorizes_transactions_filed_under_its_children -v
```
```
FAILED tests/test_categories_api.py::test_deleting_a_parent_uncategorizes_transactions_filed_under_its_children
AssertionError: assert 'manual' == 'uncategorized'
  - uncategorized
  + manual
```

Then restored the fix (`git stash pop`) and re-ran the full suite:

```
cd backend && .venv/Scripts/pytest.exe tests/ -v
```
```
205 passed, 122 warnings in 12.86s
```

Ruff: `.venv/Scripts/python.exe -m ruff check app/api/categories.py
tests/test_categories_api.py` → `All checks passed!`

### Deferred findings — left untouched, as instructed

- PATCH silently ignoring an explicit `category_id: null` (Minor).
- Untested `min_cents` / `account_id` / `uncategorized_only` filter branches
  (Minor) — these are the same lines already flagged as uncovered in the
  original coverage table above (`app/api/transactions.py` 94%,
  `app/api/analytics.py` 98%).

### Staging discipline

Staged only `backend/app/api/categories.py` and
`backend/tests/test_categories_api.py` for this commit — did not touch or
stage `docs/superpowers/plans/2026-08-09-yieldo-phase-1-socle.md`, which shows
as modified in the working tree (the coordinator's plan correction) but is not
mine to commit.
