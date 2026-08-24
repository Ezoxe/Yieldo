# Task 19 — whole-phase verification pass

**Branch:** `phase-2-analyse-decision`, from `4b1dbeb`
**Commits:** `475d78b` (chart geometry), `fe03b8f` (contrast), plus this report
**Suites:** backend **522 passed**; frontend **622 passed** (590 at the start of
this task, +32 written here); `npm run build` (`tsc -b && vite build`) at **zero
TypeScript errors**
**Fixture:** untouched — 1 import batch, 198 rows read / 197 imported / 1
duplicate / 0 failed, 1 account. Verified through `/api/imports` at the end of
the pass, against the same backend PID (32728) that served every measurement.

Everything below was measured or reproduced. Where a number appears it came off
a rendered screenshot, a decoded pixel, or a timed request — never from reading
the source and reasoning about what it ought to do.

---

## Part A — the three defects left for this pass

### A1 · The waterfall collapsed to zero wherever the running balance dipped negative

**Fixed** in `475d78b`. This one was live on the operator's dashboard.

`WaterfallChart` draws each bar as an invisible "support" series carrying the
bar's floor plus a visible series carrying its height. ECharts' default
`stackStrategy: "samesign"` (`processor/dataStack.js:84,115-118`) only chains a
stacked value onto the one below it when both share a sign. The height is always
`>= 0`; the floor goes negative the moment the cascade crosses zero. Opposite
signs, so the chain is refused, the stack result is left equal to the raw
height, and `layout/barGrid.js:398-399` computes
`stackStartValue = stackResult - rawValue` = **0**. The bar is then drawn
upward from the baseline: right height, wrong anchor.

On the operator's own data (`GET /api/analytics/summary` over the whole ledger:
inflow 1 021 999 c, net −220 963 c) the cascade is

| step | floor | height |
|---|---|---|
| Revenus | 0 | +1 021 999 |
| Loyer … Courses | positive throughout | — |
| **Autres dépenses** | **−220 963** | 336 004 |
| **Épargne** | **−220 963** | 220 963 |

— so the last two bars hit the defect. A year that ended **2 209,63 € in the
red** was drawn as a bar rising above zero, in the same visual direction as the
+10 220 € income bar, with the negative half of the y-axis (−2 000, −4 000)
drawn and entirely unused.

| | |
|---|---|
| before | `shots/task19-cascade-avant-1440-sombre.png` — "Autres dépenses" and "Épargne" both rise from the 0 line; nothing descends |
| after | `shots/task19-cascade-apres-1440-sombre.png` — "Autres dépenses" spans −2 210 → +1 150 crossing zero, "Épargne" hangs from −2 210 up to 0 |

Also visible in the full-page shots `task19-accueil-1440-clair.png`,
`task19-accueil-1440-sombre.png` and `task19-accueil-375-sombre.png`.

**Covering tests** (`frontend/src/charts/WaterfallChart.test.tsx`, both written
red first):
- *"carries the true floor of each bar, including the ones below zero"* — pins
  `support.data` as `[0, -200000, -200000]`. Passed before the fix: the floor
  arithmetic was already right, only the strategy was missing. Kept, because it
  is what makes the second test meaningful.
- *"keeps every bar anchored on its own floor when the running balance goes
  negative"* — pins `stackStrategy: "all"` on both stacked series, **and**
  asserts the fixture's own support data actually goes negative, so a later edit
  cannot make the test pass by making the cascade positive.

### A2 · The forecast fan clipped its last x-axis label at 1440

**Fixed** in `475d78b`.

Reproduced by stubbing a twelve-month forecast through a navigation init script
(the operator's real data makes the endpoint refuse, so the chart never mounts
on his ledger). At 1440 the last label rendered as **"janv. 20"** —
`shots/task19-fan-avant-1440-sombre.png`.

Cause, as the ledger said: `boundaryGap: false` puts the first and last ticks
exactly *on* the grid's edges, so a label centred on the last tick overflows to
the right by half its own width, and `grid.right: 8` leaves nowhere for it to
go. `containLabel: true` does not rescue it — `coord/cartesian/Grid.js:150`
subtracts only the label's **height** for a horizontal axis, never its width.

Three fixes were weighed:

| candidate | verdict |
|---|---|
| widen `grid.right` | a magic number tuned to one label at one font size — the very thing task 13 flagged about `legend.right: 84` |
| `axisLabel.alignMaxLabel: "right"` (exists in echarts 5.6, `AxisBuilder.js:527,539`) | rejected: it aligns the last **visible** label, and `coord/axisTickLabelBuilder.js:327` shows `showMaxLabel` is off by default, so at 768 and 375 where ECharts thins the extreme tick away it would nudge a non-edge label off its own tick — trading a 1440 clip for a narrow-width misalignment |
| **take the category default `boundaryGap`** | chosen: insets every tick by half a band, so no label can overflow at any width; it is also what the two sibling charts (`CashflowChart`, `WaterfallChart`) already do |

After: `shots/task19-fan-apres-1440-sombre.png` and
`shots/task19-tresorerie-peuple-1440-sombre.png` — "janv. 2027" renders in full,
"Seuil 0 €" is intact, and the band still descends through zero (task 13's
`stackStrategy: "all"` still holding). Cost is a half-band gutter at each end.

**Covering test** (`ForecastFanChart.test.tsx`): *"insets the extreme category
ticks so the last month's label cannot overflow the grid"* — asserts
`xAxis.boundaryGap !== false`, with the ECharts source references in the
comment.

### A3 · The phase-wide WCAG 1.4.11 / 1.4.3 pass

**Fixed** in `fe03b8f`. Method: for each item, take a real screenshot, decode
the PNG, read the composited pixel, compute the WCAG 2.x ratio. Not one number
below is derived from a token value — `design/contrast.test.ts` parses
`tokens.css` and cannot see a composite, which is exactly why every one of these
survived eighteen reviews.

| item | before | after | verdict |
|---|---|---|---|
| Theme `<select>` border vs its own fill | **1.55:1** dark / **1.30:1** light | **4.28:1** / **3.91:1** | fixed |
| …same border vs the header behind it | 1.74:1 / 1.26:1 | 4.80:1 / 3.80:1 | fixed |
| Réglages animation switch, OFF: track vs card | **1.57:1** | **5.25:1** | fixed |
| …and its knob vs the track | **1.53:1** | **4.28:1** | fixed |
| Login alert text on its own tint (dark) | **3.61:1** | **5.16:1** | fixed |
| Login alert text on its own tint (light) | 4.92:1 | unchanged | already passing |
| Treemap label on `#4fd6a8` (Courses) | **1.80:1** | **10.89:1** | fixed |
| Treemap label on `#8ab4f8` (Loyer) | **2.11:1** | **9.80:1** | fixed |
| Treemap label on `#fb7185` (Équipement) | **2.69:1** | **7.68:1** | fixed |
| Treemap label on `#64748b` (Non catégorisé) | 4.63:1 | unchanged (white still wins) | already passing |
| Cashflow legend: Entrées vs Solde net swatch | 1.11:1 dark / 1.37:1 light | now differ by **shape** | fixed |
| Cashflow **plot**: Solde net line over an Entrées bar | 1.11:1 | unchanged | **left — see below** |
| Fan chart band swatch | 1.17:1 / 1.48:1 | unchanged | **left — ruled by task 13** |
| `--yd-border-strong` on transparent-backed **buttons** | ~1.5:1 dark / 1.6:1 light | 5.04:1 / 3.96:1 | **fixed in the addendum** — this row read "on cards and panels … out of scope" and the scope claim was wrong |
| `--yd-border-strong` on cards, panels, banners and popups | ~1.5:1 | unchanged | left — container edges, see the addendum |

Three new tokens, all mirrored where the house requires it:

- `--yd-border-control` (`#63929d` dark / `#6f838d` light) — solid, not
  translucent, so the ratio cannot drift with whichever surface a control lands
  on. Applied to exactly the fifteen `input` / `select` / `textarea` rules and
  to the switch track.
- `--yd-negative-text` (`#f08c94` dark, `#b3232d` light) — swapped in only in
  the eleven rules that *also* paint themselves with a negative tint. Rules that
  put negative text on a plain card were left alone: there the colour already
  clears AA.
- `--yd-chart-label-ink` / `--yd-chart-label-paper` in `:root`, with
  `CHART_LABEL_INK` / `CHART_LABEL_PAPER` as their twins in `charts/theme.ts`
  and two new assertions in `charts/theme.test.ts` pinning them to the CSS.

**What was left, and why**

- **The fan chart's band swatch (1.17:1 / 1.48:1)** — task 13's ruling stands.
  It is drawn at exactly the band's own opacity, so it is an honest preview; a
  full-opacity border would show an edge the band lacks. If the band should
  clear 3:1 the fix belongs on `areaStyle.opacity` and the swatch follows.
- ~~**`--yd-border-strong` on cards, panels and bento cells** — out of scope.
  1.4.11's "user interface components" bullet is about controls; a decorative
  container edge is not a component, and the content inside every one of these
  containers already clears AA on its own. Raising it would be a visual
  redesign, not an accessibility fix.~~
  **Superseded — the scope claim was false.** The token also bordered fourteen
  rules that *are* controls, every one of them `background: transparent`. Fixed
  in the addendum below; the reasoning above survives only for the container
  edges it actually describes.
