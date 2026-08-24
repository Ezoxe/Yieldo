# Task 9 — Récurrences screen — report

**Commit:** `25b2a43` — `feat(recurrences): add the subscriptions and direct debits screen`
**Branch:** `phase-2-analyse-decision` (from `a5575fb`)
**Status:** DONE_WITH_CONCERNS

---

## Where the brief was stale, and what I followed instead

The brief was written before task 7's third review round. Three payload facts it
does not know about, all confirmed against `backend/app/schemas/recurrences.py`
and a live `GET /api/recurrences`:

| Field | Brief | Reality |
|---|---|---|
| `observed_span_days` | absent | present on every recurrence |
| `annualisable` | absent | present; gates `annual_cents` |
| `ledger_last_on` | absent | present on the report, nullable |

And one behavioural fact the brief's page code gets wrong: `notice` is **not**
only set when the list is empty. The engine also sets it when it detected rows
but could annualise none of them, which is precisely the operator's case. The
brief's `RecurrencesPage` prints `notice` inside the empty-state branch only, so
on the real fixture it would have rendered four rows, a `0,00 €` headline, and
no explanation at all. The response wins: `notice` is printed whenever non-null.

I also dropped the brief's `RecurrenceRow` in favour of one that takes
`ledgerLastOn`, since honesty requirement 3 cannot be satisfied without it, and
its `STATUS_LABEL.ended = "Interrompu"` asserts exactly the cancellation the
data does not support.

Two of the brief's own tests would not have passed as written: `getByText(/15,99/)`
matches both the head amount and the price-change line on its fixture, and
`getAllByRole("listitem")` counts the "À surveiller" bullets too. Both are
scoped properly in the tests I shipped.

---

## What I implemented

**`frontend/src/lib/types.ts`** — `Periodicity`, `RecurrenceStatus`,
`RecurrenceConfidence`, `PriceChange`, `Recurrence`, `RecurrenceReport`, mirroring
the real schema including the three fields above.

**`frontend/src/features/recurrences/RecurrenceRow.tsx`** — the row, plus the
pure helpers the page and task 18 share:

- `PERIODICITY_LABEL`
- `formatRatio(ratio)` → `"+18,5 %"` / `"−7,2 %"`, typographic minus so a column
  of percentages aligns with a column of `formatCents` figures
- `ANNUALISATION_FLOOR_DAYS = 91` — used only to *name* the rule in French copy;
  the gate itself always travels on the wire as `annualisable`, so a change of
  floor on the backend cannot leave the screen silently applying the old one
- `describeSpread(amountCents, spreadCents)` → `{ text, unstable }`
- `exclusionReason(recurrence)` → French reason or `null`

**`frontend/src/features/recurrences/RecurrencesPage.tsx`** — four bento cells:
cost (lg 7), à surveiller (lg 5), the counted list (lg 12), the excluded list
(lg 12). Empty ledger falls back to `EmptyState` + the audit line.

**`frontend/src/features/recurrences/RecurrencesPage.css`** — new stylesheet,
`design/Skeleton.css` imported rather than re-declared.

**Route + nav** — `/recurrences`, sidebar entry "Récurrences" between Budgets
and Catégories.

---

## The four honesty requirements

### 1. The 91-day annualisation bar

`annual_cents` is rendered **only** when `annualisable` is true. When it is
false the row renders a different sentence in its place — same size, same
weight, so nothing about the layout suggests a number went missing:

> Observé sur 22 jours seulement : trop court pour en déduire un coût annuel.

The row also carries its exclusion reason: *"Pas encore annualisé : moins de 91
jours d'observation."*

The accepted cost of the rule is stated in French at the head of the excluded
section:

> Un prélèvement n'entre dans le total qu'une fois 91 jours d'historique écoulés
> entre sa première et sa dernière échéance. Un abonnement souscrit ce trimestre
> est donc bien détecté et affiché ici, mais il n'entre dans le total qu'à partir
> de sa quatrième ou cinquième échéance mensuelle.

