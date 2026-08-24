# Task 10 report: measured rate and runway engines

## What was implemented

Two new pure engines, exactly as specified in the interfaces section of the
brief:

- `backend/app/engines/capacity.py` — `MonthlyEntry`, `MonthObservation`,
  `MeasuredRate`, `complete_months`, `measure_expense_rate`,
  `measure_savings_capacity`, `MIN_MONTHS_FOR_RATE = 3`.
- `backend/app/engines/runway.py` — `RunwayScenario`, `RunwayReport`,
  `compute_runway`.
- `backend/tests/test_capacity.py` (11 tests) and
  `backend/tests/test_runway.py` (9 tests).

The brief included full source for both modules and both test files. I
independently traced every assertion in the given tests against the given
implementation by hand (median/MAD arithmetic, month-boundary logic, runway
day rounding) before typing anything, since the task explicitly warned that
earlier briefs in this plan had stale or self-contradictory math. Everything
checked out — the shipped code below is the brief's code, unmodified, plus
one additional test (see next section).

## TDD evidence

**Before** — test files written first, module absent:

```
$ .venv/Scripts/pytest.exe tests/test_capacity.py tests/test_runway.py -v
...
ModuleNotFoundError: No module named 'app.engines.capacity'
ModuleNotFoundError: No module named 'app.engines.capacity'
Interrupted: 2 errors during collection
```

Both failures are the expected one: the engines did not exist yet.

**After** — `capacity.py` and `runway.py` created:

```
$ .venv/Scripts/pytest.exe tests/test_capacity.py tests/test_runway.py -v
...
19 passed, 1 warning in 0.10s
```

Then I added one more test (`test_the_operators_eight_empty_months_are_excluded_not_zeroed`,
see below), re-ran, added it to green: 11 capacity + 9 runway = 20 new tests.

**Full suite:**

```
$ .venv/Scripts/pytest.exe -v --cov=app --cov-report=term-missing
...
app\engines\capacity.py             51      0   100%
app\engines\runway.py               36      0   100%
...
TOTAL                             2220     88    96%
393 passed, 219 warnings in 51.41s
```

Baseline was 373 (per the task instructions), now 393 = 373 + 20 new. Ruff
(`ruff check`) is clean on all four new files.

## The explicit "eight empty months" test (task requirement 3)

The brief's own `test_the_operators_shape_yields_exactly_three_observed_months`
already exercises this shape implicitly — its entries span Jan 2025 (partial)
through Jan 2026 (partial) and only touch Feb/Mar/Dec, so April–November 2025
are the eight silently-absent months, and the assertion `len(...) == 3` proves
they are not being counted. But that test doesn't say so explicitly, so per
the task's requirement I added a dedicated test that:

- enumerates the eight empty month keys (`2025-04` .. `2025-11`) by name,
- asserts none of them appear in `complete_months`'s output and that every
  returned observation has `count > 0`,
- computes the actual measured rate (median 180 000 cents from the three real
  months: 90 000 / 180 000 / 210 000),
- and contrasts it against what the median *would* be if the eight empty
  months had instead been folded in as zero-spend observations (an
  11-month sample with 8 zeros, median 0) — demonstrating concretely that
  the naive approach collapses the rate to zero while the engine's approach
  does not.

This is the test the task description's honesty requirement is about, made
explicit rather than left implicit.

## What each engine returns on the operator's actual data shape

