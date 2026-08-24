# Task 13 Report: Temporal / category aggregation engine

## What was implemented

Created the pure aggregation engine for Yieldo's charts and summaries:

- `backend/app/engines/__init__.py` — empty package marker.
- `backend/app/engines/aggregate.py` — the engine itself, implemented verbatim from the
  brief's Step 3 reference code:
  - `TxPoint` (frozen dataclass): `on: date, amount_cents: int, category_id: int | None,
    account_id: int, is_transfer: bool = False`.
  - `Granularity = Literal["day", "week", "month", "quarter", "year"]`.
  - `bucket_key(on, granularity) -> str` — `2025-03-04` / `2025-W10` / `2025-03` /
    `2025-Q1` / `2025`. Uses `date.isocalendar()` for ISO week numbers so a late-December
    date correctly rolls into next year's week 1 (`2025-12-29` -> `2026-W01`).
  - `bucket_bounds(key, granularity) -> tuple[date, date]` — inverse of `bucket_key`. Uses
    `date.fromisocalendar()` for weeks and `calendar.monthrange()` for month/quarter end
    dates, so leap-year Februarys end on the 29th.
  - `_next_bucket_start(current, granularity) -> date` — internal helper for walking the
    calendar forward one bucket at a time (handles December -> January and
    quarter/year rollovers via `(month - 1) % 12 + 1`-style arithmetic).
  - `aggregate_series(points, granularity, include_transfers=False) -> list[BucketTotals]`
    — buckets transactions, splitting each bucket into `inflow_cents` (sum of
    non-negative amounts) and `outflow_cents` (sum of negative amounts), plus `net_cents`
    and `count`. Sorted chronologically by bucket key. Transfers excluded unless
    `include_transfers=True`.
  - `aggregate_by_category(points, include_transfers=False) -> list[CategoryTotal]` —
    expense-only (positive amounts skipped entirely), `share` computed against the total
    of expense magnitudes, sorted by `abs(total_cents)` descending.
  - `fill_missing_buckets(series, granularity, start, end) -> list[BucketTotals]` —
    inserts zero-valued buckets for gaps so a chart shows a flat period rather than a
    hole.
  - `compare_periods(current_cents, previous_cents) -> PeriodComparison` — `delta_cents`
    plus `delta_ratio` (`None`, not `0.0`, when the baseline is zero).
  - `moving_average(values, window) -> list[float]` — trailing average; raises
    `ValueError` for `window <= 0`.
- `backend/tests/test_aggregate.py` — 22 tests covering bucket-key/bounds parametrized
  cases (including the ISO-week rollover and leap-year cases called out in the brief),
  monthly inflow/outflow splitting, transfer exclusion (default vs. `include_transfers`),
  chronological ordering, yearly/quarterly rollups, gap-filling, category totals/shares/
  sorting, period comparison (including zero baseline), and moving average (including the
  window<=0 rejection).

The engine imports only `calendar`, `dataclasses`, `datetime`, and `typing` — no
`app.db`, `app.models`, or network code. No implicit clock: every function that needs
"today" takes it as a parameter (none of these functions currently need one).

## Test-first sequence

1. Wrote `backend/tests/test_aggregate.py` (brief's Step 1 content, later amended — see
   Deviation below).
2. Confirmed failure:
   ```
   cd backend && ./.venv/Scripts/pytest.exe tests/test_aggregate.py -v
   ```
   Result: `ModuleNotFoundError: No module named 'app.engines'` — collection error, 0
   tests ran. Confirmed-fail step done before any implementation code existed.
3. Implemented `backend/app/engines/aggregate.py` and `backend/app/engines/__init__.py`
   verbatim from the brief's Step 3 code block.
4. Re-ran the tests — one failure (see Deviation below), fixed the test, re-ran to green.
5. Ran `ruff check` — one auto-fixable import-order issue in the test file (see
   Deviation below), fixed with `ruff check --fix`.
6. Final run, and a full-suite sanity check:
   ```
   cd backend && ./.venv/Scripts/pytest.exe tests/test_aggregate.py -v
   ```
   Output: `22 passed, 1 warning in 0.07s` (all `test_aggregate.py` tests green; the one
   warning is the pre-existing `StarletteDeprecationWarning` about httpx/starlette,
   unrelated to this task).
   ```
   cd backend && ./.venv/Scripts/pytest.exe -q
   ```
   Output: `173 passed, 58 warnings in 6.45s` — full backend suite green, nothing else
   broken.
   ```
   cd backend && ./.venv/Scripts/python.exe -m ruff check app/engines/ tests/test_aggregate.py
   ```
   Output: `All checks passed!`

