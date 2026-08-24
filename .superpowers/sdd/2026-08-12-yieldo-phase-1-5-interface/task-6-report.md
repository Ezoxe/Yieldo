# Task 6 — Browser verification pass

Branch `phase-1-5-interface`. Base at start of this session: `68bfc6d`.
Verified against the local instance (frontend `localhost:5173`, backend
`127.0.0.1:8000`) carrying the operator's real volumes: 197 transactions from
2025-01-24 to 2026-01-09, 1 account, 69 categories, 1 import batch of 198 rows.

Port 8000 was checked before any API output was trusted
(`Get-NetTCPConnection`): PID 34832, child of the detached launcher 32844, and
confirmed to be serving *this branch's* code — `/api/analytics/summary` returns
`previous: null` with `history` populated, which is task 5's `1cbd07b` fix.
No orphaned worker.

This task was finished by a second agent after the first was cut off by a rate
limit. The first agent left 31 `task6-*` screenshots and no report; those shots
were read back and judged, and are cited below alongside the ones taken here.

---

## Part A — the two known dashboard defects

### Committed by the previous agent, verified here

`68bfc6d` — *fix(dashboard): let the spending calendar follow the period, in
French*. Verified on screen and it holds:

- `/analytics/calendar` now takes `date_from`/`date_to` through `_period`, and
  `calendarSpan()` draws the whole months the points occupy. On "Tout" the grid
  runs **janv. 25 → janv. 26** instead of the blank 2026 calendar year.
- Labels are French: months `janv. 25 … déc. 25, janv. 26`, days
  `L M M J V S D`, Monday first. Supplied outright from the same `Intl`
  formatter the rest of the app uses, because `nameMap: "fr"` is a no-op
  without a registered ECharts locale.
- The intensity scale's draggable handles print `0 €` / `884 €` instead of raw
  cents.

The other three charts were checked for the same leak. One remains — see
finding **F21** (`WaterfallChart.tsx:136` puts raw ISO dates in its aria-label).

### Committed here

`47e4d4f` — *fix(dashboard): cap the calendar's cell width instead of
stretching it*.

The previous agent left this work uncommitted, mid-way through its covering
tests. Assessed as sound and finished.

`cellSize: ["auto", 16]` let ECharts size the day column to fill the panel,
which fails at both ends of the range the chart now has to cover:

- **Too narrow.** At 375 the calendar cell is 293px and the operator's
  thirteen-month span is 57 week columns; 57 × 16px needs 912px. ECharts
  neither scrolls nor wraps a calendar — it draws past the right edge — so the
  back half of the range was off-panel with nothing on screen to say so.
- **Too wide.** On the "Mois" preset a single month is five columns, and
  `auto` stretched each to ~200px. The grid stopped reading as a calendar and
  became a row of bars.

Now `cellWidthFor(columns, available) = min(16, available / columns)`, with
`left: "center"` when the grid is narrower than the panel.

Covering tests, both new, in `SpendingCalendar.test.tsx`:

- *"never clips the grid off the right edge of a narrow panel"* — at a measured
  293px panel, `cellWidth × weekColumns(span) ≤ 293 − 40 − 16`.
- *"never stretches a short span into bars"* — a one-month span at a 1095px
  panel keeps `cellSize: [16, 16]` and `left: "center"`.

`ChartSkeleton`'s height contract is untouched (`height={220}` on the `Chart`,
unchanged), so task 3's 0.02px loading↔loaded parity does not regress.

Judged on screen at all three widths:

| shot | what it shows |
| --- | --- |
| `shots/task6-calendrier-cap-1440-dark.png` | 13-month span, 16px cells, centred in the 1095px panel, every month labelled in French |
| `shots/task6-calendrier-cap-768-light.png` | same span at a 671px panel, ~10.8px cells, every second month labelled, nothing clipped |
| `shots/task6-calendrier-cap-375-dark.png` | same span at 293px, ~4.2px cells — thin stripes rather than square days, but the **whole** range is on screen and the four labels that fit are readable |
| `shots/task6-calendrier-cap-375-light.png` | the 375 case in the light theme |
| `shots/task6-calendrier-un-mois-1440-light.png` | one month, 16px cells, centred, `déc.` label — reads as a calendar, not bars |

The 375 trade-off is deliberate and recorded as **F23**: 4.2px cells are a
stripe chart, but losing eight months silently is worse.

