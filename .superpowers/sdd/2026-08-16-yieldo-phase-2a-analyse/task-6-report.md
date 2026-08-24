# Task 6 — Budgets screen — report

**Status:** DONE_WITH_CONCERNS
**Commit:** `6e7a6ce` feat(budgets): add the monthly budget screen with per-category consumption
**Branch:** `phase-2-analyse-decision` (was `a130635`)

---

## What was implemented

`/budgets`, in front of task 5's `GET /api/budgets`. Three bento cells: the
month's totals, one `BudgetBar` per budgeted category (worst first, as the API
sorts them), and a "Sans budget" column with one input per category that was
spent on without a ceiling. Until `/categories` exists this screen is the only
place a monthly budget can be set.

Produced, as the brief specifies:

- `parseCents(text): number | null` in `design/theme.ts` — the exact inverse of
  `formatCents`. String arithmetic end to end; returns `null`, never `0`, on
  anything it cannot read exactly, including a third decimal.
- `BudgetStatus` / `BudgetLine` / `UnbudgetedCategory` / `BudgetReport` in
  `lib/types.ts`. `status` is the closed `"ok" | "at_risk" | "over"` union that
  mirrors the backend's `BudgetStatus` literal, not a widened `string`.
- `<BudgetBar line={...} />` plus the exported `fillPercent`.
- Route `/budgets` and the nav entry "Budgets", after Transactions.

### Not in the brief, added deliberately

- **`design/Skeleton.css`.** The brief's skeleton markup uses `.yd-skeleton`,
  which lived in `features/overview/OverviewPage.css`. The budgets screen would
  have depended on it only by accident of how Vite assembles the bundle — the
  exact coupling the comment at the top of `design/bento/Bento.css` calls out
  when it explains why `.yd-panel` was moved there. The primitive (bar,
  shimmer, keyframes, both motion off-switches) now lives in a shared file that
  both screens import; the per-screen size variants stay with their screens.
  `motionPreference.test.ts`'s path assertion was repointed accordingly.
- **`design/Skeleton.test.ts`** — see defect 1 below.

---

## Defects found by opening it in a browser

None of these three were visible to the jsdom suite; all three were found on
screen and are fixed in the commit.

### 1. The loading skeleton was invisible in the light theme (pre-existing, app-wide)

`.yd-skeleton` was painted with `--yd-surface-raised`. In the light theme that
is `rgba(255,255,255,0.86)` and the bento cell under it is
`--yd-surface-strong: #ffffff`. Composited in the browser: **1.000:1**. The
loading state of every screen in the app — the dashboard included — was three
blank white cards.

Fixed by deriving the bar from `--yd-text` (`color-mix(in srgb, var(--yd-text)
12%, transparent)`), so it is a tint of the foreground and can never match the
surface it lies on. No hard-coded hex; `contrast.test.ts` is untouched and green.

Pinned by the new `design/Skeleton.test.ts`, which parses `tokens.css`, resolves
the `color-mix()` the stylesheet declares, composites it over
`--yd-surface-strong` per theme and asserts the result is distinguishable. I
verified it fails on the old value: reverting the one declaration turns all four
of its cases red. *(Corrected in the fix round below — the original sentence went
on to claim the failure message names the 1.000:1 composite, and it does not.
With `background: var(--yd-surface-raised)` restored, `parseSkeletonMix()`
returns null, so three of the four cases fail with "expected null not to be
null" and the fourth on the `--yd-surface` regex; none of them reaches the
compositing branch. The test goes red on exactly the regression it was written
for, but by refusing to do the arithmetic at all rather than by doing it and
reporting 1.000:1.)*

### 2. The month navigation dropped a click, and the header lagged a month behind

`current` was read as `report?.month ?? askedMonth`. `report` is not cleared
while the next month is in flight, so:

- the header sat on the month being *replaced* for the whole load (seen on
  screen: clicking "Mois suivant" from December left "Décembre 2025" up while
  January loaded), and
- a second click on "Mois précédent" before the first response landed recomputed
  `shiftMonth` from the *stale* month and refetched the one already in flight —
  the screen simply stopped going back.

