# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Yieldo is a self-hosted personal-finance web app for French households: CSV
bank statements in, categorised ledger, budgets, recurrences, forecasts,
debts, goals, portfolio, a deterministic assistant, and an optional
human-approved LLM agent. FastAPI + SQLAlchemy + SQLite behind, React 19 +
Vite + TypeScript in front, one Docker image, French UI.

## Commands

Backend (from `backend/`, venv at `backend/.venv`, Python 3.12+):

```bash
./.venv/Scripts/pytest.exe -v --cov=app --cov-report=term-missing   # full suite (~2 min)
./.venv/Scripts/pytest.exe tests/test_budget.py -q                   # one file
./.venv/Scripts/pytest.exe tests/test_answer.py -k trace -q          # one test by name
./.venv/Scripts/ruff.exe check app tests                             # lint (E,F,I,UP,B,SIM; 100 cols)
./.venv/Scripts/alembic.exe revision --autogenerate -m "short_name"  # new migration
./.venv/Scripts/uvicorn.exe app.main:app --port 8000 --reload        # dev server
```

Frontend (from `frontend/`, Node 22+):

```bash
npm test                                 # vitest, whole suite (~40 s)
npx vitest run src/features/budgets      # one directory / file
npm run build                            # tsc -b && vite build — must be zero TS errors
npm run lint                             # eslint src --max-warnings 0
npm run dev                              # Vite on 5173, proxies /api to :8000
```

Other:

```bash
bash tests/install/test_find_port.sh     # install.sh harness, no Docker needed
cd e2e && npx playwright test            # against a running instance (YIELDO_URL)
./install.sh install|update|backup|restore|logs   # operator entry point (Docker)
```

`.claude/launch.json` declares the two dev servers (`yieldo-backend`,
`yieldo-frontend`) for the browser preview. Coverage target: ≥ 80 % on
`app/engines` and `app/importers`.

## Architecture

### Request path

`app/main.py` mounts every router under `/api` and serves the built SPA from
`YIELDO_STATIC_DIR` for any other path (an unmatched `/api/*` is a JSON 404,
never the SPA shell). Pydantic validation errors are rewritten in French by
`api/errors.py` — the front end prints `detail` verbatim, so the backend owns
every user-facing sentence.

A typical analytics route reads like this:

```
api/<screen>.py         reads the clock (date.today()), resolves user + period
  -> api/common.py      ONE place that turns ORM rows into frozen dataclasses,
                        filtered on user_id, and applies the ledger mode
    -> engines/<x>.py   pure calculation, "today" is a parameter
  -> schemas/<x>.py     wire shape (cents, ISO dates)
```

`api/common.py` is the boundary between the database and the engines. Its
docstring explains which helpers apply the three ledger readings (`real`,
`estimated`, `blended` — `engines/plan.LEDGER_MODES`) and which deliberately
stay real (recurrence detection, anomalies, liquid balance).

### Layers, and what each may touch

- `engines/` and `importers/{dialect,mapping,parser,dedup}.py`: pure. No
  session, no network, no implicit clock.
- Orchestration with a `Session` but no calculation of their own:
  `importers/service.py`, `categorization/{seed,learning}.py`,
  `transfers.py`. They assemble pure functions and persist.
- `api/`: routes. Every business query filters on `user_id` through
  `get_current_user` (`security/deps.py`).
- `models/`: SQLAlchemy, `Base` from `db.py` gives every table an int `id`.
  `models/__init__.py` re-exports everything and the `*_KINDS` tuples the
  schemas validate against.
- `schemas/`: Pydantic. `schemas/patching.not_nullable()` is how a PATCH
  refuses an explicit `null` on a NOT NULL column.
- `market/`: price providers (Finnhub, Alpha Vantage, CoinGecko, Frankfurter,
  ExchangeRate-API) behind one client with a per-provider prudence quota
  (`market/quota.py`) and a cache. Keys are Fernet-encrypted with
  `SECRET_KEY` (`security/crypto.py`) and never read back to the screen.
- `llm/`: `client.py` (OpenAI-compatible endpoint, no retry), `tools.py`
  (read tools run engines; write tools only append `AgentProposal` rows),
  `agent.py` (bounded loop, every step persisted as `AgentStep`).
- `reports/pdf.py`: fpdf2 reports.

### Auth

