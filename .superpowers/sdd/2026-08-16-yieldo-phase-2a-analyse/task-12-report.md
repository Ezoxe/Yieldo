# Task 12: Cash-flow API — report

Commit: `2e9a7f4` — feat(api): expose the twelve-month forecast band and the
runway scenarios.

## What was implemented

- `backend/app/schemas/cashflow.py` — `ForecastMonthOut`, `ForecastOut`,
  `RunwayScenarioOut`, `RunwayOut`.
- `backend/app/api/cashflow.py` — `GET /api/cashflow/forecast`,
  `GET /api/cashflow/runway`.
- `backend/app/main.py` — router attached to `api` before
  `app.include_router(api)`.
- `backend/tests/test_cashflow_api.py` — 15 tests (TDD, see below).

## TDD evidence

Test file written first, per the task-12 brief's own Step 1/2 (adapted — see
"Brief vs shipped code" below). Ran before any implementation existed:

```
tests/test_cashflow_api.py: 15 failed, ... in 5.47s
FAILED ...test_a_sparse_ledger_refuses_to_forecast_and_explains_why - KeyError: 'months'
FAILED ...test_cashflow_never_crosses_users - KeyError: 'months'
... (13 more, same KeyError / AssertionError pattern — every route 404s)
```

After implementing the schema, the router, and the `main.py` registration:

```
tests/test_cashflow_api.py: 15 passed in 4.31s
```

Full suite after: `448 passed` (433 baseline + 15 new), `app/api/cashflow.py`
and `app/schemas/cashflow.py` both at 100% statement coverage;
`app/engines/*` all at 100%; `app/importers/*` at 93–100%.

## The `today` decision (per endpoint)

**`forecast` uses the ledger's own last transaction date**
(`user_history(...).date_to`), exactly like task 8's `/api/recurrences`
router, falling back to `date.today()` only on an empty ledger. This is not a
style choice — `project_cashflow` calls `detect_recurrences(points, today)`
internally, and that engine marks a recurrence `ended` once its last
occurrence is old enough relative to whatever `today` it receives; it cannot
distinguish "cancelled" from "no recent import." The operator's ledger stops
2026-01-09, seven-plus months before the real clock this environment runs on.
Passing the real clock would silently mark every live subscription `ended`,
drop it from `_is_projected`, and understate every projected month's
`recurring_cents` by however much rent and subscriptions actually cost — the
exact failure mode task 8 fixed, reproduced one layer up. The horizon itself
starts the month after `today` (`_future_month_keys`), so this choice also
decides which calendar months get projected: the months following where the
imported history actually stops, the only span the data can honestly speak
to.

Regression-tested directly: `test_forecast_projects_from_the_ledgers_own_last_date_not_the_real_clock`
seeds a monthly rent charge running right up to the ledger's last row and
asserts it still shows up as nonzero `recurring_cents` in the projection —
this would fail if the router used `date.today()` instead.

**`runway` uses the real `date.today()`.** Nothing in `compute_runway`
classifies a recurrence by staleness — `today` only anchors `depleted_on` (a
forward calendar date) and the "already at zero" branch. Anchoring it to the
stale ledger date instead would land `depleted_on` in the past whenever the
runway is shorter than the gap since the last import (measured concretely: on
the operator's own data, `today - ledger_last_on` is seven-plus months, and a
depletion date computed from `ledger_last_on` forward would already have
"happened" by the time anyone reads the screen). An already-passed depletion
date is a strictly worse, more confusing answer than a burn rate that was
last measured on an old statement but is honestly projected forward from
today. This mirrors the codebase's other precedent, `api/budgets.py`, which
always passes the real clock into its engine and reserves `history.date_to`
only for picking a display default.

Both payloads carry `ledger_last_on` (mirroring `RecurrenceReportOut`'s own
field from task 8) so the screen can say, e.g., "mesuré jusqu'au 15 juin
2025" without asserting freshness the data doesn't have. Pinned by
`test_runway_carries_the_ledgers_last_date_alongside_the_real_projection` and
folded into the forecast test above.

## Ledger bounds and the essentials join

`_ledger_bounds(history, today)` returns `history.date_from, history.date_to`
— the actual min/max of imported transaction dates — never a query parameter
or display window, and falls back to `(today, today)` only when the user has
no transactions at all (yielding zero observed months, not a crash). Both
routes call `user_history` once and thread the result through, rather than
re-querying inside the helper (a small simplification over the brief's
`_ledger_bounds(db, user_id, today)` shape, which queried `user_history`
internally and so paid for it twice per request when the route also needed
`history.date_to` for `today`/`ledger_last_on`).

