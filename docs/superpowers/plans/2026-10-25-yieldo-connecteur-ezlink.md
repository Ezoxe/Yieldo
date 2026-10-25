# Yieldo Finance connector — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Claude drive Yieldo through a « Yieldo Finance » MCP connector served by EZLink, with every tool on one of three tiers (direct, Discord approval, never).

**Architecture:** Yieldo publishes a declarative tool catalogue on `/api/connector` (one line per tool pointing at an existing route; input schema derived from the route's OpenAPI; calls replayed in-process through ASGI with a long-lived `ycn_` key). EZLink loads that catalogue through a dedicated mTLS agent, serves it on a second MCP server (`/finance/mcp`) with its own OAuth resource and scopes, and applies the strictest of Yieldo's tier and `policy.yaml`.

**Tech Stack:** FastAPI 0.141, SQLAlchemy 2, Alembic, httpx (ASGITransport), React 19 + Vitest; EZLink: Python 3.12, `mcp` 2.3 (`MCPServer`, `ServerMiddleware`), aiosqlite, websockets mTLS.

Spec: `docs/superpowers/specs/2026-10-25-yieldo-connecteur-ezlink-design.md`.

## Global Constraints

- Money is integer cents at every layer; dates ISO-8601.
- User-facing text in French with « » and non-breaking spaces before `:` `;` `?` `!`; code, comments, commits in English.
- Every business query filters on `user_id`.
- No silent failure: a refusal names its cause and its remedy.
- A route behind `get_session_user` / `require_session_admin` is never reachable by a `ycn_` key.
- Nothing is imported until the household has seen and confirmed the mapping on screen.
- One commit per task, Conventional Commits, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- EZLink: do not touch files another session has uncommitted changes in without merging them in; commit only the files this plan changes.

## Deviations from the spec, decided while planning

- The household-rule routes live on their own router, `/api/rules`, not under `/categories/rules`: `PATCH /categories/{category_id}` would otherwise shadow them.
- `POST /invest/sessions`, its stop, `POST /invest/sandbox/reset` and `POST /invest/model/apprendre` already take `get_session_user`. They stay out of the catalogue (list `NEVER`), rather than weakening that boundary.
- The connector key is stored as a SHA-256 of its secret, not encrypted: it is shown once and never read back, unlike the `yld_` key.
- A prepared import keeps the raw file in `pending_imports`; the Imports screen downloads it and runs the ordinary wizard on it, so the mapping step is exactly the one a dropped file goes through.

---

## Part A — Yieldo

### Task A1: the connector key

**Files:**
- Create: `backend/app/models/connector_key.py`, `backend/app/security/connector_keys.py`, `backend/app/api/connector_keys.py`, `backend/alembic/versions/a1c3e5f7b9d1_connector_keys.py`
- Modify: `backend/app/models/__init__.py`, `backend/app/security/deps.py`, `backend/app/api/invest_common.py`, `backend/app/api/invest_run.py`, `backend/app/api/invest_oversight.py`, `backend/app/main.py`
- Test: `backend/tests/test_connector_keys.py`, `backend/tests/test_migrations.py`

**Interfaces:**
- Produces: `connector_keys.PREFIX = "ycn"`, `looks_like_connector_key(token) -> bool`, `issue(db, user_id) -> tuple[ConnectorKey, str]`, `find(db, token) -> ConnectorKey | None`; `deps.get_connector_user(request, db) -> User` (accepts ONLY `ycn_`); `actor_of(request) -> "session" | "agent" | "connector"`.
- Routes: `GET /api/connector-key` → `{exists, created_at, last_used_at}`; `POST /api/connector-key` → `{key, created_at}` (replaces any previous key); `DELETE /api/connector-key` → 204. All `get_session_user`.

- [ ] Write tests: issue shows the token once and GET never returns it; POST replaces (old token 401); DELETE revokes; a `ycn_` key reads `/api/accounts`; it is refused on `/api/access-key`, `/api/connector-key`, `/api/auth/password`; `get_connector_user` refuses a JWT and a `yld_` key; `actor_of` returns `"connector"`; `POST /api/invest/run` in live autonomy refuses a connector; `last_used_at` set on use; another user's key never resolves to this user.
- [ ] Run, see them fail.
- [ ] Implement model (`user_id` unique, `selector` unique, `secret_hash` String(64), `created_at`, `last_used_at`), helpers (`secrets.compare_digest` on `sha256(secret).hexdigest()`), deps branch in `get_current_user` and refusal in `get_session_user`, routes, migration (revises `e8a0c2d4f6b8`), `test_migrations.py` table test against `_reference_schema`.
- [ ] Run the file and `test_migrations.py -k connector`, see them pass; ruff.
- [ ] Commit `feat(connector): a long-lived connector key, shown once`.

### Task A2: the household's own rules

**Files:**
- Create: `backend/app/api/rules.py`, `backend/app/schemas/rules.py`
- Modify: `backend/app/main.py`
- Test: `backend/tests/test_rules_api.py`

**Interfaces:**
- `GET /api/rules` → list of `{id, pattern, category_id, category_name, origin, direction, priority, hit_count}` for the user, every origin.
- `POST /api/rules` `{pattern, category_id, direction?}` → 201, `origin = "manual"`, `priority = RULE_PRIORITIES["manual"]`, `is_regex = False`; pattern stripped, 1–200 chars, refused (409) if the same pattern already sends to the same category.
- `PATCH /api/rules/{id}` `{pattern?, category_id?, direction?}` and `DELETE /api/rules/{id}` — only `manual` and `learned` rows; a `builtin` row → 409 « Une règle intégrée ne se modifie pas : créez la vôtre, elle passe avant ».
- `direction` in `("any", "debit", "credit")`; the category must belong to the user (404 otherwise).

- [ ] Tests for each behaviour above, including isolation between two households.
- [ ] Implement; register router.
- [ ] Pass; ruff; commit `feat(rules): the household writes its own rules`.

### Task A3: the catalogue and `/api/connector`

**Files:**
- Create: `backend/app/connector/__init__.py`, `backend/app/connector/routes_index.py` (walks the API router into `(method, path, APIRoute)`), `backend/app/connector/schema.py` (input schema from OpenAPI, `$ref` inlined), `backend/app/connector/describe.py` (French sentences), `backend/app/connector/catalog.py` (the table, `NEVER`), `backend/app/connector/dispatch.py` (argument mapping + ASGI replay), `backend/app/models/connector_action.py`, `backend/app/api/connector.py`, `backend/app/schemas/connector.py`, `backend/alembic/versions/b2d4f6a8c0e2_connector_actions.py`
- Modify: `backend/app/models/__init__.py`, `backend/app/main.py`, `backend/app/api/connector_keys.py` (`GET /connector-key/actions`)
- Test: `backend/tests/test_connector_catalog.py`, `backend/tests/test_connector_api.py`, `backend/tests/test_migrations.py`

**Interfaces:**
- `ToolDef(name, title, description, tier: "read"|"write"|"approve", method, path, describe: Describer | None)`; `Describer = Callable[[Session, User, dict], str]` raising `HTTPException` (404/422) on bad arguments.
- `CATALOG: dict[str, ToolDef]`; `NEVER: dict[tuple[str, str], str]` (method, path) → reason.
- `catalog_payload() -> {"fingerprint": str, "tools": [{name, title, description, tier, scope, input_schema}]}` — `scope = "finance_read"` for `read`, else `"finance_write"`.
- `GET /api/connector/tools`, `POST /api/connector/describe {tool, args}` → `{summary, tier}`, `POST /api/connector/call {tool, args, approval_id?}` → `{status, body, fingerprint}`; all `get_connector_user`.
- `ConnectorAction(user_id, tool, args_json (amounts and texts kept, nothing secret exists here), approval_id, status_code, created_at)`.
- `GET /api/connector-key/actions?limit=` (session) → latest actions.

Behaviour:
- Argument mapping: path parameters by name, query parameters by name, the rest into the JSON body; a route whose body is not an object takes the whole body as argument `corps`. Unknown argument → 422 « Argument inconnu pour <outil> : <nom> ». Missing required → 422.
- `call` replays `method path` against the app through `httpx.ASGITransport` with the caller's `Authorization` header; returns the route's status and JSON. An `approve` tool without `approval_id` → 403 « Cette action demande votre validation sur Discord ». A response larger than 100 000 characters → 413 « Réponse trop longue : resserrez avec limit et offset (ou une période plus courte) ».
- Every `write`/`approve` call (accepted or refused by the route) appends a `ConnectorAction`.
- `describe` checks the tool exists, the arguments map, and runs the tool's describer (approve tools) or returns its title with the arguments in French (others). It never writes.

Tests (`test_connector_catalog.py`):
- every catalogue line points to an existing route with that method;
- no catalogue line points to a route depending on `get_session_user` or `require_session_admin`;
- every `POST/PUT/PATCH/DELETE` route under `/api` (except `/api/connector*`) is either in the catalogue or in `NEVER`, and every `NEVER` key exists;
- every `approve` tool has a describer; every `DELETE` route in the catalogue is `approve`;
- every tool name matches `^yieldo_[a-z0-9_]+$` and is unique; every input schema is an object schema without `$ref`.

Tests (`test_connector_api.py`): JWT and `yld_` refused on `/api/connector/*`; `tools` lists names and fingerprint; a read tool returns the same JSON as the route; `yieldo_categoriser` writes and logs an action; `approve` without `approval_id` → 403 and nothing written; `describe` of a delete names the row and writes nothing; describe of another household's transaction → 404; unknown argument → 422; isolation between two households through `call`.

- [ ] Write the catalogue tests, see them fail.
- [ ] Implement `routes_index`, `schema`, `catalog` (full table below), `describe`.
- [ ] Write the API tests, see them fail; implement `dispatch`, the model, the routes, the migration.
- [ ] Pass both files and the migration test; ruff; commit `feat(connector): Yieldo publishes its tools and replays them for EZLink`.

**Catalogue table** (tier — tool — method path — French title):

Read: `yieldo_lire_profil` GET /auth/me; `yieldo_lire_comptes` GET /accounts; `yieldo_lire_soldes` GET /accounts/balance; `yieldo_lire_imports` GET /imports; `yieldo_lire_dernier_import` GET /imports/last; `yieldo_lire_profils_import` GET /imports/profiles; `yieldo_lire_transactions` GET /transactions; `yieldo_lire_categories` GET /categories; `yieldo_lire_regles` GET /rules; `yieldo_lire_inflation` GET /analysis/inflation; `yieldo_lire_anomalies` GET /analysis/anomalies; `yieldo_lire_indice_prix` GET /analysis/price-index; `yieldo_lire_series` GET /analytics/series; `yieldo_lire_repartition` GET /analytics/categories; `yieldo_lire_resume` GET /analytics/summary; `yieldo_lire_calendrier` GET /analytics/calendar; `yieldo_lire_budgets` GET /budgets; `yieldo_lire_historique_budgets` GET /budgets/history; `yieldo_lire_univers` GET /budgets/{category_id}/detail; `yieldo_lire_recurrences` GET /recurrences; `yieldo_lire_recurrences_declarees` GET /recurrences/declared; `yieldo_lire_calendrier_recurrences` GET /recurrences/calendar; `yieldo_lire_mises_a_l_ecart` GET /recurrences/dismissals; `yieldo_lire_plan` GET /plan; `yieldo_lire_apercu_plan` GET /plan/preview; `yieldo_lire_mode_lecture` GET /plan/mode; `yieldo_lire_evenements` GET /planned-events; `yieldo_lire_runs_agent` GET /agent/runs; `yieldo_lire_propositions` GET /agent/proposals; `yieldo_lire_tresorerie` GET /cashflow/forecast; `yieldo_lire_autonomie` GET /cashflow/runway; `yieldo_lire_avenir` GET /outlook; `yieldo_lire_fiabilite` GET /outlook/reliability; `yieldo_lire_remboursement` GET /debts/payoff; `yieldo_lire_dettes` GET /debts; `yieldo_lire_objectifs` GET /goals; `yieldo_lire_contexte_faisabilite` GET /feasibility/context; `yieldo_lire_scenarios` GET /feasibility/scenarios; `yieldo_lire_contexte_simulateurs` GET /simulators/context; `yieldo_lire_defis` GET /engagement; `yieldo_lire_instruments` GET /portfolio/instruments; `yieldo_lire_comptes_titres` GET /portfolio/accounts; `yieldo_lire_positions` GET /portfolio/positions; `yieldo_lire_lots` GET /portfolio/lots; `yieldo_lire_valorisation` GET /portfolio/valuation; `yieldo_lire_patrimoine` GET /portfolio/networth; `yieldo_lire_cibles` GET /portfolio/targets; `yieldo_lire_allocation` GET /portfolio/allocation; `yieldo_lire_projection` GET /projection; `yieldo_lire_conversations` GET /chat/conversations; `yieldo_lire_chat` GET /chat; `yieldo_lire_options_export` GET /export/options; `yieldo_lire_modeles_export` GET /export/templates; `yieldo_lire_alertes` GET /alerts; `yieldo_lire_nombre_alertes` GET /alerts/count; `yieldo_rechercher` GET /search; `yieldo_invest_profils` GET /invest/policy/profils; `yieldo_invest_contrat` GET /invest/oversight/contrat; `yieldo_invest_etat` GET /invest/oversight/etat; `yieldo_invest_journal` GET /invest/oversight/journal; `yieldo_invest_journees` GET /invest/sessions; `yieldo_invest_journee` GET /invest/sessions/{session_id}; `yieldo_invest_decisions` GET /invest/decisions; `yieldo_invest_decision` GET /invest/decisions/{decision_id}; `yieldo_invest_ordres` GET /invest/orders; `yieldo_invest_vue` GET /invest/overview; `yieldo_avenir_scenario` POST /outlook/scenario; `yieldo_faisabilite` POST /feasibility; `yieldo_simuler_credit` POST /simulators/credit; `yieldo_simuler_epargne` POST /simulators/epargne; `yieldo_simuler_immobilier` POST /simulators/immobilier.

Write: `yieldo_creer_transaction` POST /transactions; `yieldo_corriger_transaction` PATCH /transactions/{transaction_id} (category, note, transfer — the « catégoriser » case included); `yieldo_creer_categorie` POST /categories; `yieldo_modifier_categorie` PATCH /categories/{category_id}; `yieldo_creer_regle` POST /rules; `yieldo_modifier_regle` PATCH /rules/{rule_id}; `yieldo_declarer_recurrence` POST /recurrences/declared; `yieldo_modifier_recurrence` PATCH /recurrences/declared/{declaration_id}; `yieldo_pointer_echeance` POST /recurrences/declared/{declaration_id}/checkins; `yieldo_ecarter_detection` POST /recurrences/dismissals; `yieldo_creer_ligne_plan` POST /plan; `yieldo_modifier_ligne_plan` PATCH /plan/{line_id}; `yieldo_creer_evenement` POST /planned-events; `yieldo_modifier_evenement` PATCH /planned-events/{event_id}; `yieldo_refuser_proposition` POST /agent/proposals/{proposal_id}/refuse; `yieldo_creer_dette` POST /debts; `yieldo_modifier_dette` PATCH /debts/{debt_id}; `yieldo_creer_objectif` POST /goals; `yieldo_modifier_objectif` PATCH /goals/{goal_id}; `yieldo_accepter_defi` POST /engagement/challenges/{challenge_id}/accept; `yieldo_refuser_defi` POST /engagement/challenges/{challenge_id}/reject; `yieldo_regler_cibles` PUT /portfolio/targets; `yieldo_demander` POST /chat; `yieldo_regler_alertes` PUT /alerts/settings; `yieldo_invest_rejouer` POST /invest/oversight/replay/{decision_id}; `yieldo_invest_arreter` POST /invest/oversight/halt; `yieldo_import_preparer` (custom, Task A4).

Approve: `yieldo_creer_compte` POST /accounts; `yieldo_modifier_compte` PATCH /accounts/{account_id}; `yieldo_supprimer_compte` DELETE /accounts/{account_id}; `yieldo_annuler_import` DELETE /imports/{batch_id}; `yieldo_creer_profil_import` POST /imports/profiles; `yieldo_supprimer_profil_import` DELETE /imports/profiles/{profile_id}; `yieldo_supprimer_transaction` DELETE /transactions/{transaction_id}; `yieldo_supprimer_categorie` DELETE /categories/{category_id}; `yieldo_supprimer_regle` DELETE /rules/{rule_id}; `yieldo_indice_prix_insee` POST /analysis/price-index/insee; `yieldo_regler_indice_prix` PUT /analysis/price-index; `yieldo_supprimer_recurrence` DELETE /recurrences/declared/{declaration_id}; `yieldo_depointer_echeance` DELETE /recurrences/declared/{declaration_id}/checkins/{due_on}; `yieldo_retablir_detection` DELETE /recurrences/dismissals/{dismissal_id}; `yieldo_supprimer_ligne_plan` DELETE /plan/{line_id}; `yieldo_plan_depuis_recurrences` POST /plan/from-recurrences; `yieldo_changer_lecture` PUT /plan/mode; `yieldo_supprimer_evenement` DELETE /planned-events/{event_id}; `yieldo_appliquer_proposition` POST /agent/proposals/{proposal_id}/apply; `yieldo_supprimer_proposition` DELETE /agent/proposals/{proposal_id}; `yieldo_supprimer_dette` DELETE /debts/{debt_id}; `yieldo_supprimer_objectif` DELETE /goals/{goal_id}; `yieldo_enregistrer_scenario` POST /feasibility/scenarios; `yieldo_supprimer_scenario` DELETE /feasibility/scenarios/{scenario_id}; `yieldo_creer_instrument` POST /portfolio/instruments; `yieldo_creer_compte_titres` POST /portfolio/accounts; `yieldo_modifier_compte_titres` PATCH /portfolio/accounts/{account_id}; `yieldo_supprimer_compte_titres` DELETE /portfolio/accounts/{account_id}; `yieldo_creer_position` POST /portfolio/positions; `yieldo_supprimer_position` DELETE /portfolio/positions/{position_id}; `yieldo_creer_lot` POST /portfolio/lots; `yieldo_modifier_lot` PATCH /portfolio/lots/{lot_id}; `yieldo_supprimer_lot` DELETE /portfolio/lots/{lot_id}; `yieldo_effacer_chat` DELETE /chat; `yieldo_exporter` POST /export; `yieldo_invest_tour` POST /invest/run (refused by the route itself when the mandate is live).

Never (`NEVER`): every `/auth/*` write, `/admin/settings`, `/access-key*`, `/connector-key*`, `/connections/*`, `/assistant/llm-settings` (PUT, DELETE), `/assistant/llm`, `/agent/run`, `/imports/analyze` (multipart; Task A4 covers it), `/imports/commit` (the mapping is the household's), `/export/download` (a file, not an answer), every `/invest/venues*`, `/invest/policy*`, `/invest/model*`, `/invest/sessions*` writes, `/invest/sandbox/reset`.

### Task A4: imports prepared by Claude

**Files:**
- Create: `backend/app/models/pending_import.py`, `backend/alembic/versions/c3e5a7b9d1f3_pending_imports.py`, `frontend/src/features/import/PreparedImports.tsx`, `frontend/src/features/import/PreparedImports.test.tsx`
- Modify: `backend/app/api/imports.py` (pending routes), `backend/app/connector/catalog.py` + `dispatch.py` (custom tool), `backend/app/models/__init__.py`, `frontend/src/features/import/ImportPage.tsx`, `frontend/src/lib/types.ts`, `frontend/src/dev/mockApi.ts`
- Test: `backend/tests/test_pending_imports_api.py`, `backend/tests/test_connector_api.py`, `backend/tests/test_migrations.py`

**Interfaces:**
- `PendingImport(user_id, account_id (FK accounts, CASCADE), filename, content LargeBinary, rows int, created_at)`.
- `GET /api/imports/pending` → `[{id, account_id, account_name, filename, rows, created_at}]`; `GET /api/imports/pending/{id}/file` → the raw bytes (`text/csv`); `DELETE /api/imports/pending/{id}` → 204. `get_current_user`.
- Tool `yieldo_import_preparer {account_id, nom_fichier, contenu}` (tier `write`): `.csv` only, ≤ 2 Mo of text, account owned; runs `build_preview` with no dialect and no mapping; stores the row; answers `{pending_id, lignes, doublons, colonnes, mapping_propose, message: "Analyse rangée dans Imports → « Préparé par Claude » : confirmez les colonnes à l'écran, rien n'est importé avant."}`.
- Front: `PreparedImports` lists the rows above the history; « Ouvrir » selects the account, fetches the file, hands it to the wizard as a `File` (`actions.selectFile`); after a commit of that file the row is deleted; « Écarter » deletes it.

- [ ] Backend tests (list/file/delete isolation, tool stores and never commits, oversize and non-CSV refusals); fail; implement; pass; migration test.
- [ ] Front test (list renders, « Ouvrir » calls the wizard with a File named like the row, « Écarter » deletes); fail; implement; pass.
- [ ] Commit `feat(import): Claude prepares an import, the household confirms its columns`.

### Task A5: the « Yieldo Finance » card

**Files:**
- Create: `frontend/src/features/connections/ConnectorPanel.tsx`, `ConnectorPanel.test.tsx`
- Modify: `frontend/src/features/connections/ConnectionsPage.tsx`, `frontend/src/lib/types.ts`, `frontend/src/dev/mockApi.ts`

**Behaviour:** state of the key (« Aucune clé », « Créée le …, dernière utilisation le … »); « Créer la clé » / « Remplacer la clé » shows the token once in a monospace field with « Copier » and the sentence « Collez-la dans le fichier de clé de l'agent EZLink (`/etc/ezlink/yieldo_key`) : elle ne sera plus affichée. »; « Révoquer »; list « Ce que Claude a fait » (tool title, date, status pill). Errors print `detail`.

- [ ] Test, fail, implement, pass; `npm run build` and `npm run lint`.
- [ ] Look at it at 1440 and 390, both themes (`?apercu=1`).
- [ ] Commit `feat(connections): the Yieldo Finance card`.

---

## Part B — EZLink

Starts only once the other session working in `E:\Projet\Github\EZLink` has committed (its working tree carries uncommitted turbo / room / team changes to `policy/catalog.py`, `policy/config.py`, `policy/engine.py`, `db.py`).

### Task B1: protocol and agent backend `yieldo`

**Files:** `packages/protocol/src/ezlink_protocol/{ops.py,messages.py}`, `packages/agent/src/ezlink_agent/{yieldo.py,config.py,dispatcher.py,__main__.py}`, `deploy/agent/agent.yaml.example`, tests beside them.

- `BackendInfo.kind` gains `"yieldo"`; `BackendInfo` gains `catalog: dict | None` (the `tools` payload with its fingerprint).
- Ops `yieldo.tools.list`, `yieldo.tool.describe`, `yieldo.tool.call` (in `AGENT_OPS`).
- `YieldoClient(base_url, key_file)` — httpx; `tools()`, `describe(tool, args)`, `call(tool, args, approval_id)`; 401 → `EZLinkError(BACKEND_ERROR, …, data={"auth": "yieldo"})`; connection error → `BACKEND_UNAVAILABLE`; a Yieldo `detail` is relayed verbatim.
- The agent announces the catalogue in `hello` and sends an event `yieldo.catalog` when the fingerprint returned by a call differs.
- Tests with respx.

### Task B2: catalogue-driven policy and finance mode

**Files:** `packages/core/src/ezlink_core/{yieldo_catalog.py,policy/catalog.py,policy/engine.py,policy/config.py,state.py}`, tests.

- `YieldoCatalog` holds the latest tools (from hello/event); `spec_for(name) -> ToolSpec | None` builds `ToolSpec(name, scope, rule, rule)` with `read`/`write` → allow, `approve` → approve.
- `SCOPES` gains `finance_read`, `finance_write`; `PRESELECTABLE_SCOPES` gains only `finance_read`.
- `PolicyEngine` looks a `yieldo_*` tool up in the catalogue; `policy.yaml` overrides for `yieldo_*` names are accepted without being in `TOOL_CATALOG` and can only tighten (`allow < approve < deny`).
- `GlobalState.finance_mode` in `("on", "readonly", "off")`, persisted in kv, audited; `off` denies every `yieldo_*` tool, `readonly` every non-`finance_read` one.

### Task B3: the `/finance/mcp` server and token separation

**Files:** `packages/core/src/ezlink_core/{mcp/finance.py,mcp/server.py,app.py,auth/oauth.py,auth/clients.py,auth/authorize.py}`, tests.

- `build_finance_server(entry, services)`: `MCPServer` with `ezlink_whoami`, `ezlink_backends`, `ezlink_approval_status`, and a `ServerMiddleware` that appends the catalogue's tools to `tools/list` and answers `tools/call` for `yieldo_*` through `gateway.invoke` → hub ops; approve tools get the `describe` sentence as approval summary, prefixed « 💶 Finance ».
- `connector_of(resource) -> "finance" | "ia"`; OAuth `authorize` keeps only the connector's scopes; the IA server refuses finance tokens and the finance server IA tokens (verifier wrapper); private static tokens carry their connector through their scopes.
- `app.py`: the public listener dispatches `/finance/mcp` and `/.well-known/oauth-protected-resource/finance/mcp` to the finance app and runs both lifespans.

### Task B4: Discord, alerts, audit, dashboard

**Files:** `packages/core/src/ezlink_core/{approvals/discord_bot.py,alerts.py,audit.py,admin/app.py}`, tests.

- `/finance on|readonly|off` DM command; messages from the finance connector prefixed « 💶 Finance »; alert on `auth: yieldo` « Clé connecteur refusée : recréez-la dans Réglages → Connexions, puis collez-la dans l'agent ».
- Audit gains `connector`; dashboard filters on it.

### Task B5: end to end, deploy, docs

- e2e: real gateway, real mTLS agent, fake Yieldo (Starlette), official MCP client on `/finance/mcp`.
- `docker-compose.yml` of Yieldo: service `ezlink-agent` under profile `ezlink`; README (French) section « Connecteur Yieldo Finance »; EZLink spec amendment and README table.
