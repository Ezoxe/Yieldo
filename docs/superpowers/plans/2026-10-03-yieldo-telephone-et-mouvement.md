# Phone layout and fluid motion — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every Yieldo screen comfortable on a 390 px phone, then give the
whole application the validated « Fluide » motion: figures and charts that move
from what the reader last saw, lists that glide, screens that hand over to each
other without a blink.

**Architecture:** Phone first, through shared primitives (shell, sheet, page
head, bento, period selector, inputs, targets) so most screens improve without
being touched, then a short list of per-screen reorders. Motion second, through
a handful of primitives in `design/motion/` (session figure memory,
`AnimatedNumber`, `DeltaPill`, `LoadSwap`, route transition, chart animation
policy) that the screens adopt. Everything stops under
`prefers-reduced-motion` and `:root[data-motion="off"]`.

**Tech Stack:** React 19, react-router 7, motion 11 (`motion/react`), zustand,
ECharts 6, vitest + Testing Library, plain CSS with `--yd-*` tokens.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-10-03-yieldo-telephone-et-mouvement-design.md`.
- Breakpoints: phone `max-width: 639px`; compact shell (tabs, sheet) `max-width: 899px`; bento phone grid `max-width: 767px`.
- User-facing text in French with « », non-breaking spaces before `:` `;` `?` `!`, `€` after the figure; code, comments, commits in English.
- No hex colour in a component; tokens only. Icons from `design/icons/`, stroke only.
- Motion language: arrivals `SIGNATURE_EASE` 260–380 ms; exits `EXIT_EASE` (`[0.2, 0, 0, 1]`) at ~60 % of the entry; figures 500–760 ms; cascade 25–45 ms capped at 8 items; only `transform`, `opacity`, `clip-path` on large surfaces.
- Under `useReducedMotion()` every motion component renders its final state as plain markup (never a 0 ms animation); every CSS animation has a `prefers-reduced-motion` block AND a `:root[data-motion="off"]` twin.
- Figure memory is session-only (in memory, cleared when the session is cleared); nothing about figures is written to storage.
- Test first. `npm test`, `npm run lint`, `npm run build` green at every commit (from `frontend/`).
- Judge every UI task in a browser at 390 and 1440 px, both themes (headless DevTools page `yieldo-mobile`, demo household).
- Branch `feat/telephone-et-mouvement`, one Conventional Commit per task.

## File map

| File | Responsibility |
|---|---|
| `design/Sheet.tsx`, `design/Sheet.css` | bottom sheet: scrim, handle, drag-to-dismiss, Escape, focus in/out |
| `app/MoreSheet.tsx`, `app/MoreSheet.css` | « Plus » on phone/tablet: environment switch, import, every destination as tiles |
| `app/useCompactTitle.ts` | the page `h1` scrolled out of view → its text for the compact header |
| `design/useLineClamp.ts` | whether a clamped block actually overflows (for « Lire la suite ») |
| `design/motion/figureMemory.ts` | session store of the last value shown per figure key |
| `design/motion/AnimatedNumber.tsx` | a figure that rolls from its remembered value, never from zero |
| `design/motion/DeltaPill.tsx` | « +212,25 € depuis ton dernier passage » |
| `design/motion/LoadSwap.tsx` | skeleton delayed 150 ms, cross-faded into the content |
| `design/motion/useAnimatedRatio.ts` | a bar's ratio animated from its remembered value, colour at 80 %/100 % |
| `app/routeDirection.ts` | +1 deeper, −1 shallower, 0 sideways, from two pathnames |
| `charts/chartAnimation.ts` | first draw / morph / still, from the chart's memory |
| `design/motion/SaveFeedback.tsx` | a submit button's « Enregistré » state with a drawn check |

---

## Phase 1 — Le téléphone

### Task 1: Phone foundations (grid, panels, inputs, targets)

**Files:**
- Modify: `frontend/src/design/bento/BentoCell.tsx` (add `sm` span)
- Modify: `frontend/src/design/bento/Bento.css` (phone grid, padding, panel head)
- Modify: `frontend/src/design/controls.css` (16 px fields, 44 px targets)
- Modify: `frontend/src/app/AppShell.css` (main padding on phone)
- Test: `frontend/src/design/bento/Bento.test.tsx`, `frontend/src/design/controlsPhone.test.ts`

**Interfaces:** Produces `BentoSpan.sm?: number` (columns of a 2-column phone grid; default 2 = full width) and the utility class `.yd-tap` (min 44 × 44 on coarse pointers).

- [ ] **Step 1: Write the failing tests**

```tsx
// Bento.test.tsx (append)
it("passes the phone span as its own custom property, full width by default", () => {
  const { container } = render(
    <BentoGrid>
      <BentoCell span={{ sm: 1, md: 2, lg: 4 }}>a</BentoCell>
      <BentoCell>b</BentoCell>
    </BentoGrid>,
  );
  const [half, full] = container.querySelectorAll<HTMLElement>(".yd-bento__cell");
  expect(half.style.getPropertyValue("--yd-cell-span-sm")).toBe("1");
  expect(full.style.getPropertyValue("--yd-cell-span-sm")).toBe("2");
});
```

```ts
// controlsPhone.test.ts
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const css = (file: string) =>
  readFileSync(path.resolve(here, file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

describe("phone controls", () => {
  it("never lets a field zoom an iPhone: 16px under 900px", () => {
    expect(css("./controls.css")).toMatch(
      /@media \(max-width: 899px\)\s*\{[^@]*:where\(input, select, textarea\)[^}]*font-size:\s*max\(16px, 1em\)/,
    );
  });
  it("gives a coarse pointer a 44px target", () => {
    expect(css("./controls.css")).toMatch(/@media \(pointer: coarse\)[\s\S]*\.yd-tap[^}]*min-height:\s*44px/);
  });
  it("lays the bento on two columns on a phone", () => {
    expect(css("./bento/Bento.css")).toMatch(
      /@media \(max-width: 767px\)[\s\S]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/,
    );
  });
});
```

- [ ] **Step 2: Run them to see them fail** — `npx vitest run src/design/bento src/design/controlsPhone.test.ts` → FAIL (no `--yd-cell-span-sm`, no rules).

- [ ] **Step 3: Implement**

`BentoCell.tsx` — add to `BentoSpan` and to the style object:

```tsx
  /** Columns spanned below 768px, where the grid is 2 columns wide. Full width
   *  unless a cell says otherwise: only small tiles share a phone row. */
  sm?: number;
```

```tsx
    "--yd-cell-span-sm": span?.sm ?? 2,
```

`Bento.css` — after the base `.yd-bento__cell` rule:

```css
@media (max-width: 767px) {
  .yd-bento {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--yd-space-sm);
    grid-auto-rows: minmax(88px, auto);
  }

  .yd-bento__cell {
    grid-column: span var(--yd-cell-span-sm, 2);
    padding: var(--yd-space-md);
  }

  .yd-bento__cell::after {
    left: var(--yd-space-md);
  }

  .yd-panel__head {
    flex-wrap: wrap;
    row-gap: var(--yd-space-xs);
  }

  .yd-panel__head > .yd-icon-badge {
    width: 1.75rem;
    height: 1.75rem;
    font-size: 0.95rem;
    border-radius: 9px;
  }

  .yd-panel__actions {
    flex-wrap: wrap;
  }
}
```

`controls.css` — append:

```css
@media (max-width: 899px) {
  :where(input, select, textarea) {
    font-size: max(16px, 1em);
  }
}