---

## Part B — the journey, screen by screen

Existing shots from the first agent are marked *(prior)*.

### 1. Landing page, logged out, `/`

| shot | what it shows |
| --- | --- |
| `task6-accueil-1440-dark.png` *(prior)* | hero, CTA pair, dashboard preview card |
| `task6-accueil-1440-light.png` *(prior)* | same in the light theme |
| `task6-accueil-375-light.png` *(prior)* | the 375 stack |
| `task6-accueil-scroll1/2/3-1440-dark.png` *(prior)* | the three content bands below the fold |
| `task6-accueil-375-dark.png` | 375 dark: header CTA pair, hero headline over three lines, body copy, hero preview card with a 2×2 figure grid — no overflow |

Scripted checks at 375: **no horizontal document scroll**, nothing past the
viewport's right edge except the atmosphere blobs (which live in an
overflow-hidden container), and — after scrolling the full 5799px document —
**no element stranded at `opacity: 0`**. Task 2's deferred worry, that
`whileInView` cells could be left invisible and no jsdom test would see it, did
not materialise.

Heading order is `H1 → H3 → H3 → H2 …`: the hero preview's panel titles are
`<h3>` under the `<h1>` with no `<h2>` between. Task 2's deferred item,
confirmed live — **F18**.

### 2. Login and registration

| shot | what it shows |
| --- | --- |
| `task6-connexion-1440-dark.png` *(prior)* | the login card centred over the auth atmosphere |
| `task6-connexion-375-light.png` *(prior)* | login at 375 light |
| `task6-connexion-erreur-anglaise-1440-dark.png` *(prior)* | **the English error**, dark |
| `task6-connexion-erreur-anglaise-1440-light.png` | the same error reproduced in the light theme |
| `task6-inscription-1440-dark.png` *(prior)* | registration, dark |
| `task6-inscription-375-light.png` | registration at 375 light: admin notice, four fields, strength meter, submit — fits without scrolling past the fold |

Submitting `pas-un-email` surfaces, verbatim in `[role="alert"]`:

> `value is not a valid email address: An email address must have an @-sign.`

Confirmed in both themes. This is **F1**. No account was created; the fixture
account was used throughout.

### 3. Dashboard

| shot | what it shows |
| --- | --- |
| `task6-dashboard-defaut-1440-dark.png` *(prior)* | default "Mois" (août 2026) — task 5's diagnosing empty state: "Vos 197 opérations vont du 24 janvier 2025 au 9 janvier 2026" with a widen button |
| `task6-dashboard-annee-1440-dark.png` *(prior)* | the "Année" preset |
| `task6-dashboard-tout-1440-dark.png` *(prior)* | "Tout" |
| `task6-mouvement-reduit-1440-dark.png` | "Tout" with reduced motion forced — the hero, its 270px running-balance sparkline, and the first bento row |
| `task6-contraste-tableau-1440-light.png` / `-dark.png` | the chrome, captured at DSF 1 for pixel sampling |

"Tout" was confirmed against the API: `/api/analytics/calendar?preset=all`
returns 84 points, first `2025-01-24`, last `2026-01-09`. The hero reads
`SOLDE NET −2 209,63 €`, `Du 24 janvier 2025 au 9 janvier 2026`, with no
comparison chip — task 5's `1cbd07b` regression fix, holding.

Task 3 asked that the hero be re-judged once the range was correct. It is now
correct and the trend line is genuinely flat across the middle, because the
operator's ledger has no rows between March and December 2025. Not a defect;
the band is simply 270px tall to show a real gap.

### 4. Transactions

| shot | what it shows |
| --- | --- |
| `task6-transactions-1440-dark.png` *(prior)* | 50 of 197 rows, native category selects, source badges |
| `task6-transactions-filtre-vide-1440-dark.png` *(prior)* | filtered to empty |
| `task6-transactions-recherche-vide-1440-dark.png` *(prior)* | searched to empty |
| `task6-transactions-regle-apprise-1440-dark.png` *(prior)* | **"Règle apprise — 8 autres transactions similaires ont été reclassées."** plus the honest caveat that the action cannot be undone |
| `task6-transactions-recherche-vide-375-light.png` | searched to empty at 375 light: names the active filter and offers "Effacer les filtres" |
| `task6-menu-flottant-occlusion-375-light.png` | the list scrolled at 375, with the fixed "Menu" button sitting on a row — **F6** |

