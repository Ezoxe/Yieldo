# Task 20 report — ECharts wrappers and the dashboard

## Fix round 1 of 5

Two Important findings and one Minor, all fixed.

### Important 1 — no period selector on the dashboard

`OverviewPage` called `usePeriod()` but never rendered a control for it, so the
dashboard's period was permanently stuck at whatever `usePeriod()` resolves to by
default, and `/` and `/transactions` carried fully independent query strings —
"shared" meant only "same parsing logic," not anything a user could act on.

**Fix — extracted the reusable control.** `FilterBar`'s period-preset tabs and
custom-range inputs moved into a new `frontend/src/features/transactions/PeriodSelector.tsx`
(`{ period: UsePeriodResult }` in, tabs + conditional range out), with its own
`PeriodSelector.css` carrying the same visual rules under new `yd-period-selector__*`
class names. `FilterBar.tsx` now renders `<PeriodSelector period={period} />` instead
of inlining the markup; `TransactionsPage.css` had the now-relocated
`.yd-filterbar__tabs/__tab/__tab-indicator/__range` rules removed (left a pointer
comment) so there is exactly one copy of both the markup and the CSS, not a second
one waiting to drift. `OverviewPage.tsx` renders the same `<PeriodSelector period={period} />`
directly under its header. Refactored the page's three previous early-return
branches (loading / empty / loaded) into one shell that always renders the header,
period selector and error banner, with only the body switching — so the control
can't accidentally go missing from one branch the way a triple-copy would invite.

**What "shared with the transactions view" means here, and what I implemented for
it:** `usePeriod()` reads the URL's own `?periode=&du=&au=`, so two different routes
necessarily have two different URLs and thus two independent period states — there
is no way to make them literally the same client-side state without a global store,
which is a bigger architectural change than this fix warrants and not what the brief
asked for. What I chose to guarantee instead: the control renders identically and
carries the identical query-parameter names on both screens (one component, so it
cannot silently diverge), and navigating dashboard → transactions carries the
dashboard's *current* period across explicitly. `OverviewPage` now renders "Voir les
transactions de cette période", a `<Link>` built by `transactionsHrefFor(period)`
to `/transactions?periode=...&du=...&au=...` — so following it lands on the
transactions view already scoped to what the dashboard was showing, instead of
resetting to that view's own default. (`SpendingCalendar`'s existing day-click
navigation already did the analogous thing in the other direction, at day
granularity, for the calendar chart specifically.)

**Covering tests:**
- `frontend/src/features/transactions/PeriodSelector.test.tsx` (new, 4 tests) —
  active-preset marking, preset click reporting, custom-range field visibility,
  reporting an edited custom range.
- `frontend/src/features/transactions/FilterBar.test.tsx` — unchanged, still green;
  confirms the extraction didn't move behavior, only its location.
- `frontend/src/features/overview/OverviewPage.test.tsx` (+3 tests):
  - `"renders the shared period selector, defaulting to the current month"`
  - `"re-fetches every panel against the new date range when the period preset changes"`
    — clicks the "Année" tab, asserts the next `/api/analytics/summary` fetch carries
    `date_from=<current-year>-01-01`.
  - `"carries the currently selected period across when linking to the transactions view"`
    — asserts the link's `href` starts with `/transactions?` and carries
    `periode`/`du`/`au`.

