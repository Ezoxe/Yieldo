# SDD ledger — plan: docs/superpowers/plans/2026-08-24-yieldo-phase-2b-decision.md

Branch: phase-2-analyse-decision, continuing from 508e60e (end of phase 2A).
Start state: backend 529 tests, frontend 634, both green, build clean.

21 tasks in six lots: A money substrate (1-2), B dettes (3-6), C objectifs
(7-9), D faisabilité (10-16), E simulateurs (17-20), F verification (21).

## Pre-flight scan

No contradictions found between tasks or against the Global Constraints. Three
decisions the plan makes are declared and accepted:

- Levers are not ranked by a synthetic score. §6.3 says "chiffrés et classés";
  the five are incommensurable, and a composite score means dividing by a
  quantity the data controls — the failure phase 2A ruled against twice.
  Feasible first, then a fixed documented order, each with its own figure.
- Cash versus credit holds INCOME constant, not capital. That makes the credit
  path's end wealth independent of the loan rate and the break-even a clean
  binary search. LOA is compared on cash figures only, never end wealth, and
  stays empty until a dealer's quote is entered.
- Saved scenarios store the question, never the answer, and recompute on every
  read — otherwise a verdict measured on last winter's statements replays as
  current.

Two spec requirements could not become tasks, both declared in the plan:
- §6.3 item 7's financial health score — no such engine exists; §6.1 lists it
  among the FinVest engines not yet ported and phase 2C owns "santé financière
  évolutive".
- §6.3 item 7's "patrimoine net à horizon cinq ans" — net worth needs phase 3's
  investment accounts. Task 11 substitutes a five-year LIQUID trajectory from
  the same capacity; task 16 requires the screen to state both absences in
  French. `ImpactOut` deliberately carries no field for either, so nobody later
  fills one with a placeholder.

## The operator's own numbers, measured before the plan was written

Run against the seeded fixture with phase 2A's shipped engines, for a 40 000 EUR
purchase:

- measured savings capacity: median **-746,19 EUR/month**, band
  [-3 476,90, +1 984,52], over 3 complete months
- projection at twelve months: **-8 954,28 EUR**
- gap: **48 954,28 EUR — larger than the price**, because the pot shrinks
- even the optimistic end of the band reaches only +24 144,42 EUR, so the
  screen is forbidden from offering "dans un bon mois, c'est jouable"
- borrowing prices the gap at 923,83 EUR/month — a **196,10 % debt ratio**
  against his measured 471,11 EUR/month income

This is a VERDICT (`out_of_reach`), not a refusal. The engine refuses only
where its input refuses: capacity `None`, under three observed months.

## Three prohibitions, in the module docstring and pinned by mutation tests

- no `abs()` or clamp on a negative capacity
- no interest credited to a non-positive pot
- no fallback verdict

These are the three ways the figure above could be quietly flattered.

## Carried from phase 2A's whole-branch review, to fix after merge

- flow queries are not filtered to the liquid account set while the balance is
  (`api/cashflow.py`) — inert on a single-account ledger, wrong by construction
- the budgets summary's two headline figures are over different populations
  with no scope sentence, the only screen of the five without one
- `formatRatio` typesets `%` with a plain space where `formatCents` uses U+00A0
- two general-purpose formatters live in component modules rather than
  `design/theme.ts`
- `budget_report` lacks a catch-and-forward for a provably-unreachable
  `ValueError`

## Environment

Fixture and login unchanged: `seed_fixture.py` in the phase 1.5 workspace,
`demo@yieldo-demo.fr` / `MotDePasseDemo123!`. Today is 2026-08-12 in the
fixture's world.

Dev servers must be started detached (`Start-Process`) or they die with the
shell. Check `Get-NetTCPConnection -LocalPort 8000` before trusting API output
— a stale worker has cost this project three separate rounds.

