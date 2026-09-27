# Audit du 26 septembre — chantier AV (Avenir) et U : Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The « Avenir » screen of spec
`docs/superpowers/specs/2026-09-26-yieldo-avenir-securite-design.md` (section
AV) and the Plan screen's pointer to it (section U).

**Architecture:** Three pure engines — `outlook_sources` (what is known about
the future, one euro one source), `outlook` (the balance day by day with its
band, low point, risk, scenarios), `backtest` (the same method replayed on the
household's history) — built on a residual model extracted from
`engines/forecast.py` without changing its results. `api/outlook.py` reads the
clock and the database, `api/planned_events.py` stores one-off events. The
front end replaces Trésorerie with `features/avenir/`.

**Tech Stack:** FastAPI, SQLAlchemy 2, Alembic, pytest; React 19, ECharts 6,
vitest.

## Global Constraints

- Amounts are integer cents at every layer; ratios inside an engine are integer basis points (0–10 000), never a float multiplied into money.
- Engines are pure: no session, no network, no implicit clock; `as_of` and `today` are parameters.
- Every query filters on `user_id`; a foreign account, category or declaration is a 404.
- French for every user-facing sentence, with « » and no-break spaces; each refusal names its cause and remedy.
- One commit per task, test first; `pytest -q`, `npm test`, `npm run lint`, `npm run build` green at every commit.
- Screens judged in the browser at 1440 and 390, both themes, on the demo household (`e2e/seed_demo_household.py`).

## Interfaces (shared by the tasks)

`engines/forecast.py` (Task AV2):

```python
@dataclass(frozen=True)
class ResidualMonth:
    key: str                  # "2026-10"
    centre_cents: int         # the month's residual centre (median), signed
    seasonal: bool
    cumulative_variance: int  # cents², end of this month, from the first key (noise + centre error)

@dataclass(frozen=True)
class ResidualModel:
    status: Literal["measured", "flat", "insufficient"]
    months: list[ResidualMonth]           # empty when "insufficient"
    observed: int
    pooled_scale_cents: int
    seasonal_scale_cents: int | None

def residual_model(history: ResidualHistory, keys: list[str]) -> ResidualModel
```

`engines/outlook_sources.py` (Task AV3):

```python
@dataclass(frozen=True)
class FlowRow:  id, on, amount_cents, account_id, label_key, label_raw, category_id, is_transfer
@dataclass(frozen=True)
class Declared: schedule: DeclaredSchedule; amount_cents: int; account_id: int | None;
                category_id: int | None; label_key: str; checkin_transaction_ids: frozenset[int]
@dataclass(frozen=True)
class Planned:  id, label, on, amount_cents, account_id, category_id
Source = Literal["detected", "declared", "planned", "scenario"]
@dataclass(frozen=True)
class KnownEvent: on, amount_cents, label, source: Source, series: str, category_id
@dataclass(frozen=True)
class Series: id: str, label: str, source: Source, amount_cents: int, periodicity: str
@dataclass(frozen=True)
class Sources: events: list[KnownEvent]; series: list[Series]; history: ResidualHistory;
               residual_rows: list[MonthlyEntry]; warnings: list[str];
               detected_projected: int; declared_projected: int; planned_projected: int;
               reconciled: int

def internal_transfer_ids(rows: list[FlowRow], window_days: int = 3) -> frozenset[int]
def assemble(rows, *, dismissed_keys, declared, planned, as_of, horizon_end,
             ledger_start, ledger_end) -> Sources
```

`engines/outlook.py` (Task AV4):

```python
@dataclass(frozen=True)
class OutlookDay: on, p10_cents, p50_cents, p90_cents
@dataclass(frozen=True)
class PlacedEvent: event: KnownEvent; balance_after_cents: int
@dataclass(frozen=True)
class MonthEnd: key, p10_cents, p50_cents, p90_cents, low_on, low_p50_cents
@dataclass(frozen=True)
class LowPoint: on, p50_cents, p10_cents
Risk = Literal["none", "possible", "probable"]
@dataclass(frozen=True)
class Outlook: as_of, horizon_end, opening_balance_cents, threshold_cents, days, events,
               months, low_point, risk, first_breach_on, variable_daily_cents, band: bool,
               band_unavailable_reason: str | None
@dataclass(frozen=True)
class Adjustment: kind: Literal["one_off", "cancel", "change_amount"]; on: date;
                  label: str | None = None; amount_cents: int | None = None; series: str | None = None

def month_profile_bps(residual_rows: list[MonthlyEntry], months: list[MonthObservation]) -> tuple[int, ...]  # 32 values, F(0)=0 … F(31)=10000
def apply_adjustments(events, adjustments) -> list[KnownEvent]
def project_outlook(*, opening_balance_cents, as_of, horizon_days, events, model, profile_bps,
                    threshold_cents) -> Outlook
```

`engines/backtest.py` (Task AV5):

```python
@dataclass(frozen=True)
class HorizonScore: horizon_months, replays, mean_abs_error_cents, median_abs_error_cents,
                    bias_cents, inside_band
@dataclass(frozen=True)
class Reliability: horizons: list[HorizonScore]; refusal: str | None
def measure_reliability(rows: list[FlowRow], *, opening_balance_cents, dismissed_keys,
                        ledger_start, ledger_end) -> Reliability
```

Routes (Tasks AV6–AV7): `GET/POST/PATCH/DELETE /api/planned-events`,
`GET /api/outlook?scope=checking|liquid&horizon_days=90`,
`POST /api/outlook/scenario`, `GET /api/outlook/reliability?scope=…`.

## Tasks

- [x] **AV1 — The two defects of today's forecast.** `api/common.scope_flow_points(db, user_id, kinds)`
  returns the recurrence points of the liquid perimeter with transfers leaving
  it kept and transfers inside it removed; `/cashflow/forecast` and the alert
  detect on those points minus dismissed labels, and measure the residual on
  all of them. Tests: a monthly transfer to a PEA lowers the projected months;
  a dismissed label's spending stays in the residual. Commit
  `fix(cashflow): the forecast counts money leaving for a PEA, and keeps dismissed labels' spending`.
- [x] **AV2 — `residual_model`, extracted.** `project_cashflow` rebuilt on it;
  every existing `test_forecast.py` test passes unchanged; new tests pin the
  model's months, statuses and variance growth. Commit
  `refactor(forecast): the residual model, on its own`.
- [x] **AV3 — `outlook_sources`.** Tests: transfer pairing inside a scope and
  not across it; dismissed keys not detected but kept in the residual;
  declaration ↔ detection by label, by amount ±15 % and day ±5, one detection
  at most; check-in and label linking remove rows from the residual; the
  « compté deux fois » warning; expansion of monthly (day clamped), quarterly,
  yearly, weekly, biweekly, declared and planned events, strictly after
  `as_of`. Commit `feat(avenir): what is known about the future, one euro one source`.
- [x] **AV4 — `outlook`.** Tests: day sums equal opening + events + residual
  shares; band non-decreasing; profile monotone, uniform under six months;
  partial first month; low point, three risk levels, threshold; each
  adjustment kind; band-less statuses with their sentences. Commit
  `feat(avenir): the balance day by day, its band and its low point`.
- [x] **AV5 — `backtest`.** Tests: a deterministic household replays with zero
  error and all inside; noise gives counts; fewer than three replays refuses
  with the month count. Commit `feat(avenir): the forecast replayed on the household's own history`.
- [x] **AV6 — Planned events.** Model, migration (+ `test_migrations.py`),
  schemas, CRUD with ownership 404s and French 422s. Commit
  `feat(avenir): planned one-off events`.
- [x] **AV7 — Outlook routes.** Scope accounts, as_of = last row of the scope
  (today when none), threshold from `alert_settings`, declarations and planned
  events filtered by scope, stale days; isolation test with two households.
  Commit `feat(avenir): /outlook, its scenarios and its reliability`.
- [x] **AV8 — The screen, head and tiles.** `features/avenir/AvenirPage.tsx`,
  route `/avenir`, `/tresorerie` redirect, navigation entry, targets,
  `lib/types.ts`, mock payloads; tiles « Fin <mois> prévue », « Point bas »,
  « Fiabilité mesurée »; stale banner. Commit `feat(avenir): the screen, and the three answers first`.
- [x] **AV9 — `charts/OutlookChart.tsx`.** Band, median, threshold, event
  marks, stale zone, scenario line; escaped tooltip. Commit
  `feat(avenir): the balance drawn day by day`.
- [x] **AV10 — Les 30 prochains jours + événements prévus.** Commit
  `feat(avenir): the next thirty days, and one-off events declared in place`.
- [x] **AV11 — Et si….** Commit `feat(avenir): what if`.
- [x] **AV12 — Runway and method move in; Trésorerie leaves.** Delete
  `features/cashflow/CashflowPage*` and `charts/ForecastFanChart*` once unused.
  Commit `refactor(avenir): runway and method on Avenir, Trésorerie retired`.
- [x] **AV13 — Vue d'ensemble : « Les 30 prochains jours ».** Commit
  `feat(overview): the next thirty days on the dashboard`.
- [x] **AV14 — Assistant and agent.** Intents `balance_forecast`, `upcoming`
  with their traces; `lire_avenir` read tool. Commit
  `feat(assistant): what the balance will be, and what is coming`.
- [x] **AV15 — Alert on the daily low point.** Commit
  `feat(alerts): the floor alert reads the low point day by day`.
- [x] **AV16 / U — Browser pass, Plan pointer, CLAUDE.md.** Commit
  `docs: Avenir in CLAUDE.md` and `fix(avenir): what the browser showed`.