@media (pointer: coarse) {
  .yd-tap {
    min-height: 44px;
    min-width: 44px;
  }
}
```

`AppShell.css` — in the `max-width: 899px` block, `.yd-shell__main { padding: 12px 12px 16px; }`.

- [ ] **Step 4: Run the tests** — same command → PASS. Then `npm test` (whole suite) and fix any test pinning the old 1-column phone grid.
- [ ] **Step 5: Look** — 390 px, `/`, `/avenir`, `/budgets`: cards 16 px padding, nothing overflowing.
- [ ] **Step 6: Commit** — `feat(phone): two-column bento, compact panels, 16px fields, 44px targets`.

### Task 2: The screen head on a phone

**Files:**
- Create: `frontend/src/design/useLineClamp.ts`
- Modify: `frontend/src/design/PageHead.tsx`, `frontend/src/design/PageHead.css`
- Test: `frontend/src/design/PageHead.test.tsx`

**Interfaces:** Produces `useLineClamp(ref): { clamped: boolean; expanded: boolean; toggle(): void }`.

- [ ] **Step 1: Failing test**

```tsx
it("offers « Lire la suite » when the lead overflows its two lines on a phone", async () => {
  mockMedia({ "(max-width: 639px)": true });
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", { configurable: true, get: () => 120 });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 44 });
  const user = userEvent.setup();
  render(<PageHead icon={OverviewIcon} title="Budgets"><p>Un long texte…</p></PageHead>);
  const more = screen.getByRole("button", { name: "Lire la suite" });
  await user.click(more);
  expect(screen.getByRole("button", { name: "Réduire" })).toHaveAttribute("aria-expanded", "true");
});
```

- [ ] **Step 2: Fail** — `npx vitest run src/design/PageHead.test.tsx`.
- [ ] **Step 3: Implement**

```ts
// useLineClamp.ts
import { useLayoutEffect, useState, type RefObject } from "react";