Fixed to `askedMonth ?? report?.month ?? ""`: the URL is the request. The
fallback still covers the first visit, where no `?mois=` exists and the report
carries whatever month the backend resolved to the user's latest transaction.
Covered by a new regression test that clicks "Mois précédent" twice and asserts
`2025-11` is asked for; it fails on the old expression.

### 3. The summary cell did not earn its 12 columns

`SPAN.summary` is full width, but the totals stacked in two `1fr` tracks, which
stretched "Dépensé" to the middle of a 1160px card and left the right two thirds
empty at 1440. The two figures now size to their content, and from 768px the
verdict moves onto their row and takes the width they leave.

---

## Other things changed after looking at the screen

- **Month arrows were `◀` / `▶` glyphs.** MASTER.md forbids emoji-as-icon and
  U+25C0/U+25B6 take emoji presentation on some platforms. Replaced with inline
  SVG chevrons on the same 24×24 / 1.6px-stroke Lucide grid as
  `features/landing/icons.tsx`, which is how the rest of the app draws icons.
- **The budget row head wrapped inconsistently at 375.** Long names pushed the
  figures onto their own line on some rows and not others, so the list lost its
  rhythm. Below 480px the figures now always take their own line, right-aligned
  onto the track's edge, so every row is built the same way.

---

## Deviations from the brief

1. **`BudgetBar.test.tsx`, the overrun case.** The brief asserts
   `getByText(/45,00/)`. That matches two elements: the note says "Dépassé de
   **45,00** €" and the figures say "3**45,00** €". I confirmed it — the bare
   regex fails with "Found multiple elements with the text: /45,00/". Tightened
   to `/Dépassé de 45,00/`, which keeps the pinned value and the intent.
2. **`parseCents`'s whitespace class** is written `/[\s  ]/g` rather
   than with the literal U+00A0 / U+202F characters. Identical behaviour (`\s`
   already covers both); escapes keep invisible characters out of the source.
3. **Budget amounts used for verification.** The brief says to set Courses 300 €,
   Carburant 120 €, Restaurants 150 €. The fixture has no "Carburant" spend in
   the month the screen opens on, and none of the three pinned values produces an
   overrun — but the brief's own checklist requires seeing a bar over 100 %. Set
   through the screen: Courses 300 €, Restaurants 150 €, Énergie 120 € (the
   stand-in for the pinned Carburant 120 €), plus Équipement 150 € and Loyer
   1 200 €, which are below what was actually spent and so produce the two
   `over` bars.
4. Two extra unit tests on `monthLabel` / `shiftMonth` (year-boundary stepping),
   and two on the nav entries in `AppShell.test.tsx`, which had no assertion
   listing them.

---

## Tests

| Suite | Result |
|---|---|
| Backend `pytest -q` | **324 passed** (unchanged — no backend code touched) |
| Frontend `npm test` | **426 passed**, 40 files (was 389 / 37) |
| `npm run build` | **zero TypeScript errors** |

37 new frontend tests: 9 `parseCents`, 9 `BudgetBar`, 13 `BudgetsPage`, 4
`Skeleton.css`, 2 `AppShell` nav.

Every new test was watched fail first. The two that matter most were verified to
fail against the specific defect they guard: the skeleton test against the old
`--yd-surface-raised` declaration (4 named failures), the double-click test
against the old `current` expression.

`npm run lint` cannot run — `eslint` is not installed in `frontend/node_modules`.
Pre-existing; unrelated to this task.

---

## Screenshots

All in `.superpowers/sdd/2026-08-16-yieldo-phase-2a-analyse/shots/`. Every one
was read back and judged. The screen opens on **janvier 2026** — the month of
the operator's last transaction, not the permanently empty current month.

### The six required combinations

| File | What it shows |
|---|---|
| `task6-budgets-375-clair.png` | Cells stacked one per row; every budget row is name → figures → bar → verdict, uniform; the "Sans budget" input and its "Définir" button both sit inside the card. |
| `task6-budgets-375-sombre.png` | The same at 375 in dark; the two red over-budget bars and the three green ones stay clearly distinct against the deep navy cell. |
| `task6-budgets-768-clair.png` | Six-column grid, all three cells full width; the month nav sits exactly on the 16px content edge, not clipped. |
| `task6-budgets-768-sombre.png` | Same layout in dark; the "Ce mois-ci" band reads figures-left, verdict-right on one line. |
| `task6-budgets-1440-clair.png` | Twelve-column layout: summary band across the top, bars (7) beside "Sans budget" (5); the verdict anchors the band's right end so the full-width cell is no longer half empty. |
| `task6-budgets-1440-sombre.png` | The same at 1440 in dark, with the sidebar's active "Budgets" pill. |

