# SDD ledger — plan: docs/superpowers/plans/2026-08-09-yieldo-phase-1-socle.md

Branch: phase-1-socle
Pre-flight scan: 4 plan defects fixed before Task 1 (commit below).
  - Global Constraint "pure engines" contradicted Task 11 (service.py takes a Session) — scoped the constraint.
  - commit_import validated the mapping against dialect.sample_headers with an `or 99` fallback — now validates against the real header count.
  - Analytics tests imported a fixture across test modules — moved `imported` into conftest.py.
  - install.sh ensure_env read YIELDO_REGISTRATION_OPEN inside the heredoc that truncates the file — now read before writing.

Task 1: complete (commits 3b20bd1..881b113, review clean)
Task 1: minor (deferred): main.py include_router(api) runs at import time — later tasks must attach sub-routers to `api` BEFORE that line, or routes silently 404.
Task 1: minor (deferred): config.py get_settings() mkdirs at import time, relative to CWD.
Task 1: env note: Python 3.12.10 installed; use backend/.venv/Scripts/python.exe, not bare `python`.

Task 2: fix round 1/5 (1 addressed, 0 open — db fixture missing StaticPool; commits 4dbdab2..b6c2c57)
Task 2: complete (commits 881b113..b6c2c57, review clean)
Task 2: note: app/models/__init__.py exists but is empty — Task 4 must import its model classes there so Alembic's star-import sees them.

Task 3: fix round 1/5 (1 addressed, 0 open — verify_password missed VerificationError; commits 4d9275e..ebee180)
Task 3: complete (commits b6c2c57..ebee180, review clean)

Task 4: complete (commits a08bee2..beef69b, review clean)
Task 4: CARRY TO TASK 6: Account.transactions relationship was omitted (Transaction did not exist yet; a dangling string relationship breaks configure_mappers for every test). Task 6 MUST add it back to backend/app/models/account.py when it creates Transaction.
Task 4: note: users.email NOCASE collation is applied by a one-time module-level type mutation in models/user.py, not the event listener the plan described. Migration b4eec68677e6 carries collation='NOCASE'.
Task 4: minor (deferred): the NOCASE mutation could be written inline in mapped_column instead of post-hoc.
Task 4: minor (deferred): no inline TODO in account.py pointing at the missing transactions relationship.
Task 4: minor (deferred): test_seed_is_idempotent checks row count only — a delete-and-recreate implementation would pass it.

Task 5: fix round 1/5 (2 addressed, 0 open — login timing oracle via per-request hash_password; register admin TOCTOU; commits d3b48c5..4e7e1ab)
Task 5: complete (commits beef69b..4e7e1ab, review clean)
Task 5: minor (deferred): the admin-race test registers sequentially, so it would also pass against the pre-fix code. A real concurrency test is not expressible against the in-memory StaticPool fixture (single shared connection). Final review should decide whether an integration-level test against a file-backed database is worth adding.
Task 5: minor (deferred): if db.rollback() itself raised inside the BEGIN IMMEDIATE guard, the original exception would be lost.
Task 5: note: email-validator>=2.2 added to pyproject (Pydantic EmailStr requires it).

