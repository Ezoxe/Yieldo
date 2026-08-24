# Task 17: Analysis API — report

Branch `phase-2-analyse-decision`, base commit `2631d24`.

## What was implemented

- `backend/app/schemas/analysis.py` — `CategoryInflationOut`, `InflationOut`,
  `AnomalyOut`, `SkippedCategoryOut`, `AnomalyReportOut`, `PriceIndexPointOut`,
  `PriceIndexPointIn`, `PriceIndexIn`. One deliberate addition beyond the
  brief's own schema listing: `PriceIndexPointIn.value` carries `Field(gt=0)`
  (see "Where the pasted index is validated" below).
- `backend/app/api/analysis.py` — `GET /api/analysis/inflation`,
  `GET /api/analysis/anomalies`, `GET`/`PUT /api/analysis/price-index`.
- `backend/app/main.py` — registered `analysis_routes.router` on `api`
  before `app.include_router(api)`.
- `backend/tests/test_analysis_api.py` — 19 tests (13 from the brief, 6
  added: a schema-boundary validation test for a non-positive index value, a
  year-zero guard test mirroring `budgets_api.py`'s own, a transfer-exclusion
  test, an "operator data shape" anomalies test, a dedicated PUT cross-tenant
  isolation test, and a reference-ratio-present test).

## TDD evidence

1. Wrote `app/schemas/analysis.py` and `app/api/analysis.py` closely
   following the brief (after reading `inflation.py`/`anomaly.py`/`common.py`
   in full to verify the brief's shape against the shipped engines — see
   below), then wrote the full test file.
2. Temporarily commented out `api.include_router(analysis_routes.router)` in
   `main.py` and ran `pytest tests/test_analysis_api.py -v`: **all 18 tests
   failed** (404 on every route — confirmed, not assumed). Restored the
   registration line.
3. Re-ran: **18/18 passed** on the first try. Added the year-zero-guard test
   afterward to close a coverage gap (see below) — **19/19 passed**,
   `app/api/analysis.py` at **100% statement coverage** (59/59).
4. Full backend suite: **515 passed** (496 before this task + 19 new).
   `--cov=app` totals **97%**, unchanged in shape from before this task
   (the two lines this task's coverage run reports missing belong to
   `accounts.py`/`auth.py`/etc., pre-existing and untouched).

## The `today` decision for each endpoint

Neither route calls `date.today()` directly. Both delegate to
`api/common.py`'s `period_range`, which reads the clock at its own boundary
and already has a precedent in this codebase: `api/analytics.py` builds every
one of its windows from it. An absent `date_from`/`date_to` therefore
resolves to *this user's own ledger span* (or `date.today()` for a user with
no data at all), never to the real calendar date — the same principle
`budgets.py` and `cashflow.py` apply through their own resolvers, just reused
here via the already-existing helper rather than a new one.

- `inflation`: `period_range` decides both what the *current* window is and,
  through `previous_year_window`, what the *previous* window is. This is the
  only date decision the route makes.
- `anomalies`: `period_range` decides only the *reported* window
  (`AnomalyReportOut.date_from`/`date_to`, and which transactions can appear
  in `anomalies`/`skipped`/count toward `scored_groups`). It does **not**
  decide what history the engine scores against — `anomaly_points(db,
  user.id)` always fetches the user's *entire* ledger, unfiltered by any
  date, exactly as `anomaly.py`'s own docstring requires (a category's
  baseline must come from its full history, not a window). This is contract
  #3 from the task brief, and it is why `anomalies` and `inflation`, despite
  sharing `period_range`, are not the same shape underneath.

## Where the pasted index is validated

