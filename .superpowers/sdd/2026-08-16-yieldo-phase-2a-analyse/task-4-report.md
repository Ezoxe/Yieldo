# Task 4 report: Budget engine

## Summary

Implemented `backend/app/engines/budget.py`, the pure engine for monthly
budget consumption, remaining amount, month-pace projection and status
(`ok` / `at_risk` / `over`). Followed `task-4-brief.md` verbatim — both the
test file and the implementation are the exact code the brief pinned, with
no deviations.

## Files changed

- `backend/app/engines/budget.py` (new) — `BudgetEntry`, `BudgetLine`,
  `BudgetStatus`, `days_in_month`, `elapsed_days`, `evaluate_budget`
  (internal helper), `evaluate_budgets`.
- `backend/tests/test_budget.py` (new) — 12 tests.

Committed as `4ee9c08 feat(engines): add monthly budget consumption with a pace projection`.

## TDD evidence

**1. Failing test first.** Wrote `backend/tests/test_budget.py` (verbatim
from the brief) before any implementation existed, then ran:

```
cd backend && .venv/Scripts/pytest.exe tests/test_budget.py -v
```

Result — collection error, exactly as the brief predicted:

```
ERROR collecting tests/test_budget.py
ImportError while importing test module 'E:\Projet\Github\Yieldo\backend\tests\test_budget.py'.
tests\test_budget.py:5: in <module>
    from app.engines.budget import (
E   ModuleNotFoundError: No module named 'app.engines.budget'
1 error in 0.25s
```

This is the expected failure: the module referenced by the test did not
exist yet, so nothing about the engine's logic was exercised — only that the
import target was absent.

**2. Implementation.** Created `backend/app/engines/budget.py` verbatim from
the brief's Step 3 code block.

**3. Passing test.** Re-ran the same command:

```
cd backend && .venv/Scripts/pytest.exe tests/test_budget.py -v
```

```
tests/test_budget.py::test_days_in_month_handles_a_leap_february PASSED
tests/test_budget.py::test_elapsed_days_counts_today_and_never_exceeds_the_month PASSED
tests/test_budget.py::test_a_finished_month_under_budget_is_ok_and_projects_nothing PASSED
tests/test_budget.py::test_spending_past_the_budget_is_over_and_remaining_goes_negative PASSED
tests/test_budget.py::test_a_month_on_pace_to_overrun_is_at_risk_before_it_overruns PASSED
tests/test_budget.py::test_a_month_on_pace_to_land_inside_the_budget_is_ok PASSED
tests/test_budget.py::test_two_days_into_the_month_no_pace_is_claimed PASSED
tests/test_budget.py::test_the_pace_floor_is_exactly_one_fifth_of_the_month PASSED
tests/test_budget.py::test_a_month_not_yet_started_projects_nothing PASSED
tests/test_budget.py::test_overspending_wins_over_pace PASSED
tests/test_budget.py::test_a_budget_of_zero_is_rejected_rather_than_divided_by PASSED
tests/test_budget.py::test_lines_come_back_in_the_order_they_were_given PASSED
======================== 12 passed, 1 warning in 0.05s ========================
```

**4. Full backend suite, with coverage:**

```
cd backend && .venv/Scripts/pytest.exe -v --cov=app --cov-report=term-missing
```

```
app\engines\budget.py               46      0   100%
...
TOTAL                             1842     88    95%
306 passed, 170 warnings in 22.54s
```

A plain `-q` rerun immediately after confirms: `306 passed, 170 warnings in 13.97s`.

`app/engines/budget.py` is at 100% line coverage (46/46 statements) — well
above the ≥80% floor for `app/engines`.

Note: the brief's own Step 5 predicted "297 passed" after this task. The
task prompt's stated baseline was 294 tests; 294 + 12 new tests = 306, which
is what both runs above show. The "297" figure in the brief text is
internally inconsistent with its own stated baseline — not a sign anything
here is wrong. 306 is the correct, green count.

## What the engine does

- `days_in_month(month_start)` — days in that calendar month via
  `calendar.monthrange`, correctly handling leap Februaries.
- `elapsed_days(month_start, today)` — days of the month lived so far,
  counting today, clamped to `[0, days_in_month]` so a month in the past
  reads as fully elapsed and a month in the future reads as untouched.
