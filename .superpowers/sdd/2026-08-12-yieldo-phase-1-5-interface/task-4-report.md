# Task 4 report — Transactions and import screens

Branch `phase-1-5-interface`. One commit on top of `3c4a848`.

This task was finished from a working tree left by a prior implementer that was
cut off by a rate limit before committing. Section 1 states what was already
there and how it was judged; section 2 states what this session changed.

---

## 1. What was in the tree, and the verdict on it

16 files were modified and uncommitted. Read as a whole, the work was complete
against the brief's Part A and Part B *as code*, and had been partly verified in
a browser (six screenshots existed). Nothing was reverted; the substance below
is the prior implementer's and it holds up.

**Part A — the pinned action bar.** `WizardActionBar` in
`frontend/src/features/import/ImportPage.tsx` replaces the old
`.yd-import__actions` row on both the mapping and the preview step. Two design
decisions in it are worth restating because they are load-bearing:

- `position: sticky; bottom: 0` rather than `position: fixed`. A sticky bar
  keeps its own box at the end of the step, so it is pinned while the page is
  longer than the viewport *and* settles below the table's last row once the
  reader reaches the bottom. That satisfies the brief's "must not cover the
  last rows / reserve space for it" **by construction** — there is no measured
  bar height to keep in sync with a padding value, which matters because the
  bar is one, two or three lines tall depending on the note under it. Verified
  on screen (`task4-import-preview-lastrow-1440-dark.png`).
- The counts are computed by two exported pure functions, `commitCounts` and
  `commitBlockedReason`, so the sentence under the button and the button's own
  `disabled` cannot drift apart. There is a test over the whole 2×2×2 matrix
  asserting a reason exists for exactly the states `canCommit` refuses.
  `commitCounts` counts the *decision* (a duplicate the user ticked "Importer
  quand même" moves from the ignored column to the imported one), not the file.

The wizard's behaviour is unchanged: `setRole` still invalidates the preview,
`canCommit` still gates `commit()`, and nothing is imported before the user has
confirmed the mapping on screen. The bar is `role="group"` with an
`aria-label`, no `aria-modal`, no focus trap; it is the last element of the
step's DOM, so the tab order runs table → bar (measured: last table control at
index 326, "Retour au tagging" 327, "Valider l'import" 328).

**Part B — the transactions screen.** `TransactionsPage` is on the bento grid
(filter band 1 track, list 3 tracks, both full width), the list keeps a real
`<table>` with four named columns, and the per-row `fadeInUp` was removed —
the cells stagger, the rows do not. `.yd-amount--negative` was applied to every
debit for the whole of phase 1 and matched **no CSS rule at all**; the colour
came from an inline style. Both tones now live in the stylesheet, and the
inline style is gone. That was the specific defect the brief called out.

**On the prior implementer's last words** ("the wide tables leak past their
scroll container and give the document a horizontal scroll at 375"): the fix
*was* in the tree — `.yd-import__tagger-cell, .yd-import__preview-cell {
overflow: hidden }`, plus a wrapping breadcrumb and compact bar buttons under
600px. Re-measured this session: `documentElement.scrollWidth === clientWidth`
(375) on the file, mapping and preview steps and on the transactions list, in
both themes. No document-level horizontal scroll anywhere.

---

## 2. What this session changed

Three files. Everything else in the diff is the prior implementer's.

### 2.1 The transactions table at 375 was broken on screen — `TransactionsPage.css`

This was found by taking the shot and looking at it, not by any test. The
mobile rule in the tree froze the amount column against the right edge with
`position: sticky` and let the rest scroll horizontally under it. Rendered, it
put an **opaque column through the middle of the category picker**: the header
read "CA", the select showed a single clipped letter, and the row was 82px tall.
It read as a broken table, not a scrollable one — and it put a sideways scroll
on a touch surface where the finger is already the page's scroll.

Replaced with a declared-column layout: `table-layout: fixed` under 600px, three
pinned widths (date `4.3rem`, category `5.4rem`, amount `4.9rem`) and the label
taking the remainder and wrapping. The source chip (`.yd-transactions__badge`)
is hidden at that width — it is the only thing dropped, and it repeats what the
picker already shows the result of.