### Supporting evidence

| File | What it shows |
|---|---|
| `task6-statuses-768-sombre.png` | All three fill colours at once — red (over), amber (at_risk, forced), green (ok) — each with its status stated in words. |
| `task6-skeleton-768-clair.png` | The loading state **after** the fix: grey shimmer bars in the same three cells as the loaded layout. This is the shot that was three blank white cards before defect 1 was fixed. |
| `task6-skeleton-768-sombre.png` | The same in dark, and the header correctly reading "Décembre 2025" — the month being *requested*, which is defect 2 fixed. |
| `task6-reduced-motion-768-sombre.png` | With the in-app Animations switch off: every cell at opacity 1, every bar at its final width, nothing stranded. |
| `task6-empty-month-768-sombre.png` | March 2024, a month with budgets but no spend: every bar honestly at 0 %, no fabricated figures. |
| `task6-focus-768-sombre.png` | Keyboard focus on "Mois suivant" — 2px teal ring, 2px offset. |

---

## Browser checklist

| Check | Result |
|---|---|
| Every bar has non-zero width | **Pass.** Measured at 1440: 615 / 615 / 344 / 252 / 80 px in a 617px track. At 375: 291 / 291 / 163 / 119 / 38 in a 293px track. `getComputedStyle(...).width` is never `0px`. |
| >100 % draws a full bar, no row overflow at 375 | **Pass.** Both over-budget rows cap at 291 of a 293px track; `fill.right > row.right` is false for every row. |
| Month nav reachable and legible at 375, no three-line wrap | **Pass.** One line, 36px targets. |
| "Sans budget" input + button fully visible at 375, not clipped | **Pass.** Input right edge 240px, button right edge 334px, cell right edge 359px. |
| `.yd-budget__status` clears 4.5:1 over the composited surface, both themes | **Pass.** Dark **15.75:1**, light **16.72:1**. Measured by walking up to the first opaque ancestor and compositing, not by reading a token. Every other text pairing on the screen was measured too; the lowest is 6.21:1 (the "Définir" button in light). |
| Warning and negative fills distinguishable from positive, both themes; status always in words | **Pass.** Dark: `#e5606b` / `#f4a261` / `#4fd6a8`. Light: `#b3232d` / `#8a4d08` / `#0e7150`. Three distinct values in both. Fills clear 6.0–6.6:1 against the cell (WCAG 1.4.11 wants 3:1). The status word is printed on every row regardless. |
| Previous month does not flash an empty grid | **Pass.** With the request held open, the grid is `role="status" aria-busy="true"` on the same three cells; widths identical (453px), heights within the same band. |
| Reduced motion: bars at final width, no cell at opacity 0 | **Pass.** `data-motion="off"`: all cells `opacity: 1`, `transform: none`, `translate: none`; all five fills at final width with `transition-property: none`. |
| No horizontal scroll, no overflowing element | **Pass** at 375, 768 and 1440. `scrollWidth === clientWidth`; no descendant of `.yd-budgets` extends past the viewport. |
| No console errors or warnings | **Pass.** |

---

## Self-review

**What I would still flag:**

- **`at_risk` cannot be reached with the operator's data.** The engine only
  projects a pace for an in-progress month (`0 < elapsed < total_days`), and the
  ledger ends 2026-01-09 while today is 2026-08-17, so every month he can look at
  is finished and `projected_cents` is always `null`. The screen says so
  explicitly ("Mois terminé : … aucune projection n'est faite"). I verified the
  amber fill by forcing the modifier onto a live row in the browser
  (`task6-statuses-768-sombre.png`) and the copy by unit test; I could not
  observe it arise naturally. That is the engine's honest behaviour, not a bug in
  this screen, but it means the `at_risk` path has never run end to end on real
  data.
