# Task 15 report — personal inflation engine

Commit: `5c7d45b` — `feat(engines): measure personal basket inflation year over year`
(one commit, as required; on top of `845080a`).

## What was implemented

`backend/app/engines/inflation.py`, a pure engine (no session, no network, no
implicit clock) that answers "où mon argent part-il davantage qu'avant ?" by
comparing the median monthly cost of each spending category between a window
and the same window twelve months earlier.

Public surface, matching the brief's interface exactly:

- `Window(start, end)`
- `CategorySpend(on, amount_cents, category_id)`
- `CategoryInflation(category_id, current_cost_cents, previous_cost_cents,
  delta_cents, ratio, months_current, months_previous, comparable, reason)`
- `InflationReport(current, previous, lines, basket_current_cost_cents,
  basket_previous_cost_cents, basket_ratio, reference_ratio, comparable, reason)`
- `previous_year_window(current) -> Window`
- `reference_ratio_from_index(points, current, previous) -> float | None`
- `compute_inflation(entries, current, index_points) -> InflationReport`
- `MIN_MONTHS_PER_WINDOW = 3`

Design decisions carried into the code, per the plan:

- **Year-over-year only.** `previous_year_window` shifts both bounds back
  exactly one year, with 29 February falling back to 28 February in a
  non-leap predecessor rather than raising.
- **Median monthly cost, not window totals.** `_monthly_costs` buckets each
  category's spend by calendar month inside a window, then `median_cents`
  (from `robust.py`) is taken over those monthly totals — never over the raw
  rows, never a sum of the window.
- **Only spending is a cost.** `_monthly_costs` excludes any row with
  `amount_cents >= 0` rather than netting it in — the same choice
  `aggregate.aggregate_by_category` makes for the dashboard, and the one task
  4/5 settled on for budgets: coercing a net-positive category into a spend
  via `abs()` fabricates a number the ledger never stated.
- **A category needs ≥3 qualifying months in EACH window to be comparable.**
  Below that, the line still appears — never dropped, never reported as
  -100 % — with a French `reason` naming the actual month counts on both
  sides (`"il faut au moins 3 mois de dépenses dans chacune des deux
  périodes, et cette catégorie en compte {current} sur la période récente et
  {previous} un an plus tôt."`).