Measured after: table 341px inside a 341px scroller (no inner scroll at all),
document scrollWidth 375, rows 47–124px against 82–166px before. All four
columns are legible and the picker is usable.

Trade-off accepted: `overflow-wrap: break-word` on the label means a word longer
than the ~100px column is cut ("REMBOURSEM / ENT AMELI"). It fires only on words
that cannot fit a line on their own; the alternative is overflow.

### 2.2 The import preview at 375 hid the amount — `ImportPage.css`

Seven columns will not fit 317px whatever is done to them, so the preview keeps
its horizontal scroll. But as it stood, `MONTANT` began 20px *past* the right
edge: the reader saw line numbers, dates and half a label, and had to scroll
sideways to check a single figure on the screen whose whole job is checking
figures before committing.

Under 600px the preview table now drops to `0.75rem`, tightens its cell padding,
lowers the label's minimum to `8ch`, and hides the CSV line-number column — an
ordinal that costs width and whose one meaningful use, a row that failed to
parse, repeats it inside the message ("Ligne 12 ignorée : …"), which is still
shown. Measured after: `MONTANT` ends at 299 of 317. Date, libellé and montant
are all on screen before any scrolling; catégorie and doublon are a swipe away.

The summary block's figures were also reduced at that width (six values at
1.15rem stood it 470px tall on an 812px screen and pushed the first previewed
row off the bottom; now ~260px including the cell's own padding and title).

### 2.3 The period range broke onto three lines — `ImportSummary.tsx`

`formatPeriod` joined the two dates with a plain space on each side of the en
dash, so an auto-fit grid track wrapped **before** the dash and stood the figure
on three lines with a lone "–" in the middle (visible at 768). A non-breaking
space glues the dash to the first date; it now breaks once, after the dash.
Measured at 768: the summary went from 3 lines / ~230px to 2 lines / 143px.

---

## 3. What was tested, and the results

**Automated.** `npm test` from `frontend/`: **330 passed, 34 files** (311 at
task start; the 19 new ones are the prior implementer's, over `commitCounts`,
`commitBlockedReason`, the bar's contents and its disabled matrix, the amount
tone classes coming from the stylesheet rather than an inline style, the list
cell being strictly the largest on the grid, and the four column headers).
Green before and after this session's changes.

`npm run build`: zero TypeScript errors. `npm run lint` left alone — eslint is
not installed repo-wide, as the brief says.

**Browser.** Chrome DevTools MCP against the running instance (frontend :5173,
backend :8000), logged in as the demo fixture, with the operator's real volumes:
197 transactions over `?periode=custom&du=2025-01-01&au=2026-01-09`, and a
generated 320-row French bank export (`Date;Libelle;Debit;Credit`, `;` separator,
comma decimal, `%d/%m/%Y`) driven through the whole wizard at each width.

Measured, not eyeballed:

| Check | Result |
|---|---|
| Document horizontal scroll at 375 (transactions, file, mapping, preview) | `scrollWidth == clientWidth == 375` everywhere |
| Action bar visible without scrolling, preview step | bottom == viewport height at 375 / 768 / 1440 |
| Action bar share of a 375×812 phone | 54px on the mapping step (6.7%), 86px on the preview step with counts + note (10.6%) — under the 13% task 2 had to rework |
| Bar covers the last row? | No: at scroll bottom the bar sits below row 320, outside the table's cell |
| Transactions table at 375 | 341px table in a 341px scroller, no inner scroll, 4 columns legible |
| Preview table at 375 | montant ends at 299 of 317 — visible before any scrolling |
| Tab order | last table control 326 → "Retour au tagging" 327 → "Valider l'import" 328; `role="group"`, no `aria-modal` |
| Focus ring on the bar | `2px solid rgb(126,226,214)` on `.yd-import__commit`, visible in the shot |
| `data-motion="off"` | every `.yd-bento__cell` resolves to `opacity: 1`, `transform: none`, `translate: none` |
| Contrast on the bar's surface, dark | warning 8.37, accent 11.29, negative 5.11, muted 7.07 |
| Contrast on the bar's surface, light | warning 6.68, accent 6.21, negative 6.57, muted 6.95 |
| Contrast in the list cell, dark / light | negative 5.11 / 6.57, positive 9.46 / 6.01, date 7.07 / 6.95 |

