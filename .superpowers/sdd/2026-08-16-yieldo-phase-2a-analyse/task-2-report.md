# Task 2 report — Shared route helpers

## What was implemented

Extracted `api/analytics.py`'s two private helpers into a new shared module,
per the brief verbatim:

- `backend/app/api/common.py` — `period_range`, `tx_points`, `recurrence_points`,
  `anomaly_points`, `liquid_balance_cents`, `LIQUID_ACCOUNT_KINDS`. Every
  function takes `user_id` as a required positional argument and filters on
  it; there is no code path in this module that reads across users.
- `backend/app/engines/recurrence.py` — `RecurringTx` frozen dataclass
  (input shape only; task 7 adds the detection algorithm).
- `backend/app/engines/anomaly.py` — `AnomalyTx` frozen dataclass (input
  shape only; task 16 adds the scorer).
- `backend/app/api/analytics.py` — `_points`/`_period` deleted; their four
  call sites each renamed to `tx_points`/`period_range` (imported from
  `app.api.common`), with no other line touched. `_period_totals` (a
  different, still-private helper) is untouched except for the one line
  where it calls the renamed `tx_points`.
- `backend/tests/test_api_common.py` — the 8 tests from the brief, copied
  verbatim.

## TDD evidence

**Before** — `pytest tests/test_api_common.py -v`:
```
ModuleNotFoundError: No module named 'app.api.common'
ERROR tests/test_api_common.py
!!!!!!!!!!!!!!!!!!! Interrupted: 1 error during collection !!!!!!!!!!!!!!!!!!!!
```
Expected and correct: the module didn't exist yet.

**After implementing `app/engines/recurrence.py`, `app/engines/anomaly.py`,
and `app/api/common.py`** — `pytest tests/test_api_common.py -v`:
```
8 passed, 1 warning in 0.50s
```

**After rewiring `app/api/analytics.py`** —
`pytest tests/test_api_common.py tests/test_analytics_api.py -v`:
```
28 passed, 41 warnings in 2.62s
```
`test_analytics_api.py` has a clean `git diff` (empty) — it is byte-for-byte
the file that shipped in phase 1.5; nothing in it changed and it stayed green.

