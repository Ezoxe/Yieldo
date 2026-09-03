# SDD ledger — phase 2C, engagement

Plan: docs/superpowers/plans/2026-09-01-yieldo-phase-2c-engagement.md
Branch phase-2-analyse-decision. 6 tasks, all shipped.

- **streak** (`b955073`) — `MonthCovered.imported` is a strict superset of
  `covered`, built from each import batch's own transaction span. That is what
  tells "imported and empty" from "never imported": the operator has eight of
  the second kind and none of the first, and conflating them turns a data gap
  into a broken habit. The current month never breaks a streak — it is not over.
- **health score** (`6755cf1`) — four components, fixed weights summing to 100
  (savings rate 30, essential share 25, runway 25, budget adherence 20). A
  component that could not be measured is **not zero**: the weights renormalise
  over what was measured, tested to diverge from a zero-substitution bug
  (100 vs 80). No weight is derived from sample size — that is the denominator
  failure phase 2A shipped twice.
- **schema** (`a923376`), **challenges** (`3c0ced7`), **`/api/engagement`**
  (`ba262b0`), **`/suivi`** (`f5a9a51`).

`measure_outcome` treats "not enough time elapsed" as its own answer, never a
zero saving. Snapshots are written at most once a day per user on read, and
"ce qui l'a fait bouger" is the delta against the **previous stored snapshot**,
never a recomputation of today's inputs at yesterday's date.

On the operator's data: streak 0, longest 13, broken 7 months; score 0 from
3 of 4 components; one anomaly challenge (FNAC DARTY). No subscription
qualifies — the eight-month gap truncates every recurrence below the
annualisable floor.