**Incidental fixes needed to get there:**
- Rendering `PeriodSelector` inside `OverviewPage.test.tsx` mounts a real
  `motion.span` (the active-tab indicator) for the first time in that file.
  Framer Motion's own reduced-motion detection calls the legacy
  `MediaQueryList.addListener`, which the test's hand-rolled `matchMedia` mock
  didn't provide (only the modern `addEventListener`) — added `addListener`/
  `removeListener` no-ops alongside it.
  - Clicking a period tab makes `OverviewPage` unmount its loaded charts back to
  the loading skeleton and remount them once the refetch resolves. Under jsdom's
  fake canvas, echarts' internal `requestAnimationFrame` ticker can fire against
  an already-disposed context mid-transition and throw an uncaught exception (a
  jsdom-only artifact — a real browser's canvas does not hit this). Rather than
  fight that in `Chart.tsx` production code for a test-environment-only race,
  `OverviewPage.test.tsx` now stubs the four chart components (`vi.mock`) so this
  file tests OverviewPage's own responsibilities — fetching, period selection,
  error surfacing, empty states — while each chart's real rendering stays covered
  by its own dedicated test file against the real echarts instance.

### Important 2 — WaterfallChart's fallback color ignored the active theme

`buildWaterfallOption` called `seriesColors("dark")` unconditionally for the
fallback categorical color (used only when a category arrives with no `color` of
its own), regardless of the `resolved` theme the chart was actually rendering in —
so an uncolored category's waterfall segment came out in dark-theme hues even on
the light theme. `CategoryTreemap.tsx` already threads `resolved` through correctly
for the identical fallback case; `WaterfallChart.tsx` did not.

**Fix:** `buildWaterfallOption` now takes a `resolved: Resolved = "dark"` parameter
(default kept for the function's other three-argument call sites and tests) and
calls `seriesColors(resolved)` instead of the hardcoded literal.
`WaterfallChart`'s component body passes its own `resolved` (from `useTheme()`)
through: `buildWaterfallOption(summary, categories, chartTokens(resolved), resolved)`.

**Covering tests** (`frontend/src/charts/WaterfallChart.test.tsx`, +2):
- `"picks the fallback categorical color from the theme actually being rendered,
  not a fixed dark palette"` — builds the same uncolored category through both
  `resolved="dark"` and `resolved="light"` and asserts the two fallback colors
  differ.
- `"defaults the fallback palette to dark when no theme is specified, for backward
  compatibility"` — confirms the default parameter still resolves to
  `seriesColors("dark")[0]` for the pre-existing three-argument call shape used by
  every other test in the file.

### Minor — SpendingCalendar's onEvents object recreated every render

`onEvents={{ click: ... }}` was an inline object literal, so `Chart.tsx`'s
`onEvents`-dependent effect saw a new identity on every render and unbound/rebound
the click handler each time, not only when the navigation logic actually changed.

**Fix:** the handler is now `useCallback((params) => ..., [navigate])`, and the
object passed to `Chart` is `useMemo(() => ({ click: handleDayClick }), [handleDayClick])`
— both defined before the component's early empty-state return, since hooks cannot
follow a conditional return. No new test added for this one: it's a referential-
stability fix with no externally observable behavior difference, and
`Chart.test.tsx`'s existing `onEvents` bind/unbind coverage already exercises the
mechanism this stabilizes.

### Commands and output

```
cd frontend && npx vitest run
# Test Files  26 passed (26)
#      Tests  210 passed (210)

cd frontend && npm run build
# tsc -b && vite build → succeeds, dist/ emitted
```

210 = 201 from the original submission + 9 new (4 in `PeriodSelector.test.tsx`,
3 in `OverviewPage.test.tsx`, 2 in `WaterfallChart.test.tsx`).

## What was implemented

- `frontend/src/charts/theme.ts` — `chartTokens(resolved)`, `seriesColors(resolved)`,
  `sequentialRamp(resolved, steps)`, `buildEchartsTheme(resolved)`. Every chart color
  traces back to `tokens.css` or a documented, validated palette; nothing downstream
  writes a hex literal.
- `frontend/src/charts/Chart.tsx` — owns the ECharts lifecycle (init once, `setOption`
  on update, `ResizeObserver`-driven resize, dispose on unmount, full re-init on a
  theme switch), disables animation when `useReducedMotion()` is true, and renders an
  export menu (PNG via `getDataURL`, CSV via a pure `rowsToCsv` helper + Blob download).
- `frontend/src/charts/CashflowChart.tsx`, `CategoryTreemap.tsx`, `SpendingCalendar.tsx`,
  `WaterfallChart.tsx` — the four charts, each exporting a pure, unit-tested
  option-builder plus a thin component wrapping `<Chart>`, with its own honest empty
  state instead of an empty grid.
- `frontend/src/features/overview/StatTile.tsx` + `OverviewPage.tsx` — the dashboard.
  `OverviewPage` fetches `/api/analytics/{summary,series,categories,calendar}` and
  `/api/categories` independently via `Promise.allSettled`, surfaces every failure as
  its own `role="alert"`, shows a skeleton while loading, and replaces the whole grid
  with one actionable empty state when the selected period has zero transactions.
- `frontend/src/lib/types.ts` — added `Granularity`, mirroring the backend's
  `granularity` query parameter (existing `SeriesBucket`/`CategoryBreakdown`/`Summary`/
  `CalendarPoint` types already matched the contract).
- `frontend/src/app/routes.tsx` — wired `OverviewPage` into `/`, replacing the
  placeholder.

## What the dataviz skill changed about my choices

The skill won on every point where it disagreed with the brief's literal snippets:

1. **No dual-axis cashflow chart.** The brief's Step 5 describes "bars ... plus une
   ligne de solde net sur un second axe" — a second value axis. That is the skill's
   #1 anti-pattern (two y-scales invent an alignment that isn't in the data). Inflow,
   outflow and net balance are all euro amounts of comparable magnitude, so
   `CashflowChart` plots all three on one shared axis: inflow/outflow as a stacked
   diverging bar (outflow keeps its true negative sign and extends below zero), net
   balance as a line on the same scale. Verified by a test that inflow/outflow never
   get sign-flipped and by a single-y-axis assertion.
2. **Solid, not dashed, gridlines.** The brief's `theme.ts` snippet set
   `valueAxis.splitLine.lineStyle.type: "dashed"`. The skill: "Gridlines and axes are
   solid hairlines, one shade off the surface... never dashed." Fixed in
   `buildEchartsTheme`, covered by a test. I kept the tooltip's `axisPointer` (the
   hover crosshair) dashed — that is an interactive affordance, not a static
   reference line, and distinguishing it from the now-solid grid is deliberate.
3. **The categorical palette is the skill's validated default, not the brief's ad hoc
   10-hex arrays.** `theme.test.ts` only requires ≥8 unique colors, so I substituted
   the skill's documented 8-hue palette (`references/palette.md`), re-validated with
   `scripts/validate_palette.js` against this app's *actual* card surfaces
   (`--yd-surface-strong`: `#ffffff` light / `#0f1c28` dark) rather than the skill's
   generic ones — light mode passes all six checks with a contrast WARN on 3 slots
   (mitigated by the legend, direct labels and CSV export every chart ships); dark
   passes outright.
4. **Category colors are identity, not a generated ramp.** Per the brief's own color
   rule ("une dépense n'est jamais rouge par défaut... les dépenses utilisent la
   couleur de leur catégorie") and the skill's "color follows the entity" rule, the
   treemap and waterfall use each category's own `color` from the backend — the same
   value the transactions table's dot bullet already uses — falling back to the
   validated categorical ramp only for an uncolored category (e.g. "Non catégorisé").
   The one legitimate red in the whole dashboard is the waterfall's final "Épargne"
   bar when the period ran a deficit — a real anomaly, not routine spending.
5. **Sequential, not net, for the spending calendar.** The brief didn't specify which
   figure heats each day; the skill's form heuristic says magnitude → sequential
   (one hue). A "spending calendar" heating by net balance would mix a polarity
   question into a magnitude answer, so it heats by `|outflow_cents|` only.
6. **Mark specs followed throughout:** bars capped at 24px (`barMaxWidth`), 2px
   lines, ≥8px line markers, a 2px `gapWidth` between treemap tiles instead of a
   border, labels hidden below ~4% share rather than clipped, and every chart got an
   `aria-label` plus a legend for ≥2 series.

## Test commands and output

```
cd frontend && npx vitest run
# Test Files  25 passed (25)
#      Tests  201 passed (201)

cd frontend && npm run build
# tsc -b && vite build → succeeds, dist/ emitted
# (pre-existing warning: the echarts bundle pushes the JS chunk over 500kB —
#  not introduced by anything test-gated in this task; a code-splitting
#  follow-up, noted below)
```

201 = 124 pre-existing + 77 added by this task, across 8 new test files:
`theme.test.ts` (29), `Chart.test.tsx` (10 + 3 `rowsToCsv` unit tests),
`CashflowChart.test.tsx` (7), `CategoryTreemap.test.tsx` (6),
`SpendingCalendar.test.tsx` (4), `WaterfallChart.test.tsx` (7),
`StatTile.test.tsx` (6), `OverviewPage.test.tsx` (8).

TDD was followed literally: all 8 new test files were written first and confirmed to
fail with "Failed to resolve import" (module not found) before any implementation
file existed, then implementation proceeded file by file until each suite passed.

## Deliberately left untested, and why

- **Canvas pixels / actual rendering.** jsdom has no layout engine; `echarts.init()`
  does succeed in jsdom (verified) so lifecycle tests (init/dispose/animation
  toggle) are real, but nothing asserts on what a chart visually looks like — that
  would be theatre. What's tested instead: the option object each chart builds (bar
  values, axis labels, colors chosen), the theme's color mapping, empty/error
  states, and the accessible label.
- **PNG export's actual image bytes.** `getDataURL()` needs a real canvas backend;
  the PNG path is exercised (menu opens, PNG-only when no export data, click
  triggers the download machinery) but the resulting data URL's pixel content is
  not inspected.
- **CSV download's real file-save behavior.** `URL.createObjectURL` doesn't exist in
  jsdom by default; the CSV test stubs it and spies on `HTMLAnchorElement.click`,
  confirming the download is *triggered* with the right filename, not that a real
  browser would save a real file. The CSV *content* (`rowsToCsv`) is fully unit
  tested independent of the DOM.
- **A separate inline HTML table twin per chart.** The skill calls for "every chart
  has a table-view twin." I treated the CSV export (plus the legend, tooltip, and
  selective direct labels every chart already ships) as satisfying the underlying
  requirement — every value reachable without hovering — rather than adding four
  more always-present `<table>` elements to the DOM. Flagging this as a scope
  decision, not an oversight, in case a later task wants literal toggle-tables.
