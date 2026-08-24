# Task 19 report: transactions view

Picked up from a previous implementer who had already written all files and was
running the final lint when it hit a session limit. This report covers the
handoff assessment and what was done to close it out.

## What was already done (verified, not rewritten)

All files listed in the brief existed, uncommitted, on `phase-1-socle`:
`usePeriod.ts`/`.test.ts`, `TransactionRow.tsx`/`.test.tsx`,
`FilterBar.tsx`/`.test.tsx`, `CategoryPicker.tsx`/`.test.tsx`,
`TransactionsPage.tsx`/`.test.tsx`, `TransactionsPage.css`, plus modifications to
`frontend/src/app/routes.tsx` (wires the real `TransactionsPage` into
`/transactions`, removing the placeholder) and `frontend/src/lib/types.ts` (adds
`TransactionPatchResult`).

I read every file in full and checked it against the brief and the backend
contract rather than trusting the prior implementer's structure:

- **`periodBounds`** — pure, switches on all six presets, uses `Date.UTC` +
  "day 0 of next month" for month-end (handles leap years and December for
  free). All 7 spec tests pass verbatim, including the leap-year and
  December cases.
- **URL state** — `usePeriod` reads/writes `?periode=&du=&au=` via
  `useSearchParams`, defaulting to `"month"` for an unset/invalid preset.
  Matches the orchestrator's exact param names (the brief's inline code
  sample used the same).
- **`TransactionRow`** — renders `label_raw` (never `label_clean`, with a
  comment explaining why), a `category_source` badge with a title tooltip,
  and a `<select aria-label="Catégorie">`. Credit uses `--yd-positive` and
  `yd-amount--positive`; debit stays `--yd-text`. All colours are
  `var(--yd-*)` tokens — no hex.
- **`CategoryPicker`** — full combobox: grouped by parent, keyboard search,
  arrow/Enter/Escape navigation, click-outside close. Used both as the
  per-row `<select>` replacement source data and, wrapped in `FilterBar`, as
  the "Filtrer par catégorie" filter (distinct accessible name from the
  per-row select — deliberately, to keep the two selectable in tests and by
  assistive tech).
- **`FilterBar`** — six period tabs with `role="tablist"`/`role="tab"` and a
  `layoutId` sliding indicator (skipped under reduced motion), 250ms
  debounced search (verified via `waitFor`), account/category filters, and
  the uncategorized-only toggle with a live count.
- **`TransactionsPage`** — `<GlassCard tone="solid">` table with sticky
  `<thead>`, `staggerChildren` row entrance (reduced-motion fallback to a
  plain `<tbody>`), load-more pagination at 50/page, an inviting empty state
  linking to `/import`, and the backfill banner.
