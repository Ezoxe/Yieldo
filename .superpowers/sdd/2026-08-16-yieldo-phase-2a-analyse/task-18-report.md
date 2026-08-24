# Task 18 — Analyse screen — report

**Commit:** `d684df0` — `feat(analysis): add the personal inflation and anomaly screen`
**Branch:** `phase-2-analyse-decision` (parent `7f147a2`)
**Suites:** backend 522 passed (unchanged, no backend code touched), frontend 585 passed
(was 532, +53), `npm run build` exit 0 with zero TypeScript errors.

---

## 1. What was implemented

`/analyse`, in front of `GET /api/analysis/inflation`, `GET /api/analysis/anomalies` and the
`GET`/`PUT` pair for the reference price index.

Four bento cells, at lg 5 / 7 then 7 / 5:

| Cell | What it holds |
|---|---|
| **Votre panier** | The basket's own year-over-year ratio, the two costs behind it, the two windows compared, what the basket is summed over, and the reference-index line. On a refusal: the engine's own sentence and **no figure at all**. |
| **Où l'argent part davantage qu'avant** | Comparable categories with their ratio and `previous → current` cost; incomparable ones inside a disclosure that opens itself when there is nothing else in the cell. |
| **Montants inhabituels** | The anomaly feed in the payload's own order, each row stating the gap from its category's usual amount; the ranking note; the scope note; the skipped groups in a disclosure. |
| **Indice de référence** | `PriceIndexForm` — paste, save, clear. |

Plus a screen-level banner above the grid saying what the period selector actually does to
each of the two engines, since "Tout" does not mean the same window on both sides.

### Files

**Created**
- `frontend/src/features/analysis/AnalysisPage.tsx`
- `frontend/src/features/analysis/AnalysisPage.css`
- `frontend/src/features/analysis/AnalysisPage.test.tsx` (26 tests)
- `frontend/src/features/analysis/PriceIndexForm.tsx`
- `frontend/src/features/analysis/PriceIndexForm.test.tsx` (21 tests)

**Modified**
- `frontend/src/lib/types.ts` — `CategoryInflation`, `Inflation`, `Anomaly`,
  `SkippedCategory`, `AnomalyReport`, `PriceIndexPoint`, with the engines' own warnings
  carried into the doc comments.
- `frontend/src/lib/api.ts` — **added `api.put`** (see §3.1).
- `frontend/src/lib/api.test.ts` — `put` serialisation, and the schema-validation
  `detail`-list branch (see §3.2).
- `frontend/src/features/transactions/usePeriod.ts` — optional `defaultPreset` (see §3.3).
- `frontend/src/features/transactions/usePeriod.test.ts` — three hook tests.
- `frontend/src/app/routes.tsx`, `AppShell.tsx`, `AppShell.test.tsx` — route and nav entry.

---

## 2. The seven honesty requirements

### 1. An anomaly is not an accusation

A caption sits above the feed, at full text contrast with an accent rule so it is read before
the rows:

> Une anomalie n'est pas un reproche. C'est une opération qui s'écarte de l'historique de sa
> propre catégorie, rien de plus : une prime d'assurance annuelle au milieu de petites
> mensualités y figure, et dans une catégorie dont les montants ne bougent jamais, six centimes
> d'écart suffisent à faire apparaître une ligne.

Both named cases were **rendered and looked at**, not just described: the stubbed payload
carries an AXA annual premium (−478,00 € against a 12,90 € median) and a Netflix reprice of
exactly six cents (−13,06 € against 13,00 €), and both appear in
`task18-peuple-1440-clair.png`.

### 2. The order is a claim

The list is rendered in payload order; nothing on this screen sorts it. `modified_z` is
**not printed anywhere** — the stub deliberately gives the 6-cent Netflix row the smallest gap
while its z is ordinary, and gives the FNAC row the largest gap, so the shot proves the order
is cents and not the score. A note says so, shown only when there is more than one row:

> Classées par écart en euros, du plus grand au plus petit : c'est l'argent réellement déplacé.
> Le score statistique décide seulement qu'une opération figure dans cette liste, il ne la
> classe pas.

