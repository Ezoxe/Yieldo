# Task 18 report — Assistant d'import en quatre étapes avec taggage des colonnes

**Commit:** `8aa6f3441df4d86b4ccc6638be13288241c44748` — `feat(import): add
four-step wizard with explicit user-driven column tagging` (single commit,
`frontend/` staged only; `docs/superpowers/plans/` untouched — nothing was
pending there when this task started).

## What was implemented

- `frontend/src/features/import/useImportWizard.ts` — the state machine:
  `step: "file" | "mapping" | "preview" | "done"`, `file`, `accountId`,
  `dialect`, `mapping`, `preview`, `overrides`, `keepDuplicates`, `errors`,
  `isBusy`, plus `isPreviewStale` and `canCommit` (both required by the
  brief's own tests though absent from its prose "Produces" list) and
  `profiles`/`batch` (needed for `DialectPanel`'s profile picker and the
  post-commit report, not tested).
  - `validateMapping` copied from the brief's Step 4 snippet verbatim — it is
    a line-for-line mirror of `backend/app/importers/mapping.py`'s
    `validate_mapping` (same three failure messages, same "assigned more
    than once" check via `SINGLE_USE_ROLES`).
  - `actions.selectFile` refuses (sets an error, no request) if no account is
    selected yet; otherwise uploads via `api.upload("/imports/analyze",
    form)`, applies `suggested_mapping`, and only then moves `step` to
    `"mapping"`. A rejected upload (400/413/...) sets `errors` from the
    `ApiError.detail` and leaves `step` on `"file"`.
  - `actions.setRole` updates `mapping`, recomputes `errors` via
    `validateMapping`, and sets `isPreviewStale = true` — it does **not**
    call the backend. This is what makes the careful point #3 in the task
    context ("retagging must require re-analysis before commit") actually
    enforceable: `canCommit` is `false` whenever `isPreviewStale` is true,
    regardless of whether the new mapping happens to be valid.
  - `actions.reanalyze` re-uploads the file with the current `mapping` and
    `dialect`, refreshes `preview`, clears `isPreviewStale`, and — this is a
    deviation, see below — advances `step` to `"preview"` once the mapping
    validates.
  - `actions.commit` sends `upload_token`, `account_id`, `original_filename`,
    `dialect`, `mapping`, `overrides`, `keep_duplicates` to
    `POST /imports/commit`, stores the returned `ImportBatch`, and moves to
    `"done"`.
  - Async actions read current state through a `useRef` snapshot updated on
    every render, not through their own closures, so a call started right
    after a synchronous setter (e.g. `selectAccount(1)` then immediately
    `selectFile(file)`, as every hook test does) always observes the update.
- `frontend/src/features/import/ColumnTagger.tsx` — implemented per the
  brief's Step 3 snippet almost verbatim (converted the Tailwind utility
  classes to a dedicated `ImportPage.css` stylesheet using `tokens.css`
  custom properties, to stay consistent with every other screen in this
  codebase, none of which use Tailwind utility classes directly in JSX).
  One `<select>` per column, `aria-label` exactly
  `Rôle de la colonne "dateOp"` (falls back to `Rôle de la colonne 1` for a
  blank header), preselected but always enabled, sample rows shown
  underneath, mapping errors in a `role="alert"` list.
- `frontend/src/features/import/DropZone.tsx` — `role="button"`,
  `aria-label="Déposez votre fichier CSV"` verbatim, opens the file picker on
  click and on Enter/Space, animated hover/drag state via a CSS transition on
  `[data-over]` (uses `--yd-motion-*` tokens, which `tokens.css` already
  zeroes under `prefers-reduced-motion: reduce` — no JS-driven animation
  needed here). Client-side extension check against `.csv/.txt/.tsv`
  (mirrors the backend's `ALLOWED_SUFFIXES`) shows an inline `role="alert"`
  immediately, without a round trip; the backend's own 400 is still what
  actually blocks anything it would somehow miss.
- `frontend/src/features/import/DialectPanel.tsx` — encoding, delimiter,
  decimal separator, date format, and preamble-row count, each editable;
  every change calls `onFieldChange` (wired to `actions.setDialectField`,
  which re-analyzes and clears `isPreviewStale` on success). "Enregistrer ce
  profil" opens a name field and calls `actions.saveProfile`; a dropdown
  (shown once `profiles` is non-empty) calls `actions.applyProfile`.
- `frontend/src/features/import/PreviewTable.tsx` — one row per
  `PreviewRow`. Categorized rows show a colour dot (`category.color`, a
  per-category value from the backend, not a design-system colour — left as
  the data value it is rather than routed through a `tokens.css` variable)
  and an origin badge (`Règle` for both `builtin` and `rule` — see Deviation
  1 below —, `Apprise`, `CSV`, `Manuelle`, `Non catégorisée`), plus a
  category `<select>` feeding `overrideCategory`. Duplicate rows get
  `opacity` via `[data-duplicate]` and an "Importer quand même" checkbox
  feeding `toggleKeepDuplicate`. **Failed rows are rendered as their own
  full-width `role="alert"` line reading `Ligne N ignorée : <message>`** —
  not folded into the summary count — per the task context's explicit
  instruction that the error list is the only way a user discovers a wrong
  date format.
- `frontend/src/features/import/ImportSummary.tsx` — pre-commit banner
  (période, entrées, sorties via `CountUp`/`formatCents`, importable,
  duplicates, failed, plus the backend's own `mapping_errors` list if
  non-empty) and, once `batch` exists, a post-commit report sentence and an
  "Annuler cet import" button wired to `actions.cancelImport`
  (`DELETE /imports/{id}`, then `reset()`).
- `frontend/src/features/import/ImportPage.tsx` — assembles the four steps
  behind an animated breadcrumb (`motion.span` scale-pulse on the active
  step, skipped under `prefers-reduced-motion`) and `fadeInUp` transitions
  (`AnimatePresence mode="wait"`, `initial={reducedMotion ? false :
  "hidden"}`). Fetches `GET /accounts` and `GET /categories` once on mount
  (kept out of `useImportWizard` itself — see Deviation 2) and calls
  `actions.loadProfiles()` the same way.
- `frontend/src/app/routes.tsx` — `/import` now renders `<ImportPage />`
  instead of the task-17 placeholder.
- `frontend/src/lib/types.ts` — replaced `ImportPreview.summary`'s untyped
  `Record<string, unknown>` with a proper `ImportSummary` interface (`total,
  importable, duplicates, failed, date_from, date_to, inflow_cents,
  outflow_cents, mapping_errors`), matching the backend's `summary` dict
  shape built in `backend/app/importers/service.py`. Nothing else referenced
  the old untyped field (confirmed via a repo-wide grep before changing it).

## Test commands and output

Before writing any implementation (only the two test files existed):

```
$ cd frontend && npm test
 ❯ src/features/import/useImportWizard.test.ts (0 test)
 ❯ src/features/import/ColumnTagger.test.tsx (0 test)
   Error: Failed to resolve import "./ColumnTagger" ...
   Error: Failed to resolve import "./useImportWizard" ...
 Test Files  2 failed | 9 passed (11)
      Tests  66 passed (66)
```
Confirmed failing as expected (missing modules) before implementation began.

After implementation:

```
$ cd frontend && npx vitest run src/features/import
 ✓ src/features/import/useImportWizard.test.ts (6 tests)
 ✓ src/features/import/ColumnTagger.test.tsx (7 tests)
 Test Files  2 passed (2)
      Tests  13 passed (13)
```

```
$ cd frontend && npm test
 ✓ src/lib/api.test.ts (8 tests)
 ✓ src/features/auth/session.test.ts (1 test)
 ✓ src/design/theme.test.ts (11 tests)
 ✓ src/design/contrast.test.ts (21 tests)
 ✓ src/features/import/useImportWizard.test.ts (6 tests)
 ✓ src/design/glass/GlassCard.test.tsx (6 tests)
 ✓ src/design/CountUp.test.tsx (2 tests)
 ✓ src/features/settings/SettingsPage.test.tsx (4 tests)
 ✓ src/features/import/ColumnTagger.test.tsx (7 tests)
 ✓ src/app/AppShell.test.tsx (10 tests)
 ✓ src/features/auth/LoginPage.test.tsx (3 tests)
 Test Files  11 passed (11)
      Tests  79 passed (79)
```

```
$ cd frontend && npm run build
> tsc -b && vite build
✓ 462 modules transformed.
✓ built in 1.75s
```

Both `npm test` and `npm run build` exit 0. Suite grew from 66 tests / 9
files to 79 tests / 11 files (+13, exactly the two new test files; the
brief's own "Expected: 43 tests PASS" in Step 6 predates tasks that landed
after this brief was written and does not reflect the actual baseline — the
task context's own note of "66 tests across 9 files" was the correct
pre-existing count, confirmed by running it before touching anything).

`npm run lint` was attempted but this checkout has no `eslint` installed
(`'eslint' n'est pas reconnu...`) — pre-existing (also noted in the task-17
report), not introduced or fixed here.

## Deviations from the brief, and why

1. **`category_source: "builtin"` maps to the same "Règle" badge as
   `"rule"`.** The brief's `PreviewTable` spec only lists four badges
   (`règle`, `apprise`, `CSV`, `manuelle`), but the task context explicitly
   flags that live rows can carry `"builtin"` too, and
   `backend/app/models/transaction.py`'s own comment says outright:
   `"builtin" and "rule" both mean "matched a rule"; "builtin" additionally
   says the rule shipped with Yieldo rather than being written by the
   user`. Since that distinction has no user-facing meaning in an import
   preview, both map to the same "Règle" chip rather than leaving `builtin`
   rows with an undefined/blank badge.
2. **Accounts and categories are fetched by `ImportPage`, not inside
   `useImportWizard`.** The brief's "Consumes" list includes `GET
   /api/accounts` and `GET /api/categories`, but folding them into the hook
   would mean an automatic fetch on every mount — which would silently
   insert extra `fetch` calls ahead of the ones
   `useImportWizard.test.ts` asserts on by array index
   (`fetchMock.mock.calls[1]` is expected to be the commit call in the
   "sends overrides and forced duplicates" test). Fetching them from
   `ImportPage`'s own `useEffect` keeps the hook's network surface limited to
   exactly what the brief's tests exercise, while still wiring both
   endpoints into the real screen.
3. **Added `actions.backToMapping`, `actions.cancelImport`, and
   `actions.loadProfiles`**, none named in the brief's action list
   (`selectFile, selectAccount, setRole, setDialectField, applyProfile,
   saveProfile, reanalyze, overrideCategory, toggleKeepDuplicate, commit,
   reset`). None of them are exercised by the two test files, so they carry
   no test risk. They exist because the brief's own component specs need
   them to be usable end to end: `PreviewStep` needs a way back to
   `"mapping"` without restarting the wizard; `ImportSummary`'s spec
   explicitly requires a working "Annuler cet import" button, which only
   makes sense wired to the backend's `DELETE /imports/{id}` rollback
   endpoint; and `DialectPanel`'s profile dropdown needs the saved list
   loaded from somewhere (`GET /imports/profiles`, deliberately *not*
   auto-fetched inside the hook itself for the same call-order reason as
   point 2).
4. **`reanalyze()` advances `step` from `"mapping"` to `"preview"` once the
   mapping validates.** The brief types `step` as four values but its own
   action list has no explicit "go to the next screen" action, and no test
   ever asserts `step === "preview"`. Read literally, the only remaining
   action that could plausibly own that transition is `reanalyze` — its
   French name in the UI ("Voir l'aperçu") is exactly what a user clicks
   once satisfied with their tagging, and the freshly-recomputed, non-stale
   `preview` it returns is what the review screen is for. This also fits the
   task's central instruction: retagging alone (`setRole`) never advances
   anything and never silently trusts a mapping the user hasn't reconfirmed;
   only an explicit, successful re-analysis does.

None of these deviations touch `tokens.css`; `src/design/contrast.test.ts`
is unaffected and still green (21/21).

## Notes for later tasks

- `frontend/src/lib/types.ts` now exports `ImportSummary` (the typed shape
  of `PreviewOut.summary`/`build_preview`'s `preview.summary` dict). Any
  later task reading `ImportPreview.summary` should use this instead of
  re-deriving field names from the backend.
- `useImportWizard`'s `batch` field and `actions.cancelImport` exist for the
  post-commit screen; if a later task builds a dedicated "import history"
  page (listing past batches via `GET /imports`, already implemented
  backend-side as `list_batches`), it is a separate concern from this
  wizard and was intentionally not folded in here.
- `ColumnTagger`'s French role labels come from `ROLE_LABELS` in
  `lib/types.ts` (task 17). If a role is ever added to `COLUMN_ROLES`
  without a matching backend addition to `backend/app/importers/mapping.py`,
  `validateMapping`'s "unknown role" case in the backend won't have a
  frontend mirror (the client-side `validateMapping` here only checks
  *missing*/duplicate roles, not unknown ones, since the `<select>` can only
  ever emit a value from `COLUMN_ROLES` in the first place).
- `PreviewTable`'s per-row category `<select>` only supports picking an
  existing category (`overrideCategory(rowNumber, categoryId)`); there is no
  "clear override / go back to auto-categorization" control. Not required by
  this task's tests or brief, but worth flagging if a later task's UX review
  wants one.
- `ImportPage.css` introduces the `yd-import__*`, `yd-dropzone__*`,
  `yd-dialect__*`, `yd-tagger__*`, `yd-preview__*`, and `yd-summary__*` class
  families, all built from existing `tokens.css` custom properties (no new
  tokens added). Reused by all six components in this feature via a shared
  stylesheet import, following the same per-feature-CSS-file convention as
  `AuthPage.css` and `SettingsPage.css`.

---

# Fix round 1 of 5

**Commit:** `bb6bc38b41b18587b3c55f003a9fdb6b430e3200` (short: `bb6bc38`) —
`fix(import): surface commit/cancel failures and enforce the stale-preview
guard in commit()` (single commit, `frontend/` staged only).

Review found one Critical and one Important issue. Both fixed; no other
scope touched.

## Critical — commit/cancel failures were swallowed on the two screens that write to the ledger

**Root cause confirmed as described.** `PreviewStep` and `DoneStep` in
`frontend/src/features/import/ImportPage.tsx` both destructured `wizard`
without pulling out `errors`. `useImportWizard`'s `commit()` and
`cancelImport()` both already called `setErrors([messageFor(err)])` on
failure (they always had — this was never missing from the hook), but
nothing in either step's JSX read that state, so a 410 (expired upload
token), a 422 (mapping rejected server-side), a 404 (account or batch gone),
or a network failure produced no visible change at all beyond the button
re-enabling. `FileStep` and `MappingStep` (via `ColumnTagger`'s own `errors`
prop) already rendered this correctly — the two money-committing screens
were the ones missing it.

**Fix:**
- Added a small shared `ErrorAlert({ errors })` component in
  `ImportPage.tsx` — `role="alert"`, one `<li>` per message, renders nothing
  when `errors` is empty. `FileStep`'s previous inline copy of this same
  markup was replaced with a call to it (behavior unchanged, one fewer
  duplicate).
- `PreviewStep` now destructures `errors` and renders `<ErrorAlert
  errors={errors} />` between `PreviewTable` and the action buttons. Since
  `commit()`'s catch block only calls `setErrors` — it never touches `step`,
  `overrides`, or `keepDuplicates` — the user was already structurally left
  on the preview step with their overrides and duplicate choices intact;
  the only thing missing was the message itself now being visible.
- `DoneStep` now destructures `errors` and renders the same `<ErrorAlert
  errors={errors} />` above the "Importer un autre fichier" button, so a
  failed `cancelImport()` (batch already gone, network error) is visible
  instead of leaving the user wondering whether the cancel worked.
- No special-casing was added for status 410 specifically: the backend's
  own `detail` text for that case (`"Le fichier téléversé a expiré.
  Recommencez l'import."`, from `backend/app/api/imports.py`'s `commit`
  endpoint) already states plainly that the upload expired and that the
  import must be restarted. Rendering it verbatim — as every other error in
  this codebase does — satisfies the requirement without substituting any
  wording of my own.

## Important — `commit()` re-validated nothing but `preview`/`dialect`/`accountId`

**Root cause confirmed as described.** `commit()` in
`frontend/src/features/import/useImportWizard.ts` guarded only against
`!current.preview`, `!current.dialect`, and `current.accountId === null`.
`isPreviewStale` and `errors.length === 0` — the two conditions `canCommit`
already checks — were not re-checked inside the action itself, so the
invariant "never send a mapping to the backend that differs from the one
the on-screen preview was computed under" existed only as the `disabled`
attribute on the "Valider l'import" button. Calling `actions.commit()`
directly (as a test now does, and as any future caller bypassing the
button could) would have gone straight to the network with a stale
mapping.

**Fix:**
- Added `errors: string[]` and `isPreviewStale: boolean` to the
  `WizardSnapshot` ref (the same ref-backed-snapshot mechanism every other
  action already reads current state through, to avoid the stale-closure
  problem `useCallback(..., [])` would otherwise cause).
- `commit()` now checks `current.isPreviewStale || current.errors.length >
  0` immediately after the existing precondition checks. On a hit, it calls
  `setErrors([...])` with a clear French message ("L'aperçu ne correspond
  plus au tagging actuel : relancez l'analyse avant de valider l'import.")
  and returns *before* touching `fetch` — no request is issued, and the
  failure is visible via the same `ErrorAlert` the Critical fix above wired
  up on `PreviewStep`.
- This message is original wording, not a backend message, because no
  backend round trip happens in this branch — there is no server `detail`
  to surface. This mirrors how `validateMapping`'s own messages are already
  client-authored (they mirror the backend's wording where a matching
  server-side rule exists, but this specific guard is purely client-side
  state consistency with no server equivalent).

## Covering tests

`frontend/src/features/import/ImportPage.test.tsx` (new file — the review
correctly noted `ImportPage.tsx` had no tests at all before this round):
- `"shows the backend's message on the preview step when commit fails, and
  keeps the user there"` — mocks `POST /imports/commit` to reject 422,
  drives the UI through account → file → mapping → "Voir l'aperçu" →
  preview, clicks "Valider l'import", asserts the alert contains the
  mocked `detail` and that "Valider l'import" and the absence of "Import
  terminé" prove the step did not change.
- `"tells the user plainly that their upload expired when commit returns
  410"` — same flow, mocks the exact backend 410 detail text
  (`"Le fichier téléversé a expiré. Recommencez l'import."`), asserts the
  alert's text matches `/expiré/` as well as containing the full sentence.
- `"shows the backend's message on the done step when cancelImport
  fails"` — drives through to a successful commit (step `"done"`), mocks
  `DELETE /imports/{id}` to reject 404, clicks "Annuler cet import",
  asserts the alert shows the mocked `detail` and that "Import terminé" is
  still on screen (the wizard was not silently reset).

`frontend/src/features/import/useImportWizard.test.ts` (new case added to
the existing file):
- `"refuses to commit a stale preview even when commit() is called
  directly"` — after a successful `selectFile`, calls `setRole(2, "debit")`
  (a retag that keeps the mapping valid — `errors` stays `[]` — but marks
  `isPreviewStale = true`), records `fetchMock.mock.calls.length`, calls
  `actions.commit()` directly (bypassing any button/`disabled` state),
  then asserts the call count is unchanged (no request was issued), `step`
  is not `"done"`, and `errors.length > 0`.

**Verified all four fail against the pre-fix code before trusting them** —
ran `npx vitest run src/features/import` against the code as the review
found it:

```
$ cd frontend && npx vitest run src/features/import
 ❯ src/features/import/ImportPage.test.tsx (3 tests | 3 failed)
   × shows the backend's message on the preview step when commit fails, and keeps the user there
   × tells the user plainly that their upload expired when commit returns 410
   × shows the backend's message on the done step when cancelImport fails
 ❯ src/features/import/useImportWizard.test.ts (7 tests | 1 failed)
   × refuses to commit a stale preview even when commit() is called directly
     AssertionError: expected 2 to be 1 // Object.is equality
 Test Files  2 failed | 1 passed (3)
      Tests  4 failed | 13 passed (17)
```

The three `ImportPage` failures were `TestingLibraryElementError: Unable to
find role="alert"` timeouts (exactly the reported bug: no alert ever
appears). The hook test failed because `commit()` issued a second `fetch`
call it should have refused to make. All four failed for the reason the
review described, not for an unrelated setup mistake — confirmed before
writing the fix.

After the fix:

```
$ cd frontend && npx vitest run src/features/import
 ✓ src/features/import/useImportWizard.test.ts (7 tests)
 ✓ src/features/import/ColumnTagger.test.tsx (7 tests)
 ✓ src/features/import/ImportPage.test.tsx (3 tests)
 Test Files  3 passed (3)
      Tests  17 passed (17)
```

```
$ cd frontend && npm test
 ✓ src/design/contrast.test.ts (21 tests)
 ✓ src/lib/api.test.ts (8 tests)
 ✓ src/design/theme.test.ts (11 tests)
 ✓ src/features/auth/session.test.ts (1 test)
 ✓ src/features/import/useImportWizard.test.ts (7 tests)
 ✓ src/design/glass/GlassCard.test.tsx (6 tests)
 ✓ src/design/CountUp.test.tsx (2 tests)
 ✓ src/features/import/ColumnTagger.test.tsx (7 tests)
 ✓ src/features/settings/SettingsPage.test.tsx (4 tests)
 ✓ src/app/AppShell.test.tsx (10 tests)
 ✓ src/features/import/ImportPage.test.tsx (3 tests)
 ✓ src/features/auth/LoginPage.test.tsx (3 tests)
 Test Files  12 passed (12)
      Tests  83 passed (83)
```

```
$ cd frontend && npm run build
> tsc -b && vite build
✓ 462 modules transformed.
✓ built in 1.47s
```

Both `npm test` and `npm run build` exit 0. Suite grew from 79 tests / 11
files to 83 tests / 12 files (+4: 3 in the new `ImportPage.test.tsx`, +1 in
`useImportWizard.test.ts`).

## Other places checked for the same class of bug

Went looking for other spots where an error might be set but never rendered,
since the review noted this exact pattern once already slipped through:

- `MappingStep`'s `onFieldChange`/`onSaveProfile` handlers (wrapping
  `setDialectField`/`saveProfile`) already surface their failures — both
  actions write into the same `errors` state `commit()` does, and
  `MappingStep` passes `errors` into `<ColumnTagger errors={errors} />`,
  which has rendered its own alert since the original task-18 pass.
  Confirmed by reading, not just assumed.
- `ImportPage`'s own mount-time `GET /accounts` / `GET /categories` failure
  path (`loadError` state) already renders its own `role="alert"` paragraph,
  unrelated to `wizard.errors`. Unaffected by this round.
- `actions.loadProfiles()`'s failure path (appends to `errors` via
  `setErrors((current) => [...current, messageFor(err)])`) is only ever
  reachable while the user is still on `FileStep` in practice (it's fired
  from the same mount effect as the accounts/categories fetch), which
  already renders `errors`. No fix needed.
- The other early-return guards inside `useImportWizard.ts`
  (`reanalyze`/`setDialectField`/`saveProfile` all `return` silently if
  `!current.file` or `!current.dialect`) were deliberately left alone: unlike
  `commit()`, these guard against states that are structurally unreachable
  through the shipped UI — the controls that call them do not render until
  a file/dialect already exist — so, unlike the two issues above, there is
  no user action that can currently trigger them. Flagging this explicitly
  rather than silently leaving it out of scope, per the coordinator's
  instruction to say so if another swallowed error turned up; this one
  did not rise to the same bar as `commit()`, which is reachable directly
  (as the new test proves) and writes financial data.

No deviation from the original task-18 report's scope beyond what the review
requested. `docs/superpowers/plans/` was not touched.