/** Whether a block cut by `line-clamp` actually hides something, re-measured
 *  on resize. A « Lire la suite » under a lead that already fits would be a
 *  promise of more text that is not there. */
export function useLineClamp(ref: RefObject<HTMLElement | null>, active: boolean) {
  const [clamped, setClamped] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || !active || expanded) return;
    const measure = () => setClamped(element.scrollHeight > element.clientHeight + 1);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, active, expanded]);

  return { clamped: clamped || expanded, expanded, toggle: () => setExpanded((open) => !open) };
}
```

`PageHead.tsx`: wrap the lead in `<div className="yd-page-head__lead" data-expanded={expanded} ref={lead}>`, and after it, when `narrow && clamped`, a `<button type="button" className="yd-page-head__more yd-tap" aria-expanded={expanded} onClick={toggle}>{expanded ? "Réduire" : "Lire la suite"}</button>`.

`PageHead.css` (replace the `max-width: 639px` block):

```css
@media (max-width: 639px) {
  .yd-page-head {
    flex-wrap: wrap;
    gap: var(--yd-space-xs) var(--yd-space-sm);
  }

  .yd-page-head__mark {
    display: none;
  }

  .yd-page-head__text h1 {
    font-size: 1.5rem;
  }

  .yd-page-head__lead:not([data-expanded="true"]) {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow: hidden;
  }

  .yd-page-head__more {
    align-self: flex-start;
    padding: 0;
    border: 0;
    background: none;
    color: var(--yd-accent);
    font: inherit;
    font-size: 0.85rem;
    font-weight: 600;
  }

  .yd-page-head__actions {
    width: 100%;
    flex-wrap: wrap;
    gap: var(--yd-space-xs);
  }
}
```

The `__lead > p` rules keep the existing `> p` styling (`.yd-page-head__text > p` becomes `.yd-page-head__lead p`).
- [ ] **Step 4: Pass**, whole suite.
- [ ] **Step 5: Look** at `/`, `/transactions`, `/suivi` on 390 px.
- [ ] **Step 6: Commit** — `feat(phone): a compact screen head with a two-line lead`.

### Task 3: The bottom sheet

**Files:**
- Create: `frontend/src/design/Sheet.tsx`, `frontend/src/design/Sheet.css`
- Test: `frontend/src/design/Sheet.test.tsx`

**Interfaces:** Produces `Sheet({ open, onClose, title, id?, children, className? })`, a `role="dialog"` named by `title`, closed by Escape, the scrim, the close button, or a downward drag past 80 px or 500 px/s.

- [ ] **Step 1: Failing tests** — renders nothing closed; when open: dialog named by its title, focus inside, Escape and the scrim call `onClose`, focus returns to the opener after close; reduced motion renders plain markup.
- [ ] **Step 2: Fail.**
- [ ] **Step 3: Implement** with `motion.div` (`initial={{ y: "100%" }}`, `animate={{ y: 0 }}`, `exit={{ y: "100%" }}`, spring `{ type: "spring", stiffness: 420, damping: 40 }`), `drag="y"`, `dragConstraints={{ top: 0, bottom: 0 }}`, `dragElastic={{ top: 0, bottom: 0.6 }}`, `onDragEnd` closing past the thresholds; scrim fade 200 ms; under reduced motion the same markup without motion. CSS: fixed bottom panel, `max-height: 92dvh`, rounded top corners `20px`, `padding-bottom: env(safe-area-inset-bottom)`, a 36 × 4 handle, a scrollable body with `overscroll-behavior: contain`, `z-index: 70`.
- [ ] **Step 4: Pass.**
- [ ] **Step 5: Commit** — `feat(design): a bottom sheet that closes with a swipe`.

### Task 4: The compact shell — header, « Plus » sheet, title on scroll

**Files:**
- Create: `frontend/src/app/MoreSheet.tsx`, `frontend/src/app/MoreSheet.css`, `frontend/src/app/useCompactTitle.ts`
- Modify: `frontend/src/app/AppShell.tsx`, `frontend/src/app/AppShell.css`, `frontend/src/app/BottomTabs.tsx`
- Test: `frontend/src/app/MoreSheet.test.tsx`, `frontend/src/app/useCompactTitle.test.ts`, `frontend/src/app/AppShell.test.tsx`, `frontend/src/app/BottomTabs.test.tsx`

**Interfaces:**
- `MoreSheet({ open, onClose, environment })` — `id="yd-more-sheet"`; a « Finances / Investissement » segmented control (links to each `home`), « Importer un relevé » (link `/import`), then every `environment.sections` item as a tile link; a click on any link closes.
- `useCompactTitle(pathname): string | null` — the text of `main h1` while it is above the viewport, else `null`.
- `BottomTabs` « Plus » now `aria-controls="yd-more-sheet"`.

- [ ] **Step 1: Failing tests**
  - MoreSheet: lists every finance destination (same list `AppShell.test` pins), « Importer un relevé » goes to `/import`, the environment control marks the current one, a tile click calls `onClose`.
  - useCompactTitle: with a fake `IntersectionObserver` reporting the `h1` out of view above the top, returns its text; in view → `null`.
  - AppShell: « Plus » opens a dialog named « Plus » containing the destinations; Escape closes it; the hidden « Menu » toggle and the left drawer are gone.
- [ ] **Step 2: Fail.**
- [ ] **Step 3: Implement**
  - Remove the dead hamburger (`.yd-shell__menu-toggle`, always `display: none`) and the left drawer branch; `drawerOpen` becomes `moreOpen` driving `MoreSheet`.
  - Header: a `<p className="yd-shell__title" aria-hidden="true">` left slot fed by `useCompactTitle`, shown ≤ 899 px only, fading with `opacity` + `translate` (160 ms).
  - CSS ≤ 899 px: header `padding: 6px 12px`, `justify-content: space-between`; `.yd-shell__import`, `.yd-shell__assistant` → `display: none`; search and user buttons 44 px squares.
  - `MoreSheet.css`: segmented control 2 × 44 px; import button full width; tiles `grid-template-columns: repeat(4, minmax(0, 1fr))`, each 72 px high, icon 22 px above an 11 px label, active tile tinted.
- [ ] **Step 4: Pass**, update the AppShell « mobile drawer » block into « more sheet ».
- [ ] **Step 5: Look** at 390 px: header 56 px, title appears after scrolling past the `h1`, « Plus » shows all 21 entries without scrolling.
- [ ] **Step 6: Commit** — `feat(phone): a compact header and a « Plus » sheet instead of the side drawer`.

### Task 5: Drawers become sheets on a phone

**Files:** Modify `frontend/src/design/Drawer.tsx`; Test `frontend/src/design/Drawer.test.tsx` (create).

- [ ] **Step 1:** Failing test: with `(max-width: 639px)` matching, an open `Drawer` renders a `.yd-sheet` dialog with its title; otherwise `.yd-drawer__panel`.
- [ ] **Step 2: Fail.** **Step 3:** In `Drawer`, `const phone = useMediaQuery("(max-width: 639px)")`; when `phone`, return `<Sheet open onClose title>` with the same head (icon, subtitle) and body. **Step 4: Pass.**
- [ ] **Step 5: Look** — `/recurrences` row detail, `/transactions` « Ajouter une opération » on 390 px.
- [ ] **Step 6: Commit** — `feat(phone): detail drawers open as bottom sheets`.

### Task 6: The period selector on one sliding line

**Files:** Modify `frontend/src/features/transactions/PeriodSelector.tsx`, `.css`; Test `PeriodSelector.test.tsx`.

- [ ] **Step 1:** Failing test: both tablists sit inside one `.yd-period-selector__strip`; the selected chip is scrolled into view on mount (`scrollIntoView` called with `{ inline: "center", block: "nearest" }`).
- [ ] **Step 2: Fail.** **Step 3:** Wrap months and presets in `<div className="yd-period-selector__strip">`; ≤ 639 px: `display: flex; overflow-x: auto; scroll-snap-type: x proximity; scrollbar-width: none; gap: 6px; mask-image` fade on the edges; both tablists `display: contents`; chips `flex: none`, 40 px high, presets drawn as chips (the underline indicator becomes the chip tint). **Step 4: Pass.**
- [ ] **Step 5: Look** at `/` and `/transactions` 390 px: one line.
- [ ] **Step 6: Commit** — `feat(phone): the period on one sliding line`.

### Task 7: Transactions on a phone

**Files:** Modify `features/transactions/TransactionRow.tsx`, `TransactionsPage.tsx`, `TransactionsPage.css`; Create `features/transactions/TransactionSheet.tsx`; Test `TransactionRow.test.tsx`, `TransactionSheet.test.tsx`.

**Interfaces:** `TransactionRow` gains `onOpen(transaction)`; `TransactionSheet({ transaction, categories, onClose, onRecategorize, onToggleTransfer, onEdit })`.

- [ ] **Step 1:** Failing tests: the row carries a phone button « Ouvrir <libellé> » calling `onOpen`; the sheet shows the label, the amount, a « Catégorie » select that calls `onRecategorize`, the transfer switch, « Modifier ».
- [ ] **Step 2: Fail.** **Step 3:** Row ≤ 639 px: one grid `avatar | label + category text | amount`, 60 px high; the category select and the action cell hidden; the label cell holds `<button className="yd-transactions__open">` covering the row (visually the row). Day headings sentence case, 12 px. Toolbar: export and add as a compact row. **Step 4: Pass.**
- [ ] **Step 5: Look** — 39 September rows ≈ 39 × 61 px.
- [ ] **Step 6: Commit** — `feat(phone): compact transaction rows that open a sheet`.

### Task 8: The overview on a phone

**Files:** Modify `features/overview/OverviewPage.tsx`, `OverviewPage.css`, the « Ce qui a changé » panel; Test `OverviewPage.test.tsx`.

- [ ] **Step 1:** Failing tests: stat tiles span `sm: 1`; on a phone « Ce qui a changé » shows four items and « Voir les N autres », which reveals the rest.
- [ ] **Step 2: Fail.** **Step 3:** `SPAN.stat.sm = 1`; phone `order` per cell class (hero 1, stats 2, thirty days 3, changed 4, set aside 5, recent 6, cash flow 7, treemap 8, waterfall 9, calendar 10); charts get `phoneHeight` (`Chart` prop, 220 px, through `useMediaQuery`). **Step 4: Pass.**
- [ ] **Step 5: Look** — first chiffre within the first 844 px.
- [ ] **Step 6: Commit** — `feat(phone): the overview in reading order`.

### Task 9: The other screens on a phone

**Files:** Budgets (`features/budgets/BudgetsPage.css` order: list, breakdown, donut 220 px), Catégories (`features/categories/*`: one line per category + « ⋯ » 44 px button opening a sheet with Modifier / Supprimer), Suivi (`features/engagement/*`: three challenges + « Voir les N autres »), Avenir (`features/balance` KPIs `sm: 1`), and the remaining screens' small targets (`.yd-tap` on list actions) after the audit script.

- [ ] **Step 1:** Failing tests per screen for the behaviours (categories action sheet, challenges cap).
- [ ] **Step 2–4:** Implement, pass.
- [ ] **Step 5: Look** — run the audit script (below) on every route at 390 px, both themes: no overflow, no list control under 44 px, no field under 16 px.
- [ ] **Step 6: Commit** — one commit per screen group (`feat(phone): …`).

Audit script (DevTools `evaluate_script`, per route):

```js
async () => { await new Promise(r => setTimeout(r, 1800)); const W = innerWidth;
  const vis = e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const taps = [...document.querySelectorAll("main a, main button, main select, main [role=tab]")]
    .filter(vis).filter(e => e.getBoundingClientRect().height < 40);
  const small = [...document.querySelectorAll("main input, main select, main textarea")]
    .filter(vis).filter(e => parseFloat(getComputedStyle(e).fontSize) < 16).length;
  return { H: document.documentElement.scrollHeight, docW: document.documentElement.scrollWidth, W, taps: taps.length, small }; }
```

---

## Phase 2 — Le mouvement « Fluide »

### Task 10: Motion foundations

**Files:**
- Create: `design/motion/figureMemory.ts`, `design/motion/AnimatedNumber.tsx`, `design/motion/DeltaPill.tsx`, `design/motion/DeltaPill.css`, `design/motion/LoadSwap.tsx`, `design/motion/useAnimatedRatio.ts`
- Modify: `design/motion/variants.ts` (add `EXIT_EASE`), `features/auth/session.ts` (clear the memory with the session), `design/CountUp.tsx` (delegates to `AnimatedNumber`)
- Test: one test file per new module.

**Interfaces:**

```ts
// figureMemory.ts
export const useFigureMemory: UseBoundStore<StoreApi<{
  values: Record<string, number>;
  remember: (key: string, value: number) => void;
  clear: () => void;
}>>;
export function recall(key: string): number | undefined;
```

```tsx
// AnimatedNumber.tsx
export function AnimatedNumber(props: {
  value: number;
  format: (value: number) => string;
  /** Session memory key. Without one the figure only rolls between two renders. */
  memoryKey?: string;
  duration?: number; // seconds, default 0.64
  className?: string;
  /** Called once per change with (previous, next) — feeds a DeltaPill. */
  onChange?: (previous: number, next: number) => void;
}): JSX.Element;
```

```tsx
// DeltaPill.tsx
export function DeltaPill(props: {
  delta: number;                 // signed, in the figure's own unit
  format: (abs: number) => string;
  /** True when up is good news (balance, savings rate); false for spending. */
  upIsGood: boolean;
  suffix?: string;               // default « depuis ton dernier passage »
}): JSX.Element | null;          // null when delta === 0
```

```tsx
// LoadSwap.tsx
export function LoadSwap(props: {
  loading: boolean;
  skeleton: ReactNode;
  children: ReactNode;
  /** ms before the skeleton may show; default 150 */
  delay?: number;
}): JSX.Element;
```

```ts
// useAnimatedRatio.ts
export function useAnimatedRatio(key: string | undefined, ratio: number):
  { ratio: number; tone: "accent" | "warning" | "negative" };