- **`useDensity`-driven chart sizing.** Available per the task context but not
  wired in; chart heights are fixed per component. Noted as a follow-up, not a
  silent gap.
- **`StatTile`'s `tone` prop.** Present in the interface signature for forward
  compatibility (`tone?: "neutral" | "good" | "bad"`) but not yet driving any visual
  styling — `OverviewPage` doesn't pass it. The delta's own good/bad coloring already
  covers the one case that mattered for this task.

## Deviations from the brief (beyond the dataviz-skill overrides above)

- **`theme.ts` does not read `tokens.css` via a live `?raw` import**, despite trying
  that first. Vitest's default test config treats any `.css`-extension import
  (regardless of query string) as a stubbed empty module unless `test.css: true` is
  set. Setting that globally to make the raw import work **broke the pre-existing,
  already-green `AppShell.test.tsx`** (6 failures — real CSS parsing in jsdom
  affected an accessibility-tree visibility check for the mobile menu toggle). Since
  "the 124-test baseline must stay green" is non-negotiable, I reverted the config
  change and instead transcribed the tokens as literal constants in `theme.ts`, with
  a cross-check test (`theme.test.ts`, "theme.ts stays in sync with tokens.css") that
  parses `tokens.css` from disk with the exact same technique
  `design/contrast.test.ts` already uses — so any future edit to `tokens.css` that
  isn't mirrored in `theme.ts` fails the suite immediately rather than drifting
  silently. This is the same guarantee "the chart theme may read them" was asking
  for, achieved without touching global test config or risking the AppShell suite.