Every pairing clears AA (4.5:1) in both themes.

**Not exercised:** an actual commit. Committing 320 rows would have written into
the operator's fixture database; the disabled-commit state was reproduced
instead with a 40-row file of unparseable dates, which reaches the same
`canCommit === false` branch without mutating anything.

---

## 4. Files changed

Prior implementer's, kept:

- `frontend/src/design/bento/Bento.css` — `.yd-panel` / `.yd-panel__title` moved
  here from `OverviewPage.css`, now that three screens use them.
- `frontend/src/features/overview/OverviewPage.css` — the two rules removed, with
  a pointer left behind.
- `frontend/src/features/import/ImportPage.tsx` — `WizardActionBar`,
  `commitCounts`, `commitBlockedReason`, the four steps on the bento grid.
- `frontend/src/features/import/{ColumnTagger,DialectPanel,ImportSummary,PreviewTable}.tsx`
  — `GlassCard` dropped, the `BentoCell` is the surface. `PreviewTable`'s classes
  renamed `yd-preview__*` → `yd-import-preview__*` (the landing page's
  `DashboardPreview` owns `.yd-preview` and the two were overriding each other).
- `frontend/src/features/transactions/{TransactionsPage,FilterBar,TransactionRow}.tsx`
  — bento grid, per-row motion removed, the debit colour moved out of an inline
  style into `.yd-amount--negative`.
- `frontend/src/features/transactions/PeriodSelector.css` — tighter tabs under
  600px.
- `ImportPage.test.tsx`, `TransactionsPage.test.tsx`, `TransactionRow.test.tsx` —
  +19 tests.

This session's:

- `frontend/src/features/transactions/TransactionsPage.css` — the <600px block
  rewritten (§2.1).
- `frontend/src/features/import/ImportPage.css` — the <600px block extended
  (§2.2).
- `frontend/src/features/import/ImportSummary.tsx` — non-breaking space in
  `formatPeriod` (§2.3).

---

## 5. Screenshots

