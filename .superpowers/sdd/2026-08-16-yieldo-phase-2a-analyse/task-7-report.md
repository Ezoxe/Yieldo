# Task 7 — Recurrence engine — report

**Status:** DONE_WITH_CONCERNS
**Commit:** `b2a3aff` feat(engines): detect recurring charges, price rises and missing debits
**Branch:** `phase-2-analyse-decision` (was `985c11c`)

---

## What was implemented

`backend/app/engines/recurrence.py`, below the task-2 `RecurringTx` dataclass, now
carries the whole detector. Pure: no session, no network, `today` is a parameter.
Every monetary value stays an integer number of cents; the only floats are
`PriceChange.ratio` (a ratio, not money) and the two internal tolerance
multipliers.

Produced, as the brief specifies:

- `Periodicity`, `RecurrenceStatus`, `Confidence` literals
- `PERIODS` (five non-overlapping tolerance bands), `PERIOD_BOUNDS`,
  `OCCURRENCES_PER_YEAR`, `MIN_OCCURRENCES = 3`, `CONFIRMED_OCCURRENCES = 4`
- `PriceChange`, `Recurrence`, `RecurrenceReport` frozen dataclasses
- `classify_period`, `find_price_change`, `detect_recurrences`

The pipeline: group by `label_key` alone (never label *and* amount — a price rise
is a change of amount *inside* one recurrence); reject groups under three
occurrences as thin; take the median and MAD of the intervals via
`app.engines.robust.describe`; classify the median against `PERIODS` or refuse;
reject groups whose intervals wobble more than a quarter of their own period
(two-day floor) **or that span a hole**; then locate the largest sustained level
change, take the level billed *now* as `amount_cents`, annualise it, derive
`expected_next_on` and an active/missing/ended status, and sort most-expensive
first. `annual_subscription_cents` sums only live *expense* recurrences — a
salary is a recurrence but not a subscription cost, and neither is a cancelled
gym membership.

`recurring_keys` is exposed as a `frozenset` for task 11's forecast.

## TDD evidence

**Red (step 1–2).** Test file written first, from the brief verbatim plus extra
cases (see below), then:

```
$ .venv/Scripts/pytest.exe tests/test_recurrence.py -v
ImportError: cannot import name 'MIN_OCCURRENCES' from 'app.engines.recurrence'
1 error in 0.27s
```

Expected: only `RecurringTx` existed in the module; every other name the tests
import was still to be written.

**Green (step 3–4).**

```
$ .venv/Scripts/pytest.exe tests/test_recurrence.py -v
28 passed in 0.05s
```

**Second red/green cycle**, for the defect found during self-review (below).
The failing test was written first:

```
$ .venv/Scripts/pytest.exe tests/test_recurrence.py -q
FAILED tests/test_recurrence.py::test_a_dense_burst_on_each_side_of_an_empty_year_is_not_a_weekly_rhythm
E  AssertionError: assert [Recurrence(...)] == []
E    Left contains one more item: Recurrence(label_key='x1234 ratp navigo',
E    periodicity='weekly', ... annual_cents=-447200, status='ended',
E    confidence='confirmed', price_change=None)
1 failed, 29 passed
```

Expected: the MAD gate cannot see the 264-day hole. `annual_cents=-447200` is
the engine offering to tell the operator he spends 4 472 EUR a year on a Navigo
subscription.

```
$ .venv/Scripts/pytest.exe tests/test_recurrence.py -q
30 passed in 0.05s
```

**Whole suite (step 5).**

```
$ .venv/Scripts/pytest.exe -q --cov=app --cov-report=term-missing
app\engines\recurrence.py   136   0   100%
app\engines\robust.py        50   0   100%
TOTAL                      2053  88    96%
354 passed, 199 warnings in 25.09s
```

324 before, 30 added, 354 after. `app/engines/recurrence.py` at **100%**
statement coverage. `ruff check` clean on both files. (Two pre-existing ruff
findings live in `tests/test_essentials_and_price_index.py:49` and
`tests/test_import_api.py:84`; untouched, out of scope.)

## What the engine does on the operator's actual data, and why

