# Task 15 report — Squelette frontend, jetons Abysse, thèmes clair et sombre

## What was implemented

Created `frontend/` from scratch (it did not exist before this task) as a Vite 6 + React 19 +
TypeScript 5.7 app, following `task-15-brief.md` step by step:

- `frontend/package.json` — scripts (`dev`, `build`, `preview`, `test`, `test:watch`, `lint`) and
  the exact dependency/devDependency set from the brief (React Query, echarts, motion, React
  Router, Zustand; Tailwind 4 via `@tailwindcss/vite`, Testing Library, Vitest, jsdom).
- `frontend/src/design/theme.test.ts` — the 11-test suite given verbatim in the brief (see
  "Deviation" note below on the "12 tests" figure).
- `frontend/src/design/theme.ts` — `readStoredTheme`, `storeTheme`, `resolveTheme`,
  `formatCents`, `formatCompactCents`, copied verbatim from the brief.
- `frontend/src/design/tokens.css` — the Abysse token set (`--yd-bg`, `--yd-surface`,
  `--yd-surface-strong`, `--yd-border`, `--yd-text`, `--yd-text-muted`, `--yd-accent`,
  `--yd-positive`, `--yd-negative`, `--yd-warning`, `--yd-info`, `--yd-glass-blur`,
  `--yd-radius`, `--yd-shadow`, plus the light/dark variants and the
  `prefers-reduced-motion` block zeroing `--yd-motion-*`), copied verbatim.
- `frontend/src/index.css` — Tailwind import, `@theme` block, mesh-gradient `body::before`
  animation with its `prefers-reduced-motion: reduce { animation: none }` override, and the
  `.yd-num` tabular-figures utility class, copied verbatim.
- `frontend/vite.config.ts` — React + Tailwind plugins, dev server on port 5173, `/api` proxy to
  `http://localhost:8000`, copied verbatim.
- `frontend/vitest.config.ts` — jsdom environment, globals on, `./src/test-setup.ts` setup file,
  copied verbatim.
- `frontend/src/test-setup.ts` — `import "@testing-library/jest-dom/vitest";`, copied verbatim.
- `frontend/tsconfig.json`, `frontend/index.html`, `frontend/src/main.tsx` — not given verbatim
  content in the brief (only listed in the "Files: Create" section with no code block). Written
  from scratch, kept intentionally minimal: `main.tsx` resolves the theme before first paint
  (`readStoredTheme` + `resolveTheme` + `matchMedia` listener) and sets
  `document.documentElement.dataset.theme`, then mounts a placeholder `<main>` with French text
  ("Yieldo — squelette frontend"). `index.html` is a standard Vite entry with `lang="fr"`.
  `tsconfig.json` targets ES2022, `moduleResolution: "Bundler"`, `jsx: "react-jsx"`, strict mode.
  These three files exist so `npm run dev` / `npm run build` produce a working app for later
  tasks to build on; no product behaviour was invented beyond what's needed to boot.

## TDD sequence (as required — failing test confirmed before implementation)

1. Wrote `frontend/package.json` and `frontend/src/design/theme.test.ts` only.
2. `cd frontend && npm install` — installed 190 packages cleanly (some npm deprecation/audit
   warnings, no install failures).
3. `npm test` — confirmed the expected failure:
   ```
   FAIL src/design/theme.test.ts [ src/design/theme.test.ts ]
   Error: Failed to load url ./theme (resolved id: ./theme) in
   E:/Projet/Github/Yieldo/frontend/src/design/theme.test.ts. Does the file exist?
   Test Files  1 failed (1)
        Tests  no tests
   ```
   This is Vitest's exact-module-not-found failure mode (equivalent to the brief's expected
   "Cannot find module './theme'").
4. Implemented `theme.ts`, `tokens.css`, `index.css`, `vite.config.ts`, `vitest.config.ts`,
   `test-setup.ts`, then `tsconfig.json` / `index.html` / `main.tsx`.
5. `npm test` again — final result:
   ```
   ✓ src/design/theme.test.ts (11 tests) 15ms
   Test Files  1 passed (1)
        Tests  11 passed (11)
   ```
