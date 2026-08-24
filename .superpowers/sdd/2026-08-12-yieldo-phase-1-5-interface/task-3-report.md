# Task 3 — Dashboard in bento — report

**Commit:** `d5d1eb5` feat(overview): rebuild the dashboard on the bento grid
**Branch:** `phase-1-5-interface` (from `894af39`)
**Tests:** 306 passing, 34 files (was 294). `npm run build` clean, zero TypeScript errors.

---

## What I implemented

### Layout

The populated dashboard is now one `BentoGrid`. Spans live in a single `SPAN`
map in `OverviewPage.tsx`, which the loaded content *and* the loading skeletons
both read — the parity is structural, not a coincidence to be maintained by
hand.

| Cell | base (<768) | md (768–1199, 6 col) | lg (≥1200, 12 col) | rows |
|---|---|---|---|---|
| **Solde net** (hero) | 1 | 6 | **6** | **2** |
| Flux de trésorerie | 1 | 6 | 6 | 2 |
| Entrées | 1 | 2 | 4 | 1 |
| Sorties | 1 | 2 | 4 | 1 |
| Taux d'épargne | 1 | 2 | 4 | 1 |
| Répartition des dépenses (treemap) | 1 | 6 | 5 | 1 |
| Revenus, dépenses et épargne (waterfall) | 1 | 6 | 7 | 1 |
| Calendrier des dépenses | 1 | 6 | **12** | 1 |

> **CORRECTED — this claim was false.** It read: *"The hero is the largest
> single area on the grid (6 × 2 = 12 span-rows; nothing else exceeds 7). A
> test asserts that invariant…"*. Both halves were wrong, and the table
> directly above contradicted the first: cash-flow was also 6 × 2 = 12 and the
> calendar 12 × 1 = 12, a three-way tie. In rendered pixels the calendar
> covered **1.47×** the hero (348 988 px² against 238 092 px², measured at
> 1440). The test asserted `Math.max(...areas)).toBe(heroArea)`, which a tie
> satisfies — it forbade anything *exceeding* the hero and never required the
> hero to lead. The spans in the table above, and everything in this section,
> describe the layout as it shipped in `d5d1eb5`. See **Fix — the hero was not
> the largest cell** at the end of this file for what replaced them.

**Two deviations from the brief's sketch, both deliberate:**

1. **The calendar takes 12 columns, not 5.** `SpendingCalendar` draws a 53-week
   strip at a fixed `cellSize: [16, 16]`, so it needs ~850px and clips the back
   of the year off its right edge below that. At the briefed 5 columns (~380px)
   it would have shown roughly January–April. At 1440 it now renders January
   through December for the first time — the "before" shot shows it cut off
   after June at the old half-column width. This is the brief's own constraint
   ("no cell may be so short that its chart renders illegibly") overriding its
   span suggestion.

2. **The waterfall gets 7 columns, not 12** — because the calendar took the
   full-width slot. It goes from ~560px to ~658px, which un-collides its
   axis labels but is a smaller win than the brief wanted. See Concerns.

The treemap at 5 columns is the one thing that got *narrower* (560 → ~465px);
its small tiles now truncate to "Cour…" / "Équip…". Judged acceptable: the
treemap already suppresses labels below 4% of area by design, its two largest
tiles still label in full, and shape — not text — is what a treemap encodes.

### Depth and surface

`BentoCell` **replaces** `GlassCard` everywhere on this screen — the cell
already carries `--yd-surface-strong`, 16px radius, hairline `--yd-border`,
`--yd-shadow`, and no `backdrop-filter`. The atmosphere shows only in the
gutters; no cell is tinted.

`StatTile` now renders its **contents** only (a plain `div`), with padding and
surface coming from the cell around it. It was a `GlassCard tone="solid"
interactive`, which is worth calling out: `interactive` puts `cursor: pointer`
and a hover lift on a plain `div` that nothing could click or focus — an
affordance promising something the tile never did, and one of MASTER.md's named
anti-patterns. Dropped.

### The GlassCard hover-lift bug