`.superpowers/sdd/.gitignore` now ships `progress.md`, `task-*-report.md` and
`final-fix-report.md`; screenshots and generated review diffs stay ignored.

## Task log

### Lot A — the money substrate

**Task 1 — amortisation** (`f06d5ca`, fix `d08c5b7`). `engines/amortization.py`:
level payment, schedule, total interest, `debt_ratio_bps`, `HCSF_DEBT_RATIO_BPS
= 3500`, `MAX_LOAN_MONTHS = 480`. First arithmetic in the codebase that cannot
be done in integers: interior `Decimal`, `ROUND_HALF_UP` at every cent via
`cents()`, rates in integer basis points, rounding residue absorbed by the
final instalment.

Review found one BLOCKING defect, invisible to a green suite and to the
exactness invariant itself: a level payment rounded below the first month's
interest made `principal = payment - interest` negative, compounding the
balance ~1,8x a month until it outran Decimal's 28-digit context and raised
`decimal.InvalidOperation` — an English traceback out of an input `_validate`
had just accepted (`build_schedule(2, 30_000, 360)`). Shorter terms did not
crash, they stalled: 999 c at 1 000 %/an over 50 months repaid zero capital for
49 rows and dumped everything on the last. The exactness invariant held
throughout, because the final-row override makes the components sum either way.
Fixed by refusing a payment that does not cover the first month's interest —
interest is highest in month one, so one comparison decides the schedule —
guarded on `first_interest > 0` so a capital too small to round up any interest
still amortises on a payment of zero. A rate CEILING was deliberately not
added: the plan puts one at task 12, where the product knows which product it
is pricing.

Also corrected: `test_monthly_rate_is_an_exact_decimal_never_a_float` claimed
350 bps while testing 1 200, whose value is exact in binary float too — the
fixture could not have caught a float return.

**Task 2 — savings** (`dff4c75`, refactor `7b066fe`). `engines/savings.py`:
`project_savings`, `required_monthly_cents` (binary search),
`months_to_target`, `opportunity_cost_cents`, `DEFAULT_ANNUAL_RETURN_BPS =
300`, `MAX_PROJECTION_MONTHS = 600`. Rounds the balance monthly, not once at
the end, stated in the docstring and pinned. Review probed 2 016 combinations:
`final == initial + contributed + interest` never broke, and the standing
prohibition holds in both directions — a pot crossing zero downward stops
earning the following month, one crossing upward earns nothing in the crossing
month itself.

`months_to_target` returns `None` for two distinct situations — never reachable,
and reachable only past month 600. That is the plan's own interface, not a
defect introduced here, but **tasks 7, 11 and 18 must render them with
different French wording**, not one blanket "jamais atteignable".

### Lot B — dettes

**Task 3 — schema** (`43a41bb`). `debts`, `goals`, `scenarios`, one migration
`d1a4c9e77b02`. Verified independently of `create_all` (which would make any
fixture-routed test pass against a migration that creates nothing): scratch
SQLite upgraded from the previous revision, schema dumped and diffed against
`Base.metadata` — columns, types, nullability, foreign keys, `ON DELETE
CASCADE`, indexes all identical; downgrade leaves nothing behind; one Alembic
head. Clean review, no findings.

**Task 4 — payoff** (`5285a7c`, fix `fbbe722`). `engines/debt.py` + shared
`period.month_end`. Review found three BLOCKING, none visible to the suite: a
negative `extra_monthly_cents` funded LESS than the contractual minimums (the
budget is `sum(minimums) + extra`) and nothing noticed — the aggregate still
cleared the first month's interest, so no refusal fired and a low-priority debt
grew untouched under a plan reporting success; a negative rate manufactured
money; the interest-only refusal claimed "le capital augmenterait" when at the
equality boundary it stays flat.