The learned-rule notice works and is French. Empty states diagnose rather than
shrug — task 5's work holds at both widths.

### 5. Import

| shot | what it shows |
| --- | --- |
| `task6-import-etape1/2/3/4-1440-dark.png` *(prior)* | file → colonnes → aperçu → terminé, walked end to end with a generated 320-row CSV |
| `task6-import-historique-1440-dark.png` *(prior)* | both batches present mid-walk: `releve-test-320.csv` (320/320) and the operator's `Feuille de calcul sans titre - Feuille 1.csv` (198 read / 197 imported / 1 doublon) |
| `task6-import-rollback-confirm-1440-dark.png` *(prior)* | the rollback confirmation |
| `task6-import-historique-375-light.png` | the same screen at 375 light, **showing only the operator's batch** |

The 320-row test batch was rolled back and the operator's fixture batch was
not touched. Verified independently at the end of this session:
`GET /api/imports` returns exactly one batch, id 1, 198 rows, created
2026-08-12; `GET /api/transactions` still totals 197.

Step 4's completion line reads **"320 ligne importées dans « releve-test-320.csv »"** —
a French grammar defect, traced to source. That is **F7**.

### 6. Settings

| shot | what it shows |
| --- | --- |
| `task6-reglages-1440-dark.png` *(prior)* | three rows and a logout button, hard left, on the raw background — no card, no bento |
| `task6-reglages-375-light.png` | the same bare rows at 375 light |

- **Theme switch**: verified live in both directions; `data-theme` follows.
- **Density switch**: present (`Confortable` / `Compact`).
- **Animation switch**: verified to stop **CSS** motion, not just JS motion.
  With `data-motion="off"`, `document.getAnimations()` returns **0**, the
  atmosphere blob's computed `animation-name` is `none` and its
  `transition-duration` is `0s`. The mechanism is
  `:root[data-motion="off"] { --yd-motion-*: 0ms }` in `tokens.css:152`, which
  reaches every transition declared through the tokens — including the three
  stylesheets that carry only a `prefers-reduced-motion` block
  (`AuthPage.css:143`, `SettingsPage.css:91`, `PeriodSelector.css:97`).
  Both gates are honoured; see the caveat under "Reduced-motion pass".

This screen is **F5**: it reads as phase-1 furniture beside the rebuilt ones.

### 7. Categories

| shot | what it shows |
| --- | --- |
| `task6-categories-375-light.png` | one unstyled sentence, "Catégories — à venir.", on an otherwise blank screen |

Reached from a sidebar item that advertises it as a screen. It has **no
heading at all** — the scripted sweep returned an empty heading list for this
route, where every other route has an `<h1>`. **F4**.

### Reduced-motion pass

`prefers-reduced-motion: reduce` was forced at document-start via an injected
`matchMedia` override, which exercises the **JS** gate
(`useReducedMotion` / Motion). Result on the dashboard: **0 running
animations**, no element left at partial opacity or mid-transform, counters at
their final values, atmosphere static. `task6-mouvement-reduit-1440-dark.png`.

Named plainly: the **CSS** `@media (prefers-reduced-motion: reduce)` gate could
not be forced in the browser — the chrome-devtools `emulate` tool exposes
`colorScheme`, CPU, network, viewport, UA and geolocation, but not the reduced-
motion media feature, and there is no CDP passthrough. What was verified
instead is that the `data-motion="off"` twin, which sets the identical
declarations through the zeroed duration tokens, does stop CSS motion live.

### Console

Checked on every screen. **No uncaught errors and no React warnings** anywhere
in the authenticated app. Two things surfaced:

- One `401` on anonymous page load, from the `/auth/refresh` probe in
  `hydrate()`. Expected behaviour, but it paints a red console error on the
  landing page for every first-time visitor — **F15**.
- Two DevTools *issues*: "A form field element should have an id or name
  attribute" (counts 1 and 3) — **F16**.

---

## Findings

Severity is mine. Reproduction is one line each.

### Major

**F1 — the login error is raw English Pydantic text.**
Repro: `/connexion`, type `pas-un-email` + any password, submit → the alert
reads *"value is not a valid email address: An email address must have an
@-sign."* Both themes. The repository contract says all user-facing text is
French, and this is on the first screen anyone touches.
Evidence: `task6-connexion-erreur-anglaise-1440-dark.png`, `-1440-light.png`.

