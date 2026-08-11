# CLAUDE.md

Working contract for this repository. Short and factual — read it before
touching code.

## Money and dates

- Every monetary amount is an integer number of cents (`amount_cents: int`).
  Never a `float` on a monetary value, at any layer. Convert to `Decimal`
  only at the display boundary.
- Dates are `datetime.date` in the database, ISO-8601 (`YYYY-MM-DD`) in JSON.

## Isolation

- Every query on a business table filters on `user_id`, via the
  `get_current_user` dependency. No route reads across users.

## Pure engines

- `backend/app/engines/` and `backend/app/importers/{dialect,mapping,parser,dedup}.py`
  are pure functions: no DB session, no network call, no implicit clock —
  "today" is always a parameter.
- The one explicit exception: `backend/app/importers/service.py` and
  `backend/app/categorization/{seed,learning}.py` are orchestration layers
  that take a `Session`. They carry no calculation logic of their own — they
  assemble pure functions and persist the result.

## No silent failures

- No bare `except: pass`. No fallback value standing in for real data.
  Errors surface to the user (in French, see below) or propagate.

## Language

- User-facing text and error messages: French.
- Code, identifiers, comments, and commit messages: English.
- Repository documentation for the operator (README.md, troubleshooting):
  French, since the operator is a French speaker. This file is for coding
  sessions, not the operator, and stays English.

## Column tagging is user-driven

- CSV dialect detection and column-role suggestion (`backend/app/importers/dialect.py`,
  `mapping.py`) only ever *propose*. Nothing is imported until the user has
  seen and confirmed the mapping on screen, and any change to it invalidates
  the preview until the analysis is re-run. Never auto-commit a suggestion.

## Design tokens (Abysse)

Accent `#7ee2d6`, positive `#4fd6a8`, info `#3b82f6`, warning `#f4a261`,
negative `#e5606b`. Light and dark themes both required; every status/text
colour pairing must hold WCAG AA (4.5:1) in both.

## Testing

- TDD: write the failing test first.
- Backend: `backend/.venv/Scripts/pytest.exe -v --cov=app --cov-report=term-missing`
  from `backend/`. Target ≥80% coverage on `app/engines` and `app/importers`.
- Frontend: `npm test` from `frontend/`. `npm run build` must produce zero
  TypeScript errors.
- `install.sh`: `bash tests/install/test_find_port.sh` exercises the
  Docker-free parts (port probing, secret generation, backup/restore) without
  needing a Docker daemon.
- End-to-end: `cd e2e && npx playwright test`, against a running instance.
  Requires Docker; see README.md's "Premier déploiement" section for what has
  and has not actually been run yet.

## Commits

- One commit per task. Conventional Commits format, English.

## Runtime minimums

Python 3.12+, Node 22+.

## Where to look first

- `docs/superpowers/specs/2026-08-09-yieldo-design.md` — product design and
  phase roadmap.
- `docs/superpowers/plans/2026-08-09-yieldo-phase-1-socle.md` — phase 1
  implementation plan, task by task.
- `.superpowers/sdd/2026-08-09-yieldo-phase-1-socle/progress.md` — the ledger
  of what each task actually shipped, deferred defects, and carry-forward
  notes for later tasks. Read it before assuming a past task's behavior.