Pinned by a test that asserts both the row order and the absence of `"12.4"` / `"40.2"` from
the list's text.

### 3. `category_median_cents` is unsigned, `amount_cents` is signed

The row prints the ledger's own signed amount, and the sentence under it does the subtraction
so the reader never does:

> Dépense du 28 décembre 2025 · Équipement et high-tech — habituellement 68,41 € pour une
> dépense de cette catégorie, celle-ci s'en écarte de 168,14 € de plus.

Computed as `Math.abs(Math.abs(amount_cents) - category_median_cents)`, the same metric the
engine ranks on. The noun follows the sign, so an income anomaly reads "Recette … pour une
recette de cette catégorie" (visible on the salary row in the populated shots).

### 4. `skipped` / `scored_groups` are window-scoped, the statistics are not

> N groupes analysés sur la période du X au Y — chaque catégorie est examinée séparément pour
> ses dépenses et pour ses recettes. L'habitude de chaque groupe, elle, est mesurée sur tout
> votre historique et jamais sur la seule période affichée : restreindre la période ne rend pas
> une dépense ordinaire inhabituelle.

The wording also fixes a smaller thing the brief got wrong: these are **category+sign groups**,
not categories, so the disclosure labels each skipped row `(dépenses)` / `(recettes)` from
`SkippedCategory.direction`. The brief displayed that field nowhere and called them
"catégories".

### 5. An incomparable line's three cost fields

None of `current_cost_cents`, `previous_cost_cents` or `delta_cents` is rendered for an
incomparable line — the engine's docstring forbids all three as "a change, a price, or a
trend", so nothing appears rather than a figure with a caveat. A test asserts the rendered
line contains neither `120,00` (its real 12000-cent current cost) nor a `%`.

The same rule governs the basket: on a refusal the cell prints the engine's sentence, the two
windows, the category count and the reference line — **no percentage, no euro figure**, pinned
by a test on the whole cell's text.

### 6. The reference index is optional and never invented

Four states, four sentences, no zero in any of them:

| State | Sentence |
|---|---|
| `reference_ratio` present | `Indice de référence sur les mêmes périodes : +2,6 %. C'est l'évolution de la série que vous avez saisie vous-même, pas la vôtre.` |
| null, nothing stored | `Aucune comparaison extérieure : vous n'avez saisi aucun indice de référence, et aucun zéro ne prend sa place.` |
| null, a series is stored | `Un indice de référence est saisi, mais la série ne couvre pas les deux périodes comparées : aucune comparaison extérieure n'est possible.` |
| the index route itself failed | `L'indice de référence n'a pas pu être chargé : impossible de dire ce qui est enregistré.` |

The fourth is mine, not the brief's: with the route down, `indexPoints` is `[]` and the brief's
code would have claimed nothing was configured when it had no idea.

### 7. Both halves must read as deliberate answers on the real data

They do, and the shots show it: inflation refuses over 17 categories, none comparable;
anomalies come out mixed — 2 flagged, 8 groups scored, 11 skipped. Neither reads as an
error: the refusal uses the warning rule on a normal surface (never `--yd-negative`, which
stays reserved for a load failure), and the anomaly half prints real rows.

---

## 3. Where the brief disagreed with the shipped code

### 3.1 `api.put` does not exist — the brief's form could not have compiled

`PriceIndexForm` calls `api.put("/analysis/price-index", …)`. `frontend/src/lib/api.ts`
exports `get`, `post`, `patch`, `delete`, `upload` and **no `put`**. Added, with a test and a
comment on why PUT and PATCH are not interchangeable here (PUT replaces the whole series).

### 3.2 The two `detail` shapes are already handled — one layer below where the task looked

The task asked me to branch on the string-vs-list `detail`. `readError` in `lib/api.ts`
already does (`typeof body?.detail === "string"` … else `body.detail[0]?.msg`), so
`ApiError.detail` is always a string and `[object Object]` is unreachable. I pinned it with a
test in both `api.test.ts` and `PriceIndexForm.test.tsx` rather than adding a second branch.