At the schema boundary: `PriceIndexPointIn.value: Decimal = Field(gt=0)`.
Task 15's review left a live gap in `inflation.reference_ratio_from_index`
— its zero-baseline guard is `before == 0` rather than `before <= 0`, so a
negative index value divides and returns a sign-inverted ratio. Rather than
patch the engine (out of this task's scope and not requested) or trust every
future caller to independently rediscover the same guard, the value is
refused before it can ever reach the engine: 0 and negative values both fail
pydantic validation and return a French 422 (`"doit être strictement
supérieur à 0."`, via the existing `french_validation_detail` handler in
`main.py` — this is a genuine pydantic `RequestValidationError`, not a
hand-raised `HTTPException`, so `detail` comes back as FastAPI's list-of-errors
shape rather than a bare string; the malformed-month and duplicate-month
checks in the router *do* raise `HTTPException` directly and so return a
plain string `detail`. Both are exercised by separate tests
(`test_a_zero_or_negative_index_value_is_refused_at_the_schema_boundary`,
`test_a_malformed_month_in_the_index_is_refused_in_french`), and the
positive-value test also confirms a rejected PUT never runs the
delete-then-insert — the previously stored series survives untouched.

The month string is validated in the route itself (`_parse_month`), not the
schema, because a malformed month must produce the same French, human
"AAAA-MM" message `budgets.py`'s `resolve_month` already established, and
because the year-zero edge case (`_MONTH_KEY` matches "0000-05"; naive
`date(0, 5, 1)` raises an unhandled `ValueError`) needs the same explicit
`1 <= year <= 9999` guard `budgets.py` uses — a pydantic-level string pattern
can't express that guard as cleanly as the existing `resolve_month`-style
function can, and duplicating the working pattern kept the two malformed-month
paths (budgets, analysis) recognizably the same shape.

## How transfers were excluded from the inflation basket

`inflation.py`'s own docstring and `CategorySpend`'s field docstring both
name this the caller's responsibility (contract #1 in the task brief):
`_monthly_costs` applies no `is_transfer` filter. The router filters at
construction time, before a `CategorySpend` is ever built:

```python
points = [
    CategorySpend(on=point.on, amount_cents=point.amount_cents,
                  category_id=point.category_id)
    for point in tx_points(db, user.id, previous.start, end)
    if not point.is_transfer
]
```

Proven by `test_transfers_are_excluded_from_the_inflation_basket`: a category
holding *only* six months of a large (`-300 000` cents/month) `is_transfer=True`
row, spanning both the current and previous windows, never appears in
`InflationOut.lines` at all — not marked incomparable, simply absent, because
it never enters either window's cost dict. Ran this test against a
deliberately unfiltered version of the router first (removed the `if not
point.is_transfer` clause) to confirm it fails without the guard: the
category then appeared as the single dominant, comparable line, exactly the
failure mode the engine's docstring warns about.

## Cross-tenant coverage

Every query in the router filters on `user_id`, via `_index_points`,
`_category_names`, `tx_points(db, user.id, ...)`, and `anomaly_points(db,
user.id)` — no route reads across users. Tests:

- `test_analysis_never_crosses_users` (from the brief): a second user reads
  empty/refusing results after the first user has written real data on
  every one of the four endpoints.
- `test_a_price_index_put_never_touches_another_users_series` (added): two
  users each `PUT` their own series; confirms the second user's write does
  not delete or leak into the first user's stored rows — this exercises the
  `DELETE ... WHERE user_id = ?` half of the replace, which the brief's own
  test never isolated on its own.
- `test_analysis_requires_authentication`: all four endpoints, including the
  `PUT`, return 401 with no bearer token.

## The operator's own data shape

- **Inflation refuses**: `test_the_operators_shape_cannot_compare_and_says_why`
  (from the brief) — the Boursorama sample covers one week of March 2025;
  every line comes back `comparable: false` with a French reason naming
  "un an plus tôt", never a fabricated `-100 %`.
- **Anomalies come out mixed**: added
  `test_the_operators_data_shape_leaves_some_anomalies_scored_and_others_skipped`,
  which builds the same four-category shape `test_anomaly.py`'s own
  `test_the_operators_data_shape_leaves_some_categories_scored_and_others_skipped`
  uses (2026-08-16 phase 2A plan, Lot E: "19 categories, ~10 rows each |
  mixed — some scored, some skipped") through the actual HTTP endpoint: one
  category scored with a finding, one scored with none, two skipped under
  `MIN_HISTORY` each with its own true observation count. `scored_groups ==
  2` and the flagged transaction belongs only to the outlier category.

## Where the brief disagreed with the shipped code

1. **`test_anomalies_are_scored_over_history_and_reported_for_the_period`'s
   assertion `"10 opérations" in body["skipped"][0]["reason"]` cannot pass
   against the shipped `anomaly.py`.** `SkippedCategory`'s own reason text
   uses `_SIGN_LABELS = {"expense": "dépenses", "income": "recettes"}` —
   the word "opérations" does not appear anywhere in the engine. Fixed the
   test to check for `"10 dépenses"` or `"10 recettes"` (using `MIN_HISTORY`
   rather than a hard-coded `10`, and checking `any(...)` across `skipped`
   rather than assuming which sign group sorts first) instead of asserting a
   string the engine never produces.
2. The brief's own router listing labelled its `PriceIndexPointIn.value`
   comment as "not going through a float" but did not itself add `Field(gt=0)`
   in its schema code block (the field is declared but the constraint is
   present verbatim in the brief's own text — this part matched; flagged
   here only because the task instructions explicitly called out that this
   decision needed to be made and stated, not because the brief was wrong).
3. Everything else in the brief's router/schema code (field names, response
   shapes, the replace-then-return pattern, the malformed-month and
   duplicate-month guards) matched the shipped engines and existing router
   conventions exactly and was kept as specified.

## Files changed

- `backend/app/schemas/analysis.py` (new)
- `backend/app/api/analysis.py` (new)
- `backend/app/main.py` (2-line addition: import + `include_router`)
- `backend/tests/test_analysis_api.py` (new, 19 tests)

## Self-review findings

- Fixed a factual error in my own first draft of `analysis.py`'s module
  docstring, which claimed `budgets.py` and `cashflow.py` also use
  `period_range` — they don't; only `analytics.py` does. Corrected before
  committing.
- Fixed an inaccurate inline comment in `replace_price_index` that claimed
  `"2025-01"` and `"2025-1"` could collide into the same parsed month —
  `_MONTH_KEY` requires exactly two month digits, so that specific collision
  is unreachable; the duplicate-month guard is really only about the same
  literal month string appearing twice in one payload. Corrected before
  committing.
- Confirmed no route builds `names = {...}` (the category id → `Category`
  map) more than once per request; factored into a shared `_category_names`
  helper rather than repeating the brief's inline duplication in both
  `inflation` and `anomalies`.
- Verified the transfer-exclusion test actually exercises the guard by
  running it against a version of the router with the `is_transfer` filter
  removed — it failed as expected (the transfer category appeared as the
  dominant line) before the filter was restored.

## Concerns

- None blocking. `PriceIndexPointIn.value` has no upper bound (`gt=0` only);
  the brief did not ask for one and an index level has no natural ceiling,
  so none was added.
- Task 18 (the screen) should be aware that `AnomalyReportOut.date_from`/
  `date_to` describe the *reported* window only — a screen date-range picker
  must not be read as "this changes what counts as a category's baseline,"
  since it never does.

(The "no upper bound" concern above was overtaken by the review: see the
fix round below.)

---

## Fix round 1 — review response

Two Important findings and one of five Minor findings, ruled on and fixed on
top of `8ff72ad`. The other four Minor findings are left to the ledger per
the ruling and are not touched here.

### Important 1: the default `/inflation` window compared the ledger against itself

**Root cause.** `inflation()` reused `period_range`'s absent-bound default —
"as far as there is data" — as `current`. `previous_year_window` shifts
`current` back exactly one year; on any ledger longer than twelve months the
two windows overlap, and `_monthly_costs` counts the shared months on both
sides. The reviewer probed this on a 36-month ledger with a real, constant
10 %/year rise (2023 = 100 EUR/mo, 2024 = 110, 2025 = 121): the default
window (2023-01-10 to 2025-12-10) reported +4.76 %, flagged
`comparable: true`, `reason: null` — a number the ledger never stated, and
exactly the number task 18's page load would have shown as the headline
figure.

**Fix, both halves per the ruling:**

- **Router** (`backend/app/api/analysis.py`): a new `_default_current_window`
  (plus `_last_day_of_month`/`_shift_months` helpers) replaces the
  `period_range`-based default *only* when both `date_from` and `date_to` are
  absent. It anchors on the ledger's own last transaction (never
  `date.today()` — a stale ledger must not default to an empty window at the
  real calendar date) and returns the last twelve **complete calendar
  months**: the 1st of the month eleven months before the anchor's month,
  through the last day of the anchor's own month. An explicit
  `date_from`/`date_to` (either one) still goes through `period_range`
  exactly as before — only the fully-absent case changes.
- **Engine** (`backend/app/engines/inflation.py`): `compute_inflation` now
  raises a French `ValueError` whenever `previous.end >= current.start` —
  the exact overlap condition, computed by reusing `previous_year_window`
  itself rather than reimplementing "twelve months" as separate day/month
  arithmetic that could drift out of step with the shift it is checking.
  This fires regardless of how `current` was constructed, so an explicit
  range typed in by a caller is refused exactly like an unfixed default
  would have been. The router catches it and returns a French 422 (same
  catch-and-forward idiom `imports.py` already uses for an engine
  `ValueError` that is already user-facing prose).

**TDD evidence.** Tests written first in both files
(`test_a_window_longer_than_twelve_months_refuses_rather_than_overlapping`,
`test_a_window_of_exactly_twelve_months_is_allowed`,
`test_a_window_one_day_over_twelve_months_refuses` in `test_inflation.py`;
`test_the_default_window_is_the_last_twelve_months_not_the_whole_ledger`,
`test_an_explicit_window_over_twelve_months_refuses_rather_than_blending`
in `test_analysis_api.py`). Verified red by `git stash push` on just the
three implementation files (engine, router, schema), leaving the new tests
in place, then running:

```
.venv/Scripts/pytest.exe tests/test_analysis_api.py tests/test_inflation.py -q
```

Result: 6 failed, 39 passed. The default-window test failed with
`AssertionError: assert '2023-01-10' == '2025-01-01'` — the router handing
back the whole 36-month span exactly as the reviewer described, independently
reproducing their finding rather than merely trusting it. The two
twelve-months-refuses tests (engine and API) both failed with
`Failed: DID NOT RAISE ValueError`. `git stash pop` restored the fix;
re-running the same command: 45 passed.

### Important 2: `PUT /api/analysis/price-index` 500'd on three payload shapes

**Root cause.** `PriceIndexPointIn.value` had `gt=0` and no upper bound.
Three verified payloads reached `replace_price_index`'s
`(point.value * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP)` and
crashed: `"1e30"` and a 29-digit literal both raised
`decimal.InvalidOperation` (the quantized result needs more digits than the
default 28-digit context precision), and `"1e20"` raised `OverflowError`
converting to a SQLite `INTEGER` at commit.

**Fix.** `backend/app/schemas/analysis.py`: `value: Decimal = Field(gt=0,
le=1_000_000)`. A million is generous headroom over any real reference index
(INSEE's IPC sits around 100-140) while keeping every value the schema can
ever pass downstream (<= 100_000_000 hundredths) far under both the Decimal
context ceiling and SQLite's 8-byte integer range — closing all three shapes
at the schema boundary, before the route body ever runs, with the same
French 422 (`"doit être inférieur ou égal à 1000000."`, via the existing
`french_message`/`less_than_equal` handling in `errors.py`) every other
bounded field already returns.

**TDD evidence.** `test_a_price_index_value_far_too_large_is_refused_not_a_500`
written first. Verified red in the same stash cycle as above: the test
failed with an actual unhandled `decimal.InvalidOperation` propagating
through the whole ASGI stack (traced to `app/api/analysis.py:249`, the
quantize line) — a genuine 500, not a simulated one. After restoring the
fix: 422 on all three payloads (`"1e30"`, `"9"*27+".99"`, `"1e20"`).

### Minor (fixed in this commit, per the ruling): `gt=0` does not stop the *rounded* value from being 0

**Root cause.** `gt=0` binds the raw `Decimal` the caller sent, not
`value_hundredths`, the rounded integer actually stored. `"0.004"` passes
`gt=0` (it is positive) and rounds (`ROUND_HALF_UP`) down to `0` hundredths.
A zero *current-side* median divided into a positive previous one in
`inflation.reference_ratio_from_index` fabricates `ratio = -1.0` — a
"-100 %" reference inflation nobody's pasted series actually stated. The
router's own docstring claimed positivity was "already enforced by
`PriceIndexPointIn`", which was true of the `Decimal` and false of what
gets stored.

**Fix.** `replace_price_index` now checks `hundredths <= 0` *after*
rounding and before storing, raising a French 422 naming the offending
month. The docstring is corrected to say what is and is not enforced where,
and why the router needs its own guard the schema cannot express (it never
sees the rounded value).

**TDD evidence.**
`test_a_price_index_value_rounding_to_zero_hundredths_is_refused` (value
`"0.004"`) written first; verified red in the same stash cycle — without
the fix the request returned `200` and the assertion
(`assert response.status_code == 422`) failed on `assert 200 == 422`, i.e.
the point was silently stored as 0 rather than refused. Also asserts the
series is left empty afterward (the point never got persisted).

### Command and full-suite output

```
.venv/Scripts/pytest.exe -q --cov=app --cov-report=term-missing
```

```
...
app\api\analysis.py                 81      0   100%
app\engines\inflation.py            96      0   100%
app\schemas\analysis.py             58      0   100%
...
TOTAL                             2816     88    97%
522 passed, 305 warnings in 56.43s
```

522 passed (515 before this fix round + 4 new API-level tests + 3 new
engine-level tests). All three touched modules — `app/api/analysis.py`,
`app/engines/inflation.py`, `app/schemas/analysis.py` — at 100% statement
coverage. Ruff clean on all five changed files.

### Files changed in this fix round

- `backend/app/api/analysis.py` — default-window fix, `ValueError`->422
  translation, post-rounding zero guard, corrected docstring.
- `backend/app/engines/inflation.py` — the <=12-month guard in
  `compute_inflation`, module docstring's new fourth bullet.
- `backend/app/schemas/analysis.py` — `le=1_000_000` on
  `PriceIndexPointIn.value`, corrected/expanded comment.
- `backend/tests/test_analysis_api.py` — 4 new tests.
- `backend/tests/test_inflation.py` — 3 new tests.

### Not touched (per the ruling — left to the ledger)

- Two `detail` shapes on the same `/price-index` endpoint (plain string from
  hand-raised `HTTPException`s vs. FastAPI's list-of-errors shape from a
  genuine pydantic `RequestValidationError`) — task 18 must branch on
  `typeof`.
- Two of the four cross-tenant assertions in `test_analysis_api.py` are
  over-determined and would pass even with the `user_id` filter removed.
- The month format (`"AAAA-MM"`) does not zero-pad below year 1000.
- An inverted explicit range (`date_from > date_to`) is accepted by the
  shared `resolve_range` rather than refused.

### Self-review of this fix round

- Reworded the engine's new module-docstring bullet after a first draft read
  awkwardly ("a blended one that looks like it is exactly what... design
  exists to prevent") — tightened before committing.
- Confirmed the overlap guard's boundary is exactly where the router's new
  default lands: a calendar-aligned 1 Jan-31 Dec window does *not* trigger
  the guard (`test_a_window_of_exactly_twelve_months_is_allowed`), and one
  day more does (`test_a_window_one_day_over_twelve_months_refuses`) — the
  router's default and the engine's refusal boundary are proven consistent
  with each other, not just each individually correct.
- Considered adding `decimal_places`/`max_digits` constraints to
  `PriceIndexPointIn.value` in addition to `le=1_000_000`. Decided against:
  `le` alone provably closes all three reported crashes (the failure mode is
  magnitude, not precision, at a bounded magnitude — verified by hand: a
  29-significant-digit value just under 1,000,000 still quantizes to a
  small, safely representable integer), and the ruling asked to "pin the
  upper end," not to add a second, independent constraint the review did
  not request.