"quatrième ou cinquième" rather than the brief's "fourth charge" because the
brief's figure is wrong for a common case: a monthly charge on the 10th from
January to April spans 90 days, one short of the bar. The fifth charge clears
it. Where the months are longer the fourth already does. The copy states the
rule in days, which is exact, and the charge count as the range it actually is.

And when nothing at all clears the bar — the operator's case — the headline is
not `0,00 €`. It reads **"Pas encore calculable"**, with the engine's own notice
under it. Zero is a claim, and here it would be the wrong one: the subscriptions
do not cost nothing, they have not been watched long enough to cost anything yet.
Pinned by a test that asserts `0,00` appears nowhere on that render.

### 2. The sort order

`splitRecurrences` partitions on the engine's own summing condition,
`annualisable && annual_cents < 0 && status !== "ended"`, in that order.

- **Counted** keeps the backend's order. There, descending `abs(annual_cents)`
  means what it says — most expensive first, which is why the reader opened the
  screen. Captioned "Du plus cher au moins cher, sur douze mois."
- **Excluded** is re-sorted on `abs(amount_cents)`, the amount actually charged.
  Ordering it on `annual_cents` would order a list by a key the screen refuses
  to display, which reads as no order at all. Captioned explicitly:
  "Classés par montant prélevé, et non par coût annuel".

On the operator's fixture this is the whole ballgame: the payload's first row is
`CARTE X1234 FNAC DARTY` at `annual_cents: -836576`, and it is excluded. A
screen rendering the list as sent would open with **8 365,76 €** under a heading
that says "Coût des abonnements".

`exclusionReason` is the single source of both the grouping and the per-row
sentence, so the two cannot drift.

### 3. `ended` is not a cancellation

The row takes `ledgerLastOn` and `ledgerClause` branches on where the data ran
out relative to the charge that was due:

- **Ledger stops on or before the expected date** — nothing was observed about
  that charge at all:
  > Le 2 mai 2026 est la dernière date de votre historique, antérieure à cette
  > échéance : rien ne dit que le prélèvement a cessé, il se peut simplement
  > qu'aucun relevé plus récent n'ait été importé.
- **Ledger runs on past it** — the statements demonstrably kept arriving and the
  charge did not, which is a real observation and burying it under "you haven't
  imported" would be its own lie:
  > Le 15 août 2026 est la dernière date de votre historique, soit 305 jours
  > après l'échéance attendue : vos relevés se sont poursuivis sans ce prélèvement.

Neither branch says "résilié", "annulé" or "interrompu". The status badge for
`ended` is **"Sans prélèvement récent"**, not the brief's "Interrompu".

The page states the clock once, up front, in "À surveiller":
*"Statuts jugés au 9 janvier 2026, dernière date de votre historique, et non à
la date du jour."*

I added the two-branch behaviour **after** seeing the first browser pass: the
single-branch version told the reader Spotify's eleven-month silence might just
be a missing import, while the ledger plainly ran on for eleven months without
it. That is the screen inventing a reassurance.

### 4. `amount_spread_cents`

Every row states its spread. `describeSpread` has three registers:

- `spread === 0` → "Montant constant d'une échéance à l'autre."
- `spread / |amount| < 5 %` → "Montant quasi constant : ±0,60 € autour de 42,50 €."
- otherwise → "Montant variable : ±41,81 € autour de 160,88 €." **plus** "Un
  abonnement ne varie pas ainsi : ce libellé regroupe peut-être plusieurs
  opérations différentes."

An unstable row also gets a 3px `--yd-warning` left rule, so it is findable in a
list of ten cards — colour reinforcing the words, never replacing them. The page
counts them in "À surveiller": *"3 libellés au montant variable : un même libellé
peut regrouper des opérations différentes."*

On the operator's fixture this fires on three of the four detected rows, which is
the correct answer — they are card purchases and pharmacy visits, not subscriptions.
The `retrait dab` case named in the engine's docstring is exercised in the
populated screenshots: it is the top row of the *counted* list at −3 120,00 €/an
and carries the warning.

One extra: `price_change_count` is not printed as-is. The backend counts changes,
rises and falls alike, and calling a fall a "hausse" is a small lie repeated on
every screen that shows it. The page derives the two counts from the rows'
`price_change.ratio` sign and reports them separately.