**Full suite** — `pytest -v --cov=app --cov-report=term-missing`:
```
280 passed, 168 warnings in 20.97s
TOTAL coverage: 95% (1780 stmts, 89 miss)
```
Baseline was 272 tests (per the task instructions); this task added the 8
in `test_api_common.py`, landing at 280 — matches exactly. (The brief's own
math, "279 (271 + 8)", undercounts the baseline by one; not a discrepancy in
my work, just an off-by-one in the brief's arithmetic.)

Coverage for the files this task touches:
- `app/api/common.py`: 95% (38 stmts, 2 missed — lines 68 and 148)
- `app/api/analytics.py`: 100%
- `app/engines/recurrence.py`: 100%
- `app/engines/anomaly.py`: 100%

The two missed lines in `common.py` are the `account_id` filter branch of
`tx_points` and the "no liquid accounts" early return of
`liquid_balance_cents`. Neither is newly uncovered: `test_analytics_api.py`
never exercised `/analytics/series?account_id=...` before this refactor
either (confirmed by grep — no test in that file references `account_id`
at all), so this gap simply moved with the code, it wasn't introduced by it.
CLAUDE.md's ≥80% coverage gate names `app/engines` and `app/importers`
specifically, not `app/api`, so this doesn't fail the project's own bar.

## Files changed

- `backend/app/api/common.py` (new)
- `backend/app/engines/recurrence.py` (new)
- `backend/app/engines/anomaly.py` (new)
- `backend/app/api/analytics.py` (modified — imports and four call sites only)
- `backend/tests/test_api_common.py` (new)

Commit: `1f45697` — `refactor(api): extract the shared user-filtered fetch
helpers into api/common`

## Self-review

- **Every existing caller still passes the same arguments?** Yes. Diffed
  `git diff backend/app/api/analytics.py` line by line: the only changes are
  import lines, the deletion of the two function bodies, and four call-site
  renames (`_period(` → `period_range(`, `_points(` → `tx_points(`) with
  identical argument lists at every site. `_period_totals` (a separate,
  still-private helper untouched by the brief) only had its one internal
  call to `_points` renamed to `tx_points`; its own signature and callers
  (`summary`) are unchanged.
- **Did the extraction change any default?** No. `tx_points`'s `account_id`
  keeps its `= None` default; `period_range`/`tx_points` signatures were
  copied verbatim from `_period`/`_points`, including argument order.
- **Is the tenant filter impossible to omit at every new call site?** Yes.
  `user_id` is a required (non-defaulted) positional parameter on all five
  public functions in `common.py`, and every SQLAlchemy query in the module
  filters on it directly — `recurrence_points` and `anomaly_points` filter
  `Transaction.user_id == user_id` before excluding transfers;
  `liquid_balance_cents` filters `Account.user_id == user_id` when resolving
  the account set and filters on `user_id` again (belt-and-suspenders) on
  both the opening-balance and movements queries, even though the
  `account_id in (...)` clause would already scope it correctly (checked:
  `account_ids` is derived from a user_id-filtered account query).
- Ran `ruff check` on all five changed/new files: clean.
- Confirmed via grep that no code outside `api/analytics.py` referenced the
  old `_points`/`_period` names (the `_points()` helper in
  `tests/test_aggregate.py` is an unrelated, module-local fixture builder in
  that test file, not the one being extracted).

## Concerns

None. `api/analytics.py`'s behaviour is provably unchanged: `git diff`
against the pre-task commit (`3c96e50`) shows only the two deletions and
four mechanical renames, `test_analytics_api.py` is byte-identical to its
phase-1.5 version and still passes all 20 of its tests, and the load-bearing
"absent bound means whole history, not the current calendar year" behaviour
in `period_range` (née `_period`) is copied verbatim, docstring included,
with `resolve_range` and `date.today()` called in the same order with the
same arguments as before.

---

## Fix report — cross-tenant hardening (review follow-up)

The review on commit `1f45697` flagged an Important gap: only
`recurrence_points` had a dedicated "insert a second user's row, prove it's
excluded" test. `tx_points`, `anomaly_points`, `liquid_balance_cents`, and
`period_range` were only exercised single-tenant, even though this module
exists specifically to centralize the `user_id` filter for four upcoming
routers. Also flagged, a Minor: `liquid_balance_cents` had no test proving
it returns `0` for a user with no liquid accounts at all.

### What was added

Five new tests in `backend/tests/test_api_common.py`, in the same shape as
the existing `test_recurrence_points_never_cross_users`:

- `test_tx_points_never_cross_users`
- `test_anomaly_points_never_cross_users`
- `test_liquid_balance_never_crosses_users`
- `test_liquid_balance_is_zero_for_a_user_with_no_liquid_accounts_at_all` (closes the Minor)
- `test_period_range_never_widens_with_another_users_older_history` — asserts
  the case the review called out specifically: a second user's older
  transaction (2020-01-01) must not push *this* user's defaulted start date
  back past their own earliest transaction (2025-06-01).

No production code changed as part of adding these tests — the module
already filters correctly, so this is pure hardening.

### Mutation check (per the review's instruction)

For each of the four cross-tenant tests, the corresponding `user_id` filter
was temporarily dropped from the source, the single new test was run to
confirm it goes red, then the filter was restored and the test re-run to
confirm green. Evidence below; each mutation was reverted immediately after
its check (confirmed via `git diff` showing zero changes to `common.py` /
`history.py` once all four checks were done).

**1. `tx_points`** — dropped `Transaction.user_id == user_id` from the base
query in `app/api/common.py`.

Red:
```
$ .venv/Scripts/pytest.exe tests/test_api_common.py::test_tx_points_never_cross_users -v
FAILED tests/test_api_common.py::test_tx_points_never_cross_users
assert [-1549, -9999] == [-1549]
```
Green after restoring the filter:
```
tests/test_api_common.py::test_tx_points_never_cross_users PASSED
1 passed, 1 warning in 0.13s
```

**2. `anomaly_points`** — dropped `Transaction.user_id == user_id` from its
query filter in `app/api/common.py`.

Red:
```
$ .venv/Scripts/pytest.exe tests/test_api_common.py::test_anomaly_points_never_cross_users -v
FAILED tests/test_api_common.py::test_anomaly_points_never_cross_users
assert [-1549, -9999] == [-1549]
```
Green after restoring the filter:
```
tests/test_api_common.py::test_anomaly_points_never_cross_users PASSED
1 passed, 1 warning in 0.13s
```

**3. `liquid_balance_cents`** — dropped `Account.user_id == user_id` /
`Transaction.user_id == user_id` from all three queries in the function
(account-id lookup, opening-balance sum, movements sum) in `app/api/common.py`.

Red:
```
$ .venv/Scripts/pytest.exe tests/test_api_common.py::test_liquid_balance_never_crosses_users -v
FAILED tests/test_api_common.py::test_liquid_balance_never_crosses_users
assert 1000000 == 100000
```
(1,000,000 = mine's 100,000 + theirs' 900,000 opening balances, summed
together once the filter was gone — exactly the cross-tenant leak the test
targets.) Green after restoring the filters:
```
tests/test_api_common.py::test_liquid_balance_never_crosses_users PASSED
tests/test_api_common.py::test_liquid_balance_is_zero_for_a_user_with_no_liquid_accounts_at_all PASSED
2 passed, 1 warning in 0.17s
```

**4. `period_range`** — `period_range` has no query of its own; its tenant
boundary is entirely `user_history`'s. Dropped `Transaction.user_id ==
user_id` from `user_history`'s query in `app/api/history.py`.

Red:
```
$ .venv/Scripts/pytest.exe tests/test_api_common.py::test_period_range_never_widens_with_another_users_older_history -v
FAILED tests/test_api_common.py::test_period_range_never_widens_with_another_users_older_history
AssertionError: assert (datetime.date(2020, 1, 1), datetime.date(2025, 6, 1)) == (datetime.date(2025, 6, 1), datetime.date(2025, 6, 1))
```
(The other user's 2020 transaction leaked in and widened the start date —
exactly the failure mode the review asked this test to catch.) Green after
restoring the filter:
```
tests/test_api_common.py::test_period_range_never_widens_with_another_users_older_history PASSED
1 passed, 1 warning in 0.12s
```

Each of the four new cross-tenant tests would fail without the filter it
exists to guard, so none of them would pass by coincidence.

### Full suite, after hardening

`pytest -v --cov=app --cov-report=term-missing` from `backend/`:
```
285 passed, 168 warnings in 21.11s
TOTAL coverage: 95% (1780 stmts, 88 miss)
```
280 (previous total) + 5 new tests = 285. `app/api/common.py` coverage rose
from 95% to 97% (38 stmts, 1 miss instead of 2) — the "no liquid accounts"
early return is now exercised; the one remaining gap is the `account_id`
filter branch of `tx_points`, unrelated to this fix and pre-existing (see
the original report above).

`ruff check` on the touched files: clean.

### Files changed in this fix

- `backend/tests/test_api_common.py` (5 new tests; no other file has a net
  diff — `common.py` and `history.py` were mutated and restored during the
  check above, confirmed identical to `1f45697` via `git diff`)

Commit: `47c04d5` — `test(api): add cross-tenant coverage for the api/common fetch helpers`
