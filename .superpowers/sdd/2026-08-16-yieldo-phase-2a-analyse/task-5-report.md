# Task 5 report: Budgets API

## What was implemented

- `backend/app/schemas/budgets.py` — `BudgetLineOut`, `UnbudgetedOut`,
  `BudgetReportOut`, exactly as specified in the brief (Step 3, verbatim).
- `backend/app/api/budgets.py` — `GET /api/budgets?month=YYYY-MM`, exactly as
  specified in the brief (Step 4, verbatim): reads the clock at the boundary
  (`date.today()`), fetches this user's history and transactions through the
  existing `api/common` and `api/history` helpers, converts them into
  `app.engines.budget`'s input dataclass, and serialises the result. No
  calculation logic lives in the router.
- `backend/app/main.py` — registered `budget_routes.router` on `api` (the
  `/api`-prefixed sub-router) before `app.include_router(api)`, per the
  phase-1 ledger note about the include-order trap. Import added
  alphabetically alongside the other `app.api` imports.
- `backend/tests/test_budgets_api.py` — the brief's 11 tests verbatim, plus
  two of my own (see below): 13 tests total.

Writing a budget still goes through the existing `PATCH /api/categories/{id}`
with `monthly_budget_cents`; no new write endpoint was added, per the brief.

## TDD evidence

Baseline before this task: `310 passed` (confirmed by running the full suite
before writing anything).

**Step 1 — failing test first.** Wrote `backend/tests/test_budgets_api.py`
with the brief's 11 tests plus my own two, then ran it against the
not-yet-existing router:

```
$ .venv/Scripts/pytest.exe tests/test_budgets_api.py -v
...
FAILED tests/test_budgets_api.py::test_the_default_month_is_the_month_of_the_last_transaction
FAILED tests/test_budgets_api.py::test_a_category_with_no_budget_produces_no_line
FAILED tests/test_budgets_api.py::test_a_budget_set_through_the_categories_endpoint_shows_up
FAILED tests/test_budgets_api.py::test_a_budgeted_category_with_no_spending_still_reports_a_line
FAILED tests/test_budgets_api.py::test_unbudgeted_lists_what_was_spent_with_no_ceiling_set
FAILED tests/test_budgets_api.py::test_setting_a_budget_moves_a_category_out_of_unbudgeted
FAILED tests/test_budgets_api.py::test_the_month_calendar_facts_are_reported
FAILED tests/test_budgets_api.py::test_a_malformed_month_is_refused_in_french
FAILED tests/test_budgets_api.py::test_a_month_number_out_of_range_is_refused
FAILED tests/test_budgets_api.py::test_budgets_require_authentication - Asser...
FAILED tests/test_budgets_api.py::test_budgets_never_cross_users - KeyError: ...
FAILED tests/test_budgets_api.py::test_a_category_with_both_spend_and_refund_excludes_income_rather_than_nets_it
======================= 12 failed, 27 warnings in 1.66s =======================
```

Failure mode: `assert 404 == 200` — the router did not exist yet, exactly as
the brief predicted ("every request 404s"). `test_budgets_never_cross_users`
failed on a `KeyError` instead of `404`, because it never reaches the
assertions — the `.json()["access_token"]` and category lookups it depends on
run fine, and the *first* failing status code it hits is the same 404 (the
short summary line just reports the first uncaught exception in the chain).

**Implementation** — schemas, router, `main.py` registration, all per the
brief.

**Step 6/7 — passing.**

```
$ .venv/Scripts/pytest.exe tests/test_budgets_api.py -v
...
======================= 12 passed, 27 warnings in 1.50s =======================
```

(12 at that point — the 13th test, the no-history fallback case, was added
afterward to close a coverage gap; see below.)

Full suite with coverage:

```
$ .venv/Scripts/pytest.exe -v --cov=app --cov-report=term-missing
...
app\api\budgets.py               48      0   100%
app\schemas\budgets.py           31      0   100%
...
TOTAL                             1925     88    95%
===================== 323 passed, 197 warnings in 24.97s ======================
```

323 = 310 baseline + 13 new tests. Nothing else regressed. `app/api/budgets.py`
and `app/schemas/budgets.py` are both at 100% line coverage.

The brief's own step 7 claimed "308 passed" for the whole suite post-task,
which is stale relative to the current tree (this branch is well past that
point — 310 tests were already green before this task started, per the task
prompt). I went with the actual baseline I measured rather than the brief's
number.

## The spend-vs-refund decision

The brief flagged this as the most likely thing to get wrong: task 4's
`evaluate_budgets` now raises a French `ValueError` on a positive
`spent_cents` rather than coercing it, so if the router ever *nets* income
against spend for a category, a month where refunds exceed spend in that
category would 500 the endpoint.

**Decision: exclude, don't net.** The router builds `spent_by_category` from
`aggregate_by_category(points)` (`app/engines/aggregate.py`), which already
implements the "exclude income rows" precedent CLAUDE.md and the brief point
to — line 157-158 skips any point with `amount_cents >= 0` before it ever
accumulates a category total. Because the router hands `BudgetEntry` the
result of that pre-filtered aggregation (`total.total_cents`), a category's
`spent_cents` can never be positive by construction: refunds in that category
never enter the sum at all, they aren't subtracted from it. This was already
the shape of the brief's router code (Step 4); I didn't have to change
anything to get the right behaviour, but the brief explicitly asked for a
test proving it, since the correctness here depends on `aggregate_by_category`
staying income-excluding and would silently break if someone "improved" it to
net later.

**The test** (`test_a_category_with_both_spend_and_refund_excludes_income_rather_than_nets_it`,
in `backend/tests/test_budgets_api.py`): inserts a 500 EUR refund, dated
inside March 2025 and filed under `transport-carburant`, directly via the
`db` fixture (there is no manual transaction-creation endpoint) alongside the
fixture's existing -68.10 EUR fuel purchase in the same category and month —
a refund larger than the spend. It asserts:
- the request returns `200`, not a 500 from the engine's `ValueError`;
- `spent_cents == -6_810`, i.e. the refund is invisible to the total, not
  netted against it (which would have produced `+43_190` and raised).

The test's docstring states which behaviour is correct and why, per the task
brief's instruction.

## A gap I found and closed on my own

After the 12 brief tests passed, coverage on `app/api/budgets.py` was 98%,
missing line 42 — the `return today.replace(day=1)` fallback in
`resolve_month`, reached only when a user has *no* transactions at all (so
`history` is `None`) and passes no `month` query param. None of the brief's
11 tests exercise a user with zero transactions. I added
`test_a_user_with_no_transactions_at_all_defaults_to_todays_month`, mirroring
the existing pattern in `test_analytics_api.py`
(`test_summary_history_is_null_for_a_user_without_any_transaction`): register
a fresh user, hit `/api/budgets` with no `month`, assert `month` equals
today's `YYYY-MM`, `history` is `None`, and both `lines` and `unbudgeted` are
empty. This closed coverage to 100% on both new files.

## Files changed

- `backend/app/schemas/budgets.py` (new)
- `backend/app/api/budgets.py` (new)
- `backend/app/main.py` (modified — router import + registration, 2 lines)
- `backend/tests/test_budgets_api.py` (new, 13 tests)

## Self-review findings

Read back through the router and tests with fresh eyes before committing:

- **Isolation**: every query filters on `user_id` — `user_history(db, user.id)`,
  `tx_points(db, user.id, ...)`, and the direct `Category` query all do. No
  route reads across users. `test_budgets_never_cross_users` and the
  cross-tenant tests already in `api/common`/`analytics` cover the shared
  helpers; the direct `Category` query is new here and I checked it
  explicitly filters `Category.user_id == user.id`.