---

## Tests

- Frontend: **474 passed** (was 437; +36 new, +1 AppShell nav route).
  - `RecurrenceRow.test.tsx` — 23 tests
  - `RecurrencesPage.test.tsx` — 13 tests
  - `AppShell.test.tsx` — nav list pinned to 7 entries, new routing test
- Backend: **373 passed**, unchanged.
- `npm run build` — zero TypeScript errors.

TDD was followed for the page (`npm test -- RecurrencesPage` → red, module not
found → implement → green). For `RecurrenceRow` I wrote the whole test file
first but implemented before running it, so the red step is inferred rather than
observed. Noted rather than glossed.

Tests worth naming, because they pin the honesty rather than the markup:

- *"never prints an annual figure for a run it may not annualise"* — asserts
  `365,76` is absent from the DOM.
- *"keeps the excluded recurrences out of the counted list, whatever their rank"*
  — asserts both lists' exact contents against a payload in the backend's real
  order, where the two largest figures are both excluded.
- *"refuses to print a zero total when nothing cleared the annualisation bar"*.
- *"blames the missing statements... when the ledger stops first"* and *"reports
  the gap in days when the ledger ran on without the charge"* — the two branches.
- *"names the annualisation gate first when two reasons apply"* — pins the
  precedence to the engine's own.

---

## Browser verification

Dev servers: frontend 5173, backend 8000. **The backend was stale** — it had been
started before task 8's commit and served 404 on `/api/recurrences`; I restarted
it from `backend/.venv` with `--reload`. Worth knowing for task 10.

Populated-state screenshots were produced by stubbing `window.fetch` for
`/api/recurrences` through a navigation init script, **not** by importing and
rolling back a CSV. Read-only, nothing touched. The fixture was re-checked after
all captures: **197 transactions, 2025-01-24 → 2026-01-09**, exactly as phase
1.5's task 6 left it.

All shots in `.superpowers/sdd/2026-08-16-yieldo-phase-2a-analyse/shots/`.

### Real fixture (four bursts, nothing annualisable — the correct answer)

| File | What it shows |
|---|---|
| `task9-fixture-375-clair.png` | 375 light: no horizontal scroll (`scrollWidth === clientWidth === 375`, verified in JS), 76-char labels wrap inside their card, the amount drops to its own right-aligned line rather than colliding. |
| `task9-fixture-375-sombre.png` | Same at 375 dark; the warning left-rule and the "Prélèvement manquant" badge stay legible on the dark surface. |
| `task9-fixture-768-clair.png` | 768 light: cells stack full width, list still single-column (the 900px switch has not fired), the notice's left rule reads as a reason and not a caption. |
| `task9-fixture-768-sombre.png` | Same at 768 dark. |
| `task9-fixture-1440-clair.png` | 1440 light: cost cell (7 cols) beside "À surveiller" (5), two-column list below, cards not stretched to the row height. |
| `task9-fixture-1440-sombre.png` | Same at 1440 dark — the headline reads "Pas encore calculable", the notice explains it, and the four bursts each state their observed window instead of a yearly cost. |

### Populated (stubbed payload: counted list, price rise, income, ended, unstable)

| File | What it shows |
|---|---|
| `task9-peuple-375-clair.png` | 375 light, eight rows across both lists; every card wraps, nothing overflows. |
| `task9-peuple-375-sombre.png` | Same at 375 dark. |
| `task9-peuple-768-clair.png` | 768 light: both lists present, `RETRAIT DAB` at the top of the counted list carrying its "Montant variable" warning. |
| `task9-peuple-768-sombre.png` | Same at 768 dark. |
| `task9-peuple-1440-clair.png` | 1440 light: `4 780,68 €` headline, five counted / three excluded, the Netflix price rise as `13,49 € → 15,99 € le 14 janvier 2026, +18,5 %`, and Spotify's silence phrased as 305 days of statements without it. |
| `task9-peuple-1440-sombre.png` | Same at 1440 dark. |

