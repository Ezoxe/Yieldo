# SDD ledger — phase 4, assistant

Plan: docs/superpowers/plans/2026-09-03-yieldo-phase-4-assistant.md
Branch phase-2-analyse-decision. 10 tasks, all shipped.

`0c50376` `b4ba831` `473dd6b` `f69f6c7` · `c218aa5` `92edfc7` `902d0a9`
`0009dc8` · `ee873ac` `50c8e84` `2148557` `b45dd4f` · `f3db94e` `d653509`
`f5f4b0e` · `1f35a42`.

**The contract of the phase: the model never calculates.** It is handed the
deterministic answer and asked to comment. Pinned by feeding a stubbed
completion a deliberately **wrong** number and proving it reaches no wire field
— a plausible number could not have proven it.

- Nine intents, each tested with three to six phrasings **plus phrasings that
  must not match**. One phrasing per intent cannot tell a parser from a lookup
  table. Self-review against the real fixture caught two false positives:
  "Combien coûte une baguette ?" answering with the whole ledger total, and the
  filler noun "dépenses" read as a category.
- An unrecognised intent is a designed state with ten clickable formulations,
  never a guess. An engine refusal travels through **unchanged**.
- A stored question is re-executed on read, proven by a mutation: caching the
  answer turns the test red.
- Export filters are the feature — each dimension is tested against a fixture
  that always holds out-of-scope rows, so a broken filter visibly leaks.
  Anonymisation is verified by scanning the **whole** document for twelve
  seeded names plus every absolute figure, not one field.
- Four model causes: aucun modèle configuré, clé refusée, injoignable, délai
  dépassé. A disabled or unreachable model degrades to the deterministic answer
  alone and says so.
- **An absence in an unimported month is a gap in the data, not a missed
  payment.** `_missing_debit_alerts` withholds the subject and says which month
  is not covered. The operator has eight such months.
- Keys are write-only end to end: no field is ever prefilled and no masked
  value is painted anywhere. CoinGecko and Frankfurter render no key field.

**Two flakes closed** (`50c8e84`): both pages call `useReducedMotion()`, and a
local `vi.fn()` `matchMedia` reset by `vi.restoreAllMocks()` threw into
whatever test was running next. `test-setup.ts` now carries a permanent stub —
do not redefine it locally.

**Final verification** (phases 2C, 3, 4): backend 1567 passed / 6 skipped with
no key and no network, ruff clean, frontend 1124, build clean, one Alembic head,
migration schema identical to `Base.metadata` up and down, isolation verified
on all nine new routes with positive controls first, no key reaching any
response, log, PDF or export. One NOTE, since fixed in `1f35a42`: twelve
columns carried a `server_default` in the migration and only a Python-side
`default=` on the model, so `create_all` and a migrated database disagreed at
the DDL level. The comparison test now covers `server_default` too.