- **The cashflow plot's 1.11:1 hue distance** — recorded as finding **M4**
  rather than fixed. The criterion is met by mark type (stacked bars vs a
  2 px line with 8 px circular symbols) and by position (inflow above the
  baseline, outflow below), and every series clears 3:1 against the plotting
  surface (Entrées 9.46:1, Sorties 4.69:1 against the card). Closing the hue gap
  means moving `--yd-positive` or `--yd-accent-strong`, which are mirrored into
  `charts/theme.ts` and used by every chart in the app — a change no test can
  judge, at the end of a phase. The *visible* consequence (the net line is hard
  to follow where it crosses a green bar) is named in the findings.

**Test I did not expect to need.** `tileLabelColor`'s test asserts the ratio
over every fill in both categorical ramps, not a colour name. That is what
caught four ramp colours — `#d95926` and `#d55181` from **`DARK_CATEGORICAL`**
(`charts/theme.ts:103`, `:106`; this line said "light-ramp" and was wrong for
both), `#2a78d6` and `#e34948` from `LIGHT_CATEGORICAL` — sitting in the
mid-luminance band where **neither** white **nor** `--yd-text`
clears 4.5:1 (best of the two: 4.31, 4.24, 4.42, 4.23). Hence a near-black ink
token rather than reusing `--yd-text`; worst case across both ramps is now
4.68:1.

---

## Part B — the journey

375 / 768 / 1440, both themes, on the operator's real fixture. Every screenshot
below was read back with the Read tool and judged. All are in
`.superpowers/sdd/2026-08-16-yieldo-phase-2a-analyse/shots/`.

### The four new screens — 24 shots

| screen | file | what the shot shows |
|---|---|---|
| /budgets | `task19-budgets-1440-sombre.png` | Opens on **Janvier 2026**, the last month with data, not the empty current month. 5 budgeted categories, 2 over budget in red, 5 unbudgeted with inputs. Budgets compute — a real answer. |
| /budgets | `task19-budgets-1440-clair.png` | Same in light; the new control borders on the five "250,00" inputs are clearly visible and not heavy. |
| /budgets | `task19-budgets-768-clair.png` / `-sombre.png` | Cells stack to one column; the month arrows stay inside the content box. |
| /budgets | `task19-budgets-375-clair.png` / `-sombre.png` | Amounts move below their category name; progress bars full width; no overflow. |
| /recurrences | `task19-recurrences-1440-sombre.png` | **"Pas encore calculable"** with the 91-day rule spelled out, and the four bursts (FNAC, CAF, pharmacie, frais de tenue de compte) each carrying "Observé sur 22/25/25/32 jours seulement" and "Pas encore annualisé". Reads as a decision, not a failure. |
| /recurrences | `task19-recurrences-1440-clair.png` | Same in light; the amber left rules on the excluded cards read clearly. |
| /recurrences | `task19-recurrences-768-clair.png` / `-sombre.png` | Single column; the four cards keep their internal structure. |
| /recurrences | `task19-recurrences-375-clair.png` / `-sombre.png` | Amounts drop to their own line; "Prélèvement manquant" stays legible; no overflow. |
| /tresorerie | `task19-tresorerie-1440-sombre.png` | Forecast **refuses** ("il faut au moins 6 mois complets… l'historique n'en compte que 3"); runway computes as "Déjà épuisé" on a negative balance, flagged "mesuré sur 3 mois". The banner uses the conditional ("partirait… mais elle n'est pas établie") — task 14's fix holding. |
| /tresorerie | `task19-tresorerie-1440-clair.png` | Same in light. |
| /tresorerie | `task19-tresorerie-768-clair.png` / `-sombre.png` | **Re-shot** — the stale `task14-reel-768-*` carried pre-fix banner wording. Two scenario panels stay side by side; nothing clips. |
| /tresorerie | `task19-tresorerie-375-clair.png` / `-sombre.png` | **Re-shot** for the same reason. Scenario panels stack; "Déjà épuisé" fits one line. |
| /tresorerie (stub) | `task19-tresorerie-peuple-1440-sombre.png` | A stubbed twelve-month payload: fan drawn, band centred on the dashed median and descending through zero, breach pin at juin 2026, last label "janv. 2027" intact. |
| /analyse | `task19-analyse-1440-sombre.png` | Inflation **refuses** and names both windows; the 17 non-comparable categories are listed with their own month counts; anomalies come out **mixed** (2 rows + "11 groupes non analysés"); the index panel is honestly empty. |
| /analyse | `task19-analyse-1440-clair.png` | Same in light. |
| /analyse | `task19-analyse-768-clair.png` / `-sombre.png` | Cells stack; the category rows keep name and counts on one line. |
| /analyse | `task19-analyse-375-clair.png` / `-sombre.png` | Category names wrap onto their own line above the counts — task 18's one-character-per-line collapse does **not** return. Tab bar wraps to two rows. |

**All six designed answers confirmed** as deliberate answers rather than broken
screens: budgets compute; récurrences detect four bursts and annualise none;
the forecast refuses with its reason; the runway computes flagged as measured on
three months; inflation refuses naming both windows; anomalies come out mixed.

### The three screens this phase did not build

| screen | file | note |
|---|---|---|
| / | `task19-accueil-1440-sombre.png`, `task19-accueil-1440-clair.png`, `task19-accueil-375-sombre.png` | Dashboard with the fixed waterfall, the re-inked treemap and the reshaped cashflow legend. h1 → h2 throughout, no skip. |
| /transactions | `task19-transactions-1440-clair.png`, `-1440-sombre.png`, `task19-transactions-375-sombre.png` | 50 of 197 with "Charger plus"; filters and per-row category selects all carry the new visible border. |
| /import | `task19-import-1440-clair.png`, `task19-import-1440-sombre.png` | Confirms the fixture is clean: exactly one batch, "198 lignes lues, 197 importées, 1 doublon, 0 en erreur". |
| /categories | `task19-categories-placeholder-1440-sombre.png` | A bare sentence, no `h1`, no card — see finding **m2**. |

### Structural checks, every screen

- **No horizontal document scroll** at any width on any screen:
  `documentElement.scrollWidth === clientWidth` held for all 24 new-screen
  combinations and all regression screens.
- **Exactly one `<h1>`, no heading skip** on `/`, `/transactions`, `/budgets`,
  `/recurrences`, `/tresorerie`, `/analyse`, `/import`, `/reglages`. The one
  exception is `/categories`, which has **zero** headings (finding **m2**).
- **Console, all nine nav entries**, walked client-side in one session: no
  errors, no React warnings. Two DevTools advisories only (finding **m8**).

### Sidebar at 768 px *height* — the specific ask

At 1280 × 768 the nine entries occupy y = 0…436, ending **332 px above the
fold**. Nothing scrolls off. `shots/task19-sidebar-hauteur768-1280-clair.png`.
(The sidebar is `position: relative`, so it scrolls away with a long page —
pre-existing phase-1.5 behaviour, recorded as **m11**, not a new defect.)

### Mobile drawer

`shots/task19-tiroir-ouvert-375-clair.png` — opens with all nine entries and a
scrim, at 812 px height.
- Escape **closes** it ✔ — but drops focus to `<body>` (finding **M3**).
- Clicking a nav link **closes** it and navigates ✔.
- Opening it leaves focus on the Menu button (no trap, but nothing lost).
- The fixed "Menu" button does **not** occlude any new screen's first heading:
  measured at 768, button box `(12,12)-(79,54)`, `h1` box `(16,90)-(737,124)` —
  no intersection. The phase-1.5 Moderate does not extend to the four new
  screens.

### `usePeriod` / `PeriodSelector` — changed twice, re-verified