### Extra checks

| File | What it shows |
|---|---|
| `task9-motion-off-1440-sombre.png` | `data-motion="off"`: all four bento cells at `opacity: 1`, `transform: none`, none stranded; `CountUp` shows its final value with no animation. |
| `task9-chargement-1440-clair.png` | The loading skeleton (20s stubbed delay), on the same cells at the same spans as the loaded content. |

Measured in the browser, over the **composited** pixel (each element's real
background stack walked and alpha-composited, not `--yd-bg`):

| Element | Dark | Light |
|---|---|---|
| `.yd-recurrence__badge--missing` on `--yd-warning` | **7.40:1** | **6.68:1** |
| `.yd-recurrence__excluded` / `__meta` (muted) | 6.25:1 | 6.95:1 |
| `.yd-recurrences__clock` | 7.07:1 | 6.95:1 |
| `.yd-recurrence__observed` / `__spread--unstable` | 13.93:1 | 16.72:1 |
| `.yd-recurrences__uncomputable` | — | 16.72:1 |

All clear AA (4.5:1) in both themes. No console errors or warnings.

### What the browser changed

Two things I would not have caught in Vitest:

1. **Span balance.** The brief's `cost: lg 5 / alerts: lg 7` left the cost cell's
   prose wrapping into eleven lines and the four-line alerts cell beside it half
   empty at 1440. Swapped to 7/5.
2. **The `ended` phrasing**, above — the single-branch version was actively
   misleading on a ledger that outlives the subscription.

---

## Self-review findings

Found and fixed before committing:

1. **A false caption.** The excluded list read "leur coût annuel n'est pas
   affiché, puisqu'il n'a pas été calculé" — but that list also holds income and
   `ended` rows, which *are* annualisable and *do* show a yearly figure. The
   sentence was false for two of its three cases. Rewritten to
   "Classés par montant prélevé, et non par coût annuel : celui-ci n'est pas
   calculé pour les lignes observées moins de 91 jours", with a preceding
   paragraph naming all three exclusion reasons.
2. **`ended` phrasing**, as above.
3. A French word left in an English code comment.

Deliberate choices worth flagging for review:

- `UNSTABLE_SPREAD_RATIO = 0.05` is my number, not the engine's. The engine has
  no amount-stability gate at all (documented, not patched). Five percent is the
  line at which a charge stops looking like one price; it is a display threshold
  only and changes no total.
- The counted list keeps the backend's order and the excluded list does not. That
  asymmetry is intentional and captioned, but it is a thing a reviewer should
  agree with rather than discover.
- `report.price_change_count` is now unused by the screen, superseded by the
  rise/fall split derived from the rows. The field stays on the type.

---

## Concerns

1. **`RETRAIT DAB` is counted, and the screen can only warn.** In the populated
   payload a weekly withdrawal group with a 58 % spread is `annualisable`,
   negative and active, so the engine folds `−3 120,00 €` into the annual total
   and the screen must show it there. All this screen can do is put the warning
   on the row and count it in "À surveiller"; it cannot decline to add it up
   without contradicting the total the backend sent. If the operator's ledger
   ever grows past the 91-day bar on `retrait dab`, the headline figure will be
   materially wrong and only a sentence will say so. That is an engine decision
   (amount stability is not a gate) and I did not want to paper over it on the
   client — but it is the one place where this screen's honesty is advisory
   rather than structural. Worth a phase-2 decision.

2. **Counted-list ordering when a row is `missing`.** The engine's total includes
   `missing` rows (only `ended` is dropped), so a subscription that may have
   lapsed still contributes its full annual figure to the headline. The screen
   states the status on the row, but the total does not distinguish. Consistent
   with the backend; noting it because a reader could reasonably expect otherwise.

3. **TDD purity on `RecurrenceRow`**: whole test file written first, implementation
   written before the red run. The page followed the loop properly.

4. **The loading skeleton guesses two cards.** Both lists collapse to one
   skeleton block sized for roughly two rows. On a ledger with twenty
   recurrences the page will grow when the data lands. Same limitation as
   `BudgetsPage`, so at least it is consistent.