Two credentials reach `get_current_user`: the browser's short-lived JWT
(access token in memory only; refresh in an HttpOnly cookie, see
`frontend/src/lib/api.ts`) and an agent access key (`yld_…`, 24 h,
`security/agent_keys.py`). Both resolve to the same `User`. Routes that change
the account's own credentials — password, email, the key itself, and the
provider keys in Réglages → Connexions — take `get_session_user` instead. A
key opens the ledger; it does not open the account.

Around them:

- Tokens carry `sv`, the user's `session_version`. Changing the password or
  « Déconnecter les autres sessions » (`POST /auth/sessions/revoke-others`)
  bumps it, so every other refresh cookie and access token stops working;
  the caller gets a fresh pair.
- `security/throttle.py` slows repeated failed logins per address and per
  email; `security/headers.py` (pure ASGI) sets the CSP and the other
  headers on every response; `security/secret_guard.py` refuses to start in
  production on the public default `SECRET_KEY`.
- The refresh cookie is `Secure` whenever the request arrived over HTTPS —
  behind a proxy that means uvicorn's `FORWARDED_ALLOW_IPS`.
- Registration closes once the first account exists. The administrator
  reopens it in Réglages → Installation (`/admin/settings`,
  `require_session_admin`, `models/instance_settings.py`);
  `YIELDO_REGISTRATION_OPEN` only sets the default.
- Every ECharts HTML tooltip escapes what it prints through
  `charts/escapeHtml.ts`: a label is written by a bank or a merchant.

### Database and migrations

SQLite in `data/yieldo.db`, WAL, foreign keys on. Tests build the schema with
`Base.metadata.create_all` on an in-memory `StaticPool` engine
(`tests/conftest.py`); the deployed instance runs `alembic upgrade head` in
`docker/entrypoint.sh` and never calls `create_all`. `db.create_schema()`
exists for scripts and stamps the Alembic head so the result stays
migratable. `tests/test_migrations.py` runs real `upgrade()`/`downgrade()`
against a file DB seeded at the previous revision — extend it for any
migration that backfills data.

### Frontend

- `app/routes.tsx` — every screen; `app/navigation.ts` — the sidebar in
  groups, with French `aliases` the header search matches on. One list for
  both, so a screen cannot be reachable by one and invisible to the other.
- `app/AppShell.tsx` — sidebar, header (global search, assistant drawer,
  `LedgerModeBadge`), `Outlet` keyed on the ledger mode so changing it
  refetches every screen.
- `features/<screen>/` — one directory per screen: `XPage.tsx`, its CSS,
  sub-components, tests, and often `fixtures.ts` reused by both the tests and
  the preview harness.
- `lib/api.ts` — the only fetch wrapper (`api.get/post/put/patch/delete/upload`),
  silent refresh on 401. `lib/types.ts` — wire types. Screens fetch with
  `useEffect` + `useState`; `@tanstack/react-query` is mounted in `main.tsx`
  but no screen uses it yet.
- State: zustand stores for the session (`features/auth/session.ts`), the
  ledger mode, the proposal badge count, and the motion / shibi preferences.
- `design/` — tokens (`tokens.css`), primitives (`PageHead`, `InfoTip`,
  `EmptyState`, `Skeleton`, `Drawer`), `bento/` grid and `PanelHead`,
  `icons/`, `motion/`, `ai/` (spotlight targets), `shibi/` (the mascot).
  `charts/` — ECharts wrappers sharing `charts/theme.ts`. ECharts 6 is loaded
  module by module in `charts/echarts.ts`: a series or component not
  registered there renders nothing.
