# SDD ledger — plan: docs/superpowers/plans/2026-08-16-yieldo-phase-2a-analyse.md

Branch: phase-2-analyse-decision (created from bf5c2cd, end of phase 1.5)
Start state: backend 262 tests, frontend 389, both green, build clean.

19 tasks. Lot A shared foundations (1-3), then budgets (4-6), recurrences
(7-9), cashflow (10-14), inflation/anomalies (15-18), verification (19).

## Pre-flight scan

No contradictions found between tasks or against the Global Constraints. Four
deliberate deviations from the design spec are declared in the plan itself,
with reasons, and are accepted:

- no `recurrences` table — detection is computed per request; persisting a
  derived value would need invalidation on every import, category edit and
  rollback
- `/categories` stays a placeholder; budget amount and the essential flag are
  edited on /budgets
- the INSEE comparison is a user-pasted series, never an outbound call
- inflation is year-over-year only, comparing median monthly cost rather than
  window totals — comparing totals across windows with unequal statement
  coverage would report a collapse that is an artefact of which files were
  imported

## Expected refusals on the operator's fixture — designed behaviour, not bugs

3 complete observed months (2025-01 and 2026-01 are partial; 2025-04 to
2025-11 are empty and are NOT counted as zero-spend months).

- récurrences: gaps of 9 months between blocks, almost everything rejected
- prévision: needs 6 observed months, has 3 — refuses
- inflation: needs 3 months in each of two year-apart windows — refuses
- runway: computes, labelled "mesuré sur 3 mois complets seulement"
- anomalies: mixed, ~10 rows per category against a threshold of 10

Reported to the operator on 2026-08-17: importing more history from the bank
is what lights these up; the code is not what is holding them back.

## Environment

Fixture and login unchanged from phase 1.5:
`.superpowers/sdd/2026-08-12-yieldo-phase-1-5-interface/seed_fixture.py`,
`demo@yieldo-demo.fr` / `MotDePasseDemo123!`. Today is 2026-08-12 in the
fixture's world.

Dev servers must be started detached (`Start-Process`) or they die with the
shell that spawned them. Check `Get-NetTCPConnection -LocalPort 8000` before
trusting API output — an orphaned `uvicorn --reload` worker cost a full round
in phase 1.5.

## Lot A — shared foundations

Task 1: complete (commits bf5c2cd..3c96e50, review clean — no Critical, no
Important). 272 tests, robust.py at 100%.
Task 1: note: `_half` rounds half away from zero, so a median of an even-length
sample does not floor on negatives — 179 of the operator's 197 rows are
negative and `//` would have biased every one of them.
Task 1: note: `mean_ad == 0` implies `mad == 0`, so `modified_z`'s None case
and `Spread.sigma == 0` always coincide. Consumers may trust either signal.
Task 1: minor (deferred): `describe()` is the module's only public function
without a docstring, and it is the entry point the five consuming engines
call. `test_quantile_offset_is_an_integer_number_of_cents` asserts against the
same expression the implementation uses, so half of it is tautological. No
test drives describe()/modified_z() on an all-negative sample — the shape the
ledger actually has. All three inherited verbatim from the brief.

Task 2: fix round 1/5 (1 addressed, 0 open — only recurrence_points had a
cross-tenant test; tx_points, anomaly_points, liquid_balance_cents and
period_range were single-tenant only, on the module whose whole purpose is
centralising the user_id filter for four new routers. Each new test was
mutation-checked red-then-green; period_range's seam is user_history in
api/history.py, not a filter in common.py). Commits 1f45697..47c04d5.
Task 2: complete (commits 3c96e50..47c04d5, review clean). 285 tests.
Task 2: note: the extraction was verified mechanical — analytics.py lost two
function bodies and four call-site renames, nothing else. The phase 1.5
behaviours that run through it are provably untouched: an absent bound means
the user's whole history, and previous/comparison stay null when the caller
stated no start date.
Task 2: note: liquid_balance_cents wraps its SUM/COALESCE results in int()
before returning, so the driver's return type cannot leak a float onto a cents
value.

Task 3: fix round 1/5 (1 addressed, 0 open — no automated test exercised the
migration itself; the suite's db fixture builds schema from Base.metadata, so
the Alembic file was never executed. Now backend/tests/test_migrations.py runs
the real upgrade from the previous revision against a temp SQLite file, with
rows inserted BEFORE the upgrade so the backfill is proved on pre-existing
rows. Mutation-checked: commenting out the backfill UPDATE turns the flagged
set empty and two tests go red). Commits 5726361..dcb0601.
Task 3: complete (commits 47c04d5..dcb0601, review clean). 294 tests.
Task 3: IMPORTANT NOTE FOR EVERY FUTURE MIGRATION TASK: the plan's own
verification step was worthless and the implementer was right to ignore it.
`seed_fixture.py` calls Base.metadata.create_all() against the CURRENT ORM
models, so the new column already exists before the migration runs. Build the
"before" database at the previous Alembic revision — test_migrations.py now
carries a reusable harness (`migration_db` fixture, monkeypatches
settings.data_dir to tmp_path; Settings.database_url is a property recomputed
per call, and alembic/env.py re-reads it on every command, so the redirection
is real).
Task 3: note: ESSENTIAL_SLUGS is one frozenset in categorization/seed.py,
consumed by both the seed and the migration, so the two cannot drift. 21 slugs,
each verified to exist in CATEGORY_TREE.
Task 3: note: this is the project's first migration to DROP a column. Plain
`op.drop_column` needs SQLite >= 3.35; the Docker base (python:3.12-slim,
Bookworm) ships >= 3.40. A future column drop on another runtime needs
batch_alter_table.
Task 3: minor (deferred): PriceIndexPoint.month is documented as always the
1st but nothing enforces it — tasks 15/17 add the write path.
FIELD_SUBJECTS in api/errors.py has no `is_essential` entry, so a validation
failure there falls back to the raw field identifier in the French message.

## Lot B — budgets

Task 4: fix round 1/5 (3 addressed, 0 open — `abs(entry.spent_cents)` silently
turned a net refund into a spend, feeding a fabricated figure into
remaining/consumed/projected and able to trip "over"; the engine now raises a
French ValueError on a positive input, before any arithmetic. Zero stays the
ordinary no-spend case. `evaluate_budget` singular made private so task 5
cannot bypass the once-per-call elapsed/total_days computation. The equality
boundary is pinned: spending exactly the ceiling is "over" with remaining 0,
and the field comment now says so). Commits 4ee9c08..b477376.
Task 4: complete (commits dcb0601..b477376, review clean). 310 tests,
budget.py at 100%.
Task 4: CARRY TO TASK 5: the engine now REFUSES a positive `spent_cents`.
Task 5 must build `BudgetEntry.spent_cents` the way `aggregate_by_category`
already does (`aggregate.py:157-158` — `if point.amount_cents >= 0: continue`,
i.e. exclude income rows rather than netting them in), or the router will
raise on any category whose refunds exceed its spend in a month.
Task 4: note: the brief's Step 5 predicted "297 passed" against its own stated
baseline of 294 plus 12 new tests. The arithmetic in the brief is wrong; 306
was correct. Later briefs' predicted counts are not to be trusted over an
actual run.

