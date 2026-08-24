# Task 23 report — E2E test and documentation

Commit: `ec08f42` — `test(e2e): add onboarding journey and write project documentation`
Fix round 1: commit `6563706` — `fix(import): add missing bank-account creation form`

## What was written

- `e2e/fixtures/releve.csv` — 8-row, two-year French bank statement
  (semicolon-delimited, comma decimals, `dd/mm/yyyy`). Deliberately diverges
  from the plan's literal 7-row fixture: it adds a second `CARREFOUR MARKET
  CB` row so the recategorization step has something to backfill (see
  below).
- `e2e/playwright.config.ts` — as specified in the brief: `baseURL
  http://localhost:8080`, `fr-FR` locale, single serial worker.
- `e2e/package.json` — `yieldo-e2e`, `@playwright/test` only.
- `e2e/tests/onboarding.spec.ts` — two tests: the full onboarding journey
  (register → create account → import → tag columns → dashboard period
  filter → recategorize → learned-rule backfill), and a second test that
  re-imports the same file and confirms nothing new is added.
- `README.md` — French, operator-facing: what Yieldo is/isn't, one-command
  install, update, backup/restore, data location and privacy, CSV shape and
  column tagging, troubleshooting (port, Docker, lost `SECRET_KEY`), an
  explicit "first deploy — what to verify" checklist, and the phase 2-4
  roadmap pulled from `docs/superpowers/specs/2026-08-09-yieldo-design.md`.
- `CLAUDE.md` — English, short bullet contract: cents as integers, pure
  engines, per-user isolation, French/English language split, user-driven
  column tagging, TDD, one commit per task, runtime minimums.

## The brief's draft script did not match the real app — what changed and why

I read `RegisterPage.tsx`, `ImportPage.tsx`, `ColumnTagger.tsx`,
`ImportSummary.tsx`, `PreviewTable.tsx`, `DialectPanel.tsx`,
`useImportWizard.ts`, `TransactionsPage.tsx`, `TransactionRow.tsx`,
`OverviewPage.tsx`, `StatTile.tsx`, `CountUp.tsx`, `PeriodSelector.tsx`,
`usePeriod.ts`, `theme.ts` (formatCents), `AppShell.tsx`, `routes.tsx`,
`RequireAuth.tsx`, `session.ts`, `api.ts`, plus the backend's
`accounts.py`, `schemas/accounts.py`, `security/deps.py`, `auth.py`, and
`categorization/seed.py` (builtin category/rule seeding). Several of the
brief's literal assertions do not exist in the shipped code:

1. **No "create account" UI exists anywhere in phase 1.** Grepped the whole
   frontend for "Nouveau compte" / "Nom du compte" / "Type de compte" — zero
   matches. `ImportPage.tsx`'s `FileStep` only has a `<select>` of *existing*
   accounts (`GET /accounts`); there is no form wired to `POST /accounts`
   anywhere in the UI, even though the backend endpoint
   (`backend/app/api/accounts.py`) is fully implemented. The test creates the
   account by calling `POST /api/accounts` directly with the access token the
   register response returns — exactly what an operator would have to do
   before such a screen exists. This is a real phase-1 gap, not a test
   shortcut; worth flagging for a future task.
2. **Button/text labels differ from the brief.** The mapping step's button is
   "Voir l'aperçu" (not "Importer"); it doubles as the wizard's re-analyze
   trigger. The commit button is "Valider l'import". There is no "7 lignes",
   "X transactions importées" or "X doublons" literal text anywhere —
   `ImportSummary.tsx` renders `<dt>Importables</dt>`/`<dt>Doublons</dt>`
   inside a `<dl>`, and the done-step sentence is built by a `plural()`
   helper that (as written) produces "8 ligne importées", not "8 lignes
   importées" — matched verbatim, not "corrected", since that's what the
   component actually renders.