**But there is a real leak the task did not name**: `body.detail[0].msg` from Pydantic is
**English** ("Input should be greater than 0"), and `PriceIndexPointIn` types
`value: Decimal = Field(gt=0, le=1_000_000)`. The brief's regex `(-?\d+(?:[.,]\d+)?)` happily
accepts `-5`, so a reader pasting a negative index would have been shown an English validation
message — a CLAUDE.md violation. `parseIndexSeries` now mirrors all three backend guards
(`gt=0`, `le=1_000_000`, and the router's post-rounding "still positive at the hundredth"
check for the `"0.004"` case task 15's review found), each in French and naming its line. The
backend still enforces all three; this is duplication for the message, not for the rule.

### 3.3 The brief's period wiring produces a wrong refusal on the operator's data

The brief passes `usePeriod()`'s bounds straight through. `usePeriod` defaults to `"month"`,
which today is 2026-08-01 → 2026-08-31, and the operator's ledger stops 2026-01-09. Both
routes would have answered about an empty August: inflation refusing with "pas assez de mois
de dépenses" (true of the window, not of the ledger), and anomalies returning
`scored_groups: 0, skipped: []` — which the brief's own copy renders as *"Aucune catégorie n'a
assez d'historique pour juger qu'un montant sort de l'ordinaire"*, a diagnosis of the wrong
illness.

Two fixes:
- `usePeriod` takes an optional `defaultPreset`; this screen passes `"all"`, whose empty
  bounds `api.get` drops, so each route resolves its own honest window
  (`_default_current_window`'s last twelve complete ledger months for inflation, the ledger's
  span for anomalies). The other two consumers call `usePeriod()` unchanged — verified in the
  browser, see §5.
- The empty-window case gets its own sentence: `Aucune opération sur cette période : il n'y a
  rien à examiner.` `scored_groups === 0 && skipped.length === 0` is what tells it apart from
  a genuine lack of history.

### 3.4 The running backend was stale and served no `/api/analysis/*` at all

`GET /api/analysis/inflation` on the running worker returned `{"detail":"Not Found"}`, and
`/api/openapi.json` listed 26 paths with none of the three analysis routes. The worker had
been started before task 17 landed and carried no `--reload`. Restarted detached from
`backend/`; the routes then appeared. **Had I trusted it, every browser check in this task
would have been done against a screen with three failed loads.**

### 3.5 Smaller divergences

- The brief's skeleton classes (`yd-skeleton--title/value/chart`) do not exist; each screen
  sizes its own. Added `--an-title/figure/list/form`.
- The brief's test `it("prints an em dash rather than a zero …")` asserts no em dash anywhere;
  its own assertion is for a sentence. I wrote the assertion the name implies instead (no
  reference figure in the cell at all).
- The brief's test expected `parseIndexSeries` to return the readable points *alongside*
  errors. Since PUT replaces the whole series, returning them would let a partial paste
  silently erase the months the parser could not read. Changed to all-or-nothing, with the
  test rewritten to say why.
- The brief's `plural(points.length, "mois enregistré", …)` etc. were fine and kept.
- Task context says HEAD is `7f147a2`; `git log` at session start showed `8ff72ad` as the tip.
  `7f147a2` was in fact the tip (`8ff72ad` is its parent) — the snapshot in my prompt was one
  commit behind. No action needed, noted for completeness.

---

## 4. Defects I found in the browser and fixed before reporting

These were all found by rendering and reading the shot, not by reasoning about the code.

1. **The basket cell stretched to a near-empty full column.** At 1440 on the real data it held
   five sentences and a card and a half of blank surface, which reads as a failed load — the
   defect CashflowPage fixed with `align-self: start`. First fixed on the basket; then found
   that **collapsing the 17-category disclosure moved the same blank half-card to the cell
   beside it**, so the rule now applies to every cell on the screen, skeletons included.
2. **Seventeen near-identical reason paragraphs.** The engine writes one sentence per
   incomparable line differing only in two digits; rendered as sent, the panel was a wall.
   The shared half is now stated once above the list and each row shows its own two counts
   (`2 mois récents · 1 un an plus tôt`). This is a factoring, not a paraphrase — but it is
   only faithful while the counts *are* the whole story, so `countsExplain()` falls back to
   printing the engine's own sentence for a line the counts do not explain (the engine's
   `previous_cost > 0` guard), and a test pins that fallback.