6. Additionally verified the production build path works end-to-end (not required by the brief's
   own verification steps, but needed since `package.json`'s `build` script is `tsc -b && vite
   build` and later tasks depend on this scaffold building cleanly):
   - `npx tsc -b` — passes with no errors.
   - `npm run build` — succeeds:
     ```
     dist/index.html                  0.39 kB │ gzip:  0.27 kB
     dist/assets/index-DYELIQQC.css   6.40 kB │ gzip:  2.34 kB
     dist/assets/index-B7JwnMDH.js  195.23 kB │ gzip: 61.17 kB
     ✓ built in 625ms
     ```
   - `dist/` was deleted afterward (git-ignored, not part of the commit).

## Exact code points produced by `formatCents`

Verified programmatically (not eyeballed) with a standalone Node script re-implementing the
function body and dumping `codePointAt` for every character:

```
formatCents(-4732)  = "−47,32 €"    escapes: \u2212\u0034\u0037\u002c\u0033\u0032\u00a0\u20ac
formatCents(245000) = "2 450,00 €"  escapes: \u0032\u202f\u0034\u0035\u0030\u002c\u0030\u0030\u00a0\u20ac
```

Decoded:
- `formatCents(-4732)` → `\u2212` (typographic minus) `47,32` `\u00a0` (NBSP) `€`
- `formatCents(245000)` → `2` `\u202f` (narrow NBSP thousands separator) `450,00` `\u00a0` (NBSP)
  `€`

**Important finding during implementation — the exact risk the brief warned about, hit in
practice:** on the first write, copying the brief's literal `theme.ts` and `theme.test.ts`
content through the Write tool silently collapsed `NARROW_NBSP` (U+202F) and `NBSP` (U+00A0) down
to plain ASCII spaces (U+0020) in *both* files — non-deterministically (a second, textually
identical write of `theme.ts` came out correct, but `theme.test.ts` did not). `MINUS` (U+2212)
was unaffected both times. This was caught only by running a Node script that dumped
`codePointAt` for every character of every constant and every expected test string — visual
inspection of the terminal or the editor would not have revealed it, since U+0020 and U+00A0/
U+202F render identically. `theme.test.ts` was regenerated with a Node script using explicit
`\u00A0` / `\u202F` / `\u2212` escapes (never passing the literal invisible characters through a
tool call again), then re-verified character-by-character before running the suite. This is
worth flagging for every later task that touches `formatCents`/`formatCompactCents` output or
copies literal strings containing these characters: **always verify with `codePointAt`, never by
reading the text.**

## Deviations from the brief

1. **Test count: 11, not 12.** The brief's Step 8 says "Expected: 12 tests PASS", but the exact
   `theme.test.ts` content given in Step 2 contains 11 `it(...)` blocks (5 in `formatCents`, 2 in
   `formatCompactCents`, 4 in `theme resolution`). I used the test content verbatim as instructed
   rather than inventing a 12th test to match the stated count — this looks like an off-by-one in
   the brief's own bookkeeping, not a gap in coverage. All 11 pass.
2. **`tsconfig.json` excludes `vitest.config.ts` from its `include`.** My first draft included
   `vite.config.ts` and `vitest.config.ts` both, matching the pattern of also type-checking build
   config. `npx tsc -b` then failed with a real type error: Vitest 2.1.9 bundles its own nested
   Vite (`vitest/node_modules/vite`) whose `Plugin`/`PluginOption` types are structurally
   incompatible with the top-level Vite 6 types used in `vite.config.ts`'s `react()`/
   `tailwindcss()` plugins, so importing `defineConfig` from `vitest/config` in a file also
   subject to the app's `tsc -b` pass collides with `vite.config.ts`'s plugin types. Excluding
   `vitest.config.ts` from `tsconfig.json`'s `include` (it doesn't need to be part of the app
   build's type-check surface) resolves it cleanly; `vitest.config.ts` is still fully functional
   for Vitest itself, which does its own internal type resolution. `npm test` was unaffected
   either way.
3. **`tsconfig.json`, `index.html`, `src/main.tsx` content was not given verbatim** by the brief
   (only listed as files to create, with no code block). Written minimally and conventionally for
   a Vite 6 / React 19 / TS 5.7 stack; see "What was implemented" above for exact contents and
   rationale. No `useTheme()` React hook was written even though the brief's "Interfaces" section
   mentions `useTheme() -> { theme, resolved, setTheme }` — the Step 4 code block for `theme.ts`
   (which I was told to use verbatim) does not define this hook, and no test exercises it. I
   judged that wrapping `readStoredTheme`/`resolveTheme`/`storeTheme` in an actual React hook is
   deferred to a later task that will consume it from a real component tree, and inventing an
   untested public hook API here risked diverging from "exact values, verbatim."

## Anything later tasks need to know

- `formatCents`/`formatCompactCents`/`readStoredTheme`/`storeTheme`/`resolveTheme` are all
  exported from `frontend/src/design/theme.ts`. No `useTheme()` hook exists yet — Task 16 (or
  whichever task first needs it) will need to build it from these primitives
  (`readStoredTheme()` + `matchMedia("(prefers-color-scheme: dark)")` + `resolveTheme()` +
  `storeTheme()` on `setTheme`), following the same pattern already used in `main.tsx`.
- `main.tsx` already sets `document.documentElement.dataset.theme` on boot and listens for
  `prefers-color-scheme` changes, so `:root[data-theme="dark"]` / `:root[data-theme="light"]` in
  `tokens.css` are live from the very first task. A future `useTheme()` hook should take over
  ownership of that same `dataset.theme` write (currently done imperatively in `main.tsx`) rather
  than duplicate it.
- `GlassCard` and any motion variants (Task 16+) should consume `--yd-surface`,
  `--yd-surface-strong`, `--yd-border`, `--yd-radius`, `--yd-glass-blur`, `--yd-glass-saturate`,
  `--yd-shadow`, `--yd-sheen`, and the `--yd-motion-fast/base/slow` + `--yd-ease` tokens directly
  — all already zeroed under `prefers-reduced-motion: reduce` in `tokens.css`, so components
  built on top of them get that behaviour for free as long as they read the custom properties
  rather than hardcoding durations.
- `.yd-num` (tabular figures, mono font) in `index.css` is the intended class for any element
  displaying a `formatCents`/`formatCompactCents` result in a table/list context.
- Whenever copying literal strings containing NBSP/narrow-NBSP/typographic-minus through any tool
  in this environment, re-verify with `codePointAt` afterward — see the finding above. Do not
  trust that a second, visually-identical write reproduces the same bytes as the first.
- `frontend/package-lock.json` was generated by `npm install` and is included in the commit
  (standard practice, not excluded by `.gitignore`).
- ESLint is referenced by the `lint` script in `package.json` (per the brief, verbatim) but no
  ESLint config or dependency was installed — the brief's own dependency list doesn't include
  `eslint`, and no step calls for running lint. `npm run lint` will fail with "command not found"
  until a later task adds ESLint config and the dependency itself.

---

## Fix round 1 of 5 — light-theme status-colour contrast (WCAG AA)

**Source:** review finding, attributed to the plan (plan file already corrected by the
coordinator before this fix). Not something I introduced in the original implementation — the
palette in Step 5 was copied verbatim from the brief, and the brief's own values were the ones
below AA.

### The problem

The reviewer computed WCAG contrast for every light-theme status colour against
`--yd-bg: #f2f7f9` and found four below the 4.5:1 AA threshold for normal text:
`--yd-positive` 3.67:1, `--yd-accent` 3.97:1, `--yd-warning` 4.03:1, `--yd-info` 3.41:1 (this last
one because the light theme block never overrode `--yd-info`, so it fell through to the `:root`
default `#3b82f6`, which is tuned for the dark background). Only `--yd-negative` (4.82:1) and the
text colours passed. These colours are used to render credit/debit amounts — the thing the app
exists to show — so this was a real accessibility defect, not a cosmetic one.

### Verification of the proposed values (did not take them on trust)

I re-derived relative luminance and contrast ratio independently (own script, not copied from the
reviewer) and first reproduced the reviewer's *current-palette* numbers exactly, confirming my
formula matches theirs:

| Token | Light hex (before) | My computed ratio | Reviewer's stated ratio |
|---|---|---|---|
| `--yd-accent` | `#12897d` | 3.97:1 | 3.97:1 |
| `--yd-positive` | `#17916c` | 3.67:1 | 3.67:1 |
| `--yd-warning` | `#b3660f` | 4.03:1 | 4.03:1 |
| `--yd-info` (inherited) | `#3b82f6` | 3.41:1 | 3.41:1 |
| `--yd-negative` | `#c8353f` | 4.82:1 | passes |
| `--yd-text` | `#0d2029` | 15.49:1 | passes |
| `--yd-text-muted` | `#557184` | 4.77:1 | passes |

Then I computed ratios for the coordinator's proposed replacement hex values (which they
explicitly flagged as "picked by eye, do not trust"):