3. **Dashboard stat tiles are labelled "Entrées"/"Sorties"/"Solde
   net"/"Taux d'épargne", never "Revenus".** The brief's `getByText("Revenus")`
   would never match.
4. **Amounts are read via `getByRole("status", { name: ... })`, not
   `getByLabel`.** `CountUp.tsx` renders `<span role="status"
   aria-label={format(value)}>` — the accessible-name-bearing role, and the
   robust way to read the value without depending on the animated digits.
5. **Period preset controls have `role="tab"`, not `role="button"`**
   (`PeriodSelector.tsx`, `role="tablist"` / `role="tab"`).
6. **Recategorizing "CARREFOUR MARKET" to "Courses" would fire no event at
   all**, because the builtin rule (`categorization/seed.py`, pattern
   `"carrefour"` → category `Courses`) already auto-categorizes it that way
   on import — selecting an already-selected `<option>` dispatches no
   `change` event. The fixture now has a second `CARREFOUR MARKET CB` row,
   and the test corrects the first one to "Restaurants" instead — a genuine
   category change, which the backend's `learn_from_correction` +
   `apply_learned_rule` (`backend/app/categorization/learning.py`) then
   backfills onto the second row (`backfilled = 1`), which is what makes the
   "Règle apprise" banner actually appear.
7. **Two rows both contain "CARREFOUR MARKET" as a substring** (`"CARREFOUR
   MARKET"` and `"CARREFOUR MARKET CB"`), so `getByRole("row", { name:
   /CARREFOUR MARKET/ })` would resolve to two elements and fail Playwright's
   strict mode. The row locator instead filters on the label cell's *exact*
   text (`page.getByText("CARREFOUR MARKET", { exact: true })`).
