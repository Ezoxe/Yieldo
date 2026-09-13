# Tour du 13 septembre — chantiers A, B, C : Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Fix the eight defects seen on the tour, land the twelve UI/UX
changes and the eight light features of spec
`docs/superpowers/specs/2026-09-13-yieldo-tour-ameliorations-design.md`.

**Architecture:** Front-end fixes stay inside the screen that owns them
(`features/<screen>/`), shared behaviour goes to `design/` or `app/`. Every
new backend figure is a pure function in `engines/` fed by `api/common.py`
helpers and exposed by the screen's router; every new table is an Alembic
migration plus a `tests/test_migrations.py` case when it backfills.

**Tech Stack:** FastAPI, SQLAlchemy 2, Alembic, pytest; React 19, Vite 6,
vitest + Testing Library, ECharts, @tanstack/react-query, zustand.

## Global Constraints

- Amounts are integer cents everywhere; dates ISO in JSON.
- Every business query filters on `user_id`; engines take `today` as a parameter.
- User-facing text French with « » and non-breaking spaces; code and commits English.
- No hex in components; `.yd-num` on figures; status = pill; methodology behind `InfoTip`.
- Icons stroke-only, never icon-only without `aria-label`.
- Screens judged in the browser at 1440 and 390 px, both themes, before "done".
- One commit per task, Conventional Commits, tests green at each commit.
- Frontend: `cd frontend && npm test && npm run build`; backend: `cd backend && ./.venv/Scripts/pytest.exe -q`.

---

## Chantier A — corrections

### Task A1: Plan page points at Réglages

**Files:**
- Modify: `frontend/src/features/plan/PlanPage.tsx:285`
- Test: `frontend/src/features/plan/PlanPage.test.tsx`

- [x] Test: render `PlanPage` (existing render helper in the test file) and assert `screen.getByText(/Le mode se change dans Réglages → Lecture des chiffres/)` exists and `queryByText(/dans l'en-tête/)` is null.
- [x] Run `npx vitest run src/features/plan/PlanPage.test.tsx` → fails.
- [x] Replace the sentence with « Le mode se change dans Réglages → Lecture des chiffres. » keeping the rest of the paragraph.
- [x] Run → passes. Commit `fix(plan): the mode is changed in Réglages, and the screen says so`.

### Task A2: Categories root keeps the shared gap

**Files:**
- Modify: `frontend/src/features/categories/CategoriesPage.css` (add `.yd-categories { display:flex; flex-direction:column; gap: var(--yd-space-lg); }` at top)
- Test: `frontend/src/features/categories/CategoriesPage.test.tsx`

- [x] Test: after render, `document.querySelector(".yd-categories")` has class and `getComputedStyle` is not available in jsdom for CSS files — instead assert the CSS file contains the rule: read `CategoriesPage.css` with `fs.readFileSync` in the test and `expect(css).toMatch(/\.yd-categories\s*\{[^}]*display:\s*flex/)` (pattern used by `design/contrast.test.ts`, which reads `tokens.css` from disk).
- [x] Run → fails. Add the rule. Run → passes. Commit `fix(categories): the screen root is a flex column like every other screen`.

### Task A3: Recurrence calendar reachable at 390 px

**Files:**
- Modify: `frontend/src/features/recurrences/RecurrenceCalendar.tsx:90` (wrap `<table>` in `<div className="yd-rcal-scroll">`)
- Modify: `frontend/src/features/recurrences/DeclaredRecurrences.css:231`
- Test: `frontend/src/features/recurrences/RecurrenceCalendar.test.tsx`

- [x] Test: the table's parent has class `yd-rcal-scroll`; CSS file contains `.yd-rcal-scroll` with `overflow-x: auto` and `.yd-rcal` with `min-width`.
- [x] CSS:
  ```css
  .yd-rcal-scroll { overflow-x: auto; min-width: 0; -webkit-overflow-scrolling: touch; }
  .yd-rcal { width: 100%; min-width: 34rem; border-collapse: collapse; table-layout: fixed; }
  ```
  and `min-width: 0` on the grid cell that holds the calendar (the `1fr auto` grid at `DeclaredRecurrences.css:12`, add `& > * { min-width: 0; }`).