5. **The backend dev server was stale** and served 404 until restarted. If task 10
   opens a browser without restarting it, it will see the same phantom failure.

---

# Task 9 — fix round 1 — report

**Reviewed commit:** `25b2a43`
**Branch:** `phase-2-analyse-decision`
**Scope:** the two Important findings, plus the two Minor prose findings named
in the brief. The six deferred Minor findings were left alone.

---

## Finding 1 — the refusal gate tested the wrong condition

**What was wrong.** `RecurrencesPage.tsx` gated on
`report.recurrences.some((item) => item.annualisable)` while the figure it
guards, `annual_subscription_cents`, is summed by the engine over
`annualisable && annual_cents < 0 && status != "ended"`
(`engines/recurrence.py:412-416`). Different sets. One annualisable *income*
row — or one annualisable expense that had gone `ended` — satisfied the wider
test while the sum stayed empty, and the screen printed `CountUp(0)` →
**"0,00 €"** plus "par an, soit 0,00 € par mois" under a heading that says
"Coût des abonnements". `notice` is null in that state (the engine writes one
only when *nothing* is annualisable, `:425`), so nothing explained the zero.

**What changed.**

1. The gate is now `split.counted.length > 0` — the very set the figure is
   summed over, computed by `splitRecurrences` from `exclusionReason`, which
   already mirrors the engine's condition in the engine's own order.
2. A second register of copy, in a new pure helper `uncomputableCopy`:

   | state | headline | reason under it |
   |---|---|---|
   | nothing annualisable | "Pas encore calculable" | none — the engine's `notice` prints just below and says it |
   | annualisable rows exist, none counted | "Aucun abonnement en cours dans ce total" | "Des récurrences ont bien été détectées, mais aucune n'entre dans le total des abonnements : chaque ligne, plus bas, dit ce qui l'en écarte." |

   The second register carries its own reason precisely because the engine
   sends none in that state. It renders with `.yd-recurrences__notice` — the
   same left-ruled treatment as the engine's own notice, no new colour pairing.

   The second headline deliberately says "dans ce total" rather than "aucun
   abonnement en cours": the state is reachable with a live short-window
   expense in the list, so the only claim the screen may make is about its own
   total, not about the operator's life. Same reason the reason-sentence says
   "n'entre dans le total" and not "n'est pas un abonnement".

**Why "Pas encore calculable" could not simply be reused.** It is true when
nothing has been watched for a quarter. It is false the moment a row *has*
cleared the 91-day bar and merely is not a live subscription cost: there the
annual figure is perfectly calculable, and telling the reader to import more
statements sends him after something that would change nothing.

**Tests** (`RecurrencesPage.test.tsx`), three new:

- *"refuses a zero total when the only annualisable recurrence is income"* —
  payload `incomeOnly` = one annualisable salary + one short-window burst.
  Asserts the second headline, and that neither "par an, soit" nor the first
  register appears.
- *"says why the total is empty when the engine sends no notice"* — same
  payload, asserts the reason sentence.
- *"refuses a zero total when every annualisable expense has stopped"* —
  payload `allEnded` = an annualisable `ended` expense + a short-window burst.

The existing *"refuses to print a zero total when nothing cleared the
annualisation bar"* gained one assertion, that the **second** register does not
appear there, so the two registers are pinned apart from both sides.

---

## Finding 2 — the unreachable prose branch: **kept, as a documented guard**

**Resolution: kept**, with the tests re-anchored so it is exhibited as a guard
rather than as the operator's prose.

**Why kept rather than dropped.** The branch is unreachable *because of a
coupling the route makes on purpose and could stop making*:
`api/recurrences.py:49` passes `today = history.date_to` and `:95` returns
`ledger_last_on = history.date_to`. The route's own docstring spends a
paragraph weighing the alternative — passing the real `date.today()` — and
rejects it for this release. The day that decision changes, or the day any
other caller renders a row against a clock of its own, `ledger_last_on` sits
*before* `expected_next_on` and this becomes the common case, with the branch
saying exactly the right thing. Dropping it does not remove a false sentence;
it replaces one with a worse one, since the surviving branch would then print
"soit −8 jours après l'échéance attendue".

