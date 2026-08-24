# Task 14 — Trésorerie screen — report

**Branch:** `phase-2-analyse-decision`
**Commits:** `e87f5f3` (feature), `f160e08` (self-review fixes)
**Suites:** backend 452 passed · frontend 525 passed (491 baseline + 34 new) · `npm run build` zero TypeScript errors

---

## What I implemented

A `/tresorerie` screen in front of `GET /api/cashflow/forecast` and
`GET /api/cashflow/runway`, plus a nav entry "Trésorerie" between Récurrences
and Catégories.

**`frontend/src/features/cashflow/RunwayPanel.tsx`** — one runway scenario.
Exports `formatMonths(months: number): string` and `<RunwayPanel scenario
label unavailableReason />`. The panel renders the float duration, the burn
median, the measured band, and the rate's own sample size — or, when the
scenario is null, that scenario's own unavailability reason.

**`frontend/src/features/cashflow/CashflowPage.tsx`** — three bento cells
(balance 4 / runway 8 / forecast 12 at lg), `Promise.allSettled` over the two
routes so one failing does not blank the other, and a page-level note naming
both anchor dates when they diverge.

**`frontend/src/features/cashflow/CashflowPage.css`** — panel and scenario
styling, skeleton sizes, prose measure caps.

Modified: `app/routes.tsx`, `app/AppShell.tsx`, `app/AppShell.test.tsx`.

---

## Where the brief disagreed with the shipped code

**The brief is substantially stale.** It was written against an earlier
version of `cashflow.py` and every one of the following is wrong in it. I
followed the code.

| Brief says | Shipped code |
|---|---|
| `RunwayScenario` has no `rate` | `RunwayScenarioOut.rate: MeasuredRateOut` — the band and the per-scenario sample size the whole task turns on |
| `Runway.insufficient_reason` (one field) | `normal_unavailable_reason` **and** `essentials_unavailable_reason`, split by a prior review |
| `Runway.months_observed` only | also `ledger_span_months`, `projected_from`, `ledger_last_on` |
| `Forecast` has 8 fields | also `ledger_months_observed`, `recurrences_projected`, `pooled_scale_cents`, `seasonal_scale_cents`, `projected_from`, `ledger_last_on` |
| `<RunwayPanel scenario label />` | needs a third prop, `unavailableReason`, or requirement 5 is unsatisfiable |
| Page renders `runway.insufficient_reason` as one block for both scenarios | that field does not exist; doing so would be exactly the conflation the review fixed |
| Link "Modifier cette liste" → `/budgets` | **nothing in the app edits `is_essential`.** `/categories` is still a placeholder and `BudgetBar.tsx` only *displays* the flag. I replaced the copy with an honest statement that the list is not yet editable, pointing at Budgets as the place the flags are visible. A link promising an editor that does not exist is the same class of small lie this screen exists to avoid. |
| Test fixture `months: 0.78` asserted to render "0,8 mois" | `formatMonths(0.78)` is "moins d'un mois" — the brief's own fixture contradicts its own implementation |

`frontend/src/lib/types.ts` was **already correct and complete** — task 13
shipped accurate mirror types. No type changes were needed.

### The operator's real data is a state the brief did not anticipate

