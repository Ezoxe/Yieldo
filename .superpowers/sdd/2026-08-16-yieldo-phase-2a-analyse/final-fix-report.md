# Phase 2A — final whole-phase review, fix wave

One wave, two findings, both in `backend/app/engines/runway.py`: B1 (blocking)
and N1 (non-blocking, folded in because it is the same file and the same
class). The five other non-blocking findings named in the brief were left
untouched and go to the after-merge list.

Base: `4311cc1`, branch `phase-2-analyse-decision`.

---

## B1 — a refusal attributed the scenario's sample size to the ledger

### The defect

`_reason_insufficient_history(observed, label)` was called at `runway.py:114`
with `len(months)`. For `normal` that argument *is* the ledger's complete-month
count and the sentence was true. For `essentials` it is
`len(essential_months)`, and `api/cashflow.py` builds those months from a
**filtered** entry list (`essential_points`), so `complete_months` never emits
a month with no essential row in it. Its length is a count of months carrying
essential-tagged spending — never the ledger's size. The sentence
"l'historique n'en compte que N" therefore made a false claim about the ledger,
printed six lines above `CashflowPage`'s own "dont N mois complets".

### RED evidence, against the engine at `4311cc1`

Eleven complete months in the ledger, essential spending in two of them:

```
=== B1: essentials refusal blames the ledger ===
ledger complete months (months_observed): 11
essentials reason: Pas assez d'historique pour mesurer les dépenses essentielles :
                   il faut au moins 3 mois complets de relevés, et l'historique
                   n'en compte que 2.

=== B1 zero case: no essential category marked at all ===
ledger complete months (months_observed): 11
essentials reason: Pas assez d'historique pour mesurer les dépenses essentielles :
                   il faut au moins 3 mois complets de relevés, et l'historique
                   n'en compte que 0.
```

Two numbers for one fact. The zero case is worse: the stated cause is wrong as
well as the number — nothing is short about an eleven-month history.

### The fix

`compute_runway` now computes `ledger_months = len(all_months)` once and
threads it into both `_scenario` calls. `_reason_insufficient_history` takes it
and splits the sentence on whether the two counts agree:

* `observed == ledger_months` — the ledger itself is short. `normal`'s only
  case, and the original wording, now quoting `ledger_months` explicitly.
* `observed < ledger_months` — the ledger is whatever length it is and only
  some of its complete months carry this scenario's kind of spending. New
  wording, which states the sample size as its own clause and reserves
  "l'historique" for the ledger's own count.

Both branches are singular-safe (`n'en compte aucun` / `n'en compte qu'un
seul`, and `sur le seul mois complet de l'historique` via the new
`_ledger_span` helper) — the old sentence produced "n'en compte que 0", which
the review quoted directly.

**The zero-essential-categories case got its own sentence.** The engine cannot
tell "nothing is flagged essential" from "flagged categories carry no spending
in any complete month" out of the month list alone — both leave
`essential_months` empty — so `compute_runway` now takes a required
`essential_category_count: int`, which `api/cashflow.py` already had in hand as
`len(essential_ids)` and already ships in the payload. A plain int keeps the
engine pure. The branch is `essential_category_count == 0 and not
essential_months`, the only shape those two can honestly take together, so
contradictory input falls through to the measurement rather than to a lie.

`_reason_no_essential_category()` quotes **no month count at all**, on purpose:
none is relevant (no length of history produces essential spending when no
category is flagged), and a sentence carrying no number is structurally
incapable of contradicting the scope note under it. It leads with the scenario
rather than the category list because the Trésorerie cell's own note already
opens "Aucune catégorie n'est marquée essentielle" on this exact state — two
adjacent paragraphs opening on the same clause read as one sentence printed
twice. That collision was caught by the frontend RED run, not by inspection.

### After

```
essentials reason: Pas assez de mois pour mesurer les dépenses essentielles :
                   seuls 2 mois portent ce type de dépense sur les 11 mois
                   complets de l'historique, et il en faut au moins 3.

no essential category:
                   Ce scénario n'a aucune dépense à mesurer : aucune catégorie
                   n'est marquée essentielle, et la longueur de l'historique
                   n'y change rien.
```

---

## N1 — a refusal named a quantity the engine did not measure

### The defect

