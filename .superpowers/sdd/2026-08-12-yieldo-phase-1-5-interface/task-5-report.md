# Task 5 — The four usability defects — report

Commit `0c2828d` (single commit, branch `phase-1-5-interface`, on top of `5089800`).

Suites: backend **245 passed** (was 220, +25), frontend **355 passed** (was 333,
+22), `npm run build` zero TypeScript errors. Coverage on the two targeted
packages: `app/engines` 93–100% (`period.py` 100%), `app/importers` 96–100%
(`mapping.py` 99%), total 95%.

---

## What shipped

### Defect 1 — signed amount column

`suggest_mapping(headers, rows=(), decimal_separator=",")`. A header alone
cannot tell a two-column débit/crédit export from the single signed column most
French banks actually ship — both are commonly headed "Débit" — so the
suggestion is now given the sample rows the parser already read. A column
matched as `debit` or `credit` whose values carry **both** a negative and a
positive amount is proposed as `amount` instead.

- `_carries_both_signs` parses with the dialect's own decimal separator, skips
  empty cells and short rows, treats an exact zero as neither sign, and
  **disqualifies the column outright if any non-empty cell fails to parse** — a
  column carrying text is not a column of amounts, and no proposal should be
  built on half a reading.
- Scan is bounded at `SIGN_SAMPLE_ROWS = 200` so the suggestion stays cheap on a
  200 000-row export.
- Only-negative or only-positive stays ambiguous and is never guessed.
- `mapping.py` stays pure: it imports `parse_amount` from `dialect.py` (no
  cycle), no session, no clock, no I/O.
- One caller, `build_preview` in `service.py` (the orchestration layer), now
  passes `rows` and `resolved_dialect.decimal_separator`. Grepped: no others.
- Still only a proposal — the user confirms on screen before anything is
  written.

### Defect 2 — "Tout" means all

New pure engine `backend/app/engines/period.py::resolve_range(date_from,
date_to, earliest, latest, today)`. New `backend/app/api/history.py::user_history`
(one aggregate row: `min(date)`, `max(date)`, `count(id)`, filtered on
`user_id`). New shared schema `backend/app/schemas/history.py::HistoryOut`.

`_default_range` became `_period(db, user_id, date_from, date_to)`, which reads
the clock **at the route boundary** and hands it to the engine as a parameter.
All three date-taking analytics routes (`/series`, `/categories`, `/summary`)
use it.

**Decision worth flagging:** an absent `date_to` resolves to the user's *latest*
transaction, not `date.today()`. The brief said `date.today()` is "fine" and
required only that future-dated data not be cut off. Latest satisfies that by
construction (it is the max over all dates) and additionally makes the range
*exactly* the span that holds data — which is what the brief's own verification
demands ("must cover 2025-01-24 to 2026-01-09"), what makes the hero's
covered-range line readable, and what makes defect 4's "Afficher toute la
période" land on the identical range. With `today` the operator's line would
have read "au 16 août 2026" with seven empty months on the cashflow axis.

Two clamps keep a *defaulted* bound from inverting the range (`min(earliest,
end)`, `max(latest, date_from)`); bounds the caller stated are returned
untouched. A user with no transactions gets `(today, today)` — empty and honest,
no crash.

`/transactions` did **not** have the same defect (absent dates already meant the
whole ledger there); it is unchanged in that respect. It gained `period_total`
and `history` for defect 4.

### Defect 3 — import history

New `frontend/src/features/import/ImportHistory.tsx` + styles in
`ImportPage.css`, mounted as a full-width bento cell on the wizard's landing
step. Batches most recent first, each with filename, `12 août 2026 à 08:29`, and
the four counts.

Rollback confirms inline before firing. **I read `DELETE /api/imports/{batch_id}`
and `rollback_import` before writing the copy**: it deletes every transaction
carrying that batch id *for that user*, then the batch row, and returns
`{"removed": n}`. It does **not** touch the archived CSV — so the copy claims
nothing about the file:

> Cet import a créé 197 transactions : elles seront supprimées avec le lot.
> Cette action est irréversible.

