# Yieldo Phase 2A — Analyse : Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Six analysis engines — budgets, récurrences, prévision de trésorerie, runway, inflation personnelle, détection d'anomalies — each with its pure engine, its API surface and its screen, and each of which says "pas assez de données pour conclure" rather than inventing a confident number from four points.

**Architecture:** The phase-1 layering is unchanged: `models` (ORM) → `engines` (pure functions, no session, no network, no implicit clock) → `api` (routers that read the clock, fetch this user's rows, convert them into the engines' input dataclasses and serialise the result). One new shared statistics module (`engines/robust.py`) carries the median/MAD primitives all six features stand on, so "robust method, no arbitrary threshold" is implemented once. One new shared route module (`api/common.py`) carries the `user_id`-filtered fetch helpers, extracted from `api/analytics.py` where they are currently private. Frontend adds four screens on the existing bento grid and one new ECharts component.

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

Phase 1 shipped 435 passing tests and an interface the operator rejected on sight: every frontend test runs in jsdom, which has no rendering engine, and 24 reviews never opened a browser. A passing Vitest suite proves a component mounted. It proves nothing about how it looks, whether a bar has non-zero width, or whether a label is legible. Every screen-bearing task below carries an explicit browser-verification step naming the widths and the themes.

### Three failure modes that have each already cost a fix round

Do not rediscover these.

1. **A stylesheet `transform` is silently overridden by Motion.** Every `motion.*` element gets an inline `transform: none` once its entry animation settles, and an inline declaration beats any stylesheet rule. A hover lift, a scale, a nudge written as `transform:` in CSS on such an element is dead on screen while its CSS test passes. **Use the independent `translate` / `scale` / `rotate` properties instead** (see `frontend/src/design/bento/Bento.css`).
2. **A `transition` prop on an element that also carries `variants` is never consulted.** Motion resolves `resolvedVariant.transition` first and only falls back to the component prop when the variant has none. Every variant in `frontend/src/design/motion/variants.ts` carries its own transition, so **timing goes inside the variant** (see `fadeInUpDelayed`).
3. **Percentage widths inside an auto-width flex column resolve to zero.** The dashboard's loading skeleton shipped with an invisible figure for exactly this reason. Any bar, gauge or track sized in percent must sit in a container with a *definite* inline size — a grid track, or a flex item carrying `min-width: 0` plus `flex: 1`. This plan builds budget bars and a confidence band; both are exposed.

### Environment facts the implementer needs

- Branch `phase-2-analyse-decision`, cut from `bf5c2cd` (end of phase 1.5). Backend **262** tests, frontend **389**, both green, `npm run build` clean. Both suites stay green at every task.
- Verification fixture: `.superpowers/sdd/2026-08-12-yieldo-phase-1-5-interface/seed_fixture.py`. Run from `backend/` with `.venv/Scripts/python.exe ../.superpowers/sdd/2026-08-12-yieldo-phase-1-5-interface/seed_fixture.py`. It rebuilds `backend/data/yieldo.db` from scratch with the operator's real volumes: **197 transactions, 2025-01-24 → 2026-01-09, 1 account, 69 categories with 19 in use, 1 import batch (198 rows, 197 imported, 1 duplicate)**. Login `demo@yieldo-demo.fr` / `MotDePasseDemo123!`.
- Months present in the fixture: 2025-01 (13 rows, partial — starts the 24th), 2025-02 (61), 2025-03 (20), 2025-12 (77), 2026-01 (26, partial — ends the 9th). **April to November 2025 are empty.** 179 debits, 18 credits.
- Today is **2026-08-12** in that fixture's world (seven months after the last transaction). The default "Mois" period is empty; that is expected, not a bug.
- Before trusting any API output, check that no orphaned `uvicorn --reload` worker is holding port 8000: `Get-NetTCPConnection -LocalPort 8000`. This cost a full round in phase 1.5 — a dead parent's worker served pre-fix code while every new instance failed to bind.
- The fixture writes `label_clean = label.lower()`, which is **not** what the real importer writes (`normalize_label(label_raw)`). The recurrence pipeline in this plan therefore recomputes the grouping key from `label_raw` at the API boundary rather than trusting the stored `label_clean`. Do not "fix" that by reading `label_clean`.

### Honesty on thin data — the requirement specific to this phase

The operator's history is 197 transactions over roughly twelve months, with two dense months, three sparse ones and eight empty ones. Recurrence detection, seasonality, inflation and outlier scoring all degrade on that volume, and every one of them can be made to emit a confident-looking number from three or four points.

**Every engine in this plan must refuse rather than guess**, and must say so in French, naming what is missing. Each of the six features carries an explicit minimum-sample constant, a documented reason for its value, and a test for the thin-data case using the operator's own shape. Where an engine refuses, the screen prints the refusal — never an empty chart, never a zero standing in for an unknown.

The measured outcome on the operator's fixture, which the implementer should expect and must not "fix":

| Feature | Threshold | Operator's data | Result |
|---|---|---|---|
| Budgets | none (a budget is declared, not inferred) | — | computes |
| Récurrences | ≥3 occurrences, intervals regular | gaps of 9 months between blocks | almost everything rejected |
| Prévision | ≥6 complete observed months | 3 | **refuses** |
| Runway | ≥3 complete observed months | 3 | computes, flagged "mesuré sur 3 mois" |
| Inflation | ≥3 months with data in **each** of two year-apart windows | second window empty | **refuses** |
| Anomalies | ≥10 observations in the category | 19 categories, ~10 rows each | mixed — some scored, some skipped |

### Scope

This plan covers exactly the six features named above. **Phase 2B** (moteur de faisabilité d'achat, simulateurs crédit/épargne/immobilier, dettes, objectifs) and **phase 2C** (mécaniques d'engagement : streak, jalons, santé évolutive, défis) are separate plans. What 2B will consume from this one is named in the Interfaces blocks — chiefly `engines/capacity.measure_savings_capacity`, which is the *measured* savings capacity the purchase-feasibility engine needs (design §6.3 item 1: "mesurée sur les transactions des douze derniers mois, pas déclarée. Avec sa variabilité").

### Deliberate deviations from the design spec, with reasons

- **No `recurrences` table.** §4.1 lists one. Detection here is computed on the fly from the ledger. Persisting a derived result needs invalidation on every import, every category edit and every rollback, and detection over ~200 rows costs microseconds. `transactions.is_recurring` and `transactions.recurrence_id` stay unused, exactly as they are today.
- **`/categories` stays a placeholder.** It was already flagged as a live nav destination with no screen (phase 1.5 finding, `routes.tsx:17`). Setting a monthly budget and marking a category essential are done on the Budgets screen, which is where the reader is already thinking about them. A full categories manager is not in this phase.
- **INSEE comparison is user-supplied and optional.** The app makes no outbound call by default. Phase 2A ships a `price_index_points` table, a `PUT`/`GET` pair, and a paste-a-series form on the Analyse screen. With no series entered, the reference column reads "—" and the screen says the index is not configured. It never invents one.
- **Inflation compares year-over-year only**, not against the preceding period. "Inflation personnelle" means the same basket twelve months apart; a three-month window against the previous three months measures seasonality, not inflation.

---

## File Structure

**Backend** — `backend/app/`

| File | Responsibility |
|---|---|
| `engines/robust.py` | **new** — median, MAD, mean absolute deviation, modified z-score, normal-equivalent scale. Integer cents in, integer cents out. The single source of every "robust method" in this phase |
| `engines/budget.py` | **new** — consumption of a monthly budget, month-pace projection, status |
| `engines/recurrence.py` | **new** — grouping by label key, interval regularity, periodicity, price-level change, missing occurrence, annual cost |
| `engines/capacity.py` | **new** — complete observed months, measured monthly expense rate, measured monthly savings capacity (**phase 2B consumes this**) |
| `engines/runway.py` | **new** — months sustainable without income, normal and essentials-only scenarios |
| `engines/forecast.py` | **new** — 12-month projection from recurrences plus seasonal residual, P10/P50/P90 balance band, threshold breaches |
| `engines/inflation.py` | **new** — per-category median monthly spend, two year-apart windows, optional reference index |
| `engines/anomaly.py` | **new** — modified z-score per category over the category's own history |
| `api/common.py` | **new** — `user_id`-filtered fetch helpers shared by every analytics-shaped router, extracted from `api/analytics.py` |
| `api/budgets.py` | **new** — `GET /api/budgets` |
| `api/recurrences.py` | **new** — `GET /api/recurrences` |
| `api/cashflow.py` | **new** — `GET /api/cashflow/forecast`, `GET /api/cashflow/runway` |
| `api/analysis.py` | **new** — `GET /api/analysis/inflation`, `GET /api/analysis/anomalies`, `GET`/`PUT /api/analysis/price-index` |
| `schemas/budgets.py`, `schemas/recurrences.py`, `schemas/cashflow.py`, `schemas/analysis.py` | **new** — Pydantic output shapes |
| `models/price_index.py` | **new** — `PriceIndexPoint` |
| `models/category.py` | modified — adds `is_essential` |
| `categorization/seed.py` | modified — adds `ESSENTIAL_SLUGS`, applied by the seed and by the migration |
| `api/analytics.py` | modified — its two private helpers move to `api/common.py` |
| `main.py` | modified — four new routers |

**Frontend** — `frontend/src/`

| File | Responsibility |
|---|---|
| `features/budgets/BudgetsPage.tsx` + `.css` | Budgets screen, month navigation, inline budget editing |
| `features/budgets/BudgetBar.tsx` | One budget line: name, figures, consumption track |
| `features/recurrences/RecurrencesPage.tsx` + `.css` | Abonnements et prélèvements: annual cost, price rises, missing debits, full list |
| `features/cashflow/CashflowPage.tsx` + `.css` | Trésorerie: runway scenarios and the 12-month projection |
| `features/cashflow/RunwayPanel.tsx` | The two runway scenarios |
| `features/analysis/AnalysisPage.tsx` + `.css` | Analyse: inflation personnelle and anomalies |
| `features/analysis/PriceIndexForm.tsx` | Paste-a-series form for the optional reference index |
| `charts/ForecastFanChart.tsx` | P10/P50/P90 confidence band — never a single line |
| `lib/types.ts` | modified — mirror types for the four new payload families |
| `app/routes.tsx`, `app/AppShell.tsx` | modified — four new routes and four new nav entries |

---

# Lot A — Shared foundations

### Task 1: Robust statistics primitives

Every one of the six features needs a centre and a scale that extreme values cannot drag around. Writing that six times would give six subtly different definitions. It is written once, here, in integer cents, with the published constants named and sourced.

**Files:**
- Create: `backend/app/engines/robust.py`
- Test: `backend/tests/test_robust.py`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `Spread` frozen dataclass with fields `median: int`, `mad: int`, `mean_ad: int`, `sigma: int`, `count: int`.
  - `median_cents(values: list[int]) -> int` — raises `ValueError` on an empty list.
  - `describe(values: list[int]) -> Spread` — raises `ValueError` on an empty list.
  - `modified_z(value: int, spread: Spread) -> float | None` — `None` when the sample has no scale at all.
  - `quantile_offset_cents(sigma: int, sigmas: float = P90_SIGMAS) -> int`.
  - Constants `OUTLIER_Z = 3.5`, `P90_SIGMAS = 1.281552`, `MAD_TO_SIGMA = 1.4826`, `MEAN_AD_TO_SIGMA = 1.2533`, `MODIFIED_Z_MAD_CONSTANT = 0.6745`, `MODIFIED_Z_MEAN_AD_CONSTANT = 1.253314`.
  - Tasks 4, 7, 10, 11, 15 and 16 all import from here. Phase 2B's Monte-Carlo and stress-test engines will too.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_robust.py`:

```python
import pytest

from app.engines.robust import (
    OUTLIER_Z,
    P90_SIGMAS,
    describe,
    median_cents,
    modified_z,
    quantile_offset_cents,
)


def test_median_of_an_odd_sample_is_the_middle_value():
    assert median_cents([300, 100, 200]) == 200


def test_median_of_an_even_sample_rounds_half_away_from_zero():
    """Cents are integers. 100.5 rounds to 101, and -100.5 to -101 -- never
    toward zero on one side and away on the other, which would bias a series of
    expenses upward and a series of incomes downward."""
    assert median_cents([100, 101]) == 101
    assert median_cents([-100, -101]) == -101


def test_median_of_an_empty_sample_is_an_error_not_a_zero():
    with pytest.raises(ValueError):
        median_cents([])


def test_describe_reports_median_mad_and_a_normal_equivalent_scale():
    spread = describe([1000, 1100, 1200, 1300, 1400])
    assert spread.count == 5
    assert spread.median == 1200
    # deviations: 200, 100, 0, 100, 200 -> median 100
    assert spread.mad == 100
    assert spread.mean_ad == 120
    assert spread.sigma == round(1.4826 * 100)


def test_an_extreme_value_does_not_move_the_centre():
    """The whole point of the median: one 500 EUR outlier must not redefine
    what a normal week costs."""
    normal = describe([1000, 1100, 1200, 1300, 1400])
    with_outlier = describe([1000, 1100, 1200, 1300, 1400, 50000])
    assert with_outlier.median == 1250
    assert abs(with_outlier.median - normal.median) < 100


def test_modified_z_flags_a_clear_outlier():
    values = [1000, 1050, 1100, 1150, 1200, 1100, 1050, 1150, 1100, 1000]
    spread = describe(values)
    assert modified_z(1100, spread) == pytest.approx(0.0, abs=0.5)
    assert modified_z(50000, spread) > OUTLIER_Z


def test_modified_z_falls_back_to_the_mean_deviation_when_the_mad_is_zero():
    """A subscription billed at exactly the same amount most months has a MAD of
    zero, and dividing by it would raise. Iglewicz & Hoaglin's own documented
    alternative is the mean absolute deviation with the 1.253314 constant --
    not an invented threshold."""
    values = [1549, 1549, 1549, 1549, 1549, 1549, 1549, 1549, 1549, 1999]
    spread = describe(values)
    assert spread.mad == 0
    assert spread.mean_ad > 0
    assert modified_z(1999, spread) > OUTLIER_Z


def test_modified_z_is_none_when_the_sample_never_moves():
    """Ten identical amounts carry no scale. No value can be called an outlier
    against them, and returning a number here would be inventing one."""
    spread = describe([1549] * 10)
    assert spread.mad == 0
    assert spread.mean_ad == 0
    assert modified_z(9999, spread) is None


def test_quantile_offset_is_an_integer_number_of_cents():
    offset = quantile_offset_cents(10000)
    assert isinstance(offset, int)
    assert offset == round(10000 * P90_SIGMAS)
```

- [ ] **Step 2: Run the test to verify it fails**

Run from `backend/`: `.venv/Scripts/pytest.exe tests/test_robust.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.engines.robust'`

- [ ] **Step 3: Write the implementation**

Create `backend/app/engines/robust.py`:

```python
"""Robust centre and scale, in integer cents.

Every "statistical deviation" in Yieldo goes through this module. The design
brief is explicit that the method must be robust -- median and median absolute
deviation -- so that a single 500 EUR purchase does not redefine what a normal
week costs, and that there are to be no arbitrary thresholds.

The constants below are therefore not tuned; they are the published ones:

* the modified z-score and its 0.6745 / 1.253314 constants, and the 3.5 cutoff,
  are Iglewicz & Hoaglin, *How to Detect and Handle Outliers* (ASQC Basic
  References in Quality Control, vol. 16, 1993);
* 1.4826 is the standard consistency factor making the MAD an unbiased
  estimator of the standard deviation under normality, and 1.2533 the same
  factor for the mean absolute deviation;
* 1.281552 is the standard normal 90th percentile, used to turn a scale into a
  P10/P90 band.

Pure: no session, no network, no clock.
"""

from dataclasses import dataclass

# Modified z-score, Iglewicz & Hoaglin. The MAD form is the primary one; the
# mean-absolute-deviation form is their documented fallback for samples whose
# MAD is zero -- which is the normal case for a subscription billed at the
# same amount every month.
MODIFIED_Z_MAD_CONSTANT = 0.6745
MODIFIED_Z_MEAN_AD_CONSTANT = 1.253314

# A value beyond this is an outlier. Their recommendation, not a tuned knob.
OUTLIER_Z = 3.5

# Consistency factors turning a robust dispersion into a normal-equivalent
# standard deviation.
MAD_TO_SIGMA = 1.4826
MEAN_AD_TO_SIGMA = 1.2533

# Standard normal 90th percentile: sigma * this is the half-width of a P10/P90
# band around the median.
P90_SIGMAS = 1.281552


def _half(total: int) -> int:
    """`total / 2`, rounded half away from zero, staying in integer cents.

    Floor division would bias a series of expenses (all negative) one way and a
    series of incomes the other, which is exactly the kind of silent asymmetry
    the money rule exists to prevent.
    """
    quotient, remainder = divmod(abs(total), 2)
    magnitude = quotient + remainder
    return magnitude if total >= 0 else -magnitude


def median_cents(values: list[int]) -> int:
    """The median of a sample of integer cents.

    Raises rather than returning zero on an empty sample: "no data" and "zero
    euros" are different answers, and a fallback value standing in for real
    data is precisely what the no-silent-failures rule forbids.
    """
    if not values:
        raise ValueError("La médiane d'une série vide n'existe pas")
    ordered = sorted(values)
    middle = len(ordered) // 2
    if len(ordered) % 2 == 1:
        return ordered[middle]
    return _half(ordered[middle - 1] + ordered[middle])


def _mean_absolute(deviations: list[int]) -> int:
    """Mean of non-negative deviations, rounded half up, in integer cents."""
    count = len(deviations)
    return (sum(deviations) * 2 + count) // (2 * count)


@dataclass(frozen=True)
class Spread:
    """A robust centre and scale. Every field is in the unit of the input."""

    median: int
    mad: int
    mean_ad: int
    # Normal-equivalent standard deviation. 0 means the sample never moves --
    # not "we could not measure it", which is what `count` is for.
    sigma: int
    count: int


def describe(values: list[int]) -> Spread:
    if not values:
        raise ValueError("Impossible de décrire une série vide")
    centre = median_cents(values)
    deviations = [abs(value - centre) for value in values]
    mad = median_cents(deviations)
    mean_ad = _mean_absolute(deviations)
    if mad:
        sigma = round(MAD_TO_SIGMA * mad)
    elif mean_ad:
        sigma = round(MEAN_AD_TO_SIGMA * mean_ad)
    else:
        sigma = 0
    return Spread(median=centre, mad=mad, mean_ad=mean_ad, sigma=sigma, count=len(values))


def modified_z(value: int, spread: Spread) -> float | None:
    """How far `value` sits from the sample's centre, in robust deviations.

    `None` when the sample carries no dispersion at all: with every observation
    identical there is no scale to measure against, and any number returned
    here would be manufactured. Callers must treat `None` as "cannot say",
    never as zero.
    """
    if spread.mad:
        return MODIFIED_Z_MAD_CONSTANT * (value - spread.median) / spread.mad
    if spread.mean_ad:
        return (value - spread.median) / (MODIFIED_Z_MEAN_AD_CONSTANT * spread.mean_ad)
    return None


def quantile_offset_cents(sigma: int, sigmas: float = P90_SIGMAS) -> int:
    """Half-width, in integer cents, of a band `sigmas` standard deviations wide."""
    return round(sigma * sigmas)
```

- [ ] **Step 4: Run the test to verify it passes**

Run from `backend/`: `.venv/Scripts/pytest.exe tests/test_robust.py -v`
Expected: PASS, 9 tests.

- [ ] **Step 5: Run the whole backend suite**

Run from `backend/`: `.venv/Scripts/pytest.exe -q`
Expected: 271 passed (262 + 9).

- [ ] **Step 6: Commit**

```bash
git add backend/app/engines/robust.py backend/tests/test_robust.py
git commit -m "feat(engines): add robust median and MAD primitives in integer cents"
```

---

### Task 2: Shared route helpers

`api/analytics.py` holds two private helpers — `_points` and `_period` — that every router in this phase needs, plus two new ones this phase introduces. They move to a module of their own so four new routers do not each grow their own copy of the `user_id` filter. The existing 262 tests are the guard: this task adds behaviour but must not change any.

**Files:**
- Create: `backend/app/api/common.py`
- Create: `backend/app/engines/recurrence.py` (input dataclass only — task 7 adds the algorithm)
- Create: `backend/app/engines/anomaly.py` (input dataclass only — task 16 adds the algorithm)
- Modify: `backend/app/api/analytics.py` (replace `_points` / `_period` with imports; update the call sites)
- Test: `backend/tests/test_api_common.py`

**Interfaces:**
- Consumes: `app.engines.aggregate.TxPoint`, `app.engines.period.resolve_range`, `app.api.history.user_history`, `app.importers.dedup.normalize_label`.
- Produces:
  - `period_range(db, user_id, date_from, date_to) -> tuple[date, date, HistoryOut | None]` — reads `date.today()` here, at the route boundary, and hands it to the pure engine.
  - `tx_points(db, user_id, date_from, date_to, account_id=None) -> list[TxPoint]`
  - `recurrence_points(db, user_id) -> list[RecurringTx]` — the whole ledger, non-transfer rows only, `label_key` recomputed from `label_raw`.
  - `anomaly_points(db, user_id) -> list[AnomalyTx]` — the whole ledger, non-transfer rows only, carrying the transaction id and label.
  - `liquid_balance_cents(db, user_id) -> int`
  - `LIQUID_ACCOUNT_KINDS = ("checking", "savings", "cash")`
  - `RecurringTx(on: date, amount_cents: int, label_key: str, label_raw: str, category_id: int | None)`
  - `AnomalyTx(id: int, on: date, amount_cents: int, label: str, category_id: int | None)`
  - Tasks 5, 8, 12 and 17 all import from here.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_api_common.py`:

```python
from datetime import date

from app.api.common import (
    LIQUID_ACCOUNT_KINDS,
    anomaly_points,
    liquid_balance_cents,
    period_range,
    recurrence_points,
    tx_points,
)
from app.models import Account, Category, Transaction, User
from app.security.passwords import hash_password


def _user(db, email: str) -> User:
    user = User(email=email, name="T", password_hash=hash_password("motdepasse123"),
                role="user", is_active=True)
    db.add(user)
    db.flush()
    return user


def _account(db, user: User, kind: str = "checking", opening: int = 0) -> Account:
    account = Account(user_id=user.id, name=kind, kind=kind, currency="EUR",
                      opening_balance_cents=opening, include_in_net_worth=True,
                      archived=False)
    db.add(account)
    db.flush()
    return account


def _tx(db, user, account, on, amount, label="CARTE X1234 CARREFOUR 12/03",
        is_transfer=False, category_id=None):
    row = Transaction(user_id=user.id, account_id=account.id, date=on,
                      amount_cents=amount, label_raw=label, label_clean=label.lower(),
                      category_id=category_id, category_source="uncategorized",
                      is_transfer=is_transfer, dedup_hash=f"{on}{amount}{label}",
                      tags=[])
    db.add(row)
    db.flush()
    return row


def test_recurrence_points_recompute_the_label_key_from_the_raw_label(db):
    """label_clean is whatever was stored -- the verification fixture writes a
    bare lowercase, the importer writes a normalised form. The grouping key is
    recomputed so two rows differing only by an embedded date group together."""
    user = _user(db, "a@example.com")
    account = _account(db, user)
    _tx(db, user, account, date(2025, 1, 10), -1549, "PRELEVEMENT SEPA NETFLIX 10/01")
    _tx(db, user, account, date(2025, 2, 10), -1549, "PRELEVEMENT SEPA NETFLIX 10/02")
    db.commit()

    points = recurrence_points(db, user.id)
    assert len({point.label_key for point in points}) == 1


def test_recurrence_points_exclude_internal_transfers(db):
    user = _user(db, "b@example.com")
    account = _account(db, user)
    _tx(db, user, account, date(2025, 1, 10), -1549, "NETFLIX")
    _tx(db, user, account, date(2025, 1, 11), -50000, "VIREMENT LIVRET", is_transfer=True)
    db.commit()

    assert len(recurrence_points(db, user.id)) == 1


def test_recurrence_points_never_cross_users(db):
    mine = _user(db, "mine@example.com")
    theirs = _user(db, "theirs@example.com")
    _tx(db, mine, _account(db, mine), date(2025, 1, 10), -1549, "NETFLIX")
    _tx(db, theirs, _account(db, theirs), date(2025, 1, 10), -9999, "AUTRE")
    db.commit()

    points = recurrence_points(db, mine.id)
    assert [point.amount_cents for point in points] == [-1549]


def test_anomaly_points_carry_the_transaction_id_and_label(db):
    user = _user(db, "c@example.com")
    account = _account(db, user)
    category = Category(user_id=user.id, name="Courses", slug="courses", kind="expense")
    db.add(category)
    db.flush()
    row = _tx(db, user, account, date(2025, 1, 10), -4200, "LECLERC",
              category_id=category.id)
    db.commit()

    points = anomaly_points(db, user.id)
    assert points[0].id == row.id
    assert points[0].label == "LECLERC"
    assert points[0].category_id == category.id


def test_liquid_balance_sums_opening_balances_and_every_movement(db):
    user = _user(db, "d@example.com")
    account = _account(db, user, "checking", opening=100_000)
    _tx(db, user, account, date(2025, 1, 10), -4200, "LECLERC")
    _tx(db, user, account, date(2025, 1, 20), 250_000, "SALAIRE")
    db.commit()

    assert liquid_balance_cents(db, user.id) == 100_000 - 4_200 + 250_000


def test_liquid_balance_ignores_illiquid_and_archived_accounts(db):
    user = _user(db, "e@example.com")
    _account(db, user, "checking", opening=100_000)
    pea = _account(db, user, "pea", opening=900_000)
    assert pea.kind not in LIQUID_ACCOUNT_KINDS
    archived = _account(db, user, "savings", opening=700_000)
    archived.archived = True
    db.commit()

    assert liquid_balance_cents(db, user.id) == 100_000


def test_period_range_still_answers_an_absent_bound_with_the_whole_history(db):
    user = _user(db, "f@example.com")
    account = _account(db, user)
    _tx(db, user, account, date(2025, 1, 24), -1000, "A")
    _tx(db, user, account, date(2026, 1, 9), -1000, "B")
    db.commit()

    start, end, history = period_range(db, user.id, None, None)
    assert (start, end) == (date(2025, 1, 24), date(2026, 1, 9))
    assert history is not None and history.transaction_count == 2


def test_tx_points_are_the_engine_shape_not_orm_rows(db):
    user = _user(db, "g@example.com")
    account = _account(db, user)
    _tx(db, user, account, date(2025, 1, 24), -1000, "A")
    db.commit()

    points = tx_points(db, user.id, date(2025, 1, 1), date(2025, 12, 31))
    assert [type(point).__name__ for point in points] == ["TxPoint"]
```

- [ ] **Step 2: Run the test to verify it fails**

Run from `backend/`: `.venv/Scripts/pytest.exe tests/test_api_common.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.api.common'`

- [ ] **Step 3: Create the two engine input shapes**

Create `backend/app/engines/recurrence.py`:

```python
"""Recurrence detection. Pure: no session, no network, no implicit clock."""

from dataclasses import dataclass
from datetime import date


@dataclass(frozen=True)
class RecurringTx:
    """The minimal shape recurrence detection needs. Deliberately not an ORM object.

    `label_key` is the normalised grouping key, computed by the caller from
    `label_raw` -- never read from the stored `label_clean`, whose contents
    depend on which importer version wrote the row.
    """

    on: date
    amount_cents: int
    label_key: str
    label_raw: str
    category_id: int | None
```

Create `backend/app/engines/anomaly.py`:

```python
"""Robust anomaly detection. Pure: no session, no network, no implicit clock."""

from dataclasses import dataclass
from datetime import date


@dataclass(frozen=True)
class AnomalyTx:
    """One transaction, as the anomaly scorer needs it."""

    id: int
    on: date
    amount_cents: int
    label: str
    category_id: int | None
```

- [ ] **Step 4: Write `api/common.py`**

Create `backend/app/api/common.py`:

```python
"""Fetch helpers shared by every analytics-shaped router.

Two rules hold in every function here, without exception:

* every query filters on `user_id`. There is no read path without it;
* the clock is read *here*, at the route boundary, and passed into the engines
  as a parameter. No engine imports `date.today`.

The engines never see an ORM object: each helper converts rows into the frozen
dataclass its engine declares.
"""

from datetime import date

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.history import user_history
from app.engines.aggregate import TxPoint
from app.engines.anomaly import AnomalyTx
from app.engines.period import resolve_range
from app.engines.recurrence import RecurringTx
from app.importers.dedup import normalize_label
from app.models import Account, Transaction
from app.schemas.history import HistoryOut

# What "the money you could actually spend next month" is made of. A PEA or a
# life-insurance contract is wealth, not runway: selling it is a decision, not a
# withdrawal, and counting it here would tell someone they can survive eleven
# months when they can survive two.
LIQUID_ACCOUNT_KINDS = ("checking", "savings", "cash")


def period_range(
    db: Session, user_id: int, date_from: date | None, date_to: date | None
) -> tuple[date, date, HistoryOut | None]:
    """The range this request actually covers, plus the user's whole ledger span.

    An absent bound means all of *this user's* data, not the current calendar
    year. `date.today()` is read here and handed to `resolve_range` as a
    parameter, so the engine stays pure and testable at any date.
    """
    history = user_history(db, user_id)
    start, end = resolve_range(
        date_from,
        date_to,
        history.date_from if history else None,
        history.date_to if history else None,
        date.today(),
    )
    return start, end, history


def tx_points(
    db: Session,
    user_id: int,
    date_from: date | None,
    date_to: date | None,
    account_id: int | None = None,
) -> list[TxPoint]:
    """This user's transactions in the aggregation engine's input shape."""
    query = db.query(Transaction).filter(Transaction.user_id == user_id)
    if date_from is not None:
        query = query.filter(Transaction.date >= date_from)
    if date_to is not None:
        query = query.filter(Transaction.date <= date_to)
    if account_id is not None:
        query = query.filter(Transaction.account_id == account_id)
    return [
        TxPoint(on=t.date, amount_cents=t.amount_cents, category_id=t.category_id,
                account_id=t.account_id, is_transfer=t.is_transfer)
        for t in query.all()
    ]


def recurrence_points(db: Session, user_id: int) -> list[RecurringTx]:
    """The whole ledger, keyed for recurrence grouping.

    Always the whole ledger, never a period: a monthly charge cannot be
    recognised from one month of statements, and a period-scoped detection
    would report a different set of subscriptions on every date filter.

    Internal transfers are excluded -- a standing order to a savings account is
    regular by construction and is not a subscription.

    The key is recomputed from `label_raw` rather than read from `label_clean`:
    what is stored there depends on which importer version wrote the row (the
    phase 1.5 verification fixture writes a bare lowercase), and a grouping key
    that changes with the writer would silently split one subscription in two.
    """
    rows = (
        db.query(Transaction)
        .filter(Transaction.user_id == user_id, Transaction.is_transfer.is_(False))
        .order_by(Transaction.date)
        .all()
    )
    return [
        RecurringTx(
            on=row.date,
            amount_cents=row.amount_cents,
            label_key=normalize_label(row.label_raw),
            label_raw=row.label_raw,
            category_id=row.category_id,
        )
        for row in rows
    ]


def anomaly_points(db: Session, user_id: int) -> list[AnomalyTx]:
    """The whole ledger, for scoring against each category's own history.

    Always the whole ledger for the same reason as above: an amount is unusual
    relative to everything the user has ever spent in that category, not
    relative to the fortnight currently on screen. The *reported* window is
    narrowed by the engine, not by this query.
    """
    rows = (
        db.query(Transaction)
        .filter(Transaction.user_id == user_id, Transaction.is_transfer.is_(False))
        .order_by(Transaction.date)
        .all()
    )
    return [
        AnomalyTx(id=row.id, on=row.date, amount_cents=row.amount_cents,
                  label=row.label_raw, category_id=row.category_id)
        for row in rows
    ]


def liquid_balance_cents(db: Session, user_id: int) -> int:
    """Opening balances plus every movement, over this user's liquid accounts.

    Transfers are counted here, unlike everywhere else: moving money between two
    of the user's own accounts is not spending, but it does change what sits in
    each of them, and this figure is a balance rather than a flow.
    """
    account_ids = [
        row.id
        for row in db.query(Account.id)
        .filter(
            Account.user_id == user_id,
            Account.kind.in_(LIQUID_ACCOUNT_KINDS),
            Account.archived.is_(False),
        )
        .all()
    ]
    if not account_ids:
        return 0

    opening = (
        db.query(func.coalesce(func.sum(Account.opening_balance_cents), 0))
        .filter(Account.user_id == user_id, Account.id.in_(account_ids))
        .scalar()
    )
    movements = (
        db.query(func.coalesce(func.sum(Transaction.amount_cents), 0))
        .filter(Transaction.user_id == user_id, Transaction.account_id.in_(account_ids))
        .scalar()
    )
    return int(opening) + int(movements)
```

- [ ] **Step 5: Point `analytics.py` at the shared helpers**

In `backend/app/api/analytics.py`:

1. Delete the `_points` and `_period` function definitions entirely.
2. Delete the imports they alone needed: `from app.api.history import user_history`, `from app.engines.period import resolve_range`, `Transaction` from the models import, and `TxPoint` from the aggregate import.
3. Add `from app.api.common import period_range, tx_points`.
4. Rename the call sites. `_points(` → `tx_points(` at **four** sites: inside `series`, inside `categories_breakdown`, inside `_period_totals`, and inside `calendar_heatmap`. `_period(` → `period_range(` at **four** sites: `series`, `categories_breakdown`, `summary`, `calendar_heatmap`.

- [ ] **Step 6: Run the tests to verify they pass**

Run from `backend/`: `.venv/Scripts/pytest.exe tests/test_api_common.py tests/test_analytics_api.py -v`
Expected: PASS. `test_analytics_api.py` must be **unchanged** and still green — it is the guard that the extraction changed no behaviour.

- [ ] **Step 7: Run the whole backend suite**

Run from `backend/`: `.venv/Scripts/pytest.exe -q`
Expected: 279 passed (271 + 8).

- [ ] **Step 8: Commit**

```bash
git add backend/app/api/common.py backend/app/api/analytics.py backend/app/engines/recurrence.py backend/app/engines/anomaly.py backend/tests/test_api_common.py
git commit -m "refactor(api): extract the shared user-filtered fetch helpers into api/common"
```

---

### Task 3: Schema groundwork — essential categories and the optional price index

Two schema changes, one migration. `categories.is_essential` is what makes the runway's "reduced to essentials" scenario a real measurement rather than a guess. `price_index_points` is where a user-supplied INSEE series lives; the app still makes no outbound call.

**Files:**
- Modify: `backend/app/models/category.py`
- Create: `backend/app/models/price_index.py`
- Modify: `backend/app/models/__init__.py`
- Modify: `backend/app/categorization/seed.py`
- Modify: `backend/app/schemas/transactions.py`
- Create: `backend/alembic/versions/c3f81a20d5e4_essential_categories_and_price_index.py`
- Modify: `frontend/src/lib/types.ts`
- Test: `backend/tests/test_essentials_and_price_index.py`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `Category.is_essential: bool` (non-null, default `False`), on `CategoryOut`, settable through `CategoryIn` and `CategoryPatch`.
  - `app.categorization.seed.ESSENTIAL_SLUGS: frozenset[str]` — used by both `seed_categories` and the migration, so a new user and an existing one get the same defaults.
  - `PriceIndexPoint` model: `user_id`, `month: date` (always the 1st), `value_hundredths: int`, unique on `(user_id, month)`.
  - Frontend `Category.is_essential: boolean`.
  - Tasks 10 and 12 read `is_essential`; tasks 15 and 17 read `PriceIndexPoint`; task 6's screen writes `is_essential`.
- Note: `value_hundredths` is an index level (118.42 → `11842`), **not** money. The integer keeps it exact without pretending it is a number of cents.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_essentials_and_price_index.py`:

```python
from datetime import date

import pytest
from sqlalchemy.exc import IntegrityError

from app.categorization.seed import ESSENTIAL_SLUGS, seed_categories
from app.models import Category, PriceIndexPoint, User
from app.security.passwords import hash_password


def _user(db, email: str = "e@example.com") -> User:
    user = User(email=email, name="T", password_hash=hash_password("motdepasse123"),
                role="user", is_active=True)
    db.add(user)
    db.flush()
    return user


def test_a_fresh_category_is_not_essential_until_it_is_said_to_be(db):
    user = _user(db)
    category = Category(user_id=user.id, name="Loisirs", slug="loisirs", kind="expense")
    db.add(category)
    db.commit()
    assert category.is_essential is False


def test_the_seed_marks_the_french_household_necessities_essential(db):
    user = _user(db)
    seed_categories(db, user.id)
    db.commit()

    by_slug = {c.slug: c for c in db.query(Category).filter(Category.user_id == user.id)}
    assert by_slug["logement-loyer"].is_essential is True
    assert by_slug["alimentation-courses"].is_essential is True
    assert by_slug["sante-pharmacie"].is_essential is True
    # Not essential: what a household cuts first when income stops.
    assert by_slug["loisirs-vacances"].is_essential is False
    assert by_slug["abonnements-streaming"].is_essential is False
    assert by_slug["alimentation-restaurant"].is_essential is False


def test_every_essential_slug_exists_in_the_seed_tree(db):
    """A typo in ESSENTIAL_SLUGS would silently mark nothing and quietly halve
    the reduced-spending runway."""
    user = _user(db)
    seed_categories(db, user.id)
    db.commit()
    known = {c.slug for c in db.query(Category).filter(Category.user_id == user.id)}
    assert ESSENTIAL_SLUGS <= known


def test_a_price_index_point_is_unique_per_user_and_month(db):
    user = _user(db)
    db.add(PriceIndexPoint(user_id=user.id, month=date(2025, 1, 1), value_hundredths=11842))
    db.commit()
    db.add(PriceIndexPoint(user_id=user.id, month=date(2025, 1, 1), value_hundredths=11900))
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()


def test_two_users_may_hold_the_same_month(db):
    first = _user(db, "a@example.com")
    second = _user(db, "b@example.com")
    db.add(PriceIndexPoint(user_id=first.id, month=date(2025, 1, 1), value_hundredths=11842))
    db.add(PriceIndexPoint(user_id=second.id, month=date(2025, 1, 1), value_hundredths=11842))
    db.commit()
    assert db.query(PriceIndexPoint).count() == 2


def test_the_categories_api_round_trips_is_essential(client, imported):
    headers, _ = imported
    categories = client.get("/api/categories", headers=headers).json()
    target = next(c for c in categories if c["slug"] == "loisirs-vacances")
    assert target["is_essential"] is False

    patched = client.patch(f"/api/categories/{target['id']}", headers=headers,
                           json={"is_essential": True}).json()
    assert patched["is_essential"] is True
```

- [ ] **Step 2: Run the test to verify it fails**

Run from `backend/`: `.venv/Scripts/pytest.exe tests/test_essentials_and_price_index.py -v`
Expected: FAIL — `ImportError: cannot import name 'ESSENTIAL_SLUGS'`

- [ ] **Step 3: Add the column and the model**

In `backend/app/models/category.py`, add `Boolean` to the `sqlalchemy` import and this column after `monthly_budget_cents`:

```python
    # What the household still pays when income stops -- rent, food, energy,
    # health, insurance, tax. It is what makes the runway's reduced scenario a
    # measurement of the user's own ledger rather than a guessed percentage.
    # Editable: only the user knows whether their gym membership is optional.
    is_essential: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
```

Create `backend/app/models/price_index.py`:

```python
from datetime import date

from sqlalchemy import Date, ForeignKey, Integer, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class PriceIndexPoint(Base):
    """One month of a user-supplied reference price index (e.g. INSEE's IPC).

    Yieldo makes no outbound call by default, so this series is never fetched:
    the user pastes it in on the Analyse screen, or leaves it empty and the
    comparison column simply reads "—". Nothing here is ever invented.

    `value_hundredths` is an index level, not money: 118.42 is stored as 11842.
    An integer keeps it exact without pretending it is a number of cents.
    """

    __tablename__ = "price_index_points"
    __table_args__ = (
        UniqueConstraint("user_id", "month", name="uq_price_index_user_month"),
    )

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    # Always the first day of the month it stands for.
    month: Mapped[date] = mapped_column(Date, nullable=False)
    value_hundredths: Mapped[int] = mapped_column(Integer, nullable=False)
```

In `backend/app/models/__init__.py`, add `from app.models.price_index import PriceIndexPoint` and `"PriceIndexPoint"` to `__all__`.

- [ ] **Step 4: Add the essential slug list and apply it in the seed**

In `backend/app/categorization/seed.py`, above `seed_categories`:

```python
# The French household floor: what still gets paid when income stops. Deliberately
# excludes restaurants, delivery, streaming, sport, holidays, hobbies, clothing,
# gifts and equipment -- the reduced-spending scenario is meant to be austere, and
# a reader who disagrees can change any of these on the Budgets screen.
ESSENTIAL_SLUGS: frozenset[str] = frozenset({
    "logement-loyer",
    "logement-credit",
    "logement-charges",
    "logement-energie",
    "logement-internet",
    "logement-assurance",
    "alimentation-courses",
    "transport-carburant",
    "transport-assurance",
    "transport-commun",
    "sante-medecin",
    "sante-pharmacie",
    "sante-mutuelle",
    "famille-garde",
    "famille-scolarite",
    "impots-revenu",
    "impots-fonciere",
    "impots-habitation",
    "impots-autres",
    "frais-tenue",
    "frais-carte",
})
```

In `seed_categories`, at the parent `Category(...)` call add `is_essential=slug in ESSENTIAL_SLUGS`, and at the child call add `is_essential=child_slug in ESSENTIAL_SLUGS`. Existing categories are left untouched — `seed_categories` is documented as safe to call twice and must not overwrite a user's own choice.

- [ ] **Step 5: Expose it on the schemas**

In `backend/app/schemas/transactions.py`: add `is_essential: bool` to `CategoryOut`, `is_essential: bool = False` to `CategoryIn`, `is_essential: bool | None = None` to `CategoryPatch`.

In `frontend/src/lib/types.ts`, add `is_essential: boolean;` to the `Category` interface.

- [ ] **Step 6: Write the migration**

Create `backend/alembic/versions/c3f81a20d5e4_essential_categories_and_price_index.py`:

```python
"""essential categories and price index

Revision ID: c3f81a20d5e4
Revises: a7b67772495a
Create Date: 2026-08-16 10:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

from app.categorization.seed import ESSENTIAL_SLUGS

revision: str = 'c3f81a20d5e4'
down_revision: Union[str, Sequence[str], None] = 'a7b67772495a'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # server_default is required: SQLite cannot add a NOT NULL column without one,
    # and it stays in place afterwards because SQLite cannot drop a default either.
    # Harmless -- the ORM always supplies the value on insert.
    op.add_column(
        "categories",
        sa.Column("is_essential", sa.Boolean(), nullable=False,
                  server_default=sa.false()),
    )
    # An existing user's seeded tree gets the same defaults a new user's does.
    # A user who renamed or deleted a category simply has fewer rows matched;
    # nothing is created here.
    categories = sa.table("categories", sa.column("slug", sa.String),
                          sa.column("is_essential", sa.Boolean))
    op.execute(
        categories.update()
        .where(categories.c.slug.in_(sorted(ESSENTIAL_SLUGS)))
        .values(is_essential=True)
    )

    op.create_table(
        "price_index_points",
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("month", sa.Date(), nullable=False),
        sa.Column("value_hundredths", sa.Integer(), nullable=False),
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "month", name="uq_price_index_user_month"),
    )
    op.create_index(op.f("ix_price_index_points_user_id"), "price_index_points",
                    ["user_id"], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f("ix_price_index_points_user_id"), table_name="price_index_points")
    op.drop_table("price_index_points")
    op.drop_column("categories", "is_essential")
```

- [ ] **Step 7: Run the tests to verify they pass**

Run from `backend/`: `.venv/Scripts/pytest.exe tests/test_essentials_and_price_index.py -v`
Expected: PASS, 6 tests.

- [ ] **Step 8: Verify the migration applies to a real database**

Run from `backend/`:

```bash
.venv/Scripts/python.exe ../.superpowers/sdd/2026-08-12-yieldo-phase-1-5-interface/seed_fixture.py
.venv/Scripts/alembic.exe stamp a7b67772495a
.venv/Scripts/alembic.exe upgrade head
.venv/Scripts/python.exe -c "import sqlite3;c=sqlite3.connect('data/yieldo.db');print(c.execute('select count(*) from categories where is_essential=1').fetchone())"
```

Expected: the upgrade runs clean and the count is `(21,)`.

Then re-seed so later tasks start from the canonical fixture (the seed now sets `is_essential` itself):

```bash
.venv/Scripts/python.exe ../.superpowers/sdd/2026-08-12-yieldo-phase-1-5-interface/seed_fixture.py
```

- [ ] **Step 9: Run both suites**

Run from `backend/`: `.venv/Scripts/pytest.exe -q` → 285 passed.
Run from `frontend/`: `npm test` → 389 passed, then `npm run build` → zero TypeScript errors.

- [ ] **Step 10: Commit**

```bash
git add backend/app/models backend/app/categorization/seed.py backend/app/schemas/transactions.py backend/alembic/versions/c3f81a20d5e4_essential_categories_and_price_index.py backend/tests/test_essentials_and_price_index.py frontend/src/lib/types.ts
git commit -m "feat(models): add essential categories and a user-supplied price index"
```

---

# Lot B — Budgets par catégorie

The `categories` table already carries `monthly_budget_cents`, unused since phase 1. Nothing new is stored; what is missing is the consumption calculation, the pace alert, and a screen on which to set the figure.

### Task 4: Budget engine

**Files:**
- Create: `backend/app/engines/budget.py`
- Test: `backend/tests/test_budget.py`

**Interfaces:**
- Consumes: nothing (deliberately — a budget is declared by the user, not inferred, so this engine needs no statistics).
- Produces:
  - `BudgetEntry(category_id: int, budget_cents: int, spent_cents: int)` — `budget_cents` positive (a ceiling), `spent_cents` negative (an outflow, the codebase convention everywhere else).
  - `BudgetLine(category_id: int, budget_cents: int, spent_cents: int, remaining_cents: int, consumed_ratio: float, projected_cents: int | None, status: BudgetStatus)`.
  - `BudgetStatus = Literal["ok", "at_risk", "over"]`.
  - `days_in_month(month_start: date) -> int`
  - `elapsed_days(month_start: date, today: date) -> int`
  - `evaluate_budgets(entries: list[BudgetEntry], month_start: date, today: date) -> list[BudgetLine]`
  - Task 5 consumes all of it.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_budget.py`:

```python
from datetime import date

import pytest

from app.engines.budget import (
    BudgetEntry,
    days_in_month,
    elapsed_days,
    evaluate_budgets,
)

# 300 EUR of groceries a month.
BUDGET = 30_000


def _line(spent_cents: int, today: date, month_start: date = date(2026, 1, 1)):
    entries = [BudgetEntry(category_id=1, budget_cents=BUDGET, spent_cents=spent_cents)]
    return evaluate_budgets(entries, month_start, today)[0]


def test_days_in_month_handles_a_leap_february():
    assert days_in_month(date(2024, 2, 1)) == 29
    assert days_in_month(date(2026, 2, 1)) == 28


def test_elapsed_days_counts_today_and_never_exceeds_the_month():
    assert elapsed_days(date(2026, 1, 1), date(2026, 1, 1)) == 1
    assert elapsed_days(date(2026, 1, 1), date(2026, 1, 15)) == 15
    # A month long finished is fully elapsed, not 220 days elapsed.
    assert elapsed_days(date(2026, 1, 1), date(2026, 8, 12)) == 31
    # A month not yet started has nothing elapsed.
    assert elapsed_days(date(2026, 9, 1), date(2026, 8, 12)) == 0


def test_a_finished_month_under_budget_is_ok_and_projects_nothing():
    """A month that is over does not need projecting: it *is* its own result."""
    line = _line(-25_000, date(2026, 8, 12))
    assert line.status == "ok"
    assert line.remaining_cents == 5_000
    assert line.projected_cents is None
    assert line.consumed_ratio == pytest.approx(25_000 / 30_000)


def test_spending_past_the_budget_is_over_and_remaining_goes_negative():
    line = _line(-34_500, date(2026, 8, 12))
    assert line.status == "over"
    assert line.remaining_cents == -4_500


def test_a_month_on_pace_to_overrun_is_at_risk_before_it_overruns():
    """Half of January gone, 20 000 spent of a 30 000 budget: still under, but
    the month lands at 40 000. Saying "ok" here is the alert arriving too late."""
    line = _line(-20_000, date(2026, 1, 15))
    assert line.status == "at_risk"
    assert line.projected_cents == -(20_000 * 31 // 15)
    assert line.remaining_cents == 10_000


def test_a_month_on_pace_to_land_inside_the_budget_is_ok():
    line = _line(-10_000, date(2026, 1, 15))
    assert line.status == "ok"
    assert line.projected_cents == -(10_000 * 31 // 15)


def test_two_days_into_the_month_no_pace_is_claimed():
    """One grocery run on the 2nd projects to a fifteen-fold overrun. Below a
    fifth of the month, the projection is not made at all rather than made
    badly -- and no "at_risk" is raised on the strength of it."""
    line = _line(-8_000, date(2026, 1, 2))
    assert line.projected_cents is None
    assert line.status == "ok"


def test_the_pace_floor_is_exactly_one_fifth_of_the_month():
    # 31-day month: 6 days elapsed is 6*5 = 30 < 31, still too early; 7 is enough.
    assert _line(-20_000, date(2026, 1, 6)).projected_cents is None
    assert _line(-20_000, date(2026, 1, 7)).projected_cents is not None


def test_a_month_not_yet_started_projects_nothing():
    line = _line(0, date(2026, 8, 12), month_start=date(2026, 9, 1))
    assert line.projected_cents is None
    assert line.status == "ok"


def test_overspending_wins_over_pace():
    """Already past the ceiling on the 15th: "over" is the fact, "at_risk" would
    be a softer word for the same thing."""
    line = _line(-31_000, date(2026, 1, 15))
    assert line.status == "over"


def test_a_budget_of_zero_is_rejected_rather_than_divided_by():
    with pytest.raises(ValueError):
        evaluate_budgets(
            [BudgetEntry(category_id=1, budget_cents=0, spent_cents=-100)],
            date(2026, 1, 1),
            date(2026, 1, 15),
        )


def test_lines_come_back_in_the_order_they_were_given():
    entries = [
        BudgetEntry(category_id=7, budget_cents=10_000, spent_cents=-1_000),
        BudgetEntry(category_id=3, budget_cents=10_000, spent_cents=-9_000),
    ]
    lines = evaluate_budgets(entries, date(2026, 1, 1), date(2026, 8, 12))
    assert [line.category_id for line in lines] == [7, 3]
```

- [ ] **Step 2: Run the test to verify it fails**

Run from `backend/`: `.venv/Scripts/pytest.exe tests/test_budget.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.engines.budget'`

- [ ] **Step 3: Write the implementation**

Create `backend/app/engines/budget.py`:

```python
"""Consumption of a declared monthly budget, and whether the month is on pace.

A budget is the one figure in this phase that is *declared* rather than
measured, so there is no statistics module here and no minimum sample: the user
said 300 EUR, and the only question is how much of it is gone.

Sign convention, unchanged from the rest of the codebase: an outflow is
negative. `budget_cents` and `remaining_cents` are the two exceptions and are
positive, because a ceiling is not a flow -- `remaining_cents` goes negative
only once the ceiling has actually been passed, which is the reading a user
expects.

Pure: no session, no network, no implicit clock -- `today` is a parameter.
"""

import calendar
from dataclasses import dataclass
from datetime import date
from typing import Literal

BudgetStatus = Literal["ok", "at_risk", "over"]

# A pace projection needs enough of the month behind it to mean anything: two
# days into January, one large grocery run projects to a fifteen-fold overrun
# and would raise an alert about nothing. A fifth of the month is the floor --
# seven days in a 31-day month.
PACE_MIN_ELAPSED_DENOMINATOR = 5


@dataclass(frozen=True)
class BudgetEntry:
    category_id: int
    # The ceiling the user set, positive.
    budget_cents: int
    # What went out of this category this month, negative.
    spent_cents: int


@dataclass(frozen=True)
class BudgetLine:
    category_id: int
    budget_cents: int
    spent_cents: int
    # Positive while under the ceiling, negative once past it.
    remaining_cents: int
    # A ratio, not money: 0.83 means 83 % of the budget is gone. Can exceed 1.
    consumed_ratio: float
    # Where the month lands at the current pace, negative like `spent_cents`.
    # None whenever a projection would be dishonest: too early in the month, or
    # the month is finished (it *is* its own result) or has not started.
    projected_cents: int | None
    status: BudgetStatus


def days_in_month(month_start: date) -> int:
    return calendar.monthrange(month_start.year, month_start.month)[1]


def elapsed_days(month_start: date, today: date) -> int:
    """How much of `month_start`'s month has been lived, counting today.

    Clamped at both ends: a month in the past is fully elapsed, a month in the
    future has nothing elapsed. Without the clamp, a January budget viewed in
    August would report 224 days elapsed and project a thirtieth of the truth.
    """
    total = days_in_month(month_start)
    if today < month_start:
        return 0
    return min((today - month_start).days + 1, total)


def evaluate_budget(entry: BudgetEntry, elapsed: int, total_days: int) -> BudgetLine:
    if entry.budget_cents <= 0:
        raise ValueError("Un budget mensuel doit être strictement positif")

    spent = abs(entry.spent_cents)
    remaining = entry.budget_cents - spent
    consumed = spent / entry.budget_cents

    projected: int | None = None
    if 0 < elapsed < total_days and elapsed * PACE_MIN_ELAPSED_DENOMINATOR >= total_days:
        # Integer arithmetic end to end -- the projection is an amount in cents
        # and never passes through a float.
        projected = -(spent * total_days // elapsed)

    if spent >= entry.budget_cents:
        status: BudgetStatus = "over"
    elif projected is not None and abs(projected) > entry.budget_cents:
        status = "at_risk"
    else:
        status = "ok"

    return BudgetLine(
        category_id=entry.category_id,
        budget_cents=entry.budget_cents,
        spent_cents=entry.spent_cents,
        remaining_cents=remaining,
        consumed_ratio=consumed,
        projected_cents=projected,
        status=status,
    )


def evaluate_budgets(
    entries: list[BudgetEntry], month_start: date, today: date
) -> list[BudgetLine]:
    """Every budget line for one month, in the order it was given."""
    total_days = days_in_month(month_start)
    elapsed = elapsed_days(month_start, today)
    return [evaluate_budget(entry, elapsed, total_days) for entry in entries]
```

- [ ] **Step 4: Run the test to verify it passes**

Run from `backend/`: `.venv/Scripts/pytest.exe tests/test_budget.py -v`
Expected: PASS, 12 tests.

- [ ] **Step 5: Run the whole backend suite and commit**

Run from `backend/`: `.venv/Scripts/pytest.exe -q` → 297 passed.

```bash
git add backend/app/engines/budget.py backend/tests/test_budget.py
git commit -m "feat(engines): add monthly budget consumption with a pace projection"
```

---

### Task 5: Budgets API

**Files:**
- Create: `backend/app/schemas/budgets.py`
- Create: `backend/app/api/budgets.py`
- Modify: `backend/app/main.py` (register the router)
- Test: `backend/tests/test_budgets_api.py`

**Interfaces:**
- Consumes: `app.engines.budget.{BudgetEntry, evaluate_budgets, days_in_month, elapsed_days}`, `app.engines.aggregate.aggregate_by_category`, `app.api.common.{period_range, tx_points}`, `app.api.history.user_history`.
- Produces:
  - `GET /api/budgets?month=YYYY-MM` → `BudgetReportOut`.
  - `BudgetReportOut{month: str, month_start: date, month_end: date, days_elapsed: int, days_in_month: int, is_current_month: bool, lines: list[BudgetLineOut], unbudgeted: list[UnbudgetedOut], total_budget_cents: int, total_spent_cents: int, history: HistoryOut | None}`
  - `BudgetLineOut{category_id, name, color, is_essential, budget_cents, spent_cents, remaining_cents, consumed_ratio, projected_cents, status}`
  - `UnbudgetedOut{category_id, name, color, spent_cents}`
  - Writing a budget reuses the existing `PATCH /api/categories/{id}` with `monthly_budget_cents`; no new write endpoint.
  - Task 6 consumes all of it.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_budgets_api.py`:

```python
def _category(client, headers, slug: str):
    categories = client.get("/api/categories", headers=headers).json()
    return next(c for c in categories if c["slug"] == slug)


def test_the_default_month_is_the_month_of_the_last_transaction(client, imported):
    """Not today's month. The operator's statements stop months before today, and
    defaulting to today would open this screen on a permanently empty month."""
    headers, _ = imported
    body = client.get("/api/budgets", headers=headers).json()
    history = client.get("/api/analytics/summary", headers=headers).json()["history"]
    assert body["month"] == history["date_to"][:7]


def test_a_category_with_no_budget_produces_no_line(client, imported):
    headers, _ = imported
    body = client.get("/api/budgets?month=2025-03", headers=headers).json()
    assert body["lines"] == []


def test_a_budget_set_through_the_categories_endpoint_shows_up(client, imported):
    headers, _ = imported
    carburant = _category(client, headers, "transport-carburant")
    client.patch(f"/api/categories/{carburant['id']}", headers=headers,
                 json={"monthly_budget_cents": 10_000})

    body = client.get("/api/budgets?month=2025-03", headers=headers).json()
    line = next(line for line in body["lines"] if line["category_id"] == carburant["id"])
    assert line["budget_cents"] == 10_000
    assert line["spent_cents"] < 0
    assert line["name"] == "Carburant"
    assert line["color"].startswith("#")
    assert line["status"] in {"ok", "at_risk", "over"}


def test_a_budgeted_category_with_no_spending_still_reports_a_line(client, imported):
    """Silence is a result: a 200 EUR budget with nothing spent is the best
    possible month, and dropping the row would hide it."""
    headers, _ = imported
    vacances = _category(client, headers, "loisirs-vacances")
    client.patch(f"/api/categories/{vacances['id']}", headers=headers,
                 json={"monthly_budget_cents": 20_000})

    body = client.get("/api/budgets?month=2025-03", headers=headers).json()
    line = next(line for line in body["lines"] if line["category_id"] == vacances["id"])
    assert line["spent_cents"] == 0
    assert line["remaining_cents"] == 20_000
    assert line["status"] == "ok"


def test_unbudgeted_lists_what_was_spent_with_no_ceiling_set(client, imported):
    headers, _ = imported
    body = client.get("/api/budgets?month=2025-03", headers=headers).json()
    assert body["unbudgeted"]
    assert all(entry["spent_cents"] < 0 for entry in body["unbudgeted"])
    # Most spent first: the reader is being offered a budget to set.
    magnitudes = [abs(entry["spent_cents"]) for entry in body["unbudgeted"]]
    assert magnitudes == sorted(magnitudes, reverse=True)


def test_setting_a_budget_moves_a_category_out_of_unbudgeted(client, imported):
    headers, _ = imported
    carburant = _category(client, headers, "transport-carburant")
    client.patch(f"/api/categories/{carburant['id']}", headers=headers,
                 json={"monthly_budget_cents": 10_000})

    body = client.get("/api/budgets?month=2025-03", headers=headers).json()
    assert carburant["id"] not in [entry["category_id"] for entry in body["unbudgeted"]]


def test_the_month_calendar_facts_are_reported(client, imported):
    headers, _ = imported
    body = client.get("/api/budgets?month=2025-02", headers=headers).json()
    assert body["month_start"] == "2025-02-01"
    assert body["month_end"] == "2025-02-28"
    assert body["days_in_month"] == 28
    assert body["is_current_month"] is False
    assert body["days_elapsed"] == 28


def test_a_malformed_month_is_refused_in_french(client, imported):
    headers, _ = imported
    response = client.get("/api/budgets?month=mars-2025", headers=headers)
    assert response.status_code == 422
    assert "AAAA-MM" in response.json()["detail"]


def test_a_month_number_out_of_range_is_refused(client, imported):
    headers, _ = imported
    assert client.get("/api/budgets?month=2025-13", headers=headers).status_code == 422


def test_budgets_require_authentication(client, imported):
    assert client.get("/api/budgets").status_code == 401


def test_budgets_never_cross_users(client, imported):
    headers, _ = imported
    carburant = _category(client, headers, "transport-carburant")
    client.patch(f"/api/categories/{carburant['id']}", headers=headers,
                 json={"monthly_budget_cents": 10_000})

    other = client.post("/api/auth/register", json={
        "name": "Autre", "email": "autre@example.com", "password": "motdepasse123"}).json()
    other_headers = {"Authorization": f"Bearer {other['access_token']}"}

    body = client.get("/api/budgets?month=2025-03", headers=other_headers).json()
    assert body["lines"] == []
    assert body["unbudgeted"] == []
    assert body["total_spent_cents"] == 0
```

- [ ] **Step 2: Run the test to verify it fails**

Run from `backend/`: `.venv/Scripts/pytest.exe tests/test_budgets_api.py -v`
Expected: FAIL — every request 404s, the router does not exist.

- [ ] **Step 3: Write the schemas**

Create `backend/app/schemas/budgets.py`:

```python
from datetime import date

from pydantic import BaseModel

from app.schemas.history import HistoryOut


class BudgetLineOut(BaseModel):
    category_id: int
    name: str
    color: str
    is_essential: bool
    # A ceiling, positive.
    budget_cents: int
    # An outflow, negative -- the same convention as every other amount in the
    # API. The screen takes the magnitude for display.
    spent_cents: int
    # Positive while under the ceiling, negative once past it.
    remaining_cents: int
    consumed_ratio: float
    # null whenever a projection would be dishonest (too early in the month, or
    # the month is over). Never a zero standing in for "we did not compute it".
    projected_cents: int | None
    status: str


class UnbudgetedOut(BaseModel):
    category_id: int
    name: str
    color: str
    spent_cents: int


class BudgetReportOut(BaseModel):
    # "AAAA-MM", the same key shape aggregate.bucket_key emits for a month.
    month: str
    month_start: date
    month_end: date
    days_elapsed: int
    days_in_month: int
    is_current_month: bool
    lines: list[BudgetLineOut]
    unbudgeted: list[UnbudgetedOut]
    total_budget_cents: int
    total_spent_cents: int
    # The whole ledger's span, so an empty month can tell "you have no data" from
    # "you are looking at the wrong month" -- the same contract as SummaryOut.
    history: HistoryOut | None
```

- [ ] **Step 4: Write the router**

Create `backend/app/api/budgets.py`:

```python
import re
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.common import tx_points
from app.api.history import user_history
from app.db import get_db
from app.engines.aggregate import aggregate_by_category
from app.engines.budget import BudgetEntry, days_in_month, elapsed_days, evaluate_budgets
from app.models import Category, User
from app.schemas.budgets import BudgetLineOut, BudgetReportOut, UnbudgetedOut
from app.schemas.history import HistoryOut
from app.security.deps import get_current_user

router = APIRouter(prefix="/budgets", tags=["budgets"])

_MONTH_KEY = re.compile(r"^(\d{4})-(\d{2})$")


def resolve_month(value: str | None, history: HistoryOut | None, today: date) -> date:
    """The first day of the month this request is about.

    An absent `month` resolves to the month of the user's *latest transaction*,
    not to today's. The operator's statements stop months before today, and
    defaulting to the current month would open this screen on a permanently
    empty one -- the same class of defect as the "Tout" range bug in phase 1.5.
    A user with no data at all falls back to today's month, which is honest and
    empty rather than absent.
    """
    if value is not None:
        match = _MONTH_KEY.match(value)
        if match is None:
            raise HTTPException(status_code=422, detail="Mois invalide : format attendu AAAA-MM")
        year, month = int(match.group(1)), int(match.group(2))
        if not 1 <= month <= 12:
            raise HTTPException(status_code=422, detail="Mois invalide : format attendu AAAA-MM")
        return date(year, month, 1)
    if history is not None:
        return history.date_to.replace(day=1)
    return today.replace(day=1)


@router.get("", response_model=BudgetReportOut)
def budget_report(
    month: str | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> BudgetReportOut:
    today = date.today()
    history = user_history(db, user.id)
    month_start = resolve_month(month, history, today)
    total_days = days_in_month(month_start)
    month_end = date(month_start.year, month_start.month, total_days)

    points = tx_points(db, user.id, month_start, month_end)
    spent_by_category = {
        total.category_id: total.total_cents for total in aggregate_by_category(points)
    }

    categories = (
        db.query(Category)
        .filter(Category.user_id == user.id)
        .order_by(Category.position, Category.name)
        .all()
    )

    budgeted = [c for c in categories if c.monthly_budget_cents and c.monthly_budget_cents > 0]
    entries = [
        BudgetEntry(
            category_id=category.id,
            budget_cents=category.monthly_budget_cents,
            spent_cents=spent_by_category.get(category.id, 0),
        )
        for category in budgeted
    ]
    evaluated = evaluate_budgets(entries, month_start, today)
    by_id = {category.id: category for category in budgeted}
    lines = [
        BudgetLineOut(
            category_id=line.category_id,
            name=by_id[line.category_id].name,
            color=by_id[line.category_id].color,
            is_essential=by_id[line.category_id].is_essential,
            budget_cents=line.budget_cents,
            spent_cents=line.spent_cents,
            remaining_cents=line.remaining_cents,
            consumed_ratio=line.consumed_ratio,
            projected_cents=line.projected_cents,
            status=line.status,
        )
        for line in evaluated
    ]
    # Worst first: the reader opens this screen to find out what went wrong.
    lines.sort(key=lambda line: line.consumed_ratio, reverse=True)

    budgeted_ids = set(by_id)
    known = {category.id: category for category in categories}
    unbudgeted = [
        UnbudgetedOut(
            category_id=category_id,
            name=known[category_id].name,
            color=known[category_id].color,
            spent_cents=total_cents,
        )
        for category_id, total_cents in spent_by_category.items()
        # `None` is the uncategorized bucket: there is no category to hang a
        # budget on, so offering one here would lead nowhere.
        if category_id is not None and category_id not in budgeted_ids and category_id in known
    ]
    unbudgeted.sort(key=lambda entry: entry.spent_cents)

    return BudgetReportOut(
        month=f"{month_start.year}-{month_start.month:02d}",
        month_start=month_start,
        month_end=month_end,
        days_elapsed=elapsed_days(month_start, today),
        days_in_month=total_days,
        is_current_month=(month_start.year, month_start.month) == (today.year, today.month),
        lines=lines,
        unbudgeted=unbudgeted,
        total_budget_cents=sum(line.budget_cents for line in lines),
        total_spent_cents=sum(total for total in spent_by_category.values()),
        history=history,
    )
```

Note: month-length arithmetic is **not** repeated here. `days_in_month` comes from the engine, which is the only place that knows how a month is measured in this codebase.

- [ ] **Step 5: Register the router**

In `backend/app/main.py`, add `from app.api import budgets as budget_routes` beside the other router imports and `api.include_router(budget_routes.router)` after `analytics_routes`.

- [ ] **Step 6: Run the tests to verify they pass**

Run from `backend/`: `.venv/Scripts/pytest.exe tests/test_budgets_api.py -v`
Expected: PASS, 11 tests.

- [ ] **Step 7: Run the whole backend suite and commit**

Run from `backend/`: `.venv/Scripts/pytest.exe -q` → 308 passed.

```bash
git add backend/app/schemas/budgets.py backend/app/api/budgets.py backend/app/main.py backend/tests/test_budgets_api.py
git commit -m "feat(api): expose monthly budget consumption per category"
```

---

### Task 6: Budgets screen

The first screen of the phase. It is also the only place a budget or an essential flag can be set, because `/categories` is still a placeholder and building a full categories manager is not in this phase.

**Files:**
- Create: `frontend/src/features/budgets/BudgetsPage.tsx`
- Create: `frontend/src/features/budgets/BudgetsPage.css`
- Create: `frontend/src/features/budgets/BudgetBar.tsx`
- Create: `frontend/src/features/budgets/BudgetsPage.test.tsx`
- Create: `frontend/src/features/budgets/BudgetBar.test.tsx`
- Modify: `frontend/src/design/theme.ts` (add `parseCents`)
- Modify: `frontend/src/design/theme.test.ts`
- Modify: `frontend/src/lib/types.ts`
- Modify: `frontend/src/app/routes.tsx`, `frontend/src/app/AppShell.tsx`, `frontend/src/app/AppShell.test.tsx`

**Interfaces:**
- Consumes: `GET /api/budgets`, `GET /api/categories`, `PATCH /api/categories/{id}` (task 5 and task 3).
- Produces:
  - `parseCents(text: string): number | null` in `design/theme.ts` — the inverse of `formatCents`, exact, string-based, no float. Tasks 14 and 18 reuse it.
  - TS types `BudgetLine`, `UnbudgetedCategory`, `BudgetReport` in `lib/types.ts`.
  - `<BudgetBar line={...} />` presentational component.
  - Route `/budgets`, nav entry "Budgets".

- [ ] **Step 1: Write the failing test for `parseCents`**

Append to `frontend/src/design/theme.test.ts`:

```ts
import { parseCents } from "./theme";

describe("parseCents", () => {
  it("reads a plain euro amount", () => {
    expect(parseCents("300")).toBe(30000);
  });

  it("reads a French decimal comma", () => {
    expect(parseCents("300,50")).toBe(30050);
  });

  it("reads a dot as well, because keyboards differ", () => {
    expect(parseCents("300.50")).toBe(30050);
  });

  it("survives the spaces and the euro sign formatCents produces", () => {
    // formatCents emits narrow no-break spaces and a trailing "€"; a user who
    // copies a figure off the screen and pastes it back must get it back.
    expect(parseCents(formatCents(123456))).toBe(123456);
  });

  it("pads a single decimal digit rather than reading it as cents", () => {
    expect(parseCents("300,5")).toBe(30050);
  });

  it("never goes through a float", () => {
    // 0.1 + 0.2 territory: 8.70 EUR through parseFloat*100 gives 869.9999...
    expect(parseCents("8,70")).toBe(870);
    expect(parseCents("1145,29")).toBe(114529);
  });

  it("refuses more than two decimals rather than silently rounding", () => {
    expect(parseCents("300,505")).toBeNull();
  });

  it("refuses anything that is not a number", () => {
    expect(parseCents("")).toBeNull();
    expect(parseCents("abc")).toBeNull();
    expect(parseCents("-")).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run from `frontend/`: `npm test -- theme.test.ts`
Expected: FAIL — `parseCents is not a function`.

- [ ] **Step 3: Implement `parseCents`**

Append to `frontend/src/design/theme.ts`:

```ts
/**
 * The inverse of {@link formatCents}: a typed or pasted euro amount, back to an
 * integer number of cents.
 *
 * String arithmetic throughout, never `parseFloat(x) * 100` -- 8.70 through a
 * float is 869.9999999999999, and `Math.round` hiding that is exactly the kind
 * of silent conversion the integer-cents rule exists to prevent.
 *
 * Accepts what a French user actually types or pastes: a comma or a dot, the
 * narrow no-break spaces and the "€" that `formatCents` itself emits, and the
 * typographic minus it uses for negatives. Returns `null` -- never 0 -- for
 * anything it cannot read exactly, including more than two decimals: rounding
 * a third digit away would change the number the user typed without saying so.
 */
export function parseCents(text: string): number | null {
  const cleaned = text
    .replace(/[\s  ]/g, "")
    .replace(/€/g, "")
    .replace(MINUS, "-")
    .replace(",", ".");
  if (!/^-?\d+(\.\d{1,2})?$/.test(cleaned)) return null;

  const negative = cleaned.startsWith("-");
  const [whole, fraction = ""] = cleaned.replace("-", "").split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return negative ? -cents : cents;
}
```

- [ ] **Step 4: Add the TypeScript payload types**

Append to `frontend/src/lib/types.ts`:

```ts
export type BudgetStatus = "ok" | "at_risk" | "over";

export interface BudgetLine {
  category_id: number;
  name: string;
  color: string;
  is_essential: boolean;
  /** A ceiling, positive. */
  budget_cents: number;
  /** An outflow, negative — take the magnitude for display. */
  spent_cents: number;
  /** Positive while under the ceiling, negative once past it. */
  remaining_cents: number;
  consumed_ratio: number;
  /** null when a projection would be dishonest — never a zero standing in. */
  projected_cents: number | null;
  status: BudgetStatus;
}

export interface UnbudgetedCategory {
  category_id: number;
  name: string;
  color: string;
  spent_cents: number;
}

export interface BudgetReport {
  month: string;
  month_start: string;
  month_end: string;
  days_elapsed: number;
  days_in_month: number;
  is_current_month: boolean;
  lines: BudgetLine[];
  unbudgeted: UnbudgetedCategory[];
  total_budget_cents: number;
  total_spent_cents: number;
  history: History | null;
}
```

- [ ] **Step 5: Write the failing test for `BudgetBar`**

Create `frontend/src/features/budgets/BudgetBar.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { BudgetLine } from "../../lib/types";
import { BudgetBar, fillPercent } from "./BudgetBar";

const line: BudgetLine = {
  category_id: 1,
  name: "Courses",
  color: "#4fd6a8",
  is_essential: true,
  budget_cents: 30000,
  spent_cents: -24000,
  remaining_cents: 6000,
  consumed_ratio: 0.8,
  projected_cents: null,
  status: "ok",
};

describe("fillPercent", () => {
  it("is the consumed share as a percentage string", () => {
    expect(fillPercent(0.8)).toBe("80%");
  });

  it("caps at 100 so a threefold overrun does not overflow the row", () => {
    expect(fillPercent(3.4)).toBe("100%");
  });

  it("never goes negative", () => {
    expect(fillPercent(-1)).toBe("0%");
  });
});

describe("BudgetBar", () => {
  it("names the category and states both figures", () => {
    render(<BudgetBar line={line} />);
    expect(screen.getByText("Courses")).toBeInTheDocument();
    // Spent as a magnitude, never "−240,00 € sur 300,00 €".
    expect(screen.getByText(/240,00/)).toBeInTheDocument();
    expect(screen.getByText(/300,00/)).toBeInTheDocument();
  });

  it("exposes the consumption as a progress bar with its real value", () => {
    render(<BudgetBar line={line} />);
    const bar = screen.getByRole("progressbar", { name: /Courses/ });
    expect(bar).toHaveAttribute("aria-valuenow", "80");
    expect(bar).toHaveAttribute("aria-valuemax", "100");
  });

  it("says what is left in words, not only in colour", () => {
    render(<BudgetBar line={line} />);
    expect(screen.getByText(/Il reste/)).toBeInTheDocument();
  });

  it("says how much was overspent when the ceiling is passed", () => {
    render(<BudgetBar line={{ ...line, spent_cents: -34500, remaining_cents: -4500, consumed_ratio: 1.15, status: "over" }} />);
    expect(screen.getByText(/Dépassé de/)).toBeInTheDocument();
    expect(screen.getByText(/45,00/)).toBeInTheDocument();
  });

  it("states the projection when the month is on pace to overrun", () => {
    render(<BudgetBar line={{ ...line, spent_cents: -20000, remaining_cents: 10000, consumed_ratio: 0.67, projected_cents: -41333, status: "at_risk" }} />);
    expect(screen.getByText(/À ce rythme/)).toBeInTheDocument();
    expect(screen.getByText(/413,33/)).toBeInTheDocument();
  });

  it("says nothing about a pace it does not have", () => {
    render(<BudgetBar line={line} />);
    expect(screen.queryByText(/À ce rythme/)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 6: Run it to verify it fails, then write `BudgetBar`**

Run from `frontend/`: `npm test -- BudgetBar` → FAIL, module not found.

Create `frontend/src/features/budgets/BudgetBar.tsx`:

```tsx
import { formatCents } from "../../design/theme";
import type { BudgetLine } from "../../lib/types";

/**
 * The consumed share, as a CSS percentage, clamped into [0, 100].
 *
 * Capped rather than allowed to overflow: a category at 340 % of its budget
 * would otherwise draw a bar three times the width of its row. The overrun is
 * stated in figures underneath instead, where it can be read exactly.
 */
export function fillPercent(ratio: number): string {
  const clamped = Math.min(100, Math.max(0, ratio * 100));
  return `${Math.round(clamped)}%`;
}

const STATUS_NOTE: Record<BudgetLine["status"], string> = {
  ok: "Dans le budget",
  at_risk: "En passe de dépasser",
  over: "Budget dépassé",
};

interface BudgetBarProps {
  line: BudgetLine;
}

export function BudgetBar({ line }: BudgetBarProps) {
  const spent = Math.abs(line.spent_cents);
  const percent = Math.round(Math.min(100, Math.max(0, line.consumed_ratio * 100)));

  return (
    <div className={`yd-budget yd-budget--${line.status}`}>
      <div className="yd-budget__head">
        <span className="yd-budget__name">{line.name}</span>
        {line.is_essential ? (
          <span className="yd-budget__essential" title="Dépense essentielle">
            Essentiel
          </span>
        ) : null}
        <span className="yd-budget__figures">
          {formatCents(spent)} <span aria-hidden="true">/</span>{" "}
          <span className="sr-only">sur</span>
          {formatCents(line.budget_cents)}
        </span>
      </div>

      {/* The track lives in a grid row with a definite inline size (see
          BudgetsPage.css). A percentage width inside an auto-width flex column
          resolves against nothing and renders at ZERO -- which is how the
          dashboard once shipped a loading skeleton with no figure in it. */}
      <div
        className="yd-budget__track"
        role="progressbar"
        aria-label={`Consommation du budget ${line.name}`}
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className="yd-budget__fill"
          style={{ width: fillPercent(line.consumed_ratio) }}
        />
      </div>

      <p className="yd-budget__note">
        <span className="yd-budget__status">{STATUS_NOTE[line.status]}</span>
        {line.remaining_cents >= 0
          ? ` — Il reste ${formatCents(line.remaining_cents)}`
          : ` — Dépassé de ${formatCents(Math.abs(line.remaining_cents))}`}
        {line.projected_cents !== null
          ? ` — À ce rythme, ${formatCents(Math.abs(line.projected_cents))} sur le mois`
          : ""}
      </p>
    </div>
  );
}
```

- [ ] **Step 7: Write the failing test for `BudgetsPage`**

Create `frontend/src/features/budgets/BudgetsPage.test.tsx`:

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "../../app/ThemeProvider";
import { BudgetsPage } from "./BudgetsPage";

const fetchMock = vi.fn();

const report = {
  month: "2026-01",
  month_start: "2026-01-01",
  month_end: "2026-01-31",
  days_elapsed: 31,
  days_in_month: 31,
  is_current_month: false,
  lines: [
    {
      category_id: 1, name: "Courses", color: "#4fd6a8", is_essential: true,
      budget_cents: 30000, spent_cents: -34500, remaining_cents: -4500,
      consumed_ratio: 1.15, projected_cents: null, status: "over",
    },
    {
      category_id: 2, name: "Carburant", color: "#f4a261", is_essential: true,
      budget_cents: 12000, spent_cents: -6000, remaining_cents: 6000,
      consumed_ratio: 0.5, projected_cents: null, status: "ok",
    },
  ],
  unbudgeted: [
    { category_id: 3, name: "Restaurants", color: "#fb7185", spent_cents: -18000 },
  ],
  total_budget_cents: 42000,
  total_spent_cents: -58500,
  history: { date_from: "2025-01-24", date_to: "2026-01-09", transaction_count: 197 },
};

const emptyReport = {
  ...report, lines: [], unbudgeted: [], total_budget_cents: 0, total_spent_cents: 0,
};

const categories = [
  { id: 1, parent_id: null, name: "Courses", slug: "alimentation-courses", kind: "expense", color: "#4fd6a8", icon: "cart", monthly_budget_cents: 30000, is_essential: true },
  { id: 3, parent_id: null, name: "Restaurants", slug: "alimentation-restaurant", kind: "expense", color: "#fb7185", icon: "cart", monthly_budget_cents: null, is_essential: false },
];

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function setupFetch(overrides: { budgets?: () => Response; categories?: () => Response } = {}) {
  fetchMock.mockImplementation((input: string, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : String(input), "http://localhost");
    if (url.pathname === "/api/budgets") {
      return Promise.resolve(overrides.budgets ? overrides.budgets() : jsonResponse(report));
    }
    if (url.pathname === "/api/categories") {
      return Promise.resolve(overrides.categories ? overrides.categories() : jsonResponse(categories));
    }
    if (url.pathname.startsWith("/api/categories/") && init?.method === "PATCH") {
      return Promise.resolve(jsonResponse({ ...categories[0], monthly_budget_cents: 25000 }));
    }
    throw new Error(`Unhandled fetch in test: ${url.pathname}`);
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false, media: query,
      addEventListener: vi.fn(), removeEventListener: vi.fn(),
      addListener: vi.fn(), removeListener: vi.fn(),
    })),
  });
});

function renderPage(entry = "/budgets") {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <ThemeProvider>
        <BudgetsPage />
      </ThemeProvider>
    </MemoryRouter>,
  );
}

describe("BudgetsPage", () => {
  it("names the month it is showing, in French", async () => {
    setupFetch();
    renderPage();
    expect(await screen.findByText(/janvier 2026/i)).toBeInTheDocument();
  });

  it("renders one bar per budgeted category", async () => {
    setupFetch();
    renderPage();
    await screen.findByText("Courses");
    expect(screen.getAllByRole("progressbar")).toHaveLength(2);
  });

  it("offers the categories that were spent on with no budget set", async () => {
    setupFetch();
    renderPage();
    expect(await screen.findByText("Restaurants")).toBeInTheDocument();
    expect(screen.getByLabelText(/Budget mensuel pour Restaurants/)).toBeInTheDocument();
  });

  it("sends a budget typed in euros as integer cents", async () => {
    setupFetch();
    renderPage();
    const input = await screen.findByLabelText(/Budget mensuel pour Restaurants/);
    await userEvent.clear(input);
    await userEvent.type(input, "250,50");
    await userEvent.click(screen.getByRole("button", { name: /Enregistrer le budget de Restaurants/ }));

    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(([, init]) => init?.method === "PATCH");
      expect(patch).toBeDefined();
      expect(JSON.parse(patch![1].body as string)).toEqual({ monthly_budget_cents: 25050 });
    });
  });

  it("refuses an unreadable amount instead of sending a zero", async () => {
    setupFetch();
    renderPage();
    const input = await screen.findByLabelText(/Budget mensuel pour Restaurants/);
    await userEvent.type(input, "abc");
    await userEvent.click(screen.getByRole("button", { name: /Enregistrer le budget de Restaurants/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/Montant invalide/);
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PATCH")).toBe(false);
  });

  it("diagnoses an empty month rather than showing a blank grid", async () => {
    setupFetch({ budgets: () => jsonResponse(emptyReport) });
    renderPage();
    expect(await screen.findByText(/Aucun budget défini/)).toBeInTheDocument();
  });

  it("moves to the previous month without losing the rest of the screen", async () => {
    setupFetch();
    renderPage();
    await screen.findByText("Courses");
    await userEvent.click(screen.getByRole("button", { name: /Mois précédent/ }));

    await waitFor(() => {
      const asked = fetchMock.mock.calls
        .map(([input]) => new URL(String(input), "http://localhost"))
        .filter((url) => url.pathname === "/api/budgets")
        .map((url) => url.searchParams.get("month"));
      expect(asked).toContain("2025-12");
    });
  });

  it("surfaces a failed load in French instead of an empty screen", async () => {
    setupFetch({ budgets: () => jsonResponse({ detail: "Base indisponible" }, 500) });
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent("Base indisponible");
  });
});
```

- [ ] **Step 8: Run it to verify it fails, then write `BudgetsPage`**

Run from `frontend/`: `npm test -- BudgetsPage` → FAIL, module not found.

Create `frontend/src/features/budgets/BudgetsPage.tsx`:

```tsx
import { motion } from "motion/react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router";

import { BentoCell, type BentoSpan } from "../../design/bento/BentoCell";
import { BentoGrid } from "../../design/bento/BentoGrid";
import { CountUp } from "../../design/CountUp";
import { EmptyState, historySentence } from "../../design/EmptyState";
import { useReducedMotion } from "../../design/motion/useReducedMotion";
import { entryProps, staggerProps } from "../../design/motion/variants";
import { formatCents, parseCents } from "../../design/theme";
import { ApiError, api } from "../../lib/api";
import { plural } from "../../lib/plural";
import type { BudgetReport } from "../../lib/types";
import { BudgetBar } from "./BudgetBar";
import "./BudgetsPage.css";

const GENERIC_ERROR = "Une erreur inattendue est survenue.";

function messageFor(err: unknown): string {
  return err instanceof ApiError ? err.detail : GENERIC_ERROR;
}

/** "2026-01" → "janvier 2026". The month key is the API's, the words are ours. */
export function monthLabel(key: string): string {
  const [year, month] = key.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("fr-FR", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** The month `offset` months away from `key`, in the same "AAAA-MM" shape. */
export function shiftMonth(key: string, offset: number): string {
  const [year, month] = key.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1 + offset, 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}`;
}

const SPAN = {
  summary: { base: 1, md: 6, lg: 12 },
  lines: { base: 1, md: 6, lg: 7 },
  unbudgeted: { base: 1, md: 6, lg: 5 },
  empty: { base: 1, md: 6, lg: 12 },
} satisfies Record<string, BentoSpan>;

interface BudgetInputProps {
  categoryId: number;
  name: string;
  spentCents: number;
  onSaved: () => void;
  onError: (message: string) => void;
}

/**
 * One "set a budget" row. The euro figure typed here becomes integer cents
 * through `parseCents`, which returns null rather than 0 on anything it cannot
 * read exactly -- a silent 0 would set a budget of nothing and mark the
 * category permanently over.
 */
function BudgetInput({ categoryId, name, spentCents, onSaved, onError }: BudgetInputProps) {
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    const cents = parseCents(value);
    if (cents === null || cents <= 0) {
      onError(`Montant invalide pour ${name} : saisissez un montant en euros, par exemple 250,50.`);
      return;
    }
    setSaving(true);
    try {
      await api.patch(`/categories/${categoryId}`, { monthly_budget_cents: cents });
      onSaved();
    } catch (err) {
      onError(messageFor(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <li className="yd-budgets__suggestion">
      <span className="yd-budgets__suggestion-name">{name}</span>
      <span className="yd-budgets__suggestion-spent">{formatCents(Math.abs(spentCents))}</span>
      <label className="yd-budgets__suggestion-field">
        <span className="sr-only">{`Budget mensuel pour ${name}`}</span>
        <input
          type="text"
          inputMode="decimal"
          aria-label={`Budget mensuel pour ${name}`}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="250,00"
        />
      </label>
      <button
        type="button"
        className="yd-budgets__suggestion-save"
        disabled={saving}
        onClick={() => void save()}
      >
        <span className="sr-only">{`Enregistrer le budget de ${name}`}</span>
        <span aria-hidden="true">Définir</span>
      </button>
    </li>
  );
}

export function BudgetsPage() {
  const [params, setParams] = useSearchParams();
  const reduced = useReducedMotion();
  const askedMonth = params.get("mois");

  const [report, setReport] = useState<BudgetReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setIsLoading(true);
      try {
        const body = await api.get<BudgetReport>("/budgets", { month: askedMonth ?? undefined });
        if (cancelled) return;
        setReport(body);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setReport(null);
        setError(messageFor(err));
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [askedMonth, reloadToken]);

  const goToMonth = useCallback(
    (key: string) => setParams({ mois: key }),
    [setParams],
  );

  const current = report?.month ?? askedMonth ?? "";
  const overCount = report?.lines.filter((line) => line.status === "over").length ?? 0;
  const atRiskCount = report?.lines.filter((line) => line.status === "at_risk").length ?? 0;

  let body: ReactNode;
  if (isLoading) {
    body = (
      <BentoGrid role="status" aria-busy="true" aria-label="Chargement des budgets">
        <BentoCell span={SPAN.summary} className="yd-panel">
          <div className="yd-skeleton yd-skeleton--title" aria-hidden="true" />
          <div className="yd-skeleton yd-skeleton--value" aria-hidden="true" />
        </BentoCell>
        <BentoCell span={SPAN.lines} className="yd-panel">
          <div className="yd-skeleton yd-skeleton--chart" aria-hidden="true" />
        </BentoCell>
        <BentoCell span={SPAN.unbudgeted} className="yd-panel">
          <div className="yd-skeleton yd-skeleton--chart" aria-hidden="true" />
        </BentoCell>
      </BentoGrid>
    );
  } else if (report === null) {
    body = null;
  } else if (report.lines.length === 0 && report.unbudgeted.length === 0) {
    body = (
      <BentoGrid as={motion.div} {...staggerProps(reduced)}>
        <BentoCell as={motion.div} span={SPAN.empty} {...entryProps(reduced)}>
          {report.history === null ? (
            <EmptyState
              title="Aucun budget défini, et aucune dépense à budgéter."
              detail="Importez un relevé bancaire : les catégories sur lesquelles vous dépensez apparaîtront ici, prêtes à recevoir un plafond."
            >
              <Link to="/import" className="yd-empty__action">
                Importer un relevé
              </Link>
            </EmptyState>
          ) : (
            <EmptyState
              title="Aucun budget défini, et aucune dépense ce mois-ci."
              detail={historySentence(report.history)}
            >
              <button
                type="button"
                className="yd-empty__action"
                onClick={() => goToMonth(report.history!.date_to.slice(0, 7))}
              >
                Aller au dernier mois avec des données
              </button>
            </EmptyState>
          )}
        </BentoCell>
      </BentoGrid>
    );
  } else {
    body = (
      <BentoGrid as={motion.div} {...staggerProps(reduced)}>
        <BentoCell as={motion.div} span={SPAN.summary} className="yd-panel" {...entryProps(reduced)}>
          <h2 className="yd-panel__title">Ce mois-ci</h2>
          <div className="yd-budgets__totals">
            <div className="yd-budgets__total">
              <span className="yd-budgets__total-label">Budgété</span>
              <CountUp
                value={report.total_budget_cents}
                format={(cents) => formatCents(cents)}
                className="yd-budgets__total-value"
              />
            </div>
            <div className="yd-budgets__total">
              <span className="yd-budgets__total-label">Dépensé</span>
              <CountUp
                value={Math.abs(report.total_spent_cents)}
                format={(cents) => formatCents(cents)}
                className="yd-budgets__total-value"
              />
            </div>
            <p className="yd-budgets__verdict">
              {overCount === 0 && atRiskCount === 0
                ? "Aucun budget dépassé."
                : [
                    overCount > 0
                      ? `${overCount} ${plural(overCount, "budget dépassé", "budgets dépassés")}`
                      : "",
                    atRiskCount > 0
                      ? `${atRiskCount} ${plural(atRiskCount, "budget en passe de l'être", "budgets en passe de l'être")}`
                      : "",
                  ]
                    .filter(Boolean)
                    .join(", ") + "."}
            </p>
            {!report.is_current_month ? (
              // A finished month has no pace to project, and saying so is
              // better than leaving the reader wondering why no projection
              // appears on any line.
              <p className="yd-budgets__note">
                Mois terminé : les montants affichés sont définitifs, aucune projection n'est faite.
              </p>
            ) : (
              <p className="yd-budgets__note">
                {`Mois en cours, ${report.days_elapsed} ${plural(report.days_elapsed, "jour écoulé", "jours écoulés")} sur ${report.days_in_month}.`}
              </p>
            )}
          </div>
        </BentoCell>

        <BentoCell as={motion.div} span={SPAN.lines} className="yd-panel" {...entryProps(reduced)}>
          <h2 className="yd-panel__title">Budgets par catégorie</h2>
          {report.lines.length === 0 ? (
            <p className="yd-budgets__none">
              Aucun budget défini. Choisissez une catégorie à droite pour commencer.
            </p>
          ) : (
            <div className="yd-budgets__list">
              {report.lines.map((line) => (
                <BudgetBar key={line.category_id} line={line} />
              ))}
            </div>
          )}
        </BentoCell>

        <BentoCell as={motion.div} span={SPAN.unbudgeted} className="yd-panel" {...entryProps(reduced)}>
          <h2 className="yd-panel__title">Sans budget</h2>
          {report.unbudgeted.length === 0 ? (
            <p className="yd-budgets__none">Chaque catégorie sur laquelle vous avez dépensé a un budget.</p>
          ) : (
            <ul className="yd-budgets__suggestions">
              {report.unbudgeted.map((entry) => (
                <BudgetInput
                  key={entry.category_id}
                  categoryId={entry.category_id}
                  name={entry.name}
                  spentCents={entry.spent_cents}
                  onSaved={() => {
                    setError(null);
                    setReloadToken((token) => token + 1);
                  }}
                  onError={setError}
                />
              ))}
            </ul>
          )}
        </BentoCell>
      </BentoGrid>
    );
  }

  return (
    <section className="yd-budgets">
      <div className="yd-budgets__header">
        <h1>Budgets</h1>
        <div className="yd-budgets__month-nav">
          <button
            type="button"
            onClick={() => goToMonth(shiftMonth(current, -1))}
            disabled={!current}
          >
            <span className="sr-only">Mois précédent</span>
            <span aria-hidden="true">◀</span>
          </button>
          <span className="yd-budgets__month" aria-live="polite">
            {current ? monthLabel(current) : ""}
          </span>
          <button
            type="button"
            onClick={() => goToMonth(shiftMonth(current, 1))}
            disabled={!current}
          >
            <span className="sr-only">Mois suivant</span>
            <span aria-hidden="true">▶</span>
          </button>
        </div>
      </div>

      {error !== null ? (
        <p role="alert" className="yd-budgets__alert">
          {error}
        </p>
      ) : null}

      {body}
    </section>
  );
}
```

- [ ] **Step 9: Write the stylesheet**

Create `frontend/src/features/budgets/BudgetsPage.css`. The load-bearing rules — everything else is spacing and type scale:

```css
.yd-budgets__header {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--yd-space-sm);
  margin-bottom: var(--yd-space-lg);
}

.yd-budgets__month-nav {
  display: flex;
  align-items: center;
  gap: var(--yd-space-sm);
}

.yd-budgets__month {
  min-width: 10ch;
  text-align: center;
  font-variant-numeric: tabular-nums;
  /* First letter of a French month is lowercase from Intl; the heading reads
     better capitalised, and text-transform does not touch the data. */
  text-transform: capitalize;
}

.yd-budgets__list {
  display: flex;
  flex-direction: column;
  gap: var(--yd-space-md);
}

/* One budget row. A GRID, not a flex column: the track below is sized in
   percent, and a percentage inside an auto-width flex column resolves against
   nothing and renders at zero width. `minmax(0, 1fr)` gives it a definite
   inline size to resolve against. Verified in a browser, not in jsdom. */
.yd-budget {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--yd-space-2xs);
}

.yd-budget__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--yd-space-xs);
}

.yd-budget__name {
  font-weight: 600;
  color: var(--yd-text);
}

.yd-budget__figures {
  margin-left: auto;
  font-family: var(--yd-font-mono);
  font-variant-numeric: tabular-nums;
  color: var(--yd-text);
}

.yd-budget__essential {
  font-size: 0.72rem;
  padding: 0 var(--yd-space-2xs);
  border-radius: var(--yd-radius-sm);
  border: 1px solid var(--yd-border-strong);
  color: var(--yd-text-muted);
}

.yd-budget__track {
  width: 100%;
  height: 10px;
  border-radius: 999px;
  background: var(--yd-surface);
  border: 1px solid var(--yd-border);
  overflow: hidden;
}

.yd-budget__fill {
  height: 100%;
  border-radius: inherit;
  background: var(--yd-positive);
  /* `width`, not `transform: scaleX()`: this fill sits inside a cell rendered
     as a motion.* element, which carries an inline `transform: none` once its
     entry animation settles and would kill a transform-based bar outright. */
  transition: width var(--yd-motion-slow) var(--yd-ease);
}

.yd-budget--at_risk .yd-budget__fill {
  background: var(--yd-warning);
}

.yd-budget--over .yd-budget__fill {
  background: var(--yd-negative);
}

.yd-budget__note {
  margin: 0;
  font-size: 0.86rem;
  color: var(--yd-text-muted);
}

/* Status is never carried by colour alone: `.yd-budget__status` states it in
   words, and the bar's colour only reinforces it (WCAG 1.4.1). */
.yd-budget__status {
  font-weight: 600;
  color: var(--yd-text);
}

.yd-budgets__suggestions {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--yd-space-sm);
}

.yd-budgets__suggestion {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  grid-template-areas:
    "name spent"
    "field save";
  gap: var(--yd-space-2xs) var(--yd-space-xs);
  align-items: center;
}

.yd-budgets__suggestion-name { grid-area: name; }
.yd-budgets__suggestion-spent {
  grid-area: spent;
  font-family: var(--yd-font-mono);
  font-variant-numeric: tabular-nums;
  color: var(--yd-text-muted);
}
.yd-budgets__suggestion-field { grid-area: field; }
.yd-budgets__suggestion-field input {
  width: 100%;
  font-family: var(--yd-font-mono);
}
.yd-budgets__suggestion-save { grid-area: save; }

.yd-budgets__alert {
  margin: 0 0 var(--yd-space-md);
  padding: var(--yd-space-sm) var(--yd-space-md);
  border-radius: var(--yd-radius-sm);
  border: 1px solid var(--yd-negative);
  color: var(--yd-text);
}
```

- [ ] **Step 10: Register the route and the nav entry**

In `frontend/src/app/routes.tsx`, add `import { BudgetsPage } from "../features/budgets/BudgetsPage";` and `{ path: "budgets", element: <BudgetsPage /> },` inside the `AppShellRoute` children, before `categories`.

In `frontend/src/app/AppShell.tsx`, add `{ to: "/budgets", label: "Budgets" },` to `NAV_ITEMS` after Transactions.

In `frontend/src/app/AppShell.test.tsx`, update whatever assertion counts or lists the nav entries.

- [ ] **Step 11: Run the frontend suite**

Run from `frontend/`: `npm test`
Expected: PASS. `npm run build` → zero TypeScript errors.

- [ ] **Step 12: Browser verification — the step that actually decides whether this task is done**

Re-seed and start the app:

```bash
cd backend && .venv/Scripts/python.exe ../.superpowers/sdd/2026-08-12-yieldo-phase-1-5-interface/seed_fixture.py
```

Start the backend and `npm run dev`, log in as `demo@yieldo-demo.fr` / `MotDePasseDemo123!`, and go to `/budgets`.

Set three real budgets through the screen first, so the page has something to show: Courses 300 €, Carburant 120 €, Restaurants 150 €.

Then screenshot **every one of these six combinations** and attach them to the task report:

| Width | Theme |
|---|---|
| 375 px | clair |
| 375 px | sombre |
| 768 px | clair |
| 768 px | sombre |
| 1440 px | clair |
| 1440 px | sombre |

Check, in the browser and not in a test:

- [ ] **Every bar has non-zero width.** This is the single most likely defect in this task (failure mode 3). Confirm with `getComputedStyle(document.querySelector('.yd-budget__fill')).width` — it must not be `0px`.
- [ ] A category at over 100 % draws a full bar and does not overflow its row at 375 px.
- [ ] The month navigation is reachable and legible at 375 px; the month name does not wrap the arrows onto three lines.
- [ ] The "Sans budget" input and its button are both fully visible at 375 px, and neither is clipped by the cell's right edge (this exact clipping bit the import wizard at 375 in phase 1.5).
- [ ] `.yd-budget__status` text clears 4.5:1 against `--yd-surface-strong` in **both** themes. Measure it over the composited pixels — `contrast.test.ts` parses `tokens.css` only and cannot see this pairing.
- [ ] The warning and negative fills are distinguishable from the positive fill in both themes, and the status word is present regardless (colour alone is never the signal).
- [ ] Navigating to the previous month does not flash an empty grid then re-fill — the skeleton must occupy the same cells.
- [ ] Reduced motion on: the bars appear at their final width with no transition, and no cell is stranded at `opacity: 0`.

- [ ] **Step 13: Commit**

```bash
git add frontend/src/features/budgets frontend/src/design/theme.ts frontend/src/design/theme.test.ts frontend/src/lib/types.ts frontend/src/app/routes.tsx frontend/src/app/AppShell.tsx frontend/src/app/AppShell.test.tsx
git commit -m "feat(budgets): add the monthly budget screen with per-category consumption"
```

---

# Lot C — Détection des récurrences

Design spec §6.2: "Regroupe les transactions par similarité de libellé et de montant, teste la régularité des intervalles, en déduit une périodicité. Produit la liste des abonnements et prélèvements, détecte les hausses de prix (« Netflix : 13,49 € → 15,99 € en mars 2026, +18,5 % »), signale les prélèvements attendus mais absents, et calcule le coût annuel total des abonnements."

### Task 7: Recurrence engine

Grouping is by **label key alone**, never by label *and* amount: a price rise is a change of amount within one recurrence, and grouping on amount would split Netflix into two subscriptions and then fail to notice that one replaced the other. Amount stability is instead used inside a group, to find the level change.

**Files:**
- Modify: `backend/app/engines/recurrence.py` (the `RecurringTx` dataclass from task 2 stays at the top; everything else is added below it)
- Test: `backend/tests/test_recurrence.py`

**Interfaces:**
- Consumes: `app.engines.robust.{describe, median_cents}`.
- Produces:
  - `Periodicity = Literal["weekly", "biweekly", "monthly", "quarterly", "yearly"]`
  - `PriceChange(previous_cents: int, current_cents: int, changed_on: date, ratio: float, occurrence_index: int)`
  - `Recurrence(label_key, label, category_id, periodicity, occurrences, first_on, last_on, median_interval_days, amount_cents, amount_spread_cents, annual_cents, expected_next_on, status, confidence, price_change)`
  - `RecurrenceStatus = Literal["active", "missing", "ended"]`, `Confidence = Literal["probable", "confirmed"]`
  - `RecurrenceReport(recurrences, recurring_keys, annual_subscription_cents, monthly_subscription_cents, analysed_groups, rejected_thin, rejected_irregular, notice)`
  - `classify_period(median_interval_days: int) -> Periodicity | None`
  - `find_price_change(amounts: list[int], dates: list[date]) -> PriceChange | None`
  - `detect_recurrences(transactions: list[RecurringTx], today: date) -> RecurrenceReport`
  - `MIN_OCCURRENCES = 3`, `CONFIRMED_OCCURRENCES = 4`, `OCCURRENCES_PER_YEAR`
  - Task 8 consumes the report. **Task 11 (forecast) consumes `recurrences` and `recurring_keys`** — the key set is what lets the forecast subtract recurring flows from the historical residual instead of double-counting them.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_recurrence.py`:

```python
from datetime import date, timedelta

import pytest

from app.engines.recurrence import (
    MIN_OCCURRENCES,
    RecurringTx,
    classify_period,
    detect_recurrences,
    find_price_change,
)

TODAY = date(2026, 8, 12)


def _monthly(label: str, amount: int, start: date, count: int, category_id: int | None = None):
    """`count` charges roughly a month apart, with the two-day drift a real
    direct debit has when the due date falls on a weekend."""
    drift = [0, 1, -1, 2, 0, -2, 1, 0, -1, 1, 0, 2]
    rows = []
    for index in range(count):
        month = start.month - 1 + index
        year = start.year + month // 12
        on = date(year, month % 12 + 1, start.day) + timedelta(days=drift[index % len(drift)])
        rows.append(RecurringTx(on=on, amount_cents=amount, label_key=label,
                                label_raw=label.upper(), category_id=category_id))
    return rows


def test_classify_period_recognises_the_five_shapes():
    assert classify_period(7) == "weekly"
    assert classify_period(14) == "biweekly"
    assert classify_period(30) == "monthly"
    assert classify_period(28) == "monthly"
    assert classify_period(31) == "monthly"
    assert classify_period(91) == "quarterly"
    assert classify_period(365) == "yearly"


def test_classify_period_refuses_what_matches_nothing():
    """A 20-day rhythm is not a periodicity anyone bills on. Returning the
    nearest match would invent a monthly subscription out of noise."""
    assert classify_period(20) is None
    assert classify_period(60) is None
    assert classify_period(0) is None


def test_a_monthly_subscription_is_detected():
    rows = _monthly("netflix", -1549, date(2025, 9, 10), 8)
    report = detect_recurrences(rows, TODAY)

    assert len(report.recurrences) == 1
    found = report.recurrences[0]
    assert found.periodicity == "monthly"
    assert found.occurrences == 8
    assert found.amount_cents == -1549
    assert found.confidence == "confirmed"
    assert found.annual_cents == -1549 * 12


def test_two_occurrences_are_never_a_recurrence():
    """Two points define one interval, and one interval has no regularity to
    test. Calling that a subscription is exactly the confident-from-nothing
    answer this phase exists to prevent."""
    rows = _monthly("netflix", -1549, date(2026, 6, 10), 2)
    report = detect_recurrences(rows, TODAY)
    assert report.recurrences == []
    assert report.rejected_thin == 1
    assert MIN_OCCURRENCES == 3


def test_three_occurrences_are_reported_as_probable_not_confirmed():
    rows = _monthly("netflix", -1549, date(2026, 5, 10), 3)
    report = detect_recurrences(rows, TODAY)
    assert [r.confidence for r in report.recurrences] == ["probable"]


def test_irregular_shopping_at_the_same_shop_is_not_a_recurrence():
    """Seven visits to the same supermarket, at irregular gaps and varying
    amounts. The label groups them; the interval test throws them out."""
    days = [1, 3, 9, 10, 22, 23, 40]
    rows = [
        RecurringTx(on=date(2025, 2, 1) + timedelta(days=offset),
                    amount_cents=-2000 - offset * 37, label_key="carrefour",
                    label_raw="CARREFOUR", category_id=None)
        for offset in days
    ]
    report = detect_recurrences(rows, TODAY)
    assert report.recurrences == []
    assert report.rejected_irregular == 1


def test_the_operators_shape_yields_almost_nothing_and_says_so():
    """Two dense months, a nine-month hole, then two more. Intervals of 30, 30,
    275, 30 are not a rhythm, and the engine must decline rather than average
    them into a "quarterly" subscription."""
    rows = [
        RecurringTx(on=on, amount_cents=-1549, label_key="netflix",
                    label_raw="NETFLIX", category_id=None)
        for on in (date(2025, 1, 25), date(2025, 2, 24), date(2025, 3, 26),
                   date(2025, 12, 26), date(2026, 1, 5))
    ]
    report = detect_recurrences(rows, TODAY)
    assert report.recurrences == []
    assert report.notice is not None
    assert "3" in report.notice


def test_a_price_rise_is_found_and_measured():
    """The spec's own example: Netflix 13,49 EUR -> 15,99 EUR, +18,5 %."""
    old = _monthly("netflix", -1349, date(2025, 9, 10), 4)
    new = _monthly("netflix", -1599, date(2026, 1, 10), 4)
    report = detect_recurrences(old + new, TODAY)

    change = report.recurrences[0].price_change
    assert change is not None
    assert change.previous_cents == -1349
    assert change.current_cents == -1599
    assert change.changed_on.year == 2026 and change.changed_on.month == 1
    assert change.ratio == pytest.approx(0.185, abs=0.002)


def test_after_a_price_rise_the_current_level_is_the_new_price():
    """The annual cost has to be built on what is billed now, not on the median
    of the whole history -- which would understate every raised subscription."""
    rows = _monthly("netflix", -1349, date(2025, 9, 10), 4) + _monthly("netflix", -1599, date(2026, 1, 10), 4)
    found = detect_recurrences(rows, TODAY).recurrences[0]
    assert found.amount_cents == -1599
    assert found.annual_cents == -1599 * 12


def test_a_one_cent_wobble_is_not_a_price_rise():
    amounts = [-1549, -1549, -1550, -1549, -1550, -1549]
    dates = [date(2025, 9, 10) + timedelta(days=30 * i) for i in range(6)]
    assert find_price_change(amounts, dates) is None


def test_a_change_needs_two_occurrences_on_each_side():
    """One 15,99 EUR charge after five at 13,49 EUR could be a one-off
    adjustment. Two makes it a level."""
    dates = [date(2025, 9, 10) + timedelta(days=30 * i) for i in range(6)]
    assert find_price_change([-1349] * 5 + [-1599], dates) is None
    assert find_price_change([-1349] * 4 + [-1599] * 2, dates) is not None


def test_a_debit_that_stopped_arriving_is_flagged_missing():
    """Monthly until March, nothing since, and today is August. Expected on the
    10th of April and never came."""
    rows = _monthly("salle de sport", -3990, date(2026, 1, 10), 3)
    report = detect_recurrences(rows, date(2026, 4, 25))
    assert report.recurrences[0].status == "missing"
    assert report.recurrences[0].expected_next_on.month == 4


def test_a_debit_missing_for_two_whole_periods_is_ended_not_missing():
    """"Missing" is an alert worth acting on; a subscription cancelled six
    months ago is not. Two periods of silence is the line."""
    rows = _monthly("salle de sport", -3990, date(2025, 9, 10), 4)
    report = detect_recurrences(rows, TODAY)
    assert report.recurrences[0].status == "ended"


def test_a_debit_still_within_its_window_is_active():
    rows = _monthly("netflix", -1549, date(2026, 3, 10), 6)
    report = detect_recurrences(rows, date(2026, 8, 12))
    assert report.recurrences[0].status == "active"


def test_the_annual_subscription_total_covers_only_live_expenses():
    """Income is a recurrence too and belongs in the list, but a salary is not
    a subscription cost. Neither is a cancelled gym membership."""
    live = _monthly("netflix", -1549, date(2026, 3, 10), 6)
    salary = _monthly("salaire", 220000, date(2026, 3, 5), 6)
    dead = _monthly("salle de sport", -3990, date(2025, 2, 10), 4)
    report = detect_recurrences(live + salary + dead, TODAY)

    assert report.annual_subscription_cents == -1549 * 12
    assert report.monthly_subscription_cents == -1549
    assert {r.label_key for r in report.recurrences} >= {"netflix", "salaire"}


def test_the_recurring_key_set_is_exposed_for_the_forecast():
    rows = _monthly("netflix", -1549, date(2026, 3, 10), 6)
    report = detect_recurrences(rows, TODAY)
    assert report.recurring_keys == frozenset({"netflix"})


def test_the_most_expensive_recurrence_comes_first():
    cheap = _monthly("spotify", -1199, date(2026, 3, 10), 6)
    dear = _monthly("loyer", -78000, date(2026, 3, 5), 6)
    report = detect_recurrences(cheap + dear, TODAY)
    assert [r.label_key for r in report.recurrences] == ["loyer", "spotify"]


def test_an_empty_ledger_produces_an_empty_report_not_a_crash():
    report = detect_recurrences([], TODAY)
    assert report.recurrences == []
    assert report.annual_subscription_cents == 0
    assert report.notice is not None
```

- [ ] **Step 2: Run the test to verify it fails**

Run from `backend/`: `.venv/Scripts/pytest.exe tests/test_recurrence.py -v`
Expected: FAIL — `ImportError: cannot import name 'classify_period'`

- [ ] **Step 3: Write the implementation**

Append to `backend/app/engines/recurrence.py`, below the `RecurringTx` dataclass created in task 2:

```python
from collections import Counter
from datetime import timedelta
from typing import Literal

from app.engines.robust import describe, median_cents

Periodicity = Literal["weekly", "biweekly", "monthly", "quarterly", "yearly"]
RecurrenceStatus = Literal["active", "missing", "ended"]
Confidence = Literal["probable", "confirmed"]

# (name, nominal interval in days, tolerance in days). The tolerances do not
# overlap -- [5,9], [11,17], [25,35], [81,101], [335,395] -- so a median
# interval matches at most one shape and there is no precedence to argue about.
# 30 +/- 5 covers every calendar month plus the weekend drift a direct debit
# picks up when the due date falls on a Saturday.
PERIODS: tuple[tuple[Periodicity, int, int], ...] = (
    ("weekly", 7, 2),
    ("biweekly", 14, 3),
    ("monthly", 30, 5),
    ("quarterly", 91, 10),
    ("yearly", 365, 30),
)

OCCURRENCES_PER_YEAR: dict[Periodicity, int] = {
    "weekly": 52, "biweekly": 26, "monthly": 12, "quarterly": 4, "yearly": 1,
}

# Three charges give two intervals -- the minimum from which regularity can be
# tested at all. Two charges give one interval and no way to tell a rhythm from
# a coincidence, so two is never a recurrence.
MIN_OCCURRENCES = 3
# Four or more, having already passed the regularity test, is called confirmed.
# Exactly three is reported as probable and the screen says so.
CONFIRMED_OCCURRENCES = 4

# How far the intervals may wander from their own median and still count as
# regular: a quarter of the period, with a two-day floor so a weekly charge is
# not held to 1.75 days.
MAX_INTERVAL_MAD_RATIO = 0.25
MIN_INTERVAL_MAD_DAYS = 2

# A level change below 2 % is rounding, a VAT tweak or a partial month -- not a
# price rise worth telling anyone about.
PRICE_CHANGE_MIN_RATIO = 0.02
# Two occurrences on each side: one charge at a new amount is an adjustment,
# two is a level.
MIN_SIDE_OCCURRENCES = 2


@dataclass(frozen=True)
class PriceChange:
    previous_cents: int
    current_cents: int
    changed_on: date
    # A ratio, not money: 0.185 is +18,5 %. Signed -- a fall is a real result.
    ratio: float
    # Index, within the recurrence's own occurrences, of the first charge at the
    # new level. What lets the caller take the current level rather than the
    # median of the whole history.
    occurrence_index: int


@dataclass(frozen=True)
class Recurrence:
    label_key: str
    # The most recent raw label, for display. The key is for grouping only.
    label: str
    category_id: int | None
    periodicity: Periodicity
    occurrences: int
    first_on: date
    last_on: date
    median_interval_days: int
    # The level billed *now*: after a price rise this is the new price, not the
    # median of the whole history. Signed -- negative for an expense.
    amount_cents: int
    # MAD of the amounts at the current level: how much this charge wobbles.
    amount_spread_cents: int
    # This recurrence annualised at its current level, signed. A property of the
    # recurrence itself -- the report's subscription total decides separately
    # which of these to add up.
    annual_cents: int
    expected_next_on: date
    status: RecurrenceStatus
    confidence: Confidence
    price_change: PriceChange | None


@dataclass(frozen=True)
class RecurrenceReport:
    recurrences: list[Recurrence]
    # The label keys that belong to a detected recurrence. The cash-flow
    # forecast subtracts these rows from the historical series before measuring
    # its residual, so a rent payment is not counted once as a recurrence and
    # again inside the month's average.
    recurring_keys: frozenset[str]
    # Live expense recurrences only, annualised. Signed (negative).
    annual_subscription_cents: int
    monthly_subscription_cents: int
    analysed_groups: int
    rejected_thin: int
    rejected_irregular: int
    # French, and not None whenever nothing at all was detected: an empty list
    # with no explanation reads as "you have no subscriptions", which is a
    # different claim from "your history is too sparse to tell".
    notice: str | None


def _divide(total: int, divisor: int) -> int:
    """Integer division rounded half away from zero. Money never goes float."""
    quotient, remainder = divmod(abs(total), divisor)
    magnitude = quotient + (1 if remainder * 2 >= divisor else 0)
    return magnitude if total >= 0 else -magnitude


def classify_period(median_interval_days: int) -> Periodicity | None:
    """The billing rhythm a median interval matches, or None.

    None rather than the nearest match: a 20-day rhythm is not something anyone
    bills on, and rounding it to "monthly" would manufacture a subscription out
    of shopping noise.
    """
    for name, nominal, tolerance in PERIODS:
        if abs(median_interval_days - nominal) <= tolerance:
            return name
    return None


def find_price_change(amounts: list[int], dates: list[date]) -> PriceChange | None:
    """The largest sustained level change in a series of charges, if any.

    Every split with at least `MIN_SIDE_OCCURRENCES` charges on each side is
    tried; the winner is the one with the biggest step. A split only qualifies
    if the step clears both a relative floor (2 %, so rounding is not a rise)
    and the series' own noise (twice the larger of the two sides' MAD, so a
    charge that always wobbles is not read as having jumped).
    """
    best: PriceChange | None = None
    best_step = 0
    for split in range(MIN_SIDE_OCCURRENCES, len(amounts) - MIN_SIDE_OCCURRENCES + 1):
        before = describe(amounts[:split])
        after = describe(amounts[split:])
        if before.median == 0:
            continue
        step = after.median - before.median
        ratio = step / abs(before.median)
        if abs(ratio) < PRICE_CHANGE_MIN_RATIO:
            continue
        if abs(step) <= 2 * max(before.mad, after.mad):
            continue
        if abs(step) > best_step:
            best_step = abs(step)
            best = PriceChange(
                previous_cents=before.median,
                current_cents=after.median,
                changed_on=dates[split],
                ratio=ratio,
                occurrence_index=split,
            )
    return best


def detect_recurrences(
    transactions: list[RecurringTx], today: date
) -> RecurrenceReport:
    """Group, test for regularity, and describe what survives.

    Grouping is by label key **alone**, never by label and amount together: a
    price rise is a change of amount inside one recurrence, and grouping on
    amount would split Netflix in two and then be unable to notice that one
    replaced the other. Amount is used *within* a group instead, to locate the
    level change.

    Known limitation, documented rather than patched: a bank that appends a
    varying reference which `normalize_label` does not strip will fragment one
    subscription into several groups, each too thin to qualify. The engine will
    then report nothing rather than something wrong.
    """
    groups: dict[str, list[RecurringTx]] = {}
    for tx in transactions:
        if not tx.label_key:
            continue
        groups.setdefault(tx.label_key, []).append(tx)

    recurrences: list[Recurrence] = []
    rejected_thin = 0
    rejected_irregular = 0

    for key in sorted(groups):
        rows = sorted(groups[key], key=lambda row: row.on)
        if len(rows) < MIN_OCCURRENCES:
            rejected_thin += 1
            continue

        dates = [row.on for row in rows]
        intervals = [(dates[i] - dates[i - 1]).days for i in range(1, len(dates))]
        interval_spread = describe(intervals)
        periodicity = classify_period(interval_spread.median)
        allowed_wobble = max(
            MIN_INTERVAL_MAD_DAYS,
            round(interval_spread.median * MAX_INTERVAL_MAD_RATIO),
        )
        if periodicity is None or interval_spread.mad > allowed_wobble:
            rejected_irregular += 1
            continue

        amounts = [row.amount_cents for row in rows]
        change = find_price_change(amounts, dates)
        current_level = amounts[change.occurrence_index:] if change else amounts
        level_spread = describe(current_level)
        amount_cents = level_spread.median

        interval_days = interval_spread.median
        expected_next = dates[-1] + timedelta(days=interval_days)
        # A grace period proportional to the rhythm: a weekly charge two days
        # late is nothing, a yearly one two days late is nothing either.
        grace = max(3, round(interval_days * 0.2))
        if today <= expected_next + timedelta(days=grace):
            status: RecurrenceStatus = "active"
        elif today <= dates[-1] + timedelta(days=2 * interval_days + grace):
            status = "missing"
        else:
            status = "ended"

        categories = Counter(row.category_id for row in rows if row.category_id is not None)
        category_id = categories.most_common(1)[0][0] if categories else None

        recurrences.append(Recurrence(
            label_key=key,
            label=rows[-1].label_raw,
            category_id=category_id,
            periodicity=periodicity,
            occurrences=len(rows),
            first_on=dates[0],
            last_on=dates[-1],
            median_interval_days=interval_days,
            amount_cents=amount_cents,
            amount_spread_cents=level_spread.mad,
            annual_cents=amount_cents * OCCURRENCES_PER_YEAR[periodicity],
            expected_next_on=expected_next,
            status=status,
            confidence="confirmed" if len(rows) >= CONFIRMED_OCCURRENCES else "probable",
            price_change=change,
        ))

    # Most expensive first: the reader opens this screen to find what to cancel.
    recurrences.sort(key=lambda item: abs(item.annual_cents), reverse=True)

    annual = sum(
        item.annual_cents
        for item in recurrences
        if item.annual_cents < 0 and item.status != "ended"
    )

    notice: str | None = None
    if not recurrences:
        notice = (
            f"Aucune récurrence détectée : il faut au moins {MIN_OCCURRENCES} "
            "opérations portant le même libellé, espacées d'intervalles réguliers. "
            "Importez davantage de relevés et cette liste se remplira."
        )

    return RecurrenceReport(
        recurrences=recurrences,
        recurring_keys=frozenset(item.label_key for item in recurrences),
        annual_subscription_cents=annual,
        monthly_subscription_cents=_divide(annual, 12),
        analysed_groups=len(groups),
        rejected_thin=rejected_thin,
        rejected_irregular=rejected_irregular,
        notice=notice,
    )
```

Add `Counter`, `timedelta` and `Literal` to the module's imports, and keep `dataclass` / `date` from the task-2 header.

- [ ] **Step 4: Run the test to verify it passes**

Run from `backend/`: `.venv/Scripts/pytest.exe tests/test_recurrence.py -v`
Expected: PASS, 18 tests.

- [ ] **Step 5: Run the whole backend suite and commit**

Run from `backend/`: `.venv/Scripts/pytest.exe -q` → 326 passed.

```bash
git add backend/app/engines/recurrence.py backend/tests/test_recurrence.py
git commit -m "feat(engines): detect recurring charges, price rises and missing debits"
```

---

### Task 8: Recurrences API

**Files:**
- Create: `backend/app/schemas/recurrences.py`
- Create: `backend/app/api/recurrences.py`
- Modify: `backend/app/main.py`
- Test: `backend/tests/test_recurrences_api.py`

**Interfaces:**
- Consumes: `app.api.common.recurrence_points`, `app.engines.recurrence.detect_recurrences`.
- Produces:
  - `GET /api/recurrences` → `RecurrenceReportOut`. No date parameters: detection always runs over the whole ledger, because a monthly charge cannot be recognised from one month of statements and a period-scoped detection would report a different set of subscriptions on every filter change.
  - `RecurrenceOut{label, label_key, category_id, category_name, category_color, periodicity, occurrences, first_on, last_on, median_interval_days, amount_cents, amount_spread_cents, annual_cents, expected_next_on, status, confidence, price_change}`
  - `PriceChangeOut{previous_cents, current_cents, changed_on, ratio}`
  - `RecurrenceReportOut{recurrences, annual_subscription_cents, monthly_subscription_cents, analysed_groups, rejected_thin, rejected_irregular, notice, missing_count, price_change_count}`
  - Task 9 consumes it. Task 12 calls `detect_recurrences` again for the forecast rather than this endpoint.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_recurrences_api.py`:

```python
from datetime import date, timedelta


def _seed_monthly(client, headers, account_id, label, amount, start, count):
    """Write a monthly charge straight through the transactions API is not
    possible (there is no POST), so this uses the import pipeline's own commit
    path via a small CSV built in memory."""
    rows = ["date;libelle;montant"]
    for index in range(count):
        month = start.month - 1 + index
        year = start.year + month // 12
        on = date(year, month % 12 + 1, start.day)
        rows.append(f"{on.strftime('%d/%m/%Y')};{label};{amount / 100:.2f}".replace(".", ","))
    csv = "\n".join(rows).encode("utf-8")

    preview = client.post("/api/imports/analyze", headers=headers,
                          files={"file": ("r.csv", csv, "text/csv")},
                          data={"account_id": str(account_id)}).json()
    client.post("/api/imports/commit", headers=headers, json={
        "upload_token": preview["upload_token"], "account_id": account_id,
        "dialect": preview["dialect"], "mapping": preview["suggested_mapping"],
        "overrides": {}, "keep_duplicates": [],
    })


def test_a_sparse_ledger_reports_nothing_and_explains_why(client, imported):
    """The Boursorama sample is four transactions over one week. Nothing in it
    is a recurrence, and the response must say so rather than return an
    unexplained empty list."""
    headers, _ = imported
    body = client.get("/api/recurrences", headers=headers).json()
    assert body["recurrences"] == []
    assert body["notice"] is not None
    assert "libellé" in body["notice"]


def test_a_monthly_charge_is_detected_and_annualised(client, imported):
    headers, account_id = imported
    _seed_monthly(client, headers, account_id, "PRELEVEMENT SEPA NETFLIX",
                  -1549, date(2026, 1, 10), 6)

    body = client.get("/api/recurrences", headers=headers).json()
    found = next(r for r in body["recurrences"] if "NETFLIX" in r["label"])
    assert found["periodicity"] == "monthly"
    assert found["occurrences"] == 6
    assert found["amount_cents"] == -1549
    assert found["annual_cents"] == -1549 * 12
    assert found["expected_next_on"] > found["last_on"]


def test_the_subscription_totals_are_reported(client, imported):
    headers, account_id = imported
    _seed_monthly(client, headers, account_id, "PRELEVEMENT SEPA NETFLIX",
                  -1549, date(2026, 1, 10), 6)

    body = client.get("/api/recurrences", headers=headers).json()
    assert body["annual_subscription_cents"] <= -1549 * 12
    assert body["monthly_subscription_cents"] < 0


def test_a_price_rise_is_carried_through_to_the_wire(client, imported):
    headers, account_id = imported
    _seed_monthly(client, headers, account_id, "PRELEVEMENT SEPA NETFLIX",
                  -1349, date(2025, 6, 10), 4)
    _seed_monthly(client, headers, account_id, "PRELEVEMENT SEPA NETFLIX",
                  -1599, date(2025, 10, 10), 4)

    body = client.get("/api/recurrences", headers=headers).json()
    found = next(r for r in body["recurrences"] if "NETFLIX" in r["label"])
    assert found["price_change"] is not None
    assert found["price_change"]["previous_cents"] == -1349
    assert found["price_change"]["current_cents"] == -1599
    assert body["price_change_count"] >= 1


def test_the_category_name_travels_with_the_recurrence(client, imported):
    headers, account_id = imported
    _seed_monthly(client, headers, account_id, "PRELEVEMENT SEPA NETFLIX",
                  -1549, date(2026, 1, 10), 6)
    body = client.get("/api/recurrences", headers=headers).json()
    found = next(r for r in body["recurrences"] if "NETFLIX" in r["label"])
    # The builtin rules file streaming under Abonnements; if they did not match,
    # the name is null rather than a guess.
    assert found["category_name"] is None or isinstance(found["category_name"], str)


def test_internal_transfers_are_never_reported_as_subscriptions(client, imported):
    headers, account_id = imported
    _seed_monthly(client, headers, account_id, "VIREMENT SEPA EMIS LIVRET A",
                  -50000, date(2026, 1, 5), 6)
    transactions = client.get("/api/transactions?limit=200", headers=headers).json()["items"]
    livret = [t for t in transactions if "LIVRET" in t["label_raw"]]
    for row in livret:
        client.patch(f"/api/transactions/{row['id']}", headers=headers,
                     json={"is_transfer": True})

    body = client.get("/api/recurrences", headers=headers).json()
    assert all("LIVRET" not in r["label"] for r in body["recurrences"])


def test_recurrences_require_authentication(client, imported):
    assert client.get("/api/recurrences").status_code == 401


def test_recurrences_never_cross_users(client, imported):
    headers, account_id = imported
    _seed_monthly(client, headers, account_id, "PRELEVEMENT SEPA NETFLIX",
                  -1549, date(2026, 1, 10), 6)

    other = client.post("/api/auth/register", json={
        "name": "Autre", "email": "autre@example.com", "password": "motdepasse123"}).json()
    other_headers = {"Authorization": f"Bearer {other['access_token']}"}

    body = client.get("/api/recurrences", headers=other_headers).json()
    assert body["recurrences"] == []
    assert body["annual_subscription_cents"] == 0
```

- [ ] **Step 2: Run the test to verify it fails**

Run from `backend/`: `.venv/Scripts/pytest.exe tests/test_recurrences_api.py -v`
Expected: FAIL — 404 on every request.

- [ ] **Step 3: Write the schemas**

Create `backend/app/schemas/recurrences.py`:

```python
from datetime import date

from pydantic import BaseModel


class PriceChangeOut(BaseModel):
    previous_cents: int
    current_cents: int
    changed_on: date
    # Signed ratio, not money: 0.185 renders as "+18,5 %". A fall is negative
    # and is a real, reportable result.
    ratio: float


class RecurrenceOut(BaseModel):
    label: str
    label_key: str
    category_id: int | None
    category_name: str | None
    category_color: str | None
    periodicity: str
    occurrences: int
    first_on: date
    last_on: date
    median_interval_days: int
    # The level billed now, signed. After a rise this is the new price.
    amount_cents: int
    amount_spread_cents: int
    annual_cents: int
    expected_next_on: date
    status: str
    confidence: str
    price_change: PriceChangeOut | None


class RecurrenceReportOut(BaseModel):
    recurrences: list[RecurrenceOut]
    # Live expense recurrences only, signed (negative).
    annual_subscription_cents: int
    monthly_subscription_cents: int
    analysed_groups: int
    rejected_thin: int
    rejected_irregular: int
    # French, non-null whenever nothing was detected. The screen prints it
    # instead of an unexplained empty list.
    notice: str | None
    missing_count: int
    price_change_count: int
```

- [ ] **Step 4: Write the router**

Create `backend/app/api/recurrences.py`:

```python
from datetime import date

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.common import recurrence_points
from app.db import get_db
from app.engines.recurrence import detect_recurrences
from app.models import Category, User
from app.schemas.recurrences import PriceChangeOut, RecurrenceOut, RecurrenceReportOut
from app.security.deps import get_current_user

router = APIRouter(prefix="/recurrences", tags=["recurrences"])


@router.get("", response_model=RecurrenceReportOut)
def list_recurrences(
    user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> RecurrenceReportOut:
    """Every recurring charge in this user's whole ledger.

    Deliberately takes no date range. A monthly subscription cannot be
    recognised from one month of statements, and answering a filtered range
    would report a different set of subscriptions each time the reader changed
    the period -- which reads as the app changing its mind.
    """
    report = detect_recurrences(recurrence_points(db, user.id), date.today())
    names = {c.id: c for c in db.query(Category).filter(Category.user_id == user.id).all()}

    return RecurrenceReportOut(
        recurrences=[
            RecurrenceOut(
                label=item.label,
                label_key=item.label_key,
                category_id=item.category_id,
                category_name=names[item.category_id].name
                if item.category_id in names else None,
                category_color=names[item.category_id].color
                if item.category_id in names else None,
                periodicity=item.periodicity,
                occurrences=item.occurrences,
                first_on=item.first_on,
                last_on=item.last_on,
                median_interval_days=item.median_interval_days,
                amount_cents=item.amount_cents,
                amount_spread_cents=item.amount_spread_cents,
                annual_cents=item.annual_cents,
                expected_next_on=item.expected_next_on,
                status=item.status,
                confidence=item.confidence,
                price_change=PriceChangeOut(
                    previous_cents=item.price_change.previous_cents,
                    current_cents=item.price_change.current_cents,
                    changed_on=item.price_change.changed_on,
                    ratio=item.price_change.ratio,
                ) if item.price_change is not None else None,
            )
            for item in report.recurrences
        ],
        annual_subscription_cents=report.annual_subscription_cents,
        monthly_subscription_cents=report.monthly_subscription_cents,
        analysed_groups=report.analysed_groups,
        rejected_thin=report.rejected_thin,
        rejected_irregular=report.rejected_irregular,
        notice=report.notice,
        missing_count=sum(1 for item in report.recurrences if item.status == "missing"),
        price_change_count=sum(
            1 for item in report.recurrences if item.price_change is not None
        ),
    )
```

- [ ] **Step 5: Register the router**

In `backend/app/main.py`: `from app.api import recurrences as recurrence_routes` and `api.include_router(recurrence_routes.router)`.

- [ ] **Step 6: Run the tests to verify they pass**

Run from `backend/`: `.venv/Scripts/pytest.exe tests/test_recurrences_api.py -v`
Expected: PASS, 8 tests.

- [ ] **Step 7: Run the whole backend suite and commit**

Run from `backend/`: `.venv/Scripts/pytest.exe -q` → 334 passed.

```bash
git add backend/app/schemas/recurrences.py backend/app/api/recurrences.py backend/app/main.py backend/tests/test_recurrences_api.py
git commit -m "feat(api): expose detected recurrences, price rises and missing debits"
```

---

### Task 9: Récurrences screen

**Files:**
- Create: `frontend/src/features/recurrences/RecurrencesPage.tsx`
- Create: `frontend/src/features/recurrences/RecurrencesPage.css`
- Create: `frontend/src/features/recurrences/RecurrenceRow.tsx`
- Create: `frontend/src/features/recurrences/RecurrencesPage.test.tsx`
- Create: `frontend/src/features/recurrences/RecurrenceRow.test.tsx`
- Modify: `frontend/src/lib/types.ts`, `frontend/src/app/routes.tsx`, `frontend/src/app/AppShell.tsx`, `frontend/src/app/AppShell.test.tsx`

**Interfaces:**
- Consumes: `GET /api/recurrences` (task 8).
- Produces:
  - TS types `Periodicity`, `RecurrenceStatus`, `PriceChange`, `Recurrence`, `RecurrenceReport` in `lib/types.ts`.
  - `PERIODICITY_LABEL`, `formatRatio(ratio: number): string` and `<RecurrenceRow>` — `formatRatio` is reused by task 18's inflation table.
  - Route `/recurrences`, nav entry "Récurrences".

- [ ] **Step 1: Add the TypeScript payload types**

Append to `frontend/src/lib/types.ts`:

```ts
export type Periodicity = "weekly" | "biweekly" | "monthly" | "quarterly" | "yearly";
export type RecurrenceStatus = "active" | "missing" | "ended";
export type RecurrenceConfidence = "probable" | "confirmed";

export interface PriceChange {
  previous_cents: number;
  current_cents: number;
  changed_on: string;
  /** Signed ratio, not money: 0.185 renders as "+18,5 %". */
  ratio: number;
}

export interface Recurrence {
  label: string;
  label_key: string;
  category_id: number | null;
  category_name: string | null;
  category_color: string | null;
  periodicity: Periodicity;
  occurrences: number;
  first_on: string;
  last_on: string;
  median_interval_days: number;
  /** The level billed now, signed. After a rise this is the new price. */
  amount_cents: number;
  amount_spread_cents: number;
  annual_cents: number;
  expected_next_on: string;
  status: RecurrenceStatus;
  confidence: RecurrenceConfidence;
  price_change: PriceChange | null;
}

export interface RecurrenceReport {
  recurrences: Recurrence[];
  annual_subscription_cents: number;
  monthly_subscription_cents: number;
  analysed_groups: number;
  rejected_thin: number;
  rejected_irregular: number;
  /** French, non-null whenever nothing was detected. Print it. */
  notice: string | null;
  missing_count: number;
  price_change_count: number;
}
```

- [ ] **Step 2: Write the failing test for `RecurrenceRow`**

Create `frontend/src/features/recurrences/RecurrenceRow.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { Recurrence } from "../../lib/types";
import { formatRatio, RecurrenceRow } from "./RecurrenceRow";

const base: Recurrence = {
  label: "PRELEVEMENT SEPA NETFLIX INTERNATIONAL BV",
  label_key: "prelevement sepa netflix international bv",
  category_id: 12,
  category_name: "Streaming",
  category_color: "#7ee2d6",
  periodicity: "monthly",
  occurrences: 8,
  first_on: "2025-09-10",
  last_on: "2026-04-10",
  median_interval_days: 30,
  amount_cents: -1599,
  amount_spread_cents: 0,
  annual_cents: -19188,
  expected_next_on: "2026-05-10",
  status: "active",
  confidence: "confirmed",
  price_change: null,
};

describe("formatRatio", () => {
  it("writes a rise with a sign and one decimal, French style", () => {
    expect(formatRatio(0.185)).toBe("+18,5 %");
  });

  it("writes a fall with a typographic minus", () => {
    expect(formatRatio(-0.072)).toBe("−7,2 %");
  });
});

describe("RecurrenceRow", () => {
  it("names the charge, its rhythm and what it costs a year", () => {
    render(<RecurrenceRow recurrence={base} />);
    expect(screen.getByText(/NETFLIX/)).toBeInTheDocument();
    expect(screen.getByText("Mensuel")).toBeInTheDocument();
    expect(screen.getByText(/191,88/)).toBeInTheDocument();
  });

  it("states a price rise with both amounts and the percentage", () => {
    render(
      <RecurrenceRow
        recurrence={{
          ...base,
          price_change: {
            previous_cents: -1349, current_cents: -1599,
            changed_on: "2026-01-10", ratio: 0.1853,
          },
        }}
      />,
    );
    expect(screen.getByText(/13,49/)).toBeInTheDocument();
    expect(screen.getByText(/15,99/)).toBeInTheDocument();
    expect(screen.getByText(/\+18,5 %/)).toBeInTheDocument();
    expect(screen.getByText(/janvier 2026/)).toBeInTheDocument();
  });

  it("says when an expected debit did not arrive", () => {
    render(<RecurrenceRow recurrence={{ ...base, status: "missing" }} />);
    expect(screen.getByText(/Attendu le/)).toBeInTheDocument();
  });

  it("marks a three-occurrence detection as uncertain in words", () => {
    render(<RecurrenceRow recurrence={{ ...base, occurrences: 3, confidence: "probable" }} />);
    expect(screen.getByText(/Probable/)).toBeInTheDocument();
    expect(screen.getByText(/3 occurrences/)).toBeInTheDocument();
  });

  it("does not claim uncertainty it does not have", () => {
    render(<RecurrenceRow recurrence={base} />);
    expect(screen.queryByText(/Probable/)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run it to verify it fails, then write `RecurrenceRow`**

Run from `frontend/`: `npm test -- RecurrenceRow` → FAIL, module not found.

Create `frontend/src/features/recurrences/RecurrenceRow.tsx`:

```tsx
import { frenchDate } from "../../design/EmptyState";
import { formatCents } from "../../design/theme";
import type { Periodicity, Recurrence, RecurrenceStatus } from "../../lib/types";

export const PERIODICITY_LABEL: Record<Periodicity, string> = {
  weekly: "Hebdomadaire",
  biweekly: "Toutes les deux semaines",
  monthly: "Mensuel",
  quarterly: "Trimestriel",
  yearly: "Annuel",
};

const STATUS_LABEL: Record<RecurrenceStatus, string> = {
  active: "Actif",
  missing: "Prélèvement manquant",
  ended: "Interrompu",
};

/**
 * A signed ratio as a French percentage with one decimal: 0.185 → "+18,5 %".
 * Uses the same typographic minus as `formatCents` so a column of figures and
 * a column of percentages line up on the same glyph.
 */
export function formatRatio(ratio: number): string {
  const percent = Math.abs(ratio * 100).toLocaleString("fr-FR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  const sign = ratio < 0 ? "−" : "+";
  return `${sign}${percent} %`;
}

interface RecurrenceRowProps {
  recurrence: Recurrence;
}

export function RecurrenceRow({ recurrence }: RecurrenceRowProps) {
  const change = recurrence.price_change;

  return (
    <li className={`yd-recurrence yd-recurrence--${recurrence.status}`}>
      <div className="yd-recurrence__head">
        <span className="yd-recurrence__label">{recurrence.label}</span>
        <span className="yd-recurrence__amount">{formatCents(recurrence.amount_cents)}</span>
      </div>

      <p className="yd-recurrence__meta">
        <span className="yd-recurrence__periodicity">
          {PERIODICITY_LABEL[recurrence.periodicity]}
        </span>
        {recurrence.category_name ? ` · ${recurrence.category_name}` : ""}
        {` · ${formatCents(Math.abs(recurrence.annual_cents))} par an`}
      </p>

      <p className="yd-recurrence__status">
        <span className={`yd-recurrence__badge yd-recurrence__badge--${recurrence.status}`}>
          {STATUS_LABEL[recurrence.status]}
        </span>
        {recurrence.status === "missing"
          ? ` — Attendu le ${frenchDate(recurrence.expected_next_on)}, jamais arrivé.`
          : recurrence.status === "active"
            ? ` — Prochain prélèvement attendu le ${frenchDate(recurrence.expected_next_on)}.`
            : ` — Dernier prélèvement le ${frenchDate(recurrence.last_on)}.`}
      </p>

      {/* Confidence is stated in words, never implied by a lighter colour: three
          occurrences is the floor at which regularity can be tested at all, and
          the reader is entitled to know this one rests on it. */}
      {recurrence.confidence === "probable" ? (
        <p className="yd-recurrence__confidence">
          {`Probable — détecté sur ${recurrence.occurrences} occurrences seulement.`}
        </p>
      ) : null}

      {change !== null ? (
        <p className="yd-recurrence__change">
          {`${formatCents(Math.abs(change.previous_cents))} → ${formatCents(Math.abs(change.current_cents))} en ${frenchDate(change.changed_on)}, `}
          <strong>{formatRatio(change.ratio)}</strong>
        </p>
      ) : null}
    </li>
  );
}
```

- [ ] **Step 4: Write the failing test for `RecurrencesPage`**

Create `frontend/src/features/recurrences/RecurrencesPage.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "../../app/ThemeProvider";
import type { RecurrenceReport } from "../../lib/types";
import { RecurrencesPage } from "./RecurrencesPage";

const fetchMock = vi.fn();

const netflix = {
  label: "PRELEVEMENT SEPA NETFLIX", label_key: "netflix",
  category_id: 12, category_name: "Streaming", category_color: "#7ee2d6",
  periodicity: "monthly" as const, occurrences: 8,
  first_on: "2025-09-10", last_on: "2026-04-10", median_interval_days: 30,
  amount_cents: -1599, amount_spread_cents: 0, annual_cents: -19188,
  expected_next_on: "2026-05-10", status: "active" as const,
  confidence: "confirmed" as const,
  price_change: { previous_cents: -1349, current_cents: -1599, changed_on: "2026-01-10", ratio: 0.1853 },
};

const gym = {
  ...netflix, label: "PRELEVEMENT SEPA SALLE DE SPORT", label_key: "salle",
  amount_cents: -3990, annual_cents: -47880, status: "missing" as const,
  price_change: null, expected_next_on: "2026-05-10",
};

const report: RecurrenceReport = {
  recurrences: [gym, netflix],
  annual_subscription_cents: -67068,
  monthly_subscription_cents: -5589,
  analysed_groups: 22, rejected_thin: 14, rejected_irregular: 6,
  notice: null, missing_count: 1, price_change_count: 1,
};

const emptyReport: RecurrenceReport = {
  recurrences: [], annual_subscription_cents: 0, monthly_subscription_cents: 0,
  analysed_groups: 22, rejected_thin: 20, rejected_irregular: 2,
  notice: "Aucune récurrence détectée : il faut au moins 3 opérations portant le même libellé, espacées d'intervalles réguliers.",
  missing_count: 0, price_change_count: 0,
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function setupFetch(response: () => Response = () => jsonResponse(report)) {
  fetchMock.mockImplementation((input: string) => {
    const url = new URL(typeof input === "string" ? input : String(input), "http://localhost");
    if (url.pathname === "/api/recurrences") return Promise.resolve(response());
    throw new Error(`Unhandled fetch in test: ${url.pathname}`);
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false, media: query,
      addEventListener: vi.fn(), removeEventListener: vi.fn(),
      addListener: vi.fn(), removeListener: vi.fn(),
    })),
  });
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/recurrences"]}>
      <ThemeProvider>
        <RecurrencesPage />
      </ThemeProvider>
    </MemoryRouter>,
  );
}

describe("RecurrencesPage", () => {
  it("states the annual and monthly subscription cost", async () => {
    setupFetch();
    renderPage();
    expect(await screen.findByText(/670,68/)).toBeInTheDocument();
    expect(screen.getByText(/55,89/)).toBeInTheDocument();
  });

  it("lists every detected recurrence", async () => {
    setupFetch();
    renderPage();
    await screen.findByText(/NETFLIX/);
    expect(screen.getAllByRole("listitem").length).toBeGreaterThanOrEqual(2);
  });

  it("calls out the missing debits and the price rises separately", async () => {
    setupFetch();
    renderPage();
    expect(await screen.findByText(/1 prélèvement attendu et jamais arrivé/)).toBeInTheDocument();
    expect(screen.getByText(/1 hausse de prix/)).toBeInTheDocument();
  });

  it("prints the backend's explanation instead of an unexplained empty list", async () => {
    setupFetch(() => jsonResponse(emptyReport));
    renderPage();
    expect(await screen.findByText(/au moins 3 opérations/)).toBeInTheDocument();
  });

  it("says how many groups were examined and rejected, so the emptiness is legible", async () => {
    setupFetch(() => jsonResponse(emptyReport));
    renderPage();
    expect(await screen.findByText(/22 libellés examinés/)).toBeInTheDocument();
  });

  it("surfaces a failed load in French", async () => {
    setupFetch(() => jsonResponse({ detail: "Base indisponible" }, 500));
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent("Base indisponible");
  });
});
```

- [ ] **Step 5: Run it to verify it fails, then write `RecurrencesPage`**

Run from `frontend/`: `npm test -- RecurrencesPage` → FAIL, module not found.

Create `frontend/src/features/recurrences/RecurrencesPage.tsx`:

```tsx
import { motion } from "motion/react";
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router";

import { BentoCell, type BentoSpan } from "../../design/bento/BentoCell";
import { BentoGrid } from "../../design/bento/BentoGrid";
import { CountUp } from "../../design/CountUp";
import { EmptyState } from "../../design/EmptyState";
import { useReducedMotion } from "../../design/motion/useReducedMotion";
import { entryProps, staggerProps } from "../../design/motion/variants";
import { formatCents } from "../../design/theme";
import { ApiError, api } from "../../lib/api";
import { plural } from "../../lib/plural";
import type { RecurrenceReport } from "../../lib/types";
import { RecurrenceRow } from "./RecurrenceRow";
import "./RecurrencesPage.css";

const GENERIC_ERROR = "Une erreur inattendue est survenue.";

function messageFor(err: unknown): string {
  return err instanceof ApiError ? err.detail : GENERIC_ERROR;
}

const SPAN = {
  cost: { base: 1, md: 6, lg: 5 },
  alerts: { base: 1, md: 6, lg: 7 },
  list: { base: 1, md: 6, lg: 12 },
  empty: { base: 1, md: 6, lg: 12 },
} satisfies Record<string, BentoSpan>;

export function RecurrencesPage() {
  const reduced = useReducedMotion();
  const [report, setReport] = useState<RecurrenceReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const body = await api.get<RecurrenceReport>("/recurrences");
        if (cancelled) return;
        setReport(body);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setReport(null);
        setError(messageFor(err));
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  let body: ReactNode;
  if (isLoading) {
    body = (
      <BentoGrid role="status" aria-busy="true" aria-label="Chargement des récurrences">
        <BentoCell span={SPAN.cost} className="yd-panel">
          <div className="yd-skeleton yd-skeleton--title" aria-hidden="true" />
          <div className="yd-skeleton yd-skeleton--value" aria-hidden="true" />
        </BentoCell>
        <BentoCell span={SPAN.alerts} className="yd-panel">
          <div className="yd-skeleton yd-skeleton--title" aria-hidden="true" />
          <div className="yd-skeleton yd-skeleton--meta" aria-hidden="true" />
        </BentoCell>
        <BentoCell span={SPAN.list} className="yd-panel">
          <div className="yd-skeleton yd-skeleton--chart" aria-hidden="true" />
        </BentoCell>
      </BentoGrid>
    );
  } else if (report === null) {
    body = null;
  } else if (report.recurrences.length === 0) {
    body = (
      <BentoGrid as={motion.div} {...staggerProps(reduced)}>
        <BentoCell as={motion.div} span={SPAN.empty} {...entryProps(reduced)}>
          <EmptyState
            title="Aucune récurrence détectée."
            // The backend's own sentence, not a paraphrase: it knows precisely
            // what was missing, and an empty list with no reason reads as
            // "you have no subscriptions", which is a different claim.
            detail={report.notice}
          >
            <p className="yd-recurrences__audit">
              {`${report.analysed_groups} ${plural(report.analysed_groups, "libellé examiné", "libellés examinés")} : `}
              {`${report.rejected_thin} ${plural(report.rejected_thin, "trop peu fréquent", "trop peu fréquents")}, `}
              {`${report.rejected_irregular} ${plural(report.rejected_irregular, "trop irrégulier", "trop irréguliers")}.`}
            </p>
            <Link to="/import" className="yd-empty__action">
              Importer d'autres relevés
            </Link>
          </EmptyState>
        </BentoCell>
      </BentoGrid>
    );
  } else {
    body = (
      <BentoGrid as={motion.div} {...staggerProps(reduced)}>
        <BentoCell as={motion.div} span={SPAN.cost} className="yd-panel" {...entryProps(reduced)}>
          <h2 className="yd-panel__title">Coût des abonnements</h2>
          <CountUp
            value={Math.abs(report.annual_subscription_cents)}
            format={(cents) => formatCents(cents)}
            className="yd-recurrences__annual"
          />
          <p className="yd-recurrences__annual-note">
            {`par an, soit ${formatCents(Math.abs(report.monthly_subscription_cents))} par mois`}
          </p>
          <p className="yd-recurrences__scope">
            Prélèvements actifs uniquement. Les revenus récurrents figurent dans la liste
            mais ne sont pas comptés ici.
          </p>
        </BentoCell>

        <BentoCell as={motion.div} span={SPAN.alerts} className="yd-panel" {...entryProps(reduced)}>
          <h2 className="yd-panel__title">À surveiller</h2>
          <ul className="yd-recurrences__alerts">
            <li>
              {report.missing_count === 0
                ? "Aucun prélèvement attendu ne manque à l'appel."
                : `${report.missing_count} ${plural(report.missing_count, "prélèvement attendu et jamais arrivé", "prélèvements attendus et jamais arrivés")}.`}
            </li>
            <li>
              {report.price_change_count === 0
                ? "Aucune hausse de prix détectée."
                : `${report.price_change_count} ${plural(report.price_change_count, "hausse de prix", "hausses de prix")} depuis le début de l'historique.`}
            </li>
          </ul>
        </BentoCell>

        <BentoCell as={motion.div} span={SPAN.list} className="yd-panel" {...entryProps(reduced)}>
          <h2 className="yd-panel__title">Toutes les récurrences</h2>
          <ul className="yd-recurrences__list">
            {report.recurrences.map((item) => (
              <RecurrenceRow key={item.label_key} recurrence={item} />
            ))}
          </ul>
        </BentoCell>
      </BentoGrid>
    );
  }

  return (
    <section className="yd-recurrences">
      <div className="yd-recurrences__header">
        <h1>Récurrences</h1>
      </div>

      {error !== null ? (
        <p role="alert" className="yd-recurrences__alert">
          {error}
        </p>
      ) : null}

      {body}
    </section>
  );
}
```

- [ ] **Step 6: Write the stylesheet**

Create `frontend/src/features/recurrences/RecurrencesPage.css`. The load-bearing rules:

```css
.yd-recurrences__header { margin-bottom: var(--yd-space-lg); }

.yd-recurrences__annual {
  font-family: var(--yd-font-mono);
  font-variant-numeric: tabular-nums;
  font-size: clamp(1.8rem, 5vw, 2.6rem);
  color: var(--yd-text);
}

.yd-recurrences__annual-note,
.yd-recurrences__scope,
.yd-recurrences__audit {
  margin: 0;
  color: var(--yd-text-muted);
  font-size: 0.86rem;
}

.yd-recurrences__list,
.yd-recurrences__alerts {
  list-style: none;
  margin: 0;
  padding: 0;
}

.yd-recurrences__list {
  display: grid;
  /* Two columns of subscriptions above 900px, one below. `minmax(0, 1fr)` and
     not `1fr`: a 76-character raw bank label sets the track's minimum width
     otherwise and pushes the grid past the viewport. */
  grid-template-columns: minmax(0, 1fr);
  gap: var(--yd-space-md);
}

@media (min-width: 900px) {
  .yd-recurrences__list {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

.yd-recurrence {
  display: flex;
  flex-direction: column;
  gap: var(--yd-space-2xs);
  padding: var(--yd-space-sm);
  border-radius: var(--yd-radius-sm);
  border: 1px solid var(--yd-border);
  background: var(--yd-surface);
}

.yd-recurrence__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--yd-space-xs);
}

.yd-recurrence__label {
  /* Raw bank labels reach 76 characters. Wrap rather than clip: the reader
     needs to recognise the merchant, and an ellipsis at 375px would cut every
     one of them at "PRELEVEMENT SEPA…". */
  overflow-wrap: anywhere;
  font-weight: 600;
  color: var(--yd-text);
}

.yd-recurrence__amount {
  flex: 0 0 auto;
  font-family: var(--yd-font-mono);
  font-variant-numeric: tabular-nums;
  color: var(--yd-text);
}

.yd-recurrence__meta,
.yd-recurrence__status,
.yd-recurrence__confidence,
.yd-recurrence__change {
  margin: 0;
  font-size: 0.86rem;
  color: var(--yd-text-muted);
}

.yd-recurrence__change { color: var(--yd-text); }

.yd-recurrence__badge {
  font-weight: 600;
  color: var(--yd-text);
}

/* Status colour reinforces the word, never replaces it (WCAG 1.4.1): every
   badge already carries "Actif" / "Prélèvement manquant" / "Interrompu". */
.yd-recurrence__badge--missing { color: var(--yd-warning); }
.yd-recurrence__badge--ended { color: var(--yd-text-muted); }

.yd-recurrence--missing { border-color: var(--yd-warning); }

.yd-recurrences__alert {
  margin: 0 0 var(--yd-space-md);
  padding: var(--yd-space-sm) var(--yd-space-md);
  border-radius: var(--yd-radius-sm);
  border: 1px solid var(--yd-negative);
  color: var(--yd-text);
}
```

- [ ] **Step 7: Register the route and the nav entry**

`routes.tsx`: import `RecurrencesPage`, add `{ path: "recurrences", element: <RecurrencesPage /> },`.
`AppShell.tsx`: add `{ to: "/recurrences", label: "Récurrences" },` after Budgets.
`AppShell.test.tsx`: update the nav assertions.

- [ ] **Step 8: Run the frontend suite**

Run from `frontend/`: `npm test` → PASS. `npm run build` → zero TypeScript errors.

- [ ] **Step 9: Browser verification**

Re-seed, start the app, log in, go to `/recurrences`.

**Expect this screen to be empty on the operator's fixture.** Intervals of 30, 30, 275, 30 days are not a rhythm and the engine declines — that is the correct answer, not a bug to fix. Screenshot the empty state too: it is the state the operator will actually see, and it has to read as an explanation rather than as a broken page.

Then, to see the populated state, import a second CSV holding a monthly charge across six consecutive months (build one with the helper shape used in `test_recurrences_api.py`), screenshot, and **roll that batch back** through `/import`'s history before finishing — the fixture must end the task at 197 transactions, exactly as phase 1.5's task 6 left it.

Screenshot all six combinations (375 / 768 / 1440 × clair / sombre), in **both** the empty and the populated state.

Check in the browser:

- [ ] The empty state prints the backend's French sentence and the audit line ("22 libellés examinés : 14 trop peu fréquents, 6 trop irréguliers"), and does not read as a failure.
- [ ] A 76-character raw label wraps inside its card at 375 px and does not push the grid horizontally. Confirm `document.documentElement.scrollWidth === document.documentElement.clientWidth`.
- [ ] The amount column stays on the label's baseline and does not collide with a long label at 375 px.
- [ ] `.yd-recurrence__badge--missing` on `--yd-warning` clears 4.5:1 over `--yd-surface` in **both** themes. `--yd-warning` is `#f4a261` in dark and `#8a4d08` in light; measure over the composited pixel, not over `--yd-bg`.
- [ ] The two-column list at 1440 px does not leave a lone card stranded in a column of its own with three times the height of its neighbour.
- [ ] Reduced motion on: cards are visible at full opacity, none stranded at `opacity: 0`.

- [ ] **Step 10: Commit**

```bash
git add frontend/src/features/recurrences frontend/src/lib/types.ts frontend/src/app/routes.tsx frontend/src/app/AppShell.tsx frontend/src/app/AppShell.test.tsx
git commit -m "feat(recurrences): add the subscriptions and direct debits screen"
```

---

# Lot D — Trésorerie : prévision et runway

### Task 10: Measured rate and runway engines

`capacity.py` answers "what does a month actually cost this household, and what does it actually save" from the ledger rather than from a declaration. It is the module **phase 2B's purchase-feasibility engine consumes** (design §6.3 item 1: "Capacité d'épargne réelle, mesurée sur les transactions des douze derniers mois, pas déclarée. Avec sa variabilité"), so its output shape is fixed here and should not be reshaped later.

**Files:**
- Create: `backend/app/engines/capacity.py`
- Create: `backend/app/engines/runway.py`
- Test: `backend/tests/test_capacity.py`
- Test: `backend/tests/test_runway.py`

**Interfaces:**
- Consumes: `app.engines.robust.{describe, median_cents, quantile_offset_cents}`, `app.engines.aggregate.bucket_bounds`.
- Produces, in `capacity.py`:
  - `MonthlyEntry(on: date, amount_cents: int)` — the minimal input shape. Callers build it from anything.
  - `MonthObservation(key: str, start: date, end: date, inflow_cents: int, outflow_cents: int, net_cents: int, count: int)`
  - `MeasuredRate(months: int, median_cents: int, spread_cents: int, low_cents: int, high_cents: int)`
  - `complete_months(entries: list[MonthlyEntry], ledger_start: date, ledger_end: date) -> list[MonthObservation]`
  - `measure_expense_rate(months: list[MonthObservation]) -> MeasuredRate | None` — positive magnitudes.
  - **`measure_savings_capacity(months: list[MonthObservation]) -> MeasuredRate | None`** — signed net. **Phase 2B consumes this.**
  - `MIN_MONTHS_FOR_RATE = 3`
- Produces, in `runway.py`:
  - `RunwayScenario(name: str, monthly_burn_cents: int, months: float | None, depleted_on: date | None)`
  - `RunwayReport(balance_cents, months_observed, normal, essentials, insufficient_reason)`
  - `compute_runway(balance_cents, all_months, essential_months, today) -> RunwayReport`
- Task 11 consumes `MonthObservation` and `complete_months`; task 12 consumes both modules.

- [ ] **Step 1: Write the failing test for `capacity`**

Create `backend/tests/test_capacity.py`:

```python
from datetime import date

from app.engines.capacity import (
    MIN_MONTHS_FOR_RATE,
    MonthlyEntry,
    complete_months,
    measure_expense_rate,
    measure_savings_capacity,
)

LEDGER_START = date(2025, 1, 24)
LEDGER_END = date(2026, 1, 9)


def _month(year: int, month: int, *amounts: int) -> list[MonthlyEntry]:
    return [MonthlyEntry(on=date(year, month, 5), amount_cents=amount) for amount in amounts]


def test_a_month_wholly_inside_the_ledger_with_activity_is_observed():
    entries = _month(2025, 2, 220_000, -180_000)
    months = complete_months(entries, LEDGER_START, LEDGER_END)
    assert [m.key for m in months] == ["2025-02"]
    assert months[0].inflow_cents == 220_000
    assert months[0].outflow_cents == -180_000
    assert months[0].net_cents == 40_000
    assert months[0].count == 2


def test_a_partial_month_at_either_end_of_the_ledger_is_not_observed():
    """The operator's ledger opens on 24 January and closes on 9 January. Those
    two months hold a week of statements each; counting them as months would
    make the measured rate a quarter of the truth."""
    entries = _month(2025, 1, -50_000) + _month(2026, 1, -50_000) + _month(2025, 2, -180_000)
    months = complete_months(entries, LEDGER_START, LEDGER_END)
    assert [m.key for m in months] == ["2025-02"]


def test_a_month_inside_the_ledger_with_no_activity_is_not_observed():
    """April to November 2025 are empty in the operator's data -- because no
    statement was imported, not because nothing was spent. Counting them as
    zero-spend months would halve every measured rate."""
    entries = _month(2025, 2, -180_000) + _month(2025, 12, -200_000)
    months = complete_months(entries, LEDGER_START, LEDGER_END)
    assert [m.key for m in months] == ["2025-02", "2025-12"]


def test_the_operators_shape_yields_exactly_three_observed_months():
    entries = (
        _month(2025, 1, -50_000)     # partial, dropped
        + _month(2025, 2, -180_000)
        + _month(2025, 3, -90_000)
        + _month(2025, 12, -210_000)
        + _month(2026, 1, -60_000)   # partial, dropped
    )
    assert len(complete_months(entries, LEDGER_START, LEDGER_END)) == 3


def test_the_expense_rate_is_a_positive_magnitude_with_a_band():
    entries = _month(2025, 2, -180_000) + _month(2025, 3, -200_000) + _month(2025, 12, -190_000)
    rate = measure_expense_rate(complete_months(entries, LEDGER_START, LEDGER_END))
    assert rate is not None
    assert rate.months == 3
    assert rate.median_cents == 190_000
    assert rate.low_cents < rate.median_cents < rate.high_cents


def test_one_extravagant_month_does_not_redefine_the_rate():
    entries = (
        _month(2025, 2, -180_000) + _month(2025, 3, -190_000)
        + _month(2025, 4, -185_000) + _month(2025, 5, -1_800_000)
    )
    rate = measure_expense_rate(complete_months(entries, date(2025, 2, 1), date(2025, 5, 31)))
    assert rate is not None
    # The median sits between the three ordinary months, not between them and
    # the outlier -- which is the whole reason the method is robust.
    assert 180_000 <= rate.median_cents <= 190_000


def test_fewer_than_three_months_measures_nothing():
    entries = _month(2025, 2, -180_000) + _month(2025, 3, -200_000)
    assert measure_expense_rate(complete_months(entries, LEDGER_START, LEDGER_END)) is None
    assert MIN_MONTHS_FOR_RATE == 3


def test_savings_capacity_is_the_signed_monthly_net():
    """Phase 2B's purchase-feasibility engine reads exactly this. A household
    that overspends has a negative capacity, and that must survive to the
    caller rather than being clamped to zero."""
    entries = (
        _month(2025, 2, 220_000, -180_000)
        + _month(2025, 3, 220_000, -240_000)
        + _month(2025, 12, 220_000, -200_000)
    )
    capacity = measure_savings_capacity(complete_months(entries, LEDGER_START, LEDGER_END))
    assert capacity is not None
    assert capacity.median_cents == 20_000
    assert capacity.months == 3


def test_savings_capacity_reports_a_negative_median_rather_than_zero():
    entries = (
        _month(2025, 2, 200_000, -240_000)
        + _month(2025, 3, 200_000, -230_000)
        + _month(2025, 12, 200_000, -250_000)
    )
    capacity = measure_savings_capacity(complete_months(entries, LEDGER_START, LEDGER_END))
    assert capacity is not None and capacity.median_cents < 0


def test_measuring_nothing_returns_none_not_a_zero_rate():
    assert measure_expense_rate([]) is None
    assert measure_savings_capacity([]) is None
```

- [ ] **Step 2: Run it to verify it fails, then write `capacity.py`**

Run from `backend/`: `.venv/Scripts/pytest.exe tests/test_capacity.py -v` → FAIL, module not found.

Create `backend/app/engines/capacity.py`:

```python
"""What a month actually costs, and what it actually saves, measured.

The design brief's purchase-feasibility engine (§6.3) opens on "Capacité
d'épargne réelle, mesurée sur les transactions des douze derniers mois, pas
déclarée. Avec sa variabilité." `measure_savings_capacity` is that figure, and
phase 2B consumes it directly -- its shape is settled here.

Everything is measured over *complete observed months*, and both halves of that
phrase matter:

* complete -- a ledger opening on 24 January holds a week of that month, and
  counting it as a month would make the measured rate a quarter of the truth;
* observed -- a month with no transactions inside a sparse ledger means "no
  statement was imported", not "nothing was spent". Counting those as
  zero-spend months would halve every rate in this module.

Pure: no session, no network, no implicit clock.
"""

from dataclasses import dataclass
from datetime import date

from app.engines.aggregate import bucket_bounds
from app.engines.robust import describe, quantile_offset_cents

# Three months is the floor at which a median means anything at all. Below it
# the "rate" is one or two numbers wearing a statistic's clothes, and the
# caller is told nothing could be measured rather than handed a figure.
MIN_MONTHS_FOR_RATE = 3


@dataclass(frozen=True)
class MonthlyEntry:
    """The minimal input: when, and how much. Callers build these from whatever
    row shape they already hold."""

    on: date
    amount_cents: int


@dataclass(frozen=True)
class MonthObservation:
    key: str
    start: date
    end: date
    inflow_cents: int
    # Negative, like every outflow in this codebase.
    outflow_cents: int
    net_cents: int
    count: int


@dataclass(frozen=True)
class MeasuredRate:
    """A rate measured from history, with its variability -- never a bare number.

    `low_cents` / `high_cents` are the P10 / P90 equivalents derived from the
    robust scale. A rate quoted without them invites the reader to treat a
    median as a certainty.
    """

    months: int
    median_cents: int
    spread_cents: int
    low_cents: int
    high_cents: int


def complete_months(
    entries: list[MonthlyEntry], ledger_start: date, ledger_end: date
) -> list[MonthObservation]:
    """Every whole calendar month inside the ledger that actually holds activity."""
    buckets: dict[str, list[int]] = {}
    for entry in entries:
        if entry.on < ledger_start or entry.on > ledger_end:
            continue
        buckets.setdefault(f"{entry.on.year}-{entry.on.month:02d}", []).append(
            entry.amount_cents
        )

    observations: list[MonthObservation] = []
    for key in sorted(buckets):
        start, end = bucket_bounds(key, "month")
        # A month straddling either edge of the ledger is only partly covered by
        # the statements that exist, so it is not an observation of a month.
        if start < ledger_start or end > ledger_end:
            continue
        amounts = buckets[key]
        inflow = sum(amount for amount in amounts if amount > 0)
        outflow = sum(amount for amount in amounts if amount < 0)
        observations.append(MonthObservation(
            key=key, start=start, end=end,
            inflow_cents=inflow, outflow_cents=outflow,
            net_cents=inflow + outflow, count=len(amounts),
        ))
    return observations


def _measure(values: list[int]) -> MeasuredRate | None:
    if len(values) < MIN_MONTHS_FOR_RATE:
        return None
    spread = describe(values)
    offset = quantile_offset_cents(spread.sigma)
    return MeasuredRate(
        months=len(values),
        median_cents=spread.median,
        spread_cents=spread.sigma,
        low_cents=spread.median - offset,
        high_cents=spread.median + offset,
    )


def measure_expense_rate(months: list[MonthObservation]) -> MeasuredRate | None:
    """What a month costs, as a positive magnitude. None when unmeasurable."""
    return _measure([abs(month.outflow_cents) for month in months])


def measure_savings_capacity(months: list[MonthObservation]) -> MeasuredRate | None:
    """What a month saves, signed. None when unmeasurable.

    **Phase 2B's purchase-feasibility engine consumes this function.** The sign
    is kept: a household that spends more than it earns has a negative capacity,
    and clamping that to zero would let a feasibility verdict read "atteignable
    en serrant" for someone who is going backwards every month.
    """
    return _measure([month.net_cents for month in months])
```

- [ ] **Step 3: Write the failing test for `runway`**

Create `backend/tests/test_runway.py`:

```python
from datetime import date

from app.engines.capacity import MonthlyEntry, complete_months
from app.engines.runway import compute_runway

TODAY = date(2026, 8, 12)
START = date(2025, 2, 1)
END = date(2025, 12, 31)


def _months(*totals: tuple[int, int, int]):
    """(year, month, outflow) -> observations."""
    entries = [MonthlyEntry(on=date(year, month, 5), amount_cents=amount)
               for year, month, amount in totals]
    return complete_months(entries, START, END)


def test_a_measured_burn_gives_a_month_count_and_a_depletion_date():
    months = _months((2025, 2, -100_000), (2025, 3, -100_000), (2025, 4, -100_000))
    report = compute_runway(600_000, months, months, TODAY)
    assert report.normal is not None
    assert report.normal.monthly_burn_cents == 100_000
    assert report.normal.months == 6.0
    assert report.normal.depleted_on is not None
    assert report.normal.depleted_on > TODAY


def test_cutting_to_essentials_lengthens_the_runway():
    everything = _months((2025, 2, -200_000), (2025, 3, -200_000), (2025, 4, -200_000))
    essentials = _months((2025, 2, -100_000), (2025, 3, -100_000), (2025, 4, -100_000))
    report = compute_runway(600_000, everything, essentials, TODAY)
    assert report.normal.months == 3.0
    assert report.essentials.months == 6.0
    assert report.essentials.depleted_on > report.normal.depleted_on


def test_two_months_of_history_measures_nothing_and_says_so():
    """The operator has three observed months. Two would be one interval short,
    and a runway quoted off two numbers is a guess with a decimal point."""
    months = _months((2025, 2, -100_000), (2025, 3, -100_000))
    report = compute_runway(600_000, months, months, TODAY)
    assert report.normal is None
    assert report.essentials is None
    assert report.insufficient_reason is not None
    assert "3 mois" in report.insufficient_reason
    assert report.months_observed == 2


def test_the_observed_month_count_is_always_reported():
    """Three months is the floor, not comfort. The screen has to be able to say
    "mesuré sur 3 mois seulement"."""
    months = _months((2025, 2, -100_000), (2025, 3, -100_000), (2025, 4, -100_000))
    report = compute_runway(600_000, months, months, TODAY)
    assert report.months_observed == 3


def test_an_empty_balance_is_zero_months_not_an_error():
    months = _months((2025, 2, -100_000), (2025, 3, -100_000), (2025, 4, -100_000))
    report = compute_runway(0, months, months, TODAY)
    assert report.normal.months == 0.0
    assert report.normal.depleted_on == TODAY


def test_an_overdrawn_account_is_zero_months_not_a_negative_runway():
    months = _months((2025, 2, -100_000), (2025, 3, -100_000), (2025, 4, -100_000))
    report = compute_runway(-45_000, months, months, TODAY)
    assert report.normal.months == 0.0


def test_a_household_that_spends_nothing_has_no_runway_to_quote():
    """Dividing by a zero burn is infinity. Reported as "not measurable" rather
    than as a very large number that would read as a promise."""
    months = _months((2025, 2, 100_000), (2025, 3, 100_000), (2025, 4, 100_000))
    report = compute_runway(600_000, months, months, TODAY)
    assert report.normal is None
    assert report.insufficient_reason is not None


def test_an_improbably_long_runway_states_the_months_but_no_date():
    """1 000 years out, a calendar date is noise, and `date` overflows past
    year 9999 anyway."""
    months = _months((2025, 2, -100), (2025, 3, -100), (2025, 4, -100))
    report = compute_runway(10_000_000_00, months, months, TODAY)
    assert report.normal.months > 600
    assert report.normal.depleted_on is None


def test_the_operators_own_numbers_produce_a_very_short_runway():
    """197 transactions netting +93 EUR against roughly 1 900 EUR a month out.
    The honest answer is "less than a month", and it must not round to zero
    silently or crash."""
    months = _months((2025, 2, -190_000), (2025, 3, -190_000), (2025, 4, -190_000))
    report = compute_runway(9_300, months, months, TODAY)
    assert 0 < report.normal.months < 0.1
    assert report.normal.depleted_on is not None
```

- [ ] **Step 4: Run it to verify it fails, then write `runway.py`**

Run from `backend/`: `.venv/Scripts/pytest.exe tests/test_runway.py -v` → FAIL, module not found.

Create `backend/app/engines/runway.py`:

```python
"""How long the money lasts with no income at all, at the measured rate.

Two scenarios, both measured rather than assumed: what this household actually
spends, and what it spends on the categories it has marked essential. The gap
between them is the lever, and it is the user's own ledger on both sides.

`months` is a `float` and that is deliberate: it is a duration, not a monetary
value. The integer-cents rule governs money; a count of months has no cents to
lose. Every amount in this module stays an integer.

Pure: no session, no network, no implicit clock -- `today` is a parameter.
"""

from dataclasses import dataclass
from datetime import date, timedelta

from app.engines.capacity import MIN_MONTHS_FOR_RATE, MeasuredRate, MonthObservation, measure_expense_rate

DAYS_PER_YEAR = 365

# Past fifty years a depletion date is noise, and `date` cannot represent one
# past year 9999 at all. The month count is still reported; only the calendar
# date is withheld.
MAX_DATED_MONTHS = 600


@dataclass(frozen=True)
class RunwayScenario:
    # "normal" or "essentials".
    name: str
    # Positive magnitude: what one month costs under this scenario.
    monthly_burn_cents: int
    # A duration, not money. None never occurs on a returned scenario -- a
    # scenario that could not be computed is None itself.
    months: float | None
    depleted_on: date | None


@dataclass(frozen=True)
class RunwayReport:
    balance_cents: int
    months_observed: int
    normal: RunwayScenario | None
    essentials: RunwayScenario | None
    # French. Non-null exactly when neither scenario could be computed.
    insufficient_reason: str | None


def _scenario(
    name: str, rate: MeasuredRate | None, balance_cents: int, today: date
) -> RunwayScenario | None:
    if rate is None or rate.median_cents <= 0:
        # No measurable burn: dividing by it is infinity, and an infinity
        # rendered on screen reads as a promise. Nothing is returned instead.
        return None

    burn = rate.median_cents
    if balance_cents <= 0:
        # Already at or past zero. Not a negative runway -- there is simply none
        # left, starting today.
        return RunwayScenario(name=name, monthly_burn_cents=burn, months=0.0,
                              depleted_on=today)

    months = balance_cents / burn
    if months > MAX_DATED_MONTHS:
        return RunwayScenario(name=name, monthly_burn_cents=burn, months=months,
                              depleted_on=None)

    days = round(balance_cents * DAYS_PER_YEAR / (burn * 12))
    return RunwayScenario(name=name, monthly_burn_cents=burn, months=months,
                          depleted_on=today + timedelta(days=days))


def compute_runway(
    balance_cents: int,
    all_months: list[MonthObservation],
    essential_months: list[MonthObservation],
    today: date,
) -> RunwayReport:
    normal = _scenario("normal", measure_expense_rate(all_months), balance_cents, today)
    essentials = _scenario(
        "essentials", measure_expense_rate(essential_months), balance_cents, today
    )

    reason: str | None = None
    if normal is None and essentials is None:
        reason = (
            f"Pas assez de données pour conclure : il faut au moins "
            f"{MIN_MONTHS_FOR_RATE} mois complets de relevés portant des dépenses, "
            f"et l'historique en compte {len(all_months)}."
        )

    return RunwayReport(
        balance_cents=balance_cents,
        months_observed=len(all_months),
        normal=normal,
        essentials=essentials,
        insufficient_reason=reason,
    )
```

- [ ] **Step 5: Run both tests and commit**

Run from `backend/`: `.venv/Scripts/pytest.exe tests/test_capacity.py tests/test_runway.py -v` → PASS, 19 tests.
Run from `backend/`: `.venv/Scripts/pytest.exe -q` → 353 passed.

```bash
git add backend/app/engines/capacity.py backend/app/engines/runway.py backend/tests/test_capacity.py backend/tests/test_runway.py
git commit -m "feat(engines): measure the real monthly rate and derive the runway"
```

---

### Task 11: Cash-flow forecast engine

Design spec §6.2: "Projette 12 mois à partir des récurrences détectées et de la saisonnalité observée sur l'historique réel. Renvoie un intervalle de confiance, pas une valeur unique. Signale les mois où le solde projeté passe sous un seuil."

The recurrences and the historical residual are kept strictly disjoint: the caller passes observations built from **non-recurring rows only**, using the key set the recurrence engine returns. Without that, rent would be counted once as a recurrence and again inside the month's own average.

**Files:**
- Create: `backend/app/engines/forecast.py`
- Test: `backend/tests/test_forecast.py`

**Interfaces:**
- Consumes: `app.engines.capacity.MonthObservation`, `app.engines.recurrence.Recurrence`, `app.engines.robust.{describe, median_cents, quantile_offset_cents}`, `app.engines.aggregate.bucket_bounds`.
- Produces:
  - `ForecastMonth(key, start, end, recurring_cents, residual_cents, net_p50_cents, balance_p10_cents, balance_p50_cents, balance_p90_cents, below_threshold, seasonal)`
  - `ForecastReport(months, months_observed, seasonality_used, threshold_cents, first_breach_key, opening_balance_cents, insufficient_reason)`
  - `project_cashflow(balance_cents, residual_observations, recurrences, today, horizon_months=12, threshold_cents=0) -> ForecastReport`
  - `MIN_MONTHS_FOR_FORECAST = 6`, `DEFAULT_HORIZON_MONTHS = 12`, `MIN_OBSERVATIONS_FOR_SEASONALITY = 2`
- Task 12 consumes it; task 13's chart draws `balance_p10/p50/p90`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_forecast.py`:

```python
from datetime import date

from app.engines.capacity import MonthlyEntry, complete_months
from app.engines.forecast import (
    MIN_MONTHS_FOR_FORECAST,
    project_cashflow,
)
from app.engines.recurrence import Recurrence

TODAY = date(2026, 8, 12)


def _observations(count: int, net_per_month: int, start_month: int = 1):
    """`count` complete months through 2025, each netting about `net_per_month`.

    The jitter is deliberate and fixed: six identical months have a MAD of zero,
    hence a scale of zero, hence a band of zero width -- which would make every
    assertion about the confidence interval below vacuously true. Real months
    are never identical, and the fixture must not be either.

    The ledger end is December, not the last month with data: `complete_months`
    already drops months with no activity, and a tighter end would silently cut
    the final month for being partly outside the ledger.
    """
    jitter = [0, 1_500, -1_200, 800, -900, 2_000, -1_700, 600, -400, 1_100, -1_300, 300]
    entries = [
        MonthlyEntry(
            on=date(2025, start_month + index, 15),
            amount_cents=net_per_month + jitter[index % len(jitter)],
        )
        for index in range(count)
    ]
    return complete_months(entries, date(2025, start_month, 1), date(2025, 12, 31))


def _rent() -> Recurrence:
    return Recurrence(
        label_key="loyer", label="VIREMENT SEPA LOYER", category_id=None,
        periodicity="monthly", occurrences=8,
        first_on=date(2026, 1, 5), last_on=date(2026, 8, 5),
        median_interval_days=30, amount_cents=-78_000, amount_spread_cents=0,
        annual_cents=-936_000, expected_next_on=date(2026, 9, 4),
        status="active", confidence="confirmed", price_change=None,
    )


def test_five_observed_months_is_not_enough_and_the_engine_says_so():
    """The operator has three. Six is the floor at which a seasonal pattern can
    even be looked for, and a twelve-month projection off five points would be
    a straight line with a decorative band around it."""
    report = project_cashflow(100_000, _observations(5, -10_000), [], TODAY)
    assert report.months == []
    assert report.insufficient_reason is not None
    assert "6 mois" in report.insufficient_reason
    assert report.months_observed == 5
    assert MIN_MONTHS_FOR_FORECAST == 6


def test_six_observed_months_produce_twelve_projected_ones():
    report = project_cashflow(100_000, _observations(6, -10_000), [], TODAY)
    assert len(report.months) == 12
    assert report.insufficient_reason is None


def test_the_projection_starts_the_month_after_today():
    report = project_cashflow(100_000, _observations(6, -10_000), [], TODAY)
    assert report.months[0].key == "2026-09"
    assert report.months[-1].key == "2027-08"


def test_a_recurring_charge_lands_in_every_month_it_is_due():
    report = project_cashflow(1_000_000, _observations(6, 0), [_rent()], TODAY)
    assert all(month.recurring_cents <= -78_000 for month in report.months[:6])


def test_the_band_is_never_a_single_line():
    report = project_cashflow(100_000, _observations(6, -10_000), [], TODAY)
    first = report.months[0]
    assert first.balance_p10_cents < first.balance_p50_cents < first.balance_p90_cents


def test_the_band_widens_with_distance():
    """Twelve months out is less certain than one month out, and the shape has
    to say so. A constant-width band would claim otherwise."""
    report = project_cashflow(100_000, _observations(8, -10_000, start_month=1), [], TODAY)
    first = report.months[0]
    last = report.months[-1]
    assert (last.balance_p90_cents - last.balance_p10_cents) > (
        first.balance_p90_cents - first.balance_p10_cents
    )


def test_a_calendar_month_seen_twice_gets_its_own_seasonal_residual():
    """December costs more than March in most households. Two Decembers is the
    floor at which that can be claimed."""
    entries = [
        MonthlyEntry(on=date(year, month, 15), amount_cents=-40_000 if month == 12 else -10_000)
        for year in (2024, 2025)
        for month in range(1, 13)
    ]
    observations = complete_months(entries, date(2024, 1, 1), date(2025, 12, 31))
    report = project_cashflow(1_000_000, observations, [], date(2026, 1, 15))

    december = next(month for month in report.months if month.key.endswith("-12"))
    march = next(month for month in report.months if month.key.endswith("-03"))
    assert december.seasonal is True
    assert december.residual_cents < march.residual_cents
    assert report.seasonality_used is True


def test_one_observation_of_a_calendar_month_falls_back_to_the_pooled_median():
    report = project_cashflow(1_000_000, _observations(6, -10_000), [], TODAY)
    assert all(month.seasonal is False for month in report.months)
    assert report.seasonality_used is False
    # Every month gets the same pooled figure, because none of them has a
    # seasonal one of its own.
    assert len({month.residual_cents for month in report.months}) == 1


def test_a_month_whose_low_estimate_falls_under_the_threshold_is_flagged():
    report = project_cashflow(50_000, _observations(6, -10_000), [], TODAY, threshold_cents=0)
    breached = [month for month in report.months if month.below_threshold]
    assert breached
    assert report.first_breach_key == breached[0].key


def test_the_flag_uses_the_low_estimate_not_the_median():
    """Warning only once the *median* dips below the floor is warning too late:
    the reader wants to know when it could happen, not when it probably has.

    Constructed rather than guessed: the threshold is set to one month's own
    median, so that month is by definition not below it on the median and is
    below it on the low estimate, whatever the arithmetic works out to.
    """
    observations = _observations(6, -10_000)
    baseline = project_cashflow(200_000, observations, [], TODAY)
    threshold = baseline.months[5].balance_p50_cents

    report = project_cashflow(200_000, observations, [], TODAY, threshold_cents=threshold)
    month = report.months[5]
    assert month.balance_p50_cents >= threshold
    assert month.balance_p10_cents < threshold
    assert month.below_threshold is True


def test_no_breach_reports_no_breach_rather_than_the_first_month():
    report = project_cashflow(10_000_000, _observations(6, -10_000), [], TODAY)
    assert report.first_breach_key is None
    assert all(month.below_threshold is False for month in report.months)


def test_the_horizon_is_configurable():
    report = project_cashflow(100_000, _observations(6, -10_000), [], TODAY, horizon_months=6)
    assert len(report.months) == 6


def test_a_cancelled_recurrence_is_not_projected_forward():
    ended = Recurrence(
        label_key="salle", label="SALLE DE SPORT", category_id=None,
        periodicity="monthly", occurrences=4,
        first_on=date(2025, 2, 10), last_on=date(2025, 5, 10),
        median_interval_days=30, amount_cents=-3_990, amount_spread_cents=0,
        annual_cents=-47_880, expected_next_on=date(2025, 6, 9),
        status="ended", confidence="confirmed", price_change=None,
    )
    report = project_cashflow(100_000, _observations(6, -10_000), [ended], TODAY)
    assert all(month.recurring_cents == 0 for month in report.months)
```

- [ ] **Step 2: Run it to verify it fails, then write `forecast.py`**

Run from `backend/`: `.venv/Scripts/pytest.exe tests/test_forecast.py -v` → FAIL, module not found.

Create `backend/app/engines/forecast.py`:

```python
"""Twelve months of projected balance, as a band and never as a line.

The design brief is explicit: "Renvoie un intervalle de confiance, pas une
valeur unique", and §7.3 forbids a single Monte-Carlo line for the same reason
-- a single projected number reads as a forecast someone stands behind.

Two sources, kept strictly disjoint:

* the detected recurrences, projected forward on their own schedule;
* everything else, as a monthly residual taken from the real history, seasonal
  where the history can support a seasonal claim and pooled where it cannot.

Disjoint matters: the caller passes observations built from **non-recurring
rows only** (using `RecurrenceReport.recurring_keys`). Feed it the whole history
and the rent is counted twice -- once as a recurrence and again inside the
month's own average.

Pure: no session, no network, no implicit clock -- `today` is a parameter.
"""

import math
from dataclasses import dataclass
from datetime import date, timedelta

from app.engines.aggregate import bucket_bounds
from app.engines.capacity import MonthObservation
from app.engines.recurrence import Recurrence
from app.engines.robust import describe, median_cents, quantile_offset_cents

# Six complete observed months is the floor. Below it there is no second
# observation of any calendar month, so seasonality cannot be looked for at all,
# and a twelve-month projection would be one number repeated twelve times with a
# decorative band around it. The operator's ledger holds three.
MIN_MONTHS_FOR_FORECAST = 6

DEFAULT_HORIZON_MONTHS = 12

# Two observations of the same calendar month before a seasonal claim is made.
# One December is an anecdote.
MIN_OBSERVATIONS_FOR_SEASONALITY = 2

# A runaway guard on the recurrence walk: no legitimate schedule produces this
# many occurrences inside a twelve-month horizon, and a corrupt interval must
# not spin forever.
MAX_OCCURRENCES_PER_RECURRENCE = 500


@dataclass(frozen=True)
class ForecastMonth:
    key: str
    start: date
    end: date
    # Recurring flows due this month, signed.
    recurring_cents: int
    # Everything else, signed.
    residual_cents: int
    net_p50_cents: int
    balance_p10_cents: int
    balance_p50_cents: int
    balance_p90_cents: int
    below_threshold: bool
    # True when this month's residual came from observations of this same
    # calendar month rather than from the pooled median.
    seasonal: bool


@dataclass(frozen=True)
class ForecastReport:
    months: list[ForecastMonth]
    months_observed: int
    seasonality_used: bool
    threshold_cents: int
    first_breach_key: str | None
    opening_balance_cents: int
    # French. Non-null exactly when `months` is empty.
    insufficient_reason: str | None


def _future_month_keys(today: date, horizon_months: int) -> list[str]:
    """The `horizon_months` months after today's, starting with the next one.

    The current month is excluded on purpose: part of it has already happened,
    so projecting it would mix a measured past with an estimated future inside
    one bar.
    """
    keys: list[str] = []
    year, month = today.year, today.month
    for _ in range(horizon_months):
        month += 1
        if month > 12:
            month, year = 1, year + 1
        keys.append(f"{year}-{month:02d}")
    return keys


def _recurring_by_month(
    recurrences: list[Recurrence], horizon_end: date
) -> dict[str, int]:
    """Walk each live recurrence forward on its own rhythm and bin the charges."""
    totals: dict[str, int] = {}
    for item in recurrences:
        if item.status == "ended":
            continue
        step = max(1, item.median_interval_days)
        cursor = item.expected_next_on
        seen = 0
        while cursor <= horizon_end and seen < MAX_OCCURRENCES_PER_RECURRENCE:
            key = f"{cursor.year}-{cursor.month:02d}"
            totals[key] = totals.get(key, 0) + item.amount_cents
            cursor += timedelta(days=step)
            seen += 1
    return totals


def project_cashflow(
    balance_cents: int,
    residual_observations: list[MonthObservation],
    recurrences: list[Recurrence],
    today: date,
    horizon_months: int = DEFAULT_HORIZON_MONTHS,
    threshold_cents: int = 0,
) -> ForecastReport:
    if len(residual_observations) < MIN_MONTHS_FOR_FORECAST:
        return ForecastReport(
            months=[],
            months_observed=len(residual_observations),
            seasonality_used=False,
            threshold_cents=threshold_cents,
            first_breach_key=None,
            opening_balance_cents=balance_cents,
            insufficient_reason=(
                f"Pas assez de données pour projeter : il faut au moins "
                f"{MIN_MONTHS_FOR_FORECAST} mois complets de relevés, et "
                f"l'historique en compte {len(residual_observations)}. "
                "Importez des relevés supplémentaires pour obtenir une prévision."
            ),
        )

    nets = [observation.net_cents for observation in residual_observations]
    pooled = median_cents(nets)
    sigma = describe(nets).sigma

    by_calendar_month: dict[int, list[int]] = {}
    for observation in residual_observations:
        by_calendar_month.setdefault(observation.start.month, []).append(
            observation.net_cents
        )

    keys = _future_month_keys(today, horizon_months)
    horizon_end = bucket_bounds(keys[-1], "month")[1]
    recurring = _recurring_by_month(recurrences, horizon_end)

    months: list[ForecastMonth] = []
    seasonality_used = False
    running = balance_cents
    first_breach: str | None = None

    for index, key in enumerate(keys):
        start, end = bucket_bounds(key, "month")
        samples = by_calendar_month.get(start.month, [])
        seasonal = len(samples) >= MIN_OBSERVATIONS_FOR_SEASONALITY
        residual = median_cents(samples) if seasonal else pooled
        seasonality_used = seasonality_used or seasonal

        recurring_cents = recurring.get(key, 0)
        net = recurring_cents + residual
        running += net

        # Independent monthly errors accumulate as the square root of the number
        # of months: the band widens with distance rather than staying a
        # constant ribbon, which would claim month twelve is as knowable as
        # month one. The multiplication is rounded straight back to integer
        # cents -- no monetary value is stored as a float.
        half_width = round(quantile_offset_cents(sigma) * math.sqrt(index + 1))
        low = running - half_width
        high = running + half_width

        # The alert fires on the LOW estimate, not the median: the reader wants
        # to know when the balance *could* go under, not when it probably
        # already has.
        breached = low < threshold_cents
        if breached and first_breach is None:
            first_breach = key

        months.append(ForecastMonth(
            key=key, start=start, end=end,
            recurring_cents=recurring_cents,
            residual_cents=residual,
            net_p50_cents=net,
            balance_p10_cents=low,
            balance_p50_cents=running,
            balance_p90_cents=high,
            below_threshold=breached,
            seasonal=seasonal,
        ))

    return ForecastReport(
        months=months,
        months_observed=len(residual_observations),
        seasonality_used=seasonality_used,
        threshold_cents=threshold_cents,
        first_breach_key=first_breach,
        opening_balance_cents=balance_cents,
        insufficient_reason=None,
    )
```

- [ ] **Step 3: Run the test and commit**

Run from `backend/`: `.venv/Scripts/pytest.exe tests/test_forecast.py -v` → PASS, 13 tests.
Run from `backend/`: `.venv/Scripts/pytest.exe -q` → 366 passed.

```bash
git add backend/app/engines/forecast.py backend/tests/test_forecast.py
git commit -m "feat(engines): project twelve months of balance as a confidence band"
```

---

### Task 12: Cash-flow API

**Files:**
- Create: `backend/app/schemas/cashflow.py`
- Create: `backend/app/api/cashflow.py`
- Modify: `backend/app/main.py`
- Test: `backend/tests/test_cashflow_api.py`

**Interfaces:**
- Consumes: `app.api.common.{recurrence_points, liquid_balance_cents}`, `app.api.history.user_history`, `app.engines.capacity.{MonthlyEntry, complete_months}`, `app.engines.recurrence.detect_recurrences`, `app.engines.forecast.project_cashflow`, `app.engines.runway.compute_runway`, `Category.is_essential` (task 3).
- Produces:
  - `GET /api/cashflow/forecast?months=12&threshold_cents=0` → `ForecastOut`
  - `GET /api/cashflow/runway` → `RunwayOut`
  - `ForecastMonthOut{key, start, end, recurring_cents, residual_cents, net_p50_cents, balance_p10_cents, balance_p50_cents, balance_p90_cents, below_threshold, seasonal}`
  - `ForecastOut{months, months_observed, seasonality_used, threshold_cents, first_breach_key, opening_balance_cents, insufficient_reason}`
  - `RunwayScenarioOut{name, monthly_burn_cents, months, depleted_on}`
  - `RunwayOut{balance_cents, months_observed, normal, essentials, insufficient_reason, essential_category_count}`
  - Tasks 13 and 14 consume both.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_cashflow_api.py`:

```python
from datetime import date


def _import_months(client, headers, account_id, label, amount, first_month, count):
    """One charge a month, on the 15th, for `count` consecutive months."""
    rows = ["date;libelle;montant"]
    year, month = first_month
    for _ in range(count):
        rows.append(f"15/{month:02d}/{year};{label};{amount / 100:.2f}".replace(".", ","))
        month += 1
        if month > 12:
            month, year = 1, year + 1
    csv = "\n".join(rows).encode("utf-8")
    preview = client.post("/api/imports/analyze", headers=headers,
                          files={"file": ("c.csv", csv, "text/csv")},
                          data={"account_id": str(account_id)}).json()
    client.post("/api/imports/commit", headers=headers, json={
        "upload_token": preview["upload_token"], "account_id": account_id,
        "dialect": preview["dialect"], "mapping": preview["suggested_mapping"],
        "overrides": {}, "keep_duplicates": [],
    })


def test_a_sparse_ledger_refuses_to_forecast_and_explains_why(client, imported):
    """The Boursorama sample spans one week. Six complete observed months is the
    floor, and the response has to name the shortfall rather than return an
    empty months array with no comment."""
    headers, _ = imported
    body = client.get("/api/cashflow/forecast", headers=headers).json()
    assert body["months"] == []
    assert body["insufficient_reason"] is not None
    assert "6 mois" in body["insufficient_reason"]


def test_enough_history_produces_twelve_banded_months(client, imported):
    headers, account_id = imported
    _import_months(client, headers, account_id, "COURSES DIVERSES", -20_000, (2025, 1), 10)

    body = client.get("/api/cashflow/forecast", headers=headers).json()
    assert body["insufficient_reason"] is None
    assert len(body["months"]) == 12
    first = body["months"][0]
    assert first["balance_p10_cents"] < first["balance_p50_cents"] < first["balance_p90_cents"]


def test_the_horizon_and_the_threshold_are_both_honoured(client, imported):
    headers, account_id = imported
    _import_months(client, headers, account_id, "COURSES DIVERSES", -20_000, (2025, 1), 10)

    body = client.get("/api/cashflow/forecast?months=6&threshold_cents=-100000",
                      headers=headers).json()
    assert len(body["months"]) == 6
    assert body["threshold_cents"] == -100_000


def test_an_out_of_range_horizon_is_refused_in_french(client, imported):
    headers, _ = imported
    response = client.get("/api/cashflow/forecast?months=0", headers=headers)
    assert response.status_code == 422
    response = client.get("/api/cashflow/forecast?months=61", headers=headers)
    assert response.status_code == 422


def test_the_opening_balance_is_the_liquid_balance(client, imported):
    headers, _ = imported
    body = client.get("/api/cashflow/forecast", headers=headers).json()
    runway = client.get("/api/cashflow/runway", headers=headers).json()
    assert body["opening_balance_cents"] == runway["balance_cents"]


def test_runway_refuses_on_two_observed_months(client, imported):
    headers, _ = imported
    body = client.get("/api/cashflow/runway", headers=headers).json()
    assert body["normal"] is None
    assert body["insufficient_reason"] is not None
    assert "3 mois" in body["insufficient_reason"]


def test_runway_reports_both_scenarios_when_it_can(client, imported):
    headers, account_id = imported
    # "COURSES" matches the builtin grocery rule, which is an essential category.
    _import_months(client, headers, account_id, "CARTE X1234 CARREFOUR COURSES",
                   -20_000, (2025, 1), 6)
    _import_months(client, headers, account_id, "CARTE X1234 RESTAURANT LE COMPTOIR",
                   -15_000, (2025, 1), 6)

    body = client.get("/api/cashflow/runway", headers=headers).json()
    assert body["months_observed"] >= 3
    assert body["normal"] is not None
    assert body["essentials"] is not None
    # Cutting to essentials always costs less than not cutting.
    assert body["essentials"]["monthly_burn_cents"] <= body["normal"]["monthly_burn_cents"]


def test_runway_reports_how_many_categories_are_marked_essential(client, imported):
    """The reduced scenario is only as meaningful as that list, so the screen
    has to be able to say how many categories it rests on."""
    headers, _ = imported
    body = client.get("/api/cashflow/runway", headers=headers).json()
    assert body["essential_category_count"] == 21


def test_cashflow_requires_authentication(client, imported):
    assert client.get("/api/cashflow/forecast").status_code == 401
    assert client.get("/api/cashflow/runway").status_code == 401


def test_cashflow_never_crosses_users(client, imported):
    headers, account_id = imported
    _import_months(client, headers, account_id, "COURSES DIVERSES", -20_000, (2025, 1), 10)

    other = client.post("/api/auth/register", json={
        "name": "Autre", "email": "autre@example.com", "password": "motdepasse123"}).json()
    other_headers = {"Authorization": f"Bearer {other['access_token']}"}

    forecast = client.get("/api/cashflow/forecast", headers=other_headers).json()
    runway = client.get("/api/cashflow/runway", headers=other_headers).json()
    assert forecast["months"] == []
    assert runway["balance_cents"] == 0
    assert runway["normal"] is None
```

- [ ] **Step 2: Run the test to verify it fails**

Run from `backend/`: `.venv/Scripts/pytest.exe tests/test_cashflow_api.py -v`
Expected: FAIL — 404 on every request.

- [ ] **Step 3: Write the schemas**

Create `backend/app/schemas/cashflow.py`:

```python
from datetime import date

from pydantic import BaseModel


class ForecastMonthOut(BaseModel):
    key: str
    start: date
    end: date
    recurring_cents: int
    residual_cents: int
    net_p50_cents: int
    balance_p10_cents: int
    balance_p50_cents: int
    balance_p90_cents: int
    below_threshold: bool
    # True when this month's estimate came from observations of the same
    # calendar month rather than from the pooled median.
    seasonal: bool


class ForecastOut(BaseModel):
    months: list[ForecastMonthOut]
    months_observed: int
    seasonality_used: bool
    threshold_cents: int
    first_breach_key: str | None
    opening_balance_cents: int
    # French. Non-null exactly when `months` is empty -- the screen prints it
    # instead of drawing an empty chart.
    insufficient_reason: str | None


class RunwayScenarioOut(BaseModel):
    name: str
    monthly_burn_cents: int
    # A duration in months, not a monetary value. Fractional on purpose: a
    # runway of 0,4 mois is a real and important answer.
    months: float
    # null when the runway is longer than fifty years, where a calendar date
    # would be noise.
    depleted_on: date | None


class RunwayOut(BaseModel):
    balance_cents: int
    months_observed: int
    normal: RunwayScenarioOut | None
    essentials: RunwayScenarioOut | None
    insufficient_reason: str | None
    # How many categories the reduced scenario rests on. The screen states it,
    # because a scenario built on an empty essential list is not a scenario.
    essential_category_count: int
```

- [ ] **Step 4: Write the router**

Create `backend/app/api/cashflow.py`:

```python
from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.common import liquid_balance_cents, recurrence_points
from app.api.history import user_history
from app.db import get_db
from app.engines.capacity import MonthlyEntry, MonthObservation, complete_months
from app.engines.forecast import DEFAULT_HORIZON_MONTHS, project_cashflow
from app.engines.recurrence import RecurringTx, detect_recurrences
from app.engines.runway import compute_runway
from app.models import Category, User
from app.schemas.cashflow import (
    ForecastMonthOut,
    ForecastOut,
    RunwayOut,
    RunwayScenarioOut,
)
from app.security.deps import get_current_user

router = APIRouter(prefix="/cashflow", tags=["cashflow"])


def _ledger_bounds(db: Session, user_id: int, today: date) -> tuple[date, date]:
    """The span the statements actually cover. A user with no rows gets an empty
    single-day span, which yields no observed months and an honest refusal."""
    history = user_history(db, user_id)
    if history is None:
        return today, today
    return history.date_from, history.date_to


def _months(
    points: list[RecurringTx], start: date, end: date
) -> list[MonthObservation]:
    return complete_months(
        [MonthlyEntry(on=point.on, amount_cents=point.amount_cents) for point in points],
        start,
        end,
    )


@router.get("/forecast", response_model=ForecastOut)
def forecast(
    months: int = Query(default=DEFAULT_HORIZON_MONTHS, ge=1, le=60),
    threshold_cents: int = 0,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ForecastOut:
    """Twelve months of projected balance, as a P10/P50/P90 band.

    The recurring half and the residual half are kept disjoint: the residual
    observations are built from rows whose label key is NOT in the detected
    recurrence set, so rent is projected once, from its own schedule, and never
    a second time inside a monthly average.
    """
    today = date.today()
    points = recurrence_points(db, user.id)
    detected = detect_recurrences(points, today)
    start, end = _ledger_bounds(db, user.id, today)

    residual_points = [p for p in points if p.label_key not in detected.recurring_keys]
    report = project_cashflow(
        balance_cents=liquid_balance_cents(db, user.id),
        residual_observations=_months(residual_points, start, end),
        recurrences=detected.recurrences,
        today=today,
        horizon_months=months,
        threshold_cents=threshold_cents,
    )

    return ForecastOut(
        months=[
            ForecastMonthOut(
                key=month.key, start=month.start, end=month.end,
                recurring_cents=month.recurring_cents,
                residual_cents=month.residual_cents,
                net_p50_cents=month.net_p50_cents,
                balance_p10_cents=month.balance_p10_cents,
                balance_p50_cents=month.balance_p50_cents,
                balance_p90_cents=month.balance_p90_cents,
                below_threshold=month.below_threshold,
                seasonal=month.seasonal,
            )
            for month in report.months
        ],
        months_observed=report.months_observed,
        seasonality_used=report.seasonality_used,
        threshold_cents=report.threshold_cents,
        first_breach_key=report.first_breach_key,
        opening_balance_cents=report.opening_balance_cents,
        insufficient_reason=report.insufficient_reason,
    )


def _scenario_out(scenario) -> RunwayScenarioOut | None:
    if scenario is None:
        return None
    return RunwayScenarioOut(
        name=scenario.name,
        monthly_burn_cents=scenario.monthly_burn_cents,
        months=scenario.months,
        depleted_on=scenario.depleted_on,
    )


@router.get("/runway", response_model=RunwayOut)
def runway(
    user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> RunwayOut:
    """How many months the liquid balance lasts with no income at all."""
    today = date.today()
    points = recurrence_points(db, user.id)
    start, end = _ledger_bounds(db, user.id, today)

    essential_ids = {
        row.id
        for row in db.query(Category.id)
        .filter(Category.user_id == user.id, Category.is_essential.is_(True))
        .all()
    }
    essential_points = [p for p in points if p.category_id in essential_ids]

    report = compute_runway(
        balance_cents=liquid_balance_cents(db, user.id),
        all_months=_months(points, start, end),
        essential_months=_months(essential_points, start, end),
        today=today,
    )

    return RunwayOut(
        balance_cents=report.balance_cents,
        months_observed=report.months_observed,
        normal=_scenario_out(report.normal),
        essentials=_scenario_out(report.essentials),
        insufficient_reason=report.insufficient_reason,
        essential_category_count=len(essential_ids),
    )
```

- [ ] **Step 5: Register the router**

In `backend/app/main.py`: `from app.api import cashflow as cashflow_routes` and `api.include_router(cashflow_routes.router)`.

- [ ] **Step 6: Run the tests and commit**

Run from `backend/`: `.venv/Scripts/pytest.exe tests/test_cashflow_api.py -v` → PASS, 10 tests.
Run from `backend/`: `.venv/Scripts/pytest.exe -q` → 376 passed.

```bash
git add backend/app/schemas/cashflow.py backend/app/api/cashflow.py backend/app/main.py backend/tests/test_cashflow_api.py
git commit -m "feat(api): expose the twelve-month forecast band and the runway scenarios"
```

---

### Task 13: Forecast fan chart

Design spec §7.3: "Éventail de percentiles P10/P50/P90 [...] jamais une ligne unique, qui donnerait une fausse impression de certitude" and "Courbes de projection avec bandes de confiance". This is that component.

**Files:**
- Create: `frontend/src/charts/ForecastFanChart.tsx`
- Create: `frontend/src/charts/ForecastFanChart.test.tsx`
- Modify: `frontend/src/lib/types.ts`

**Interfaces:**
- Consumes: `charts/Chart.tsx` (`Chart`, `ChartExportRow`), `charts/theme.ts` (`chartTokens`, `ChartTokens`), `design/theme.ts` (`formatCents`, `formatCompactCents`).
- Produces:
  - TS types `ForecastMonth`, `Forecast`, `RunwayScenario`, `Runway` in `lib/types.ts`.
  - `buildForecastOption(months: ForecastMonth[], thresholdCents: number, tokens: ChartTokens): { option, ariaLabel, exportRows }`
  - `monthAxisLabel(key: string): string`
  - `<ForecastFanChart months={...} thresholdCents={...} />`
  - Task 14 renders it.

- [ ] **Step 1: Add the TypeScript payload types**

Append to `frontend/src/lib/types.ts`:

```ts
export interface ForecastMonth {
  key: string;
  start: string;
  end: string;
  recurring_cents: number;
  residual_cents: number;
  net_p50_cents: number;
  balance_p10_cents: number;
  balance_p50_cents: number;
  balance_p90_cents: number;
  below_threshold: boolean;
  /** True when the estimate came from this same calendar month in the history. */
  seasonal: boolean;
}

export interface Forecast {
  months: ForecastMonth[];
  months_observed: number;
  seasonality_used: boolean;
  threshold_cents: number;
  first_breach_key: string | null;
  opening_balance_cents: number;
  /** French, non-null exactly when `months` is empty. Print it. */
  insufficient_reason: string | null;
}

export interface RunwayScenario {
  name: "normal" | "essentials";
  monthly_burn_cents: number;
  /** A duration in months, not money. Fractional on purpose. */
  months: number;
  depleted_on: string | null;
}

export interface Runway {
  balance_cents: number;
  months_observed: number;
  normal: RunwayScenario | null;
  essentials: RunwayScenario | null;
  insufficient_reason: string | null;
  essential_category_count: number;
}
```

- [ ] **Step 2: Write the failing test**

Create `frontend/src/charts/ForecastFanChart.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "../app/ThemeProvider";
import type { ForecastMonth } from "../lib/types";
import { buildForecastOption, ForecastFanChart, monthAxisLabel } from "./ForecastFanChart";
import { chartTokens } from "./theme";

function month(key: string, p10: number, p50: number, p90: number, breached = false): ForecastMonth {
  const [year, m] = key.split("-").map(Number);
  return {
    key,
    start: `${key}-01`,
    end: `${key}-28`,
    recurring_cents: -78000,
    residual_cents: -20000,
    net_p50_cents: -98000,
    balance_p10_cents: p10,
    balance_p50_cents: p50,
    balance_p90_cents: p90,
    below_threshold: breached,
    seasonal: m === 12 && year > 0,
  };
}

const months = [
  month("2026-09", 80000, 100000, 120000),
  month("2026-10", 40000, 90000, 140000),
  month("2026-11", -20000, 80000, 180000, true),
];

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false, media: query,
      addEventListener: vi.fn(), removeEventListener: vi.fn(),
      addListener: vi.fn(), removeListener: vi.fn(),
    })),
  });
});

describe("monthAxisLabel", () => {
  it("writes a French abbreviated month and year", () => {
    // ECharts' own `nameMap: "fr"` is a no-op without a registered locale — the
    // spending calendar shipped twelve English month names for exactly that
    // reason. Labels are supplied outright here.
    expect(monthAxisLabel("2026-09")).toMatch(/sept/i);
    expect(monthAxisLabel("2026-09")).toContain("2026");
  });
});

describe("buildForecastOption", () => {
  const tokens = chartTokens("dark");

  it("draws a band and a median, never a single line", () => {
    const { option } = buildForecastOption(months, 0, tokens);
    const series = option.series as Array<{ name?: string; data?: number[] }>;
    // Three series: the invisible P10 floor, the stacked band, the P50 line.
    expect(series).toHaveLength(3);
    const median = series.find((s) => s.name === "Solde projeté (médiane)");
    expect(median?.data).toEqual([100000, 90000, 80000]);
  });

  it("stacks the band as a height above P10, not as an absolute P90", () => {
    const { option } = buildForecastOption(months, 0, tokens);
    const series = option.series as Array<{ name?: string; data?: number[] }>;
    const band = series.find((s) => s.name === "Intervalle P10–P90");
    expect(band?.data).toEqual([40000, 100000, 200000]);
  });

  it("marks the threshold so the reader can see where the floor is", () => {
    const { option } = buildForecastOption(months, 0, tokens);
    const series = option.series as Array<{ name?: string; markLine?: unknown }>;
    const median = series.find((s) => s.name === "Solde projeté (médiane)");
    expect(median?.markLine).toBeDefined();
  });

  it("describes the projection and its uncertainty in the aria label", () => {
    const { ariaLabel } = buildForecastOption(months, 0, tokens);
    expect(ariaLabel).toMatch(/projection/i);
    expect(ariaLabel).toMatch(/P10/);
    expect(ariaLabel).toMatch(/P90/);
  });

  it("names the first month that could fall under the threshold", () => {
    const { ariaLabel } = buildForecastOption(months, 0, tokens);
    expect(ariaLabel).toMatch(/novembre 2026/i);
  });

  it("exports the three bounds per month, not just the median", () => {
    const { exportRows } = buildForecastOption(months, 0, tokens);
    expect(exportRows).toHaveLength(3);
    expect(Object.keys(exportRows[0])).toEqual(
      expect.arrayContaining(["Mois", "Estimation basse", "Médiane", "Estimation haute"]),
    );
  });
});

describe("ForecastFanChart", () => {
  it("says so plainly rather than drawing an empty plot", () => {
    render(
      <ThemeProvider>
        <ForecastFanChart months={[]} thresholdCents={0} />
      </ThemeProvider>,
    );
    expect(screen.getByText(/Aucune projection/)).toBeInTheDocument();
  });

  it("renders a labelled chart when there is something to draw", () => {
    render(
      <ThemeProvider>
        <ForecastFanChart months={months} thresholdCents={0} />
      </ThemeProvider>,
    );
    expect(screen.getByRole("img", { name: /projection/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run it to verify it fails, then write the chart**

Run from `frontend/`: `npm test -- ForecastFanChart` → FAIL, module not found.

Create `frontend/src/charts/ForecastFanChart.tsx`:

```tsx
import type { EChartsOption } from "echarts";

import { useTheme } from "../app/ThemeProvider";
import { formatCents, formatCompactCents } from "../design/theme";
import type { ForecastMonth } from "../lib/types";
import { Chart, type ChartExportRow } from "./Chart";
import { type ChartTokens, chartTokens } from "./theme";

/** "2026-09" → "sept. 2026". */
export function monthAxisLabel(key: string): string {
  const [year, month] = key.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("fr-FR", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function monthLongLabel(key: string): string {
  const [year, month] = key.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("fr-FR", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export interface ForecastOptionResult {
  option: EChartsOption;
  ariaLabel: string;
  exportRows: ChartExportRow[];
}

/**
 * A P10/P50/P90 fan, never a single line.
 *
 * The band is drawn the standard ECharts way: an invisible series carrying P10,
 * and a second stacked on top of it carrying the band's *height* (P90 − P10),
 * not P90 itself. Stacking absolute values would draw the band at P10 + P90 and
 * put the shaded region roughly twice as high as the truth.
 *
 * The median is dashed on purpose. `charts/theme.ts` reserves solid strokes for
 * measured reference lines and dashes for anything projected; every value on
 * this chart is projected.
 */
export function buildForecastOption(
  months: ForecastMonth[],
  thresholdCents: number,
  tokens: ChartTokens,
): ForecastOptionResult {
  const labels = months.map((month) => monthAxisLabel(month.key));
  const breach = months.find((month) => month.below_threshold);

  const option: EChartsOption = {
    legend: { data: ["Intervalle P10–P90", "Solde projeté (médiane)"], top: 0 },
    grid: { left: 8, right: 8, top: 40, bottom: 32, containLabel: true },
    xAxis: { type: "category", data: labels, boundaryGap: false },
    yAxis: {
      type: "value",
      axisLabel: { formatter: (value: number) => formatCompactCents(value) },
    },
    tooltip: {
      trigger: "axis",
      formatter: (params) => {
        const rows = (Array.isArray(params) ? params : [params]) as Array<{
          dataIndex?: number;
          axisValueLabel?: string;
        }>;
        const index = rows[0]?.dataIndex ?? 0;
        const month = months[index];
        if (!month) return "";
        return [
          `<strong>${monthLongLabel(month.key)}</strong>`,
          `Médiane : ${formatCents(month.balance_p50_cents)}`,
          `Fourchette : ${formatCents(month.balance_p10_cents)} à ${formatCents(month.balance_p90_cents)}`,
          month.seasonal
            ? "Estimation saisonnière (même mois observé plusieurs fois)"
            : "Estimation moyenne (mois jamais observé deux fois)",
        ].join("<br/>");
      },
    },
    series: [
      {
        // Invisible floor of the band. Carries P10 so the stack starts there.
        name: "P10",
        type: "line",
        stack: "confidence",
        symbol: "none",
        lineStyle: { opacity: 0 },
        areaStyle: { opacity: 0 },
        silent: true,
        data: months.map((month) => month.balance_p10_cents),
      },
      {
        name: "Intervalle P10–P90",
        type: "line",
        stack: "confidence",
        symbol: "none",
        lineStyle: { opacity: 0 },
        areaStyle: { color: tokens.accent, opacity: 0.18 },
        // The band's HEIGHT, not its top edge — see the doc comment.
        data: months.map((month) => month.balance_p90_cents - month.balance_p10_cents),
      },
      {
        name: "Solde projeté (médiane)",
        type: "line",
        symbol: "circle",
        symbolSize: 6,
        lineStyle: { width: 2, type: "dashed", color: tokens.accentStrong },
        itemStyle: { color: tokens.accentStrong },
        z: 3,
        data: months.map((month) => month.balance_p50_cents),
        markLine: {
          silent: true,
          symbol: "none",
          lineStyle: { color: tokens.negative, type: "solid", width: 1 },
          label: {
            formatter: `Seuil ${formatCompactCents(thresholdCents)}`,
            color: tokens.muted,
            position: "insideEndTop",
          },
          data: [{ yAxis: thresholdCents }],
        },
      },
    ],
  };

  const ariaLabel = months.length
    ? `Projection du solde sur ${months.length} mois, de ${monthLongLabel(months[0].key)} à ${monthLongLabel(months[months.length - 1].key)}. ` +
      `Médiane de ${formatCents(months[0].balance_p50_cents)} à ${formatCents(months[months.length - 1].balance_p50_cents)}, ` +
      `fourchette P10 à P90 de ${formatCents(months[months.length - 1].balance_p10_cents)} à ${formatCents(months[months.length - 1].balance_p90_cents)} en fin de période.` +
      (breach
        ? ` Le solde pourrait passer sous le seuil dès ${monthLongLabel(breach.key)}.`
        : " Le solde ne passe sous le seuil sur aucun mois projeté.")
    : "Projection du solde.";

  const exportRows: ChartExportRow[] = months.map((month) => ({
    Mois: monthAxisLabel(month.key),
    "Estimation basse": formatCents(month.balance_p10_cents),
    Médiane: formatCents(month.balance_p50_cents),
    "Estimation haute": formatCents(month.balance_p90_cents),
    Saisonnier: month.seasonal ? "oui" : "non",
  }));

  return { option, ariaLabel, exportRows };
}

interface ForecastFanChartProps {
  months: ForecastMonth[];
  thresholdCents: number;
}

export function ForecastFanChart({ months, thresholdCents }: ForecastFanChartProps) {
  const { resolved } = useTheme();

  if (months.length === 0) {
    // Never an empty plot with axes and no data: an axis with nothing on it
    // reads as "the balance is flat at zero", which is a claim.
    return <p className="yd-chart-empty">Aucune projection disponible.</p>;
  }

  const { option, ariaLabel, exportRows } = buildForecastOption(
    months,
    thresholdCents,
    chartTokens(resolved),
  );

  return (
    <Chart
      option={option}
      height={340}
      ariaLabel={ariaLabel}
      dataForExport={{
        filename: "prevision-de-tresorerie",
        headers: ["Mois", "Estimation basse", "Médiane", "Estimation haute", "Saisonnier"],
        rows: exportRows,
      }}
    />
  );
}
```

- [ ] **Step 4: Run the test and the suite, then commit**

Run from `frontend/`: `npm test -- ForecastFanChart` → PASS, 8 tests. Then `npm test` → all green, `npm run build` → zero TypeScript errors.

```bash
git add frontend/src/charts/ForecastFanChart.tsx frontend/src/charts/ForecastFanChart.test.tsx frontend/src/lib/types.ts
git commit -m "feat(charts): add the P10/P50/P90 forecast fan chart"
```

---

### Task 14: Trésorerie screen

The forecast and the runway share a screen because they answer the same question from two sides: how long does the money last, and when could it run out.

**Files:**
- Create: `frontend/src/features/cashflow/CashflowPage.tsx`
- Create: `frontend/src/features/cashflow/CashflowPage.css`
- Create: `frontend/src/features/cashflow/RunwayPanel.tsx`
- Create: `frontend/src/features/cashflow/CashflowPage.test.tsx`
- Create: `frontend/src/features/cashflow/RunwayPanel.test.tsx`
- Modify: `frontend/src/app/routes.tsx`, `frontend/src/app/AppShell.tsx`, `frontend/src/app/AppShell.test.tsx`

**Interfaces:**
- Consumes: `GET /api/cashflow/forecast`, `GET /api/cashflow/runway` (task 12), `<ForecastFanChart>` (task 13).
- Produces:
  - `formatMonths(months: number): string` — French duration copy, exported for reuse.
  - `<RunwayPanel scenario={...} label={...} />`
  - Route `/tresorerie`, nav entry "Trésorerie".

- [ ] **Step 1: Write the failing test for `RunwayPanel`**

Create `frontend/src/features/cashflow/RunwayPanel.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { RunwayScenario } from "../../lib/types";
import { formatMonths, RunwayPanel } from "./RunwayPanel";

const scenario: RunwayScenario = {
  name: "normal",
  monthly_burn_cents: 190000,
  months: 6.3,
  depleted_on: "2027-02-18",
};

describe("formatMonths", () => {
  it("writes whole months without a decimal point", () => {
    expect(formatMonths(6)).toBe("6 mois");
  });

  it("keeps one decimal when it carries information", () => {
    expect(formatMonths(6.3)).toBe("6,3 mois");
  });

  it("uses the singular for one month", () => {
    expect(formatMonths(1)).toBe("1 mois");
  });

  it("says less than a month rather than rounding a fraction to zero", () => {
    // The operator's own numbers land here: ~93 EUR against ~1 900 EUR a month.
    expect(formatMonths(0.05)).toBe("moins d'un mois");
  });
});

describe("RunwayPanel", () => {
  it("states the duration, the burn and the date", () => {
    render(<RunwayPanel scenario={scenario} label="Rythme actuel" />);
    expect(screen.getByText("6,3 mois")).toBeInTheDocument();
    expect(screen.getByText(/1 900,00/)).toBeInTheDocument();
    expect(screen.getByText(/18 février 2027/)).toBeInTheDocument();
  });

  it("omits the date rather than inventing one when there is none", () => {
    render(<RunwayPanel scenario={{ ...scenario, depleted_on: null, months: 900 }} label="Rythme actuel" />);
    expect(screen.queryByText(/épuisé le/i)).not.toBeInTheDocument();
  });

  it("says nothing could be measured when the scenario is absent", () => {
    render(<RunwayPanel scenario={null} label="Rythme actuel" />);
    expect(screen.getByText(/Non mesurable/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to verify it fails, then write `RunwayPanel`**

Run from `frontend/`: `npm test -- RunwayPanel` → FAIL, module not found.

Create `frontend/src/features/cashflow/RunwayPanel.tsx`:

```tsx
import { frenchDate } from "../../design/EmptyState";
import { formatCents } from "../../design/theme";
import type { RunwayScenario } from "../../lib/types";

/**
 * A duration in months, in French.
 *
 * Anything under a month is written out rather than printed as "0,1 mois":
 * a reader scanning a figure reads the leading zero as "about none", and the
 * operator's own balance lands exactly there. Whole months drop the decimal so
 * "6 mois" does not read as "6,0 mois", which suggests a precision the median
 * of three observations does not have.
 */
export function formatMonths(months: number): string {
  if (months < 1) return "moins d'un mois";
  const rounded = Math.round(months * 10) / 10;
  const body = Number.isInteger(rounded)
    ? String(rounded)
    : rounded.toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return `${body} mois`;
}

interface RunwayPanelProps {
  scenario: RunwayScenario | null;
  label: string;
}

export function RunwayPanel({ scenario, label }: RunwayPanelProps) {
  if (scenario === null) {
    return (
      <div className="yd-runway">
        <span className="yd-runway__label">{label}</span>
        <p className="yd-runway__unavailable">
          Non mesurable — pas assez de mois complets de relevés pour établir un rythme.
        </p>
      </div>
    );
  }

  return (
    <div className="yd-runway">
      <span className="yd-runway__label">{label}</span>
      <span className="yd-runway__months">{formatMonths(scenario.months)}</span>
      <p className="yd-runway__detail">
        {`${formatCents(scenario.monthly_burn_cents)} par mois`}
        {scenario.depleted_on !== null
          ? ` — épuisé le ${frenchDate(scenario.depleted_on)}`
          : ""}
      </p>
    </div>
  );
}
```

- [ ] **Step 3: Write the failing test for `CashflowPage`**

Create `frontend/src/features/cashflow/CashflowPage.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "../../app/ThemeProvider";
import type { Forecast, Runway } from "../../lib/types";
import { CashflowPage } from "./CashflowPage";

vi.mock("../../charts/ForecastFanChart", () => ({
  ForecastFanChart: () => <div role="img" aria-label="Projection (stub)" />,
}));

const fetchMock = vi.fn();

const forecast: Forecast = {
  months: [
    {
      key: "2026-09", start: "2026-09-01", end: "2026-09-30",
      recurring_cents: -78000, residual_cents: -20000, net_p50_cents: -98000,
      balance_p10_cents: 30000, balance_p50_cents: 50000, balance_p90_cents: 70000,
      below_threshold: false, seasonal: false,
    },
    {
      key: "2026-10", start: "2026-10-01", end: "2026-10-31",
      recurring_cents: -78000, residual_cents: -20000, net_p50_cents: -98000,
      balance_p10_cents: -40000, balance_p50_cents: 20000, balance_p90_cents: 80000,
      below_threshold: true, seasonal: false,
    },
  ],
  months_observed: 9, seasonality_used: false, threshold_cents: 0,
  first_breach_key: "2026-10", opening_balance_cents: 148000,
  insufficient_reason: null,
};

const thinForecast: Forecast = {
  months: [], months_observed: 3, seasonality_used: false, threshold_cents: 0,
  first_breach_key: null, opening_balance_cents: 9300,
  insufficient_reason:
    "Pas assez de données pour projeter : il faut au moins 6 mois complets de relevés, et l'historique en compte 3.",
};

const runway: Runway = {
  balance_cents: 148000, months_observed: 9,
  normal: { name: "normal", monthly_burn_cents: 190000, months: 0.78, depleted_on: "2026-09-04" },
  essentials: { name: "essentials", monthly_burn_cents: 120000, months: 1.23, depleted_on: "2026-09-19" },
  insufficient_reason: null, essential_category_count: 21,
};

const thinRunway: Runway = {
  balance_cents: 9300, months_observed: 2, normal: null, essentials: null,
  insufficient_reason:
    "Pas assez de données pour conclure : il faut au moins 3 mois complets de relevés portant des dépenses, et l'historique en compte 2.",
  essential_category_count: 21,
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function setupFetch(overrides: { forecast?: () => Response; runway?: () => Response } = {}) {
  fetchMock.mockImplementation((input: string) => {
    const url = new URL(typeof input === "string" ? input : String(input), "http://localhost");
    if (url.pathname === "/api/cashflow/forecast") {
      return Promise.resolve(overrides.forecast ? overrides.forecast() : jsonResponse(forecast));
    }
    if (url.pathname === "/api/cashflow/runway") {
      return Promise.resolve(overrides.runway ? overrides.runway() : jsonResponse(runway));
    }
    throw new Error(`Unhandled fetch in test: ${url.pathname}`);
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false, media: query,
      addEventListener: vi.fn(), removeEventListener: vi.fn(),
      addListener: vi.fn(), removeListener: vi.fn(),
    })),
  });
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/tresorerie"]}>
      <ThemeProvider>
        <CashflowPage />
      </ThemeProvider>
    </MemoryRouter>,
  );
}

describe("CashflowPage", () => {
  it("shows both runway scenarios", async () => {
    setupFetch();
    renderPage();
    expect(await screen.findByText("Rythme actuel")).toBeInTheDocument();
    expect(screen.getByText("Dépenses réduites à l'essentiel")).toBeInTheDocument();
  });

  it("names the first month the balance could fall under the threshold", async () => {
    setupFetch();
    renderPage();
    expect(await screen.findByText(/octobre 2026/i)).toBeInTheDocument();
  });

  it("states how many months the measurement rests on", async () => {
    setupFetch();
    renderPage();
    expect(await screen.findByText(/9 mois complets/)).toBeInTheDocument();
  });

  it("warns when the rate rests on the bare minimum", async () => {
    setupFetch({
      runway: () => jsonResponse({ ...runway, months_observed: 3 }),
    });
    renderPage();
    expect(await screen.findByText(/3 mois complets seulement/)).toBeInTheDocument();
  });

  it("prints the backend's refusal instead of an empty chart", async () => {
    setupFetch({ forecast: () => jsonResponse(thinForecast) });
    renderPage();
    expect(await screen.findByText(/au moins 6 mois complets/)).toBeInTheDocument();
  });

  it("prints the runway refusal separately from the forecast refusal", async () => {
    setupFetch({ forecast: () => jsonResponse(thinForecast), runway: () => jsonResponse(thinRunway) });
    renderPage();
    expect(await screen.findByText(/au moins 6 mois complets/)).toBeInTheDocument();
    expect(screen.getByText(/au moins 3 mois complets/)).toBeInTheDocument();
  });

  it("says what the reduced scenario rests on", async () => {
    setupFetch();
    renderPage();
    expect(await screen.findByText(/21 catégories marquées essentielles/)).toBeInTheDocument();
  });

  it("surfaces a failed load in French", async () => {
    setupFetch({ runway: () => jsonResponse({ detail: "Base indisponible" }, 500) });
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent("Base indisponible");
  });
});
```

- [ ] **Step 4: Run it to verify it fails, then write `CashflowPage`**

Run from `frontend/`: `npm test -- CashflowPage` → FAIL, module not found.

Create `frontend/src/features/cashflow/CashflowPage.tsx`:

```tsx
import { motion } from "motion/react";
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router";

import { ForecastFanChart } from "../../charts/ForecastFanChart";
import { BentoCell, type BentoSpan } from "../../design/bento/BentoCell";
import { BentoGrid } from "../../design/bento/BentoGrid";
import { CountUp } from "../../design/CountUp";
import { useReducedMotion } from "../../design/motion/useReducedMotion";
import { entryProps, staggerProps } from "../../design/motion/variants";
import { formatCents } from "../../design/theme";
import { ApiError, api } from "../../lib/api";
import { plural } from "../../lib/plural";
import type { Forecast, Runway } from "../../lib/types";
import { RunwayPanel } from "./RunwayPanel";
import "./CashflowPage.css";

const GENERIC_ERROR = "Une erreur inattendue est survenue.";

function messageFor(err: unknown): string {
  return err instanceof ApiError ? err.detail : GENERIC_ERROR;
}

function monthLongLabel(key: string): string {
  const [year, month] = key.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("fr-FR", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

const SPAN = {
  balance: { base: 1, md: 6, lg: 4 },
  runway: { base: 1, md: 6, lg: 8 },
  forecast: { base: 1, md: 6, lg: 12 },
} satisfies Record<string, BentoSpan>;

interface LoadErrors {
  forecast?: string;
  runway?: string;
}

export function CashflowPage() {
  const reduced = useReducedMotion();
  const [forecast, setForecast] = useState<Forecast | null>(null);
  const [runway, setRunway] = useState<Runway | null>(null);
  const [errors, setErrors] = useState<LoadErrors>({});
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [forecastResult, runwayResult] = await Promise.allSettled([
        api.get<Forecast>("/cashflow/forecast"),
        api.get<Runway>("/cashflow/runway"),
      ]);
      if (cancelled) return;

      const nextErrors: LoadErrors = {};
      if (forecastResult.status === "fulfilled") setForecast(forecastResult.value);
      else {
        setForecast(null);
        nextErrors.forecast = messageFor(forecastResult.reason);
      }
      if (runwayResult.status === "fulfilled") setRunway(runwayResult.value);
      else {
        setRunway(null);
        nextErrors.runway = messageFor(runwayResult.reason);
      }
      setErrors(nextErrors);
      setIsLoading(false);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const errorMessages = Object.values(errors).filter((message): message is string => Boolean(message));

  let body: ReactNode;
  if (isLoading) {
    body = (
      <BentoGrid role="status" aria-busy="true" aria-label="Chargement de la trésorerie">
        <BentoCell span={SPAN.balance} className="yd-panel">
          <div className="yd-skeleton yd-skeleton--title" aria-hidden="true" />
          <div className="yd-skeleton yd-skeleton--value" aria-hidden="true" />
        </BentoCell>
        <BentoCell span={SPAN.runway} className="yd-panel">
          <div className="yd-skeleton yd-skeleton--title" aria-hidden="true" />
          <div className="yd-skeleton yd-skeleton--meta" aria-hidden="true" />
        </BentoCell>
        <BentoCell span={SPAN.forecast} className="yd-panel">
          <div className="yd-skeleton yd-skeleton--chart" aria-hidden="true" />
        </BentoCell>
      </BentoGrid>
    );
  } else {
    body = (
      <BentoGrid as={motion.div} {...staggerProps(reduced)}>
        <BentoCell as={motion.div} span={SPAN.balance} className="yd-panel" {...entryProps(reduced)}>
          <h2 className="yd-panel__title">Solde disponible</h2>
          {runway !== null ? (
            <>
              <CountUp
                value={runway.balance_cents}
                format={(cents) => formatCents(cents, { signed: true })}
                className="yd-cashflow__balance"
              />
              <p className="yd-cashflow__note">
                Comptes courants, livrets et espèces. Les placements ne sont pas comptés :
                les vendre est une décision, pas un retrait.
              </p>
            </>
          ) : (
            <p className="yd-cashflow__note">Solde indisponible.</p>
          )}
        </BentoCell>

        <BentoCell as={motion.div} span={SPAN.runway} className="yd-panel" {...entryProps(reduced)}>
          <h2 className="yd-panel__title">Combien de temps sans revenu</h2>
          {runway === null ? null : runway.insufficient_reason !== null ? (
            <p className="yd-cashflow__insufficient">{runway.insufficient_reason}</p>
          ) : (
            <>
              <div className="yd-cashflow__scenarios">
                <RunwayPanel scenario={runway.normal} label="Rythme actuel" />
                <RunwayPanel scenario={runway.essentials} label="Dépenses réduites à l'essentiel" />
              </div>
              <p className="yd-cashflow__note">
                {`Mesuré sur ${runway.months_observed} ${plural(runway.months_observed, "mois complet", "mois complets")}`}
                {runway.months_observed <= 3
                  ? // Three is the floor at which a median exists at all. Saying
                    // so is the difference between a measurement and a claim.
                    ` seulement — le rythme mesuré reste fragile.`
                  : ` de relevés.`}
              </p>
              <p className="yd-cashflow__note">
                {`Le scénario réduit repose sur ${runway.essential_category_count} ${plural(runway.essential_category_count, "catégorie marquée essentielle", "catégories marquées essentielles")}. `}
                <Link to="/budgets">Modifier cette liste</Link>
              </p>
            </>
          )}
        </BentoCell>

        <BentoCell as={motion.div} span={SPAN.forecast} className="yd-panel" {...entryProps(reduced)}>
          <h2 className="yd-panel__title">Prévision sur douze mois</h2>
          {forecast === null ? null : forecast.insufficient_reason !== null ? (
            <p className="yd-cashflow__insufficient">{forecast.insufficient_reason}</p>
          ) : (
            <>
              <ForecastFanChart months={forecast.months} thresholdCents={forecast.threshold_cents} />
              <p className="yd-cashflow__note">
                {forecast.first_breach_key !== null
                  ? `Le solde pourrait passer sous ${formatCents(forecast.threshold_cents)} dès ${monthLongLabel(forecast.first_breach_key)}.`
                  : `Le solde ne passe sous ${formatCents(forecast.threshold_cents)} sur aucun des mois projetés.`}
              </p>
              <p className="yd-cashflow__note">
                {`Projection établie sur ${forecast.months_observed} ${plural(forecast.months_observed, "mois complet observé", "mois complets observés")}. `}
                {forecast.seasonality_used
                  ? "La saisonnalité observée est prise en compte."
                  : "Aucun mois n'a été observé deux fois : la saisonnalité n'est pas prise en compte."}
                {" La bande indique une fourchette, pas une certitude."}
              </p>
            </>
          )}
        </BentoCell>
      </BentoGrid>
    );
  }

  return (
    <section className="yd-cashflow">
      <div className="yd-cashflow__header">
        <h1>Trésorerie</h1>
      </div>

      {errorMessages.map((message) => (
        <p role="alert" className="yd-cashflow__alert" key={message}>
          {message}
        </p>
      ))}

      {body}
    </section>
  );
}
```

- [ ] **Step 5: Write the stylesheet**

Create `frontend/src/features/cashflow/CashflowPage.css`:

```css
.yd-cashflow__header { margin-bottom: var(--yd-space-lg); }

.yd-cashflow__balance,
.yd-runway__months {
  font-family: var(--yd-font-mono);
  font-variant-numeric: tabular-nums;
  font-size: clamp(1.6rem, 4.5vw, 2.4rem);
  color: var(--yd-text);
}

.yd-cashflow__scenarios {
  display: grid;
  /* minmax(0, 1fr) so a long duration string cannot set the track's minimum
     and push the pair past the cell at 375. */
  grid-template-columns: minmax(0, 1fr);
  gap: var(--yd-space-md);
}

@media (min-width: 640px) {
  .yd-cashflow__scenarios {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

.yd-runway {
  display: flex;
  flex-direction: column;
  gap: var(--yd-space-2xs);
  padding: var(--yd-space-sm);
  border-radius: var(--yd-radius-sm);
  border: 1px solid var(--yd-border);
  background: var(--yd-surface);
}

.yd-runway__label {
  font-size: 0.86rem;
  color: var(--yd-text-muted);
}

.yd-runway__detail,
.yd-runway__unavailable,
.yd-cashflow__note {
  margin: 0;
  font-size: 0.86rem;
  color: var(--yd-text-muted);
}

/* A refusal is content, not an error: it says what is missing and how to fix
   it. Styled as a plain informative block rather than in the negative colour,
   which is reserved for something having gone wrong. */
.yd-cashflow__insufficient {
  margin: 0;
  padding: var(--yd-space-sm) var(--yd-space-md);
  border-radius: var(--yd-radius-sm);
  border: 1px solid var(--yd-border-strong);
  background: var(--yd-surface);
  color: var(--yd-text);
}

.yd-cashflow__alert {
  margin: 0 0 var(--yd-space-md);
  padding: var(--yd-space-sm) var(--yd-space-md);
  border-radius: var(--yd-radius-sm);
  border: 1px solid var(--yd-negative);
  color: var(--yd-text);
}
```

- [ ] **Step 6: Register the route and the nav entry**

`routes.tsx`: import `CashflowPage`, add `{ path: "tresorerie", element: <CashflowPage /> },`.
`AppShell.tsx`: add `{ to: "/tresorerie", label: "Trésorerie" },` after Récurrences.
`AppShell.test.tsx`: update the nav assertions.

- [ ] **Step 7: Run the frontend suite**

Run from `frontend/`: `npm test` → PASS. `npm run build` → zero TypeScript errors.

- [ ] **Step 8: Browser verification**

Re-seed, start the app, log in, go to `/tresorerie`.

**Expect a mixed screen on the operator's fixture:** the runway computes (three observed months, flagged "3 mois complets seulement"), and the forecast refuses (six required). That contrast is the point of the screen and must be screenshotted as-is.

To also see the populated forecast, import a ten-month CSV, screenshot, then **roll that batch back** through `/import` before finishing — the fixture ends the task at 197 transactions.

Screenshot all six combinations (375 / 768 / 1440 × clair / sombre) in both states.

Check in the browser:

- [ ] The refusal block reads as an explanation, not as an error. It must not be in the negative colour and must not sit beside an empty chart with axes.
- [ ] **The fan band is visible and is not twice as tall as it should be.** The stacked-series trick is the most likely defect here: read the P90 gridline against the printed figures in the export CSV and confirm the shaded top edge sits at P90, not at P10 + P90.
- [ ] The band is distinguishable from the page background in **both** themes at 18 % opacity — check it has not vanished into the light theme's white card.
- [ ] The dashed median line reads as a projection and is distinguishable from the solid threshold line.
- [ ] The threshold `markLine` label does not overprint the last data point at 375 px. The waterfall chart shipped exactly this defect in phase 1.5 ("+10 220 900 €").
- [ ] Twelve month labels on the x-axis at 375 px: they must not overlap into an unreadable smear. If they do, thin them (every other label) rather than rotating them to vertical.
- [ ] The two runway panels sit side by side at 640 px and up, stack below, and neither clips its duration string.
- [ ] `--yd-text-muted` on `--yd-surface` inside `.yd-runway` clears 4.5:1 in both themes. This is a translucent surface over a bento cell over a halo — measure the composited pixel.
- [ ] Reduced motion on: the chart renders without its draw-in animation and the cells are at full opacity.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/features/cashflow frontend/src/app/routes.tsx frontend/src/app/AppShell.tsx frontend/src/app/AppShell.test.tsx
git commit -m "feat(cashflow): add the treasury screen with runway scenarios and the forecast band"
```

---

# Lot E — Inflation personnelle et anomalies

### Task 15: Personal inflation engine

Design spec §6.2: "Évolution du coût du panier réel de l'utilisateur, catégorie par catégorie, comparée à l'indice INSEE. Répond à « où mon argent part-il davantage qu'avant ? »."

Two windows twelve months apart, compared **per observed month** rather than as totals: the operator's ledger has three months of data in one window and none in the other, and comparing raw totals across windows with different amounts of coverage would report a 100 % collapse in every category.

**Files:**
- Create: `backend/app/engines/inflation.py`
- Test: `backend/tests/test_inflation.py`

**Interfaces:**
- Consumes: `app.engines.robust.median_cents`.
- Produces:
  - `Window(start: date, end: date)`
  - `CategorySpend(on: date, amount_cents: int, category_id: int | None)`
  - `CategoryInflation(category_id, current_cost_cents, previous_cost_cents, delta_cents, ratio, months_current, months_previous, comparable, reason)`
  - `InflationReport(current, previous, lines, basket_current_cost_cents, basket_previous_cost_cents, basket_ratio, reference_ratio, comparable, reason)`
  - `previous_year_window(current: Window) -> Window`
  - `reference_ratio_from_index(points: list[tuple[date, int]], current: Window, previous: Window) -> float | None`
  - `compute_inflation(entries, current, index_points) -> InflationReport`
  - `MIN_MONTHS_PER_WINDOW = 3`
- **Sign convention, module-local and deliberate:** every `*_cost_cents` here is a **positive** magnitude. Personal inflation is about the price of a basket, and a basket's price is a positive number; the field names carry `_cost_` precisely so the difference from the rest of the codebase is visible at every call site. `delta_cents` is signed and positive when the basket got more expensive.
- Task 17 consumes it.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_inflation.py`:

```python
from datetime import date

import pytest

from app.engines.inflation import (
    MIN_MONTHS_PER_WINDOW,
    CategorySpend,
    Window,
    compute_inflation,
    previous_year_window,
    reference_ratio_from_index,
)

CURRENT = Window(start=date(2026, 1, 1), end=date(2026, 6, 30))


def _spend(year: int, month: int, category_id: int, amount: int) -> CategorySpend:
    return CategorySpend(on=date(year, month, 12), amount_cents=amount, category_id=category_id)


def _six_months(year: int, category_id: int, amount: int, first_month: int = 1):
    return [_spend(year, first_month + index, category_id, amount) for index in range(6)]


def test_the_previous_window_is_the_same_span_a_year_earlier():
    previous = previous_year_window(CURRENT)
    assert previous.start == date(2025, 1, 1)
    assert previous.end == date(2025, 6, 30)


def test_a_leap_day_window_does_not_crash_on_a_non_leap_year():
    previous = previous_year_window(Window(start=date(2024, 2, 29), end=date(2024, 8, 29)))
    assert previous.start == date(2023, 2, 28)


def test_a_category_that_costs_more_reports_a_positive_ratio():
    entries = _six_months(2026, 1, -30_000) + _six_months(2025, 1, -25_000)
    report = compute_inflation(entries, CURRENT, [])
    line = next(line for line in report.lines if line.category_id == 1)

    assert line.comparable is True
    assert line.current_cost_cents == 30_000
    assert line.previous_cost_cents == 25_000
    assert line.delta_cents == 5_000
    assert line.ratio == pytest.approx(0.2)


def test_a_category_that_costs_less_reports_a_negative_ratio():
    entries = _six_months(2026, 1, -20_000) + _six_months(2025, 1, -25_000)
    line = next(l for l in compute_inflation(entries, CURRENT, []).lines if l.category_id == 1)
    assert line.ratio == pytest.approx(-0.2)
    assert line.delta_cents == -5_000


def test_the_comparison_is_per_month_not_per_total():
    """Six months of data against three months of data. Comparing totals would
    report a 50 % fall; comparing the median month reports no change, which is
    what the ledger actually says."""
    entries = _six_months(2026, 1, -30_000) + [
        _spend(2025, month, 1, -30_000) for month in (1, 2, 3)
    ]
    line = next(l for l in compute_inflation(entries, CURRENT, []).lines if l.category_id == 1)
    assert line.ratio == pytest.approx(0.0)
    assert line.months_current == 6
    assert line.months_previous == 3


def test_a_window_with_too_few_months_is_not_comparable_and_says_why():
    """The operator's own case: everything twelve months back is empty. The line
    must appear with a reason, not silently vanish and not report -100 %."""
    entries = _six_months(2026, 1, -30_000)
    line = next(l for l in compute_inflation(entries, CURRENT, []).lines if l.category_id == 1)

    assert line.comparable is False
    assert line.ratio is None
    assert line.months_previous == 0
    assert line.reason is not None
    assert "3 mois" in line.reason
    assert MIN_MONTHS_PER_WINDOW == 3


def test_a_previous_window_of_exactly_zero_never_divides_by_zero():
    entries = _six_months(2026, 1, -30_000) + [_spend(2025, month, 1, 0) for month in range(1, 7)]
    line = next(l for l in compute_inflation(entries, CURRENT, []).lines if l.category_id == 1)
    assert line.ratio is None
    assert line.comparable is False


def test_income_is_not_part_of_the_basket():
    """"Where is my money going more than before" is about spending. A salary
    rise is a real fact but it is not inflation."""
    entries = _six_months(2026, 1, 220_000) + _six_months(2025, 1, 200_000)
    assert compute_inflation(entries, CURRENT, []).lines == []


def test_the_basket_total_is_reported_when_enough_categories_are_comparable():
    entries = (
        _six_months(2026, 1, -30_000) + _six_months(2025, 1, -25_000)
        + _six_months(2026, 2, -10_000) + _six_months(2025, 2, -10_000)
    )
    report = compute_inflation(entries, CURRENT, [])
    assert report.comparable is True
    assert report.basket_current_cost_cents == 40_000
    assert report.basket_previous_cost_cents == 35_000
    assert report.basket_ratio == pytest.approx(5_000 / 35_000)


def test_the_basket_refuses_when_nothing_is_comparable():
    report = compute_inflation(_six_months(2026, 1, -30_000), CURRENT, [])
    assert report.comparable is False
    assert report.basket_ratio is None
    assert report.reason is not None


def test_the_worst_increase_comes_first():
    entries = (
        _six_months(2026, 1, -11_000) + _six_months(2025, 1, -10_000)   # +10 %
        + _six_months(2026, 2, -15_000) + _six_months(2025, 2, -10_000)  # +50 %
    )
    lines = [line for line in compute_inflation(entries, CURRENT, []).lines if line.comparable]
    assert [line.category_id for line in lines] == [2, 1]


def test_incomparable_lines_sort_after_comparable_ones():
    entries = (
        _six_months(2026, 1, -11_000) + _six_months(2025, 1, -10_000)
        + _six_months(2026, 2, -15_000)
    )
    lines = compute_inflation(entries, CURRENT, []).lines
    assert lines[-1].comparable is False


def test_a_reference_index_is_used_when_it_covers_both_windows():
    """User-supplied, never fetched. 118.42 is stored as 11842 hundredths."""
    points = [(date(2025, month, 1), 11_842) for month in range(1, 7)]
    points += [(date(2026, month, 1), 12_078) for month in range(1, 7)]
    ratio = reference_ratio_from_index(points, CURRENT, previous_year_window(CURRENT))
    assert ratio == pytest.approx((12_078 - 11_842) / 11_842)


def test_no_reference_index_is_no_reference_ratio_not_zero():
    assert reference_ratio_from_index([], CURRENT, previous_year_window(CURRENT)) is None


def test_a_reference_index_covering_only_one_window_is_unusable():
    points = [(date(2026, month, 1), 12_078) for month in range(1, 7)]
    assert reference_ratio_from_index(points, CURRENT, previous_year_window(CURRENT)) is None


def test_the_reference_ratio_reaches_the_report():
    entries = _six_months(2026, 1, -30_000) + _six_months(2025, 1, -25_000)
    points = [(date(2025, m, 1), 11_842) for m in range(1, 7)]
    points += [(date(2026, m, 1), 12_078) for m in range(1, 7)]
    report = compute_inflation(entries, CURRENT, points)
    assert report.reference_ratio is not None
    assert report.basket_ratio > report.reference_ratio
```

- [ ] **Step 2: Run it to verify it fails, then write `inflation.py`**

Run from `backend/`: `.venv/Scripts/pytest.exe tests/test_inflation.py -v` → FAIL, module not found.

Create `backend/app/engines/inflation.py`:

```python
"""What the user's own basket costs now against twelve months ago.

Year-over-year and nothing else. "Inflation personnelle" means the same basket a
year apart; comparing a three-month window against the three months before it
measures seasonality wearing inflation's name.

Two decisions that carry the honesty of the whole module:

* the comparison is **per observed month**, never per window total. The
  operator's ledger holds three months of data inside one window and none
  inside the other, and comparing totals across windows with different coverage
  would report a collapse in every category that is an artefact of which
  statements were imported;
* a category is only compared when **both** windows hold at least
  `MIN_MONTHS_PER_WINDOW` months with data. Otherwise the line still appears,
  marked not comparable, with the reason -- never dropped silently, and never
  reported as -100 %.

Sign convention, module-local and deliberate: every `*_cost_cents` here is a
POSITIVE magnitude. A basket's price is a positive number, and the field names
carry `_cost_` so the departure from the codebase's negative-outflow convention
is visible at every call site. `delta_cents` is signed and positive when the
basket got more expensive.

Pure: no session, no network, no implicit clock.
"""

from dataclasses import dataclass
from datetime import date

from app.engines.robust import median_cents

# Three months with data in EACH window. Below that the "median month" is one or
# two numbers, and a percentage built on it is a decimal point pretending to be
# a measurement.
MIN_MONTHS_PER_WINDOW = 3


@dataclass(frozen=True)
class Window:
    start: date
    end: date


@dataclass(frozen=True)
class CategorySpend:
    on: date
    amount_cents: int
    category_id: int | None


@dataclass(frozen=True)
class CategoryInflation:
    category_id: int | None
    # Median monthly cost, positive. 0 when not comparable.
    current_cost_cents: int
    previous_cost_cents: int
    # Signed: positive when this category got more expensive.
    delta_cents: int
    # None whenever no honest ratio exists -- never 0, which would read as
    # "unchanged".
    ratio: float | None
    months_current: int
    months_previous: int
    comparable: bool
    # French. Non-null exactly when `comparable` is False.
    reason: str | None


@dataclass(frozen=True)
class InflationReport:
    current: Window
    previous: Window
    lines: list[CategoryInflation]
    basket_current_cost_cents: int
    basket_previous_cost_cents: int
    basket_ratio: float | None
    # From a user-supplied index only. None when none was entered or when the
    # series does not cover both windows. Never fetched from anywhere.
    reference_ratio: float | None
    comparable: bool
    reason: str | None


def _shift_back_one_year(day: date) -> date:
    try:
        return day.replace(year=day.year - 1)
    except ValueError:
        # 29 February in a year whose predecessor is not a leap year.
        return day.replace(year=day.year - 1, day=28)


def previous_year_window(current: Window) -> Window:
    return Window(start=_shift_back_one_year(current.start),
                  end=_shift_back_one_year(current.end))


def _monthly_costs(
    entries: list[CategorySpend], window: Window
) -> dict[int | None, list[int]]:
    """Per category, the monthly cost totals inside `window`, as magnitudes."""
    per_month: dict[tuple[int | None, str], int] = {}
    for entry in entries:
        # Only spending. A salary rise is a real fact and is not inflation.
        if entry.amount_cents >= 0:
            continue
        if entry.on < window.start or entry.on > window.end:
            continue
        key = (entry.category_id, f"{entry.on.year}-{entry.on.month:02d}")
        per_month[key] = per_month.get(key, 0) + abs(entry.amount_cents)

    grouped: dict[int | None, list[int]] = {}
    for (category_id, _month), total in per_month.items():
        grouped.setdefault(category_id, []).append(total)
    return grouped


def reference_ratio_from_index(
    points: list[tuple[date, int]], current: Window, previous: Window
) -> float | None:
    """The reference index's own change between the two windows.

    `points` are `(first day of month, index value in hundredths)` pairs, typed
    in by the user. Returns None -- never 0 -- when the series does not cover
    both windows: a missing comparison is not a comparison showing no change.
    """
    def _median_in(window: Window) -> int | None:
        values = [value for month, value in points if window.start <= month <= window.end]
        return median_cents(values) if values else None

    now = _median_in(current)
    before = _median_in(previous)
    if now is None or before is None or before == 0:
        return None
    return (now - before) / before


def compute_inflation(
    entries: list[CategorySpend],
    current: Window,
    index_points: list[tuple[date, int]],
) -> InflationReport:
    previous = previous_year_window(current)
    now = _monthly_costs(entries, current)
    before = _monthly_costs(entries, previous)

    lines: list[CategoryInflation] = []
    for category_id in sorted(set(now) | set(before), key=lambda value: (value is None, value)):
        current_months = now.get(category_id, [])
        previous_months = before.get(category_id, [])
        current_cost = median_cents(current_months) if current_months else 0
        previous_cost = median_cents(previous_months) if previous_months else 0

        comparable = (
            len(current_months) >= MIN_MONTHS_PER_WINDOW
            and len(previous_months) >= MIN_MONTHS_PER_WINDOW
            and previous_cost > 0
        )
        reason: str | None = None
        ratio: float | None = None
        if comparable:
            ratio = (current_cost - previous_cost) / previous_cost
        else:
            reason = (
                f"Pas assez de données pour conclure : il faut au moins "
                f"{MIN_MONTHS_PER_WINDOW} mois de dépenses dans chacune des deux "
                f"périodes, et cette catégorie en compte {len(current_months)} "
                f"sur la période récente et {len(previous_months)} un an plus tôt."
            )

        lines.append(CategoryInflation(
            category_id=category_id,
            current_cost_cents=current_cost,
            previous_cost_cents=previous_cost,
            delta_cents=current_cost - previous_cost,
            ratio=ratio,
            months_current=len(current_months),
            months_previous=len(previous_months),
            comparable=comparable,
            reason=reason,
        ))

    # Steepest rise first among the comparable lines; everything that could not
    # be compared falls to the bottom rather than being interleaved as if it
    # were a zero.
    lines.sort(key=lambda line: (not line.comparable, -(line.ratio or 0.0)))

    comparable_lines = [line for line in lines if line.comparable]
    basket_now = sum(line.current_cost_cents for line in comparable_lines)
    basket_before = sum(line.previous_cost_cents for line in comparable_lines)
    basket_ratio = (
        (basket_now - basket_before) / basket_before if basket_before > 0 else None
    )

    report_reason: str | None = None
    if not comparable_lines:
        report_reason = (
            "Pas assez de données pour conclure : aucune catégorie ne dispose de "
            f"{MIN_MONTHS_PER_WINDOW} mois de dépenses à la fois sur la période "
            "choisie et sur la même période un an plus tôt. Importez des relevés "
            "couvrant les deux périodes pour obtenir une comparaison."
        )

    return InflationReport(
        current=current,
        previous=previous,
        lines=lines,
        basket_current_cost_cents=basket_now,
        basket_previous_cost_cents=basket_before,
        basket_ratio=basket_ratio,
        reference_ratio=reference_ratio_from_index(index_points, current, previous),
        comparable=bool(comparable_lines),
        reason=report_reason,
    )
```

- [ ] **Step 3: Run the test and commit**

Run from `backend/`: `.venv/Scripts/pytest.exe tests/test_inflation.py -v` → PASS, 15 tests.
Run from `backend/`: `.venv/Scripts/pytest.exe -q` → 391 passed.

```bash
git add backend/app/engines/inflation.py backend/tests/test_inflation.py
git commit -m "feat(engines): measure personal basket inflation year over year"
```

---

### Task 16: Anomaly detection engine

Design spec §6.2: "Écart statistique par rapport à l'historique de la catégorie, méthode robuste (médiane et écart absolu médian) pour ne pas être faussée par les valeurs extrêmes. Évite les seuils arbitraires."

The threshold is Iglewicz & Hoaglin's published 3.5, already living in `robust.py` — not a number chosen here.

**Files:**
- Modify: `backend/app/engines/anomaly.py` (the `AnomalyTx` dataclass from task 2 stays at the top)
- Test: `backend/tests/test_anomaly.py`

**Interfaces:**
- Consumes: `app.engines.robust.{OUTLIER_Z, describe, modified_z}`.
- Produces:
  - `Anomaly(transaction_id, on, amount_cents, label, category_id, category_median_cents, modified_z, direction)`
  - `SkippedCategory(category_id, direction, observations, reason)`
  - `AnomalyReport(anomalies, skipped, scored_groups)`
  - `detect_anomalies(history: list[AnomalyTx], window_start: date, window_end: date) -> AnomalyReport`
  - `MIN_HISTORY = 10`
- Task 17 consumes it.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_anomaly.py`:

```python
from datetime import date, timedelta

from app.engines.anomaly import MIN_HISTORY, AnomalyTx, detect_anomalies

WINDOW_START = date(2025, 1, 1)
WINDOW_END = date(2026, 12, 31)


def _rows(category_id: int, amounts: list[int], start: date = date(2025, 1, 1)):
    return [
        AnomalyTx(id=index + 1, on=start + timedelta(days=index * 3),
                  amount_cents=amount, label=f"ACHAT {index}", category_id=category_id)
        for index, amount in enumerate(amounts)
    ]


def test_an_expense_far_beyond_the_categorys_habit_is_flagged():
    rows = _rows(1, [-4000] * 11 + [-90000])
    report = detect_anomalies(rows, WINDOW_START, WINDOW_END)
    assert [a.amount_cents for a in report.anomalies] == [-90000]
    assert report.anomalies[0].direction == "high"
    assert report.anomalies[0].category_median_cents == 4000


def test_an_ordinary_expense_is_not_flagged():
    rows = _rows(1, [-4000, -4200, -3900, -4100, -4050, -3950, -4150, -4000, -4300, -3800])
    assert detect_anomalies(rows, WINDOW_START, WINDOW_END).anomalies == []


def test_one_extreme_value_does_not_hide_the_next_one():
    """The median and MAD are computed over the whole history including the
    outliers; that is the point of using them. A mean and a standard deviation
    would be dragged out far enough to swallow the second."""
    rows = _rows(1, [-4000] * 10 + [-90000, -95000])
    report = detect_anomalies(rows, WINDOW_START, WINDOW_END)
    assert len(report.anomalies) == 2


def test_a_category_with_too_short_a_history_is_skipped_not_guessed():
    """The operator has 19 categories in use over 197 rows -- several sit under
    ten observations, and a MAD computed on four points is arithmetic, not
    statistics."""
    rows = _rows(1, [-4000] * 8 + [-90000])
    report = detect_anomalies(rows, WINDOW_START, WINDOW_END)
    assert report.anomalies == []
    assert len(report.skipped) == 1
    assert report.skipped[0].observations == 9
    assert "10" in report.skipped[0].reason
    assert MIN_HISTORY == 10


def test_a_category_whose_amount_never_varies_yields_no_anomaly():
    """Twelve identical charges carry no scale. Any value would be infinitely
    far from the centre, which is not a finding."""
    rows = _rows(1, [-1549] * 12)
    report = detect_anomalies(rows, WINDOW_START, WINDOW_END)
    assert report.anomalies == []


def test_a_single_different_charge_among_identical_ones_is_still_caught():
    """MAD is zero here, so scoring falls back to the mean absolute deviation --
    the documented alternative, not an invented rule."""
    rows = _rows(1, [-1549] * 11 + [-9999])
    report = detect_anomalies(rows, WINDOW_START, WINDOW_END)
    assert [a.amount_cents for a in report.anomalies] == [-9999]


def test_income_and_expenses_are_scored_separately():
    """A 2 200 EUR salary is not an anomalous grocery run. Grouping by sign
    keeps a category holding both from flagging every one of them."""
    expenses = _rows(1, [-4000] * 11 + [-4200])
    incomes = _rows(1, [220000] * 11 + [225000], start=date(2025, 6, 1))
    # Distinct ids across the two blocks: `_rows` numbers from 1 each time.
    incomes = [
        AnomalyTx(id=row.id + 100, on=row.on, amount_cents=row.amount_cents,
                  label=row.label, category_id=row.category_id)
        for row in incomes
    ]
    report = detect_anomalies(expenses + incomes, WINDOW_START, WINDOW_END)
    assert report.anomalies == []


def test_an_unusually_small_charge_is_reported_as_low():
    rows = _rows(1, [-40000] * 11 + [-100])
    report = detect_anomalies(rows, WINDOW_START, WINDOW_END)
    assert report.anomalies[0].direction == "low"


def test_only_anomalies_inside_the_window_are_reported():
    """Scored against the whole history, reported for the period on screen. A
    period filter that also narrowed the history would rescore every category
    against a handful of rows."""
    rows = _rows(1, [-4000] * 11 + [-90000], start=date(2025, 1, 1))
    late = rows[-1]
    report = detect_anomalies(rows, date(2026, 1, 1), date(2026, 12, 31))
    assert report.anomalies == []
    assert late.on < date(2026, 1, 1)


def test_the_biggest_deviation_comes_first():
    rows = _rows(1, [-4000] * 10 + [-60000, -90000])
    report = detect_anomalies(rows, WINDOW_START, WINDOW_END)
    assert len(report.anomalies) == 2
    assert report.anomalies[0].amount_cents == -90000
    assert abs(report.anomalies[0].modified_z) >= abs(report.anomalies[1].modified_z)


def test_uncategorized_rows_are_not_scored_against_each_other():
    """"Non catégorisé" is not a category: its rows have nothing in common, and
    a median over them describes nothing."""
    rows = [
        AnomalyTx(id=index + 1, on=date(2025, 1, 1) + timedelta(days=index),
                  amount_cents=amount, label="X", category_id=None)
        for index, amount in enumerate([-4000] * 11 + [-90000])
    ]
    report = detect_anomalies(rows, WINDOW_START, WINDOW_END)
    assert report.anomalies == []


def test_an_empty_history_is_an_empty_report_not_a_crash():
    report = detect_anomalies([], WINDOW_START, WINDOW_END)
    assert report.anomalies == []
    assert report.skipped == []
    assert report.scored_groups == 0
```

- [ ] **Step 2: Run it to verify it fails, then write `anomaly.py`**

Run from `backend/`: `.venv/Scripts/pytest.exe tests/test_anomaly.py -v` → FAIL, `ImportError: cannot import name 'detect_anomalies'`.

Append to `backend/app/engines/anomaly.py`, below the `AnomalyTx` dataclass created in task 2:

```python
from typing import Literal

from app.engines.robust import OUTLIER_Z, describe, modified_z

Direction = Literal["high", "low"]

# Ten observations before any outlier claim. Iglewicz & Hoaglin's own guidance
# for the modified z-score; below it the MAD is arithmetic rather than
# statistics, and the operator has several categories sitting just under.
MIN_HISTORY = 10


@dataclass(frozen=True)
class Anomaly:
    transaction_id: int
    on: date
    amount_cents: int
    label: str
    category_id: int | None
    # The category's usual amount, as a magnitude.
    category_median_cents: int
    # Robust deviations from that median. Signed.
    modified_z: float
    direction: Direction


@dataclass(frozen=True)
class SkippedCategory:
    category_id: int | None
    # "high" and "low" are scored inside one group; this names which sign group
    # was skipped -- "expense" or "income".
    direction: str
    observations: int
    # French.
    reason: str


@dataclass(frozen=True)
class AnomalyReport:
    anomalies: list[Anomaly]
    skipped: list[SkippedCategory]
    scored_groups: int


def detect_anomalies(
    history: list[AnomalyTx], window_start: date, window_end: date
) -> AnomalyReport:
    """Transactions inside the window that are unusual for their own category.

    Scored against the category's **whole** history, reported only for the
    window on screen. Narrowing the history with the period would rescore every
    category against a handful of rows and turn ordinary spending into alerts
    whenever the reader zoomed in.

    Grouped by category *and sign*: a 2 200 EUR salary is not an anomalous
    grocery run, and a category holding both would otherwise flag every row in
    it. Rows with no category are never scored -- "Non catégorisé" is not a
    category, its rows have nothing in common, and a median over them describes
    nothing.
    """
    groups: dict[tuple[int, str], list[AnomalyTx]] = {}
    for row in history:
        if row.category_id is None:
            continue
        sign = "expense" if row.amount_cents < 0 else "income"
        groups.setdefault((row.category_id, sign), []).append(row)

    anomalies: list[Anomaly] = []
    skipped: list[SkippedCategory] = []
    scored = 0

    for (category_id, sign), rows in sorted(groups.items()):
        if len(rows) < MIN_HISTORY:
            skipped.append(SkippedCategory(
                category_id=category_id,
                direction=sign,
                observations=len(rows),
                reason=(
                    f"Pas assez de données pour conclure : il faut au moins "
                    f"{MIN_HISTORY} opérations dans cette catégorie pour juger "
                    f"qu'un montant sort de l'ordinaire, et celle-ci en compte "
                    f"{len(rows)}."
                ),
            ))
            continue

        magnitudes = [abs(row.amount_cents) for row in rows]
        spread = describe(magnitudes)
        scored += 1

        for row in rows:
            if row.on < window_start or row.on > window_end:
                continue
            score = modified_z(abs(row.amount_cents), spread)
            # None means the sample carries no dispersion at all. No value can
            # be called unusual against it, and inventing one here is exactly
            # what the no-fallback rule forbids.
            if score is None or abs(score) <= OUTLIER_Z:
                continue
            anomalies.append(Anomaly(
                transaction_id=row.id,
                on=row.on,
                amount_cents=row.amount_cents,
                label=row.label,
                category_id=category_id,
                category_median_cents=spread.median,
                modified_z=score,
                direction="high" if abs(row.amount_cents) > spread.median else "low",
            ))

    anomalies.sort(key=lambda item: abs(item.modified_z), reverse=True)
    return AnomalyReport(anomalies=anomalies, skipped=skipped, scored_groups=scored)
```

Add `dataclass`, `date` (already imported at the top of the file from task 2) and `Literal` to the module imports.

- [ ] **Step 3: Run the test and commit**

Run from `backend/`: `.venv/Scripts/pytest.exe tests/test_anomaly.py -v` → PASS, 12 tests.
Run from `backend/`: `.venv/Scripts/pytest.exe -q` → 403 passed.

```bash
git add backend/app/engines/anomaly.py backend/tests/test_anomaly.py
git commit -m "feat(engines): flag transactions that deviate from their own category's history"
```

---

### Task 17: Analysis API

**Files:**
- Create: `backend/app/schemas/analysis.py`
- Create: `backend/app/api/analysis.py`
- Modify: `backend/app/main.py`
- Test: `backend/tests/test_analysis_api.py`

**Interfaces:**
- Consumes: `app.api.common.{period_range, tx_points, anomaly_points}`, `app.engines.inflation.{CategorySpend, Window, compute_inflation, previous_year_window}`, `app.engines.anomaly.detect_anomalies`, `PriceIndexPoint` (task 3).
- Produces:
  - `GET /api/analysis/inflation?date_from=&date_to=` → `InflationOut`
  - `GET /api/analysis/anomalies?date_from=&date_to=` → `AnomalyReportOut`
  - `GET /api/analysis/price-index` → `list[PriceIndexPointOut]`
  - `PUT /api/analysis/price-index` → `list[PriceIndexPointOut]` — **replaces the whole series**, idempotent.
  - `CategoryInflationOut{category_id, name, color, current_cost_cents, previous_cost_cents, delta_cents, ratio, months_current, months_previous, comparable, reason}`
  - `InflationOut{current_from, current_to, previous_from, previous_to, lines, basket_current_cost_cents, basket_previous_cost_cents, basket_ratio, reference_ratio, comparable, reason}`
  - `AnomalyOut{transaction_id, date, amount_cents, label, category_id, category_name, category_color, category_median_cents, modified_z, direction}`
  - `AnomalyReportOut{anomalies, skipped, scored_groups, date_from, date_to}`
  - `SkippedCategoryOut{category_id, name, direction, observations, reason}`
  - `PriceIndexPointOut{month: str, value_hundredths: int}` and `PriceIndexPointIn{month: str, value: Decimal}`
  - Task 18 consumes all four.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_analysis_api.py`:

```python
def test_the_operators_shape_cannot_compare_and_says_why(client, imported):
    """The Boursorama sample covers one week of March 2025, and the window a
    year earlier is empty. Every line must come back not comparable, with a
    reason -- never as -100 %."""
    headers, _ = imported
    body = client.get("/api/analysis/inflation", headers=headers).json()
    assert body["comparable"] is False
    assert body["basket_ratio"] is None
    assert body["reason"] is not None
    assert "un an plus tôt" in body["reason"]


def test_the_two_windows_are_reported_so_the_reader_knows_what_is_compared(client, imported):
    headers, _ = imported
    body = client.get("/api/analysis/inflation?date_from=2025-03-01&date_to=2025-03-31",
                      headers=headers).json()
    assert body["current_from"] == "2025-03-01"
    assert body["current_to"] == "2025-03-31"
    assert body["previous_from"] == "2024-03-01"
    assert body["previous_to"] == "2024-03-31"


def test_inflation_lines_carry_the_category_name_and_colour(client, imported):
    headers, _ = imported
    body = client.get("/api/analysis/inflation", headers=headers).json()
    assert body["lines"]
    assert all(line["name"] for line in body["lines"])
    assert all(line["color"].startswith("#") for line in body["lines"])


def test_a_price_index_round_trips_as_exact_hundredths(client, imported):
    headers, _ = imported
    response = client.put("/api/analysis/price-index", headers=headers, json={
        "points": [
            {"month": "2025-01", "value": "118.42"},
            {"month": "2026-01", "value": "120.78"},
        ],
    })
    assert response.status_code == 200
    stored = client.get("/api/analysis/price-index", headers=headers).json()
    assert [point["value_hundredths"] for point in stored] == [11842, 12078]
    assert [point["month"] for point in stored] == ["2025-01", "2026-01"]


def test_putting_the_series_again_replaces_it_rather_than_appending(client, imported):
    headers, _ = imported
    client.put("/api/analysis/price-index", headers=headers,
               json={"points": [{"month": "2025-01", "value": "118.42"}]})
    client.put("/api/analysis/price-index", headers=headers,
               json={"points": [{"month": "2025-02", "value": "119.10"}]})
    stored = client.get("/api/analysis/price-index", headers=headers).json()
    assert [point["month"] for point in stored] == ["2025-02"]


def test_an_empty_series_clears_the_index(client, imported):
    headers, _ = imported
    client.put("/api/analysis/price-index", headers=headers,
               json={"points": [{"month": "2025-01", "value": "118.42"}]})
    client.put("/api/analysis/price-index", headers=headers, json={"points": []})
    assert client.get("/api/analysis/price-index", headers=headers).json() == []


def test_a_malformed_month_in_the_index_is_refused_in_french(client, imported):
    headers, _ = imported
    response = client.put("/api/analysis/price-index", headers=headers,
                          json={"points": [{"month": "janvier 2025", "value": "118.42"}]})
    assert response.status_code == 422
    assert "AAAA-MM" in response.json()["detail"]


def test_a_duplicated_month_is_refused_rather_than_silently_kept_once(client, imported):
    headers, _ = imported
    response = client.put("/api/analysis/price-index", headers=headers, json={
        "points": [
            {"month": "2025-01", "value": "118.42"},
            {"month": "2025-01", "value": "119.00"},
        ],
    })
    assert response.status_code == 422


def test_no_index_means_no_reference_ratio_not_zero(client, imported):
    headers, _ = imported
    body = client.get("/api/analysis/inflation", headers=headers).json()
    assert body["reference_ratio"] is None


def test_anomalies_are_scored_over_history_and_reported_for_the_period(client, imported):
    headers, _ = imported
    body = client.get("/api/analysis/anomalies", headers=headers).json()
    assert "anomalies" in body and "skipped" in body
    assert body["date_from"] and body["date_to"]
    # The sample has four transactions; every category is under the floor.
    assert body["anomalies"] == []
    assert body["skipped"]
    assert "10 opérations" in body["skipped"][0]["reason"]


def test_skipped_categories_carry_their_name(client, imported):
    headers, _ = imported
    body = client.get("/api/analysis/anomalies", headers=headers).json()
    assert all(entry["name"] for entry in body["skipped"])


def test_analysis_requires_authentication(client, imported):
    assert client.get("/api/analysis/inflation").status_code == 401
    assert client.get("/api/analysis/anomalies").status_code == 401
    assert client.get("/api/analysis/price-index").status_code == 401
    assert client.put("/api/analysis/price-index", json={"points": []}).status_code == 401


def test_analysis_never_crosses_users(client, imported):
    headers, _ = imported
    client.put("/api/analysis/price-index", headers=headers,
               json={"points": [{"month": "2025-01", "value": "118.42"}]})

    other = client.post("/api/auth/register", json={
        "name": "Autre", "email": "autre@example.com", "password": "motdepasse123"}).json()
    other_headers = {"Authorization": f"Bearer {other['access_token']}"}

    assert client.get("/api/analysis/price-index", headers=other_headers).json() == []
    assert client.get("/api/analysis/anomalies", headers=other_headers).json()["anomalies"] == []
    assert client.get("/api/analysis/inflation", headers=other_headers).json()["lines"] == []
```

- [ ] **Step 2: Run the test to verify it fails**

Run from `backend/`: `.venv/Scripts/pytest.exe tests/test_analysis_api.py -v`
Expected: FAIL — 404 on every request.

- [ ] **Step 3: Write the schemas**

Create `backend/app/schemas/analysis.py`:

```python
from datetime import date
from decimal import Decimal

from pydantic import BaseModel, Field


class CategoryInflationOut(BaseModel):
    category_id: int | None
    name: str
    color: str
    # POSITIVE magnitudes: a basket's price is a positive number. See the note
    # in app/engines/inflation.py -- this is a deliberate, named exception to
    # the negative-outflow convention, which is why the fields say `_cost_`.
    current_cost_cents: int
    previous_cost_cents: int
    # Signed: positive when this category got more expensive.
    delta_cents: int
    # null -- never 0 -- when no honest ratio exists.
    ratio: float | None
    months_current: int
    months_previous: int
    comparable: bool
    # French. Non-null exactly when `comparable` is false.
    reason: str | None


class InflationOut(BaseModel):
    current_from: date
    current_to: date
    previous_from: date
    previous_to: date
    lines: list[CategoryInflationOut]
    basket_current_cost_cents: int
    basket_previous_cost_cents: int
    basket_ratio: float | None
    # From a user-supplied series only. Yieldo fetches nothing.
    reference_ratio: float | None
    comparable: bool
    reason: str | None


class AnomalyOut(BaseModel):
    transaction_id: int
    date: date
    # Signed, the usual convention: this one IS a transaction amount.
    amount_cents: int
    label: str
    category_id: int | None
    category_name: str | None
    category_color: str | None
    # The category's usual amount, as a magnitude.
    category_median_cents: int
    modified_z: float
    direction: str


class SkippedCategoryOut(BaseModel):
    category_id: int | None
    name: str
    direction: str
    observations: int
    reason: str


class AnomalyReportOut(BaseModel):
    anomalies: list[AnomalyOut]
    skipped: list[SkippedCategoryOut]
    scored_groups: int
    date_from: date
    date_to: date


class PriceIndexPointOut(BaseModel):
    # "AAAA-MM".
    month: str
    # An index level, not money: 118.42 is 11842. Sent as an integer so no
    # float ever touches it.
    value_hundredths: int


class PriceIndexPointIn(BaseModel):
    month: str
    # Decimal, so "118.42" arrives exact. Pydantic parses a JSON string into
    # Decimal without going through a float.
    value: Decimal = Field(gt=0)


class PriceIndexIn(BaseModel):
    # The WHOLE series. PUT replaces what is stored, so posting it twice is
    # idempotent and an empty list clears it.
    points: list[PriceIndexPointIn]
```

- [ ] **Step 4: Write the router**

Create `backend/app/api/analysis.py`:

```python
import re
from datetime import date
from decimal import ROUND_HALF_UP, Decimal

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.common import anomaly_points, period_range, tx_points
from app.db import get_db
from app.engines.anomaly import detect_anomalies
from app.engines.inflation import (
    CategorySpend,
    Window,
    compute_inflation,
    previous_year_window,
)
from app.models import Category, PriceIndexPoint, User
from app.schemas.analysis import (
    AnomalyOut,
    AnomalyReportOut,
    CategoryInflationOut,
    InflationOut,
    PriceIndexIn,
    PriceIndexPointOut,
    SkippedCategoryOut,
)
from app.security.deps import get_current_user

router = APIRouter(prefix="/analysis", tags=["analysis"])

_MONTH_KEY = re.compile(r"^(\d{4})-(\d{2})$")

UNCATEGORIZED_NAME = "Non catégorisé"
UNCATEGORIZED_COLOR = "#64748b"


def _parse_month(value: str) -> date:
    match = _MONTH_KEY.match(value)
    if match is None:
        raise HTTPException(status_code=422, detail="Mois invalide : format attendu AAAA-MM")
    year, month = int(match.group(1)), int(match.group(2))
    if not 1 <= month <= 12:
        raise HTTPException(status_code=422, detail="Mois invalide : format attendu AAAA-MM")
    return date(year, month, 1)


def _index_points(db: Session, user_id: int) -> list[PriceIndexPoint]:
    return (
        db.query(PriceIndexPoint)
        .filter(PriceIndexPoint.user_id == user_id)
        .order_by(PriceIndexPoint.month)
        .all()
    )


@router.get("/inflation", response_model=InflationOut)
def inflation(
    date_from: date | None = None,
    date_to: date | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> InflationOut:
    """The user's own basket, now against the same window twelve months ago."""
    start, end, _ = period_range(db, user.id, date_from, date_to)
    current = Window(start=start, end=end)
    previous = previous_year_window(current)

    # One fetch covering both windows. Transfers are not spending.
    points = [
        CategorySpend(on=point.on, amount_cents=point.amount_cents,
                      category_id=point.category_id)
        for point in tx_points(db, user.id, previous.start, end)
        if not point.is_transfer
    ]
    report = compute_inflation(
        points,
        current,
        [(item.month, item.value_hundredths) for item in _index_points(db, user.id)],
    )

    names = {c.id: c for c in db.query(Category).filter(Category.user_id == user.id).all()}
    return InflationOut(
        current_from=report.current.start,
        current_to=report.current.end,
        previous_from=report.previous.start,
        previous_to=report.previous.end,
        lines=[
            CategoryInflationOut(
                category_id=line.category_id,
                name=names[line.category_id].name
                if line.category_id in names else UNCATEGORIZED_NAME,
                color=names[line.category_id].color
                if line.category_id in names else UNCATEGORIZED_COLOR,
                current_cost_cents=line.current_cost_cents,
                previous_cost_cents=line.previous_cost_cents,
                delta_cents=line.delta_cents,
                ratio=line.ratio,
                months_current=line.months_current,
                months_previous=line.months_previous,
                comparable=line.comparable,
                reason=line.reason,
            )
            for line in report.lines
        ],
        basket_current_cost_cents=report.basket_current_cost_cents,
        basket_previous_cost_cents=report.basket_previous_cost_cents,
        basket_ratio=report.basket_ratio,
        reference_ratio=report.reference_ratio,
        comparable=report.comparable,
        reason=report.reason,
    )


@router.get("/anomalies", response_model=AnomalyReportOut)
def anomalies(
    date_from: date | None = None,
    date_to: date | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> AnomalyReportOut:
    """Transactions in the period that are unusual for their own category.

    The history handed to the engine is the whole ledger; only the reported
    window is narrowed. Rescoring a category against the fortnight on screen
    would turn ordinary spending into alerts whenever the reader zoomed in.
    """
    start, end, _ = period_range(db, user.id, date_from, date_to)
    report = detect_anomalies(anomaly_points(db, user.id), start, end)
    names = {c.id: c for c in db.query(Category).filter(Category.user_id == user.id).all()}

    return AnomalyReportOut(
        anomalies=[
            AnomalyOut(
                transaction_id=item.transaction_id,
                date=item.on,
                amount_cents=item.amount_cents,
                label=item.label,
                category_id=item.category_id,
                category_name=names[item.category_id].name
                if item.category_id in names else None,
                category_color=names[item.category_id].color
                if item.category_id in names else None,
                category_median_cents=item.category_median_cents,
                modified_z=item.modified_z,
                direction=item.direction,
            )
            for item in report.anomalies
        ],
        skipped=[
            SkippedCategoryOut(
                category_id=item.category_id,
                name=names[item.category_id].name
                if item.category_id in names else UNCATEGORIZED_NAME,
                direction=item.direction,
                observations=item.observations,
                reason=item.reason,
            )
            for item in report.skipped
        ],
        scored_groups=report.scored_groups,
        date_from=start,
        date_to=end,
    )


@router.get("/price-index", response_model=list[PriceIndexPointOut])
def read_price_index(
    user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> list[PriceIndexPointOut]:
    return [
        PriceIndexPointOut(
            month=f"{item.month.year}-{item.month.month:02d}",
            value_hundredths=item.value_hundredths,
        )
        for item in _index_points(db, user.id)
    ]


@router.put("/price-index", response_model=list[PriceIndexPointOut])
def replace_price_index(
    payload: PriceIndexIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[PriceIndexPointOut]:
    """Replace this user's reference index with the series supplied.

    Replace rather than merge, so pasting a corrected series fixes it outright
    and an empty list clears it. Yieldo never fetches this from anywhere: the
    app makes no outbound call by default, and an index nobody typed in is an
    index that does not exist.
    """
    parsed: dict[date, int] = {}
    for point in payload.points:
        month = _parse_month(point.month)
        if month in parsed:
            raise HTTPException(
                status_code=422,
                detail=f"Le mois {point.month} apparaît deux fois dans la série.",
            )
        # Exact: Decimal all the way to the integer. No float touches this.
        parsed[month] = int(
            (point.value * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
        )

    db.query(PriceIndexPoint).filter(PriceIndexPoint.user_id == user.id).delete(
        synchronize_session=False
    )
    for month, value in sorted(parsed.items()):
        db.add(PriceIndexPoint(user_id=user.id, month=month, value_hundredths=value))
    db.commit()

    return read_price_index(user=user, db=db)
```

- [ ] **Step 5: Register the router**

In `backend/app/main.py`: `from app.api import analysis as analysis_routes` and `api.include_router(analysis_routes.router)`.

- [ ] **Step 6: Run the tests and commit**

Run from `backend/`: `.venv/Scripts/pytest.exe tests/test_analysis_api.py -v` → PASS, 13 tests.
Run from `backend/`: `.venv/Scripts/pytest.exe -q` → 416 passed.

```bash
git add backend/app/schemas/analysis.py backend/app/api/analysis.py backend/app/main.py backend/tests/test_analysis_api.py
git commit -m "feat(api): expose personal inflation, anomalies and the reference price index"
```

---

### Task 18: Analyse screen

Inflation personnelle and détection d'anomalies share a screen: both answer "what changed", both are scoped by the same period selector, and both spend most of their time on the operator's data explaining what they cannot conclude.

**Files:**
- Create: `frontend/src/features/analysis/AnalysisPage.tsx`
- Create: `frontend/src/features/analysis/AnalysisPage.css`
- Create: `frontend/src/features/analysis/PriceIndexForm.tsx`
- Create: `frontend/src/features/analysis/AnalysisPage.test.tsx`
- Create: `frontend/src/features/analysis/PriceIndexForm.test.tsx`
- Modify: `frontend/src/lib/types.ts`, `frontend/src/app/routes.tsx`, `frontend/src/app/AppShell.tsx`, `frontend/src/app/AppShell.test.tsx`

**Interfaces:**
- Consumes: `GET /api/analysis/{inflation,anomalies,price-index}`, `PUT /api/analysis/price-index` (task 17), `usePeriod` / `PeriodSelector` (phase 1.5), `formatRatio` from `features/recurrences/RecurrenceRow` (task 9).
- Produces:
  - TS types `CategoryInflation`, `Inflation`, `Anomaly`, `SkippedCategory`, `AnomalyReport`, `PriceIndexPoint` in `lib/types.ts`.
  - `parseIndexSeries(text: string): { points: {month: string; value: string}[]; errors: string[] }`
  - Route `/analyse`, nav entry "Analyse".

- [ ] **Step 1: Add the TypeScript payload types**

Append to `frontend/src/lib/types.ts`:

```ts
export interface CategoryInflation {
  category_id: number | null;
  name: string;
  color: string;
  /** POSITIVE magnitudes — a basket's price is a positive number. */
  current_cost_cents: number;
  previous_cost_cents: number;
  /** Signed: positive when this category got more expensive. */
  delta_cents: number;
  /** null — never 0 — when no honest ratio exists. */
  ratio: number | null;
  months_current: number;
  months_previous: number;
  comparable: boolean;
  reason: string | null;
}

export interface Inflation {
  current_from: string;
  current_to: string;
  previous_from: string;
  previous_to: string;
  lines: CategoryInflation[];
  basket_current_cost_cents: number;
  basket_previous_cost_cents: number;
  basket_ratio: number | null;
  reference_ratio: number | null;
  comparable: boolean;
  reason: string | null;
}

export interface Anomaly {
  transaction_id: number;
  date: string;
  amount_cents: number;
  label: string;
  category_id: number | null;
  category_name: string | null;
  category_color: string | null;
  category_median_cents: number;
  modified_z: number;
  direction: "high" | "low";
}

export interface SkippedCategory {
  category_id: number | null;
  name: string;
  direction: string;
  observations: number;
  reason: string;
}

export interface AnomalyReport {
  anomalies: Anomaly[];
  skipped: SkippedCategory[];
  scored_groups: number;
  date_from: string;
  date_to: string;
}

export interface PriceIndexPoint {
  month: string;
  /** An index level, not money: 118.42 arrives as 11842. */
  value_hundredths: number;
}
```

- [ ] **Step 2: Write the failing test for `PriceIndexForm`**

Create `frontend/src/features/analysis/PriceIndexForm.test.tsx`:

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { parseIndexSeries, PriceIndexForm } from "./PriceIndexForm";

describe("parseIndexSeries", () => {
  it("reads semicolon-separated month and value pairs", () => {
    const { points, errors } = parseIndexSeries("2025-01;118,42\n2026-01;120.78");
    expect(errors).toEqual([]);
    expect(points).toEqual([
      { month: "2025-01", value: "118.42" },
      { month: "2026-01", value: "120.78" },
    ]);
  });

  it("ignores blank lines rather than failing on them", () => {
    const { points, errors } = parseIndexSeries("\n2025-01;118,42\n\n");
    expect(errors).toEqual([]);
    expect(points).toHaveLength(1);
  });

  it("names the line that could not be read instead of dropping it silently", () => {
    const { points, errors } = parseIndexSeries("2025-01;118,42\njanvier;abc");
    expect(points).toHaveLength(1);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("ligne 2");
  });
});

const fetchMock = vi.fn();

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(jsonResponse([{ month: "2025-01", value_hundredths: 11842 }]));
  vi.stubGlobal("fetch", fetchMock);
});

describe("PriceIndexForm", () => {
  it("says plainly that nothing is configured and that nothing is fetched", () => {
    render(<PriceIndexForm points={[]} onSaved={vi.fn()} />);
    expect(screen.getByText(/Aucun indice de référence/)).toBeInTheDocument();
    expect(screen.getByText(/aucune donnée n'est téléchargée/i)).toBeInTheDocument();
  });

  it("sends the parsed series as month and decimal-string pairs", async () => {
    render(<PriceIndexForm points={[]} onSaved={vi.fn()} />);
    await userEvent.type(screen.getByLabelText(/Série de l'indice/), "2025-01;118,42");
    await userEvent.click(screen.getByRole("button", { name: /Enregistrer l'indice/ }));

    await waitFor(() => {
      const put = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT");
      expect(put).toBeDefined();
      expect(JSON.parse(put![1].body as string)).toEqual({
        points: [{ month: "2025-01", value: "118.42" }],
      });
    });
  });

  it("refuses to send a series it could not fully read", async () => {
    render(<PriceIndexForm points={[]} onSaved={vi.fn()} />);
    await userEvent.type(screen.getByLabelText(/Série de l'indice/), "janvier;abc");
    await userEvent.click(screen.getByRole("button", { name: /Enregistrer l'indice/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/ligne 1/);
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(false);
  });

  it("shows how many months are stored once there are some", () => {
    render(<PriceIndexForm points={[{ month: "2025-01", value_hundredths: 11842 }]} onSaved={vi.fn()} />);
    expect(screen.getByText(/1 mois enregistré/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run it to verify it fails, then write `PriceIndexForm`**

Run from `frontend/`: `npm test -- PriceIndexForm` → FAIL, module not found.

Create `frontend/src/features/analysis/PriceIndexForm.tsx`:

```tsx
import { useState } from "react";

import { ApiError, api } from "../../lib/api";
import { plural } from "../../lib/plural";
import type { PriceIndexPoint } from "../../lib/types";

const GENERIC_ERROR = "Une erreur inattendue est survenue.";
const LINE = /^(\d{4}-\d{2})\s*[;,\t]\s*(-?\d+(?:[.,]\d+)?)$/;

export interface ParsedSeries {
  points: { month: string; value: string }[];
  errors: string[];
}

/**
 * "2025-01;118,42" per line, into what the API expects.
 *
 * The value is kept as a decimal STRING and handed to the backend as one, where
 * Pydantic parses it into a `Decimal`. Turning it into a JavaScript number here
 * would round-trip an exact index level through a float for no reason.
 *
 * Every line that cannot be read is named. A parser that skipped them would
 * silently store a shorter series than the reader pasted.
 */
export function parseIndexSeries(text: string): ParsedSeries {
  const points: { month: string; value: string }[] = [];
  const errors: string[] = [];

  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (line === "") return;
    const match = LINE.exec(line);
    if (match === null) {
      errors.push(
        `Impossible de lire la ligne ${index + 1} : « ${line} ». Format attendu : AAAA-MM;118,42`,
      );
      return;
    }
    points.push({ month: match[1], value: match[2].replace(",", ".") });
  });

  return { points, errors };
}

interface PriceIndexFormProps {
  points: PriceIndexPoint[];
  onSaved: () => void;
}

export function PriceIndexForm({ points, onSaved }: PriceIndexFormProps) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    const parsed = parseIndexSeries(text);
    if (parsed.errors.length > 0) {
      setError(parsed.errors.join(" "));
      return;
    }
    setSaving(true);
    try {
      await api.put("/analysis/price-index", { points: parsed.points });
      setError(null);
      setText("");
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : GENERIC_ERROR);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="yd-index">
      {points.length === 0 ? (
        <p className="yd-index__state">
          Aucun indice de référence enregistré. La colonne de comparaison reste vide.
        </p>
      ) : (
        <p className="yd-index__state">
          {`${points.length} ${plural(points.length, "mois enregistré", "mois enregistrés")}, de ${points[0].month} à ${points[points.length - 1].month}.`}
        </p>
      )}

      <p className="yd-index__note">
        Yieldo ne se connecte à aucun service : aucune donnée n'est téléchargée. Copiez
        vous-même la série de votre choix — l'indice des prix à la consommation de
        l'INSEE, par exemple — une ligne par mois, au format
        <code> AAAA-MM;118,42</code>. Enregistrer remplace la série précédente.
      </p>

      <label className="yd-index__field">
        <span>Série de l'indice</span>
        <textarea
          rows={5}
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={"2025-01;118,42\n2025-02;118,90"}
        />
      </label>

      {error !== null ? (
        <p role="alert" className="yd-index__error">
          {error}
        </p>
      ) : null}

      <button type="button" disabled={saving} onClick={() => void save()}>
        Enregistrer l'indice
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Write the failing test for `AnalysisPage`**

Create `frontend/src/features/analysis/AnalysisPage.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "../../app/ThemeProvider";
import type { AnomalyReport, Inflation } from "../../lib/types";
import { AnalysisPage } from "./AnalysisPage";

const fetchMock = vi.fn();

const inflation: Inflation = {
  current_from: "2026-01-01", current_to: "2026-06-30",
  previous_from: "2025-01-01", previous_to: "2025-06-30",
  lines: [
    {
      category_id: 1, name: "Courses", color: "#4fd6a8",
      current_cost_cents: 30000, previous_cost_cents: 25000, delta_cents: 5000,
      ratio: 0.2, months_current: 6, months_previous: 6, comparable: true, reason: null,
    },
    {
      category_id: 2, name: "Restaurants", color: "#fb7185",
      current_cost_cents: 12000, previous_cost_cents: 0, delta_cents: 12000,
      ratio: null, months_current: 6, months_previous: 0, comparable: false,
      reason: "Pas assez de données pour conclure : il faut au moins 3 mois de dépenses dans chacune des deux périodes, et cette catégorie en compte 6 sur la période récente et 0 un an plus tôt.",
    },
  ],
  basket_current_cost_cents: 30000, basket_previous_cost_cents: 25000,
  basket_ratio: 0.2, reference_ratio: 0.019, comparable: true, reason: null,
};

const thinInflation: Inflation = {
  ...inflation,
  lines: [inflation.lines[1]],
  basket_current_cost_cents: 0, basket_previous_cost_cents: 0,
  basket_ratio: null, reference_ratio: null, comparable: false,
  reason: "Pas assez de données pour conclure : aucune catégorie ne dispose de 3 mois de dépenses à la fois sur la période choisie et sur la même période un an plus tôt.",
};

const anomalies: AnomalyReport = {
  anomalies: [
    {
      transaction_id: 42, date: "2026-03-14", amount_cents: -90000,
      label: "CARTE X1234 FNAC DARTY", category_id: 3,
      category_name: "Équipement et high-tech", category_color: "#fb7185",
      category_median_cents: 4000, modified_z: 12.4, direction: "high",
    },
  ],
  skipped: [
    {
      category_id: 4, name: "Pharmacie", direction: "expense", observations: 6,
      reason: "Pas assez de données pour conclure : il faut au moins 10 opérations dans cette catégorie pour juger qu'un montant sort de l'ordinaire, et celle-ci en compte 6.",
    },
  ],
  scored_groups: 5, date_from: "2026-01-01", date_to: "2026-06-30",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

interface Overrides {
  inflation?: () => Response;
  anomalies?: () => Response;
  index?: () => Response;
}

function setupFetch(overrides: Overrides = {}) {
  fetchMock.mockImplementation((input: string) => {
    const url = new URL(typeof input === "string" ? input : String(input), "http://localhost");
    if (url.pathname === "/api/analysis/inflation") {
      return Promise.resolve(overrides.inflation ? overrides.inflation() : jsonResponse(inflation));
    }
    if (url.pathname === "/api/analysis/anomalies") {
      return Promise.resolve(overrides.anomalies ? overrides.anomalies() : jsonResponse(anomalies));
    }
    if (url.pathname === "/api/analysis/price-index") {
      return Promise.resolve(overrides.index ? overrides.index() : jsonResponse([]));
    }
    throw new Error(`Unhandled fetch in test: ${url.pathname}`);
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false, media: query,
      addEventListener: vi.fn(), removeEventListener: vi.fn(),
      addListener: vi.fn(), removeListener: vi.fn(),
    })),
  });
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/analyse"]}>
      <ThemeProvider>
        <AnalysisPage />
      </ThemeProvider>
    </MemoryRouter>,
  );
}

describe("AnalysisPage", () => {
  it("states the basket's own inflation", async () => {
    setupFetch();
    renderPage();
    expect(await screen.findByText("+20,0 %")).toBeInTheDocument();
  });

  it("names both windows being compared", async () => {
    setupFetch();
    renderPage();
    expect(await screen.findByText(/janvier 2025/)).toBeInTheDocument();
  });

  it("shows the reference index beside the basket when one is configured", async () => {
    setupFetch();
    renderPage();
    expect(await screen.findByText("+1,9 %")).toBeInTheDocument();
  });

  it("prints an em dash rather than a zero when no index is configured", async () => {
    setupFetch({ inflation: () => jsonResponse({ ...inflation, reference_ratio: null }) });
    renderPage();
    expect(await screen.findByText(/Indice de référence non configuré/)).toBeInTheDocument();
  });

  it("keeps an incomparable category visible with its reason", async () => {
    setupFetch();
    renderPage();
    expect(await screen.findByText("Restaurants")).toBeInTheDocument();
    expect(screen.getByText(/0 un an plus tôt/)).toBeInTheDocument();
  });

  it("prints the backend's refusal when nothing can be compared", async () => {
    setupFetch({ inflation: () => jsonResponse(thinInflation) });
    renderPage();
    expect(await screen.findByText(/aucune catégorie ne dispose de 3 mois/)).toBeInTheDocument();
  });

  it("lists the anomalies with the category's usual amount for comparison", async () => {
    setupFetch();
    renderPage();
    expect(await screen.findByText(/FNAC DARTY/)).toBeInTheDocument();
    expect(screen.getByText(/habituellement 40,00/)).toBeInTheDocument();
  });

  it("says which categories were too short to judge", async () => {
    setupFetch();
    renderPage();
    expect(await screen.findByText(/Pharmacie/)).toBeInTheDocument();
    expect(screen.getByText(/au moins 10 opérations/)).toBeInTheDocument();
  });

  it("surfaces a failed load in French", async () => {
    setupFetch({ anomalies: () => jsonResponse({ detail: "Base indisponible" }, 500) });
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent("Base indisponible");
  });
});
```

- [ ] **Step 5: Run it to verify it fails, then write `AnalysisPage`**

Run from `frontend/`: `npm test -- AnalysisPage` → FAIL, module not found.

Create `frontend/src/features/analysis/AnalysisPage.tsx`:

```tsx
import { motion } from "motion/react";
import { useCallback, useEffect, useState, type ReactNode } from "react";

import { BentoCell, type BentoSpan } from "../../design/bento/BentoCell";
import { BentoGrid } from "../../design/bento/BentoGrid";
import { EmptyState, frenchDate } from "../../design/EmptyState";
import { useReducedMotion } from "../../design/motion/useReducedMotion";
import { entryProps, staggerProps } from "../../design/motion/variants";
import { formatCents } from "../../design/theme";
import { ApiError, api } from "../../lib/api";
import { plural } from "../../lib/plural";
import type { AnomalyReport, Inflation, PriceIndexPoint } from "../../lib/types";
import { formatRatio } from "../recurrences/RecurrenceRow";
import { PeriodSelector } from "../transactions/PeriodSelector";
import { usePeriod } from "../transactions/usePeriod";
import { PriceIndexForm } from "./PriceIndexForm";
import "./AnalysisPage.css";

const GENERIC_ERROR = "Une erreur inattendue est survenue.";

function messageFor(err: unknown): string {
  return err instanceof ApiError ? err.detail : GENERIC_ERROR;
}

const SPAN = {
  basket: { base: 1, md: 6, lg: 5 },
  index: { base: 1, md: 6, lg: 7 },
  table: { base: 1, md: 6, lg: 7 },
  anomalies: { base: 1, md: 6, lg: 5 },
} satisfies Record<string, BentoSpan>;

interface LoadErrors {
  inflation?: string;
  anomalies?: string;
  index?: string;
}

export function AnalysisPage() {
  const period = usePeriod();
  const reduced = useReducedMotion();

  const [inflation, setInflation] = useState<Inflation | null>(null);
  const [anomalies, setAnomalies] = useState<AnomalyReport | null>(null);
  const [indexPoints, setIndexPoints] = useState<PriceIndexPoint[]>([]);
  const [errors, setErrors] = useState<LoadErrors>({});
  const [isLoading, setIsLoading] = useState(true);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setIsLoading(true);
      const [inflationResult, anomalyResult, indexResult] = await Promise.allSettled([
        api.get<Inflation>("/analysis/inflation", { date_from: period.from, date_to: period.to }),
        api.get<AnomalyReport>("/analysis/anomalies", { date_from: period.from, date_to: period.to }),
        api.get<PriceIndexPoint[]>("/analysis/price-index"),
      ]);
      if (cancelled) return;

      const nextErrors: LoadErrors = {};
      if (inflationResult.status === "fulfilled") setInflation(inflationResult.value);
      else {
        setInflation(null);
        nextErrors.inflation = messageFor(inflationResult.reason);
      }
      if (anomalyResult.status === "fulfilled") setAnomalies(anomalyResult.value);
      else {
        setAnomalies(null);
        nextErrors.anomalies = messageFor(anomalyResult.reason);
      }
      if (indexResult.status === "fulfilled") setIndexPoints(indexResult.value);
      else {
        setIndexPoints([]);
        nextErrors.index = messageFor(indexResult.reason);
      }
      setErrors(nextErrors);
      setIsLoading(false);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [period.from, period.to, reloadToken]);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);
  const errorMessages = Object.values(errors).filter((message): message is string => Boolean(message));

  let body: ReactNode;
  if (isLoading) {
    body = (
      <BentoGrid role="status" aria-busy="true" aria-label="Chargement de l'analyse">
        <BentoCell span={SPAN.basket} className="yd-panel">
          <div className="yd-skeleton yd-skeleton--title" aria-hidden="true" />
          <div className="yd-skeleton yd-skeleton--value" aria-hidden="true" />
        </BentoCell>
        <BentoCell span={SPAN.index} className="yd-panel">
          <div className="yd-skeleton yd-skeleton--chart" aria-hidden="true" />
        </BentoCell>
        <BentoCell span={SPAN.table} className="yd-panel">
          <div className="yd-skeleton yd-skeleton--chart" aria-hidden="true" />
        </BentoCell>
        <BentoCell span={SPAN.anomalies} className="yd-panel">
          <div className="yd-skeleton yd-skeleton--chart" aria-hidden="true" />
        </BentoCell>
      </BentoGrid>
    );
  } else {
    body = (
      <BentoGrid as={motion.div} {...staggerProps(reduced)}>
        <BentoCell as={motion.div} span={SPAN.basket} className="yd-panel" {...entryProps(reduced)}>
          <h2 className="yd-panel__title">Votre panier</h2>
          {inflation === null ? null : inflation.comparable && inflation.basket_ratio !== null ? (
            <>
              <span className="yd-analysis__ratio">{formatRatio(inflation.basket_ratio)}</span>
              <p className="yd-analysis__note">
                {`${formatCents(inflation.basket_previous_cost_cents)} par mois il y a un an, ${formatCents(inflation.basket_current_cost_cents)} aujourd'hui.`}
              </p>
              <p className="yd-analysis__note">
                {`Comparaison entre le ${frenchDate(inflation.current_from)} – ${frenchDate(inflation.current_to)} et le ${frenchDate(inflation.previous_from)} – ${frenchDate(inflation.previous_to)}.`}
              </p>
              <p className="yd-analysis__note">
                {inflation.reference_ratio !== null
                  ? `Indice de référence sur la même période : ${formatRatio(inflation.reference_ratio)}.`
                  : "Indice de référence non configuré — aucune comparaison externe n'est affichée."}
              </p>
            </>
          ) : (
            <p className="yd-analysis__insufficient">{inflation.reason}</p>
          )}
        </BentoCell>

        <BentoCell as={motion.div} span={SPAN.index} className="yd-panel" {...entryProps(reduced)}>
          <h2 className="yd-panel__title">Indice de référence</h2>
          <PriceIndexForm points={indexPoints} onSaved={reload} />
        </BentoCell>

        <BentoCell as={motion.div} span={SPAN.table} className="yd-panel" {...entryProps(reduced)}>
          <h2 className="yd-panel__title">Où l'argent part davantage qu'avant</h2>
          {inflation === null || inflation.lines.length === 0 ? (
            <EmptyState
              title="Aucune dépense sur la période."
              detail="Élargissez la période ou importez des relevés supplémentaires."
            />
          ) : (
            <ul className="yd-analysis__lines">
              {inflation.lines.map((line) => (
                <li
                  key={line.category_id ?? "uncategorized"}
                  className={`yd-analysis__line${line.comparable ? "" : " yd-analysis__line--incomparable"}`}
                >
                  <span className="yd-analysis__line-name">{line.name}</span>
                  {line.comparable && line.ratio !== null ? (
                    <>
                      <span className="yd-analysis__line-ratio">{formatRatio(line.ratio)}</span>
                      <span className="yd-analysis__line-detail">
                        {`${formatCents(line.previous_cost_cents)} → ${formatCents(line.current_cost_cents)} par mois`}
                      </span>
                    </>
                  ) : (
                    // Never dropped, never shown as −100 %: the line stays, and
                    // says exactly what is missing.
                    <span className="yd-analysis__line-reason">{line.reason}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </BentoCell>

        <BentoCell as={motion.div} span={SPAN.anomalies} className="yd-panel" {...entryProps(reduced)}>
          <h2 className="yd-panel__title">Montants inhabituels</h2>
          {anomalies === null ? null : (
            <>
              {anomalies.anomalies.length === 0 ? (
                <p className="yd-analysis__note">
                  {anomalies.scored_groups === 0
                    ? "Aucune catégorie n'a assez d'historique pour juger qu'un montant sort de l'ordinaire."
                    : `Aucun montant inhabituel sur la période, sur ${anomalies.scored_groups} ${plural(anomalies.scored_groups, "catégorie analysée", "catégories analysées")}.`}
                </p>
              ) : (
                <ul className="yd-analysis__anomalies">
                  {anomalies.anomalies.map((item) => (
                    <li key={item.transaction_id} className="yd-analysis__anomaly">
                      <span className="yd-analysis__anomaly-label">{item.label}</span>
                      <span className="yd-analysis__anomaly-amount">
                        {formatCents(item.amount_cents)}
                      </span>
                      <span className="yd-analysis__anomaly-detail">
                        {`${frenchDate(item.date)} · ${item.category_name ?? "Non catégorisé"} · habituellement ${formatCents(item.category_median_cents)}`}
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              {anomalies.skipped.length > 0 ? (
                <details className="yd-analysis__skipped">
                  <summary>
                    {`${anomalies.skipped.length} ${plural(anomalies.skipped.length, "catégorie non analysée", "catégories non analysées")}`}
                  </summary>
                  <ul>
                    {anomalies.skipped.map((entry) => (
                      <li key={`${entry.category_id}-${entry.direction}`}>
                        <strong>{entry.name}</strong> — {entry.reason}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </>
          )}
        </BentoCell>
      </BentoGrid>
    );
  }

  return (
    <section className="yd-analysis">
      <div className="yd-analysis__header">
        <h1>Analyse</h1>
      </div>

      <PeriodSelector period={period} />

      {errorMessages.map((message) => (
        <p role="alert" className="yd-analysis__alert" key={message}>
          {message}
        </p>
      ))}

      {body}
    </section>
  );
}
```

- [ ] **Step 6: Write the stylesheet**

Create `frontend/src/features/analysis/AnalysisPage.css`:

```css
.yd-analysis__header { margin-bottom: var(--yd-space-lg); }

.yd-analysis__ratio {
  font-family: var(--yd-font-mono);
  font-variant-numeric: tabular-nums;
  font-size: clamp(1.8rem, 5vw, 2.6rem);
  color: var(--yd-text);
}

.yd-analysis__note,
.yd-analysis__line-detail,
.yd-analysis__line-reason,
.yd-analysis__anomaly-detail,
.yd-index__state,
.yd-index__note {
  margin: 0;
  font-size: 0.86rem;
  color: var(--yd-text-muted);
}

.yd-analysis__insufficient {
  margin: 0;
  padding: var(--yd-space-sm) var(--yd-space-md);
  border-radius: var(--yd-radius-sm);
  border: 1px solid var(--yd-border-strong);
  background: var(--yd-surface);
  color: var(--yd-text);
}

.yd-analysis__lines,
.yd-analysis__anomalies {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--yd-space-sm);
}

/* A grid, not a flex row: name and figure need to align down the column, and
   `minmax(0, 1fr)` stops a long category name setting the track's minimum. */
.yd-analysis__line,
.yd-analysis__anomaly {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: var(--yd-space-2xs) var(--yd-space-sm);
  padding-bottom: var(--yd-space-sm);
  border-bottom: 1px solid var(--yd-border);
}

.yd-analysis__line-name,
.yd-analysis__anomaly-label {
  overflow-wrap: anywhere;
  font-weight: 600;
  color: var(--yd-text);
}

.yd-analysis__line-ratio,
.yd-analysis__anomaly-amount {
  font-family: var(--yd-font-mono);
  font-variant-numeric: tabular-nums;
  text-align: right;
  color: var(--yd-text);
}

.yd-analysis__line-detail,
.yd-analysis__line-reason,
.yd-analysis__anomaly-detail {
  grid-column: 1 / -1;
}

/* Dimmed, but the reason is still full-contrast text: the line is present
   precisely so the reader can see why it could not be compared. */
.yd-analysis__line--incomparable .yd-analysis__line-name {
  color: var(--yd-text-muted);
}

.yd-index {
  display: flex;
  flex-direction: column;
  gap: var(--yd-space-sm);
}

.yd-index__field {
  display: flex;
  flex-direction: column;
  gap: var(--yd-space-2xs);
}

.yd-index__field textarea {
  width: 100%;
  font-family: var(--yd-font-mono);
  resize: vertical;
}

.yd-index__error,
.yd-analysis__alert {
  margin: 0;
  padding: var(--yd-space-sm) var(--yd-space-md);
  border-radius: var(--yd-radius-sm);
  border: 1px solid var(--yd-negative);
  color: var(--yd-text);
}

.yd-analysis__skipped summary {
  cursor: pointer;
  color: var(--yd-text-muted);
  font-size: 0.86rem;
}
```

- [ ] **Step 7: Register the route and the nav entry**

`routes.tsx`: import `AnalysisPage`, add `{ path: "analyse", element: <AnalysisPage /> },`.
`AppShell.tsx`: add `{ to: "/analyse", label: "Analyse" },` after Trésorerie.
`AppShell.test.tsx`: update the nav assertions.

- [ ] **Step 8: Run the frontend suite**

Run from `frontend/`: `npm test` → PASS. `npm run build` → zero TypeScript errors.

- [ ] **Step 9: Browser verification**

Re-seed, start the app, log in, go to `/analyse`.

**Expect the inflation half to refuse on the operator's fixture**, whatever period is chosen: the window twelve months before 2025-01→2026-01 is empty. The anomaly half will be mixed — a handful of categories have ten or more rows and get scored, the rest are listed under "catégories non analysées". Both are the correct answers.

Screenshot all six combinations (375 / 768 / 1440 × clair / sombre). Then enter a two-point index series through the form (`2025-01;118,42` and `2026-01;120,78`), confirm it round-trips, and screenshot the configured state at 1440 in both themes.

Check in the browser:

- [ ] The refusal block is legible and reads as an explanation. It must not sit in the negative colour, which is reserved for failure.
- [ ] An incomparable category line is dimmed but its **reason text still clears 4.5:1** — the dimming is on the name, not on the explanation.
- [ ] At 375 px the ratio column does not collide with a long category name; the detail line wraps to its own full-width row.
- [ ] The textarea does not overflow its cell at 375 px (`width: 100%` inside a flex column with `align-items` unset — confirm the rendered width is not zero and not wider than the cell).
- [ ] `<details>` opens and closes with the keyboard and its summary has a visible focus ring.
- [ ] A 76-character raw bank label in the anomalies list wraps rather than pushing the page horizontally. Confirm `document.documentElement.scrollWidth === document.documentElement.clientWidth`.
- [ ] The period selector behaves the same as on the dashboard and the transactions screen — `PeriodSelector.css` is **shared**, and phase 1.5 had a round where it was changed without re-checking its other two consumers. Load `/` and `/transactions` after this task and confirm they are unchanged.
- [ ] Reduced motion on: no cell stranded at `opacity: 0`.

- [ ] **Step 10: Commit**

```bash
git add frontend/src/features/analysis frontend/src/lib/types.ts frontend/src/app/routes.tsx frontend/src/app/AppShell.tsx frontend/src/app/AppShell.test.tsx
git commit -m "feat(analysis): add the personal inflation and anomaly screen"
```

---

### Task 19: Whole-phase verification pass

Nothing new is built here. This task walks the finished phase the way the operator will, in a browser, and treats anything that looks wrong as a finding rather than a matter of taste. Phase 1 shipped 435 green tests and a rejected interface because no task ever did this.

**Files:**
- Create: `.superpowers/sdd/2026-08-16-yieldo-phase-2a-analyse/progress.md` (the ledger, written as the phase runs — this task closes it)
- Create: `.superpowers/sdd/2026-08-16-yieldo-phase-2a-analyse/task-19-report.md`
- Modify: whatever the pass finds.

**Interfaces:**
- Consumes: every screen and endpoint built in tasks 1–18.
- Produces: the findings list, the coverage figures, and the carry-forward notes phase 2B will read before starting.

- [ ] **Step 1: Rebuild the fixture and confirm the starting state**

```bash
cd backend && .venv/Scripts/python.exe ../.superpowers/sdd/2026-08-12-yieldo-phase-1-5-interface/seed_fixture.py
.venv/Scripts/alembic.exe upgrade head
```

Confirm: 197 transactions, 1 account, 69 categories, 21 marked essential, 1 import batch. Check no orphaned uvicorn holds port 8000 (`Get-NetTCPConnection -LocalPort 8000`) before trusting any API output.

- [ ] **Step 2: Run both suites and the build**

Run from `backend/`: `.venv/Scripts/pytest.exe -v --cov=app --cov-report=term-missing`
Expected: all green. **Record the coverage figures for `app/engines` and `app/importers`; both must be ≥80 %.** If `app/engines` is under, the gap is a missing test, not a reason to lower the target — name the uncovered lines in the report and add tests.

Run from `frontend/`: `npm test` then `npm run build`.
Expected: all green, zero TypeScript errors.

- [ ] **Step 3: Walk all four new screens in a browser**

For each of `/budgets`, `/recurrences`, `/tresorerie`, `/analyse`, at 375 / 768 / 1440 px in **both** themes — 24 screenshots minimum — and with the operator's real fixture loaded:

- [ ] No horizontal document scroll at any width: `document.documentElement.scrollWidth === document.documentElement.clientWidth`.
- [ ] Every screen has exactly one `<h1>`, and the heading order runs h1 → h2 with no skip. The landing page shipped an h1 → h3 skip in phase 1.5; do not repeat it.
- [ ] Every refusal message ("pas assez de données…") is present, legible, and reads as an explanation rather than as a failure.
- [ ] No French text is missing its non-breaking space before `:`, `?`, `!`, `%` or `»`. Phase 1.5 shipped two blocked-reason strings using a plain space where the rest of the file used `&nbsp;:`.
- [ ] Every new status colour pairing clears 4.5:1 for text and 3:1 for non-text, measured over the **composited** pixel in both themes. `contrast.test.ts` parses `tokens.css` only and cannot see any of these.
- [ ] Reduced motion, both via the OS media query and via the in-app Réglages switch: nothing stranded at `opacity: 0`, no cell missing.
- [ ] Keyboard: every control on every new screen is reachable and shows a focus ring, including the ones below the fold.

- [ ] **Step 4: Re-check the three screens this phase did not build**

The four new nav entries and the shared `PeriodSelector` reach into phase 1.5's work.

- [ ] `/`, `/transactions` and `/import` still render correctly at 375 and 1440 in both themes.
- [ ] The sidebar now holds nine entries. Confirm it does not scroll off the bottom at 768 px height, and that the mobile drawer still closes on Escape and on navigation.
- [ ] The mobile "Menu" button (a known phase-1.5 Moderate: `position: fixed` inside a static header) does not occlude any new screen's first heading below 1024 px. If it does, that is now a blocking finding — it is occluding four more screens than it was.

- [ ] **Step 5: Measure the two things a median cannot see**

Phase 1.5's task 6 established that a median frame time cannot detect a tail, and that the previous "median 6.9 ms" reassurance was measuring the effects-off case. Repeat the measurement with the four new screens mounted:

- [ ] rAF A/B at 1440 with the atmosphere on and off, reporting **p95 and the share of frames over 20 ms**, not the median. The forecast chart adds a fifth always-on canvas.
- [ ] End-to-end latency of `GET /api/recurrences` and `GET /api/cashflow/forecast` against the 197-row fixture, median and p95. Both run `detect_recurrences` over the whole ledger on every request; if either exceeds 200 ms p95 at 197 rows, record the figure and flag it for phase 2B rather than optimising here.

- [ ] **Step 6: Write the ledger and the report**

Write `.superpowers/sdd/2026-08-16-yieldo-phase-2a-analyse/task-19-report.md` with:

- every finding, severity-ranked, with the screenshot that shows it;
- the two measurements from step 5, with p95 figures;
- the coverage figures for `app/engines` and `app/importers`;
- an explicit **STILL UNVERIFIED** block naming what was not covered (browsers other than Chrome, other hardware, the deployed instance, the CSS `prefers-reduced-motion` gate which chrome-devtools cannot force);
- a **carry-forward for phase 2B** block naming at minimum: `engines/capacity.measure_savings_capacity` as the measured savings capacity the purchase-feasibility engine consumes, `engines/robust` as the shared statistics module, and `api/common` as the shared fetch layer.

- [ ] **Step 7: Fix everything ranked blocking, then re-run both suites**

Anything that misrepresents a number, hides a control, or fails contrast is blocking. Fix it, re-screenshot the affected combination, and re-run both suites plus `npm run build`.

- [ ] **Step 8: Confirm the fixture was left clean**

Any test batch imported during tasks 9, 12 or 14 must have been rolled back. Confirm the database holds 1 import batch (198 rows) and 197 transactions, exactly as phase 1.5 left it.

- [ ] **Step 9: Commit**

```bash
git add .superpowers/sdd/2026-08-16-yieldo-phase-2a-analyse
git commit -m "docs: record the phase 2A verification pass and its findings"
```

---

## Appendix — what phase 2B inherits

Named here so the 2B plan does not have to re-derive it.

| Symbol | Where | What 2B does with it |
|---|---|---|
| `measure_savings_capacity(months) -> MeasuredRate \| None` | `backend/app/engines/capacity.py` | **The** input to the purchase-feasibility engine (§6.3 item 1). Signed median monthly net with its P10/P90 band and its observed month count. Returns `None` below three observed months — feasibility must refuse there too, not assume zero. |
| `measure_expense_rate(months) -> MeasuredRate \| None` | `backend/app/engines/capacity.py` | The denominator for "réduire telle catégorie de dépense, avec l'historique qui dit si c'est réaliste" (§6.3 item 5). |
| `complete_months(entries, ledger_start, ledger_end)` | `backend/app/engines/capacity.py` | The one definition of "an observed month" in the codebase. Debts and goals must use it rather than a second one. |
| `robust.describe / modified_z / quantile_offset_cents` | `backend/app/engines/robust.py` | The statistics layer for Monte-Carlo percentiles, stress tests and goal projections. |
| `RecurrenceReport.annual_subscription_cents` and `.recurring_keys` | `backend/app/engines/recurrence.py` | The lever "trois abonnements à 34 €/mois inutilisés" (§6.2 engagement) and the "reduce a recurring cost" lever of §6.3 item 5. |
| `ForecastReport` | `backend/app/engines/forecast.py` | The base curve a purchase scenario is superimposed on, and the source of "impact simulé sur le fonds d'urgence" (§6.3 item 7). |
| `api/common.{period_range, tx_points, recurrence_points, anomaly_points, liquid_balance_cents}` | `backend/app/api/common.py` | Every 2B router uses these rather than growing its own `user_id` filter. |
| `parseCents(text) -> number \| null` | `frontend/src/design/theme.ts` | Every 2B form that takes a euro amount (target price, deposit, monthly payment). Exact, string-based, returns `null` rather than 0. |
| `Category.is_essential` | `backend/app/models/category.py` | The "reduced to essentials" basis, reusable by the debt-payoff and goal engines. |

Two things 2B must **not** assume:

- There is no `recurrences` table. Detection is computed on every request; if 2B needs a user to dismiss or rename a recurrence, that table is 2B's to add.
- `/categories` is still a placeholder. Budgets and the essential flag are edited on `/budgets`.
