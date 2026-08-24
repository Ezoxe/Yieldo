# Task 2 — Public landing page — report

Commit: `3f6fc35` — feat(landing): give Yieldo a front door, and the motion
switch a CSS hook. Branch `phase-1-5-interface`, base `6b12acc`.

Frontend suite 259 → 293 tests, all green. `npm run build` clean, zero
TypeScript errors. (`npm run lint` remains broken repo-wide — eslint is not
installed and there is no config. Left alone, per the brief.)

## What I implemented

### Routing

`/` now has two faces. `app/HomeRoute.tsx` is the gate:

- session `anonymous` → `LandingPage`
- session `authenticated` → `AppShellRoute`, whose `<Outlet />` renders the
  index child `OverviewPage` — unchanged from today for a logged-in operator
- session `idle` / `loading` → neither, just the quiet loading state

The loading state was inline in `RequireAuth`; it is now
`features/auth/SessionLoading.tsx` and both places use it, so there is one
copy of the markup and one reason for it in a comment.

`HomeRoute` lives in its own file rather than in `routes.tsx` so a test can
mount it without evaluating `createBrowserRouter` and the whole screen graph.
`AppShellRoute` moved with it. `routes.tsx` is now purely declarative.
`/connexion` and `/inscription` are untouched. Every other authenticated route
keeps `RequireAuth`.

### The landing page

`features/landing/` — `LandingPage.tsx`, `LandingPage.css`,
`DashboardPreview.tsx`, `DashboardPreview.css`, `icons.tsx`, plus tests.

Section order follows MASTER.md's "Real-Time / Operations Landing":

1. **Hero** — one sentence a non-technical reader understands, both CTAs, and
   the live product preview.
2. **Ce que fait Yieldo** — six bento cells, drawn only from what phase 1
   shipped: CSV import with dialect detection and dedup, the column mapping
   the user confirms before anything is written, categorisation that learns
   from corrections, the dashboard, search and recategorisation, and the
   theme/density/motion settings.
3. **Ce que Yieldo ne fait pas** — its own section, three cells: not a bank
   aggregator, never asks for bank credentials, nothing leaves the machine.
   A fourth full-width cell marks budgets, recurring detection, multi-account
   net worth and API keys as *not in this version*.
4. **Comment ça marche** — four real steps.
5. **Closing CTA** — plus a line saying that if registration is closed on this
   instance, ask the administrator.

A primary CTA also sits in the page's own top bar, per the pattern. "Se
connecter" is a sibling of "Créer un compte" in all three places, never nested
behind it — registration can be closed server-side and the operator still has
to be able to sign in. (There is no endpoint exposing `YIELDO_REGISTRATION_OPEN`
— `backend/app/config.py:16` reads it at startup and only
`backend/app/api/auth.py:56` consults it — so the page cannot and does not
branch on it.)

Icons are inline SVG on one 24×24 / 1.6px-stroke Lucide grid. No emoji, and no
sprite fetch — the page's own claim is that nothing leaves the machine.

### The hero's live product preview

A miniature of the real dashboard built from the real primitives — `CountUp`,
`formatCents` / `formatCompactCents`, the same tokens — never a screenshot.

Figures are fabricated and **internally consistent**, which the test enforces:
inflow 246 000 c, outflow 198 740 c, so net is 47 260 c and the savings rate
19,2 %; the five category rows sum to exactly the outflow. All integer cents.

It is a `<figure>` with a `<figcaption>` reading "Exemple — données fictives.
Aperçu du tableau de bord de Yieldo ; aucun de ces montants n'est réel." Not
`aria-hidden` — that would hide the disclaimer from exactly the readers who
cannot see that the numbers are a mock-up.

### Motion

Entry stagger on the hero at mount, and on each section as it scrolls into
view. `inViewStaggerProps(reduced)` is added to `design/motion/variants.ts`
next to `staggerProps`, so no easing curve is hard-coded anywhere.

Its `viewport.amount` is 0.1 and there is a test pinning it ≤ 0.15: `amount` is
the fraction of the *section* that must be on screen, and a threshold a tall
section cannot cross would strand its cells at `opacity: 0` permanently. That
is the failure mode worth a test.

## Housekeeping carried forward from task 1

### 1. The Animations switch now has a CSS hook

`applyMotionAttribute()` in `design/motion/motionPreference.ts` writes
`data-motion="on" | "off"` to the document root, the way `ThemeProvider` writes
`data-theme`. `setDisabled` calls it; `main.tsx` calls it once before first
paint next to the density line, so a reload with animations off never plays a
frame before React boots. `useReducedMotion()` is unchanged.