Task 6: fix round 1/5 (2 addressed, 0 open — _LONG_DIGITS erased merchant-identifying digits; no two-user dedup test; commits cac3192..95e79cc)
Task 6: complete (commits 5beab12..95e79cc, review clean)
Task 6: note: ruff per-file-ignores now cover alembic/versions/*.py and B008 in app/api/*.py + app/security/deps.py. Later tasks should not re-flag those.
Task 6: minor (deferred): no test covers ColumnProfile (user_id, name) uniqueness, nor the category_id ondelete=SET NULL behaviour at DB level.

Task 7: fix round 1/5 (2 addressed, 0 open — statistical encoding detection silently mangled French accents; parse_date fell back across formats; commits 4293bb1..4a99204)
Task 7: complete (commits 2922260..4a99204, review clean)
Task 7: note: encoding is now an explicit candidate cascade (utf-8-sig, cp1252, latin-1, plus UTF-16 BOM). charset-normalizer removed from pyproject. parse_date is strict — a mismatched row belongs in the preview error list, which Task 11 must surface.
Task 7: note: the Latin-1 fixture gained two rows (PRÉLÈVEMENT MUTUELLE, GOÛTER À LA FERME). Any later task counting that fixture's rows must use the current count, not the plan's original 3.

Task 8: fix round 1/5 (1 addressed, 0 open — comptabilis on the wrong date pattern swapped booking/value date; commits 97bab44..dae8f3e)
Task 8: complete (commits f8ca676..dae8f3e, review clean)
Task 8: note: parser.py needs `from __future__ import annotations` — CandidateRow's field named `date` shadows the imported datetime.date, so `date | None` raises TypeError at import without it. Consequence: dataclasses.fields(CandidateRow)[i].type is now a string, not a type object. Task 11/12 must not introspect it.
Task 8: minor (deferred): when a row has BOTH debit and credit populated, debit silently wins with no warning; untested.
Task 8: minor (deferred): the value_date best-effort swallow (unparseable -> None) has no test coverage.

Task 9: fix round 1/5 (1 addressed, 0 open — "total energies gaz" unreachable, gas bills filed as fuel; commits f2810b3..5b9958f)
Task 9: complete (commits 3ae639c..5b9958f, review clean)
Task 9: note: classify() returns the rule's origin verbatim, so builtin rules store category_source="builtin". Task 11 preview asserts that.
Task 9: minor (deferred): BUILTIN_RULES patterns "casino" (also a gambling/hotel brand), "match" (also Paris Match) and "orange" (also L'Orange Bleue) are broad enough to misfile real transactions. Final review should decide whether to narrow them.
Task 9: minor (deferred): the amount-sign split in test_builtin_rules_classify_common_french_merchants keys off the slug prefix "revenus" rather than the rule's direction — fragile if another credit slug is added.

Task 10: fix round 1/5 (1 addressed, 0 open — extract_pattern dropped interior stopwords, breaking substring contiguity so learned rules never matched; commits 881804b..ed96672)
Task 10: complete (commits 9b47fb6..ed96672, review clean)
Task 10: note: learned patterns are contiguous substrings by construction (edges trimmed only). Task 14's PATCH /transactions calls learn_from_correction then apply_learned_rule and returns learned_rule_id + backfilled.
Task 10: minor (deferred): a transaction with amount_cents == 0 gets direction="debit" but can never match itself (classify requires strictly < 0).
Task 10: minor (deferred): _LEARNED_PRIORITY = 200 duplicates RULE_PRIORITIES["learned"] instead of referencing it.

Task 11: fix round 1/5 (2 addressed, 0 open — bucket CSV hints discarded when no rule matched; forced-duplicate fingerprint collided on repeat; commits 791d62d..a99cc29)
Task 11: complete (commits 644ea30..a99cc29, review clean)
Task 11: note: category precedence is leaf hint -> rule -> bucket hint -> uncategorized. summary carries an extra "mapping_errors" key beyond the plan's list; Tasks 12 and 18 surface it.
Task 11: minor (deferred): by_name is keyed on casefolded category name, so a parent and a child sharing a name would collide. Pre-existing data-modelling risk, not introduced by task 11.
Task 11: minor (deferred): test_leaf_hint_wins_over_a_conflicting_rule is regression-only — it would also have passed pre-fix.
Task 11: minor (deferred): commit_import has no internal try/except + rollback; a failed commit leaves the Session for the caller to clean up.

Task 12: fix round 1/5 (3 addressed, 0 open — cross-tenant import via guessable batch-<id>.csv token; 20MB cap checked after buffering; missing 24h purge; commits a0a584b..25e8734)
Task 12: note: the first fix implementer was stopped mid-round; its staged work turned out complete and a fresh implementer verified it empirically before committing.
Task 12: complete (commits 4fc541c..25e8734, review clean)
Task 12: note: uploads live at uploads_dir/pending/<user_id>/<token>, archives at uploads_dir/archive/<user_id>/batch-<id>.csv. The user segment always comes from the session. analyze returns original_filename; CommitIn echoes it back.
Task 12: minor (deferred): CommitIn.original_filename has no Pydantic max_length — truncated server-side only.
Task 12: minor (deferred): the pending sweep is global rather than per-user and runs on every analyze.

Task 13: complete (commits 6ad36dd..5a6cb8c, review clean, no fix round)
Task 13: note: the plan's yearly assertion was arithmetically wrong (595500 vs the 595000 its own quarter assertions sum to). Corrected in both plan and test.
Task 13: minor (deferred): no test crosses a December->January or Q4->Q1 rollover in fill_missing_buckets; the arithmetic was hand-verified correct.
Task 13: minor (deferred): defensive ValueError messages inside the pure engine are in French, unlike the rest of the non-UI code.
Task 13: minor (deferred): the `if grand_total else 0.0` guard in aggregate_by_category is dead code.

Task 14: fix round 1/5 (1 addressed, 0 open — deleting a parent category left its children's transactions with category_id NULL but category_source "manual"; commits df8b541..0bbad53)
Task 14: complete (commits 26de002..0bbad53, review clean)
Task 14: BACKEND COMPLETE. 205 tests, coverage 93% on app/engines and app/importers.
Task 14: note: GET /api/categories returns a FLAT list ordered parents-first; the frontend rebuilds the two-level tree from parent_id. Totals come from GET /api/analytics/categories.
Task 14: minor (deferred): PATCH /transactions silently ignores an explicit category_id: null — no way to clear a category.
Task 14: minor (deferred): min_cents, account_id and uncategorized_only filter branches have no dedicated test.

Task 15: fix round 1/5 (1 addressed, 0 open — light-theme status colours below WCAG AA, --yd-info had no light override; commits 53982c8..5e15112)
Task 15: complete (commits c33df84..5e15112, review clean)
Task 15: note: contrast.test.ts parses tokens.css from disk and asserts 4.5:1 for every status colour and text colour in BOTH themes. Any later palette edit must keep it green.
Task 15: note: useTheme() is NOT in task 15 — the hook belongs to ThemeProvider in task 16. theme.ts exports readStoredTheme/storeTheme/resolveTheme/formatCents/formatCompactCents.
Task 15: note: frontend uses Node 24, @types/node is a devDependency, and vitest.config.ts is excluded from tsconfig include (real nested-Vite type collision).
Task 15: minor (deferred): readStoredTheme/storeTheme swallow localStorage exceptions without logging.

Task 16: fix round 1/5 (3 addressed, 0 open — drawer animated through reduced-motion; hard-coded scrim colour; drawer untested; commits 5ef068d..de0f699)
Task 16: note: the first fix implementer hit a session limit mid-round; a fresh one verified its partial work and finished the missing drawer tests.
Task 16: complete (commits 9826411..de0f699, review clean)
Task 16: note: --yd-scrim added to tokens.css in both themes. contrast.test.ts only parses #rrggbb, so rgba() tokens are skipped without weakening it.
Task 16: note: the static sidebar always renders and is hidden by CSS only, so with the drawer open TWO navs are queryable in jsdom. Later tests must use getAllByRole.
Task 16: note: AppShell takes userName as a required prop. Task 17 wires it from the session store.

Task 17: fix round 1/5 (2 addressed + settings screen built, 0 open — refresh desynced the store; /auth/* guard untested; /reglages was a placeholder; commits 39e1594..5b01275)
Task 17: complete (commits 0e26648..5b01275, review clean)
Task 17: note: access token is in memory only; hydrate() runs before render and RequireAuth shows a loading state rather than redirecting, so a page reload keeps the session via the refresh cookie.
Task 17: note: new global state — DensityProvider (data-density, --yd-space-* tokens) and useMotionPreference (Zustand, no provider). useReducedMotion() consults both the media query and the user switch.
Task 17: note: registration open/close moved OUT of phase 1 — needs a server-side settings table, deferred to phase 3 with API-key management.
Task 17: minor (deferred): onSessionRefreshed defaults to null; if session.ts is never imported the store silently desyncs. Cannot happen in the app, dormant in api.test.ts.
Task 17: minor (deferred): concurrent 401s each fire their own refresh, no shared in-flight promise.

Task 18: fix round 1/5 (2 addressed, 0 open — commit and cancel errors rendered nowhere on the preview/done steps; commit() lacked its own stale-preview guard; commits 8aa6f34..bb6bc38)
Task 18: complete (commits 5c4c703..bb6bc38, review clean)
Task 18: note: reanalyze() is what advances mapping -> preview. canCommit requires !isPreviewStale, and commit() now re-checks it itself.
Task 18: note: category_source "builtin" shares the "Règle" badge with "rule".
Task 18: minor (deferred): DropZone, DialectPanel, PreviewTable and ImportSummary still have no tests of their own.
Task 18: minor (deferred): when the preview is stale AND validation errors exist, the stale message replaces the validation ones. Unreachable through the UI.

Task 19: fix round 1/5 (1 addressed, 0 open — handleUndo discarded its own backfill count and cleared the notice; commits dec1791..9ef6133)
Task 19: complete (commits bb6bc38..9ef6133, review clean). Frontend suite now 124 tests.
Task 19: note: usePeriod owns ?periode=&du=&au=. For non-custom presets the bounds are recomputed from today on read; du/au are decorative except in custom mode. Task 20 shares this hook.
Task 19: note: a true bulk undo is not expressible — PATCH returns only a backfilled count, never which rows. The banner says so explicitly, and no chained undo is offered because learned rules are overwritten wholesale per pattern, so undoing an undo would ping-pong.
Task 19: minor (deferred): the .yd-amount--negative class is applied but has no CSS rule; debit colour comes from an inline style.

Task 20: fix round 1/5 (3 addressed, 0 open — dashboard had no period selector; WaterfallChart hardcoded the dark palette; SpendingCalendar rebound its handler each render; commits 27572e3..13a3ca9)
Task 20: complete (commits 9ef6133..13a3ca9, review clean). Frontend suite 210 tests, FRONTEND COMPLETE.
Task 20: note: PeriodSelector is shared by FilterBar and OverviewPage. The dashboard links to /transactions carrying ?periode=&du=&au=.
Task 20: note: OverviewPage.test.tsx stubs the four chart components. Verified experimentally to be a jsdom artefact (no canvas package, getContext returns null), NOT a dispose race — the crash reproduces without any unmount. Chart.tsx cleanup is correct.
Task 20: note: the dataviz skill overrode the plan on two points — single-axis cashflow rather than dual y-axis, solid rather than dashed gridlines. Both correct.
Task 20: minor (deferred): charts expose their data non-visually through CSV export only, no in-DOM table twin.

Task 21: fix round 1/5 (2 addressed, 0 open — bind-mounted ./data shadowed the image chown so first boot could not write the database; %00 raised an uncaught 500; commits 09db015..72ddc96)
Task 21: complete (commits 13a3ca9..72ddc96, review clean). Backend suite 210 tests.
Task 21: CARRY TO TASK 22: install.sh must create ./data with a plain `mkdir -p`, any owner. The entrypoint starts as root, fixes ownership when wrong, skips the recursive chown when already 1000:1000, then drops to uid 1000 via gosu.
Task 21: UNVERIFIED — Docker is not installed on this machine. Nobody has run docker build, docker compose up, the healthcheck, or alembic inside the container. The operator must do this on first deploy.
Task 21: note: the SPA catch-all needs an explicit /api/* guard, otherwise unmatched API paths return 503 instead of a JSON 404.
Task 21: note: .dockerignore patterns need a **/ prefix — bare patterns only match at the build-context root, which would have shipped backend/.venv and frontend/node_modules (~344MB).
Task 21: note: .gitattributes pins *.sh to LF so a Windows checkout cannot break the entrypoint shebang.

