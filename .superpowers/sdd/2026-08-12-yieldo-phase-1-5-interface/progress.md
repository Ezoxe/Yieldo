# SDD ledger — plan: docs/superpowers/plans/2026-08-12-yieldo-phase-1-5-interface.md

Branch: phase-1-5-interface (created from master @ 6828f94)

## Verification environment (set up before Task 1)

The operator's real data profile, read live from https://yieldo.ezoxe.fr on
2026-08-12 (aggregates only, no personal rows copied):

- 1 bank account ("Société Générale", checking, EUR)
- 69 categories (14 parents, 55 children) — the standard seed
- 197 transactions, 2025-01-24 to 2026-01-09
  - months present: 2025-01 (13), 2025-02 (61), 2025-03 (20), 2025-12 (77), 2026-01 (26)
  - 179 debits / 18 credits; credits total 1_032_139 c, debits total -1_022_839 c
  - 19 distinct categories used; sources: csv 125, builtin 46, uncategorized 26
  - longest raw label 76 chars
- 1 import batch: 198 rows, 197 imported, 1 duplicate, 0 failed

Local fixture must reproduce those volumes. Today is 2026-08-12, so the
default "Mois" period is empty — that is exactly defect 2/4 of Task 5 and
must stay reproducible locally.

Screenshots are taken with chrome-devtools MCP against the local dev server
(the deployed instance's browser tab cannot composite frames for screenshots).

Fixture: `seed_fixture.py` in this directory rebuilds the database from
scratch. Login `demo@yieldo-demo.fr` / `MotDePasseDemo123!`.

## Findings outside the plan, raised with the operator, not yet scheduled

- `/categories` is a placeholder ("Catégories — à venir") while the sidebar
  advertises it as a screen. `routes.tsx:17`.
- The login error surfaces Pydantic's raw English text
  ("value is not a valid email address..."), violating the French contract.
- `npm run lint` has never worked: eslint is not installed and there is no
  config. Broken since phase 1, so no frontend lint has ever run.

## Task 1

Base: 6828f94.
- 98227a0 — primitives: atmosphere, bento grid, signature easing, motion,
  demo route `/design-systeme` (dev-only). 247 tests.
- Browser caught what jsdom could not: the bento hover lift was dead, because
  Motion writes inline `transform: none` on every `motion.*` element once its
  entry animation settles. Fixed with the independent `translate` property.
  The CSS test asserting the rule passed throughout. Same latent bug remains
  in GlassCard.
- Controller-authored brief defects, corrected in a follow-up round (7a3c215):
  Geist/Geist Mono were never shipped at all (now self-hosted via
  @fontsource-variable, no CDN); the pinned blob values rendered flat.
- 1563db4 — halos repositioned, feTurbulence dither (data: URI, opacity 0.12
  — `overlay` scales with its backdrop, 0.03 left an 86px flat run), AppShell
  sidebar and header translucent. Knock-ons fixed: the active nav pill used
  the same token as the sidebar and vanished; the drawer needed
  --yd-surface-raised over the scrim.
- 6b12acc — light theme ground deepened. --yd-text-muted ended at #435d6c
  after two corrections: #4a6577 fell to 4.46:1 and #46606f still measured
  4.41:1 at 375 in the inter-card gutters, where stacked cards overlap two
  drop shadows over a halo.
- charts/theme.ts duplicates the palette for canvas charts and had to move in
  step with tokens.css. Any later palette edit must touch both.
- Ruled after reading the shots: light `--yd-text-muted` moves to #4a6577
  (contrast wins over halo intensity); halos repositioned out from behind the
  sidebar; dither added against 8-bit banding; AppShell sidebar and header
  become translucent so the atmosphere reads through the chrome.

Task 1: complete (commits 6828f94..6b12acc, review clean — no Critical, no
Important). 259 tests.
Task 1: ratified after review, not defects: the bento gutter widens to
  --yd-space-lg above 1200px (the light-theme contrast figures were measured
  in that gutter); the theme select's 1.29:1 hairline is a pre-existing 1.4.11
  gap, identical before and after the translucent header, not introduced here.
Task 1: minor (deferred): charts/theme.ts font mirror had no real guard →
  handed to task 2. Bento hover honoured only the media query, not the in-app
  switch → handed to task 2. Light --yd-bg-mesh-* left behind the deepened
  ground → handed to task 2.
Task 1: minor (deferred): DesignSystemPage.test.tsx asserts only that the
  aria-label contains "€", which a float-rounding regression would survive.
  fonts.test.ts's CDN check covers three files, so an @import in any component
  CSS would pass it. The blob keyframe-property regex is indentation-coupled
  (`/^\s{4}([a-z-]+):/gm`) and goes vacuous on a reformat.
Task 1: watch item: `filter: blur()` sits on the parent of each animated blob,
  so the blur cannot be cached across frames, and two always-on
  `backdrop-filter` surfaces were added. Median 6.9ms/frame, worst 13.8ms,
  zero frames over 20ms — on one desktop machine only. Re-check on the
  operator's hardware in task 6.

## Task 2

Base: 6b12acc.
- 3f6fc35 — landing page, `data-motion` CSS hook for the in-app animation
  switch, phase-1 `body::before` mesh deleted and the atmosphere mounted on
  the auth routes. 293 tests.
- 894af39 — fix round 1/5 (1 addressed, 0 open — the hero preview's
  `transition: { delay: 0.12 }` was inert: Motion never consults the component
  prop when the resolved variant carries its own transition, so the hero's two
  halves arrived together. Now `fadeInUpDelayed` in variants.ts, guarded by a
  test asserting the resolved variant's delay; browser-measured at 89–100ms).
Task 2: complete (commits 6b12acc..894af39, review clean). 294 tests.
Task 2: note: the browser pass caught five defects the tests could not — a
  141-char line length, an invisible icon plate, an unreadable CTA border,
  18-char lines at 768, and a sticky bar eating 13% of a phone screen.
Task 2: minor (deferred): GlassCard.css's hover lift still uses `transform`,
  so it carries task 1's latent Motion-override bug. StatTile uses it, so that
  lift is probably dead on screen today. Task 3 owns that screen.
Task 2: minor (deferred): the ghost CTA's border needed a page-local
  `color-mix` to clear 1.4.11 (3:1); `--yd-border-strong` still fails it on
  every other control, and contrast.test.ts parses only tokens.css so neither
  is visible to the suite. Needs a phase-wide contrast pass.
Task 2: minor (deferred): HomeRoute.test.tsx's "only ever renders at /" is
  tautological. AppShellRoute lives in HomeRoute.tsx and belongs beside
  AppShell. RequireAuth.tsx's `import "./AuthPage.css"` is now dead.
  DashboardPreview's panel titles are `<h3>` under an `<h1>`, skipping `<h2>`.
  formatRate duplicates OverviewPage's formatPercent verbatim.
  LandingPage.test.tsx forces reduced motion in beforeEach, so the animated
  `whileInView` branch — the one that can strand cells invisible — is never
  rendered in any jsdom test.
Task 2: minor (deferred): variants.test.ts's signature-easing loop was not
  extended to cover the new `fadeInUpDelayed`.

## Task 3

Base: 894af39.
- d5d1eb5 — dashboard rebuilt on the bento grid, animated counters, staggered
  entry, skeletons sharing the loaded layout's spans. 306 tests.
- 3c4a848 — fix round 1/5 (1 addressed, 0 open — the hero was NOT the largest
  cell: hero 6x2, cashflow 6x2 and calendar 12x1 all tied at area 12, and the
  guard asserted `Math.max(...areas) === heroArea`, which a tie satisfies. In
  rendered pixels the calendar beat the hero 1.4x. Hero is now a full-width
  12x2 band at 522023px² against the calendar's 348988, and the guard asserts
  strictly greater over every sibling).
Task 3: complete (commits 894af39..3c4a848, review clean). 311 tests.
Task 3: note: the calendar keeps the full-width slot because SpendingCalendar
  draws at a fixed 16px cell and needs ~850px — it clips after June at half
  width. Below 1200px every cell is full width, so a 445px chart cell is
  taller than the hero; the hierarchy is a desktop property only.
Task 3: note: the hero's trend band draws the running net balance from the
  already-fetched cashflow series, accumulating integer cents. It revives
  Sparkline, which was dead code, and needed three fixes to survive the
  scale-up: non-scaling stroke, an end marker that is not an ellipse under a
  non-uniform transform, and a flat series drawn through the middle of the
  band rather than along its floor.
Task 3: note: measuring caught two skeleton defects — an SVG intrinsic ratio
  made the loaded hero 3px taller than its own skeleton, and the skeleton's
  hero bars resolved percentages against an auto-width flex column and
  rendered at ZERO width, so the loading screen had no figure in it. Both
  fixed; loading↔loaded now differs by 0.02px across all eight cells.
Task 3: note: on `/?periode=all` the hero's trend is flat and the cell reads
  as empty, because the "Tout" defect limits the answered range to the current
  year. Verified correct at `/?periode=custom&du=2025-01-01&au=2026-01-09`.
  Task 5 fixes the range; task 6 must re-judge the hero afterwards.
Task 3: minor (deferred): the loading region sets `role="status"`
  `aria-busy="true"` with every child `aria-hidden`, so it announces nothing —
  the comment claims the opposite. GlassCard.test.tsx's reduced-motion regex
  is lazy across the media-query boundary and would stay green if the rule
  moved out of the block. `tone`/`StatTileTone` on StatTile are dead.
  OverviewPage.tsx grew ~170 net lines and now owns the grid shape, the
  skeleton grid, the hero and French date formatting.
## Task 4

Base: 3c4a848.
- 61ec258 — commit action pinned to the viewport as `WizardActionBar`
  carrying the counts and a French `commitBlockedReason`; both screens on the
  bento grid; `.yd-amount--negative` now carries the colour instead of an
  inline style. 330 tests.
- 5089800 — fix round 1/5 (3 addressed, 0 open — the sticky bar hid the focus
  ring of every control below the fold, since nothing set
  `scroll-padding-bottom` and the document is the scrolling box; the 375
  category column was truncated to "Livrai"/"Remb"/"Salair"; PeriodSelector.css
  is shared and had been changed without re-checking the dashboard).
Task 4: complete (commits 3c4a848..5089800, review clean). 333 tests.
Task 4: note: the first implementer was cut off by a rate limit before
  committing; a second assessed the uncommitted tree, found its work sound,
  and finished it. Its own browser pass then caught three more: a 375 row
  where an opaque sticky amount column sliced through the category picker,
  MONTANT hidden past the right edge of the 375 import preview, and the
  summary's date range breaking onto three lines around a lone dash.
Task 4: note: at 375 the transaction row becomes a two-line CSS grid
  (date | libellé | montant, then the category picker full width). That strips
  the inferred table semantics, so role="table"/"rowgroup"/"row"/
  "columnheader"/"cell" are now declared explicitly. Desktop is untouched.
Task 4: note: `:root:has(.yd-import__actionbar) { scroll-padding-bottom: 8rem }`
  is the focus-ring reserve. 8rem is a constant against measured bars of 68px
  and 86px; a taller bar would need it revisited.
Task 4: minor (deferred): ImportPage.tsx now holds the SPAN map, `plural`,
  `commitCounts`, `commitBlockedReason`, `NewAccountForm`, `ErrorAlert`,
  `WizardActionBar` and four step components, while every other piece of the
  wizard has its own file. `plural` exists in three shapes across two files.
  Three CSS-string tests restate the stylesheet and only fail on deletion.
  One test name overclaims ("reachable without scrolling" — jsdom checks no
  such thing). French colon spacing uses a plain space in the two blocked
  reasons where the rest of the file uses `&nbsp;:`. A stale z-index comment
  cites a sticky header that was deliberately made non-sticky. The mobile
  column-width comment promises robustness the rule does not have.
Task 4: minor (deferred): `toImport` is now the screen's primary decision
  figure but can overstate what will be written — the clamp protects
  `duplicatesIgnored`, not `toImport`. Pre-existing wizard behaviour.
Task 4: minor (deferred): reaching the action bar by keyboard costs 326 tab
  stops with a 320-row file; a skip link is worth considering. The filter band
  still eats ~270px of an 812px phone before the first row.
Task 4: minor (deferred): at 375 a tabbed-to category select inside the import
  preview is still clipped horizontally — Chrome scrolls the document for a
  focused control but not the container's inline axis.

## Task 5

Base: 5089800.
- 0c2828d — all four defects. New pure engine `backend/app/engines/period.py`,
  a `user_history` lookup in `backend/app/api/history.py`, a shared
  `frontend/src/design/EmptyState.tsx`, and `ImportHistory.tsx`.
  Backend 245, frontend 355.
- 1cbd07b — fix round 1/5 (1 addressed, 0 open — REGRESSION INTRODUCED BY THE
  FIX: with no `date_from`, `start` became the user's earliest transaction, so
  the comparison window ended the day before the first row that exists and
  could not contain data. `compare_periods` returned `delta = net - 0`, and the
  default screen announced "−2 209,63 € par rapport à la période précédente" in
  red — the net itself, presented as a fall. Exactly the misleading-but-true
  class this task was chartered to remove. `previous`/`comparison` are now
  null when the caller stated no start date, and NetHero drops the chip).
Task 5: complete (commits 5089800..1cbd07b, review clean). Backend 248,
  frontend 357.
Task 5: note: `suggest_mapping(headers, rows, decimal_separator)` now sees the
  sample rows and proposes `amount` when a debit/credit-matched column carries
  BOTH signs. A single-sign column stays debit/credit — it is ambiguous alone.
  Still a proposal only; `build_preview` keeps `mapping or suggest_mapping(...)`.
Task 5: note: absent `date_to` resolves to the user's LATEST transaction, not
  `date.today()`. Deliberate deviation from the brief, which permitted today.
Task 5: note: `previous` is now nullable on a response shape that shipped in
  phase 1.
Task 5: note: the implementer self-caught two contrast defects it had
  introduced (white on --yd-negative at 3.38:1; a rollback label at 4.00:1),
  both fixed and independently re-derived by the reviewer to 3 significant
  figures. contrast.test.ts only pairs status tokens against --yd-bg, so none
  of these composited pairings has automated backing.
Task 5: ENVIRONMENT: an orphaned uvicorn --reload worker (parent killed, so it
  could never reload) held port 8000 and served pre-fix code while every new
  instance failed to bind with [Errno 10048]. Check
  `Get-NetTCPConnection -LocalPort 8000` before trusting API output.
Task 5: minor (deferred): `backend/app/api/history.py` defines no router and
  no endpoint — it is a repository query helper in the routers package.
  `_period` runs the `user_history` aggregate unconditionally, and /series and
  /categories discard it entirely.
Task 5: minor (deferred): `transaction_count` excludes transfers while
  `history.transaction_count` counts every row, so a ledger of only transfers
  renders "Aucune transaction… vos N opérations vont du X au Y" with a widen
  button that lands on the same empty state.
Task 5: minor (deferred): `filteredEmptyDetail` can blame filters while naming
  none, permanently, if the accounts/categories reference data failed to load.
Task 5: minor (deferred): /analytics/series?granularity=day with no dates is
  now unbounded — previously capped at one calendar year. API surface only.
Task 5: minor (deferred): `batchDateTime` formats without an explicit timeZone
  while its sibling `frenchDate` forces UTC and has a test for that hazard.
  `frenchDate` — a generic formatter — lives in design/EmptyState.tsx.
  Two simultaneous role="alert" nodes when a rollback fails with its
  confirmation still open.
Task 5: minor (deferred): an explicit range whose predecessor is empty still
  shows a chip — December 2025 reads "+715,50 €" because November is empty.
  Correctly scoped per the controller's ruling, but a reader could take it for
  growth.
Task 5: minor (deferred, pre-existing): `.yd-summary__cancel` in ImportPage.css
  carries the same --yd-negative-on-panel pairing measured at 4.00:1.

## Open questions put to the operator, not yet answered

- The spending calendar renders ONE year. On the now-correct "Tout" it renders
  2026, which holds nine days of data — a full-width blank panel on the
  default screen. Should it follow the period, or render several years?
- Its day and month labels render in English (`Jan`, `Feb`, `S`, `M`, `T`):
  `nameMap: "fr"` is a no-op without the registered ECharts locale. A French
  contract violation on the main screen.

Task 3: minor (deferred): the spending calendar's day and month labels render
  in English — `nameMap: "fr"` is a no-op without the registered ECharts
  locale. Pre-existing, but the full-width calendar makes twelve English month
  names far more prominent than the half-width one did.

Task 1: review — no Critical, no Important, task quality Approved. Spec ❌ on
one narrow point plus 8 minors. Controller rulings on the open items:
- RATIFIED: Bento.css overrides the brief's `gap: var(--yd-space-md)` to
  `--yd-space-lg` at >=1200px. Undisclosed in the report, but it is the
  gutter every light-theme contrast measurement was taken in, and 24px reads
  correctly at desktop. It stands; tasks 2-5 inherit it.
- ⚠️ resolved: the theme select's non-text contrast was never measured. The
  reviewer computed the hairline at 1.29:1 against the header both before and
  after the translucency change — identical, so pre-existing WCAG 1.4.11, not
  a regression. Accepted as pre-existing; the final review should decide
  whether phase 1.5 fixes it.
Task 1: complete (commits 6828f94..6b12acc, review clean). Frontend 259 tests.

Task 1: minor (deferred): charts/theme.ts mirrors the font stack with no
  guard — charts/theme.test.ts asserts `toContain("Geist Mono")`, which
  passes on the pre-fix broken value. Carried into task 2.
Task 1: minor (deferred): the in-app Animations switch is a Zustand store
  with no CSS hook, so no stylesheet can respond to it — the bento hover and
  index.css's body::before honour only the media query. A root
  `data-motion="off"` attribute closes both. Carried into task 2.
Task 1: minor (deferred): light --yd-bg deepened to #e9f1f3 but
  --yd-bg-mesh-a/b did not move, so the auth routes now sit ~5% lighter than
  the app. Task 2 replaces body::before rather than retuning it.
Task 1: minor (deferred): DesignSystemPage.test.tsx asserts only that the
  aria-label contains "€" — passes through a float-rounding regression.
Task 1: minor (deferred): fonts.test.ts's no-CDN check covers three files;
  an @import in any component CSS would pass it.
Task 1: minor (deferred): the keyframe-property guard regex is
  indentation-coupled (`/^\s{4}([a-z-]+):/gm`) and goes vacuous on a reformat.
Task 1: watch: filter: blur() sits on the parent of the animated element, so
  it recomputes per frame, and two always-on backdrop-filter surfaces were
  added. Measured fine on one machine (worst 13.8ms). Verify on the
  operator's hardware in task 6.

## Task 6

Base: 1cbd07b. Two agents: the first was cut off by a rate limit after
committing Part A and leaving 31 screenshots and no report; the second judged
its uncommitted tree, finished it, and owns everything below.

- 68bfc6d — Part A. /analytics/calendar takes date_from/date_to through
  `_period`; the chart draws the whole months its points occupy instead of one
  calendar year; French month/day names supplied outright (nameMap: "fr" is a
  no-op without a registered ECharts locale); the intensity scale stopped
  printing raw cents. Backend 250, frontend 368.
- 47e4d4f — the calendar's cell width is capped rather than stretched:
  `min(16, available / weekColumns)`, centred when narrower than the panel.
  `cellSize: ["auto", 16]` clipped a 13-month span off the right edge at 375
  (ECharts neither scrolls nor wraps) and stretched a one-month span into
  200px bars. Two covering tests. Frontend 370.

Task 6: complete. Backend 250, frontend 370, `npm run build` clean.
Task 6: FULL REPORT — `task-6-report.md` in this directory. 24 findings
  (5 Major, 7 Moderate, 12 Minor), the item-by-item triage of every
  `minor (deferred)` line above, and both Part D measurements. Read it before
  the whole-branch review; the list below is only the headline.
Task 6: Major — the login error surfaces raw English Pydantic text; the
  treemap's on-tile labels fail 4.5:1 in BOTH themes (1.80 / 2.06 / 2.11 /
  2.69:1, measured over composited pixels); the waterfall's value labels
  overprint into a wrong number at 375 ("+10 220 900 €"); /categories is a
  live nav destination with no screen and no <h1>; /reglages still reads as
  phase-1 furniture.
Task 6: Moderate — the mobile "Menu" button is position:fixed inside a static
  header and occludes scrolled content below 1024px; ImportSummary's `plural`
  suffixes the phrase not the noun, shipping "320 ligne importées" (four
  `plural` helpers now exist across four files); the login alert's own text is
  3.67:1 in dark; two of the cashflow chart's three series differ by 1.11:1;
  the waterfall labels 3 of its 9 bars; the halo/backdrop-filter frame cost;
  control borders at 1.24:1.
Task 6: measurement 1 — halo blur + two backdrop-filter surfaces, rAF A/B.
  At 1440: 92.3 fps vs 140.8 with the effects off, p95 27.7ms vs 7.2ms, 16% of
  frames over 20ms (24% under CPU x4). At 375 with CPU x4: no measurable cost
  (fill-rate bound, 4.2x smaller area, sidebar surface not rendered). Task 1's
  "median 6.9ms, worst 13.8ms, zero over 20ms" reproduces EXACTLY as the
  effects-OFF row — the median cannot see this cost. Stop carrying that line
  as reassurance.
Task 6: measurement 2 — `user_history()` costs 0.372ms median (p95 1.609ms)
  against 197 rows: 10% of the two queries, ~2.0-2.7% of a 13.8-18.5ms
  end-to-end request. Not visible. Can wait.
Task 6: triage roll-up — 4 deferred items CLOSE as resolved (task 1's bento
  motion switch, task 1's light bg-mesh, task 2's GlassCard `transform` hover,
  task 3's silent loading region is now named). 4 want fixing BEFORE merge:
  one phase-wide WCAG 1.4.11 pass covering task 1's 1.29:1 theme select, task
  2's --yd-border-strong, task 5's .yd-summary__cancel and the 1.24:1 auth
  input border; the `plural` consolidation behind the French grammar bug; the
  375 transactions filter band (measured at 214px, first row 427px down an
  812px phone — 53% of the screen); and the landing page's H1->H3 heading
  order. The rest can wait.
Task 6: UNVERIFIED, named — the deployed instance (still phase-1 code,
  redeployment is the operator's call); the CSS prefers-reduced-motion gate
  (chrome-devtools `emulate` cannot force that media feature; the JS gate and
  the data-motion twin were both verified live); Chrome only; one 144Hz
  machine; import wizard steps 2-4 at 375/light rest on task 4's shots, not
  re-run so as not to put a second batch through the operator's fixture.
Task 6: the operator's fixture batch was NOT rolled back. The 320-row test
  batch the first agent created was; verified at session end — 1 batch (id 1,
  198 rows), 197 transactions, 69 categories.

## Final whole-branch review and its fix wave

FINAL REVIEW (6828f94..47e4d4f, 14 commits) — verdict: fix before merge,
3 blocking, all in the import pipeline, the only path that writes user data.
- B1: the sign-sniffing promoted a debit column to `amount` inside the header
  pass, so a two-column export whose Débit column held ONE negative row (an
  extourne) proposed `{2: amount, 3: credit}` and rendered a clean, committable
  preview in which every expense read as income. Fixed with a two-pass
  promotion gated on the counterpart column being absent.
- B2: `toImport` counted kept duplicates twice after a retag, so the action bar
  could promise more rows than the commit would write, and `canCommit` could
  enable a commit whose fresh preview had importable == 0.
- B3: `plural(count, word)` suffixed the phrase — "320 ligne importées". Four
  helpers in three shapes existed; consolidated onto one shared module.
- F1: the login error surfaced Pydantic's raw English. Fixed at the validation
  boundary, so no French message is swallowed and no field path or Python type
  name can leak.
Fixed in 9bcfddf. The scoped re-review verdicted all four ADDRESSED and the
invited `row_number` re-indexing bug CLOSED, but found the wave had itself
introduced a silent failure: clearing overrides on a re-indexing dialect edit
reached the screen nowhere, so one touch of the preamble spinner wiped every
category correction with no warning. Fixed in bf5c2cd, with the clear moved
ahead of the try so a failed analyze cannot leave stale row keys.

Task 1's performance watch item was WRONG and is corrected here: its "median
6.9ms/frame, worst 13.8ms, zero frames over 20ms" reproduces exactly as task
6's effects-OFF row. Measured properly, the halos plus the two always-on
backdrop-filter surfaces cost 92.3 fps against 140.8 at 1440, p95 27.7ms
against 7.2, 16% of frames over 20ms and 24% under CPU x4. At 375 the cost is
nil. A median cannot detect a tail — do not quote that number again.
`user_history()` costs 0.372ms median at 197 rows, about 2.5% of a request.

Final state: backend 262 tests, frontend 389, `npm run build` clean. Both
suites re-run by the controller at bf5c2cd and green.

STILL UNVERIFIED
- The deployed instance at https://yieldo.ezoxe.fr still runs phase-1 code.
  Redeploying is the operator's call. Everything in this phase was verified
  against a local instance seeded to the operator's real data volumes.
- Chrome only, one 144 Hz desktop machine. No Firefox, no Safari, no phone.
- The CSS `prefers-reduced-motion` gate could not be forced in-browser
  (chrome-devtools exposes no control for it). The JS gate and the
  `data-motion` twin were both verified live.
- `applyProfile` rewrites the dialect wholesale from a saved profile,
  `header_row`/`preamble_rows` included, without clearing `overrides` — the
  row-key defect is re-reachable on that path. Pre-existing, documented, not
  flagged by any review, left for a later phase.