3. **At 375 the category names collapsed to one character per line.** The 40-character month
   counts shared the row with the name and left it a four-character track: "Internet et
   téléphone" wrapped to six one-syllable lines. The counts now take their own full-width row
   below 640px and return to the aligned column above it.
4. **The first list row ran into the paragraph above it**, because the separator lives on
   `.yd-analysis__line + .yd-analysis__line` and the first row has no predecessor. The rule
   now belongs to the list inside a disclosure.
5. **Two parse errors ran together as prose.** With `janvier;abc` and `2026-01;-5` pasted, the
   joined sentence buried both line numbers. Errors are now a list when there is more than one.
6. **There was no way to clear a stored index.** The brief's form refuses an empty textarea
   (correctly — PUT with `points: []` erases), which left the operator unable to remove a
   series. Added an explicit `Effacer l'indice` button, shown only when something is stored,
   and exercised it in the browser.

---

## 5. Browser verification

Chrome DevTools MCP, against `http://localhost:5173`, logged in as `demo@yieldo-demo.fr`.
Verified twice as required: against the operator's real data, and against a stubbed populated
payload injected over `window.fetch` so a real inflation table and a real anomaly list were
actually seen. Every shot below was read back with the Read tool and judged.

`document.documentElement.scrollWidth === clientWidth === 375` at 375 px on both the real and
the populated payload (only the decorative atmosphere blobs extend past, pre-existing and
clipped). Console: **no errors, no warnings**.

### Real data — inflation refuses, anomalies mixed

| Shot | What it shows |
|---|---|
| `task18-real-refusal-1440-sombre.png` | The refusal in the basket cell with no figure beside it, the 17 incomparable categories as a compact table with their own month counts, and the 2 real anomalies with their gap sentences. |
| `task18-real-refusal-1440-clair.png` | The same in the light theme; the refusal's warning rule and the caption's accent rule both read, muted text holds. |
| `task18-real-refusal-768-clair.png` | All four cells stacked full-width at md; nothing overflows. |
| `task18-real-refusal-768-sombre.png` | Same at md in dark. |
| `task18-real-refusal-375-clair.png` | 375 after the wrap fix: category name on its own line, counts below, the 22-character bank label wrapping cleanly. |
| `task18-real-refusal-375-sombre.png` | Same at 375 in dark. |

### Stubbed populated payload — a real table and a real feed

| Shot | What it shows |
|---|---|
| `task18-peuple-1440-clair.png` | `+9,3 %` headline, five comparable categories from `+21,0 %` down to `−7,5 %`, and four anomalies: a 76-character raw bank label wrapping to two lines, the AXA annual premium, an **income** anomaly phrased with "Recette", and the six-cent Netflix reprice last despite an ordinary score. |
| `task18-peuple-1440-sombre.png` | The same in dark. |
| `task18-peuple-details-ouverts-1440-sombre.png` | Both disclosures open: incomparable lines aligned on the same edge as the comparable ones, and skipped groups labelled `(dépenses)` / `(recettes)`. |
| `task18-peuple-768-sombre.png` / `-clair.png` | Populated at md, both themes. |
| `task18-peuple-375-clair.png` / `-sombre.png` | Populated at 375, both themes, disclosures open; the long label wraps to three lines without pushing the page. |

### The price-index form

| Shot | What it shows |
|---|---|
| `task18-index-rejet-1440-sombre.png` | A three-line paste with two bad lines refused: `Ligne 2 — « janvier;abc » : format attendu AAAA-MM;118,42` and `Ligne 3 — « 2026-01;-5 » : la valeur d'un indice est strictement positive`. Nothing was sent. |
| `task18-index-configure-1440-sombre.png` | After a valid four-point paste round-tripped: `4 mois enregistrés, de 2024-06 à 2026-01.`, the `Effacer l'indice` button now present, and the basket showing `Indice de référence sur les mêmes périodes : +2,6 %` — arithmetic checked by hand against the medians of the two windows. |
| `task18-index-configure-1440-clair.png` | The same in light. |

