# Task 13 report — Forecast fan chart

Status: **DONE**

## What was implemented

- `frontend/src/charts/ForecastFanChart.tsx` — the P10/P50/P90 confidence
  band for the twelve-month cash-flow projection.
  - `buildForecastOption(months, thresholdCents, tokens)` returns the
    ECharts option, an aria label, and CSV export rows.
  - The band is drawn as two stacked line series: an invisible P10 floor and
    a visible series carrying the band's *height* (`P90 − P10`), not P90
    itself — stacking absolute P90 on top of P10 would draw the band twice
    as tall as the truth.
  - The median (`Solde projeté (médiane)`) is a dashed line, per
    `charts/theme.ts`'s convention that dashes mean "projected".
  - A `markLine` draws the threshold as a solid reference line, labelled with
    its value.
  - A `markPoint` (red pin) calls out the first month with `below_threshold`
    true, using the field the backend computed rather than re-deriving it
    client-side.
  - The tooltip states the median, the P10–P90 range, whether the month's
    estimate is seasonal or pooled, and a breach note — all sourced directly
    from `ForecastMonth`, no re-computation.
  - `months.length === 0` renders a plain French sentence
    ("Aucune projection disponible."), never an empty axis with nothing
    plotted — an axis at zero would read as a claim about the balance, not
    an absence of data. The empty state intentionally does not surface
    `insufficient_reason`: composing that explanation is a page-level
    concern (task 14), not this chart's job.
  - `monthAxisLabel` / `monthLongLabel` format `"2026-09"` as `"sept. 2026"`
    / `"septembre 2026"` via `toLocaleDateString("fr-FR", …)`, the same
    technique `CashflowChart.tsx` already uses (ECharts' own `nameMap: "fr"`
    is a no-op without a registered locale).
- `frontend/src/charts/ForecastFanChart.test.tsx` — 10 tests: band-not-line
  shape, correct stacking arithmetic, threshold markLine presence, aria-label
  content (mentions "projection", "P10", "P90", the first breach month,
  and correctly omits the breach sentence when nothing breaches), CSV export
  columns, and the two component-level states (empty vs. populated).
- `frontend/src/lib/types.ts` — added `ForecastMonth`, `Forecast`,
  `MeasuredRate`, `RunwayScenario`, `Runway`.

## Where the brief disagreed with the shipped code

The brief's proposed `Forecast` and `Runway` TypeScript interfaces were
stale against `backend/app/schemas/cashflow.py` (verified by reading that
file directly, since the brief warned every task from 4 onward had this
problem):

- **`Forecast`** was missing six fields the schema actually returns:
  `ledger_months_observed`, `recurrences_projected`, `pooled_scale_cents`,
  `seasonal_scale_cents`, `projected_from`, `ledger_last_on`.
- **`RunwayScenario`** was missing the `rate: MeasuredRate` sub-object
  entirely (`MeasuredRateOut` in the schema) — the full measured rate a
  scenario's burn was derived from, including its own P10/P90-equivalent
  band (`low_cents`/`high_cents`).
- **`Runway`** invented a single `insufficient_reason: string | null` field
  that does not exist on the shipped schema. The real `RunwayOut` carries
  **two independent fields**, `normal_unavailable_reason` and
  `essentials_unavailable_reason`, because `essentials` is measured over its
  own self-selected set of months and can fail on its own even when `normal`
  succeeds (`backend/app/api/cashflow.py` lines 240–241). `Runway` was also
  missing `ledger_span_months` and `projected_from`.

I implemented the corrected, complete versions in `types.ts` with doc
comments transcribed from the Pydantic schema's own comments, so task 14
(which wires `Runway` into the Trésorerie screen) does not inherit this gap.

The brief's proposed `ForecastFanChart.tsx`/`.test.tsx` content was
otherwise accurate against `ForecastMonthOut` and matched the house pattern
in `CashflowChart.tsx`/`WaterfallChart.tsx` closely enough that I kept its
structure, fixing two real defects found only in the browser (see below).

## Testing