The success notice repeats the **server's** figure, not the batch's record of
what it once imported: `Import supprimé : 3 transactions retirées.` The list
refetches after a successful rollback. The cell lives inside the step's stage,
which is keyed on the step, so returning from a commit remounts it and the new
batch is already listed (verified live). Errors surface the backend's French
`detail` verbatim; a failed load sets `batches = null`, never an empty list
standing in for a list that could not be read.

Focus moves to **Annuler**, not to the destructive button — a keyboard user who
reached "Supprimer cet import" with Enter must not have the confirmation land
under the same key.

### Defect 4 — empty states that diagnose

New shared `frontend/src/design/EmptyState.{tsx,css}` (title / detail / action),
plus `frontend/src/design/EmptyState.tsx::historySentence`. `frenchDate` moved
there out of `OverviewPage.tsx` and is now shared with `coveredRangeLabel`.

Three cases, ordered so the answer is useful — no ledger beats empty period
beats blaming a filter, because clearing a filter cannot conjure transactions
into a window that holds none:

1. `history === null` → « Aucune donnée pour le moment. » + link to /import.
2. `period_total === 0` → « Aucune transaction sur cette période. » + « Vos 197
   opérations vont du 24 janvier 2025 au 9 janvier 2026. » + a button that sets
   the range to exactly that.
3. otherwise → « Aucune transaction ne correspond à ces filtres. » + « Cette
   période contient 197 transactions. Filtre actif : la recherche
   « zzz-introuvable ». » + « Effacer les filtres ».

The dashboard has only cases 1 and 2 (it carries no filters). No second endpoint
was added: both screens read defect 2's `history`.

"Effacer les filtres" bumps a `filterResetKey` that remounts `FilterBar` —
the search box owns its own debounced input state, and clearing the page's
`search` alone would leave text sitting in a field that no longer filters.

---

## TDD evidence, per defect

### Defect 1 — RED

`.venv/Scripts/pytest.exe tests/test_mapping.py tests/test_import_api.py::test_analyze_proposes_amount_for_a_single_signed_column -q`

```
7 failed, 14 passed
FAILED tests/test_mapping.py::test_single_signed_column_is_proposed_as_amount_not_debit
FAILED tests/test_mapping.py::test_a_signed_column_headed_debit_is_proposed_as_amount
FAILED tests/test_mapping.py::test_two_column_debit_credit_export_still_proposes_both
FAILED tests/test_mapping.py::test_a_column_of_only_negative_values_stays_debit
FAILED tests/test_mapping.py::test_a_dot_decimal_signed_column_is_read_with_the_dialect_separator
FAILED tests/test_mapping.py::test_a_non_numeric_column_headed_debit_is_never_reinterpreted
FAILED tests/test_import_api.py::test_analyze_proposes_amount_for_a_single_signed_column
```

The six unit tests failed on `TypeError: suggest_mapping() got an unexpected
keyword argument 'rows'` — expected, the signature did not exist yet. The API
test failed on the defect itself:

```
E  AssertionError: assert {'0': 'date',... '2': 'debit'} == {'0': 'date',...'2': 'amount'}
E    Differing items:
E    {'2': 'debit'} != {'2': 'amount'}
```

That is the operator's file: `Date;Libellé;Débit/Crédit` with `-47,32` and
`2450,00`. Tagged `debit`, the parser's `_resolve_amount` would have returned
`-abs(2450,00)` — a €2450 salary silently imported as a €2450 expense.

### Defect 1 — GREEN

`.venv/Scripts/pytest.exe tests/test_mapping.py tests/test_import_api.py tests/test_import_service.py -q` → **58 passed**.

A seventh test (`test_a_row_shorter_than_the_header_never_stops_the_scan`) was
added afterwards to cover the ragged-row branch coverage flagged; `mapping.py`
went 97% → 99% (the one remaining miss, line 152, is a pre-existing
unknown-role branch).

### Defect 2 — RED

`tests/test_period.py` first failed at import: `ModuleNotFoundError: No module
named 'app.engines.period'` — expected, the engine did not exist.