Textarea width measured in the browser: **419.3 px inside a 421.3 px content box** — not zero,
not wider than the cell (trap 3 cleared).

### Other checks

| Shot | What it shows |
|---|---|
| `task18-details-focus-1440-sombre.png` | The disclosure summary focused from the keyboard, with a visible 2 px accent ring; Enter toggled it closed (`matches(':focus-visible') === true`, `outline: rgb(126, 226, 214) solid 2px`). |
| `task18-motion-off-1440-sombre.png` | `data-motion="off"`: all four cells at `opacity: 1`, `transform: none`, no inline opacity — nothing stranded. |
| `task18-regression-transactions-1440-sombre.png` | `/transactions` unchanged: the shared `PeriodSelector` still opens on "Mois". |
| `task18-regression-dashboard-1440-sombre.png` | `/` unchanged, same. |

Cell heights measured after the `align-self` fix: `[426, 1067, 548, 420]` — every cell sized to
its own content, none stretched.

The demo fixture was left as found: the index I pasted was removed again through the
`Effacer l'indice` button (which also exercised that path), and both the form and the basket
returned to their "nothing configured" wording.

---

## 6. Self-review findings

- **`formatRatio(line.ratio as number)`** — removed the cast. `comparableLines` is filtered
  through a type predicate (`line.comparable && line.ratio !== null`), so the narrowing is
  real. The two lists are now exhaustive by construction: a line arriving flagged comparable
  with a null ratio falls to the incomparable side rather than reaching `formatRatio(null)`.
- **`toHundredths` rounds on the third decimal only**, while the backend's `ROUND_HALF_UP`
  sees the whole remainder. Checked the boundary cases (`0.004`, `0.0049`, `0.0050`,
  `0.00449999`) — all agree. Where they could ever disagree, the failure mode is the
  backend's own French guard firing instead, which is the correct fallback for a client-side
  pre-check.
- **String arithmetic in `toHundredths`**, not `Number(text) * 100`: the value is compared
  against a zero boundary a float can land on the wrong side of, the same reason `parseCents`
  refuses the shortcut.
- **Error keys** on the page-level alerts are the field name, never the message — a database
  outage takes all three routes down with the same `detail`, which as a key would collide and
  as a repeated sentence would say nothing about which panel is missing.
- **`role="alert"` on a `<div>` wrapping a `<ul>`** is valid; `aria-invalid` and
  `aria-describedby` are wired to the textarea.
- Traps: no `transform` anywhere in the new CSS (the only movement is `align-self`/grid);
  no `transition` prop on a variant-carrying element (timings live in `variants.ts`);
  percentage widths sit in `minmax(0, 1fr)` grid tracks, verified by measurement.

---

## 7. Concerns

1. **`usePeriod` is shared, and I changed it.** The change is additive (`defaultPreset =
   "month"`), both other consumers were re-checked in the browser, and three hook tests pin
   the behaviour — but phase 1.5 had a round where this exact module was changed without
   re-checking its consumers, so it is worth a reviewer's eye.
2. **"Tout" means two different windows.** With no period in the URL, inflation answers over
   the last twelve complete ledger months and anomalies over the whole ledger. That is each
   engine's own honest answer and neither can stretch to the other's, so the divergence is
   stated in the banner and each panel names the window it used. It is still a thing a reader
   could be surprised by.
3. **The seventeen reasons are factored, not quoted.** The shared clause is stated once and
   each line shows its own two counts. `countsExplain()` and `MIN_MONTHS_PER_WINDOW = 3`
   guard the case where the counts do not explain the exclusion, but the constant is a copy of
   the backend's — the same accepted arrangement as `RecurrenceRow`'s
   `ANNUALISATION_FLOOR_DAYS`, where a backend change leaves the sentence naming the wrong
   number rather than the screen applying the old rule.
4. **`eslint` is not installed in this repo** — `npm run lint` fails with "'eslint' n'est pas
   reconnu". Pre-existing, not introduced here, but it means no linter ran over this code.