**F2 — the treemap's category labels fail WCAG AA 1.4.3 in both themes.**
Repro: dashboard → "Répartition des dépenses"; the white on-tile labels
measured over the composited pixels:

| label | fill | ratio | needs |
| --- | --- | --- | --- |
| Courses | `#4fd6a8` (`--yd-positive`) | **1.80:1** | 4.5:1 |
| Transports en commun | `#f4a261` (`--yd-warning`) | **2.06:1** | 4.5:1 |
| Loyer | `#8ab4f8` | **2.11:1** | 4.5:1 |
| Équipement et high-tech | `#fb7185` | **2.69:1** | 4.5:1 |
| Divers | `#64748b` | 4.76:1 | pass |

Identical in light and dark (the treemap uses the same fills in both).
`contrast.test.ts` cannot see this: it pairs tokens against a flat `--yd-bg`,
never against a chart fill.

**F3 — the waterfall chart's value labels overprint at 375.**
Repro: dashboard at 375, "Revenus, dépenses et épargne" → the first two labels
render as `+10 220 900 €`, which is a number that does not exist. `−902 €` and
`−3 793 €` also collide. Both themes.
Evidence: `task6-calendrier-cap-375-dark.png`, `task6-calendrier-cap-375-light.png`.

**F4 — `/categories` is a live nav destination with no screen behind it.**
Repro: click "Catégories" in the sidebar → one unstyled sentence, "Catégories
— à venir.", and **no `<h1>`** (the only route in the app without one).
`routes.tsx:17`. Already raised with the operator; recorded here because it is
now the only route that looks unbuilt.

**F5 — `/reglages` reads as phase-1 furniture beside the rebuilt screens.**
Repro: open `/reglages` at 1440 → three hairline-separated rows and a logout
button in the left third of the screen, on the raw background, with no card,
no bento cell and no panel. Every other screen in the app is on the bento
grid. It is the most visible remaining "before" surface.

### Moderate

**F6 — the mobile "Menu" button floats over scrolled content below 1024px.**
Repro: `/transactions` at 375, scroll to y=700 → `elementsFromPoint` under the
button's centre returns `TR.yd-transactions__row "08/01/2026 VIREMENT SEPA
RECU S…"`. The header is `position: static` and scrolls away, but the button
inside it is `position: fixed` with an opaque background and no chrome behind
it. Also reproduces at 768 over the treemap panel.
Evidence: `task6-menu-flottant-occlusion-375-light.png`.

**F7 — the import completion line is ungrammatical French.**
Repro: finish an import of 320 rows → *"320 ligne importées dans « … »"*.
`ImportSummary.tsx:23` defines `plural(count, word)` as
``` `${count} ${word}${count > 1 ? "s" : ""}` ```, which suffixes the *phrase*,
so `plural(320, "ligne importée")` pluralises "importée" and never "ligne".
The same helper produces *"N doublon ignorés"* and *"N ligne en erreurs"*.
Four different `plural` helpers now exist across four files
(`ImportPage.tsx:56`, `ImportHistory.tsx:12`, `ImportSummary.tsx:23`,
`TransactionsPage.tsx:51`); the other three take `(singular, plural)` and are
correct. Task 4's deferred "plural exists in three shapes across two files" has
grown, and has now produced a live defect.

**F8 — the login alert's own text fails 4.5:1 in the dark theme.**
Repro: dark theme, trigger the login error → `--yd-negative` `#e5606b` over the
alert's composited red-tinted panel `#323345` = **3.67:1**. The light theme
passes at 4.93:1. `contrast.test.ts` pairs `--yd-negative` against flat
`--yd-bg` and sees nothing wrong.

**F9 — two of the cashflow chart's three series are the same colour.**
Repro: dashboard → "Flux de trésorerie" legend; "Entrées" `#4fd6a8` against
"Solde net" `#4dc9ba` measures **1.11:1**. WCAG 1.4.11 asks 3:1 between
graphical objects a reader must tell apart. On the dashboard's primary chart,
two of three series are indistinguishable.

**F10 — the waterfall labels only 3 of its 9 bars.**
Repro: dashboard → "Revenus, dépenses et épargne"; the category axis prints
`Revenus`, `Transports en commun`, `Autres dépenses` — every fourth bar. The
other six are identifiable only by hovering, and at 375 and 768 there is no
hover.