Ledger `2025-01-24` .. `2026-01-09`, statements only in Feb, Mar and Dec 2025
(the other eight months of 2025 hold no statement, and Jan 2025 / Jan 2026 are
partial weeks at the ledger's edges):

- `complete_months` returns exactly 3 `MonthObservation`s (`2025-02`,
  `2025-03`, `2025-12`). The two partial months and the eight silent months
  are all excluded — the partial months because their calendar bounds
  straddle the ledger edge, the silent months because they never produce a
  bucket at all (no entries were assigned to them, so there is nothing to
  drop or zero — they simply never exist as an observation).
- `measure_expense_rate` and `measure_savings_capacity` both return a
  `MeasuredRate` with `months == 3`, because 3 meets `MIN_MONTHS_FOR_RATE`
  exactly — no more, no less. This matches the task's stated expected
  outcome: "runway computes but is flagged as measured on three complete
  months only."
- `compute_runway` therefore returns a populated `normal` scenario (and an
  `essentials` scenario, if the essential-only observation list also clears
  3 months) with `months_observed == 3`, so the screen built in task 12-14
  can render "mesuré sur 3 mois seulement" using that field directly rather
  than inferring it.
- Nothing here rounds a short runway to zero or throws: the module's own
  test (`test_the_operators_own_numbers_produce_a_very_short_runway`, taken
  from the brief) exercises a runway under a month and asserts it renders
  as a small positive float with a real depletion date, not a zero.

## Where the brief and the shipped code disagreed

Only a documentation-level discrepancy, no behavioral one:

- The brief's "Consumes" line lists
  `app.engines.robust.{describe, median_cents, quantile_offset_cents}`, but
  `capacity.py` only imports `describe` and `quantile_offset_cents` directly.
  `median_cents` is used internally by `describe()` (in `robust.py`), so
  there's no need for `capacity.py` to import it separately. Not a bug —
  just an overstated dependency line in the interfaces list. I left the
  imports as the brief's own source specified (no `median_cents` import),
  since that's what the shipped code actually uses.
- The brief's step 5 predicted "353 passed" as the whole-suite baseline
  before this task's tests were added. The actual pre-task baseline (per the
  task instructions themselves, and confirmed by running the suite before
  writing any code) was 373. This is exactly the kind of stale prediction
  the task description warned about (tasks 4/7/8/9's briefs had the same
  issue) — the suite is at 393 now (373 + 20), not 373 + 19 = 392, because I
  added the one extra explicit test described above.

Everything else — the month-boundary arithmetic, the median/MAD math, the
runway day-rounding, the zero-burn and zero-balance special cases — matched
the brief's own tests exactly when I traced them by hand before writing any
code, so no other departures were needed.

## Self-review

**What does each engine do on data it has never seen?**

- *Inverted or degenerate ledger bounds* (`ledger_start > ledger_end`):
  `complete_months` was not given an explicit test for this, so I traced it
  by hand. Every entry's date is either `< ledger_start` or `> ledger_end`
  whenever the range is inverted (there is no day that satisfies neither),
  so every entry is filtered at the per-entry check and the function returns
  an empty list — no crash, no fabricated observation. This mirrors the
  existing convention in `app/engines/period.py`'s `resolve_range`, which
  also handles nonsensical bounds by producing an honest (if unhelpful)
  result rather than raising. I left this as-is rather than adding a new
  `ValueError`, both because no test calls for it and because the orchestration
  layer (task 12) will derive these bounds from the caller's own transaction
  data (`min`/`max` of imported statement dates), where an inverted range
  cannot occur by construction. Worth a second look if a future caller ever
  passes user-supplied bounds instead of derived ones.
- *Zero-amount entries*: `complete_months` classifies an entry into `inflow`
  only if `amount_cents > 0` and into `outflow` only if `< 0`; a literal
  `0`-cent entry (unlikely from a real bank import, but not impossible) would
  increment `count` without touching `inflow_cents`/`outflow_cents`. This
  doesn't corrupt `net_cents` (zero contributes nothing either way) and
  `count` isn't consumed by `_measure`, so it's a harmless quirk rather than
  a defect — flagging it here rather than silently deciding it's fine.
