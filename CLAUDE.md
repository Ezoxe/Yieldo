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
- `get_current_user` accepts EITHER a session JWT or an agent access key
  (`app/security/agent_keys.py`). Routes that change the account's own
  credentials — the password, the email, the access key itself, and the
  provider keys in Réglages → Connexions — take `get_session_user` instead.
  A key opens the ledger; it does not open the account.

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

## The assistant's spotlight

`design/ai/targets.ts` is the list of things the assistant may point at, and
the French terms that name each one. The answer from `POST /chat` carries a
sentence and a figure — never an element id — so the link is made by matching
that sentence against this list. Two rules hold it honest: nothing is invented
(a chip appears only when its `data-ai-target` is really in the document, or
its route can be navigated to), and the list is data, so a new card means a new
line here.

A component becomes pointable by carrying `data-ai-target="…"` and nothing
else; `AISpotlightProvider` sets `data-ai-active` on the matching node.
`useSpotlightTarget(id)` is the React-owned alternative.

## The assistant's trace

`answer.steps` is what the assistant actually ran: the engines, the ledger it
read with THIS account's counts, and the route showing the same data. It comes
from `engines/answer.trace_query`, one declared branch per intent beside
`_HANDLERS`, and `test_every_intent_declares_a_trace` fails if the two tables
drift apart. `ReasoningTrace` staggers the reveal and never writes a step of
its own; it prints no duration, because the stagger is a rhythm and not a
measurement. While a question is in flight the front end says only what it can
see — one query is running — never a simulated progress report through phases
it cannot observe.

## Shared UI primitives

- Icons: `frontend/src/design/icons/`. One grid (24x24, 1.75px stroke,
  `currentColor`, Lucide geometry), named after MEANING (`AlertsIcon`, not
  `BellIcon`). **Stroke only — no `fill`, ever**: one filled shape among twenty
  wireframe glyphs reads as a rendering fault. Never an emoji, never a second
  drawing of the same concept, and never the only label on a control. The badge
  around an icon is a flat tint and a hairline, never a gradient — the glyph is
  the drawing, the container is a ground for it.
- `PageHead` (`design/PageHead.tsx`) is the head of every screen; `PanelHead`
  (`design/bento/PanelHead.tsx`) is the head of every bento panel. Both pair a
  tinted mark with real text — the mark is always `aria-hidden`.
- Content width is decided once, on `.yd-shell__main` from `--yd-page-max`. A
  screen must not declare its own `max-width`.
- Bento cells stretch to their row (`align-items: stretch`). A short panel
  shows room, not a ragged edge; pin a card's footer with `margin-top: auto`
  rather than reintroducing `align-self: start`.

## Looking at the screens

`frontend/src/dev/mockApi.ts` is a development-only fetch stub. Run the front
end and open any screen with `?apercu=1` to browse the whole application against
a canned French ledger — no backend, no database, no account. It is dropped from
production builds (dynamic import behind `import.meta.env.DEV`), and it is not a
test double: nothing asserts on it.

`.claude/launch.json` declares the two dev servers (`yieldo-backend`,
`yieldo-frontend`).

**Judge UI work in a browser before calling it done.** Phase 1's interface was
reviewed twenty-four times on the diff alone and rejected on sight.

## Design tokens

Neutral near-black ground (`#07070a`), surfaces raised off it in layers
(`--yd-surface`, `--yd-surface-strong`, `--yd-surface-raised`), hairlines in
white at 6-12% alpha, and functional accents: indigo `--yd-accent`
(interactive, strategy), emerald `--yd-positive` (gains), rose
`--yd-negative` (spending, alerts), amber `--yd-warning` (a ceiling in reach),
blue `--yd-info` (a standing condition). The light theme carries the same five
hues at their 600/700 steps.

Light and dark are both required, and every status/text pairing must hold WCAG
AA (4.5:1) against its own theme's ground — `design/contrast.test.ts` measures
it from `tokens.css` on disk, and `charts/theme.ts` must mirror any colour
change or `charts/theme.test.ts` fails.

Never write a hex in a component. Money and figures take `.yd-num`
(`tabular-nums`); a status is a pill badge, not a sentence; a methodology note
goes behind an `InfoTip`, not under the figure.

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