- **The light theme's `--yd-warning` is a dark brown (`#8a4d08`)**, not an amber.
  It is measurably distinct from `--yd-negative`, and status is never carried by
  colour alone, so this is not an accessibility failure — but at a glance the
  at_risk and over bars are closer in the light theme than in the dark one. The
  token is governed by `contrast.test.ts` and shared app-wide; changing it is out
  of scope for this task.
- **The full empty state is only covered by a unit test.** Once budgets exist for
  the demo user, `lines` is never empty, so the "Aucun budget défini" branch
  cannot be reached in the browser without deleting them. I saw the *unbudgeted*
  half of that screen before setting any budgets; the `EmptyState` branch itself
  is jsdom-only.
- **Redundancy I left alone deliberately:** the budget input carries both a
  wrapping `<label>` with sr-only text and an `aria-label` with the same string,
  and the test's fetch mock has a `GET /api/categories` handler the page never
  calls. Both come from the brief. Neither is a defect — the accessible name
  resolves correctly and the dead handler is inert — so I did not churn pinned
  code over taste.
- **`setParams({ mois: key })` replaces the whole query string.** Fine today,
  since `mois` is the only parameter `/budgets` uses; worth remembering if a later
  task adds a filter to this screen.

**On scope:** the shared-skeleton extraction and the defect-1 fix reach outside
`features/budgets/`. I judged that warranted — the brief's own markup depends on
that primitive, and shipping a screen whose loading state is invisible in one of
two required themes is precisely the failure mode this phase exists to stop. The
change is mechanical (one rule moved, one declaration changed, one test path
repointed) and the dashboard is fixed by the same edit.

---

# Task 6 — fix round (review findings 1–4)

**Status:** DONE
**Commit:** on top of `6e7a6ce`
**Branch:** `phase-2-analyse-decision`

The screen itself was approved; these are the four findings the review raised
against it, plus the one wrong sentence in this report (corrected in place
above, in defect 1). The skeleton fix from `6e7a6ce` is untouched.

---

## Finding 1 (Important) — a save flashed the whole page back to skeletons

`onSaved` bumped `reloadToken`, the effect re-ran, `setIsLoading(true)` swapped
the entire body for the skeleton grid, and every `BudgetInput` on it unmounted
with its local `value`. Filling in three budgets and clicking *Définir* on the
first emptied the other two.

The effect now separates a **navigation** from a **refetch**:

```tsx
const shownMonth = useRef<string | null | undefined>(undefined);

useEffect(() => {
  const isNavigation = shownMonth.current !== askedMonth;
  shownMonth.current = askedMonth;
  async function load() {
    if (isNavigation) setIsLoading(true);
    ...
```

A month change reaches a different `askedMonth` and still blanks to the
skeleton — that one is a real navigation, and the skeleton is how the screen
says the figures are about to be replaced. A save re-asks for the month already
on screen, so the grid stays mounted and only the data underneath it changes.
The first mount is a navigation by construction (`undefined !== null`), and
`isLoading` starts `true` regardless, so nothing changed about the first paint.

`onSaved` lost its `setError(null)`: with save failures now reported at the
field (finding 2), page-level `error` is only ever a *load* failure, and a load
failure sets `report` to null — no input is rendered to save from.

## Finding 2 (Important) — a rejected or failed save reported itself off-screen

Both failure paths moved into `BudgetInput`, under the field that caused them.
`onError` is gone from its props; it owns a local `error` instead, rendered as a
`role="alert"` in a third grid area of the row, wired to the input with
`aria-invalid` and `aria-describedby`. Typing again clears it — what was typed
is what was rejected, so once it changes the message no longer describes the
field it sits under.

The page-level alert stays exactly where it was, for the one failure that has no
field to attach to: a failed load.

Measured on screen at 375 (below): the message lands 4 px under the input, fully
inside the viewport, no scrolling.

## Finding 3 (Minor) — "Choisissez une catégorie à droite" was wrong below 1200px

`SPAN.unbudgeted` is `{ base: 1, md: 6 }`. Confirmed in the browser at 768: the
"Sans budget" cell's top is 816 px, the bars cell's is 338 px, and their left
edges are both 16 px — it is *below*, not to the right. Now:
"Aucun budget défini. Choisissez une catégorie dans « Sans budget » pour
commencer." Named, not placed, so it holds at all three required widths.