The essentials join: `essential_ids` is the set of this user's
`Category.id` where `is_essential IS TRUE`, and `essential_points` is
`points` filtered to `p.category_id in essential_ids`. Since `category_id`
is `None` for an uncategorised row and `essential_ids` only ever contains
real ids, `None in essential_ids` is `False` — an uncategorised transaction
is excluded from `essential_months` while staying in `all_months`, matching
`runway.py`'s documented conservative default exactly (can only shorten the
essentials runway, never inflate it).

## Brief vs. shipped code — three discrepancies found and corrected

The brief text itself flagged that it might be stale and specifically said
"if it shows anything filtering on `recurring_keys`, stop and tell me." It
did not — Step 4's router code already called `build_observations`,
confirming the `a801569` plan correction landed. But three other problems
surfaced once I traced the brief's code against the actual shipped engines:

1. **Missing imports.** The brief's Step 4 router body calls
   `build_observations(...)` and constructs `LedgerEntry(...)`, but its own
   import block only has `from app.engines.forecast import
   DEFAULT_HORIZON_MONTHS, project_cashflow` — neither name is imported. As
   written, the file does not import.

2. **`RunwayOut.insufficient_reason` does not exist on the engine.** The
   brief's schema and router reference `report.insufficient_reason`, but
   `runway.RunwayReport` (as shipped, after task 10's fix round 1) has no
   such field — it has `normal_unavailable_reason` and
   `essentials_unavailable_reason`, deliberately kept separate. Task 10's own
   progress note explains why: a single conflated reason once told a
   household with three observed months and no deficit "il faut au moins 3
   mois complets ... et l'historique en compte 3," naming the wrong cause.
   Re-introducing one field here would silently reopen that defect at the API
   boundary — `RunwayOut` now carries both reasons; the router passes each
   through untouched; `test_runway_refuses_on_two_observed_months` checks
   both.

3. **The Query bound doesn't match the engine's own limit.** The brief sets
   `months: int = Query(..., le=60)`, but `forecast.MAX_HORIZON_MONTHS = 24`
   and `project_cashflow` raises a plain `ValueError` past it — nothing in
   this app catches a bare `ValueError`, so `months=25..60` would have 500'd
   with an untranslated message instead of the clean French 422 every other
   malformed input in this API gets (the `budgets.py` month-range guard is
   the established precedent for exactly this class of bug). Fixed to
   `le=MAX_HORIZON_MONTHS`, imported from `forecast.py` rather than
   hard-coded, so the two can't drift again. Test replaces the brief's
   `months=61` probe (which happened to still return 422, for the wrong
   reason) with `months=25`, right at the real boundary, and asserts the
   French message names 24.

4. **(Test-data defect, not a code defect.)** The brief's own Step 1 test
   fixture builds "residual" data by importing one fixed-amount charge under
   one label every month for ten months — but that is indistinguishable from
   a genuine subscription to `detect_recurrences` (regular ~30-day interval,
   zero amount spread, well past the 91-day annualisation floor), so
   `build_observations` would window it whole out of the residual, leaving
   `months_observed = 0` and the forecast refusing instead of succeeding.
   I traced this by hand before running anything (interval MAD ≈ 0 for a
   fixed day-of-month charge) and confirmed it empirically: rewriting the
   fixture to use uniquely-labelled one-off transactions per month (never
   reaching `MIN_OCCURRENCES = 3` under one key) makes the "success path"
   tests pass for the right reason. `_import_unique_months` in the test file
   documents this explicitly.

## Tests

15 tests in `backend/tests/test_cashflow_api.py`:

- sparse ledger refuses forecast, names the shortfall ("6 mois")
- genuine residual data produces 12 banded months (P10 < P50 < P90)
- horizon and threshold query params both honoured
- out-of-range horizon → 422, French, matches the engine's real 24-month cap
- forecast's opening balance equals runway's balance (same
  `liquid_balance_cents` call)
- `ledger_months_observed` and `months_observed` are both wired through and
  can genuinely differ (a month carrying only a projected recurring charge
  counts in the former, not the latter)
- forecast projects from the ledger's own last date, not the real clock
  (regression test for the `today` decision above)
- runway refuses on two observed months, with both scenario-specific reasons
  present
- runway reports both scenarios when it can, essentials ≤ normal
- `essential_category_count == 21` (matches the seeded `ESSENTIAL_SLUGS`)
- runway's `depleted_on` is never before the real `date.today()`
- runway carries `ledger_last_on`
- both routes require authentication (401)
- both routes never cross users
- the operator's own data shape: forecast refuses (3 observed < 6 floor),
  runway computes and reports `months_observed == 3`

Cross-tenant coverage follows the established one-directional pattern already
used by `test_recurrences_api.py` (proves user B's empty ledger isn't
polluted by user A's data) rather than also seeding B with her own data —
consistent with the codebase's existing precedent, not a new gap I
introduced.

## Files changed

- `E:\Projet\Github\Yieldo\backend\app\schemas\cashflow.py` (new)
- `E:\Projet\Github\Yieldo\backend\app\api\cashflow.py` (new)
- `E:\Projet\Github\Yieldo\backend\app\main.py` (router registration)
- `E:\Projet\Github\Yieldo\backend\tests\test_cashflow_api.py` (new)

## Self-review findings

- Ran `ruff check` (project's configured linter, `select = ["E", "F", "I",
  "UP", "B", "SIM"]`) against all four touched files: clean, including import
  ordering.
- Full suite: 448 passed, no regressions. `app/api/cashflow.py` and
  `app/schemas/cashflow.py` at 100% coverage.
- Traced both routes by hand against every one of the three preconditions in
  the task brief (build_observations, real ledger bounds, NULL-category
  exclusion) and confirmed each with a dedicated or incidental test, not just
  by inspection.
- Verified `git status` before committing: exactly the four files the task
  scopes, nothing stray staged.

## Concerns / things worth a second look

- `RunwayOut` and `ForecastOut` both gained a field beyond the brief's
  literal interface list (`ledger_months_observed`, `ledger_last_on` ×2, and
  the `normal_unavailable_reason`/`essentials_unavailable_reason` split
  replacing a single `insufficient_reason`). Each is justified above (either
  a genuine engine-contract requirement or the explicit "make sure the
  payload lets the screen phrase it honestly" instruction in the task
  brief), but tasks 13/14 building the chart and the screen should read this
  report's schema, not just the original brief's field list, before wiring
  the frontend.
- `recurrence_points` (used for both `all_months` and `essential_months` in
  `runway`) excludes internal transfers by construction. This is the
  existing, documented behavior of that shared helper and is exactly what
  the task-12 brief's own "Consumes" list specifies calling — flagged here
  only so a later reviewer knows it was a deliberate reuse of an existing
  policy, not a decision made fresh in this task.
- I did not add a test proving the reverse cross-tenant direction (user B
  seeded with her own data, confirming she sees only that) — matching task
  8's own accepted minor deferral for the same class of test, not a new gap.

---

## Fix round 1 (post-review)

Review verdict: **approved**, with four Important findings (all about what
the payload omits, not about correctness of what was implemented) and one
Minor folded in because task 13 needs it. Fixed on top of `2e9a7f4`.

### 1. Neither payload named its own projection anchor

Added `projected_from: date` to both `ForecastOut` and `RunwayOut`, set from
each handler's own `today` variable (`history.date_to` for forecast,
`date.today()` for runway — the same asymmetric choice documented in
`api/cashflow.py`'s module docstring). `ledger_last_on` alone told the screen
how fresh the *data* was, not which date the *projection counts from* —
those are the same value for `forecast` (by construction) but different
values for `runway`, and only `projected_from` says which.

### 2. `RunwayScenarioOut` dropped `RunwayScenario.rate`

Added a nested `MeasuredRateOut` (mirrors `capacity.MeasuredRate`:
`months`, `median_cents`, `spread_cents`, `low_cents`, `high_cents`) and a
`rate: MeasuredRateOut` field on `RunwayScenarioOut`, wired via a new
`_rate_out` helper. This restores both things the review named: the
low/high band (so a burn is never shipped as a bare median), and each
scenario's own sample size (`rate.months`), independent of
`RunwayOut.months_observed`, which only ever described `normal`'s sample.

### 3. `RunwayOut` had no counterpart to `ForecastOut.ledger_months_observed`

Added `ledger_span_months: int` and a router-level helper
`_ledger_span_months(history)` computing the raw elapsed calendar-month span
between the ledger's first and last transaction date, inclusive
(`(end.year - start.year) * 12 + (end.month - start.month) + 1`, 0 on an
empty ledger). This is deliberately a different computation from
`ForecastOut.ledger_months_observed` (which counts *complete* months) —
runway has no residual/recurring split to make the same distinction the
forecast makes, so the missing piece here is the raw span, not a second
"complete months" count. Pinned on the operator's own fixture: 3 complete
months measured, but a 13-month raw span (2025-01..2026-01 inclusive) —
`test_the_operators_own_data_shape_forecast_refuses_and_runway_computes` now
asserts both numbers side by side.

### 4. The uncategorised-row rule was correct but unguarded

Added `test_an_uncategorised_transaction_counts_toward_normal_but_not_essentials`:
seeds a normal essential grocery charge and a second charge under a label
matching no builtin rule (confirmed uncategorised via the transactions API
before asserting anything about runway), then asserts
`normal.monthly_burn_cents > essentials.monthly_burn_cents`.

**Mutation check**, run and recorded here:

```
$ sed -i 's/p.category_id in essential_ids\]/p.category_id in essential_ids or p.category_id is None]/' app/api/cashflow.py
$ .venv/Scripts/python.exe -m pytest tests/test_cashflow_api.py::test_an_uncategorised_transaction_counts_toward_normal_but_not_essentials -v
...
>       assert body["normal"]["monthly_burn_cents"] > body["essentials"]["monthly_burn_cents"]
E       assert 70000 > 70000
FAILED tests/test_cashflow_api.py::test_an_uncategorised_transaction_counts_toward_normal_but_not_essentials
1 failed, 6 warnings in 0.89s
```

Mutation caught (essentials collapses to equal normal once the NULL-category
row is wrongly admitted). Reverted immediately after.

### Minor folded in: `ForecastOut` dropped three methodology fields

Added `recurrences_projected: int`, `pooled_scale_cents: int`, and
`seasonal_scale_cents: int | None`, wired straight from `ForecastReport`.
New test `test_forecast_reports_the_scales_and_recurrence_count_the_band_is_built_from`
seeds one genuine recurrence (rent) alongside genuine residual data and
asserts `recurrences_projected == 1` and `pooled_scale_cents > 0`.

### TDD evidence for this round

RED — new tests run against the pre-fix schema/router (reverted via
`git stash push -- app/schemas/cashflow.py app/api/cashflow.py`, keeping the
new test file in place):

```
FAILED tests/test_cashflow_api.py::test_forecast_reports_the_scales_and_recurrence_count_the_band_is_built_from
FAILED tests/test_cashflow_api.py::test_both_payloads_name_their_own_projection_anchor
FAILED tests/test_cashflow_api.py::test_runway_scenarios_carry_their_own_independent_sample_size
FAILED tests/test_cashflow_api.py::test_the_operators_own_data_shape_forecast_refuses_and_runway_computes
4 failed, 15 passed, 41 warnings in 5.77s
```

(`test_an_uncategorised_transaction_counts_toward_normal_but_not_essentials`
passed even before this round's implementation changes — it exercises
existing, already-correct behavior from the original commit; its own "red"
is the mutation check above, not a schema gap.)

GREEN — after `git stash pop` restoring the implementation:

```
19 passed, 41 warnings in 5.50s
```

Full suite: `.venv/Scripts/pytest.exe -v --cov=app --cov-report=term-missing`
→ **452 passed** (433 baseline + 19 cashflow tests), `app/api/cashflow.py`
and `app/schemas/cashflow.py` both at 100% statement coverage, no
regressions. `ruff check` clean on all three touched files.

### Files changed (this round)

- `backend/app/schemas/cashflow.py` — `MeasuredRateOut`, `RunwayScenarioOut.rate`,
  `RunwayOut.ledger_span_months`, `RunwayOut.projected_from`,
  `ForecastOut.projected_from`, `ForecastOut.recurrences_projected`,
  `ForecastOut.pooled_scale_cents`, `ForecastOut.seasonal_scale_cents`.
- `backend/app/api/cashflow.py` — `_ledger_span_months` helper, `_rate_out`
  helper, both routes now set `projected_from` from their own `today`.
- `backend/tests/test_cashflow_api.py` — 4 new tests, 1 test extended with an
  additional assertion (`ledger_span_months == 13` on the operator fixture).

### Self-review, this round

- Re-ran `ruff check` on all touched files: clean.
- Confirmed `git status` before committing: only the three files this round
  touched.
- Deliberately chose `ledger_span_months` as *raw calendar arithmetic on
  primitive dates already in scope* rather than adding new pure-engine logic
  for it — `history.date_from`/`history.date_to` are already fetched in the
  router, and the computation has no business rule to get wrong (no
  "complete month" judgment call, unlike `complete_months`), so it belongs at
  the router boundary rather than manufacturing a new engine function for
  two lines of arithmetic.