5. **The ratio counts up from zero.** `CountUp` animates `0 → 0.0926`, so the headline reads
   `+0,0 %` for a frame. The digits are `aria-hidden` and the accessible name is the true
   value, and this is the app's established treatment for every headline figure — but on a
   *percentage* the transient zero is a claim in a way it is not on a balance. Flagging it
   rather than deviating from the house pattern unilaterally.
6. **`Non catégorisé` appears in the inflation lines but never in the anomalies.** That is the
   two engines' correct and different behaviour (`detect_anomalies` skips `category_id is
   None`; `compute_inflation` does not), and the screen does not currently explain the
   asymmetry to a reader comparing the two panels.

---

# Task 18 — fix round 1 — report

**Parent:** `d684df0`
**Branch:** `phase-2-analyse-decision`
**Scope:** the four review findings on the Analyse screen. Frontend only — no
backend file was touched, and no API payload changed.

**Suites:** backend 522 passed (unchanged), frontend 590 passed (was 585, +5),
`npm run build` exit 0 with zero TypeScript errors.

---

## Finding 1 (Important) — an empty-window diagnosis firing on a ledger that is not empty

`nothingFoundSentence`, `AnalysisPage.tsx`. `scored_groups === 0 &&
skipped.length === 0` was read as "the window is empty". It is not:
`detect_anomalies` drops every `category_id is None` row before grouping
(`engines/anomaly.py:172-175`) and `anomaly_points` filters transfers out of the
query (`api/common.py:117-122`), so a window holding only uncategorised
operations — every ledger between an import and the categorisation that follows
it — or only internal transfers arrives with exactly the same two values.

The API was **not** widened, as instructed. The sentence now claims only what
all three cases share:

> Aucune opération catégorisée sur cette période, virements internes exclus : il
> n'y a rien à examiner. Une opération sans catégorie n'est jamais analysée ici —
> c'est sa catégorie qui lui donne un historique auquel se comparer. Élargissez la
> période, ou catégorisez les opérations qu'elle contient.

"importez des relevés qui la couvrent" is gone, and the remedy named is the one
that actually applies to the common case.

**Covering tests** (`AnalysisPage.test.tsx`):

- `tells an empty window apart from a ledger with no usable history` — rewritten:
  asserts the sentence names `virements internes` and asserts
  `not.toMatch(/importez des relevés/)`, which is the assertion that fails on the
  old copy.
- `names categorisation, not importing, as what an unscored window may be missing`
  — new.

## Finding 2 (Important) — a deliberate engine refusal dressed as a failure

A >12-month range makes `compute_inflation` raise in French and the router
return 422. That is an answer, not a failure. Four changes:

- New `refusalReason(err)` — `err instanceof ApiError && err.status === 422 ?
  err.detail : null`. Keyed on the **status**, not the wording, so rephrasing the
  engine's guard cannot silently reroute it.
- A refusal no longer populates `nextErrors.inflation`, so it never reaches
  `errorEntries` and no `role="alert"` is rendered. It lands in new
  `inflationRefusal` state instead.
- The basket cell renders it in `.yd-analysis__insufficient` — the warning rule
  the CSS comment at `AnalysisPage.css:102-105` reserves for exactly this — plus
  one note saying no figure is shown and what to do (`Changez la période
  ci-dessus`), deliberately **not** naming twelve months, since a hand-edited
  malformed `du`/`au` is the one other 422 this route can return.
- The lines cell no longer prints "Ce panneau n'a pas pu être chargé." either.
  It says `Aucune catégorie n'est comparée : le moteur a refusé cette période,
  pour la raison donnée dans « Votre panier ».` — the refusal is stated once, and
  pointed at by name rather than by position, since the two cells sit side by
  side at lg and stacked at md.

**Covering tests:**

- `reports a range the engine refuses as the explanation it is` — the assertion
  now pins what the name claims: the sentence is inside `yd-analysis-basket`,
  carries the class `yd-analysis__insufficient`, `queryByRole("alert")` is
  **absent**, and `n'a pas pu être chargé` appears nowhere on the page.
- `still treats a genuine inflation failure as a failure` — new regression guard:
  a 500 still produces the alert, still names `Inflation personnelle indisponible`,
  and still shows the load-failure copy in the two cells.