- [x] Verify in browser at 390: the panel scrolls horizontally, `document.documentElement.scrollWidth === 390`. Commit `fix(recurrences): the calendar scrolls inside its panel instead of losing the weekend`.

### Task A4: Feasibility form is labelled and stable

**Files:**
- Modify: `frontend/src/features/feasibility/FeasibilityPage.tsx` (the « Votre achat » form: price, term, contribution inputs)
- Modify: `frontend/src/features/feasibility/FeasibilityPage.css` (form grid `align-items: start`)
- Test: `frontend/src/features/feasibility/FeasibilityPage.test.tsx`

- [x] Test: `screen.getByLabelText("Prix du bien (€)")` and `getByLabelText("Apport déjà disponible (€)")` resolve to inputs; the inputs have no `placeholder`; a hint `Par exemple 40 000,00` is in the document.
- [x] Give each `<label htmlFor>` / `<input id>` pair a `useId()`-based id; move the example into a `<p className="yd-field__hint">` under the input; `align-items: start` on `.yd-feasibility__form-grid` (whatever the grid class is — read the CSS first).
- [x] Commit `fix(feasibility): fields are labelled, examples are hints, and an error no longer stretches its neighbour`.

### Task A5: Treemap breadcrumb names the whole, not the first tile

**Files:**
- Modify: `frontend/src/charts/CategoryTreemap.tsx:199-222`
- Test: `frontend/src/charts/CategoryTreemap.test.tsx` (if absent, create; the chart tests use a mocked `echarts` — see `Chart.test.tsx` for the pattern)

- [x] Test: the option passed to echarts has `series[0].name === "Dépenses"`.
- [x] Add `name: "Dépenses"` to the series. Verify in browser the pill reads « Dépenses » at root. Commit `fix(charts): the treemap breadcrumb names the whole at the root`.

### Task A6: StatTile sparkline never crosses the figure

**Files:**
- Modify: `frontend/src/features/overview/StatTile.css`
- Test: `frontend/src/features/overview/StatTile.test.tsx`

- [x] Read `StatTile.tsx` to find the sparkline element class. Test: CSS file contains a `@media (max-width: 640px)` block that sets the sparkline `position: static` (or `order`) — read from disk as in A2.
- [x] CSS: under 640 px the sparkline becomes a block under the figure: `position: static; height: 28px; margin-top: var(--yd-space-xs);`. Verify at 390. Commit `fix(overview): on a phone the sparkline sits under the figure, not behind it`.

### Task A7: Mobile transaction rows drop the repeated date

**Files:**
- Modify: `frontend/src/features/transactions/TransactionsPage.css` (the row grid; `@media (max-width: 640px)` hides `.yd-tx__date` — read `TransactionRow.tsx` for the actual class)
- Test: `frontend/src/features/transactions/TransactionRow.test.tsx` (CSS-on-disk assertion)

- [x] Hide the date cell under 640 px and let the label column take the space; the group header already carries the date. Verify at 390 the label « CB PIZZERIA DA MARCO » is no longer truncated. Commit `fix(transactions): on a phone the date lives in the day header alone`.

### Task A8: Route-level code splitting and query cache

**Files:**
- Modify: `frontend/src/app/routes.tsx` (every page import → `lazy(() => import(...).then(m => ({ default: m.XPage })))`, `Suspense` fallback = `<PageSkeleton />`)
- Create: `frontend/src/design/PageSkeleton.tsx` (a `PageHead`-shaped skeleton using `Skeleton.css`)
- Modify: `frontend/vite.config.ts` (`build.rollupOptions.output.manualChunks: { echarts: ["echarts"], motion: ["motion"] }`)
- Create: `frontend/src/lib/useApiQuery.ts`:
  ```ts
  import { useQuery } from "@tanstack/react-query";
  import { api } from "./api";
  export function useApiQuery<T>(path: string, params?: Record<string, string|number|boolean|undefined|null>, enabled = true) {
    return useQuery<T, ApiError>({ queryKey: [path, params ?? {}], queryFn: () => api.get<T>(path, params), staleTime: 30_000, enabled });
  }
  ```
