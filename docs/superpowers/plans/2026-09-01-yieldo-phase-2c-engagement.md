# Yieldo Phase 2C — Engagement : Implementation Plan

Design §6.2's last block. Four mechanics, all anchored on real data:
*streak de suivi*, *jalons d'objectifs*, *santé financière évolutive*,
*défis dérivés des données*. Spec's own closing rule, which governs every task
here:

> Aucun badge décoratif, aucun titre, aucun élément qui ne corresponde pas à
> une action mesurable.

## Global constraints

Inherited whole from phase 2B, and non-negotiable:

- Integer cents on every monetary field, at every layer. `Decimal` interior
  only, through `engines/amortization.cents`. Rates as integer basis points.
- Pure engines: no session, no network, no implicit clock — `today` is a
  parameter. `engines/` and `importers/{dialect,mapping,parser,dedup}.py` only.
- Every query on a business table filters `user_id` via `get_current_user`.
- No silent failures. No bare `except`. No fallback value standing in for real
  data. An input the engine cannot interpret raises a French `ValueError`.
- French user-facing text; English code, identifiers, comments and commits.
- TDD, one commit per task, Conventional Commits.
- UI tasks are not done until opened in a browser at 375, 768 and 1440 px, in
  both themes, against the seeded fixture, with screenshots attached.

### The defect classes this project keeps paying for

1. **A French sentence naming the wrong cause**, or asserting a measurement
   that was not made. Fixed in fifteen tasks across phases 2A and 2B. Read
   every sentence and ask whether it is true of *every* input that reaches it.
2. **An invariant that holds by construction.** Task 1 of 2B shipped a balance
   that compounded to a `decimal.InvalidOperation` crash while its exactness
   invariant held throughout. Assert what can break.
3. **A test that passes for the wrong reason.** A fixture of identical values
   cannot tell a median from a mean; a category present in every month cannot
   tell "per observed month" from "per month it appeared" — that exact fixture
   hid a defect through all of lot D.
4. **`None` as a fallback.** Every distinct situation gets its own answer and
   its own sentence.

### The operator's data, which every figure here must survive

197 transactions, 24 January 2025 to 9 January 2026, one account, 69
categories, **3 complete observed months**, savings capacity **−746,19 €/month**,
income **471,11 €/month**, liquid balance **−2 209,63 €**. Eight months of the
span are unimported and must never be counted as zero.

A household with three complete months and a negative capacity is the case
every screen in this phase is designed for. A mechanic that only reads well on
a healthy, fully-imported ledger is designed for somebody else.

## Scope

Four mechanics, six tasks. `Milestone` already ships from phase 2B task 7
(`engines/goal.py`) and is consumed **exactly as built** — it is not rebuilt
here.

## Task order

### Lot A — measurement

- **Task 1: The follow-up streak** — `engines/streak.py`.
  Consecutive months with imported statements, from the `import_batches` and
  the transaction dates already stored. Produces `StreakReport`: `current`,
  `longest`, `last_complete_month`, `months: list[MonthCovered]` (each `key`,
  `covered`, `transaction_count`), and `broken_reason: str | None`.
  A month with no transactions is **not** covered — but the engine must
  distinguish "imported and empty" from "never imported", because the operator
  has eight of the second kind and none of the first. `today` is a parameter,
  and the CURRENT month is never counted as broken: it is not over.

- **Task 2: The financial health score** — `engines/health.py`.
  Design §6.2: "le score et ses composantes suivis dans le temps, avec ce qui
  l'a fait bouger". Four components, each measured, each with its own French
  sentence and its own refusal: savings rate, essential-expense share, runway,
  and budget adherence. `HealthScore`: `score: int | None` (0-100),
  `components: list[HealthComponent]`, `unavailable_reason: str | None`.
  **A component that could not be measured is not zero.** The score is `None`
  when fewer than two components could be measured, and the reason says which
  ones and why. No component is weighted by a quantity the data controls —
  fixed documented weights, stated on screen.

### Lot B — persistence

- **Task 3: `health_snapshots` and `challenges`** — models, one migration.
  `HealthSnapshot`: `user_id`, `taken_on: date`, `score: int`,
  `components: str` (JSON), unique on `(user_id, taken_on)`.
  `Challenge`: `user_id`, `kind`, `title`, `detail`, `target_cents: int | None`,
  `category_id: int | None`, `proposed_on: date`, `state`
  (`proposed`/`accepted`/`rejected`), `decided_on: date | None`,
  `measured_cents: int | None`, `measured_on: date | None`.
  Verified through `tests/test_migrations.py`'s `migration_db` harness, never
  through the fixture — `seed_fixture.py` calls `create_all`, so a migration
  that creates nothing would still pass.
  `*Patch` schemas use `schemas/patching.not_nullable`.

### Lot C — the challenges

- **Task 4: Data-derived challenges** — `engines/challenge.py`.
  Proposals built from what phase 2A already measures: unused subscriptions
  from `engines/recurrence.py`, a category above its own past level from
  `engines/inflation.py` and `aggregate`, an anomaly from `engines/anomaly.py`,
  a budget repeatedly overrun from `engines/budget.py`.
  Each proposal carries **the figure that justifies it and the months it was
  measured over**. A challenge Yieldo cannot quantify is not proposed — it is
  not shown as a zero, and it is not shown at all.
  `measure_outcome(challenge, months, today)` returns what actually happened
  the month after acceptance, including "not enough elapsed yet" as its own
  answer rather than a zero.

- **Task 5: `/api/engagement`** — streak, milestones, health with its history,
  and challenges with accept/reject.
  `GET /api/engagement` assembles all four from the requesting user's own
  ledger. `POST /api/engagement/challenges/{id}/accept` and `/reject`.
  Health snapshots are written at most once a day per user, on read, and the
  history is what makes "ce qui l'a fait bouger" possible — the delta is
  computed against the previous snapshot, never against a recomputation of
  today's inputs at yesterday's date.
  A refusal from any engine is a 200 carrying a French sentence, not a 422.

### Lot D — the screen

- **Task 6: `/suivi`** — the screen and the health-history chart.
  Streak, milestones across all goals, the score with its four components and
  what moved each, and the challenge list with accept/reject and the measured
  outcome of what was accepted.
  On the operator's data: a broken streak, a score built from two of four
  components, and challenges derived from 197 real transactions. **That state
  is the screen's best-designed state.**
  Tokens from `design/tokens.css`; ECharts `stackStrategy: "all"`; the chart
  key in HTML above the canvas, never `legend`; motion gated by both
  `data-motion="off"` and `useReducedMotion()`.