| consumer | default preset | behaviour |
|---|---|---|
| `/` | Mois | ✔ tabs switch, URL syncs, custom range filters |
| `/transactions` | Mois | ✔ "Tout" → 50/197 rows, URL `?periode=all` |
| `/analyse` | **Tout** (task 18's additive `defaultPreset`) | ✔ |
| `/tresorerie` | — | does not consume `usePeriod`; verified it renders and refuses correctly regardless |

Task 18's fix re-verified end to end: clicking **Personnalisé** with no bounds
leaves the `/analyse` banner reading *"Aucune période imposée…"* — it does **not**
claim the two engines agree on a window the user never chose. Typing a real
range (2025-11-01 → 2026-01-09) switches the banner to *"Les deux panneaux
répondent sur la période choisie ci-dessus"*, and both panels re-answer with the
new counts. `shots/task19-periode-personnalisee-analyse-1440-clair.png`.

### Reduced motion

Via the in-app Réglages switch (`data-motion="off"`), checked on `/analyse`,
`/budgets` and `/tresorerie`:
`--yd-motion-fast` and `--yd-motion-base` both **0ms**; every computed
`transition-duration` **0s**; **zero** elements carrying text at `opacity < 1`
or `visibility: hidden`; every cell present.
`shots/task19-motion-off-analyse-1440-sombre.png`.

### Keyboard

No positive `tabindex` anywhere. Every control on the new screens is reachable
in DOM order, including below the fold: the last budget input ("Frais de tenue
de compte", off-screen at 1440 × 900) takes focus and shows a 2 px
`--yd-accent` ring at 1 px offset — `shots/task19-focus-budgets-1440-sombre.png`.

---

## Findings

Severities are mine. "Blocking" means it misrepresents a number, hides a
control, or fails contrast — the rule the brief set.

### Blocking — all five fixed in this pass

| # | finding | reproduction |
|---|---|---|
| **B1** | The dashboard waterfall drew a **−2 209,63 € deficit as a bar rising above zero**, and the "Autres dépenses" step likewise. Live since phase 1.5. | Open `/` → "Afficher toute la période" → look at the last two bars of "Revenus, dépenses et épargne". Fixed in `475d78b`. |
| **B2** | Treemap category labels at **1.80 – 2.69:1** on three of four tiles — white-on-pastel, well under AA. | Open `/` with data, read the "Répartition des dépenses" tile labels. Fixed in `fe03b8f`. |
| **B3** | Alert text at **3.61:1** in the dark theme, on the login screen and ten others, because the panel is tinted from the same colour as the text. | Fail a login; or inject `.yd-auth__alert` on `/connexion` in the dark theme and sample the pixel. Fixed in `fe03b8f`. |
| **B4** | The Réglages animation switch is **invisible when off**: track 1.57:1 against the card, knob 1.53:1 against the track, whole control inside a 1.64:1 band. | `/reglages` in the dark theme, turn "Animations" off. Fixed in `fe03b8f`. |
| **B5** | Every form control's boundary at **1.30 – 1.55:1**, with a fill 1.12:1 from the surface behind it — nothing identified a select or an input as a control. | Any screen: sample the theme `<select>`'s border against its own fill. Fixed in `fe03b8f`. |

### Moderate — recorded, not fixed

| # | finding | reproduction |
|---|---|---|
| ~~**M1**~~ | At 375 the cashflow legend's third entry is **overprinted by the Exporter button** — it renders as "Sold*Exporte*r". `CashflowChart` has no `legend.right` reservation; the fan chart carries `right: 84` for exactly this. **Fixed in the addendum.** | `/` at 375 with data, look at the "Flux de trésorerie" legend. Before: `shots/task19b-legende-flux-avant-375-sombre.png`. After: `-apres-375-sombre.png` / `-clair.png`. |
| ~~**M2**~~ | At 375 the **waterfall's bar labels collide** — "+10 220 €" and "−3 900 €" overprint each other, so neither amount is readable. Two figures on screen, both illegible. **Fixed in the addendum** (`labelLayout: { hideOverlap: true }`); it was under-ranked here. | Before: `shots/task19b-cascade-labels-avant-375-sombre.png`. After: `-apres-375-sombre.png` / `-clair.png`. |
| **M3** | **Escape closes the mobile drawer but drops focus to `<body>`** instead of returning it to the Menu button. A keyboard user is dumped at the top of the document; the drawer is the only way to nine nav entries below 900 px. | 375 → Menu → Escape → `document.activeElement` is `BODY`. |
| **M4** | On the plot, the "Solde net" line is **1.11:1** (dark) / **1.12:1** (light) from the "Entrées" bar it crosses, so it is hard to follow over the December and January bars. Not a 1.4.11 failure (differing mark type + position, and both series clear 3:1 against the card) but a real legibility cost. | `/` with data, follow the teal line across the two green bars at the right. Fixing it means moving a categorical token — for 2B. |

### Minor

| # | finding | reproduction |
|---|---|---|
| **m1** | `WaterfallChart`'s `aria-label` emits **raw ISO dates inside French prose**: *"…du 2025-01-24 au 2026-01-09"*. Every sibling chart says *"du 24 janvier 2025 au 9 janvier 2026"*. Screen-reader users get the one chart that speaks in ISO. | `/` → read the `aria-label` of the cascade figure. One-line fix: route through `frenchDate`. |
| **m2** | **`/categories` has no `<h1>`** and no card — one nav entry of nine lands on a bare `<p>Catégories — à venir.</p>`. It is a declared deviation that budgets and the essential flag live on `/budgets`, but the screen never says so, while `/tresorerie` links *to* `/budgets` for exactly that. | Click "Catégories". `shots/task19-categories-placeholder-1440-sombre.png`. Should at minimum carry an h1 and point at `/budgets`. |
| **m3** | **The savings-rate tile is the only figure on the dashboard that is typeset wrong.** `formatPercent` (`OverviewPage.tsx:56-58`) emits `-21,6 %` with a hyphen-minus (U+002D) and a **plain U+0020** before `%`. The three amounts beside it are correct — `formatCents` uses U+2212, U+202F and U+00A0. | `/` with data; dump the code points of the "TAUX D'ÉPARGNE" tile. |
| **m4** | **French spacing before high punctuation is not applied app-wide.** The whole app contains **five** `&nbsp;` usages, all in the phase-1 import feature; every French string added in phases 1.5 and 2A uses a plain space before `:` `;` `!` `?` `»`. `/analyse` alone renders 22 such occurrences, `/tresorerie` 10, `/recurrences` 6+. This is a convention that was established once and never propagated — not two slips. | Any screen: `nodeValue.match(/[^\s] [:;!?%»]/g)`. A mechanical pass, but one that will touch test strings — for 2B, deliberately. |
| **m5** | Three `<ul>` per screen carry `list-style: none` **without `role="list"`**, so Safari/VoiceOver drop list semantics. This includes the **sidebar nav's own list of nine entries**, not just `RecurrencesPage` as the ledger recorded. | `/recurrences` → enumerate `ul` and read `listStyleType` and `role`. |
| **m6** | At 1440 `/analyse` leaves roughly **650 px of empty left column** below "Votre panier" while the right cell runs long with 17 expanded rows. Very visible in the light theme. | `shots/task19-analyse-1440-clair.png`. |
| **m7** | Selecting **"Personnalisé"** writes empty query params — `?periode=custom&du=&au=`. Harmless (the screens handle it), but the URL claims a custom period that does not exist, and it is the shape of the defect task 18 fixed. | Click "Personnalisé" on `/transactions` or `/analyse`. |
| **m8** | **`npm run lint` has never worked** — `eslint` is not installed, so `eslint src --max-warnings 0` exits "'eslint' n'est pas reconnu". Recorded, not fixed, per the brief. | `cd frontend && npm run lint`. |
| **m9** | Two form fields lack `id`/`name`, raising a DevTools issue on every navigation. Both are wrapped in a `<label>` so they are accessibly named; this is an autofill/forms advisory, not a WCAG failure. | Console on `/analyse`. |
| **m10** | The dashboard's default period is **"Mois"**, which on the operator's ledger (ending 2026-01-09, clock at 2026-08-23) is **empty**. His first screen every session is an empty state. It is a good empty state — it names the real range and offers one click to it — but `/budgets` solves the same problem by opening on the last month *with* data. | Open `/` with no query string. `shots/task19-waterfall-avant-1440-sombre.png` (first capture). |
| **m11** | The sidebar is `position: relative`, so all nine entries scroll away on a long page (`/analyse` is 2 023 px at 1440 and 4 173 px at 375). It does **not** scroll off at 768 px height, which was the question asked. | Scroll `/analyse` to y = 600 at 1280 × 768. |

### Informational

- **The JS bundle is 1 632 kB** (530 kB gzipped) in one chunk; Vite warns about
  it on every build. At 4× CPU throttle this shows up as a single **1 243 –
  1 285 ms** blocking frame at load — the entire tail of the frame distribution
  (see Part D). Not a regression from this phase, but it is now the app's
  dominant performance cost.
- The backend test run emits `InsecureKeyLengthWarning` — the **dev default**
  `secret_key` is 26 bytes, under the 32 recommended for HS256. `install.sh`
  generates `openssl rand -hex 32`, so a deployed instance is unaffected, and
  the default is literally named `dev-insecure-key-change-me`. Benign.

---

## Part C — triage of the ledger's deferred items

Every `minor (deferred)` line in `progress.md`, judged against what is on
screen. **Visible?** means an operator could encounter it in the running app on
his own data. **Merge?** means it must be fixed before this branch merges.

### Already resolved by later tasks — close them

| item | resolution |
|---|---|
| Task 3 · `PriceIndexPoint.month` first-of-month unenforced | Task 17 made `_parse_month` the only write path. Closed. |
| Task 11 · `_reason_short_ledger` cites the residual count as the ledger count | Fixed in task 14 once two contradicting numbers landed on one screen. Closed. |
| Task 6 · alert and field error use `--yd-negative` on a tinted panel, "resolve with the phase-wide contrast pass" | Done here — `--yd-negative-text`, 3.61 → 5.16:1. Closed. |

### Visible in the app, and this pass raised the severity

| item | was | now | merge? |
|---|---|---|---|
| Task 13 · `legend: { right: 84 }` is a magic number | minor | the *absence* of the same reservation on `CashflowChart` produces a real collision at 375 — finding **M1** | no, but fix early in 2B |
| Task 9 · `list-style: none` without `role="list"` | minor, scoped to `RecurrencesPage` | app-wide, including the nav — finding **m5** | no |
| Task 18 · no busy state on a period change | minor | **confirmed visible**: changing the `/analyse` period leaves the previous window's figures on screen, under its own "La comparaison porte sur…" sentence, until the new response lands | no — but it is the most user-visible of the deferred UI items |
| Task 6 · a save has no busy indicator | minor | same class as the above; both are the "stale figures with no signal" pattern | no |

### Visible, correctly ranked minor — leave

| item | why it can wait |
|---|---|
| Task 9 · a `missing` row contributes its full annual figure with no clause | on the operator's data nothing is annualisable at all, so the case is unreachable today |
| Task 9 · the 91-day paragraph renders even when every exclusion is income or ended | it renders on his data and is true there; the over-broad case needs a ledger he does not have |
| Task 9 · `RecurrencesPage.tsx` at ~349 lines carrying fetch, partition, three counts, three body states and the copy deck | a maintainability cost, not a defect; 2B will add to this file and should split it then |
| Task 14 · `RunwayPanel:124` says "descend sous zéro" on `low_cents <= 0` | overstates only at exactly zero; his values are strictly negative |
| Task 14 · `CashflowPage` indexes `forecast.months[0].key` on the contract alone | would white-screen on a contract violation; the contract is pinned by backend tests |
| Task 18 · `Effacer l'indice` erases the stored series on one unconfirmed click | destructive and unconfirmed — but the button only exists once a series is saved, and the operator has none. **Worth a confirm dialog in 2B**; I rank it the highest-risk of the deferred UI items |
| Task 18 · "Coût mensuel médian" labels a sum of medians | wording, visible, true-ish; correct phrasing is "somme des coûts médians" |
| Task 6 · `.yd-budgets__suggestion` always declares a third grid row | a stray row-gap; invisible unless you measure |
| Task 12 · `months` means two things at two levels of the runway payload | no `Field(description=...)`, so nothing surfaces in OpenAPI — a 2B reader hazard, not a screen defect |

### Not visible — engine and test-quality debt, all can wait

These are real, and none of them can be reached from the running app on any
ledger the operator can produce today. They belong in 2B's first cleanup, not in
this merge.

- **Unpinned guards and tautological tests** — task 1 (`describe()` has no
  docstring; `test_quantile_offset_is_an_integer_number_of_cents` asserts the
  implementation's own expression; no all-negative sample despite 179 of 197
  rows being negative), task 5 (the "worst first" sort is never exercised with
  more than one budgeted category), task 7 (the sign check, the
  `after.median == 0` half, and `MIN_INTERVAL_MAD_DAYS` all execute unpinned
  behind 100 % statement coverage), task 10 (two assertions verify Python rather
  than the engine), task 11 (`test_the_split_loses_no_money` omits the
  `_is_projected` gate), task 14 (two loose assertions: `/minimum/i`, a bare
  `/7/`), task 16 (tie order across categories is deterministic but unpinned).
  **Judgement:** the task 1 gap is the one worth closing first — `robust` is at
  100 % coverage and is consumed by five engines, and no test drives it on the
  shape the ledger actually has.
- **One-directional cross-tenant tests** — tasks 8, 12 and 17 each prove
  exclusion only from the empty side (user B sees nothing of user A) without
  seeding B with her own rows. Isolation is the repo's own stated invariant;
  three routers proving only half of it is worth one afternoon in 2B.
- **Contract and sign hazards for 2B's consumers** — task 16's
  `category_median_cents` is unsigned against a signed `amount_cents` (a naive
  subtraction gives nonsense), task 11's `residual_scale_cents = 0` on a refusal
  is a zero standing in for an unknown where the repo's precedent is
  `int | None`, task 12's `RunwayScenarioOut.months` is non-optional against the
  engine's `float | None`. **These three are the ones 2B is most likely to trip
  over**, because they are shape mismatches at exactly the seams the appendix
  says 2B will consume.
- **Numerically inert inconsistencies** — task 10's `capacity.py` routes amount
  0 to neither bucket while `aggregate.py` sends `>= 0` to inflow; task 15's
  zero-baseline guard is `== 0` rather than `<= 0` and untested; task 17's month
  format does not zero-pad below year 1000; `resolve_range` accepts an inverted
  explicit range. All harmless today, all cheap.
- **Documentation defects** — task 8's router docstring cites a "budgets.py
  house pattern" that does not exist. Task 11's own process lesson was that
  three times the thing left untrue was the *explanation*, not the logic. This
  is the fourth instance and it should be corrected on the same principle.
- **Modelling caveats that only bite on a longer ledger** — task 11's seasonal
  centre-variance treats a repeated calendar month as independent past horizon
  12, and `seasonal_scale` is pooled across calendar months rather than measured
  per month; task 7's `_analysable_run` returns `None` on an unclassifiable
  full-group median instead of trimming further, and nothing records that a
  group *was* trimmed. **Judgement:** the "nothing records that a group was
  trimmed" one deserves promotion the moment the operator imports real history —
  a reader who subscribed in 2019 will read `first_on = 2024-10` as a bug, and
  the screen has no way to say otherwise.

**Bottom line for the merge:** none of the ~55 deferred items blocks this
branch. Four deserve promotion in 2B's plan rather than staying on a list:
`Effacer l'indice` needs a confirmation; the three shape mismatches
(`category_median_cents` sign, `residual_scale_cents` zero-for-unknown,
`RunwayScenarioOut.months` optionality) sit exactly where 2B will consume them;
the missing-busy-state pattern is the most visible; and task 1's untested
all-negative path underpins five engines.

---

## Part D — the two measurements

### D1 · Frame cost, re-measured with a metric that can see a tail

The phase-1.5 watch item claimed 92.3 fps with effects on against 140.8 with
them off, and 16 % of frames over 20 ms. **It does not reproduce.**

Method: a `requestAnimationFrame` loop collecting per-frame deltas, 30 warm-up
frames discarded, reporting p50 / p95 / p99 / max and the share of frames over
16.7, 20 and 33.3 ms. "Effects off" = `.yd-atmosphere { display: none }` plus
`backdrop-filter: none` on the sidebar, the header and `.yd-glass`. 1440 × 900,
`/` with the whole ledger loaded and four ECharts canvases mounted.

| condition | frames | p50 | p95 | p99 | max | fps (mean) | > 20 ms |
|---|---|---|---|---|---|---|---|
| idle, effects **ON** | 420 | 6.90 | 7.00 | 7.10 | 7.70 | 144.0 | **0 %** |
| idle, effects **OFF** | 420 | 6.90 | 7.00 | 7.10 | 7.10 | 144.0 | **0 %** |
| scrolling, effects **OFF** | 420 | 6.90 | 7.10 | 7.10 | 7.10 | 144.0 | 0 % |
| scrolling, effects **ON** | 420 | 6.90 | 7.00 | 7.10 | 7.10 | 144.0 | 0 % |
| scrolling + CPU 6×, effects **ON** | 420 | 6.90 | 7.00 | 7.10 | 13.90 | 143.3 | 0 % |
| scrolling + CPU 6×, effects **OFF** | 420 | 6.90 | 7.00 | 7.10 | 48.50 | 142.0 | 0.2 % |
| **load + 4-chart render, CPU 4×, effects ON** | 890 | 6.90 | 7.10 | **48.60** | **1284.7** | 94.2 | **1.7 %** |
| **load + 4-chart render, CPU 4×, effects OFF** | 890 | 6.90 | 7.10 | **48.60** | **1243.0** | 95.4 | **1.5 %** |

**Reading.** At steady state the atmosphere costs the main thread nothing: the
halo keyframes animate `transform` on a compositor layer (the CSS keeps `filter`
off the animated element deliberately), and the two `backdrop-filter` surfaces
do not repaint while the content under them is static or merely scrolling. Under
6× CPU throttle the two conditions are still indistinguishable.

The only condition that produces a tail is **load**, and there the two
conditions differ by **1.2 fps on the mean and 0.2 points on the over-20 ms
share** — inside run-to-run noise — while p50, p95 and p99 are *identical*. The
tail is one frame of **1.24 – 1.28 s**, which is the 1 632 kB bundle being
parsed and the four charts being built, not the atmosphere.

**Conclusion — corrected in the addendum, read that version.** The phase-1.5
figure (92.3 fps against 140.8) does not reproduce, and the bundle is the real
cost. But the watch item is **not closed**: every row above reports p50 = 6.90 ms
on a 144 Hz display, which *is* the vsync interval — **the instrument is
saturated at its floor**. "Identical at p50/p95/p99" therefore means "no frames
were dropped", not "the atmosphere costs nothing"; two conditions can differ by
several milliseconds of paint and composite and still produce byte-identical rAF
deltas. The correct wording, and what would settle it, is in the addendum.

The forecast fan's fifth canvas could not be included here because it does not
mount on the operator's data.

*Caveat, plainly: one machine, one browser, a 144 Hz display, and rAF measures
main-thread frame cadence. It cannot see GPU-side cost that the compositor
absorbs without dropping a frame — nor any main-thread cost that fits inside the
6.9 ms vsync budget. A slower GPU could tell a different story.*

### D2 · Analysis endpoint latency at the operator's volumes

Through the real HTTP stack, 30 samples each after 3 discarded warm-ups, against
the 197-row fixture.

| endpoint | median | p95 | max | status |
|---|---|---|---|---|
| `/api/recurrences` | 12.1 ms | **18.0 ms** | 18.4 ms | 200 |
| `/api/cashflow/forecast` | 15.5 ms | **27.3 ms** | 52.7 ms | 200 |
| `/api/cashflow/runway` | 13.2 ms | 19.7 ms | 20.3 ms | 200 |
| `/api/analysis/inflation` | 12.4 ms | 18.3 ms | 18.6 ms | 200 |
| `/api/analysis/anomalies` | 11.9 ms | 24.7 ms | 43.5 ms | 200 |
| `/api/budgets` | 8.2 ms | 12.0 ms | 13.4 ms | 200 |
| `/api/analytics/summary` | 9.4 ms | 13.4 ms | 15.6 ms | 200 |

**Nothing needs attention.** The brief's threshold was 200 ms p95; the worst
endpoint is at **27.3 ms**, 7× under it, and that is the one running
`detect_recurrences` over the whole ledger *and* projecting twelve months. Both
recurrence-driven endpoints re-run detection per request and neither is close to
a problem at this volume.

*What this does not tell us:* the operator's fixture is 197 rows over one
account. `detect_recurrences` walks the whole ledger every time, so the cost is
linear in row count with a `n log n` sort inside each label group. At ten years
of statements — the thing that would light every one of these features up — this
should be re-measured before assuming it holds.

---

## Coverage

From `pytest --cov=app --cov-report=term-missing`, 522 tests:

| package | statements | missed | coverage |
|---|---|---|---|
| **`app/engines`** | 845 | 11 | **98.7 %** |
| **`app/importers`** | 420 | 18 | **95.7 %** |
| whole app | 2 816 | 88 | 97 % |

Both targets clear ≥ 80 % comfortably. Per module: `anomaly`, `budget`,
`capacity`, `inflation`, `period`, `recurrence`, `robust`, `runway` at **100 %**;
`forecast` at 99 % (lines 350, 352); `aggregate` at 93 % (lines 57, 81, 88,
91-96 — `fill_missing_buckets` paths the analysis engines deliberately do not
use). `dedup` 100 %, `mapping` 97 %, `parser` 96 %, `service` 96 %, `dialect`
93 %.

---

## STILL UNVERIFIED

Named plainly, because the point of this pass is that nobody discovers these
later.

1. **The CSS `prefers-reduced-motion` gate.** chrome-devtools cannot force the
   media query. Only the in-app `data-motion="off"` switch was exercised. The
   media-query block in `tokens.css` and `AtmosphericBackground.css` is
   unverified in a browser.
2. **Any browser other than Chrome.** Every measurement, screenshot and contrast
   reading is Chrome-only. The `role="list"` finding (**m5**) is specifically a
   Safari/VoiceOver problem and was reasoned about, not observed.
3. **Any hardware other than this machine.** The frame measurements are from one
   144 Hz desktop. CPU throttling was emulated; the GPU was not.
4. **The deployed instance.** Everything here ran against the Vite dev server and
   a `--reload` uvicorn worker. Nothing was checked behind `install.sh`, against
   the built `dist/`, or with the production secret.
5. **The forecast fan on a real backend response.** It was exercised through a
   stubbed payload only — the same limitation task 14 recorded. The backend's own
   forecast path on six or more observed months has never been rendered.
6. **The public landing page.** `HomeRoute` renders `LandingPage` for an
   anonymous visitor; the session was authenticated throughout, so the phase-1.5
   `h1 → h3` skip on that page was not re-checked.
7. **Screen readers.** No assistive technology was run. Heading order, `aria-label`
   text and list semantics were inspected in the accessibility tree only.
8. **A larger ledger.** Every refusal on this fixture is the *refusing* branch.
   The computing branches of forecast, inflation and annualised recurrences have
   never been rendered from real backend data, only from unit tests and stubs.
9. **Import, end to end.** No CSV was imported during this pass — deliberately,
   to leave the fixture clean. The import wizard was only seen at step 1.

---

## Carry-forward for phase 2B

The appendix in the task brief already names the symbols 2B inherits. What this
pass adds:

- **`engines/capacity.measure_savings_capacity`**, **`engines/robust`** and
  **`api/common`** are all at 100 % coverage and behaved correctly on the
  operator's real data throughout. They are safe to build on.
- **Three shape mismatches sit exactly at the seams 2B will consume** and should
  be fixed before, not during: `anomaly.category_median_cents` is unsigned
  against a signed `amount_cents`; `forecast.residual_scale_cents` returns `0`
  on a refusal where the repo's precedent is `int | None`;
  `RunwayScenarioOut.months` is non-optional against the engine's `float | None`.
- **`/categories` is still a placeholder with no heading** (**m2**). 2B owns it.
  Until then the placeholder should at least say where budgets and the essential
  flag are actually edited.
- **The essential-category list is not editable anywhere.** The reduced runway
  scenario rests on 21 flags the operator cannot change, and `/tresorerie` says
  so in French. Task 14 called this a real product gap; it still is.
- **The bundle, not the atmosphere, is the performance item to watch** — 1 632 kB
  in one chunk, one ~1.25 s blocking frame at load under 4× throttle. The
  phase-1.5 frame-cost watch item can be closed.
- **The French-spacing convention needs one deliberate decision** (**m4**), not
  another deferral: either adopt `&nbsp;` before high punctuation everywhere and
  do the mechanical pass with its test-string fallout, or drop the five existing
  usages in the import feature so the app is at least consistent.
- **`npm run lint` still does not exist** (**m8**). Eighteen tasks shipped
  without a linter.

---

# Addendum — fix round on the task 19 review

**Branch:** `phase-2-analyse-decision`, on top of `fe03b8f`
**Suites after:** backend **522 passed** (unchanged, nothing backend was
touched); frontend **630 passed** (622 before, **+8** written here);
`npm run build` (`tsc -b && vite build`) at **zero TypeScript errors**
**Fixture:** untouched, and the same backend worker throughout —
`Get-NetTCPConnection -LocalPort 8000` reported PID **6544** before and after,
`/api/health` returning `{"status":"ok","version":"0.1.0"}`. `/import` still
reads "198 lignes lues, 197 importées, 1 doublon, 0 en erreur", one batch, one
account.

Four Important findings, all fixed. Two corrections to what the report said.
Three new items for the ledger. One question for the operator.

---

## Finding 1 — `--yd-border-control` extended to every control that had a hairline

**The deferral rested on a false description and is withdrawn.** The claim was
that `--yd-border-strong` lives "on cards, panels and bento cells". It also
bordered **fourteen rules covering seventeen buttons**, every one of them
`background: transparent`, where the hairline is the entire outline of the
control — the exact defect B5 fixed for inputs.

Found by parsing every stylesheet rather than by reading: a rule that declares
`cursor: pointer` and takes a border from `--yd-border` or `--yd-border-strong`.
Fourteen hits, no false positives.

| file | rule | buttons |
|---|---|---|
| `charts/Chart.css` | `.yd-chart__export-toggle` — was on plain **`--yd-border`**, the worse of the two | 1 per chart, on every screen |
| `design/EmptyState.css` | `.yd-empty__action` | 1 |
| `features/analysis/AnalysisPage.css` | `.yd-index__save, .yd-index__clear` | 2 |
| `features/budgets/BudgetsPage.css` | `.yd-budgets__month-nav button` | 2 |
| `features/budgets/BudgetsPage.css` | `.yd-budgets__suggestion-save` | 1 per unbudgeted row |
| `features/import/ImportPage.css` | `.yd-import__new-account-toggle` | 1 |
| `features/import/ImportPage.css` | `.yd-import-history__cancel` | 1 |
| `features/import/ImportPage.css` | `.yd-import__back` | 1 |
| `features/import/ImportPage.css` | `.yd-dialect__save, .yd-dialect__save-row button` | 2 |
| `features/import/ImportPage.css` | `.yd-dialect__notice-dismiss` | 1 |
| `features/import/ImportPage.css` | `.yd-summary__cancel` | 1 |
| `features/settings/SettingsPage.css` | `.yd-settings__logout` | 1 |
| `features/transactions/TransactionsPage.css` | `.yd-transactions__undo` | 1 |
| `features/transactions/TransactionsPage.css` | `.yd-transactions__load-more` | 1 |

All fourteen now take `--yd-border-control`: **5.04:1** against the dark card
surface, **3.96:1** against the light one. Read off the rendered page, the
"Se déconnecter" button reports `rgb(99, 146, 157)` = `#63929d`, and
`.yd-empty__action` and `.yd-index__save` report the same.

**Two hover twins had to move with them**, or the fix would have been undone on
hover — `--yd-border-strong` is *weaker* than `--yd-border-control`, so hovering
would have lowered the contrast:

- `.yd-chart__export-toggle:hover` / `[aria-expanded="true"]` → `--yd-accent`.
- `.yd-glass--interactive:hover` → `--yd-accent`.
- `.yd-bento__cell--interactive:hover` → `--yd-accent` as well, for one rule.
  A 1.2:1 → 1.5:1 step was feedback nobody could see; the 2px lift is what that
  hover is actually for.

**One more, found by the scan's own blind spot and fixed anyway.**
`.yd-dropzone` — the import wizard's primary control, a `role="button"` with
`cursor: pointer` — draws itself as a **dashed** `--yd-border-strong`, because
its edge comes from `.yd-glass--raised` and not from any rule of its own. A
per-rule scan can never see that. It now sets
`border-color: var(--yd-border-control)` on `.yd-dropzone` itself rather than
on `.yd-glass--raised`, which is a container tone the two auth cards also use.

### What I judged genuinely not a control, and why

Every one of these keeps `--yd-border` / `--yd-border-strong`:

- **Cards and bento cells** (`Bento.css:20`, `GlassCard.css:4`), and the
  **raised glass tone** (`GlassCard.css:28`) — containers. 1.4.11 does not
  reach them.
- **Banners and refusal panels** — `.yd-analysis__scope`,
  `.yd-analysis__insufficient`, `.yd-cashflow__clocks`,
  `.yd-cashflow__insufficient`, `.yd-transactions__notice`,
  `.yd-import-history__notice`, `.yd-auth__notice`. Prose in a box. Nothing to
  operate.
- **Popup surfaces** — `.yd-category-picker__list`, `.yd-chart__export-menu`.
  Both are opaque `--yd-surface-strong` with `var(--yd-shadow)`; the *items*
  inside are the controls and they are identified by the menu, not by its 1px
  edge.
- **`.yd-budget__essential`** — a static "Essentiel" badge, a `<span>`. Not
  operable; it is a label with a chip around it.
- **`.yd-import__crumb[data-done] .yd-import__crumb-marker`** — a step number in
  an `<ol>`. It reports progress; it is not clickable.
- **`.yd-import__actionbar`** — the sticky footer *holding* the controls. Its
  own buttons are `.yd-import__commit` (filled accent, no border needed) and
  `.yd-import__back` (fixed above).

### Covering test

`frontend/src/design/controlBorders.test.ts` (new, 2 tests, written red — it
listed all fourteen offenders before the fix). It parses every `.css` under
`src/`, collects the selectors of every rule declaring `cursor: pointer`, and
fails if any of those selectors — or a `:hover` / `[attr]` narrowing of one —
takes a border from `--yd-border` or `--yd-border-strong`. A second test guards
the guard (more than 200 rules and more than 20 control selectors parsed), so a
parser that silently matched nothing cannot make the first one vacuous.

Its limits are written into the file: it reads one rule's own declarations, so
it cannot see an edge inherited through composition (the dropzone case) and it
does not resolve the cascade. It is a regression guard for the shape of defect
this repo shipped, not a proof of contrast.

---

## Finding 2 — both new tokens are now pinned

`frontend/src/design/contrast.test.ts`:

- `--yd-negative-text` added to **`TEXT_TOKENS`** — it is a text colour, so
  4.5:1 against `--yd-bg` is its floor, not 3:1. Passes as shipped (dark
  `#f08c94` ≈ 10:1; light `#b3232d` is the same value `--yd-negative` already
  clears).
- **New suite**, "tokens.css control boundaries (WCAG 2.x 1.4.11, non-text,
  3:1)", with `CONTROL_BORDER_TOKENS = ["--yd-border-control"]` measured
  against `--yd-surface-strong` — the app's opaque card, the lightest ground in
  the dark theme and the darkest in the light one, so it is the worst case a
  control's edge actually lands on. Dark **5.04:1**, light **3.96:1**.

`--yd-border` and `--yd-border-strong` are deliberately *not* in that list:
they are translucent, so they have no fixed ratio at all, and
`controlBorders.test.ts` is what keeps them off controls.

**Red-first evidence.** These two assertions pass on the tokens as shipped, so
I proved they bite by temporarily weakening both values:

```
x dark theme: --yd-negative-text clears 4.5:1 against --yd-bg
  -> dark --yd-negative-text (#7a2027) against --yd-bg (#060d15) is only 1.92:1
x dark theme: --yd-border-control clears 3:1 against --yd-surface-strong
  -> dark --yd-border-control (#1d2c38) against --yd-surface-strong (#0f1c28) is only 1.21:1
```

Both reverted immediately; the diff on `tokens.css` shows only the comment
rewrite below and no colour change.

The `--yd-border-control` comment block in `tokens.css` also carried the wrong
scope ("the visible boundary of a FORM CONTROL, and nothing else") and has been
rewritten to say what the token now covers, what it deliberately does not, and
which two test files hold each half of that line.

---

## Finding 3 — the cashflow legend reservation

`charts/CashflowChart.tsx`: `legend.right: 84`, the same reservation the sibling
`ForecastFanChart.tsx:79` already carried, with a comment naming the collision.

- **Before** (`shots/task19b-legende-flux-avant-375-sombre.png`): the legend
  runs the full 293px chart box and "Solde net" renders *underneath* the opaque
  "Exporter" button — "Sold**Exporte**r".
- **After** (`-apres-375-sombre.png`, `-apres-375-clair.png`): ECharts wraps
  "Solde net" onto its own second line, fully legible, in both themes.
- **At 1440** (`-apres-1440-sombre.png`): the three entries stay on one line,
  shifted left, clear of the button. No regression.

**Covering test** (`CashflowChart.test.tsx`, red first): *"reserves the Exporter
button's width so the legend cannot render underneath it"* —
`legend.right === 84`.

---

## Finding 4 — the waterfall's overprinted amounts at 375

**Fixed, and it was contained.** `charts/WaterfallChart.tsx`:
`labelLayout: { hideOverlap: true }` on the visible series.

**Why not "move one of them".** The collision is structural, not accidental:
two consecutive steps share a top level whenever a rise is followed by a fall
from that level. On the operator's ledger "Revenus" (+10 220 €) and "Logement"
(−3 900 €) both anchor at 10 220. And a cascade offers no free level to move a
label to — **bar *i*'s bottom IS bar *i+1*'s top by construction** — so
"label the falls at the bottom instead" only walks the collision one step along
and lands it on the two steps that share the resting total (Autres dépenses and
Épargne), which is the worst pair to lose.

**Why not "make the text shorter".** Measured, not estimated: at 375 the chart
box is **293px**, the plotting area about **235px** for **eight** bands (about
29px each), and each label is about **55px**. `formatCompactCents` would give
"+10,2 k€" at roughly 45px — still wider than the band. Printing eight exact
euro amounts horizontally at that width is geometrically impossible.

So the choice is between an unreadable overprint and printing fewer of them.
`hideOverlap` is ECharts' own answer and it is measured per render, not against
a breakpoint: it lays the labels out, drops the ones whose boxes collide, keeps
the rest.

| | |
|---|---|
| before, 375 dark | `shots/task19b-cascade-labels-avant-375-sombre.png` — "+10 2209 00 €": two amounts, neither readable |
| after, 375 dark | `shots/task19b-cascade-labels-apres-375-sombre.png` — "+10 220 €" reads cleanly; the other seven amounts all print; Logement's −3 900 € is **not printed** |
| after, 375 light | `shots/task19b-cascade-labels-apres-375-clair.png` — identical result |
| after, 1440 dark | `shots/task19b-accueil-1440-sombre.png` — **all eight** amounts print, including −3 900 €. The fix costs nothing at desktop width |
| after, 1440 light | `shots/task19b-accueil-1440-clair.png` — same |

**Stated plainly as a cost:** at 375 one amount — the largest expense — is no
longer printed on the plot. It remains in the tooltip and in the CSV export,
and the treemap directly above it shows Logement as the largest tile. That is
worse than printing it and better than printing garbage, which is the only
other option the geometry allows. If 2B wants every figure at 375, the fix is
not in this component: it is a taller chart with rotated labels, or a table
under the plot.

**Covering test** (`WaterfallChart.test.tsx`, red first): *"drops a bar label
rather than overprinting it on its neighbour"* — pins
`series.montant.labelLayout.hideOverlap`.

---

## Correction — the frame-cost measurement is saturated, not conclusive

The method in **D1** was sound (named warm-up, named off-state, tail
percentiles rather than a median, a stated blind spot) and the phase-1.5 claim
genuinely does not reproduce. But the closure was wrong.

**Every row reports p50 = 6.90 ms on a 144 Hz display. 1000/144 = 6.94 ms.**
The instrument is pinned at the vsync interval — its floor. "Identical at
p50 / p95 / p99" means **"no frames were dropped"**, which is not the same
claim as "the atmosphere costs nothing". Two conditions can differ by several
milliseconds of paint, raster and composite and still emit byte-identical rAF
deltas, because rAF measures *cadence*, not *work*.

**Corrected status of the phase-1.5 watch item: not closed.** Record it as
**"not reproducible at frame-drop granularity; unmeasured below vsync"**.

What would settle it, for whoever picks it up:

1. **Interleaved A/B repetitions inside one session**, reporting the spread —
   ON, OFF, ON, OFF … rather than one block per condition. The current numbers
   are one run each, so run-to-run drift and condition are confounded.
2. **A metric with headroom below vsync.** Any of: `long-animation-frame`
   PerformanceObserver entries; per-frame paint / raster / GPU durations from a
   DevTools trace; or an uncapped run (a display or compositor mode not clamping
   to 144 Hz), where the frame time is free to fall below 6.9 ms and a
   difference, if there is one, becomes visible.

**The 1 632 kB bundle and its ~1.25 s load frame are a direct measurement and
stand unchanged.** That one is not saturated: 1 243–1 285 ms is nowhere near
the floor.

## Correction — a ramp mislabel

`#d95926` and `#d55181` were called light-ramp colours. They are
**`DARK_CATEGORICAL`** entries (`charts/theme.ts:103`, `:106`). `#2a78d6` and
`#e34948` are the two from `LIGHT_CATEGORICAL`. The *finding* is unaffected —
four ramp colours across **both** ramps sit where neither white nor `--yd-text`
clears 4.5:1, which is exactly why `--yd-chart-label-ink` is a near-black rather
than a reuse of `--yd-text`. Corrected in place above.

---

## New for the ledger

Three items, none fixed here.

- **m12 (Minor, new — found while verifying finding 3).** At 375 the cashflow
  chart's last x-axis label is **clipped**: "janv. 2026" renders as
  "janv. 202", in both themes. Visible in
  `shots/task19b-legende-flux-apres-375-sombre.png` and `-clair.png`. Same
  class as A2's fan-chart clip, but `boundaryGap` does **not** rescue this one:
  with 13 monthly buckets in a 235px plot the half-band inset is about 9px
  against a label half-width of about 32px. It is the axis, not the legend, so
  the `right: 84` fix above does not touch it. Pre-existing, phase 1.5.
- **m13 (Minor).** `tileLabelColor`'s `NaN` fallback on a short hex.
  `CategoryTreemap.tsx:116-124` slices fixed offsets, so a 4-character value
  gives `parseInt("")` → `NaN`, and `NaN >= NaN` is `false`, so it silently
  returns ink. `contrast.test.ts:27-29` **throws** on the same input. Against
  this repo's no-silent-failure rule the treemap should throw too. (Raised by
  the reviewer; deferred deliberately, per the brief.)