- `frontend/`: `npm test` → **488 passed** (478 pre-existing + 10 new), zero
  failures.
- `npm run build` → zero TypeScript errors.
- `backend/`: `.venv/Scripts/pytest.exe -q` → **452 passed**, unaffected
  (no backend files touched).

## Browser verification (the actual point of this task)

Dev servers: the backend at port 8000 turned out to be an **orphaned worker
from before task 12's router was registered** — `GET /api/cashflow/forecast`
404'd even hit directly against `127.0.0.1:8000`, exactly the trap the task
brief warned about. Killed the stale process (PID 29892) and restarted it
detached via `Start-Process`; confirmed with a direct curl that it then
returned 401 (auth required) rather than 404.

Verified in Chrome via the `design-systeme` dev harness (`/design-systeme`,
already documented in `app/routes.tsx` as "so they can be judged in a
browser instead of in jsdom") logged in as `demo@yieldo-demo.fr`. I
temporarily added two cells to `DesignSystemPage.tsx`: one with a
locally-built 12-month stub (a deliberately widening band, per the engine's
guarantee, with one breached month), and one that called the real
`GET /api/cashflow/forecast` through the app's own authenticated `api`
client. **Reverted that harness file to HEAD before committing** — it was
scratch work outside this task's stated file scope
(`git checkout -- frontend/src/features/design-system/DesignSystemPage.tsx`),
confirmed via `git status` that only the three intended files remain
staged.

Both required states were visible on every screenshot below (the stub cell
and the live-fetch cell share each page):

- **Stub, populated**: the band visibly widens from ~±200 € in month 1 to
  ~±3 000 € by month 12, matching the engine's documented guarantee that
  uncertainty grows with distance and shrinks with more history. Threshold
  line, breach pin, and tooltip (verified separately, see below) all read
  correctly.
- **Real data, refusal**: `GET /api/cashflow/forecast` for the operator's
  actual account returned `months: []` and
  `insufficient_reason: "Pas assez de données pour projeter : il faut au
  moins 6 mois complets de relevés, et l'historique n'en compte que 3.
  Importez des relevés supplémentaires pour obtenir une prévision."` — the
  designed outcome the brief predicted. `ForecastFanChart` correctly
  rendered "Aucune projection disponible." with no axes, no plot, nothing
  implying a zero balance.

Screenshots (`.superpowers/sdd/2026-08-16-yieldo-phase-2a-analyse/shots/`):

- `task13-forecast-1440-light.png` — desktop, light. Band widens cleanly,
  legend swatches match the drawn fill, threshold line and breach pin both
  legible, refusal cell below reads plainly.
- `task13-forecast-1440-dark.png` — same, dark theme. Same layout, teal/red
  tones hold contrast against the dark card surface.
- `task13-forecast-768-light.png` / `-dark.png` — tablet width. Two-column
  bento grid, chart legend and export button coexist without collision,
  band and pin unchanged in shape.
- `task13-forecast-375-light.png` / `-dark.png` — mobile width, single
  column, hamburger nav. Legend, export button and refusal text all remain
  legible with no overlap (see defect #2 below, fixed before these were
  captured).

Also checked (not part of the required matrix, but cheap and caught the
untestable-in-jsdom tooltip path): hovered the stub chart and confirmed the
tooltip renders the month, median, P10–P90 range, the seasonal/pooled note,
and the breach sentence — all correct. No console errors or warnings across
the whole session (`list_console_messages` returned empty).

## Defects found only in the browser, fixed before committing

1. **Legend swatch didn't match the drawn band.** ECharts colors a line
   series' legend swatch from `itemStyle.color`, defaulting to the theme's
   categorical palette (an orange) when unset. The band series only set
   `areaStyle.color`, so its legend entry showed orange while the actual
   fill was pale teal — a real "the key lies about the chart" bug, invisible
   in jsdom since nothing there renders a legend swatch. Fixed by adding
   `itemStyle: { color: tokens.accent }` to that series.
2. **Legend text collided with the export button at 375 px.** This chart's
   two French legend labels ("Intervalle P10–P90", "Solde projeté
   (médiane)") are longer than any other chart's in this app; at 375 px
   their combined width extended under the absolutely-positioned "Exporter"
   button (`Chart.css`'s `.yd-chart__toolbar` sits `position: absolute; top:
   0; right: 0`, unaware of the legend beneath it), covering the tail of the
   second label. Fixed by reserving the button's width in the legend's own
   box (`legend: { right: 84 }`, `grid.top` bumped 40→56 to match) so
   ECharts lays the legend out around the button rather than under it. This
   is exactly the class of defect the phase's own rule exists to catch —
   invisible in a 478→488 green Vitest run, visible in five seconds at
   375 px in a real browser.

## Self-review

- Re-read `ForecastFanChart.tsx` end to end after the two fixes above;
  confirmed `series.data` arrays stay plain `number[]` (never objects) so
  the prescribed unit tests keep asserting on real values, not on styling
  wrappers.
- Checked the `markPoint` breach-pin's text/background color pairing
  (`tokens.surfaceStrong` on `tokens.negative`) by hand against WCAG 2.x,
  since `design/contrast.test.ts` only validates each status token against
  the page background, not against each other: 5.10:1 dark, 6.57:1 light —
  both clear the 4.5:1 AA floor. Documented the reasoning inline so a future
  edit to `surfaceStrong` for unrelated reasons doesn't silently break it.
- Confirmed `git status` is clean of anything beyond the three committed
  files; the pre-existing untracked `backend/tests/test_cashflow_api.py`
  visible in the initial git status turned out to already be tracked
  history from task 12's commits (`2e9a7f4`/`c72581e`) — not left over from
  this session, not touched, not committed here.
- Ran the full frontend and backend suites one final time after all fixes
  and after reverting the temporary harness file: 488 and 452 passing.

## Concerns

- None blocking. `npm run lint` could not be exercised — the project's own
  eslint isn't installed in `node_modules/.bin` in this environment, and
  `npx eslint` pulled a mismatched v10 that doesn't recognize the repo's
  config format. This is a pre-existing environment gap, not something this
  change introduced, and `CLAUDE.md`'s testing section does not list lint as
  a gate (only `npm test` and `npm run build`).
- Task 14 should read `Forecast.insufficient_reason` and surface it near the
  chart (the chart itself deliberately stays silent about *why* it's empty)
  — confirmed this is a deliberate boundary, not an oversight, since the
  brief frames the chart as one component of a screen task 14 assembles.

---

# Task 13 fix round — review findings

Status: **DONE**

Fixes on top of `7b5ba2c`. Files touched: `frontend/src/charts/ForecastFanChart.tsx`
and `frontend/src/charts/ForecastFanChart.test.tsx`. Nothing else.

## Finding 1 (Critical) — the band anchored at zero when P10 went negative

Confirmed against the installed `echarts@5.6.0` before changing anything, and
the reviewer's trace is exactly right:

- `lib/processor/dataStack.js:87` reads `stackStrategy` per series, defaulting
  to `'samesign'`; lines 115–118 only chain a stacked value onto the one below
  it when `sum >= 0 && val > 0` (or both negative). This chart's band series
  carries a *height* (always >= 0) sitting on a *floor* that goes negative the
  moment the projection dips into overdraft — opposite signs, so the chain is
  refused, `sum` stays at the raw height and `stackedOver` stays `NaN`.
- `lib/chart/line/helper.js:109–121` (`getStackedOnPoint`) then falls back to
  `dataCoordInfo.valueStart`, which is 0 whenever the axis spans both signs —
  which is the whole point of a balance chart.

Net effect as described: the right *width*, anchored in the wrong place, which
visually erased the overdraft the P10 estimate exists to warn about.

**Fix:** `stackStrategy: "all"` on both series in the `"confidence"` stack. It
is only load-bearing on the second (nothing sits below the first), but it is
declared on both so the stack group states one strategy; the comment says so
rather than implying the first one does work.

The doc comment on `buildForecastOption` was also wrong by omission — it
explained why the band carries a height without saying that the technique is
only correct with a non-default stack strategy. Corrected.

## Findings 2 and 3 — the legend told a different story than the chart

**Finding 2 (band swatch painted solid).** Traced the mechanism rather than
guessing at it: `LegendModel.js:264–267` defaults the legend's own
`itemStyle.color` and `itemStyle.opacity` to `'inherit'`, and
`LegendView.js:435–441` resolves `'inherit'` off `data.getVisual('style')` —
which for a line series is the series' **`itemStyle`**, never its `areaStyle`,
where this band's real translucency lives. So the previous round's
`itemStyle: { color: tokens.accent }` fixed the hue and left the swatch at full
saturation for what is drawn as an 18 % wash.

**Fix:** `itemStyle: { color: tokens.accent, opacity: 0.18 }`, mirroring
`areaStyle` exactly. Safe on the plot: the series is `symbol: "none"`, so its
`itemStyle` styles nothing that is drawn, and `LineView.js:662` builds the area
from `areaStyle` alone.

**Finding 3 (two swatches near-indistinguishable).** Judged with the whole
chart in view, as asked — and the swatches *can* carry the mark-type
distinction, so they now do. `charts/theme.ts` forces `legend.icon: "roundRect"`
app-wide, which is what flattened both entries into blocks of two teals sitting
~1.32:1 apart. Giving only the median's legend entry `icon: "inherit"` routes it
through `LineSeriesModel.getLegendIcon` (`lib/chart/line/LineSeries.js:68–89`),
which draws the series' actual mark — the dashed stroke plus its round symbol —
while the band keeps the block. `legend.data` therefore became objects rather
than bare strings.

Measured off the live canvas rather than eyeballed (`getImageData` on the
legend strip, composited over the real card background):

| | drawn as | vs card |
|---|---|---|
| Band swatch, dark | `#7ee2d6` at alpha 0.18, 24x14 px block | 1.48:1 |
| Median swatch, dark | `#4dc9ba` at alpha 1.0, 25x10 px line+dot | 9.64:1 |
| Band swatch, light | `#0b6d63` at alpha 0.18, 24x14 px block | 1.17:1 |

The two entries now differ in shape, in size, and by a factor of ~6 in
contrast. Finding 3 is resolved as a consequence of finding 2 plus the icon
change; no separate colour change was needed, which is the outcome the brief
preferred.

**Deliberately not "fixed" further:** the band swatch is faint (1.17:1 light,
1.48:1 dark), below the 3:1 WCAG 1.4.11 floor for a graphical object. That is
not a regression — it is the honest depiction of a band that is itself drawn at
exactly that contrast on exactly that surface. A crisp full-opacity border on
the swatch would make it findable, but it would reintroduce the original defect
in miniature: a key showing an edge the band does not have. Identification is
carried by the label, the mark shape, and the fact that the plot contains
exactly one pale wash. Recorded here so the next reviewer sees it was measured
and decided, not missed. If the phase later wants the band above 3:1, the fix
belongs on `areaStyle.opacity` — on the band itself — and the swatch follows
automatically.

## Covering tests

Three new tests in `ForecastFanChart.test.tsx`, written failing first
(3 failed / 10 passed before the change, 13 passed after):

- *"keeps the band anchored on P10 when P10 is negative"* — asserts both
  `stack: "confidence"` series carry `stackStrategy: "all"`, and asserts the
  fixture actually contains a negative P10 so the test cannot quietly stop
  covering its own premise.
- *"paints the band's legend swatch with the same wash as the band"* — asserts
  `itemStyle.color`/`opacity` equal `areaStyle.color`/`opacity`, so the two can
  never drift apart again.
- *"gives the median's legend entry the series' own mark, not a block"* —
  asserts `icon: "inherit"` on the median entry and its absence on the band's.

These pin the built option; they are explicitly **not** the evidence for
finding 1, since the bug lives downstream in ECharts' own stacking engine. Each
test carries a comment saying so. The screenshots below are the evidence.

## Browser verification — a payload whose P10 actually goes negative

Both dev servers were already up and healthy (8000 → PID 28700, 5173 → PID
20580); no orphaned worker this time.

Temporarily added two cells to `DesignSystemPage.tsx` (`/design-systeme`,
DEV-only route) and **reverted the file to HEAD before committing** —
`git status` confirms only the two chart files are staged. The stub is twelve
months whose median falls 2 500 € → 80 € while the band widens ±300 € → ±4 480 €,
so the **low estimate crosses under zero from month 5 on** — the condition the
original round's stub never reached. Threshold set to 0 € so the reference line
and the zero line coincide and the crossing is unambiguous.

The second cell renders the *same option object with `stackStrategy` stripped*,
so the fixed and broken renderings sit side by side in one frame.

Screenshots (`.superpowers/sdd/2026-08-16-yieldo-phase-2a-analyse/shots/`):

- **`task13-negative-p10-1440-light.png`** and **`task13-negative-p10-1440-dark.png`**
  — the decisive pair. **Left cell (fixed):** the band opens symmetrically
  around the dashed median, its lower edge crosses under the "Seuil 0 €" line
  around janvier 2027 and descends to roughly −4,4 k€ by août 2027; the axis
  runs +6 k€ to −6 k€. **Right cell (ECharts default):** the band's lower edge
  is pinned flat on the zero line for all twelve months and never enters
  negative territory at all, while its top climbs to ~9 k€ — and the median
  line ends up running *below* its own confidence band in the later months,
  which is visibly incoherent. That is the defect, drawn.
- **`task13-negative-p10-768-light.png`**, **`task13-negative-p10-375-dark.png`**
  — the band still crosses below zero, and the legend still clears the
  absolutely-positioned "Exporter" button at both widths. Worth re-checking
  because `legend.data` changed shape and one entry changed icon type; the
  `right: 84` reservation from the previous round still holds (the line+dot
  icon is the same 25 px item width as the block).
- **`task13-legend-1440-light.png`** — the chart element alone, the frame the
  pixel measurements above were taken from.

No console errors or warnings from the app across the session; the single
`list_console_messages` entry is a `willReadFrequently` hint provoked by my own
`getImageData` measurement script, not by application code.

## Commands

- `npx vitest run src/charts/ForecastFanChart.test.tsx` before the fix →
  **3 failed | 10 passed**; after → **13 passed**.
- `npm test` → **491 passed** (488 pre-existing + 3 new), 43 files, zero failures.
- `npm run build` → `built in 6.42s`, zero TypeScript errors. The
  `chunks are larger than 500 kB` notice is pre-existing and unrelated.
- `backend/.venv/Scripts/pytest.exe -q` → **452 passed**, unaffected (no backend
  file touched).
- `npm run lint` still not exercisable — eslint is not installed in this
  environment. Pre-existing gap, left alone per the brief.

## Carry forward — NOT fixed in this round, by instruction

**`frontend/src/charts/WaterfallChart.tsx:80–121` has the same latent defect.**
Its `base` series is `Math.min(start, end)`, which goes negative as soon as the
running balance dips below zero, while `visible` is `Math.abs(step.delta)` and
therefore always positive — the identical invisible-floor / positive-height
pattern under `stack: "waterfall"`, with no `stackStrategy` declared.

Verified this is not merely an analogy from the line case: the bar path is hit
too. `lib/layout/barGrid.js:398–399` computes `stackStartValue = +value −
store.get(valueDimIdx, dataIndex)`, i.e. `stackResult − rawValue`. Under
`samesign` with a negative base the visible series is never chained, so
`stackResult` *is* the raw height and `stackStartValue` collapses to 0 — the bar
is drawn from the zero line instead of from the running balance. Same class of
error, same invisible-in-jsdom character.

Left untouched here as instructed; it is a house pattern rather than a one-off,
so it belongs to the phase's verification pass. Any future chart built on the
invisible-floor technique needs `stackStrategy: "all"` from the start.

Two Minor findings remain deferred to the ledger as directed and were not
touched: the `legend: { right: 84 }` magic number, and the tooltip's
`dataIndex ?? 0` fallback.