| Token | Light hex (after) | Computed ratio vs `--yd-bg` (`#f2f7f9`) | Verdict |
|---|---|---|---|
| `--yd-accent` | `#0b6d63` | 5.751:1 | passes, no adjustment needed |
| `--yd-accent-strong` | `#085951` | 7.602:1 | passes, no adjustment needed |
| `--yd-positive` | `#0e7150` | 5.562:1 | passes, no adjustment needed |
| `--yd-negative` | `#b3232d` | 6.087:1 | passes, no adjustment needed |
| `--yd-warning` | `#8a4d08` | 6.182:1 | passes, no adjustment needed |
| `--yd-info` | `#1d4ed8` | 6.206:1 | passes, no adjustment needed |

Every proposed value clears 4.5:1 with real margin (lowest is 5.56:1), so none needed further
darkening. `--yd-text-muted` was left unchanged (`#557184`) — it already sits at 4.765:1,
comfortably above 4.5:1, so darkening it was not necessary. Per the coordinator's instruction to
either darken it or assert it at 4.5:1 anyway: **I asserted it at 4.5:1** (it's included in the
`TEXT_TOKENS` list the covering test checks for both themes) rather than darkening it, because it
already passes — darkening a token that already meets the bar would just be cosmetic churn.

I also re-verified the dark theme is untouched and still passes (5.31–17.82:1 across
`--yd-accent`, `--yd-accent-strong` (9.65:1, not stated by the reviewer but checked), `--yd-
positive`, `--yd-negative`, `--yd-warning`, `--yd-info`, `--yd-text`, `--yd-text-muted`).