- **m14 (Minor).** **The WCAG maths now exists in three copies** —
  `design/contrast.test.ts`, `charts/CategoryTreemap.tsx` and
  `charts/theme.test.ts`. It wants a single `design/contrast.ts` that all three
  import. Doing it here would have meant moving production code during a fix
  round; it belongs in 2B's first cleanup. (Raised by the reviewer; deferred
  deliberately.)

---

## For the operator to decide — the SDD directory is not in the repository

Not acted on. Recorded next to the standing refusal to commit these files,
because it is a policy question and not a coding one.

`CLAUDE.md` tells every future session:

> `.superpowers/sdd/2026-08-09-yieldo-phase-1-socle/progress.md` — the ledger of
> what each task actually shipped … Read it before assuming a past task's
> behavior.

But `.superpowers/sdd/.gitignore` is a single line, `*`. Verified:
`git check-ignore -v` names that file as the reason, and
`git ls-files .superpowers` returns **zero** tracked paths. So a fresh clone — a
new machine, a rebuilt worktree, a second contributor, or this project a year
from now — has **none** of it: not the two phase ledgers, not the nineteen task
reports, not this file, and not the phase 2B carry-forward. `CLAUDE.md`
instructs those sessions to read a file they cannot have.

The trade-off, both directions:

- **Commit it.** The instruction in `CLAUDE.md` becomes true, and the reasoning
  behind roughly 55 deferred decisions survives the clone. Cost: the directory
  is large (39 review diffs, about 40 reports, a `shots/` folder of PNGs), it is
  process exhaust rather than product, and it puts screenshots of the operator's
  own ledger — real-looking transaction labels and amounts, albeit from a
  synthetic local fixture — into the repository's history permanently.