- **Sign convention, module-local:** every `*_cost_cents` is a positive
  magnitude (a basket's price). `delta_cents` is signed, positive when the
  category got more expensive.
- **The reference index is never fetched.** `reference_ratio_from_index`
  reads only the `(month, value_hundredths)` pairs the user pasted in
  (`price_index_points`, task 3) and returns `None` — never `0` — when the
  series does not cover both windows. `median_cents` is reused generically
  here to summarise the index's own value inside each window; it is an index
  level, not money, matching how `price_index.py`'s own docstring frames
  `value_hundredths`.
- **Basket total** sums only the comparable lines' median costs on each side
  and takes the ratio of the two sums; incomparable categories are excluded
  from both sides rather than treated as a silent zero.
- **Sort order:** comparable lines first, steepest increase first
  (`-(ratio or 0.0)` on comparable lines only); incomparable lines fall to
  the bottom, never interleaved as if they were a zero.

## TDD evidence

1. `backend/tests/test_inflation.py` written first (18 tests). Ran against
   the not-yet-created module:
   ```
   ModuleNotFoundError: No module named 'app.engines.inflation'
   ```
   confirmed red.
2. `backend/app/engines/inflation.py` written to satisfy the tests. Full run:
   ```
   tests/test_inflation.py .................. [100%]
   18 passed, 1 warning in 0.07s
   ```
3. Full backend suite: `472 passed` (454 baseline + 18 new), 0 failures.
   `app/engines/inflation.py` at **100 %** coverage
   (`app\engines\inflation.py  94  0  100%`).
4. Mutation testing on the module (temporarily edited, reran, restored):
   - Removed the `and previous_cost > 0` clause from `comparable` entirely →
     all 18 tests still passed. This is a genuine finding, written up below
     rather than hidden.
   - Loosened the income/zero-amount filter from `amount_cents >= 0` to
     `amount_cents > 0` (i.e. let zero-amount rows count as "spending") →
     `test_a_previous_window_with_only_zero_amount_rows_is_not_comparable`
     failed on `months_previous == 0` (got 6), *and* the run showed
     `comparable is False` still held — the `previous_cost > 0` guard fired
     for real in that mutated world, with `previous_cost_cents = 0` and
     `months_previous = 6 ≥ MIN_MONTHS_PER_WINDOW`. This is the mutation the
     guard exists for; see "Discrepancy" below.
5. `ruff check` clean on both new files (0 errors) after fixing lint issues
   introduced by copying the brief's test bodies verbatim — see below.

## Two tests specifically required by the task brief

- **The operator's own data shape (refusal):**
  `test_a_window_with_too_few_months_is_not_comparable_and_says_why` builds
  six months of current spend and none a year earlier — exactly the
  operator's case (his second window is empty) — and asserts `comparable is
  False`, `ratio is None`, `months_previous == 0`, and that the French
  `reason` names `"3 mois"`. `test_an_empty_ledger_refuses_with_a_reason`
  covers the fully-empty case at the report level.
- **Median month, not window total (the "simplified back" test):**
  `test_the_comparison_is_per_month_not_per_total` compares six months of
  -30 000 c current spend against three months of -30 000 c a year earlier.
  A totals-based comparison would read `(180 000 − 90 000) / 90 000 = +100 %`;
  the engine reports `ratio == 0.0` because both windows' *median* month cost
  the same 30 000 c. This is the test that fails immediately if the
  comparison is changed back to totals — I mutation-tested this by hand
  (summing instead of taking the median) and confirmed the assertion breaks.

## What the engine returns on the operator's actual ledger shape, and why

Per the plan's own pre-flight note and the phase 2A progress ledger: the
operator's ledger has 3 complete observed months total, with an eight-month
gap. Whatever window task 17's router picks, the year-ago window will
overwhelmingly fail to reach `MIN_MONTHS_PER_WINDOW = 3` months of spend for
essentially every category (`2025-04` through `2025-11` are empty — no
statement was imported, not zero spend). The engine's designed output on this
shape is therefore: every (or nearly every) `CategoryInflation` line has
`comparable = False`, each carrying its own honest month-count reason;
`InflationReport.comparable = False`; `InflationReport.reason` is the
basket-level French refusal naming that no category reached three months of
spend in both periods and inviting more imports. This is the designed
"refuses honestly" outcome the plan calls for — not a bug, and matches the
"expected refusals" note the plan's own pre-flight scan already recorded for
this feature.

## How a category that disappeared between windows is handled

`test_a_category_dropped_entirely_is_not_reported_as_deflation` pins this
directly: a category with six months of spend a year ago and *zero* rows in
the current window gets `months_current == 0`, `current_cost_cents == 0` (0
because there is nothing to take a median of, not because a price of zero was
measured), `comparable == False`, and `ratio is None`. It is not silently
dropped from `lines`, and it is not reported as -100 % deflation — the
`months_current >= MIN_MONTHS_PER_WINDOW` gate on `comparable` catches it
before any ratio arithmetic runs. This directly answers the self-review
question the brief poses.

## Discrepancy against the brief, and how it was handled

The brief's proposed code and its own test
`test_a_previous_window_of_exactly_zero_never_divides_by_zero` (renamed here
to `test_a_previous_window_with_only_zero_amount_rows_is_not_comparable`) are
**correct**, but the brief's own test name overstates what the test proves.
Verified by construction and confirmed by mutation testing:

- `_monthly_costs` only ever sums rows with `amount_cents < 0` (income and
  zero-amount rows are excluded, per `test_income_is_not_part_of_the_basket`'s
  contract). Every value that reaches a per-month bucket is therefore the sum
  of one or more *positive* magnitudes, so it can never be exactly 0. A
  median taken over a list of strictly-positive integers is itself always
  positive (verified for both `robust.median_cents`'s odd- and even-length
  branches). **This means `previous_cost_cents` can never actually be 0 when
  `previous_months` is non-empty, given today's filtering** — so the
  `and previous_cost > 0` clause inside `comparable` is currently
  unreachable through the public interface, and the brief's test passes
  because `months_previous` is 0 (the count gate fires), not because the
  cost-is-zero gate fires.
- I confirmed this by mutation-deleting the clause: all 18 tests, including
  the renamed one, still passed. I then mutation-tested the filter itself
  (`>= 0` → `> 0`, admitting zero-amount rows as "spending"): in that
  mutated world `months_previous` becomes 6 (≥ 3) with `previous_cost_cents
  == 0`, and the `previous_cost > 0` guard is what keeps `comparable ==
  False` — the exact scenario the guard exists to catch, should a future
  change ever loosen the income filter.
- **Resolution:** kept the guard (cheap, and a genuine safety net against
  that one plausible future refactor, confirmed by the second mutation
  above), added an inline comment in `inflation.py` explaining precisely why
  it is currently unreachable and under what change it would become live,
  renamed the test to describe what it actually demonstrates, and documented
  the mechanism in the test's own docstring. No behavior changed from the
  brief's proposed code — this is a documentation/test-honesty fix, in the
  spirit of task 11's carried lesson that "a test can pass for the wrong
  reason" and "a comment stating *when* a value appears deserves the same
  'does a test still prove this?' pass as the code."

No other discrepancy was found between the brief and what was shipped: the
`Window`/`CategorySpend`/`CategoryInflation`/`InflationReport` shapes, the
leap-day handling, the sort order, the basket aggregation, and the reference
index handling all matched the brief's proposed code on inspection and under
targeted mutation checks (removing the `>= MIN_MONTHS_PER_WINDOW` count
checks, the `not line.comparable` sort key, and the `>= 0` income filter were
each individually verified to break the relevant test).

One cosmetic fix beyond the brief: the brief's test bodies used `l` as a
generator loop variable (`next(l for l in ... if l.category_id == 1)`),
which is `ruff` `E741` (ambiguous variable name — collides with `1`/`I` at a
glance) and not used anywhere else in this test suite. Renamed to `item` and
split the resulting lines to stay under the project's 100-column limit
(`ruff` `E501`). Both new files are `ruff check` clean; this was not true of
the brief's code verbatim.

## Self-review

- **What does this produce on a ledger it has never seen?** Any category
  with fewer than 3 qualifying months of spend in either the current or the
  year-ago window is reported as `comparable = False` with an honest,
  specific reason — never dropped, never given a fabricated ratio. A basket
  with no comparable category refuses at the report level with its own
  reason. A category present in only one window (new, or discontinued) is
  exactly this case and is explicitly tested.
- **Is a category that simply stopped being bought reported as deflation?**
  No — verified by `test_a_category_dropped_entirely_is_not_reported_as_
  deflation`. It hits the `months_current >= MIN_MONTHS_PER_WINDOW` gate
  before any subtraction or division happens, so `ratio` stays `None` rather
  than becoming a manufactured -100 %.
- **Money/date discipline:** every `*_cost_cents` and `delta_cents` stays an
  `int`; only `ratio`, `basket_ratio`, and `reference_ratio` are floats, and
  each is a ratio, never a monetary value. Dates are `datetime.date`
  end-to-end; no implicit clock is read anywhere in the module.
- **No silent failures:** there is no bare `except`, no fallback value
  standing in for missing data — an incomparable line/report always carries
  a non-null French `reason`, and `reason` is `None` exactly when
  `comparable` is `True` (asserted implicitly by every test that checks
  both fields together).
- **Isolation:** the module takes no `Session` and has no notion of
  `user_id` — task 17's router is responsible for scoping `entries` and
  `index_points` to the current user before calling in, the same contract
  every other pure engine in this plan follows.
- **Remaining, deliberately out of scope for this task:** transfer
  exclusion (`is_transfer`) is not a field on `CategorySpend`, matching
  `capacity.MonthlyEntry` / `forecast.LedgerEntry`'s precedent — the router
  is expected to filter transfers out before constructing entries, the same
  way `api/common.py` already does for the other cashflow engines.
  `reference_ratio_from_index` requires only ≥1 index point inside each
  window (not `MIN_MONTHS_PER_WINDOW`) before using it; the brief does not
  ask for a stricter floor there and the index series is independent,
  externally-supplied monthly data rather than transaction coverage, so this
  was left as specified rather than invented.

## Files changed

- `backend/app/engines/inflation.py` (new, 94 statements, 100 % covered)
- `backend/tests/test_inflation.py` (new, 18 tests)

## Concerns for task 17 (API) / task 18 (screen)

- The router must build `entries`/`index_points` already scoped to
  `user_id` and with transfers excluded, per the pattern above — this engine
  enforces neither.
- On the operator's real data, expect `InflationReport.comparable = False`
  and most/all `lines` to read `comparable = False` — this is the designed
  outcome per the plan's pre-flight note, not something to work around in
  the router or screen.
- `reference_ratio` is `None` until the operator pastes in an INSEE series
  via `price_index_points`; the screen needs to render a "—" for that
  column exactly as `price_index.py`'s docstring already anticipates,
  rather than treating `None` as 0 % or omitting the column.

---

## Fix round 1/5 — review response

Review confirmed both self-reported findings (the divide-by-zero test passing
for the wrong reason, and the `E741` ambiguous-`l` lint issue) and both
binding plan decisions (year-over-year only, median-not-totals). Three
Important findings came back; all three addressed here, on top of `5c7d45b`.
Four Minor findings were explicitly left for the ledger per the review and
are not touched in this round.

### 1. False field comment on `CategoryInflation.current_cost_cents`

The comment read "0 when not comparable" — false whenever a line is
incomparable because only ONE side is thin. `test_a_window_with_too_few_
months_is_not_comparable_and_says_why`'s own fixture proves it:
`current_cost_cents == 30_000` on a `comparable=False` line, since the
current side has six genuine months of spend and only the previous side is
empty. `delta_cents` carried no such warning at all.

Fix: rewrote the comments on `current_cost_cents`, `previous_cost_cents` and
`delta_cents` in `backend/app/engines/inflation.py` to state the real rule —
these are medians of whatever months existed on each side; `0` means "no
qualifying month on this side", never a measured zero; none of the three may
be read as a change, a price, or a trend when `comparable` is `False`, and
`ratio is None` is the only trustworthy "no comparison" signal.

Pinned with new assertions in the same test (no behaviour changed — the
engine already computed these values correctly; only the comment lied):

```
$ .venv/Scripts/pytest.exe tests/test_inflation.py -v -k too_few_months
tests/test_inflation.py::test_a_window_with_too_few_months_is_not_comparable_and_says_why PASSED
```
now also asserts `current_cost_cents == 30_000`, `previous_cost_cents == 0`,
`delta_cents == 30_000`.

No mutation check applies here — there is no implementation branch to kill,
only a comment that no longer contradicts the code it sits beside.

### 2. `CategorySpend` cannot express a transfer

Confirmed: `_monthly_costs`'s own docstring named `aggregate.
aggregate_by_category` as its precedent for excluding non-spend rows, on
exactly the axis (`include_transfers`) where the two modules actually
diverge — `CategorySpend` has no `is_transfer` field and `_monthly_costs`
applies no such filter, so a standing order into savings or a card
settlement enters the basket as a monthly cost like any other.

Resolved as a documented caller obligation rather than a new field, for
consistency with the two engines this module's shape is otherwise modelled
on — `capacity.MonthlyEntry` and `forecast.LedgerEntry` also carry no
`is_transfer` field and also rely on the router excluding transfers before
construction (the same way `api/common.py`'s `user_history` already filters
`Transaction.is_transfer.is_(False)` for every other cashflow engine). Adding
the field here alone would be the odd one out among its siblings without
making the contract any safer, since a caller who forgets to filter can
equally forget to set a boolean.

Written in two places task 17's implementer will actually read before using
the type: the module docstring (new paragraph, "Transfers are the caller's
responsibility") and a new docstring on `CategorySpend` itself, both stating
the obligation, naming the precedent it diverges from, and naming the
concrete consequence (a repeating monthly "cost" that can dominate the
ranking) if it is skipped.

This is a documentation-only fix — no runtime behaviour changed, so there is
no test to write or mutate for it. Confirmed no test relies on any prior
(absent) transfer-filtering behaviour: `grep -n is_transfer backend/tests/
test_inflation.py` returns nothing, before and after.

### 3. No test distinguishes median from mean

Confirmed by construction: every existing fixture builds months of an
identical amount, so median and mean coincide in all 18 original tests.

Fix: added `test_the_cost_is_the_median_month_not_the_mean` to
`backend/tests/test_inflation.py` — three months at 10 000 c and one outlier
month at 90 000 c, which median to 10 000 c and mean (integer floor) to
30 000 c.

Ran against the unmodified engine first — it passed, since `median_cents` is
already what the code calls:
```
$ .venv/Scripts/pytest.exe tests/test_inflation.py -v -k median_month_not_the_mean
tests/test_inflation.py::test_the_cost_is_the_median_month_not_the_mean PASSED
```

Mutation check, exactly as requested — temporarily replaced both
`median_cents(...)` calls in `compute_inflation` with
`sum(...) // len(...)`, reran, then reverted:
```
$ python -c "... replace median_cents(current_months)... with sum(current_months)//len(current_months) ..."
$ .venv/Scripts/pytest.exe tests/test_inflation.py -v -k median_month_not_the_mean
FAILED tests/test_inflation.py::test_the_cost_is_the_median_month_not_the_mean
  assert 30000 == 10000
   +  where 30000 = CategoryInflation(..., current_cost_cents=30000, ...).current_cost_cents
1 failed, 18 deselected, 1 warning in 0.21s
```
Confirmed red under the mean mutation, then the file was restored from the
pre-mutation copy and reverified green:
```
$ .venv/Scripts/pytest.exe tests/test_inflation.py -q
19 passed, 1 warning in 0.05s
```

### Re-run of the full backend suite after all three fixes

```
$ .venv/Scripts/python.exe -m ruff check app/engines/inflation.py tests/test_inflation.py
All checks passed!

$ .venv/Scripts/pytest.exe -q --cov=app --cov-report=term-missing
...
app\engines\inflation.py            94      0   100%
...
TOTAL                             2618     89    97%
473 passed, 258 warnings in 39.58s
```
473 passed (472 baseline for this task + 1 new median-vs-mean test).
`inflation.py` stays at 100 % coverage — the two docstring additions and the
rewritten comments added no executable statements, so the statement count
(94) is unchanged from the first round.

### Minor findings — recorded for the ledger, not fixed in this round

Per the review's explicit instruction, these four are left open and belong in
`progress.md`'s task 15 entry rather than fixed here:

- `reference_ratio_from_index`'s baseline-zero guard is `before == 0` rather
  than `before <= 0`, and untested — the one division in this module fed
  entirely by a value a human can type in, so a negative or malformed index
  entry is not defended against the same way the transaction-derived values
  are (which can never be negative by construction).
- The empty-ledger refusal (`test_an_empty_ledger_refuses_with_a_reason`)
  exercises the report-level reason with zero categories in play; the
  message names categories that do not exist in that fixture.
- The "excluded rather than netted in" claim on `_monthly_costs` is untested
  for a single month holding both a spend and a refund landing in the same
  calendar month for the same category (only whole-month income exclusion is
  pinned, by `test_income_is_not_part_of_the_basket`).
- `lines.sort(key=lambda line: (not line.comparable, -(line.ratio or 0.0)))`
  uses `or` on a float that can legitimately be `0.0` (an exact-zero ratio on
  a comparable line) — currently harmless since `-0.0 == -(0.0 or 0.0)`, but
  the `or` reads as a None-guard and would misbehave if the sort key were
  ever generalised to a value where `0.0` and "absent" must be told apart.

## Commits

- `5c7d45b` — `feat(engines): measure personal basket inflation year over year`
  (round 1, reviewed)
- `2207eb3` — `fix(engines): correct a stale field comment and document the
  inflation transfer gap` (fix round 1/5, this round)