Measured in the browser on the real 422: `border-left-color` is
`rgb(244, 162, 97)` (`--yd-warning`, `#f4a261`) in dark and `rgb(138, 77, 8)` in
light; zero elements with `role="alert"`; `document.body.textContent` contains no
"n'a pas pu être chargé".

## Finding 3 (Important) — the scope banner denied the divergence in the one case it occurs

`period.preset === "all"` → `period.from === "" && period.to === ""`. Clicking
"Personnalisé" writes `periode=custom&du=&au=`, `buildUrl` drops both empty
params, and the two engines fall back to their two different defaults while
`preset` reads `"custom"`. The bounds are what the routes actually receive, so
they are what the banner is now keyed on. This also stays correct for a
half-filled custom range (`du` set, `au` empty): one bound present sends inflation
through `period_range` exactly as anomalies, so the two panels really do agree
there and the "both panels" sentence is right.

**Covering tests:**

- `keeps the two-windows warning on a custom period with no bounds yet` — new.
- `says both panels agree once a custom period actually has bounds` — new, pins
  the other side so the guard cannot be widened to always-divergent.

Confirmed in the browser: clicking the "Personnalisé" tab lands on
`?periode=custom&du=&au=` and `.yd-analysis__scope` reads "Aucune période
imposée…", while the two panels below name 1 fév 2025 – 31 jan 2026 and the whole
ledger respectively — the divergence the banner now discloses.

## Finding 4 (Minor, folded in) — a factual overstatement in the anomaly caption

`six centimes d'écart suffisent` → `quelques centimes peuvent suffire`. With
MAD 0 the score uses the mean absolute deviation **rounded to integer cents**
(`engines/robust.py:72-75`, `:100-101`, `:117-118`): six cents in a twelve-row
group gives `mean_ad = 1` and z ≈ 4.79, but the same six cents in a thirty-row
group gives `(6*2 + 30) // 60 = 0`, `modified_z` returns `None`, and no line
appears. The size that surfaces a line depends on the group's length, so no
particular number of cents can be promised. The code comment above the paragraph
now carries that arithmetic.

**Covering test:** `does not promise that six cents always surfaces a line` —
asserts the caption contains `quelques centimes peuvent suffire` and
`not.toMatch(/six centimes/)`.

---

## Commands and output

```
$ cd frontend && npx vitest run src/features/analysis/AnalysisPage.test.tsx   # before the fix
  Tests  5 failed | 26 passed (31)
$ cd frontend && npx vitest run src/features/analysis/AnalysisPage.test.tsx   # after
  Tests  31 passed (31)
$ cd frontend && npm test
  Test Files  47 passed (47)
       Tests  590 passed (590)
$ cd frontend && npm run build
  built in 7.63s        (exit 0, zero TypeScript errors)
$ cd backend && ./.venv/Scripts/pytest.exe -q
  522 passed, 305 warnings in 54.08s
```

`design/contrast.test.ts` is inside the 590 and stayed green; no colour was
hard-coded — the refusal reuses `.yd-analysis__insufficient`, which was already
on `--yd-warning`. No CSS file was changed at all in this round, so no motion,
easing or duration was touched either.

`npm run lint` still fails with "'eslint' n'est pas reconnu" (pre-existing, §7.4
above); left alone as instructed.

## Backend liveness check

Before trusting any browser output: `Get-NetTCPConnection -LocalPort 8000` showed
a listener on 127.0.0.1:8000, and `/api/openapi.json` listed
`/api/analysis/inflation`, `/api/analysis/anomalies` and
`/api/analysis/price-index`. The worker was current; no restart was needed.

## Re-shot screenshots

All read back with the Read tool and judged. Chrome DevTools MCP against
`http://localhost:5173`, logged in as `demo@yieldo-demo.fr`, at 1440 in both
themes.