In `.superpowers/sdd/2026-08-12-yieldo-phase-1-5-interface/shots/`. All were
re-taken this session against the final code except `task4-import-file-1440-dark`
(the file step is untouched by this session's changes).

| File | What it shows |
|---|---|
| `task4-transactions-1440-dark.png` | The list at the operator's row count: one compact filter band, 47px uniform rows, four aligned columns, amounts right-aligned in mono, and the row counter + "Charger plus" on screen without scrolling. |
| `task4-transactions-1440-light.png` | The same in the light theme — the debit red and credit green both hold against a white cell. |
| `task4-transactions-768-dark.png` | Tablet: labels wrap to two or three lines, the four columns stay in line, the footer is still on screen. |
| `task4-transactions-768-light.png` | The same, light. |
| `task4-transactions-375-dark.png` | The fix in §2.1: four columns inside 341px, category picker whole and usable, no clipping, no sideways scroll. |
| `task4-transactions-375-light.png` | The same, light. |
| `task4-import-preview-1440-dark.png` | The preview step with 320 rows loaded, unscrolled: the bar is already on screen, stating "320 lignes à importer" beside both actions. |
| `task4-import-preview-1440-light.png` | The same, light. |
| `task4-import-preview-768-dark.png` | Tablet, unscrolled — the bar is pinned at the bottom before the reader has touched the page. |
| `task4-import-preview-768-light.png` | The same, light; also shows the period on two lines rather than three (§2.3). |
| `task4-import-preview-375-dark.png` | Phone, unscrolled: the bar takes 10.6% of the viewport and carries the count; date, libellé and montant are all visible (§2.2). |
| `task4-import-preview-375-light.png` | The same, light. |
| `task4-import-preview-lastrow-1440-dark.png` | Scrolled to the bottom: row 320 is fully visible and the bar has settled *below* the table's cell — proof it can never hide the last rows. |
| `task4-import-preview-blocked-1440-dark.png` | The disabled state: "0 ligne à importer" / "40 lignes en erreur" in the bar, the commit button greyed, and the French explanation under it — "Aucune ligne à importer : toutes les lignes de ce fichier sont des doublons ou en erreur." |
| `task4-import-mapping-blocked-1440-dark.png` | The other refusal: two columns tagged "Date", the specific errors in the alert, and the bar saying "Corrigez le taggage des colonnes avant de continuer." |
| `task4-import-mapping-stale-1440-dark.png` | The stale-preview note: the tagging changed, so the bar says the aperçu must be re-run before going on. |
| `task4-import-actionbar-focus-1440-dark.png` | Keyboard focus on "Valider l'import" — a 2px accent ring, no layout shift. |
| `task4-import-mapping-1440-dark.png` | The mapping step's grid: dialect 4 columns, column tagger 8 — the decision point gets the weight. |
| `task4-import-mapping-375-dark.png` / `-375-light.png` | The same step on a phone, its own way forward pinned. |
| `task4-import-file-1440-dark.png` | The file step: account cell 5 columns, drop zone 7. |

---

## 6. Self-review findings

Findings I raised against the tree and then acted on:

1. **The 375 transactions table looked broken, and no test could have said so.**
   Fixed (§2.1). This is the third time this phase that a rule which reads
   correctly in the stylesheet renders wrong — worth repeating that the browser
   pass, not the suite, is the gate.
2. **The preview's most important column was off-screen at 375.** Fixed (§2.2).
3. **A three-line date range at 768.** Fixed (§2.3).

Findings I raised and deliberately did *not* act on:

4. **The filter band takes ~270px of an 812px phone before the first row.** Six
   period tabs, a date range, a search box, two selects and a switch. Collapsing
   it behind a disclosure on a phone is the right answer, but it is a behaviour
   change to a shared component (`PeriodSelector` is also the dashboard's) and
   the brief says not to fork it. Left for task 5.
5. **At 768 the category `<select>` keeps its 200px maximum while the label
   wraps to three lines.** Capping the select narrower would buy density at the
   cost of truncating category names mid-word inside a control. Kept the names.
6. **The `Origine` chip is hidden under 600px** on the transactions list, and the
   `Ligne` column under 600px on the import preview. Both are deliberate, both
   are stated in the stylesheet comments, and neither carries information that
   is not recoverable elsewhere on the screen.

Checks that came back clean: no hard-coded hex in any changed file; no easing,
duration or delay written outside a variant; every amount still integer cents
with `formatCents` the only conversion; user-facing text French, code and
comments English; no `except: pass`-shaped silent fallback — the bar's refusal
always names a reason.

---

## 7. Concerns

1. **Reaching the bar by keyboard on the preview step means tabbing through
   every row.** 320 rows × one category `<select>` = 326 stops before "Retour au
   tagging". The bar is exactly where the brief asked for it (natural order,
   after the table, no trap), and a mouse or touch user is unaffected — but a
   keyboard-only operator with a 300-row file has a long walk. A skip link
   ("Aller à la validation") would fix it and would not disturb the tab order
   for anyone else. Out of scope here; worth a line in task 5's brief.
2. **`keepDuplicates` can outlive the rows it named.** Re-analysing after ticking
   "Importer quand même" does not clear the keep-list, so `duplicates -
   keptDuplicates` can go negative. `commitCounts` clamps it at zero, which keeps
   a nonsensical figure off the screen without inventing one. The underlying
   wizard behaviour is pre-existing and untouched by this task.
3. **The commit path itself was not exercised end to end** in a browser this
   session — see §3. The commit *button* and every refusal it can show were, and
   `ImportPage.test.tsx` covers a successful commit and a failing one.
4. **`.yd-transactions__cell--label { width: 100% }`** is what makes the desktop
   table give the label the slack, and it is also why the table inflates past
   its container when the columns' minimums do not fit. That is now harmless
   (fixed layout under 600px, room to spare above it), but it is a rule that
   would misbehave again at some width between the two if a fifth column ever
   arrives.

---

# Fix round 1 — on top of `61ec258`

Three findings from the review of `61ec258`. The eight Minor findings were
deliberately left alone for the whole-branch review to triage.

## F1. The sticky bar hid the focus ring of the controls above it

**Reproduced first, in the browser.** With `scroll-padding-bottom` forced to
`0px` on the scrolling root, at 1440×900: park the caret on the preview's
category `<select>` #16 and press Tab. The bar's top edge is at y=832; the
newly focused `<select>` #17 lands at **841–871** — entirely underneath the
opaque bar, and Chrome does not scroll at all, because as far as it is
concerned the control is already inside the scrollport. That is the finding,
exactly as written.

**Fix** — `frontend/src/features/import/ImportPage.css`, one rule:

```css
:root:has(.yd-import__actionbar) {
  scroll-padding-bottom: 8rem;
}
```

Neither wizard table owns a vertical scroll (`.yd-import-preview__scroll` and
`.yd-tagger__scroll` are `overflow-x` only), so the scrolling box is the
document and the reserve belongs on its root. `:has()` scopes it to the screens
that actually carry a bar — no other page pays for it. 8rem = 128px against a
bar measured at **68px** (1440, counts + two buttons) and **86px** (375, counts
+ note); the headroom covers a note that wraps further, and overshooting only
parks the focused row a little higher up the screen.

**Verified, same path, fix in place:**

| Width | Bar | Before Tab | After Tab | Ring clear of bar |
|---|---|---|---|---|
| 1440×900 | top 832, h 68 | next stop at 841 (under the bar) | focused at 371–401, scrollY 444→914 | **431px** |
| 375×812 | top 726, h 86 (10.6%) | next stop at 738 (under the bar) | focused at 328–356, scrollY 914→1324 | **370px** |

Outline in both cases: `rgb(126, 226, 214) solid 2px`, `outline-offset: 1px`.

## F2. The transactions category column was truncated to uselessness at 375

The four-column phone layout gave the category 5.4rem, which rendered
"Livrai" / "Remb" / "Salair" / "Loyer" — a column that could not tell
*Livraison* from *Livres*, or name which of the eight income categories a row
carried.

**Fix** — `TransactionsPage.css`, the `@media (max-width: 599px)` block: the row
becomes a two-line grid. Line one is date | libellé | montant, in their own
tracks, the amount still right-aligned in `--yd-font-mono`; line two carries the
category picker, indented under the label so the columns still read as columns.
It is still a table — one row per transaction, aligned tracks shared by the
header row and every body row, `CATÉGORIE` sitting over its own line — and it is
not a card.

Making the wrap possible means `display: block` on `<table>`/`<thead>`/`<tbody>`
and `display: grid` on the rows, which is also what stops a browser inferring
table semantics from the layout. So `TransactionsPage.tsx` and
`TransactionRow.tsx` now write `role="table"` / `"rowgroup"` / `"row"` /
`"columnheader"` / `"cell"` down explicitly instead of leaving them to the
display value. Two side effects of the reflow, both handled in the same block:
the hover/focus tint moves from the cells to the row (the cells no longer own
the row's inset, so a cell-level tint would stripe the row and leave the gutters
bare), and the sticky header band moves from each `<th>` to the header row
(per-cell opaque backgrounds would paint three rectangles instead of one band).

Measured at 375×812:

| | Before | After |
|---|---|---|
| Category `<select>` width | ~86px, text clipped mid-word | **219px**, "Livraison" / "Remboursements" whole |
| Row heights (first 8) | 82–166px | **75–95px** |
| Document horizontal scroll | none | none (`scrollWidth == clientWidth == 360`) |

Also checked for overflow at **320px** (`docScroll 305 == 305`, select 164px,
"Livraison" still whole) and at the **599px** boundary (`584 == 584`, rows 56px).
Above the breakpoint nothing moved: at **768** and **1440** the table is still
`display: table`, the rows `table-row`, and the four columns start at identical
x for every row (1440: 257 / 372 / 995 / 1288; 768: 17 / 132 / 316 / 609), rows
a uniform 47px at 1440.

## F3. `PeriodSelector.css` is shared — the dashboard at 375

Checked, both themes, `Tout` selected so the screen is populated. The tabs are
**not** broken: six tabs on two lines inside the 343px band (line one Mois /
Trimestre / Année / Depuis janvier / Tout, ending at x=333; line two
Personnalisé), 75px tall in total, the selected tab underlined by its indicator,
and no horizontal document scroll. `task3-375-dark.png` and `task3-375-light.png`
re-shot against the current code so the record matches.

## What changed

- `frontend/src/features/import/ImportPage.css` — the `scroll-padding-bottom`
  reserve (F1).
- `frontend/src/features/transactions/TransactionsPage.css` — the `<600px`
  block: two-line grid rows, tint and header band moved to the row (F2).
- `frontend/src/features/transactions/TransactionsPage.tsx` — explicit table
  roles, `.yd-transactions__body` on the `<tbody>` (F2).
- `frontend/src/features/transactions/TransactionRow.tsx` — explicit `row` /
  `cell` roles (F2).

Covering tests (all three written failing first):

- `frontend/src/features/import/ImportPage.test.tsx` — "reserves the bar's
  height on the scrolling root, so a focused control below the fold is not
  scrolled under it".
- `frontend/src/features/transactions/TransactionRow.test.tsx` — "declares its
  table semantics instead of leaving them to the layout" (asserts the written
  attribute, not the role jsdom infers from the tag — only the attribute
  survives `display: grid` in a real browser) and "gives the category a line of
  its own on a phone".

