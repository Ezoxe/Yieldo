# Yieldo Phase 2B — Décision : Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Answer « puis-je m'offrir cette voiture ? » with a figure and concrete levers — the purchase-feasibility engine of design §6.3 — and ship the three decision surfaces it stands on: credit/savings/property simulators, debt payoff schedules (boule de neige and avalanche), and savings goals with their progress.

**Architecture:** Unchanged layering — `models` (ORM) → `engines` (pure functions: no session, no network, no implicit clock) → `api` (routers that read the clock, fetch this user's rows, build the engines' input dataclasses, serialise the result) → `features` (screens). Two new shared money engines (`amortization.py`, `savings.py`) carry every loan and every compounding calculation in the phase, so a monthly payment is defined once. The feasibility engine composes them with phase 2A's `capacity.measure_savings_capacity` — the **measured** savings rate, never a declared one — and refuses wherever that input refuses.

**Tech Stack:** Python 3.12, FastAPI, SQLAlchemy 2.0, Alembic, Pydantic v2, pytest. React 19, TypeScript 5.7, Vite 6, Motion 11, ECharts 5, React Router 7, Vitest.

---

## Global Constraints

Copied verbatim from `CLAUDE.md`. Every task's requirements implicitly include this section.

- **Montants** : every monetary amount is an integer number of cents (`amount_cents: int`). Never a `float` on a monetary value, at any layer. Convert to `Decimal` only at the display boundary.
- **Dates** : `datetime.date` in the database, ISO-8601 (`YYYY-MM-DD`) in JSON.
- **Isolation** : every query on a business table filters on `user_id`, via the `get_current_user` dependency. No route reads across users.
- **Moteurs purs** : `backend/app/engines/` and `backend/app/importers/{dialect,mapping,parser,dedup}.py` are pure functions: no DB session, no network call, no implicit clock — "today" is always a parameter. The one explicit exception remains `backend/app/importers/service.py` and `backend/app/categorization/{seed,learning}.py`.
- **Aucun échec silencieux** : no bare `except: pass`. No fallback value standing in for real data. Errors surface to the user (in French) or propagate.
- **Langue** : user-facing text and error messages in French. Code, identifiers, comments and commit messages in English.
- **TDD** : write the failing test first.
- **Commits** : one commit per task, Conventional Commits format, English.
- **Couverture** : ≥80 % on `app/engines` and `app/importers`, measured with `backend/.venv/Scripts/pytest.exe -v --cov=app --cov-report=term-missing` from `backend/`.
- **Runtime** : Python 3.12+, Node 22+.
- **Couleurs Abysse** : accent `#7ee2d6`, positive `#4fd6a8`, info `#3b82f6`, warning `#f4a261`, negative `#e5606b`. Light and dark themes both required; every status/text colour pairing must hold WCAG AA (4.5:1) in both.

### The rule that governs every phase from 1.5 onward

**No task is done until it has been opened in a browser at 375 px, 768 px and 1440 px, in both themes, with the operator's real data volumes, and the screenshots are attached to the task report.**

Phase 1 shipped 435 passing tests and an interface the operator rejected on sight. Phase 1.5 verified its dashboard in a browser, in both themes, with screenshots — and still shipped a waterfall chart that drew a 2 209,63 € deficit as a bar rising *above* zero for two whole phases, plus a loading skeleton painted at 1.000:1 in the light theme. A passing Vitest suite proves a component mounted. It proves nothing about how it looks, whether a bar has non-zero width, whether a label is legible, or whether a number has the right sign on screen.

### The integer-cents rule and interest arithmetic — read this before Task 1

This phase computes amortisation schedules and compound growth, which are inherently fractional. The rule still holds without exception, and here is how:

- **Every value that crosses a function boundary, is stored, or is serialised is an `int` of cents.** No `float` ever touches a monetary value.
- **Interior arithmetic uses `decimal.Decimal`**, exact and base-10, quantised back to an integer with `ROUND_HALF_UP` at every step where a cent is produced. Precedent in this repo: `api/analysis.py:322` already does `int((point.value * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))` for exactly this reason.
- **A rate is never a float either.** Rates travel as integer basis points (`annual_rate_bps`: `350` means 3,50 %) and are converted to a `Decimal` monthly rate inside the engine. A rate is not money, but a float rate multiplied into a cents value would smuggle a float into the result.
- Every engine in this phase that produces a schedule must satisfy an invariant test: **the sum of the principal components equals the borrowed capital, to the cent**, and **total paid = capital + total interest, to the cent**. Rounding residue is absorbed by the final payment, never left dangling.

### Six failure modes that have each already cost this project a fix round

Seventeen of phase 2A's nineteen tasks needed a fix round, and **not one of those fixes came from a red test**. They came from reviewers redoing arithmetic by hand, tracing behaviour into installed library source, or opening a browser. Do not rediscover these.

1. **A French sentence naming the wrong cause.** Fixed in phase 2A tasks 10, 11, 14, 17 and 18: a refusal blaming a month count when the real cause was a degenerate scale; a screen asserting a measured rate beside two "Non mesurable" panels; a banner claiming a projection exists above a panel that refused. **Distinct causes need distinct, mutually exclusive messages, each true on the branch that emits it.** Every refusal in this plan carries its own named `_reason_*` function.
2. **A comment or field docstring stating *when* a value appears is part of the contract.** Phase 2A task 11 left three explanations untrue across three rounds while its logic held under mutation testing every round. A comment saying when a value appears deserves the same "does a test still prove this?" pass as the code.
3. **A test that passes for the wrong reason.** Task 15's divide-by-zero test never reached the guard it named. Task 16's ordering test was single-category where the metric is monotonic. Task 17's overlap defect escaped because the shared fixture held one week of data and was too small to express it. **Fixtures of identical values cannot tell a median from a mean.** Every test in this plan that claims to exercise a guard must be mutation-checked: comment the guard out, watch the test go red, restore.
4. **Three browser traps.** A stylesheet `transform` is silently overridden by Motion's inline `transform: none` — use the independent `translate` / `scale` / `rotate` properties. A `transition` prop on an element carrying `variants` is never consulted — timing goes inside the variant. Percentage widths inside an auto-width flex column resolve to zero — any bar or track sized in percent needs a container with a definite inline size.
5. **ECharts stacking.** A stacked value is chained onto the previous series only when both share the same sign (`stackStrategy: "samesign"` is the default; `dataStack.js:87,115-118`). An invisible-floor / visible-height band or cascade therefore collapses to zero wherever the running value goes negative (`layout/barGrid.js:398-399` computes `stackStartValue = stackResult - rawValue`). **Both charts in this codebase that used the technique shipped broken.** Any new chart that stacks anything sets `stackStrategy: "all"` on every stacked series. This phase's amortisation chart and debt-payoff chart both stack.
6. **The auto-extracted task briefs were wrong in twelve consecutive tasks** — a test file raising `TypeError` at collection, a fixture whose assertion was arithmetically impossible, a formula producing the opposite sign from its own test's assertion, a router teaching a defect the project had already closed, and a running backend serving no such endpoint at all. **Every implementer must verify their brief against the shipped code before writing anything, and report any discrepancy in the task report rather than silently working around it.** Every arithmetic result asserted in this plan was produced by running the reference implementation; if your code disagrees with a number here, one of the two is wrong and you must find out which before proceeding.

### Environment facts the implementer needs

- Branch cut from the end of phase 2A (`4311cc1`). Backend **522** tests, frontend **632**, both green, `npm run build` clean. Both suites stay green at every task.
- **`npm run lint` has never worked** — `eslint` is not installed and `package.json` still declares the script. Recorded, not fixed in this phase. Do not add it to any verification step.
- Verification fixture: `.superpowers/sdd/2026-08-12-yieldo-phase-1-5-interface/seed_fixture.py`. Run from `backend/` with `.venv/Scripts/python.exe ../.superpowers/sdd/2026-08-12-yieldo-phase-1-5-interface/seed_fixture.py`. It rebuilds `backend/data/yieldo.db` with the operator's real volumes: **197 transactions, 2025-01-24 → 2026-01-09, 1 account, 69 categories with 19 in use, 1 import batch**. Login `demo@yieldo-demo.fr` / `MotDePasseDemo123!`.
- Months present: 2025-01 (13 rows, partial), 2025-02 (61), 2025-03 (20), 2025-12 (77), 2026-01 (26, partial). **April to November 2025 are empty and are not counted as zero-spend months.** Three complete observed months. 179 debits, 18 credits.
- Today is **2026-08-12** in that fixture's world.
- **Dev servers must be started detached** (`Start-Process`) or they die with the shell that spawned them.
- **Before trusting any API output, check that no orphaned `uvicorn --reload` worker is holding port 8000:** `Get-NetTCPConnection -LocalPort 8000`. A stale worker serving pre-fix code cost this project two separate rounds, most recently in phase 2A task 18 where the running backend served no `/api/analysis/*` at all.

### The operator's measured numbers — verify against these, do not "fix" them

Every figure below was produced by running phase 2A's shipped engines against the seeded fixture. They are the primary case this phase must answer honestly, not an edge case.

| Quantity | Source | Value |
|---|---|---|
| Complete observed months | `capacity.complete_months` | **3** (2025-02, 2025-03, 2025-12) |
| Monthly net, per month | — | 2025-02 −218 338 c · 2025-03 −74 619 c · 2025-12 +71 550 c |
| **Measured savings capacity** | `capacity.measure_savings_capacity` | **median −74 619 c**, spread 213 078 c, band **[−347 690 c, +198 452 c]**, over 3 months |
| Measured expense rate | `capacity.measure_expense_rate` | median 265 449 c, band [−18 360 c, 549 258 c] |
| Measured income rate (new, Task 11) | `capacity.measure_income_rate` | median **47 111 c**, over 3 months |
| Liquid balance | `api.common.liquid_balance_cents` | **−220 963 c** (−2 209,63 €) |

**The operator's measured savings capacity is negative and his liquid balance is negative.** `measure_savings_capacity` returns `None` below three observed months; he has exactly three, so it returns a figure — a negative one. The feasibility engine must therefore answer honestly on a household that cannot currently afford anything, and must refuse where its input refuses. Expected outcome for a 40 000 € car in twelve months with no down payment, all hand-verified:

| Output | Value | Why |
|---|---|---|
| `saved_at_horizon_cents` (median) | **−895 428 c** | twelve months of a −746,19 €/month rate; no interest accrues on a negative pot |
| `saved_at_horizon_low_cents` | −4 172 280 c | the band's low end |
| `saved_at_horizon_high_cents` | +2 414 442 c | **still short of 4 000 000 c** — even the optimistic band fails |
| `verdict` | `out_of_reach` | the median does not reach the target |
| `gap_cents` | **4 895 428 c** | larger than the target itself, because the pot shrinks |
| `save_more` lever | required 328 775 c/month → **extra 403 394 c/month** | measured capacity is negative, so the "effort" is first to return to positive |
| `delay` lever | **infeasible** | `months_to_target` is `None` at a non-positive rate; no delay ever reaches it |
| `reduce_target` lever | **infeasible** | the reachable amount is negative; no target is reachable |
| `borrow` lever | 4 895 428 c over 60 months at 5,00 % → 92 383 c/month, 647 532 c of interest, **debt ratio 19 610 bps** | 196 % of a 471,11 €/month measured income — far past the 3 500 bps threshold |
| Runway impact | already exhausted before *and* after | the balance is already below zero |

None of the above is a bug. Every screen in this phase must render it as the truthful answer it is.

### Scope

This plan covers exactly four things, and nothing else: the **moteur de faisabilité d'achat** (design §6.3, in full), the **simulateurs crédit, épargne et immobilier**, **dettes** with snowball and avalanche schedules, and **objectifs** with their progress. Each gets its engine, its API surface and its screen.

**Phase 2C** — engagement mechanics: streak de suivi, jalons, santé financière évolutive, défis dérivés des données — is a separate plan and is not planned here. What 2C will consume from this one is named in the Interfaces blocks, chiefly `engines/goal.Milestone` (design §6.2: "étapes intermédiaires automatiques (25 %, 50 %, 75 %) sur chaque objectif d'épargne, avec la date projetée d'atteinte"), which is built here in Task 7 with exactly that shape.

### Deliberate deviations from the design spec, with reasons

- **§6.3 item 7 ships two of its three components.** "Impact simulé sur le fonds d'urgence, le patrimoine net à horizon cinq ans, et le score de santé financière." The emergency-fund impact is built (Task 11) from the measured expense rate, and a five-year liquid-savings trajectory stands in for the net-worth line. **The financial health score is not computed**: no health-score engine exists in this codebase, §6.1 lists it among the engines carried over from FinVest and not yet ported, and phase 2C owns "santé financière évolutive". **Net worth proper is phase 3** ("Patrimoine et marchés"). The screen states both absences in French rather than rendering a blank panel or a zero.
- **Levers are not ranked by a single synthetic score.** §6.3 item 5 says "leviers chiffrés et classés". The five levers are incommensurable — euros per month, months of delay, euros of target, a debt ratio — and reducing them to one number means dividing by a quantity the data controls, which is the exact failure phase 2A task 16 ruled against after two rejected metrics. **Delivered ordering: feasible levers first, then a fixed documented order** (save more, delay, reduce target, borrow, cut a category), each carrying its own figure and its own French reason when infeasible.
- **A saved scenario stores its inputs, never its computed figures**, and is recomputed on every read. Storing the result would show a verdict measured against last winter's ledger as if it were current — the same staleness trap `api/cashflow.py` documents for its clock.
- **LOA is compared on cash figures only, never on end wealth.** Whether the lessee owns anything at the end depends on a choice the contract leaves open, and the terms come from a dealer's quote. Yieldo never invents a French average for a specific contract: with no LOA terms supplied, the panel says so.
- **The property simulator's rent comparison is capped at the loan term.** Past the last instalment the buyer's monthly effort drops and the comparison changes shape; extending it would need a second regime. The cap is stated in French on screen.

---

## File Structure

**Backend** — `backend/app/`

| File | Responsibility |
|---|---|
| `engines/amortization.py` | **new** — monthly payment, full amortisation schedule, total interest, debt ratio in basis points. Every loan in the phase goes through it |
| `engines/savings.py` | **new** — monthly-compounded projection with contributions (which may be negative), the contribution required to hit a target, months to a target, opportunity cost |
| `engines/debt.py` | **new** — snowball and avalanche payoff plans over a constant monthly budget, with two distinct refusals |
| `engines/goal.py` | **new** — goal progress, 25/50/75/100 milestones with projected dates, sequential funding by priority. **Phase 2C consumes `Milestone`** |
| `engines/ownership.py` | **new** — total cost of ownership over N years, French default cost items, declining-balance depreciation |
| `engines/feasibility.py` | **new** — §6.3 items 1, 2, 4 and 7: measured capacity in, verdict + gap + opportunity cost + impact out |
| `engines/levers.py` | **new** — §6.3 items 5 and 6: the five levers, and cash vs credit vs LOA with the break-even loan rate |
| `engines/property.py` | **new** — notary fees, borrowed amount, monthly effort, debt ratio, and a rent-versus-buy wealth comparison |
| `engines/capacity.py` | modified — adds `measure_income_rate` (Task 11) |
| `engines/runway.py` | modified — extracts `months_of_runway` so feasibility and runway cannot drift (Task 11) |
| `models/debt.py`, `models/goal.py`, `models/scenario.py` | **new** — the phase's three tables |
| `alembic/versions/<rev>_debts_goals_scenarios.py` | **new** — one migration for all three |
| `api/debts.py`, `api/goals.py`, `api/feasibility.py`, `api/simulators.py` | **new** — four routers |
| `schemas/debts.py`, `schemas/goals.py`, `schemas/feasibility.py`, `schemas/simulators.py` | **new** — Pydantic wire shapes |
| `api/errors.py` | modified — `FIELD_SUBJECTS` entries for the phase's new fields |
| `main.py` | modified — four new routers |

**Frontend** — `frontend/src/`

| File | Responsibility |
|---|---|
| `features/debts/DebtsPage.tsx` + `.css` | Dettes: the list, the two strategies side by side, what avalanche saves |
| `features/debts/DebtForm.tsx` | Add / edit one debt |
| `features/goals/GoalsPage.tsx` + `.css` | Objectifs: progress, milestones, projected dates, sequential funding note |
| `features/goals/GoalForm.tsx` | Add / edit one goal |
| `features/feasibility/FeasibilityPage.tsx` + `.css` | Faisabilité: the question form, the verdict, the measured capacity |
| `features/feasibility/VerdictPanel.tsx` | The verdict, the gap, the band |
| `features/feasibility/LeverList.tsx` | The five levers, feasible first |
| `features/feasibility/FinancingPanel.tsx` | Comptant / crédit / LOA and the break-even rate |
| `features/feasibility/ScenarioBar.tsx` | Save, list and compare saved scenarios |
| `features/simulators/SimulatorsPage.tsx` + `.css` | Simulateurs: credit and savings |
| `features/simulators/PropertySimulator.tsx` | Simulateurs: immobilier and the rent comparison |
| `charts/AmortizationChart.tsx` | Stacked interest / principal per year — `stackStrategy: "all"` |
| `charts/DebtPayoffChart.tsx` | Stacked remaining balance per debt over time — `stackStrategy: "all"` |
| `lib/types.ts` | modified — mirror types for the four new payload families |
| `app/routes.tsx`, `app/AppShell.tsx` | modified — four new routes and four new nav entries |

---

## Task Order

| Lot | Tasks | Deliverable |
|---|---|---|
| **A — money substrate** | 1–2 | `amortization.py`, `savings.py` |
| **B — dettes** | 3–6 | schema for the whole phase, `debt.py`, `/api/debts`, `/dettes` |
| **C — objectifs** | 7–9 | `goal.py`, `/api/goals`, `/objectifs` |
| **D — faisabilité** | 10–16 | `ownership.py`, `feasibility.py`, `levers.py`, `/api/feasibility`, scenarios, `/faisabilite` |
| **E — simulateurs** | 17–20 | `property.py`, `/api/simulators`, `/simulateurs` |
| **F — vérification** | 21 | phase-wide browser, contrast, chart and isolation pass |

---
# Lot A — The money substrate

Every loan figure and every compounding figure in this phase comes from these two modules. Written once, in integer cents, so a monthly payment quoted on the Simulateurs screen, inside a feasibility lever and inside the property simulator is the same number computed the same way.

### Task 1: Amortisation — payment, schedule, total interest, debt ratio

A constant-payment (French *amortissable*) loan. Three consumers depend on it: the `borrow` lever of §6.3 item 5, the credit simulator, and the property simulator.

**Files:**
- Create: `backend/app/engines/amortization.py`
- Test: `backend/tests/test_amortization.py`

**Interfaces:**
- Consumes: nothing. Pure; standard library only (`dataclasses`, `decimal`).
- Produces:
  - `ScheduleRow` frozen dataclass: `month: int`, `payment_cents: int`, `interest_cents: int`, `principal_cents: int`, `remaining_cents: int`.
  - `LoanSchedule` frozen dataclass: `principal_cents: int`, `annual_rate_bps: int`, `months: int`, `monthly_payment_cents: int`, `total_paid_cents: int`, `total_interest_cents: int`, `rows: list[ScheduleRow]`.
  - `monthly_rate(annual_rate_bps: int) -> Decimal`
  - `monthly_payment_cents(principal_cents: int, annual_rate_bps: int, months: int) -> int`
  - `build_schedule(principal_cents: int, annual_rate_bps: int, months: int) -> LoanSchedule`
  - `debt_ratio_bps(monthly_payments_cents: int, monthly_income_cents: int | None) -> int | None`
  - `cents(value: Decimal) -> int` — the one rounding helper, `ROUND_HALF_UP`.
  - Constants `HCSF_DEBT_RATIO_BPS = 3500`, `MAX_LOAN_MONTHS = 480`.
  - Consumed by Tasks 4 (debt payoff), 12 (levers, financing), 17 (property), 18 (simulators API).

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_amortization.py`:

```python
from decimal import Decimal

import pytest

from app.engines.amortization import (
    HCSF_DEBT_RATIO_BPS,
    build_schedule,
    cents,
    debt_ratio_bps,
    monthly_payment_cents,
    monthly_rate,
)


def test_monthly_rate_is_an_exact_decimal_never_a_float():
    """A float rate multiplied into a cents value smuggles a float into money.
    350 bps is 3,50 %/an, so 0,0029166... per month -- exact in Decimal."""
    rate = monthly_rate(1200)
    assert isinstance(rate, Decimal)
    assert rate == Decimal("0.01")


def test_a_zero_rate_loan_divides_the_capital_evenly():
    assert monthly_payment_cents(120_000, 0, 12) == 10_000


def test_an_indivisible_capital_leaves_its_residue_on_the_last_instalment():
    """100 000 c over 3 months at 0 % is 33 333,33 c. The level payment rounds
    half up to 33 333 and the final instalment carries the residue, so the
    capital is repaid to the cent and never one cent short."""
    assert monthly_payment_cents(100_000, 0, 3) == 33_333
    schedule = build_schedule(100_000, 0, 3)
    assert [row.payment_cents for row in schedule.rows] == [33_333, 33_333, 33_334]
    assert schedule.rows[-1].remaining_cents == 0


def test_a_one_month_loan_repays_capital_plus_one_month_of_interest():
    """The formula's simplest closed case: P*i/(1-(1+i)^-1) = P*(1+i)."""
    assert monthly_payment_cents(100_000, 1200, 1) == 101_000


def test_the_payment_matches_the_hand_computed_annuity():
    """100 000 c at 12 %/an over 2 months: 1000 * 1.0201 / 0.0201 = 50 751,24 c,
    which rounds half up to 50 751."""
    assert monthly_payment_cents(100_000, 1200, 2) == 50_751


def test_a_real_mortgage_matches_the_published_figure():
    """100 000 EUR over 20 years at 3,00 % is 554,60 EUR/month and 33 103,24 EUR
    of interest -- the standard reference figure for this loan."""
    schedule = build_schedule(10_000_000, 300, 240)
    assert schedule.monthly_payment_cents == 55_460
    assert schedule.total_interest_cents == 3_310_324
    assert schedule.total_paid_cents == 13_310_324


def test_the_schedule_is_exact_to_the_cent():
    """The invariant the integer-cents rule exists for: principal repaid sums to
    the capital, and total paid is capital plus interest. No residue anywhere."""
    schedule = build_schedule(100_000, 1200, 3)
    assert sum(row.principal_cents for row in schedule.rows) == 100_000
    assert sum(row.interest_cents for row in schedule.rows) == schedule.total_interest_cents
    assert schedule.total_paid_cents == 100_000 + schedule.total_interest_cents
    assert schedule.rows[-1].remaining_cents == 0


def test_the_last_payment_absorbs_the_rounding_residue():
    """Rounding each month's interest leaves a residue the level payment cannot
    clear. It is absorbed by the final instalment -- never left as a remaining
    balance of one cent, and never smeared silently across the schedule.

    Hand-computed at 100 000 c, 12 %/an, 3 months, payment 34 002:
      m1 interest 1 000, principal 33 002, remaining 66 998
      m2 interest   670, principal 33 332, remaining 33 666
      m3 interest   337, principal 33 666, remaining      0  <- payment 34 003
    """
    schedule = build_schedule(100_000, 1200, 3)
    assert [row.payment_cents for row in schedule.rows] == [34_002, 34_002, 34_003]
    assert [row.interest_cents for row in schedule.rows] == [1_000, 670, 337]
    assert [row.remaining_cents for row in schedule.rows] == [66_998, 33_666, 0]
    assert schedule.total_interest_cents == 2_007


def test_a_zero_rate_schedule_carries_no_interest_at_all():
    schedule = build_schedule(120_000, 0, 12)
    assert schedule.total_interest_cents == 0
    assert all(row.interest_cents == 0 for row in schedule.rows)
    assert schedule.rows[-1].remaining_cents == 0


def test_borrowing_nothing_produces_an_empty_schedule_not_a_crash():
    """A property bought outright borrows zero. That is a real answer, not an
    error -- but it must not pretend to be a loan with rows in it."""
    schedule = build_schedule(0, 300, 240)
    assert schedule.monthly_payment_cents == 0
    assert schedule.rows == []
    assert schedule.total_interest_cents == 0
    assert schedule.months == 240


def test_invalid_inputs_raise_in_french_rather_than_returning_zero():
    with pytest.raises(ValueError, match="négatif"):
        build_schedule(-1, 300, 12)
    with pytest.raises(ValueError, match="durée"):
        build_schedule(100_000, 300, 0)
    with pytest.raises(ValueError, match="durée"):
        build_schedule(100_000, 300, 481)
    with pytest.raises(ValueError, match="taux"):
        build_schedule(100_000, -1, 12)


def test_debt_ratio_is_reported_in_basis_points():
    """900 EUR of instalments against 2 500 EUR of income is 36,00 %."""
    assert debt_ratio_bps(90_000, 250_000) == 3600
    assert debt_ratio_bps(87_500, 250_000) == HCSF_DEBT_RATIO_BPS


def test_debt_ratio_is_none_without_a_measurable_income():
    """No income measured is not a ratio of zero. A zero here would render as
    "0 % d'endettement" on a household whose income could not be measured at
    all -- a fallback value standing in for real data."""
    assert debt_ratio_bps(90_000, None) is None
    assert debt_ratio_bps(90_000, 0) is None
    assert debt_ratio_bps(90_000, -100) is None


def test_cents_rounds_half_away_from_zero_on_both_signs():
    assert cents(Decimal("0.5")) == 1
    assert cents(Decimal("-0.5")) == -1
    assert cents(Decimal("2.4")) == 2
```

- [ ] **Step 2: Run the test to verify it fails**

Run from `backend/`: `.venv/Scripts/pytest.exe tests/test_amortization.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.engines.amortization'`

- [ ] **Step 3: Write the implementation**

Create `backend/app/engines/amortization.py`:

```python
"""Constant-payment loans, in integer cents.

Every loan figure in Yieldo comes from here: the "emprunter Z EUR" lever of the
purchase-feasibility engine (design §6.3 item 5), the credit simulator and the
property simulator. Written once so the same loan quoted on three screens is
the same number.

**Fractional arithmetic without a float on a monetary value.** An annuity needs
powers and divisions that integers cannot express. Every interior computation
here runs in `decimal.Decimal` -- exact, base-10, no binary representation error
-- and is quantised back to an integer number of cents with `ROUND_HALF_UP` the
moment a cent is produced. Nothing crosses a function boundary as a float, and
a rate is an integer number of basis points, not a float, for the same reason:
a float rate multiplied into a cents value would smuggle a float into money.

**The rounding residue is absorbed by the final instalment.** Rounding each
month's interest to the cent leaves the level payment unable to clear the
capital exactly. The alternative -- leaving one cent outstanding, or silently
smearing the difference -- would break the invariant every consumer relies on:
the principal components sum to the capital borrowed, and total paid equals
capital plus interest, to the cent. `test_the_schedule_is_exact_to_the_cent`
pins it.

Pure: no session, no network, no clock.
"""

from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal

# The HCSF (Haut Conseil de stabilité financière) ceiling on a French
# household's debt-service ratio, in basis points: 35,00 %. Design §6.3 item 5
# names it explicitly ("alerte si le seuil de 35 % est franchi"). It is a
# published regulatory threshold, not a tuned constant.
HCSF_DEBT_RATIO_BPS = 3500

# Forty years. Past this a French bank does not lend, and a schedule that long
# is a table nobody reads. The bound exists so a mistyped horizon surfaces as a
# French error rather than as a 100 000-row response.
MAX_LOAN_MONTHS = 480

_BPS = Decimal(10_000)
_MONTHS_PER_YEAR = Decimal(12)
_ONE_CENT = Decimal(1)


def cents(value: Decimal) -> int:
    """A Decimal amount, rounded half away from zero, as an integer of cents.

    `ROUND_HALF_UP` in Python's `decimal` means *half away from zero*, so a
    negative half rounds to the larger magnitude too. Symmetry matters here for
    the same reason it does in `robust._half`: rounding expenses one way and
    incomes the other is a silent, directional bias on money.
    """
    return int(value.quantize(_ONE_CENT, rounding=ROUND_HALF_UP))


def monthly_rate(annual_rate_bps: int) -> Decimal:
    """The nominal annual rate, in basis points, as an exact monthly Decimal.

    Proportional division by twelve (taux nominal / 12), which is how a French
    *taux débiteur* is applied to a monthly instalment -- not the twelfth root
    of the annual factor, which would be an actuarial rate and would disagree
    with every bank's own amortisation table.
    """
    return Decimal(annual_rate_bps) / _BPS / _MONTHS_PER_YEAR


def _validate(principal_cents: int, annual_rate_bps: int, months: int) -> None:
    if principal_cents < 0:
        raise ValueError("Le capital emprunté ne peut pas être négatif.")
    if annual_rate_bps < 0:
        raise ValueError("Le taux d'un crédit ne peut pas être négatif.")
    if not 1 <= months <= MAX_LOAN_MONTHS:
        raise ValueError(
            f"La durée d'un crédit doit être comprise entre 1 et {MAX_LOAN_MONTHS} mois."
        )


def monthly_payment_cents(principal_cents: int, annual_rate_bps: int, months: int) -> int:
    """The level instalment: P * i / (1 - (1+i)^-n), rounded half up to the cent.

    Half up on BOTH branches -- the zero-rate one included -- so there is one
    rounding rule in this module rather than two that disagree. The residue
    this leaves, in either direction, lands on the final instalment, which
    `build_schedule` resizes: the last payment is therefore routinely a cent or
    two away from this figure, and that is where the schedule's exactness comes
    from. Callers printing "mensualité" print this number; callers printing a
    schedule print each row's own `payment_cents`.
    """
    _validate(principal_cents, annual_rate_bps, months)
    if principal_cents == 0:
        return 0
    rate = monthly_rate(annual_rate_bps)
    if rate == 0:
        return cents(Decimal(principal_cents) / Decimal(months))
    factor = (Decimal(1) + rate) ** months
    exact = Decimal(principal_cents) * rate * factor / (factor - Decimal(1))
    return cents(exact)


@dataclass(frozen=True)
class ScheduleRow:
    # 1-based: month 1 is the first instalment, not the day the loan is signed.
    month: int
    payment_cents: int
    interest_cents: int
    principal_cents: int
    # Capital still owed AFTER this instalment. 0 on the last row, always.
    remaining_cents: int


@dataclass(frozen=True)
class LoanSchedule:
    principal_cents: int
    annual_rate_bps: int
    # The stated term. `rows` is empty when nothing was borrowed, but `months`
    # still reports what was asked for -- a caller printing "sur 240 mois"
    # beside a zero loan must not read 0 here.
    months: int
    monthly_payment_cents: int
    total_paid_cents: int
    total_interest_cents: int
    # Empty exactly when `principal_cents == 0`. Never truncated: a caller that
    # wants a yearly view aggregates these itself.
    rows: list[ScheduleRow]


def build_schedule(principal_cents: int, annual_rate_bps: int, months: int) -> LoanSchedule:
    """The full amortisation table, exact to the cent.

    Borrowing nothing returns an empty schedule rather than raising: a property
    bought outright, or a feasibility gap already covered, is a real answer.
    Every other invalid input raises in French -- there is no zero standing in
    for a capital that could not be computed.
    """
    _validate(principal_cents, annual_rate_bps, months)
    payment = monthly_payment_cents(principal_cents, annual_rate_bps, months)
    if principal_cents == 0:
        return LoanSchedule(
            principal_cents=0, annual_rate_bps=annual_rate_bps, months=months,
            monthly_payment_cents=0, total_paid_cents=0, total_interest_cents=0, rows=[],
        )

    rate = monthly_rate(annual_rate_bps)
    remaining = principal_cents
    rows: list[ScheduleRow] = []
    total_interest = 0
    total_paid = 0

    for month in range(1, months + 1):
        interest = cents(Decimal(remaining) * rate)
        principal = payment - interest
        # Two ways the level payment stops being right, both handled the same
        # way -- the instalment is resized so `remaining` lands exactly on zero:
        # the final month (where the rounding residue lives), and any month
        # where the level payment would overshoot what is left.
        if month == months or principal > remaining:
            principal = remaining
        this_payment = principal + interest
        remaining -= principal
        total_interest += interest
        total_paid += this_payment
        rows.append(ScheduleRow(
            month=month, payment_cents=this_payment, interest_cents=interest,
            principal_cents=principal, remaining_cents=remaining,
        ))
        if remaining == 0 and month < months:
            # Repaid early because the level payment overshot. Stop rather than
            # emitting zero-value rows a chart would draw as a flat tail.
            break

    return LoanSchedule(
        principal_cents=principal_cents, annual_rate_bps=annual_rate_bps, months=months,
        monthly_payment_cents=payment, total_paid_cents=total_paid,
        total_interest_cents=total_interest, rows=rows,
    )


def debt_ratio_bps(monthly_payments_cents: int, monthly_income_cents: int | None) -> int | None:
    """Taux d'endettement, in basis points. `None` when income is unmeasurable.

    `None`, never 0: a household whose income could not be measured has no debt
    ratio, and a zero here would render as "0 % d'endettement" — a fallback
    value standing in for real data, which the no-silent-failures rule forbids.
    Callers get `None` and must say so on screen.

    Compare against `HCSF_DEBT_RATIO_BPS` to decide whether the 35 % threshold
    design §6.3 item 5 names has been crossed.
    """
    if monthly_income_cents is None or monthly_income_cents <= 0:
        return None
    return int(
        (Decimal(monthly_payments_cents) * _BPS / Decimal(monthly_income_cents))
        .quantize(_ONE_CENT, rounding=ROUND_HALF_UP)
    )
```

- [ ] **Step 4: Run the test to verify it passes**

Run from `backend/`: `.venv/Scripts/pytest.exe tests/test_amortization.py -v`
Expected: PASS, 14 tests.

- [ ] **Step 5: Mutation-check the two guards this module exists for**

Not optional, and not a matter of coverage. Phase 2A shipped a divide-by-zero test that never reached the guard it named. Apply each mutation alone, against a restored file:

1. In `build_schedule`, delete the `or principal > remaining` clause. Expected: `test_the_last_payment_absorbs_the_rounding_residue` still passes (the final month is handled by the other half), but the invariant test on a short overshoot does not exist yet — **add** `test_an_overshooting_level_payment_does_not_go_past_zero` using `build_schedule(100_000, 0, 12)` after temporarily forcing `payment` high, or simpler: assert `build_schedule(100_000, 1200, 2).rows[-1].remaining_cents == 0` and check no row carries a negative `remaining_cents`. Restore.
2. In `debt_ratio_bps`, change `<= 0` to `< 0`. Expected: `test_debt_ratio_is_none_without_a_measurable_income` goes red on the zero-income case (ZeroDivisionError). Restore.
3. In `monthly_payment_cents`, change the zero-rate branch to `principal_cents // months` (floor). Expected: `test_a_zero_rate_loan_divides_the_capital_evenly` still passes — 120 000 / 12 divides exactly, so that test cannot see the difference — while `test_an_indivisible_capital_leaves_its_residue_on_the_last_instalment` goes red. This is the pair phase 2A's "a fixture too small to express the defect" lesson is about: keep both tests. Restore.

Record the three results in the task report.

- [ ] **Step 6: Run the full backend suite**

Run from `backend/`: `.venv/Scripts/pytest.exe -q`
Expected: 522 + 14 = **536** passed. If the number differs, count your own tests before assuming the baseline moved — phase 2A's briefs predicted the wrong total more than once.

- [ ] **Step 7: Commit**

```bash
git add backend/app/engines/amortization.py backend/tests/test_amortization.py
git commit -m "feat(engines): amortise a constant-payment loan exactly to the cent"
```

---

### Task 2: Savings — compound projection, required contribution, time to target

The other half of the substrate. Everything that grows or shrinks over months goes through it: the feasibility horizon, the opportunity cost of §6.3 item 4, the savings simulator, the goal projections, the renter's pot in the property comparison, and the wealth comparison of §6.3 item 6.

**Files:**
- Create: `backend/app/engines/savings.py`
- Test: `backend/tests/test_savings.py`

**Interfaces:**
- Consumes: `app.engines.amortization.cents` (the single rounding helper).
- Produces:
  - `SavingsPoint` frozen dataclass: `month: int`, `contributed_cents: int`, `interest_cents: int`, `balance_cents: int` (the first two cumulative).
  - `SavingsProjection` frozen dataclass: `initial_cents`, `monthly_cents`, `annual_rate_bps`, `months`, `final_cents`, `contributed_cents`, `interest_cents`, `points: list[SavingsPoint]`.
  - `project_savings(initial_cents: int, monthly_cents: int, annual_rate_bps: int, months: int) -> SavingsProjection`
  - `required_monthly_cents(target_cents: int, initial_cents: int, annual_rate_bps: int, months: int) -> int`
  - `months_to_target(target_cents: int, initial_cents: int, monthly_cents: int, annual_rate_bps: int) -> int | None`
  - `opportunity_cost_cents(amount_cents: int, annual_rate_bps: int, months: int) -> int`
  - Constants `DEFAULT_ANNUAL_RETURN_BPS = 300`, `MAX_PROJECTION_MONTHS = 600`.
  - Consumed by Tasks 7 (goals), 11 (feasibility), 12 (levers, financing), 17 (property), 18 (simulators API).

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_savings.py`:

```python
import pytest

from app.engines.savings import (
    MAX_PROJECTION_MONTHS,
    months_to_target,
    opportunity_cost_cents,
    project_savings,
    required_monthly_cents,
)


def test_a_zero_rate_projection_is_the_contributions_and_nothing_else():
    projection = project_savings(100_000, 50_000, 0, 12)
    assert projection.final_cents == 700_000
    assert projection.contributed_cents == 600_000
    assert projection.interest_cents == 0


def test_interest_compounds_monthly_on_the_running_balance():
    """100 000 c at 12 %/an, no contribution: 1 000 c then 1 010 c."""
    projection = project_savings(100_000, 0, 1200, 2)
    assert [point.balance_cents for point in projection.points] == [101_000, 102_010]
    assert projection.interest_cents == 2_010
    assert projection.final_cents == 102_010


def test_a_contribution_earns_nothing_in_the_month_it_is_made():
    """End-of-month contributions (annuité de fin de période). Month 1 earns no
    interest on a zero opening balance, and the first contribution starts
    earning in month 2. 0 / 100 000 c per month / 12 %/an over three months:
    100 000, then 201 000, then 303 010."""
    projection = project_savings(0, 100_000, 1200, 3)
    assert [point.balance_cents for point in projection.points] == [100_000, 201_000, 303_010]
    assert projection.contributed_cents == 300_000
    assert projection.interest_cents == 3_010


def test_a_negative_balance_earns_no_interest():
    """A savings pot that has gone negative is an overdraft, not an investment.
    Crediting it a return would manufacture money out of a debt -- and this is
    not a hypothetical branch: the operator's measured savings capacity is
    -74 619 c/month and his liquid balance is -220 963 c, so every feasibility
    projection run on his real data lives here."""
    projection = project_savings(0, -100_000, 1200, 3)
    assert projection.final_cents == -300_000
    assert projection.interest_cents == 0


def test_a_negative_contribution_draws_the_pot_down_without_clamping():
    """Withdrawals are how the credit-versus-cash comparison is modelled, and
    how a negative measured capacity is projected. Nothing is floored at zero:
    a pot that runs out keeps going negative, which is the honest answer."""
    projection = project_savings(250_000, -100_000, 0, 3)
    assert [point.balance_cents for point in projection.points] == [150_000, 50_000, -50_000]


def test_the_operators_own_case_projects_to_the_hand_verified_figure():
    """Twelve months of the operator's measured capacity from a zero pot. The
    savings capacity is negative, so the pot shrinks and no interest accrues.
    This exact number is asserted again by the feasibility engine's test."""
    assert project_savings(0, -74_619, 300, 12).final_cents == -895_428


def test_required_monthly_is_the_smallest_contribution_that_reaches_the_target():
    """Exact boundary, not an approximation: one cent less falls short."""
    required = required_monthly_cents(4_000_000, 0, 300, 12)
    assert required == 328_775
    assert project_savings(0, required, 300, 12).final_cents >= 4_000_000
    assert project_savings(0, required - 1, 300, 12).final_cents < 4_000_000


def test_required_monthly_is_zero_when_the_target_is_already_covered():
    """Not a negative contribution, and not an error: nothing more is needed."""
    assert required_monthly_cents(100_000, 200_000, 300, 12) == 0


def test_months_to_target_counts_whole_months():
    assert months_to_target(700_000, 100_000, 50_000, 0) == 12
    assert months_to_target(100_000, 100_000, 50_000, 0) == 0


def test_months_to_target_refuses_when_the_pot_can_never_grow():
    """The operator's branch again. A non-positive capacity on a non-positive
    balance never reaches anything, and returning a large number here would put
    a date on screen that will never arrive. None, never a sentinel integer."""
    assert months_to_target(4_000_000, 0, -74_619, 300) is None
    assert months_to_target(4_000_000, 0, 0, 300) is None


def test_months_to_target_refuses_past_the_fifty_year_bound():
    assert months_to_target(100_000_000, 0, 1, 0) is None


def test_opportunity_cost_is_the_forgone_gain_not_the_final_value():
    """Design §6.3 item 4: "ce que la somme aurait produit". The gain, not the
    amount plus the gain -- printing the latter under "coût d'opportunité"
    would overstate it by the whole purchase price."""
    assert opportunity_cost_cents(100_000, 1200, 2) == 2_010


def test_opportunity_cost_of_nothing_is_nothing():
    assert opportunity_cost_cents(0, 300, 60) == 0
    assert opportunity_cost_cents(-500, 300, 60) == 0


def test_invalid_inputs_raise_in_french():
    with pytest.raises(ValueError, match="durée"):
        project_savings(0, 1000, 300, 0)
    with pytest.raises(ValueError, match="durée"):
        project_savings(0, 1000, 300, MAX_PROJECTION_MONTHS + 1)
    with pytest.raises(ValueError, match="rendement"):
        project_savings(0, 1000, -1, 12)
```

- [ ] **Step 2: Run the test to verify it fails**

Run from `backend/`: `.venv/Scripts/pytest.exe tests/test_savings.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.engines.savings'`

- [ ] **Step 3: Write the implementation**

Create `backend/app/engines/savings.py`:

```python
"""What a savings plan becomes, month by month, in integer cents.

Consumed by the purchase-feasibility horizon, the opportunity cost of design
§6.3 item 4, the savings simulator, the goal projections, the renter's pot in
the property comparison, and the wealth comparison of §6.3 item 6.

Three conventions, each load-bearing:

* **End-of-month contributions** (annuité de fin de période). A contribution
  earns no interest in the month it is made. The other convention would report
  a month of growth that has not happened yet.
* **A non-positive balance earns nothing.** A savings pot that has gone
  negative is an overdraft, not an investment, and crediting it a return would
  manufacture money out of a debt. This is not a hypothetical branch: the
  operator's measured savings capacity is negative and his liquid balance is
  -220 963 c, so every projection run on his real data passes through it.
* **Nothing is clamped at zero.** A negative contribution is a withdrawal --
  which is exactly how "pay the loan out of the same income the cash buyer
  invests" is modelled -- and a pot that runs out keeps going negative. Phase
  2A's `capacity.measure_savings_capacity` keeps the sign of a deficit for the
  same reason: clamping it would let a feasibility verdict read "atteignable"
  for a household going backwards every month.

The inverses (`required_monthly_cents`, `months_to_target`) are computed
**against `project_savings` itself**, by search rather than by a closed form.
The closed form disagrees with the per-month rounding by a few cents, and a
"required contribution" that does not actually reach the target when fed back
into the projection on the same screen is the kind of internal contradiction
this project keeps finding in review.

Pure: no session, no network, no clock.
"""

from dataclasses import dataclass
from decimal import Decimal

from app.engines.amortization import cents, monthly_rate

# The default rate of return on savings, in basis points: 3,00 %/an. An
# assumption, not a measurement -- design §10 requires every assumption to be
# displayed beside the result it produced, and every screen in this phase does.
# The user can override it; Yieldo never fetches a market rate.
DEFAULT_ANNUAL_RETURN_BPS = 300

# Fifty years, matching `runway.MAX_DATED_MONTHS`. Past it a projection is
# noise and a date is meaningless.
MAX_PROJECTION_MONTHS = 600


@dataclass(frozen=True)
class SavingsPoint:
    month: int
    # Both cumulative from the start of the projection, not per-month, so a
    # chart can draw the contributed/earned split at any point without summing.
    contributed_cents: int
    interest_cents: int
    balance_cents: int


@dataclass(frozen=True)
class SavingsProjection:
    initial_cents: int
    # May be negative: a withdrawal plan, or a measured savings capacity that
    # is a deficit. See the module docstring.
    monthly_cents: int
    annual_rate_bps: int
    months: int
    final_cents: int
    contributed_cents: int
    # Always >= 0: interest accrues only on a positive balance.
    interest_cents: int
    points: list[SavingsPoint]


def _validate(annual_rate_bps: int, months: int) -> None:
    if annual_rate_bps < 0:
        raise ValueError("Le taux de rendement ne peut pas être négatif.")
    if not 1 <= months <= MAX_PROJECTION_MONTHS:
        raise ValueError(
            f"La durée d'une projection doit être comprise entre 1 et "
            f"{MAX_PROJECTION_MONTHS} mois."
        )


def project_savings(
    initial_cents: int, monthly_cents: int, annual_rate_bps: int, months: int
) -> SavingsProjection:
    """Month-by-month growth. See the module docstring for the three conventions."""
    _validate(annual_rate_bps, months)
    rate = monthly_rate(annual_rate_bps)
    balance = initial_cents
    contributed = 0
    interest_total = 0
    points: list[SavingsPoint] = []

    for month in range(1, months + 1):
        # Interest first, on the opening balance, and only when there is a
        # positive balance to earn it.
        interest = cents(Decimal(balance) * rate) if balance > 0 else 0
        balance += interest + monthly_cents
        contributed += monthly_cents
        interest_total += interest
        points.append(SavingsPoint(
            month=month, contributed_cents=contributed,
            interest_cents=interest_total, balance_cents=balance,
        ))

    return SavingsProjection(
        initial_cents=initial_cents, monthly_cents=monthly_cents,
        annual_rate_bps=annual_rate_bps, months=months, final_cents=balance,
        contributed_cents=contributed, interest_cents=interest_total, points=points,
    )


def required_monthly_cents(
    target_cents: int, initial_cents: int, annual_rate_bps: int, months: int
) -> int:
    """The smallest whole-cent monthly contribution reaching `target_cents`.

    Binary search over `project_savings`, not a closed-form annuity: the final
    balance is strictly increasing in the contribution, so the search is exact,
    and the answer is guaranteed consistent with the projection the same screen
    draws beside it.

    Returns 0 -- never a negative "contribution" -- when the target is already
    covered by the initial amount and its own growth. The upper bound is
    `target - initial`, which always suffices: at `months == 1` the final
    balance is at least `initial + (target - initial) == target`, and interest
    is never negative.
    """
    _validate(annual_rate_bps, months)
    if project_savings(initial_cents, 0, annual_rate_bps, months).final_cents >= target_cents:
        return 0
    low, high = 1, max(1, target_cents - initial_cents)
    while low < high:
        middle = (low + high) // 2
        if project_savings(
            initial_cents, middle, annual_rate_bps, months
        ).final_cents >= target_cents:
            high = middle
        else:
            low = middle + 1
    return low


def months_to_target(
    target_cents: int, initial_cents: int, monthly_cents: int, annual_rate_bps: int
) -> int | None:
    """Whole months until the balance first reaches `target_cents`.

    `None` -- never a sentinel integer, never `MAX_PROJECTION_MONTHS` -- in the
    two cases where no month ever reaches it:

    * the balance stops growing (a non-positive contribution on a balance that
      earns nothing, which is the operator's own state: a measured capacity of
      -74 619 c/month on a negative pot). A "délai" quoted here would put a
      date on screen that will never arrive;
    * the target is past the fifty-year bound.

    0 when the target is already met, which is a real answer.
    """
    if annual_rate_bps < 0:
        raise ValueError("Le taux de rendement ne peut pas être négatif.")
    if initial_cents >= target_cents:
        return 0

    rate = monthly_rate(annual_rate_bps)
    balance = initial_cents
    for month in range(1, MAX_PROJECTION_MONTHS + 1):
        previous = balance
        interest = cents(Decimal(balance) * rate) if balance > 0 else 0
        balance += interest + monthly_cents
        if balance >= target_cents:
            return month
        if balance <= previous and monthly_cents <= 0:
            # It did not grow this month and nothing is being added: it never
            # will. Refuse now rather than iterating six hundred times to the
            # same conclusion.
            return None
    return None


def opportunity_cost_cents(amount_cents: int, annual_rate_bps: int, months: int) -> int:
    """What `amount_cents` would have EARNED over `months` -- the forgone gain.

    Design §6.3 item 4: "ce que la somme aurait produit si elle avait été
    investie". The gain alone, not the amount plus the gain: printing the
    latter under "coût d'opportunité" overstates it by the whole purchase price.

    0 for a non-positive amount: no capital was tied up, so nothing was forgone.
    """
    if amount_cents <= 0:
        return 0
    return project_savings(amount_cents, 0, annual_rate_bps, months).final_cents - amount_cents
```

- [ ] **Step 4: Run the test to verify it passes**

Run from `backend/`: `.venv/Scripts/pytest.exe tests/test_savings.py -v`
Expected: PASS, 14 tests.

- [ ] **Step 5: Mutation-check the three guards this module exists for**

Apply each alone, against a restored file, and record the result:

1. Remove the `if balance > 0` condition on interest (always accrue). Expected: `test_a_negative_balance_earns_no_interest` and `test_the_operators_own_case_projects_to_the_hand_verified_figure` both go red.
2. Remove the `if balance <= previous and monthly_cents <= 0: return None` early refusal. Expected: `test_months_to_target_refuses_when_the_pot_can_never_grow` **still passes** — the loop reaches its bound and returns `None` anyway. That is the mutation surviving, and it is fine: the guard is a performance short-circuit, not the correctness path, and the docstring must not claim otherwise. Confirm the docstring says "refuse now rather than iterating" and not "otherwise it would return a number".
3. In `required_monthly_cents`, change `>= target_cents` to `> target_cents` in the loop. Expected: `test_required_monthly_is_the_smallest_contribution_that_reaches_the_target` goes red (the boundary moves by one cent).

- [ ] **Step 6: Run the full backend suite**

Run from `backend/`: `.venv/Scripts/pytest.exe -q --cov=app/engines --cov-report=term-missing`
Expected: **550** passed. `amortization.py` and `savings.py` both at 100 %.

- [ ] **Step 7: Commit**

```bash
git add backend/app/engines/savings.py backend/tests/test_savings.py
git commit -m "feat(engines): project savings monthly without inventing growth on a deficit"
```

---
# Lot B — Dettes

### Task 3: The phase's schema — `debts`, `goals`, `scenarios`

Three tables from design §4.1, one migration. Grouped because a migration is a single reviewable unit and because `test_migrations.py`'s harness is exercised once rather than three times.

**Read before starting:** phase 2A task 3's ledger entry. `seed_fixture.py` calls `Base.metadata.create_all()` against the *current* ORM models, so a new table already exists before the migration runs — verifying a migration through the fixture is worthless. `backend/tests/test_migrations.py` carries a reusable `migration_db` fixture that builds the "before" database at the previous Alembic revision against a temp SQLite file. Use it.

**Files:**
- Create: `backend/app/models/debt.py`, `backend/app/models/goal.py`, `backend/app/models/scenario.py`
- Create: `backend/alembic/versions/d1a4c9e77b02_debts_goals_scenarios.py`
- Modify: `backend/app/models/__init__.py`
- Modify: `backend/tests/test_migrations.py` (append a second revision-pair test using the existing harness)
- Test: `backend/tests/test_models.py` (append), `backend/tests/test_migrations.py`

**Interfaces:**
- Consumes: `app.db.Base` (supplies `id`).
- Produces:
  - `Debt` — `user_id`, `name`, `kind`, `principal_cents` (**positive magnitude**), `annual_rate_bps`, `minimum_payment_cents`, `term_months: int | None`, `opened_on: date | None`, `archived: bool`.
  - `Goal` — `user_id`, `name`, `target_cents`, `saved_cents`, `due_on: date | None`, `priority: int` (**lower is more urgent**), `archived: bool`.
  - `Scenario` — `user_id`, `name`, `kind`, `payload: str` (JSON of the *request*), `created_at: datetime`.
  - `DEBT_KINDS`, `SCENARIO_KINDS` tuples, exported from `app.models`.
  - Consumed by Tasks 5 (`/api/debts`), 8 (`/api/goals`), 14 (scenarios).

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_models.py`:

```python
from datetime import date

from app.models import Debt, Goal, Scenario, User


def _user(db) -> User:
    user = User(email="dettes@example.com", name="Max", password_hash="x")
    db.add(user)
    db.commit()
    return user


def test_a_debt_stores_its_outstanding_capital_as_a_positive_magnitude(db):
    """The one deliberate exception to the negative-outflow convention in this
    codebase. A debt's `principal_cents` is "capital restant dû" (design §4.1):
    an amount owed, quoted positive, the way a bank statement quotes it. The
    payoff engine's arithmetic depends on it and says so."""
    user = _user(db)
    debt = Debt(user_id=user.id, name="Crédit auto", kind="auto",
                principal_cents=850_000, annual_rate_bps=490,
                minimum_payment_cents=21_500, term_months=48)
    db.add(debt)
    db.commit()
    assert debt.id is not None
    assert debt.principal_cents > 0
    assert debt.archived is False


def test_a_goal_defaults_to_nothing_saved_and_the_lowest_urgency(db):
    user = _user(db)
    goal = Goal(user_id=user.id, name="Fonds d'urgence", target_cents=600_000)
    db.add(goal)
    db.commit()
    assert goal.saved_cents == 0
    assert goal.priority == 100
    assert goal.due_on is None
    assert goal.archived is False


def test_a_scenario_stores_its_inputs_as_json_and_is_timestamped(db):
    """The request, never the computed figures -- see the model's docstring."""
    user = _user(db)
    scenario = Scenario(user_id=user.id, name="Voiture 2027", kind="feasibility",
                        payload='{"target_cents": 4000000, "horizon_months": 12}')
    db.add(scenario)
    db.commit()
    assert scenario.created_at is not None
    assert '"target_cents": 4000000' in scenario.payload


def test_deleting_a_user_takes_their_debts_goals_and_scenarios_with_them(db):
    user = _user(db)
    db.add_all([
        Debt(user_id=user.id, name="A", kind="consumer", principal_cents=1,
             annual_rate_bps=0, minimum_payment_cents=1),
        Goal(user_id=user.id, name="B", target_cents=1),
        Scenario(user_id=user.id, name="C", kind="feasibility", payload="{}"),
    ])
    db.commit()
    db.delete(user)
    db.commit()
    assert db.query(Debt).count() == 0
    assert db.query(Goal).count() == 0
    assert db.query(Scenario).count() == 0


def test_a_goal_due_date_is_a_real_date_not_a_string(db):
    user = _user(db)
    goal = Goal(user_id=user.id, name="Voyage", target_cents=300_000,
                due_on=date(2027, 6, 30), priority=1)
    db.add(goal)
    db.commit()
    db.refresh(goal)
    assert goal.due_on == date(2027, 6, 30)
```

Append to `backend/tests/test_migrations.py`:

```python
PHASE_2B_REVISION = "d1a4c9e77b02"
PHASE_2B_PREVIOUS = "c3f81a20d5e4"


def test_the_phase_2b_migration_adds_three_tables_to_a_populated_database(migration_db):
    """Run the real `upgrade()` against a database built at the PREVIOUS
    revision with rows already in it -- the shape an operator's database
    actually has. The suite's `db` fixture builds schema from
    `Base.metadata`, so without this the migration file is never executed
    anywhere."""
    command.upgrade(migration_db.config, PHASE_2B_PREVIOUS)
    conn = _connect(migration_db)
    conn.execute(
        "INSERT INTO users (id, email, name, password_hash, role, is_active, created_at) "
        "VALUES (1, 'a@b.fr', 'Max', 'x', 'user', 1, '2026-01-01T00:00:00')"
    )
    conn.commit()
    conn.close()

    command.upgrade(migration_db.config, PHASE_2B_REVISION)

    conn = _connect(migration_db)
    tables = {
        row[0]
        for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
    }
    assert {"debts", "goals", "scenarios"} <= tables
    # The pre-existing user survived, and the new tables really do enforce the
    # foreign key -- a table created without it would accept this insert.
    assert conn.execute("SELECT COUNT(*) FROM users").fetchone()[0] == 1
    conn.execute(
        "INSERT INTO goals (id, user_id, name, target_cents, saved_cents, priority, archived) "
        "VALUES (1, 1, 'Fonds', 600000, 0, 100, 0)"
    )
    conn.commit()
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute(
            "INSERT INTO goals (id, user_id, name, target_cents, saved_cents, priority, archived) "
            "VALUES (2, 4242, 'Orphelin', 1, 0, 100, 0)"
        )
    conn.close()


def test_the_phase_2b_migration_rolls_back_cleanly(migration_db):
    command.upgrade(migration_db.config, PHASE_2B_REVISION)
    command.downgrade(migration_db.config, PHASE_2B_PREVIOUS)
    conn = _connect(migration_db)
    tables = {
        row[0]
        for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
    }
    assert not ({"debts", "goals", "scenarios"} & tables)
    # The tables the previous revision owns are untouched.
    assert "price_index_points" in tables
    conn.close()
```

- [ ] **Step 2: Run the tests to verify they fail**

Run from `backend/`: `.venv/Scripts/pytest.exe tests/test_models.py tests/test_migrations.py -v`
Expected: FAIL — `ImportError: cannot import name 'Debt' from 'app.models'`

- [ ] **Step 3: Write the three models**

Create `backend/app/models/debt.py`:

```python
from datetime import date

from sqlalchemy import Boolean, Date, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base

DEBT_KINDS = (
    "mortgage", "auto", "consumer", "student", "credit_card", "personal", "other",
)


class Debt(Base):
    """One outstanding credit, as design §4.1 describes it: "capital restant dû,
    taux, mensualité, durée, type".

    **`principal_cents` is a POSITIVE magnitude**, and this is the one
    deliberate exception to the negative-means-outflow convention that governs
    `transactions.amount_cents` and every engine downstream of it. A debt is an
    amount *owed*, quoted the way the lender's statement quotes it, and the
    payoff engine subtracts payments from it. Storing it negative would put a
    sign flip in every comparison in `engines/debt.py` and in every screen.
    `engines/debt.DebtInput` restates the same contract at the engine boundary.

    Declared, not derived. Yieldo has no way to recognise a consumer loan from
    a statement line, and design §6.1's correction ("les moteurs travaillent
    désormais sur les transactions réelles quand elles existent, avec repli sur
    les valeurs déclarées sinon") is exactly this case: there is nothing to
    measure, so the user tells us.
    """

    __tablename__ = "debts"

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    kind: Mapped[str] = mapped_column(String(24), default="consumer", nullable=False)
    # Capital restant dû, positive. See the class docstring.
    principal_cents: Mapped[int] = mapped_column(Integer, nullable=False)
    # Taux débiteur annuel, in basis points: 490 is 4,90 %/an. Never a float.
    annual_rate_bps: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    # Mensualité contractuelle. The payoff engine treats the sum of these plus
    # any extra as a constant monthly budget -- that is what makes a snowball a
    # snowball rather than a series of unrelated repayments.
    minimum_payment_cents: Mapped[int] = mapped_column(Integer, nullable=False)
    # Durée restante déclarée. Optional and purely informative: the payoff
    # engine derives its own horizon from the capital, the rate and the budget,
    # and does not read this. Kept because design §4.1 lists it and because a
    # user comparing Yieldo's answer with their bank's needs to see both.
    term_months: Mapped[int | None] = mapped_column(Integer, nullable=True)
    opened_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    # Archived rather than deleted, like `accounts`: a repaid debt is part of
    # the household's history.
    archived: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
```

Create `backend/app/models/goal.py`:

```python
from datetime import date

from sqlalchemy import Boolean, Date, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class Goal(Base):
    """A savings goal, as design §4.1 describes it: "intitulé, montant cible,
    échéance, montant déjà constitué, priorité".

    **`priority` is lower-is-more-urgent**, defaulting to 100 so a goal created
    without one sorts after every goal that was given one. `engines/goal.py`
    funds goals *sequentially* in this order -- the whole measured capacity to
    the most urgent goal until it completes, then the next -- because applying
    the household's one capacity to every goal in parallel would tell the user
    all five finish at once, which is arithmetically impossible and is the kind
    of confident-looking falsehood this project keeps finding in review.

    `saved_cents` is declared, not measured. Yieldo cannot tell which euros in
    a savings account belong to which goal; only the user knows.
    """

    __tablename__ = "goals"

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    target_cents: Mapped[int] = mapped_column(Integer, nullable=False)
    saved_cents: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    # Échéance souhaitée. Optional: a goal without a deadline is still a goal,
    # and `engines/goal.py` reports `on_track = None` rather than inventing one.
    due_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    priority: Mapped[int] = mapped_column(Integer, default=100, nullable=False)
    archived: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
```

Create `backend/app/models/scenario.py`:

```python
from datetime import UTC, datetime

from sqlalchemy import DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base

SCENARIO_KINDS = ("feasibility",)


class Scenario(Base):
    """A saved simulation, for design §6.3's "chaque scénario est enregistrable
    et comparable aux autres".

    **`payload` holds the REQUEST, never the computed result.** Every scenario
    is recomputed against the current ledger when it is read back. Storing the
    figures would show a verdict measured on last winter's statements as though
    it were today's answer -- the same staleness trap `api/cashflow.py`'s module
    docstring works through for its clock, and a much worse one here, since the
    whole point of the feasibility engine is that its capacity input is
    measured from transactions that change with every import.

    JSON in a `Text` column rather than SQLAlchemy's `JSON` type: the payload is
    never queried into, only read whole and validated by the same Pydantic model
    that validated it on the way in, so a typed column would buy nothing and
    would make the "validate on read, do not trust the database" contract less
    obvious. Money inside the JSON is still an integer number of cents.
    """

    __tablename__ = "scenarios"

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    kind: Mapped[str] = mapped_column(String(24), nullable=False)
    payload: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False
    )
```

Replace `backend/app/models/__init__.py`:

```python
from app.models.account import ACCOUNT_KINDS, Account
from app.models.category import CATEGORY_KINDS, Category
from app.models.debt import DEBT_KINDS, Debt
from app.models.goal import Goal
from app.models.import_batch import ColumnProfile, ImportBatch
from app.models.price_index import PriceIndexPoint
from app.models.rule import RULE_ORIGINS, RULE_PRIORITIES, CategoryRule
from app.models.scenario import SCENARIO_KINDS, Scenario
from app.models.transaction import TRANSACTION_CATEGORY_SOURCES, Transaction
from app.models.user import User

__all__ = [
    "ACCOUNT_KINDS", "CATEGORY_KINDS", "DEBT_KINDS", "RULE_ORIGINS", "RULE_PRIORITIES",
    "SCENARIO_KINDS", "TRANSACTION_CATEGORY_SOURCES",
    "Account", "Category", "CategoryRule", "ColumnProfile", "Debt", "Goal",
    "ImportBatch", "PriceIndexPoint", "Scenario", "Transaction", "User",
]
```

- [ ] **Step 4: Write the migration**

Create `backend/alembic/versions/d1a4c9e77b02_debts_goals_scenarios.py`:

```python
"""debts, goals and scenarios

Revision ID: d1a4c9e77b02
Revises: c3f81a20d5e4
Create Date: 2026-08-25 09:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'd1a4c9e77b02'
down_revision: Union[str, Sequence[str], None] = 'c3f81a20d5e4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema.

    Three new tables, no backfill: nothing in an existing database can be
    turned into a debt, a goal or a saved scenario. `server_default` is set on
    every NOT NULL column with an ORM default so a future ALTER on SQLite, and
    any hand-written INSERT, behave the same way the ORM does.
    """
    op.create_table(
        "debts",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("kind", sa.String(length=24), nullable=False,
                  server_default=sa.text("'consumer'")),
        sa.Column("principal_cents", sa.Integer(), nullable=False),
        sa.Column("annual_rate_bps", sa.Integer(), nullable=False,
                  server_default=sa.text("0")),
        sa.Column("minimum_payment_cents", sa.Integer(), nullable=False),
        sa.Column("term_months", sa.Integer(), nullable=True),
        sa.Column("opened_on", sa.Date(), nullable=True),
        sa.Column("archived", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_debts_user_id"), "debts", ["user_id"], unique=False)

    op.create_table(
        "goals",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("target_cents", sa.Integer(), nullable=False),
        sa.Column("saved_cents", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("due_on", sa.Date(), nullable=True),
        sa.Column("priority", sa.Integer(), nullable=False, server_default=sa.text("100")),
        sa.Column("archived", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_goals_user_id"), "goals", ["user_id"], unique=False)

    op.create_table(
        "scenarios",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("kind", sa.String(length=24), nullable=False),
        sa.Column("payload", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_scenarios_user_id"), "scenarios", ["user_id"], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f("ix_scenarios_user_id"), table_name="scenarios")
    op.drop_table("scenarios")
    op.drop_index(op.f("ix_goals_user_id"), table_name="goals")
    op.drop_table("goals")
    op.drop_index(op.f("ix_debts_user_id"), table_name="debts")
    op.drop_table("debts")
```

- [ ] **Step 5: Run the tests to verify they pass**

Run from `backend/`: `.venv/Scripts/pytest.exe tests/test_models.py tests/test_migrations.py -v`
Expected: PASS. If the foreign-key assertion fails with no `IntegrityError`, check that `_connect` still issues `PRAGMA foreign_keys = ON` — SQLite defaults it off per connection.

- [ ] **Step 6: Verify the migration head is single**

Run from `backend/`: `.venv/Scripts/alembic.exe heads`
Expected: exactly one head, `d1a4c9e77b02`. Two heads means a `down_revision` typo, and Alembic will refuse to upgrade a real database.

- [ ] **Step 7: Run the full backend suite and commit**

Run from `backend/`: `.venv/Scripts/pytest.exe -q`
Expected: **557** passed.

```bash
git add backend/app/models/ backend/alembic/versions/d1a4c9e77b02_debts_goals_scenarios.py backend/tests/test_models.py backend/tests/test_migrations.py
git commit -m "feat(models): add debts, goals and scenarios tables"
```

---

### Task 4: Debt payoff — boule de neige and avalanche

Design §6.1: "analyse de dettes avec échéancier boule de neige et avalanche". Both strategies over one constant monthly budget, with the interest each one costs and the difference between them.

**Files:**
- Create: `backend/app/engines/debt.py`
- Modify: `backend/app/engines/period.py` (add the shared `month_end` helper)
- Test: `backend/tests/test_debt.py`, `backend/tests/test_period.py` (append)

**Interfaces:**
- Consumes: `app.engines.amortization.{cents, monthly_rate}`, `app.engines.period.month_end`.
- Produces:
  - `DebtInput` frozen dataclass: `id: int`, `name: str`, `principal_cents: int` (positive), `annual_rate_bps: int`, `minimum_payment_cents: int`.
  - `DebtPayoff` frozen dataclass: `debt_id`, `name`, `cleared_in_months: int`, `cleared_on: date`, `interest_cents`, `paid_cents`.
  - `BalancePoint` frozen dataclass: `month: int`, `on: date`, `balances_cents: dict[int, int]`, `total_cents: int`.
  - `PayoffPlan` frozen dataclass: `strategy`, `monthly_budget_cents`, `first_month_interest_cents`, `months: int | None`, `cleared_on: date | None`, `total_interest_cents`, `total_paid_cents`, `order: list[int]`, `payoffs: list[DebtPayoff]`, `points: list[BalancePoint]`, `unavailable_reason: str | None`.
  - `StrategyComparison` frozen dataclass: `snowball: PayoffPlan`, `avalanche: PayoffPlan`, `interest_saved_cents: int | None`, `months_saved: int | None`.
  - `build_payoff(debts, extra_monthly_cents, strategy, today) -> PayoffPlan`
  - `compare_strategies(debts, extra_monthly_cents, today) -> StrategyComparison`
  - Constants `STRATEGIES = ("snowball", "avalanche")`, `MAX_PAYOFF_MONTHS = 600`.
  - `period.month_end(anchor: date, offset: int) -> date` — new, in the existing pure date module. **Also consumed by Tasks 7 (goal projections), 11 (feasibility horizon) and 17 (property).** Written here rather than privately in `debt.py` because four engines in this phase need the same "N calendar months after this month, at month end" arithmetic, and four private copies is how two modules end up bucketing the same edge differently.
  - Consumed by Task 5 (`/api/debts/payoff`).

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_period.py`:

```python
from datetime import date

from app.engines.period import month_end


def test_month_end_lands_on_the_last_day_of_the_target_month():
    assert month_end(date(2026, 8, 25), 0) == date(2026, 8, 31)
    assert month_end(date(2026, 8, 25), 3) == date(2026, 11, 30)


def test_month_end_crosses_a_year_boundary_without_a_day_31_problem():
    """Plain integer arithmetic on a zero-based month count, so there is no
    "31 February does not exist" case to special-case at every step -- the same
    approach `api/analysis._shift_months` already takes."""
    assert month_end(date(2026, 12, 31), 2) == date(2027, 2, 28)
    assert month_end(date(2027, 12, 1), 14) == date(2029, 2, 28)


def test_month_end_accepts_a_negative_offset():
    assert month_end(date(2026, 1, 15), -1) == date(2025, 12, 31)
```

Create `backend/tests/test_debt.py`:

```python
from datetime import date

import pytest

from app.engines.debt import (
    DebtInput,
    build_payoff,
    compare_strategies,
)

TODAY = date(2026, 8, 25)


def _debt(id_, principal, minimum, rate=0, name=None) -> DebtInput:
    return DebtInput(id=id_, name=name or f"Dette {id_}", principal_cents=principal,
                     annual_rate_bps=rate, minimum_payment_cents=minimum)


def test_the_freed_minimum_rolls_onto_the_next_debt():
    """The whole point of a snowball, and the only thing that makes it faster
    than paying each debt separately. Hand-computed, zero rate so every cent is
    checkable, budget 30 000 c held constant:

      m1  A 30 000 -> 20 000   B 100 000 -> 80 000
      m2  A 20 000 -> 10 000   B  80 000 -> 60 000
      m3  A 10 000 ->      0   B  60 000 -> 40 000   (A cleared)
      m4  A cleared            B  40 000 -> 10 000   (A's 10 000 rolls onto B)
      m5                       B  10 000 ->      0
    """
    plan = build_payoff([_debt(1, 30_000, 10_000), _debt(2, 100_000, 20_000)],
                        0, "snowball", TODAY)
    assert plan.months == 5
    assert plan.total_interest_cents == 0
    assert plan.total_paid_cents == 130_000
    assert plan.order == [1, 2]
    assert {p.debt_id: p.cleared_in_months for p in plan.payoffs} == {1: 3, 2: 5}
    assert plan.points[3].balances_cents == {1: 0, 2: 10_000}


def test_interest_accrues_before_the_payment_each_month():
    """Single debt, 100 000 c at 12 %/an, 60 000 c/month.
      m1 interest 1 000 -> 101 000, pay 60 000 -> 41 000
      m2 interest   410 ->  41 410, pay 41 410 ->      0
    """
    plan = build_payoff([_debt(1, 100_000, 60_000, rate=1200)], 0, "avalanche", TODAY)
    assert plan.months == 2
    assert plan.total_interest_cents == 1_410
    assert plan.total_paid_cents == 101_410
    assert plan.first_month_interest_cents == 1_000


def test_the_two_strategies_attack_in_different_orders():
    """Smallest balance first versus highest rate first. The fixture is built so
    the two orders genuinely differ -- a fixture where they coincide proves
    nothing, which is how phase 2A's single-category ordering test passed for
    the wrong reason."""
    debts = [_debt(1, 200_000, 5_000, rate=2000), _debt(2, 50_000, 5_000, rate=500)]
    comparison = compare_strategies(debts, 20_000, TODAY)
    assert comparison.snowball.order == [2, 1]
    assert comparison.avalanche.order == [1, 2]


def test_avalanche_costs_no_more_interest_than_snowball():
    """Attacking the dearest debt first cannot cost more. Asserted as an
    inequality plus a strict check on this fixture, because `<=` alone would
    pass if the implementation ignored the strategy entirely."""
    debts = [_debt(1, 200_000, 5_000, rate=2000), _debt(2, 50_000, 5_000, rate=500)]
    comparison = compare_strategies(debts, 20_000, TODAY)
    assert comparison.avalanche.total_interest_cents <= comparison.snowball.total_interest_cents
    assert comparison.interest_saved_cents > 0
    assert comparison.interest_saved_cents == (
        comparison.snowball.total_interest_cents - comparison.avalanche.total_interest_cents
    )


def test_a_budget_that_cannot_cover_the_first_month_of_interest_refuses():
    """500 c/month against 1 000 c of monthly interest: the capital would grow
    for ever. Refused with its OWN reason, before the loop -- never with the
    fifty-year message, which would name the wrong cause."""
    plan = build_payoff([_debt(1, 100_000, 500, rate=1200)], 0, "snowball", TODAY)
    assert plan.months is None
    assert plan.cleared_on is None
    assert plan.unavailable_reason is not None
    assert "intérêts" in plan.unavailable_reason
    assert "ans" not in plan.unavailable_reason
    # The two figures the screen needs to state the shortfall itself, in euros.
    assert plan.monthly_budget_cents == 500
    assert plan.first_month_interest_cents == 1_000


def test_a_payoff_longer_than_fifty_years_refuses_with_a_different_reason():
    """One cent above the interest: the capital does shrink, so the budget
    guard does not fire, but not within a lifetime. A distinct cause needs a
    distinct message -- the failure mode that cost phase 2A five fix rounds."""
    plan = build_payoff([_debt(1, 1_000_000, 10_001, rate=1200)], 0, "snowball", TODAY)
    assert plan.months is None
    assert plan.unavailable_reason is not None
    assert "ans" in plan.unavailable_reason
    assert "intérêts du premier mois" not in plan.unavailable_reason


def test_an_empty_debt_list_is_answered_not_refused():
    """Nobody with no debts has a payoff problem. Zero months, no reason: a
    refusal here would put an error on a screen whose real message is "vous
    n'avez aucune dette"."""
    plan = build_payoff([], 0, "snowball", TODAY)
    assert plan.months == 0
    assert plan.unavailable_reason is None
    assert plan.payoffs == []
    assert plan.points == []


def test_the_clearing_date_is_the_end_of_the_month_the_last_payment_lands_in():
    plan = build_payoff([_debt(1, 30_000, 10_000)], 0, "snowball", TODAY)
    assert plan.months == 3
    # August 2026 + 3 months -> end of November 2026.
    assert plan.cleared_on == date(2026, 11, 30)


def test_extra_money_shortens_the_plan():
    slow = build_payoff([_debt(1, 100_000, 10_000)], 0, "snowball", TODAY)
    fast = build_payoff([_debt(1, 100_000, 10_000)], 10_000, "snowball", TODAY)
    assert slow.months == 10
    assert fast.months == 5


def test_an_unknown_strategy_raises_in_french():
    with pytest.raises(ValueError, match="stratégie"):
        build_payoff([_debt(1, 1000, 100)], 0, "waterfall", TODAY)


def test_a_negative_principal_raises_rather_than_being_absorbed():
    """`Debt.principal_cents` is a positive magnitude by contract. A negative
    one is a caller bug, and silently treating it as zero would hide a debt."""
    with pytest.raises(ValueError, match="capital"):
        build_payoff([_debt(1, -1000, 100)], 0, "snowball", TODAY)
```

- [ ] **Step 2: Run the test to verify it fails**

Run from `backend/`: `.venv/Scripts/pytest.exe tests/test_debt.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.engines.debt'`

- [ ] **Step 3: Add the shared month helper**

Append to `backend/app/engines/period.py`:

```python
import calendar


def month_end(anchor: date, offset: int) -> date:
    """The last day of the month `offset` calendar months after `anchor`'s.

    Four engines in this phase need the same arithmetic -- a debt cleared "in
    3 months", a goal reached "in 10", a purchase horizon, a property's rent
    comparison -- and money lands at month end. From an August anchor, offset 3
    is 30 November.

    Plain integer arithmetic on a zero-based month count, exactly like
    `api/analysis._shift_months`, so there is no "31 February does not exist"
    case to special-case at every step. A negative offset walks backwards.

    Pure: the clock is the caller's `anchor`, never read here.
    """
    total = anchor.year * 12 + (anchor.month - 1) + offset
    year, month = divmod(total, 12)
    return date(year, month + 1, calendar.monthrange(year, month + 1)[1])
```

- [ ] **Step 4: Write the implementation**

Create `backend/app/engines/debt.py`:

```python
"""Boule de neige and avalanche, over one constant monthly budget.

Design §6.1 lists "analyse de dettes avec échéancier boule de neige et
avalanche" among the engines carried over from FinVest. This is that engine,
rebuilt: integer cents throughout, both refusals named separately, and a
budget that stays constant as debts clear -- which is the entire mechanism.

**The budget is fixed at the start and never shrinks.** It is the sum of every
debt's contractual minimum plus whatever extra the household commits. When a
debt clears, its minimum does not disappear; it rolls onto the next debt in the
attack order. A model that let the budget fall as debts cleared would describe
paying each debt separately, which is neither strategy and is slower than both.

**Two refusals, mutually exclusive by construction:**

* the budget does not cover the first month's interest, so the capital would
  grow for ever. Checked before the loop, so its message can never be emitted
  on a plan that merely takes a long time;
* the plan runs past `MAX_PAYOFF_MONTHS`. Only reachable after the first check
  has passed.

The reasons name causes, not amounts: the two figures a screen needs to state
the shortfall in euros (`monthly_budget_cents`, `first_month_interest_cents`)
are published as fields, and formatting money is the display boundary's job.

Pure: no session, no network, no implicit clock -- `today` is a parameter.
"""

from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from app.engines.amortization import cents, monthly_rate
from app.engines.period import month_end

STRATEGIES = ("snowball", "avalanche")

# Fifty years, matching `runway.MAX_DATED_MONTHS` and
# `savings.MAX_PROJECTION_MONTHS`. Past it a payoff date is not an answer.
MAX_PAYOFF_MONTHS = 600


@dataclass(frozen=True)
class DebtInput:
    """One debt, at the engine boundary.

    `principal_cents` is a POSITIVE magnitude -- capital restant dû -- matching
    `models.Debt`. This is the deliberate exception to the negative-outflow
    convention, restated here so an engine reader does not have to go looking.
    """

    id: int
    name: str
    principal_cents: int
    annual_rate_bps: int
    minimum_payment_cents: int


@dataclass(frozen=True)
class DebtPayoff:
    debt_id: int
    name: str
    cleared_in_months: int
    cleared_on: date
    interest_cents: int
    paid_cents: int


@dataclass(frozen=True)
class BalancePoint:
    month: int
    on: date
    # debt_id -> capital still owed at the END of this month. Every debt in the
    # input appears in every point, cleared ones included with a 0, so a
    # stacked chart has a value for every series at every x.
    balances_cents: dict[int, int]
    total_cents: int


@dataclass(frozen=True)
class PayoffPlan:
    strategy: str
    # Constant for the whole plan. See the module docstring.
    monthly_budget_cents: int
    # What every debt costs in interest in month one, together. Published so a
    # screen can state the shortfall behind a budget refusal in euros without
    # recomputing it, and so a healthy plan can show what the budget is up
    # against. 0 on an empty debt list.
    first_month_interest_cents: int
    # None exactly when `unavailable_reason` is set. 0 on an empty debt list,
    # which is an answer rather than a refusal.
    months: int | None
    cleared_on: date | None
    total_interest_cents: int
    total_paid_cents: int
    # Debt ids in attack order. Populated even on a refusal -- the order is a
    # property of the strategy and the debts, not of whether the plan converged.
    order: list[int]
    payoffs: list[DebtPayoff]
    points: list[BalancePoint]
    # French. Set exactly when `months` is None, and it names WHICH of the two
    # causes applies. Never both.
    unavailable_reason: str | None


@dataclass(frozen=True)
class StrategyComparison:
    snowball: PayoffPlan
    avalanche: PayoffPlan
    # Snowball's interest minus avalanche's: positive when avalanche is cheaper,
    # which it is whenever the two orders differ. None when either plan refused
    # -- a difference between a number and a refusal is not a saving.
    interest_saved_cents: int | None
    months_saved: int | None


def _ordered(debts: list[DebtInput], strategy: str) -> list[DebtInput]:
    """Attack order.

    Snowball: smallest capital first -- the motivational strategy, one debt
    visibly gone as early as possible. Avalanche: highest rate first -- the
    cheapest strategy. Both fall back to the smallest capital and then the id,
    so the order is total and a tie never depends on dictionary insertion.
    """
    if strategy == "snowball":
        return sorted(debts, key=lambda d: (d.principal_cents, d.id))
    if strategy == "avalanche":
        return sorted(debts, key=lambda d: (-d.annual_rate_bps, d.principal_cents, d.id))
    raise ValueError(f"Stratégie de remboursement inconnue : {strategy}")


def _reason_budget_too_small() -> str:
    return (
        "La mensualité totale disponible ne couvre pas les intérêts du premier "
        "mois : le capital augmenterait au lieu de diminuer, et aucun échéancier "
        "ne peut être établi. Augmentez le versement mensuel, ou renégociez le "
        "taux de la dette la plus chère."
    )


def _reason_too_long() -> str:
    return (
        f"Au rythme actuel, ces dettes ne seraient pas soldées avant "
        f"{MAX_PAYOFF_MONTHS // 12} ans. Aucune échéance n'est avancée au-delà : "
        "elle ne voudrait rien dire."
    )


def build_payoff(
    debts: list[DebtInput],
    extra_monthly_cents: int,
    strategy: str,
    today: date,
) -> PayoffPlan:
    """One strategy's full schedule. See the module docstring for both refusals."""
    order = _ordered(debts, strategy)
    for debt in order:
        if debt.principal_cents < 0:
            raise ValueError(
                f"Le capital restant dû de « {debt.name} » ne peut pas être négatif."
            )
    ids = [debt.id for debt in order]
    budget = sum(debt.minimum_payment_cents for debt in debts) + extra_monthly_cents
    rates = {debt.id: monthly_rate(debt.annual_rate_bps) for debt in debts}
    first_interest = sum(
        cents(Decimal(debt.principal_cents) * rates[debt.id]) for debt in debts
    )

    if not debts:
        return PayoffPlan(
            strategy=strategy, monthly_budget_cents=budget, first_month_interest_cents=0,
            months=0, cleared_on=None, total_interest_cents=0, total_paid_cents=0,
            order=[], payoffs=[], points=[], unavailable_reason=None,
        )

    if budget <= first_interest:
        return PayoffPlan(
            strategy=strategy, monthly_budget_cents=budget,
            first_month_interest_cents=first_interest, months=None, cleared_on=None,
            total_interest_cents=0, total_paid_cents=0, order=ids, payoffs=[], points=[],
            unavailable_reason=_reason_budget_too_small(),
        )

    remaining = {debt.id: debt.principal_cents for debt in debts}
    interest_by_debt = {debt.id: 0 for debt in debts}
    paid_by_debt = {debt.id: 0 for debt in debts}
    payoffs: list[DebtPayoff] = []
    points: list[BalancePoint] = []
    total_interest = 0
    total_paid = 0

    for month in range(1, MAX_PAYOFF_MONTHS + 1):
        for debt in order:
            if remaining[debt.id] <= 0:
                continue
            interest = cents(Decimal(remaining[debt.id]) * rates[debt.id])
            remaining[debt.id] += interest
            interest_by_debt[debt.id] += interest
            total_interest += interest

        # Contractual minimums first, in attack order, then everything left over
        # cascades down the same order. Cascading rather than stopping at the
        # focus debt matters on the last month: the focus can be cleared with
        # money to spare, and that money is available to the next debt now, not
        # next month.
        left = budget
        for pass_ in ("minimum", "surplus"):
            for debt in order:
                if left <= 0:
                    break
                owed = remaining[debt.id]
                if owed <= 0:
                    continue
                ceiling = debt.minimum_payment_cents if pass_ == "minimum" else left
                payment = min(ceiling, owed, left)
                if payment <= 0:
                    continue
                remaining[debt.id] -= payment
                paid_by_debt[debt.id] += payment
                left -= payment
                total_paid += payment

        on = month_end(today, month)
        for debt in order:
            if remaining[debt.id] == 0 and debt.id not in {p.debt_id for p in payoffs}:
                payoffs.append(DebtPayoff(
                    debt_id=debt.id, name=debt.name, cleared_in_months=month, cleared_on=on,
                    interest_cents=interest_by_debt[debt.id], paid_cents=paid_by_debt[debt.id],
                ))
        points.append(BalancePoint(
            month=month, on=on,
            balances_cents={debt.id: remaining[debt.id] for debt in order},
            total_cents=sum(remaining.values()),
        ))

        if all(value == 0 for value in remaining.values()):
            return PayoffPlan(
                strategy=strategy, monthly_budget_cents=budget,
                first_month_interest_cents=first_interest, months=month, cleared_on=on,
                total_interest_cents=total_interest, total_paid_cents=total_paid,
                order=ids, payoffs=payoffs, points=points, unavailable_reason=None,
            )

    return PayoffPlan(
        strategy=strategy, monthly_budget_cents=budget,
        first_month_interest_cents=first_interest, months=None, cleared_on=None,
        total_interest_cents=total_interest, total_paid_cents=total_paid,
        order=ids, payoffs=payoffs, points=points, unavailable_reason=_reason_too_long(),
    )


def compare_strategies(
    debts: list[DebtInput], extra_monthly_cents: int, today: date
) -> StrategyComparison:
    """Both plans, and what choosing avalanche over snowball actually buys.

    `interest_saved_cents` and `months_saved` are None whenever either plan
    refused: the difference between a number and a refusal is not a saving, and
    subtracting a refusal's zeroed totals would report a spectacular fictional
    gain.
    """
    snowball = build_payoff(debts, extra_monthly_cents, "snowball", today)
    avalanche = build_payoff(debts, extra_monthly_cents, "avalanche", today)
    if snowball.months is None or avalanche.months is None:
        return StrategyComparison(snowball=snowball, avalanche=avalanche,
                                  interest_saved_cents=None, months_saved=None)
    return StrategyComparison(
        snowball=snowball, avalanche=avalanche,
        interest_saved_cents=snowball.total_interest_cents - avalanche.total_interest_cents,
        months_saved=snowball.months - avalanche.months,
    )
```

- [ ] **Step 5: Run the tests to verify they pass**

Run from `backend/`: `.venv/Scripts/pytest.exe tests/test_debt.py tests/test_period.py -v`
Expected: PASS, 11 new debt tests and 3 new period tests.

- [ ] **Step 6: Mutation-check the mechanism and both refusals**

Apply each alone against a restored file:

1. Recompute `budget` inside the month loop from the *unpaid* debts only (the "budget shrinks as debts clear" defect). Expected: `test_the_freed_minimum_rolls_onto_the_next_debt` goes red — B finishes in month 7, not 5.
2. Delete the `"surplus"` pass. Expected: the same test goes red.
3. Swap `_reason_budget_too_small` and `_reason_too_long`. Expected: **both** refusal tests go red, on the `"ans" not in`/`"intérêts du premier mois" not in` assertions. That negative half is the whole point: it is what stops a message naming the wrong cause, which is the single most expensive failure mode in this project's history.
4. In `_ordered`, make the avalanche key `(d.annual_rate_bps, ...)` (ascending). Expected: `test_the_two_strategies_attack_in_different_orders` and `test_avalanche_costs_no_more_interest_than_snowball` both go red.

- [ ] **Step 7: Run the full backend suite and commit**

Run from `backend/`: `.venv/Scripts/pytest.exe -q --cov=app/engines --cov-report=term-missing`
Expected: **571** passed, `debt.py` at 100 %.

```bash
git add backend/app/engines/debt.py backend/app/engines/period.py backend/tests/test_debt.py backend/tests/test_period.py
git commit -m "feat(engines): schedule debt payoff by snowball and avalanche"
```

---
### Task 5: `/api/debts` — CRUD and the payoff comparison

**Files:**
- Create: `backend/app/api/debts.py`, `backend/app/schemas/debts.py`
- Modify: `backend/app/main.py` (register the router), `backend/app/api/errors.py` (`FIELD_SUBJECTS`)
- Test: `backend/tests/test_debts_api.py`

**Interfaces:**
- Consumes: `app.engines.debt.{DebtInput, compare_strategies}`, `app.models.{DEBT_KINDS, Debt, User}`, `app.security.deps.get_current_user`.
- Produces:
  - `GET /api/debts` → `list[DebtOut]` (unarchived, ordered by id)
  - `POST /api/debts` → `DebtOut`, 201
  - `PATCH /api/debts/{debt_id}` → `DebtOut`
  - `DELETE /api/debts/{debt_id}` → 204, archives
  - `GET /api/debts/payoff?extra_cents=0` → `StrategyComparisonOut`
  - Schemas `DebtIn`, `DebtPatch`, `DebtOut`, `DebtPayoffOut`, `BalancePointOut`, `PayoffPlanOut`, `StrategyComparisonOut`.
  - Consumed by Tasks 6 (screen) and 13 (feasibility's existing debt instalments feed the debt-ratio lever).

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_debts_api.py`:

```python
def _register(client, email="dettes@example.fr"):
    body = client.post("/api/auth/register", json={
        "name": "Max", "email": email, "password": "motdepasse123"}).json()
    return {"Authorization": f"Bearer {body['access_token']}"}


def _create(client, headers, **overrides):
    payload = {"name": "Crédit auto", "kind": "auto", "principal_cents": 850_000,
               "annual_rate_bps": 490, "minimum_payment_cents": 21_500,
               "term_months": 48}
    payload.update(overrides)
    return client.post("/api/debts", headers=headers, json=payload)


def test_a_debt_round_trips(client):
    headers = _register(client)
    created = _create(client, headers)
    assert created.status_code == 201
    body = created.json()
    assert body["principal_cents"] == 850_000
    assert body["archived"] is False

    listed = client.get("/api/debts", headers=headers).json()
    assert [item["id"] for item in listed] == [body["id"]]


def test_deleting_a_debt_archives_it_rather_than_erasing_it(client):
    headers = _register(client)
    debt_id = _create(client, headers).json()["id"]
    assert client.delete(f"/api/debts/{debt_id}", headers=headers).status_code == 204
    assert client.get("/api/debts", headers=headers).json() == []


def test_an_unknown_debt_kind_is_refused_in_french(client):
    headers = _register(client)
    response = _create(client, headers, kind="hypothèque-martienne")
    assert response.status_code == 422
    assert "Type de dette inconnu" in response.json()["detail"]


def test_a_negative_capital_is_refused_in_french(client):
    """`Debt.principal_cents` is a positive magnitude by contract. Pydantic
    enforces it, and `french_request_validation_error` translates the message --
    the frontend renders `detail` verbatim."""
    headers = _register(client)
    response = _create(client, headers, principal_cents=-1)
    assert response.status_code == 422
    assert "capital" in str(response.json()["detail"]).lower()


def test_the_payoff_compares_both_strategies(client):
    headers = _register(client)
    _create(client, headers, name="Conso", kind="consumer", principal_cents=200_000,
            annual_rate_bps=2000, minimum_payment_cents=5_000, term_months=None)
    _create(client, headers, name="Carte", kind="credit_card", principal_cents=50_000,
            annual_rate_bps=500, minimum_payment_cents=5_000, term_months=None)

    body = client.get("/api/debts/payoff", headers=headers,
                      params={"extra_cents": 20_000}).json()
    assert body["snowball"]["order"] != body["avalanche"]["order"]
    assert body["interest_saved_cents"] > 0
    assert body["snowball"]["monthly_budget_cents"] == 30_000
    assert len(body["snowball"]["points"]) == body["snowball"]["months"]


def test_the_payoff_of_a_user_with_no_debts_is_an_answer_not_an_error(client):
    headers = _register(client)
    body = client.get("/api/debts/payoff", headers=headers).json()
    assert body["snowball"]["months"] == 0
    assert body["snowball"]["unavailable_reason"] is None
    assert body["interest_saved_cents"] == 0


def test_an_unpayable_budget_returns_a_refusal_not_a_500(client):
    headers = _register(client)
    _create(client, headers, principal_cents=100_000, annual_rate_bps=1200,
            minimum_payment_cents=500, term_months=None)
    body = client.get("/api/debts/payoff", headers=headers).json()
    assert body["snowball"]["months"] is None
    assert "intérêts" in body["snowball"]["unavailable_reason"]
    assert body["interest_saved_cents"] is None


def test_a_negative_extra_payment_is_refused(client):
    headers = _register(client)
    response = client.get("/api/debts/payoff", headers=headers, params={"extra_cents": -1})
    assert response.status_code == 422


def test_debts_never_cross_users(client):
    """Both directions. Phase 2A shipped a cross-tenant test proving exclusion
    only from the empty side; this one seeds both users and checks each sees
    exactly their own."""
    alice = _register(client, "alice@example.fr")
    bob = _register(client, "bob@example.fr")
    _create(client, alice, name="Auto Alice")
    bob_debt = _create(client, bob, name="Auto Bob").json()

    assert [d["name"] for d in client.get("/api/debts", headers=alice).json()] == ["Auto Alice"]
    assert [d["name"] for d in client.get("/api/debts", headers=bob).json()] == ["Auto Bob"]
    assert client.delete(f"/api/debts/{bob_debt['id']}", headers=alice).status_code == 404
    assert client.patch(f"/api/debts/{bob_debt['id']}", headers=alice,
                        json={"name": "volé"}).status_code == 404
    # And Bob's debt is untouched by the two refused attempts.
    assert client.get("/api/debts", headers=bob).json()[0]["name"] == "Auto Bob"
```

- [ ] **Step 2: Run it and watch it fail**

Run from `backend/`: `.venv/Scripts/pytest.exe tests/test_debts_api.py -v`
Expected: FAIL — 404 on every route.

- [ ] **Step 3: Write the schemas**

Create `backend/app/schemas/debts.py`:

```python
"""Wire shapes for /api/debts.

`principal_cents` is a positive magnitude on every shape here, matching
`models.Debt` and `engines.debt.DebtInput` -- the deliberate exception to the
negative-outflow convention, restated at the boundary so a frontend author
reading only this file does not negate it.
"""

from datetime import date

from pydantic import BaseModel, ConfigDict, Field


class DebtIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    kind: str
    # ge=0 rather than gt=0: a debt whose capital has just reached zero is a
    # real row the user may not have archived yet.
    principal_cents: int = Field(ge=0)
    annual_rate_bps: int = Field(default=0, ge=0, le=10_000)
    minimum_payment_cents: int = Field(ge=0)
    term_months: int | None = Field(default=None, ge=1, le=480)
    opened_on: date | None = None


class DebtPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    kind: str | None = None
    principal_cents: int | None = Field(default=None, ge=0)
    annual_rate_bps: int | None = Field(default=None, ge=0, le=10_000)
    minimum_payment_cents: int | None = Field(default=None, ge=0)
    term_months: int | None = Field(default=None, ge=1, le=480)
    opened_on: date | None = None
    archived: bool | None = None


class DebtOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    kind: str
    principal_cents: int
    annual_rate_bps: int
    minimum_payment_cents: int
    term_months: int | None
    opened_on: date | None
    archived: bool


class DebtPayoffOut(BaseModel):
    debt_id: int
    name: str
    cleared_in_months: int
    cleared_on: date
    interest_cents: int
    paid_cents: int


class BalancePointOut(BaseModel):
    month: int
    on: date
    # Keys are debt ids as strings -- JSON object keys are always strings, and
    # saying so here stops a frontend author expecting numbers. EVERY debt in
    # the plan appears at EVERY point, cleared ones as 0, so a stacked chart
    # has a value for every series at every x.
    balances_cents: dict[str, int]
    total_cents: int


class PayoffPlanOut(BaseModel):
    strategy: str
    monthly_budget_cents: int
    # What the debts cost in interest in month one, together. The screen states
    # the shortfall behind a budget refusal from this and `monthly_budget_cents`
    # -- the engine names causes, the display boundary formats euros.
    first_month_interest_cents: int
    # null exactly when `unavailable_reason` is set. 0 -- with a null reason --
    # on a user with no debts, which is an answer, not a refusal.
    months: int | None
    cleared_on: date | None
    total_interest_cents: int
    total_paid_cents: int
    order: list[int]
    payoffs: list[DebtPayoffOut]
    # Empty on both refusal branches and on an empty debt list. Never render a
    # chart from it without checking `months` first.
    points: list[BalancePointOut]
    # French. Set exactly when `months` is null, and it names WHICH of the two
    # causes applies: a budget below the first month's interest, or a plan
    # running past fifty years. Print it verbatim; do not paraphrase.
    unavailable_reason: str | None


class StrategyComparisonOut(BaseModel):
    snowball: PayoffPlanOut
    avalanche: PayoffPlanOut
    # Snowball's interest minus avalanche's, so positive means avalanche is
    # cheaper. **null when either plan refused** -- the difference between a
    # number and a refusal is not a saving. 0 is a real answer (both strategies
    # cost the same, e.g. a single debt); null is not.
    interest_saved_cents: int | None
    months_saved: int | None
```

- [ ] **Step 4: Write the router**

Create `backend/app/api/debts.py`:

```python
"""GET/POST/PATCH/DELETE /api/debts and GET /api/debts/payoff.

The clock is read here, at the boundary, and handed to `build_payoff` as a
parameter -- no engine imports `date.today`.

**This route uses the real calendar date, and the reasoning is its own, not
borrowed.** `api/cashflow.py`'s forecast anchors on the ledger's last
transaction because `detect_recurrences` classifies a subscription as `ended`
by staleness and would mark every live one dead on a ledger that stops in
January. Nothing in `engines/debt.py` classifies anything by staleness: `today`
only anchors `cleared_on`, a forward calendar date. Anchoring that to a stale
ledger date would land every payoff date months in the past. A debt is declared
by the user, not read from statements, so its freshness is not a property of
the ledger at all -- which is why, unlike `/api/cashflow/*`, this payload
carries no `ledger_last_on`.

`/payoff` is declared before the `/{debt_id}` routes. FastAPI matches in
declaration order, and although no `GET /{debt_id}` exists today, adding one
later above this line would silently swallow `/payoff` into a 422 on an
integer path parameter.
"""

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.db import get_db
from app.engines.debt import DebtInput, PayoffPlan, compare_strategies
from app.models import DEBT_KINDS, Debt, User
from app.schemas.debts import (
    BalancePointOut,
    DebtIn,
    DebtOut,
    DebtPatch,
    DebtPayoffOut,
    PayoffPlanOut,
    StrategyComparisonOut,
)
from app.security.deps import get_current_user

router = APIRouter(prefix="/debts", tags=["debts"])


def _owned(db: Session, user: User, debt_id: int) -> Debt:
    debt = db.query(Debt).filter(Debt.id == debt_id, Debt.user_id == user.id).first()
    if debt is None:
        raise HTTPException(status_code=404, detail="Dette introuvable")
    return debt


def _check_kind(kind: str | None) -> None:
    if kind is not None and kind not in DEBT_KINDS:
        raise HTTPException(status_code=422, detail=f"Type de dette inconnu : {kind}")


def _active_debts(db: Session, user_id: int) -> list[Debt]:
    return (
        db.query(Debt)
        .filter(Debt.user_id == user_id, Debt.archived.is_(False))
        .order_by(Debt.id)
        .all()
    )


@router.get("/payoff", response_model=StrategyComparisonOut)
def payoff(
    extra_cents: int = Query(default=0, ge=0, le=100_000_000),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> StrategyComparisonOut:
    """Both strategies over the same constant budget. See the module docstring
    for why this route reads the real clock."""
    debts = [
        DebtInput(id=row.id, name=row.name, principal_cents=row.principal_cents,
                  annual_rate_bps=row.annual_rate_bps,
                  minimum_payment_cents=row.minimum_payment_cents)
        for row in _active_debts(db, user.id)
    ]
    comparison = compare_strategies(debts, extra_cents, date.today())
    return StrategyComparisonOut(
        snowball=_plan_out(comparison.snowball),
        avalanche=_plan_out(comparison.avalanche),
        interest_saved_cents=comparison.interest_saved_cents,
        months_saved=comparison.months_saved,
    )


def _plan_out(plan: PayoffPlan) -> PayoffPlanOut:
    return PayoffPlanOut(
        strategy=plan.strategy,
        monthly_budget_cents=plan.monthly_budget_cents,
        first_month_interest_cents=plan.first_month_interest_cents,
        months=plan.months,
        cleared_on=plan.cleared_on,
        total_interest_cents=plan.total_interest_cents,
        total_paid_cents=plan.total_paid_cents,
        order=plan.order,
        payoffs=[
            DebtPayoffOut(debt_id=p.debt_id, name=p.name,
                          cleared_in_months=p.cleared_in_months, cleared_on=p.cleared_on,
                          interest_cents=p.interest_cents, paid_cents=p.paid_cents)
            for p in plan.payoffs
        ],
        points=[
            BalancePointOut(
                month=point.month, on=point.on,
                # JSON object keys are strings. Converted here, once, rather
                # than left for the frontend to discover.
                balances_cents={str(k): v for k, v in point.balances_cents.items()},
                total_cents=point.total_cents,
            )
            for point in plan.points
        ],
        unavailable_reason=plan.unavailable_reason,
    )


@router.get("", response_model=list[DebtOut])
def list_debts(user: User = Depends(get_current_user),
               db: Session = Depends(get_db)) -> list[Debt]:
    return _active_debts(db, user.id)


@router.post("", response_model=DebtOut, status_code=status.HTTP_201_CREATED)
def create_debt(payload: DebtIn, user: User = Depends(get_current_user),
                db: Session = Depends(get_db)) -> Debt:
    _check_kind(payload.kind)
    debt = Debt(user_id=user.id, **payload.model_dump())
    db.add(debt)
    db.commit()
    db.refresh(debt)
    return debt


@router.patch("/{debt_id}", response_model=DebtOut)
def patch_debt(debt_id: int, payload: DebtPatch, user: User = Depends(get_current_user),
               db: Session = Depends(get_db)) -> Debt:
    debt = _owned(db, user, debt_id)
    _check_kind(payload.kind)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(debt, field, value)
    db.commit()
    db.refresh(debt)
    return debt


@router.delete("/{debt_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_debt(debt_id: int, user: User = Depends(get_current_user),
                db: Session = Depends(get_db)) -> None:
    """Archiving, not deleting: a repaid debt is part of the household's history."""
    debt = _owned(db, user, debt_id)
    debt.archived = True
    db.commit()
```

- [ ] **Step 5: Register the router and name the new fields in French**

In `backend/app/main.py`, add `from app.api import debts as debt_routes` with the other imports and `api.include_router(debt_routes.router)` with the others.

In `backend/app/api/errors.py`, add to `FIELD_SUBJECTS`:

```python
    "principal_cents": "Le capital restant dû",
    "annual_rate_bps": "Le taux annuel",
    "minimum_payment_cents": "La mensualité",
    "term_months": "La durée",
    "extra_cents": "Le versement supplémentaire",
```

Phase 2A left `months` and `threshold_cents` out of this map and the validation message fell back to the raw identifier. Do not repeat it: every field this task introduces gets an entry.

- [ ] **Step 6: Run the tests to verify they pass**

Run from `backend/`: `.venv/Scripts/pytest.exe tests/test_debts_api.py -v`
Expected: PASS, 9 tests.

- [ ] **Step 7: Full suite and commit**

Run from `backend/`: `.venv/Scripts/pytest.exe -q`
Expected: **580** passed.

```bash
git add backend/app/api/debts.py backend/app/schemas/debts.py backend/app/main.py backend/app/api/errors.py backend/tests/test_debts_api.py
git commit -m "feat(api): expose debts and their snowball/avalanche payoff plans"
```

---

### Task 6: `/dettes` — the screen and the payoff chart

**Files:**
- Create: `frontend/src/features/debts/DebtsPage.tsx`, `DebtsPage.css`, `DebtForm.tsx`, `DebtsPage.test.tsx`, `DebtForm.test.tsx`
- Create: `frontend/src/charts/DebtPayoffChart.tsx`, `DebtPayoffChart.test.tsx`
- Modify: `frontend/src/lib/types.ts`, `frontend/src/app/routes.tsx`, `frontend/src/app/AppShell.tsx`

**Interfaces:**
- Consumes: `GET/POST/PATCH/DELETE /api/debts`, `GET /api/debts/payoff` (Task 5).
- Produces: route `/dettes`, nav entry "Dettes". `Debt`, `PayoffPlan`, `StrategyComparison`, `DebtPayoff`, `BalancePoint` types in `lib/types.ts`, consumed by Task 16 (the feasibility screen names the household's existing instalments).

- [ ] **Step 1: Add the mirror types**

Append to `frontend/src/lib/types.ts`:

```typescript
/** `principal_cents` is a POSITIVE magnitude — capital restant dû. The one
 *  deliberate exception to the negative-means-outflow convention every other
 *  amount in this file follows. Do not negate it for display. */
export interface Debt {
  id: number;
  name: string;
  kind: string;
  principal_cents: number;
  /** Basis points: 490 is 4,90 %/an. */
  annual_rate_bps: number;
  minimum_payment_cents: number;
  term_months: number | null;
  opened_on: string | null;
  archived: boolean;
}

export interface DebtPayoff {
  debt_id: number;
  name: string;
  cleared_in_months: number;
  cleared_on: string;
  interest_cents: number;
  paid_cents: number;
}

export interface BalancePoint {
  month: number;
  on: string;
  /** Keyed by debt id AS A STRING — JSON object keys always are. Every debt in
   *  the plan appears at every point, cleared ones as 0, so a stacked chart has
   *  a value for every series at every x. */
  balances_cents: Record<string, number>;
  total_cents: number;
}

export interface PayoffPlan {
  strategy: string;
  monthly_budget_cents: number;
  first_month_interest_cents: number;
  /** null exactly when `unavailable_reason` is set. 0 with a null reason is a
   *  user with no debts — an answer, not a refusal. */
  months: number | null;
  cleared_on: string | null;
  total_interest_cents: number;
  total_paid_cents: number;
  order: number[];
  payoffs: DebtPayoff[];
  /** Empty on both refusal branches and on an empty debt list. Check `months`
   *  before rendering a chart from it. */
  points: BalancePoint[];
  /** French, from the engine. Print verbatim — it names which of two distinct
   *  causes applies, and paraphrasing is how this project has repeatedly ended
   *  up telling the user the wrong one. */
  unavailable_reason: string | null;
}

export interface StrategyComparison {
  snowball: PayoffPlan;
  avalanche: PayoffPlan;
  /** null when either plan refused. 0 is a real answer (one debt, or two with
   *  the same rate); null is not. */
  interest_saved_cents: number | null;
  months_saved: number | null;
}
```

- [ ] **Step 2: Write the failing chart test**

Create `frontend/src/charts/DebtPayoffChart.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "../app/ThemeProvider";
import { DebtPayoffChart, buildPayoffOption } from "./DebtPayoffChart";
import type { BalancePoint } from "../lib/types";

const POINTS: BalancePoint[] = [
  { month: 1, on: "2026-09-30", balances_cents: { "1": 20000, "2": 80000 }, total_cents: 100000 },
  { month: 2, on: "2026-10-31", balances_cents: { "1": 0, "2": 60000 }, total_cents: 60000 },
];
const NAMES = new Map([
  [1, "Conso"],
  [2, "Auto"],
]);

describe("buildPayoffOption", () => {
  it("stacks with stackStrategy 'all' on every series", () => {
    // ECharts chains a stacked value onto the previous series ONLY when both
    // share the same sign (dataStack.js:87,115-118). Two charts in this
    // codebase shipped drawing negative values above zero for exactly this
    // reason. A remaining balance is never negative today, but the guard is
    // one line and its absence is invisible until it is not.
    const option = buildPayoffOption(POINTS, NAMES, "light");
    const series = option.series as Array<Record<string, unknown>>;
    expect(series).toHaveLength(2);
    for (const item of series) {
      expect(item.stack).toBe("solde");
      expect(item.stackStrategy).toBe("all");
    }
  });

  it("gives every debt a value at every month, cleared ones included", () => {
    const option = buildPayoffOption(POINTS, NAMES, "light");
    const series = option.series as Array<{ name: string; data: number[] }>;
    expect(series.map((s) => s.name)).toEqual(["Conso", "Auto"]);
    expect(series[0].data).toEqual([200, 0]);
    expect(series[1].data).toEqual([800, 600]);
  });

  it("labels the x axis with French months", () => {
    const option = buildPayoffOption(POINTS, NAMES, "light");
    const axis = option.xAxis as { data: string[] };
    expect(axis.data[0]).toMatch(/sept/i);
  });
});

describe("DebtPayoffChart", () => {
  it("carries an accessible description naming both ends of the plan", () => {
    vi.stubGlobal("ResizeObserver", undefined);
    render(
      <ThemeProvider>
        <DebtPayoffChart points={POINTS} names={NAMES} />
      </ThemeProvider>,
    );
    const figure = screen.getByRole("img");
    expect(figure.getAttribute("aria-label")).toContain("30 septembre 2026");
    expect(figure.getAttribute("aria-label")).toContain("31 octobre 2026");
  });
});
```

- [ ] **Step 3: Write the chart**

Create `frontend/src/charts/DebtPayoffChart.tsx`:

```tsx
import type { EChartsOption } from "echarts";

import { frenchDate } from "../design/EmptyState";
import type { ResolvedTheme } from "../design/theme";
import { useTheme } from "../app/ThemeProvider";
import type { BalancePoint } from "../lib/types";
import { Chart } from "./Chart";
import { chartTokens, seriesColors } from "./theme";

/** "2026-09-30" → "sept. 2026". */
function monthLabel(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("fr-FR", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * One stacked area per debt: what is still owed, month by month, until the last
 * one clears.
 *
 * `stackStrategy: "all"` on every series, without exception. ECharts' default
 * is `"samesign"`, which chains a stacked value onto the previous series only
 * when the two share a sign; where it refuses, `stackedOverDimension` is left
 * NaN and the series falls back to `valueStart` — zero. Two charts in this
 * codebase shipped with that defect, one of them drawing the operator's
 * −2 209,63 € year as a bar rising above zero for two whole phases. Remaining
 * balances are non-negative today, so this is a guard rather than a fix; it
 * costs one line and it is the line whose absence nobody notices.
 */
export function buildPayoffOption(
  points: BalancePoint[],
  names: Map<number, string>,
  theme: ResolvedTheme,
): EChartsOption {
  const tokens = chartTokens(theme);
  const ramp = seriesColors(theme);
  const ids = points.length > 0 ? Object.keys(points[0].balances_cents) : [];

  return {
    grid: { left: 8, right: 8, top: 32, bottom: 8, containLabel: true },
    legend: { top: 0, right: 84 },
    tooltip: { trigger: "axis" },
    xAxis: { type: "category", data: points.map((point) => monthLabel(point.on)) },
    yAxis: {
      type: "value",
      axisLabel: {
        formatter: (value: number) => `${value.toLocaleString("fr-FR")} €`,
      },
    },
    series: ids.map((id, index) => ({
      type: "line" as const,
      name: names.get(Number(id)) ?? `Dette ${id}`,
      stack: "solde",
      stackStrategy: "all" as const,
      areaStyle: { opacity: 0.35 },
      showSymbol: false,
      color: ramp[index % ramp.length],
      // Euros, not cents: an axis labelled in cents reads as a hundredfold
      // error. The conversion happens here, at the display boundary, and the
      // CSV export below keeps the exact integer.
      data: points.map((point) => Math.round(point.balances_cents[id] / 100)),
    })),
    backgroundColor: tokens.surfaceStrong,
  };
}

interface DebtPayoffChartProps {
  points: BalancePoint[];
  names: Map<number, string>;
}

export function DebtPayoffChart({ points, names }: DebtPayoffChartProps) {
  const { resolved } = useTheme();
  if (points.length === 0) return null;

  const first = frenchDate(points[0].on);
  const last = frenchDate(points[points.length - 1].on);

  return (
    <Chart
      option={buildPayoffOption(points, names, resolved)}
      height={300}
      ariaLabel={`Capital restant dû, du ${first} au ${last}, une bande par dette.`}
      dataForExport={{
        filename: "remboursement-dettes",
        headers: ["Mois", ...Array.from(names.values())],
        rows: points.map((point) => {
          const row: Record<string, string | number> = { Mois: point.on };
          for (const [id, name] of names) row[name] = point.balances_cents[String(id)] ?? 0;
          return row;
        }),
      }}
    />
  );
}
```

**Check before writing:** `seriesColors(resolved)` is the existing per-series ramp accessor in `frontend/src/charts/theme.ts:112-114`; it returns `DARK_CATEGORICAL` or `LIGHT_CATEGORICAL`. Read the file and confirm the signature before importing it — phase 2A's ledger records that four entries across those two arrays clear 4.5:1 against neither white nor `--yd-text`, which is why on-mark labels use `--yd-chart-label-ink`. This chart puts no label on a mark, so only the legend text matters, and that sits on the card.

- [ ] **Step 4: Write the failing screen test**

Create `frontend/src/features/debts/DebtsPage.test.tsx` with these cases, using the project's existing `vi.mock("../../lib/api")` idiom (copy the mocking shape from `frontend/src/features/cashflow/CashflowPage.test.tsx`):

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "../../app/ThemeProvider";
import { api } from "../../lib/api";
import { DebtsPage } from "./DebtsPage";

vi.mock("../../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../../lib/api")>("../../lib/api");
  return { ...actual, api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } };
});

const DEBTS = [
  { id: 1, name: "Conso", kind: "consumer", principal_cents: 200_000, annual_rate_bps: 2000,
    minimum_payment_cents: 5_000, term_months: null, opened_on: null, archived: false },
  { id: 2, name: "Auto", kind: "auto", principal_cents: 50_000, annual_rate_bps: 500,
    minimum_payment_cents: 5_000, term_months: null, opened_on: null, archived: false },
];

const PLAN = (strategy: string, order: number[], interest: number) => ({
  strategy, monthly_budget_cents: 10_000, first_month_interest_cents: 3_542,
  months: 30, cleared_on: "2029-02-28", total_interest_cents: interest,
  total_paid_cents: 250_000 + interest, order,
  payoffs: [], points: [
    { month: 1, on: "2026-09-30", balances_cents: { "1": 198_000, "2": 47_000 },
      total_cents: 245_000 },
  ],
  unavailable_reason: null,
});

function renderPage() {
  return render(
    <ThemeProvider>
      <MemoryRouter>
        <DebtsPage />
      </MemoryRouter>
    </ThemeProvider>,
  );
}

describe("DebtsPage", () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.stubGlobal("ResizeObserver", undefined);
  });

  it("shows what choosing avalanche over snowball actually saves", async () => {
    vi.mocked(api.get).mockImplementation(async (path: string) =>
      path === "/debts"
        ? DEBTS
        : { snowball: PLAN("snowball", [2, 1], 40_000),
            avalanche: PLAN("avalanche", [1, 2], 31_000),
            interest_saved_cents: 9_000, months_saved: 2 } as never,
    );
    renderPage();
    expect(await screen.findByText(/90,00/)).toBeInTheDocument();
    expect(screen.getByText(/2 mois/)).toBeInTheDocument();
  });

  it("prints the engine's own refusal, and no chart, when the budget is too small", async () => {
    const refused = { ...PLAN("snowball", [1], 0), months: null, cleared_on: null,
      points: [], unavailable_reason:
        "La mensualité totale disponible ne couvre pas les intérêts du premier mois : le capital augmenterait au lieu de diminuer, et aucun échéancier ne peut être établi. Augmentez le versement mensuel, ou renégociez le taux de la dette la plus chère." };
    vi.mocked(api.get).mockImplementation(async (path: string) =>
      path === "/debts"
        ? DEBTS
        : { snowball: refused, avalanche: refused,
            interest_saved_cents: null, months_saved: null } as never,
    );
    renderPage();
    expect(await screen.findByText(/ne couvre pas les intérêts du premier mois/)).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    // And it must NOT be dressed as a load failure. Phase 2A shipped exactly
    // that: a deliberate refusal rendered in the negative alert under "Ce
    // panneau n'a pas pu être chargé".
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("says the household has no debts rather than refusing", async () => {
    vi.mocked(api.get).mockImplementation(async (path: string) =>
      path === "/debts"
        ? []
        : { snowball: { ...PLAN("snowball", [], 0), months: 0, points: [], cleared_on: null },
            avalanche: { ...PLAN("avalanche", [], 0), months: 0, points: [], cleared_on: null },
            interest_saved_cents: 0, months_saved: 0 } as never,
    );
    renderPage();
    expect(await screen.findByText(/Aucune dette enregistrée/)).toBeInTheDocument();
    expect(screen.queryByText(/ne couvre pas/)).not.toBeInTheDocument();
  });

  it("adds a debt and reloads both queries", async () => {
    vi.mocked(api.get).mockImplementation(async (path: string) =>
      path === "/debts" ? DEBTS : ({ snowball: PLAN("snowball", [2, 1], 40_000),
        avalanche: PLAN("avalanche", [1, 2], 31_000),
        interest_saved_cents: 9_000, months_saved: 2 } as never),
    );
    vi.mocked(api.post).mockResolvedValue(DEBTS[0] as never);
    renderPage();
    await screen.findByText("Conso");
    await userEvent.click(screen.getByRole("button", { name: /Ajouter une dette/ }));
    await userEvent.type(screen.getByLabelText(/Intitulé/), "Étudiant");
    await userEvent.type(screen.getByLabelText(/Capital restant dû/), "12000");
    await userEvent.type(screen.getByLabelText(/Mensualité/), "150");
    await userEvent.click(screen.getByRole("button", { name: /Enregistrer/ }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/debts",
      expect.objectContaining({ name: "Étudiant", principal_cents: 1_200_000,
        minimum_payment_cents: 15_000 })));
  });
});
```

- [ ] **Step 5: Write `DebtForm.tsx`**

A controlled form over `DebtIn`. Every euro field uses `parseCents` from `design/theme` — **never `parseFloat(x) * 100`**, which turns 8,70 into 869.9999999999999. The rate field takes a percentage and converts to basis points with the same string arithmetic: `Math.round(Number(text.replace(",", ".")) * 100)` is acceptable **only** on the rate, which is not money; add a comment saying so explicitly, because the next reader will otherwise copy it onto an amount.

Field errors render at the field, with `aria-invalid` and `aria-describedby` — not in a page-level alert, which at 375 px sits several screens above the input. That was phase 2A task 6's fix and it applies to every form this phase adds.

- [ ] **Step 6: Write `DebtsPage.tsx`**

Structure, on the existing bento grid:

1. `<h1>Dettes</h1>` plus a lead sentence.
2. The debt list: name, capital restant dû, rate as a percentage, monthly instalment, edit and archive. `formatCents` for every amount. Empty state: "Aucune dette enregistrée." with a diagnosis, not a restatement — say that debts are declared here because Yieldo cannot recognise a consumer loan from a statement line, and offer the add button.
3. The extra-payment control: a euro input, defaulting to 0, that re-queries `/debts/payoff?extra_cents=`. Debounced; while the request is in flight the panel carries `aria-busy` **and a visible busy state** — the missing busy state on a period change was phase 2A's most visible deferral and is not deferred again.
4. Two strategy panels side by side (stacked below 1200 px). Each: months, clearing date, total interest, total paid, and the attack order as a numbered list. Never say "à droite" or "ci-contre" — name the panel, because the layout stacks.
5. The saving: "Choisir l'avalanche plutôt que la boule de neige vous coûte X € d'intérêts en moins et vous libère N mois plus tôt." Rendered **only** when `interest_saved_cents !== null`. When it is 0 (one debt, or equal rates), say the two strategies cost the same here — do not print "0,00 € d'intérêts en moins", which reads as a bug.
6. `DebtPayoffChart` from the currently selected strategy's `points`, rendered only when `months !== null && points.length > 0`.
7. Refusal treatment, mirroring `CashflowPage`: `unavailable_reason` printed in the panel's own explanatory style, never in the negative-coloured alert reserved for something having gone wrong. A network failure keeps the alert.

- [ ] **Step 7: Wire the route and the nav**

`routes.tsx`: `{ path: "dettes", element: <DebtsPage /> }` inside the `AppShellRoute` children. `AppShell.tsx`: `{ to: "/dettes", label: "Dettes" }` after Analyse.

- [ ] **Step 8: Run the frontend suite and the build**

From `frontend/`: `npm test` — expected green, ~14 new tests. Then `npm run build` — **zero TypeScript errors**. Do not run `npm run lint`; eslint is not installed in this repo and the script has never worked.

- [ ] **Step 9: BROWSER GATE — the step that is not optional**

Seed and start:

```powershell
cd E:\Projet\Github\Yieldo\backend
.venv\Scripts\python.exe ..\.superpowers\sdd\2026-08-12-yieldo-phase-1-5-interface\seed_fixture.py
Get-NetTCPConnection -LocalPort 8000 -ErrorAction SilentlyContinue
Start-Process -FilePath .\.venv\Scripts\uvicorn.exe -ArgumentList "app.main:app","--port","8000" -WindowStyle Hidden
cd ..\frontend
Start-Process -FilePath npm -ArgumentList "run","dev" -WindowStyle Hidden
```

`Get-NetTCPConnection` must show **no** listener before you start, and the PID after must be the one you just launched. A stale `uvicorn --reload` worker serving pre-fix code has cost this project two separate rounds.

Log in as `demo@yieldo-demo.fr` / `MotDePasseDemo123!`, go to `/dettes`, and:

- The operator has **no debts**. Confirm the empty state reads as an invitation, not as a failure, and that neither refusal message appears.
- Add three debts by hand so the real screen is exercised: a 12 000 € consumer loan at 6,90 % paying 250 €/month, a 4 500 € card at 19,90 % paying 120 €/month, and an 850 € store credit at 0 % paying 50 €/month. Confirm the two orders differ, the saving is positive, and the chart draws three bands.
- Set the extra payment to 1 € and confirm the plan lengthens; set it to 500 € and confirm it shortens.
- Screenshots at **375, 768 and 1440 px, in both themes** — twelve in all, attached to the task report. Check specifically: the numbered attack order does not overflow at 375; the chart legend does not render under the Exporter button (`legend.right: 84` is there for that reason — phase 2A found "Sold\*Exporte\*r" at 375 on the cashflow chart); no horizontal scroll on `<body>`; the browser console is clean.

- [ ] **Step 10: Commit**

```bash
git add frontend/src/features/debts frontend/src/charts/DebtPayoffChart.tsx frontend/src/charts/DebtPayoffChart.test.tsx frontend/src/lib/types.ts frontend/src/app/routes.tsx frontend/src/app/AppShell.tsx
git commit -m "feat(debts): show both payoff strategies and what avalanche saves"
```

---
# Lot C — Objectifs

### Task 7: Goal progress, milestones and sequential funding

Design §4.1 gives `goals` its fields; §6.2's engagement section gives the milestones their shape: "étapes intermédiaires automatiques (25 %, 50 %, 75 %) sur chaque objectif d'épargne, avec la date projetée d'atteinte". **Phase 2C consumes `Milestone` exactly as built here** — it is the only thing 2C takes from this plan besides the measured capacity, and changing its shape later means changing it in two phases.

**Files:**
- Create: `backend/app/engines/goal.py`
- Test: `backend/tests/test_goal.py`

**Interfaces:**
- Consumes: `app.engines.period.month_end` (Task 4), `app.engines.savings.MAX_PROJECTION_MONTHS` (Task 2).
- Produces:
  - `GoalInput` frozen dataclass: `id`, `name`, `target_cents`, `saved_cents`, `due_on: date | None`, `priority: int`.
  - `Milestone` frozen dataclass: `percent: int`, `threshold_cents: int`, `reached: bool`, `months_away: int | None`, `projected_on: date | None`. **Phase 2C's jalons read this.**
  - `GoalProgress` frozen dataclass: `goal_id`, `name`, `target_cents`, `saved_cents`, `remaining_cents`, `progress_ratio: float`, `milestones: list[Milestone]`, `funding_starts_in_months: int`, `months_to_completion: int | None`, `projected_completion_on: date | None`, `projection_unavailable_reason: str | None`, `due_on: date | None`, `months_until_due: int | None`, `on_track: bool | None`.
  - `evaluate_goals(goals: list[GoalInput], monthly_capacity_cents: int | None, today: date) -> list[GoalProgress]`
  - Constant `MILESTONE_PERCENTS = (25, 50, 75, 100)`.
  - Consumed by Task 8 (`/api/goals`) and by **phase 2C**.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_goal.py`:

```python
from datetime import date

from app.engines.goal import MILESTONE_PERCENTS, GoalInput, evaluate_goals

TODAY = date(2026, 8, 25)


def _goal(id_, target, saved=0, priority=100, due=None, name=None) -> GoalInput:
    return GoalInput(id=id_, name=name or f"Objectif {id_}", target_cents=target,
                     saved_cents=saved, due_on=due, priority=priority)


def test_progress_and_the_four_milestones():
    """600 000 c target, 100 000 c saved, 50 000 c/month measured capacity.
    Thresholds 150 000 / 300 000 / 450 000 / 600 000; months away 1 / 4 / 7 / 10."""
    [progress] = evaluate_goals([_goal(1, 600_000, saved=100_000)], 50_000, TODAY)
    assert progress.remaining_cents == 500_000
    assert progress.progress_ratio == 100_000 / 600_000
    assert [m.percent for m in progress.milestones] == list(MILESTONE_PERCENTS)
    assert [m.threshold_cents for m in progress.milestones] == [150_000, 300_000, 450_000, 600_000]
    assert [m.months_away for m in progress.milestones] == [1, 4, 7, 10]
    assert progress.months_to_completion == 10
    assert progress.projected_completion_on == date(2027, 6, 30)


def test_a_milestone_already_reached_carries_no_projected_date():
    """Yieldo has no history for `saved_cents` -- it is a figure the user
    declares -- so it cannot say WHEN a passed milestone was passed. `None`
    rather than a date, and never `today`, which would claim it happened now."""
    [progress] = evaluate_goals([_goal(1, 400_000, saved=250_000)], 50_000, TODAY)
    reached = [m for m in progress.milestones if m.reached]
    assert [m.percent for m in reached] == [25, 50]
    assert all(m.projected_on is None and m.months_away is None for m in reached)


def test_a_milestone_threshold_rounds_up_so_the_fraction_is_really_held():
    """25 % of 1 001 c is 250,25 c. Reaching the quarter means holding 251 c,
    not 250 -- the ceiling, so the milestone never fires a cent early."""
    [progress] = evaluate_goals([_goal(1, 1_001)], 100, TODAY)
    assert progress.milestones[0].threshold_cents == 251


def test_goals_are_funded_one_at_a_time_in_priority_order():
    """The household has ONE measured capacity. Applying it in full to every
    goal in parallel would report five goals all completing at once, which is
    arithmetically impossible. The most urgent goal takes the whole capacity
    until it completes; the next starts then."""
    goals = [_goal(2, 300_000, priority=200, name="Voyage"),
             _goal(1, 500_000, priority=1, name="Urgence")]
    urgence, voyage = evaluate_goals(goals, 50_000, TODAY)
    assert urgence.name == "Urgence"
    assert urgence.funding_starts_in_months == 0
    assert urgence.months_to_completion == 10
    assert voyage.name == "Voyage"
    assert voyage.funding_starts_in_months == 10
    assert voyage.months_to_completion == 16
    assert voyage.milestones[-1].months_away == 16


def test_a_completed_goal_does_not_hold_up_the_queue():
    goals = [_goal(1, 100_000, saved=100_000, priority=1),
             _goal(2, 300_000, priority=2)]
    done, next_up = evaluate_goals(goals, 50_000, TODAY)
    assert done.remaining_cents == 0
    assert done.months_to_completion == 0
    assert done.projected_completion_on == TODAY
    assert next_up.funding_starts_in_months == 0
    assert next_up.months_to_completion == 6


def test_an_unmeasurable_capacity_refuses_with_its_own_reason():
    """Below three complete observed months `capacity.measure_savings_capacity`
    returns None. No date can be projected from nothing."""
    [progress] = evaluate_goals([_goal(1, 600_000)], None, TODAY)
    assert progress.projected_completion_on is None
    assert progress.months_to_completion is None
    assert progress.projection_unavailable_reason is not None
    assert "mesurée" in progress.projection_unavailable_reason
    assert "négative" not in progress.projection_unavailable_reason
    assert all(m.projected_on is None for m in progress.milestones)


def test_a_negative_measured_capacity_refuses_with_a_DIFFERENT_reason():
    """THE OPERATOR'S OWN CASE: his measured savings capacity is -74 619 c per
    month. The goal does not merely progress slowly -- it does not progress at
    all, and the reason must say THAT and not "pas assez d'historique", which
    is a different cause with a different remedy. Naming the wrong cause is the
    single most expensive failure mode in this project's history."""
    [progress] = evaluate_goals([_goal(1, 600_000)], -74_619, TODAY)
    assert progress.projected_completion_on is None
    assert progress.projection_unavailable_reason is not None
    assert "négative" in progress.projection_unavailable_reason
    assert "historique" not in progress.projection_unavailable_reason
    assert progress.on_track is None


def test_a_zero_capacity_takes_the_same_branch_as_a_negative_one():
    [progress] = evaluate_goals([_goal(1, 600_000)], 0, TODAY)
    assert progress.projection_unavailable_reason is not None
    assert "négative" in progress.projection_unavailable_reason


def test_a_projection_past_fifty_years_refuses_with_a_third_reason():
    [progress] = evaluate_goals([_goal(1, 100_000_000)], 100, TODAY)
    assert progress.months_to_completion is None
    assert progress.projection_unavailable_reason is not None
    assert "ans" in progress.projection_unavailable_reason
    assert "négative" not in progress.projection_unavailable_reason


def test_on_track_compares_the_projection_with_the_deadline():
    on_time = evaluate_goals([_goal(1, 600_000, due=date(2027, 12, 31))], 50_000, TODAY)[0]
    late = evaluate_goals([_goal(1, 600_000, due=date(2026, 12, 31))], 50_000, TODAY)[0]
    assert on_time.on_track is True
    assert late.on_track is False
    assert on_time.months_until_due == 16
    assert late.months_until_due == 4


def test_on_track_is_none_without_a_deadline_and_without_a_projection():
    """Three states, not two. `False` means "vous n'y arriverez pas"; `None`
    means "on ne peut pas se prononcer". Collapsing them puts an accusation on
    a screen that has no basis for one."""
    no_due = evaluate_goals([_goal(1, 600_000)], 50_000, TODAY)[0]
    no_projection = evaluate_goals(
        [_goal(1, 600_000, due=date(2027, 1, 31))], -74_619, TODAY)[0]
    assert no_due.on_track is None
    assert no_projection.on_track is None
    assert no_projection.months_until_due == 5


def test_an_overfunded_goal_is_reported_as_it_is_not_clamped():
    [progress] = evaluate_goals([_goal(1, 100_000, saved=150_000)], 50_000, TODAY)
    assert progress.progress_ratio == 1.5
    assert progress.remaining_cents == 0
    assert all(m.reached for m in progress.milestones)
```

- [ ] **Step 2: Run it and watch it fail**

Run from `backend/`: `.venv/Scripts/pytest.exe tests/test_goal.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.engines.goal'`

- [ ] **Step 3: Write the implementation**

Create `backend/app/engines/goal.py`:

```python
"""Savings goals: how far along, and when each step lands.

Design §4.1 gives the fields; §6.2's engagement section gives the milestones
their shape -- 25 %, 50 %, 75 %, "avec la date projetée d'atteinte".
**Phase 2C's "jalons d'objectifs" reads `Milestone` exactly as defined here.**

**Goals are funded one at a time, in priority order.** The household has one
measured savings capacity. Applying it in full to every goal independently
would report five goals all completing at the same date, which is
arithmetically impossible and is precisely the kind of confident-looking
falsehood every review in this project has been catching. The most urgent goal
(lowest `priority`, then lowest id) takes the whole capacity until it
completes; the next starts then. `funding_starts_in_months` says when each
goal's own clock begins, so a screen can explain a far-off date rather than
leaving the user to wonder.

**Three distinct refusals, mutually exclusive by construction**, because a
household told the wrong cause takes the wrong action:

* the capacity could not be measured at all (`None` -- fewer than three
  complete observed months). Remedy: import more statements;
* the measured capacity is negative or zero. **This is the operator's own
  state: -74 619 c per month.** The goal does not progress slowly; it does not
  progress. Remedy: spend less or earn more. Telling him "pas assez
  d'historique" here would send him to the import screen to fix something that
  is not broken;
* the projection runs past fifty years.

Pure: no session, no network, no implicit clock -- `today` is a parameter.
"""

from dataclasses import dataclass
from datetime import date

from app.engines.period import month_end
from app.engines.savings import MAX_PROJECTION_MONTHS

# Design §6.2. 100 is included so the completion itself is a milestone with the
# same shape as the other three -- phase 2C renders one list, not three plus a
# special case.
MILESTONE_PERCENTS = (25, 50, 75, 100)


@dataclass(frozen=True)
class GoalInput:
    id: int
    name: str
    target_cents: int
    # Declared by the user, not measured: Yieldo cannot tell which euros in a
    # savings account belong to which goal.
    saved_cents: int
    due_on: date | None
    # Lower is more urgent. See the module docstring on sequential funding.
    priority: int


@dataclass(frozen=True)
class Milestone:
    """One step of a goal. **Phase 2C's engagement mechanics consume this.**

    `reached` and `projected_on` are not two views of one fact:

    * a reached milestone has `projected_on is None` and `months_away is None`,
      because `saved_cents` is a declared figure with no history behind it and
      Yieldo genuinely does not know when the threshold was crossed. `today`
      would claim it happened now;
    * an unreached milestone has a date exactly when a capacity was measurable
      and positive, and `None` otherwise -- in which case the goal's own
      `projection_unavailable_reason` says why, once, rather than four times.
    """

    percent: int
    # The ceiling of `percent`% of the target, so reaching a quarter means
    # holding at least a quarter and the milestone never fires a cent early.
    threshold_cents: int
    reached: bool
    months_away: int | None
    projected_on: date | None


@dataclass(frozen=True)
class GoalProgress:
    goal_id: int
    name: str
    target_cents: int
    saved_cents: int
    # Floored at 0: an overfunded goal needs nothing more. The overfunding
    # itself is still visible in `progress_ratio`, which is NOT clamped.
    remaining_cents: int
    progress_ratio: float
    milestones: list[Milestone]
    # How many months pass before this goal starts receiving anything, under
    # the one-at-a-time funding rule. 0 for the most urgent unfinished goal.
    funding_starts_in_months: int
    # Includes the wait above. None exactly when
    # `projection_unavailable_reason` is set. 0 on an already-completed goal.
    months_to_completion: int | None
    projected_completion_on: date | None
    # French. Set exactly when `months_to_completion` is None, and it names
    # WHICH of three causes applies. Never two at once.
    projection_unavailable_reason: str | None
    due_on: date | None
    # Whole calendar months from today's month to the deadline's; negative when
    # the deadline has passed. None when there is no deadline.
    months_until_due: int | None
    # Three states, deliberately. True/False are verdicts; None means no
    # verdict is possible -- no deadline, or no projection to compare with it.
    # Collapsing None into False puts an accusation on screen without a basis.
    on_track: bool | None


def _threshold_cents(target_cents: int, percent: int) -> int:
    """Ceiling of `percent`% of the target, in integer cents."""
    return -(-target_cents * percent // 100)


def _months_for(remaining_cents: int, capacity_cents: int) -> int:
    """Whole months of `capacity_cents` needed to cover `remaining_cents`."""
    return -(-remaining_cents // capacity_cents)


def _reason_no_capacity() -> str:
    return (
        "Votre capacité d'épargne n'a pas pu être mesurée : il faut au moins "
        "trois mois complets de relevés. Aucune date ne peut être projetée "
        "tant qu'elle n'est pas connue."
    )


def _reason_capacity_not_positive() -> str:
    return (
        "Votre capacité d'épargne mesurée est négative ou nulle : au rythme "
        "constaté dans vos relevés, cet objectif ne progresse pas, et aucune "
        "date d'atteinte ne peut être avancée."
    )


def _reason_too_far() -> str:
    return (
        f"Au rythme mesuré, cet objectif ne serait pas atteint avant "
        f"{MAX_PROJECTION_MONTHS // 12} ans. Aucune date n'est avancée au-delà : "
        "elle ne voudrait rien dire."
    )


def _months_until(today: date, due_on: date | None) -> int | None:
    if due_on is None:
        return None
    return (due_on.year - today.year) * 12 + (due_on.month - today.month)


def evaluate_goals(
    goals: list[GoalInput], monthly_capacity_cents: int | None, today: date
) -> list[GoalProgress]:
    """Every goal, in funding order, with its milestones and its own reason.

    `monthly_capacity_cents` is `capacity.measure_savings_capacity(...)
    .median_cents`, or `None` when that function refused. The sign is kept: a
    household spending more than it earns has a negative capacity, and clamping
    it to zero here would let a goal read "en bonne voie" for someone going
    backwards every month.
    """
    ordered = sorted(goals, key=lambda goal: (goal.priority, goal.id))
    results: list[GoalProgress] = []
    offset_months = 0

    for goal in ordered:
        remaining = max(0, goal.target_cents - goal.saved_cents)
        ratio = goal.saved_cents / goal.target_cents if goal.target_cents else 0.0
        months_until_due = _months_until(today, goal.due_on)

        if remaining == 0:
            # Already there. It consumes no capacity, so it does not push the
            # goals behind it back, and it needs no reason.
            results.append(GoalProgress(
                goal_id=goal.id, name=goal.name, target_cents=goal.target_cents,
                saved_cents=goal.saved_cents, remaining_cents=0, progress_ratio=ratio,
                milestones=[
                    Milestone(percent=percent,
                              threshold_cents=_threshold_cents(goal.target_cents, percent),
                              reached=True, months_away=None, projected_on=None)
                    for percent in MILESTONE_PERCENTS
                ],
                funding_starts_in_months=offset_months, months_to_completion=0,
                projected_completion_on=today, projection_unavailable_reason=None,
                due_on=goal.due_on, months_until_due=months_until_due,
                on_track=None if goal.due_on is None else today <= goal.due_on,
            ))
            continue

        reason: str | None = None
        own_months: int | None = None
        if monthly_capacity_cents is None:
            reason = _reason_no_capacity()
        elif monthly_capacity_cents <= 0:
            reason = _reason_capacity_not_positive()
        else:
            own_months = _months_for(remaining, monthly_capacity_cents)
            if offset_months + own_months > MAX_PROJECTION_MONTHS:
                reason = _reason_too_far()
                own_months = None

        milestones: list[Milestone] = []
        for percent in MILESTONE_PERCENTS:
            threshold = _threshold_cents(goal.target_cents, percent)
            if goal.saved_cents >= threshold:
                milestones.append(Milestone(percent=percent, threshold_cents=threshold,
                                            reached=True, months_away=None, projected_on=None))
                continue
            if own_months is None or monthly_capacity_cents is None:
                milestones.append(Milestone(percent=percent, threshold_cents=threshold,
                                            reached=False, months_away=None, projected_on=None))
                continue
            away = offset_months + _months_for(threshold - goal.saved_cents,
                                               monthly_capacity_cents)
            milestones.append(Milestone(percent=percent, threshold_cents=threshold,
                                        reached=False, months_away=away,
                                        projected_on=month_end(today, away)))

        total_months = None if own_months is None else offset_months + own_months
        completion = None if total_months is None else month_end(today, total_months)
        results.append(GoalProgress(
            goal_id=goal.id, name=goal.name, target_cents=goal.target_cents,
            saved_cents=goal.saved_cents, remaining_cents=remaining, progress_ratio=ratio,
            milestones=milestones, funding_starts_in_months=offset_months,
            months_to_completion=total_months, projected_completion_on=completion,
            projection_unavailable_reason=reason, due_on=goal.due_on,
            months_until_due=months_until_due,
            on_track=None if (goal.due_on is None or completion is None)
            else completion <= goal.due_on,
        ))
        if total_months is not None:
            offset_months = total_months

    return results
```

- [ ] **Step 4: Run the test to verify it passes**

Run from `backend/`: `.venv/Scripts/pytest.exe tests/test_goal.py -v`
Expected: PASS, 12 tests.

- [ ] **Step 5: Mutation-check the three reasons and the funding queue**

Apply each alone against a restored file:

1. Swap `_reason_no_capacity()` and `_reason_capacity_not_positive()`. Expected: **both** refusal tests go red on their negative assertions (`"négative" not in` / `"historique" not in`). Those negative halves are the whole test; without them a swapped pair passes.
2. Delete `offset_months = total_months` at the end of the loop (parallel funding). Expected: `test_goals_are_funded_one_at_a_time_in_priority_order` goes red — Voyage completes in 6 months instead of 16.
3. Change `_threshold_cents` to floor division. Expected: `test_a_milestone_threshold_rounds_up_so_the_fraction_is_really_held` goes red. The 600 000 c fixture divides exactly and cannot see it — keep both tests, for the reason phase 2A task 17 records.
4. Change `on_track` to `False` where it currently returns `None`. Expected: `test_on_track_is_none_without_a_deadline_and_without_a_projection` goes red.

- [ ] **Step 6: Full suite and commit**

Run from `backend/`: `.venv/Scripts/pytest.exe -q --cov=app/engines --cov-report=term-missing`
Expected: **592** passed, `goal.py` at 100 %.

```bash
git add backend/app/engines/goal.py backend/tests/test_goal.py
git commit -m "feat(engines): project goal milestones from the measured savings capacity"
```

---

### Task 8: `/api/goals` — CRUD, and progress against the measured capacity

**Files:**
- Create: `backend/app/api/goals.py`, `backend/app/schemas/goals.py`
- Modify: `backend/app/main.py`, `backend/app/api/errors.py`
- Test: `backend/tests/test_goals_api.py`

**Interfaces:**
- Consumes: `app.engines.goal.{GoalInput, evaluate_goals}`, `app.engines.capacity.{MonthlyEntry, complete_months, measure_savings_capacity}`, `app.api.common.recurrence_points`, `app.api.history.user_history`.
- Produces:
  - `GET /api/goals` → `GoalReportOut` (the goals with their progress, plus the measured capacity and the ledger bounds behind it)
  - `POST /api/goals` → `GoalOut`, 201 · `PATCH /api/goals/{goal_id}` → `GoalOut` · `DELETE /api/goals/{goal_id}` → 204, archives
  - Schemas `GoalIn`, `GoalPatch`, `GoalOut`, `MilestoneOut`, `GoalProgressOut`, `GoalReportOut`.
  - Consumed by Task 9 (screen) and by **phase 2C** (`MilestoneOut`).

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_goals_api.py`:

```python
def _register(client, email="objectifs@example.fr"):
    body = client.post("/api/auth/register", json={
        "name": "Max", "email": email, "password": "motdepasse123"}).json()
    return {"Authorization": f"Bearer {body['access_token']}"}


def _create(client, headers, **overrides):
    payload = {"name": "Fonds d'urgence", "target_cents": 600_000, "saved_cents": 100_000,
               "due_on": None, "priority": 1}
    payload.update(overrides)
    return client.post("/api/goals", headers=headers, json=payload)


def test_a_goal_round_trips_and_archives(client):
    headers = _register(client)
    created = _create(client, headers)
    assert created.status_code == 201
    goal_id = created.json()["id"]
    assert client.delete(f"/api/goals/{goal_id}", headers=headers).status_code == 204
    assert client.get("/api/goals", headers=headers).json()["goals"] == []


def test_a_goal_target_must_be_strictly_positive(client):
    headers = _register(client)
    assert _create(client, headers, target_cents=0).status_code == 422


def test_progress_refuses_without_enough_history(client):
    """A brand-new user has no transactions, so `measure_savings_capacity`
    returns None and every goal says so -- with the month-count reason, not
    the negative-capacity one."""
    headers = _register(client)
    _create(client, headers)
    body = client.get("/api/goals", headers=headers).json()
    assert body["capacity"] is None
    progress = body["goals"][0]
    assert progress["months_to_completion"] is None
    assert "trois mois complets" in progress["projection_unavailable_reason"]
    assert body["months_observed"] == 0


def test_progress_is_measured_from_real_transactions(client, imported):
    """`imported` seeds the Boursorama sample. Whatever it measures, the
    payload must state the sample size beside the figure -- a rate quoted
    without its provenance invites the reader to treat it as a certainty."""
    headers, _account_id = imported
    _create(client, headers)
    body = client.get("/api/goals", headers=headers).json()
    assert body["months_observed"] >= 0
    if body["capacity"] is not None:
        assert body["capacity"]["months"] == body["months_observed"]
        assert body["capacity"]["low_cents"] <= body["capacity"]["median_cents"]
        assert body["capacity"]["median_cents"] <= body["capacity"]["high_cents"]


def test_goals_are_returned_in_funding_order_with_their_wait(client):
    headers = _register(client)
    _create(client, headers, name="Voyage", target_cents=300_000, saved_cents=0, priority=200)
    _create(client, headers, name="Urgence", target_cents=500_000, saved_cents=0, priority=1)
    body = client.get("/api/goals", headers=headers).json()
    assert [g["name"] for g in body["goals"]] == ["Urgence", "Voyage"]
    assert body["goals"][0]["funding_starts_in_months"] == 0


def test_the_milestones_are_the_four_the_engagement_phase_will_read(client):
    headers = _register(client)
    _create(client, headers)
    [progress] = client.get("/api/goals", headers=headers).json()["goals"]
    assert [m["percent"] for m in progress["milestones"]] == [25, 50, 75, 100]
    assert [m["threshold_cents"] for m in progress["milestones"]] == [
        150_000, 300_000, 450_000, 600_000]


def test_goals_never_cross_users(client):
    alice = _register(client, "alice2@example.fr")
    bob = _register(client, "bob2@example.fr")
    _create(client, alice, name="Alice")
    bob_goal = _create(client, bob, name="Bob").json()
    assert [g["name"] for g in client.get("/api/goals", headers=alice).json()["goals"]] == ["Alice"]
    assert [g["name"] for g in client.get("/api/goals", headers=bob).json()["goals"]] == ["Bob"]
    assert client.patch(f"/api/goals/{bob_goal['id']}", headers=alice,
                        json={"name": "volé"}).status_code == 404
    assert client.get("/api/goals", headers=bob).json()["goals"][0]["name"] == "Bob"
```

- [ ] **Step 2: Run it and watch it fail**

Run from `backend/`: `.venv/Scripts/pytest.exe tests/test_goals_api.py -v`
Expected: FAIL — 404 on every route.

- [ ] **Step 3: Write the schemas**

Create `backend/app/schemas/goals.py`:

```python
"""Wire shapes for /api/goals.

`GoalReportOut` carries the measured capacity beside the goals, never just the
dates it produced: a projected date quoted without the rate and the sample size
behind it invites the reader to treat it as a commitment. Same contract
`schemas/cashflow.py` established for the runway's two scenarios.
"""

from datetime import date

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.cashflow import MeasuredRateOut
from app.schemas.history import HistoryOut


class GoalIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    target_cents: int = Field(gt=0)
    saved_cents: int = Field(default=0, ge=0)
    due_on: date | None = None
    # Lower is more urgent; goals are funded one at a time in this order.
    priority: int = Field(default=100, ge=1, le=999)


class GoalPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    target_cents: int | None = Field(default=None, gt=0)
    saved_cents: int | None = Field(default=None, ge=0)
    due_on: date | None = None
    priority: int | None = Field(default=None, ge=1, le=999)
    archived: bool | None = None


class GoalOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    target_cents: int
    saved_cents: int
    due_on: date | None
    priority: int
    archived: bool


class MilestoneOut(BaseModel):
    """One step of a goal. **Phase 2C's "jalons d'objectifs" reads this shape.**

    A REACHED milestone carries `projected_on: null` and `months_away: null`,
    and that is not a gap: `saved_cents` is declared by the user with no history
    behind it, so Yieldo does not know when the threshold was crossed. Rendering
    today's date there would claim it happened now.
    """

    percent: int
    threshold_cents: int
    reached: bool
    months_away: int | None
    projected_on: date | None


class GoalProgressOut(BaseModel):
    goal_id: int
    name: str
    target_cents: int
    saved_cents: int
    # Floored at 0. `progress_ratio` is NOT clamped, so an overfunded goal
    # still reads above 1.0.
    remaining_cents: int
    progress_ratio: float
    milestones: list[MilestoneOut]
    # Months before this goal starts receiving anything: goals are funded one
    # at a time, in priority order, out of the household's single measured
    # capacity. The screen must state this, or a far-off date reads as a bug.
    funding_starts_in_months: int
    # null exactly when `projection_unavailable_reason` is set.
    months_to_completion: int | None
    projected_completion_on: date | None
    # French. Names WHICH of three causes applies: no measurable capacity, a
    # capacity that is negative or zero, or a projection past fifty years.
    # Print it verbatim.
    projection_unavailable_reason: str | None
    due_on: date | None
    months_until_due: int | None
    # THREE states. null is not false: it means no verdict is possible, either
    # because there is no deadline or because no date could be projected.
    on_track: bool | None


class GoalReportOut(BaseModel):
    # In funding order (priority, then id) -- not the order they were created.
    goals: list[GoalProgressOut]
    # The measured monthly savings capacity behind every date above, or null
    # when fewer than three complete months could be observed. **Signed**: a
    # household spending more than it earns has a negative median here, and the
    # screen must say so rather than showing an empty progress projection.
    capacity: MeasuredRateOut | None
    # Complete observed months -- the sample the capacity rests on. 0 on an
    # empty ledger.
    months_observed: int
    # The ledger's own span, so "3 complete months" can be told apart from
    # "3 complete months inside a thirteen-month ledger with a nine-month
    # import hole", which is the operator's actual situation.
    history: HistoryOut | None
```

- [ ] **Step 4: Write the router**

Create `backend/app/api/goals.py`:

```python
"""GET/POST/PATCH/DELETE /api/goals.

The clock is read here and handed to `evaluate_goals` as a parameter. This
route uses the real `date.today()`: nothing in `engines/goal.py` classifies
anything by staleness, and `today` only anchors forward projection dates, which
must count from now. That is the same reasoning `api/cashflow.py`'s runway
route sets out, and NOT the ledger-anchored clock its forecast route uses --
the two are different decisions for different reasons, and citing the wrong
precedent has already misled one reader in this codebase.

The measured capacity comes from the same pipeline `/api/cashflow/runway` uses:
`recurrence_points` (this user's rows, transfers excluded) → `complete_months`
over the LEDGER'S OWN bounds → `measure_savings_capacity`. The bounds must be
the actual extent of the imported statements and never a requested window;
`capacity.complete_months` cannot tell the two apart and wider bounds silently
admit a partial month as complete.
"""

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.common import recurrence_points
from app.api.history import user_history
from app.db import get_db
from app.engines.capacity import (
    MeasuredRate,
    MonthlyEntry,
    MonthObservation,
    complete_months,
    measure_savings_capacity,
)
from app.engines.goal import GoalInput, evaluate_goals
from app.models import Goal, User
from app.schemas.cashflow import MeasuredRateOut
from app.schemas.goals import (
    GoalIn,
    GoalOut,
    GoalPatch,
    GoalProgressOut,
    GoalReportOut,
    MilestoneOut,
)
from app.security.deps import get_current_user

router = APIRouter(prefix="/goals", tags=["goals"])


def _owned(db: Session, user: User, goal_id: int) -> Goal:
    goal = db.query(Goal).filter(Goal.id == goal_id, Goal.user_id == user.id).first()
    if goal is None:
        raise HTTPException(status_code=404, detail="Objectif introuvable")
    return goal


def observed_months(db: Session, user_id: int) -> list[MonthObservation]:
    """Complete months of this user's own ledger, over the ledger's own bounds.

    Shared with `api/feasibility.py`, which needs exactly the same measurement
    -- one definition rather than two that drift.
    """
    history = user_history(db, user_id)
    if history is None:
        return []
    points = recurrence_points(db, user_id)
    return complete_months(
        [MonthlyEntry(on=point.on, amount_cents=point.amount_cents) for point in points],
        history.date_from,
        history.date_to,
    )


def rate_out(rate: MeasuredRate | None) -> MeasuredRateOut | None:
    if rate is None:
        return None
    return MeasuredRateOut(months=rate.months, median_cents=rate.median_cents,
                           spread_cents=rate.spread_cents, low_cents=rate.low_cents,
                           high_cents=rate.high_cents)


@router.get("", response_model=GoalReportOut)
def list_goals(user: User = Depends(get_current_user),
               db: Session = Depends(get_db)) -> GoalReportOut:
    rows = (
        db.query(Goal)
        .filter(Goal.user_id == user.id, Goal.archived.is_(False))
        .order_by(Goal.priority, Goal.id)
        .all()
    )
    months = observed_months(db, user.id)
    capacity = measure_savings_capacity(months)
    progress = evaluate_goals(
        [GoalInput(id=row.id, name=row.name, target_cents=row.target_cents,
                   saved_cents=row.saved_cents, due_on=row.due_on, priority=row.priority)
         for row in rows],
        # The sign is kept. A negative median is the operator's own state and
        # the engine has a distinct refusal for it; clamping to 0 here would
        # route him to the wrong one.
        None if capacity is None else capacity.median_cents,
        date.today(),
    )
    return GoalReportOut(
        goals=[
            GoalProgressOut(
                goal_id=item.goal_id, name=item.name, target_cents=item.target_cents,
                saved_cents=item.saved_cents, remaining_cents=item.remaining_cents,
                progress_ratio=item.progress_ratio,
                milestones=[
                    MilestoneOut(percent=m.percent, threshold_cents=m.threshold_cents,
                                 reached=m.reached, months_away=m.months_away,
                                 projected_on=m.projected_on)
                    for m in item.milestones
                ],
                funding_starts_in_months=item.funding_starts_in_months,
                months_to_completion=item.months_to_completion,
                projected_completion_on=item.projected_completion_on,
                projection_unavailable_reason=item.projection_unavailable_reason,
                due_on=item.due_on, months_until_due=item.months_until_due,
                on_track=item.on_track,
            )
            for item in progress
        ],
        capacity=rate_out(capacity),
        months_observed=len(months),
        history=user_history(db, user.id),
    )


@router.post("", response_model=GoalOut, status_code=status.HTTP_201_CREATED)
def create_goal(payload: GoalIn, user: User = Depends(get_current_user),
                db: Session = Depends(get_db)) -> Goal:
    goal = Goal(user_id=user.id, **payload.model_dump())
    db.add(goal)
    db.commit()
    db.refresh(goal)
    return goal


@router.patch("/{goal_id}", response_model=GoalOut)
def patch_goal(goal_id: int, payload: GoalPatch, user: User = Depends(get_current_user),
               db: Session = Depends(get_db)) -> Goal:
    goal = _owned(db, user, goal_id)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(goal, field, value)
    db.commit()
    db.refresh(goal)
    return goal


@router.delete("/{goal_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_goal(goal_id: int, user: User = Depends(get_current_user),
                db: Session = Depends(get_db)) -> None:
    """Archiving, not deleting: a goal that was reached is worth keeping."""
    goal = _owned(db, user, goal_id)
    goal.archived = True
    db.commit()
```

- [ ] **Step 5: Register the router and name the fields**

`main.py`: import and `api.include_router(goal_routes.router)`.
`errors.py` `FIELD_SUBJECTS`: `"target_cents": "Le montant cible"`, `"saved_cents": "Le montant déjà constitué"`, `"due_on": "L'échéance"`, `"priority": "La priorité"`.

- [ ] **Step 6: Run the tests, then the full suite, then commit**

Run from `backend/`: `.venv/Scripts/pytest.exe tests/test_goals_api.py -v` → PASS, 7 tests.
Run from `backend/`: `.venv/Scripts/pytest.exe -q` → **599** passed.

```bash
git add backend/app/api/goals.py backend/app/schemas/goals.py backend/app/main.py backend/app/api/errors.py backend/tests/test_goals_api.py
git commit -m "feat(api): expose goals with progress measured from real transactions"
```

---

### Task 9: `/objectifs` — the screen

**Files:**
- Create: `frontend/src/features/goals/GoalsPage.tsx`, `GoalsPage.css`, `GoalForm.tsx`, `GoalsPage.test.tsx`, `GoalForm.test.tsx`
- Modify: `frontend/src/lib/types.ts`, `frontend/src/app/routes.tsx`, `frontend/src/app/AppShell.tsx`

**Interfaces:**
- Consumes: `GET/POST/PATCH/DELETE /api/goals` (Task 8).
- Produces: route `/objectifs`, nav entry "Objectifs". Types `Goal`, `Milestone`, `GoalProgress`, `GoalReport`.

- [ ] **Step 1: Add the mirror types**

Append to `frontend/src/lib/types.ts`:

```typescript
export interface Goal {
  id: number;
  name: string;
  target_cents: number;
  saved_cents: number;
  due_on: string | null;
  /** Lower is more urgent. Goals are funded one at a time in this order. */
  priority: number;
  archived: boolean;
}

/** Phase 2C's engagement milestones read this shape. */
export interface Milestone {
  percent: number;
  threshold_cents: number;
  reached: boolean;
  /** null on a REACHED milestone — `saved_cents` is declared with no history,
   *  so Yieldo does not know when the threshold was crossed. Rendering today's
   *  date there would claim it happened now. Also null whenever the goal's own
   *  projection refused. */
  months_away: number | null;
  projected_on: string | null;
}

export interface GoalProgress {
  goal_id: number;
  name: string;
  target_cents: number;
  saved_cents: number;
  /** Floored at 0. `progress_ratio` is not clamped and reads above 1 when the
   *  goal is overfunded. */
  remaining_cents: number;
  progress_ratio: number;
  milestones: Milestone[];
  /** Months before this goal receives anything. Say it on screen, or a far-off
   *  date reads as a bug. */
  funding_starts_in_months: number;
  months_to_completion: number | null;
  projected_completion_on: string | null;
  /** French, from the engine. Names WHICH of three causes applies — no
   *  measurable capacity, a capacity that is negative or zero, or a projection
   *  past fifty years. Print verbatim; the three remedies are different. */
  projection_unavailable_reason: string | null;
  due_on: string | null;
  months_until_due: number | null;
  /** THREE states. null is not false. */
  on_track: boolean | null;
}

export interface GoalReport {
  goals: GoalProgress[];
  /** null below three complete observed months. **Signed** — `median_cents` is
   *  negative for a household spending more than it earns. */
  capacity: MeasuredRate | null;
  months_observed: number;
  history: History | null;
}
```

`MeasuredRate` already exists in this file from phase 2A — reuse it, do not redeclare it.

- [ ] **Step 2: Write the failing screen test**

Create `frontend/src/features/goals/GoalsPage.test.tsx`. The cases that must exist:

```tsx
it("says the capacity is negative, and does not show an empty projection", async () => {
  // THE OPERATOR'S OWN STATE. -74 619 c/month measured over 3 months.
  vi.mocked(api.get).mockResolvedValue({
    goals: [{ ...PROGRESS, months_to_completion: null, projected_completion_on: null,
      projection_unavailable_reason:
        "Votre capacité d'épargne mesurée est négative ou nulle : au rythme constaté dans vos relevés, cet objectif ne progresse pas, et aucune date d'atteinte ne peut être avancée.",
      milestones: PROGRESS.milestones.map((m) => ({ ...m, projected_on: null, months_away: null })),
      on_track: null }],
    capacity: { months: 3, median_cents: -74_619, spread_cents: 213_078,
      low_cents: -347_690, high_cents: 198_452 },
    months_observed: 3,
    history: { date_from: "2025-01-24", date_to: "2026-01-09", transaction_count: 197 },
  } as never);
  renderPage();
  expect(await screen.findByText(/ne progresse pas/)).toBeInTheDocument();
  // The measured rate is stated as the negative figure it is, with its sample.
  expect(screen.getByText(/−746,19/)).toBeInTheDocument();
  expect(screen.getByText(/3 mois/)).toBeInTheDocument();
  // No projected date anywhere, and no progress bar implying forward motion.
  expect(screen.queryByText(/Atteint le/)).not.toBeInTheDocument();
});

it("tells a household with too little history a DIFFERENT thing", async () => {
  // Same screen, different cause, different remedy: import statements.
  // These two must never render the same sentence.
});

it("names the wait before a second goal starts being funded", async () => {
  // funding_starts_in_months: 10 -> "Ce financement commence dans 10 mois,
  // une fois « Urgence » atteint." Without it, a date sixteen months out on a
  // 300 000 c goal at 500 EUR/month looks like an arithmetic error.
});

it("marks a reached milestone without inventing a date for it", async () => {
  // reached: true, projected_on: null -> "Atteint" and nothing else. Never
  // "Atteint le 25 août 2026", which is today and is not when it happened.
});

it("shows a progress bar whose width is a real percentage", async () => {
  // Percentage widths inside an auto-width flex column resolve to ZERO. The
  // track must sit in a container with a definite inline size -- a grid track,
  // or a flex item carrying `min-width: 0` and `flex: 1`. Assert the inline
  // style the component sets, and check it in the browser at 375 px.
});
```

Write each of those out in full, following the mocking idiom in `frontend/src/features/cashflow/CashflowPage.test.tsx`.

- [ ] **Step 3: Write `GoalForm.tsx` and `GoalsPage.tsx`**

`GoalForm`: name, target (euros, via `parseCents`), already saved (euros, via `parseCents`), deadline (`type="date"`), priority (a number input, 1 = la plus urgente, with the label saying so). Field errors at the field, `aria-invalid` + `aria-describedby`.

`GoalsPage` structure:

1. `<h1>Objectifs</h1>` and a lead.
2. **The capacity panel, first, because everything below depends on it.** Three mutually exclusive registers:
   - `capacity === null` — "Votre capacité d'épargne n'a pas encore pu être mesurée." plus the month count and the ledger span from `history`, and a link to `/import`.
   - `capacity.median_cents <= 0` — the measured figure, signed, with its band and its sample size, and the sentence that at this rhythm no goal advances. **Do not soften it and do not clamp it.** Reuse `RunwayPanel`'s vocabulary: the band, then "Rythme mesuré sur N mois de relevés".
   - otherwise — the median, the band, the sample size.
   Branch on `capacity === null` first and then on the sign, explicitly. Do not derive a single boolean: the two states have different remedies and phase 2A repeatedly shipped a derived branch that collapsed them.
3. One card per goal, in the order the API returned (funding order — say so): name, `saved / target`, the progress track, the four milestones as a row, the projected completion or the engine's refusal, the deadline and `on_track` in three states, and `funding_starts_in_months` when it is above 0.
4. The empty state: "Aucun objectif." with the diagnosis that a goal is declared here because Yieldo cannot tell which euros in an account belong to which goal, plus the add button.

The progress track: a grid track or `flex: 1; min-width: 0` container, never an auto-width flex column. `role="progressbar"` with `aria-valuenow`, `aria-valuemin`, `aria-valuemax` and `aria-valuetext` in French. Width clamped to 100 % for the bar while the *text* still reports the real ratio above 100 %.

**Guard the NaN case explicitly.** Phase 2A left one open: a ratio of `NaN` emits `width: NaN%`, React drops the declaration, and the bar renders at `width: auto` — a FULL bar, the wrong failure direction. `target_cents` is `gt=0` on the wire so it should be unreachable; write the guard anyway and comment that it is defence in depth, because a full bar on an unknown is the worst possible lie this screen can tell.

- [ ] **Step 4: Wire the route and the nav**

`{ path: "objectifs", element: <GoalsPage /> }`; `{ to: "/objectifs", label: "Objectifs" }` after Dettes.

- [ ] **Step 5: Frontend suite and build**

From `frontend/`: `npm test` (green), `npm run build` (zero TypeScript errors). No lint step.

- [ ] **Step 6: BROWSER GATE**

Seed the fixture, check port 8000 is free, start both servers detached (see Task 6, Step 9 for the exact commands), log in as the demo user, go to `/objectifs`.

- The operator has **no goals** and a **negative measured capacity**. Add three: "Fonds d'urgence" 6 000 € target / 0 saved / priority 1; "Remplacement voiture" 8 000 € / 1 200 € / priority 2; "Vacances" 1 500 € / 0 / priority 3 with a deadline of 2027-07-01.
- Confirm the capacity panel prints **−746,19 €** with its band **[−3 476,90 €, +1 984,52 €]** and "3 mois de relevés", and that every goal shows the negative-capacity refusal — **not** the "pas assez d'historique" one.
- Confirm no goal shows a projected date, no milestone shows a date, and `on_track` on the deadline-bearing goal renders as "on ne peut pas se prononcer" rather than "en retard".
- Screenshots at **375, 768, 1440 px, both themes**, attached to the report. Check: the milestone row wraps rather than overflowing at 375; the progress track has non-zero width at every breakpoint (this is the trap that shipped an invisible figure in phase 1.5); no horizontal scroll; console clean.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/features/goals frontend/src/lib/types.ts frontend/src/app/routes.tsx frontend/src/app/AppShell.tsx
git commit -m "feat(goals): show goal progress and say plainly when nothing advances"
```

---
# Lot D — Faisabilité d'achat

Design §6.3, "le cœur de la demande". Four engine tasks, two API tasks, two screen tasks.

### Task 10: Total cost of ownership

§6.3 item 3: "Coût total de possession, pas seulement le prix d'achat. Pour un véhicule : assurance, entretien, carburant, décote, projetés sur cinq ans. Les postes sont préremplis par des moyennes françaises et ajustables."

**Files:**
- Create: `backend/app/engines/ownership.py`
- Test: `backend/tests/test_ownership.py`

**Interfaces:**
- Consumes: `app.engines.amortization.cents`.
- Produces:
  - `CostItem` frozen dataclass: `key: str`, `label: str` (French), `monthly_cents: int | None`, `annual_bps_of_value: int | None` — exactly one of the two is set.
  - `CostLine` frozen dataclass: `key`, `label`, `total_cents`, `monthly_average_cents`.
  - `OwnershipReport` frozen dataclass: `price_cents`, `years`, `lines: list[CostLine]`, `depreciation_cents`, `residual_value_cents`, `running_cost_cents`, `total_cost_cents`, `monthly_average_cents`.
  - `total_cost_of_ownership(price_cents, years, items, depreciation_bps_per_year) -> OwnershipReport`
  - `VEHICLE_DEFAULTS`, `PROPERTY_DEFAULTS` tuples of `CostItem`; `VEHICLE_DEPRECIATION_BPS_PER_YEAR = 1500`, `PROPERTY_DEPRECIATION_BPS_PER_YEAR = 0`, `DEFAULT_OWNERSHIP_YEARS = 5`, `MAX_OWNERSHIP_YEARS = 30`.
  - `defaults_for(nature: str) -> tuple[tuple[CostItem, ...], int]` — the items and the depreciation rate for `"vehicle"`, `"property"` or `"other"`.
  - Consumed by Tasks 13 (`/api/feasibility`) and 18 (`/api/simulators/immobilier`).

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_ownership.py`:

```python
import pytest

from app.engines.ownership import (
    DEFAULT_OWNERSHIP_YEARS,
    VEHICLE_DEFAULTS,
    VEHICLE_DEPRECIATION_BPS_PER_YEAR,
    CostItem,
    defaults_for,
    total_cost_of_ownership,
)


def test_flat_and_value_proportional_costs_are_both_handled():
    """20 000 EUR over 2 years, 15 %/an declining depreciation, 65 EUR/month of
    insurance and 1 %/an of maintenance. Hand-computed:
      insurance    65 * 24                                   = 1 560,00 EUR
      maintenance  1 % of 20 000 then 1 % of 17 000          =   370,00 EUR
      depreciation 3 000 then 2 550                          = 5 550,00 EUR
      residual     20 000 - 5 550                            = 14 450,00 EUR
      total        1 560 + 370 + 5 550                       = 7 480,00 EUR
      monthly      748 000 c / 24                            =   311,67 EUR
    """
    report = total_cost_of_ownership(
        2_000_000, 2,
        [CostItem("insurance", "Assurance", monthly_cents=6_500, annual_bps_of_value=None),
         CostItem("maintenance", "Entretien", monthly_cents=None, annual_bps_of_value=100)],
        1500,
    )
    assert {line.key: line.total_cents for line in report.lines} == {
        "insurance": 156_000, "maintenance": 37_000}
    assert report.depreciation_cents == 555_000
    assert report.residual_value_cents == 1_445_000
    assert report.running_cost_cents == 193_000
    assert report.total_cost_cents == 748_000
    assert report.monthly_average_cents == 31_167


def test_a_value_proportional_cost_follows_the_declining_value():
    """The second year's maintenance is 1 % of 17 000, not of 20 000. Charging
    it on the purchase price would overstate the cost of every old car."""
    report = total_cost_of_ownership(
        2_000_000, 2,
        [CostItem("maintenance", "Entretien", monthly_cents=None, annual_bps_of_value=100)],
        1500,
    )
    assert report.lines[0].total_cents == 20_000 + 17_000


def test_depreciation_is_declining_balance_never_straight_line():
    """A car does not lose the same euros every year. Straight-line would put
    the residual value at zero after seven years at 15 %, which is false."""
    report = total_cost_of_ownership(2_000_000, 7, [], 1500)
    assert report.residual_value_cents > 0
    assert report.depreciation_cents + report.residual_value_cents == 2_000_000


def test_a_property_does_not_depreciate_by_default():
    items, depreciation = defaults_for("property")
    assert depreciation == 0
    report = total_cost_of_ownership(30_000_000, 5, list(items), depreciation)
    assert report.depreciation_cents == 0
    assert report.residual_value_cents == 30_000_000


def test_the_vehicle_defaults_are_the_ones_the_screen_prefills():
    items, depreciation = defaults_for("vehicle")
    assert items == VEHICLE_DEFAULTS
    assert depreciation == VEHICLE_DEPRECIATION_BPS_PER_YEAR
    assert {item.key for item in items} == {"insurance", "maintenance", "fuel"}
    # Every default carries a French label -- the screen prints these verbatim.
    assert all(item.label and item.label[0].isupper() for item in items)


def test_an_unknown_nature_has_no_prefilled_costs_rather_than_a_car_s():
    """"other" is a category, not a car. Prefilling a fuel budget for a sofa
    would be a fabricated figure presented as a French average."""
    items, depreciation = defaults_for("other")
    assert items == ()
    assert depreciation == 0


def test_a_cost_item_must_be_exactly_one_of_the_two_kinds():
    with pytest.raises(ValueError, match="Assurance"):
        total_cost_of_ownership(100_000, 1, [
            CostItem("insurance", "Assurance", monthly_cents=100, annual_bps_of_value=100)], 0)
    with pytest.raises(ValueError, match="Assurance"):
        total_cost_of_ownership(100_000, 1, [
            CostItem("insurance", "Assurance", monthly_cents=None, annual_bps_of_value=None)], 0)


def test_invalid_horizons_raise_in_french():
    with pytest.raises(ValueError, match="durée"):
        total_cost_of_ownership(100_000, 0, [], 0)
    with pytest.raises(ValueError, match="prix"):
        total_cost_of_ownership(-1, DEFAULT_OWNERSHIP_YEARS, [], 0)
```

- [ ] **Step 2: Run it and watch it fail**

Run from `backend/`: `.venv/Scripts/pytest.exe tests/test_ownership.py -v`
Expected: FAIL — `ModuleNotFoundError`.

- [ ] **Step 3: Write the implementation**

Create `backend/app/engines/ownership.py`:

```python
"""What owning the thing costs, on top of buying it.

Design §6.3 item 3: "Coût total de possession, pas seulement le prix d'achat.
Pour un véhicule : assurance, entretien, carburant, décote, projetés sur cinq
ans. Les postes sont préremplis par des moyennes françaises et ajustables."

Two kinds of cost, and the distinction is not cosmetic:

* **flat monthly** -- insurance, fuel, service charges. Constant in euros;
* **proportional to the asset's remaining value** -- maintenance, taxe
  foncière. Charged each year on the value at the START of that year, which is
  what makes an eight-year-old car cheaper to maintain in this model than a new
  one. Charging them on the purchase price for ever would overstate the cost of
  every ageing asset.

**Depreciation is declining balance, never straight line.** At 15 %/year a car
does not lose the same euros every year, and a straight line puts the residual
value at zero after seven years -- a figure the model would then feed into the
feasibility impact.

**The defaults are French averages, and they are defaults.** Every one is
overridable by the user, and every screen that uses them prints the assumption
beside the result, as design §10 requires. `"other"` deliberately has NO
prefilled items: inventing a fuel budget for a sofa would be a fabricated
figure wearing a French average's clothes.

Pure: no session, no network, no clock.
"""

from dataclasses import dataclass
from decimal import Decimal

from app.engines.amortization import cents

# Design §6.3: "projetés sur cinq ans".
DEFAULT_OWNERSHIP_YEARS = 5
MAX_OWNERSHIP_YEARS = 30

_BPS = Decimal(10_000)


@dataclass(frozen=True)
class CostItem:
    """One running cost. Exactly one of the two amounts is set; both, or
    neither, raises rather than silently picking one."""

    key: str
    # French. Printed verbatim by the screen.
    label: str
    monthly_cents: int | None
    annual_bps_of_value: int | None


@dataclass(frozen=True)
class CostLine:
    key: str
    label: str
    total_cents: int
    monthly_average_cents: int


@dataclass(frozen=True)
class OwnershipReport:
    price_cents: int
    years: int
    lines: list[CostLine]
    depreciation_cents: int
    residual_value_cents: int
    # Every running cost, together. Depreciation is NOT in here -- it is not
    # money leaving the household's account, it is value leaving the asset, and
    # a screen that adds them without saying so is comparing two different
    # things. `total_cost_cents` is the sum a buyer should actually weigh.
    running_cost_cents: int
    total_cost_cents: int
    monthly_average_cents: int


# Moyennes françaises, ordres de grandeur 2025-2026, ajustables par
# l'utilisateur. Insurance: a mid-range comprehensive motor policy. Maintenance
# and fuel: a household driving roughly 12 000 km a year. These are prefilled
# starting points, not measurements, and every screen says so.
VEHICLE_DEFAULTS: tuple[CostItem, ...] = (
    CostItem("insurance", "Assurance", monthly_cents=6_500, annual_bps_of_value=None),
    CostItem("maintenance", "Entretien et réparations", monthly_cents=7_000,
             annual_bps_of_value=None),
    CostItem("fuel", "Carburant", monthly_cents=13_000, annual_bps_of_value=None),
)
# A car loses roughly 15 % of its remaining value a year after the first.
VEHICLE_DEPRECIATION_BPS_PER_YEAR = 1500

PROPERTY_DEFAULTS: tuple[CostItem, ...] = (
    CostItem("property_tax", "Taxe foncière", monthly_cents=None, annual_bps_of_value=90),
    CostItem("charges", "Charges de copropriété", monthly_cents=15_000,
             annual_bps_of_value=None),
    CostItem("home_insurance", "Assurance habitation", monthly_cents=2_500,
             annual_bps_of_value=None),
    CostItem("upkeep", "Entretien", monthly_cents=None, annual_bps_of_value=100),
)
# Property is not assumed to lose value. Appreciation is a separate, explicit
# assumption made in `engines/property.py`, where it is displayed and editable
# -- baking a market view into a cost engine would hide it.
PROPERTY_DEPRECIATION_BPS_PER_YEAR = 0


def defaults_for(nature: str) -> tuple[tuple[CostItem, ...], int]:
    """The prefilled items and depreciation rate for a purchase's nature.

    `"other"` returns nothing at all, on purpose. See the module docstring.
    """
    if nature == "vehicle":
        return VEHICLE_DEFAULTS, VEHICLE_DEPRECIATION_BPS_PER_YEAR
    if nature == "property":
        return PROPERTY_DEFAULTS, PROPERTY_DEPRECIATION_BPS_PER_YEAR
    return (), 0


def total_cost_of_ownership(
    price_cents: int, years: int, items: list[CostItem], depreciation_bps_per_year: int
) -> OwnershipReport:
    if price_cents < 0:
        raise ValueError("Le prix d'achat ne peut pas être négatif.")
    if not 1 <= years <= MAX_OWNERSHIP_YEARS:
        raise ValueError(
            f"La durée de possession doit être comprise entre 1 et {MAX_OWNERSHIP_YEARS} ans."
        )
    for item in items:
        if (item.monthly_cents is None) == (item.annual_bps_of_value is None):
            raise ValueError(
                f"Le poste « {item.label} » doit être défini soit par un montant "
                "mensuel, soit par un pourcentage annuel de la valeur du bien, "
                "mais pas les deux."
            )

    totals: dict[str, int] = {item.key: 0 for item in items}
    value = price_cents
    depreciation = 0

    for _year in range(years):
        for item in items:
            if item.monthly_cents is not None:
                totals[item.key] += item.monthly_cents * 12
            else:
                # On the value at the START of the year -- see the docstring.
                totals[item.key] += cents(
                    Decimal(value) * Decimal(item.annual_bps_of_value) / _BPS
                )
        loss = cents(Decimal(value) * Decimal(depreciation_bps_per_year) / _BPS)
        depreciation += loss
        value -= loss

    months = years * 12
    lines = [
        CostLine(key=item.key, label=item.label, total_cents=totals[item.key],
                 monthly_average_cents=cents(Decimal(totals[item.key]) / Decimal(months)))
        for item in items
    ]
    running = sum(line.total_cents for line in lines)
    total = running + depreciation
    return OwnershipReport(
        price_cents=price_cents, years=years, lines=lines,
        depreciation_cents=depreciation, residual_value_cents=value,
        running_cost_cents=running, total_cost_cents=total,
        monthly_average_cents=cents(Decimal(total) / Decimal(months)),
    )
```

- [ ] **Step 4: Run the test, mutation-check, commit**

Run from `backend/`: `.venv/Scripts/pytest.exe tests/test_ownership.py -v` → PASS, 8 tests.

Mutations, each alone: (1) charge value-proportional items on `price_cents` instead of `value` — `test_a_value_proportional_cost_follows_the_declining_value` goes red; (2) make depreciation straight-line (`price * bps / 10000` each year) — `test_depreciation_is_declining_balance_never_straight_line` goes red on the sum invariant; (3) change the `==` in the CostItem guard to `and` — the "both set" half of `test_a_cost_item_must_be_exactly_one_of_the_two_kinds` goes red.

Full suite: **607** passed.

```bash
git add backend/app/engines/ownership.py backend/tests/test_ownership.py
git commit -m "feat(engines): total cost of ownership with declining-balance depreciation"
```

---

### Task 11: The purchase-feasibility engine — verdict, gap, opportunity cost, impact

**This is the phase's reason to exist.** §6.3 items 1, 2, 4 and 7. The levers (5) and the financing comparison (6) are Task 12; the total cost of ownership (3) was Task 10.

**Read `backend/app/engines/capacity.py` in full before writing a line.** Its module docstring and `measure_savings_capacity`'s field docstring were written for this task: the capacity is measured over *complete observed months*, the eight unimported months in the operator's ledger cannot be counted as zero, the sign of a deficit is kept deliberately, and the function returns `None` below three observed months.

**The operator's measured capacity is −74 619 c per month and his liquid balance is −220 963 c.** A household that cannot currently afford anything is the primary case this engine answers, not an edge case it survives.

**Files:**
- Create: `backend/app/engines/feasibility.py`
- Modify: `backend/app/engines/capacity.py` (add `measure_income_rate`), `backend/app/engines/runway.py` (extract `months_of_runway`)
- Test: `backend/tests/test_feasibility.py`, `backend/tests/test_capacity.py` (append), `backend/tests/test_runway.py` (append)

**Interfaces:**
- Consumes: `capacity.{MeasuredRate, MonthObservation}`, `runway.months_of_runway`, `savings.{project_savings, opportunity_cost_cents}`, `period.month_end`, `ownership.DEFAULT_OWNERSHIP_YEARS`.
- Produces:
  - `capacity.measure_income_rate(months) -> MeasuredRate | None` — the median monthly inflow, same contract as its two siblings. Consumed by Task 13 for the debt ratio.
  - `runway.months_of_runway(balance_cents: int, monthly_burn_cents: int) -> float` — raises on a non-positive burn. Both `runway._scenario` and `feasibility` call it, so the two cannot drift.
  - `PurchaseRequest`, `Assumptions`, `EmergencyImpact`, `Impact`, `FeasibilityReport` frozen dataclasses (fields below).
  - `assess_feasibility(request, capacity, expense_rate, balance_cents, assumptions, today) -> FeasibilityReport`
  - `VERDICTS = ("comfortable", "tight", "out_of_reach")`, `NATURES = ("vehicle", "property", "other")`, `MAX_HORIZON_MONTHS = 600`.
  - Consumed by Tasks 12 (levers read `gap_cents` and the capacity), 13 (`/api/feasibility`), 15–16 (screens).

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_capacity.py`:

```python
def test_the_income_rate_is_measured_from_inflows_alone():
    """Design §6.3 item 5 needs a taux d'endettement, and a taux d'endettement
    needs an income. Measured like everything else here -- the median of the
    complete observed months' inflows -- and `None` below the floor, never 0,
    which would render as "0 % d'endettement" on a household whose income
    simply could not be measured."""
    months = complete_months(
        [MonthlyEntry(on=date(2025, 1, 10), amount_cents=200_000),
         MonthlyEntry(on=date(2025, 1, 20), amount_cents=-50_000),
         MonthlyEntry(on=date(2025, 2, 10), amount_cents=250_000),
         MonthlyEntry(on=date(2025, 3, 10), amount_cents=210_000)],
        date(2025, 1, 1), date(2025, 3, 31),
    )
    rate = measure_income_rate(months)
    assert rate is not None
    assert rate.months == 3
    assert rate.median_cents == 210_000


def test_the_income_rate_refuses_below_three_observed_months():
    months = complete_months(
        [MonthlyEntry(on=date(2025, 1, 10), amount_cents=200_000),
         MonthlyEntry(on=date(2025, 2, 10), amount_cents=250_000)],
        date(2025, 1, 1), date(2025, 2, 28),
    )
    assert measure_income_rate(months) is None
```

Append to `backend/tests/test_runway.py`:

```python
def test_months_of_runway_is_the_one_definition_both_engines_use():
    from app.engines.runway import months_of_runway

    assert months_of_runway(600_000, 200_000) == 3.0
    # Already at or past zero: no autonomy left to count, starting now. NOT a
    # negative duration, which would render as a date in the past.
    assert months_of_runway(0, 200_000) == 0.0
    assert months_of_runway(-220_963, 265_449) == 0.0


def test_months_of_runway_raises_on_a_burn_that_is_not_positive():
    """Dividing by it is infinity, and an infinity on screen reads as a
    promise. Both callers guard before calling; this raises rather than
    returning a sentinel, exactly like `robust.median_cents` on an empty
    sample."""
    from app.engines.runway import months_of_runway

    with pytest.raises(ValueError, match="dépense"):
        months_of_runway(600_000, 0)
    with pytest.raises(ValueError, match="dépense"):
        months_of_runway(600_000, -1)
```

Create `backend/tests/test_feasibility.py`:

```python
from datetime import date

import pytest

from app.engines.capacity import MeasuredRate
from app.engines.feasibility import (
    Assumptions,
    PurchaseRequest,
    assess_feasibility,
)

TODAY = date(2026, 8, 25)

# A healthy household: 4 000 EUR/month of measured savings capacity, band
# 3 000 - 5 000. Used for the three verdicts, because one rate against three
# targets is the fixture that can actually tell them apart.
HEALTHY = MeasuredRate(months=12, median_cents=400_000, spread_cents=78_000,
                       low_cents=300_000, high_cents=500_000)
BURN = MeasuredRate(months=12, median_cents=250_000, spread_cents=30_000,
                    low_cents=200_000, high_cents=300_000)

# THE OPERATOR, measured from his real ledger by phase 2A's own engines.
OPERATOR_CAPACITY = MeasuredRate(months=3, median_cents=-74_619, spread_cents=213_078,
                                 low_cents=-347_690, high_cents=198_452)
OPERATOR_BURN = MeasuredRate(months=3, median_cents=265_449, spread_cents=221_457,
                             low_cents=-18_360, high_cents=549_258)
OPERATOR_BALANCE = -220_963

ASSUMPTIONS = Assumptions(annual_return_bps=300, loan_rate_bps=500, loan_months=60,
                          ownership_years=5, monthly_income_cents=250_000,
                          existing_debt_payments_cents=0)


def _request(target, horizon=12, down=0, nature="vehicle") -> PurchaseRequest:
    return PurchaseRequest(target_cents=target, horizon_months=horizon,
                           down_payment_cents=down, nature=nature)


def test_a_target_the_bad_months_still_reach_is_comfortable():
    """"Atteignable confortablement" is defined by the measured BAND, not by an
    invented margin: even a month at the low end of the observed variability
    gets there. 12 months at 3 000 EUR reaches 36 499,16 EUR."""
    report = assess_feasibility(_request(3_500_000), HEALTHY, BURN, 1_000_000,
                                ASSUMPTIONS, TODAY)
    assert report.verdict == "comfortable"
    assert report.saved_at_horizon_low_cents == 3_649_916
    assert report.saved_at_horizon_cents == 4_866_555


def test_a_target_only_the_median_reaches_is_tight():
    report = assess_feasibility(_request(4_000_000), HEALTHY, BURN, 1_000_000,
                                ASSUMPTIONS, TODAY)
    assert report.verdict == "tight"
    assert report.saved_at_horizon_low_cents < 4_000_000 <= report.saved_at_horizon_cents
    # Negative gap: a surplus, not a shortfall. The screen must not print it
    # as "il vous manque -866,55 EUR".
    assert report.gap_cents == -866_555


def test_a_target_the_median_misses_is_out_of_reach_with_the_figure():
    report = assess_feasibility(_request(6_000_000), HEALTHY, BURN, 1_000_000,
                                ASSUMPTIONS, TODAY)
    assert report.verdict == "out_of_reach"
    assert report.gap_cents == 6_000_000 - 4_866_555


def test_an_unmeasurable_capacity_refuses_rather_than_guessing():
    """`measure_savings_capacity` returns None below three complete observed
    months. The engine refuses where its input refuses: no verdict, no gap, no
    projection -- and a reason that names the month floor."""
    report = assess_feasibility(_request(4_000_000), None, BURN, 1_000_000,
                                ASSUMPTIONS, TODAY)
    assert report.verdict is None
    assert report.gap_cents is None
    assert report.saved_at_horizon_cents is None
    assert report.capacity_unavailable_reason is not None
    assert "trois mois complets" in report.capacity_unavailable_reason


def test_the_operators_own_case_is_answered_not_refused():
    """HIS MEASURED CAPACITY IS NEGATIVE. That is a verdict, not a refusal: the
    engine has a figure and the figure says the pot shrinks. Every number here
    was produced by running phase 2A's shipped engines against the seeded
    fixture, then this engine's own arithmetic on top."""
    report = assess_feasibility(_request(4_000_000), OPERATOR_CAPACITY, OPERATOR_BURN,
                                OPERATOR_BALANCE, ASSUMPTIONS, TODAY)
    assert report.verdict == "out_of_reach"
    # Twelve months of a -746,19 EUR/month rate from a zero down payment. No
    # interest accrues: `savings.project_savings` credits nothing to a
    # non-positive balance, because a shrinking pot is an overdraft.
    assert report.saved_at_horizon_cents == -895_428
    assert report.saved_at_horizon_low_cents == -4_172_280
    # EVEN THE OPTIMISTIC END OF THE BAND FALLS SHORT. The screen must not
    # offer "dans un bon mois, c'est jouable".
    assert report.saved_at_horizon_high_cents == 2_414_442
    # The gap is LARGER than the target, and that is the honest figure.
    assert report.gap_cents == 4_895_428
    assert report.gap_cents > report.request.target_cents
    assert report.capacity_unavailable_reason is None


def test_a_negative_capacity_is_never_flipped_positive():
    """Phase 2A's review verified this trap is structurally absent from
    `capacity.py`; it must not be reintroduced one layer up. An `abs()` here
    would turn the operator's deficit into 8 954,28 EUR of savings and report
    a household going backwards as one making progress."""
    report = assess_feasibility(_request(4_000_000), OPERATOR_CAPACITY, OPERATOR_BURN,
                                OPERATOR_BALANCE, ASSUMPTIONS, TODAY)
    assert report.saved_at_horizon_cents < 0
    assert report.capacity is not None and report.capacity.median_cents < 0


def test_the_emergency_fund_impact_is_measured_from_the_expense_rate():
    """40 000 EUR out of a 10 000 EUR liquid balance at 2 500 EUR/month."""
    report = assess_feasibility(_request(4_000_000), HEALTHY, BURN, 1_000_000,
                                ASSUMPTIONS, TODAY)
    assert report.impact.emergency.runway_months_before == pytest.approx(4.0)
    # The balance goes below zero, so there is no autonomy left -- 0.0, never a
    # negative duration.
    assert report.impact.emergency.runway_months_after == 0.0
    assert report.impact.emergency.unavailable_reason is None


def test_the_emergency_impact_refuses_when_the_burn_is_unmeasurable():
    no_rate = assess_feasibility(_request(4_000_000), HEALTHY, None, 1_000_000,
                                 ASSUMPTIONS, TODAY)
    assert no_rate.impact.emergency.runway_months_before is None
    assert "mesuré" in no_rate.impact.emergency.unavailable_reason

    flat = MeasuredRate(months=12, median_cents=0, spread_cents=0,
                        low_cents=0, high_cents=0)
    no_burn = assess_feasibility(_request(4_000_000), HEALTHY, flat, 1_000_000,
                                 ASSUMPTIONS, TODAY)
    assert no_burn.impact.emergency.runway_months_before is None
    # A DIFFERENT cause needs a DIFFERENT sentence.
    assert no_burn.impact.emergency.unavailable_reason != \
        no_rate.impact.emergency.unavailable_reason


def test_the_five_year_liquid_impact_is_the_purchase_price_apart():
    """Two projections from the same rate, differing only by the price -- so
    the difference is exactly the price when nothing compounds, which is the
    operator's case (a negative balance earns nothing)."""
    report = assess_feasibility(_request(4_000_000), OPERATOR_CAPACITY, OPERATOR_BURN,
                                OPERATOR_BALANCE, ASSUMPTIONS, TODAY)
    assert report.impact.liquid_in_five_years_before_cents == -4_698_103
    assert report.impact.liquid_in_five_years_after_cents == -8_698_103


def test_the_opportunity_cost_is_over_the_ownership_horizon_and_says_so():
    """Design §6.3 item 4. 40 000 EUR at 3 %/an over five years earns
    6 464,66 EUR -- the FORGONE GAIN, not the final value."""
    report = assess_feasibility(_request(4_000_000), HEALTHY, BURN, 1_000_000,
                                ASSUMPTIONS, TODAY)
    assert report.opportunity_cost_cents == 646_466
    assert report.opportunity_horizon_months == 60


def test_the_horizon_end_date_is_named_so_the_screen_can_print_it():
    report = assess_feasibility(_request(4_000_000, horizon=12), HEALTHY, BURN,
                                1_000_000, ASSUMPTIONS, TODAY)
    assert report.horizon_end_on == date(2027, 8, 31)


def test_invalid_requests_raise_in_french():
    with pytest.raises(ValueError, match="prix"):
        assess_feasibility(_request(0), HEALTHY, BURN, 0, ASSUMPTIONS, TODAY)
    with pytest.raises(ValueError, match="échéance"):
        assess_feasibility(_request(4_000_000, horizon=0), HEALTHY, BURN, 0,
                           ASSUMPTIONS, TODAY)
    with pytest.raises(ValueError, match="apport"):
        assess_feasibility(_request(4_000_000, down=-1), HEALTHY, BURN, 0,
                           ASSUMPTIONS, TODAY)
    with pytest.raises(ValueError, match="nature"):
        assess_feasibility(_request(4_000_000, nature="spaceship"), HEALTHY, BURN, 0,
                           ASSUMPTIONS, TODAY)
```

- [ ] **Step 2: Run them and watch them fail**

Run from `backend/`: `.venv/Scripts/pytest.exe tests/test_feasibility.py tests/test_capacity.py tests/test_runway.py -v`
Expected: FAIL — `ModuleNotFoundError` on `app.engines.feasibility`, `ImportError` on `measure_income_rate` and `months_of_runway`.

- [ ] **Step 3: Add `measure_income_rate` to `capacity.py`**

Append to `backend/app/engines/capacity.py`, directly after `measure_expense_rate`:

```python
def measure_income_rate(months: list[MonthObservation]) -> MeasuredRate | None:
    """What a month brings in. None when unmeasurable.

    The third sibling of `measure_expense_rate` and `measure_savings_capacity`,
    over the same complete observed months and with the same floor. Phase 2B's
    purchase-feasibility engine needs it for the taux d'endettement of design
    §6.3 item 5 -- a ratio whose denominator must be measured from real
    statements rather than declared, like everything else in this module.

    `None`, never 0: a household whose income could not be measured has no debt
    ratio at all, and `amortization.debt_ratio_bps` refuses in the same way for
    the same reason.
    """
    return _measure([month.inflow_cents for month in months])
```

- [ ] **Step 4: Extract `months_of_runway` in `runway.py`**

Add to `backend/app/engines/runway.py`, above `_scenario`:

```python
def months_of_runway(balance_cents: int, monthly_burn_cents: int) -> float:
    """How many months `balance_cents` lasts at `monthly_burn_cents` a month.

    The single definition of this division. `_scenario` below and phase 2B's
    `engines/feasibility.py` both call it, so the two cannot drift into
    bucketing the same edge differently -- the failure `capacity.py` and
    `aggregate.py` were flagged for in phase 2A.

    Raises on a non-positive burn rather than returning a sentinel: dividing by
    it is infinity, and an infinity rendered on screen reads as a promise. Both
    callers establish `monthly_burn_cents > 0` before calling, each with its
    own French explanation for the reader.

    0.0 -- not a negative duration -- when the balance is already at or past
    zero. There is no autonomy left, starting today; a negative number here
    would render as a depletion date in the past.
    """
    if monthly_burn_cents <= 0:
        raise ValueError(
            "Sans dépense nette mesurée, aucune autonomie ne peut être calculée."
        )
    if balance_cents <= 0:
        return 0.0
    return balance_cents / monthly_burn_cents
```

Then, in `_scenario`, replace the two lines that computed the duration:

```python
    burn = rate.median_cents
    months_count = months_of_runway(balance_cents, burn)
    if months_count == 0.0:
        # Already at or past zero. Not a negative runway -- there is simply none
        # left, starting today.
        return RunwayScenario(name=name, monthly_burn_cents=burn, rate=rate, months=0.0,
                              depleted_on=today), None
    if months_count > MAX_DATED_MONTHS:
        return RunwayScenario(name=name, monthly_burn_cents=burn, rate=rate,
                              months=months_count, depleted_on=None), None
```

The `if balance_cents <= 0:` block that preceded it is deleted; `months_of_runway` now owns that case. **Run `tests/test_runway.py` and `tests/test_cashflow_api.py` immediately after this edit** — they are phase 2A's, they pass today, and they must still pass unchanged. A refactor that needs its own tests edited is not a refactor.

- [ ] **Step 5: Write the feasibility engine**

Create `backend/app/engines/feasibility.py`:

```python
"""« Puis-je m'offrir cette voiture ? » — the answer, with its provenance.

Design §6.3, "le cœur de la demande". This module covers items 1, 2, 4 and 7;
`engines/levers.py` covers 5 and 6, `engines/ownership.py` covers 3.

**The capacity is measured, never declared.** §6.3 item 1: "Capacité d'épargne
réelle, mesurée sur les transactions des douze derniers mois, pas déclarée.
Avec sa variabilité." It arrives here as `capacity.MeasuredRate`, built by
`capacity.measure_savings_capacity` over complete observed months. Read that
module's docstring: months with no imported statement are NOT counted as
zero-spend months, and the sign of a deficit is kept.

**The engine refuses exactly where its input refuses.** `measure_savings_
capacity` returns `None` below three complete observed months. On `None` there
is no verdict, no gap and no projection -- only a French reason naming the
month floor. A verdict manufactured from one or two months would be the
single most damaging number this application could print.

**A negative measured capacity is a VERDICT, not a refusal, and it is the
primary case.** The operator's measured capacity is -74 619 c per month and his
liquid balance is -220 963 c. The engine has a figure; the figure says the pot
shrinks. So it answers: `out_of_reach`, with `saved_at_horizon_cents` negative
and a `gap_cents` LARGER than the purchase price. Three things are therefore
forbidden here, each of which would turn a truthful answer into a comfortable
lie:

* no `abs()` and no clamp anywhere on the capacity or on a projected balance;
* no interest credited to a non-positive pot (`savings.project_savings` refuses
  it at source, which is why the projection goes through that function rather
  than through a local loop);
* no fallback verdict. `out_of_reach` with a real figure is the answer, and
  `engines/levers.py` is where "what would have to change" is said.

**The three verdicts are defined by the measured band, not by an invented
margin.** §6.3 item 2 asks for "atteignable confortablement, atteignable en
serrant, hors de portée". Here:

* *comfortable* -- the horizon is reached even when every month runs at the
  band's LOW end (P10 of the observed variability);
* *tight* -- reached at the median, but not at the low end;
* *out_of_reach* -- not reached at the median.

Every threshold therefore comes from the household's own dispersion. A fixed
"10 % of headroom" rule would be exactly the arbitrary threshold design §6.2
forbids for anomaly detection, applied to a bigger decision.

Pure: no session, no network, no implicit clock -- `today` is a parameter.
"""

from dataclasses import dataclass
from datetime import date

from app.engines.capacity import MeasuredRate
from app.engines.ownership import DEFAULT_OWNERSHIP_YEARS, MAX_OWNERSHIP_YEARS
from app.engines.period import month_end
from app.engines.runway import months_of_runway
from app.engines.savings import (
    MAX_PROJECTION_MONTHS,
    opportunity_cost_cents,
    project_savings,
)

VERDICTS = ("comfortable", "tight", "out_of_reach")
NATURES = ("vehicle", "property", "other")
MAX_HORIZON_MONTHS = MAX_PROJECTION_MONTHS


@dataclass(frozen=True)
class PurchaseRequest:
    target_cents: int
    horizon_months: int
    # Money already set aside for this purchase, today. Not the liquid balance:
    # a household can have savings it does not intend to spend on a car.
    down_payment_cents: int
    # One of NATURES. Decides which French cost defaults `ownership.py`
    # prefills, and nothing else here.
    nature: str


@dataclass(frozen=True)
class Assumptions:
    """Every hypothesis, in one place, so a screen can print them beside the
    result -- design §10: "Les hypothèses sont toujours affichées à côté du
    résultat." None of these is measured; all are editable."""

    annual_return_bps: int
    loan_rate_bps: int
    loan_months: int
    ownership_years: int
    # MEASURED, unlike the four above: `capacity.measure_income_rate(...)
    # .median_cents`, or None when it could not be measured. The debt ratio in
    # `engines/levers.py` divides by it and refuses when it is None.
    monthly_income_cents: int | None
    # What the household already pays every month on existing credits, from
    # the `debts` table.
    existing_debt_payments_cents: int


@dataclass(frozen=True)
class EmergencyImpact:
    """§6.3 item 7, the fonds d'urgence half.

    The comparison is made on the liquid balance AS IT STANDS TODAY, with and
    without the purchase price removed. Projecting the balance to the horizon
    first would need a second assumption on top of the capacity, and the
    question a buyer is asking -- "what does this purchase do to my safety
    net?" -- is answered by the simpler comparison. The screen states which one
    it is.
    """

    runway_months_before: float | None
    runway_months_after: float | None
    # Both months are None exactly when this is set, and it names WHICH of two
    # causes applies: no measurable expense rate, or a rate that is not a
    # positive burn.
    unavailable_reason: str | None


@dataclass(frozen=True)
class Impact:
    emergency: EmergencyImpact
    # The liquid balance in five years, with and without the purchase, at the
    # measured savings capacity. None when the capacity could not be measured.
    liquid_in_five_years_before_cents: int | None
    liquid_in_five_years_after_cents: int | None
    liquid_unavailable_reason: str | None
    # §6.3 item 7 also names "le patrimoine net à horizon cinq ans" and "le
    # score de santé financière". NEITHER IS COMPUTED HERE, and neither has a
    # field: net worth needs the investment accounts phase 3 builds, and the
    # health score needs an engine this codebase does not yet have (§6.1 lists
    # it among the FinVest engines not yet ported; phase 2C owns its evolving
    # form). The screen says both in French rather than rendering a blank
    # panel or a zero -- absence of a field is deliberate, so that nobody
    # later fills one with a placeholder.


@dataclass(frozen=True)
class FeasibilityReport:
    request: PurchaseRequest
    assumptions: Assumptions
    # The measured savings capacity this whole report rests on, republished so
    # a screen can show the band and the sample size beside the verdict without
    # re-measuring. None when it could not be measured.
    capacity: MeasuredRate | None
    # French. Set exactly when `capacity` is None, and it is the ONLY reason
    # this engine refuses. A negative capacity is not a refusal: it produces a
    # verdict of `out_of_reach` with real figures.
    capacity_unavailable_reason: str | None
    # All five below are None exactly when `capacity_unavailable_reason` is set.
    verdict: str | None
    saved_at_horizon_cents: int | None
    saved_at_horizon_low_cents: int | None
    saved_at_horizon_high_cents: int | None
    # Target minus what is projected at the median. POSITIVE means short,
    # NEGATIVE means a surplus -- the screen must branch on the sign rather
    # than printing "il vous manque -866,55 EUR".
    gap_cents: int | None
    # §6.3 item 4, over `opportunity_horizon_months` -- the holding period, not
    # the saving horizon, because that is how long the money is tied up in the
    # asset. The horizon is published so the sentence can name it.
    opportunity_cost_cents: int
    opportunity_horizon_months: int
    impact: Impact
    # The last day of the month the horizon lands in, so the screen prints a
    # date rather than only a month count.
    horizon_end_on: date


def _reason_capacity_unmeasurable() -> str:
    return (
        "Votre capacité d'épargne n'a pas pu être mesurée : il faut au moins "
        "trois mois complets de relevés pour en tirer une médiane. Sans elle, "
        "aucun verdict ne peut être rendu sur cet achat — un chiffre tiré de "
        "deux mois serait une invention, pas une mesure."
    )


def _reason_no_expense_rate() -> str:
    return (
        "Votre rythme de dépenses n'a pas pu être mesuré : il faut au moins "
        "trois mois complets de relevés. L'effet de cet achat sur votre fonds "
        "d'urgence ne peut donc pas être chiffré."
    )


def _reason_burn_not_positive() -> str:
    return (
        "Le rythme de dépenses mesuré n'est pas déficitaire : sans dépense "
        "nette à couvrir, il n'y a pas d'autonomie à réduire, et l'effet de "
        "cet achat sur le fonds d'urgence n'a pas de sens."
    )


def _validate(request: PurchaseRequest, assumptions: Assumptions) -> None:
    if request.target_cents <= 0:
        raise ValueError("Le prix du bien doit être strictement positif.")
    if not 1 <= request.horizon_months <= MAX_HORIZON_MONTHS:
        raise ValueError(
            f"L'échéance doit être comprise entre 1 et {MAX_HORIZON_MONTHS} mois."
        )
    if request.down_payment_cents < 0:
        raise ValueError("L'apport ne peut pas être négatif.")
    if request.nature not in NATURES:
        raise ValueError(f"Nature de bien inconnue : {request.nature}")
    if not 1 <= assumptions.ownership_years <= MAX_OWNERSHIP_YEARS:
        raise ValueError(
            f"La durée de possession doit être comprise entre 1 et "
            f"{MAX_OWNERSHIP_YEARS} ans."
        )


def _emergency(balance_cents: int, target_cents: int,
               expense_rate: MeasuredRate | None) -> EmergencyImpact:
    if expense_rate is None:
        return EmergencyImpact(None, None, _reason_no_expense_rate())
    if expense_rate.median_cents <= 0:
        return EmergencyImpact(None, None, _reason_burn_not_positive())
    burn = expense_rate.median_cents
    return EmergencyImpact(
        runway_months_before=months_of_runway(balance_cents, burn),
        runway_months_after=months_of_runway(balance_cents - target_cents, burn),
        unavailable_reason=None,
    )


def assess_feasibility(
    request: PurchaseRequest,
    capacity: MeasuredRate | None,
    expense_rate: MeasuredRate | None,
    balance_cents: int,
    assumptions: Assumptions,
    today: date,
) -> FeasibilityReport:
    """The verdict, the gap, the opportunity cost and the impact.

    See the module docstring for the refusal contract and for why a negative
    capacity produces an answer rather than a refusal.
    """
    _validate(request, assumptions)
    ownership_months = assumptions.ownership_years * 12
    horizon_end = month_end(today, request.horizon_months)
    opportunity = opportunity_cost_cents(
        request.target_cents, assumptions.annual_return_bps, ownership_months
    )
    emergency = _emergency(balance_cents, request.target_cents, expense_rate)

    if capacity is None:
        return FeasibilityReport(
            request=request, assumptions=assumptions, capacity=None,
            capacity_unavailable_reason=_reason_capacity_unmeasurable(),
            verdict=None, saved_at_horizon_cents=None, saved_at_horizon_low_cents=None,
            saved_at_horizon_high_cents=None, gap_cents=None,
            opportunity_cost_cents=opportunity, opportunity_horizon_months=ownership_months,
            impact=Impact(emergency=emergency, liquid_in_five_years_before_cents=None,
                          liquid_in_five_years_after_cents=None,
                          liquid_unavailable_reason=_reason_capacity_unmeasurable()),
            horizon_end_on=horizon_end,
        )

    def projected(monthly_cents: int) -> int:
        # Through `project_savings`, never a local loop: that function refuses
        # to credit interest to a non-positive balance, which is the whole
        # reason the operator's shrinking pot projects honestly.
        return project_savings(
            request.down_payment_cents, monthly_cents,
            assumptions.annual_return_bps, request.horizon_months,
        ).final_cents

    at_median = projected(capacity.median_cents)
    at_low = projected(capacity.low_cents)
    at_high = projected(capacity.high_cents)

    if at_low >= request.target_cents:
        verdict = "comfortable"
    elif at_median >= request.target_cents:
        verdict = "tight"
    else:
        verdict = "out_of_reach"

    five_years = 5 * 12
    liquid_before = project_savings(balance_cents, capacity.median_cents,
                                    assumptions.annual_return_bps, five_years).final_cents
    liquid_after = project_savings(balance_cents - request.target_cents,
                                   capacity.median_cents, assumptions.annual_return_bps,
                                   five_years).final_cents

    return FeasibilityReport(
        request=request, assumptions=assumptions, capacity=capacity,
        capacity_unavailable_reason=None, verdict=verdict,
        saved_at_horizon_cents=at_median, saved_at_horizon_low_cents=at_low,
        saved_at_horizon_high_cents=at_high,
        gap_cents=request.target_cents - at_median,
        opportunity_cost_cents=opportunity, opportunity_horizon_months=ownership_months,
        impact=Impact(emergency=emergency,
                      liquid_in_five_years_before_cents=liquid_before,
                      liquid_in_five_years_after_cents=liquid_after,
                      liquid_unavailable_reason=None),
        horizon_end_on=horizon_end,
    )
```

Note the unused import guard: `DEFAULT_OWNERSHIP_YEARS` is imported for callers that build `Assumptions` — if your linter flags it as unused, re-export it explicitly rather than deleting it, since Task 13 imports it from here.

- [ ] **Step 6: Run every affected suite**

Run from `backend/`:
```
.venv/Scripts/pytest.exe tests/test_feasibility.py tests/test_capacity.py tests/test_runway.py tests/test_cashflow_api.py -v
```
Expected: PASS. **`test_runway.py` and `test_cashflow_api.py` must pass with no edits to them** — if either needs changing, the extraction changed behaviour and must be redone.

- [ ] **Step 7: Mutation-check the three things that must never come back**

Apply each alone against a restored file, and record the result in the task report:

1. Wrap the capacity in `abs()` at the `projected(capacity.median_cents)` call. Expected: `test_a_negative_capacity_is_never_flipped_positive` and `test_the_operators_own_case_is_answered_not_refused` both go red.
2. Change the `comfortable` test from `at_low` to `at_high`. Expected: `test_a_target_only_the_median_reaches_is_tight` goes red — it would report "comfortable". This is the mutation that proves the band, not just a threshold, is doing the work.
3. Return a verdict of `"out_of_reach"` instead of `None` when `capacity is None`. Expected: `test_an_unmeasurable_capacity_refuses_rather_than_guessing` goes red. A refusal dressed as a verdict is the failure this engine exists to avoid.
4. Swap `_reason_no_expense_rate` and `_reason_burn_not_positive`. Expected: `test_the_emergency_impact_refuses_when_the_burn_is_unmeasurable` goes red on the inequality between the two sentences.

- [ ] **Step 8: Full suite and commit**

Run from `backend/`: `.venv/Scripts/pytest.exe -q --cov=app/engines --cov-report=term-missing`
Expected: **623** passed. `feasibility.py` at 100 %; `capacity.py` and `runway.py` still at 100 %.

```bash
git add backend/app/engines/feasibility.py backend/app/engines/capacity.py backend/app/engines/runway.py backend/tests/test_feasibility.py backend/tests/test_capacity.py backend/tests/test_runway.py
git commit -m "feat(engines): answer purchase feasibility from the measured savings capacity"
```

---
### Task 12: The levers, and comptant versus crédit versus LOA

§6.3 items 5 and 6. The five levers with their figures, and the wealth comparison that says at which loan rate borrowing stops destroying value.

**Files:**
- Create: `backend/app/engines/levers.py`
- Test: `backend/tests/test_levers.py`

**Interfaces:**
- Consumes: `feasibility.{Assumptions, FeasibilityReport, PurchaseRequest}`, `amortization.{HCSF_DEBT_RATIO_BPS, build_schedule, debt_ratio_bps, monthly_payment_cents}`, `savings.{months_to_target, project_savings, required_monthly_cents}`, `robust.median_cents`.
- Produces:
  - `CategoryHistory` frozen dataclass: `category_id: int`, `name: str`, `monthly_cents: list[int]` (positive magnitudes, one per complete observed month).
  - `Lever` frozen dataclass — `kind`, `feasible`, `unavailable_reason`, plus the kind-specific fields listed in the code below.
  - `LoaTerms` frozen dataclass: `deposit_cents`, `monthly_cents`, `months`, `residual_cents`.
  - `FinancingOption`, `FinancingComparison` frozen dataclasses.
  - `build_levers(report: FeasibilityReport, categories: list[CategoryHistory]) -> list[Lever]`
  - `compare_financing(price_cents, down_payment_cents, assumptions, loa) -> FinancingComparison`
  - `LEVER_KINDS = ("save_more", "delay", "reduce_target", "borrow", "cut_category")`, `MAX_SEARCHED_RATE_BPS = 3000`.
  - Consumed by Tasks 13 (`/api/feasibility`) and 16 (the levers panel).

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_levers.py`:

```python
from datetime import date

from app.engines.amortization import HCSF_DEBT_RATIO_BPS
from app.engines.capacity import MeasuredRate
from app.engines.feasibility import Assumptions, PurchaseRequest, assess_feasibility
from app.engines.levers import (
    LEVER_KINDS,
    CategoryHistory,
    LoaTerms,
    build_levers,
    compare_financing,
)

TODAY = date(2026, 8, 25)
HEALTHY = MeasuredRate(months=12, median_cents=400_000, spread_cents=78_000,
                       low_cents=300_000, high_cents=500_000)
BURN = MeasuredRate(months=12, median_cents=250_000, spread_cents=30_000,
                    low_cents=200_000, high_cents=300_000)
OPERATOR_CAPACITY = MeasuredRate(months=3, median_cents=-74_619, spread_cents=213_078,
                                 low_cents=-347_690, high_cents=198_452)
OPERATOR_BURN = MeasuredRate(months=3, median_cents=265_449, spread_cents=221_457,
                             low_cents=-18_360, high_cents=549_258)
ASSUMPTIONS = Assumptions(annual_return_bps=300, loan_rate_bps=500, loan_months=60,
                          ownership_years=5, monthly_income_cents=250_000,
                          existing_debt_payments_cents=0)
# The operator's measured income median is 47 111 c -- three complete months.
OPERATOR_ASSUMPTIONS = Assumptions(annual_return_bps=300, loan_rate_bps=500,
                                   loan_months=60, ownership_years=5,
                                   monthly_income_cents=47_111,
                                   existing_debt_payments_cents=0)

GROCERIES = CategoryHistory(category_id=7, name="Alimentation",
                            monthly_cents=[60_000, 55_000, 70_000, 58_000])
RESTAURANTS = CategoryHistory(category_id=9, name="Restaurants",
                              monthly_cents=[20_000, 12_000, 30_000, 18_000])


def _report(target, capacity, burn, assumptions, horizon=12, down=0, balance=1_000_000):
    return assess_feasibility(
        PurchaseRequest(target_cents=target, horizon_months=horizon,
                        down_payment_cents=down, nature="vehicle"),
        capacity, burn, balance, assumptions, TODAY,
    )


def _by_kind(levers):
    return {lever.kind: lever for lever in levers}


def test_every_lever_kind_is_returned_exactly_once():
    levers = build_levers(_report(6_000_000, HEALTHY, BURN, ASSUMPTIONS),
                          [GROCERIES, RESTAURANTS])
    assert sorted(lever.kind for lever in levers) == sorted(LEVER_KINDS)


def test_feasible_levers_come_first_and_the_rest_keep_the_documented_order():
    """No synthetic ranking score: the five levers are incommensurable -- euros
    per month, months, euros of target, a ratio -- and reducing them to one
    number means dividing by a quantity the data controls, the exact failure
    phase 2A ruled against after two rejected metrics."""
    levers = build_levers(_report(4_000_000, OPERATOR_CAPACITY, OPERATOR_BURN,
                                  OPERATOR_ASSUMPTIONS, balance=-220_963),
                          [GROCERIES, RESTAURANTS])
    flags = [lever.feasible for lever in levers]
    assert flags == sorted(flags, reverse=True)


def test_the_save_more_lever_is_the_shortfall_per_month():
    """6 000 000 c in 12 months needs 493 163 c/month; the household measures
    400 000 c. The lever is the difference, and the effort is expressed against
    the MEASURED capacity, not against an invented budget."""
    levers = _by_kind(build_levers(_report(6_000_000, HEALTHY, BURN, ASSUMPTIONS), []))
    lever = levers["save_more"]
    assert lever.feasible is True
    assert lever.extra_monthly_cents == 93_163
    assert lever.effort_ratio == 93_163 / 400_000


def test_the_save_more_lever_on_a_deficit_says_what_it_really_costs():
    """THE OPERATOR. 4 000 000 c in 12 months needs 328 775 c/month against a
    measured capacity of -74 619: the swing is 403 394 c/month, and it includes
    closing the deficit first. `effort_ratio` is None -- a ratio against a
    negative denominator is not an effort, it is a sign error waiting to be
    printed -- and the reason says so."""
    levers = _by_kind(build_levers(
        _report(4_000_000, OPERATOR_CAPACITY, OPERATOR_BURN, OPERATOR_ASSUMPTIONS,
                balance=-220_963), []))
    lever = levers["save_more"]
    assert lever.extra_monthly_cents == 403_394
    assert lever.effort_ratio is None
    assert lever.feasible is True
    assert "déficit" in (lever.note or "")


def test_the_delay_lever_counts_the_extra_months():
    """At 400 000 c/month, 6 000 000 c is reached in 15 months against a
    12-month horizon: three months later."""
    levers = _by_kind(build_levers(_report(6_000_000, HEALTHY, BURN, ASSUMPTIONS), []))
    lever = levers["delay"]
    assert lever.feasible is True
    assert lever.delay_months == 3
    assert lever.reached_in_months == 15


def test_the_delay_lever_refuses_on_a_capacity_that_never_gets_there():
    """THE OPERATOR AGAIN. `savings.months_to_target` returns None at a
    non-positive rate: no delay ever reaches the target, and quoting one would
    put a date on screen that will never arrive."""
    levers = _by_kind(build_levers(
        _report(4_000_000, OPERATOR_CAPACITY, OPERATOR_BURN, OPERATOR_ASSUMPTIONS,
                balance=-220_963), []))
    lever = levers["delay"]
    assert lever.feasible is False
    assert lever.delay_months is None
    assert "négative" in lever.unavailable_reason


def test_the_reduce_target_lever_is_what_the_horizon_actually_reaches():
    levers = _by_kind(build_levers(_report(6_000_000, HEALTHY, BURN, ASSUMPTIONS), []))
    lever = levers["reduce_target"]
    assert lever.feasible is True
    assert lever.reduced_target_cents == 4_866_555


def test_the_reduce_target_lever_refuses_when_nothing_is_reachable():
    """A reachable amount of -895 428 c is not a smaller car. Offering it would
    print "ramenez votre cible à -8 954,28 EUR"."""
    levers = _by_kind(build_levers(
        _report(4_000_000, OPERATOR_CAPACITY, OPERATOR_BURN, OPERATOR_ASSUMPTIONS,
                balance=-220_963), []))
    lever = levers["reduce_target"]
    assert lever.feasible is False
    assert lever.reduced_target_cents is None
    assert "aucune cible" in lever.unavailable_reason.lower()


def test_the_borrow_lever_prices_the_gap_and_the_debt_ratio():
    """1 133 445 c over 60 months at 5,00 %: 21 390 c/month, 149 924 c of
    interest, 856 bps of debt ratio against 250 000 c of measured income."""
    levers = _by_kind(build_levers(_report(6_000_000, HEALTHY, BURN, ASSUMPTIONS), []))
    lever = levers["borrow"]
    assert lever.borrow_cents == 1_133_445
    assert lever.loan_payment_cents == 21_390
    assert lever.loan_total_interest_cents == 149_924
    assert lever.debt_ratio_bps == 856
    assert lever.debt_ratio_exceeded is False


def test_the_borrow_lever_raises_the_thirty_five_percent_alarm():
    """THE OPERATOR: 4 895 428 c over 60 months at 5,00 % is 92 383 c/month
    against a measured income of 47 111 c -- 19 610 basis points, 196 % of what
    he earns. Design §6.3 item 5 asks for the alert at 3 500."""
    levers = _by_kind(build_levers(
        _report(4_000_000, OPERATOR_CAPACITY, OPERATOR_BURN, OPERATOR_ASSUMPTIONS,
                balance=-220_963), []))
    lever = levers["borrow"]
    assert lever.borrow_cents == 4_895_428
    assert lever.loan_payment_cents == 92_383
    assert lever.loan_total_interest_cents == 647_532
    assert lever.debt_ratio_bps == 19_610
    assert lever.debt_ratio_bps > HCSF_DEBT_RATIO_BPS
    assert lever.debt_ratio_exceeded is True


def test_the_borrow_lever_has_no_ratio_without_a_measured_income():
    no_income = Assumptions(annual_return_bps=300, loan_rate_bps=500, loan_months=60,
                            ownership_years=5, monthly_income_cents=None,
                            existing_debt_payments_cents=0)
    levers = _by_kind(build_levers(_report(6_000_000, HEALTHY, BURN, no_income), []))
    lever = levers["borrow"]
    assert lever.debt_ratio_bps is None
    # Not "0 % d'endettement", and not "seuil dépassé" either.
    assert lever.debt_ratio_exceeded is False
    assert "revenu" in (lever.note or "")


def test_the_borrow_lever_is_not_offered_when_there_is_no_gap():
    levers = _by_kind(build_levers(_report(3_500_000, HEALTHY, BURN, ASSUMPTIONS), []))
    lever = levers["borrow"]
    assert lever.feasible is False
    assert "déjà" in lever.unavailable_reason


def test_the_cut_category_lever_names_a_category_and_checks_its_history():
    """Alimentation's monthly spends are 60 000 / 55 000 / 70 000 / 58 000, so
    the median is 59 000. Freeing 93 163 c/month from it is impossible; the
    lever must say which category comes closest rather than proposing a cut the
    history says has never happened."""
    levers = _by_kind(build_levers(
        _report(6_000_000, HEALTHY, BURN, ASSUMPTIONS), [GROCERIES, RESTAURANTS]))
    lever = levers["cut_category"]
    assert lever.feasible is False
    assert lever.category_name == "Alimentation"
    assert lever.category_median_cents == 59_000
    assert "93" in lever.unavailable_reason or "Alimentation" in lever.unavailable_reason


def test_the_cut_category_lever_uses_the_history_to_say_whether_it_is_realistic():
    """A cut the household has already achieved in some months is a different
    proposition from one it never has. 15 000 c off Alimentation's 59 000 c
    median leaves 44 000 c, and the history holds no month at or below that --
    so `months_at_or_below` is 0 out of 4, and the copy can say so."""
    levers = _by_kind(build_levers(
        _report(4_866_555 + 180_000, HEALTHY, BURN, ASSUMPTIONS),
        [GROCERIES, RESTAURANTS]))
    lever = levers["cut_category"]
    assert lever.feasible is True
    assert lever.category_name == "Alimentation"
    assert lever.months_observed == 4
    assert lever.months_at_or_below is not None


def test_the_cut_category_lever_refuses_when_no_category_history_exists():
    levers = _by_kind(build_levers(_report(6_000_000, HEALTHY, BURN, ASSUMPTIONS), []))
    lever = levers["cut_category"]
    assert lever.feasible is False
    assert lever.category_name is None
    assert "catégorie" in lever.unavailable_reason


def test_no_levers_at_all_when_the_capacity_could_not_be_measured():
    """Nothing to change, because nothing was measured. The screen shows the
    capacity refusal instead -- an empty lever list is not a lever list of
    refusals, which would print five sentences all saying the same thing."""
    assert build_levers(_report(6_000_000, None, BURN, ASSUMPTIONS), [GROCERIES]) == []


def test_borrowing_beats_cash_below_the_break_even_rate_and_loses_above_it():
    """20 000 EUR, 4 000 EUR down, 48 months, savings at 3,00 %/an. Both paths
    end owning the same thing and spending the same monthly euros; the only
    difference is where the money sits. Break-even lands at 299 bps -- one
    basis point under the 3,00 % return, the whole gap being the cent-rounding
    in the two projections."""
    comparison = compare_financing(2_000_000, 400_000, ASSUMPTIONS, None)
    assert comparison.break_even_rate_bps == 299
    assert comparison.break_even_reason is None
    by_kind = {option.kind: option for option in comparison.options}
    # ASSUMPTIONS carries loan_rate_bps=500, above the break-even, so cash wins.
    assert by_kind["cash"].wealth_at_end_cents > by_kind["credit"].wealth_at_end_cents
    assert comparison.better_kind == "cash"


def test_credit_wins_below_the_break_even_rate():
    cheap = Assumptions(annual_return_bps=300, loan_rate_bps=100, loan_months=48,
                        ownership_years=5, monthly_income_cents=250_000,
                        existing_debt_payments_cents=0)
    comparison = compare_financing(2_000_000, 400_000, cheap, None)
    by_kind = {option.kind: option for option in comparison.options}
    assert by_kind["credit"].wealth_at_end_cents > by_kind["cash"].wealth_at_end_cents
    assert comparison.better_kind == "credit"


def test_the_loa_line_is_a_cost_comparison_and_never_a_wealth_one():
    """Whether the lessee owns anything at the end depends on a choice the
    contract leaves open, so no end-wealth figure is produced -- and the option
    says why, rather than leaving a null a screen might render as zero."""
    loa = LoaTerms(deposit_cents=300_000, monthly_cents=25_000, months=48,
                   residual_cents=800_000)
    comparison = compare_financing(2_000_000, 400_000, ASSUMPTIONS, loa)
    option = {o.kind: o for o in comparison.options}["loa"]
    assert option.available is True
    assert option.total_paid_cents == 300_000 + 25_000 * 48 + 800_000
    assert option.wealth_at_end_cents is None
    assert option.wealth_unavailable_reason is not None


def test_without_loa_terms_the_option_says_so_rather_than_inventing_them():
    """Yieldo has no French average for one dealer's contract. Design §6.3's
    LOA column stays empty until the user types the quote in."""
    option = {o.kind: o for o in compare_financing(2_000_000, 400_000, ASSUMPTIONS,
                                                   None).options}["loa"]
    assert option.available is False
    assert option.total_paid_cents is None
    assert "loyer" in option.unavailable_reason.lower() or \
        "location" in option.unavailable_reason.lower()
```

- [ ] **Step 2: Run it and watch it fail**

Run from `backend/`: `.venv/Scripts/pytest.exe tests/test_levers.py -v`
Expected: FAIL — `ModuleNotFoundError`.

- [ ] **Step 3: Write the implementation**

Create `backend/app/engines/levers.py`:

```python
"""What would have to change, and what borrowing actually costs.

Design §6.3 items 5 and 6.

**The levers are not ranked by one score, and that is a decision, not an
omission.** §6.3 asks for "leviers chiffrés et classés". The five are
incommensurable -- euros per month, months of delay, euros of target, a debt
ratio, a category's spend -- and collapsing them onto a common scale means
dividing by a quantity the data controls, which is exactly the failure phase 2A
task 16 ruled against after trying and rejecting two ranking metrics. What is
delivered instead: **feasible levers first, then the fixed order
`save_more, delay, reduce_target, borrow, cut_category`**, each carrying its own
figure and, when it cannot be offered, its own French reason. A screen can then
present five honest options rather than one confident ordering built on a
number nobody can defend.

**The cash-versus-credit comparison holds INCOME constant, not capital.** Both
paths end owning the same asset and spending the same euros each month; the
only difference is where the money sits:

* *comptant* -- the capital is spent, and the instalment the buyer does not owe
  is invested every month instead;
* *crédit* -- only the down payment is spent, the rest of the capital stays
  invested untouched, and the instalment leaves the household's income.

Framed this way the credit path's end wealth does not depend on the loan rate
at all, while the cash path's does (a dearer loan means a bigger instalment to
invest). Their difference is therefore strictly decreasing in the loan rate,
which makes the break-even rate a clean binary search and makes §6.3's sentence
-- "si l'épargne rapporte plus que le coût du crédit, payer comptant détruit de
la valeur" -- a computed figure rather than a slogan. On a 3,00 % return the
break-even lands within a basis point of 3,00 %, which is the check that the
model is doing what it claims.

**LOA is compared on cash figures only.** Whether the lessee owns anything at
the end depends on a choice the contract leaves open, and the terms come from a
dealer's quote. With no terms supplied the option says so; it never invents a
French average for one specific contract.

Pure: no session, no network, no clock.
"""

from dataclasses import dataclass

from app.engines.amortization import (
    HCSF_DEBT_RATIO_BPS,
    build_schedule,
    debt_ratio_bps,
    monthly_payment_cents,
)
from app.engines.feasibility import Assumptions, FeasibilityReport
from app.engines.robust import median_cents
from app.engines.savings import (
    months_to_target,
    project_savings,
    required_monthly_cents,
)

LEVER_KINDS = ("save_more", "delay", "reduce_target", "borrow", "cut_category")

# A loan rate above 30 %/an is not a mortgage or a car loan; the break-even
# search stops there and says so rather than walking to an absurd figure.
MAX_SEARCHED_RATE_BPS = 3000


@dataclass(frozen=True)
class CategoryHistory:
    """One category's measured monthly spend, as POSITIVE magnitudes, one entry
    per complete observed month. The caller builds these the way
    `aggregate.aggregate_by_category` does -- excluding income rows rather than
    netting them in -- and takes the magnitude."""

    category_id: int
    name: str
    monthly_cents: list[int]


@dataclass(frozen=True)
class Lever:
    """One way out, with its number.

    Every field below is populated on EXACTLY ONE kind and is None on the other
    four. That is the price of a flat wire shape; the alternative is five
    payload types the screen has to discriminate. `kind` decides which fields
    to read, and nothing else does.
    """

    kind: str
    feasible: bool
    # French. Set exactly when `feasible` is False.
    unavailable_reason: str | None
    # An extra remark on a FEASIBLE lever -- e.g. that the extra monthly saving
    # includes closing an existing deficit, or that no income was measured so
    # the debt ratio is absent. None when there is nothing to add. Never a
    # substitute for `unavailable_reason`, which only appears on a refusal.
    note: str | None

    # save_more
    extra_monthly_cents: int | None
    # The extra as a fraction of the MEASURED capacity. **None when the
    # capacity is not positive**: a ratio against a negative denominator is not
    # an effort, it is a sign error waiting to be rendered as "-540 % d'effort".
    effort_ratio: float | None

    # delay
    reached_in_months: int | None
    delay_months: int | None

    # reduce_target
    reduced_target_cents: int | None

    # borrow
    borrow_cents: int | None
    loan_payment_cents: int | None
    loan_total_interest_cents: int | None
    # None when no income could be measured. Never 0, which would render as
    # "0 % d'endettement" on a household whose income is simply unknown.
    debt_ratio_bps: int | None
    # False both when the ratio is comfortably under the threshold AND when
    # there is no ratio at all. A screen must read `debt_ratio_bps is None`
    # first; this flag alone cannot tell the two apart, and says so here.
    debt_ratio_exceeded: bool

    # cut_category
    category_id: int | None
    category_name: str | None
    category_median_cents: int | None
    cut_monthly_cents: int | None
    # How many of the observed months already sat at or below the post-cut
    # level -- the history that says whether the cut is realistic. None when no
    # category history was supplied.
    months_at_or_below: int | None
    months_observed: int | None


def _lever(kind: str, **fields) -> Lever:
    """Build a lever with every unset field explicitly None, so adding a field
    to `Lever` later cannot silently leave four kinds carrying a stale value."""
    base = dict(
        feasible=True, unavailable_reason=None, note=None,
        extra_monthly_cents=None, effort_ratio=None,
        reached_in_months=None, delay_months=None, reduced_target_cents=None,
        borrow_cents=None, loan_payment_cents=None, loan_total_interest_cents=None,
        debt_ratio_bps=None, debt_ratio_exceeded=False,
        category_id=None, category_name=None, category_median_cents=None,
        cut_monthly_cents=None, months_at_or_below=None, months_observed=None,
    )
    base.update(fields)
    return Lever(kind=kind, **base)


def _save_more(report: FeasibilityReport) -> Lever:
    capacity = report.capacity
    required = required_monthly_cents(
        report.request.target_cents, report.request.down_payment_cents,
        report.assumptions.annual_return_bps, report.request.horizon_months,
    )
    extra = required - capacity.median_cents
    if extra <= 0:
        return _lever("save_more", feasible=False, extra_monthly_cents=0,
                      unavailable_reason=(
                          "Votre capacité d'épargne mesurée suffit déjà : il n'y a "
                          "rien de plus à mettre de côté chaque mois."))
    if capacity.median_cents <= 0:
        return _lever(
            "save_more", extra_monthly_cents=extra, effort_ratio=None,
            note=("Ce montant comprend le retour à l'équilibre : votre capacité "
                  "d'épargne mesurée est actuellement un déficit, et il faut d'abord "
                  "le combler avant de mettre quoi que ce soit de côté."))
    return _lever("save_more", extra_monthly_cents=extra,
                  effort_ratio=extra / capacity.median_cents)


def _delay(report: FeasibilityReport) -> Lever:
    capacity = report.capacity
    if capacity.median_cents <= 0:
        return _lever("delay", feasible=False, unavailable_reason=(
            "Votre capacité d'épargne mesurée est négative ou nulle : attendre "
            "n'y change rien, la somme mise de côté ne grandit pas avec le temps."))
    reached = months_to_target(
        report.request.target_cents, report.request.down_payment_cents,
        capacity.median_cents, report.assumptions.annual_return_bps,
    )
    if reached is None:
        return _lever("delay", feasible=False, unavailable_reason=(
            "Au rythme mesuré, cette somme ne serait pas réunie avant cinquante "
            "ans. Aucun report n'est proposé au-delà : il ne voudrait rien dire."))
    delay = reached - report.request.horizon_months
    if delay <= 0:
        return _lever("delay", feasible=False, reached_in_months=reached, delay_months=0,
                      unavailable_reason=(
                          "L'échéance que vous avez fixée est déjà tenable : il n'y a "
                          "rien à reporter."))
    return _lever("delay", reached_in_months=reached, delay_months=delay)


def _reduce_target(report: FeasibilityReport) -> Lever:
    reachable = report.saved_at_horizon_cents
    if reachable <= 0:
        return _lever("reduce_target", feasible=False, unavailable_reason=(
            "Aucune cible n'est atteignable à l'échéance choisie : au rythme "
            "mesuré, la somme mise de côté diminue au lieu d'augmenter."))
    if reachable >= report.request.target_cents:
        return _lever("reduce_target", feasible=False,
                      reduced_target_cents=reachable, unavailable_reason=(
                          "Votre cible est déjà dans ce que l'échéance permet : il "
                          "n'y a rien à réduire."))
    return _lever("reduce_target", reduced_target_cents=reachable)


def _borrow(report: FeasibilityReport) -> Lever:
    gap = report.gap_cents
    if gap <= 0:
        return _lever("borrow", feasible=False, unavailable_reason=(
            "L'échéance couvre déjà le prix : il n'y a rien à emprunter."))
    assumptions = report.assumptions
    payment = monthly_payment_cents(gap, assumptions.loan_rate_bps, assumptions.loan_months)
    schedule = build_schedule(gap, assumptions.loan_rate_bps, assumptions.loan_months)
    ratio = debt_ratio_bps(
        assumptions.existing_debt_payments_cents + payment,
        assumptions.monthly_income_cents,
    )
    note = None
    if ratio is None:
        note = (
            "Le taux d'endettement n'est pas calculé : vos revenus n'ont pas pu "
            "être mesurés sur au moins trois mois complets de relevés."
        )
    return _lever("borrow", borrow_cents=gap, loan_payment_cents=payment,
                  loan_total_interest_cents=schedule.total_interest_cents,
                  debt_ratio_bps=ratio,
                  debt_ratio_exceeded=ratio is not None and ratio > HCSF_DEBT_RATIO_BPS,
                  note=note)


def _cut_category(report: FeasibilityReport, categories: list[CategoryHistory],
                  needed_monthly_cents: int | None) -> Lever:
    usable = [c for c in categories if c.monthly_cents]
    if not usable:
        return _lever("cut_category", feasible=False, unavailable_reason=(
            "Aucune catégorie de dépense n'a assez d'historique pour dire ce "
            "qu'elle coûte un mois normal. Importez davantage de relevés."))
    if needed_monthly_cents is None or needed_monthly_cents <= 0:
        return _lever("cut_category", feasible=False, unavailable_reason=(
            "Rien n'a besoin d'être libéré chaque mois : l'échéance est déjà "
            "tenable au rythme mesuré."))

    ranked = sorted(usable, key=lambda c: median_cents(c.monthly_cents), reverse=True)
    best = ranked[0]
    median = median_cents(best.monthly_cents)
    if median < needed_monthly_cents:
        return _lever(
            "cut_category", feasible=False, category_id=best.category_id,
            category_name=best.name, category_median_cents=median,
            months_observed=len(best.monthly_cents),
            unavailable_reason=(
                f"Aucune catégorie ne pèse assez pour libérer la somme nécessaire "
                f"chaque mois. La plus lourde, « {best.name} », coûte moins que "
                "cela un mois normal : la supprimer entièrement ne suffirait pas."))

    after = median - needed_monthly_cents
    return _lever(
        "cut_category", category_id=best.category_id, category_name=best.name,
        category_median_cents=median, cut_monthly_cents=needed_monthly_cents,
        months_at_or_below=sum(1 for value in best.monthly_cents if value <= after),
        months_observed=len(best.monthly_cents),
    )


def build_levers(
    report: FeasibilityReport, categories: list[CategoryHistory]
) -> list[Lever]:
    """The five levers, feasible ones first, in the documented order otherwise.

    Returns an EMPTY list when `report.capacity` is None. Five refusals all
    saying "your capacity could not be measured" is five copies of one
    sentence; the screen prints `report.capacity_unavailable_reason` once
    instead.
    """
    if report.capacity is None:
        return []

    save_more = _save_more(report)
    levers = [
        save_more,
        _delay(report),
        _reduce_target(report),
        _borrow(report),
        _cut_category(report, categories, save_more.extra_monthly_cents),
    ]
    # Stable sort: feasible first, and the documented order preserved inside
    # each group. `sorted` is guaranteed stable in Python, which is what makes
    # "then the fixed order" true rather than incidental.
    return sorted(levers, key=lambda lever: 0 if lever.feasible else 1)


@dataclass(frozen=True)
class LoaTerms:
    """A location avec option d'achat, as quoted by a dealer. Every figure comes
    from the user; Yieldo has no average for one specific contract."""

    deposit_cents: int
    monthly_cents: int
    months: int
    # The buy-out price at the end. The lessee may or may not pay it -- which
    # is exactly why no end-wealth figure is produced for this option.
    residual_cents: int


@dataclass(frozen=True)
class FinancingOption:
    kind: str
    # False only for `loa` with no terms supplied.
    available: bool
    unavailable_reason: str | None
    # Cash out of the household's own capital on day one.
    out_of_pocket_cents: int | None
    monthly_cents: int | None
    total_paid_cents: int | None
    interest_cents: int | None
    # Wealth at the end of the loan term, under the income-constant framing in
    # the module docstring. None on the LOA option, always.
    wealth_at_end_cents: int | None
    # Set exactly when `wealth_at_end_cents` is None on an AVAILABLE option.
    wealth_unavailable_reason: str | None


@dataclass(frozen=True)
class FinancingComparison:
    horizon_months: int
    options: list[FinancingOption]
    # The loan rate at which borrowing and paying cash leave the household
    # equally wealthy. Below it, borrowing wins; above it, cash does. None when
    # the crossing is outside the searched range, with the reason saying which
    # side.
    break_even_rate_bps: int | None
    break_even_reason: str | None
    # "cash" or "credit". Compares ONLY the two options that carry a wealth
    # figure; the LOA line is deliberately not in the running, and the screen
    # must say so rather than implying a three-way verdict.
    better_kind: str


def _wealth_cash(borrowed_cents: int, rate_bps: int, assumptions: Assumptions) -> int:
    payment = monthly_payment_cents(borrowed_cents, rate_bps, assumptions.loan_months)
    return project_savings(0, payment, assumptions.annual_return_bps,
                           assumptions.loan_months).final_cents


def _wealth_credit(borrowed_cents: int, assumptions: Assumptions) -> int:
    # Independent of the loan rate by construction: the instalment leaves the
    # household's income, not this pot. See the module docstring.
    return project_savings(borrowed_cents, 0, assumptions.annual_return_bps,
                           assumptions.loan_months).final_cents


def compare_financing(
    price_cents: int,
    down_payment_cents: int,
    assumptions: Assumptions,
    loa: LoaTerms | None,
) -> FinancingComparison:
    """Comptant, crédit and LOA, plus the rate at which borrowing starts to pay.

    See the module docstring for the framing and for why the LOA line carries
    no wealth figure.
    """
    if price_cents <= 0:
        raise ValueError("Le prix du bien doit être strictement positif.")
    if not 0 <= down_payment_cents <= price_cents:
        raise ValueError("L'apport doit être compris entre zéro et le prix du bien.")

    borrowed = price_cents - down_payment_cents
    schedule = build_schedule(borrowed, assumptions.loan_rate_bps, assumptions.loan_months)
    cash_wealth = _wealth_cash(borrowed, assumptions.loan_rate_bps, assumptions)
    credit_wealth = _wealth_credit(borrowed, assumptions)

    options = [
        FinancingOption(
            kind="cash", available=True, unavailable_reason=None,
            out_of_pocket_cents=price_cents,
            monthly_cents=0, total_paid_cents=price_cents, interest_cents=0,
            wealth_at_end_cents=cash_wealth, wealth_unavailable_reason=None,
        ),
        FinancingOption(
            kind="credit", available=True, unavailable_reason=None,
            out_of_pocket_cents=down_payment_cents,
            monthly_cents=schedule.monthly_payment_cents,
            total_paid_cents=down_payment_cents + schedule.total_paid_cents,
            interest_cents=schedule.total_interest_cents,
            wealth_at_end_cents=credit_wealth, wealth_unavailable_reason=None,
        ),
    ]

    if loa is None:
        options.append(FinancingOption(
            kind="loa", available=False,
            unavailable_reason=(
                "Aucun loyer de location avec option d'achat n'a été saisi. Ces "
                "montants viennent du devis du concessionnaire : Yieldo ne les "
                "invente pas."),
            out_of_pocket_cents=None, monthly_cents=None, total_paid_cents=None,
            interest_cents=None, wealth_at_end_cents=None,
            wealth_unavailable_reason=None,
        ))
    else:
        options.append(FinancingOption(
            kind="loa", available=True, unavailable_reason=None,
            out_of_pocket_cents=loa.deposit_cents, monthly_cents=loa.monthly_cents,
            total_paid_cents=loa.deposit_cents + loa.monthly_cents * loa.months
            + loa.residual_cents,
            interest_cents=None, wealth_at_end_cents=None,
            wealth_unavailable_reason=(
                "Aucun patrimoine final n'est calculé pour la LOA : selon que "
                "l'option d'achat est levée ou non, vous finissez propriétaire "
                "du bien ou sans rien, et le contrat laisse ce choix ouvert."),
        ))

    # `difference` is strictly decreasing in the loan rate: credit's wealth does
    # not depend on it, cash's grows with it. Binary search for the last rate at
    # which credit is still at least as good.
    def difference(rate_bps: int) -> int:
        return credit_wealth - _wealth_cash(borrowed, rate_bps, assumptions)

    break_even: int | None = None
    reason: str | None = None
    if borrowed <= 0:
        reason = ("Il n'y a rien à emprunter : l'apport couvre déjà le prix. "
                  "Aucun taux d'équilibre n'a de sens ici.")
    elif difference(0) < 0:
        reason = ("Emprunter coûte plus que ne rapporte votre épargne, quel que "
                  "soit le taux : au rendement retenu, payer comptant est "
                  "toujours préférable.")
    elif difference(MAX_SEARCHED_RATE_BPS) > 0:
        reason = (f"Emprunter reste avantageux jusqu'à "
                  f"{MAX_SEARCHED_RATE_BPS // 100} %, la limite au-delà de "
                  "laquelle ce calcul n'a plus de sens.")
    else:
        low, high = 0, MAX_SEARCHED_RATE_BPS
        while low < high:
            middle = (low + high + 1) // 2
            if difference(middle) >= 0:
                low = middle
            else:
                high = middle - 1
        break_even = low

    return FinancingComparison(
        horizon_months=assumptions.loan_months, options=options,
        break_even_rate_bps=break_even, break_even_reason=reason,
        better_kind="credit" if credit_wealth > cash_wealth else "cash",
    )
```

- [ ] **Step 4: Run the test to verify it passes**

Run from `backend/`: `.venv/Scripts/pytest.exe tests/test_levers.py -v`
Expected: PASS, 19 tests.

- [ ] **Step 5: Mutation-check what the reviewers would check by hand**

Each alone, against a restored file:

1. In `_save_more`, compute `effort_ratio` unconditionally. Expected: `test_the_save_more_lever_on_a_deficit_says_what_it_really_costs` goes red — the ratio comes out at −5.4, which is what would otherwise be printed as an effort.
2. In `_borrow`, set `debt_ratio_exceeded=True` when `ratio is None`. Expected: `test_the_borrow_lever_has_no_ratio_without_a_measured_income` goes red.
3. In `build_levers`, use `sorted(..., reverse=True)` on the feasibility key. Expected: `test_feasible_levers_come_first_and_the_rest_keep_the_documented_order` goes red.
4. In `compare_financing`, make `_wealth_credit` subtract the instalments (the double-count that broke the first draft of this comparison). Expected: `test_borrowing_beats_cash_below_the_break_even_rate_and_loses_above_it` goes red — the break-even collapses toward zero.
5. Give the LOA option a `wealth_at_end_cents`. Expected: `test_the_loa_line_is_a_cost_comparison_and_never_a_wealth_one` goes red.

- [ ] **Step 6: Full suite and commit**

Run from `backend/`: `.venv/Scripts/pytest.exe -q --cov=app/engines --cov-report=term-missing`
Expected: **642** passed, `levers.py` at 100 %.

```bash
git add backend/app/engines/levers.py backend/tests/test_levers.py
git commit -m "feat(engines): price the five feasibility levers and the cash-versus-credit crossover"
```

---
### Task 13: `/api/feasibility` — the measured inputs, assembled

**Files:**
- Create: `backend/app/api/feasibility.py`, `backend/app/schemas/feasibility.py`
- Modify: `backend/app/main.py`, `backend/app/api/errors.py`
- Test: `backend/tests/test_feasibility_api.py`

**Interfaces:**
- Consumes: `feasibility.*`, `levers.*`, `ownership.*`, `capacity.{measure_savings_capacity, measure_expense_rate, measure_income_rate}`, `api.common.{liquid_balance_cents, tx_points}`, `api.goals.{observed_months, rate_out}`, `models.{Category, Debt}`.
- Produces:
  - `GET /api/feasibility/context` → `FeasibilityContextOut` — everything measured, so the form can prefill honestly before the user has typed anything.
  - `POST /api/feasibility` → `FeasibilityOut` — the full §6.3 answer.
  - Schemas listed in Step 3.
  - Consumed by Tasks 14 (scenarios recompute through the same function), 15 and 16 (screens).

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_feasibility_api.py`:

```python
def _register(client, email="faisabilite@example.fr"):
    body = client.post("/api/auth/register", json={
        "name": "Max", "email": email, "password": "motdepasse123"}).json()
    return {"Authorization": f"Bearer {body['access_token']}"}


REQUEST = {"target_cents": 4_000_000, "horizon_months": 12,
           "down_payment_cents": 0, "nature": "vehicle"}


def test_a_household_with_no_history_gets_a_refusal_not_a_verdict(client):
    headers = _register(client)
    body = client.post("/api/feasibility", headers=headers, json=REQUEST).json()
    assert body["verdict"] is None
    assert body["capacity"] is None
    assert "trois mois complets" in body["capacity_unavailable_reason"]
    # And no levers at all -- five refusals repeating one sentence is not five
    # options.
    assert body["levers"] == []
    # The cost of ownership does NOT depend on the capacity and is still there.
    assert body["ownership"]["total_cost_cents"] > 0


def test_the_context_route_prefills_only_what_it_measured(client):
    headers = _register(client)
    body = client.get("/api/feasibility/context", headers=headers).json()
    assert body["capacity"] is None
    assert body["expense_rate"] is None
    assert body["income_rate"] is None
    assert body["months_observed"] == 0
    assert body["balance_cents"] == 0
    assert body["existing_debt_payments_cents"] == 0
    # The assumptions ARE prefilled -- they are declared defaults, not
    # measurements, and the screen prints them as such.
    assert body["assumptions"]["annual_return_bps"] == 300


def test_existing_debt_instalments_feed_the_debt_ratio(client):
    headers = _register(client)
    client.post("/api/debts", headers=headers, json={
        "name": "Conso", "kind": "consumer", "principal_cents": 500_000,
        "annual_rate_bps": 600, "minimum_payment_cents": 15_000, "term_months": 36})
    body = client.get("/api/feasibility/context", headers=headers).json()
    assert body["existing_debt_payments_cents"] == 15_000


def test_an_archived_debt_no_longer_counts(client):
    headers = _register(client)
    debt = client.post("/api/debts", headers=headers, json={
        "name": "Conso", "kind": "consumer", "principal_cents": 500_000,
        "annual_rate_bps": 600, "minimum_payment_cents": 15_000,
        "term_months": 36}).json()
    client.delete(f"/api/debts/{debt['id']}", headers=headers)
    assert client.get("/api/feasibility/context",
                      headers=headers).json()["existing_debt_payments_cents"] == 0


def test_the_full_answer_is_produced_from_real_transactions(client, imported):
    headers, _account = imported
    body = client.post("/api/feasibility", headers=headers, json=REQUEST).json()
    assert set(body) >= {"verdict", "capacity", "gap_cents", "levers", "financing",
                         "ownership", "impact", "opportunity_cost_cents"}
    if body["capacity"] is None:
        assert body["verdict"] is None and body["levers"] == []
    else:
        assert body["verdict"] in ("comfortable", "tight", "out_of_reach")
        assert len(body["levers"]) == 5
        # Feasible levers first -- the documented ordering, on the wire.
        flags = [lever["feasible"] for lever in body["levers"]]
        assert flags == sorted(flags, reverse=True)


def test_the_vehicle_defaults_are_returned_and_are_overridable(client):
    headers = _register(client)
    default = client.post("/api/feasibility", headers=headers, json=REQUEST).json()
    assert {line["key"] for line in default["ownership"]["lines"]} == {
        "insurance", "maintenance", "fuel"}

    custom = client.post("/api/feasibility", headers=headers, json={
        **REQUEST,
        "ownership_items": [
            {"key": "insurance", "label": "Assurance", "monthly_cents": 9_000,
             "annual_bps_of_value": None}],
    }).json()
    assert {line["key"] for line in custom["ownership"]["lines"]} == {"insurance"}
    assert custom["ownership"]["lines"][0]["total_cents"] == 9_000 * 60


def test_an_engine_refusal_arrives_as_a_french_422_not_a_500(client):
    headers = _register(client)
    response = client.post("/api/feasibility", headers=headers, json={
        **REQUEST, "ownership_items": [
            {"key": "x", "label": "Assurance", "monthly_cents": 100,
             "annual_bps_of_value": 100}]})
    assert response.status_code == 422
    assert "Assurance" in response.json()["detail"]


def test_a_target_of_zero_is_refused_in_french(client):
    headers = _register(client)
    response = client.post("/api/feasibility", headers=headers,
                           json={**REQUEST, "target_cents": 0})
    assert response.status_code == 422


def test_loa_terms_travel_through_to_the_comparison(client):
    headers = _register(client)
    body = client.post("/api/feasibility", headers=headers, json={
        **REQUEST, "loa": {"deposit_cents": 300_000, "monthly_cents": 25_000,
                           "months": 48, "residual_cents": 800_000}}).json()
    loa = {option["kind"]: option for option in body["financing"]["options"]}["loa"]
    assert loa["available"] is True
    assert loa["total_paid_cents"] == 300_000 + 25_000 * 48 + 800_000
    assert loa["wealth_at_end_cents"] is None


def test_feasibility_never_reads_another_users_data(client):
    """Both directions, and on the MEASURED inputs specifically: a second
    user's statements must not widen this user's capacity."""
    alice = _register(client, "alice3@example.fr")
    bob = _register(client, "bob3@example.fr")
    client.post("/api/debts", headers=bob, json={
        "name": "Bob", "kind": "consumer", "principal_cents": 500_000,
        "annual_rate_bps": 600, "minimum_payment_cents": 15_000, "term_months": 36})
    alice_context = client.get("/api/feasibility/context", headers=alice).json()
    bob_context = client.get("/api/feasibility/context", headers=bob).json()
    assert alice_context["existing_debt_payments_cents"] == 0
    assert bob_context["existing_debt_payments_cents"] == 15_000
```

- [ ] **Step 2: Run it and watch it fail** — 404 on both routes.

- [ ] **Step 3: Write the schemas**

Create `backend/app/schemas/feasibility.py`. The shapes, each mirroring its engine dataclass one-to-one with the same field docstrings copied across (the docstrings ARE the contract — phase 2A left three of them untrue for three rounds while the logic held, so treat them as code):

```python
"""Wire shapes for /api/feasibility.

Design §6.3. Every measured input travels beside the verdict it produced --
the capacity with its band and its sample size, the ledger's span, the liquid
balance -- because a verdict quoted without its provenance invites the reader
to treat a median of three months as a certainty.
"""

from datetime import date

from pydantic import BaseModel, Field

from app.engines.feasibility import NATURES
from app.engines.ownership import DEFAULT_OWNERSHIP_YEARS, MAX_OWNERSHIP_YEARS
from app.engines.savings import DEFAULT_ANNUAL_RETURN_BPS
from app.schemas.cashflow import MeasuredRateOut
from app.schemas.history import HistoryOut


class CostItemIn(BaseModel):
    key: str = Field(min_length=1, max_length=40)
    label: str = Field(min_length=1, max_length=80)
    # Exactly one of the two. Both, or neither, raises in the engine and comes
    # back as a French 422 -- validated there rather than here so there is one
    # rule, in one place, in one language.
    monthly_cents: int | None = Field(default=None, ge=0)
    annual_bps_of_value: int | None = Field(default=None, ge=0, le=10_000)


class LoaIn(BaseModel):
    deposit_cents: int = Field(ge=0)
    monthly_cents: int = Field(ge=0)
    months: int = Field(ge=1, le=120)
    residual_cents: int = Field(ge=0)


class FeasibilityIn(BaseModel):
    """The question. Nothing here is measured -- it is what the user asks."""

    target_cents: int = Field(gt=0, le=100_000_000_00)
    horizon_months: int = Field(ge=1, le=600)
    down_payment_cents: int = Field(default=0, ge=0)
    nature: str = Field(default="vehicle")
    # Assumption overrides. Absent means the declared default, which the
    # response echoes back so the screen can print what was actually used.
    annual_return_bps: int | None = Field(default=None, ge=0, le=3_000)
    loan_rate_bps: int | None = Field(default=None, ge=0, le=3_000)
    loan_months: int | None = Field(default=None, ge=1, le=480)
    ownership_years: int | None = Field(default=None, ge=1, le=MAX_OWNERSHIP_YEARS)
    # Absent means "use the French defaults for `nature`". An EMPTY LIST means
    # "no running costs at all", which is a different statement and is honoured.
    ownership_items: list[CostItemIn] | None = None
    loa: LoaIn | None = None


class AssumptionsOut(BaseModel):
    """Every hypothesis actually used, echoed back. Design §10: "Les hypothèses
    sont toujours affichées à côté du résultat.\""""

    annual_return_bps: int
    loan_rate_bps: int
    loan_months: int
    ownership_years: int
    # MEASURED, unlike the four above. null when it could not be measured over
    # three complete months -- in which case there is no debt ratio either.
    monthly_income_cents: int | None
    existing_debt_payments_cents: int


class CostLineOut(BaseModel):
    key: str
    label: str
    total_cents: int
    monthly_average_cents: int


class OwnershipOut(BaseModel):
    price_cents: int
    years: int
    lines: list[CostLineOut]
    depreciation_cents: int
    residual_value_cents: int
    # Running costs only. Depreciation is NOT included here: it is value
    # leaving the asset, not money leaving the account, and adding the two
    # without saying so compares different things. `total_cost_cents` is the
    # sum a buyer should weigh.
    running_cost_cents: int
    total_cost_cents: int
    monthly_average_cents: int


class EmergencyImpactOut(BaseModel):
    runway_months_before: float | None
    runway_months_after: float | None
    # Both months are null exactly when this is set, and it names WHICH of two
    # causes applies: no measurable expense rate, or a rate that is not a
    # positive burn.
    unavailable_reason: str | None


class ImpactOut(BaseModel):
    emergency: EmergencyImpactOut
    liquid_in_five_years_before_cents: int | None
    liquid_in_five_years_after_cents: int | None
    liquid_unavailable_reason: str | None
    # There is deliberately NO net-worth field and NO health-score field.
    # Design §6.3 item 7 names both; neither exists in this codebase yet (net
    # worth is phase 3, the evolving health score is phase 2C). The screen says
    # so in French. Do not add a field here with a zero in it.


class LeverOut(BaseModel):
    kind: str
    feasible: bool
    # French. Set exactly when `feasible` is false.
    unavailable_reason: str | None
    # An extra remark on a FEASIBLE lever. Never a substitute for the above.
    note: str | None
    extra_monthly_cents: int | None
    # null when the measured capacity is not positive: a ratio against a
    # negative denominator is not an effort.
    effort_ratio: float | None
    reached_in_months: int | None
    delay_months: int | None
    reduced_target_cents: int | None
    borrow_cents: int | None
    loan_payment_cents: int | None
    loan_total_interest_cents: int | None
    # null when no income could be measured. Read this BEFORE
    # `debt_ratio_exceeded`, which is false both under the threshold and when
    # there is no ratio at all.
    debt_ratio_bps: int | None
    debt_ratio_exceeded: bool
    category_id: int | None
    category_name: str | None
    category_median_cents: int | None
    cut_monthly_cents: int | None
    months_at_or_below: int | None
    months_observed: int | None


class FinancingOptionOut(BaseModel):
    kind: str
    available: bool
    unavailable_reason: str | None
    out_of_pocket_cents: int | None
    monthly_cents: int | None
    total_paid_cents: int | None
    interest_cents: int | None
    # Always null on the LOA option, with `wealth_unavailable_reason` saying
    # why. Never render a null here as zero.
    wealth_at_end_cents: int | None
    wealth_unavailable_reason: str | None


class FinancingOut(BaseModel):
    horizon_months: int
    options: list[FinancingOptionOut]
    break_even_rate_bps: int | None
    break_even_reason: str | None
    # Compares ONLY cash and credit -- the LOA line is not in the running.
    better_kind: str


class FeasibilityContextOut(BaseModel):
    """Everything measured, so the form prefills from data rather than guesses."""

    capacity: MeasuredRateOut | None
    expense_rate: MeasuredRateOut | None
    income_rate: MeasuredRateOut | None
    months_observed: int
    history: HistoryOut | None
    balance_cents: int
    existing_debt_payments_cents: int
    assumptions: AssumptionsOut
    natures: list[str] = Field(default_factory=lambda: list(NATURES))
    default_ownership_years: int = DEFAULT_OWNERSHIP_YEARS
    default_annual_return_bps: int = DEFAULT_ANNUAL_RETURN_BPS


class FeasibilityOut(BaseModel):
    target_cents: int
    horizon_months: int
    down_payment_cents: int
    nature: str
    horizon_end_on: date
    assumptions: AssumptionsOut

    # The measured capacity behind the verdict, with its band and sample size.
    # null when fewer than three complete months could be observed. **Signed**:
    # a negative median is a household spending more than it earns, and it
    # produces a verdict rather than a refusal.
    capacity: MeasuredRateOut | None
    # French. Set exactly when `capacity` is null, and it is the ONLY reason
    # this endpoint refuses to give a verdict.
    capacity_unavailable_reason: str | None
    months_observed: int
    history: HistoryOut | None
    balance_cents: int

    # All null exactly when `capacity_unavailable_reason` is set.
    verdict: str | None
    saved_at_horizon_cents: int | None
    saved_at_horizon_low_cents: int | None
    saved_at_horizon_high_cents: int | None
    # POSITIVE means short, NEGATIVE means a surplus. Branch on the sign; never
    # print "il vous manque -866,55 €".
    gap_cents: int | None

    opportunity_cost_cents: int
    opportunity_horizon_months: int
    ownership: OwnershipOut
    impact: ImpactOut
    # EMPTY when `capacity` is null. Otherwise exactly five, feasible first.
    levers: list[LeverOut]
    financing: FinancingOut
```

- [ ] **Step 4: Write the router**

Create `backend/app/api/feasibility.py`:

```python
"""POST /api/feasibility and GET /api/feasibility/context.

**Why POST for a computation that writes nothing.** The request carries a
purchase, four assumption overrides, an arbitrary list of running-cost items
and an optional LOA quote. As a query string that is twenty-odd parameters,
unreadable in a browser bar and past the length a proxy will reliably pass.
The route is idempotent and side-effect free; only the shape of the input
argues for POST.

The clock is read here and handed to `assess_feasibility` as a parameter. It is
the REAL `date.today()`: nothing in the feasibility engine classifies anything
by staleness, and the horizon must count forward from now -- a purchase planned
"in twelve months" means twelve months from today, not from whenever the last
statement was imported. That is the same reasoning `/api/cashflow/runway` sets
out for itself; it is NOT the ledger-anchored clock `/api/cashflow/forecast`
uses, and the two are separate decisions.

Every measured input is fetched through the helpers that already enforce the
user filter (`api/common.py`) and the ledger-bounds precondition
(`api/goals.observed_months`). `capacity.complete_months` cannot tell a genuine
ledger extent from a requested window, and bounds wider than the data really
covers silently admit a partial month as complete.
"""

from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.common import liquid_balance_cents, tx_points
from app.api.goals import observed_months, rate_out
from app.api.history import user_history
from app.db import get_db
from app.engines.capacity import (
    MonthObservation,
    measure_expense_rate,
    measure_income_rate,
    measure_savings_capacity,
)
from app.engines.feasibility import Assumptions, PurchaseRequest, assess_feasibility
from app.engines.levers import CategoryHistory, LoaTerms, build_levers, compare_financing
from app.engines.ownership import (
    DEFAULT_OWNERSHIP_YEARS,
    CostItem,
    defaults_for,
    total_cost_of_ownership,
)
from app.engines.savings import DEFAULT_ANNUAL_RETURN_BPS
from app.models import Category, Debt, User
from app.schemas.feasibility import (
    AssumptionsOut,
    CostLineOut,
    EmergencyImpactOut,
    FeasibilityContextOut,
    FeasibilityIn,
    FeasibilityOut,
    FinancingOptionOut,
    FinancingOut,
    ImpactOut,
    LeverOut,
    OwnershipOut,
)
from app.security.deps import get_current_user

router = APIRouter(prefix="/feasibility", tags=["feasibility"])

# Declared defaults, not measurements. Echoed back on every response so the
# screen prints the hypothesis beside the figure it produced (design §10).
DEFAULT_LOAN_RATE_BPS = 500
DEFAULT_LOAN_MONTHS = 60


def _existing_debt_payments_cents(db: Session, user_id: int) -> int:
    return sum(
        row.minimum_payment_cents
        for row in db.query(Debt).filter(
            Debt.user_id == user_id, Debt.archived.is_(False)
        ).all()
    )


def _category_history(
    db: Session, user_id: int, months: list[MonthObservation]
) -> list[CategoryHistory]:
    """Each category's spend, per complete observed month, as positive magnitudes.

    Income rows are EXCLUDED rather than netted in -- the same rule
    `aggregate.aggregate_by_category` applies (`aggregate.py:157-158`), and the
    same one `engines/budget.py` refuses a positive `spent_cents` over. A
    category whose refunds exceed its spend in a month would otherwise
    contribute a negative "spend" to a median that is supposed to say what a
    normal month costs.

    Transfers are excluded: moving money to a savings account is not a
    reducible expense.

    Only months in `months` count, so the operator's eight unimported months
    cannot enter a median as zeroes.
    """
    if not months:
        return []
    keys = {month.key for month in months}
    names = {c.id: c.name for c in db.query(Category).filter(
        Category.user_id == user_id).all()}
    totals: dict[int, dict[str, int]] = {}
    for point in tx_points(db, user_id, months[0].start, months[-1].end):
        if point.is_transfer or point.amount_cents >= 0 or point.category_id is None:
            continue
        key = f"{point.on.year}-{point.on.month:02d}"
        if key not in keys:
            continue
        totals.setdefault(point.category_id, {}).setdefault(key, 0)
        totals[point.category_id][key] += -point.amount_cents
    return [
        CategoryHistory(category_id=category_id, name=names.get(category_id, "Sans nom"),
                        monthly_cents=[by_month[key] for key in sorted(by_month)])
        for category_id, by_month in totals.items()
    ]


def _assumptions(db: Session, user: User, payload: FeasibilityIn | None,
                 months: list[MonthObservation]) -> Assumptions:
    income = measure_income_rate(months)
    return Assumptions(
        annual_return_bps=(payload.annual_return_bps if payload
                           and payload.annual_return_bps is not None
                           else DEFAULT_ANNUAL_RETURN_BPS),
        loan_rate_bps=(payload.loan_rate_bps if payload and payload.loan_rate_bps
                       is not None else DEFAULT_LOAN_RATE_BPS),
        loan_months=(payload.loan_months if payload and payload.loan_months
                     is not None else DEFAULT_LOAN_MONTHS),
        ownership_years=(payload.ownership_years if payload and payload.ownership_years
                         is not None else DEFAULT_OWNERSHIP_YEARS),
        # Measured, and null-preserving: a household whose income could not be
        # measured has no debt ratio, and `debt_ratio_bps` refuses accordingly.
        monthly_income_cents=None if income is None else income.median_cents,
        existing_debt_payments_cents=_existing_debt_payments_cents(db, user.id),
    )


def _assumptions_out(assumptions: Assumptions) -> AssumptionsOut:
    return AssumptionsOut(
        annual_return_bps=assumptions.annual_return_bps,
        loan_rate_bps=assumptions.loan_rate_bps,
        loan_months=assumptions.loan_months,
        ownership_years=assumptions.ownership_years,
        monthly_income_cents=assumptions.monthly_income_cents,
        existing_debt_payments_cents=assumptions.existing_debt_payments_cents,
    )


@router.get("/context", response_model=FeasibilityContextOut)
def context(user: User = Depends(get_current_user),
            db: Session = Depends(get_db)) -> FeasibilityContextOut:
    """Everything measured, before the user has typed anything."""
    months = observed_months(db, user.id)
    return FeasibilityContextOut(
        capacity=rate_out(measure_savings_capacity(months)),
        expense_rate=rate_out(measure_expense_rate(months)),
        income_rate=rate_out(measure_income_rate(months)),
        months_observed=len(months),
        history=user_history(db, user.id),
        balance_cents=liquid_balance_cents(db, user.id),
        existing_debt_payments_cents=_existing_debt_payments_cents(db, user.id),
        assumptions=_assumptions_out(_assumptions(db, user, None, months)),
    )


@router.post("", response_model=FeasibilityOut)
def assess(payload: FeasibilityIn, user: User = Depends(get_current_user),
           db: Session = Depends(get_db)) -> FeasibilityOut:
    """Design §6.3, end to end. See the module docstring for the POST and the clock."""
    months = observed_months(db, user.id)
    assumptions = _assumptions(db, user, payload, months)
    request = PurchaseRequest(
        target_cents=payload.target_cents, horizon_months=payload.horizon_months,
        down_payment_cents=payload.down_payment_cents, nature=payload.nature,
    )

    default_items, depreciation = defaults_for(payload.nature)
    items = (
        [CostItem(key=i.key, label=i.label, monthly_cents=i.monthly_cents,
                  annual_bps_of_value=i.annual_bps_of_value)
         for i in payload.ownership_items]
        if payload.ownership_items is not None
        else list(default_items)
    )

    # Fetched once and reused: three calls would be three identical aggregate
    # queries, and a figure the response reports must be the same one the
    # engine was handed.
    balance = liquid_balance_cents(db, user.id)

    try:
        report = assess_feasibility(
            request,
            measure_savings_capacity(months),
            measure_expense_rate(months),
            balance,
            assumptions,
            date.today(),
        )
        ownership = total_cost_of_ownership(
            payload.target_cents, assumptions.ownership_years, items, depreciation
        )
        levers = build_levers(report, _category_history(db, user.id, months))
        financing = compare_financing(
            payload.target_cents, payload.down_payment_cents, assumptions,
            None if payload.loa is None else LoaTerms(
                deposit_cents=payload.loa.deposit_cents,
                monthly_cents=payload.loa.monthly_cents,
                months=payload.loa.months,
                residual_cents=payload.loa.residual_cents),
        )
    except ValueError as exc:
        # The engines raise in French already -- the same catch-and-forward
        # idiom `api/analysis.py` uses for `compute_inflation`'s own guard.
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    return FeasibilityOut(
        target_cents=request.target_cents, horizon_months=request.horizon_months,
        down_payment_cents=request.down_payment_cents, nature=request.nature,
        horizon_end_on=report.horizon_end_on,
        assumptions=_assumptions_out(assumptions),
        capacity=rate_out(report.capacity),
        capacity_unavailable_reason=report.capacity_unavailable_reason,
        months_observed=len(months), history=user_history(db, user.id),
        balance_cents=balance,
        verdict=report.verdict,
        saved_at_horizon_cents=report.saved_at_horizon_cents,
        saved_at_horizon_low_cents=report.saved_at_horizon_low_cents,
        saved_at_horizon_high_cents=report.saved_at_horizon_high_cents,
        gap_cents=report.gap_cents,
        opportunity_cost_cents=report.opportunity_cost_cents,
        opportunity_horizon_months=report.opportunity_horizon_months,
        ownership=OwnershipOut(
            price_cents=ownership.price_cents, years=ownership.years,
            lines=[CostLineOut(key=line.key, label=line.label,
                               total_cents=line.total_cents,
                               monthly_average_cents=line.monthly_average_cents)
                   for line in ownership.lines],
            depreciation_cents=ownership.depreciation_cents,
            residual_value_cents=ownership.residual_value_cents,
            running_cost_cents=ownership.running_cost_cents,
            total_cost_cents=ownership.total_cost_cents,
            monthly_average_cents=ownership.monthly_average_cents),
        impact=ImpactOut(
            emergency=EmergencyImpactOut(
                runway_months_before=report.impact.emergency.runway_months_before,
                runway_months_after=report.impact.emergency.runway_months_after,
                unavailable_reason=report.impact.emergency.unavailable_reason),
            liquid_in_five_years_before_cents=report.impact
            .liquid_in_five_years_before_cents,
            liquid_in_five_years_after_cents=report.impact
            .liquid_in_five_years_after_cents,
            liquid_unavailable_reason=report.impact.liquid_unavailable_reason),
        levers=[LeverOut(**lever.__dict__) for lever in levers],
        financing=FinancingOut(
            horizon_months=financing.horizon_months,
            options=[FinancingOptionOut(**option.__dict__)
                     for option in financing.options],
            break_even_rate_bps=financing.break_even_rate_bps,
            break_even_reason=financing.break_even_reason,
            better_kind=financing.better_kind),
    )
```

**One thing to watch as you write it.** `LeverOut(**lever.__dict__)` and
`FinancingOptionOut(**option.__dict__)` work only while the dataclass fields and
the schema fields are identical in name. They are today, and both sides are in
this plan. Add a test that builds a `LeverOut` from every lever kind returned by
a real call and fails loudly if a field exists on one side only — a `TypeError`
raised at runtime on one lever kind, months from now, is far worse than a red
test today:

```python
def test_every_lever_field_survives_the_wire(client, imported):
    headers, _account = imported
    body = client.post("/api/feasibility", headers=headers, json=REQUEST).json()
    if not body["levers"]:
        return
    expected = set(LeverOut.model_fields)
    for lever in body["levers"]:
        assert set(lever) == expected
```

And, as the Global Constraints require: **verify this task's brief against the
shipped code before writing.** Twelve consecutive phase-2A tasks were handed a
defective brief. If anything here disagrees with what is on disk, say so in the
task report rather than working around it silently.

- [ ] **Step 5: Register, name the fields, run**

`main.py`: import and include the router. `errors.py` `FIELD_SUBJECTS`: `"target_cents": "Le prix du bien"`, `"horizon_months": "L'échéance"`, `"down_payment_cents": "L'apport"`, `"nature": "La nature du bien"`, `"loan_rate_bps": "Le taux du crédit"`, `"loan_months": "La durée du crédit"`, `"ownership_years": "La durée de possession"`, `"monthly_cents": "Le montant mensuel"`, `"residual_cents": "La valeur de rachat"`, `"deposit_cents": "L'apport initial"`.

Run from `backend/`: `.venv/Scripts/pytest.exe tests/test_feasibility_api.py -v` → PASS, 10 tests. Full suite → **652** passed.

- [ ] **Step 6: Verify against the operator's real data before committing**

Seed the fixture, start the backend detached, check port 8000 first, then:

```powershell
$t = (Invoke-RestMethod -Uri http://localhost:8000/api/auth/login -Method Post -Body (@{email="demo@yieldo-demo.fr";password="MotDePasseDemo123!"}|ConvertTo-Json) -ContentType "application/json").access_token
$h = @{ Authorization = "Bearer $t" }
Invoke-RestMethod -Uri http://localhost:8000/api/feasibility -Method Post -Headers $h -ContentType "application/json" -Body (@{target_cents=4000000;horizon_months=12;down_payment_cents=0;nature="vehicle"}|ConvertTo-Json) | ConvertTo-Json -Depth 6
```

**Expected, and every figure is hand-verified in this plan's "operator's measured numbers" table:** `verdict` = `out_of_reach`; `capacity.median_cents` = `-74619` over 3 months; `saved_at_horizon_cents` = `-895428`; `saved_at_horizon_high_cents` = `2414442`; `gap_cents` = `4895428`; the `borrow` lever at `92383` a month with `debt_ratio_bps` `19610`; `delay` and `reduce_target` both infeasible with their own distinct reasons. **If any of these differs, stop and find out which of the two is wrong before continuing.** Paste the response into the task report.

- [ ] **Step 7: Commit**

```bash
git add backend/app/api/feasibility.py backend/app/schemas/feasibility.py backend/app/main.py backend/app/api/errors.py backend/tests/test_feasibility_api.py
git commit -m "feat(api): assemble the purchase-feasibility answer from measured inputs"
```

---

### Task 14: Saved scenarios — stored as questions, recomputed on read

§6.3: "Chaque scénario est enregistrable et comparable aux autres."

**Files:**
- Modify: `backend/app/api/feasibility.py`, `backend/app/schemas/feasibility.py`
- Test: `backend/tests/test_scenarios_api.py`

**Interfaces:**
- Consumes: `models.Scenario` (Task 3), the `assess` computation from Task 13.
- Produces:
  - `POST /api/feasibility/scenarios` → `ScenarioOut`, 201
  - `GET /api/feasibility/scenarios` → `list[ScenarioOut]` — each with its **recomputed** result
  - `DELETE /api/feasibility/scenarios/{scenario_id}` → 204, **hard delete**
  - Schemas `ScenarioIn`, `ScenarioOut`.
  - Consumed by Task 16 (the comparison bar).

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_scenarios_api.py`:

```python
def _register(client, email="scenarios@example.fr"):
    body = client.post("/api/auth/register", json={
        "name": "Max", "email": email, "password": "motdepasse123"}).json()
    return {"Authorization": f"Bearer {body['access_token']}"}


REQUEST = {"target_cents": 4_000_000, "horizon_months": 12,
           "down_payment_cents": 0, "nature": "vehicle"}


def test_a_scenario_round_trips_with_its_result_recomputed(client):
    headers = _register(client)
    created = client.post("/api/feasibility/scenarios", headers=headers,
                          json={"name": "Voiture 2027", "request": REQUEST})
    assert created.status_code == 201
    listed = client.get("/api/feasibility/scenarios", headers=headers).json()
    assert [item["name"] for item in listed] == ["Voiture 2027"]
    assert listed[0]["request"]["target_cents"] == 4_000_000
    # The RESULT is present and was computed now, not stored.
    assert "verdict" in listed[0]["result"]


def test_a_saved_scenario_follows_the_ledger_rather_than_freezing_it(client, imported):
    """The whole reason the payload holds the question and not the answer. A
    verdict measured on last winter's statements, replayed months later as
    though it were current, is exactly the staleness `api/cashflow.py` documents
    for its clock -- and worse here, because the capacity input is measured."""
    headers, account_id = imported
    client.post("/api/feasibility/scenarios", headers=headers,
                json={"name": "Voiture", "request": REQUEST})
    before = client.get("/api/feasibility/scenarios", headers=headers).json()[0]["result"]

    # Delete every transaction the fixture imported, so the measurement changes.
    for tx in client.get("/api/transactions", headers=headers,
                         params={"limit": 500}).json()["items"]:
        client.delete(f"/api/transactions/{tx['id']}", headers=headers)

    after = client.get("/api/feasibility/scenarios", headers=headers).json()[0]["result"]
    assert after["months_observed"] == 0
    assert after["capacity"] is None
    assert after["verdict"] is None
    assert before["months_observed"] != after["months_observed"]


def test_a_stored_payload_is_validated_on_the_way_back_out(client, db):
    """The database is not an input this code controls. A row whose payload no
    longer parses must surface as a French 422 naming the scenario, not as an
    untranslated 500 that takes the whole list down with it.

    The corruption is applied through the session directly, because that is the
    only way to reach the state -- writing it through the API is impossible by
    construction, which is exactly why the read path needs its own guard."""
    from app.models import Scenario

    headers = _register(client)
    client.post("/api/feasibility/scenarios", headers=headers,
                json={"name": "Cassé", "request": REQUEST})
    row = db.query(Scenario).one()
    row.payload = '{"target_cents": "quarante mille euros"}'
    db.commit()

    response = client.get("/api/feasibility/scenarios", headers=headers)
    assert response.status_code == 422
    assert "Cassé" in response.json()["detail"]


def test_deleting_a_scenario_removes_it(client):
    headers = _register(client)
    created = client.post("/api/feasibility/scenarios", headers=headers,
                          json={"name": "Voiture", "request": REQUEST}).json()
    assert client.delete(f"/api/feasibility/scenarios/{created['id']}",
                         headers=headers).status_code == 204
    assert client.get("/api/feasibility/scenarios", headers=headers).json() == []


def test_the_number_of_saved_scenarios_is_bounded(client):
    """Each read recomputes a full feasibility answer, which walks the ledger.
    An unbounded list turns one page load into arbitrarily many computations."""
    headers = _register(client)
    for index in range(20):
        response = client.post("/api/feasibility/scenarios", headers=headers,
                               json={"name": f"S{index}", "request": REQUEST})
    assert response.status_code == 422
    assert "scénarios" in response.json()["detail"]


def test_scenarios_never_cross_users(client):
    alice = _register(client, "alice4@example.fr")
    bob = _register(client, "bob4@example.fr")
    client.post("/api/feasibility/scenarios", headers=alice,
                json={"name": "Alice", "request": REQUEST})
    bob_scenario = client.post("/api/feasibility/scenarios", headers=bob,
                               json={"name": "Bob", "request": REQUEST}).json()
    assert [s["name"] for s in client.get("/api/feasibility/scenarios",
                                          headers=alice).json()] == ["Alice"]
    assert client.delete(f"/api/feasibility/scenarios/{bob_scenario['id']}",
                         headers=alice).status_code == 404
    assert len(client.get("/api/feasibility/scenarios", headers=bob).json()) == 1
```

- [ ] **Step 2: Run it and watch it fail** — 404 on all three routes.

- [ ] **Step 3: Add the schemas**

Append to `backend/app/schemas/feasibility.py`:

```python
class ScenarioIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    # The QUESTION, not the answer. See `models.Scenario`'s docstring.
    request: FeasibilityIn


class ScenarioOut(BaseModel):
    id: int
    name: str
    created_at: datetime
    # Exactly what was saved, echoed back so the screen can reopen it in the
    # form.
    request: FeasibilityIn
    # Recomputed against the CURRENT ledger on every read. Two scenarios listed
    # side by side are therefore always answered from the same statements,
    # which is what makes them comparable at all.
    result: FeasibilityOut
```

Add `from datetime import datetime` to the imports.

- [ ] **Step 4: Add the routes**

In `backend/app/api/feasibility.py`, first extract the body of `assess` into a private `_assess(payload, user, db) -> FeasibilityOut` and have both the route and the scenario listing call it — one computation, one place. Then add:

```python
import json

# Each read recomputes a full feasibility answer, which walks the whole ledger.
# Ten is generous for a household comparing purchases and keeps one page load
# to ten computations rather than an unbounded number.
MAX_SCENARIOS = 10


def _owned_scenario(db: Session, user: User, scenario_id: int) -> Scenario:
    scenario = db.query(Scenario).filter(
        Scenario.id == scenario_id, Scenario.user_id == user.id).first()
    if scenario is None:
        raise HTTPException(status_code=404, detail="Scénario introuvable")
    return scenario


@router.post("/scenarios", response_model=ScenarioOut,
             status_code=status.HTTP_201_CREATED)
def save_scenario(payload: ScenarioIn, user: User = Depends(get_current_user),
                  db: Session = Depends(get_db)) -> ScenarioOut:
    """Store the QUESTION. The answer is recomputed on every read -- see
    `models.Scenario`'s docstring for why."""
    existing = db.query(Scenario).filter(Scenario.user_id == user.id).count()
    if existing >= MAX_SCENARIOS:
        raise HTTPException(
            status_code=422,
            detail=f"Vous ne pouvez pas enregistrer plus de {MAX_SCENARIOS} "
                   "scénarios. Supprimez-en un pour en ajouter un autre.")
    scenario = Scenario(user_id=user.id, name=payload.name, kind="feasibility",
                        payload=payload.request.model_dump_json())
    db.add(scenario)
    db.commit()
    db.refresh(scenario)
    return ScenarioOut(id=scenario.id, name=scenario.name,
                       created_at=scenario.created_at, request=payload.request,
                       result=_assess(payload.request, user, db))


@router.get("/scenarios", response_model=list[ScenarioOut])
def list_scenarios(user: User = Depends(get_current_user),
                   db: Session = Depends(get_db)) -> list[ScenarioOut]:
    """Every saved scenario, each recomputed against the CURRENT ledger.

    The stored payload is re-validated through `FeasibilityIn` rather than
    trusted: the database is not an input this code controls, and a row that no
    longer parses must surface as a French error rather than a 500 that takes
    the whole list down.
    """
    out: list[ScenarioOut] = []
    for row in db.query(Scenario).filter(
            Scenario.user_id == user.id).order_by(Scenario.id).all():
        try:
            request = FeasibilityIn.model_validate(json.loads(row.payload))
        except (ValueError, TypeError) as exc:
            raise HTTPException(
                status_code=422,
                detail=f"Le scénario « {row.name} » n'est plus lisible et doit "
                       "être supprimé puis recréé.") from exc
        out.append(ScenarioOut(id=row.id, name=row.name, created_at=row.created_at,
                               request=request, result=_assess(request, user, db)))
    return out


@router.delete("/scenarios/{scenario_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_scenario(scenario_id: int, user: User = Depends(get_current_user),
                    db: Session = Depends(get_db)) -> None:
    """A hard delete, unlike debts and goals: a scenario holds no history worth
    keeping -- it is a question, and the same question can be asked again."""
    db.delete(_owned_scenario(db, user, scenario_id))
    db.commit()
```

Register `/scenarios` **before** the `POST ""` route only if FastAPI's matching requires it — it does not here, since the paths differ, but keep `/context` and `/scenarios` above any future `"/{something}"` route for the reason Task 5 records.

- [ ] **Step 5: Run, then commit**

Run from `backend/`: `.venv/Scripts/pytest.exe tests/test_scenarios_api.py -v` → PASS, 6 tests. Full suite → **658** passed.

Mutation check: store the computed `FeasibilityOut` in `payload` instead of the request and read it straight back. Expected: `test_a_saved_scenario_follows_the_ledger_rather_than_freezing_it` goes red. That test is the entire justification for the design and must be the one that catches it.

```bash
git add backend/app/api/feasibility.py backend/app/schemas/feasibility.py backend/tests/test_scenarios_api.py
git commit -m "feat(api): save feasibility scenarios as questions and recompute them on read"
```

---
### Task 15: `/faisabilite` — the question, the measured capacity, the verdict

The screen the operator asked for. This task ships the form, the capacity panel and the verdict; Task 16 adds the cost of ownership, the levers, the financing comparison, the impact and the saved scenarios.

**Files:**
- Create: `frontend/src/features/feasibility/FeasibilityPage.tsx`, `FeasibilityPage.css`, `PurchaseForm.tsx`, `VerdictPanel.tsx`, and the matching `.test.tsx` for each
- Modify: `frontend/src/lib/types.ts`, `frontend/src/app/routes.tsx`, `frontend/src/app/AppShell.tsx`

**Interfaces:**
- Consumes: `GET /api/feasibility/context`, `POST /api/feasibility` (Task 13).
- Produces: route `/faisabilite`, nav entry "Faisabilité". Types `FeasibilityRequest`, `FeasibilityContext`, `Feasibility`, `Assumptions`, `Ownership`, `Impact`, `Lever`, `Financing`, `Scenario` — the whole family, declared here and consumed by Task 16.

- [ ] **Step 1: Add the mirror types**

Append the full family to `frontend/src/lib/types.ts`, one interface per schema in `backend/app/schemas/feasibility.py`, copying each field docstring across as a TSDoc comment. The four that carry a contract and must not be paraphrased:

```typescript
export interface Feasibility {
  target_cents: number;
  horizon_months: number;
  down_payment_cents: number;
  nature: string;
  horizon_end_on: string;
  assumptions: Assumptions;

  /** The measured savings capacity behind the verdict, with its band and its
   *  sample size. null below three complete observed months. **Signed** — a
   *  negative `median_cents` is a household spending more than it earns, and it
   *  produces a VERDICT, not a refusal. Never take its absolute value. */
  capacity: MeasuredRate | null;
  /** French. Set exactly when `capacity` is null, and it is the only reason
   *  this endpoint declines to give a verdict. Print verbatim. */
  capacity_unavailable_reason: string | null;
  months_observed: number;
  history: History | null;
  balance_cents: number;

  /** All five null exactly when `capacity_unavailable_reason` is set. */
  verdict: "comfortable" | "tight" | "out_of_reach" | null;
  saved_at_horizon_cents: number | null;
  saved_at_horizon_low_cents: number | null;
  saved_at_horizon_high_cents: number | null;
  /** POSITIVE means short, NEGATIVE means a surplus. Branch on the sign —
   *  "il vous manque −866,55 €" is not a sentence. */
  gap_cents: number | null;

  opportunity_cost_cents: number;
  opportunity_horizon_months: number;
  ownership: Ownership;
  impact: Impact;
  /** EMPTY when `capacity` is null. Otherwise exactly five, feasible first. */
  levers: Lever[];
  financing: Financing;
}
```

Write `Assumptions`, `Ownership`, `CostLine`, `Impact`, `EmergencyImpact`, `Lever`, `Financing`, `FinancingOption`, `FeasibilityContext`, `FeasibilityRequest`, `Scenario` alongside it, each mirroring its Pydantic model exactly.

- [ ] **Step 2: Write the failing `VerdictPanel` test**

Create `frontend/src/features/feasibility/VerdictPanel.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { VerdictPanel } from "./VerdictPanel";
import type { Feasibility } from "../../lib/types";

const BASE = {
  target_cents: 4_000_000, horizon_months: 12, down_payment_cents: 0,
  nature: "vehicle", horizon_end_on: "2027-08-31",
} as const;

/** THE OPERATOR. Every figure measured from his real ledger by phase 2A's
 *  engines, then this phase's arithmetic on top. */
const OPERATOR = {
  ...BASE,
  capacity: { months: 3, median_cents: -74_619, spread_cents: 213_078,
              low_cents: -347_690, high_cents: 198_452 },
  capacity_unavailable_reason: null,
  months_observed: 3,
  history: { date_from: "2025-01-24", date_to: "2026-01-09", transaction_count: 197 },
  balance_cents: -220_963,
  verdict: "out_of_reach" as const,
  saved_at_horizon_cents: -895_428,
  saved_at_horizon_low_cents: -4_172_280,
  saved_at_horizon_high_cents: 2_414_442,
  gap_cents: 4_895_428,
} as unknown as Feasibility;

describe("VerdictPanel", () => {
  it("says the pot shrinks, and never presents a deficit as savings", () => {
    render(<VerdictPanel report={OPERATOR} />);
    expect(screen.getByText(/Hors de portée/i)).toBeInTheDocument();
    // The projection is NEGATIVE and printed as such.
    expect(screen.getByText(/−8 954,28/)).toBeInTheDocument();
    // The gap is larger than the price, and the copy says why rather than
    // leaving the reader to think it is an arithmetic error.
    expect(screen.getByText(/48 954,28/)).toBeInTheDocument();
    expect(screen.getByText(/diminue/i)).toBeInTheDocument();
    // NOT the "il vous manque" framing alone: the cause is the deficit.
    expect(screen.getByText(/−746,19/)).toBeInTheDocument();
  });

  it("does not offer the optimistic end of the band as a way through", () => {
    // 24 144,42 € at the band's high end is still short of 40 000 €. If it
    // were reachable the copy would say so; here it must not.
    render(<VerdictPanel report={OPERATOR} />);
    expect(screen.queryByText(/dans un bon mois/i)).not.toBeInTheDocument();
  });

  it("prints the refusal and no verdict when the capacity is unmeasurable", () => {
    render(<VerdictPanel report={{
      ...OPERATOR, capacity: null, verdict: null, gap_cents: null,
      saved_at_horizon_cents: null, saved_at_horizon_low_cents: null,
      saved_at_horizon_high_cents: null, months_observed: 1,
      capacity_unavailable_reason:
        "Votre capacité d'épargne n'a pas pu être mesurée : il faut au moins trois mois complets de relevés pour en tirer une médiane. Sans elle, aucun verdict ne peut être rendu sur cet achat — un chiffre tiré de deux mois serait une invention, pas une mesure.",
    } as unknown as Feasibility} />);
    expect(screen.getByText(/trois mois complets/)).toBeInTheDocument();
    expect(screen.queryByText(/Hors de portée/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Atteignable/i)).not.toBeInTheDocument();
    // A refusal is a deliberate answer, not a load failure.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("calls a surplus a surplus rather than a negative shortfall", () => {
    render(<VerdictPanel report={{
      ...OPERATOR,
      capacity: { months: 12, median_cents: 400_000, spread_cents: 78_000,
                  low_cents: 300_000, high_cents: 500_000 },
      verdict: "tight" as const, saved_at_horizon_cents: 4_866_555,
      saved_at_horizon_low_cents: 3_649_916, saved_at_horizon_high_cents: 6_100_000,
      gap_cents: -866_555,
    } as unknown as Feasibility} />);
    expect(screen.getByText(/en serrant/i)).toBeInTheDocument();
    expect(screen.getByText(/8 665,55/)).toBeInTheDocument();
    expect(screen.queryByText(/il vous manque/i)).not.toBeInTheDocument();
  });

  it("states the sample the whole verdict rests on", () => {
    render(<VerdictPanel report={OPERATOR} />);
    expect(screen.getByText(/3 mois/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Write `VerdictPanel.tsx`**

```tsx
import { frenchDate } from "../../design/EmptyState";
import { formatCents } from "../../design/theme";
import { plural } from "../../lib/plural";
import type { Feasibility } from "../../lib/types";

/**
 * `capacity.MIN_MONTHS_FOR_RATE`, named here only so one French sentence can
 * state the floor. Nothing is computed from it: the refusal itself travels on
 * the wire as `capacity_unavailable_reason`. Same arrangement as
 * `CashflowPage`'s own copy of this constant.
 */
const MIN_MONTHS_FOR_RATE = 3;

const VERDICT_LABEL = {
  comfortable: "Atteignable confortablement",
  tight: "Atteignable en serrant",
  out_of_reach: "Hors de portée",
} as const;

/**
 * Why the verdict is what it is, in one sentence, on the branch that earned it.
 *
 * Four registers, mutually exclusive by construction. The distinction that
 * matters most is the last one: a household whose measured capacity is a
 * DEFICIT is not merely short of the target, its savings are going backwards,
 * and a sentence that only says "il vous manque X" sends the reader looking for
 * a bigger down payment when the actual remedy is somewhere else entirely.
 * This is the operator's own state (−746,19 € a month), so it is the branch
 * most likely to be read.
 */
function verdictExplanation(report: Feasibility): string {
  const capacity = report.capacity;
  if (capacity === null) return "";
  const horizon = `${report.horizon_months} ${plural(report.horizon_months, "mois", "mois")}`;

  if (capacity.median_cents <= 0) {
    return `Au rythme mesuré dans vos relevés, votre épargne diminue de ${formatCents(
      Math.abs(capacity.median_cents),
    )} par mois. En ${horizon} elle n'augmente donc pas : elle descend à ${formatCents(
      report.saved_at_horizon_cents ?? 0,
      { signed: true },
    )}. L'écart avec le prix est plus grand que le prix lui-même, et c'est cela qu'il dit.`;
  }
  if (report.verdict === "comfortable") {
    return `Même en enchaînant des mois faibles — ${formatCents(
      capacity.low_cents,
    )} par mois, le bas de la variabilité mesurée — vous atteignez ${formatCents(
      report.saved_at_horizon_low_cents ?? 0,
    )} en ${horizon}.`;
  }
  if (report.verdict === "tight") {
    return `Vous y arrivez au rythme médian mesuré, mais pas en enchaînant des mois faibles : au bas de votre variabilité vous n'atteignez que ${formatCents(
      report.saved_at_horizon_low_cents ?? 0,
    )}.`;
  }
  return `Au rythme médian mesuré vous atteignez ${formatCents(
    report.saved_at_horizon_cents ?? 0,
  )} en ${horizon}, et même au haut de votre variabilité ${formatCents(
    report.saved_at_horizon_high_cents ?? 0,
  )} — l'un et l'autre en dessous du prix.`;
}

/**
 * The gap, in the mood its sign has earned.
 *
 * `gap_cents` is target minus what is projected: positive means short,
 * negative means a surplus. Printing the negative case through the "il vous
 * manque" template gives "il vous manque −866,55 €", which is the same class
 * of defect as phase 2A's refusal blaming a month count for a degenerate
 * scale — a true number under a false sentence.
 */
function gapSentence(gapCents: number): string {
  return gapCents > 0
    ? `Il manque ${formatCents(gapCents)} à l'échéance.`
    : `Il reste ${formatCents(Math.abs(gapCents))} de marge à l'échéance.`;
}

interface VerdictPanelProps {
  report: Feasibility;
}

export function VerdictPanel({ report }: VerdictPanelProps) {
  // Branch on the refusal FIRST, then on the sign. Two states with two
  // different remedies: import more statements, or change what a month costs.
  // Deriving one boolean from both is how this project has repeatedly ended up
  // telling a user the wrong one.
  if (report.capacity === null) {
    return (
      <div className="yd-verdict yd-verdict--unmeasured">
        <h2 className="yd-panel__title">Verdict</h2>
        <p className="yd-verdict__refusal">{report.capacity_unavailable_reason}</p>
        <p className="yd-verdict__note">
          {`Vos relevés couvrent ${report.months_observed} ${plural(
            report.months_observed,
            "mois complet",
            "mois complets",
          )}. Il en faut au moins ${MIN_MONTHS_FOR_RATE} pour qu'une médiane veuille dire quelque chose.`}
        </p>
      </div>
    );
  }

  const capacity = report.capacity;
  const verdict = report.verdict ?? "out_of_reach";

  return (
    <div className={`yd-verdict yd-verdict--${verdict}`}>
      <h2 className="yd-panel__title">Verdict</h2>
      <p className="yd-verdict__label">{VERDICT_LABEL[verdict]}</p>
      <p className="yd-verdict__explanation">{verdictExplanation(report)}</p>
      <p className="yd-verdict__gap">{gapSentence(report.gap_cents ?? 0)}</p>

      <p className="yd-verdict__capacity">
        {`Capacité d'épargne mesurée : `}
        <span className="yd-num">{formatCents(capacity.median_cents, { signed: true })}</span>
        {` par mois, entre ${formatCents(capacity.low_cents, {
          signed: true,
        })} et ${formatCents(capacity.high_cents, { signed: true })} d'un mois à l'autre.`}
      </p>
      <p className="yd-verdict__sample">
        {`Mesurée sur ${capacity.months} mois de relevés, pas déclarée. À l'échéance du ${frenchDate(
          report.horizon_end_on,
        )}.`}
      </p>
    </div>
  );
}
```

**Colour rule.** `--yd-negative` on `out_of_reach`, `--yd-warning` on `tight`, `--yd-positive` on `comfortable` — and the *text* colour must be the AA-safe token (`--yd-negative-text` and its siblings, pinned in `design/contrast.test.ts` since phase 2A). One accent per screen: the verdict owns it. Add the three verdict text tokens to `TEXT_TOKENS` in `design/contrast.test.ts` if any is new, and prove the test bites by temporarily weakening the value.

- [ ] **Step 4: Write `PurchaseForm.tsx`**

Fields: price (euros, `parseCents`), horizon in months, down payment (euros, `parseCents`), nature (select over `context.natures`, French labels "Véhicule" / "Immobilier" / "Autre"), and a collapsible "Hypothèses" group holding the return rate, loan rate, loan term and ownership years — each prefilled from `context.assumptions` and each labelled as an assumption, per design §10.

Submit posts to `/feasibility`. While in flight the submit button is disabled **and** the panel carries a visible busy state, not only `aria-busy`.

- [ ] **Step 5: Write `FeasibilityPage.tsx` (first half)**

1. `<h1>Faisabilité d'achat</h1>` and a lead naming the question: « Puis-je m'offrir ce bien, et sinon que faut-il changer ? »
2. A **measured-context banner** built from `GET /api/feasibility/context`, shown before the user has asked anything: what the ledger covers, what was measured (capacity, expense rate, income rate — each with its band and sample, or its absence), the liquid balance, and the existing monthly instalments. This is where the operator learns his capacity is negative **before** he types a price, which is the honest ordering.
3. `PurchaseForm`.
4. `VerdictPanel`, once a result exists.
5. Errors: a network failure is a `role="alert"`; a **422 carrying an engine's French sentence is not** — render it the way `AnalysisPage.refusalReason` does, in the panel's explanatory style. Phase 2A shipped a deliberate refusal dressed as a load failure on exactly this branch; copy `AnalysisPage.tsx`'s `refusalReason` helper rather than reinventing it.

- [ ] **Step 6: Wire the route and nav, run the suite and the build**

`{ path: "faisabilite", element: <FeasibilityPage /> }`; `{ to: "/faisabilite", label: "Faisabilité" }` after Objectifs.
From `frontend/`: `npm test` green, `npm run build` at zero TypeScript errors. No lint step.

- [ ] **Step 7: BROWSER GATE**

Seed, check port 8000, start both servers detached, log in as the demo user, open `/faisabilite`.

- Ask the operator's own question: **40 000 €, 12 mois, apport 0, véhicule.**
- Confirm on screen: verdict **Hors de portée**; capacity **−746,19 €** per month with the band **[−3 476,90 €, +1 984,52 €]** and "3 mois de relevés"; the projection **−8 954,28 €**; the gap **48 954,28 €**; and the explanation naming the deficit rather than only the shortfall.
- Ask a second question — **8 000 €, 36 mois** — and confirm the verdict is still out of reach and the sentences change with the figures rather than being generic.
- Screenshots at **375, 768, 1440 px, both themes**. Check: the long verdict paragraph does not overflow at 375; `formatCents`'s U+2212 minus and U+202F thousands separator render correctly (the negative figures on this screen are the most minus-heavy in the app); the verdict colour clears AA against its own background in both themes, measured off a decoded screenshot pixel, not from a token value; console clean; no horizontal scroll.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/features/feasibility frontend/src/lib/types.ts frontend/src/app/routes.tsx frontend/src/app/AppShell.tsx
git commit -m "feat(feasibility): ask the purchase question and answer it from measured capacity"
```

---

### Task 16: `/faisabilite` — levers, financing, ownership, impact and saved scenarios

The rest of §6.3 on the same screen.

**Files:**
- Create: `frontend/src/features/feasibility/LeverList.tsx`, `FinancingPanel.tsx`, `OwnershipPanel.tsx`, `ImpactPanel.tsx`, `ScenarioBar.tsx`, and a `.test.tsx` for each
- Modify: `frontend/src/features/feasibility/FeasibilityPage.tsx`, `FeasibilityPage.css`

**Interfaces:**
- Consumes: `Feasibility.levers`, `.financing`, `.ownership`, `.impact` (Task 13); `/api/feasibility/scenarios` (Task 14).
- Produces: nothing later in this plan consumes it. Phase 2C's "défis dérivés des données" will read the same `Lever` shape for its category-cut proposals — do not change the wire shape without checking there.

- [ ] **Step 1: Write the failing `LeverList` test**

Create `frontend/src/features/feasibility/LeverList.test.tsx`. The cases that must exist, each written out in full:

```tsx
it("renders the five levers with feasible ones first", () => { /* ... */ });

it("says what an extra monthly saving really costs on a deficit", () => {
  // extra_monthly_cents 403 394, effort_ratio null, note naming the deficit.
  // The copy must NOT print an effort percentage — there is none, and a ratio
  // against a negative denominator would render as "−540 % d'effort".
});

it("prints each infeasible lever's own reason, never a shared one", () => {
  // delay: "attendre n'y change rien" ; reduce_target: "aucune cible n'est
  // atteignable". Two DIFFERENT sentences on one screen. Assert they differ.
  expect(delayText).not.toEqual(reduceText);
});

it("raises the 35 % alarm on the borrow lever and states the ratio", () => {
  // debt_ratio_bps 19 610 -> "196,10 %" and a warning treatment. Design §6.3
  // item 5 asks for the alert at 3 500 bps.
});

it("says the debt ratio is absent rather than showing 0 %", () => {
  // debt_ratio_bps null, debt_ratio_exceeded false. Reading the flag alone
  // cannot tell "comfortably under" from "unknown" — the component must branch
  // on the null FIRST, and the test must prove it does.
  expect(screen.queryByText(/0,00 %/)).not.toBeInTheDocument();
  expect(screen.getByText(/n'ont pas pu être mesurés/)).toBeInTheDocument();
});

it("backs the category cut with the history rather than asserting it", () => {
  // months_at_or_below 0 of 4 -> "vos relevés ne montrent aucun mois à ce
  // niveau" ; 3 of 4 -> "trois des quatre mois observés y étaient déjà".
});

it("renders nothing at all when the lever list is empty", () => {
  // capacity null -> levers []. The capacity refusal is shown once by
  // VerdictPanel; five copies of it here would be five copies of one sentence.
});
```

- [ ] **Step 2: Write `LeverList.tsx`**

One card per lever, keyed by `kind`, each with its own French heading and its own figure. The rules:

- **`save_more`** — the extra per month. Print `effort_ratio` as a percentage **only when it is not null**; when it is null, print `note` instead, which already explains that the figure includes closing a deficit.
- **`delay`** — `delay_months` and the month the target would actually be reached (`reached_in_months` from today).
- **`reduce_target`** — `reduced_target_cents`, framed as "ce que l'échéance permet".
- **`borrow`** — the amount, the instalment, the total interest, and the debt ratio. Branch on `debt_ratio_bps === null` **before** looking at `debt_ratio_exceeded`, because the flag is false in both the healthy case and the unknown case and cannot tell them apart. Above the threshold, use the warning treatment and name the 35 % rule.
- **`cut_category`** — the category, its measured median, the monthly cut, and the history: `months_at_or_below` out of `months_observed`. Never propose a cut without that count; §6.3 item 5 asks for "l'historique qui dit si c'est réaliste", and a proposal without it is a guess with a euro sign on it.
- Infeasible levers keep their card, greyed, with `unavailable_reason` printed verbatim.

- [ ] **Step 3: Write `FinancingPanel.tsx`**

Three columns (stacked below 768 px): Comptant, Crédit, LOA. Each with its out-of-pocket, monthly, total paid, interest and end wealth. Then the break-even sentence:

- `break_even_rate_bps !== null` → "Emprunter cesse d'être avantageux au-delà de X,XX % : en dessous, l'argent laissé placé rapporte plus que le crédit ne coûte. Votre taux retenu est Y,YY %." Name which side of the line the user's own assumption falls on.
- otherwise → print `break_even_reason` verbatim.
- The LOA column with `available: false` prints its `unavailable_reason` and a control that reveals the LOA fields in the form. With `available: true` it prints the cash figures and `wealth_unavailable_reason` — **never a zero** where the wealth figure would be.
- `better_kind` is stated as comparing **cash and credit only**, in words, so the LOA column is not read as having lost a three-way race.

- [ ] **Step 4: Write `OwnershipPanel.tsx` and `ImpactPanel.tsx`**

`OwnershipPanel`: the cost lines with their totals and monthly averages, then depreciation and residual value **stated separately from the running costs**, because one is money leaving the account and the other is value leaving the asset. `running_cost_cents` and `total_cost_cents` are both printed with a sentence saying which is which. Every line is labelled as a French average that the form can override, per design §6.3 item 3.

`ImpactPanel`:
- The emergency fund, before and after, from `impact.emergency`. On the operator's data both are `0.0`: print "déjà épuisé avant comme après", never "0,0 mois", which reads as a measurement of nothing.
- The five-year liquid trajectory, before and after.
- **Then, explicitly, the two things §6.3 asks for that this phase does not compute:** "Le patrimoine net à cinq ans et le score de santé financière ne sont pas encore calculés : les comptes d'investissement arrivent avec la phase Patrimoine, et le score de santé avec les mécaniques de suivi." A blank panel or a zero would be worse than saying it.

- [ ] **Step 5: Write `ScenarioBar.tsx`**

Name-and-save, a list of saved scenarios, delete, and a comparison table putting each saved scenario's **recomputed** verdict, gap and required monthly saving side by side. One sentence states that every scenario is recomputed against the current statements, so two of them are always answered from the same data.

Delete asks for confirmation. Phase 2A shipped `Effacer l'indice` erasing a stored series on one unconfirmed click and it was promoted into this plan rather than deferred again: **a destructive control on this screen confirms first.**

- [ ] **Step 6: Frontend suite and build**

`npm test` green; `npm run build` at zero TypeScript errors.

- [ ] **Step 7: BROWSER GATE — the longest screen in the app**

Seed, check port 8000, start detached, log in, `/faisabilite`, ask **40 000 € / 12 mois / apport 0 / véhicule**, and verify against the plan's hand-computed table:

| On screen | Expected |
|---|---|
| `save_more` | **+4 033,94 €** par mois, no effort percentage, note naming the deficit |
| `delay` | infeasible — "attendre n'y change rien" |
| `reduce_target` | infeasible — "aucune cible n'est atteignable" |
| `borrow` | 48 954,28 € · **923,83 €**/mois · 6 475,32 € d'intérêts · **196,10 %** d'endettement, alarm raised |
| `cut_category` | infeasible, naming the operator's heaviest category and its measured median |
| Coût de possession | 5 ans, assurance + entretien + carburant + décote, on a 40 000 € vehicle |
| Coût d'opportunité | **6 464,66 €** sur 60 mois |
| Fonds d'urgence | déjà épuisé avant **et** après |
| Cinq ans | **−46 981,03 €** avant · **−86 981,03 €** après |
| Comptant vs crédit | break-even around **299 bps** at a 3,00 % return; with the 5,00 % default loan rate, comptant wins |

Then save two scenarios (40 000 € / 12 mois and 15 000 € / 36 mois) and confirm the comparison table shows two different verdicts.

Screenshots at **375, 768, 1440 px, both themes** — twelve at least, and the page is long, so capture it in full rather than only the fold. Check: the three financing columns stack cleanly at 768 and 375; the lever cards do not clip their long French sentences; the warning treatment on the debt ratio clears AA in both themes measured off a decoded pixel; no horizontal scroll on `<body>`; console clean.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/features/feasibility
git commit -m "feat(feasibility): show the levers, the financing crossover and the impact"
```

---
# Lot E — Simulateurs

Design §6.1 lists "simulateur de crédit" and "simulateur immobilier" among the engines carried over from FinVest, and §12 names "simulateurs crédit, épargne et immobilier" in phase 2. Credit and savings need no new engine — Tasks 1 and 2 built them. Property does.

### Task 17: The property simulator engine

**Files:**
- Create: `backend/app/engines/property.py`
- Test: `backend/tests/test_property.py`

**Interfaces:**
- Consumes: `amortization.{LoanSchedule, build_schedule, cents, debt_ratio_bps, HCSF_DEBT_RATIO_BPS}`, `savings.project_savings`.
- Produces:
  - `PropertyRequest` frozen dataclass: `price_cents`, `down_payment_cents`, `notary_bps`, `loan_rate_bps`, `loan_months`, `insurance_bps_per_year`, `monthly_charges_cents`, `annual_property_tax_cents`, `monthly_income_cents: int | None`, `existing_debt_payments_cents`.
  - `PropertySimulation` frozen dataclass: `price_cents`, `notary_fees_cents`, `acquisition_cost_cents`, `down_payment_cents`, `down_payment_short_cents`, `borrowed_cents`, `schedule: LoanSchedule`, `monthly_insurance_cents`, `monthly_charges_cents`, `monthly_property_tax_cents`, `monthly_effort_cents`, `total_interest_cents`, `total_cost_cents`, `debt_ratio_bps: int | None`, `debt_ratio_exceeded: bool`.
  - `RentComparison` frozen dataclass: `horizon_months`, `capped_reason: str | None`, `monthly_rent_cents`, `buyer_property_value_cents`, `buyer_remaining_loan_cents`, `buyer_wealth_cents`, `renter_wealth_cents`, `difference_cents`, `better_kind: str`.
  - `simulate_property(request) -> PropertySimulation`
  - `rent_comparison(simulation, monthly_rent_cents, years, annual_return_bps, appreciation_bps_per_year) -> RentComparison`
  - `NOTARY_BPS_EXISTING = 750`, `NOTARY_BPS_NEW = 250`, `DEFAULT_INSURANCE_BPS_PER_YEAR = 36`, `DEFAULT_APPRECIATION_BPS_PER_YEAR = 100`.
  - Consumed by Task 18 (`/api/simulators/immobilier`).

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_property.py`:

```python
import pytest

from app.engines.amortization import HCSF_DEBT_RATIO_BPS
from app.engines.property import (
    NOTARY_BPS_EXISTING,
    PropertyRequest,
    rent_comparison,
    simulate_property,
)

# 300 000 EUR in the existing market, 60 000 EUR down, 3,50 % over 20 years,
# 150 EUR of charges, 1 200 EUR of taxe foncière, 4 000 EUR of measured income.
REQUEST = PropertyRequest(
    price_cents=30_000_000, down_payment_cents=6_000_000,
    notary_bps=NOTARY_BPS_EXISTING, loan_rate_bps=350, loan_months=240,
    insurance_bps_per_year=36, monthly_charges_cents=15_000,
    annual_property_tax_cents=120_000, monthly_income_cents=400_000,
    existing_debt_payments_cents=0,
)


def test_the_notary_fees_are_added_to_the_price_before_the_loan_is_sized():
    """A French buyer borrows the price PLUS the frais de notaire minus the
    down payment. Sizing the loan on the price alone understates it by 22 500
    EUR here."""
    simulation = simulate_property(REQUEST)
    assert simulation.notary_fees_cents == 2_250_000
    assert simulation.acquisition_cost_cents == 32_250_000
    assert simulation.borrowed_cents == 26_250_000


def test_the_monthly_effort_is_every_recurring_euro_not_just_the_instalment():
    """1 522,39 instalment + 78,75 insurance + 150 charges + 100 taxe foncière."""
    simulation = simulate_property(REQUEST)
    assert simulation.schedule.monthly_payment_cents == 152_239
    assert simulation.monthly_insurance_cents == 7_875
    assert simulation.monthly_property_tax_cents == 10_000
    assert simulation.monthly_effort_cents == 185_114
    assert simulation.total_interest_cents == 10_287_523


def test_the_debt_ratio_uses_the_instalment_and_the_insurance():
    """A French bank counts the assurance emprunteur inside the taux
    d'endettement. Leaving it out understates the ratio on every loan."""
    simulation = simulate_property(REQUEST)
    assert simulation.debt_ratio_bps == 4003
    assert simulation.debt_ratio_bps > HCSF_DEBT_RATIO_BPS
    assert simulation.debt_ratio_exceeded is True


def test_the_debt_ratio_is_absent_without_a_measured_income():
    simulation = simulate_property(
        PropertyRequest(**{**REQUEST.__dict__, "monthly_income_cents": None}))
    assert simulation.debt_ratio_bps is None
    assert simulation.debt_ratio_exceeded is False


def test_a_down_payment_below_the_notary_fees_is_flagged():
    """French banks lend the price, not the fees: the frais de notaire come out
    of the buyer's own money. Reported, not refused -- it is a fact about the
    plan, not an invalid input."""
    simulation = simulate_property(
        PropertyRequest(**{**REQUEST.__dict__, "down_payment_cents": 1_000_000}))
    assert simulation.down_payment_short_cents == 1_250_000
    simulation_ok = simulate_property(REQUEST)
    assert simulation_ok.down_payment_short_cents == 0


def test_a_cash_purchase_borrows_nothing_and_still_has_a_monthly_effort():
    simulation = simulate_property(
        PropertyRequest(**{**REQUEST.__dict__, "down_payment_cents": 32_250_000}))
    assert simulation.borrowed_cents == 0
    assert simulation.schedule.rows == []
    assert simulation.monthly_insurance_cents == 0
    assert simulation.monthly_effort_cents == 15_000 + 10_000
    assert simulation.debt_ratio_bps == 0


def test_renting_and_investing_can_win_and_the_engine_says_so():
    """Ten years, 1 % a year of appreciation, savings at 3 %, 1 100 EUR of rent
    against a 1 851,14 EUR monthly effort. The renter invests the 60 000 EUR
    down payment plus the 22 500 EUR of fees, and the 751,14 EUR of monthly
    difference. Hand-verified: buyer 177 582,08 EUR, renter 216 287,06 EUR."""
    simulation = simulate_property(REQUEST)
    comparison = rent_comparison(simulation, 110_000, 10, 300, 100)
    assert comparison.horizon_months == 120
    assert comparison.capped_reason is None
    assert comparison.buyer_property_value_cents == 33_153_745
    assert comparison.buyer_remaining_loan_cents == 15_395_537
    assert comparison.buyer_wealth_cents == 17_758_208
    assert comparison.renter_wealth_cents == 21_628_706
    assert comparison.better_kind == "rent"
    assert comparison.difference_cents == 17_758_208 - 21_628_706


def test_the_comparison_is_capped_at_the_loan_term_and_says_so():
    """Past the last instalment the buyer's monthly effort drops and the
    comparison changes shape. Rather than modelling a second regime silently,
    the horizon is capped and the cap is stated in French."""
    simulation = simulate_property(REQUEST)
    comparison = rent_comparison(simulation, 110_000, 30, 300, 100)
    assert comparison.horizon_months == 240
    assert comparison.capped_reason is not None
    assert "crédit" in comparison.capped_reason


def test_invalid_inputs_raise_in_french():
    with pytest.raises(ValueError, match="prix"):
        simulate_property(PropertyRequest(**{**REQUEST.__dict__, "price_cents": 0}))
    with pytest.raises(ValueError, match="apport"):
        simulate_property(PropertyRequest(**{**REQUEST.__dict__,
                                             "down_payment_cents": -1}))
    with pytest.raises(ValueError, match="loyer"):
        rent_comparison(simulate_property(REQUEST), -1, 10, 300, 100)
```

- [ ] **Step 2: Run it and watch it fail** — `ModuleNotFoundError`.

- [ ] **Step 3: Write the implementation**

Create `backend/app/engines/property.py`:

```python
"""Buying a home: what it really costs each month, and whether renting wins.

Design §6.1's "simulateur immobilier", rebuilt on the two Lot A engines so the
instalment quoted here is the same number `engines/levers.py` quotes for a
consumer loan.

Three things the French market makes non-optional:

* **the frais de notaire are borrowed too, unless the buyer pays them.** The
  loan is sized on price + fees - apport, not on the price. Sizing it on the
  price alone understates a 300 000 EUR purchase by 22 500 EUR;
* **the assurance emprunteur counts inside the taux d'endettement.** A French
  bank includes it; leaving it out understates the ratio on every loan and
  would put a plan the bank will refuse comfortably under the 35 % threshold;
* **the fees usually come out of the buyer's own money.** When the down payment
  is smaller than the fees, that is reported (`down_payment_short_cents`), not
  refused: it is a fact about the plan.

**The rent comparison is capped at the loan term.** Past the last instalment
the buyer's monthly effort drops by the instalment and the insurance, and the
renter's invested difference changes sign; modelling that silently would be a
second regime hidden inside one number. The cap is returned with a French
reason so a screen can say it.

Pure: no session, no network, no clock.
"""

from dataclasses import dataclass
from decimal import Decimal

from app.engines.amortization import (
    HCSF_DEBT_RATIO_BPS,
    LoanSchedule,
    build_schedule,
    cents,
    debt_ratio_bps,
)
from app.engines.savings import project_savings

# Frais de notaire, in basis points of the price. ~7,5 % in the existing
# market, ~2,5 % on a new build. Ordres de grandeur, adjustable by the user.
NOTARY_BPS_EXISTING = 750
NOTARY_BPS_NEW = 250

# Assurance emprunteur, in basis points of the INITIAL capital per year --
# the common French convention (assurance sur capital initial), which keeps
# the premium flat over the loan rather than falling with the balance.
DEFAULT_INSURANCE_BPS_PER_YEAR = 36

# An assumption, displayed and editable, never a forecast. 1 %/an.
DEFAULT_APPRECIATION_BPS_PER_YEAR = 100

_BPS = Decimal(10_000)


@dataclass(frozen=True)
class PropertyRequest:
    price_cents: int
    down_payment_cents: int
    notary_bps: int
    loan_rate_bps: int
    loan_months: int
    insurance_bps_per_year: int
    monthly_charges_cents: int
    annual_property_tax_cents: int
    # Measured, or None. See `capacity.measure_income_rate`.
    monthly_income_cents: int | None
    existing_debt_payments_cents: int


@dataclass(frozen=True)
class PropertySimulation:
    price_cents: int
    notary_fees_cents: int
    acquisition_cost_cents: int
    down_payment_cents: int
    # How much of the frais de notaire the down payment does NOT cover. 0 when
    # it does. A French bank generally wants these paid from own funds, so a
    # positive figure here is a plan the bank may refuse -- reported, not
    # refused by this engine.
    down_payment_short_cents: int
    borrowed_cents: int
    # `rows` is empty when nothing was borrowed. See `amortization.LoanSchedule`.
    schedule: LoanSchedule
    monthly_insurance_cents: int
    monthly_charges_cents: int
    monthly_property_tax_cents: int
    # Instalment + insurance + charges + taxe foncière. Every recurring euro,
    # which is the figure a household actually has to find each month.
    monthly_effort_cents: int
    total_interest_cents: int
    # Acquisition + interest + insurance over the whole loan. Charges and taxe
    # foncière are NOT in here: they are the cost of living somewhere, paid by
    # an owner and a tenant alike, and folding them in would make buying look
    # worse than renting by an amount both parties pay.
    total_cost_cents: int
    debt_ratio_bps: int | None
    # False both under the threshold AND when there is no ratio at all. Read
    # `debt_ratio_bps is None` first.
    debt_ratio_exceeded: bool


@dataclass(frozen=True)
class RentComparison:
    horizon_months: int
    # French, set exactly when the requested horizon was cut back to the loan
    # term. See the module docstring.
    capped_reason: str | None
    monthly_rent_cents: int
    buyer_property_value_cents: int
    buyer_remaining_loan_cents: int
    # Value minus what is still owed.
    buyer_wealth_cents: int
    # The down payment and the fees, invested, plus the monthly difference
    # between the owner's effort and the rent -- which may be NEGATIVE, in
    # which case the renter is drawing the pot down, and `project_savings`
    # models that honestly rather than flooring it.
    renter_wealth_cents: int
    difference_cents: int
    # "buy" or "rent".
    better_kind: str


def simulate_property(request: PropertyRequest) -> PropertySimulation:
    if request.price_cents <= 0:
        raise ValueError("Le prix du bien doit être strictement positif.")
    if request.down_payment_cents < 0:
        raise ValueError("L'apport ne peut pas être négatif.")

    notary = cents(Decimal(request.price_cents) * Decimal(request.notary_bps) / _BPS)
    acquisition = request.price_cents + notary
    borrowed = max(0, acquisition - request.down_payment_cents)
    schedule = build_schedule(borrowed, request.loan_rate_bps, request.loan_months)
    insurance = cents(
        Decimal(borrowed) * Decimal(request.insurance_bps_per_year) / _BPS / Decimal(12)
    )
    tax_monthly = cents(Decimal(request.annual_property_tax_cents) / Decimal(12))
    ratio = debt_ratio_bps(
        request.existing_debt_payments_cents + schedule.monthly_payment_cents + insurance,
        request.monthly_income_cents,
    )
    months = schedule.months if borrowed else 0
    return PropertySimulation(
        price_cents=request.price_cents, notary_fees_cents=notary,
        acquisition_cost_cents=acquisition, down_payment_cents=request.down_payment_cents,
        down_payment_short_cents=max(0, notary - request.down_payment_cents),
        borrowed_cents=borrowed, schedule=schedule,
        monthly_insurance_cents=insurance,
        monthly_charges_cents=request.monthly_charges_cents,
        monthly_property_tax_cents=tax_monthly,
        monthly_effort_cents=schedule.monthly_payment_cents + insurance
        + request.monthly_charges_cents + tax_monthly,
        total_interest_cents=schedule.total_interest_cents,
        total_cost_cents=acquisition + schedule.total_interest_cents + insurance * months,
        debt_ratio_bps=ratio,
        debt_ratio_exceeded=ratio is not None and ratio > HCSF_DEBT_RATIO_BPS,
    )


def rent_comparison(
    simulation: PropertySimulation,
    monthly_rent_cents: int,
    years: int,
    annual_return_bps: int,
    appreciation_bps_per_year: int,
) -> RentComparison:
    """Owner's net wealth against renter's, at the same date, from the same start.

    Both start with the same money: the owner spends the down payment and the
    fees on day one, the renter invests them. Both then spend the same amount
    each month -- the owner on the instalment, insurance, charges and taxe
    foncière, the renter on rent plus whatever is left over, invested.
    """
    if monthly_rent_cents < 0:
        raise ValueError("Le loyer ne peut pas être négatif.")
    if years < 1:
        raise ValueError("La durée de comparaison doit être d'au moins un an.")

    requested = years * 12
    horizon = requested
    capped: str | None = None
    if simulation.borrowed_cents > 0 and requested > simulation.schedule.months:
        horizon = simulation.schedule.months
        capped = (
            f"La comparaison s'arrête à la fin du crédit, soit "
            f"{simulation.schedule.months} mois : au-delà, la mensualité et "
            "l'assurance disparaissent et l'effort mensuel n'est plus le même. "
            "Prolonger le calcul sans le dire mélangerait deux situations "
            "différentes."
        )

    # Monthly compounding, like every other growth in this codebase, so a
    # horizon that is not a whole number of years is not lumpy.
    value = project_savings(simulation.price_cents, 0,
                            appreciation_bps_per_year, horizon).final_cents
    rows = simulation.schedule.rows
    remaining = rows[horizon - 1].remaining_cents if horizon <= len(rows) else 0
    buyer = value - remaining

    renter = project_savings(
        simulation.down_payment_cents + simulation.notary_fees_cents,
        simulation.monthly_effort_cents - monthly_rent_cents,
        annual_return_bps, horizon,
    ).final_cents

    return RentComparison(
        horizon_months=horizon, capped_reason=capped,
        monthly_rent_cents=monthly_rent_cents,
        buyer_property_value_cents=value, buyer_remaining_loan_cents=remaining,
        buyer_wealth_cents=buyer, renter_wealth_cents=renter,
        difference_cents=buyer - renter,
        better_kind="buy" if buyer >= renter else "rent",
    )
```

- [ ] **Step 4: Run, mutation-check, commit**

Run from `backend/`: `.venv/Scripts/pytest.exe tests/test_property.py -v` → PASS, 9 tests.

Mutations, each alone: (1) size the loan on `price_cents` instead of `acquisition_cost_cents` — the notary test goes red; (2) drop the insurance from the debt-ratio numerator — `test_the_debt_ratio_uses_the_instalment_and_the_insurance` goes red (the ratio falls to 3806 bps, still above the threshold, which is precisely why the test asserts the exact figure and not only the flag); (3) remove the horizon cap — `test_the_comparison_is_capped_at_the_loan_term_and_says_so` goes red.

Full suite: **667** passed, `property.py` at 100 %.

```bash
git add backend/app/engines/property.py backend/tests/test_property.py
git commit -m "feat(engines): simulate a French property purchase against renting"
```

---

### Task 18: `/api/simulators` — credit, savings, property

**Files:**
- Create: `backend/app/api/simulators.py`, `backend/app/schemas/simulators.py`
- Modify: `backend/app/main.py`, `backend/app/api/errors.py`
- Test: `backend/tests/test_simulators_api.py`

**Interfaces:**
- Consumes: `amortization.build_schedule`, `savings.project_savings`, `property.{PropertyRequest, rent_comparison, simulate_property}`, `capacity.measure_income_rate`, `api.goals.observed_months`, `api.feasibility._existing_debt_payments_cents`.
- Produces:
  - `POST /api/simulators/credit` → `CreditOut` (the schedule, plus a yearly roll-up for the chart)
  - `POST /api/simulators/epargne` → `SavingsOut`
  - `POST /api/simulators/immobilier` → `PropertyOut` (simulation + optional rent comparison)
  - `GET /api/simulators/context` → the measured income and existing instalments, so the property simulator's debt ratio is measured rather than typed.
  - Consumed by Tasks 19 and 20.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_simulators_api.py`. Required cases:

```python
def test_a_credit_schedule_matches_the_engine_to_the_cent(client):
    headers = _register(client)
    body = client.post("/api/simulators/credit", headers=headers, json={
        "principal_cents": 10_000_000, "annual_rate_bps": 300, "months": 240}).json()
    assert body["monthly_payment_cents"] == 55_460
    assert body["total_interest_cents"] == 3_310_324
    assert len(body["rows"]) == 240
    # The yearly roll-up is what the chart draws: 20 bars, and the parts sum
    # back to the whole.
    assert len(body["years"]) == 20
    assert sum(y["interest_cents"] for y in body["years"]) == body["total_interest_cents"]
    assert sum(y["principal_cents"] for y in body["years"]) == 10_000_000


def test_a_credit_of_zero_months_is_refused_in_french(client): ...
def test_a_credit_longer_than_forty_years_is_refused_in_french(client): ...


def test_a_savings_projection_returns_its_points(client):
    body = client.post("/api/simulators/epargne", headers=headers, json={
        "initial_cents": 0, "monthly_cents": 100_000, "annual_rate_bps": 1200,
        "months": 3}).json()
    assert [p["balance_cents"] for p in body["points"]] == [100_000, 201_000, 303_010]
    assert body["interest_cents"] == 3_010


def test_a_savings_withdrawal_plan_is_allowed_and_goes_negative(client):
    """A negative monthly contribution is a withdrawal, and the pot is not
    floored at zero. This is the same branch the operator's own feasibility
    projection uses."""
    body = client.post("/api/simulators/epargne", headers=headers, json={
        "initial_cents": 250_000, "monthly_cents": -100_000, "annual_rate_bps": 0,
        "months": 3}).json()
    assert body["final_cents"] == -50_000


def test_the_property_simulation_matches_the_engine(client): ...
def test_the_property_debt_ratio_uses_the_measured_income(client): ...
def test_the_rent_comparison_is_returned_only_when_a_rent_is_given(client): ...
def test_the_simulators_never_read_another_users_data(client): ...
```

Write every one of them out in full, using the figures asserted in Tasks 1, 2 and 17 — they are hand-verified there and must agree here.

- [ ] **Step 2: Schemas and router**

`schemas/simulators.py`: `CreditIn`/`CreditOut` (with `ScheduleRowOut` and `ScheduleYearOut`), `SavingsIn`/`SavingsOut` (with `SavingsPointOut`), `PropertyIn`/`PropertyOut` (with `PropertySimulationOut` and `RentComparisonOut`), `SimulatorContextOut`.

`ScheduleYearOut` is the roll-up the chart draws: `year: int`, `interest_cents`, `principal_cents`, `remaining_cents` (at year end). Computed in the router, not the engine — it is a presentation concern and the engine has no business knowing a chart wants twenty bars instead of 240.

`api/simulators.py`: three POST routes and one GET. Same POST rationale as `/api/feasibility` (structured input, no side effect) — state it in the module docstring. Every `ValueError` from an engine becomes a French 422 through the same catch-and-forward idiom. The property route measures the income itself (`measure_income_rate(observed_months(db, user.id))`) rather than accepting it from the client, so the debt ratio on screen is measured and not typed; the module docstring says so.

`errors.py` `FIELD_SUBJECTS`: `"initial_cents": "Le capital de départ"`, `"monthly_cents"` is already there from Task 13, `"notary_bps": "Les frais de notaire"`, `"insurance_bps_per_year": "L'assurance emprunteur"`, `"monthly_charges_cents": "Les charges"`, `"annual_property_tax_cents": "La taxe foncière"`, `"monthly_rent_cents": "Le loyer"`.

- [ ] **Step 3: Run, register, commit**

`.venv/Scripts/pytest.exe tests/test_simulators_api.py -v` → PASS. Full suite → **678** passed.

```bash
git add backend/app/api/simulators.py backend/app/schemas/simulators.py backend/app/main.py backend/app/api/errors.py backend/tests/test_simulators_api.py
git commit -m "feat(api): expose the credit, savings and property simulators"
```

---

### Task 19: `/simulateurs` — credit and savings, with the amortisation chart

**Files:**
- Create: `frontend/src/features/simulators/SimulatorsPage.tsx`, `.css`, `CreditSimulator.tsx`, `SavingsSimulator.tsx`, and their tests
- Create: `frontend/src/charts/AmortizationChart.tsx`, `AmortizationChart.test.tsx`
- Modify: `frontend/src/lib/types.ts`, `frontend/src/app/routes.tsx`, `frontend/src/app/AppShell.tsx`

**Interfaces:**
- Consumes: `POST /api/simulators/credit`, `POST /api/simulators/epargne` (Task 18).
- Produces: route `/simulateurs`, nav entry "Simulateurs". Task 20 adds a third tab to the same page.

- [ ] **Step 1: The chart, and the stacking rule**

`AmortizationChart` draws one bar per year, stacked: interest below, principal above. **Both series carry `stackStrategy: "all"`.** Its test asserts that, exactly as `DebtPayoffChart.test.tsx` does, and for the same documented reason — ECharts chains a stacked value onto the previous series only when both share a sign, and two charts in this codebase shipped broken because of it.

A second assertion the test must carry: the two series' values at each year sum to that year's total payment. A stacked chart whose parts do not sum to the whole is drawing a different quantity from the one its legend claims.

`labelLayout: { hideOverlap: true }` on any on-bar labels, and `legend.right: 84` to clear the Exporter button — both fixes phase 2A had to make after finding them in a browser at 375 px, not in a test.

- [ ] **Step 2: `CreditSimulator.tsx`**

Inputs: capital (euros, `parseCents`), rate (percentage → basis points, with the comment that the string-arithmetic rule applies to money and this is a rate), duration in months with a years hint. Outputs: the instalment, the total interest, the total paid, the chart, and a collapsible full schedule table.

The schedule table is 240 rows on a mortgage. Virtualise nothing; collapse it behind a disclosure and render it only when opened. At 375 px it scrolls **inside its own `overflow-x: auto` container** — the page body must never scroll horizontally.

- [ ] **Step 3: `SavingsSimulator.tsx`**

Inputs: initial amount, monthly contribution (**which may be negative — label it "versement mensuel (négatif pour un retrait)"**), rate, duration. Outputs: final amount, contributed, interest, and a two-series area chart of contributed versus interest. Same `stackStrategy: "all"`.

State plainly that the rate is an assumption, not a measurement, and that Yieldo fetches no market rate — design §10 and §2's "pas un conseiller financier".

- [ ] **Step 4: `SimulatorsPage.tsx`**

A tab list (`role="tablist"` with proper `aria-controls`/`aria-selected`, arrow-key navigation) over Crédit · Épargne · Immobilier. Task 20 fills the third. The active tab lives in the URL query (`?onglet=credit`) so a reload keeps it and the tab is linkable.

Above the tabs, one sentence: these simulators answer "what if", from figures you type; the Faisabilité screen answers "can I", from figures measured in your statements. Link to `/faisabilite`. Without it the two screens read as duplicates.

- [ ] **Step 5: Suite, build, BROWSER GATE, commit**

`npm test` green, `npm run build` clean. Then the browser: seed, check port 8000, start detached, log in, `/simulateurs`.

- Run 100 000 € / 3,00 % / 240 mois and confirm **554,60 €** and **33 103,24 €** of interest on screen — the same figures Task 1 asserts.
- Run a savings plan of 0 € / 100 € per month / 12 % / 3 mois and confirm **3 030,10 €**.
- Run a savings plan with a **negative** monthly contribution and confirm the balance goes below zero on the chart rather than flattening at zero. **Check the chart specifically**: this is the exact shape the `samesign` stacking defect destroys, and a screenshot is the only thing that proves it.
- Screenshots at **375, 768, 1440 px, both themes**. Check: the 240-row table scrolls inside its container and not the page; the chart's last x-axis label is not clipped (phase 2A left `m12` open on the cashflow chart for exactly this); tabs are reachable and operable by keyboard; console clean.

```bash
git add frontend/src/features/simulators frontend/src/charts/AmortizationChart.tsx frontend/src/charts/AmortizationChart.test.tsx frontend/src/lib/types.ts frontend/src/app/routes.tsx frontend/src/app/AppShell.tsx
git commit -m "feat(simulators): add the credit and savings simulators"
```

---

### Task 20: `/simulateurs` — the property tab

**Files:**
- Create: `frontend/src/features/simulators/PropertySimulator.tsx`, `PropertySimulator.test.tsx`
- Modify: `frontend/src/features/simulators/SimulatorsPage.tsx`, `.css`, `frontend/src/lib/types.ts`

**Interfaces:**
- Consumes: `POST /api/simulators/immobilier`, `GET /api/simulators/context` (Task 18).

- [ ] **Step 1: Write the failing test**

Cases, each written out in full:

```tsx
it("shows the notary fees as part of what is borrowed", () => {
  // 300 000 € + 22 500 € − 60 000 € = 262 500 € borrowed. A reader who sees
  // only "300 000 €" cannot tell where the instalment came from.
});

it("raises the 35 % alarm and names the rule", () => {
  // debt_ratio_bps 4003 -> "40,03 %" with the warning treatment and the
  // sentence naming the HCSF threshold.
});

it("says the debt ratio could not be measured rather than showing 0 %", () => {
  // debt_ratio_bps null. Branch on the null BEFORE the exceeded flag.
});

it("warns when the down payment does not cover the notary fees", () => {
  // down_payment_short_cents 12 500 € -> the sentence about own funds.
});

it("prints the rent comparison only when a rent was entered", () => {
  // No rent -> no comparison and a sentence saying what to type, never an
  // empty panel and never a zero.
});

it("states the comparison horizon cap in the engine's own words", () => {
  // capped_reason printed verbatim, not paraphrased.
});

it("says which side wins without hiding the assumptions behind it", () => {
  // "Louer et placer la différence" with the appreciation rate, the return
  // rate and the horizon all named in the same paragraph. Design §10.
});
```

- [ ] **Step 2: Write `PropertySimulator.tsx`**

Inputs: price, down payment, a notary choice between "ancien (7,5 %)" and "neuf (2,5 %)" plus a free field, loan rate, loan term, insurance rate, monthly charges, annual property tax, and — for the comparison — a monthly rent, a horizon in years, an appreciation rate and a return rate.

That is a lot of fields. Group them under three headings — **Le bien**, **Le crédit**, **Comparer avec la location** — and make the third collapsible and empty by default. The debt ratio's income comes from `GET /api/simulators/context` and is displayed as measured, with its sample size, never as an input.

Outputs: the acquisition breakdown, the monthly effort broken into its four parts, the debt ratio with the threshold, the total cost, the amortisation chart (reused from Task 19), and the rent comparison when a rent was entered.

- [ ] **Step 3: Suite, build, BROWSER GATE, commit**

`npm test` green, `npm run build` clean. Then the browser, `/simulateurs?onglet=immobilier`:

- Run the plan's own worked example: **300 000 €, apport 60 000 €, ancien, 3,50 %, 240 mois, assurance 0,36 %, charges 150 €, taxe foncière 1 200 €**. Confirm on screen: frais de notaire **22 500 €**, emprunté **262 500 €**, mensualité **1 522,39 €**, assurance **78,75 €**, effort **1 851,14 €**, intérêts **102 875,23 €**, endettement **40,03 %** with the alarm raised.
- Add a rent of **1 100 €** over **10 ans** and confirm: patrimoine acheteur **177 582,08 €**, patrimoine locataire **216 287,06 €**, and the verdict "louer et placer la différence".
- Set the comparison horizon to **30 ans** and confirm the cap sentence appears and the horizon reads 240 months.
- Screenshots at **375, 768, 1440 px, both themes**. Check: the three field groups stack without the labels wrapping to one character per line (phase 2A found exactly that on category names at 375); the comparison's two wealth figures are legible side by side at 768 and stack at 375; console clean; no horizontal scroll.

```bash
git add frontend/src/features/simulators frontend/src/lib/types.ts
git commit -m "feat(simulators): add the property simulator and the rent comparison"
```

---

# Lot F — Vérification

### Task 21: Phase-wide verification pass

Phase 2A's equivalent task found five blocking defects, including a chart that had been drawing a 2 209,63 € deficit as a bar above zero **since phase 1.5**, through two verification passes that used screenshots. Assume this phase has shipped at least one thing of that kind, and go looking for it.

**Files:** whatever the findings require. Expect to touch charts and stylesheets.

**Interfaces:** consumes everything above.

- [ ] **Step 1: Establish a trustworthy environment**

```powershell
cd E:\Projet\Github\Yieldo\backend
.venv\Scripts\python.exe ..\.superpowers\sdd\2026-08-12-yieldo-phase-1-5-interface\seed_fixture.py
Get-NetTCPConnection -LocalPort 8000 -ErrorAction SilentlyContinue
```

The last command must print **nothing**. Then start both servers detached and record the backend PID in the report. Confirm `GET /api/openapi.json` lists `/api/debts`, `/api/goals`, `/api/feasibility`, `/api/simulators` — phase 2A lost a round to a stale worker serving a build with no `/api/analysis/*` in it at all.

Record the fixture's shape before and after the session (transaction count, account count, batch count) and confirm nothing changed.

- [ ] **Step 2: Every screen, every width, both themes**

`/dettes`, `/objectifs`, `/faisabilite`, `/simulateurs` (three tabs) at **375, 768 and 1440 px** in **light and dark** — at least 28 screenshots, all attached. On each, read the rendered image rather than trusting the DOM:

- no horizontal scroll on `<body>`;
- no clipped chart axis label, no legend under the Exporter button;
- no text collapsing to one character per line;
- every bar, track and progress fill has non-zero width;
- the console is clean.

- [ ] **Step 3: Contrast, measured off decoded pixels**

For every new colour pairing this phase introduced — the three verdict states, the debt-ratio alarm, the lever cards' greyed-out treatment, the two chart ramps in `AmortizationChart` and `DebtPayoffChart` — decode the screenshot and compute the WCAG ratio **from the actual pixels**, not from token values. Phase 2A's task 19 found four ramp colours failing 4.5:1 against both white and `--yd-text` that way, and found the light-theme skeleton at exactly 1.000:1 that no token-based check had caught.

Targets: 4.5:1 for text, 3:1 for a control boundary or a meaningful graphical object. Add any new token to `design/contrast.test.ts`'s `TEXT_TOKENS` and **prove the test bites** by temporarily weakening the value before reverting.

`design/controlBorders.test.ts` already fails any rule with `cursor: pointer` taking its border from `--yd-border` or `--yd-border-strong`. Every new control in this phase must pass it; run it explicitly.

- [ ] **Step 4: The chart audit**

Grep every chart added in this phase for `stack:` and confirm each stacked series also carries `stackStrategy: "all"`. Then **prove it in the browser** on data that goes negative — the savings simulator with a negative monthly contribution is the ready-made case. A screenshot showing the area descending below the axis is the evidence; a passing unit test is not.

- [ ] **Step 5: Cross-tenant sweep**

For each of `/api/debts`, `/api/debts/payoff`, `/api/goals`, `/api/feasibility`, `/api/feasibility/context`, `/api/feasibility/scenarios` and the three simulator routes: seed **two** users with **different** data and assert each sees only their own — in both directions. Phase 2A shipped several tests proving exclusion only from the empty side; those prove nothing about a filter that leaks.

- [ ] **Step 6: The operator's own answers, end to end**

Log in as the demo user and walk the phase's own story, checking every figure against this plan's tables:

1. `/faisabilite` → 40 000 €, 12 mois → **Hors de portée**, capacity **−746,19 €**, projection **−8 954,28 €**, gap **48 954,28 €**, borrow lever at **923,83 €**/mois and **196,10 %**.
2. `/objectifs` → three goals → every one refusing with the **negative-capacity** reason, not the month-count one.
3. `/dettes` → no debts → the empty state, not a refusal. Add three, confirm the two orders differ.
4. `/simulateurs` → the three worked examples from Tasks 19 and 20.

- [ ] **Step 7: Performance, with an instrument that has headroom**

Phase 2A's frame-rate measurement was saturated at the vsync floor (p50 6.90 ms on a 144 Hz display is 1000/144) and its "no difference" conclusion was withdrawn. Do not repeat it. Measure API latency (p95, against a 200 ms threshold) on `/api/feasibility` and `/api/debts/payoff` — both recompute over the whole ledger — and measure the bundle size, which phase 2A left as an **open watch item at 1 632 kB with a ~1.25 s load frame**. Report whether this phase's four screens made it worse and by how much.

- [ ] **Step 8: Write the findings up, fix the blocking ones, re-verify**

Blocking = wrong number on screen, wrong sign, illegible text, a refusal dressed as a failure, a message naming the wrong cause, a contrast failure, or a cross-tenant leak. Fix each, re-run both suites, re-shoot the affected screenshots, and record every deferral with a reason.

- [ ] **Step 9: Final gate**

Both suites green. `npm run build` at zero TypeScript errors. Backend coverage ≥80 % on `app/engines` — report the actual figure per module. **Do not run `npm run lint`**: eslint is not installed and the script has never worked in this repository. Record that fact again in the report so nobody spends a round on it.

```bash
git add -A
git commit -m "fix(phase-2b): resolve the verification pass findings"
```

---

## Self-review

**Spec coverage — design §6.3, item by item.**

| §6.3 | Where |
|---|---|
| 1. Capacité d'épargne réelle, mesurée, avec sa variabilité | Task 11, consuming phase 2A's `capacity.measure_savings_capacity`; surfaced with its band and sample size by Tasks 13 and 15 |
| 2. Verdict avec l'écart chiffré | Task 11 (`verdict`, `gap_cents`), Task 15 (`VerdictPanel`) |
| 3. Coût total de possession, préremplis par des moyennes françaises et ajustables | Task 10 (`ownership.py`), Task 13 (override on the wire), Task 16 (`OwnershipPanel`) |
| 4. Coût d'opportunité | Task 2 (`opportunity_cost_cents`), Task 11, Task 16 |
| 5. Leviers chiffrés et classés (5 kinds, 35 % alert) | Task 12 (`levers.py`), Task 16 (`LeverList`) |
| 6. Comptant / crédit / LOA and the break-even rate | Task 12 (`compare_financing`), Task 16 (`FinancingPanel`) |
| 7. Impact simulé | Task 11 — **fonds d'urgence and a five-year liquid trajectory only**; net worth and the health score are declared out of scope with reasons, and Task 16 states both absences on screen |
| Scénarios enregistrables et comparables | Tasks 3, 14, 16 |
| Simulateurs crédit / épargne / immobilier (§12) | Tasks 1, 2, 17, 18, 19, 20 |
| Dettes, boule de neige et avalanche (§6.1) | Tasks 3, 4, 5, 6 |
| Objectifs et leur progression (§4.1, §6.2 jalons) | Tasks 3, 7, 8, 9 |

**Placeholder scan.** Every code step carries real code or, on the four screen tasks, a numbered structural specification plus the full code for the components that carry a contract (`VerdictPanel`, `DebtPayoffChart`, the type declarations). No "TBD", no "add error handling", no "similar to Task N". Every arithmetic assertion in this document was produced by running a reference implementation against the repository's own engines.

**Type consistency.** `MeasuredRate` / `MeasuredRateOut` is reused from phase 2A on all four new payload families rather than redeclared. `month_end` is defined once (Task 4) and consumed by Tasks 4, 7, 11 and 17. `cents` and `monthly_rate` are defined once (Task 1) and consumed by Tasks 2, 4, 10 and 17. `months_of_runway` is defined once (Task 11) and consumed by `runway._scenario` and `feasibility._emergency`. `observed_months` and `rate_out` are defined once (Task 8, `api/goals.py`) and consumed by Tasks 13 and 18. `Lever` and `LeverOut` carry identical field names, and Task 13 adds the test that keeps them that way.