`interest_saved_cents` was documented as positive whenever the orders differ.
It is not: over a 4 000-fixture sweep with a non-negative extra, **450 pairs
tied with different orders and one left avalanche a cent behind** — rounding
each month's interest to the cent erases the theoretical gap. Pinned by
`test_avalanche_can_tie_or_trail_by_a_cent`. Any screen printing "vous
économisez X" must handle X <= 0.

Empty debt list answers `months=0, cleared_on=None, reason=None` — not a
refusal. A screen must read that as "aucune dette", never "soldé dans 0 mois".

**Task 5 — `/api/debts`** (`8c92506`, fix `e49f1c3`). CRUD, archive-not-delete,
`/payoff`. Isolation verified by probe on every axis (404, never 403). Review
found a BLOCKING defect **older than this phase**: every `*Patch` schema types
its fields `X | None` so omitting one means "leave it alone", and pydantic
reads an explicit JSON `null` as provided — so `{"name": null}` validated,
reached `setattr` and surfaced as a raw `IntegrityError` 500 with an English
traceback. Reachable on debts, accounts, categories AND transactions. Fixed
once, shared: `schemas/patching.not_nullable`, applied field by field so
clearing a genuinely nullable column still works.

**Task 6 — `/dettes`** (`550a039`, fix `c6f7405`). Screen, form, stacked payoff
chart. Six viewport×theme screenshots against the seeded fixture, plus the
empty and refusal states. The implementer found four defects in the browser
that the suite could not see, including an ECharts legend that wraps onto as
many rows as it needs while `grid.top` is a fixed pixel count — at 375 px the
third row painted over the plot. The legend is now HTML above the canvas.

Review caught a form telling the user "format JJ/MM/AAAA" for a field that
validates ISO. And a wording change that had left **three tests passing
vacuously**: they asserted the OLD sentence was absent, nothing asserted the
new one was present. Fourth test added.

### Lot C — objectifs

**Task 7 — goal engine** (`dbda272`, fix `ee529f2`). `engines/goal.py`:
`Milestone` (25/50/75/100, consumed by phase 2C exactly as built),
`GoalProgress`, sequential funding by priority. A goal already at its target
consumes no capacity and does not push the queue back.

Defect found by probe, not by the suite: funding is sequential but
`offset_months` only advanced past goals that COMPLETED. A goal refused for
running past fifty years left the offset untouched, so the next goal was
projected as if nothing were in front of it — a 1 000 € goal behind a
10 000 000 000 € one came back "atteint dans 2 mois". Now a **fourth** refusal,
naming the blocker rather than repeating the fifty-year sentence, which would
blame the small goal's own size.

**Task 8 — `/api/goals`** (`ce67642`, tests `d1e3a9e`). CRUD plus progress
measured from the requesting user's own transactions. Two of the four refusals
were only covered at engine level; both now travel over the wire with a real
small positive capacity behind them, because task 9's screen renders what the
API actually sends.

**Task 9 — `/objectifs`** (`291e2dd`, fix `dbe07cb`). Six viewport×theme
screenshots plus the empty, no-capacity, projection and blocked-queue states.
The stale-worker trap was live again: port 8000 held by an orphaned
system-python uvicorn, killed before seeding.

The negative-capacity refusal said "cet objectif ne progresse pas". Every goal
refuses with the identical sentence, so the screen hoists it above the list —
where "cet objectif" designates nothing. Reworded in the ENGINE to "aucun
objectif ne progresse", true in both positions. Two frontend assertions were
pinned to the old wording and would have gone on passing against the stale
fixture.

**The screen the operator will actually open** is the negative-capacity one:
it names the two real remedies and states outright that importing more relevés
would change nothing. No import link is rendered in that register at all.

### Lot D — faisabilité d'achat

**Task 10 — ownership** (`283e8d3`). `engines/ownership.py`: declining-balance
depreciation on the REMAINING value, French prefilled averages, each assumption
kept attached to the line it produced so task 16 can show and edit it.
`CostItem` carries a monthly amount XOR an annual rate of value, enforced in
French. Added beyond the brief: a bound on `depreciation_bps_per_year`, without
which a negative rate silently models appreciation — which this module says is
never baked in — and a rate over 10 000 bps drives the residual negative.