| Shot | What it shows |
|---|---|
| `task18-fix-caption-1440-sombre.png` | The whole screen on the real ledger, dark. The anomaly caption now ends "quelques centimes peuvent suffire à faire apparaître une ligne", at full text contrast behind its accent rule. Everything else unchanged: the basket's refusal still in the warning block, the 17 incomparable categories aligned on one edge, the two FNAC anomalies with their gap sentences. |
| `task18-fix-caption-1440-clair.png` | The same in light. The accent rule and the muted prose both hold. |
| `task18-fix-perso-sans-bornes-1440-clair.png` | Finding 3. "Personnalisé" selected, both date inputs empty, and the banner reading "Aucune période imposée…" — the divergence disclosed where the old build asserted agreement. The panels below prove it: inflation on 1er février 2025 – 31 janvier 2026, anomalies on the whole ledger. |
| `task18-fix-perso-sans-bornes-1440-sombre.png` | The same in dark. |
| `task18-fix-refus-plus-de-12-mois-1440-sombre.png` | Finding 2, the state that was mis-styled. `du=2024-01-01&au=2026-01-09`. No red band above the grid at all. The engine's sentence sits in the basket cell behind the orange warning rule, with "Aucun chiffre n'est affiché : le moteur a refusé cette période…" under it, and the cell beside it says "Aucune catégorie n'est comparée… pour la raison donnée dans « Votre panier »" instead of claiming a failed load. The anomaly panel still answers normally on the same range (8 groupes analysés du 1er janvier 2024 au 9 janvier 2026) — only inflation refused, and only inflation says so. |
| `task18-fix-refus-plus-de-12-mois-1440-clair.png` | The same in light; the warning rule darkens to `rgb(138, 77, 8)` and the body text stays at full contrast. |
| `task18-fix-refus-plus-de-12-mois-375-sombre.png` | The refusal at 375. `document.documentElement.scrollWidth === clientWidth === 375`; the refusal block wraps to five lines inside its cell and nothing pushes the page sideways. |
| `task18-fix-fenetre-sans-operation-1440-clair.png` | Finding 1, on a window the ledger does not cover (`2026-08-01 → 2026-08-31`). The anomaly cell now reads "Aucune opération catégorisée sur cette période, virements internes exclus…" and names categorisation rather than importing. |
| `task18-fix-fenetre-sans-operation-1440-sombre.png` | The same in dark. |

Console after a clean reload of the refusal state: no JavaScript error. Chrome
logs the 422 itself as a network-level "Failed to load resource" line — that is
the browser reporting a non-2xx, unavoidable for any deliberate 422 and not an
application error — plus the pre-existing "A form field element should have an id
or name attribute" issue on `PeriodSelector`'s date inputs, which predates this
task and is shared with `/transactions` and `/`.

---

## Concerns and carry-forward

1. **`inflation.lines.length === 0` has the same shape of overstatement as
   finding 1, one cell over.** The lines cell says *"Aucune dépense sur les deux
   périodes comparées. Élargissez la période ou importez des relevés
   supplémentaires."* `api/analysis.py:165-170` filters transfers out before
   building `CategorySpend`, so a window holding nothing but internal transfers
   reaches that branch too and the sentence is false there. It is narrower than
   finding 1 — `compute_inflation` does *not* drop uncategorised rows, it groups
   them as "Non catégorisé", so the common post-import state does not reach it —
   and it was not among the four findings this round was scoped to, so I left
   verified prose alone rather than widen the diff. Visible in
   `task18-fix-fenetre-sans-operation-1440-clair.png`. Worth a ledger line.
2. **The refusal treatment is keyed on status 422, which is not exclusively the
   engine's.** FastAPI returns 422 with an English Pydantic `msg` for an
   unparseable `date_from`/`date_to`. That is reachable only by hand-editing the
   URL — the `type="date"` inputs emit ISO or nothing — and the English leak
   exists on the old alert path too, so this is not a regression. It is why the
   note beside the refusal says "Changez la période ci-dessus" and never names
   twelve months.
3. **The four deferred Minor findings were not touched**, as instructed: the
   "Coût mensuel médian" label over a sum of medians, `countsExplain`'s fallback
   not rescuing the case its comment claims, the missing busy state on a period
   change, and `Effacer l'indice` erasing on one unconfirmed click.
4. **375 was measured through CDP viewport emulation**, not `resize_page`:
   Chrome on Windows would not take the window below 485 px. `scrollWidth ===
   clientWidth === 375` under emulation.