```

Behaviour pinned by the tests:
- `AnimatedNumber`: first render with no memory → shows the value at once (no roll) and remembers it; re-render with a new value → rolls (`animate` called from the old value) and remembers the new one; mounted again with a remembered, different value → rolls from the remembered value and calls `onChange(old, new)`; same value → no animation; reduced motion → value at once, memory still updated. Screen readers get the true value (`aria-label`), digits `aria-hidden`.
- `DeltaPill`: « +212,25 € depuis ton dernier passage », positive tone when the move is good news, nothing for a zero delta.
- `LoadSwap`: loading for 100 ms then done → the skeleton never appears; loading for 300 ms → it appears after 150 ms and is replaced by the content (`AnimatePresence mode="popLayout"`, skeleton exit 200 ms fade); reduced motion → instant swap.
- `useAnimatedRatio`: tone flips at 0.8 and 1.0 of the *current* animated value.
- The session's `clearSession` empties the figure memory.

- [ ] Steps: failing tests → fail → implement → pass → `npm test` → commit `feat(motion): session figure memory, animated numbers, delta pills, delayed skeletons`.

### Task 11: Screens hand over to each other

**Files:** Create `app/routeDirection.ts` (+ test); Modify `app/AppShell.tsx`, `app/BottomTabs.tsx` (+ CSS), `app/AppShell.css`, `features/budgets/*` (layoutId on the category name), `features/budgets/universe/UniversePage.tsx` (same layoutId on its title).

**Interfaces:** `routeDirection(from: string, to: string): -1 | 0 | 1` — deeper path (same first segment, more segments) → 1; the reverse → −1; otherwise 0.

- [ ] Tests: `routeDirection("/budgets", "/budgets/12") === 1`, reverse −1, `"/budgets" → "/avenir"` 0, `"/invest" → "/invest/mandat"` 1, `"/reglages/connexions" → "/reglages"` −1.
- [ ] AppShell: `<AnimatePresence mode="popLayout" initial={false} custom={direction}>` around `<motion.div key={pathname|mode}>` with variants `enter: { opacity: 0, x: 14·d, y: d ? 0 : 6 }`, `center: { opacity: 1, x: 0, y: 0, transition: 0.26 s SIGNATURE }`, `exit: { opacity: 0, x: −14·d, transition: 0.14 s EXIT }`; the exiting screen is taken out of flow by `popLayout` (route wrapper `position: relative`).
- [ ] Budgets row name and universe title share `layoutId={"yd-budget-title-" + id}` inside a `LayoutGroup` in AppShell.
- [ ] Bottom tabs: an indicator `motion.span layoutId="yd-tabs-indicator"` behind the active tab, spring 520/42; the icon lifts 2 px when it becomes active.
- [ ] Sidebar: the entries of a newly selected environment enter with a 25 ms cascade.
- [ ] Commit `feat(motion): screens cross over, deeper screens arrive from the right`.

### Task 12: Skeletons that wait and cross-fade

**Files:** every screen with a loading branch (Overview, Transactions, Budgets, Recurrences, Plan, Analysis, Debts, Goals, Suivi, Categories, Patrimoine, Projection, Feasibility, Assistant, Proposals, invest pages, import history) and `design/PageSkeleton.css`.

- [ ] Each `loading ? <XSkeleton/> : <Content/>` becomes `<LoadSwap loading={loading} skeleton={<XSkeleton/>}>…</LoadSwap>`; `PageSkeleton` (route chunk fallback) fades in after 150 ms through CSS (`animation: yd-fade-in 160ms var(--yd-ease) 150ms both`, with the two motion-off twins).
- [ ] Existing screen tests keep passing (they wait for content, not for the skeleton).
- [ ] Commit `feat(motion): skeletons wait 150 ms and cross-fade into the screen`.

### Task 13: Figures and bars from the last value seen

**Files:** Overview (hero, three tiles), Avenir (fin de mois, point bas), Budgets (totals, bars), Patrimoine (net worth), Goals (progress), Debts (remaining), `design/DataProgress.tsx`, `features/import/ImportSummary.tsx`, `features/recurrences/RecurrencesPage.tsx`, `features/analysis/AnalysisPage.tsx`, `features/overview/SetAsidePanel.tsx`.

- [ ] `CountUp` call sites move to `AnimatedNumber` with memory keys (`overview.net`, `overview.income`, `overview.expenses`, `overview.savingsRate`, `avenir.end`, `avenir.low`, `budgets.total`, …) and a `DeltaPill` under the hero figures.
- [ ] Bars: `useAnimatedRatio("budget." + id, ratio)` drives `transform: scaleX()` and the tone class; goals/debts the same.
- [ ] Commit `feat(motion): figures and bars move from what the reader last saw`.

### Task 14: Charts draw once, then morph

**Files:** Create `charts/chartAnimation.ts` (+ test); Modify `charts/Chart.tsx`, `charts/OutlookChart.tsx`, bar charts (`CashflowChart`, `CategoryMonthsChart`, `SavingsChart`).

**Interfaces:**

```ts
export type ChartMotion = "draw" | "morph" | "still";
export function chartMotion(memoryKey: string | undefined, signature: string,
  memory: Map<string, string>): ChartMotion;
```

- [ ] Tests: unknown key → `draw`; same signature → `still`; different → `morph`; no key → `draw`.
- [ ] `Chart` gains `memoryKey?: string`: `draw` → `animationDuration 700, animationEasing "exponentialOut"`; `morph` → first `setOption(previousOption, { notMerge: true, silent })` without animation, then the new option with `animationDurationUpdate 600`; `still` → `animation: false`. Bars: `animationDelay: (i) => Math.min(i, 8) * 30`.
- [ ] Avenir: median and band `animationDuration: 900, animationEasing: "linear"`; mark points `animationDelay` = their index / day count × 900; low point label after.
- [ ] Commit `feat(motion): charts draw once, then morph from what was shown`.

### Task 15: Lists that glide

**Files:** `features/transactions/TransactionsPage.tsx`, `TransactionRow.tsx`, CSS; `features/import/ImportSummary.tsx` (link `?lot=<id>`); `lib/types.ts` (`import_batch_id` on `Transaction` if missing); proposals, alerts, declared recurrences, planned events, goals, debts, categories lists.

- [ ] Rows: `motion.tr layout="position"` inside `AnimatePresence mode="popLayout" initial={false}`; leaving rows fade 140 ms (220 ms + 28 px right when masked as a transfer); entering rows 280 ms rise 6 px, cascade 25 ms capped at 8.
- [ ] Recategorize: the category cell flashes (`yd-flash` 900 ms); when `backfilled > 0`, refetch the loaded page silently and flash every row whose category changed, 140 ms apart; the notice opens in height (`motion.div` `height: auto`).
- [ ] Import handoff: `?lot=<batch>` → rows of that batch get `data-new` for 3 s (accent bar + « nouveau »), then the parameter is removed (same handoff pattern as `q`).
- [ ] Other lists: `AnimatePresence` + `layout` on items that can be added or removed.
- [ ] Commit `feat(motion): lists glide, corrections show what they touched`.

### Task 16: Windows, menus, sections

**Files:** `features/search/GlobalSearch.tsx/.css`, `app/UserMenu.tsx/.css`, `app/EnvironmentSwitcher.tsx/.css`, `design/InfoTip.css`, global `details` rule in `design/controls.css`.

- [ ] Search dialog: `transform-origin: top`, opens with opacity 0 → 1 and scale .98 → 1 in 220 ms, groups cascade 30 ms, exit 140 ms.
- [ ] Menus and InfoTip: 160 ms in (opacity + scale .97 from the anchor), 100 ms out.
- [ ] `details`: `interpolate-size: allow-keywords` and `details::details-content { transition: height 240ms, content-visibility 240ms allow-discrete; height: 0; overflow: clip } details[open]::details-content { height: auto }`, chevron rotation; motion-off twins.
- [ ] Commit `feat(motion): windows open from where they were asked for`.

### Task 17: Feedback

**Files:** Create `design/motion/SaveFeedback.tsx` (+ test, + CSS); adopt it in the budget ceiling form, Réglages forms, category form, goal form; global error entry in `design/controls.css`.

- [ ] `SaveFeedback` renders the submit label, and for 1.4 s after `saved` turns true « Enregistré » with a drawn check (`stroke-dashoffset` 1 → 0, 320 ms).
- [ ] `[role="alert"]` and `.yd-field-error` enter with 4 px + fade 200 ms; `[aria-invalid="true"]` fields shake twice 3 px on submit (class toggled by the form).
- [ ] Commit `feat(motion): saved and refused say so in the control itself`.

### Task 18: Signature moments

**Files:** `design/theme.ts` / `app/ThemeProvider.tsx` (theme change through `document.startViewTransition` with a circular reveal from the click point), `features/goals/*` (ring closes → positive + drawn check), `features/import/ImportSummary.tsx` (rolling figures, « Voir les opérations » with `?lot=`).

- [ ] Tests: theme change still applies without `startViewTransition`; goal at 100 % renders the reached state.
- [ ] Commit `feat(motion): theme, goals and imports get their moment`.

### Task 19: Verification and documentation

- [ ] Full frontend suite, lint, build; backend untouched unless an API field was added (then its tests).
- [ ] Browser tour: every route at 390 and 1440, both themes, motion on and off, demo household.
- [ ] `CLAUDE.md`: a « Phone » and a « Motion » section (breakpoints, primitives, memory, rules).
- [ ] Memory note for the session.
- [ ] Commit `docs: the phone layout and the motion language`.