- **Leave it ignored.** The repository stays product-only. Cost: `CLAUDE.md`
  cites a file that does not ship, which is precisely the class of defect task
  11's own process lesson named — *the thing left untrue is the explanation, not
  the logic* — and this would be the fifth instance.

A middle option exists and is worth naming: commit `progress.md` and the task
reports (text, small, and the part `CLAUDE.md` actually points at) while keeping
`shots/` and `review-*.diff` ignored. That makes the instruction true without
putting the operator's figures or 39 diffs into history.

**Whatever is chosen, one of the two must move** — the file, or the sentence in
`CLAUDE.md`. Nothing in this round changed either.

---

## Commands and their output

```
> backend/.venv/Scripts/pytest.exe -q          (from backend/)
522 passed, 305 warnings in 25.41s

> npm test                                     (from frontend/)
Test Files  48 passed (48)
     Tests  630 passed (630)

> npm run build                                (tsc -b && vite build)
dist/assets/index-Cf30o_zd.css     92.71 kB | gzip:  14.76 kB
dist/assets/index-xX39_763.js   1,632.04 kB | gzip: 530.97 kB
built in 4.10s            -- zero TypeScript errors

> npm run lint
still does not exist (m8): eslint is not installed. Left alone, per the brief.
```

Frontend went 622 → 630: +2 in `design/controlBorders.test.ts`, +4 in
`design/contrast.test.ts` (two tokens × two themes), +1 in
`charts/CashflowChart.test.tsx`, +1 in `charts/WaterfallChart.test.tsx`.