The stylesheets then respond in two layers:

- `tokens.css` zeroes `--yd-motion-fast/base/slow` under
  `:root[data-motion="off"]`. Every transition in this app is written in those
  three tokens, so this single rule reaches all of them.
- Duration is only half of it — a 0 ms transition still lets a hover *jump*.
  So each rule that actually moves something carries its own
  `[data-motion="off"]` twin beside its reduced-motion block: `Bento.css`,
  `GlassCard.css`, `ImportPage.css`'s dropzone, and the two keyframe
  animations whose hard-coded durations the tokens cannot reach
  (`AtmosphericBackground.css`, `OverviewPage.css`'s skeleton shimmer).
  `LandingPage.css`'s CTA hover has one too.

### 2. The phase-1 mesh is gone from the auth routes

Deleted `body::before`, `@keyframes yd-drift`, and the now-unused
`--yd-bg-mesh-a` / `--yd-bg-mesh-b` from both themes. `AtmosphericBackground`
is mounted on `LoginPage`, `RegisterPage` and the landing page, as a sibling of
the content with the content lifted by `position: relative; z-index: 1` — the
same arrangement `AppShell.css` documents.

### 3. The chart font mirror is closed

`design/fonts.test.ts` now asserts `charts/theme.ts` names `Geist Variable` and
`Geist Mono Variable` first, and that `tokens.css` still declares both families
so a rename on either side cannot drift them apart. `charts/theme.ts` itself
needed no change — it was already correct; what was missing was the guard.

## What I tested, and the results

`frontend/src/design/motion/motionPreference.test.ts` (new, 9 tests) — the
attribute is written in both directions and moves with the store; each
stylesheet carries the rule it owes.

`frontend/src/app/HomeRoute.test.tsx` (new, 5 tests) — the three session states,
plus a guard that the gate renders nothing at a path it does not own.

`frontend/src/features/landing/LandingPage.test.tsx` (new, 17 tests) — section
order, both CTAs everywhere, the four boundary claims, the preview's caption
and its arithmetic, no emoji, ten inline SVG icons.

`frontend/src/design/motion/variants.test.ts` — extended for
`inViewStaggerProps`.

`frontend/src/test-setup.ts` — stubs `IntersectionObserver`, which jsdom does
not implement and Motion's `whileInView` calls unconditionally on mount.
Deliberately inert: jsdom has no layout, so it has no honest answer to "is this
on screen", and a stub that faked one would assert something untrue.

**Both new guards were mutation-checked**, because the brief is right that a
test asserting a rule exists is not evidence:

- reverting `charts/theme.ts` to the broken `"Geist Mono, ui-monospace, …"`
  fails the new assertion. The pre-existing `charts/theme.test.ts:21`
  `toContain("Geist Mono")` passed on that same broken value — which is the
  hole this closes.
- deleting the `:root[data-motion="off"]` rule from `Bento.css` fails the new
  assertion.

### Browser verification — the actual gate

Chrome DevTools MCP against the local dev server, `demo@yieldo-demo.fr`.

**Layout, measured not eyeballed.** At 375 / 768 / 1440 in both themes:
`scrollWidth - clientWidth` is 0 everywhere (only the atmosphere blobs exceed
the viewport, and they are inside its `overflow: hidden`). After scrolling the
full page, zero cells remain below `opacity: 0.99` — nothing is stranded behind
a scroll trigger.

**Contrast, on composited pixels in both themes.** My first three attempts at
this produced nonsense, because Chrome serialises `color-mix()` as
`color(srgb r g b / a)` with 0–1 floats and a naive `rgb()` parser reads them as
0–255. I only trusted the numbers after adding a self-check that round-trips a
known colour. Final figures (light / dark): cell body text 6.95 / 7.07, cell
title 16.72 / 15.75, accent eyebrow on the page 5.42 / 12.76, step number 6.21 /
11.29, capability icon on its plate 5.05 / 8.12, preview caption 6.07 / 8.00,
primary CTA label on its fill 5.42 / 12.76, ghost CTA label 15.98 / 15.48.

**Reduced motion.** `emulate` cannot set `prefers-reduced-motion`, so I drove
both gates at once via `initScript` — the OS query patched before the app boots
(the JS gate) and the stored switch seeded (the CSS gate). Result:
`data-motion="off"`, atmosphere `--animated` class dropped, blob
`animation-name: none`, `--yd-motion-fast: 0ms`, cell transition `0s`, CountUp
showing its final figure, and **all 14 cells at full opacity with no scrolling
at all**.

**The switch, with the OS media query off** — housekeeping 1's real test, on
`/design-systeme`'s interactive cell:

| | switch on | switch off |
|---|---|---|
| `data-motion` | `on` | `off` |
| OS `prefers-reduced-motion` | false | **false** |
| hovered | true | true |
| `translate` | `0px -2px` | **`none`** |
| transition duration | `0.14s` | **`0s`** |
| blob `animation-name` | running | **`none`** |

**Authenticated hard reload of `/`.** Instrumented from before any app script
with a `MutationObserver` plus a per-frame sampler. Normal network: loading at
543 ms, shell at 590 ms, `.yd-landing` never in the DOM. Then on **Slow 3G**,
which widens the window a naive gate would fail in: loading held for **2004 ms**
before the shell appeared, and `.yd-landing` still never rendered once.

**No external requests.** 86 resources on a cold load of `/`, **zero** outside
`localhost:5173`. Both fonts served locally; `document.fonts` reports `Geist
Variable` and `Geist Mono Variable` actually *loaded*, Geist Mono measures truly
monospaced, and Geist measures different from the `ui-sans-serif` fallback — so
the page's own "pas même une police chargée depuis un CDN" claim holds. The
dither is still a `data:` URI.

**Focus.** Real keyboard Tab, not a programmatic `.focus()`: `:focus-visible`
true, `outline: solid 2px rgb(126, 226, 214)`, offset 2px. `cursor: pointer` on
the CTAs.

## Defects the browser caught, that the tests did not

1. **141 characters per line.** The full-width "Pas encore disponible" cell ran
   its body edge to edge at 1440 — about twice a readable measure. Capped at
   78ch, and it stacks below 600px.
2. **An invisible icon plate.** The neutral boundary plate at
   `color-mix(--yd-text 8%)` did not read against `--yd-surface-strong` in the
   dark theme. Raised to 14%.
3. **The ghost CTA had no visible boundary.** `--yd-border-strong` measured
   1.63:1 against the top bar in the light theme, under WCAG 1.4.11's 3:1 for
   non-text UI boundaries. Given its own value derived from `--yd-text`; now
   3.44 light / 5.07 dark. I deliberately did **not** touch the shared token —
   it is load-bearing for every card in the app and belongs to the phase's
   final contrast pass.
4. **18 characters per line at 768.** The `md: 2`-of-6 cells squeezed their
   text into a gutter. Capabilities are now a flat `md: 3` (two per row) and
   the boundaries go two-then-one-full-width. Narrowest measure on the page
   went from ~18 to 39 characters.
5. **A sticky bar eating 13% of a phone screen.** At 375 the bar wraps to two
   rows, 110px, held permanently. It is sticky only from 640px now; below that
   it scrolls away, and the closing section repeats both actions anyway.

## Self-review

- **Naming / YAGNI.** `inViewStaggerProps` went into the shared `variants.ts`
  rather than staying local, because it is a motion primitive tasks 3–5 will
  want and because the alternative was hard-coding a curve at the call site.
  `SessionLoading` and `HomeRoute` are each small, but each removes a
  duplicated decision. I do not think anything else here earns its own file.
- **Test quality.** The preview test asserts arithmetic, not three plausible
  strings, and reads `aria-label` off the attribute rather than through
  Testing Library's label query — that query collapses the non-breaking spaces
  `formatCents` deliberately emits, so a normalised match would pass on a
  figure formatted with plain spaces. The "mentions X only in the pending
  cell" test is the one I would keep if I could keep only one: it is the
  failure a screenshot review cannot catch.
- **A mistake I made and caught.** During mutation testing I ran
  `git checkout` on `Bento.css` to undo a mutation — but that file was already
  modified by this task, so it reverted to HEAD and silently dropped my
  `data-motion` rule. I re-added it and then grepped every `data-motion` hook
  across the tree to confirm nothing else had been lost. Worth recording
  because it would have shipped a hole in the exact feature the task exists to
  build.

## Concerns

- **`GlassCard.css`'s hover lift is still `transform`, not `translate`.** Task
  1's ledger flagged it as the same latent bug that killed the bento hover.
  `StatTile` renders `GlassCard interactive`, so on the dashboard that lift is
  probably dead in the browser today. It is outside this brief (and task 3 owns
  that screen), so I only added its `data-motion` twin and did not change the
  property. Flagging it so it is not lost again.
- **The theme select's hairline** remains at the pre-existing 1.29:1 that task
  1's review accepted. My ghost-CTA fix is local to this page and does not
  address it; the phase's final review should still decide on
  `--yd-border-strong` globally.
- **Reduced motion was emulated, not native.** Chrome DevTools MCP exposes no
  `prefers-reduced-motion` control, so the shot drives the JS gate through a
  patched `matchMedia` and the CSS gate through the in-app switch. Together
  they reproduce the full reduced state — I verified every gate individually —
  but it is not the OS setting itself.
- **The dashboard behind the authenticated reload is empty** ("Aucune
  transaction sur cette période"). That is the known task-5 defect 2/4, not
  something this task introduced; today's date puts the default "Mois" period
  outside the fixture's data.
- **`--yd-bg-mesh-a/b` are deleted.** Nothing referenced them after
  `body::before` went, and a full grep confirms it, but any unmerged branch
  using them would break.

## Screenshots

All in `.superpowers/sdd/2026-08-12-yieldo-phase-1-5-interface/shots/`.

- `task2-1440-dark.png` — full page, dark. The hero with the miniature
  dashboard beside it, then the six capability cells on the asymmetric 7/5
  grid, the three boundary cells, the amber "pas encore disponible" strip, the
  four numbered steps, and the closing card.
- `task2-1440-light.png` — the same page in light, white cards raised off the
  deepened ground with the halos still readable behind them.
- `task2-768-dark.png` — tablet. Hero stacked above the preview, capabilities
  two per row, boundaries two-then-one-full-width.
- `task2-768-light.png` — the same at 768 in light.
- `task2-375-dark.png` — phone, full page. Everything single-column, no
  horizontal overflow, top bar wrapped to two rows and scrolling away.
- `task2-375-light.png` — the same at 375 in light.
- `task2-1440-dark-reduced-motion.png` — 1440 dark with both motion gates off,
  captured **without scrolling at all**: every section is already fully opaque,
  which is the proof that nothing depends on a scroll trigger to be visible.
- `task2-authenticated-reload-1440-dark.png` — `/` after a cache-ignoring hard
  reload while signed in: the sidebar, header and "Vue d'ensemble", with the
  instrumentation confirming `.yd-landing` never entered the DOM.
- `task2-connexion-1440-dark.png` and `task2-connexion-1440-light.png` —
  `/connexion` now sitting on the app's own atmosphere in both themes, instead
  of the phase-1 mesh that made it lighter than the rest of the app.
- `task2-focus-ring-1440-dark.png` — the teal 2px focus ring on "Se connecter"
  in the top bar, after a real keyboard Tab.

## Files changed

New: `frontend/src/app/HomeRoute.tsx`, `frontend/src/app/HomeRoute.test.tsx`,
`frontend/src/features/auth/SessionLoading.tsx`,
`frontend/src/features/landing/{LandingPage.tsx,LandingPage.css,LandingPage.test.tsx,DashboardPreview.tsx,DashboardPreview.css,icons.tsx}`,
`frontend/src/design/motion/motionPreference.test.ts`.

Modified: `frontend/src/app/routes.tsx`, `frontend/src/index.css`,
`frontend/src/main.tsx`, `frontend/src/test-setup.ts`,
`frontend/src/design/tokens.css`, `frontend/src/design/motion/motionPreference.ts`,
`frontend/src/design/motion/variants.ts`, `frontend/src/design/motion/variants.test.ts`,
`frontend/src/design/fonts.test.ts`, `frontend/src/design/bento/Bento.css`,
`frontend/src/design/glass/GlassCard.css`,
`frontend/src/design/atmosphere/AtmosphericBackground.css`,
`frontend/src/features/auth/{AuthPage.css,LoginPage.tsx,RegisterPage.tsx,RequireAuth.tsx}`,
`frontend/src/features/import/ImportPage.css`,
`frontend/src/features/overview/OverviewPage.css`.

---

## Fix report — hero preview's stagger delay was inert (review finding)

Follow-up to the shipped task above. Original commit `3f6fc35`; this fix lands
as a separate commit on top of it, on the same branch.

### The finding

`frontend/src/features/landing/LandingPage.tsx:218` gave the hero preview
`variants: fadeInUp` plus a sibling `transition: { delay: 0.12 }` prop. Motion
resolves a `motion.*` element's transition from the *variant* first
(`resolvedVariant.transition`) and only falls back to the component's
`transition` prop when the resolved variant carries none.
`fadeInUp.visible` always declares its own `transition` (duration + ease), so
the component prop was dead: the preview and the hero copy both used
`fadeInUp` with no delay of their own, and animated in lockstep. The brief's
"entry stagger on the hero" did not exist at runtime, and nothing in the
suite could have caught it — the same shape as task 1's CSS `transform`
silently overridden by Motion's inline `transform: none`.

### The fix

`frontend/src/design/motion/variants.ts` gains `fadeInUpDelayed`, a sibling
of `fadeInUp` whose `visible.transition` folds the 120ms delay in directly
(`{ duration: 0.34, ease: SIGNATURE_EASE, delay: 0.12 }`) instead of leaving
it in a prop the resolved variant would ignore. `LandingPage.tsx`'s hero
preview now passes `variants={fadeInUpDelayed}` and no longer carries a
`transition` prop at all. `fadeInUp` itself, the hero copy's `heroEntry`, and
every other call site are untouched.

### The guard

`frontend/src/features/landing/LandingPage.test.tsx` gained a `vi.mock` of
`motion/react` that wraps `motion.div` in a capturing component recording the
exact props LandingPage passes to each `motion.div` it renders (keyed by
`className`), then delegates to the real `motion.div` so every existing
assertion in the file keeps working unchanged. The new test
(`LandingPage hero stagger > gives the preview a resolved delay the copy
does not have`) reads `capturedMotionDivs` for the `yd-landing__hero-copy`
and `yd-landing__hero-preview` elements and asserts on
`variants.visible.transition.delay` — the value Motion actually resolves —
not on the presence of a `transition` prop, which is exactly the field that
lied in the original bug.

Command and output:

```
cd frontend && npx vitest run src/features/landing/LandingPage.test.tsx src/design/motion/variants.test.ts
```

```
 ✓ src/design/motion/variants.test.ts (10 tests) 4ms
 ✓ src/features/landing/LandingPage.test.tsx (18 tests) 469ms

 Test Files  2 passed (2)
      Tests  28 passed (28)
```

**Mutation check.** Reverted `LandingPage.tsx`'s hero preview to the original
buggy shape (`variants: fadeInUp` + `transition: { delay: 0.12 }`) and reran
just the new test:

```
npx vitest run src/features/landing/LandingPage.test.tsx -t "resolved delay"
```

```
 × LandingPage hero stagger > gives the preview a resolved delay the copy does not have
   → expected +0 to be close to 0.12, received difference is 0.12, but expected 0.005
```

The guard fails on the pre-fix code, exactly as intended, then re-applied the
fix and confirmed green again.

### Browser confirmation — measured, not eyeballed

Chrome DevTools MCP against the running dev server (`http://localhost:5173/`),
anonymous session (landing page only renders for one). An `initScript`
injected before app code samples `getComputedStyle(...).opacity` for
`.yd-landing__hero-copy` and `.yd-landing__hero-preview` on every animation
frame for ~700-900ms after navigation.

**Before the fix** (temporarily reverted, HMR picked it up): every single
sampled frame showed `copyOpacity === previewOpacity`, identical to the
displayed precision at each timestamp (e.g. `t=299: 0.899517 / 0.899517`,
`t=402: 0.991351 / 0.991351`) — the two halves animating in exact lockstep,
confirming the reviewer's "arrive simultaneously" diagnosis.

**After the fix**: the copy starts moving first — `previewOpacity` stays `"0"`
through several frames where `copyOpacity` is already well underway (e.g. at
`t=298`, copy `0.913` vs preview `0`), then the preview visibly starts
(`t=305, preview 0.0997`). Measured against a >0.02 opacity threshold: copy
crossed it at `t=248ms`, preview at `t=337ms` — an 89ms measured gap, in the
neighbourhood of the configured 120ms delay (rAF sampling grain plus the
ease-out curve's fast initial slope account for the difference from the
nominal value; the earlier 900ms-window run showed a similar ~94-101ms gap by
frame-crossing analysis). Either way, the two halves visibly no longer arrive
together, which is the property under test.

### Verification

- `npx vitest run` (full suite): 34 files, **294 tests passed** (293 baseline
  + 1 new guard). No regressions.
- `npm run build`: zero TypeScript errors, build succeeds (pre-existing
  chunk-size warning only, unrelated to this change).
- `npm run lint` left alone, per the brief (broken repo-wide, eslint not
  installed).

### Files changed

Modified: `frontend/src/design/motion/variants.ts` (new `fadeInUpDelayed`
export), `frontend/src/features/landing/LandingPage.tsx` (hero preview now
uses `fadeInUpDelayed`, dead `transition` prop removed),
`frontend/src/features/landing/LandingPage.test.tsx` (new `motion/react`
mock plus the `LandingPage hero stagger` guard test).

### Concerns

None. The eight Minor findings from the same review (dead imports,
tautological test, heading order, duplicated formatter, page-local border
colour) were left untouched, per the brief — they remain open for the
whole-branch review.