- **Money/dates**: everything is `int` cents end to end; `month_start`/
  `month_end` are `date` objects, serialised to ISO-8601 by Pydantic
  automatically.
- **Pure engine boundary**: `budget.py` takes no session and no clock;
  `date.today()` is read once in the router and threaded through. Confirmed
  by reading `app/engines/budget.py` itself, not just the brief's claim.
  Both `budget.py` and `aggregate.py` are untouched by this task.
  `spent_cents` for a budgeted category defaults to `0` (via
  `spent_by_category.get(category.id, 0)`) when there is no spend that
  month, which is the engine's ordinary "no spend yet" case, not an error.
- **No silent failures**: malformed/out-of-range month raises `HTTPException`
  with a French message; no bare `except`, no fallback value standing in for
  a real figure anywhere in the new code.
- **French user text**: `"Mois invalide : format attendu AAAA-MM"` — verified
  against the test's substring assertion (`"AAAA-MM" in detail`).
  `test_a_malformed_month_is_refused_in_french` and
  `test_a_month_number_out_of_range_is_refused` both pass.
- **Sort orders**: `lines` sorts by `consumed_ratio` descending (worst
  first); `unbudgeted` sorts by `spent_cents` ascending, which — because
  `spent_cents` is negative — puts the largest magnitude (most spent) first.
  Verified against `test_unbudgeted_lists_what_was_spent_with_no_ceiling_set`,
  which asserts magnitudes are sorted descending.
- **Uncategorized bucket**: `category_id is None` transactions are excluded
  from both `lines` (impossible, since `budgeted` only ever iterates real
  `Category` rows) and `unbudgeted` (explicit filter) — there's no category
  row to attach a budget-setting affordance to, so surfacing it in
  `unbudgeted` would be a dead end for the user. Matches the brief's inline
  comment and its own reasoning.
- **Transfers**: `aggregate_by_category` is called with its default
  `include_transfers=False`, consistent with every other analytics endpoint
  — a transfer to savings never counts as a "spend" a budget could track.