**F11 — the halo blur and the two `backdrop-filter` surfaces cost a quarter of
the desktop's frames.** Measured; see Part D. Task 1's watch item, promoted:
its "median 6.9ms/frame" metric cannot detect this, because the median is
unaffected.

**F12 — control borders fail WCAG 1.4.11 (3:1).**
Repro: `/inscription` light theme → the text inputs' 1px border composites to
`#e2e7e9` against a `#feffff` card = **1.24:1**. Same class as task 1's
ratified theme-select hairline (1.29:1) and task 2's deferred
`--yd-border-strong`. Three independent measurements of the same gap now
exist; it wants one phase-wide pass rather than a fourth deferral.

### Minor

**F13 — no global `:focus-visible`.** Every stylesheet declares its own list of
selectors. The sidebar nav links, the header theme select, the period tabs,
the chart "Exporter" buttons, the auth submit button and the auth footer link
all fall back to the UA ring (`outline: auto 1px`). In Chrome that ring is
visible — sampled at `#ffffff` on `#0b2437` = 17:1 and not clipped — so this is
an inconsistency, not an invisible-ring defect. It is browser-dependent.

**F14 — `npm run lint` has never worked.** `eslint` is not installed and there
is no config. Confirmed: *"'eslint' n'est pas reconnu…"*. Known; not fixed here
per the brief.

**F15 — a red `401` in the console on every anonymous page load**, from the
`/auth/refresh` probe in `hydrate()`.

**F16 — form fields without `id` or `name`** (DevTools issue, counts 1 and 3 on
the transactions screen). Costs browser autofill and weakens label association.

**F17 — the registration strength meter reads "Trop faible" on an empty field**
before anything is typed. `task6-inscription-375-light.png`.

**F18 — landing page heading order skips `<h2>`**: `H1 → H3 → H3 → H2`.
Task 2's deferred item, confirmed live.

**F19 — targets under 24×24 at 375** (WCAG 2.2 AA 2.5.8): the "Non
catégorisées uniquement" checkbox is 13×13, the settings animation toggle
40×22, and the "Voir les transactions de cette période" link 20px tall.

**F20 — the import dropzone's instructions are its least legible text.** Its
disabled state is `opacity: 0.6` on the container, dragging the headline to
**4.46:1** and the sub-line to **2.76:1**. WCAG 1.4.3 exempts inactive
components, so this is not a formal failure — but it is the first thing a new
user reads on that screen, and it is dimmed precisely while they still need it.
Verified as a disabled state: choosing an account returns opacity to 1.

**F21 — one chart still leaks raw ISO dates into user-facing text.**
`WaterfallChart.tsx:136` builds *"Cascade des revenus… du 2025-01-24 au
2026-01-09."* Every sibling chart says *"du 1 janvier 2025 au 31 janvier
2026"*. Screen-reader text is user-facing text.

**F22 — an orphan on the empty-search message at 375.** *"…la recherche «
zzzintrouvable*  ⏎  *»."* leaves the closing guillemet and the period alone on
their own line. Same class as task 4's lone-dash defect.
`task6-transactions-recherche-vide-375-light.png`.

**F23 — the calendar is a stripe chart at 375.** Consequence of the cap
committed here: a 13-month span in a 293px panel gives 4.2px day cells with a
2px cell border. The week structure survives, individual days do not. The
alternative — the pre-fix behaviour — silently dropped eight months, so this is
the better of the two. Worth revisiting if the calendar ever gets a
per-year-row layout at narrow widths.

**F24 — one 1.58 MB JS chunk (515 kB gzip), no code splitting.** Vite warns on
every build. Relevant because the operator may open this on a phone.

**Counts: 5 Major, 7 Moderate, 12 Minor — 24 findings.**

---

## Part D — triage of the carried-forward Minor list

Each item from `progress.md`, against what is on screen. "Visible" means a user
could encounter it in the running app.

### Task 1

