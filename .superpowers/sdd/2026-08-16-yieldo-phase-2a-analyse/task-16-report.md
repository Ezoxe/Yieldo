# Task 16: Anomaly detection engine — report

Branch `phase-2-analyse-decision`, commit `2b6da8a` (parent `2207eb3`).

## What was implemented

`backend/app/engines/anomaly.py`, filled in beneath the `AnomalyTx` dataclass
task 2 already shipped:

- `MIN_HISTORY = 10` — the design plan's own threshold for a category to be
  scored at all.
- `Anomaly`, `SkippedCategory`, `AnomalyReport` dataclasses, matching the
  brief's stated interface exactly (field names and types), since task 17
  consumes it.
- `detect_anomalies(history, window_start, window_end) -> AnomalyReport`:
  groups transactions by `(category_id, sign)`, skips groups under
  `MIN_HISTORY` with a French reason naming the group's own count, scores the
  rest with `robust.describe`/`robust.modified_z` over the category's
  **whole** history, filters the *output* to the requested window, and sorts
  by `|modified_z|` descending.

`backend/tests/test_anomaly.py`: 16 tests, all new.

## TDD evidence

1. Wrote the full test file first. `pytest tests/test_anomaly.py -v` failed at
   collection: `ImportError: cannot import name 'MIN_HISTORY' from
   'app.engines.anomaly'`.
2. Implemented `anomaly.py`. All 16 tests passed on the first run after
   implementation (the fixture fix described below was worked out and
   verified against `robust.py` directly *before* being written into the test
   file, so there was no red run after that point).
3. Full backend suite: **489 passed** (473 before this task + 16 new),
   `anomaly.py` at **100% coverage** (60/60 statements).

## The brief disagreed with its own math — found and fixed

The brief's `test_income_and_expenses_are_scored_separately` used this
fixture for both the expense and income sub-groups: eleven identical values
plus one differing by a small amount (`[-4000]*11 + [-4200]`, and the income
mirror `[220000]*11 + [225000]`). It asserted `report.anomalies == []`.

Checked directly against the shipped `robust.describe`/`modified_z` before
writing any implementation: this is the *same* "one value differs, the rest
are identical" shape the brief's own next test
(`test_a_single_different_charge_among_identical_ones_is_still_caught`)
deliberately exploits. With fewer than half a sample differing from its mode,
MAD is 0 and scoring falls to the mean-absolute-deviation fallback, which —
for this shape — flags almost any nonzero difference regardless of its actual
size: with `n-1` identical values, the score works out to roughly `n /
MODIFIED_Z_MEAN_AD_CONSTANT` independent of how large the differing value is.
Measured: the brief's expense block scores `|z| ≈ 9.39` and its income block
`|z| ≈ 9.57`, each **on its own, correctly-separated group**. So even a
correct implementation, with sign-grouping working exactly as intended, could
not have produced `report.anomalies == []` from that fixture — the test's
assertion was wrong, not the algorithm. Ninth consecutive task in this plan
with a defective brief fixture (see task 11's and 15's own entries in
`progress.md`).

Fix: replaced the fixture with the already-proven-ordinary ten-value spread
from `test_an_ordinary_expense_is_not_flagged`, used twice for twenty expense
rows, and scaled by ×-55 for ten income rows. `modified_z` is scale-invariant,
so if the smaller spread doesn't cross the outlier threshold on its own, the
proportionally identical larger one can't either — this was checked directly,
not assumed. The 20-vs-10 split (rather than 10-vs-10) is deliberate: an equal
split turns out to pool harmlessly into a wide bimodal MAD even when
sign-grouping is silently broken (verified: pooling ten-and-ten sits the
median between the two clusters and nothing crosses 3.5 either way, so a
10-vs-10 fixture would not have caught a real sign-grouping regression). With
expenses in the majority, a pooled median lands inside the expense cluster and
every income row becomes a huge deviation from it — verified: the mutation
"always group as 'expense'" pools this exact fixture and flags all ten income
rows at `|z| ≈ 690–784`; correctly grouped, neither side is ever flagged. This
is now the property under test.