- Modify: `OverviewPage.tsx`, `TransactionsPage.tsx`, `BudgetsPage.tsx` — replace their `useEffect + useState` fetch with `useApiQuery`; keep the same loading/error rendering (`isPending`, `error?.detail`). Invalidate with `queryClient.invalidateQueries({ queryKey: [path] })` after a mutation on those screens.
- Test: `frontend/src/lib/useApiQuery.test.ts` (wraps in `QueryClientProvider`, mocks `api.get`, asserts data and that a second mount within 30 s does not refetch); existing page tests keep passing (wrap their render in a `QueryClientProvider` — add a `renderWithQuery` helper to `src/test-utils.tsx` if none exists).

- [x] Measure before: `npm run build` → note `index-*.js` gzip.
- [x] Implement; `npm run build` → initial chunk < 300 kB gzip, echarts in its own chunk. Commit `perf(front): lazy routes, echarts chunk, and a query cache on the three busiest screens`.

## Chantier B — UI/UX

### Task B1: User menu in the header

**Files:**
- Create: `frontend/src/app/UserMenu.tsx` + `UserMenu.css`
- Modify: `frontend/src/app/AppShell.tsx:239` (replace `<span className="yd-shell__user">`)
- Test: `frontend/src/app/UserMenu.test.tsx`

- [x] Test: renders a button with `aria-haspopup="menu"` and the initial « M » for "Maxime"; clicking shows menu items « Réglages », a theme group (Système / Clair / Sombre, radio), « Se déconnecter »; Escape closes; « Se déconnecter » calls `useSession.getState().logout` (read `session.ts` for the real name).
- [x] Implementation: `useTheme()` from `design/useResolvedTheme.ts`/`ThemeProvider` for the theme (read how `SettingsPage` switches it and reuse that setter); menu is a `<div role="menu">` with `role="menuitem"` buttons; focus returns to the trigger on close.
- [x] Verify 1440 and 390. Commit `feat(shell): a user menu in the header, with the theme and the exit`.

### Task B2: Bottom tabs and folded filters on mobile

**Files:**
- Create: `frontend/src/app/BottomTabs.tsx` + `.css` (fixed bottom, `< 768px` only, five entries: `/`, `/transactions`, `/budgets`, `/assistant`, « Plus » → `setDrawerOpen(true)`), icons from `design/icons`, labels visible.
- Modify: `AppShell.tsx` (render `<BottomTabs onMore=… />`; add bottom padding to `.yd-shell__main` under 768 px so content is not hidden)
- Modify: `frontend/src/features/transactions/FilterBar.tsx` (a « Filtres » toggle button under 640 px showing the count of active filters: account ≠ all, uncategorised, transfers; the period selector stays outside the fold)
- Test: `BottomTabs.test.tsx` (five links/buttons, active one has `aria-current="page"`), `FilterBar.test.tsx` (toggle shows/hides the fold and prints « Filtres (2) »).

- [x] Commit `feat(mobile): five tabs at the bottom, and the transaction filters fold away`.

### Task B3: Prose folds behind « Comment c'est calculé »