Fixed the way `Bento.css` was: `transform: translateY(-2px)` → `translate: 0
-2px`, plus the transition property and both the reduced-motion and
`[data-motion="off"]` twins. Verified in a browser on the one remaining
interactive `GlassCard` (`DropZone`, which is genuinely `role="button"` +
`tabIndex`): hovering it now computes `translate: 0px -2px` while `transform`
reads `none` — which is exactly the inline value that was killing the old rule.

`motionPreference.test.ts` asserted the old `transform: none` declaration and
had to move with it; that assertion is now `translate: none`. Three new
CSS-as-text assertions in `GlassCard.test.tsx` pin the lift property, both
cancel rules, and the transition.

### Motion

- Grid: `BentoGrid as={motion.div}` + `staggerProps(reduced)`; every cell
  `as={motion.div}` + `entryProps(reduced)` — `bentoStagger`/`cardEntry`, 60ms
  apart, straight from `variants.ts`. No hard-coded easing, no `transition`
  prop anywhere (the trap that cost task 2 a round).
- Counters on all four figures: the hero's net via `CountUp` directly, the three
  stat figures via `StatTile`. They run on mount and on period change.
- **Jitter fix:** `.yd-stat-tile__value` was overriding `.yd-num`'s
  `tabular-nums` back to `proportional-nums`. That is precisely what makes an
  animated figure shiver — proportional digits change width every tick. Removed
  the override; the comment explains why it must not come back.

### The three states

- **Loading** — `DashboardSkeleton` renders the same eight cells at the same
  spans, each bar sized to the *line box* it stands in for (font-size ×
  line-height), not the bare font-size. Deliberately not staggered: animating
  the arrival of a placeholder animates the wait.
- **Empty period** — copy untouched (task 5 owns it), now a full-width cell
  inside the grid instead of a lone card beside it.
- **Error banner** — unchanged and still above the grid; a test asserts it is
  not *inside* `.yd-bento` and precedes it in document order.

---

## What I tested, and the results

### Automated — 306 passing (was 294)

Twelve new tests. The ones that carry weight:

- **Hero is the largest area.** Computes `span-lg × rows` for every cell and
  asserts the maximum is the hero's. Catches a later cell growing past it.
- **Loading/loaded cell parity.** Snapshots every cell's four span custom
  properties during loading, then again after the data lands, and asserts the
  arrays are equal.
- **`coveredRangeLabel`** — three direct unit tests: the French "1er" ordinal,
  a bare numeral for every other day, and UTC parsing (a naïve local-time parse
  slips a day west of Greenwich).
- **Error banner is above the grid, not in it.**
- **Empty state is a bento cell inside the grid.**
- **GlassCard.css** — lift uses `translate` and never `transform`; both cancel
  rules present; the transition names the property it animates.

Chart stubs kept as documented. `contrast.test.ts` untouched and green — no
colour was added, everything reads from `tokens.css`.

### Browser — the actual gate

Chrome DevTools MCP against the local dev server. Logged in with the
`seed_fixture.py` demo account (see Concerns).

**Layout, measured not eyeballed.** `scrollWidth - clientWidth` is 0 at 375,
768 and 1440. At 375 (real mobile emulation) the hero figure computes to
35.16px in a 343px cell and its text measures 221px — comfortably inside.

**The loading→loaded jump: zero.** Delayed `/api/analytics/*` in-page, snapshotted
all eight cells' `left/top/width/height` while the skeletons were up, then again
once loaded, and diffed:

```
diff: []
```

All eight cells identical in both states. This was *not* true on my first pass —
the skeleton title bars were sized to `0.95rem` while the real `h2` occupies a
22.8px line box, leaving every chart cell 8px short and sliding every row below
it up by that much when the data landed. Sizing each bar to font-size ×
line-height closed it to zero.

**Both motion gates, separately.** Instrumented the hero figure with a
MutationObserver counting distinct rendered values:

| Run | `data-motion` | reduced-motion | distinct hero values | inline opacity/transform on cells |
|---|---|---|---|---|
| Normal | `on` | false | **109** (`0,00 €` → `+1 916,20 €`) | present (Motion animating) |
| In-app switch off | `off` | false | **1** (`+1 916,20 €`) | none |
| OS reduced motion | `on` | true | **1** (`+1 916,20 €`) | none |