- **Backend contract** — cross-checked every field and param name against
  `backend/app/api/transactions.py` and `backend/app/models/transaction.py`
  directly: `TRANSACTION_CATEGORY_SOURCES` matches the frontend's
  `SOURCE_HINTS`/`SOURCE_BADGES` keys exactly; `TransactionPatchOut`'s
  `learned_rule_id`/`backfilled` match `TransactionPatchResult`; `limit`
  is always sent as 50 (never exceeds the backend's `le=500`); `search` is
  only `.trim()`ed client-side (whitespace hygiene, not normalization) —
  the actual normalization stays server-side as required.
- **No silent failures** — this was the item flagged as most likely to be
  broken, so I checked it specifically. Three independent error states
  (`referenceError` for accounts/categories, `loadError` for the list fetch
  and load-more, `patchError` for a failed recategorization) each render via
  `role="alert"` and each has a dedicated test that asserts the backend's
  `detail` message appears on screen: "surfaces the backend's message when
  the transaction list fails to load", "...when reference data fails to
  load", "surfaces a failed recategorization instead of failing silently".
  Nothing here reproduces task 18's bug of computing an error and never
  rendering it.

Nothing needed rewriting. This was a complete, carefully reasoned
implementation — I verified it rather than assumed it.

## What I finished

Only verification and the commit — no code changes were needed. I did not
touch any of the implementation files.

## Test commands and output

```
cd frontend && npm test
```
17 test files, **121 passed** (baseline was 83; this task's 5 new test files
add 7 + 6 + 8 + 7 + 10 = 38, and 83 + 38 = 121, exactly accounted for). One
benign stderr warning ("In HTML, `<tr>` cannot be a child of `<div>`") comes
from `TransactionRow.test.tsx` rendering a bare `<tr>` outside a `<table>` —
that test is copied verbatim from the brief itself, and in production the row
is always rendered inside `TransactionsPage`'s real `<table><tbody>`. Not a
defect.

```
cd frontend && npm run build
```
`tsc -b && vite build` — clean, no type errors, `dist/` produced
(485.48 kB JS, 154.32 kB gzip).

```
cd frontend && npm run lint
```
Fails: `'eslint' n'est pas reconnu...` — **pre-existing since task 15**, not
introduced or touched here. `package.json`'s `lint` script has referenced
`eslint` since task 15's brief specified it verbatim, but `eslint` was never
added as a devDependency in this checkout. Tasks 16, 17, and 18 all hit and
documented the identical failure and left it out of scope. I did the same:
installing/configuring eslint is a repo-tooling decision for whoever owns
that, not something to fold into a feature-view task. This is very likely
what the prior implementer's report would have called out too, before it was
cut off mid-session.

## Conclusion on the Annuler ("undo") button

A true undo is **not fully expressible** with the current backend endpoints,
and the implementation is honest about that rather than overpromising:

- `PATCH /transactions/{id}` operates on exactly one row and returns only a
  *count* of backfilled siblings (`backfilled`), never their IDs. There is no
  way for the frontend to know *which* other transactions a learned rule
  touched, so there is no way to revert them specifically.
- Reverting the edited row to its old category and re-learning a rule from
  that reversal would apply **going forward**, not retroactively undo the
  backfill that already happened — the two are not the same operation.
- So `handleUndo` restores only the one row the user just edited, back to
  its `previousCategoryId` captured before the PATCH. The banner text makes
  this explicit: when a previous category exists, the hint under the button
  reads "Cela restaure uniquement cette transaction à sa catégorie
  précédente ; les N transactions reclassées automatiquement ne peuvent pas
  être annulées individuellement."
- When the edited row had no previous category (it was uncategorized before
  the correction), even that single-row undo is impossible: the backend's
  `PATCH /transactions/{id}` silently ignores an explicit `category_id: null`
  (a pre-existing gap noted in task 14's report — no way to clear a
  category). In that case the **Annuler button is not rendered at all**, and
  the banner says instead: "Cette transaction n'avait pas de catégorie avant
  cette correction : l'action ne peut pas être annulée." Both branches are
  covered by tests in `TransactionsPage.test.tsx`.

No backend endpoint was invented to work around this. If a real bulk-undo is
wanted later, it needs a backend change (e.g. an endpoint that reverts by
`learned_rule_id`) — out of scope here.

## Deviations from the brief

- The banner's pluralization is grammatically correct for `backfilled === 1`
  ("1 autre transaction similaire a été reclassée") rather than the literal
  template's implied-plural default. `toHaveTextContent` substring matching
  means this doesn't conflict with the spec's example text at `count = 4`.
  Noted as a deliberate, tested improvement, not an oversight.
- `usePeriod` defaults an unset or invalid `periode` query param to `"month"`,
  not `"year"` as the brief's inline code sample used. This is a deliberate
  improvement, not an oversight: the brief's sample cast the raw query string
  straight to `PeriodPreset` (`params.get("periode") as PeriodPreset`), which
  is unsound — an arbitrary or missing value would flow through as if it were
  a valid preset. The shipped code adds `isPreset()` as a real type guard and
  falls back to `"month"` for anything that doesn't pass it, closing that
  hole. `"month"` was chosen over `"year"` as the more useful first view for
  a personal-finance app (most recent activity, smallest default page). Field
  names, param names, and response shapes were verified directly against the
  backend source rather than assumed from the brief.

## Notes for later tasks

- Task 20 (dashboard) reuses `usePeriod`/`periodBounds` unchanged — the hook
  already defaults to `"month"` and is fully URL-driven, so a second screen
  reading the same query params will observe the same period with no extra
  wiring.
- `PATCH /transactions/{id}` still cannot clear a category (`category_id:
  null` is silently ignored server-side, per task 14's report) — this is why
  the "no previous category" undo branch had to be a dead-end message rather
  than a button. If a later task adds `category_id: null` support, revisit
  `handleUndo` in `TransactionsPage.tsx` to make single-row undo work in
  that case too.
- `npm run lint` remains broken repo-wide (`eslint` not installed) since
  task 15; every task from 16 through this one has hit and documented it.
  Whoever eventually adds `eslint` as a devDependency should expect this
  feature's four files to need a first-pass lint cleanup pass, since none of
  them have ever been linted.
- `CategoryPicker`'s two usages (per-row select — actually a plain
  `<select>`, not `CategoryPicker` — and the `FilterBar` filter) use
  different accessible names ("Catégorie" vs "Filtrer par catégorie")
  specifically so `getAllByLabelText`/`getByLabelText` can disambiguate them
  in tests. Keep that distinction if either label is ever reworded.

---

## Fix round 1/5

Review approved the work with one Important finding, on `handleUndo` in
`frontend/src/features/transactions/TransactionsPage.tsx`.

### The finding

Undoing a recategorization issues its own `PATCH /transactions/{id}`, and
`patch_transaction` in `backend/app/api/transactions.py` (lines 105-110) runs
`learn_from_correction` + `apply_learned_rule` on **every** category change —
it has no special case for "this PATCH happens to be an undo." So the undo's
own response can itself carry `backfilled > 0` and a fresh `learned_rule_id`.
The pre-fix `handleUndo` discarded both and unconditionally called
`setNotice(null)`: if undoing a correction silently reclassified a dozen
other transactions, the user was told nothing. Same class of silent side
effect the reviews have been catching throughout this plan, and more
confusing here specifically because the user pressed a button labelled
*Annuler* and it quietly made further changes.

### The fix

`frontend/src/features/transactions/TransactionsPage.tsx`:

- `BackfillNotice` gained an `origin: "correction" | "undo"` field.
- `handleRecategorize`'s notice now carries `origin: "correction"`
  (unchanged behavior, just tagged).
- `handleUndo` now inspects its own PATCH response the same way
  `handleRecategorize` does: if `updated.backfilled > 0`, it calls
  `setNotice` with a new `origin: "undo"` notice carrying that count;
  otherwise it clears the notice as before.
- The render logic branches on `notice.origin`. A `"correction"` notice
  renders exactly as before (the "Règle apprise..." wording, with Annuler
  when `previousCategoryId` is non-null). A new `"undo"` notice renders a
  separate, differently-worded banner: "Annulation effectuée — restaurer la
  catégorie précédente a aussi appris une règle qui a reclassé automatiquement
  N autre(s) transaction(s) similaire(s)." plus a hint that this
  reclassification cannot be undone from this screen. It never renders an
  Annuler button.
- The module doc comment above `TransactionsPage` was extended to explain
  both why the undo's backfill can't reuse the correction wording
  (misattribution — the user pressed Annuler, not Corriger) and why it
  deliberately doesn't chain into its own Annuler.

### On chaining a further Annuler

Considered and rejected. A learned rule is stored **per pattern**, one row,
and `learn_from_correction` overwrites its `category_id` wholesale on every
correction (`backend/app/categorization/learning.py`) — it is not versioned
and there is no history to walk back through. Undoing the undo would flip
that single shared rule's category back again, and that PATCH could itself
backfill and re-announce, for as long as the user keeps clicking. That is an
oscillation with no natural end, not a bounded undo, so chaining is not
honest here in the way the coordinator's message anticipated it might not
be. The `"undo"` notice is deliberately informational-only: no button, and
its hint text says outright that the automatic reclassification cannot be
undone from this screen, so nothing implies an undo is available when it
isn't.

### Covering tests added

All three in `frontend/src/features/transactions/TransactionsPage.test.tsx`,
inserted after the existing "announces the learned rule and lets the user
undo just this transaction" test:

1. `"reports the undo's own backfill instead of silently discarding it"` —
   corrects a transaction (backfilled 4), then undoes it with a mocked PATCH
   response carrying `backfilled: 3, learned_rule_id: 77`; asserts the new
   status banner reads "3 autres transactions similaires" and that it does
   **not** contain an Annuler button.
2. `"clears the notice once the undo itself has nothing further to report"` —
   same setup, undo PATCH returns `backfilled: 0`; asserts the status banner
   disappears, preserving today's behavior for the common case.
3. `"surfaces a failed undo instead of failing silently"` — undo PATCH
   returns a 409 with a French `detail`; asserts that message appears in a
   `role="alert"` element. This was the one untested failure path of the
   five the review referenced (the `catch` block itself was already correct
   pre-fix — only the test was missing).

### Verifying the tests actually catch the bug

Per the coordinator's instruction not to assume, I did this empirically
rather than by inspection: saved the fixed `TransactionsPage.tsx`, checked
out the pre-fix committed version (`git show HEAD:...` from commit
`dec1791`) over it, ran only the new tests against that pre-fix code, then
restored the fix and reran.

Pre-fix result (`npx vitest run src/features/transactions/TransactionsPage.test.tsx`):
**1 failed, 12 passed.** The failure was exactly test 1 (`"reports the
undo's own backfill instead of silently discarding it"` — timed out waiting
for a second `status` banner that the pre-fix code never renders, since it
unconditionally cleared the notice). Tests 2 and 3 passed even pre-fix: test
2 covers behavior that was already correct (the old code always cleared the
notice, which happens to be right when `backfilled` is 0), and test 3
exercises a `catch` block that was never touched by this bug — both are
legitimate regression coverage for already-correct code paths, not proof of
a second bug. Only test 1 is a true red-then-green test for the fix itself.

### Test commands and output

```
cd frontend && npm test
```
17 test files, **124 passed** (was 121 before this fix round; the 3 new
tests account for the difference exactly). `TransactionsPage.test.tsx` now
has 13 tests, all passing, including the 3 new ones.

```
cd frontend && npm run build
```
`tsc -b && vite build` — clean, no type errors, `dist/` produced
(486.15 kB JS, 154.45 kB gzip).

### Deviation documentation point

Added to the "Deviations from the brief" section above (not a code change):
`usePeriod` defaults an unset/invalid `periode` param to `"month"` rather
than the brief sample's `"year"`, and does so through a real `isPreset()`
type guard rather than the brief's unsound `as PeriodPreset` cast. See that
section for the full note.

### Staging and commit

Staged only the two touched files:
`frontend/src/features/transactions/TransactionsPage.tsx` and
`frontend/src/features/transactions/TransactionsPage.test.tsx`. Commit
`9ef6133`: `fix(transactions): surface the undo's own learned-rule backfill`.