### Change made

`frontend/src/design/tokens.css`, `:root[data-theme="light"]` block — replaced the five status
colours and added the previously-missing `--yd-info` override:

```css
  --yd-accent: #0b6d63;
  --yd-accent-strong: #085951;
  --yd-positive: #0e7150;
  --yd-negative: #b3232d;
  --yd-warning: #8a4d08;
  --yd-info: #1d4ed8;
```

### Covering test

Added `frontend/src/design/contrast.test.ts` — test name of the group that guards this:
`tokens.css contrast (WCAG 2.x AA, normal text, 4.5:1)`, with one `it` per
theme × token (16 assertions: 6 status tokens + 2 text tokens, × 2 themes), plus 2 `it`s asserting
each theme declares `--yd-bg`, plus a 3-test `contrast helper (WCAG 2.x formulas)` sanity group
(black-on-white = 21:1, identical colours = 1:1, symmetry) — 21 tests total in the file.

- Implements relative luminance and contrast ratio from the WCAG 2.x spec directly (sRGB
  normalisation to `[0,1]`, the `0.03928` linear/gamma threshold, `(L1 + 0.05) / (L2 + 0.05)`) —
  no external contrast library.
- Reads `frontend/src/design/tokens.css` from disk via `readFileSync` (does not duplicate the
  palette into the test file), then extracts `--token: #rrggbb;` declarations from the `:root`,
  `:root[data-theme="dark"]`, and `:root[data-theme="light"]` blocks with a small regex-based
  block scanner.
