# La journée simulée : Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run a whole simulated trading day (78 synthetic steps from a
random, replayable seed) against the configured model in the background,
and show its capital curve, its market, what the model said step by step,
and its balance sheet — per spec
`docs/superpowers/specs/2026-09-21-yieldo-journee-simulee-design.md`.

**Architecture:** One new table (`trading_sessions`, points as JSON) and
two nullable columns on `trade_decisions`. A runner in `trading/session.py`
loops `service.run_cycle` step by step in a FastAPI background task with its
own DB session, committing each step so the screen can poll. A pure engine
turns points, decisions and orders into the balance sheet. One new screen,
`features/invest/SessionPage.tsx`, draws it with `charts/Chart.tsx`.

**Tech Stack:** FastAPI `BackgroundTasks`, SQLAlchemy + Alembic (SQLite,
batch mode), pytest; React 19 + ECharts wrappers, vitest.

## Global Constraints

- Cents and basis points as integers; `Decimal` for every ratio.
- Every query on `trading_sessions` and `trade_decisions` filters on
  `user_id`. Creating and stopping a day take `get_session_user`.
- No silent failure: a day that fails ends `failed` with the French cause.
- French UI text, French typography; English code and commits.
- Frontend: tokens only, `.yd-num`, pills, both widths, both themes, judged
  in a browser. `npx tsc -b` clean, `npm test` green, backend suite green,
  `ruff` clean on touched files.
- One Conventional Commit per task with the Co-Authored-By line.

---

### Task 1: Model, migration, audit kinds
- Create `backend/app/models/trading_session.py` (`TradingSession`,
  `SESSION_STATUSES`), export from `models/__init__.py`; `TradeDecision`
  gains `session_id` (FK, SET NULL, index) and `session_step`.
- `AUDIT_KINDS` += `session_started`, `session_finished`; front
  `JOURNAL_KIND_LABELS` gets both.
- Migration `d8e9f0a1b2c3_trading_sessions.py`, `down_revision = c7d8e9f0a1b2`.
- Tests: `test_migrations.py` (single head, table matches metadata, columns
  land NULL on a populated `trade_decisions`, downgrade), `vocabulary.test.ts`.
- [x] tests red → green → commit `feat(invest): a trading day has a table`.

### Task 2: `engines/session_report.py`
- `Point(step, equity_cents, cash_cents, exposure_cents, orders)`,
  `DecisionSummary(step, symbol, outcome, choice, mass_bps, confidence_bps,
  act_bps, latency_ms, rules_choice)`, `OrderSummary(step, symbol, side,
  realised_pnl_cents, status)` → `report(points, decisions, orders,
  initial_cash_cents) -> SessionReport` with the fields of the spec and
  `mass_series: dict[symbol, list[MassPoint(step, buy_bps, sell_bps, hold_bps)]]`.
- Tests `tests/test_session_report.py`: return and drawdown on a known
  curve; winners/losers from filled sells; agreement from rules choices;
  means ignore None; empty input is all zeros.
- [x] commit `feat(invest): the balance sheet of a trading day`.

### Task 3: `trading/session.py` runner
- `start_session(db, user, *, steps, seed, cash_cents, provider_name, model)`
  creates the row (`running`), resets the sandbox, sets `sandbox_step`.
- `run_session(session_factory, session_id, user_id)` — the loop, with its
  own DB session; per step: `run_cycle`, tag the run's decisions with
  `session_id`/`session_step`, snapshot equity via `service.positions_of` +
  `quoting.quote`, append point, `completed_steps += 1`, commit; honour
  `stop_requested`; on `DecisionError`/`VenueError` → `failed` + message;
  finish with totals, drawdown, audit `session_finished`.
- Tests `tests/test_trading_session.py` with `ReplayProvider`, 8 steps:
  78→8 points, decisions tagged with steps 1..8, `sandbox_step == seed + 8`,
  `finished` with totals; a `stop_requested` set after 3 steps ends
  `stopped` with 3 points; a provider raising `DecisionError` ends `failed`
  naming the cause.
- [x] commit `feat(invest): a trading day runs step by step in the background`.

### Task 4: Routes `api/invest_session.py`
- `POST /invest/sessions` (202; 409 if one is running or the pipeline is
  halted; seed = `secrets.randbelow(100_000)` when absent; needs a model and
  a paper venue — same refusals as `/run`), `GET /invest/sessions`,
  `GET /invest/sessions/{id}` (closes recomputed from `sandbox.closes`,
  decisions with mass, orders, report), `POST /invest/sessions/{id}/stop`.
  `/run` refuses (409) while a day is running.
- Schemas in `schemas/invest.py`; router mounted in `main.py`.
- Tests `tests/test_invest_session_api.py` (BackgroundTasks run inline
  under TestClient, so a 4-step day finishes within the request).
- [x] commit `feat(invest): /invest/sessions — start, watch, stop, read a day`.

### Task 5: Screen « La journée »
- `navigation.ts` entry, `routes.tsx`, `lib/types.ts` types.
- `features/invest/SessionPage.tsx` + `SessionCharts.tsx` (option builders
  exported as pure functions: `capitalOption(session)`, `marketOption(symbol,
  closes, decisions, orders)`, `massOption(symbol, series)`) + CSS.
- Polling every 2 s while `running` (`useApiQuery` with `refetchInterval`).
- Control room: « Simuler une journée » link.
- Tests: `SessionCharts.test.tsx` (series lengths, markers, colours from
  tokens), `SessionPage.test.tsx` (form posts, progress, balance sheet,
  previous days, replay seed prefill).
- [x] commit `feat(invest): the « La journée » screen`.

### Task 6: Browser judgement, both widths and themes
- Run a real day against Laya (78 steps); fix what the browser shows; push.