`.venv/Scripts/pytest.exe tests/test_analytics_api.py tests/test_transactions_api.py -q`

```
9 failed, 24 passed
E  AssertionError: assert '2026-01-01' == '2025-03-01'
E  AssertionError: assert ['2026-01', '...2026-06', ...] == ['2025-03']
E    At index 0 diff: '2026-01' != '2025-03'
E  assert 0 == 4
E  KeyError: 'history'   (x4)
E  KeyError: 'period_total'   (x2)
```

The first three are the defect verbatim: with no dates, the summary answered
`2026-01-01` instead of the fixture's `2025-03-01`, the monthly series returned
eight buckets of the current calendar year instead of the one month that holds
data, and the category breakdown counted zero of four rows. The `KeyError`s are
the new fields.

### Defect 2 — GREEN

`.venv/Scripts/pytest.exe tests/test_period.py tests/test_analytics_api.py tests/test_transactions_api.py -q` → **40 passed** (after correcting one of my own
expectations: the category breakdown is expense-only, so 3 of the 4 fixture rows,
not 4 — noted in the test).

`app/engines/period.py` 100% covered, `app/api/history.py` 100%.

**Live before/after on the operator's own volumes.** The running instance still
had the pre-fix code loaded:

```
GET /api/analytics/summary  →  date_from 2026-01-01, date_to 2026-08-16,
                               transaction_count 26
```

After restarting it on this branch:

```
GET /api/analytics/summary  →  date_from 2025-01-24, date_to 2026-01-09,
                               transaction_count 197
                               history {2025-01-24 … 2026-01-09, 197}
```

### Defects 3 and 4 — RED

`npx vitest run src/features/import src/features/overview src/features/transactions`

```
Test Files  4 failed | 8 passed (12)
     Tests  8 failed | 117 passed (125)

FAIL src/features/import/ImportHistory.test.tsx   (whole file — module absent)
FAIL ImportPage — past imports > shows the import history on the landing step
FAIL OverviewPage > shows a dashboard-wide empty state pointing at Import…
FAIL OverviewPage > says where the data actually is when the period is the only thing that is empty
FAIL OverviewPage > widens the period to the whole history in one click
FAIL OverviewPage > places the empty state on the grid rather than beside it
FAIL TransactionsPage > offers the import when the user has no transactions at all
FAIL TransactionsPage > says where the data is, and widens to it, when only the period is empty
FAIL TransactionsPage > names the filter that is hiding the period's transactions, and clears it
```

`ImportHistory.test.tsx` failed at collection (7 tests, no such module).

### Defects 3 and 4 — GREEN

`npm test` → **36 files, 355 passed**. `npm run build` → zero TypeScript errors.

---

## What else I tested

- **Cross-user isolation**: `test_the_history_span_never_reaches_across_users`
  and `test_listing_history_is_null_for_a_user_without_any_transaction` —
  another user's older statement must never widen this user's default range.
- **A user with no transactions at all**: `history` is `null`, the summary
  returns `date_from == date_to`, nothing crashes.
- **Inverted-range guards**: `resolve_range` tested with an explicit end before
  the history and an explicit start after it; both assert `start <= end`.
- **Rollback failure path**: `ImportHistory` surfaces the backend's own
  `"Lot d'import introuvable"` and leaves the batch on screen.
- **Rollback is not fired by the first click** — an explicit assertion that no
  DELETE went out while the confirmation is showing, and another for Annuler.
- **List-load failure**: asserts the alert, and that no empty list is shown in
  place of data that could not be read.