Task 22: fix round 1/5 (3 addressed, 0 open — set -e could skip the recovery path leaving no service and no message; backup printed nothing; English leak; commits d64fec4..ff5ce40)
Task 22: complete (commits 72ddc96..ff5ce40, review clean). install.sh harness 14 assertions.
Task 22: note: info/ok/warn write to stderr; cmd_backup puts only the archive path on stdout.
Task 22: note: the Python port probe validates the interpreter with --version (a Windows Store shim was found) and tries connect() before bind() (a bare bind on 0.0.0.0 succeeds on Windows even when something listens on 127.0.0.1). Both are no-ops on Debian.
Task 22: UNVERIFIED — no Docker, no ss on this machine. The ss -tuln branch, the full install/update cycle, and compose down/up inside the recovery paths are all first-deploy checks.

Task 23: complete (commit ec08f42) — e2e/ onboarding journey, README.md, CLAUDE.md. Backend suite still 210 tests (95% cov), frontend suite still 210 tests, install.sh harness 14/14 — all re-run this task, none touched.
Task 23: fix round 1/5 (1 addressed, 0 open — no code anywhere POSTed to /api/accounts, so a freshly registered user could never enter the import wizard; added a "Nouveau compte" form to ImportPage's FileStep wired to the existing endpoint; commit 6563706). Frontend suite now 213 tests.
Task 23: note: bank accounts have no dedicated screen of their own — they are created inline on /import, in FileStep, either as the empty-state's only content (no accounts yet) or behind a "Nouveau compte" toggle next to the existing select (accounts already exist). AccountIn's optional fields (currency, opening_balance_cents, opened_on, include_in_net_worth) are left to backend defaults; the form only takes name + kind.
Task 23: minor (deferred): no dedicated screen lists/edits/archives existing bank accounts (rename, archive, opening balance) — only creation, from the import screen. Likely belongs with /reglages or its own /comptes route in a later phase.
Task 23: UNVERIFIED — still no Docker on this machine. Docker build/up, the container healthcheck, and the (now UI-driven) e2e journey have never been executed against a live instance.

Task 23: fix round 1/5 (1 addressed, 0 open — no UI existed to create a bank account, so the import wizard was unreachable and the app was unusable end to end; commits ec08f42..6563706)
Task 23: complete (commits ff5ce40..6563706, review clean). Frontend 213 tests.
Task 23: minor (deferred): bank accounts can only be created, from /import. No list, edit or archive screen.
ALL 23 TASKS COMPLETE. Backend 210 tests, frontend 213, install.sh 14 assertions.

FINAL REVIEW (two passes + one fix wave)
Pass 1 (journey, contract drift, isolation): one HIGH — commit_import wrote client-supplied category overrides with no ownership check, so a user could file their transaction under another user's category. Fixed in dff2f35. Journey and contract drift reported clean.
Pass 2 (money invariant, consistency, deferred set, deploy risk): money layer verified clean end to end. Two defects plus one trip-wire, all fixed in eddb5d4:
  - parser.py silently discarded the credit when a row had both debit and credit
  - the "Non catégorisé" option sent category_id 0 and got back "Catégorie introuvable"; PATCH now accepts an explicit null to clear a category
  - learning.py duplicated RULE_PRIORITIES["learned"] instead of referencing it
Final state: backend 220 tests, frontend 215 tests, install.sh 14 assertions.
STILL UNVERIFIED, first-deploy checklist in priority order:
  1. docker compose build has never run — apt (curl, gosu), pip install and npm build are all first-time on the target box
  2. entrypoint.sh chown-on-mismatch has never executed; confirm `ls -ln data/` shows uid 1000 after first up
  3. install.sh's ss -tuln branch has never run; verify the port it picks
  4. the Playwright onboarding journey has never run