- **Ruff**: `ruff check` on the four changed/new files reports no issues.
  (Two pre-existing, unrelated lint findings exist elsewhere in the test
  suite — `test_import_api.py`'s `.encode("utf-8")` — untouched by this task.)
- No mypy configuration exists in this project (`pyproject.toml` has no mypy
  section), so no type-checking step was skipped.

I did not find anything to change as a result of this review — the brief's
router and schema code, taken verbatim, holds up.

## Concerns

- None blocking at the time this section was written. The `status: str` note
  below was raised by review and has since been fixed — see the fix round
  below.

---

# Fix round (post-review)

Review came back spec-compliant, tenant-isolation-solid, and confirmed the
refund/spend test would genuinely fail if `aggregate_by_category` ever netted
income in (the reviewer hand-traced the fixture row). Two findings, both
addressed here on top of `7711fa0`.

## Important: unhandled 500 on `month=0000-05`

`_MONTH_KEY` (`^(\d{4})-(\d{2})$`) accepts any four digits, including
`"0000"`. `"0000-05"` passes the regex, passes `1 <= month <= 12`, and then
`return date(year, month, 1)` executes `date(0, 5, 1)` — `datetime.MINYEAR`
is 1, so this raises `ValueError: year 0 is out of range`. Nothing in the app
registers a handler for a bare `ValueError` (`main.py` only handles
`RequestValidationError`), so it would have propagated as a generic,
untranslated 500 instead of the French 422 every other malformed-month path
returns. `test_a_month_number_out_of_range_is_refused` only ever exercised
`2025-13` (month out of range), never a bad year — so this path had no test
covering it at all.

**Fix, as directed: an explicit range check, not a try/except.** An English
traceback reaching the user through an uncaught exception is exactly the
no-silent-failures violation CLAUDE.md forbids, and a guard states the rule
where the next reader will find it, rather than relying on catching whatever
`date()` happens to raise.

```python
year, month = int(match.group(1)), int(match.group(2))
if not 1 <= year <= 9999 or not 1 <= month <= 12:
    raise HTTPException(status_code=422, detail="Mois invalide : format attendu AAAA-MM")
return date(year, month, 1)
```

(`backend/app/api/budgets.py:36-42`)

### TDD evidence

**Failing test first**, added to `backend/tests/test_budgets_api.py`:
`test_a_year_of_zero_is_refused_in_french_not_a_500`, requesting
`/api/budgets?month=0000-05` and asserting a French 422.

```
$ .venv/Scripts/pytest.exe tests/test_budgets_api.py::test_a_year_of_zero_is_refused_in_french_not_a_500 -v
...
>           return date(year, month, 1)
                   ^^^^^^^^^^^^^^^^^^^^
E           ValueError: year 0 is out of range

app\api\budgets.py:39: ValueError
=========================== short test summary info ===========================
FAILED tests/test_budgets_api.py::test_a_year_of_zero_is_refused_in_french_not_a_500
======================== 1 failed, 5 warnings in 0.70s ========================
```

This is the exact failure mode the review described, reproduced before
touching the fix.

**After the fix:**

```
$ .venv/Scripts/pytest.exe tests/test_budgets_api.py -v
...
tests/test_budgets_api.py::test_a_year_of_zero_is_refused_in_french_not_a_500 PASSED [ 71%]
...
======================= 14 passed, 31 warnings in 1.70s =======================
```

## Minor: `status` as a typed literal, not a bare `str`

`app/engines/budget.py` already defines `BudgetStatus = Literal["ok",
"at_risk", "over"]`. `BudgetLineOut.status` was declared as a plain `str`,
so the generated OpenAPI schema advertised it as an open string rather than
a closed set, pushing the hardcoding of `"ok" | "at_risk" | "over"` onto
task 6's frontend types.

**Fix:** import `BudgetStatus` into the schema and use it directly, so the
closed set is declared once, in the engine, and the wire contract follows it:

```python
from app.engines.budget import BudgetStatus
...
class BudgetLineOut(BaseModel):
    ...
    status: BudgetStatus
```

Verified the generated OpenAPI schema now reflects the enum:

```
$ .venv/Scripts/python.exe -c "
from app.main import app
schema = app.openapi()
print(schema['components']['schemas']['BudgetLineOut']['properties']['status'])
"
{'type': 'string', 'enum': ['ok', 'at_risk', 'over'], 'title': 'Status'}
```

No new schema/engine coupling concern: `app/engines/budget.py` still imports
nothing from `app.schemas` or `app.api` — the dependency runs one way, engine
type into schema, which is the same direction every schema in this codebase
already depends on the models/engines it serialises.

The other Minor from review (the "worst first" sort being unexercised by any
test with more than one budgeted category) was explicitly left to the ledger
per the coordinator's instruction — not addressed in this round.

## Full suite after both fixes

```
$ .venv/Scripts/pytest.exe -v --cov=app --cov-report=term-missing
...
app\api\budgets.py               48      0   100%
...
app\schemas\budgets.py           32      0   100%
...
TOTAL                             1926     88    95%
===================== 324 passed, 199 warnings in 24.91s ======================
```

324 = 310 original baseline + 14 tests in `test_budgets_api.py` (13 from the
first round + 1 new for the year-0 case). 100% line coverage held on both
`app/api/budgets.py` and `app/schemas/budgets.py`. `ruff check` on all three
touched files reports no issues.

## Files changed in this round

- `backend/app/api/budgets.py` — explicit year-range guard
- `backend/app/schemas/budgets.py` — `status: BudgetStatus` instead of `str`
- `backend/tests/test_budgets_api.py` — one new test

## Concerns after the fix round

None. Both review findings are addressed and verified; the full suite is
green.
