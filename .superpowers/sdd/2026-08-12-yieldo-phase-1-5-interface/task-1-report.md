# Task 1 — Visual foundations — report

**Status:** DONE_WITH_CONCERNS
**Branch:** `phase-1-5-interface`
**Commit:** `98227a0` — feat(design): add atmospheric background, bento grid and motion primitives

---

## What I implemented

### 1. Signature easing
`--yd-ease: cubic-bezier(0.16, 1, 0.3, 1)` in `tokens.css`, with a single JS twin
`SIGNATURE_EASE = [0.16, 1, 0.3, 1] as const` exported from `motion/variants.ts`.
`fadeInUp`, `slideOver`, `cardEntry`, `CountUp.tsx` and `PeriodSelector.tsx` all
reference it. `[0.22, 1, 0.36, 1]` no longer appears anywhere under `frontend/src`
(verified by grep — `PeriodSelector.tsx` was a fourth site the brief did not list).

A test parses `tokens.css` from disk and asserts `--yd-ease` and `SIGNATURE_EASE`
carry the same four numbers, so the CSS and JS sides cannot drift.

### 2. Radius
`--yd-radius: 16px`, `--yd-radius-sm: 10px`.

### 3. Atmospheric background
`design/atmosphere/AtmosphericBackground.tsx` + `.css` + test. Fixed layer at
`inset: 0`, `z-index: 0`, `pointer-events: none`, `aria-hidden="true"`, carrying
`--yd-bg-gradient` and three blobs at the exact sizes, positions, blurs, tints and
opacities (0.12 / 0.09 / 0.08) from the brief. Blobs are two elements each: the
wrapper holds the blur and the final opacity, the fill holds the tint and the
animation — so no keyframe ever touches `filter`. Only `transform` is animated
(28s / 36s / 44s, `ease-in-out`, `alternate`, negative delays of −6s / −19s / −3s so
they never move in lockstep).

Mounted in `AppShell` as a **sibling** of the content; `.yd-shell__sidebar--static`
and `.yd-shell__body` get `position: relative; z-index: 1`. This is why phase 1's
mesh background was invisible: it sat at `z-index: -1`, underneath `.yd-shell`'s own
opaque background.

Reduced motion: `useReducedMotion()` drops the `--animated` class entirely (no
animation object at all), plus a `@media (prefers-reduced-motion: reduce)` block
that repeats the selectors at full specificity so it wins before hydration.

### 4. Bento primitives
`design/bento/BentoGrid.tsx`, `BentoCell.tsx`, `Bento.css` + tests. 1 / 6 / 12
columns at `<768` / `≥768` / `≥1200`. Spans travel as inline custom properties
(`--yd-cell-span-base/-md/-lg`, `--yd-cell-rows`) consumed by media queries — never
an inline `grid-column`, which would beat every media query. `base` defaults to 1,
`md` to 6, `lg` to `md`. Opaque surface, `min-width: 0`, hover lift + stronger
border, `cursor: pointer`, visible focus ring.