- `evaluate_budgets(entries, month_start, today)` — for each `BudgetEntry`:
  - `remaining_cents = budget_cents - abs(spent_cents)` (positive while
    under budget, negative once past it — the reading a user expects from
    "remaining", not the outflow-negative convention used elsewhere).
  - `consumed_ratio = abs(spent_cents) / budget_cents` — a float ratio, not
    money, per CLAUDE.md's "a ratio may be a float; a projected spend may
    not" distinction the task brief called out.
  - `projected_cents` — a full-month projection at the current daily pace,
    computed in integer cents (`spent * total_days // elapsed`, never
    passing through a float), but only when the month is between 1/5 elapsed
    and not yet finished. Below that floor (fewer than ~7 days into a
    31-day month) or once the month is over, `projected_cents` is `None`
    rather than a confident-looking but dishonest number.
  - `status` — `"over"` once spending has actually passed the ceiling
    (checked first, so overspending always wins over a pace-based verdict);
    `"at_risk"` when no overspend yet but the projection would exceed the
    ceiling; `"ok"` otherwise, including every case where no projection is
    possible.
- `BudgetEntry.budget_cents <= 0` raises `ValueError` with a French message
  ("Un budget mensuel doit être strictement positif") before any division
  happens — no silent divide-by-zero, no fallback value.

## Self-review

- **Completeness against the brief:** every symbol in the brief's
  "Produces" list exists with the exact signature specified
  (`BudgetEntry`, `BudgetLine`, `BudgetStatus`, `days_in_month`,
  `elapsed_days`, `evaluate_budgets`). `evaluate_budget` (singular) is an
  internal helper not in the "Produces" list but is part of the brief's own
  pinned code — kept as-is since the brief pins the implementation verbatim.
- **Naming:** consistent with the sign-convention language used in
  `robust.py` and `period.py` (outflow negative, docstrings explaining the
  one place the convention is deliberately broken). No renames made.
- **YAGNI:** the module contains only what task 5 needs per the brief; no
  API wiring, no DB access, no speculative helpers added.
- **Money/float discipline (CLAUDE.md):** `budget_cents`, `spent_cents`,
  `remaining_cents`, `projected_cents` are all `int`. `consumed_ratio` is
  the one intentional `float`, and it is a ratio, never a monetary amount —
  matches the task brief's explicit carve-out.
- **No silent failures:** the only failure mode (zero or negative budget)
  raises `ValueError` in French rather than returning a fallback or
  dividing by zero.
- **Do the tests verify real behaviour?** Yes, with one caveat: two tests
  (`test_a_month_on_pace_to_overrun_is_at_risk_before_it_overruns` and
  `test_a_month_on_pace_to_land_inside_the_budget_is_ok`) assert
  `projected_cents == -(spent * total_days // elapsed)`, the same formula
  the implementation uses. This is inherent to the brief (both files were
  pinned verbatim, so the test's expected value and the implementation's
  computation share a formula by construction) rather than something
  introduced here. The other ten tests are true behavioural checks: the
  pace floor boundary (day 6 vs day 7), status transitions (`ok`→`at_risk`,
  `at_risk` losing to `over`), sign/clamp edge cases on `elapsed_days`, the
  zero-budget rejection, and result ordering are all independent of the
  internal formula and would catch a genuine regression.
- **Ran `git status` after staging:** only `backend/app/engines/budget.py`
  and `backend/tests/test_budget.py` were staged and committed; the
  pre-existing untracked plan doc
  (`docs/superpowers/plans/2026-08-16-yieldo-phase-2a-analyse.md`) was left
  untouched, as it predates this task.

## Concerns

None blocking. The only note-worthy item is the brief's internally
inconsistent "297 passed" prediction in Step 5, addressed above — the
actual, correct, green count is 306.

---

## Fix round (review findings on `4ee9c08`)

Three review findings against `backend/app/engines/budget.py`, fixed on top
of `8e64d94`. Original implementer's session had ended; this round was done
by a separate fix session.

### Finding 1 (Important) — unguarded sign silently turns a refund into a spend