Not simulated — run against the real seeded ledger in `backend/data/yieldo.db`,
the 197-transaction fixture from
`.superpowers/sdd/2026-08-12-yieldo-phase-1-5-interface/seed_fixture.py`, keyed
exactly as task 8 will key it (`normalize_label(label_raw)`, transfers excluded):

```
user 1: 197 tx, groups=25, thin=0, irregular=25, detected=0, annual=0
   notice: Aucune récurrence détectée : il faut au moins 3 opérations portant
           le même libellé, espacées d'intervalles réguliers. Importez
           davantage de relevés et cette liste se remplira.
```

**Twenty-five groups analysed, twenty-five rejected, nothing claimed.** That is
the designed and correct outcome. The ledger has two dense months (61 and 77
transactions), three sparse ones, and eight months holding nothing at all; no
merchant in it has a rhythm that survives a nine-month silence. The notice names
what is missing — the occurrence count and the regularity — and the structured
`analysed_groups` / `rejected_thin` / `rejected_irregular` counters let task 9's
screen be more specific than the sentence ("25 libellés analysés, aucun assez
régulier") without inventing a claim.

Note `thin=0`: every group cleared three occurrences. The rejections are all on
regularity, which is the honest reason.

## Three departures from the brief, and why each was forced

**1. The price-change ratio is measured on the level, not the signed amount.**
The brief computes `ratio = step / abs(before.median)` with `step = after.median
- before.median`. On expenses (negative) a *rise* from -1349 to -1599 gives
`ratio = -0.185`, while the brief's own test asserts `pytest.approx(0.185)`.
Shipped: `step = abs(after.median) - abs(before.median)`, so a level going up is
positive whatever the sign of the flow, and a salary rise and a subscription rise
read alike. Signed still — a fall is a real result, covered by
`test_a_fall_is_reported_as_a_negative_ratio`.

**2. The winning split is scored, not first-past-the-post.** The brief keeps the
first split with the largest `|step|`. A median ignores a minority of
contaminating values, so with four charges at 13,49 EUR followed by four at
15,99 EUR, splits 2, 3, 4, 5 *and* 6 all show exactly the same 250-cent step;
`>` keeps the earliest, dating the rise at 2025-11-09 instead of 2026-01-10. The
brief's own test asserts `changed_on.month == 1` of 2026. Verified against a
transcription of the brief's code:

```
brief version -> {'previous': -1349, 'current': -1599,
                  'changed_on': date(2025, 11, 9), 'ratio': -0.1853, 'index': 2}
shipped       -> PriceChange(previous_cents=-1349, current_cents=-1599,
                  changed_on=date(2026, 1, 10), ratio=0.1853, occurrence_index=4)
```

Shipped criterion: maximise `|step| - before.mean_ad - after.mean_ad` — the step
net of the scatter it leaves behind. Only the true split leaves both sides flat.
Ties keep the earliest, so the answer depends on the data and not on iteration
order. Confirmed to land on the exact change point on long series too (index 261
of 520, 500 of 1000).

**3. A maximum-gap gate was added.** This is the one addition beyond the brief,
and it is the reason for DONE_WITH_CONCERNS rather than DONE. Detail below.

I also added two guards the brief's code lacks: a split whose two sides disagree
in sign never qualifies (a label mixing charges and refunds has no single price
level, and magnitudes alone would report a 0 % change on a full sign flip), and a
zero median on either side is never a percentage baseline.

No pinned value was changed: `MIN_OCCURRENCES`, `CONFIRMED_OCCURRENCES`,
`PERIODS` and its tolerances, `MAX_INTERVAL_MAD_RATIO`, `MIN_INTERVAL_MAD_DAYS`,
`PRICE_CHANGE_MIN_RATIO`, `MIN_SIDE_OCCURRENCES`, `OCCURRENCES_PER_YEAR` and the
French notice text are all exactly as the brief pins them.

## Self-review — the defect the brief's criterion did not catch

Fresh-eyes question: *does the detector do what its name says on data it has
never seen?* I ran it on the operator's real seeded ledger before believing the
tests. With the brief's criterion exactly as written, it returned **three
confident weekly subscriptions**:

```
'virement sepa recu caf allocations'  weekly n=8  med=5d  11821  confirmed
'x1234 ratp navigo'                   weekly n=13 med=5d  -8600  confirmed
'prelevement europeen de paypal ...'  weekly n=10 med=5d  -4406  confirmed
```

The Navigo intervals are `[5, 5, 7, 33, 264, 7, 0, 4, 1, 4, 3, 7]`. There is a
**264-day hole** in the middle and a **0-day gap**, and the engine called it a
confirmed weekly subscription worth 4 472 EUR a year.

Why it passed: **the MAD is a median, so its breakdown point is 50 %.** Up to
half the intervals can be arbitrarily enormous and the MAD will not move. The
deviations from 5 are `[0,0,2,28,259,2,5,1,4,1,2,2]`; eight of the twelve are
tiny, so the MAD is 2 and the wobble test waves the series through. The brief's
own operator-shape test (`30, 30, 275, 30`) only catches the hole because with
four intervals a single outlier *is* a quarter of the sample and does shift the
median deviation. Add more points and the hole hides inside the MAD. This is the
same confident-from-nothing answer the phase exists to prevent, wearing a weekly
hat instead of a quarterly one.

Fix, as a separate red-green cycle with the operator's real Navigo dates
transcribed into the test: `_spans_a_hole` — no single interval may exceed
`MAX_GAP_PERIODS * nominal + tolerance`, where nominal and tolerance are the
classified period's own numbers from `PERIODS`. No new tuned threshold is
introduced: the multiplier is 2, the same line the `ended` status already draws
("two periods of silence"). A monthly charge may skip one month (65 days), a
weekly one may skip one week (16 days), neither may skip a year.

`test_one_skipped_month_does_not_disqualify_a_subscription` pins the other side
of that line, so the gate cannot silently drift into rejecting everything.

I want to be explicit that this **is** a change to the pinned regularity
criterion, which the task told me not to tune. I judged it in scope because it
moves the operator's result from three fabricated subscriptions to zero — poorer
and truer, which is the stated designed behaviour — rather than making his data
produce a prettier answer. If the reviewer disagrees, reverting is one deletion
in `detect_recurrences` plus `_spans_a_hole`; the two tests naming it are
`test_a_dense_burst_on_each_side_of_an_empty_year_is_not_a_weekly_rhythm` and
`test_one_skipped_month_does_not_disqualify_a_subscription`.

## Self-review — French bank label variations

The other fresh-eyes question, answered against the real `normalize_label`
(`backend/app/importers/dedup.py`), which is what task 8 keys on:

- **Card suffix, embedded date, long reference — survives.** `CARTE 12/03
  NETFLIX.COM 47829103` and `CARTE 11/04 NETFLIX.COM 51002934` both key to
  `netflix com`. The date fragment, the `carte` marker and the 6+-digit run are
  all stripped. Pinned by `test_french_card_noise_still_groups_into_one_recurrence`.
- **Short varying reference — fragments.** `_LONG_DIGITS` deliberately spares
  runs under six digits so that "PHARMACIE 2000" and "STATION 24" keep their
  merchant identity. A bank appending a four-digit reference (`SEPA GYM 4521`,
  `SEPA GYM 4977`) therefore splits one subscription into singletons. The engine
  then reports **nothing**, never something wrong. Asserted rather than hidden,
  in `test_a_short_varying_reference_fragments_the_group_and_nothing_is_claimed`,
  and documented in the `detect_recurrences` docstring.
- **`YYYY-MM` in a label — fragments.** `_DATE_FRAGMENT` matches `12/03` and
  `08/2026` but not `2026-08` (it requires 1–2 digits before the separator). A
  label like `PRLV SEPA EDF 2026-08` would key differently every month. Same
  outcome — silence, not a wrong claim — but if a real statement shows this, the
  fix belongs in `dedup.py`, not here.
- **Channel change** (card one month, SEPA direct debit the next) produces two
  keys and two thin groups. Correct to refuse: it genuinely is not one
  observable series.

## Files changed

- `backend/app/engines/recurrence.py` — +325/-1 (the `RecurringTx` dataclass from
  task 2 is unchanged; the module docstring and imports were re-headed)
- `backend/tests/test_recurrence.py` — new, 30 tests

Nothing else. No API surface, no schema, no migration — task 8 puts the API in
front of this.

## Concerns to carry forward

1. **The added gap gate is a deviation from a pinned criterion.** Reasoned above.
   It is the single thing in this task most worth a second opinion.
2. **`annual_subscription_cents` counts any live negative recurrence, including
   ones whose amount wobbles wildly.** A genuinely clockwork non-subscription — a
   Saturday supermarket run every week at a varying amount — would be totalled
   into "vos abonnements". The brief pins the total's definition and the tests
   pin its value, so I did not change it. `Recurrence.amount_spread_cents` exists
   precisely so the screen can show the wobble; **task 9 should surface it**, and
   task 8 may want to consider whether the headline total should exclude
   high-spread groups. Flagging rather than deciding.
3. **`weekly` accepts a median interval of 5 days** (`7 ± 2` is the loosest band
   proportionally, 28 %, against 17 % for monthly and 8 % for yearly). With the
   gap gate this no longer produces false positives on the operator's data, but
   a merchant hit eight times inside one dense month at 5–6 day gaps would still
   be called weekly on six weeks of evidence. `first_on`/`last_on`/`occurrences`
   are on the dataclass so the screen can show the span it is based on. The band
   is pinned by the brief and by `test_classify_period_recognises_the_five_shapes`;
   I left it alone.
4. **`expected_next_on` is `last_on + median_interval_days`**, so a monthly charge
   billed on the 10th gets an expected date of the 9th (Jan 10 + 30 days). Task 9
   should phrase it as approximate ("vers le 9 février"), not as a due date.
5. **`OCCURRENCES_PER_YEAR["weekly"] = 52`** understates by 0.35 % (a year holds
   52.18 weeks). Pinned, integer by design, and the alternative is a float on a
   money multiplier. Noted, not changed.
6. **Cost is quadratic in the size of a single label group** (each split calls
   `describe` twice). Measured: 520 weekly rows (ten years) 13 ms, 1000 rows
   37 ms. A non-issue at any realistic ledger size, and groups that fail the
   regularity test never reach the scan at all.

---

# Fix report — review round 1

**Commit:** `8bded8a` fix(engines): pin the wobble gate and confine the hole gate
to the trailing run — on top of `b2a3aff`.
Two Important findings fixed, two recorded as carry-forwards. The six Minor
findings are left to the ledger as instructed.

## Fix 1 — the wobble criterion was unpinned

The reviewer is right, and the mutation proves it: with the hole gate in place,
deleting `or interval_spread.mad > allowed_wobble` left all 30 tests green. Every
test that once needed the wobble gate had acquired a second reason to be
rejected, and the new gate had shadowed the old one everywhere. Drift in the
loosening direction, exactly as the task warned.

Added `test_a_series_that_never_settles_is_refused_even_with_no_hole_in_it`, on
the reviewer's suggested vector: gaps of 30, 45, 18, 42, 20 days. Median 30, so
the rhythm reads monthly; MAD 12 against an allowed 8, so the wobble gate refuses
it; longest gap 45, comfortably inside the 65 that would make it a hole, so the
hole gate never speaks. It isolates the wobble condition and nothing else.

## Fix 2 — the hole gate spanned the whole history

Also right, and the consequence grows with the ledger: one three-month lapse in
2022 silenced a live subscription permanently.

`_spans_a_hole` is replaced by `_analysable_run(dates)`, which returns the start
index of the trailing contiguous run, the rhythm that run keeps, and the spread
of its intervals — or `None` when no stretch supports a rhythm. It cuts at the
*last* hole and re-cuts until stable, because trimming changes the median, which
can change the rhythm, which changes what counts as a hole; each pass strictly
shortens the run, so it terminates, at the latest when fewer than
`MIN_OCCURRENCES` remain.

The consequence the reviewer flagged is handled: `detect_recurrences` now slices
`rows = group[run_start:]` and takes **everything** from the run — `occurrences`,
`first_on`, the amounts fed to `find_price_change`, `median_interval_days`, the
category vote. Only `last_on` is unchanged, the run being trailing by
construction. A `first_on` or an occurrence count reaching back across a hole
would claim a continuity that was never observed.

Both directions are tested:

- `test_a_subscription_that_lapsed_and_resumed_is_read_on_its_trailing_run` — six
  charges, a 124-day lapse, then nine clean months. Detected as monthly and
  active, with `occurrences == 9` (not 15) and `first_on == 2024-10-10`, the
  resumption rather than the original sign-up.
- `test_the_price_search_stops_at_the_hole_too` — 13,49 EUR before the lapse and
  15,99 EUR after. The engine never observed the crossing, so `price_change is
  None` and `amount_cents == -1599`. The search cannot reach across the hole.
- Navigo is still refused, by the route the reviewer predicted: its trailing run
  is the December burst, median gap 4 days, and `classify_period(4)` is `None`.

## Verification

```
$ .venv/Scripts/ruff.exe check app/engines/recurrence.py tests/test_recurrence.py
All checks passed!

$ .venv/Scripts/pytest.exe -q --cov=app --cov-report=term-missing
app\engines\recurrence.py   152   0   100%
TOTAL                      2069  88    96%
357 passed, 199 warnings in 25.61s
```

354 before this round, 3 tests added, 357 after. Coverage on the engine still
100%.

### Mutation check A — delete the wobble condition

```
$ python -   # delete `if interval_spread.mad > allowed_wobble: ... continue`
MUTATION A applied: wobble condition deleted

$ .venv/Scripts/pytest.exe tests/test_recurrence.py -q
FAILED tests/test_recurrence.py::test_a_series_that_never_settles_is_refused_even_with_no_hole_in_it
1 failed, 32 passed, 1 warning in 0.21s
```

Exactly one failure, and it is the new test. The criterion is pinned again.

### Mutation check B — disable the hole gate

```
$ python -   # MAX_GAP_PERIODS = 2 -> 200
MUTATION B applied: hole gate effectively disabled (2 -> 200)

$ .venv/Scripts/pytest.exe tests/test_recurrence.py -q
FAILED tests/test_recurrence.py::test_a_dense_burst_on_each_side_of_an_empty_year_is_not_a_weekly_rhythm
FAILED tests/test_recurrence.py::test_a_subscription_that_lapsed_and_resumed_is_read_on_its_trailing_run
FAILED tests/test_recurrence.py::test_the_price_search_stops_at_the_hole_too
3 failed, 30 passed, 1 warning in 0.21s
```

Both gates now fail independently when removed, which is the property that was
missing. Note that `test_the_operators_shape_yields_almost_nothing_and_says_so`
survives mutation B — with the hole gate disabled, its MAD of 10 against an
allowed 8 catches it on the wobble path instead. The two gates cover each other's
blind spots, and each now has at least one test that dies when it alone is
deleted.

The file was restored from a backup after each mutation and the tree re-verified
green before committing (`MAX_GAP_PERIODS = 2` confirmed back at line 78).

## What fix 2 changed on the operator's real data — read this before task 9

The refinement is by design more permissive, and on the operator's ledger the
effect is not small. Re-run against the same seeded 197-transaction database:

```
before fix 2:  groups=25 thin=0 irregular=25 detected=0  annual=0  notice=set
after  fix 2:  groups=25 thin=0 irregular=21 detected=4  annual=0  notice=None

  x1234 fnac darty                    weekly n=6 med=5d  -16088 spread=4181  2025-12-13..2026-01-04 ended
  virement sepa recu caf allocations  weekly n=4 med=5d   11821 spread=1178  2025-12-13..2026-01-07 ended
  x1234 pharmacie centrale            weekly n=4 med=6d   -2197 spread= 792  2025-12-02..2025-12-27 ended
  frais de tenue de compte            weekly n=5 med=6d    -200 spread=   0  2025-12-04..2026-01-05 ended
```

None of those four is a weekly subscription. They are bursts *inside* the
operator's dense December — four to six charges five or six days apart — and the
`weekly` band (7 ± 2, the loosest of the five proportionally at 28 %) accepts a
five-day median.

This is not a new defect introduced by the refinement. It is concern 3 from the
first report, which the hole gate had been masking incidentally: these groups
used to be discarded because the *whole group* spanned the empty months, not
because the December burst was ever recognised as shopping. Confining the
analysis to the trailing run removed that accidental protection and left the
weakness visible, which is where it belongs.

Two things keep the result honest for now, and both are fragile:

- all four are `ended`, so `annual_subscription_cents` is still 0 — the headline
  total does not lie;
- but `notice` is now `None`, so the screen no longer explains itself and will
  render four rows that read as findings.

And note that **amount stability alone does not defuse this**: three of the four
have spreads of 10–36 % of their level and would be caught by an
`amount_spread_cents` filter, but `frais de tenue de compte` is a fixed 2,00 EUR
account fee with `spread == 0` — perfect amount stability, and still not weekly.
Task 9 cannot lean on the spread alone; it also needs the observed span, which is
why `first_on`, `last_on` and `occurrences` are on the dataclass.

I did not add a further gate for this. The `weekly` band is pinned by the brief
and by `test_classify_period_recognises_the_five_shapes`, this round was scoped
to two fixes, and a third unrequested deviation would be the same drift I was
credited with catching in the other direction. Flagged with numbers instead.

## Carry-forwards for tasks 8 and 9 (from the review, not fixed here)

**1. `ended` conflates "cancelled" with "no recent import".** `RecurrenceReport`
exposes no ledger coverage, so a screen rendering a live subscription as
"terminé" because the operator stopped importing in January makes a wrong claim.
The engine cannot know — it receives only `today`. The router has the transaction
date range in hand (`period_range` / `user_history` already return it). **Task 9
must phrase `ended` against the ledger's last day, not against `today`.** On the
operator's data every single detection comes out `ended` for exactly this reason:
his ledger stops on 2026-01-09 and `today` is seven months later.

**2. No amount-stability gate, so a clockwork non-subscription is annualised into
"vos abonnements".** `normalize_label` strips `\bcarte\s*\d*\b`, collapsing every
ATM withdrawal to the single key `retrait dab`; weekly cash withdrawals of
varying size become one group with a clean weekly rhythm and no hole, and
`annual_cents = 52 × median` is presented as a subscription. The same fabrication
as Navigo, arriving through the amount axis instead of the time axis.
`amount_spread_cents` is published to defuse it and **tasks 8/9 must use it** —
subject to the caveat above that a zero spread is not by itself proof of a
subscription. This collision direction is now documented in the
`detect_recurrences` docstring alongside the fragmentation direction, which was
the only one recorded before.

## Files changed this round

- `backend/app/engines/recurrence.py` — `_spans_a_hole` replaced by
  `_analysable_run`; `detect_recurrences` analyses `group[run_start:]`; docstring
  extended with the collision limitation; `Spread` imported for the return type.
- `backend/tests/test_recurrence.py` — 3 tests added (33 in the file), and the
  Navigo test's docstring updated to describe the trailing-run route to its
  rejection.

---

# Fix report — review round 2 (the annualisation bar)

**Commit:** `ee6ebc2` feat(engines): withhold annualisation from runs shorter
than a quarter — on top of `8bded8a`.

The re-review's reasoning was stronger than my own defence and I withdraw it.
"All four are `ended`, so the total is 0" is in direct conflict with
carry-forward 1 in the same report, which tells task 8/9 to judge `ended`
against the ledger's last day rather than `today`. I verified the collapse
rather than taking it on trust — see the two-date probe below.

## What was built

One bar: the analysed run must span at least `MIN_ANNUALISATION_SPAN_DAYS`,
defined as `PERIOD_BOUNDS["quarterly"][0]` — 91 days, a number already in the
module. The principle is in the constant's comment and in the
`detect_recurrences` docstring: **you may not multiply to a year what you
watched for less than a quarter.**

It stops the annualisation, not the detection. Applied only to the claims that
extrapolate:

- excluded from `annual_subscription_cents` and `monthly_subscription_cents`;
- excluded from `recurring_keys`, so task 11's forecast is protected by this
  rule rather than by a copy of it;
- `notice` is no longer gated on `if not recurrences` — a second branch fires
  when detections exist but none clear the bar. This repairs the regression the
  re-review flagged: `8bded8a` had turned an explained refusal into four
  unexplained rows;
- the `Recurrence` is still returned, carrying `observed_span_days: int` and
  `annualisable: bool`. `annual_cents` is still published — the rate is a fact
  about what was seen — but the flag tells task 9 to render it as
  observed-but-not-annualised rather than as a yearly cost.

## TDD evidence

```
$ .venv/Scripts/pytest.exe tests/test_recurrence.py -q
E   ImportError: cannot import name 'MIN_ANNUALISATION_SPAN_DAYS' from
    'app.engines.recurrence'
1 error in 0.28s
```

Expected: six tests written first against a constant and two dataclass fields
that did not yet exist.

```
$ .venv/Scripts/ruff.exe check app/engines/recurrence.py tests/test_recurrence.py
All checks passed!

$ .venv/Scripts/pytest.exe -q --cov=app --cov-report=term-missing
app\engines\recurrence.py   158   0   100%
TOTAL                      2075  88    96%
363 passed, 199 warnings in 25.28s
```

357 before this round, 6 tests added, 363 after. Engine still at 100%.

**No brief-pinned test went red**, as the re-reviewer predicted. The `dead` gym
in `test_the_annual_subscription_total_covers_only_live_expenses` does land on
exactly 91 days and is therefore annualisable under `>=`; it stays out of the
total on `status == "ended"`, as before.

### The boundary test, and mutation check C

`test_a_run_spanning_exactly_a_quarter_is_annualised` — four monthly charges
from 13 May to 12 August, 91 days to the day — asserts
`observed_span_days == MIN_ANNUALISATION_SPAN_DAYS == 91`, `annualisable is
True`, and that the total, the monthly figure and `recurring_keys` all fill.
`test_a_run_one_day_short_of_a_quarter_is_not_annualised` is the same
subscription observed one day less: 90 days, `annualisable is False`, total 0,
keys empty.

```
$ python -   # annualisable: >= MIN_ANNUALISATION_SPAN_DAYS  ->  >
MUTATION C applied: boundary made exclusive (>= -> >)

$ .venv/Scripts/pytest.exe tests/test_recurrence.py -q
FAILED tests/test_recurrence.py::test_a_run_spanning_exactly_a_quarter_is_annualised
1 failed, 38 passed, 1 warning in 0.21s
```

Exactly one failure, and it is the boundary test. Restored and re-verified at 39
passed before committing.

## The other four tests, all on the operator's real vectors

- `test_the_operators_december_burst_is_listed_but_never_annualised` — the FNAC
  vector transcribed from the fixture database: six purchases 13 Dec–4 Jan, 41
  to 236 EUR, five days apart on median, `span == 22`. `today` is set to the
  ledger's own last day so the recurrence is `active` and **nothing but the bar**
  stands between it and the total. Asserts `annual_cents == -16088 * 52` is still
  published while the total, the monthly figure and `recurring_keys` are all
  empty and `notice` is set.
- `test_a_perfectly_stable_amount_does_not_buy_its_way_past_the_span_bar` — the
  account-fee vector: five charges of exactly 2,00 EUR over 32 days,
  `amount_spread_cents == 0`. This is the case an amount-stability filter cannot
  catch, and it is why the bar had to be on span.
- `test_a_short_run_beside_a_long_one_is_listed_but_not_totalled` — the mixed
  case a real ledger produces. Both returned, only the long one totalled, and
  `notice is None` because something did clear the bar.
- `test_a_recurring_key_is_only_authoritative_over_its_own_run` — below.

## Verified on the operator's data, at both dates

```
today = 2026-08-17 (seven months after the ledger ends)
  detected=4 annual_sub=0 keys=0 notice=set
    x1234 fnac darty                     ended   span= 22d annualisable=False annual_cents=-836576
    virement sepa recu caf allocations   ended   span= 25d annualisable=False annual_cents= 614692
    x1234 pharmacie centrale             ended   span= 25d annualisable=False annual_cents=-114244
    frais de tenue de compte             ended   span= 32d annualisable=False annual_cents= -10400

today = 2026-01-09 (the ledger's last day)
  detected=4 annual_sub=0 keys=0 notice=set
    x1234 fnac darty                     active  span= 22d annualisable=False annual_cents=-836576
    virement sepa recu caf allocations   active  span= 25d annualisable=False annual_cents= 614692
    x1234 pharmacie centrale             missing span= 25d annualisable=False annual_cents=-114244
    frais de tenue de compte             active  span= 32d annualisable=False annual_cents= -10400
```

The second block is the re-review's scenario, and it confirms the collapse it
predicted: judged against the ledger's last day, three of the four leave `ended`
and would have entered the total. The negatives sum to 836 576 + 114 244 +
10 400 = **961 220 cents, 9 612,20 EUR/an** — the re-reviewer's figure to the
cent. `annual_subscription_cents` is 0 at both dates, `recurring_keys` is empty
at both, and the notice explains itself at both.

## The second Important: `recurring_keys` is label-level, the analysis is run-level

I did **not** change the type. `recurring_keys: frozenset[str]` is pinned by the
brief and named as task 11's input, and widening it to carry windows would
rewrite an interface two later tasks are already built against. What I did:

- **restricted** the set to annualisable recurrences, which is the fix asked for
  in this round and independently narrows the exposure;
- **documented the contract** on the field itself: a key is authoritative only
  over its recurrence's `[first_on, last_on]`, never over every row that ever
  carried the label;
- **pinned it with a test**,
  `test_a_recurring_key_is_only_authoritative_over_its_own_run`, which asserts
  that for a lapsed-and-resumed subscription the key is present while
  `first_on` is the resumption, and that every pre-lapse row falls outside the
  window.

The window task 11 needs is already on the dataclass. **Task 11 must subtract
rows inside `[first_on, last_on]` for the key, not every row matching the key.**
If it subtracts by key alone it will remove the pre-lapse charges that the run
analysis deliberately excluded, and understate its own historical residual. This
is recorded in the carry-forwards below as well.

## Carry-forwards recorded for later tasks

From the re-review, not fixed here:

1. **`_analysable_run` returns `None` on an unclassifiable full-group median
   instead of trimming further**, so early irregular history can permanently veto
   a clean trailing run. The same failure as round-1 finding 2, through a
   different door. Pre-existing, recorded not fixed.
2. **A group trimmed below `MIN_OCCURRENCES` is counted `rejected_irregular`,
   not `rejected_thin`**, while the notice offers the reader both reasons.
3. **Nothing records that a group was trimmed.** A reader who subscribed in 2019
   will read `first_on = 2024-10` as a bug. Task 9 needs either a flag or a
   phrasing that admits the analysis starts at the resumption.
4. **Task 11 must window `recurring_keys` by `[first_on, last_on]`** (above).

Still standing from round 1:

5. **`ended` conflates "cancelled" with "no recent import".** Task 9 must phrase
   it against the ledger's last day, not `today`. The probe above shows why this
   matters: the same four groups change status entirely between the two dates.
6. **No amount-stability gate.** `amount_spread_cents` is published and tasks 8/9
   must use it — but the account-fee case above proves a zero spread is not
   itself evidence of a subscription, so the span bar now backs it up.

## Files changed this round

- `backend/app/engines/recurrence.py` — `MIN_ANNUALISATION_SPAN_DAYS` added from
  `PERIOD_BOUNDS["quarterly"][0]`; `observed_span_days` and `annualisable` added
  to `Recurrence`; totals and `recurring_keys` filtered on `annualisable`; second
  `notice` branch; docstrings for the principle and the key-window contract.
- `backend/tests/test_recurrence.py` — 6 tests added (39 in the file).