The live payload has `balance_cents: -220963` — **negative**. Consequently
both scenarios come back with `months: 0.0` and `depleted_on` equal to
*today* (`runway.py`'s `balance_cents <= 0` branch), and both scenarios'
`rate.low_cents` is **negative** (−18 360 and −19 880). The brief's
`formatMonths` would have printed "moins d'un mois" for a balance that is
already gone, and had no notion of a band whose low end is below zero. Both
are handled explicitly (see requirements 2 and 4 below).

---

## The six honesty requirements

**1 — Two panels, two clocks.** Each panel names its own anchor date from its
own `projected_from`. The runway cell: *"Autonomie comptée à partir du
23 août 2026, la date du jour, sur un rythme mesuré jusqu'au 9 janvier 2026,
dernière date de votre historique."* The forecast cell: *"La projection
partirait du 9 janvier 2026, dernière date de votre historique, et non de la
date du jour."* When the two `projected_from` values differ, a page-level
banner above the grid states the divergence outright. When they are equal
(fresh ledger) the banner is absent — pinned by a test in both directions.
On a populated forecast the sentence also names the first projected month
("les mois projetés commencent en septembre 2026"), which is the concrete
form of the claim.

**2 — Two different `months`.** `RunwayScenarioOut.months` (float duration)
renders in the panel's figure slot through `formatMonths`.
`MeasuredRateOut.months` (integer sample size) renders only via
`sampleSentence` as *"Rythme mesuré sur 3 mois de relevés"* — worded "de
relevés" precisely because the number above it is also a count of months and
the two routinely differ. A test asserts both numbers appear with their own
wording when they disagree (duration 6,3 / sample 4).
`formatMonths(0)` returns **"Déjà épuisé"**, not "moins d'un mois": on the
operator's negative balance there is nothing left to spend, and the panel
suppresses the `depleted_on` date on that branch because the engine sets it
to *today*, which would read as a forecast about a date that has arrived.

**3 — Two different populations.** The runway cell states *"Votre historique
s'étend sur 13 mois civils, dont 3 mois complets exploitables pour mesurer un
rythme"* — `ledger_span_months` beside `months_observed`, so the nine-month
import hole is visible. At the `MIN_MONTHS_FOR_RATE` floor it adds *"C'est le
minimum en dessous duquel rien n'est mesuré : le rythme reste fragile."* The
forecast cell carries its own pair: `ledger_months_observed` beside
`months_observed` (*"9 mois complets, dont 7 portent une activité non
récurrente"*).

**4 — Each scenario's own band.** Every computed panel prints *"Entre
−183,60 € et 5 492,58 € d'un mois à l'autre"* from that scenario's own
`rate.low_cents`/`high_cents`, plus its own `rate.months`. Because the
operator's P10 is negative, the panel adds a warning-ruled caveat: *"La
fourchette basse descend sous zéro : les écarts entre mois dépassent la
médiane elle-même, cette autonomie est donc un ordre de grandeur, pas une
échéance."* That caveat is suppressed when the low end is a genuine expense —
both branches are tested.

**5 — Independent reasons.** `normal_unavailable_reason` and
`essentials_unavailable_reason` are passed to their own `<RunwayPanel>` and
never cross. Two tests pin it: `essentials` null while `normal` computes, and
`normal` null while `essentials` computes; each asserts the reason appears
exactly once and that the surviving scenario still shows its duration.
`task14-scenario-indispo-1440-sombre.png` shows this on screen — "3,2 mois"
beside "Non mesurable" carrying the *non-deficit* reason, not a month-count
complaint. A null reason on a null scenario (a contract violation) renders
*"le serveur n'a pas indiqué pourquoi"* rather than an empty panel — no
silent failure.

**6 — The mixed state reads as two deliberate answers.** On the operator's
data the forecast prints the backend's own refusal sentence in a
warning-ruled informative block — never the negative colour, never beside an
empty chart with axes — while the runway beside it computes and is flagged as
resting on three months. A test asserts the refusal appears *and* that no
chart is rendered *and* that the runway still answers.

---

## Screenshots

All read back with the Read tool and judged. `.superpowers/…/shots/`.

### Operator's real data — forecast refuses, runway computes

| File | What it shows |
|---|---|
| `task14-reel-1440-clair.png` | Full screen at lg: clocks banner naming both dates, balance −2 209,63 € sized to its content, two "Déjà épuisé" panels each with band + caveat + sample, and the forecast refusal as an explanation. |
| `task14-reel-1440-sombre.png` | Same at lg dark; the translucent scenario surface is visible against the opaque cell and the amber caveat rules read clearly. |
| `task14-reel-768-clair.png` | md: cells stack full-width, the two scenario panels stay side by side (640px rule), nothing clips. |
| `task14-reel-768-sombre.png` | Same in dark. |
| `task14-reel-375-clair.png` | Mobile: scenario panels stack, "Déjà épuisé" fits on one line, no horizontal overflow. |
| `task14-reel-375-sombre.png` | Same in dark. |

### Stubbed populated payload — band and both scenarios visible

| File | What it shows |
|---|---|
| `task14-peuple-1440-clair.png` | Twelve-month fan: band correctly centred on the dashed median, breach pin at mars 2027, solid "Seuil 0 €" line, both scenarios at 3,2 / 6,7 mois with real bands. |
| `task14-peuple-1440-sombre.png` | Same in dark — the band is clearly distinguishable from the card at 18 % opacity. |
| `task14-peuple-768-clair.png` / `-sombre.png` | md: x-axis labels thinned to every other month, no smear. |
| `task14-peuple-375-clair.png` / `-sombre.png` | Mobile: labels thinned to every third (sept./déc./mars/juin), "Seuil 0 €" does not overprint the last data point. |
| `task14-scenario-indispo-1440-sombre.png` | Requirement 5 on screen: `normal` computed beside `essentials` "Non mesurable" with its own non-deficit reason, dashed border, panels top-aligned. Also captured with `data-motion="off"`. |

### Band-anchoring check (task 13's defect)

Verified arithmetically against the stub rather than by eye. Last month:
median −4 040 €, offset 1 455 € → band −5 495 € to −2 585 €. The rendered
band spans exactly that around the median. It is **not** anchored at zero and
**not** double-height, so `stackStrategy: "all"` is holding.

### Measurements taken in the browser

- **Composited contrast**, `--yd-text-muted` inside `.yd-runway` (translucent
  `--yd-surface` over the opaque `--yd-surface-strong` cell — the cell being
  opaque is what terminates the composite, so the halo never reaches it):
  **6.25:1 dark**, **6.95:1 light**. Both clear AA. Note `contrast.test.ts`
  only pins tokens against `--yd-bg` and does not composite, so this check is
  genuinely separate from the suite.
- **Reduced motion** (`data-motion="off"`): all three cells at `opacity: 1`
  and `transform: none` — nothing stuck invisible, chart drawn without
  animation.
- **Console**: no errors, no warnings.

---

## Self-review findings (all fixed, commit `f160e08`)

1. **Duplicate React key and an unattributed error.** Errors were keyed by
   their message. A database outage takes both routes down with the same
   `detail`, giving a duplicate key *and* the same sentence printed twice with
   nothing to say which panel was missing. Now keyed by field and prefixed
   "Autonomie indisponible :" / "Prévision indisponible :". Pinned by a new
   test.
2. **Layout jump between loading and loaded.** The skeleton's balance cell
   lacked `yd-cashflow__balance-cell`, so it stretched to the row at lg while
   the loaded cell sizes to content — the card visibly shrank when data
   landed, the exact jump the shared `SPAN` map exists to prevent.
3. **No heading for the scenarios.** Labels were spans; a reader navigating by
   heading could not reach "Dépenses réduites à l'essentiel". Now `h3` under
   the cell's `h2`, with typography explicitly reset so nothing moved.
   Verified in the a11y tree: h1 → h2 → h3.

Also fixed during browser verification, before the first commit:

4. **`ci-contre` was wrong at two of three widths.** The balance cell said the
   scenarios were "ci-contre" (beside), but they are stacked *below* at 375
   and 768. Reworded position-neutrally — the same trap `BudgetsPage` names as
   "named, not placed".
5. **~230 px of dead white card** under the balance cell at lg. `align-self:
   start`.
6. **~175-character prose lines** at 1440 in the full-width forecast cell.
   Capped to a readable measure.
7. Two `plural()` calls passed identical singular/plural forms (dead code),
   and one participle did not agree with its count ("dont 7 portant" →
   "dont 7 portent").

---

## Concerns

1. **Defect in `ForecastFanChart` (task 13), not fixed.** At 1440, where all
   twelve x-axis labels render, **the last label is clipped** — it reads
   "août 20". Measured, not eyeballed: sampling the canvas' bottom-right
   40 px band shows ink at the *final* pixel column (`inkAtFinalColumn: 8`).
   Cause: `ForecastFanChart.tsx:82` sets `grid: { left: 8, right: 8, … }`
   together with `xAxis.boundaryGap: false`, which places the last category on
   the grid's right edge; `containLabel` does not reserve the label's
   overhanging half. The other two charts use `right: 8` safely because they
   keep `boundaryGap: true`. Fix is one value — `right: 36` or similar — and
   no test pins `grid`. **I did not make it**, because the task explicitly
   said to drop the chart in and "do not reach into it", and the component was
   reviewed and committed under task 13. It is invisible at 375 and 768, where
   the last label is thinned away. Flagging for the coordinator to decide.

2. **Two commits, not one.** `CLAUDE.md` says one commit per task. I committed
   the feature, then found three defects in self-review. `git commit --amend`
   is blocked by this repo's Fact-Forcing Gate hook — I presented the facts it
   asked for (unpushed local commit, rollback `git reset --hard e87f5f3`,
   the verbatim instruction) and retried, and it blocked again. I chose not to
   try to work around a safety control, so the fixes landed as `f160e08`.
   Squash on merge if the convention matters here.

3. **`formatMonths` returns a capitalised state string** ("Déjà épuisé") on
   the `months <= 0` branch while its other branches return lowercase
   fragments ("moins d'un mois", "6,3 mois"). It is documented, tested, and it
   is the honest rendering — but a formatter mixing a state into a duration is
   arguably the wrong seam. Left as is because splitting it would put the
   zero-balance decision in two places.

4. **The essentials list is not editable anywhere in the app.** The screen now
   says so rather than linking to a non-existent editor, but this is a real
   product gap: the reduced scenario rests on 21 flags the operator cannot
   change. Worth a task.

5. **The stubbed populated verification is a stub.** The brief suggested
   importing a ten-month CSV and rolling it back. I patched `window.fetch`
   through a navigation init script instead — it exercises the real component
   tree, the real chart, and the real theme, and it leaves the operator's
   fixture untouched at 197 transactions (no import, no rollback, no risk of
   leaving the ledger dirty). It does *not* exercise the backend's own
   forecast path on ten months of data; that remains unverified end to end.

---

# Task 14 — fix round on the review findings

**Commit:** `845080a` on `phase-2-analyse-decision`, on top of `f160e08`.
**Suites:** backend 454 passed (452 + 2 new) · frontend 532 passed (525 + 7 new)
· `npm run build` (`tsc -b && vite build`) zero TypeScript errors.

Two Important findings and one folded-in backend defect. Both Important
findings are the same failure: a sentence in the indicative asserting a
measurement the engine below it had refused to make.

---

## Finding 1 — four sentences asserted a measured rate when neither scenario could be measured

The runway cell was gated on `runway === null` alone. That is the question
"did the payload arrive", not "was anything measured". When both scenarios come
back null — any user's second month, and equally any ledger where both medians
fail `rate.median_cents > 0` — four sentences went on describing a rate, beside
two "Non mesurable" panels.

**The gate.** `CashflowPage.tsx` now computes

```ts
const runwayMeasured =
  runway !== null && (runway.normal !== null || runway.essentials !== null);
```

and every sentence that speaks of a *rythme mesuré* is gated on it. Three
sentence builders were lifted out of the JSX so each state is one readable
string rather than a chain of ternaries inside a `<p>`: `runwayScopeSentence`,
`runwayAnchorSentence`, `clocksSentence` (finding 2), plus a shared
`staleLedgerDate` helper.

| Was | Is, when nothing was measured |
|---|---|
| "Si tout revenu s'arrêtait, **au rythme de dépenses mesuré** dans vos relevés." | "Si tout revenu s'arrêtait. Aucun des deux rythmes de dépenses n'a pu être mesuré dans vos relevés." |
| "dont 2 mois complets **exploitables pour mesurer un rythme**." | "dont 2 mois complets. … Aucun rythme n'a pu en être tiré : chaque scénario dit pourquoi." |
| "**C'est le minimum** en dessous duquel rien n'est mesuré : le rythme reste fragile." (fired at 0, 1 and 2) | at `< 3`: "Il en faut au moins 3 pour mesurer un rythme." — a statement about the threshold, true whatever the scenarios did with it |
| "Autonomie comptée à partir du 23 août 2026 … sur **un rythme mesuré** jusqu'au 9 janvier 2026" | "Aucune autonomie n'est comptée : elle le serait à partir du 23 août 2026, la date du jour, sur des relevés qui s'arrêtent au 9 janvier 2026." |

**The `MIN_MONTHS_FOR_RATE` guard** is now `=== MIN_MONTHS_FOR_RATE`, never
`<=`, with a distinct branch below it. At exactly three months the sentence
also splits on `runwayMeasured`: with a rate it keeps "… : le rythme reste
fragile"; without one it stops at "C'est le minimum en dessous duquel rien
n'est mesuré." — the count is still worth stating, the fragile rate does not
exist. That second branch is the `median_cents <= 0` road into the same state,
which the month count alone cannot distinguish.

**Covering tests** (`CashflowPage.test.tsx`), the first three red before the
change:

- `claims no measured rate when neither scenario could be measured` — the gap
  the review named: no fixture in the suite had ever nulled both scenarios at
  once. New fixture `unmeasurableRunway` (2 observed months, 13 calendar, both
  reasons set). Asserts two "Non mesurable" panels, no "au rythme de dépenses
  mesuré", no "exploitable" in the scope note, no "Autonomie comptée à partir
  du", and the conditional sentence present.
- `does not call two months the minimum, nor call a missing rate fragile`.
- `states the minimum without promising a rate when three months yielded none`
  — second fixture `noBurnRunway`, the non-deficit road at three months.
- `still calls a rate resting on exactly three months fragile` — the regression
  pin in the other direction, tight where the pre-existing `/minimum/i` test is
  loose. Green before and after; it exists so the `<=` → `===` change cannot
  quietly delete the clause.

---

## Finding 2 — the clocks banner asserted a projection while the forecast was refusing

`clocksDiverge` compared the two `projected_from` values and never read
`insufficient_reason`, so the first prose on the page announced "La prévision
**part du** 9 janvier 2026 … c'est la seule période sur laquelle vos relevés
peuvent se prononcer" while the cell below printed a refusal and drew nothing.
The forecast cell's own refusal branch already wrote "partirait"; the banner now
takes the same mood, clause by clause, in `clocksSentence`:

- forecast refusing: "La prévision **partirait** du 9 janvier 2026, dernière
  date de votre historique, mais elle n'est pas établie : la raison est donnée
  avec la projection." The "seule période" clause — which claims a period the
  statements pronounced on — is dropped entirely.
- runway with no measured rate: "L'autonomie **serait comptée** depuis le
  23 août 2026, la date du jour, mais aucun rythme n'a pu être mesuré." Not in
  the finding, but it is the identical defect in the identical sentence and is
  reachable in the same second-month state.
- both refusing: the opener follows too — "Ces deux panneaux **partiraient** du
  même solde".

Both dates are still named in every branch: the divergence is real whether or
not either side computed, and that is what the banner is for.

**Covering tests**, three, the first and third red before the change:

- `puts the projection in the conditional when the forecast refuses` — the
  operator's own configuration, the one `CashflowPage.test.tsx:224-232` had
  pinned in the indicative. Asserts "La prévision partirait du 9 janvier 2026",
  absence of "La prévision part du", absence of "seule période".
- `keeps the projection in the indicative when the forecast is actually drawn`
  — the opposite direction, so the conditional cannot creep onto a real
  projection.
- `does not say an autonomy is counted when neither scenario was measured`.

---

## Finding 3 (folded in) — `_reason_short_ledger` quoted the residual count

`backend/app/engines/forecast.py`. The branch is chosen on
`ledger_months < MIN_MONTHS_FOR_FORECAST`, so `ledger_months` is the number
"l'historique n'en compte que N" has to quote. It quoted `observed`, the
residual count, so a five-month ledger with three residual months refused with
"n'en compte que 3" directly above the screen's own note reading "Votre
historique compte 5 mois complets".

`_reason_short_ledger(observed, ledger_months)` now cites the ledger count and
adds the residual count as its own clause when the two differ — that clause is
why importing one more month may land on `_reason_thin_residual` rather than on
a projection:

> Pas assez de données pour projeter : il faut au moins 6 mois complets de
> relevés, et l'historique n'en compte que 5, dont 3 portent des opérations non
> récurrentes. Importez des relevés supplémentaires pour obtenir une prévision.

Zero and one are written out ("n'en compte aucun", "n'en compte qu'un seul"):
an empty ledger is the first thing a new account has, and "n'en compte que 0"
is not a sentence.

**Covering tests** (`backend/tests/test_forecast.py`), both red before:
`test_the_short_ledger_refusal_counts_the_ledger_and_not_the_residual` and
`test_the_short_ledger_refusal_counts_in_french_at_zero_and_one`. The existing
`test_a_genuinely_short_ledger_is_still_told_to_import_more` stays green
untouched — its fixture has `observed == ledger_months`, where the new clause is
correctly absent.

This does **not** change the operator's own screen: his ledger has
`ledger_months_observed == months_observed == 3`, so the sentence is
byte-identical there. It changes the five-months-with-a-hole case, which is what
the reviewer found.

---

## Commands

```
backend/.venv/Scripts/pytest.exe -q --cov=app --cov-report=term-missing
  -> 454 passed, 258 warnings in 42.85s - TOTAL coverage 96%

frontend/ npm test
  -> Test Files 45 passed (45) - Tests 532 passed (532)

frontend/ npm run build   (tsc -b && vite build)
  -> built in 4.57s, no TypeScript errors
     (the pre-existing >500 kB chunk warning is unchanged)
```

`contrast.test.ts` is inside the frontend suite and green. `npm run lint` was
not run — it has never worked in this repo.

---

## Re-shot screenshots

Chrome DevTools MCP at 1440×1150, against the live instance and the operator's
own fixture, both read back with the Read tool. Same names as the originals,
which showed the wrong banner.

| File | What it now shows |
|---|---|
| `task14-reel-1440-clair.png` | The operator's real state. Banner: "Ces deux panneaux partent du même solde, mais pas de la même date. L'autonomie est comptée depuis le 23 août 2026, la date du jour. La prévision **partirait** du 9 janvier 2026, dernière date de votre historique, mais elle n'est pas établie : la raison est donnée avec la projection." The runway computed, so its half stays in the indicative. Everything below — balance −2 209,63 €, two "Déjà épuisé" panels with band and caveat, the refusal block — is unchanged from the version already reviewed. |
| `task14-reel-1440-sombre.png` | The same at 1440 dark; the info rule on the banner and the amber rules on the caveats read as before. |
| `task14-aucun-rythme-1440-sombre.png` | **New.** The state finding 1 is about, which the operator's data cannot reach: the runway route stubbed to `months_observed: 2` with both scenarios null. Two dashed "Non mesurable" panels each carrying its own reason; the caption, the scope note, the anchor sentence and all three clauses of the banner in the conditional. Console clean — no errors, no warnings. The forecast half of that shot is the real payload, so its "3 mois complets" is the true figure while the runway's "2" is the stub's; they are unrelated fields and the shot is of the runway cell. |

The date reads 23 août 2026 rather than the originals' 22 août: the real clock
moved a day between the two sessions, which is the point of `projected_from`.

---

## Concerns

1. **`Le scénario réduit repose sur 21 catégories marquées essentielles.`**
   (the essentials note) is still in the indicative when `essentials` is null.
   I left it: it describes what the scenario is *defined over* rather than
   claiming a measurement was made, and the review enumerated the four
   sentences it wanted gated — this was not among them. Flagging it so the
   decision is visible rather than silent.
2. **Two shots, not the full matrix.** Only the 1440 pair was re-shot, per the
   brief. The 768 and 375 real-data shots still carry the old banner text; the
   *layout* in them is unaffected by this change, but their banner wording is
   now stale.
3. The five deferred Minor findings and `ForecastFanChart`'s clipped last
   x-axis label were not touched, as instructed.