So the two branches are now ordered reachable-first, and `ledgerClause`'s
docstring states which one the API can emit, why the other cannot fire today,
what would make it fire tomorrow, and what it prevents.

**What changed in the tests.**

- `RecurrenceRow.test.tsx` *"says when an expected debit did not arrive"* now
  renders against `2026-05-20`, not the default `2026-05-02`: `missing`
  requires the ledger past `expected_next_on` + grace (6 days on a 30-day
  rhythm), so the old fixture was a payload the backend cannot send. It also
  now asserts the gap sentence the operator actually reads.
- The old *"blames the missing statements … when the ledger stops first"* is
  renamed *"blames the missing statements when the ledger stops before the due
  date"* and carries a comment saying in as many words that this payload is not
  API-reachable, that it pins what the guard would say, and that no other test
  should read as though it were live copy. It gained one assertion: that the
  guard never prints a negative day count.
- The two "never asserts a cancellation" assertions (`résilié`, `Interrompu`)
  were **added to the reachable `ended` test** as well, so that property is
  pinned on the sentence the operator sees and not only on the guard.

**Same defect one level up, also fixed.** `RecurrencesPage.test.tsx`'s main
fixture had the identical problem and the review did not name it: `gym` was
`missing` and `oldFee` `ended` against `ledger_last_on: "2026-05-02"`, both of
which the engine would have classified `active`; `oldFee` also inherited a
`first_on` three months *after* its own `last_on`. The whole payload is now
anchored on `ledger_last_on: "2026-05-20"` with per-row dates the engine could
actually produce, and a comment at the top of the fixture states the rule. One
assertion moved with it ("Statuts jugés au 20 mai 2026"). Nothing else in that
file changed meaning: the counted/excluded split, the totals and the alert
counts are all as before.

---

## Finding 3 — "depuis le début de l'historique" overstated the window

`find_price_change` runs on the analysed run only, which `_analysable_run` cuts
at the last hole, so on a ledger with a lapse the changes before it were never
examined. Both branches of the alert line now say **"sur la période
analysée"** — the zero branch too ("Aucun changement de prix détecté sur la
période analysée."), since it makes the same claim about the same window.

Pinned by an assertion added to *"calls out the missing debits and the price
rises separately"*.

## Finding 4 — two slips in the excluded list's captions

- "Classés par montant **prélevé**" → "Classés par montant **de l'opération**".
  The list holds recurring income, where nothing was prélevé.
- "celui-ci n'est pas **calculé**" → "n'est pas **retenu**". `annual_cents` is
  computed for every row; what the 91-day bar withholds is the vouching, not
  the arithmetic.

The code comment above the caption was rewritten too — it carried the same
"have no annual cost" slip.

New test *"captions the excluded list without claiming more than it can"*,
which also asserts the old wording is gone.

---

## Tests and commands

```
frontend> npx vitest run src/features/recurrences      (red step, before impl)
  Test Files  1 failed | 1 passed (2)
       Tests  5 failed | 35 passed (40)

frontend> npx vitest run src/features/recurrences      (after impl)
  Test Files  2 passed (2)
       Tests  40 passed (40)

frontend> npx vitest run
  Test Files  42 passed (42)
       Tests  478 passed (478)        (was 474; +4 new page tests)

frontend> npm run build
  built in 8.71s                      (zero TypeScript errors; the 500 kB
                                       chunk-size warning is pre-existing)

backend>  ./.venv/Scripts/pytest.exe -q
  373 passed, 219 warnings in 33.84s   (unchanged — no backend code touched)
```

TDD was followed: the five assertions above were written first and observed
failing against `25b2a43`'s implementation, then the page and the row changed.

`contrast.test.ts` is inside the 478 and stayed green. `npm run lint` was not
run — it has never worked in this repository.

---

## Browser verification

Servers were already up and **not stale**: `GET /api/recurrences`
unauthenticated returned `401 {"detail":"Authentification requise"}`, which is
the route answering, not a phantom 404. No login was performed — the browser
profile already held a session. No console errors or warnings across every
state captured (errors + warnings, preserved over the last three navigations:
none).