**Problem:** `abs(entry.spent_cents)` at the old line 76 accepted a positive
`spent_cents` (a category netting positive — e.g. a refund exceeding this
month's spend) and silently coerced it into a "spent" figure, feeding a false
number into `remaining_cents`, `consumed_ratio`, `projected_cents`, and
`status`. Nothing enforced the docstring's stated invariant that
`spent_cents` is negative.

**Fix:** `_evaluate_budget` (see finding 2 for the rename) now asserts the
sign instead of coercing it: `if entry.spent_cents > 0: raise ValueError(...)`
with a French message, mirroring the existing `budget_cents <= 0` guard.
`spent = -entry.spent_cents` replaces `spent = abs(entry.spent_cents)` — now
only reachable once `spent_cents <= 0` is established, so the negation is
unambiguous rather than a silent sign-flip of unknown input.

**Decision on `spent_cents == 0`:** explicitly *not* rejected. A budgeted
category with nothing spent yet this month is the ordinary, expected case,
not an error — only `spent_cents > 0` (net income) is refused. Pinned by
`test_zero_spent_cents_is_the_ordinary_no_spend_case_and_does_not_raise`.

**RED** — `cd backend && .venv/Scripts/pytest.exe tests/test_budget.py -v`,
before the fix, with the new
`test_a_positive_spent_cents_is_rejected_rather_than_coerced` test added:

```
tests/test_budget.py::test_a_positive_spent_cents_is_rejected_rather_than_coerced FAILED

    with pytest.raises(ValueError):
>       ...
E       Failed: DID NOT RAISE ValueError
```

This is the expected failure: the old `abs()` line accepted a positive
`spent_cents` (`100`) without complaint, so `pytest.raises(ValueError)` never
saw an exception. It shows the exact behaviour the finding described — a
positive input passing through silently — not a coincidental failure.

(The zero-spend pinning test already passed at this point, since zero was
never rejected by the old code either — it's a characterization test for the
decision above, not a regression test for a bug.)

**GREEN** — same command after the fix: `test_a_positive_spent_cents_is_rejected_rather_than_coerced PASSED`,
`test_zero_spent_cents_is_the_ordinary_no_spend_case_and_does_not_raise PASSED`.

### Finding 2 (Minor) — internal helper was public

**Problem:** `evaluate_budget` (singular) was a public name despite not
being in the brief's "Produces" list, so nothing stopped a future caller
(task 5) from reaching for it directly and losing the "elapsed/total_days
computed once, shared across entries" design that `evaluate_budgets`
(plural) provides.

**Fix:** renamed to `_evaluate_budget`, updated its one call site inside
`evaluate_budgets`, and added a short docstring stating it is internal.

**RED** — same run as above, with
`test_evaluate_budget_singular_is_an_internal_helper_not_a_public_name` added:

```
tests/test_budget.py::test_evaluate_budget_singular_is_an_internal_helper_not_a_public_name FAILED

>       assert not hasattr(budget_module, "evaluate_budget")
E       AssertionError: assert not True
E        +  where True = hasattr(<module 'app.engines.budget' ...>, 'evaluate_budget')
```

Expected: the module still exported the public singular name at this point.

**GREEN** — after the rename: `test_evaluate_budget_singular_is_an_internal_helper_not_a_public_name PASSED`
(`evaluate_budget` absent, `_evaluate_budget` present).

### Finding 3 (Minor) — untested boundary where code and prose disagreed

**Problem:** `spent >= entry.budget_cents` classifies spending exactly equal
to the budget as `"over"` (`remaining_cents == 0`), which read as being at
odds with the field comment "negative once past it" — the comment implied
`remaining_cents` only signals a breach once it goes negative, but the code
already calls it a breach at zero.

**Decision:** keep the current behaviour — exactly at the ceiling counts as
`"over"`, the safer direction for a budget alert — and correct the comment to
match, rather than change the `>=` to `>`.

**Test:** `test_spending_exactly_the_budget_is_over_with_remaining_at_zero`
pins `status == "over"` and `remaining_cents == 0` at `spent_cents == -BUDGET`.
This test passes both before and after the fix — there was no behavioural
bug here, only an undocumented boundary and a stale comment, exactly as the
finding characterized it ("plausible product choice, but no test pins down
which way it is supposed to go"). No RED/GREEN pair applies; the test simply
now exists and is green, and the comment was corrected alongside it.

**Comment fix:** `BudgetLine.remaining_cents` field comment changed from
"Positive while under the ceiling, negative once past it." to "Positive
while under the ceiling; zero once the ceiling is reached, negative once it
is exceeded. Zero already counts as breached (see `status`), the safer
reading of a budget." The module docstring's sign-convention paragraph was
extended to state the same thing and to state the `spent_cents` sign
invariant is now enforced, not merely advisory.

### Files changed

- `backend/app/engines/budget.py` — `_evaluate_budget` rename (was
  `evaluate_budget`), positive-`spent_cents` guard replacing `abs()`,
  updated docstring/comments for `spent_cents` and `remaining_cents`.
- `backend/tests/test_budget.py` — four new tests: positive-`spent_cents`
  rejection, zero-`spent_cents` non-rejection, internal-helper naming, and
  the exactly-at-budget boundary.

### Full suite

```
cd backend && .venv/Scripts/pytest.exe -v --cov=app --cov-report=term-missing
```

```
app\engines\budget.py               48      0   100%
...
TOTAL                             1844     88    95%
310 passed, 170 warnings in 25.10s
```

306 baseline + 4 new tests = 310, all green. `app/engines/budget.py` stays
at 100% line coverage (48/48 statements, up from 46 because of the new
guard clause).

### Scope

Touched only `backend/app/engines/budget.py` and
`backend/tests/test_budget.py`, as instructed — no API wiring (task 5) or
screen (task 6) work.