### 5. Card-entry motion
`cardEntry` and `bentoStagger` variants, plus two helpers: `staggerProps(reduced)`
for the container (owns the timeline) and `entryProps(reduced)` for the item
(carries `variants` only — an item that declares its own `animate` opts out of the
parent's stagger and fires on mount). Both return `{}` under reduced motion. The
pattern is documented in a doc comment and used verbatim in the demo route.

### 6. Demo route
`/design-systeme`, inside the authenticated shell, absent from the sidebar, and
registered only when `import.meta.env.DEV` is true. Seven cells with lg spans
6 / 3 / 3 / 3 / 3 / 4 / 8 and one cell spanning 2 rows — every lg row sums to
exactly 12, so the grid has no holes. French captions throughout, one `CountUp`
figure in mono tabular numerals, one interactive `<button>` cell.

---

## The defect the browser caught that the tests could not

**The hover lift did not work at all.** `Bento.css` originally used
`transform: translateY(-2px)` on `:hover`. A cell rendered as a `motion.*` element —
which is exactly how the demo, and every screen in tasks 2–5, renders them — carries
an **inline `transform: none`** that Motion writes when the entry animation settles.
An inline declaration beats a stylesheet rule, so hovering did nothing.

The CSS test asserting `transform: translateY(-2px)` passed the whole time. I only
found it by reading `getComputedStyle(...).transform` in the live page and getting
`"none"` while `:hover` matched.

Fixed by using the independent `translate: 0 -2px` property, which Motion does not
write. Verified live: hovered cell top = 227px, neighbour top = 229px — a real 2px
lift with no layout shift. The test now asserts `translate` and explicitly asserts
`transform:` is *absent* from the hover rule.

This is the single best illustration of why this phase exists.

---

## What I tested, and the results

- **`npm test` — 247 passed / 247, 30 files.** Was 215 before; I added 32 tests
  (8 variants, 8 atmosphere, 12 bento, 4 demo page). `contrast.test.ts` stays green —
  the new gradient and `rgba()` tokens are skipped by its `#rrggbb`-only parser, as
  expected.
- **`npm run build` — zero TypeScript errors.** (Pre-existing >500 kB chunk warning
  only.)
- **`npm run lint` — CANNOT RUN.** `eslint` is not installed and there is no eslint
  config in `frontend/`. This script has been broken since phase 1; not something I
  introduced and not something I fixed. See concerns.
- **Live browser measurements** (not just screenshots):
  - `--yd-ease` resolves to `cubic-bezier(0.16, 1, 0.3, 1)`; cell radius 16px;
    atmosphere `z-index: 0`; blob A opacity 0.12; gradient resolves to the specified
    three stops.
  - Entry stagger sampled per frame: cells cross opacity 0 at 260 / 332 / 393 / 462 /
    546 ms — a clean ~60 ms cascade, all at 1.0 by 906 ms.
  - Reduced motion (via the in-app Animations switch): all three blob fills report
    `animationName: "none"` and `transform: "none"` — genuinely static, not a 0 ms
    animation.
  - Focus: `:focus-visible` matches, outline `2px solid rgb(126,226,214)`, offset 2px,
    `cursor: pointer`, real `<button type="button">`.
  - No horizontal overflow at 375px (`scrollWidth === innerWidth === 375`).
  - Frame timing over 2.5 s with the blobs animating: median 6.9 ms, p95 7.0 ms,
    worst 7.2 ms, **zero** frames over 20 ms.
  - Zero console errors or warnings.

---

## Screenshots

All in `.superpowers/sdd/2026-08-12-yieldo-phase-1-5-interface/shots/`.

| File | What it actually shows |
|------|------------------------|
| `task1-1440-dark.png` | The 12-column layout at rest: a 6-wide 2-row cell on the left, 3/3 above 3/3 on the right, 4/8 across the bottom — visibly asymmetric, and the background carries a clear teal wash upper-left and a blue one at the right edge, not a flat fill. |
| `task1-1440-light.png` | The same layout in the light theme; white cells separate from the pale ground by border and shadow, and the atmosphere is present but very faint (see concerns). |
| `task1-768-dark.png` | The 6-column step: full-width hero cell, then 3/3, 3/3, 2/4 — no holes, and the atmosphere reads more strongly here because the blobs cover proportionally more of the viewport. |
| `task1-768-light.png` | The same 6-column layout in light; the teal wash top-left and green tint bottom-left are both visible. |
| `task1-375-dark.png` | Single column, all seven cells stacked, no horizontal scrollbar, atmosphere glowing at the top and bottom of the scroll. |
| `task1-375-light.png` | The same at 375 in light theme; the swatch row wraps to two lines inside the hero cell rather than overflowing. |
| `task1-1440-dark-reduced-motion.png` | Motion disabled: the caption reads "Le mouvement est actuellement désactivé : rien ne doit bouger", and the blobs render at their untransformed base positions — the atmosphere is still there, just still. |
| `task1-1440-dark-hover-focus.png` | The interactive cell simultaneously hovered and keyboard-focused: teal focus ring at 2px offset, strengthened border, and its top edge sitting 2px above its neighbours. This is the post-fix state. |
| `task1-1440-dark-overview-regression.png` | The existing dashboard over the new atmosphere — nothing hidden, nav active state intact, and the GlassCard's `backdrop-filter` finally has something to blur. |

I read every one of these back and judged them. Two shoots were redone: the first
1440 dark pass (taken before the hover fix) and the initial full-page capture, which
mis-framed the fixed layer.

---

## Self-review findings

- **Fixed during review:** the hover rule carried `box-shadow: var(--yd-shadow)`,
  identical to the resting value — a dead declaration, plus a matching dead entry in
  the `transition` list. Both removed. `.yd-atmosphere__blob-fill` had a
  `border-radius: 50%` that clipped nothing (the gradient fades to transparent at 70%,
  inside the box). Removed.
- **Scope:** 7 files modified, 8 added. Nothing outside the task was restructured.
  `PeriodSelector.tsx` is the one file touched beyond the brief's list, because the
  brief requires the old easing literal to appear nowhere under `frontend/src`.
- **Naming:** I chose `staggerProps` / `entryProps` over the brief's single
  `entryProps` because one function cannot serve both roles — a child that declares
  `animate` silently opts out of the parent's stagger. Documented in the doc comment.
- **`type` prop on `BentoCell`:** added explicitly rather than widening the props to
  `ButtonHTMLAttributes`, so a cell rendered as a button can't silently default to
  `type="submit"`.
- **Test quality:** the CSS-text tests are a deliberate compromise. jsdom applies no
  stylesheets, so they read the file as text with comments stripped (a comment
  mentioning `backdrop-filter` initially failed the "no backdrop-filter" assertion —
  caught and fixed). They catch regressions in specific rules; they emphatically do
  **not** prove the rule has any effect, as the hover bug proved.

---

## Concerns

1. **Geist and Geist Mono are not shipped, and never have been.** `tokens.css` has
   named them since phase 1, but there is no `@font-face`, no font file anywhere in
   the repo, and no `<link>` in `index.html`. I measured it in the page: text rendered
   with `font-family: Geist` is pixel-identical to text rendered with a deliberately
   bogus family, i.e. every screen has been falling back to the system UI font. The
   "Geist Mono tabular figures" the plan relies on for every money column do not
   exist yet. **Not fixed** — self-hosting a font family means vendoring binary assets
   and a licensing decision, which is outside this task and needs the operator. This
   should be its own task before task 3 rebuilds the dashboard on animated figures.

2. **The light theme's atmosphere is close to invisible at 1440px.** It is exactly to
   spec — the brief pins both the gradient stops (`#eef6f8` → `#f2f7f9` → `#e9f2f5`,
   which span only a few units of luminance) and the 0.08–0.12 opacity band. But over
   white cells on a near-white ground, the result reads flatter than the dark theme.
   It is more convincing at 768 and 375, where the blobs cover more of the viewport.
   Worth an explicit look from the operator before tasks 2–5 build on it.

3. **`npm run lint` is a broken script.** `eslint` is not in `devDependencies` and
   there is no config file. The brief's verification section asks for it; I could not
   run it. Pre-existing since phase 1.

4. **`body::before` in `index.css` is now redundant and is not gated by the in-app
   switch.** It is the old mesh layer. Inside the shell it is invisible (the shell's
   opaque background covers it), but it keeps animating forever, and unlike the new
   atmosphere it only respects the CSS media query, not the Réglages "Animations"
   switch — with motion disabled in-app, `document.getAnimations()` still reports it
   running. I left it because it is the login page's only background and task 2 rebuilds
   the public routes. Task 2 should replace it with `AtmosphericBackground` and delete it.

5. **`GlassCard` has the same latent hover bug** as the one I fixed in Bento: its
   `.yd-glass--interactive:hover` uses `transform: translateY(-2px)`, which would be
   dead the moment anyone renders a `GlassCard` as a `motion.*` element. It is latent
   today (nothing does), so I left it rather than change a shared primitive I would
   then have to re-verify on every screen using it. Flagging it for whoever touches
   GlassCard next.

6. **The demo page's CSS ships in the production bundle.** `import.meta.env.DEV`
   removes the route and lets Rollup tree-shake the component, but the `import
   "./DesignSystemPage.css"` side effect survives. It is a handful of rules; noting it
   rather than adding a lazy-import dance for it.

---

# Task 1 — follow-up fix pass

**Status:** DONE_WITH_CONCERNS
**Branch:** `phase-1-5-interface`
**Commit:** on top of `98227a0`

Three items handed back by the task author: ship the fonts, make the atmosphere
actually visible, and close the dead gap in the demo's first cell. All three are
defects in the brief, not in `98227a0`. Nothing already verified in the browser
(bento spans, responsive collapse, reduced motion, signature easing) was touched.

## 1. Fonts — self-hosted, nothing leaves the machine

`npm i @fontsource-variable/geist @fontsource-variable/geist-mono`, imported as a
side effect in `frontend/src/main.tsx` ahead of `./index.css`. No CDN, no Google
Fonts `<link>`, no `@import` from a remote host.

The packages register the families **`Geist Variable`** and **`Geist Mono Variable`**,
not `Geist` / `Geist Mono` — naming only the bare families is exactly how phase 1
ended up silently on the system font. `--yd-font` and `--yd-font-mono` in
`tokens.css` now lead with the Variable names and keep the bare names behind them
as a fallback. `charts/theme.ts` repeats the same two stacks, because ECharts draws
to canvas and cannot read a custom property; both were updated in step.

Measured in Chrome at 1440, `/design-systeme`:

- `getComputedStyle(document.body).fontFamily` →
  `"Geist Variable", Geist, ui-sans-serif, system-ui, sans-serif`; the `CountUp`
  figure and every `.yd-num` resolve to
  `"Geist Mono Variable", "Geist Mono", ui-monospace, "SF Mono", monospace`.
- `document.fonts.check('16px "Geist Variable"')` and the mono equivalent both
  `true`; the latin faces of both families report `loaded`.
- The font is *used*, not merely declared: a canvas measurement of the same string
  gives 305.7 px in Geist Variable against 272.9 px in a deliberately bogus family.
- Network, `resourceTypes: ["font"]` — exactly two requests, both local:
  `http://localhost:5173/node_modules/@fontsource-variable/geist/files/geist-latin-wght-normal.woff2`
  and the `geist-mono` twin. `performance.getEntriesByType('resource')` over all
  79 resources reports **zero distinct origins other than `location.origin`**.
  The cyrillic/vietnamese/latin-ext faces are declared but never fetched — their
  `unicode-range` never matches.
- `npm run build` emits all twelve woff2 into `dist/assets/` (167 kB total,
  29.4 kB for latin Geist, 23.1 kB for latin Geist Mono).
- Tabular figures hold: with the figure's computed font, the eight-glyph runs
  `00000000` through `99999999` all measure **184.328125 px** — one advance width
  for all ten digits. Sampling the `CountUp` element per frame while it counts,
  every sample sharing a digit shape has exactly one width (`#,## €` → 135.938 px,
  `## ###,## €` → 241.547 px), so the only width changes are the legitimate ones
  when a digit is added. No horizontal jitter.

New covering test: `frontend/src/design/fonts.test.ts` (4 tests) asserts both
packages are runtime dependencies, that `main.tsx` imports them, that `tokens.css`
leads with the family names the packages actually register, and that no CDN host
appears in `index.html`, `tokens.css` or `main.tsx`. jsdom loads no fonts, so this
is text-level wiring only — it catches "named but never shipped", which is the
defect that survived twenty-three tasks.

## 2. Atmosphere — raised to the author's pinned values

`tokens.css` and `AtmosphericBackground.css`, exactly as specified:

| | before | after |
|---|---|---|
| dark tint A / B / C | 0.55 / 0.42 / 0.40 | **0.95 / 0.80 / 0.85** |
| light tint A / B / C | `rgba(11,109,99,.30)` / `rgba(29,78,216,.20)` / `rgba(14,113,80,.22)` | **`rgba(11,109,99,.55)` / `rgba(29,78,216,.40)` / `rgba(14,113,80,.42)`** |
| element opacity | 0.12 / 0.09 / 0.08 | unchanged (inside the plan's band) |
| falloff | `transparent 70%` | **`transparent 62%`** |
| sizes | 46vw/380 · 38vw/320 · 30vw/260 | **54vw/460 · 44vw/380 · 36vw/300** |

Verified live: blob A is 460 px at 375 px wide (the `max()` floor holds), its fill
computes to `radial-gradient(circle, rgba(126,226,214,0.95) 0%, rgba(0,0,0,0) 62%)`,
and the three element opacities read 0.12 / 0.09 / 0.08.

New covering tests in `AtmosphericBackground.test.tsx` (+2): every blob's element
opacity stays inside 0.08–0.12, and every radial gradient reaches `transparent` at
or before 62%. The opacity band is the one number the plan caps, so it is the one a
future "make it brighter" pass could step over silently.

**Measured effect, decoded from the PNGs themselves** (a small zlib-based PNG
reader; sRGB relative luminance per WCAG). With the shell hidden so the layer is
visible on its own, blob A's core reads `#13262f` (L=0.0173) against a far-corner
ground of `#040c14` (L=0.0034) — a 5x luminance spread, and the teal, blue and
green halos are each individually identifiable. In the composite at 1440 dark the
visible background runs from `#0b1823` top-left to `#050c14` bottom-right.

## 3. The dead gap in "Fond atmosphérique"

`margin-top: auto` on `.yd-ds__swatches` was pinning the colour chips to the floor
of a two-row cell. Removed, with a comment saying why: the chips belong to the
caption above them, not to the bottom edge.

## Tests and commands

    cd frontend
    npm test        -> 31 files, 253 passed / 253  (was 247; +4 fonts, +2 atmosphere)
    npm run build   -> built in 4.67s, zero TypeScript errors
    npm run lint    -> STILL BROKEN, not by me: "'eslint' n'est pas reconnu en tant
                       que commande interne ou externe". eslint is not in
                       devDependencies and there is no config. Pre-existing since
                       phase 1; left alone as instructed.

`contrast.test.ts` stays green (21 tests). Zero console errors or warnings on the
demo route. No horizontal overflow at 375 (`documentElement.scrollWidth` 360 vs
`innerWidth` 375). Hover and focus still behave: `translate` computes to
`0px -2px` with `transform: none`, outline `2px solid rgb(126,226,214)` at 2 px
offset, hovered cell top 204 px against a neighbour at 206 px.

## Screenshots

All under `.superpowers/sdd/2026-08-12-yieldo-phase-1-5-interface/shots/`, all
viewport captures (a full-page capture mis-frames a `position: fixed` layer).

| File | What it actually shows |
|------|------------------------|
| `task1-1440-dark.png` | Geist throughout, the mono figure crisp and tabular; the background carries a teal lift across the top-left third and falls away to near-black bottom-right — a directional wash rather than a distinct halo, because the cores sit under the opaque sidebar and the hero cell. |
| `task1-1440-light.png` | The same layout in light: a pale teal-green tint pooling at the top-left corner and a faint cool cast down the right edge; present, but the softest of the six. |
| `task1-768-dark.png` | The 6-column step, and the best dark shot of the three — the teal halo is unmistakable behind the header and the page title, with the top-right visibly darker. |
| `task1-768-light.png` | Same breakpoint in light; the green-teal corner at the top-left and the cool tint at the right edge both read clearly against the white cells. |
| `task1-375-dark.png` | Single column, no horizontal scrollbar, the swatches wrapped to three rows inside the hero cell, and a teal glow across the whole upper third. |
| `task1-375-light.png` | The same at 375 in light; the atmosphere is proportionally strongest here, since one blob covers most of the viewport. |
| `task1-1440-dark-reduced-motion.png` | Motion off via the in-app switch: the caption reads « rien ne doit bouger », all three fills report `animationName: "none"` and `transform: "none"`, and the halo sits at its untransformed position — noticeably stronger than in the animated shot, where the drift had carried the core further under the cells. |
| `task1-1440-dark-hover-focus.png` | The interactive cell hovered and keyboard-focused at once: teal ring at 2 px offset, strengthened border, top edge 2 px above its neighbour. |
| `task1-1440-dark-overview-regression.png` | The real dashboard at `/?periode=all`, 1440 dark: KPI figures now in Geist Mono tabular, the translucent GlassCards picking up the teal wash on the left of the row and reading cooler on the right, charts and nav unaffected. |

I read all nine back. Honest verdict: at 768 and 375, in both themes, the screen
no longer reads as one flat colour — there is a light source in the upper left and
the far corner is visibly darker. At 1440 it is better than before but not yet
"distinct pooling": see concern 2. The light theme at 1440 is the weakest of the
six.

## Concerns

1. **The light theme's muted text no longer clears 4.5:1 over the halo, and the
   blob alpha is not the lever that fixes it.** Decoding the light 1440 capture,
   the background directly behind the intro paragraph (sampled in the inter-line
   band, so no glyph pixels) bottoms out at `#e7f1f2`, L=0.8631 — against
   `--yd-text-muted` (`#557184`, L=0.1541) that is **4.47:1**. With the blobs
   forced to `opacity: 0` the same pixel is `#eff6f8`, L=0.9104 → **4.71:1**. So
   the new atmosphere costs 0.24 and takes it under AA.
   The root cause is older than this change: `--yd-text-muted` against a flat
   `--yd-bg` is only **4.76:1** — 6% of headroom — so *any* darkening eats it. I
   measured light blob A at 0.48 as an experiment: 4.49:1, still short. Scaling
   linearly, the brief's original 0.30 lands near 4.58:1 — the intensity you
   already rejected as invisible. There is no blob alpha that is both visible and
   safe. The fix has to be the text token — `#4a6577` computes to 5.34:1 over the
   same pixel and 5.69:1 over flat `--yd-bg` — but that is a palette decision
   affecting every light-theme screen, so I did not make it unilaterally.
   **I shipped your values and am reporting, as instructed.**
   The dark theme is comfortable: `--yd-text-muted` over the brightest halo
   measures 6.62:1, and 7.54:1 lower down.
   Two other light-theme regions already failed *before* this change — the band
   below the grid (4.36:1) and the gap between cells (4.15:1) — from the card
   `box-shadow`, not the blobs. No text sits there today; tasks 2–5 should not
   assume that stays true.

2. **At 1440 the halo cores are covered by the chrome, so the composite reads
   softer than the layer deserves.** Blob A's core lands at roughly (273, 268),
   behind the 232 px opaque sidebar and the first bento cell. The layer itself is
   emphatically not flat — with the shell hidden the three halos are obvious — but
   at desktop width you mostly see its shoulders. The blob *positions* were not in
   the list of things you unpinned, so `top: -12vh; left: -8vw` is untouched. If
   1440 still reads too even to you, position is the lever with the most left in
   it: moving A toward the top of the content area, or B further into the right
   margin, would put a core where nothing covers it.

3. **Faint banding in the isolated layer.** Scanning the green channel across
   blob A, most steps advance one unit every 11–15 px, with one 31 px plateau —
   the usual 8-bit quantisation of a very low-contrast gradient; Chrome dithers
   part of it. I could not see it in any composite screenshot, because the visible
   background is broken up by cells, but it would show on a large empty screen
   (the login page, once task 2 puts the atmosphere there). A noise overlay is the
   standard remedy if it ever surfaces.

4. **The two-row hero cell on the demo route now has trailing empty space.** The
   chips moved up under the caption as asked, so the gap moved from the middle of
   the cell to its bottom. A cell spanning two rows cannot size to its content, so
   the alternatives were: leave the hole at the bottom (chosen), or drop `rows={2}`
   and leave a six-column hole in the grid instead. Only visible at ≥1200 px; at
   768 and 375 the cell fills.

5. **Everything here was judged on a `DEV`-only route.** Eight of the nine shots
   are `/design-systeme`. The atmosphere behind a real, dense screen rests on the
   single dashboard capture.

---

# Task 1 — second fix pass (coordinator's four rulings)

**Status:** DONE_WITH_CONCERNS
**Branch:** `phase-1-5-interface`
**Commit:** on top of `7a3c215`

## 1. Contrast wins — `--yd-text-muted` darkened in the light theme

`#557184` → `#4a6577`. Blob alphas untouched.

The same measurement as before, on the same pixels — the inter-line band directly
behind the muted intro paragraph, decoded from the 1440 light capture:

| | before | after |
|---|---|---|
| muted text over the brightest halo | `#e7f1f2` → **4.47:1** | `#e4eef0` → **5.20:1** |
| muted text, bottom band below the grid | 4.36:1 | **5.11:1** |
| muted text, gap between two cells (card shadow) | 4.15:1 | **4.68:1** |

The two regions that were failing *before* any of my changes now pass as well.
`contrast.test.ts` is greener, not worse: the token is measured against a flat
`--yd-bg` there and went from 4.76:1 to **5.69:1**. All 21 of its assertions pass.

One follow-on the test suite caught and I would have missed: `charts/theme.ts`
mirrors the palette for the canvas charts, and `theme.test.ts` asserts the mirror
matches `tokens.css` token for token. `LIGHT_TOKENS.muted` and its assertion were
updated in step, so the ECharts axis labels move with the token.

## 2. Halo cores moved into the content column

| blob | before | after | core at 1440x1000 |
|---|---|---|---|
| A | `top: -12vh; left: -8vw` | **`top: -20vh; left: 20vw`** | (677, 189) |
| B | `top: 34vh; right: -10vw` | **`top: 4vh; right: -10vw`** | (1267, 377) |
| C | `bottom: -14vh; left: 28vw` | **`bottom: -14vh; left: 38vw`** | (806, 881) |

Offsets place the *box*; the core is half a box further in, which is what made
`left: -8vw` put the brightest halo at x≈273 — under the sidebar and the first
cell. Read back from the live page, no core now sits left of x=677, and the three
are on a diagonal rather than stacked. C keeps its low position; B keeps its
right-hand one and comes up from the second row of cells to the first.

## 3. Dither

A static `.yd-atmosphere__grain` element, painted last inside the layer so it sits
above the halos and below the content. `feTurbulence` fractal noise desaturated to
grey, tiled at 200px, `mix-blend-mode: overlay`, in a `data:` URI. Network panel
confirms one request, `GET data:image/svg+xml,…`, and nothing else.

**Opacity is 0.12, not the 0.025–0.035 you suggested, and the reason is
measurable.** `overlay` scales its contribution with the backdrop, so on a
near-black ground the low values do almost nothing. Scanning the green channel
across blob A on the isolated layer, same column as the original measurement:

| | longest flat run | runs longer than 8px |
|---|---|---|
| no grain | 86 px (y=189), 149 px (y=420) | 34, 20 |
| grain 0.05 | 86 px, 149 px | 26, 20 |
| **grain 0.12** | **20 px, 14 px** | **9, 4** |

At 0.12 the noise itself measures a standard deviation of **1.05/255** in dark and
**0.91/255** in light, over a 40x40 patch — one quantisation step, which is what
dithers a contour without becoming a texture. I could not see it in any capture at
1:1, and it moves the mean by under one unit (green 19.69 → 20.12), so it does not
wash the blacks or shift any contrast measurement.

## 4. The shell brought into the system

`AppShell.css`: the sidebar and the header go from opaque `--yd-surface-strong` to
`var(--yd-surface)` with `backdrop-filter: blur(var(--yd-glass-blur))
saturate(var(--yd-glass-saturate))` and their existing hairline borders. This is
the single change that did the most: 232px of column and the whole header strip
stop being a wall in front of the atmosphere.

Two consequences I had to fix rather than discover later:

- The active nav pill was `var(--yd-surface)` — the same value the sidebar now
  carries, so it vanished into it. Hover and active are `var(--yd-surface-raised)`.
- The drawer floats over the page, not over the atmosphere. At `--yd-surface`'s
  alpha the transactions table read straight through the nav labels, so
  `.yd-shell__sidebar--drawer` takes `--yd-surface-raised`. Its open/close
  behaviour, scrim, Escape handling and inert body are untouched.

`.yd-shell__main` and everything inside it were not touched.

**Contrast over the new variable background, measured from the captures, worst
pixel in each region:**

| | dark | light |
|---|---|---|
| nav label (`--yd-text-muted`) over the sidebar | 6.51:1 | 5.91:1 |
| active nav item (`--yd-accent`) over its pill | 8.37:1 | 6.20:1 |
| `--yd-text` over the sidebar | 14.51:1 | 16.08:1 |
| header user name over the header | 6.08:1 | 5.85:1 |
| drawer nav label over the drawer | 4.83:1 | 5.52:1 |
| drawer active item | 7.82:1 | 6.11:1 |

Nothing in the chrome is below 4.5:1 in either theme.

## Tests, build, and runtime

    cd frontend
    npm test       -> 31 files, 259 passed / 259  (was 253; +6: grain data URI,
                      grain paints last, three AppShell.css assertions, drawer surface)
    npm run build  -> built in 4.89s, zero TypeScript errors
    npm run lint   -> still broken repo-wide, eslint absent, untouched

Frame timing with the blobs drifting, the grain composited and two backdrop-filter
surfaces live: 150 frames, median 6.9 ms, p95 7.1 ms, worst 13.8 ms, **zero** over
20 ms. Zero console errors or warnings. Under the in-app motion switch all three
blob fills and the grain report `animationName: "none"`.

## Screenshots

Same folder, all viewport captures, all re-shot after every change above.

| File | What it actually shows |
|------|------------------------|
| `task1-1440-dark.png` | The teal halo now pools in the upper left *through* the sidebar and header, which read as smoked glass with a vertical falloff; the top-right of the header turns cool blue and the bottom-right corner goes near-black. |
| `task1-1440-light.png` | Same layout in light: the sidebar is frosted rather than white, with a green-teal tint gathering down its lower half and a cool cast at the right edge — softer than dark, and the weakest of the six (see concerns). |
| `task1-768-dark.png` | The 6-column step; the halo is unmistakable behind the title band and the header, and the "Menu" button sits on a visibly lit ground. |
| `task1-768-light.png` | Same at 768 in light; a pale green-teal wash across the top-left third, clearly separate from the white cells. |
| `task1-375-dark.png` | Single column, no horizontal scrollbar, a strong teal glow across the header and the title. |
| `task1-375-light.png` | Same at 375 in light; the atmosphere is proportionally strongest at this width, since one blob covers most of the viewport. |
| `task1-1440-dark-reduced-motion.png` | Motion off: caption reads « rien ne doit bouger », all three fills and the grain report `animationName: "none"`, and the halo sits at its untransformed position. |
| `task1-1440-dark-hover-focus.png` | The interactive cell hovered and focused: teal ring at 2px offset, strengthened border, `translate: 0px -2px` with `transform: none`. |
| `task1-1440-dark-overview-regression.png` | The real dashboard at `/?periode=all`, dark: translucent sidebar with the active "Vue d'ensemble" pill clearly raised, teal light gathering behind the KPI row, charts and figures unchanged. |
| `task1-1440-light-overview-regression.png` | The same dashboard in light, re-shot after the `charts/theme.ts` muted change so the axis labels are the shipped colour. |

Judged honestly, read back one at a time: dark reads like an environment now at
all three widths — there is a light source, a falloff, and a dark corner, and the
chrome participates instead of blocking. 768 and 375 light both read clearly.
**1440 light is still the weak one**: better than the flat white page it was, but
"three distinguishable pools" overstates it — see concern 1.

## Concerns

1. **1440 light does not fully meet your acceptance test, and the lever left is
   the base gradient.** In the light theme the halo tints are dark colours over a
   near-white ground, so they *darken* rather than pool light; measured across the
   exposed background the whole range is L 0.856 to 0.902, and the frosted sidebar
   at 0.968 is brighter than any of it. You get modulation, not pools. Making them
   read as light would mean the base gradient sitting a little deeper so a lighter
   halo has somewhere to come from — and the base gradient (`#eef6f8 → #f2f7f9 →
   #e9f2f5`) is still pinned from the original brief. Say the word and I will
   deepen it; with the muted token now at 5.20:1 there is finally headroom to
   spend.

2. **At 1440 the bento cells still mask two of the three cores.** Even after the
   move, B's core (1267, 377) and C's (806, 881) sit under opaque cells on this
   route; only A's spills into the title band and the chrome. That is the demo
   page's own density, not the layer — the dashboard capture, whose cards are
   translucent GlassCards, shows all three participating. Tasks 3–5 should expect
   the atmosphere to read best where a screen leaves the layer some room.

3. **`backdrop-filter` now runs on two always-visible surfaces.** Frame timing is
   unaffected here (worst 13.8 ms over 150 frames), but this is a desktop Chrome
   measurement on one machine, and blur cost scales with surface area — the
   sidebar is a full-height 232px column. Worth a second look on the operator's
   own hardware before tasks 3–5 add more translucent surfaces.

4. **`body::before` in `index.css` is still the old phase-1 mesh layer**, still
   animating forever, still gated only by the CSS media query and not by the
   in-app Animations switch. Carried forward from the first report: it is the
   login page's only background, and task 2 owns the public routes.

5. **The demo route's two-row hero cell still has trailing empty space** at ≥1200px.
   Unchanged from the last pass and unchanged by anything here.

---

# Task 1 — third fix pass (the light theme's ground)

**Status:** DONE
**Branch:** `phase-1-5-interface`
**Commit:** on top of `1563db4`

## What changed

The light ground, exactly as ruled, plus one token I had to move to keep it legal.

    --yd-bg           #f2f7f9  ->  #e9f1f3
    --yd-bg-gradient  linear-gradient(155deg, #e3eef1 0%, #ecf3f5 46%, #dde9ee 100%)
    --yd-blob-a       rgba(11, 109, 99, 0.55)   ->  rgba(11, 109, 99, 0.78)
    --yd-blob-b       rgba(29, 78, 216, 0.40)   ->  rgba(29, 78, 216, 0.55)
    --yd-blob-c       rgba(14, 113, 80, 0.42)   ->  rgba(14, 113, 80, 0.58)
    --yd-text-muted   #4a6577  ->  #435d6c
    charts/theme.ts LIGHT_TOKENS.muted follows the token, as its sync test requires

Element opacities are untouched at 0.12 / 0.09 / 0.08, still inside the plan's band.

**Figure and ground now separate.** Measured across the whole 1440 light screen,
the exposed ground spans **L 0.693 to 0.958** and a `--yd-surface-strong` card
sits at **1.000**. Before this pass the ground spanned 0.856–0.902 against the
same 1.000 card — a 0.10 spread that no card could sit *on*. The spread is now
0.265, and the darkest ground is 0.31 below the card.

## The token I had to move, and why twice

You predicted this and you were right: deepening the ground cut every dark-on-light
ratio by about 5.7%. `--yd-text-muted` at `#4a6577` fell to **4.46:1** on the worst
exposed pixel. I darkened rather than lightened the ground, as instructed — but the
first correction was not enough, and I only found that by measuring every viewport
rather than stopping at 1440.

| | worst exposed pixel | ratio |
|---|---|---|
| `#4a6577` (previous pass) | 1440 cell gap, L 0.7123 | 4.46:1 |
| `#46606f` (first correction) | 375 inter-card gutter, L 0.6479 | **4.41:1** |
| `#435d6c` (shipped) | same pixel | **4.64:1** |

The 375 case is the one that matters and it is not an artefact: at that width the
cards stack, so two drop shadows overlap in every 16px gutter, over a halo. I
scanned the gutter column by column — the whole 16px band sat between 4.41 and
4.66:1, not one stray pixel. `#435d6c` clears it everywhere.

No text is ever placed in a 16px inter-card gutter, so this is a stricter bar than
WCAG actually asks for. I held it anyway: it means **no exposed pixel of the light
theme is below AA for muted text**, on any captured screen, with no caveat attached.

## Re-measured, as asked

**Token level, against the new `--yd-bg` — what `contrast.test.ts` asserts from disk:**

| token | ratio |
|---|---|
| `--yd-text` | 14.61:1 |
| `--yd-text-muted` | 6.07:1 |
| `--yd-accent` | 5.42:1 |
| `--yd-accent-strong` | 7.17:1 |
| `--yd-positive` | 5.25:1 |
| `--yd-negative` | 5.74:1 |
| `--yd-warning` | 5.83:1 |
| `--yd-info` | 5.85:1 |

All 21 assertions pass. The status colours were the closest to the edge and the
tightest, `--yd-positive`, still holds 5.25:1.

**On screen, worst pixel per region, decoded from the shipped captures:**

| region | muted `#435d6c` | `--yd-text` |
|---|---|---|
| 1440, band behind the muted intro paragraph | 5.47:1 | — |
| 1440, vertical cell gap (card shadow + halo) | 5.06:1 | 12.5:1 |
| 1440, horizontal cell gap | **4.92:1** | 11.83:1 |
| 1440, band below the grid | 5.27:1 | — |
| 1440, right margin | 5.18:1 | — |
| 768, inter-card gutter | 5.07:1 | — |
| 768, left margin | 5.28:1 | 12.70:1 |
| 375, inter-card gutter | **4.64:1** | 11.17:1 |
| 375, left margin | 5.18:1 | — |
| dashboard, ground under the tab strip | 5.24:1 | — |
| dashboard, gutter between KPI cards | 4.94:1 | — |
| dashboard, band below the chart card | 4.81:1 | — |

**Chrome, over the now-translucent sidebar and header:**

| | ratio |
|---|---|
| nav labels (muted) over the sidebar | 6.55:1 |
| active pill (`--yd-accent` on `--yd-surface-raised`) | 6.16:1 |
| header user name over the header | 6.21:1 (1440), 6.41:1 (768), 6.54:1 (375) |
| accent link on the exposed ground (dashboard) | 5.38:1 |

Nothing anywhere is below 4.5:1. The tightest number on any screen is 4.64:1.

The muted/primary tonal step survives the darkening: `--yd-text` and
`--yd-text-muted` still differ by 2.44:1, and in the 1440 capture the intro
paragraph still reads as clearly secondary to the heading above it.

## Tests and build

    npm test       -> 31 files, 259 passed / 259
    npm run build  -> built in 4.13s, zero TypeScript errors

## Screenshots — read back and judged

All ten re-shot at HEAD over the same filenames.

Light, against the same question as dark — does this look like a product someone
chose to use?

- **`task1-1440-light.png`** — Yes. The white cards now read as raised surfaces
  with a green-teal pool behind the upper left, cooler grey-blue down the right
  edge and along the bottom, and the frosted sidebar sitting in front of the light
  rather than replacing it. The eye lands on the cards because they are the
  brightest thing on screen, which is the correct hierarchy for a page whose job
  is to show figures.
- **`task1-768-light.png`** — The tint gathers across the top third and the cards
  stand off it clearly; the "Menu" button reads as a floating control rather than
  a sticker.
- **`task1-375-light.png`** — Strongest of the three, since one halo covers most of
  the viewport: a clear green-teal wash behind the title with white cards on top.
- **`task1-1440-light-overview-regression.png`** — The real dashboard. KPI cards
  and chart cards float on a tinted ground, the active nav pill is unmistakable,
  the ECharts axis labels carry the new muted token. This is the screen the
  rejection was about, and it no longer reads as a white form.

Dark, unchanged by this pass and re-shot to match HEAD: `task1-1440-dark.png`,
`task1-768-dark.png`, `task1-375-dark.png`,
`task1-1440-dark-overview-regression.png`,
`task1-1440-dark-reduced-motion.png` (all three fills and the grain report
`animationName: "none"`), `task1-1440-dark-hover-focus.png` (teal ring at 2px
offset, `translate: 0px -2px`, `transform: none`).

## Concerns

Both light-theme concerns from the last pass are closed. What remains is
unchanged and none of it belongs to this task:

1. **`body::before` in `index.css` is still the phase-1 mesh layer**, still
   animating forever, still gated only by the CSS media query and not by the
   in-app Animations switch. It is the login page's only background; task 2 owns
   the public routes.
2. **The demo route's two-row hero cell still has trailing empty space** at
   ≥1200px. Cosmetic, on an internal control screen.
3. **`backdrop-filter` on two always-visible surfaces** is measured only on this
   machine (median 6.9 ms, worst 13.8 ms, zero frames over 20 ms). Worth
   confirming on the operator's hardware before tasks 3–5 add more translucent
   surfaces.