**Task 11 — feasibility** (`f075543`, lint `16c1003`). The centre of the phase.
Three verdicts by where the target falls against the band (`comfortable`,
`tight`, `out_of_reach`) and exactly ONE refusal: capacity unmeasurable. A
negative capacity is a verdict, not a refusal. 42 tests, 16 mutations applied
and all 16 killed, 16 016-combination sweep.

The operator's six figures come out unchanged, re-measured from the live
fixture rather than trusted from the brief: median −74 619 c over 3 months,
projection −895 428 c, gap 4 895 428 c (larger than the 4 000 000 price), the
optimistic band reaching only 2 414 442 c.

Two spec requirements stay deliberately unfilled and `Impact` carries no field
for either: the financial health score (phase 2C) and net worth at five years
(needs phase 3's investment accounts; a five-year LIQUID trajectory stands in).
**Flag any later schema that tries to add one.**

Brief defects caught: it reused the verdict refusal under the five-year panel,
where "aucun verdict ne peut être rendu" makes no sense; its income fixture put
the debit in the smallest month so inflow and net medians agreed, unable to
tell them apart; and one mutation test only asserted two strings DIFFER, which
a swap preserves.

**Task 12 — levers and financing** (`49dbbec`). Five levers in a fixed
documented order, feasible first, never ranked by a synthetic score. Ten
distinct refusals, no two sharing a wording, pinned by a test that counts them.
Cash versus credit holds income constant, so the credit path's end wealth is
rate-independent and the break-even is a clean binary search — proven over all
3 001 rates rather than spot-checked, with fixtures at both bounds where an
off-by-one changes the answer. LOA compares on cash figures only.

923,83 €/month at a 196,10 % debt ratio comes out as measured. No clamp, no
hedge: it is a verdict.

**Carry into task 13:** `_borrow` propagates amortisation's own refusal at the
user's quoted rate, which loses all five levers. Bound `loan_months` at the
wire so it stays unreachable.

**Tasks 14-21** — scenarios (`740e2b3`), `/faisabilite` (`4c25f3b`, `201a57e`),
the property engine (`dec6be0`), `/api/simulators` (`9dd0d72`), `/simulateurs`
(`d55d515`, `3782186`), the editable ownership form (`f75aea8`), the wire
additions (`99aec93`), the verification fixes (`e10dfc1`).

Scenarios were proven to recompute by a mutation, not by inspection: storing
the computed answer and reading it straight back turned the recomputation test
red. The brief's own version of that test used a one-month fixture where
`months_observed` was 0 before AND after the deletion — unfalsifiable.

**Task 21 verification** — 838 backend, 844 frontend, ruff and build clean,
one Alembic head, migration schema identical to `Base.metadata` and the
downgrade leaving no residue, 57/57 isolation checks in both directions, and
the operator's nine measured figures exact end to end.

It found three BLOCKING defects the suites could not:

- `_category_history` counted one entry per month a category HAPPENED to
  appear in, not one per complete observed month. A rent paid once in three
  months had a median of that single payment, won "la plus lourde", and the
  card printed it under "ce qu'il coûte un mois normal". The single test over
  that loop used a category present in every month, where both definitions
  agree.
- `_reason_no_category_history` told the household to import more relevés, in a
  branch only reachable by a household that already has three complete months.
- The comptant column spends the whole price on day one; on a balance that
  does not cover it, "payer comptant vous laisse X de plus" sat beside a
  verdict refusing the same purchase.

**Phase 2B closed.** Carry-forward for a later phase: the frontend bundle is a
single 1 739 kB chunk (+6,6 % over phase 2A), still past Vite's warning; eslint
is not installed so `npm run lint` has never run.