## Finding 4 (Minor) — `fillPercent`'s clamp was duplicated inline

`BudgetBar` recomputed `Math.round(Math.min(100, Math.max(0, ratio * 100)))` for
`aria-valuenow`. Extracted to `consumedPercent(ratio: number): number`;
`fillPercent` is now `${consumedPercent(ratio)}%` and `aria-valuenow` is
`consumedPercent(line.consumed_ratio)`. One clamp, two readings of it.

---

## Tests

| Suite | Result |
|---|---|
| Backend `pytest -q` | **324 passed** (no backend code touched) |
| Frontend `npm test` | **437 passed**, 40 files (was 426) |
| `npm run build` | **zero TypeScript errors** |

11 new tests. 9 of them were watched fail on the pre-fix code; the 2 marked
below as guards passed from the start by design — they exist to stop a
regression in behaviour that is already correct, which is stated plainly here
rather than dressed up as red-to-green.

| Test | Guards |
|---|---|
| `keeps what is typed in the other fields when one budget is saved` | Finding 1. Types into two rows, saves one, asserts the other still holds `120`. Fails pre-fix: the input remounts empty. |
| `does not blank the grid to skeletons while a save reloads` | Finding 1. Holds the reload's response open and asserts "Courses" and the other input are still in the document. Fails pre-fix. |
| `still shows the skeleton on a month change` | *Guard.* The half of finding 1 that must **not** change. Holds the response open, asserts `role="status"` / `aria-busy` and that "Courses" is gone. |
| `states an unreadable amount at the field that caused it` | Finding 2. Asserts the alert is inside the row's `<li>`, plus `aria-invalid` and the accessible description. Fails pre-fix. |
| `states a rejected save at the field too, verbatim from the backend` | Finding 2. 422 from `PATCH /api/categories/{id}`, asserts the backend's French `detail` at the field. Fails pre-fix. |
| `points at the other panel by name rather than by a position it only has at 1200px` | Finding 3. Fails pre-fix on "à droite". |
| `consumedPercent` ×3, and `fillPercent` "is `consumedPercent` and nothing else" | Finding 4. Fail pre-fix: the export does not exist. |
| `draws the fill and announces the value from the same clamped figure` | *Guard.* Finding 4. Ties `aria-valuenow` to the rendered width at ratio 3.4. |

The shared `report` fixture grew a second unbudgeted category (Énergie), which
is what makes "the *other* field kept its text" expressible at all.

`npm run lint` still cannot run — `eslint` is not installed. Pre-existing.

### The corrected sentence

Verified by experiment, not by reading. Reverting `Skeleton.css` to
`background: var(--yd-surface-raised)` and running `npm test -- Skeleton`:

```
× paints the bar as a tint of a token ... → expected null not to be null
× does not paint the bar with a surface token ... → expected '...' not to match /background:[^;]*--yd-surface/
× dark theme: the bar is visible against the cell it sits on → expected null not to be null
× light theme: the bar is visible against the cell it sits on → expected null not to be null
Test Files 1 failed (1)
```

All four red, as originally claimed — but three on "expected null not to be
null" and one on the `--yd-surface` regex. No case reaches the compositing
branch, so no message names 1.000:1. The file was restored and is green again.

---

## Browser verification

Chrome DevTools MCP against the running instance, logged in as the demo
operator, janvier 2026. **Both Important findings verified at 375**, which is
where finding 2 bites.