- **Pure French grammar**: unit tests over `activeFilterLabels`,
  `filteredEmptyDetail` (singular/plural on both the count and "Filtre(s)
  actif(s)"), `frenchDate` ("1er" vs bare numeral, UTC), `historySentence`.
- **A full live import and rollback in the browser** (see below) — I did not
  roll back the operator's fixture; I imported a 3-row signed-column CSV and
  rolled *that* back, then confirmed the fixture was untouched:
  `197 transactions, 2025-01-24 → 2026-01-09, 1 batch`.
- Browser console: no errors or warnings on any screen visited.

---

## Files changed

Backend, new: `app/engines/period.py`, `app/api/history.py`,
`app/schemas/history.py`, `tests/test_period.py`.
Backend, modified: `app/api/analytics.py`, `app/api/transactions.py`,
`app/importers/mapping.py`, `app/importers/service.py`,
`app/schemas/analytics.py`, `app/schemas/transactions.py`,
`tests/test_analytics_api.py`, `tests/test_import_api.py`,
`tests/test_mapping.py`, `tests/test_transactions_api.py`.

Frontend, new: `src/design/EmptyState.tsx`, `src/design/EmptyState.css`,
`src/design/EmptyState.test.tsx`, `src/features/import/ImportHistory.tsx`,
`src/features/import/ImportHistory.test.tsx`.
Frontend, modified: `src/lib/types.ts`, `src/features/import/ImportPage.tsx`,
`src/features/import/ImportPage.css`, `src/features/import/ImportPage.test.tsx`,
`src/features/overview/OverviewPage.tsx`, `.css`, `.test.tsx`,
`src/features/transactions/TransactionsPage.tsx`, `.css`, `.test.tsx`,
`src/charts/WaterfallChart.test.tsx` (fixture gained `history`).

---

## Screenshots

All in `.superpowers/sdd/2026-08-12-yieldo-phase-1-5-interface/shots/`. Every
one was read back with the Read tool and judged.

- **`task5-tout-1440-dark.png`** — `/?periode=all`. The hero reads « Du 24
  janvier 2025 au 9 janvier 2026 », the cumulative trend has real shape (a
  descent, a plateau, a climb) instead of the pre-fix flat line, and the
  cashflow axis runs janv. 2025 → janv. 2026. Entrées 10 219,99 € / Sorties
  −12 429,62 €, against 4 636 / −2 720 before: the whole 197.
- **`task5-tout-1440-light.png`** — the same view, same figures, same axis, in
  the light theme.
- **`task3-1440-dark.png`** (re-shot) — task 3's hero verified against a working
  "Tout". The previous file was itself a picture of the defect: "Tout" selected,
  « Du 1er janvier 2026 au 16 août 2026 », a flat line, and an axis starting
  janv. 2026.
- **`task5-import-history-1440-dark.png` / `-1440-light.png`** — the new
  "Imports précédents" cell, full width under the two cells that start an
  import: filename, `12 août 2026 à 08:29`, `198 lignes lues / 197 importées /
  1 doublon / 0 en erreur`, and the outlined destructive action right-aligned.
- **`task5-import-history-375-dark.png` / `-375-light.png`** — the same row
  stacked on a phone: filename wraps to two lines, counts to two rows, action
  left-aligned below. Document scroll width 360 against a 375 viewport — no
  horizontal overflow.
- **`task5-rollback-confirm-1440-dark.png`** — the confirmation taking the whole
  row inside a red-bordered block, naming 197 transactions and "irréversible",
  with the focus ring visibly on **Annuler**.
- **`task5-rollback-done-1440-dark.png`** — after a real rollback: « Import
  supprimé : 3 transactions retirées. » and the batch gone from the list, the
  operator's fixture batch still there.
- **`task5-empty-no-data-1440-dark.png`** — case 1, on a throwaway account with
  no ledger: « Aucune donnée pour le moment. » + Importer un relevé.
- **`task5-empty-period-1440-dark.png`** — case 2, `/?periode=month` (August
  2026): « Vos 197 opérations vont du 24 janvier 2025 au 9 janvier 2026. » +
  « Afficher toute la période ». Clicking it produced
  `?periode=custom&du=2025-01-24&au=2026-01-09` and the loaded dashboard.
- **`task5-empty-filter-1440-dark.png`** — case 3: « Cette période contient 197
  transactions. Filtre actif : la recherche « zzz-introuvable ». » + « Effacer
  les filtres ». Clicking it emptied the search box and restored 50 of 197.
- **`task5-mapping-signed-1440-dark.png`** — the mapping step with a real
  cp1252-encoded CSV headed `Débit/Crédit`: the column's role select reads
  **Montant**, with `-42,10 / 2250,00 / -19,99` visible underneath. Committing it
  imported all 3 rows, credit included.

---

## Self-review findings (both fixed before the commit)

Both were **measured in the browser**, not eyeballed, and both were mine:

1. **`.yd-import-history__delete` label was `#ffffff`** — a hard-coded hex,
   against the brief's "colours from tokens.css". Worse, my comment claimed it
   cleared AA in both themes; measuring showed **3.38:1** on the dark theme's
   `--yd-negative` (#e5606b). Replaced with `var(--yd-bg)`: **5.78:1** dark,
   **5.74:1** light. The comment now carries the measured numbers and records
   that white was wrong.
2. **`.yd-import-history__rollback` label was `var(--yd-negative)`** — measured
   **4.00:1** on the row's composited ground (rgb(23,49,67)), below AA. The
   token is tuned against `--yd-bg`, and a raised surface is lighter than the
   page. The red moved to the **border** (non-text, 3:1 threshold; 4.00:1
   clears) and the label became `--yd-text`: **12.32:1** dark, **16.72:1**
   light. The word "Supprimer" was always the real signal.

Every other new pairing measured, dark / light: warning sentence 13.14 /
—, duplicate count 6.55 / 6.68, count labels 5.53 / 6.95, filename 12.32 / —,
batch date 5.53 / 6.95, `.yd-empty__title` 15.75 / 16.72, `.yd-empty__detail`
7.07 / 6.95, `.yd-empty__action` 11.29 / 6.21. All clear AA.

Also checked and found sound: no monetary float introduced at any layer (the new
fields are counts and dates); every new query filters on `user_id`; `mapping.py`
and `period.py` stay pure with no session, network or implicit clock; no bare
`except: pass` (the one `except ValueError` in `_carries_both_signs` is a
documented decision that disqualifies the column, not a swallowed error); all new
user-facing text is French; `prefers-reduced-motion` and `data-motion="off"`
twins added for both new transitions; `contrast.test.ts` still green.

---

## Concerns

1. **The `date_to` default is a judgement call I made against the brief's
   suggestion.** The brief said `date.today()` was "fine"; I resolve an absent
   end to the user's latest transaction instead. Reasoning is in "What shipped"
   above and the engine's docstring. If the controller prefers `today`, it is a
   two-line change in `resolve_range` plus one test expectation — but the hero's
   range line and the cashflow axis get seven empty months on the operator's
   data.
2. **`user_history` runs one extra aggregate query per analytics request and per
   page of the transaction list.** Cheap (a single indexed aggregate) and
   correct, but it is a new per-request cost on the hottest routes. Worth a
   glance during task 6's performance pass on the operator's hardware.
3. **The spending calendar still shows a single year** (2026 for "Tout"), so on
   a range spanning 2025–2026 it silently omits 2025. That is inherent to a
   year heatmap and pre-dates this task, but "Tout" now makes the omission more
   visible than it was. Not in scope; flagging it.
4. **Filter names in case 3 depend on reference data that loads separately.** If
   the empty state renders before `/accounts` and `/categories` resolve, an
   account or category filter is not named by name (the search filter always is,
   and the sentence still states the period's total). Self-correcting within a
   render, but it is a real ordering gap.
5. **Pre-existing, not mine:** the done step reports « 3 ligne importées » —
   singular noun with plural participle. One line in `ImportSummary.tsx`.
6. **Pre-existing, not mine:** `.yd-summary__cancel` ("Annuler cet import" on
   the done step) uses `color: var(--yd-negative)` on a panel surface, the exact
   pairing I measured at 4.00:1 and fixed in my own component. It is very likely
   below AA for the same reason. I did not touch it — it is outside this task —
   but the final review should.
7. **`SIGN_SAMPLE_ROWS = 200`** bounds the sign scan. A file whose first
   negative and first positive are more than 200 rows apart would keep the
   header-only proposal. Real statements mix both within a few dozen lines, and
   the user overrides on screen either way, but the limit is a real one.

## Environment note

The locally running backend was started from the system Python **without
`--reload`**, so it was still serving pre-fix code when I began the browser
pass (that is how I captured the live "before" figures). I restarted it on
`backend/.venv/Scripts/python.exe -m uvicorn app.main:app --port 8000 --host
127.0.0.1 --reload`. The throwaway account created for the case-1 screenshot
(`vide@yieldo-demo.fr`, plus its 69 seeded categories and 235 rules) was deleted
afterwards; the database is back to exactly the profile `seed_fixture.py`
documents: 1 user, 197 transactions 2025-01-24 → 2026-01-09, 1 batch of 198 rows.

---

# Fix report — review finding 1 (Important)

Commit `1cbd07b`, on top of `0c2828d`.

Suites after the fix: backend **248 passed** (+3), frontend **357 passed** (+2),
`npm run build` zero TypeScript errors. `app/engines/period.py` 100%,
`app/api/history.py` 100%, `app/schemas/analytics.py` 100%, total 95%.

## The finding, and that it was mine

The reviewer is right and the report missed it. Making an absent `date_from`
resolve to the user's earliest transaction — defect 2's whole point — made
`start` *by definition* the first row that exists. `summary` then took
`previous_end = start - 1 day` and compared against a window that cannot hold
data, so `compare_periods` returned `current_net - 0`, i.e. the net itself.
`task5-tout-1440-dark.png` showed the consequence on the operator's default
screen: **"−2 209,63 € par rapport à la période précédente"** in red, where
−2 209,63 € was the net restated as a fall.

Before this task "Tout" meant 1 January → today and the preceding span held real
data, so this is a regression I introduced. It is also the exact defect class
the brief chartered — true, useless, and actively misleading — reappearing in
the hero.

## The fix

Only a start the **caller stated** has a period before it. When `date_from` is
`None`, `/analytics/summary` now returns `previous: null` and `comparison: null`
— undefined, the way `savings_rate` is already `null` rather than `0` — and
`NetHero` drops the chip entirely rather than rendering a zero or an empty gap.
`.yd-hero__meta` is a flex column whose `gap` only applies *between* items, so
with one child the range line simply sits alone; no CSS change was needed.

Deliberately unchanged: a range the caller typed is still compared, even where
nothing precedes it. The user posed that window, and "nothing the month before"
is a real answer to it.

Consumers checked: `NetHero` is the only one. The three `StatTile`s on the
dashboard are fed `inflow_cents` / `outflow_cents` / `savings_rate` and never
`comparison`; `StatTile` already suppresses its optional `deltaCents` when
undefined, and `WaterfallChart` reads neither field.

## RED

`.venv/Scripts/pytest.exe tests/test_analytics_api.py -q -k "no_comparison or date_to_alone or nothing_precedes"`

```
2 failed, 1 passed, 15 deselected

FAILED tests/test_analytics_api.py::test_summary_without_dates_offers_no_comparison
FAILED tests/test_analytics_api.py::test_a_date_to_alone_still_leaves_no_preceding_period
```

The behaviour, not a missing field — the window that was being compared against
is printed in full:

```
E  AssertionError: assert {'date_from': '2025-02-22', 'date_to': '2025-02-28',
                           'inflow_cents': 0, 'outflow_cents': 0, ...} is None
```

`2025-02-22 → 2025-02-28`, every figure zero, ending the day before the
fixture's first transaction. The third test —
`test_a_requested_range_is_still_compared_even_where_nothing_precedes_it` —
**passed while RED**, which is the point: it pins the asymmetry so the fix
cannot quietly suppress comparisons the user asked for.

Frontend, `npx vitest run src/features/overview/OverviewPage.test.tsx`:

```
Tests  1 failed | 28 passed (29)

× OverviewPage > says nothing about a preceding period when the backend reports there is none
  TypeError: Cannot read properties of null (reading 'delta_cents')
```

The hero crashed outright on a null comparison — it was an untyped consumer.
Its companion (`still shows the delta when a range the user asked for does have
a period before it`) passed while RED, covering the other side.

## GREEN

```
cd backend && .venv/Scripts/pytest.exe -v --cov=app --cov-report=term-missing
  248 passed, 158 warnings in 66.22s
  app\engines\period.py    13   0  100%
  app\api\history.py        9   0  100%
  app\schemas\analytics.py 39   0  100%
  TOTAL                  1639  79   95%

cd frontend && npm test
  Test Files  36 passed (36)
       Tests  357 passed (357)

cd frontend && npm run build
  ✓ built in 14.96s        (zero TypeScript errors)
```

## Live verification

Both paths, against the operator's 197-row ledger:

```
GET /api/analytics/summary
  range 2025-01-24 2026-01-09 | net -220963
  previous:   None
  comparison: None

GET /api/analytics/summary?date_from=2025-06-01&date_to=2025-06-30
  previous: 2025-05-02 -> 2025-05-31 | comparison: {'delta_cents': 0, ...}
```

Before the restart the same instance answered the defect verbatim —
`previous` `2024-02-08 → 2025-01-23`, all zeros, `delta_cents: -220963` — which
is the "before" captured against real data.

In the browser, `/?periode=custom&du=2025-12-01&au=2025-12-31` still shows
`+715,50 € par rapport à la période précédente`: a range the user asked for,
compared as asked.

## Screenshots re-shot and read back

- **`task5-tout-1440-dark.png`** — the red chip is gone. The hero's right column
  now carries only « Du 24 janvier 2025 au 9 janvier 2026 », sitting cleanly at
  the top-right with no gap where the chip was. The net is still stated in full
  at the left, and the rest of the dashboard is unchanged (janv. 2025 → janv.
  2026 axis, 10 219,99 € in, −12 429,62 € out).
- **`task5-tout-1440-light.png`** — same, light theme.
- **`task3-1440-dark.png`** — re-shot on the same corrected view, so task 3's
  hero is now verified against a "Tout" that neither truncates the range nor
  invents a comparison.

## Environment note

The live API kept answering pre-fix code after the change. The cause was two
uvicorn processes racing for port 8000: an orphaned `--reload` **worker**
(PID 2356) whose watcher parent had been killed, so it could never reload and
never released the socket, while every new instance failed to bind with
`[Errno 10048]`. Killing the orphan and starting a single instance
(`backend/.venv/Scripts/python.exe -m uvicorn app.main:app --port 8000 --host
127.0.0.1`) fixed it. Worth knowing for the next browser pass: check
`Get-NetTCPConnection -LocalPort 8000` before trusting what the API returns.

## Concerns

1. **The suppression keys off `date_from is None`, not off whether the previous
   window actually holds data.** That is what the coordinator asked for and it
   draws a clean line — defaulted start means no comparison, stated start means
   compare as asked. The cost is the asymmetry visible above: December 2025
   reports `+715,50 € par rapport à la période précédente` because November 2025
   happens to be empty in this fixture. That number is honest (the user chose
   December, and November really was empty) but a reader could still take it for
   growth. Making the chip *also* suppress on a genuinely empty predecessor
   would be a different, larger judgement about explicit ranges, and the
   coordinator scoped it out. Flagging it for the whole-branch review.
2. **`previous` is now nullable in the public schema.** No other client exists,
   and the two frontend test fixtures still send it non-null (assignable to
   `T | null`), so nothing else needed changing — but it is a response-shape
   change on a route that shipped in phase 1.

**Second environment note, same area.** A uvicorn started as a *backgrounded
tool command* dies when that shell context is reaped (it logged every request
correctly, then `exited with code 127`), which is how the orphaned-worker mess
above started in the first place. Launch it detached instead, so it outlives the
session:

```powershell
Start-Process -FilePath 'E:\Projet\Github\Yieldo\backend\.venv\Scripts\python.exe' `
  -ArgumentList '-m','uvicorn','app.main:app','--port','8000','--host','127.0.0.1' `
  -WorkingDirectory 'E:\Projet\Github\Yieldo\backend' -WindowStyle Hidden
```

Left running that way (PID 10644) and re-confirmed serving the fixed code:
"Tout" answers `2025-01-24 → 2026-01-09`, 197 transactions, `previous` and
`comparison` null; an explicit range still carries its comparison; Vite still
answers on 5173.