Populated states were produced by patching `window.fetch` for
`/api/recurrences` through a navigation init script, read-only, exactly as the
first round did. Every stub key was removed from `localStorage` afterwards.

**The stub payload was rebuilt to be one the backend could actually emit** —
same rule as the test fixture, anchored on `ledger_last_on: "2026-05-20"`. This
matters for finding 2: on the previous round's payload the stale rows exercised
the unreachable clause. Every stale row in the new shots reads "soit N jours
après l'échéance attendue", which is what the API produces. The real fixture
confirms it independently: its one `missing` row renders "…soit 7 jours après
l'échéance attendue".

Shots re-taken (copy changed on all of them) and read back:

| File | State |
|---|---|
| `task9-fixture-{375,768,1440}-{clair,sombre}.png` | the operator's real ledger — 4 bursts, nothing annualisable, register 1 |
| `task9-peuple-{375,768,1440}-{clair,sombre}.png` | 8 stubbed rows, 5 counted / 3 excluded, headline 5 050,56 €, one rise and one fall |
| `task9-motion-off-1440-sombre.png` | `data-motion="off"` — all four cells `opacity: 1`, `transform: none`, `translate: none`; `CountUp` at its final value |

New shots, for the state finding 1 created:

| File | State |
|---|---|
| `task9-total-vide-1440-clair.png` | annualisable salary + short-window burst → "Aucun abonnement en cours dans ce total" and its reason. `document.body.innerText.includes("0,00 €") === false` |
| `task9-total-vide-1440-sombre.png` | same, dark |

`task9-chargement-1440-clair.png` was **not** re-shot: it is the skeleton, and
no skeleton copy changed.

No horizontal overflow at any width (`scrollWidth === clientWidth`: 360/360 at
375, 753/753 at 768, 1425/1425 at 1440).

Contrast, measured over the composited pixel (each element's real background
stack walked and alpha-composited, not `--yd-bg`):

| Element | Dark | Light |
|---|---|---|
| `.yd-recurrences__uncomputable` (both registers) | 15.75 | 16.72 |
| `.yd-recurrences__notice` (engine's, and the new one) | 15.75 | 16.72 |
| `.yd-recurrences__caption` / `__scope` / `__clock` | 7.07 | 6.95 |
| `.yd-recurrence__excluded` / `__badge--ended` | 6.25 | 6.95 |
| `.yd-recurrence__badge--missing` | 7.40 | — |
| `.yd-recurrence__observed` / `__spread--unstable` / `__change` | 13.93 | 16.72 |
| `.yd-recurrences__annual` | 15.75 | — |

All clear AA (4.5:1) in both themes. No new colour pairing was introduced: the
second register reuses two classes that already existed.

---

## Concerns

1. **The guard branch is now untested against reality, by construction.** That
   is the point of calling it a guard, but it does mean one French sentence in
   this file has no live rendering behind it. If a later phase changes the
   route's clock, that sentence becomes load-bearing overnight and nobody will
   have looked at it on a screen. Worth a line in the ledger.

2. **"sur la période analysée" is vaguer than the thing it describes.** The
   analysed period is per-row — each card states its own "N opérations, du X au
   Y" — while the alert line counts across all rows. The sentence is now true
   where the old one was false, but a reader who wants to know *which* period
   has to go and read the cards. A per-row phrasing would be exact and would
   cost the alert cell its one-line summary; that trade did not look like mine
   to make in a fix round.

3. **The page fixture rewrite went past the letter of the brief.** Finding 2
   named `RecurrenceRow.test.tsx`; the same correction was extended to
   `RecurrencesPage.test.tsx` and to the browser stub because they exhibited
   the identical unreachable payload. It touches more of that test file than a
   minimal fix would. Every assertion that changed meaning is listed above.

4. The six deferred Minor findings are untouched, as instructed — including
   `exclusionReason` classifying `annual_cents === 0` as income, which is
   adjacent to the gate that changed but not reached by it.