| item | visible? | verdict |
| --- | --- | --- |
| `charts/theme.ts` font mirror has no real guard | no (test-only) | **can wait** |
| Bento hover honoured only the media query, not the in-app switch | **resolved** | `tokens.css:152` zeroes the motion tokens under `[data-motion="off"]`; verified live at 0 running animations and 0s transitions. Close it. |
| light `--yd-bg-mesh-*` left behind the deepened ground | **resolved** | task 2 deleted `body::before` and mounted the atmosphere on the auth routes; the auth ground now matches the app in the light theme. Close it. |
| `DesignSystemPage.test.tsx` asserts only `"€"` in the aria-label | no (test-only, dev route) | **can wait** |
| `fonts.test.ts` CDN check covers three files | no (test-only) | **can wait** |
| blob keyframe regex is indentation-coupled | no (test-only) | **can wait** |
| watch: blur / `backdrop-filter` frame cost | **yes** | **promoted to F11.** Measured below. Not a merge blocker, but the ledger's reassurance was wrong and should not be carried forward as "measured fine". |
| theme select hairline 1.29:1 (ratified pre-existing) | **yes** | **fix before merge, as one pass with F12.** Three measurements of the same 1.4.11 gap now exist. |

### Task 2

| item | visible? | verdict |
| --- | --- | --- |
| `GlassCard.css` hover lift uses `transform`, so it carries the Motion-override bug | **resolved** | `GlassCard.css:45` now uses `translate: 0 -2px`, with a `prefers-reduced-motion` block at :76 and a `[data-motion="off"]` twin at :82. Close it. |
| ghost CTA needed a local `color-mix`; `--yd-border-strong` still fails 3:1 elsewhere | **yes** | **same pass as F12.** |
| `HomeRoute.test.tsx` tautological; `AppShellRoute` misplaced; dead `import "./AuthPage.css"`; `formatRate` duplicates `formatPercent`; `LandingPage.test.tsx` forces reduced motion in `beforeEach` | no (code hygiene / test-only) | **can wait** — with one caveat: the `beforeEach` gap was the risk that a `whileInView` cell strands invisible, and I scrolled the whole 5799px landing page at 375 and found none. The risk is real but not currently realised. |
| DashboardPreview `<h3>` under `<h1>` | **yes** | **F18.** Cheap; fold into any landing-page touch. |
| `variants.test.ts` loop not extended to `fadeInUpDelayed` | no (test-only) | **can wait** |

### Task 3

| item | visible? | verdict |
| --- | --- | --- |
| loading region announces nothing | **partly resolved** | `OverviewPage.tsx:145` carries `aria-label="Chargement du tableau de bord"`, so the region is not nameless. What a given screen reader announces for a `role="status"` whose children are all `aria-hidden` is implementation-dependent. Not a blocker; reword the comment. |
| `GlassCard.test.tsx` reduced-motion regex is lazy | no (test-only) | **can wait** |
| `tone` / `StatTileTone` dead | no | **can wait** |
| `OverviewPage.tsx` grew ~170 lines and owns the grid, skeleton, hero and date formatting | no (structure) | **can wait** — but it is the file most likely to be touched next. |

### Task 4

| item | visible? | verdict |
| --- | --- | --- |
| `ImportPage.tsx` holds too much; **`plural` in three shapes across two files**; three CSS-string tests; one overclaiming test name; inconsistent `&nbsp;:`; stale z-index comment | **yes, worse than recorded** | **fix before merge.** It is four shapes across four files, and the odd one out ships a French grammar error to the user — **F7**. |
| `toImport` can overstate what will be written | no (pre-existing wizard behaviour) | **can wait** |
| 326 tab stops to reach the action bar; the filter band eats ~270px of a phone | **yes, worse than recorded** | measured: the filter band is **214px** and the first transaction row starts **427px** down an 812px phone — **53% of the screen before any data**. **Worth fixing before merge**; a collapsed filter band at 375 is a small change with a large effect. |
| at 375 a tabbed-to category select in the import preview is still clipped horizontally | **yes** | **can wait** — a Chrome inline-axis scroll limitation, and the control is still operable. |

### Task 5