**Files:**
- Create: `frontend/src/design/Method.tsx` + `Method.css` — `<Method summary="Comment c'est calculé">children</Method>` = `<details className="yd-method">` with the summary styled as a quiet link.
- Modify: `AlertsPage.tsx` (the « Ce qui a été mesuré / Sur quelle période / Ce qui la lèverait » blocks → keep the first line, fold the other two), `ConnectionsPage.tsx` (the per-provider paragraphs « Yieldo ne vous rendra jamais cette clé… » → one `Method` per card; the « Ce qui se passe quand vous enregistrez une clé » panel → `Method`), `PatrimoinePage.tsx` (the « Latente : rien n'a été vendu… » and « Ces parts sont calculées… » notes → `InfoTip`), `FeasibilityPage.tsx` (the three « Ce qui reste chaque mois… » explanations → `InfoTip` on the tile title).
- Test: `Method.test.tsx` (closed by default, opens on click, summary text).

- [x] Commit `feat(ui): the method folds away, the figure stays`.

### Task B4: Short actions with full accessible names

**Files:**
- Modify: `features/recurrences/DeclaredRecurrences.tsx` (« Modifier Loyer » → `<button aria-label="Modifier Loyer"><EditIcon /> Modifier</button>`), `features/goals/GoalsPage.tsx`, `features/debts/DebtsPage.tsx`, `features/portfolio/PatrimoinePage.tsx` (positions / lots / accounts).
- Tests: existing tests query by accessible name (`getByRole("button", { name: "Modifier Loyer" })`) — they keep passing; add one assertion per screen that the visible text is « Modifier ».

- [x] Commit `feat(ui): list actions read short and are named in full`.

### Task B5: Deleting an import is quiet and confirmed

**Files:**
- Modify: `features/import/ImportPage.tsx` (previous imports list) + `ImportPage.css`
- Test: `ImportPage.test.tsx`: first click shows « Supprimer boursorama-2026-08.csv et ses 40 opérations ? » with « Confirmer » / « Annuler »; only « Confirmer » calls `api.delete`.

- [x] Commit `feat(import): deleting a batch is a tertiary action that asks first`.

### Task B6: Half-empty panels

**Files:**
- Modify: `features/overview/RecentTransactions.tsx` (10 rows; the request `limit` too), `features/budgets/BudgetsPage.tsx` (spending list under the donut inside the same panel), `features/settings/SettingsPage.tsx` (`LedgerModeControl` inside the Apparence panel as a first row « Lecture des chiffres »).
- Tests: `RecentTransactions.test.tsx` (10 rows), `SettingsPage.test.tsx` (the control is inside the Apparence panel).

- [x] Commit `feat(ui): panels are filled or merged, not stretched`.

### Task B7: Analysis drops the period selector

**Files:**
- Modify: `features/analysis/AnalysisPage.tsx` (remove `PeriodSelector`, `usePeriod` and the banner « Aucune période imposée »); each panel already names its window.
- Test: `AnalysisPage.test.tsx` — no `Trimestre` button; no banner.

- [x] Commit `fix(analysis): no selector for a period the panels do not read`.

### Task B8: Cashflow forecast title counts its months

**Files:**
- Modify: `features/cashflow/CashflowPage.tsx` (`Prévision sur ${n} mois`, `n = forecast.points.length`; singular « un mois » when 1).
- Test: with a 6-point fixture the head reads « Prévision sur 6 mois ».

- [x] Commit `fix(cashflow): the forecast title counts the months it shows`.

### Task B9: Every screen has a skeleton

**Files:**
- Audit `features/*/…Page.tsx` for `Skeleton` usage; add a content-shaped skeleton to the ones without (Overview, Transactions, Goals, Recurrences, Plan, Patrimoine, Projection, Categories, Settings, Proposals, Import).
- Tests: each page test gains « shows a skeleton while loading » (render with a never-resolving `api.get`, assert `document.querySelector(".yd-skeleton")`).

- [x] Commit `feat(ui): every screen loads into a skeleton of itself`.

### Task B10: Patrimoine declaration folds per account

**Files:**
- Modify: `features/portfolio/PatrimoinePage.tsx` (each investment account block becomes `<details className="yd-account-fold" open={accounts.length === 1}>` with the account name, kind and position count in the summary).
- Test: with two accounts both are closed; with one it is open.

- [x] Commit `feat(portfolio): one fold per account under « Déclarer »`.

### Task B11: Login and register carry the brand

**Files:**
- Modify: `features/auth/LoginPage.tsx`, `RegisterPage.tsx` (+ shared CSS): `<YieldoMark /> Yieldo` above the card, `<Link to="/">Accueil</Link>` under it.
- Test: both pages render the link « Accueil » to `/`.

- [x] Commit `feat(auth): the sign-in card says whose door it is`.

## Chantier C — light features

### Task C1: Net worth

**Files:**
- Create: `backend/app/engines/networth.py`
  ```python
  @dataclass(frozen=True)
  class NetWorth:
      assets_cents: int; debts_cents: int; net_cents: int
      breakdown: tuple[tuple[str, int], ...]  # ("positions", …), ("declared", …), ("cash", …), ("debts", -…)
  def measure_net_worth(positions_cents: int, declared_cents: int, cash_cents: int, debts_remaining_cents: int) -> NetWorth
  ```
- Create: `backend/app/models/net_worth_snapshot.py` (`NetWorthSnapshot`: user_id, taken_on unique with user, assets_cents, debts_cents, breakdown JSON) + migration `net_worth_snapshots`.
- Modify: `backend/app/api/portfolio.py` — `GET /portfolio/networth` → `{today: NetWorthOut, history: [ {taken_on, assets_cents, debts_cents, net_cents} ]}`; writes today's snapshot on read (pattern: `api/engagement.py` for `HealthSnapshot`). Debts: sum of `Debt.remaining_cents` (read `models/debt.py` for the real column) over active debts.
- Schemas: `schemas/portfolio.py` `NetWorthOut`, `NetWorthHistoryPoint`.
- Tests: `tests/test_networth.py` (engine: net = assets − debts; breakdown order; zero debts), `tests/test_portfolio_networth_api.py` (401 without auth; snapshot written once per day; history ordered).
- Front: `features/portfolio/NetWorthPanel.tsx` + `charts/NetWorthChart.tsx` (area, one point per snapshot, `formatCompactCents` axis); `PatrimoinePage` shows it first. Types in `lib/types.ts`. Mock route in `dev/mockApi.ts`.

- [x] Commit `feat(portfolio): net worth, assets minus debts, with a snapshot a day`.

### Task C2: Alerts visible everywhere

**Files:**
- Modify: `backend/app/api/alerts.py` — `GET /alerts/count` → `{count: int}` (same evaluation as the report, count of raised alerts).
- Create: `frontend/src/features/alerts/useAlertCount.ts` (zustand, pattern of `features/agent/useProposalCount.ts`).
- Modify: `AppShell.tsx` badges: `{"/alertes": alertCount, "/propositions": proposalCount}`; badge text « n en cours » for alerts (the `en attente` suffix is per-route).
- Create: `frontend/src/features/overview/WhatChangedPanel.tsx` — raised alerts (title, figure, link `/alertes`) and « Dernier import il y a N jours » (needs C7's `GET /imports/last`; until then reads `GET /imports` first row `created_at` — that route exists).
- Tests: backend `test_alerts_api.py` count matches report; front `WhatChangedPanel.test.tsx`, `AppShell.test.tsx` badge.

- [x] Commit `feat(alerts): a count in the sidebar and a panel of what changed`.

### Task C3: A detection becomes a declaration, or is dismissed

**Files:**
- Backend: model `RecurrenceDismissal(user_id, label_key, created_at)` + migration; `api/common.recurrence_points` excludes dismissed keys; `POST /recurrences/dismiss {label_key}`, `DELETE /recurrences/dismiss/{id}`, `GET /recurrences/dismissed`.
- Front: `RecurrenceRow.tsx` gains « Déclarer » (navigates to the declaration form with state `{label, amount_cents, periodicity, next_due_on, category_id}` — `DeclarationForm` accepts `initial`) and « Ce n'est pas un abonnement » (calls dismiss, row disappears, toast-less: the list re-renders). Settings: « Détections écartées » list with « Rétablir ».
- Tests: backend `test_recurrences_api.py` (dismissed key absent from detection, restored after delete); front `RecurrenceRow.test.tsx`, `DeclarationForm.test.tsx` (initial values).

- [x] Commit `feat(recurrences): declare a detection in one click, or say it is not one`.

### Task C4: Budgets — comparable totals, inline ceiling, six-month history

**Files:**
- Backend: `api/budgets.py` report gains `budgeted_spent_cents`; `GET /budgets/history?months=6` → per budgeted category `[ {month, spent_cents, budget_cents} ]` (uses `rolled_budget_spend` per month).
- Front: `BudgetsPage.tsx` header line « Budgété · Dépensé sur ces lignes »; ceiling becomes an inline editable field (click the amount → input → Enter/blur PATCH `/categories/{id}` `{monthly_budget_cents}`); `BudgetSparkline` (tiny bars, six months) per row.
- Tests: backend `test_budgets_api.py` (totals, history months); front `BudgetsPage.test.tsx` (inline edit sends the PATCH).

- [x] Commit `feat(budgets): comparable totals, a ceiling edited in place, six months per line`.

### Task C5: Embedded INSEE index

**Files:**
- Create: `backend/app/data/ipc_insee.csv` (header comment: source « INSEE, indice des prix à la consommation, ensemble des ménages, base 100 en 2015, série 001759970 », last month), columns `month;index`.
- Backend: `POST /analysis/price-index/insee` copies the file into the user's series (same shape as `PUT /analysis/price-index`); response says the last month.
- Front: `AnalysisPage.tsx` button « Utiliser l'indice INSEE embarqué (jusqu'à AAAA-MM) ».
- Tests: `test_analysis_api.py` (series copied, last month returned; file parses, months contiguous).

- [x] Commit `feat(analysis): the INSEE index ships with Yieldo`.

### Task C6: A goal can point at an account

**Files:**
- Backend: `Goal.account_id` nullable FK, unique `(user_id, account_id)` where not null → migration; `api/goals.py`: when set, `saved_cents` is computed (`opening_balance_cents + sum(amount_cents)`), PATCH of `saved_cents` refused with « Ce montant est mesuré sur le compte … »; `GoalOut.measured: bool`.
- Front: `GoalsPage.tsx` form gains « Compte d'épargne (facultatif) » select; card shows badge « mesuré ».
- Tests: `test_goals_api.py` (measured saved, refusal, uniqueness 409), front form test.

- [x] Commit `feat(goals): a goal backed by an account is measured, not declared`.

### Task C7: OFX, QIF, a global import button, the last import

**Files:**
- Create: `backend/app/importers/ofx.py` (`parse_ofx(text) -> list[ParsedRow]` — SGML and XML OFX, `<STMTTRN>` blocks: `DTPOSTED`, `TRNAMT`, `NAME`/`MEMO`, `FITID`), `backend/app/importers/qif.py` (`parse_qif(text)`: `D`, `T`, `P`/`M`, `^`), both pure, both reusing the `ParsedRow` shape of `importers/parser.py` (read it first).
- Modify: `importers/service.py` and `api/imports.py`: on upload, extension `.ofx`/`.qif` → parse directly, batch gets `mapping_confirmed=True`, wizard step « Colonnes » skipped.
- Modify: `api/imports.py` `GET /imports/last` → `{imported_at, file_name, rows_imported}` or 204.
- Front: header « Importer » button (`ImportIcon`, link `/import`; on mobile inside Plus drawer — already in the nav); `ImportPage` accepts `.ofx,.qif`; `WhatChangedPanel` reads `/imports/last`.
- Tests: `tests/test_ofx.py`, `tests/test_qif.py` (fixtures under `tests/fixtures/`), `test_import_api.py` (OFX upload lands rows without a mapping step).

- [x] Commit `feat(import): OFX and QIF, an import button in the header, and the age of the last import`.

### Task C8: CSV export of the ledger

**Files:**
- Backend: `GET /transactions/export.csv` (same query params as the list; `StreamingResponse`, `text/csv; charset=utf-8`, BOM, `;`, columns Date;Libellé;Montant;Catégorie;Compte;Notes; amount as `-12,34`).
- Front: « Exporter CSV » button in `TransactionsPage` head (anchor with `download`, carries the current filters).
- Tests: `test_transactions_api.py` (BOM, header, one row, filter respected).

- [x] Commit `feat(transactions): the ledger exports as CSV with the filters on screen`.

## Self-review

Spec coverage: A1–A8 → Tasks A1–A8; B1–B11 → Tasks B1–B11 (B12 = A8);
C1–C8 → Tasks C1–C8; harness fixes (goals `due_on`, projection months) are
folded into A8's `mockApi` typing. Names used across tasks: `useApiQuery`
(A8, reused by C-tasks' new screens), `Method` (B3), `useAlertCount` (C2),
`GET /imports/last` (C7, consumed by C2's panel with the interim fallback).