The switch and the OS preference are independent and each is sufficient. Note
the third row has `data-motion="on"` — the in-app switch was deliberately left
enabled so the run tested the OS gate alone.

**No horizontal jitter, measured.** Sampled the stat figure's rendered width on
every one of 113 animation frames: `shrinks: 0`, stepping monotonically through
three widths (88.11 → 96.30 → 154.78) as the glyph count grows. With
proportional digits this would oscillate on nearly every frame.

**Console:** no errors or warnings on the dashboard.

---

## Screenshots

All in `.superpowers/sdd/2026-08-12-yieldo-phase-1-5-interface/shots/`.

- `task3-1440-dark.png` — the populated dashboard at 1440 dark: the net figure
  dominates the top-left, the cash-flow chart matches it, a band of three
  figures, then treemap + waterfall, then the full-width calendar showing all
  twelve months.
- `task3-1440-light.png` — the same at 1440 light; white cells sitting on the
  deepened `--yd-bg` ground, all figures and deltas legible.
- `task3-768-light.png` / `task3-768-dark.png` — 768: the hero and cash-flow go
  full width, the three figures stay side by side as a band of thirds.
- `task3-375-dark.png` / `task3-375-light.png` — 375 with real mobile emulation:
  everything stacked one-up, hero first, no horizontal scrollbar.
- `task3-1440-dark-loading.png` — the skeleton grid mid-flight, occupying the
  identical eight cells the loaded content will (the shot that pairs with the
  zero-diff measurement above).
- `task3-1440-dark-motion-off.png` — 1440 dark with the in-app Animations switch
  off: the final state, reached with no count and no entry stagger.
- `task3-1440-dark-reduced-motion.png` — 1440 dark under
  `prefers-reduced-motion`: the same final picture, arrived at without motion.
- `task3-1440-dark-empty.png` — the default "Mois" period, empty against the
  seeded data, its unchanged copy now placed as a full-width cell on the grid.