| item | visible? | verdict |
| --- | --- | --- |
| `history.py` defines no router; `_period` runs `user_history` unconditionally and /series and /categories discard it | **no** | measured at **0.372 ms median** (below). **Can wait.** The misplacement of a repository helper in `app/api/` is a structure nit worth one line of cleanup, not a fix. |
| `transaction_count` excludes transfers while `history.transaction_count` counts every row | not reproducible on this fixture (no transfer-only ledger) | **can wait**, latent |
| `filteredEmptyDetail` can blame filters while naming none | not reproduced | **can wait**, latent — the happy path names the filter correctly ("Filtre actif : la recherche « zzzintrouvable »") |
| `/analytics/series?granularity=day` with no dates is now unbounded | API surface only; the UI always sends bounds | **can wait** |
| `batchDateTime` has no explicit `timeZone`; `frenchDate` lives in `design/EmptyState.tsx` | renders correctly here (server and client share a zone) | **can wait**, latent |
| two simultaneous `role="alert"` nodes when a rollback fails with its confirmation open | not reproduced (would need a failing rollback) | **can wait** |
| an explicit range whose predecessor is empty still shows a chip | **yes** | **can wait** — correctly scoped per the controller's ruling |
| `.yd-summary__cancel` carries the 4.00:1 `--yd-negative-on-panel` pairing | **yes** | **same pass as F12.** The dark-theme sibling "Se déconnecter" measures 5.67:1, so this is panel-specific. |

**Summary of the triage: 4 items close as resolved, 4 want fixing before this
branch merges (the 1.4.11 contrast pass covering task 1's hairline + task 2's
`--yd-border-strong` + task 5's `.yd-summary__cancel` + F12; the `plural`
consolidation behind F7; the 375 filter band; and F18's heading order as a
freebie), and the rest can wait.**

---

## The two measurements

### 1. Halo `filter: blur()` and the two always-on `backdrop-filter` surfaces

What is on the page, read from computed style: three animated
`.yd-atmosphere__blob` parents at `blur(40px)`, `blur(50px)` and `blur(30px)`
(460², 380² and 300² CSS px), and two `backdrop-filter: blur(18px)
saturate(1.55)` surfaces — `NAV.yd-shell__sidebar` and `HEADER.yd-shell__header`.

Method: `requestAnimationFrame` interval sampling over 4s of steady-state
animation on `/?periode=all`, A/B against the same page with the atmosphere
`display: none` and both `backdrop-filter`s set to `none`. This machine drives
a ~144 Hz display, so the frame budget is 6.9 ms.

| condition | fps | median | p95 | worst | frames > 20 ms |
| --- | --- | --- | --- | --- | --- |
| **1440, effects on** | 92.3 | 7.00 ms | **27.7 ms** | 34.8 ms | **59 / 369 (16%)** |
| 1440, effects off | 140.8 | 6.9 ms | 7.2 ms | 13.9 ms | 0 / 563 |
| **1440, effects on, CPU ×4** | 84.3 | 7.00 ms | **27.8 ms** | 41.7 ms | **80 / 337 (24%)** |
| 1440, effects off, CPU ×4 | 142.5 | 6.9 ms | 7.1 ms | 13.9 ms | 0 / 570 |
| **375, effects on, CPU ×4** | 142.5 | 6.9 ms | 7.1 ms | 14.0 ms | **0 / 570** |
| 375, effects off, CPU ×4 | 138.3 | 6.9 ms | 7.1 ms | 69.5 ms* | 2 / 553 |

\* the 69.5 ms outlier is the style recalculation caused by my own mutation.

Three conclusions:

1. **The cost is real on the desktop.** The effects halve the frame rate
   (92 fps vs 141) and push 16% of frames past 20 ms — 24% under a ×4 CPU
   throttle. On a 60 Hz display, where the budget is 16.7 ms, a p95 of 27.7 ms
   means roughly one frame in six visibly stutters.
2. **The cost is nil on the phone.** At 375 with the CPU throttled ×4, the
   effects cost nothing measurable: the composited area is 4.2× smaller and
   the sidebar surface is not rendered at all. Blur here is fill-rate bound,
   not CPU bound, which is why throttling the CPU does not move it. The worry
   that the operator might open this on a phone is the one case that is fine.
3. **Task 1's metric could not have found this.** Its "median 6.9 ms/frame,
   worst 13.8 ms, zero frames over 20 ms" reproduces here **exactly** — as my
   *effects-off* row. The median is unaffected by the effects; the entire cost
   sits in the tail. Any re-check should measure p95 and the dropped-frame
   count, not the median.

Recommendation: not a merge blocker, but the ledger should stop carrying this
as "measured fine on one machine". If it is ever tuned, the cheapest lever is
the `blur(50px)` blob, and `will-change`/`contain` on the blob parents so the
blur can be cached across frames.

### 2. `_period`'s unconditional `user_history` aggregate

Against the operator's real 197 rows, 200 rounds each, through the app's own
session and models:

| | median | p95 | max |
| --- | --- | --- | --- |
| `user_history()` aggregate alone | **0.372 ms** | 1.609 ms | 2.406 ms |
| the row fetch the route needs anyway | 3.356 ms | 9.876 ms | 40.790 ms |

The aggregate is **10.0% of the two queries together** (0.372 ms of 3.728 ms).

In context, end-to-end over HTTP with both bounds supplied, 30 rounds each:

| endpoint | median | p95 |
| --- | --- | --- |
| `/api/analytics/series` | 13.82 ms | 15.15 ms |
| `/api/analytics/categories` | 16.62 ms | 22.17 ms |
| `/api/analytics/summary` | 18.53 ms | 24.49 ms |
| `/api/analytics/calendar` | 16.72 ms | 30.30 ms |

**The aggregate is ~2.0–2.7% of a request.** It is a single `min/max/count`
over one indexed `user_id` filter and it is not visible in response time at
the operator's volumes. Verdict: **can wait.** Skipping it on /series and
/categories would be a correctness-neutral tidy, not a performance fix.

---

## What remains unverified

Named plainly.

1. **The deployed instance, https://yieldo.ezoxe.fr, was not checked.** It runs
   phase-1 code. This branch has not been deployed and deploying it is the
   operator's call, not mine. Everything above is the local instance carrying
   the operator's real data volumes.
2. **The CSS `prefers-reduced-motion` gate was not forced in a browser.** The
   chrome-devtools `emulate` tool does not expose that media feature and there
   is no CDP passthrough. The JS gate was forced and passes; the CSS gate is
   backed by the `data-motion="off"` twin, which was verified live, and by the
   existing jsdom tests. A real OS-level reduced-motion pass is still owed.
3. **One browser only.** Everything was measured in Chrome. F13's conclusion —
   that the UA focus ring is visible — is a Chrome fact; Firefox and Safari
   draw different defaults and were not checked.
4. **One machine, one display.** The frame measurements are from a ~144 Hz
   desktop. The 60 Hz consequence in Part D is arithmetic, not an observation.
5. **The import wizard's four steps were walked by the previous agent at 1440
   dark only.** I verified the outcome (the test batch was rolled back cleanly,
   the operator's batch untouched) and the step-1/history screen at 375 light,
   but I did not re-run the wizard, deliberately: re-running it would have put
   a second batch through the operator's fixture for evidence I already had.
   Steps 2–4 at 375 and in the light theme rest on task 4's shots
   (`task4-import-mapping-375-light.png`, `task4-import-preview-375-light.png`).
6. **768 coverage is partial.** I re-checked the dashboard at 768 (the width
   the calendar change most affects) and inherited task 3/task 4's 768 shots
   for the other screens. `/reglages` and `/categories` were not shot at 768;
   both are single-column and neither is width-sensitive.
7. **Several deferred items could not be reproduced** because the fixture does
   not contain the state they need: a transfer-only ledger (task 5's
   `transaction_count` divergence), reference data that failed to load
   (`filteredEmptyDetail`), and a failing rollback (the double `role="alert"`).
   They are triaged as latent above, on code reading rather than observation.
8. **Pixel sampling understates small-text contrast.** My measurement tool
   decodes the composited PNG, which is the right surface to measure, but
   grayscale anti-aliasing means a 13.6px glyph stem never reaches its declared
   colour. Two candidate findings were withdrawn on this basis: the
   registration info box (rendered 3.25:1, declared `#435d6c` on `#e8f1f1` =
   **6.05:1**) and the field labels (rendered 3.95:1, declared **6.87:1**).
   The findings that survive — F2, F8, F12, F9 — are all large solid areas or
   glyphs that reached full colour, and were cross-checked against declared
   values.

---

## Suites

| | result |
| --- | --- |
| backend `pytest -q` | **250 passed** |
| frontend `vitest run` | **370 passed** (36 files) |
| `npm run build` | **built in 12.95s, zero TypeScript errors** |
| `npm run lint` | **broken** — eslint not installed, no config (F14, pre-existing) |

The brief's baselines were backend 248 / frontend 357. The deltas are task 6's
own: `68bfc6d` added 2 backend and 11 frontend tests, and `47e4d4f` added the
2 frontend tests covering the cell-width cap.

Fixture verified intact at the end of the session: 1 import batch (id 1, 198
rows, the operator's), 197 transactions, 69 categories.