`_reason_no_measurable_burn` said *"Le solde net mesuré sur … n'est pas
déficitaire (N mois observés)"*. The branch fires on
`measure_expense_rate(...).median_cents <= 0` — the median of
`abs(outflow_cents)`, a **gross** expense rate that cannot be negative, so the
condition is exactly "the median month's spending is nil". That is not a
statement about a net balance, and "Solde net" is an established, different
quantity in this product: the name of `CashflowChart`'s third series.

The old test proved the sentence on an income-only fixture, where the net
happens to be healthy too, so the false half was never exercised.

### RED evidence

A fixture where gross and net diverge — two months of small inflow, one heavy
outflow:

```
=== N1: the branch fires on a zero GROSS median, not on a net balance ===
net over the observed months (cents): -998000
normal reason: Le solde net mesuré sur l'ensemble des dépenses n'est pas
               déficitaire (3 mois observés) : sans dépense nette à combler,
               aucune autonomie ne peut être calculée.
```

The net is a 9 980 € deficit and the sentence says it is not déficitaire.

### The fix

Reworded to name what was actually measured, and given `ledger_months` for the
same reason B1 needed it — `rate.months` is the scenario's own sample size and
for `essentials` can be smaller than the ledger's, so it is described as the
ledger's count only when the two genuinely agree:

```
Aucune autonomie mesurable pour l'ensemble des dépenses : sur les 3 mois
complets de l'historique, la dépense médiane d'un mois est nulle, il n'y a donc
aucune sortie d'argent à couvrir.
```

and, when the essentials sample is narrower than the ledger:

```
… : sur les 3 mois de l'historique qui portent ce type de dépense, la dépense
médiane d'un mois est nulle, …
```

---

## Files changed

| File | Change |
| --- | --- |
| `backend/app/engines/runway.py` | `_ledger_span` added; `_reason_insufficient_history` split on `observed == ledger_months`; `_reason_no_essential_category` added; `_reason_no_measurable_burn` reworded and given `ledger_months`; `_scenario` takes `ledger_months`; `compute_runway` takes `essential_category_count` and threads `len(all_months)` into both scenarios |
| `backend/app/api/cashflow.py` | passes `essential_category_count=len(essential_ids)` — a value the route already held and already returned in the payload |
| `backend/tests/test_runway.py` | 6 tests added, 3 rewritten to assert the whole clause |
| `backend/tests/test_cashflow_api.py` | 1 test added, end to end through the route |
| `frontend/src/features/cashflow/CashflowPage.test.tsx` | 2 fixtures added, 2 fixture strings corrected to the backend's real output, 2 tests added, 2 rewritten |
| `frontend/src/features/cashflow/RunwayPanel.test.tsx` | fixture string corrected; assertion tightened from `/dépenses essentielles/` to the whole sentence |

No production frontend file changed: `RunwayPanel` renders the backend's string
verbatim, which is what let the backend fix reach the screen on its own.

## Covering tests

The two tests the review named as unable to fail on the bug, and what they
assert now:

* `test_runway.py::test_two_months_of_history_measures_nothing_and_says_so` —
  was `assert "3 mois" in reason` (a substring of "il faut au moins 3 mois",
  which survives whatever number follows "n'en compte que"). Now asserts both
  reasons in full, with `==`.
* `test_runway.py::test_essentials_gets_its_own_reason_when_only_it_is_unmeasurable`
  — same substring, same fix.
* `CashflowPage.test.tsx > renders each scenario's own unavailability reason
  beside that scenario` — was `findByText(/dépenses essentielles/)`, which
  matched the label the reason opens with and said nothing about the claim
  after it. Now matches the whole sentence.

New:

| Test | What it pins |
| --- | --- |
| `test_the_essentials_refusal_never_attributes_its_sample_size_to_the_ledger` | B1 core. 11-month ledger, 2 essential months. Asserts the full sentence, that `"l'historique n'en compte que 2"` is absent, and that the ledger count in the sentence is `report.months_observed` — the number the screen prints |
| `test_a_ledger_carrying_no_essential_spending_at_all_says_so` | zero essential months out of a healthy ledger, categories flagged |
| `test_no_category_marked_essential_is_not_a_short_history` | zero categories: full sentence, no digit anywhere in it, and it does not open on the cell note's own clause |
| `test_a_one_month_ledger_is_refused_in_grammatical_french` | both singular forms; also takes `runway.py` to 100 % line coverage |
| `test_a_nil_median_expense_is_never_reported_as_a_healthy_net_balance` | N1. Fixture where the net **is** a deficit while the gross median is nil; asserts `solde net` and `déficitaire` are both gone |
| `test_an_unmeasurable_essentials_burn_names_its_own_sample_not_the_ledger` | N1 on the essentials side, where sample ≠ ledger |
| `test_cashflow_api.py::test_the_essentials_refusal_quotes_the_ledgers_own_month_count` | the same contradiction end to end through the route, asserting against `body["months_observed"]` rather than a literal |
| `CashflowPage.test.tsx > agrees with the scope note on how many complete months the ledger holds` | the actual screen failure: the scope note and the panel reason, read from one render, must quote the same ledger count |
| `CashflowPage.test.tsx > blames the empty essential list, not the ledger, when no category is flagged` | zero-category sentence on screen, and that it names no month count |

## Commands

```
backend/.venv/Scripts/pytest.exe -q --cov=app --cov-report=term-missing   (from backend/)
  before: 522 passed
  after:  529 passed, 307 warnings in 59.72s
          app\engines\runway.py   64   0   100%
          TOTAL                 2838  88    97%

npm test        (from frontend/)
  before: 632 passed
  after:  Test Files 48 passed (48) / Tests 634 passed (634)

npm run build   (from frontend/)
  ✓ built in 7.06s — zero TypeScript errors
```

`npm run lint` was left alone; eslint is not installed here.

The frontend RED run, before the fixture strings were corrected, failed 3 of 26
in `CashflowPage.test.tsx` — including the "no category flagged" test, whose
failure message is what exposed the duplicated opening clause described above.

## On screen

Dev servers were restarted from a clean state (`Get-NetTCPConnection
-LocalPort 8000` was empty before launch, so no stale worker), and the target
state was built through the real HTTP API rather than by stubbing: a throwaway
local user, eight months of a non-essential restaurant charge (Jan–Aug 2025)
against two months of the essential grocery charge. That yields a ledger of six
complete months with essential spending in two of them — `normal` measurable,
`essentials` not.

`shots/final2a-runway-essentials-refusal-1440-light.png`,
`…-1440-dark.png`, `…-375-light.png`:

* the essentials panel reads *"Pas assez de mois pour mesurer les dépenses
  essentielles : seuls 2 mois portent ce type de dépense sur **les 6 mois
  complets de l'historique**, et il en faut au moins 3."*
* the scope sentence directly beneath reads *"Votre historique s'étend sur 8
  mois civils, dont **6 mois complets** exploitables pour mesurer un rythme."*

Both say 6 for the ledger; the 2 is now visibly the essentials sample and
nothing else. At 375 the two paragraphs are consecutive — the tightest form of
the failure — and still agree.

`shots/final2a-runway-no-essential-category-1440-light.png` covers the zero
case, reached by clearing `is_essential` for that throwaway user only (nothing
in the app edits the flag yet; the flags were restored immediately after). The
panel reads *"Ce scénario n'a aucune dépense à mesurer : aucune catégorie n'est
marquée essentielle, et la longueur de l'historique n'y change rien."* — no
month count, so nothing on the screen to contradict — while the cell's own note
below still reads *"Aucune catégorie n'est marquée essentielle : le scénario
réduit ne repose sur rien."* The two are complementary rather than the same
sentence twice.

## Left alone, as instructed

The flow queries not filtered to the liquid account set while the balance is;
the budgets summary's two headline figures over different populations with no
scope sentence; `formatRatio`'s plain space before `%` where `formatCents` uses
U+00A0; the two general-purpose formatters living in component modules rather
than `design/theme.ts`; `budget_report`'s missing catch-and-forward for a
provably unreachable `ValueError`.

## Note for whoever picks this up next

`compute_runway`'s signature gained a required fifth parameter. It has exactly
one production caller (`api/cashflow.py`) and it was made required rather than
defaulted on purpose — a default would be a fallback value standing in for real
data, and the whole point of the parameter is that the engine must not guess
which of two causes it is looking at.