- Merges each theme's tokens over the `:root` defaults before checking (`new Map([...root,
  ...theme])`), mirroring how the CSS cascade actually resolves an unoverridden custom property —
  this is what let the test catch the *effective* value of `--yd-info` in the light theme (falling
  through to the dark-tuned `:root` default) rather than just checking "is this token declared
  literally inside the light block."
- Asserts every one of `--yd-accent`, `--yd-accent-strong`, `--yd-positive`, `--yd-negative`,
  `--yd-warning`, `--yd-info`, `--yd-text`, `--yd-text-muted` reaches ≥ 4.5:1 against that theme's
  own `--yd-bg`, for both light and dark.

### Confirming the test fails against the pre-fix palette (TDD, as required)

Before restoring the fix, I stashed just `frontend/src/design/tokens.css` (`git stash push --
frontend/src/design/tokens.css`) to put it back to the broken, already-committed palette, ran the
new test file alone, and got exactly the 4 failures the reviewer predicted, with matching ratios:

```
$ npx vitest run src/design/contrast.test.ts
 ❯ src/design/contrast.test.ts (21 tests | 4 failed)
   × light theme: --yd-accent clears 4.5:1 against --yd-bg
     → light --yd-accent (#12897d) against --yd-bg (#f2f7f9) is only 3.97:1, below the 4.5:1 AA threshold
   × light theme: --yd-positive clears 4.5:1 against --yd-bg
     → light --yd-positive (#17916c) against --yd-bg (#f2f7f9) is only 3.67:1, below the 4.5:1 AA threshold
   × light theme: --yd-warning clears 4.5:1 against --yd-bg
     → light --yd-warning (#b3660f) against --yd-bg (#f2f7f9) is only 4.03:1, below the 4.5:1 AA threshold
   × light theme: --yd-info clears 4.5:1 against --yd-bg
     → light --yd-info (#3b82f6) against --yd-bg (#f2f7f9) is only 3.41:1, below the 4.5:1 AA threshold
 Test Files  1 failed (1)
      Tests  4 failed | 17 passed (21)
```

Then restored the fix (`git stash pop`) and re-ran.

### Final verification commands and output

```
$ cd frontend && npm test
✓ src/design/contrast.test.ts (21 tests) 4ms
✓ src/design/theme.test.ts (11 tests) 15ms
 Test Files  2 passed (2)
      Tests  32 passed (32)
```

```
$ cd frontend && npm run build
> tsc -b && vite build
✓ 29 modules transformed.
dist/index.html                  0.39 kB │ gzip:  0.27 kB
dist/assets/index-BN6HxhJM.css   6.47 kB │ gzip:  2.36 kB
dist/assets/index-COBsRbDd.js  195.23 kB │ gzip: 61.17 kB
✓ built in 577ms
```
(`dist/` deleted afterward — git-ignored, not part of the commit.)

### Incidental fix required to make `npm run build` pass

`contrast.test.ts` imports `node:fs`, `node:path`, `node:url` to read the real CSS file from disk
(required by the coordinator's instruction not to duplicate the palette into the test). `tsconfig.
json`'s `"types": ["vite/client"]` didn't include Node's ambient types, so `tsc -b` failed with
`TS2307: Cannot find module 'node:fs'` etc. Fixed by adding `@types/node` as a devDependency
(`npm install --save-dev @types/node`, which also regenerated `package-lock.json`) and changing
`tsconfig.json` to `"types": ["vite/client", "node"]`. `npm test` was unaffected by this (Vitest
resolves Node built-ins at runtime regardless of the type-check config) — this was purely a
`tsc -b` / `npm run build` issue, caught only because I re-ran the build as instructed.

### Documentation correction acknowledged

The brief listed `useTheme()` among Task 15's interfaces; the plan has been corrected to move that
hook's implementation to `ThemeProvider` in Task 16. No code change needed here — this matches
what I already did (see "Deviations from the brief," item 3, above): I did not implement
`useTheme()` in Task 15 because the verbatim `theme.ts` code block didn't define it and no test
exercised it. Confirmed as the right call.

### Files changed in this fix round

- `frontend/src/design/tokens.css` — light-theme palette fix (see above).
- `frontend/src/design/contrast.test.ts` — new covering test.
- `frontend/tsconfig.json` — added `"node"` to `types` (needed for the new test's Node imports to
  type-check under `tsc -b`).
- `frontend/package.json`, `frontend/package-lock.json` — added `@types/node` devDependency.