| Check | Result |
|---|---|
| Save keeps the other fields' text (375, clair) | **Pass.** Typed `80` into Livraison, `150` into Billets et voyages, `120` into Internet et téléphone; saved Billets et voyages. It moved into the bars list; Livraison still held `80` and Internet et téléphone still held `120`. |
| No skeleton during that save | **Pass.** A `MutationObserver` armed before the click counted `0` insertions of `.yd-skeleton`. Scroll position also unchanged (754 px before and after). |
| Skeleton still fires on a month change | **Pass.** Same observer, then "Mois précédent": count `1`, header "décembre 2025". |
| Invalid amount visible without scrolling (375) | **Pass.** `abc` → the message renders 4 px below the input, rect top 439 / bottom 479 in an 812 px viewport, `visibleWithoutScrolling: true`, and it is the page's **only** `role="alert"`. |
| The alert is at the field, not at the top | **Pass.** `a.closest('.yd-budgets__suggestion')` is the Livraison row; the a11y tree shows the input as `invalid="true"` with `description="Montant invalide : …"`. |
| Failed save reported at the field (375) | **Pass.** `PATCH` stubbed to 409 in the page: "Budget refusé : la catégorie a été supprimée entre-temps." rendered in the Streaming row, in the viewport (top 675 of 812), the typed `20` kept and the button re-enabled. The stub was removed afterwards. |
| Field error contrast, both themes | **Pass.** Composited against the first opaque ancestor: dark `rgb(229,96,107)` on `rgb(15,28,40)` = **5.11:1**; light `rgb(179,35,45)` on `#ffffff` = **6.57:1**. Both clear AA at 13.6 px. |
| Field error does not overflow its cell (1440) | **Pass.** Alert right edge 1376 px, cell right edge 1401 px; `scrollWidth === clientWidth` at 375 and at 1440. |
| "Sans budget" really is below at 768 | **Pass**, and that is the point of finding 3: bars cell top 338 px, "Sans budget" top 816 px, both at left 16 px. |
| Console | **Clean.** No errors or warnings across the session. |

### Shots

| File | What it shows |
|---|---|
| `task6-fix-field-error-375-sombre.png` | The invalid-amount message under the Livraison field at 375 dark, on screen without scrolling. |
| `task6-fix-field-error-375-clair.png` | The same in the light theme. |
| `task6-fix-save-keeps-input-375-clair.png` | After saving Billets et voyages: its new bar in the list above, and Livraison `80` / Internet et téléphone `120` still filled in below. Finding 1 in one frame. |
| `task6-fix-save-rejected-375-clair.png` | A 409 from the backend reported in the Streaming row, at 375, in the viewport. |
| `task6-fix-field-error-1440-clair.png` | The error row at 1440: inside the 5-column "Sans budget" cell, the rows below simply pushed down. |

The six required width × theme combinations from the first round were **not**
re-shot: the loaded screen is unchanged by these fixes (the field error is
invisible until triggered, the copy change is in a branch that needs zero
budgets set, and no layout rule moved). The fixture was left exactly as the
first round's shots describe it — the one budget set during verification
(Billets et voyages, 150 €) was cleared back to `null` afterwards, and the
reloaded screen shows the same five bars and five unbudgeted rows as before.

---

## Not touched, as instructed

The four deferred Minor findings remain open: a first-load failure with no
`?mois=` leaving the screen inert, the alert's undisclosed `--yd-negative`
colour deviation, and `consumed_ratio` of NaN/Infinity rendering a full bar.

One note for whoever takes the `--yd-negative` one: the new field error uses the
same `color: var(--yd-negative)` as `.yd-dropzone__error` on the import screen,
deliberately, so a rejected field looks the same everywhere in the app. Whatever
resolves that deferred finding should resolve both together rather than leaving
the two error styles to drift apart.

## Self-review

- **A save has no busy indicator between the PATCH landing and the reload
  arriving.** The button is disabled for the PATCH itself, and the row visibly
  moves into the bars list when the reload lands, so the operator is not left
  guessing — but for the width of one request the screen shows figures that are
  one save out of date, with nothing saying so. Adding `aria-busy` to the loaded
  grid would say it; I judged the extra state outside the scope of a fix round,
  and am flagging it rather than shipping it silently.
- **Finding 3's branch is still jsdom-only on screen.** `lines` is empty only if
  no category anywhere has a budget, which the demo operator's data no longer
  allows. The copy is pinned by a unit test; the *premise* behind the fix — that
  "Sans budget" is stacked below at 768 — was measured in the browser.
- **The `role="alert"` per row is assertive.** Only one can be triggered at a
  time by a single click, so there is no pile-up, but a screen-reader user who
  triggers two in quick succession will hear the second interrupt the first.
  `role="alert"` is what the rest of the app uses for the same job and what the
  existing pinned test queries for; changing it was not this round's business.
