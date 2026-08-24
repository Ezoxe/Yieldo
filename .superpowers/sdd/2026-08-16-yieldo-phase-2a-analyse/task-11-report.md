# Task 11 — Cash-flow forecast engine

**Status:** DONE_WITH_CONCERNS
**Commit:** `d51fbbc` feat(engines): project twelve months of balance as a confidence band
**Tests:** 425 backend (396 → 425, +29), all green. `app/engines/forecast.py` at 100 %
statement coverage. `ruff check` clean.

---

## 1. Where the brief disagreed with the shipped code

The brief was stale in three provable ways and wrong in a fourth. The code won each
time.

### 1.1 The brief's test file cannot execute (blocking)

Both `Recurrence(...)` literals in the brief omit `observed_span_days` and
`annualisable`. Both are required positional fields on the shipped dataclass
(`recurrence.py:140-147`), added by task 8 (`ee6ebc2`, "withhold annualisation from
runs shorter than a quarter"). The brief's test file raises `TypeError` at collection.
The brief predates `ee6ebc2`. Fixed by supplying both fields on all five fixtures.

### 1.2 The brief never implements the carry-forward it was warned about

The brief's answer to the windowed-subtraction problem is a docstring sentence telling
the *caller* to pass "observations built from non-recurring rows only, using
`RecurrenceReport.recurring_keys`". That is the exact trap task 7's review flagged —
`recurring_keys` is a bare key set, and following the brief's own instruction produces
the defect. Nothing in the brief's engine windows anything. See §3.

### 1.3 The brief's recurrence walk double-bills a month, and its own test hides it

`_recurring_by_month` steps by `median_interval_days`. For a monthly recurrence that is
30 days, which yields 365/30 = 12.17 charges a year: inside a twelve-month horizon one
month receives two rent payments and the chart grows a spike no bank statement will
ever show. Task 13 draws this.

The tell is in the brief's own assertion:

```python
assert all(month.recurring_cents <= -78_000 for month in report.months[:6])
```

`<=` rather than `==`, and only the first six months. A month billed −156 000 passes.
The test was written to tolerate the bug. My version asserts the exact list
(`test_a_monthly_charge_lands_exactly_once_in_every_month_it_is_due`).

### 1.4 The brief's seasonal fixture violates the principle the brief itself states

The brief's `_observations` docstring argues at length that identical months give a MAD
of zero, hence a band of zero width, "which would make every assertion about the
confidence interval below vacuously true. Real months are never identical, and the
fixture must not be either." Its `test_a_calendar_month_seen_twice...` fixture then uses
two **perfectly identical** years (2024 and 2025 both −40 000 in December, −10 000
elsewhere). Rebuilt with mirrored jitter so each calendar month's median is exactly its
base while the sample still carries dispersion.

### 1.5 Minor

- Predicted counts are stale: "13 tests", "366 passed". Actual baseline was 396; this
  task ships 29 tests for 425.
- The brief imports `MonthlyEntry` from `capacity` in the test and `MonthObservation` in
  the engine; both correct, noted only because other briefs in this plan got this wrong.
- The task prompt calls `capacity.py` "task 1" work and `robust.py` "task 1"; in the
  shipped history `robust.py` is `3c96e50` and `capacity.py`/`runway.py` are task 10
  (`fb9a0fe`..`15d34a4`). Immaterial to the work.

---

## 2. TDD evidence

**Red first.** `tests/test_forecast.py` written before `forecast.py` existed:

```
tests\test_forecast.py:6: in <module>
    from app.engines.forecast import (
E   ModuleNotFoundError: No module named 'app.engines.forecast'
```

**Green after implementation:** 26 passed, then 29 after the second red/green cycle
described in §5.

**Mutation-tested, because a passing test is not evidence a test bites.** I reverted
each of the three load-bearing behaviours to the brief's version and confirmed the
intended test — and only that test — failed:

| Mutation applied to `forecast.py` | Result |
|---|---|
| `if spans:` — subtract by bare key, not by window | `test_the_recurring_subtraction_is_windowed_and_not_done_by_bare_key` **FAILED**, `test_the_split_loses_no_money` **FAILED** |
| `step_months = None` — day-walk every periodicity, as the brief does | `test_a_monthly_charge_lands_exactly_once_in_every_month_it_is_due` **FAILED** |
| `centre_units = 0.0` — the brief's bare `sqrt(k)` band | `test_the_band_is_wider_when_fewer_months_were_observed` **FAILED** |

All three reverted; `git status` confirmed only the two new files untracked before
committing.

---

## 3. How the recurring-row subtraction is windowed

`residual_entries(entries, recurrences)` owns the split, so task 12 cannot get it wrong
by filtering the ledger itself. A row is withheld only when it falls inside a specific
recurrence's `[first_on, last_on]`:

```python
if spans and any(start <= entry.on <= end for start, end in spans):
    continue
```

**The governing invariant is symmetry.** `_is_projected()` gates *both* halves: a row is
withheld from the residual **if and only if** the recurrence withholding it is also
projected forward. Two gates, both inherited rather than invented:

- `annualisable` — task 8's rule. `recurring_keys` already excludes these; projecting
  them would push the same unearned claim in by another door.
- `status != "ended"` — a cancelled subscription is not a future charge.

So an ended or too-young recurrence is projected nowhere, and its historical rows
therefore stay in the residual and go on weighing exactly what they weighed. That errs
pessimistic, which is the right direction for a floor warning resting on a `status` that
is itself a heuristic over a sparse ledger.

`test_the_recurring_subtraction_is_windowed_and_not_done_by_bare_key` builds a real
lapsed subscription (billed Jan–Mar 2025, six-month lapse, resumed Oct 2025–Mar 2026),
runs the **actual** `detect_recurrences` over it, and pins both sides the way
`test_capacity.py` pins its ledger-bounds precondition: the three pre-lapse charges
survive in the residual, and a bare-key filter is shown to lose exactly 40,47 € that is
then accounted for nowhere. `test_the_analysed_run_really_does_start_after_the_lapse`
pins the premise so the test cannot silently stop testing anything.

---

## 4. What it returns on the operator's data

**It refuses**, which is the plan's designed outcome (plan line 64: `Prévision | ≥6
complete observed months | 3 | refuses`).

`test_the_operators_own_ledger_is_refused_end_to_end` builds 197 transactions across the
operator's real shape — two dense months (Feb, Mar), three sparse, eight empty
(April–November 2025), partial months at both ledger edges (opens 24 Jan, closes 9 Jan)
— and runs the **whole pipeline** a screen will use: `detect_recurrences` →
`residual_entries` → `complete_months` → `project_cashflow`. Three complete observed
months, `months == []`, and:

> Pas assez de données pour projeter : il faut au moins 6 mois complets de relevés, et
> l'historique n'en compte que 3. Importez des relevés supplémentaires pour obtenir une
> prévision.

The threshold was not tuned. `MIN_MONTHS_FOR_FORECAST = 6` is the floor at which a
second observation of any calendar month can exist at all — below it seasonality cannot
be looked for, and the phrase "saisonnalité observée" in §6.2 would be a lie.

---

## 5. Two defects I found in my own work, and fixed

### 5.1 The band was decoration (found by reasoning, fixed before first commit)

The brief's half-width is `quantile_offset_cents(sigma) * sqrt(index + 1)`. That prices
the *noise* and treats the projected centre as if it were known exactly. It is not — it
is a median of six numbers. Writing the balance error at month *k*:

```
sum(noise) + k * (mu - mu_hat)     variance = k*sigma^2 + k^2*Var(mu_hat)
```

The centre error is **systematic**: it compounds every month instead of averaging out,
so it enters as *k squared*, and it is divided by the number of observed months. The
consequence is the one that matters for honesty: **the brief's band draws the same
ribbon whether the reader has six months of statements or five years.** At n=6, k=12 my
band is 2.0× the brief's. `Var(median) = (pi/2) * sigma^2 / n` uses the published
asymptotic efficiency of the median, in the same spirit as `robust.MAD_TO_SIGMA`.

Pooled months share one estimate (errors add, then square); seasonal months come from
disjoint samples (variances add directly). `sigma` is measured on deviations from
whichever centre each month actually uses, so a real seasonal swing counts once as
signal and not again as noise — and degrades to exactly the brief's figure when no
seasonality is used.

I deliberately did **not** substitute a Student's *t* quantile for `P90_SIGMAS`. It would
be mixing frameworks: `sigma` here comes from a MAD, not a sample standard deviation, and
*t* is derived for the latter. The docstring states plainly that the estimated scale is
treated as known and carries ~30 % relative error of its own at n=6 — that unpriced
limitation is *why* the floor is 6 and not 3.

### 5.2 The refusal named the wrong cause (found by smoke-testing an unseen ledger)

I ran the engine on a synthetic 12-month household. It refused with
`months_observed = 0` despite twelve complete months of statements.

The cause is real and will reach production: **`months_observed` counts months carrying
*residual* activity, which is not the number of months the ledger covers.**
`complete_months` never emits a month with no entries, so a household whose every charge
is recurring leaves months with no residual at all. That reader was being told
"Importez des relevés supplémentaires" — asked to fix something that is not broken.

This is precisely the defect task 10's review round fixed in `runway.py`
(`insufficient_reason` hard-coding the month count as the cause). Fixed the same way:
a second red/green cycle added an optional `ledger_months_observed` parameter, a
`ledger_months_observed` field on the report, and a second, mutually exclusive reason:

> Prévision impossible : l'historique couvre 12 mois complets, mais aucun ne porte
> d'opération non récurrente — il en faut au moins 6 pour mesurer la part variable des
> dépenses. Presque toutes les opérations sont déjà rattachées à une récurrence détectée…

Three grammatical registers (0 / 1 / n), all covered. A residual claiming more complete
months than the ledger it came from raises rather than silently picking a branch.

---

## 6. Deliberate deviations from the plan's fixed shapes

All additive; task 12 is not yet written. Task 10 set the precedent (it added `rate` to
`RunwayScenario` and split one `insufficient_reason` into two) and its review approved.

- `ForecastReport` gains `ledger_months_observed`, `recurrences_projected` and
  `residual_scale_cents`. The first is §5.2. The second lets the screen say why an
  ended or too-young recurrence is absent from the chart. The third lets the screen
  explain the band without re-measuring it.
- `project_cashflow` gains keyword-only `ledger_months_observed: int | None = None`.
- New public `LedgerEntry` and `residual_entries` — the plan left the split to the
  caller, which is the trap (§3).
- New `MAX_HORIZON_MONTHS = 24`, documented as an input guard on task 12's future query
  parameter, not an analytic knob.
- `MIN_MONTHS_FOR_FORECAST`, `DEFAULT_HORIZON_MONTHS`, `MIN_OBSERVATIONS_FOR_SEASONALITY`
  are all exactly as the plan specifies.

---

## 7. Self-review: what it does on a ledger it has never seen

Ran against a 229-transaction, 12-month synthetic household (salary, rent, subscriptions,
irregular groceries) that the tests never see. Detected salary, rent, video and two
quarterly charges; residual 12 months, scale 230 €/month:

```
2026-01  recur=+1556  resid=-708   p50=  5847   +/-  313
2026-06  recur=+1474  resid=-708   p50=  9922   +/-  963
2026-12  recur=+1474  resid=-708   p50= 14845   +/- 1635
```

Sanity: 1.2816 × 230 × sqrt(1 + (pi/2)/12) = 314 at month 1; × sqrt(12 + (pi/2)·144/12)
= 1638 at month 12. Both match. The quarterly rows correctly land 4×/year (March, June,
September, December differ from the other months). ±1 635 € at twelve months out, from
230 €/month of measured noise and twelve observed months, is a band I can defend — not a
decoration.

**Is the band honest?** With the §5.1 fix, yes for what it prices: month-to-month noise
and the sampling error of the centre. It does *not* price the uncertainty of the scale
estimate itself (~30 % relative at n=6), nor any wobble in the recurrence amounts
(`amount_spread_cents` is available and unused). Both are stated in the docstring rather
than quietly omitted. The residual honest answer is that at exactly n=6 this band is a
lower bound on the true uncertainty, which is the direction that argues for the floor
staying at 6.

---

## 8. Files changed

- `backend/app/engines/forecast.py` — new, 479 lines, 100 % covered
- `backend/tests/test_forecast.py` — new, 29 tests

Nothing else touched. No API, no schema, no frontend (tasks 12–14).

---

## 9. Concerns and carry-forward

**CARRY TO TASK 12 (important):** `project_cashflow` must be called with
`ledger_months_observed=len(complete_months(<unfiltered ledger>, …))`. Omitting it makes
the two refusal causes indistinguishable and a reader with a year of statements will be
told to import more. And `residual_observations` must be
`complete_months(residual_entries(entries, report.recurrences), …)` — **never** a filter
on `recurring_keys` (§3).

**CARRY TO TASK 12:** task 10's ledger-bounds precondition binds here too, transitively:
`ledger_start`/`ledger_end` must be the min/max of actually-imported transaction dates,
never a requested window. Both `complete_months` calls above are affected.

**CARRY TO TASK 12:** `LedgerEntry.label_key` must be `normalize_label(label_raw)` —
the same key given to `detect_recurrences`, recomputed at the API boundary, never the
stored `label_clean` (plan line 50).

**CARRY TO TASK 13:** a month can legitimately show `recurring_cents == 0` while the
household has live subscriptions — quarterly and yearly charges land in some months and
not others. The chart must not read that as missing data.

**Concern — the `ended` decision is a judgement call.** I chose "subtract exactly what
you project", so an ended recurrence's rows stay in the residual and make the forecast
slightly pessimistic. The alternative (remove them, project nothing) makes it more
optimistic on the strength of a `status` heuristic that, on a sparse ledger, often means
"no statement was imported" rather than "cancelled". I took the pessimistic side
deliberately and documented it in `_is_projected`. A reviewer may reasonably disagree;
it is one predicate and one test to flip.

**Concern — seasonality needs 24 months to do anything at all.** With 6–11 observed
months no calendar month has two samples, so `seasonality_used` is always False and every
month gets the pooled median. The engine is truthful about this (`seasonal` is per-month,
`seasonality_used` is on the report), but the screen should not imply a seasonal
projection is happening when it is not. §6.2's "saisonnalité observée" only becomes real
at two years of history — well beyond what the operator has.

**Minor:** `residual_scale_cents` is 0 on a refusal path where nothing was measured. It
is documented as such and `insufficient_reason` is the authoritative signal, but it is a
zero standing next to an unknown, which this repo is otherwise strict about.

**Minor:** `test_the_split_loses_no_money` recomputes `withheld` over all recurrences
rather than only projected ones. Inert in that fixture (its single recurrence is
projected), and the dimension is covered separately by
`test_what_is_not_projected_is_not_subtracted_either`.

---

# Fix round 1 — review findings

**Tests:** 431 backend (425 → 431, +6), all green. `forecast.py` still 100 %. `ruff` clean.

## Finding 1 — seasonality half-on under-priced the band

**Fixed. I took the reviewer's second option: price each month against the scale
of the centre it actually got.** Reasons for choosing it over all-or-nothing:

1. **All-or-nothing would delete the feature, not fix it.** At a twelve-month
   horizon every calendar month appears exactly once, so "every horizon month
   has two samples" *is* "twenty-four observed months". That collapses to my
   already-disclosed concern and makes §6.2's "saisonnalité observée sur
   l'historique réel" unreachable on any realistic ledger.
2. **It would replace an under-priced band with a wrong centre.** A twice-observed
   December costing four times a normal month would be projected at the pooled
   median — a centre we hold direct evidence against — and a December breach is
   exactly the event this engine exists to warn about. An under-priced band is
   bad; a missed breach is worse.
3. **Per-month pricing is the finer-grained version of the rule this phase already
   applies.** "Refuse rather than guess" is a per-claim rule. Seasonality for a
   December with two samples is a supportable claim; for a March with one it is
   not. Making each claim independently *and pricing each against its own
   evidence* is the same doctrine at month resolution.

So there are now two scales, each measured over the population that bears on it:

- `pooled_scale_cents` = `describe(nets).sigma` — what *a* month varies by,
  seasonal swing included, because for a calendar month we cannot explain, that
  swing is precisely the uncertainty we still carry;
- `seasonal_scale_cents` = the spread of `net − own-calendar-month median`, over
  the seasonally-eligible observations **only**.

Each projected month accumulates variance against the scale of the centre it got.
Both pure cases degenerate to the previous single-scale behaviour exactly — with
no seasonality `describe(deviations).sigma == describe(nets).sigma` identically,
so nothing already reviewed changed number.

`seasonal_scale_cents` is `int | None`: None means no calendar month reached the
threshold so nothing measured it, which is a different answer from a measured
zero — and only the measured zero is grounds to refuse. The zero-dispersion
refusal now fires per scale-in-use: a degenerate seasonal scale is irrelevant to
a horizon projected entirely from the pooled one, and vice versa.

### The test I first wrote for this was not good enough, and mutation testing caught it

My initial test asserted only that the fallback month's band was *wider* than the
seasonal month's. Mutating `month_scale = pooled_scale` to use the seasonal scale —
the exact defect — **left all 35 tests green.** The ordering held for the wrong
reason: the centre term is sized on `pooled_scale` for any fallback month, so July
stayed wider even with its own noise term collapsed by a factor of 175.

The test now pins each side against the scale it must have been priced with, using
the engine's own published `quantile_offset_cents`: one month out, a fallback
month's noise term alone is one pooled sigma, so its half-width cannot be below
that sigma's own P10/P90 offset; and a seasonal month's must be nowhere near it.
Both directions are now mutation-covered.

## Finding 2 — the symmetric caller trap, closed by shape rather than by note

`build_observations(entries, recurrences, ledger_start, ledger_end) -> ResidualHistory`
is now the whole of what task 12 calls.

I did **not** use the reviewer's literal `-> tuple[list[MonthObservation], int]`,
because a tuple destructured into two locals still lets the caller pass one and
forget the other — which is the defect being closed. `ResidualHistory` is a frozen
dataclass carrying both counts, and `project_cashflow`'s second parameter now *is*
that type. The optional `ledger_months_observed` keyword is gone. The residual is
windowed inside the helper and the ledger count is measured over the same bounds in
the same call, so neither mistake has a spelling any more. The
`ledger_months >= len(observations)` invariant moved onto the type's
`__post_init__`, checked once at construction rather than at each consuming call.

Task 10's `ledger_start` / `ledger_end` precondition is carried verbatim into
`build_observations`'s docstring, where it now binds both counts at once — that is
the single place a caller can get it wrong, and it is the place that says so.

## TDD evidence

Two red/green cycles, each red verified before implementation.

Cycle 1 (band pricing) — the diagnosis reproduced exactly, the fallback month
being the *narrower* of the two:

```
E   AssertionError: assert 794 > 1018
E    + where 794 = _width(ForecastMonth(key='2025-07', ..., seasonal=False))
E    + and 1018 = _width(ForecastMonth(key='2026-01', ..., seasonal=True))
E   AttributeError: 'ForecastReport' object has no attribute 'pooled_scale_cents'
3 failed, 29 passed
```

Cycle 2 (call shape):

```
E   ImportError: cannot import name 'ResidualHistory' from 'app.engines.forecast'
```

Final mutation matrix, each mutation applied alone against a restored file:

| Mutation | Caught by |
|---|---|
| subtract by bare key, not by window | `..._is_windowed_and_not_done_by_bare_key`, `..._split_loses_no_money` |
| day-walk every periodicity | `..._monthly_charge_lands_exactly_once...` |
| drop the centre-uncertainty term | `..._band_is_wider_when_fewer_months_were_observed` |
| fallback months priced on the seasonal scale | `..._no_seasonal_estimate_is_priced_against_the_pooled_spread` |
| seasonal months priced on the pooled scale | `..._no_seasonal_estimate_is_priced_against_the_pooled_spread` |

```
$ .venv/Scripts/ruff.exe check app/engines/forecast.py tests/test_forecast.py
All checks passed!

$ .venv/Scripts/pytest.exe -q --cov=app --cov-report=term-missing
app\engines\forecast.py            178      0   100%
TOTAL                             2404     88    96%
431 passed, 219 warnings in 60.40s
```

## Unseen-ledger smoke, re-run through the new shape

Two synthetic households the tests never see, December deliberately the busiest
month:

```
--- 12 months (no seasonality possible) ---
ledger=12 residual=12 seasonal_used=False
pooled_scale=132EUR  seasonal_scale=None
  2026-01 seasonal=False resid=-825  p50= 5727  +/-179
  2026-12 seasonal=False resid=-825  p50=13721  +/-936

--- 24 months (seasonality available) ---
ledger=24 residual=24 seasonal_used=True
pooled_scale=146EUR  seasonal_scale=66EUR
  2026-01 seasonal=True  resid=-550  p50= 6001  +/-114
  2026-12 seasonal=True  resid=-914  p50=14615  +/-393
```

December draws the most negative seasonal residual (−914 EUR against −550 EUR in
January), which is the busy December fed in. The seasonal scale is less than half
the pooled one, and the twenty-four-month band is correspondingly tighter — the
model explains more, so it claims more, and it is entitled to.

## On the five Minor findings

Left, as instructed, with one note: `residual_scale_cents` no longer exists under
that name. Its successor `pooled_scale_cents` is still `int` and still 0 on a
refusal, so that Minor stands unchanged. The `int | None` treatment the Minor asks
for was applied to `seasonal_scale_cents` alone, where the distinction is
load-bearing rather than cosmetic: None (nothing measured it) and 0 (measured, and
degenerate) lead to different branches, and only the second refuses.

## Files changed in this round

- `backend/app/engines/forecast.py`
- `backend/tests/test_forecast.py`

## Carry-forward, superseding §9

**TASK 12 now makes exactly one call to prepare its input:**

```python
history = build_observations(entries, report.recurrences, ledger_start, ledger_end)
forecast = project_cashflow(balance_cents, history, report.recurrences, today)
```

`ledger_start` / `ledger_end` must still be the min/max of actually-imported
transaction dates, never a requested window — that is the one precondition the
type cannot enforce, and it is stated in `build_observations`'s docstring.
`LedgerEntry.label_key` must still be `normalize_label(label_raw)`, the same key
given to `detect_recurrences`.

**TASK 13:** `ForecastMonth.seasonal` is now per-month and genuinely mixed on a
13–23-month ledger — some months in one chart will be seasonal and some pooled,
with visibly different band widths. That is the engine being honest, not an
artefact; the chart should not smooth it away, and the legend has two scales
(`pooled_scale_cents`, `seasonal_scale_cents`) available to explain it.

---

# Fix round 2 — regression introduced by round 1

**Tests:** 433 backend (431 → 433, +2), all green. `forecast.py` still 100 %. `ruff` clean.

## The Important issue — a degenerate seasonal scale killed the whole forecast

Confirmed and fixed, and the reviewer's reading of it was exactly right. Round 1
introduced it: the base code's single sigma was measured over the *mixed*
deviation set and so stayed non-zero, while a separately-measured seasonal scale
can be zero on its own.

**Red first**, and the failing test reproduced both halves of the defect —
the total loss and the false explanation:

```
E  assert "Impossible de mesurer un intervalle de confiance : les 13 mois
   observés ne varient pas d'un mois à l'autre, ..." is None
E   + where ... = ForecastReport(months=[], months_observed=13, ...)
2 failed, 35 passed
```

Thirteen observed months, eleven of them varying perfectly normally, the entire
twelve-month projection refused — and the reader told their months do not vary
from one to the next, which was simply false and gave them nothing to act on.

**The repair is the first one suggested: fall back, do not refuse.** A calendar
month whose samples never move tells us nothing about how *that* month varies, so
there is no seasonal estimate to price it against and it belongs on the pooled
centre and scale like any other month the model cannot explain. `seasonal_scale`
is now `describe(...).sigma or None`, and `centre_of` treats `None` as "no
seasonality anywhere" — eligibility (sample count) and usability (a non-degenerate
scale) are now two separate questions, which is what round 1 conflated.

A pleasant consequence: **the refusal condition collapses to one line.**
`pooled_scale == 0` implies every net is identical, which implies every seasonal
deviation is 0, which implies `seasonal_scale is None`, which implies every month
is pooled. So the horizon-dependent `degenerate` expression is gone, the check
moves up before the horizon is even built, and `_reason_no_dispersion` is now
reachable *only* when its French text is true. That is pinned by its own test
rather than left to argument.

## The seasonal assertion was one-sided — corrected, and the report sentence with it

The reviewer is right and my §"Finding 1" claim was overstated. `_width(seasonal)
// 2 < pooled_offset` reduces to `month_scale < pooled / 1.336`: 297 against
38 835, roughly 130× of slack. It pinned "not the pooled scale", not "the seasonal
scale".

Now bounded against its *own* scale: one month out the exact multiplier is
`sqrt(1 + (pi/2)/2) = 1.336`, so twice the seasonal scale's own P90 offset is a
ceiling nothing mis-priced fits under. Slack drops from ~130× to 2×.

**Correction to the fix-round-1 report:** the sentence "each side is now pinned
against the scale it must have been priced with" was true of the fallback side
(tight to about 4.5 %) and overstated of the seasonal side, which pinned only
"not the pooled scale". It is true of both as of this round.

Proved by adding the reviewer's own counter-example to the mutation matrix —
seasonal months priced at *half* the pooled scale, which the old assertion would
have passed:

| Mutation | Caught by |
|---|---|
| subtract by bare key, not by window | `..._is_windowed_and_not_done_by_bare_key`, `..._split_loses_no_money` |
| day-walk every periodicity | `..._monthly_charge_lands_exactly_once...` |
| drop the centre-uncertainty term | `..._band_is_wider_when_fewer_months_were_observed` |
| fallback months priced on the seasonal scale | `..._priced_against_the_pooled_spread` |
| seasonal months priced on the pooled scale | `..._priced_against_the_pooled_spread` |
| **seasonal months priced at half the pooled scale** | `..._priced_against_the_pooled_spread` |
| **degenerate seasonal scale refuses again** | `..._cent_exact_calendar_month_falls_back...` |

Seven mutations, seven caught, each applied alone against a restored file.

## The two Minor items flagged as worth acting on

**"Exactly as before" was exact in the algebra and off by ≤1 cent in the output.**
Reworded, and measured rather than assumed — 200 000 random `(sigma, n, k)` draws
comparing the single factored-out sigma against accumulate-then-round:

```
max |old-new| over 200k random (sigma,n,k): 1 cents   worst case (249747, 18, 21, 2468530, 2468531)
```

The docstring now says: same model, one extra rounding, a published band can sit
one cent off the single-scale figure.

**Bare `round()` is banker's rounding.** Kept, with the reason written down where
the next reader will ask. The value is `sqrt(noise + centre)` — a sum of squares,
so non-negative by construction and never a signed amount. The bias `robust._half`
and `recurrence._divide` exist to prevent is a *directional* one on signed money;
there is no direction here, a tie moves a band edge by at most one cent, and
`robust.describe` rounds its own sigma the same way.

## Verification

```
$ .venv/Scripts/ruff.exe check app/engines/forecast.py tests/test_forecast.py
All checks passed!

$ .venv/Scripts/pytest.exe -q --cov=app --cov-report=term-missing
app\engines\forecast.py            181      0   100%
TOTAL                             2407     88    96%
433 passed, 219 warnings in 60.30s
```

## Files changed in this round

- `backend/app/engines/forecast.py`
- `backend/tests/test_forecast.py`

## Carry-forward unchanged

Task 12 still calls `build_observations` then `project_cashflow`; the
`ledger_start` / `ledger_end` precondition still binds and is still the one thing
the type cannot enforce. Task 13's note about genuinely mixed `seasonal` flags on
a 13–23-month ledger stands, with one addition now worth knowing: a ledger in that
range whose one doubled calendar month is cent-exact will report
`seasonality_used = False` and `seasonal_scale_cents = None` while still producing
a full twelve-month projection. That is the fallback working, not a missing
estimate to apologise for.

---

# Fix round 3 — stale field comment introduced by round 2

**Commit:** `3161dff` docs(engines): correct what a null seasonal scale now means
**Tests:** 433 backend, unchanged and green. `forecast.py` 100 %. `ruff` clean.
Comment only — no behaviour change, so no new test.

## The Important issue

Confirmed on both points. Round 2's `describe(...).sigma or None` invalidated a
comment written for round 1's code, and I did not revisit it when I made the
change. The comment claimed:

1. `None` arises only from the eligibility/count case — false as of round 2,
   since a genuinely measured zero is now collapsed to `None` at source;
2. a measured zero "is a reason to refuse" — the exact behaviour round 2
   removed.

A reader — task 12, task 13, or a later engine — would have concluded that a
`None` here means "too little history to look" and that a zero would abort the
forecast. Both wrong, and it is the same wrong-cause defect class this chain has
been closing in `runway.py`, in `_reason_short_ledger`, and in
`_reason_no_dispersion`. Worth noting that it is the *third* time in this task
that a fix's own explanation, rather than its logic, was the thing left untrue.

## What it says now

The comment names both causes of `None`, states plainly that **neither is a
reason to refuse**, and records the decision not to distinguish them:

> The two causes are deliberately not distinguished: both mean "no seasonal
> estimate is in use", and neither changes what a screen should draw.
> `seasonality_used` and the per-month `ForecastMonth.seasonal` flag carry
> everything a consumer needs.

I agree with the reviewer's suspicion that the distinction is not worth
preserving. "No eligible calendar month" and "eligible but cent-exact" produce
identical downstream behaviour — every month goes to the pooled centre and scale,
`seasonality_used` is False, every `ForecastMonth.seasonal` is False — so a field
separating them would be surface with no consumer able to act on it.

Rather than leave the claims as prose, each is cited to the test that pins it:
`test_the_seasonal_scale_is_absent_when_no_month_has_one` (line 522) for the
count cause and
`test_a_cent_exact_calendar_month_falls_back_instead_of_killing_the_forecast`
(line 490) for the degenerate cause, both asserting `is None`. The "never 0"
invariant is enforced by the second of those: the `degenrefuse` mutation
(dropping `or None`) fails it, as the round-2 matrix showed.

## Verification

```
$ .venv/Scripts/ruff.exe check app/engines/forecast.py tests/test_forecast.py
All checks passed!

$ .venv/Scripts/pytest.exe -q --cov=app --cov-report=term-missing
app\engines\forecast.py            181      0   100%
TOTAL                             2407     88    96%
433 passed, 219 warnings in 54.64s
```

## Deferred to the ledger, as instructed

- **`seasonal_scale` is pooled across all eligible calendar months, not measured
  per month.** Past 24 observed months with several doubled calendar months of
  differing quality, a cent-exact month and a genuinely dispersed one blend into
  one figure. Accepted for now: a per-month scale would be measured from two
  points, which is worse, and the pooled-variance estimator is the standard
  answer to that trade-off. Worth revisiting only if a ledger of that length ever
  becomes typical.
- **`_thirteen_months_with_one_cent_exact_calendar_month` has February landing on
  the same `-10 000` as both Januaries** (`jitter[0] == 0`), which undercuts the
  fixture docstring's "the eleven other months vary perfectly normally". Harmless
  — February is a single-sample calendar month, so it never enters
  `seasonal_deviations` and cannot affect the degeneracy the fixture exists to
  create — but the prose overstates the fixture. Left per instruction.

## Task 11 close-out

Four commits: `d51fbbc` (engine), `648aea2` (two-scale band + `ResidualHistory`),
`7cb4b38` (fall back rather than refuse), `3161dff` (this comment). 433 backend
tests, `forecast.py` at 100 %, seven mutations covered. Carry-forward for tasks 12
and 13 is unchanged from fix round 2.