## Deviations from the brief (and why)

1. **Fixed a self-contradictory assertion in `test_yearly_and_quarterly_rollups`.** The
   brief's literal test code asserts:
   ```python
   assert aggregate_series(_points(), "year")[0].net_cents == 595500
   quarters = {b.key: b for b in aggregate_series(_points(), "quarter")}
   assert quarters["2025-Q1"].net_cents == 595500
   assert quarters["2025-Q2"].net_cents == -500
   ```
   All of `_points()`'s non-transfer transactions fall in 2025, so the single `"2025"`
   year bucket must equal the sum of all quarter buckets for that year: Q1 (595500) + Q2
   (-500) = **595000**, not 595500. I verified this by hand and in Python
   (`sum([-1000, -2000, 300000, -1500, 300000, -500]) == 595000`). Running the brief's
   own Step 3 reference implementation against the brief's own Step 1 test reproduces
   this exact mismatch (`AssertionError: assert 595000 == 595500`), so this is a bug in
   the brief's fixture, not an implementation defect — no correct, internally consistent
   aggregation can satisfy both the year assertion and the quarter assertions as
   originally written. I changed the year assertion to `595000` and added a one-line
   comment explaining the arithmetic; the quarter assertions are untouched. Please have
   the plan's author double check this fixture if the brief is reused elsewhere.
2. **Reordered one import block via `ruff check --fix`.** The brief's literal test file
   has a multi-name `from app.engines.aggregate import (...)` on two lines, which
   violates the project's `I001` (import sorting) rule enforced by `ruff` — this is the
   only lint finding anywhere in the backend tree once the new files were added. Per the
   task instructions ("this task should need no new ignore"), I did not add a
   per-file-ignore; I ran `ruff check --fix` to reformat the import into one name per
   line (alphabetically sorted), which is purely cosmetic and does not change behavior.
   `backend/app/engines/aggregate.py` needed no changes for lint.
3. **Test count.** The brief's Step 4 says "Expected: 24 tests PASS"; the actual
   collected/passing count is 22 (6 `bucket_key` parametrizations + 5 `bucket_bounds`
   parametrizations + 11 non-parametrized tests = 22). This is just a stated-count typo
   in the brief, not a functional issue — every test named in Step 1 is present and
   passing.

No other deviations. `bucket_key`/`bucket_bounds`/`aggregate_series`/
`aggregate_by_category`/`fill_missing_buckets`/`compare_periods`/`moving_average` and the
four dataclasses were implemented exactly as specified in the brief's Step 3 code.

## Notes for Task 14

- `app/api/analytics.py` should import from `app.engines.aggregate` and convert ORM
  `Transaction` rows into `TxPoint` tuples (`on`, `amount_cents`, `category_id`,
  `account_id`, `is_transfer`) before calling `aggregate_series` /
  `aggregate_by_category` / etc. The engine takes no session and does no queries itself
  by design — that conversion is entirely Task 14's responsibility.
  - Do not use `moving_average` for stored/aggregated cent totals — it deliberately
    returns `float`, per the phase-1 global constraint that only this function is exempt
    from the integer-cents rule.
- `include_transfers=False` is the default everywhere; Task 14's endpoints should only
  flip it to `True` if there's an explicit, deliberate reason (e.g. an "all movements"
  view) — the default keeps a savings transfer from being double-booked as both expense
  and income.
- `compare_periods(current_cents, previous_cents).delta_ratio` is `None` when
  `previous_cents == 0`. Any serializer/schema built on top of `PeriodComparison` in
  Task 14 needs to handle that `None` (e.g. render "n/a" rather than a fabricated 0%
  change) rather than coercing it to a number.
- `fill_missing_buckets` expects `series` to already be produced by `aggregate_series`
  with the same `granularity`; it does not re-derive or validate granularity consistency
  itself.

## Commit

```
5a6cb8ce0e738859c2d2638fa73cc0a9c8b54867  feat(engines): add time and category aggregation engine
```

Staged and committed only the three new files (`backend/app/engines/__init__.py`,
`backend/app/engines/aggregate.py`, `backend/tests/test_aggregate.py`) — no
`git add -A`, and `docs/superpowers/plans/` was left untouched.