Console on `/` at 1440 after every change: **no errors, no warnings**.
No horizontal document scroll at 375 on `/` or `/import`
(`scrollWidth === clientWidth === 375`).

## Screenshots re-shot and judged

All in `.superpowers/sdd/2026-08-16-yieldo-phase-2a-analyse/shots/`, all read
back with the Read tool.

| file | what it shows |
|---|---|
| `task19b-cascade-labels-avant-375-sombre.png` | the defect: "+10 2209 00 €" |
| `task19b-cascade-labels-apres-375-sombre.png` | fixed; the Exporter button's new border reads as a button and is not heavy |
| `task19b-cascade-labels-apres-375-clair.png` | same in light |
| `task19b-legende-flux-avant-375-sombre.png` | "Sold**Exporte**r" |
| `task19b-legende-flux-apres-375-sombre.png` / `-clair.png` | "Solde net" wraps to its own line, legible |
| `task19b-legende-flux-apres-1440-sombre.png` | one line at desktop, clear of the button — no regression |
| `task19b-accueil-1440-sombre.png` / `-clair.png` | all eight cascade labels print; the two Exporter buttons are visible and restrained |
| `task19b-budgets-1440-sombre.png` / `-clair.png` | the two month arrows and five "Définir" buttons now match the inputs beside them; the "Essentiel" **badges** keep the faint hairline, deliberately |
| `task19b-transactions-1440-sombre.png` | "Charger plus" is now as identifiable as the search field above it |
| `task19b-import-1440-sombre.png` | the **dropzone**'s dashed edge is now visible, and "Nouveau compte" too; fixture still 198/197/1/0 |
| `task19b-import-375-clair.png` | the light theme's control grey on white — visible, not heavy; no horizontal scroll |
| `task19b-reglages-1440-sombre.png` | "Se déconnecter" bounded; measured `rgb(99, 146, 157)` |
| `task19b-analyse-1440-sombre.png` | "Enregistrer l'indice" matches the textarea above it |
| `task19b-vide-accueil-1440-sombre.png` | the empty state's one action now reads as the one action |