8. **Session does not persist across the brief's two `test()` blocks by
   default.** Playwright Test gives every `test()` its own browser context,
   so the httpOnly refresh cookie the session lives on would not carry over
   the way the brief's own comment ("Assumes the previous test's session")
   assumed. Fixed by saving `storageState` at the end of the first test and
   loading it into a fresh context for the second — the access token itself
   is never in storageState (it's in-memory JS only, per `api.ts`); loading
   a page with the restored refresh cookie is what lets `RequireAuth`'s
   `hydrate()` trade it for a fresh access token, the same as a real second
   tab.
9. **`formatCents`'s "narrow no-break space" and "NBSP" constants are both
   actually U+202F**, confirmed by reading the codepoints directly (not by
   eyeballing the source). Kept the currency assertions as plain
   ASCII-space strings (`"4 900,00 €"`), relying on Playwright's documented
   whitespace-normalization for text/name matching — this is the standard
   pattern and not something I could execute to confirm.

## What was verified, and how

- **Selectors against real component source**: every locator in
  `onboarding.spec.ts` traces to an exact string, `aria-label` template, or
  `role` in the files listed above — quoted inline in code comments in the
  test itself.
- **TypeScript correctness**: `npm install` in `e2e/` (network was
  available), then `npx tsc --noEmit` against the spec and config files with
  `@playwright/test` + `@types/node` — zero errors. The temporary
  `tsconfig.json`, `node_modules/`, and `package-lock.json` used only for
  this check were deleted afterward; they are not part of the commit.
- **CSV auto-detection heuristics**: cross-checked the fixture's shape
  (`;` delimiter, `,` decimal, `dd/mm/yyyy`, headers `Date`/`Libelle`/
  `Debit`/`Credit`) against `backend/app/importers/dialect.py` and
  `mapping.py`'s regexes — confirms the column-tagger assertions
  (`date`/`label`/`debit`/`credit`) are what the backend would actually
  suggest.
- **Category/rule seeding**: read `backend/app/categorization/seed.py` in
  full to confirm which builtin rules would fire on the fixture's merchant
  names (this is what surfaced finding #6 above).
- **Everything that does not need Docker was actually run, this session**,
  on the current `phase-1-socle` HEAD:
  - `backend/.venv/Scripts/pytest.exe -v --cov=app --cov-report=term-missing`
    → **210 passed**, 95% overall coverage (engines/aggregate.py 93%,
    importers: dedup 100%/dialect 93%/mapping 98%/parser 95%/service 96%).
  - `cd frontend && npm test` → **210 passed** (26 files).
  - `cd frontend && npm run build` → succeeds, zero TypeScript errors (one
    non-blocking Rollup chunk-size advisory, not an error).
  - `bash tests/install/test_find_port.sh` → **14/14 assertions pass**.

## What could not be executed

**Docker is not installed on this machine.** The e2e journey itself has
**never been run**. Nobody has run `docker build`, `docker compose up`, the
container healthcheck, or `alembic upgrade head` inside the image. This is
stated plainly in the README's "Premier déploiement" section, which also
folds in the outstanding first-deploy checks already flagged in
`progress.md` (tasks 21 and 22: the `ss -tuln` port-detection branch, data
directory ownership fix-up, and the full install/update cycle).

## First-deploy checklist (also in README.md, "Premier déploiement")

1. `./install.sh install` ends with `Yieldo est accessible sur
   http://localhost:<port>`; if not, `./install.sh logs`.
2. Container logs show `[yieldo] applying database migrations…` then
   `[yieldo] starting application`, no permission errors on `/app/data`.
3. `data/yieldo.db` is owned by `1000:1000` inside the container — confirms
   the entrypoint's ownership fix-up actually ran.
4. Manual pass: register, create an account via the app, import a CSV,
   confirm the dashboard.
5. `cd e2e && npm install && npx playwright install chromium && npx
   playwright test` passes against the running instance.
6. `./install.sh update` preserves an existing transaction across the
   rebuild.
7. Manual theme (light/dark) and OS-level "reduce motion" pass on every
   screen.

## Files touched

- `E:\Projet\Github\Yieldo\e2e\fixtures\releve.csv`
- `E:\Projet\Github\Yieldo\e2e\playwright.config.ts`
- `E:\Projet\Github\Yieldo\e2e\package.json`
- `E:\Projet\Github\Yieldo\e2e\tests\onboarding.spec.ts`
- `E:\Projet\Github\Yieldo\README.md`
- `E:\Projet\Github\Yieldo\CLAUDE.md`

---

## Fix round 1

Commit: `6563706` — `fix(import): add missing bank-account creation form`

**Blocking gap, confirmed by review, independently of my own report:** no
code anywhere in `frontend/src` ever called `POST /api/accounts`.
`ImportPage`'s `FileStep` only rendered a `<select>` populated from
`GET /accounts`, so a freshly registered user landed on `/import` with an
empty dropdown, a permanently disabled `DropZone`, and no way to enter the
import wizard at all. The backend endpoint has existed since task 12
(`backend/app/api/accounts.py`); no task ever built the UI for it. Phase 1
was not usable end to end until this closed.

### What changed

`frontend/src/features/import/ImportPage.tsx`:
- Added `ACCOUNT_KIND_OPTIONS` — French labels for the backend's
  `ACCOUNT_KINDS` tuple (`backend/app/models/account.py`: `checking`,
  `savings`, `pea`, `life_insurance`, `per`, `brokerage`, `crypto`,
  `real_estate`, `loan`, `cash`), `checking` ("Compte courant") first and
  default.
- Added `NewAccountForm` — name input + kind select + submit, `ApiError`
  caught and rendered in a `role="alert"` exactly like every other form in
  this codebase (`RegisterPage`, `LoginPage`, `DialectPanel`'s profile-save
  row). No new error-handling pattern introduced.
- `FileStep` now branches on `accounts.length`:
  - `0` — renders an inviting message plus `NewAccountForm` directly, in
    place of the (previously always-present, sometimes-unusable) select.
  - `>0` — renders the select as before, plus a "Nouveau compte" toggle
    button that reveals the same form (mirrors `DialectPanel`'s
    "Enregistrer ce profil" toggle — reused pattern, not a new one).
- Added `handleCreateAccount` in `ImportPage`: `POST /accounts`, appends the
  result to the in-memory `accounts` list (no refetch needed), then calls
  `wizard.actions.selectAccount(created.id)` — the new account is usable
  immediately, no second dropdown interaction required.
- `frontend/src/features/import/ImportPage.css`: new rules for the form,
  its field grid, and the toggle button, built from the same tokens
  (`--yd-surface`, `--yd-border`, `--yd-radius-sm`, `--yd-space-*`) every
  other panel in this file already uses. The toggle's "Annuler" state
  reuses `.yd-dialect__cancel`.

### Covering tests

`frontend/src/features/import/ImportPage.test.tsx`, new
`describe("ImportPage — creating a bank account")` block:
- `invites the user to create an account when none exist, instead of a bare
  disabled select`
- `submitting the form POSTs the expected payload and selects the created
  account`
- `shows the backend's French message when account creation fails, and
  keeps the form`

Confirmed red against pre-fix code (`npx vitest run
src/features/import/ImportPage.test.tsx` → 3 failed, 3 passed — the 3
pre-existing tests in that file were unaffected), then green after the
implementation (see commands/output below).

### Commands run and their output

```
$ cd frontend && npm test
 Test Files  26 passed (26)
      Tests  213 passed (213)
```
(210 pre-existing + 3 new; no test files or counts regressed.)

```
$ cd frontend && npm run build
> build
> tsc -b && vite build
✓ 1036 modules transformed.
dist/index.html                  0.39 kB │ gzip:   0.26 kB
dist/assets/index-BiqRyPL6.css   38.17 kB │ gzip:   7.03 kB
dist/assets/index-DmaVmZbz.js  1,547.66 kB │ gzip: 507.17 kB
✓ built in 3.59s
```
Zero TypeScript errors. The chunk-size note is Rollup's pre-existing
advisory (present before this fix too), not an error.

### Documentation fixes

- `e2e/tests/onboarding.spec.ts`: the account-creation step now drives the
  real UI (`Import` link → empty-state copy → fill "Nom du compte" → click
  "Créer" → the select shows the new account already chosen) instead of a
  direct `POST /api/accounts` call. Re-verified with the same transient
  `tsc --noEmit` check used in the original task (installed
  `@playwright/test` + `@types/node`, checked, then deleted the temporary
  `tsconfig.json`/`node_modules`/`package-lock.json` — none of those are
  part of the commit). The journey is still **not executed** — no Docker on
  this machine — and the file's comments still say so.
- `README.md`:
  - First-deploy checklist item 4 (`README.md`, "Premier déploiement")
    rewritten to name both steps explicitly: "inscription (compte
    utilisateur), création d'un compte bancaire depuis l'écran d'import,
    import d'un CSV, et lecture du tableau de bord" — it no longer implies
    a single undifferentiated "account creation" step.
  - Disambiguated every use of "compte": "compte utilisateur" (created at
    `/inscription`) vs. "compte bancaire" (created on `/import`, what a CSV
    imports into) — in the "Ce que Yieldo est" bullet list, the
    installation section, the data-location section, the new "Créer un
    compte bancaire" paragraph opening the CSV/tagging section, the
    duplicate-detection wording, and the checklist. Grepped `compte` across
    the file afterward to confirm no ambiguous instance was missed.
  - Updated the frontend test count in the "Développement" section's
    closing summary (210 → 213).
  - Left the "Docker never built, e2e never run" honesty statements exactly
    as they were — this fix does not change what has and hasn't been
    executed.

### What remains unverified

Same as the original report: Docker is not installed on this machine.
`docker build`, `docker compose up`, the container healthcheck, and the
E2E journey itself (now UI-driven end to end) have still never been run
against a live instance. This fix closes the *code* gap the review found;
it does not change what could be executed in this environment.
