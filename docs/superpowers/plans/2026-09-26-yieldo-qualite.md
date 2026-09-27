# Audit du 26 septembre — chantier Q (qualité et dépendances) : Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land Q1–Q5 of spec `docs/superpowers/specs/2026-09-26-yieldo-avenir-securite-design.md`:
a working lint on both sides, silent test runs, and front-end dependencies
without known advisories — without changing what any screen shows.

**Architecture:** Tooling only. Every task ends with the full suites green
(`pytest`, `vitest`, `tsc -b && vite build`) and, for the two dependency
tasks, every chart screen opened in the browser.

**Tech Stack:** ruff, pytest; ESLint 10 flat config, typescript-eslint 8,
eslint-plugin-react-hooks 7; Vite 8 (Rolldown), @vitejs/plugin-react 6,
Vitest 5, jsdom; ECharts 6.

## Global Constraints

- No behaviour change: a test that has to change its expectation is a defect found, and gets its own commit message saying what it was.
- One commit per task, Conventional Commits, `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` trailer.
- An ESLint disable comment only with its reason written beside it, never file-wide.
- `npm audit` (production and dev) must end with no known vulnerability.
- Chart screens (Vue d'ensemble, Analyse, Budgets, Dettes, Objectifs, Projection, Patrimoine, Assistant, Trésorerie, Simulateurs, Suivi, Investissement → La journée) are opened at 1440 and 390, dark and light, after Q4 and Q5, on the demo household (`e2e/seed_demo_household.py`).

---

### Task Q1: ruff clean

**Files:** `backend/app/llm/tools.py`, `backend/app/schemas/assistant_llm.py`,
`backend/tests/test_chat_api.py`, `backend/tests/test_recurrence.py`,
`backend/tests/test_transfer.py` (whatever `ruff check app tests` lists).

- [x] **Step 1:** `cd backend && ./.venv/Scripts/ruff.exe check app tests --output-format concise` — record the list.
- [x] **Step 2:** `./.venv/Scripts/ruff.exe check app tests --fix` for the safe fixes (import order, Yoda).
- [x] **Step 3:** By hand: wrap each E501 line under 100 columns; give each `zip()` in `test_recurrence.py` `strict=True` (the zipped sequences are built to be the same length — if a test then fails, the lengths were not equal and that is the defect to report); move the late import in `schemas/assistant_llm.py` to the top or, if it is there to break an import cycle, keep it with `# noqa: E402` and the reason.
- [x] **Step 4:** `ruff check app tests` → `All checks passed!`; `pytest -q` green.
- [x] **Step 5:** Commit `chore(backend): ruff reports nothing`.

### Task Q2: Test runs without warnings

**Files:** `backend/tests/conftest.py`, `backend/pyproject.toml`, the frontend
test files that emit `act(...)` warnings.

- [x] **Step 1:** Backend: an `autouse` fixture in `conftest.py` sets
  `settings.secret_key` to a 64-character test value (`"test-" + "0" * 59`)
  via `monkeypatch` — the default key is 26 bytes and PyJWT warns on every
  token.
- [x] **Step 2:** Starlette's `TestClient` deprecation: try
  `./.venv/Scripts/pip.exe install httpx2`; if Starlette then uses it and the
  suite is green, add it to the dev dependencies in `pyproject.toml`; if not,
  add to `[tool.pytest.ini_options]` a `filterwarnings` entry naming exactly
  that message, with a comment saying why.
- [x] **Step 3:** `pytest -q -W error::DeprecationWarning -x` must not fail on
  our own code; run `pytest -q` and read the warning summary: every remaining
  warning is named in the commit message or fixed.
- [x] **Step 4:** Frontend: `npm test 2>&1 | grep -B2 "not wrapped in act"` —
  for each file, wrap the state change the test triggers (`act` around the
  event, or `await` the `findBy…` that follows it). No global suppression.
- [x] **Step 5:** Both suites green; commit `test: suites that run without warnings`.

### Task Q3: ESLint, really installed

**Files:** `frontend/package.json`, `frontend/package-lock.json`,
Create `frontend/eslint.config.js`, then whatever it finds.

- [x] **Step 1:** `npm install -D eslint @eslint/js typescript-eslint eslint-plugin-react-hooks globals`.
- [x] **Step 2:** `frontend/eslint.config.js`:

```js
import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

// The two classic hooks rules only. react-hooks 7's "recommended" also turns
// on the React Compiler rules (set-state-in-effect, refs, purity…), which flag
// the fetch-in-useEffect pattern every screen is built on; adopting them is a
// migration of its own, not a lint setting.
export default tseslint.config(
  { ignores: ["dist", "coverage"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
);
```

- [x] **Step 3:** `npm run lint` — fix every finding. `exhaustive-deps`
  findings are real questions: add the dependency when the effect must
  re-run; when it must not, restructure (a ref, a callback moved inside the
  effect) rather than disable. `no-explicit-any` in tests: type the value.
- [x] **Step 4:** `npm run lint` → 0 problems; `npm test && npm run build` green.
- [x] **Step 5:** Commit `chore(frontend): ESLint installed, and what it found fixed`.

### Task Q4: Vite 8, Vitest 5, plugin-react 6

**Files:** `frontend/package.json`, `frontend/package-lock.json`,
`frontend/vite.config.ts`, `frontend/vitest.config.ts`.

- [x] **Step 1:** `npm install -D vite@8 @vitejs/plugin-react@6 vitest@5 jsdom@latest @tailwindcss/vite@latest tailwindcss@latest`.
- [x] **Step 2:** `npm run build`. Vite 8 bundles with Rolldown: if
  `rollupOptions.output.manualChunks` is refused or ignored, express the same
  split (ECharts in its own chunk) in the form Vite 8 documents
  (`build.rolldownOptions` / `advancedChunks`), and check `dist/assets` still
  holds one `echarts-*.js`.
- [x] **Step 3:** `npm test` — fix what Vitest 5 changed (config keys, fake
  timers, module mocking); no test deleted.
- [x] **Step 4:** `npm run dev` through the preview tool: the app loads, HMR
  applies an edit, `/api` is proxied.
- [x] **Step 5:** `npm audit` → 0 vulnerabilities in the dev chain.
- [x] **Step 6:** Commit `build(frontend): Vite 8, Vitest 5 and plugin-react 6, advisories closed`.

### Task Q5: ECharts 6, imported module by module

**Files:** Create `frontend/src/charts/echarts.ts`; modify every file that
imports `echarts` (`grep -rln "from \"echarts\"" src`).

- [x] **Step 1:** `npm install echarts@6`.
- [x] **Step 2:** `charts/echarts.ts` imports `echarts/core`, registers the
  series actually used (`grep -rhn "type: \"" src/charts src/features | sort -u`
  gives line, bar, pie, treemap, heatmap, scatter, custom… — register exactly
  those), the components (grid, tooltip, legend, markLine, markArea,
  markPoint, dataZoom, calendar, visualMap, title if used) and
  `CanvasRenderer`, and re-exports `echarts` and the `EChartsOption` type.
  Every other file imports from it, never from `"echarts"`.
- [x] **Step 3:** Read ECharts 6's upgrade notes and adapt what changed for
  options this code uses (default theme colours are overridden by
  `charts/theme.ts`; check legend, tooltip and axis defaults it relies on).
- [x] **Step 4:** `npm test && npm run build`; record the echarts chunk size
  before (343 kB gzip) and after.
- [x] **Step 5:** Browser: every chart screen listed in the Global
  Constraints, 1440 and 390, both themes; hover a tooltip on each chart type.
  Fix what differs from before, each fix with its test when testable.
- [x] **Step 6:** `npm audit --omit=dev` → 0 vulnerabilities.
- [x] **Step 7:** Commit `build(charts): ECharts 6, loaded module by module`.