**The judgement, since a contrast fix that makes the interface shout is its own
defect:** it does not shout. `#63929d` and `#6f838d` are desaturated slate, and
in every shot the newly bordered buttons sit at the *same* weight as the inputs
and selects that B5 already fixed — which is the point, since they are the same
kind of thing. The screens that gained most are `/import` (the dropzone stopped
being a ghost) and the dashboard's empty state. Nothing gained a heavy outline,
and no container gained anything at all.

## What this round did NOT verify

Everything in the parent report's STILL UNVERIFIED list stands unchanged, plus:
the fourteen rules were verified by parsing the stylesheets and by reading the
computed border colour off the rendered page for four of them
(`.yd-settings__logout`, `.yd-empty__action`, `.yd-index__save`, and the chart
export toggle). The other ten were verified by screenshot, not by sampling a
composited pixel per rule.

## One thing worth knowing about the new stylesheet parser

`design/controlBorders.test.ts` reads `.css` files from disk, so line endings
matter to it — and this repository's are **mixed**. `.gitattributes` declares
only `*.sh text eol=lf`, `core.autocrlf` is `true`, and of the 23 stylesheets
under `src/`, **8 blobs are stored CRLF** (`app/AppShell.css`,
`charts/Chart.css`, `design/bento/Bento.css`, `design/glass/GlassCard.css`,
`features/auth/AuthPage.css`, `features/overview/StatTile.css`,
`features/transactions/PeriodSelector.css`, `index.css`) **and 15 LF**.