- *`runway.compute_runway` when `essentials` alone is unmeasurable*: the
  `insufficient_reason` field is documented as "non-null exactly when
  neither scenario could be computed." If a household has a measurable
  `normal` rate (≥3 complete months) but its essential-only spending never
  clears 3 observed months (plausible if some months had zero
  essential-tagged transactions), `essentials` comes back `None` with no
  accompanying message — by design, per the brief's own doc comment, but
  worth flagging for whoever builds the screen in tasks 12-14: a `None`
  `essentials` next to a populated `normal` needs its own "pas mesurable"
  treatment distinct from the whole-report `insufficient_reason` string.

**Would a single large one-off purchase distort the measured rate, and
should it?**

No, by construction, and the brief's own
`test_one_extravagant_month_does_not_redefine_the_rate` proves it at 4
months. I additionally traced the case at the 3-month floor (the minimum
this module will ever accept): with months `[180 000, 190 000,
1 800 000]`, the median is still `190 000` — the middle-ranked value — because
a median depends only on rank order, not magnitude, so one extreme month
cannot move it regardless of how extreme it is. The same holds for the MAD
(`spread_cents`): sorted deviations `[0, 10 000, 1 610 000]` still yield a
median deviation of `10 000`, not something inflated by the outlier. So the
answer is: it should not distort the rate, and it does not — even at the
statutory minimum sample size, not just in the more comfortable 4+ month
case the brief's own test demonstrates.

## Files changed

- `backend/app/engines/capacity.py` (new)
- `backend/app/engines/runway.py` (new)
- `backend/tests/test_capacity.py` (new, 11 tests)
- `backend/tests/test_runway.py` (new, 9 tests)

## Concerns

None blocking. The two notes above (inverted-bounds handling, and the
`essentials`-only-unmeasurable message gap) are both non-issues for this
task's scope but worth a mention for whoever wires the API/screen in tasks
12-14.

---

# Fix report: response to code review (approved with 4 Important findings)

The review confirmed the two structural risks it checked (`bucket_bounds`'
inclusive last day, and the `abs()` at the old `capacity.py:115` being a sign
flip on a value provably `<= 0`) were absent, and confirmed both disclosed
brief discrepancies were documentation-only. It raised four Important
findings, all addressed below, on top of commit `fb9a0fe`. Four Minor findings
were explicitly left to the ledger per the review's own instruction (Python-
identity assertions in `test_capacity.py`, the zero-amount bucketing
divergence from `aggregate.py`, inverted bounds returning empty rather than
raising, and sub-day runway dating to `today`) -- no action taken on those.

## Finding 1 -- `insufficient_reason` was factually wrong on a reachable branch

**Problem.** `runway.py` set one combined `insufficient_reason` whenever both
scenarios were `None`, always phrased as a month-count shortfall
("il faut au moins 3 mois ... et l'historique en compte {len(all_months)}").
But a scenario can also come back `None` because the measured burn is not
positive (a household that nets non-negative every month) -- a completely
different cause. `test_a_household_that_spends_nothing_has_no_runway_to_quote`
already exercised exactly this branch (3 observed months, zero burn) and only
asserted `is not None`, so the self-contradictory sentence "il faut au moins
3 mois ... et l'historique en compte 3" passed green.

**Fix.** `_scenario` now returns `(RunwayScenario | None, reason: str | None)`
and picks between two distinct message-building functions,
`_reason_insufficient_history` (too few observed months) and
`_reason_no_measurable_burn` (enough months, but no positive median burn --
states the actual observed count as context, not as a shortfall claim).
`RunwayReport.insufficient_reason` is retired in favour of two fields,
`normal_unavailable_reason` and `essentials_unavailable_reason`, each `None`
exactly when the corresponding scenario succeeded -- this also directly
serves finding 4's request.