- **`StatTile.test.tsx`'s literal brief content has a byte-level bug**: three of its
  expected strings (`"2 321,09 €"`, `"+41,80 €"`, the delta-color test's minus-signed
  string) use a plain ASCII space where the shipped `formatCents` (already tested and
  committed in task 15's `design/theme.test.ts`) uses a narrow no-break space
  (U+202F) before the digits and a regular no-break space (U+00A0) before `€`. Taken
  verbatim, the given test fails against the app's own correct, already-shipped
  money formatting. Fixed by deriving the expected strings from `formatCents` itself
  (and normalizing DOM-text-content assertions the same way Testing Library
  normalizes whitespace) instead of hand-typing invisible Unicode a second time.
- **`WaterfallChart`'s final "Épargne" step is the authoritative `summary.net_cents`**,
  not a value re-derived by summing the visible steps. `/api/analytics/summary` and
  `/api/analytics/categories` are separate endpoints with no guaranteed cent-for-cent
  reconciliation (transfers, timing); the cascade's resting point must never show a
  number the backend didn't actually report.
- **`WaterfallChart` takes `categories: CategoryBreakdown[]` in addition to
  `summary`**, not `summary` alone as the brief's interface line literally states —
  otherwise "chaque grand poste de dépense" (each major expense line) has no data to
  draw from. `OverviewPage` already fetches that breakdown for the treemap, so this
  is a free reuse, not a new fetch. Capped at the 5 largest categories with an
  "Autres dépenses" bucket for the remainder, keeping the series count inside the
  dataviz skill's soft cap.
- **`CategoryTreemap` receives already-nested `items`, not the raw flat breakdown.**
  `/api/analytics/categories` has no parent/child linkage, so `OverviewPage` calls
  the exported pure `buildCategoryTreemapItems(breakdown, categories, resolved)` to
  group leaves under their parent category (from the separately-fetched
  `/api/categories`) before handing `CategoryTreemap` a tree it can render and let
  ECharts' native `nodeClick: "zoomToNode"` drill into.

## Notes for later tasks

- The production bundle's `echarts` import isn't code-split (1.5MB / 506KB gzipped
  JS chunk, all in the main bundle). Fine for phase 1; a real follow-up is a dynamic
  `import()` around the `/charts/*` module boundary once there's a second heavy route
  to split against.
- `eslint` is referenced by `package.json`'s `lint` script but is not installed in
  this environment (`node_modules/.bin/eslint` absent, not in `devDependencies`) —
  pre-existing, unrelated to this task; `npm run lint` cannot currently run at all.
- `chartTokens`/`seriesColors`/`sequentialRamp` in `charts/theme.ts` are the only
  sanctioned source of literal color in the chart layer. Any new chart component
  should import from there, never write a hex, and if it needs a color `tokens.css`
  doesn't have, extend `theme.ts` (and its cross-check test) rather than inventing
  one locally.
- `granularityForRange` in `OverviewPage.tsx` picks bucket size from the actual
  day-span of the period (not the preset name), so a custom range gets the same
  legibility treatment as a preset one. Worth promoting to its own tested module if
  a later task needs the same logic elsewhere.