## Commands and output

```
$ npm test          (from frontend/)
 Test Files  34 passed (34)
      Tests  333 passed (333)

$ npm run build     (from frontend/)
 ✓ built in 4.02s          — zero TypeScript errors
```

333 = the 330 at `61ec258` plus the three above. `npm run lint` left alone:
eslint is not installed repo-wide.

## Screenshots re-shot

| File | What it shows |
|---|---|
| `task4-transactions-375-dark.png` | The fix for F2: two-line rows, "Livraison" / "Loyer" / "Remboursements" fully legible in a 219px picker, the four column headers still over their columns, no sideways scroll. |
| `task4-transactions-375-light.png` | The same, light — the debit red and credit green both hold against a white cell. |
| `task4-import-preview-375-dark.png` | The preview step unscrolled at 375: the bar is already on screen with "320 lignes à importer" and both actions, and the summary above it fits. |
| `task4-import-preview-375-light.png` | The same, light. |
| `task4-import-focus-below-fold-1440-dark.png` | F1 at 1440: Tab from a control whose successor sat inside the bar's band; the ring is now on row 18, mid-screen, 431px clear of the bar. |
| `task4-import-focus-below-fold-375-dark.png` | F1 at 375, where the bar is 86px rather than 68: the whole teal ring is visible with the bar and both its buttons below it, untouched. |
| `task3-375-dark.png` | The dashboard at 375 after the shared `PeriodSelector` edit: six tabs on two tidy lines, "Tout" selected and underlined, every cell below intact. |
| `task3-375-light.png` | The same, light. |

## Concerns from this round

1. **At 375 the import preview's category picker is still clipped horizontally
   when tabbed to.** Chrome scrolls the *document* for a focused control (which
   is what F1's fix acts on) but does not scroll `.yd-import-preview__scroll`'s
   inline axis: measured `scrollLeft` stays 0 while the focused `<select>`'s
   right edge sits at 491 against a container edge at 331. This is a property of
   the accepted "seven columns keep a horizontal scroll at 375" design, is
   unrelated to the bar, predates this task, and no CSS reaches it. The 375 shot
   above was taken with the table scrolled to the category column, which is how
   a reader working that column would have it.
2. **The 8rem reserve is a constant.** It is comfortably larger than every bar
   measured (68px, 86px), and overshooting is harmless — but a future bar with a
   much taller note would need the number revisited. There is no measured height
   in the code to drift, only this one.
3. **Concerns 1–4 of §7 above still stand**, unchanged by this round.