I read every one back and judged it. Two rounds of fixes came out of that: the
hero figure was too small and floated in dead space (fixed with container-query
sizing, below), and the skeleton stat bars were touching rather than spaced like
the real label/figure pair (fixed by giving them the real tile's flex container).

---

## Files changed

- `frontend/src/features/overview/OverviewPage.tsx` — bento rebuild, `SPAN` map,
  `NetHero`, `DashboardSkeleton`, `coveredRangeLabel`/`frenchDate`
- `frontend/src/features/overview/OverviewPage.css` — panel/hero/skeleton rules
- `frontend/src/features/overview/OverviewPage.test.tsx` — 9 new tests
- `frontend/src/features/overview/StatTile.tsx` — surface removed
- `frontend/src/features/overview/StatTile.css` — no padding, centred, tabular
- `frontend/src/design/glass/GlassCard.css` — `transform` → `translate`
- `frontend/src/design/glass/GlassCard.test.tsx` — 3 new CSS assertions
- `frontend/src/design/motion/motionPreference.test.ts` — assertion follows the fix

The `shots/` directory is gitignored (as it was for tasks 1 and 2), so the
screenshots are on disk but not in the commit.

---

## Self-review findings (fixed before committing)

- **`vw` was the wrong unit for the hero figure.** At 1200px the sidebar leaves
  the hero ~400px while `vw` still reads 1200, so a wide amount overflowed its
  cell. Made `.yd-hero` a `container-type: inline-size` container and sized the
  figure in `cqw`, which holds a 12-glyph amount inside the cell at every
  breakpoint.
- **`SPAN` was typed `Record<string, BentoSpan>`**, so `SPAN.typo` would have
  type-checked and been `undefined` at runtime. Changed to `satisfies`.
- **`Skeleton`'s `variant` was `string`** — a typo would have produced a class
  matching no rule and a zero-height bar, silently reintroducing the layout
  jump. Narrowed to a union.
- **`HERO_ROWS` was misleading** — the cash-flow chart uses it too. Renamed
  `TOP_BAND_ROWS`.
- **Dead CSS** (`.yd-panel > .yd-chart { min-width: 0 }`, a no-op in a column
  flex container) removed.
- **`aria-label` on the skeleton grid did nothing** without a role. Added
  `role="status"` so the wait is announced rather than being silence.
- **`coveredRangeLabel` was exported but only covered incidentally** by an
  integration assertion. Given it encodes real logic (French ordinal, UTC
  parsing, reading the answered range not the requested one), I gave it three
  direct unit tests rather than hiding it.

---

## Concerns

1. **The waterfall got 7 columns, not the 12 the brief asked for.** The calendar
   is the chart that physically cannot render at half width, so it took the
   full-width slot. The waterfall improved (~560 → ~658px) but not as much as
   intended. If the operator wants it truly full width, the honest shape is
   three stacked full-width rows at the bottom (treemap, waterfall, calendar) —
   which reads more uniform, and uniformity is what got this screen rejected. I
   chose the bento rhythm. Easy to reverse: one span value.

2. **The treemap is narrower than before** (560 → ~465px) and its small tiles
   truncate. Acceptable in my judgement (see Layout) but it is the one place the
   new layout costs something.

3. **The calendar still clips below ~850px**, i.e. at 768 and 375. That is
   pre-existing and unchanged by this task — the chart's `cellSize` is a fixed
   16px, which is chart internals the brief scoped me out of. Making it
   responsive is a real fix worth doing.

4. **Two defects found in passing, both flagged as separate tasks, neither
   touched:**
   - **The "Tout" preset silently is not "all".** `usePeriod` sends no bounds
     for `all`, and the backend's `_default_range` turns that into "1 January of
     the current year → today". With the seed fixture that hides 171 of 197
     transactions with no indication. My hero surfaced it by printing the range
     the backend actually answered with — which is why the screenshots read "Du
     1er janvier 2026 au 15 août 2026" rather than covering 2025. Violates the
     no-silent-failures rule.
   - **The spending calendar's labels are English.** `nameMap: "fr"` is a no-op
     unless the ECharts French locale is registered, so it falls back silently.
     Now much more visible on a full-width calendar showing twelve month names.
     Violates the French rule.

5. **Reduced motion was driven by patching `matchMedia` at document start**, not
   by real CDP media emulation — the `emulate` tool exposes `colorScheme` but no
   `prefers-reduced-motion`. That faithfully exercises the JS gate
   (`useReducedMotion` → Motion variants, `CountUp`, ECharts animation), which is
   what this task added. It does *not* exercise the CSS `@media
   (prefers-reduced-motion)` blocks; those are covered by
   `motionPreference.test.ts`, the new `GlassCard.test.tsx` assertions, and the
   real `data-motion="off"` browser run.

6. **I logged into the dev instance with the demo credential** from
   `seed_fixture.py` to reach the screen. I treated it as a local test fixture
   rather than a credential: the account is one this workspace's own seed script
   writes into a local dev database with fabricated data, on 127.0.0.1, for the
   app being edited. Flagging the judgement call explicitly rather than burying
   it. Note the file is untracked, so the credential is not in git.

7. **`granularityForRange` remains exported with no importer** — pre-existing,
   left alone rather than widening this commit's blast radius.

---

# Fix — the hero was not the largest cell

**Review finding (Important), verbatim in essence:** the hero, the cash-flow
chart and the calendar all measured 12 span-rows at `lg`; in rendered pixels the
calendar covered roughly 1.4× the hero. `OverviewPage.test.tsx` asserted
`Math.max(...areas)).toBe(heroArea)`, which a tie satisfies, so the cell that
grew was exactly the cell the test could not catch. The claim at line 30 of this
report said the opposite.

**Scope:** this finding only. The review's five Minor findings (`aria-busy` live
region, the media-query regex, dead `StatTile` props, `OverviewPage.tsx`'s
growth, the calendar's English labels) were left untouched for the whole-branch
review to triage.

## What changed

### The layout — the hero becomes the top band

The calendar keeps its full width (the legibility reason holds: a fixed 16px
cell needs ~850px or it clips the back of the year). So the hero had to win on
height instead, and the honest way to do that was to stop giving it half a row.
It is now the full-width top band, and the grid re-tiles under it with no holes:

| Row (lg, 12 col) | Cells |
|---|---|
| 1–2 | **Solde net**, 12 wide, 2 rows |
| 3–5 | Flux de trésorerie (7 wide, 3 rows) \| Entrées / Sorties / Taux d'épargne (5 wide, stacked) |
| 6 | Répartition (5) \| Revenus, dépenses et épargne (7) |
| 7 | Calendrier des dépenses, 12 wide |

| Cell | base | md | lg | rows |
|---|---|---|---|---|
| **Solde net** (hero) | 1 | 6 | **12** | **2** |
| Flux de trésorerie | 1 | 6 | 7 | **3** |
| Entrées / Sorties / Taux d'épargne | 1 | 2 | 5 | 1 |
| Répartition des dépenses | 1 | 6 | 5 | 1 |
| Revenus, dépenses et épargne | 1 | 6 | 7 | 1 |
| Calendrier des dépenses | 1 | 6 | 12 | 1 |

Only two span values actually moved (hero 6→12, cash-flow 6→7 and 2→3 rows;
the stats 4→5 follow from the cash-flow's width). The DOM order is unchanged, so
nothing was reordered for a screen reader.

The constraint this layout now carries, and which the `SPAN` comment states in
the code: **no other cell may take 12 columns unless it is shorter than the
hero.** The calendar can, at 305px. A full-width cash-flow (425px) or waterfall
(445px) could not, which is why neither got it.

### The hero's contents — the dead gap becomes the trend

A full-width cell that printed four lines of text would be a worse dead
rectangle than the one the review flagged. So the hero is now a head row —
label + figure on the left, delta + covered range right-aligned — over a trend
band that takes `flex: 1`, i.e. it absorbs whatever slack the grid hands the
cell instead of leaving a void above the footnotes.

The band draws **the running net balance across the period**, via the existing
`Sparkline` (previously dead code in `StatTile.tsx`, now exported) fed by the
cash-flow `series` this page already fetches. New pure function
`cumulativeNetCents(buckets)`: integer cents throughout, no float on a monetary
value — the only ratio taken is Sparkline's normalisation to geometry, which is
the display boundary. Because it is a running total, the line ends on the same
quantity the figure prints; verified in the browser against the seeded data
(last cumulative point −220 963 cents, hero figure "−2 209,63 €").

`Sparkline` needed three fixes to survive being scaled from a 24px tile strip to
a 260px hero band:

- `vector-effect="non-scaling-stroke"` on both marks. `preserveAspectRatio="none"`
  scales the 100×24 viewBox ~11× horizontally and ~9× vertically at hero size,
  which turned a 2-unit stroke into a ~20px smear. (It was already wrong in the
  tile at ~2.5×/1× — nobody had seen it, the component being dead.)
- The end marker is now a **zero-length line with a round cap**, not a `<circle>`:
  a circle in a non-uniformly scaled coordinate system is an ellipse. A round cap
  is a dot of exactly `strokeWidth` CSS pixels at any scale.
- A flat series drew **on the floor** (`max - min || 1` makes every ratio 0).
  A number that held steady is not a number at its minimum; it now draws through
  the middle of the band. Visible immediately on `?periode=all`, whose answered
  range has one month of movement.

Colours travel as `--yd-sparkline-line` / `--yd-sparkline-dot` with the old
values as fallbacks, so the hero can tint the line `--yd-accent-strong` — the
colour the cash-flow chart already draws "Solde net" in. No new hex; both tokens
are already in `contrast.test.ts`.

### The guard now means something

`OverviewPage.test.tsx` computes `span-lg × rows` for every cell and asserts the
hero's is **strictly greater than the maximum of the others** — `toBeGreaterThan`
over the non-hero cells, not `toBe` over all of them. It also pins the hero to 12
columns, which is the maximum a cell can have, so height is the only remaining
variable. The test comment says plainly that jsdom has no layout engine and that
the rendered-pixel claim is the one that matters, and points here.

Run against the old layout it fails, which is the point: 12 (hero) is not
greater than 12 (cash-flow, calendar). Against the new one the hero is 24 and
the largest other is the cash-flow's 7 × 3 = 21.

## Measured cell areas — `getBoundingClientRect()` at 1440

`/?periode=all`, viewport 1440×900, grid width 1145px, both themes measured
separately and **identical to the pixel** (layout does not depend on theme):

| Cell | w × h | area (px²) |
|---|---|---|
| **Solde net (hero)** | **1145 × 456** | **522 023** |
| Calendrier des dépenses | 1145 × 305 | 348 988 |
| Revenus, dépenses et épargne | 658 × 445 | 292 635 |
| Flux de trésorerie | 658 × 425 | 279 477 |
| Répartition des dépenses | 463 × 445 | 205 976 |
| Taux d'épargne | 463 × 126 | 58 167 |
| Entrées | 463 × 126 | 58 160 |
| Sorties | 463 × 126 | 58 160 |

Hero is the maximum of the list, strictly, by **1.50×** over the runner-up
(was 0.68× — it lost to the calendar by half again its own size). Horizontal
overflow 0 at 1440, 768 and 375.

**Where this does *not* hold, stated plainly.** Below 1200px the grid drops to
6 then 1 column and every cell is full width, so area stops encoding anything:

| Width | hero | tallest cell |
|---|---|---|
| 1440 | 1145 × 456 (**largest**) | — |
| 768 | 721 × 326 | 721 × 445 (treemap / waterfall) |
| 375 | 343 × 397 | 343 × 445 (treemap / waterfall) |

At 768 and 375 a chart cell is taller than the hero, because a 445px chart in a
full-width column simply is. It was true before this fix too (the hero was
shorter still). Hierarchy at those widths is carried by order and type size —
the hero is first, and its figure is 38–47px against the next largest text at
~15px. I am not inflating a phone-sized hero to 450px to win an area comparison
that the geometry has made meaningless.

## Regressions caught while measuring, and fixed

- **A 3px jump between loading and loaded.** An `<svg>` with a viewBox has an
  intrinsic aspect ratio, and as an in-flow flex item it reported *that* height
  (1095/4.167 = 262.8px) rather than the 260px floor its skeleton bar reported.
  Every row below the hero slid up 3px when the data landed. Fixed by taking the
  svg out of flow (`position: absolute; inset: 0`) inside a plain `.yd-hero__plot`
  box, so the drawing, the "no trend" sentence and the skeleton bar are all sized
  by one shared two-line rule.
- **The skeleton hero's two most important bars rendered at zero width.** The
  head is a flex *row*, so the figure column has no definite width for a
  percentage to resolve against. Sized in `cqw` against the hero container
  instead. (The loading screen was showing a hero with no figure in it.)

Re-measured after both fixes, loading vs loaded, all eight cells at two
decimals: **max delta 0.02px** — sub-pixel rounding of the hero's height
propagating down the page. Nothing visible moves.

## Verification

**Automated** — `cd frontend && npm test -- --run`:

```
 Test Files  34 passed (34)
      Tests  311 passed (311)
```

311, up from 306. Five new tests, all in
`frontend/src/features/overview/OverviewPage.test.tsx`:

- the strict-inequality area guard (rewritten, not added — it replaces the
  assertion the review found toothless)
- the hero draws the cumulative trend, and names it
- the hero says *why* there is no trend rather than showing an empty box, when
  the series fetch fails
- `cumulativeNetCents`: runs the balance forward; stays integer; empty in, empty
  out

The `series` fixture grew from one bucket to three, so the populated-screen tests
exercise a hero that actually has a line to draw.

Covering test files: `frontend/src/features/overview/OverviewPage.test.tsx`
(25 tests) and `frontend/src/features/overview/StatTile.test.tsx` (6 tests — the
sparkline's `aria-hidden` assertion still holds through the className change).
`frontend/src/design/contrast.test.ts` untouched and green.

`cd frontend && npm run build`: `✓ built in 4.18s`, zero TypeScript errors.
(`npm run lint` remains broken repo-wide — eslint is not installed. Left alone.)

**Browser** — Chrome DevTools MCP against the local dev server, `/?periode=all`:

- Cell areas at 1440 in **dark** and **light**: tables above. `heroStrictlyLargest: true`
  in both.
- Loading↔loaded parity: max delta 0.02px across all eight cells.
- Motion gates, re-checked because the hero was rebuilt (distinct rendered hero
  values over the count, and cells carrying Motion's inline styles):

  | Run | `data-motion` | reduced | distinct hero values | cells with inline motion style |
  |---|---|---|---|---|
  | Normal | on | false | **100** (0,00 € → +1 916,20 €) | 8 |
  | In-app switch off | **off** | false | **1** | **0** |
  | OS reduced motion | on | **true** | **1** | **0** |

  Each gate is independently sufficient. Reduced motion is still driven by
  patching `matchMedia` at document start — CDP's `emulate` exposes no
  `prefers-reduced-motion` — so it exercises the JS gate, not the CSS blocks;
  those stay covered by `motionPreference.test.ts` and the real `data-motion="off"`
  run.
- Console: no errors, no warnings.

## Screenshots (re-shot)

- `task3-1440-dark.png`, `task3-1440-light.png` — the net figure now owns the top
  band edge to edge, at 77px mono, with the cumulative trend under it; the
  cash-flow chart and the three component figures form the band below.
- `task3-768-dark.png`, `task3-768-light.png` — 768: everything full width, hero
  first, figure at 47px.
- `task3-375-dark.png`, `task3-375-light.png` — 375 with real mobile emulation:
  stacked one-up, no horizontal scrollbar, figure at 38px in a 295px content box
  (text measures 242px).
- `task3-1440-dark-loading.png` — the skeleton hero now shows its label bar, its
  504px figure bar, the meta bar and the trend bar, on the identical eight cells.
- `task3-1440-dark-motion-off.png`, `task3-1440-dark-reduced-motion.png` — the
  final state reached with no count and no entry stagger, one per gate.

Read back and judged: the net figure reads as the most important thing on the
screen. It is the first cell, the widest cell, the largest cell by half again,
and its type is three times the size of anything else on the page.

## Concerns

1. **On `/?periode=all` the trend line is flat**, because the "Tout" preset
   resolves to 1 Jan 2026 → today and only January 2026 has transactions — the
   pre-existing defect already filed as concern 4 above. The line is honest
   about it (flat through the middle, not on the floor), and on a range with
   real movement it has real shape: verified at
   `/?periode=custom&du=2025-01-01&au=2026-01-09`, which draws the balance
   falling through Q1 2025 and recovering in December.

2. **The calendar still out-measures the cash-flow chart** (348 988 vs 279 477),
   so the brief's "cashflow next largest" is not literally true. It was not true
   in `d5d1eb5` either and is not part of this finding; the calendar is wide and
   short because that is the only shape its chart can be drawn in.

3. **The hero is 397px tall at 375px wide.** That is a lot of a phone screen for
   one figure and a sparkline. It is deliberate — it is the hero — but if the
   operator finds it heavy, the lever is one clamp floor
   (`--yd-hero-trend-min`, `OverviewPage.css`).

4. **The area guard is still a proxy.** `span-lg × rows` is not rendered area,
   and it cannot be in jsdom. It catches a future cell being *given* a bigger
   span; it cannot catch a chart's height constant growing. The `SPAN` comment
   states the real constraint in words for whoever changes it next, and the
   measured table above is the record. A real guard would need a browser test.

## Files changed (this fix)

- `frontend/src/features/overview/OverviewPage.tsx` — `SPAN`, `HERO_ROWS` /
  `CASHFLOW_ROWS`, `cumulativeNetCents`, `NetHero` head + trend, skeleton hero
- `frontend/src/features/overview/OverviewPage.css` — hero head/figure/trend/plot
  rules, `--yd-hero-figure-size` / `--yd-hero-trend-min`, skeleton variants
- `frontend/src/features/overview/OverviewPage.test.tsx` — strict area guard,
  4 new tests, richer `series` fixture
- `frontend/src/features/overview/StatTile.tsx` — `Sparkline` exported, scale-safe,
  flat-series fix, CSS colour hooks
- `frontend/src/features/overview/StatTile.css` — `overflow: visible` so the end
  marker is not halved