Task 5: fix round 1/5 (2 addressed, 0 open — `GET /api/budgets?month=0000-05`
matched the four-digit pattern, passed the month-range check, then raised
`ValueError: year 0 is out of range` from `date(0, 5, 1)`. No ValueError
handler exists, so the user got an untranslated 500 where every other
malformed month returns a French 422. Now an explicit `1 <= year <= 9999`
guard, covering the whole range `_MONTH_KEY` admits rather than the one
reported value. `BudgetLineOut.status` now uses the engine's `BudgetStatus`
literal so the OpenAPI enum is generated for task 6). Commits 7711fa0..a130635.
Task 5: complete (commits b477376..a130635, review clean). 324 tests, 100% on
api/budgets.py and schemas/budgets.py.
Task 5: note: the reviewer hand-traced a real fixture row (TOTALENERGIES
ACCESS, -6810 c, 2025-03-07, transport-carburant) to prove the refund test
would genuinely fail if aggregation netted income in rather than excluding it.
Task 5: minor (deferred): the "worst first" sort of budget lines is not
exercised by any test with more than one budgeted category, unlike the
symmetric `unbudgeted` sort which is.

Task 6: fix round 1/5 (4 addressed, 0 open — a save bumped reloadToken, the
load effect set isLoading and swapped the whole body for skeletons, unmounting
every BudgetInput and discarding text typed into the other fields; now a
`shownMonth` ref distinguishes a genuine month change from a refetch, and the
grid stays mounted. Field errors moved from a page-level alert (off-screen at
375, several screens above the input) to the field itself, with aria-invalid
and aria-describedby. "à droite" replaced by the panel's name, since the cell
stacks below under 1200px. The clamp is now one function both consumers derive
from). Commits 6e7a6ce..985c11c.
Task 6: complete (commits a130635..985c11c, review clean). Backend 324,
frontend 437.
Task 6: THE BROWSER GATE EARNED ITSELF AGAIN, and this one was app-wide and
pre-existing: `.yd-skeleton` was painted `--yd-surface-raised`, which in the
light theme is white at 86% over a pure-white cell — exactly 1.000:1. EVERY
loading state in the app, the phase 1.5 dashboard included, rendered blank
cards in the light theme. Phase 1.5 verified that dashboard in both themes
with screenshots and missed it, because a skeleton is on screen for a fraction
of a second. Now a shared design/Skeleton.css, pinned by a test that performs
the source-over compositing arithmetic rather than asserting a token name
(re-derived by the reviewer: light 1.273:1, dark 1.400:1).
Task 6: note: the screen opens on the user's last month WITH DATA, not the
current month — buildUrl drops an undefined param, and the API resolves an
absent month to history.date_to.replace(day=1). Same defect class as phase
1.5's "Tout means this year", avoided by construction.
Task 6: note: `at_risk` has never run end to end on real data. The engine only
projects a pace for an in-progress month and the ledger ends 2026-01-09, so
every month the operator can open is finished and projected_cents is always
null. Verified by forcing the modifier in the browser and by unit test.
Task 6: minor (deferred): a first-load failure with no `?mois=` leaves the
screen inert — both arrows disabled, no retry, only a page reload. The alert
and the new field error both use `--yd-negative` on a tinted panel; resolve
them together with the phase-wide 1.4.11 contrast pass. `consumed_ratio` of
NaN would emit "NaN%", which React drops, leaving `width: auto` — a FULL bar,
the wrong failure direction. Unreachable today.
Task 6: minor (deferred): `.yd-budgets__suggestion` declares a third grid row
unconditionally, so a row with no error still carries its row-gap.
Task 6: minor (deferred): a save has no busy indicator for the width of the
reload request, so figures can be one save out of date with nothing saying so.

## Lot C — recurrences