**Test (failing first).** Updated
`test_a_household_that_spends_nothing_has_no_runway_to_quote` to assert
`"il faut au moins" not in report.normal_unavailable_reason` and
`"deficitaire" in report.normal_unavailable_reason` -- before the fix this
failed with an `AttributeError` (field didn't exist yet); after the field was
added but before the message was fixed, an earlier draft assertion
(`"3 mois" not in reason`) also caught the bug, then had to be relaxed once I
realised a genuine "3 mois observes" mention is legitimate context, not a
contradiction -- the real invariant is "does not claim an insufficient-history
cause it does not have," which is what the final assertions pin.

## Finding 2 -- the honesty guarantee rests on an undocumented caller precondition

**Problem.** `complete_months(entries, ledger_start, ledger_end)` only checks
whether a month's calendar bounds fall inside `[ledger_start, ledger_end]`; it
cannot tell whether those two dates are the actual extent of imported data or
merely a requested display window. If task 12 ever derives the bounds from a
requested window (e.g. "last 12 months") rather than `min`/`max` of the real
transaction dates, a month holding one week of real statements gets silently
admitted as "complete" -- reintroducing the "quarter of the truth" failure
this module exists to prevent, from the caller's side. The risk is
one-directional: wider bounds can only admit extra partial months, never drop
a genuine one.

**Fix.** Documented the precondition explicitly in `complete_months`'s
docstring in `backend/app/engines/capacity.py`, naming the failure mode and
its one-directional nature, and pointing at the new test by name.

**Test (pinning, not failing).** Added
`test_ledger_bounds_must_reflect_actual_data_coverage_not_a_requested_window`
to `test_capacity.py`: one entry covering a single week is correctly excluded
when bounds are the true one-week data extent, but incorrectly admitted as a
complete `"2025-01"` month when bounds are widened to the full calendar year
-- both assertions in the same test, side by side, so the contrast is
explicit. This test does not fail before or after (no code behavior changed,
only documentation), by design: it pins the current, correct-per-contract
behavior and demonstrates concretely what happens if the precondition is
violated, for whoever wires task 12's caller.

## Finding 3 -- `RunwayReport` forced the caller to reach back into `capacity`

**Problem.** `RunwayScenario` kept only `monthly_burn_cents`, dropping the
full `MeasuredRate` band; a screen wanting "entre 5 et 7,5 mois" would need to
call `measure_expense_rate` a second time on the same months. Worse,
`RunwayReport.months_observed` only ever reported `len(all_months)` -- but
`essentials` is measured over a different, self-selected set of months (only
those with essential-tagged spending), and nothing disclosed that sample or
its size. A screen could see `essentials.months < normal.months` with no way
to tell whether that's because essentials genuinely costs less, or because
essentials was measured over fewer/heavier months.

**Fix.** `RunwayScenario` now carries the full `rate: MeasuredRate` -- its
`low_cents`/`high_cents` band and, via `rate.months`, the exact sample size
that scenario was measured over. `RunwayReport.months_observed` keeps its
original meaning (`all_months`' own completeness) since that's still useful
as the overall-ledger figure the screen needs for "mesure sur N mois
seulement"; the per-scenario sample size now lives on `scenario.rate.months`
instead of being conflated into it.

**Test (failing first).** Added
`test_each_scenario_exposes_its_own_measured_rate_and_sample_size`: before the
fix, `report.normal.rate` raised `AttributeError: 'RunwayScenario' object has
no attribute 'rate'`. After adding the field, an earlier draft used constant
monthly amounts, which correctly collapses `low_cents == median_cents ==
high_cents` (a constant sample has zero MAD by construction, per
`robust.py`) -- the test itself was wrong, not the code, so I introduced
genuine month-to-month variability (90 000 / 100 000 / 110 000) so the
assertion actually exercises the band. The test also builds `essentials` over
4 months against `normal`'s 3, and asserts the two `rate.months` differ,
directly exercising the disclosure the review asked for.

## Finding 4 -- the uncategorised-row decision was neither made nor documented

**Problem.** `is_essential` is a non-null `Boolean` on `categories`, so a
transaction with `category_id IS NULL` (26 such rows in the operator's data)
has no essential flag to read at all. Whether such a row should count toward
`essential_months` was never decided or written down anywhere reachable from
this task, leaving it to whoever builds task 12's join to guess.

**Fix.** Decided and documented in `runway.py`'s module docstring: an
uncategorised transaction is not essential -- it is excluded from
`essential_months` while remaining part of `all_months`. This is the
conservative choice (it can only shorten the essentials runway, never inflate
it on an unreviewed row) and the docstring states plainly that task 12 must
apply the categorisation join this way. This is a documentation-only change
in this task (no code here touches categories -- that join is task 12's), but
it closes the open question before task 12 has to invent an answer.
Additionally, per the review's own note that this closes disclosed concern 2
at the same time: the essentials-only-unmeasurable case now gets its own
`essentials_unavailable_reason` (see finding 1's fix) rather than a silent
`None` next to a populated `normal`, covered by the new
`test_essentials_gets_its_own_reason_when_only_it_is_unmeasurable`.

## Test evidence

**Before the fix** (test files updated first, engine code still old):

```
$ .venv/Scripts/pytest.exe tests/test_capacity.py tests/test_runway.py -v
...
FAILED tests/test_runway.py::test_two_months_of_history_measures_nothing_and_says_so
FAILED tests/test_runway.py::test_a_household_that_spends_nothing_has_no_runway_to_quote
FAILED tests/test_runway.py::test_essentials_gets_its_own_reason_when_only_it_is_unmeasurable
FAILED tests/test_runway.py::test_each_scenario_exposes_its_own_measured_rate_and_sample_size
4 failed, 19 passed, 1 warning in 0.36s
```

All four failures were the expected ones: `AttributeError` on the
not-yet-existing `normal_unavailable_reason` / `essentials_unavailable_reason`
/ `rate` fields. (The new capacity precondition test passed immediately, by
design -- it pins existing, unchanged behavior rather than driving a code
change.)

**After the fix**, with two test-design issues caught and corrected along the
way (the "3 mois" substring being too blunt, and the constant-amounts band
test), full capacity + runway suite:

```
$ .venv/Scripts/pytest.exe tests/test_capacity.py tests/test_runway.py -v
...
23 passed, 1 warning in 0.12s
```

**Full backend suite with coverage:**

```
$ .venv/Scripts/pytest.exe -v --cov=app --cov-report=term-missing
...
app\engines\capacity.py             51      0   100%
app\engines\runway.py               42      0   100%
...
TOTAL                             2226     88    96%
396 passed, 219 warnings in 40.89s
```

396 = 393 (post task-10 baseline) + 3 new tests (1 in `test_capacity.py`, 2
net-new in `test_runway.py` after the 2 pre-existing tests were only
modified, not added). `ruff check` is clean on all four changed files.

## Files changed (this fix, on top of `fb9a0fe`)

- `backend/app/engines/capacity.py` -- added the ledger-bounds precondition
  to `complete_months`'s docstring; no behavior change.
- `backend/app/engines/runway.py` -- `RunwayScenario` gained a `rate:
  MeasuredRate` field; `RunwayReport.insufficient_reason` was replaced by
  `normal_unavailable_reason` / `essentials_unavailable_reason`; `_scenario`
  now returns a per-scope reason distinguishing "too few months" from "burn
  not positive"; module docstring states the uncategorised-row /
  `essential_months` contract for task 12.
- `backend/tests/test_capacity.py` -- added the ledger-bounds precondition
  test.
- `backend/tests/test_runway.py` -- updated two existing tests to the new
  field names and corrected message-content assertions; added three new
  tests (essentials-own-reason, per-scenario rate/sample-size disclosure,
  and the strengthened "spends nothing" assertion).

## Remaining concerns after the fix

None blocking. The four Minor findings were left untouched per the review's
instruction, and remain in the ledger for whoever picks them up.