So the parser was run against **both**: every `.css` under `src/` converted to
CRLF, the suite run (48 passed), then converted back. It is line-ending
agnostic — `\r` is not a brace, `\s` covers it in `cursor\s*:\s*pointer`, and
selectors are trimmed. A Windows clone with `autocrlf` on will not see a false
failure.

The mixed storage itself is pre-existing and harmless (nothing reads these files
byte-for-byte except this new test), but it is the reason `git status` can
briefly disagree with `git diff` on a CSS file. Not worth a `.gitattributes`
change during a fix round; worth one line in 2B's cleanup if anyone adds a
second disk-reading test.

## Commit

`4e2c812` — *fix(design,charts): give every bordered control a visible boundary
and pin it*, on top of `fe03b8f`. 16 files, +162 / −29. The report and the
ledger are **not** in it: `.superpowers/sdd/.gitignore` is `*`, which is the
standing refusal recorded above and the open question for the operator.

---

# Addendum 2 — closing Finding 2's residual defect

**Branch:** `phase-2-analyse-decision`, on top of `4e2c812`
**Suites after:** backend **522 passed** (untouched); frontend **632 passed**
(630 before, **+2** here); `npm run build` (`tsc -b && vite build`) at **zero
TypeScript errors**
**Fixture:** untouched. `Get-NetTCPConnection -LocalPort 8000` reported the
same PID **6544** as the previous round; `/api/health` returned
`{"status":"ok","version":"0.1.0"}`; `/import` still reads "198 lignes lues,
197 importées, 1 doublon, 0 en erreur".

One Important finding closed. One question settled in the browser rather than
from the code, with no change required as a result.

---

## Finding 2 (continued) — the control-border floor now measures the genuine worst-case ground

**The defect was real.** `CONTROL_BORDER_TOKENS` measured `--yd-border-control`
only against `--yd-surface-strong`, on a comment claiming that token is "the
lightest ground in the dark theme and the darkest in the light one". For the
light theme that is false: `--yd-surface-strong` there is `#ffffff`
(`tokens.css:135`) — the lightest value possible, not the darkest. The token's
own already-documented worse pairing (`tokens.css:139-141`, "3.46:1 over the
deepest exposed ground") was left completely unpinned.

**Fix**, in `frontend/src/design/contrast.test.ts`:

- `hexToRgb`/`relativeLuminance`/`contrastRatio` were split into RGB-tuple
  primitives (`Rgb`, `relativeLuminanceFromRgb`, `contrastRatioRgb`) plus a
  new `parseRgba` / `parseRgbaDeclarations` / `compositeOverOpaque` trio, so
  the suite can alpha-composite a translucent token (`rgba(...)` in
  `tokens.css`) over an opaque one instead of only reading plain 6-digit hex
  values.
- `controlGroundsForTheme` now returns, per theme, **both** grounds a
  control's edge can actually land on:
  - every theme: `--yd-surface-strong` (the opaque card) — kept, not dropped,
    since it is independent of `--yd-bg` and catches a regression the other
    check cannot.
  - **light**: `--yd-bg` itself — every light-theme surface token
    (`--yd-surface`, `--yd-surface-raised`) is a white/near-white overlay ON
    TOP of `--yd-bg`, so nothing in the theme is darker.
  - **dark**: `--yd-surface-raised` (`rgba(30, 70, 94, 0.5)`, `tokens.css:81`)
    composited over `--yd-bg` — the dark theme's translucent surfaces LIGHTEN
    the near-black page, so the lightest exposed ground, not the opaque card,
    is the worst case for a border lighter than its ground.
- `CONTROL_BORDER_TOKENS` × grounds now produces **4** tests (was 2): light
  vs `--yd-surface-strong` and vs `--yd-bg`; dark vs `--yd-surface-strong` and
  vs the `--yd-surface-raised` composite.

**Measured, not assumed** (`node` running the same formula standalone,
matching the suite's own `.toFixed(2)` output byte for byte):

| theme | `--yd-border-control` | vs `--yd-surface-strong` | vs the genuine worst-case ground |
|---|---|---|---|
| light | `#6f838d` | 3.96:1 | **3.46:1** against `--yd-bg` (`#e9f1f3`) — exactly the figure already sitting in `tokens.css:139-141` |
| dark | `#63929d` | 5.04:1 | **4.35:1** against `--yd-surface-raised` composited over `--yd-bg` — raw composite RGB `(18, 41.5, 57.5)`, not rounded to a pixel first |

Both clear the 3:1 floor as shipped — nothing in `tokens.css` changed.

**Red-first proof that the new floor actually bites**, exactly reproducing
the failure class the review named ("a light-theme value that keeps ≥3:1
against white but drops below 3:1 against the real page background would
pass this test while violating the floor it claims to guarantee"):

Searched for a value on the same hue as `--yd-border-control` (light),
lightened toward white in 2% steps, for the first one that clears
`--yd-surface-strong` at 3:1 but not `--yd-bg`:

```
t=0.10 rgb=125,143,152 hex=#7d8f98 vs-white=3.358 vs-bg=2.933
```

Set `tokens.css`'s light `--yd-border-control` to `#7d8f98` and ran the suite:

```
✓ light theme: --yd-border-control clears 3:1 against --yd-surface-strong (the opaque card)   [26 passed]
✗ light theme: --yd-border-control clears 3:1 against --yd-bg (the deepest exposed ground)
  → light --yd-border-control (#7d8f98) against --yd-bg (the deepest exposed ground) is only
    2.93:1, below the 3:1 threshold WCAG 1.4.11 sets for a control's boundary: expected
    2.93251496869847 to be greater than or equal to 3

Test Files  1 failed (1)
     Tests  1 failed | 26 passed (27)
```

`#7d8f98` is precisely the shape of value the old test would have waved
through: it clears the easier `--yd-surface-strong` pairing (3.36:1) while
failing the real ground (2.93:1). The new test catches it; the old one could
not have. Reverted immediately —
`git status --short` shows only `frontend/src/design/contrast.test.ts`
modified, `tokens.css` is back to `#6f838d` with zero diff.

The comment block above `CONTROL_BORDER_TOKENS` was rewritten to state what
the suite now checks (both grounds, named, per theme) and why the two grounds
differ by theme, rather than repeating the false "lightest in dark / darkest
in light" claim.

`--yd-negative-text`'s presence in `TEXT_TOKENS` needed no change, per the
brief — untouched.

---

## The dropzone tie, settled by computed style

The review flagged that `.yd-dropzone`'s own `border-color: var(--yd-border-control)`
(`ImportPage.css:610`) and `.yd-glass--raised`'s `border-color: var(--yd-border-strong)`
(`GlassCard.css:28`) are equal-specificity selectors in two different
stylesheets, so which one wins depends on the built bundle's source order —
and that tracing import order made it "very plausibly" the case that
`.yd-glass--raised` wins, the opposite of what commit `4e2c812` intended.

**Settled in the browser, by `getComputedStyle` on the live element** (Chrome
DevTools MCP, dev server, both themes, at 1440×900, on `/import`):

| theme | `.yd-dropzone` element classes | resolved `border-color` | matches |
|---|---|---|---|
| dark | `yd-glass yd-glass--raised yd-glass--interactive yd-dropzone` | `rgb(99, 146, 157)` | `#63929d` = `--yd-border-control` (dark) |
| light | same | `rgb(111, 131, 141)` | `#6f838d` = `--yd-border-control` (light) |

**The tie goes the right way in both themes.** `.yd-dropzone`'s own rule
wins the cascade in the actual built/served bundle — `ImportPage.css` is
evaluated after `GlassCard.css`, not before as the source-order trace
speculated. Screenshots at 1440 in both themes confirm the same dashed
teal-grey edge already recorded in the previous round
(`task19b-import-1440-sombre.png`, `task19b-import-375-clair.png`).

**No CSS change made.** Since the computed style already resolves to
`--yd-border-control` in both themes, raising `.yd-dropzone`'s specificity
would change nothing observable today — it would only remove a latent
fragility (the outcome still depends on bundler import order, which is not
pinned by any test). That fragility is noted here rather than fixed, since
the brief calls for a specificity fix only "if the tie goes the wrong way",
and it does not.

---

## Commands and their output

```
> backend/.venv/Scripts/pytest.exe -q          (from backend/)
522 passed, 305 warnings in 24.36s

> npm test -- --run                            (from frontend/)
Test Files  48 passed (48)
     Tests  632 passed (632)

> npm run build                                (tsc -b && vite build)
dist/assets/index-Cf30o_zd.css     92.71 kB | gzip:  14.76 kB
dist/assets/index-xX39_763.js   1,632.04 kB | gzip: 530.97 kB
built in 3.89s            -- zero TypeScript errors
```

Frontend went 630 → 632: both new in `design/contrast.test.ts` (the light
`--yd-bg` and dark `--yd-surface-raised`-composite grounds, added alongside
the two pre-existing `--yd-surface-strong` checks).

## Commit

`bfd5ad5` — *fix(design): pin the control-border floor to each theme's
genuine worst-case ground*, on top of `4e2c812`. `contrast.test.ts` only —
`tokens.css` is unchanged; the dropzone check required no code change.