Task 7: fix round 1/5 (2 addressed — the new max-gap gate had SHADOWED the
brief's own MAD wobble criterion in every test that depended on it, so
deleting the wobble condition left all 30 tests green; and the hole gate
spanned the whole history, so one three-month lapse in 2022 would suppress a
live subscription forever. `_spans_a_hole` became `_analysable_run`, cutting
at the last hole and re-cutting until stable, with every downstream field
reading from the run). Commits b2a3aff..8bded8a.
Task 7: fix round 2/5 (1 addressed — confining the hole gate took the
operator's data from 0 detections to 4: FNAC, CAF, pharmacie and account fees,
all bursts inside his one dense December at 5-6 day gaps, all read as weekly.
Verified by re-running at today=2026-01-09: three flip to active and sum to
961_220 cents — 9612.20 EUR/an of "abonnements" from three weeks of December
shopping, matching the reviewer's independent figure to the cent).
Commits 8bded8a..ee6ebc2.
Task 7: complete (commits 985c11c..ee6ebc2, review clean). 363 tests,
recurrence.py at 100%.

Task 7: OPERATOR DECISION, 2026-08-18: annualisation is withheld from any run
observed for less than 91 days (`MIN_ANNUALISATION_SPAN_DAYS =
PERIOD_BOUNDS["quarterly"][0]`, derived not invented, inclusive at 91).
"You may not multiply to a year what you watched for less than a quarter."
Detection, status, price change and confidence are untouched — only the two
totals and `recurring_keys` are gated, and the Recurrence still returns with
`annualisable` / `observed_span_days` so the screen can list it honestly.
ACCEPTED COST: a subscription signed up for this quarter appears in the list
but not in the headline total until its fourth charge (a weekly one needs
thirteen weeks). TASK 9 MUST SAY THIS IN FRENCH or it reads as a bug.
Task 7: note: the alternatives were tested and rejected — a minimum period
count is useless (the bursts have 4-6 occurrences, at or above
CONFIRMED_OCCURRENCES); narrowing the weekly band to 7±1 kills FNAC and CAF
but not pharmacie or frais; dropping weekly moves the failure into biweekly.
Amount stability cannot defuse it either: `frais de tenue de compte` is a flat
2,00 EUR with spread == 0.
Task 7: note: the brief was self-contradictory twice and the implementer was
right both times — its price-change formula yields -0.185 where its own test
asserts +0.185, and its first-past-the-post split dated a rise two months
early because a median ignores a minority of values. Both reproduced
arithmetically by the reviewer.

Task 7: CARRY TO TASK 8: `ended` conflates "cancelled" with "no recent
import". The engine cannot know; the router has the ledger's date range in
hand and must supply it.
Task 7: CARRY TO TASK 9: use `amount_spread_cents` — there is no amount
stability gate, and `normalize_label` strips `\bcarte\s*\d*\b`, collapsing
every ATM withdrawal into the single key `retrait dab`. Also: recurrences are
still sorted by the UN-gated `annual_cents`, so a large non-annualisable
figure can sort to the top of a list it is excluded from.
Task 7: CARRY TO TASK 11: `recurring_keys` is authoritative only over each
recurrence's own `[first_on, last_on]`. Subtracting by key alone will remove
pre-lapse rows the run analysis deliberately excluded. Window the subtraction.
Task 7: minor (deferred): `_analysable_run` returns None on an unclassifiable
full-group median instead of trimming further, so early irregular history can
permanently veto a clean trailing run — finding 2's failure through another
door. A group trimmed below MIN_OCCURRENCES counts as rejected_irregular, not
rejected_thin. Nothing records that a group WAS trimmed, so a reader who
subscribed in 2019 reads first_on = 2024-10 as a bug.
Task 7: minor (deferred): three guards execute but are unpinned despite 100%
statement coverage — the sign check, the `after.median == 0` half, and
MIN_INTERVAL_MAD_DAYS, which only binds at median <= 5 and no test reaches it.
`find_price_change` does not validate that amounts and dates are the same
length. Rows with an empty label_key are dropped with no counter.
`previous_cents` can be a midpoint of two former levels that was never billed.

Task 8: complete (commits ee6ebc2..a5575fb, review clean — no Critical, no
Important). 373 tests, api/recurrences.py and schemas/recurrences.py at 100%.
Task 8: DECISION: the router passes `user_history(db, user.id).date_to` — the
ledger's own last transaction date — as the engine's `today`, not
`date.today()`. Otherwise every subscription the operator ever had reads as
"ended" purely because he has not imported a statement since January.
`ledger_last_on` is in the payload so task 9 can phrase a stale status as
"aucun prélèvement depuis le 9 janvier 2026, dernière date de votre
historique" rather than asserting a cancellation. The reviewer verified the
consequence: because `today` is always >= every occurrence date fed in, a
debit expected past the ledger's end can never be mis-marked `missing`.
Task 8: note: an empty ledger falls back to `date.today()`, which is moot —
no rows means no recurrences to have a status.
Task 8: note: the auto-generated brief was STALE. It predates task 7's second
and third review rounds, so it lacked `annualisable` and `observed_span_days`
and described the engine's pre-fix output. The implementer pinned the engine's
real current behaviour instead and said so. Later briefs in this plan carry
the same risk: task 7 changed three times after they were written.
Task 8: minor (deferred): the router's docstring claims its clock substitution
"matches the budgets.py house pattern". It does not — budgets.py uses
history.date_to only to pick which month to default the VIEW to, and always
passes the real `date.today()` into the engine. This is a novel pattern, sound
on its own merits, but citing a false precedent could mislead a future reader
into treating clock substitution as convention.
Task 8: minor (deferred): the cross-tenant test proves one direction only —
user B's empty ledger is not polluted by user A. It does not seed B with her
own rows and confirm she sees only those.

Task 9: fix round 1/5 (4 addressed, 0 open — the refusal gate tested
`some(annualisable)` while the figure it guards is summed over
`annualisable && annual_cents < 0 && status != "ended"`. Different sets: one
annualisable INCOME row — a salary crossing 91 days, the operator's very next
ledger state — flips the gate true and prints a bare "0,00 €" under a heading
saying subscriptions cost this much per year, with no notice to explain it,
because the engine only writes that notice when NOTHING is annualisable. Gate
is now `split.counted.length > 0` with a second register of copy for
"annualisable rows exist but none is a live cost". Also: `ledgerClause`'s first
branch is unreachable — the router passes `today = history.date_to` AND
returns `ledger_last_on = history.date_to`, so the difference is always
strictly positive — and two tests pinned a payload the backend cannot emit).
Commits 25b2a43..3c8d6e2.
Task 9: complete (commits a5575fb..3c8d6e2, review clean). Backend 373,
frontend 478.
Task 9: note: the reviewer proved the two fallback registers and the engine's
own notice are mutually exclusive by construction — the page can never print
two contradicting explanations.
Task 9: note: the fix went beyond its letter, and rightly: RecurrencesPage's
main test fixture carried three backend-impossible rows, including an `oldFee`
whose `first_on` fell AFTER its `last_on`. The whole payload was re-anchored on
a reachable ledger date and independently re-verified by the reviewer against
the engine's own grace formula.
Task 9: note: the unreachable `ledgerClause` branch was KEPT as a documented
guard rather than deleted, because it is unreachable only through the current
coupling of `today` and `ledger_last_on` in api/recurrences.py, which that
router's own docstring says it weighed and could reverse. If a later phase
changes that clock, the sentence becomes load-bearing with no browser
verification behind it.
Task 9: minor (deferred): a `missing` row contributes its full annual figure to
the headline and no clause says so. The 91-day paragraph renders even when
every exclusion is income or ended. `list-style: none` without `role="list"`
drops list semantics in Safari/VoiceOver. `exclusionReason` classifies
`annual_cents === 0` as income rather than leaving it unclassified.
RecurrencesPage.tsx is at ~349 lines and carries the fetch, the partition,
three derived counts, three body states and the whole copy deck.

## Lot D — cash flow

Task 10: fix round 1/5 (4 addressed, 0 open — `insufficient_reason` hard-coded
the month count as the cause even when the real cause was a non-positive burn,
so a household with 3 observed months and no spending was told "il faut au
moins 3 mois complets, et l'historique en compte 3"; now two distinct reasons,
mutually exclusive by construction. The ledger-bounds precondition is stated
and pinned by a test that DEMONSTRATES the failure — widened bounds admit a
one-week month as complete. RunwayScenario now carries the full MeasuredRate,
so a screen gets the band and each scenario's own sample size without
re-measuring. The uncategorised-row contract is decided and written where task
12 will read it). Commits fb9a0fe..15d34a4.
Task 10: complete (commits 3c8d6e2..15d34a4, review clean). 396 tests,
capacity.py and runway.py at 100%.
Task 10: note: the eight unimported months cannot be counted as zero BY
CONSTRUCTION, not by a filter — `complete_months` builds buckets only from
entries that exist, and deliberately does not call `aggregate.fill_missing_
buckets`, which is the helper that would have caused the defect.
Task 10: note: `abs()` appears once, on a value provably <= 0 by construction,
so it is a sign flip and cannot hide a shortfall — the task 4 defect is not
repeated. The operator's savings capacity is negative and stays negative.
Task 10: CARRY TO TASK 12: `ledger_start`/`ledger_end` MUST come from the
min/max of actually-imported transaction dates, never from a requested window.
Wider bounds never add zero months, but they admit PARTIAL ones as complete —
the "quarter of the truth" failure, reintroduced from the caller side.
Task 10: CARRY TO TASK 12: a transaction with `category_id IS NULL` — the
operator has 26 — is decided NOT essential. Build the join that way.
Task 10: minor (deferred): two assertions in test_capacity.py verify Python
rather than the engine (a list comprehension against its own literal
expansion). `capacity.py` routes amount 0 to neither inflow nor outflow while
`aggregate.py` sends `>= 0` to inflow — numerically inert, but two modules
bucketing the same edge differently reads as a bug later. Inverted bounds
return empty rather than raising. A sub-day runway dates to `today`, making
`depleted_on == today` ambiguous between "overdrawn" and "hours left".

Task 11: fix round 1/5 (2 addressed — half-on seasonality under-priced the
band: sigma was measured over a MIXED deviation set, so a December seen once
got the pooled centre AND a band sized by the jitter of the months that WERE
explained. Now two scales over their own populations. And `project_cashflow`
took an optional `ledger_months_observed`, so task 12 could silently omit it
or pass unfiltered observations and double-count the rent — closed with
`build_observations() -> ResidualHistory`). Commits d51fbbc..648aea2.
Task 11: fix round 2/5 (1 addressed — round 1 INTRODUCED a defect: a cent-exact
calendar month made `seasonal_scale` 0, which refused the entire 12-month
projection and told the reader "vos mois ne varient pas d'un mois à l'autre",
false whenever the pooled scale was healthy. Now falls back to the pooled
centre and scale. The refusal condition collapsed to one line above the horizon
build, so `_reason_no_dispersion` is reachable only when its French is true).
Commits 648aea2..7cb4b38.
Task 11: fix round 3/5 (1 addressed — round 2 invalidated the
`seasonal_scale_cents` field comment on both its claims. Comment only).
Commits 7cb4b38..3161dff.
Task 11: complete (commits 15d34a4..3161dff, review clean). 433 tests,
forecast.py at 100%.

Task 11: PROCESS LESSON, named by the implementer and worth carrying to every
later task: three times in this one task the thing left untrue was the fix's
EXPLANATION, not its logic — `_reason_short_ledger`, `_reason_no_dispersion`,
and the field comment. The logic held under mutation testing every round; the
prose describing it did not. A comment or a message stating WHEN a value
appears deserves the same "does a test still prove this?" pass as the code.
Task 11: note: the brief was defective in four ways, all confirmed by the
reviewer: its test file raised TypeError at collection (two Recurrence
literals missing fields required since ee6ebc2); it never implemented the
windowed subtraction and instead told the caller to filter on `recurring_keys`
— the exact trap task 7 documented; its recurrence walk stepped 30 days for
"monthly", giving 12.17 charges a year, with its own test using `<=` and so
tolerating it; and its seasonal fixture used two identical years, giving MAD 0
for every calendar month.
Task 11: note: the band now prices the sampling error of the projected CENTRE,
not just period-to-period noise. That error is systematic and enters as k²/n,
so without it the band drew the same ribbon at six months of history as at
five years. Reviewer re-derived it: 2.04x wider at n=6, k=12.
MEDIAN_VARIANCE_FACTOR = pi/2 is the published asymptotic variance of the
sample median, not a tuned constant.
Task 11: note: the implementer REJECTED its own first test for the two-scale
fix — it passed for the wrong reason, because both effects pointed the same
way. Caught only by re-running the mutation matrix. Seven mutations, seven
caught, each applied alone against a restored file.
Task 11: note: the plan itself was corrected in a801569 — its task 12 router
still filtered on `recurring_keys`. Briefs are extracted from the plan, so the
defect would have been taught to task 12's implementer.
Task 11: minor (deferred): `_reason_short_ledger` cites the residual count as
if it were the ledger count. `residual_scale_cents = 0` on a refusal is a zero
standing in for an unknown where the repo's precedent is `int | None`. The
seasonal centre-variance term treats a repeated calendar month as independent
at horizons past 12. The `status == "ended"` projection-side gate is caught
only by a test exercising the other side. `test_the_split_loses_no_money`
omits the `_is_projected` gate. The band can drift <=1 cent from the pre-fix
numbers (two roundings where there was one; measured over 200_000 draws).
`seasonal_scale` is pooled across all eligible calendar months rather than
measured per month, so a ledger past 24 months with several doubled months of
mixed quality would blend a cent-exact month with a genuinely dispersed one.

Task 12: fix round 1/5 (5 addressed, 0 open — the two endpoints anchor on
different dates (forecast on the ledger's last day, runway on the real clock)
from the SAME balance, so on the operator's data the forecast labels twelve
months starting 2026-02 while the runway counts from 2026-08-22: the same
euros depleting on two timelines, on one screen. Both payloads now carry
`projected_from`. `RunwayScenarioOut` had dropped `RunwayScenario.rate`, which
the engine publishes precisely so a caller can tell the two scenarios' samples
apart; now nested with the band. `RunwayOut` gained `ledger_span_months`, so
"3 complete months of a 3-month ledger" is distinguishable from "3 of a
13-month ledger with a nine-month hole" — the operator's actual case. The
uncategorised-row precondition was correct but unpinned; now tested and
mutation-checked. ForecastOut carries the three explanation fields the engine
published for the chart). Commits 2e9a7f4..c72581e.
Task 12: complete (commits 3161dff..c72581e, review clean). 452 tests, 100% on
api/cashflow.py and schemas/cashflow.py.
Task 12: DECISION: `today` is split by endpoint. Forecast uses the ledger's
last transaction date (real clock would age every recurrence past `ended`);
runway uses the real clock (nothing in compute_runway classifies by staleness,
and anchoring depleted_on to a stale date would put it in the past). Both
payloads name their own anchor.
Task 12: note: the brief was wrong in FOUR ways, all verified: its router body
used `build_observations` and `LedgerEntry` without importing them; it named
`RunwayOut.insufficient_reason`, which task 10 deliberately split in two; its
Query bound was `le=60` against `MAX_HORIZON_MONTHS = 24`, so 25-60 would have
500'd instead of returning a French 422; and its own Step-1 fixture used ten
same-label fixed-amount monthly rows as "residual" data — which IS a
recurrence, gets windowed out by `build_observations`, collapses the residual
to a one-week sample, and makes the route refuse. Its assertion
`insufficient_reason is None` could never have passed.
Task 12: minor (deferred): `months` now appears at two levels of the runway
payload with different meanings — `RunwayScenarioOut.months` is a float
duration, `MeasuredRateOut.months` an int sample size. Both commented in
Python, neither uses `Field(description=...)`, so nothing surfaces in OpenAPI
for tasks 13/14. `months_observed` means different populations on the two
payloads. `FIELD_SUBJECTS` lacks `months` and `threshold_cents`.
`test_cashflow_never_crosses_users` proves exclusion only from the empty side.
`RunwayScenarioOut.months` is non-optional against the engine's `float | None`.

## Lot D (continued) — chart and screen

Task 13: fix round 1/5 (3 addressed, 0 open — CRITICAL: the confidence band
anchored at ZERO whenever P10 went negative. ECharts only chains a stacked
value onto the previous series when both share the same sign
(`stackStrategy: 'samesign'`, dataStack.js:87,115-118); with a negative floor
and a positive height the chain is refused, `stackedOverDimension` is left NaN,
and line/helper.js:109-121 falls back to `valueStart`, which is 0 when the axis
spans both signs. A month at P10 -200 / P90 +1800 drew as [0, 2000]: right
width, wrong anchor, silently erasing the overdraft risk the P10 estimate
exists to warn about. Fixed with `stackStrategy: "all"` on both series and
proved with a side-by-side screenshot. Legend swatch was solid against a
0.18-opacity band; the two swatches were ~1.32:1 apart by hue and are now
different shapes via `icon: "inherit"` on the median only).
Commits 7b5ba2c..bb8705a.
Task 13: complete (commits c72581e..bb8705a, review clean). Backend 452,
frontend 491.
Task 13: CARRY TO TASK 19 (verification pass): `frontend/src/charts/
WaterfallChart.tsx:80-121` uses the SAME invisible-floor / visible-height
technique with no `stackStrategy`, so it carries the same defect wherever its
running balance dips negative. Verified rather than assumed by analogy:
`layout/barGrid.js:398-399` computes `stackStartValue = stackResult - rawValue`,
which collapses to 0 when samesign refuses to chain. That chart has been on the
operator's dashboard since phase 1.5.
Task 13: RULING on the implementer's open question: the band's legend swatch
measures 1.17:1 light / 1.48:1 dark against the card, under WCAG 1.4.11's 3:1.
It is exactly what the band itself is drawn at, so the swatch is an honest
preview and a full-opacity border would reintroduce the defect in miniature —
a key showing an edge the band lacks. KEEP IT. If the phase wants the band
above 3:1, the fix belongs on `areaStyle.opacity` and the swatch follows
automatically. Added to task 19's phase-wide contrast pass, alongside the
1.4.11 items carried from phase 1.5.
Task 13: note: the brief's TypeScript types omitted six real schema fields and
invented a single `insufficient_reason` where task 10's review had
deliberately split it in two. Seventh consecutive task with a defective brief.
Task 13: minor (deferred): `legend: { right: 84 }` is a magic number sized to
the current Exporter button's rendering. The tooltip's `dataIndex ?? 0` falls
back to month 0 rather than surfacing nothing.

Task 14: complete (commits bb8705a..845080a, review clean). Backend 454,
frontend 532. Three commits: e87f5f3, f160e08 (its own self-review round),
845080a (review fixes).
Task 14: fix round 1/5 (3 addressed, 0 open — the runway block was gated only
on `runway === null`, never on whether either scenario computed, so at
months_observed < 3 four sentences asserted a measured rate beside two "Non
mesurable" panels, one of them arithmetically wrong at exactly 2. And the
clocks banner ignored `insufficient_reason`, so the page's FIRST prose read
"La prévision part du 9 janvier 2026 … c'est la seule période sur laquelle vos
relevés peuvent se prononcer" above a cell that refused and drew nothing — the
operator's own state, with a test pinning the indicative mood in place. The
implementer found and fixed the identical defect in the banner's runway clause
unasked).
Task 14: note: the operator's real data hit a state nobody anticipated — his
balance is NEGATIVE (-2 209,63 EUR), so both scenarios return months 0.0 with
depleted_on = today and both rate.low_cents are negative. Handled explicitly:
"Déjà épuisé", no invented date, and a caveat when the band's low end falls
below zero.
Task 14: note: `_reason_short_ledger` was interpolating the RESIDUAL month
count into "l'historique n'en compte que N", so a five-month ledger with three
residual months refused with "n'en compte que 3" directly above the screen's
own note saying "compte 5 mois complets". Recorded as a task 11 minor; it
stopped being minor once two contradicting numbers sat on one screen. Fixed.
Task 14: CARRY TO TASK 19: two chart defects of the same family, both
verified rather than assumed. (1) `WaterfallChart.tsx:80-121` uses the same
invisible-floor / visible-height stacking as the fan chart with no
`stackStrategy`, so it collapses to zero wherever its running balance dips
negative — `layout/barGrid.js:398-399` computes `stackStartValue = stackResult
- rawValue`, which is 0 when samesign refuses to chain. That chart has been on
the dashboard since phase 1.5. (2) `ForecastFanChart.tsx:81-82` clips its last
x-axis label at 1440 ("août 20"), from `grid.right: 8` plus
`boundaryGap: false`; the two sibling charts take the category default.
Task 14: minor (deferred): `RunwayPanel.tsx:124` says "descend sous zéro" on
`low_cents <= 0`, overstating when the band merely touches zero.
`CashflowPage.tsx` indexes `forecast.months[0].key` on the contract alone, so a
violation white-screens rather than surfacing. Two loose test assertions
(`/minimum/i`, a bare `/7/`). A note restates the backend's own refusal
sentence. RunwayPanel orders its two word-branches differently in two places.
The banner's "partiraient du même solde" understates a premise that holds
regardless of refusal.
Task 14: note: only the 1440 real-data shots were re-shot after the banner fix;
768 and 375 still carry the old wording, layout unaffected.

## Lot E — inflation and anomalies

Task 15: fix round 1/5 (3 addressed, 0 open — the field comment said
"0 when not comparable" while an incomparable line routinely carries a large
real cost, and `delta_cents` had no contract at all on that branch: exactly
the interface tasks 17/18 read, and exactly how task 14 ended up asserting a
measured rate beside two "Non mesurable" panels. `CategorySpend` cannot express
a transfer while its docstring named `aggregate_by_category` as its precedent
— the one axis where they differ; the caller's obligation is now stated on the
dataclass itself. And NO test distinguished the median from the mean: every
fixture used identical monthly amounts, so `sum // len` passed all 18 tests,
in a module whose entire reason for consuming `robust.median_cents` is that a
single large purchase must not redefine a normal month). Commits
5c7d45b..2207eb3.
Task 15: complete (commits 845080a..2207eb3, review clean). 473 tests,
inflation.py at 100%.
Task 15: note: the brief's own divide-by-zero test passed for the WRONG reason
— a month of only zero-amount rows never enters the per-month totals at all,
so the months-count gate fired and the cost-zero gate was never consulted. The
implementer found this by mutation testing, kept the guard as documented
defence-in-depth, and renamed the test to say what it actually proves.
Task 15: CARRY TO TASK 17: the router must scope entries by `user_id` and
exclude transfers before constructing `CategorySpend` — this engine enforces
neither, by design, and the contract is now written on the dataclass.
Task 15: minor (deferred): the reference index's zero-baseline guard is
`== 0` rather than `<= 0` and is untested, though it is the one division whose
baseline a human types in. The empty-ledger refusal names categories that do
not exist. The "excluded rather than netted in" claim is untested for a month
holding both a spend and a refund. `-(line.ratio or 0.0)` uses `or` on a float
that can legitimately be 0.0.

Task 16: fix round 1/5 (2 of 3 addressed — skip reason named the sign group's
count while saying "cette catégorie", so a category of 11 expenses and one
refund told the operator it held 1 operation WHILE being counted as scored;
and `skipped`/`scored_groups` were not window-scoped though the docstring
promised they were). Commits 2b6da8a..e4f71b9.
Task 16: fix round 2/5 (1 addressed — the ordering metric, third attempt).
Commits e4f71b9..2631d24.
Task 16: complete (commits 2207eb3..2631d24, review clean). 496 tests,
anomaly.py at 100%, 17/17 mutations caught including reversions to both
rejected metrics.

Task 16: RULING, and the reasoning is worth keeping. The anomaly list is
rendered top-down by task 18, so its ORDER is a claim. Two metrics were tried
and each was unstable at one end:
  - raw `modified_z`: on a `mad == 0` category (every fixed-amount
    subscription) the score collapses to ~n/constant, independent of the
    deviation's size — a 15-cent subscription reprice scored 11.968 against an
    860 EUR grocery spike's 9.574 and took first place.
  - relative deviation from the median: explodes at a small denominator — ten
    -1 cent rows plus one -500 scored 499.0 against the same spike's 21.5.
Both failures came from dividing by a quantity the data controls. RULED:
`modified_z` continues to decide WHETHER a row is an anomaly — that gate is
untouched, robust and category-relative — and the ORDER is absolute deviation
in cents. The relative figure may be displayed as copy, never used as the sort
key. The docstring now records all three attempts with their numbers so a
fourth is not invented.
Task 16: note: the reviewer worked the honest objection itself — a big-ticket
category's routine move outranking a small-ticket category's dramatic one —
and ruled it a bounded tradeoff rather than the same defect: absolute cents
cannot invert how much real money moved, which is exactly what both rejected
metrics could do.
Task 16: note: the brief's `test_income_and_expenses_are_scored_separately`
fixture was mathematically IMPOSSIBLE — both its blocks exceed OUTLIER_Z on
their own correctly-separated group, so its `assert anomalies == []` could not
pass against any correct implementation. Verified to the digit by the reviewer.
Task 16: note: `MIN_HISTORY`'s brief comment attributed the threshold of 10 to
Iglewicz & Hoaglin. The implementer could not verify that and reattributed it
to the plan's own table rather than substituting a second unverifiable
citation. The published-method claim is reserved for OUTLIER_Z.
Task 16: CARRY TO TASK 18 (screen copy): two operator-facing surprises that
are correct behaviour but read as accusations without wording. (1) A large but
entirely ordinary charge — an annual insurance premium among small monthly
ones — WILL be flagged; a size-based exemption would be the arbitrary
threshold the spec forbids. (2) On a `mad == 0` group a 6-cent subscription
reprice is flagged (5 cents yields None, 6 yields z = 4.787).
Task 16: minor (deferred): a zero-dispersion group is counted as scored while
structurally unable to report anything. `category_median_cents` is unsigned
against a signed `amount_cents`, so a naive subtraction in task 18 gives
nonsense for expenses. `category_id: int | None` is unreachable-None on both
dataclasses. Tie order across categories is deterministic but unpinned.

Task 17: fix round 1/5 (3 addressed, 0 open — the DEFAULT /inflation window
compared the ledger against ITSELF and called the result measured. The router
reused `period_range`, whose absent-bound default is the whole ledger span,
and `previous_year_window` shifts back exactly twelve months, so any window
longer than a year overlaps its own comparison period. Probed on 36 months of
groceries rising a true 10%/year: the default returned +4.76% with
`comparable: true` and `reason: null`. Task 18's page load calls exactly that
URL. Also: the PUT reached an unhandled 500 on three ordinary index values,
and `gt=0` bound the Decimal rather than the stored hundredths, so "0.004"
rounded to 0 and a zero current median yields a fabricated -100%).
Commits 8ff72ad..7f147a2.
Task 17: complete (commits 2631d24..7f147a2, review clean). 522 tests, 100% on
api/analysis.py, schemas/analysis.py and engines/inflation.py.
Task 17: RULING, both halves, because a bad default was only half the defect:
the router now defaults to the last twelve months anchored on the ledger's own
last transaction, and `compute_inflation` REFUSES any window longer than
twelve months in French, naming the overlap. A default fix alone would have
left the hole open to any wider range typed by hand. Boundary verified:
exactly twelve months passes, twelve months plus one day refuses.
Task 17: note: no test caught the overlap because the shared `imported`
fixture holds one week of March 2025 — shorter than a year, so a twelve-month
shift cannot overlap it. A fixture too small to express the defect.
Task 17: note: tenant isolation verified clean on the phase's FIRST write
endpoint, including a probe of a commit-time failure after the DELETE: the
previous series survives intact, so no half-series is reachable.
Task 17: note: task 3's long-open `PriceIndexPoint.month` first-of-month
invariant is now enforced for the first time — `_parse_month` is the only
write path.
Task 17: minor (deferred): two `detail` shapes on one endpoint, so task 18
must branch on `typeof detail`. Two of four cross-tenant assertions are
over-determined and would pass with the filter removed. The month format does
not zero-pad below year 1000. An inverted explicit range is accepted by the
shared `resolve_range`. `_default_current_window` anchors on the ledger's last
transaction, so if that falls mid-month the newest month is not a complete
calendar month despite the docstring's phrasing — cosmetic, cannot overlap.

Task 18: fix round 1/5 (4 addressed, 0 open — "Aucune opération sur cette
période… importez des relevés qui la couvrent" fired on `scored_groups === 0
&& skipped.length === 0`, which is ALSO the state of a window holding only
uncategorised rows (every ledger between import and categorisation) or only
internal transfers: the screen told the operator to import statements he had
already imported. A >12-month range makes the engine refuse deliberately in
French and the router return 422, and the screen dressed that as a load
FAILURE — negative-coloured alert, "Ce panneau n'a pas pu être chargé" —
breaking the rule its own CSS comment states. The scope banner keyed on
`preset === "all"`, so clicking "Personnalisé" wrote empty bounds that
`buildUrl` drops, the two engines fell back to their two different defaults,
and the banner asserted they agreed. And the six-cent claim is group-size
dependent: 6 cents in a 12-row group scores 4.79, in a 30-row group the mean
absolute deviation rounds to 0 and nothing appears).
Commits d684df0..4b1dbeb.
Task 18: complete (commits 7f147a2..4b1dbeb, review clean). Backend 522,
frontend 590.
Task 18: note: the brief was wrong in FOUR load-bearing ways — twelfth
consecutive task. `api.put` did not exist; the period wiring made both engines
answer about an empty August with the wrong stated cause; the parser accepted
negatives that Pydantic rejects in English; and THE RUNNING BACKEND SERVED NO
`/api/analysis/*` AT ALL, a stale worker, exactly the trap this ledger has
carried since phase 1.5. Six more defects were found only by reading the
rendered screenshots, including category names collapsing to one character per
line at 375.
Task 18: note: `usePeriod` gained an additive `defaultPreset`. Phase 1.5
shipped a defect by changing a shared period component without re-checking its
consumers; both other call sites were verified untouched, in code and in the
browser.
Task 18: minor (deferred): the neighbouring `inflation.lines.length === 0`
sentence carries the same shape of overstatement but is genuinely narrower —
uncategorised rows DO reach compute_inflation, grouped as "Non catégorisé", so
only a transfers-only window hits it. "Coût mensuel médian" labels a sum of
medians as a median. The `countsExplain` fallback cannot rescue the case its
comment names, because the engine writes `_reason_line` there too. No busy
state on a period change, so the previous window's figures stay on screen with
its own "La comparaison porte sur…" sentence. `Effacer l'indice` erases the
stored series on one unconfirmed click. The refusal treatment keys on 422,
which FastAPI also returns with an English Pydantic message for a hand-edited
`du`/`au`.

## Lot F — verification

Task 19: complete (commits 4b1dbeb..HEAD). Backend 522, frontend 622 (+32
written here), build clean. Full findings in `task-19-report.md`.

Task 19: fixed round 1/1 (5 blocking, 0 open). Part A's three items plus two
more the contrast pass turned up:
  1. `WaterfallChart` collapsed to zero below the baseline — the same ECharts
     `samesign` refusal the fan chart was fixed for, through the bar path. On
     the operator's own dashboard "Autres dépenses" (−3 360 €) and "Épargne"
     (−2 210 €) were drawn as bars rising ABOVE zero: a year ending 2 209,63 €
     in the red, rendered as a year in the black, with the negative half of the
     y-axis drawn and unused. Live since phase 1.5. `stackStrategy: "all"`.
  2. `ForecastFanChart` clipped "janv. 2027" to "janv. 20" at 1440.
     `containLabel` cannot fix it — `Grid.js:150` subtracts only the label's
     height for a horizontal axis. `alignMaxLabel` was rejected: it aligns the
     last VISIBLE label, and `axisTickLabelBuilder.js:327` shows the extreme
     tick is thinned away at 768/375, so it would trade a 1440 clip for a
     narrow-width misalignment. Took the category default `boundaryGap`, which
     is what the two sibling charts already do.
  3. Contrast, every figure measured off a decoded screenshot pixel rather than
     from a token value: control boundaries 1.55:1 dark / 1.30:1 light →
     4.28 / 3.91; the Réglages switch OFF, whole control inside a 1.64:1 band
     (track 1.57:1, knob 1.53:1) → 5.25 / 4.28; alert text on its own tint
     3.61:1 dark on eleven screens → 5.16:1; treemap labels 1.80 / 2.11 / 2.69:1
     → 10.89 / 9.80 / 7.68:1.
Commits 4b1dbeb..475d78b..fe03b8f.

Task 19: RULING on the three 1.4.11 items left standing, with reasons.
  - The fan chart's band swatch (1.17:1 / 1.48:1) stays — task 13's ruling
    holds unchanged.
  - [SUPERSEDED — see the "Task 19 fix round" entries at the end of this file.
    The scope claim below was FALSE and the deferral was withdrawn.]
    `--yd-border-strong` on cards, panels and bento cells stays: 1.4.11's "user
    interface components" bullet is about controls, and a container edge is not
    a component. The fix was scoped to the fifteen input/select/textarea rules
    and the switch track, via a new `--yd-border-control`.
  - The cashflow plot's 1.11:1 between the Entrées bar and the Solde net line
    stays. The criterion is met by mark type (stacked bar vs a 2px line with
    circular symbols) and by position, and both series clear 3:1 against the
    card (9.46:1, 4.69:1). Closing the hue gap means moving a categorical token
    mirrored into charts/theme.ts and used by every chart. The LEGEND half was
    fixed — `icon: "inherit"`, same fix and same reason as the fan's median.

Task 19: note: `tileLabelColor`'s test asserts the RATIO over every fill in both
categorical ramps rather than a colour name, and that is what caught four ramp
colours (#d95926 and #d55181 are DARK_CATEGORICAL, charts/theme.ts:103 and :106
— this line said "light-ramp" and was wrong; #2a78d6 and #e34948 are the two
from LIGHT_CATEGORICAL) clearing 4.5:1 against
NEITHER white NOR `--yd-text` (best of the two: 4.31, 4.24, 4.42, 4.23). Hence
`--yd-chart-label-ink`, a near-black, rather than reusing `--yd-text`.

Task 19: [PARTLY SUPERSEDED — the instrument was saturated at the vsync floor;
see the "Task 19 fix round" performance entry at the end of this file. The watch
item is NOT closed.] THE PHASE 1.5 PERFORMANCE WATCH ITEM DOES NOT REPRODUCE.
Re-measured
with p95 and the over-20ms share, not a median: at idle, while scrolling, and
under 6x CPU throttle, effects on and off are indistinguishable (p50 6.90,
p95 7.00, p99 7.10, 0% of frames over 20ms in both). The halos animate
`transform` on a compositor layer and the two backdrop-filter surfaces do not
repaint while content is static or merely scrolling. The only condition with a
tail is LOAD, and there the two differ by 1.2 fps on the mean and 0.2 points on
the over-20ms share, with p50/p95/p99 identical — the tail is one frame of
1.24-1.28s parsing a 1 632 kB bundle. Close the atmosphere watch item; open a
bundle-size one.

Task 19: analysis endpoints are nowhere near a problem at 197 rows.
`/api/cashflow/forecast` is the worst at 27.3ms p95 (200ms was the threshold);
`/api/recurrences` 18.0ms p95. Both re-run `detect_recurrences` over the whole
ledger per request, which is linear in row count — re-measure at ten years of
statements, not before.

Task 19: minor (deferred): [the first two of these — the cashflow legend and the
waterfall labels — are FIXED in the fix round; see the end of this file.] at 375
the cashflow legend's third entry is overprinted by the Exporter button (`CashflowChart` has no `legend.right`
reservation; the fan carries `right: 84` for exactly this), and the waterfall's
bar labels collide so "+10 220 €" and "−3 900 €" are both unreadable. Escape
closes the mobile drawer but drops focus to `<body>` instead of the Menu button.
`WaterfallChart`'s aria-label emits raw ISO dates inside French prose while
every sibling chart says "du 24 janvier 2025". `/categories` has no `<h1>` at
all and never says that budgets and the essential flag live on /budgets.
`formatPercent` (OverviewPage.tsx:56-58) emits `-21,6 %` with a hyphen-minus and
a plain space before `%`, beside three amounts that `formatCents` typesets
correctly with U+2212, U+202F and U+00A0. The app holds FIVE `&nbsp;` usages in
total, all in the phase-1 import feature — the French spacing convention was
established once and never propagated, so this is a decision to make rather than
two slips to fix. Three `<ul>` per screen carry `list-style: none` without
`role="list"`, the sidebar nav's own list included. `npm run lint` has never
worked — eslint is not installed.

Task 19: triage of the ~55 deferred items: none blocks the merge. Three are
already closed by later tasks (task 3's month invariant by task 17, task 11's
residual-count message by task 14, task 6's tinted-alert contrast by this pass).
Four deserve promotion into 2B's plan rather than another deferral: `Effacer
l'indice` erases on one unconfirmed click; three shape mismatches sit exactly
where 2B will consume them (`category_median_cents` unsigned against a signed
amount, `residual_scale_cents` returning 0 for an unknown, `RunwayScenarioOut.
months` non-optional against `float | None`); the missing busy-state on a period
change is the most visible; and task 1's untested all-negative path underpins
five engines on a ledger where 179 of 197 rows are negative.

Task 19: STILL UNVERIFIED, named so nobody discovers it later: the CSS
`prefers-reduced-motion` gate (chrome-devtools cannot force the media query —
only the in-app switch was exercised); any browser but Chrome; any hardware but
this machine; the deployed instance behind install.sh; the forecast fan on a
real backend response rather than a stub; the public landing page (the session
was authenticated throughout, so phase 1.5's h1→h3 skip was not re-checked); any
screen reader; and every COMPUTING branch of forecast, inflation and annualised
recurrences — on this fixture all three refuse, by design, so only the refusing
branch has ever been rendered from real data.

Task 19 (fix round, on top of fe03b8f): CORRECTS THREE THINGS THIS LEDGER SAYS.
Read these four entries over the task 19 entries above them.

Task 19 fix round: THE `--yd-border-strong` DEFERRAL WAS WITHDRAWN — its scope
claim was false. The token did not only border "cards, panels and bento cells";
it bordered FOURTEEN rules covering seventeen BUTTONS, every one of them
`background: transparent`, where the hairline is the whole outline of the
control. `.yd-chart__export-toggle` was worse still, on plain `--yd-border`.
All fourteen now take `--yd-border-control` (5.04:1 dark / 3.96:1 light against
`--yd-surface-strong`). Three hover twins moved to `--yd-accent`, because
`--yd-border-strong` is WEAKER than `--yd-border-control` and hovering would
otherwise have lowered the contrast. `.yd-dropzone` was fixed too — the import
wizard's primary control, a dashed hairline whose colour it inherits from
`.yd-glass--raised`, which is why no per-rule scan can see it. Containers,
banners, popup surfaces, the "Essentiel" badge and the breadcrumb marker keep
the hairline, and the report names each one and why.

Task 19 fix round: THE PERFORMANCE WATCH ITEM IS NOT CLOSED — the instrument was
saturated. Every row of D1 reports p50 = 6.90 ms on a 144 Hz display, and
1000/144 = 6.94 ms: that is the vsync floor, not a measurement of cost.
"Identical at p50/p95/p99" therefore means "no frames were dropped", NOT "the
atmosphere costs nothing" — two conditions can differ by several ms of paint,
raster and composite and still emit byte-identical rAF deltas, because rAF
measures cadence, not work. Correct status: "not reproducible at frame-drop
granularity; unmeasured below vsync". What would settle it: interleaved A/B
repetitions in ONE session reporting the spread (the current numbers are one run
per condition, so drift and condition are confounded), plus a metric with
headroom below vsync — `long-animation-frame` entries, per-frame paint/raster/GPU
durations from a DevTools trace, or an uncapped run. The 1 632 kB bundle and its
~1.25 s load frame ARE a direct measurement and stand: 1 243-1 285 ms is nowhere
near the floor.

Task 19 fix round: RAMP MISLABEL. `#d95926` and `#d55181` are `DARK_CATEGORICAL`
entries (charts/theme.ts:103, :106), not light-ramp colours. `#2a78d6` and
`#e34948` are the two from `LIGHT_CATEGORICAL`. The finding is unchanged — four
colours across BOTH ramps clear 4.5:1 against neither white nor `--yd-text`.

Task 19 fix round: M1 and M2 are FIXED, not deferred. `CashflowChart` now
carries `legend.right: 84`, so "Solde net" wraps onto its own line instead of
rendering under the opaque Exporter button ("Sold*Exporte*r" at 375); at 1440 the
three entries still sit on one line, clear of the button. `WaterfallChart` now
carries `labelLayout: { hideOverlap: true }` — at 375 "+10 220 €" and "-3 900 €"
shared an anchor level (a rise followed by a fall from the same level) and
overprinted as "+10 2209 00 €". Printing all eight amounts at 375 is
geometrically impossible: 235px of plot, eight bands, ~55px per label, and a
cascade has no free level to move one to because bar i's bottom IS bar i+1's
top. COST, stated: at 375 one amount — Logement's, the largest expense — is no
longer printed on the plot. It stays in the tooltip and the CSV. At 1440 all
eight print and the fix costs nothing.

Task 19 fix round: two new tokens are now PINNED, which they were not.
`--yd-negative-text` joined `TEXT_TOKENS` in design/contrast.test.ts (4.5:1
against `--yd-bg`), and a new suite pins `--yd-border-control` at 3:1 against
`--yd-surface-strong`. Both pass as shipped, so both were proved to bite by
temporarily weakening the values (1.92:1 and 1.21:1 respectively) before
reverting. New file design/controlBorders.test.ts parses every stylesheet and
fails if any rule declaring `cursor: pointer` — or a `:hover`/`[attr]` narrowing
of one — takes its border from `--yd-border` or `--yd-border-strong`. It reads
one rule at a time, so it cannot see an inherited edge; that limit is written
into the file.

Task 19 fix round: minor (deferred): m12 — at 375 the cashflow chart's LAST
X-AXIS LABEL is clipped, "janv. 2026" renders as "janv. 202", both themes.
`boundaryGap` does not rescue this one: 13 buckets in a 235px plot gives a ~9px
half-band inset against a ~32px label half-width. Pre-existing phase 1.5, and
the legend fix does not touch it. m13 — `tileLabelColor`'s NaN fallback on a
short hex (CategoryTreemap.tsx:116-124 slices fixed offsets, `parseInt("")` is
NaN, `NaN >= NaN` is false, so it silently returns ink) where
contrast.test.ts:27-29 THROWS on the same input; the no-silent-failure rule says
the treemap should throw too. m14 — the WCAG maths now exists in THREE copies
(design/contrast.test.ts, charts/CategoryTreemap.tsx, charts/theme.test.ts) and
wants one `design/contrast.ts`.

Task 19 fix round: FOR THE OPERATOR, not acted on. CLAUDE.md tells every session
to read `.superpowers/sdd/.../progress.md` "before assuming a past task's
behavior", but `.superpowers/sdd/.gitignore` is `*` and `git ls-files
.superpowers` returns zero paths — a fresh clone has none of it. Either the
directory ships or the sentence goes; a middle option is to commit progress.md
and the task reports while leaving `shots/` and `review-*.diff` ignored. The
trade-off both ways is written out at the end of task-19-report.md.

Task 19 fix round: suites after — backend 522 passed (untouched), frontend
630 passed (622 + 8), `npm run build` at zero TypeScript errors, console clean,
no horizontal scroll at 375. Same backend worker (PID 6544) and the same
untouched fixture (198/197/1/0, one batch, one account) before and after.
Fourteen screenshots re-shot at 1440 and 375 in both themes, read back and
judged: the new control colour is desaturated slate and sits at the same weight
as the inputs B5 already fixed — it does not shout, and no container gained an
outline.

Task 19 fix round: COMMIT 4e2c812 on top of fe03b8f, 16 files, +162/-29. Note
for anyone adding a second disk-reading test: this repo's CSS line endings are
MIXED — .gitattributes declares only `*.sh text eol=lf`, core.autocrlf is true,
and 8 of the 23 stylesheets under src/ are stored CRLF while 15 are LF. The new
design/controlBorders.test.ts was run against both forms (all 23 converted to
CRLF, 48 tests passed, converted back) and is line-ending agnostic.

Task 19: fix round 1/5 (4 addressed — the `--yd-border-strong` deferral rested
on a FALSE scope claim: dismissed as "decorative container edges", the token in
fact bordered 17 transparent-background buttons at ~1.5:1, where the hairline
is the only thing identifying the control. A stylesheet scan found 14 rules,
no false positives, plus `.yd-dropzone` — the import wizard's primary control —
invisible to any per-rule scan because its dashed edge comes from
`.yd-glass--raised`. Three hover twins had to move to `--yd-accent`, since
`--yd-border-strong` is now the WEAKER of the two and hovering would have
lowered contrast. The two new tokens had no test floor at all. Plus the
cashflow legend/Exporter overprint at 375, one line with an in-repo precedent,
deferred from inside the file being edited; and two overprinted amounts on the
dashboard's default chart at 375). Commits fe03b8f..4e2c812.
Task 19: fix round 2/5 (1 addressed — the new control-border floor measured
against `--yd-surface-strong`, which in the LIGHT theme is #ffffff, the
lightest possible value, not the darkest. The token clears 3.96:1 there but
only 3.46:1 against `--yd-bg` — a figure already documented in tokens.css and
left unpinned. A value keeping 3:1 against white while dropping to 2.66:1
against the real page ground would have passed. Now pinned against each
theme's genuine worst case, proved by a weakening that isolates exactly that
gap). Commits 4e2c812..bfd5ad5.
Task 19: complete (commits 4b1dbeb..bfd5ad5, review clean). Backend 522,
frontend 632, build clean.

Task 19: THE DASHBOARD WATERFALL HAD BEEN WRONG SINCE PHASE 1.5. It drew a
-2 209,63 EUR deficit as a bar rising ABOVE zero — the same ECharts samesign
stacking defect as the forecast band, found by analogy and verified in
`layout/barGrid.js:398-399` rather than assumed. Phase 1.5 verified that
screen in a browser, in both themes, with screenshots, and missed it.
Task 19: five blocking findings, all fixed: the waterfall anchor; treemap
on-tile labels at 1.80-2.69:1; alert text at 3.61:1 on ELEVEN screens; the
Réglages switch invisible when off, the whole control inside a 1.64:1 band;
and every form-control boundary at 1.30-1.55:1. Every ratio measured off a
decoded screenshot pixel, not computed from tokens.
Task 19: CORRECTION TO PHASE 1.5's PERFORMANCE FIGURE, AND TO ITS CORRECTION.
The watch item is recorded OPEN, not closed. Effects on and off are
indistinguishable at p50/p95/p99 with 0% of frames over 20ms — but every row
reports p50 = 6.90ms on a 144Hz display, which IS the vsync interval: the
instrument is saturated at its floor. That means "no frames were dropped", not
"the atmosphere costs nothing"; two conditions can differ by several
milliseconds of paint and still produce byte-identical rAF deltas. What would
settle it: interleaved A/B repetitions reporting spread, and a metric with
headroom below vsync (long-animation-frame entries, per-frame paint/raster/GPU
from a trace, or an uncapped run). The one direct measurement that stands is a
~1.25s load frame parsing a 1632 kB bundle.
Task 19: note: API latency is fine — worst 27.3ms p95 against a 200ms
threshold, at the operator's volumes.
Task 19: note: `hideOverlap` costs one printed figure at 375 — Logement's
-3 900 EUR no longer draws on the plot, though tooltip and CSV keep it. A
cascade has no free level to move a label to, because bar i's bottom IS bar
i+1's top. All eight amounts still print at 1440.
Task 19: minor (deferred): m12 — the cashflow chart's last x-axis label clips
to "janv. 202" at 375 in both themes; `boundaryGap` cannot rescue it (13
buckets give a ~9px half-band inset against a ~32px label half-width).
Pre-existing from phase 1.5. `tileLabelColor` returns ink silently on a 4-char
hex instead of throwing, against the no-fallback rule. The WCAG maths now
exists in three copies and wants a `design/contrast.ts`. `.yd-dropzone`'s
border wins its specificity tie with `.yd-glass--raised` only by bundle source
order — verified correct today by getComputedStyle, but not pinned by a test.

## OPERATOR DECISION PENDING

`CLAUDE.md` tells every future session to read this ledger "before assuming a
past task's behavior", but `.superpowers/sdd/.gitignore` is `*` and zero files
under `.superpowers` are tracked — so a fresh clone has none of it, including
every task report and the phase 2B carry-forward. Either the directory ships
(a middle option: commit `progress.md` and the reports, keep `shots/` and
`review-*.diff` ignored) or the CLAUDE.md sentence goes. Not decided.

ALL 19 TASKS COMPLETE. Backend 522 tests, frontend 632, build clean.