- `dev/mockApi.ts` — the `?apercu=1` fetch stub (see "Looking at the
  screens").

## Money and dates

- Every monetary amount is an integer number of cents (`amount_cents: int`).
  Never a `float` on a monetary value, at any layer. Convert to `Decimal`
  only at the display boundary.
- Dates are `datetime.date` in the database, ISO-8601 (`YYYY-MM-DD`) in JSON.
- The clock is read at the route boundary and passed down. No engine imports
  `date.today`.

## Isolation

- Every query on a business table filters on `user_id`, via the
  `get_current_user` dependency. No route reads across users.

## No silent failures

- No bare `except: pass`. No fallback value standing in for real data.
  Errors surface to the user (in French) or propagate. A refusal names its
  cause and its remedy ("importez des relevés", "Réglages → Connexions").

## Language

- User-facing text and error messages: French, with proper typography
  (« », non-breaking spaces before `:` `;` `?` `!`, `€` after the figure).
- Code, identifiers, comments, and commit messages: English.
- Operator documentation (README.md, troubleshooting): French. This file is
  for coding sessions and stays English.

## Column tagging is user-driven

- CSV dialect detection and column-role suggestion (`importers/dialect.py`,
  `mapping.py`) only ever *propose*. Nothing is imported until the user has
  seen and confirmed the mapping on screen, and any change to it invalidates
  the preview until the analysis is re-run. Never auto-commit a suggestion.

## One box per question

The Transactions screen has ONE search field. `search` on `GET /transactions`
is a single OR over the label (raw AND normalised — the normaliser eats digits
and dates, so the raw label is the only place a statement fragment survives),
the amount, the category name, the account name and the date.
`engines/search.parse_query` is pure: a number is an amount only when the
WHOLE query is that number, a date only when the whole query is that date,
everything else stays text.

The header search (`GET /search`) is read-only, filtered on `user_id`, and
answers with GROUPS — transactions, comptes, catégories, récurrences,
objectifs, dettes — every group present even when empty, so the screen can
say what it looked in. Beside them the dialog lists SCREENS matched
client-side against `app/navigation.ts`.

Two rules on that route: every figure it returns carries a word naming it
(« Capital restant dû », « Solde d'ouverture ») except a transaction's own
amount, which sits under its label and date; a category returns no figure at
all. A failure is printed beside the screens list, never a « rien trouvé »
that was really a network error.

A transaction hit lands on `/transactions?q=<libellé>`. The `q` is a HANDOFF:
the screen applies it, remounts its box with it, and removes it from the URL.

## The reading lives in Réglages

`LedgerModeControl` sits in Réglages → Lecture des chiffres. The header shows
`LedgerModeBadge` only when the mode is not « Réel ». Any sentence in the app
that tells the reader where to change the mode must point at Réglages.

## Avenir

`/avenir` answers what the money will do, day by day. Two perimeters:
« Comptes courants » (`checking`, the overdraft question, the default) and
« Tout le disponible » (`LIQUID_ACCOUNT_KINDS`). The projection starts the day
after the perimeter's last statement (`as_of`); `today` only measures how
stale that is.

- `engines/outlook_sources.assemble` — what is known: detected recurrences,
  declared ones (Récurrences), planned one-off events (`models/planned_event`,
  `/planned-events`). **One euro, one source**: a declaration replaces the
  detected series it describes (label, or same sign and rhythm within ±15 %
  and ±5 days), transfer legs are paired and dropped, and a label the
  household dismissed stays in the variable part instead of vanishing.
- `engines/forecast.residual_model` — the variable part, month by month, with
  a variance that accumulates from the first month.
- `engines/outlook.project_outlook` — the days: median, P10/P90 band shaped by
  the household's own month (`month_profile_bps`), low point, risk against the
  threshold (`probable` median under, `possible` only the band's low edge),
  month ends; `apply_adjustments` for « Et si… ». `OutlookInputs` +
  `project_until` project any day of one assembly exactly as an assembly made
  for that day would.
- `engines/backtest.measure_reliability` — the method replayed on the
  household's own history (1 and 3 months), refused under nine months.
- `api/outlook.py` — `GET /outlook`, `POST /outlook/scenario` (nothing
  written), `GET /outlook/reliability`. `Perimeter`, `project` and
  `avenir_facts` are shared: the Alertes floor, the assistant and the agent's
  `lire_avenir` read the future through them and nowhere else.
- The threshold is the floor set in Alertes, or zero. The floor alert
  (`engines/alert._balance_floor`) reads the current accounts' low point over
  `FLOOR_HORIZON_DAYS` (90), keyed `balance_floor:<date>`.

## Budget universes

`/budgets/:id` (`features/budgets/universe/UniversePage.tsx`) is one category:
what it cost in the month on screen and in an ordinary month, year by year,
month by month, and its children (`parts`) — or, on a child's page, its family
(`siblings`). `GET /budgets/{id}/detail` reads the month and every ceiling
exactly as `/budgets` does (`tx_points`, `rolled_budget_spend`);
`engines/category_history.py` takes means over COMPLETE months only (a covered
month with nothing spent counts as 0, no mean under three).

- `registry.ts` maps a category to a universe and a part: a child through its
  parent, seeded slugs before names, a lone root part on unambiguous words
  only. A child the universe has no part for gets no scene, not a guess.
- `readings.ts` is the one place a figure becomes a picture: the dial is the
  page's own ceiling, a part's level its own ceiling or else its monthly mean
  (said as such on its label). Both are a share still unspent, in [0, 1].
- A scene (`scenes/car/`) draws. Its colours are physical and live in its
  stylesheet, never in a component; its labels are HTML (`SceneLabels`),
  pinned on the drawing from 900px of scene width and listed under it below;
  its motion rests on the true values and stops under both motion switches.
- A new universe starts as a mockup the operator validates (the car's:
  `docs/superpowers/specs/assets/2026-09-30-voiture-maquette.html`), then a
  scene, its rule in `registry.ts`, and its branch in `UniversePage`.

## The assistant

- **Spotlight.** `design/ai/targets.ts` lists what the assistant may point
  at and the French terms naming each one. `POST /chat` returns a sentence and
  a figure — never an element id; the link is made by matching the sentence
  against the list. A chip appears only when its `data-ai-target` is really
  in the document or its route can be navigated to. A component becomes
  pointable by carrying `data-ai-target="…"` (or `useSpotlightTarget(id)`).
- **The future.** `balance_forecast` and `upcoming` are answered from
  Avenir's projection. `api/chat` assembles `ChatContext.avenir`
  (`api/outlook.avenir_facts`) only when a question is one of
  `OUTLOOK_INTENTS`: every other question skips that walk of the ledger.
- **Trace.** `answer.steps` is what actually ran, from
  `engines/answer.trace_query` — one declared branch per intent beside
  `_HANDLERS`; `test_every_intent_declares_a_trace` fails if they drift.
  `ReasoningTrace` staggers the reveal, prints no duration, and never writes
  a step of its own. In flight, the front end says only that one query is
  running — never a simulated progress report.
- **LLM fallback.** A question `engines/intent` does not recognise is
  answered by Yieldo's own refusal — unless a model is configured in
  Réglages → Connexions, in which case `api/chat.ask` hands it to
  `llm/agent.run_agent(read_only=True)`. Four rules, all held by
  `tests/test_chat_llm_fallback.py`: reads only (`READ_TOOLS`, a write tool
  named anyway is answered, not run); the model never calculates
  (`amount_cents` stays null on a model answer); it is labelled
  (`answered_by` reaches `AnswerProvenance`); it runs once (persisted,
  `ChatMessage.agent_run_id`; a GET never calls a model). A failing model
  leaves the parser's refusal standing with the cause named.
- **Proposals.** `llm/tools.py` write tools only append `AgentProposal`
  rows; `api/agent.py` applies one when a human clicks. Every proposal
  carries `evidence` — the engine figure behind it.

## The shibi

`design/shibi/sprite.ts` is the mascot: an impersonal cube drawn pixel by
pixel on a 32×32 grid, the visible face of the assistant. Pure — given a
state and a frame it returns 1024 colours — and `Shibi.tsx` is the only thing
that owns a canvas and a clock. `design/shibi/sprite.test.ts` enforces a
closed palette (thirteen colours plus three diode brightness steps) and whole
pixels at whole scales. He has no mouth and no eyebrows — the state is the
diode's hue and two square eyes, and each of the six states carries a `note`
naming the real situation it stands for. He is a replay of `answer.steps`,
live only in `ThinkingIndicator`. Réglages → Apparence turns him off;
`/reglages/shibi` is his model sheet, rendered from `sprite.ts` at run time.

## Shared UI primitives

- Icons: `design/icons/`. One grid (24×24, 1.75px stroke, `currentColor`,
  Lucide geometry), named after MEANING (`AlertsIcon`, not `BellIcon`).
  **Stroke only — no `fill`, ever.** Never an emoji, never a second drawing
  of the same concept, and never the only label on a control (an icon-only
  button needs an `aria-label`). The badge around an icon is a flat tint and
  a hairline, never a gradient.
- `PageHead` (`design/PageHead.tsx`) heads every screen; `PanelHead`
  (`design/bento/PanelHead.tsx`) heads every bento panel. The mark is
  `aria-hidden`.
- Content width is decided once, on `.yd-shell__main` from `--yd-page-max`.
  A screen must not declare its own `max-width`. A screen's root is a flex
  column with the shared gap; a `display: block` root loses the space under
  `PageHead`.
- Bento cells stretch to their row. Pin a card's footer with
  `margin-top: auto` rather than `align-self: start`.
- Wide content (tables, calendars, code) scrolls inside its own
  `overflow-x: auto` container; the page never scrolls horizontally, and at
  390 px every column of a grid must still be reachable.

## Design tokens

Neutral near-black ground (`#07070a`), surfaces raised in layers
(`--yd-surface`, `--yd-surface-strong`, `--yd-surface-raised`), hairlines in
white at 6–12 % alpha, and functional accents: indigo `--yd-accent`
(interactive, strategy), emerald `--yd-positive` (gains), rose
`--yd-negative` (spending, alerts), amber `--yd-warning` (a ceiling in
reach), blue `--yd-info` (a standing condition). The light theme carries the
same five hues at their 600/700 steps.

Light and dark are both required, and every status/text pairing must hold
WCAG AA (4.5:1) against its own theme's ground — `design/contrast.test.ts`
measures it from `tokens.css` on disk, and `charts/theme.ts` must mirror any
colour change or `charts/theme.test.ts` fails.

Never write a hex in a component. Money and figures take `.yd-num`
(`tabular-nums`); a status is a pill badge, not a sentence; a methodology
note goes behind an `InfoTip`, not under the figure.

## Looking at the screens

`frontend/src/dev/mockApi.ts` is a development-only fetch stub. Run the front
end and open any screen with `?apercu=1` to browse the whole application
against a canned French ledger — no backend, no database, no account. The
flag is stored in `sessionStorage`; `?apercu=0` clears it. It is dropped from
production builds (dynamic import behind `import.meta.env.DEV`) and it is not
a test double: nothing asserts on it.

Things to know before trusting what you see there:

- Its payloads are hand-written and NOT typed against `lib/types.ts`. A
  field missing from the stub (e.g. `due_on` on a goal) renders as
  `undefined`/`NaN` on screen and is a stub defect, not an app defect —
  confirm against the real backend before filing it as one.
- Routes it does not simulate answer `501 … n'est pas simulé dans ce mode`
  (simulators, export). Judge those against the real backend.
- Fixtures it borrows from tests describe different households (Alertes and
  Faisabilité speak of 2025; the ledger runs to 2026-09). Figures are not
  cross-consistent between screens.
- Entrance animations are driven by `motion`; in a hidden browser pane they
  can stall and leave a screen faded. Set
  `localStorage["yieldo.motion-disabled"]="true"` (the Réglages switch) to
  capture stable screenshots. `yieldo.theme` = `light|dark|system`.
- Judge at 1440 AND at 390 wide, both themes. `.yd-shell__main` scrolls the
  window, not itself.

For the real backend, `e2e/seed_demo_household.py` writes an eighteen-month
demonstration household into the DEVELOPMENT database (run it from
`backend/`; it deletes and recreates that one user, never another). Its test
credentials are in the script. Avenir, the dashboard's thirty days, the
floor alert and the assistant's questions about the future are judged there.

**Judge UI work in a browser before calling it done.** Phase 1's interface
was reviewed twenty-four times on the diff alone and rejected on sight.

## Testing

- TDD: write the failing test first.
- Backend fixtures in `tests/conftest.py`: `db` (in-memory), `client`
  (TestClient with `get_db` overridden), `imported` (a registered user with
  one account and the Boursorama sample imported into a `tmp_path`).
- Every engine has a test file of its own (`tests/test_<engine>.py`); routers
  are covered by `tests/test_<screen>_api.py`, with extra files per behaviour
  (`test_budget_rollup_api.py`, `test_portfolio_cash_api.py`, …).
- Frontend tests sit beside the component (`X.test.tsx`), jsdom +
  Testing Library; `src/test-setup.ts` is the global setup.

## Commits

- One commit per task. Conventional Commits format, English.

## Where to look first

- `docs/superpowers/specs/2026-08-09-yieldo-design.md` — product design and
  phase roadmap; later specs in the same directory cover each chantier.
- `docs/superpowers/plans/` — one implementation plan per phase, task by
  task.
- `.superpowers/sdd/2026-08-09-yieldo-phase-1-socle/progress.md` — the
  ledger of what each task actually shipped, deferred defects, and
  carry-forward notes. Read it before assuming a past task's behaviour.
- `docs/superpowers/specs/2026-09-26-yieldo-avenir-securite-design.md` — the
  security and quality audit of September 2026, and the design of Avenir.
- `docs/superpowers/specs/2026-09-06-yieldo-audit-complet.md` — the audit
  run on a real 18-month ledger: what was found, fixed, and what is still
  missing screen by screen.