## MIN_HISTORY's citation

The brief's own draft comment read: "Ten observations before any outlier
claim. Iglewicz & Hoaglin's own guidance for the modified z-score." I could
not verify that Iglewicz & Hoaglin's 1993 paper specifies a minimum sample
size of 10 anywhere — their published contribution is the 3.5 cutoff itself
(`robust.OUTLIER_Z`), not a sample-size floor. The plan sets `MIN_HISTORY = 10`
in its own table (Lot E overview: "Anomalies | ≥10 observations in the
category | 19 categories, ~10 rows each | mixed"), with no citation attached
there either. Rewrote the code comment to cite the plan's own table instead of
attributing an unverified claim to a named published source — the same class
of "field comment must stay true" issue flagged on tasks 11 and 15.

## Zero-dispersion decision (explicit, per the task's own instruction)

`robust.modified_z` returns `None` exactly when both `mad` and `mean_ad` are
0 — every observation in the group is identical to the cent. Decision: `None`
means "cannot say" and yields **no anomaly**, never a fabricated score. The
moment even one value differs, dispersion stops being zero (the mean-AD
fallback engages) and that new value **is** scored against the previously
unvarying centre — deliberately, and however small the difference. This is
written directly into `detect_anomalies`'s docstring, and both directions are
pinned by tests: `test_a_category_whose_amount_never_varies_yields_no_anomaly`
(twelve identical, no anomaly) and
`test_a_single_different_charge_among_identical_ones_is_still_caught` (eleven
identical + one different, caught).

## Mutation checks

12 targeted mutations applied one at a time to `anomaly.py`, each run against
`tests/test_anomaly.py`, each restored before the next:

| Mutation | Result |
|---|---|
| Sign grouping always "expense" | caught |
| Sign boundary `<=` instead of `<` (0 → expense) | caught |
| Drop the `category_id is None` guard | caught |
| `MIN_HISTORY` off-by-one (`<=` instead of `<`) | caught |
| Outlier boundary `<` instead of `<=` (score == 3.5 flagged) | caught |
| Outlier check reduced to `score is None` only | caught |
| `direction` always "high" | caught |
| `direction` inverted | caught |
| Window filter removed | caught |
| Sort order reversed (smallest first) | caught |
| `scored_groups` never incremented | caught |
| `category_median_cents` uses `spread.count` instead of `spread.median` | caught |

12/12 caught. The first pass (before the two boundary tests described below
were added) missed 3 of these — recorded honestly rather than only reporting
the final clean run:

- "always expense" was not caught by the original (10-vs-10) sign-separation
  fixture, for the pooling reason explained above. Fixed by moving to the
  20-vs-10 fixture.
- The `amount_cents == 0` sign-boundary mutation was not caught by anything —
  no test exercised a zero-amount row at all. Added
  `test_a_zero_amount_row_counts_as_income_not_expense`, which pins the
  convention (`>= 0` → income, matching `aggregate.py`'s own `>= 0` treatment
  of non-spends) via a 9-row skipped group's `direction` field.
- The exact `OUTLIER_Z` boundary (`<` vs `<=`) was not caught — no test
  produced a score of precisely 3.5. Added
  `test_the_outlier_cutoff_excludes_its_own_boundary`, built from an
  11-magnitude fixture reverse-engineered so `modified_z` returns exactly
  `3.5` for one probe and exactly `3.5005` for a second, checked directly
  against `robust.describe`/`modified_z` before being written into the test
  (not approximated). Confirms the `<=` convention: exactly 3.5 is not
  reported, `3.5005` is.

## Operator's-data-shape test (task instruction #3)

`test_the_operators_data_shape_leaves_some_categories_scored_and_others_
skipped`: four categories standing in for the plan's stated shape (19
categories, ~10 rows each, mixed outcome) — two at or above `MIN_HISTORY`
(one produces a finding, one doesn't) and two under it. Asserts
`scored_groups == 2`, the skipped set is exactly the two under-threshold
category ids, and each skipped category's reason names **its own** count (9
and 5 respectively, never each other's) alongside the threshold.

## Self-review: the annual-premium question

Simulated the scenario named in the task brief directly: a category holding
eleven ordinary monthly charges (e.g. €80/month insurance) and one annual
lump-sum premium twelve times the size, all in the same category. Checked: it
**is** flagged (`test_an_annual_premium_among_monthly_charges_is_flagged`,
z ≈ 9.6). This is the same "one value differs from an otherwise-unvarying
history" shape as the zero-dispersion decision above, and I judge it correct
rather than a defect to work around:

- The engine has no signal that distinguishes "this large charge is
  explicable" from "this large charge is wrong" — both look identical from
  inside a category's own amount history, which is the only thing this pure
  function is given.
- Suppressing it would require an invented rule (a size ratio, a frequency
  gate, a label pattern) with no basis in the design spec, which explicitly
  rules out arbitrary thresholds beyond the published one.
- The actual fix for this shape belongs in category hygiene — an annual
  premium sorted into its own category (or the operator dismissing the flag
  once, if a future task adds that) — not in the statistics.

Recorded as a decision in the test's own docstring, not left as an
unexplained side effect. Flagged as a **concern for task 18** (the anomalies
screen): the copy shown to the user for a flagged transaction should not
imply "this is definitely wrong," since a correctly-flagged, entirely
legitimate annual charge is an expected, designed-for outcome of this engine,
and the screen should read that way rather than accusatorially.

## Discrepancies between the brief and what was shipped

1. **The sign-separation test fixture was mathematically self-contradictory**
   (detailed above) — the brief's own assertion could not pass against the
   brief's own reference algorithm, regardless of correct implementation.
2. **`MIN_HISTORY`'s citation to Iglewicz & Hoaglin was unverifiable** and
   likely incorrect — the 10-observation floor is the plan's own choice, not
   a published guideline; reattributed the comment accordingly.
3. No other discrepancy found. `AnomalyTx`, `describe`, `modified_z`,
   `OUTLIER_Z` from the already-shipped `robust.py` and the task-2 stub
   matched the brief's stated interfaces exactly; the rest of the algorithm
   (grouping, MIN_HISTORY gate, window filtering, sort order,
   `scored_groups` semantics) held up under both the brief's own test
   intentions and the mutation matrix once the fixture and two coverage gaps
   above were fixed.

## Files changed

- `backend/app/engines/anomaly.py` — algorithm added beneath the existing
  `AnomalyTx` stub. 60 statements, 100% covered.
- `backend/tests/test_anomaly.py` — new, 16 tests.

## Concerns for later tasks

- **Task 17 (API router)**: per the recurring pattern in this plan (tasks 15,
  10, 12), this engine enforces neither `user_id` scoping nor transfer
  exclusion — the router must filter `Transaction.is_transfer.is_(False)` and
  scope by `user_id` before building `AnomalyTx` rows, the same contract
  `api/common.py:anomaly_points` already implements from task 2. Confirmed
  `anomaly_points` in `api/common.py` already does this correctly (whole
  ledger, non-transfer only, per user) — no change needed there, just noting
  the router must keep using it rather than querying `Transaction` directly.
- **Task 18 (screen)**: the annual-premium self-review finding above — the
  screen's copy for a flagged transaction should read as "statistically
  unusual for this category" rather than "wrong," since a legitimate large
  charge sharing a category with small recurring ones is a designed-for,
  correctly-flagged case, not a false positive to apologize for.
- **Minor, deferred**: `SkippedCategory.direction` and `Anomaly.direction` are
  both named `direction` but carry disjoint vocabularies ("expense"/"income"
  vs "high"/"low") by the brief's own stated interface — documented inline on
  both dataclasses to prevent confusion, but a future consumer skimming field
  names alone could still conflate them.

---

## Fix round 1/1 (review of `2b6da8a`)

Both self-reported claims (the brief's self-contradictory sign-separation
fixture, the unverifiable `MIN_HISTORY` citation) were independently
re-derived by the reviewer and confirmed to the digit. Three Important
findings, all on the interface tasks 17/18 consume; four Minor findings left
to the ledger, with the first flagged forward to task 18. All three Important
findings fixed with a failing test written first, then the code change, then
a full mutation re-run.

### 1. `anomalies` ordering was not by "most unusual" on the engine's most common branch

**Verified independently first.** Ran the reviewer's exact fixtures against
the shipped `robust.describe`/`modified_z` before touching any code:

```
15-cent subscription change  n=30  median=1549  mad=0  mean_ad=1     z=11.968269723309561
860 EUR grocery spike        n=12  median=4000  mad=0  mean_ad=7167  z=9.574170468393305
```

Confirmed to the fifth decimal against the reviewer's 11.968 / 9.574. The
sentence at `AnomalyReport.anomalies`'s old comment ("the most unusual
transaction first, across every scored category together") was false on
exactly this branch: for the "n-1 identical, one different" shape — the
shape `mad == 0` always produces, and the shape 8 of the original 16 tests
happen to use — the mean-absolute-deviation fallback's score reduces to
`group_size / MODIFIED_Z_MEAN_AD_CONSTANT`, independent of the differing
value's actual size. Larger groups score higher regardless of how small the
change was.

**Fix:** replaced the sort key. `anomalies` is now ordered by
`_unusualness()` — relative deviation from the category's own median,
`abs(abs(amount_cents) - category_median_cents) / category_median_cents` —
not `modified_z`. `modified_z` stays on `Anomaly` (it is what decided
whether the transaction crossed `OUTLIER_Z` at all) but is documented as
informational, not the ranking key. Within a single category this is
provably the same ordering `modified_z` would give (both are monotonic
transforms of `value - median` for a fixed positive median), so no
single-category test changed behavior — verified `test_the_biggest_
deviation_comes_first` still passes unmodified.

Two edge cases the new metric introduces, both tested:
- `category_median_cents == 0` (reachable: at least half a group's
  magnitudes are themselves 0 — e.g. an income line that is normally a
  no-op) would divide by zero; instead it ranks first, as infinitely far
  from a centre that never moves.
  `test_a_category_whose_median_is_zero_ranks_first_rather_than_crashing`.
- A "low" anomaly's raw `value - median` is negative; without `abs()` on
  the numerator it would rank as if less unusual than any "high" anomaly
  regardless of actual gap size.
  `test_a_low_anomaly_ranks_by_the_size_of_its_gap_not_its_sign` pins a 99.75%
  "low" gap ranking above a 10% "high" one. **This one was NOT caught by my
  first mutation pass** — see the mutation table below — and is exactly the
  kind of gap the reviewer's own methodology exists to catch. Added after
  the mutation run surfaced it, not before.

New test: `test_the_ranking_metric_is_relative_deviation_not_raw_modified_z`,
using the reviewer's own two fixtures, asserting `report.anomalies[0]
.modified_z < report.anomalies[1].modified_z` (raw z ranks them backwards)
while `[a.category_id for a in report.anomalies] == [2, 1]` (the real spike
still comes first).

### 2. Skip reason named the sign group's count as if it were the category's

**Verified independently first.** Constructed the reviewer's exact scenario
(11 ordinary expenses + 1 refund) and confirmed: `scored_groups == 1`
(the expense side), `skipped == [SkippedCategory(category_id=1,
direction='income', observations=1, reason="...et celle-ci en compte
1.")]` — the same category simultaneously "scored" and told it "compte 1",
using `cette catégorie` as the subject with no qualifier. Confirmed exactly
as described.

**Fix:** the reason now names the sign group explicitly via a
`_SIGN_LABELS = {"expense": "dépenses", "income": "recettes"}` lookup:
"il faut au moins 10 recettes dans cette catégorie ... et elle n'en compte
que 1" — "elle" still refers to the category, but the counted noun is now
"recettes" (or "dépenses"), not a bare, ambiguous "opérations".

New test: `test_the_skip_reason_names_the_sign_groups_own_count_not_the_
categorys`, asserting `"recette" in skip.reason and "dépense" not in
skip.reason` on the reviewer's own fixture, alongside `scored_groups == 1`
in the same report — pinning that the contradiction (scored and skipped on
one category) is now at least honestly worded rather than silently fixed
by coincidence.

### 3. `skipped` / `scored_groups` were not window-scoped

**Verified independently first.** Ran a history entirely in 2024 against a
2026 window: reproduced exactly `scored_groups=1, skipped=[...one entry...],
anomalies=0` on the pre-fix code — a category with zero transactions in the
displayed period counted as both "analysed" and "ignorée".

**Decision:** `skipped` and `scored_groups` are now scoped to the window
the same way `anomalies` already was. A category+sign group with no row
inside `[window_start, window_end]` is reported in neither list, however
much history it holds outside the window. The underlying statistics —
whether `MIN_HISTORY` is met, and the median/MAD themselves — still read
the group's **whole** history; only whether the outcome is surfaced at all
now depends on the group having a presence in the window. Implemented as
an early `continue` on `in_window = [row for row in rows if window_start <=
row.on <= window_end]`, before the `MIN_HISTORY` check, so the gate and the
statistics stay clearly separated in the code and in the docstring.

Two new tests: `test_a_category_entirely_outside_the_window_is_neither_
scored_nor_skipped` (the reviewer's exact reproduction, now `scored_groups
== 0, skipped == []`) and its deliberate companion `test_a_group_visible_
in_the_window_is_still_judged_on_its_whole_history` (9 of 10 rows predate
the window; the group is still scored as a 10-row category, not skipped as
a 1-row one) — proving the fix gates *reporting*, not the *statistics*.

### Minor findings — left to the ledger, one flagged forward

Per the review's own instruction, the four Minor findings are not fixed
here:

1. **Flagged forward to task 18's screen copy**, the same way the annual-
   premium self-review finding already was. Verified independently:
   `describe([1549]*11 + [1554])` gives `mad=0, mean_ad=0` → `modified_z`
   returns `None` (a 5-cent reprice is never flagged), while
   `describe([1549]*11 + [1555])` gives `mean_ad=1` → `z=4.787` (a 6-cent
   reprice IS flagged, with no explanation attached to why). This is the
   same class of surprise as the annual premium: a technically-correct flag
   with no context can read as broken rather than working-as-designed. The
   screen must not present a `mad == 0` flag as self-explanatory.
2. A zero-dispersion group (`modified_z` always `None`) still counts toward
   `scored_groups` — it was scored, in the sense of being checked, even
   though it can never report anything. Left as-is: `scored_groups`'s own
   comment already says "regardless of whether scoring found anything."
3. `category_median_cents` is unsigned while `Anomaly.amount_cents` is
   signed. **Partially addressed while fixing finding 1**: the dataclass
   comment now states explicitly "compare `abs(amount_cents)` against this
   field, never `amount_cents` itself" — the underlying asymmetry itself is
   unchanged (both fields keep their existing, correct, individually-
   documented conventions), only the risk of a naive downstream subtraction
   is now named on the field itself rather than left implicit.
4. `category_id: int | None` on `Anomaly`/`SkippedCategory` is
   unreachable-`None` (both are only ever constructed inside the `if
   row.category_id is None: continue` guard). Left as-is — narrowing it to
   `int` would touch the interface tasks 17/18 build against for a
   type-only cleanup with no behavioral stake, out of scope for a review
   fix round.

### Test run

```
$ .venv/Scripts/pytest.exe tests/test_anomaly.py -v
...
tests/test_anomaly.py::test_a_low_anomaly_ranks_by_the_size_of_its_gap_not_its_sign PASSED
tests/test_anomaly.py::test_the_skip_reason_names_the_sign_groups_own_count_not_the_categorys PASSED
tests/test_anomaly.py::test_a_category_entirely_outside_the_window_is_neither_scored_nor_skipped PASSED
tests/test_anomaly.py::test_a_group_visible_in_the_window_is_still_judged_on_its_whole_history PASSED
...
======================== 22 passed, 1 warning in 0.13s ========================

$ .venv/Scripts/pytest.exe -q --cov=app --cov-report=term-missing
...
app\engines\anomaly.py              66      0   100%
...
TOTAL                             2675     89    97%
495 passed, 258 warnings in 39.37s
```

(473 tests at the start of task 16, +16 in the original commit = 489, +6 in
this fix round including the mutation-driven `test_a_low_anomaly_ranks_by_
the_size_of_its_gap_not_its_sign` = 495. `anomaly.py`: 66/66 statements,
100%.)

### Mutation checks

Re-ran the full 12-mutation matrix from the original commit plus 4 new
mutations targeting this round's fixes (16 total), each applied alone
against the restored file:

| Mutation | Result |
|---|---|
| Sign grouping always "expense" | caught |
| Sign boundary `<=` instead of `<` | caught |
| Drop the `category_id is None` guard | caught |
| `MIN_HISTORY` off-by-one | caught |
| Outlier boundary `<` instead of `<=` | caught |
| Outlier check reduced to `score is None` only | caught |
| `direction` always "high" | caught |
| `direction` inverted | caught |
| Sort order reversed | caught |
| `scored_groups` never incremented | caught |
| `category_median_cents` uses `spread.count` | caught |
| Window gate removed (`in_window` short-circuited to `rows`, always truthy) | caught |
| `MIN_HISTORY` checked against `len(in_window)` instead of `len(rows)` | caught |
| `_unusualness`: `median == 0` returns `0.0` instead of `inf` | caught |
| `_unusualness`: drop `abs()` on the numerator | **not caught on first pass** — added `test_a_low_anomaly_ranks_by_the_size_of_its_gap_not_its_sign`, re-ran: caught |
| Sign labels swapped (`expense`↔`recettes`) | caught |

16/16 caught on the final pass. Recorded honestly: the `abs()` mutation
survived the first run because no existing test combined a "low" and a
"high" anomaly in one ranked report — every prior ranking test used only
"high" cases. Added the missing test rather than leaving the gap.

---

## Fix round 2/2 (review of `e4f71b9`)

Findings 2 and 3 from round 1 confirmed addressed by the reviewer (checked
against the new tests, not just the diff). Finding 1 was reopened: the
round-1 fix (relative deviation from the category's own median) removed the
group-size pathology but relocated the instability to a different trigger —
a tiny median as denominator.

### Independent verification of the counterexample before touching code

Ran the reviewer's fixtures against the shipped `robust.describe`/
`modified_z` first:

```
1-cent baseline, 5 EUR charge    median=1   z=8.847654210268846
50-cent baseline, 50 EUR charge  median=50  z=8.776731130427011
big spike (existing fixture)     median=4000 z=9.574170468393305
```

Confirmed: relative ratios were 499/1 = 499.0 and 4950/50 = 99.0, both above
the real spike's 86000/4000 = 21.5. The reviewer's numbers held exactly.

### Considered pushing back, decided not to

Before implementing, looked for a genuine counterexample to absolute cents
(the ruling explicitly invited one). Found a real property, not a bug: a
big-ticket category's routine variation (e.g. rent moving from 800,00 EUR to
820,00 EUR, a boring 2.5%) could in principle rank above a small-ticket
category's dramatic proportional jump (e.g. coffee from 3,00 EUR to 30,00
EUR) if both happened to clear `OUTLIER_Z` and the absolute gap in cents
favored rent. This is a real tradeoff, but it is not the same class of
failure as the two rejected metrics: it doesn't blow up, doesn't need
special-casing, and is bounded by the actual data. The ruling's own
reasoning ("the one that moved the most money... whatever the baselines")
already weighs and accepts this tradeoff deliberately, and both previous
metrics failed from an unbounded denominator, which absolute cents cannot
have by construction. Concluded there was no counterexample of the kind the
ruling was asking to hear, and implemented as instructed.

### Fix

`_unusualness` (relative ratio) renamed and replaced with `_deviation_cents`
(absolute cents): `abs(abs(amount_cents) - category_median_cents)`, no
division, no denominator, no special case for `category_median_cents == 0`
— that branch is now just an ordinary subtraction like any other, so the
`float("inf")` special-case from round 1 was removed entirely rather than
kept dead. `modified_z` stays exactly as the qualification gate (unchanged);
its field comment and `AnomalyReport.anomalies`'s field comment now lay out
all three attempts — raw z, then the relative ratio, then absolute cents —
and why each of the first two failed, so a future reader has the full
history in one place rather than re-deriving it a third time, per the
ruling's own request.

Two round-1 tests needed correction, not just renaming, because their
fixtures were built to exercise the relative-ratio metric's own instability
and that instability no longer exists:

- `test_a_category_whose_median_is_zero_ranks_first_rather_than_crashing` →
  renamed `test_a_category_whose_median_is_zero_still_ranks_by_cents_moved`.
  Its old assertion (`category_id == 1` first) depended on the round-1
  metric's `float("inf")` special case; under absolute cents there is no
  such case; the two groups compare on ordinary cents (50 000 vs 85 950) and
  category 2 now legitimately ranks first. Verified via `robust.describe`
  before editing the assertion.
- `test_the_ranking_metric_is_relative_deviation_not_raw_modified_z` →
  renamed `test_raw_modified_z_would_misrank_this_but_the_report_does_not`;
  assertions unchanged (both metrics happen to agree on this particular
  fixture — the big spike still outranks the tiny reprice under cents too),
  only the docstring and name were corrected since they described a metric
  that no longer exists.
- `test_a_low_anomaly_ranks_by_the_size_of_its_gap_not_its_sign` — assertions
  unchanged (2000-cent-scale example still orders the same way under cents),
  docstring reworded from percentages to cents.

New test, exactly as the ruling asked: `test_the_ranking_metric_is_absolute_
cents_across_three_categories`, three categories (1-cent baseline, 50-cent
baseline, the existing `big_spike` fixture) in one report, asserting the
full order `[3, 2, 1]` — strictly by cents moved, independent of baseline.

### Test run

```
$ .venv/Scripts/pytest.exe tests/test_anomaly.py -v
...
======================== 23 passed, 1 warning in 0.06s ========================

$ .venv/Scripts/pytest.exe -q --cov=app --cov-report=term-missing
...
app\engines\anomaly.py              64      0   100%
...
TOTAL                             2673     89    97%
496 passed, 258 warnings in 39.50s
```

(495 tests at the start of this round; net +1 here — two tests were renamed
and re-purposed rather than added, one net-new three-category test was
added.)

### Mutation checks

17 mutations, including the two the ruling specifically asked for
(reverting to each of the previously-rejected metrics), each applied alone
against the restored file:

| Mutation | Result |
|---|---|
| Sign grouping always "expense" | caught |
| Sign boundary `<=` instead of `<` | caught |
| Drop the `category_id is None` guard | caught |
| `MIN_HISTORY` off-by-one | caught |
| Outlier boundary `<` instead of `<=` | caught |
| Outlier check reduced to `score is None` only | caught |
| `direction` always "high" | caught |
| `direction` inverted | caught |
| Sort order reversed | caught |
| `scored_groups` never incremented | caught |
| `category_median_cents` uses `spread.count` | caught |
| Window gate removed | caught |
| `MIN_HISTORY` checked against `len(in_window)` | caught |
| Sign labels swapped | caught |
| **Revert to raw `modified_z` ranking (attempt 1)** | **caught** |
| **Revert to relative-ratio ranking (attempt 2)** | **caught** |
| `_deviation_cents` drops `abs()` on the difference | caught |

17/17 caught. Both reversion mutations are now red because of the new
three-category test and `test_a_low_anomaly_ranks_by_the_size_of_its_gap_
not_its_sign` together — the three-category test alone catches attempt 2
(the relative ratio) directly, and catches attempt 1 (raw z) as a side
effect since raw z also misorders that fixture; `test_raw_modified_z_would_
misrank_this_but_the_report_does_not` independently confirms attempt 1 on
its own dedicated fixture.

### Files changed (this round)

- `backend/app/engines/anomaly.py` — `_unusualness` replaced with
  `_deviation_cents`; `AnomalyReport.anomalies` and `Anomaly.modified_z`
  field comments rewritten to record all three ranking attempts.
- `backend/tests/test_anomaly.py` — two tests renamed/corrected, one new
  three-category test added.
