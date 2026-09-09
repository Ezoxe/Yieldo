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

## One box per question

The Transactions screen has ONE search field, and `search` on
`GET /transactions` is a single OR over the label (raw AND normalised -- the
normaliser eats digits and dates, so the raw label is the only place a
statement fragment survives), the amount, the category name, the account name
and the date. Reading the raw text is `engines/search.parse_query`, pure: a
number is an amount only when the WHOLE query is that number, a date only when
the whole query is that date, and everything else stays text. The category
combobox that used to sit beside the box is gone; a select and two switches
are not searches and never looked like one.

The header holds the same idea for the whole application. `GET /search` is
read-only, filtered on `user_id` like every other route, and answers with
GROUPS -- transactions, comptes, catégories, récurrences, objectifs, dettes --
every group present even when empty, so the screen can say what it looked in.
Beside them the dialog lists SCREENS, matched client-side against
`app/navigation.ts`: that module is the one list both the sidebar and the
search read, and its `aliases` are the French words a household reaches for
("abonnements" finds Récurrences). Data, like `design/ai/targets.ts` -- a new
screen is a new line there, not a new branch.

Two rules on that route. Every figure it returns carries a word naming it
(« Capital restant dû », « Solde d'ouverture ») except a transaction's own
amount, which sits under its label and date; a category returns no figure at
all, because a monthly budget printed under a search hit reads as what you
spent. And a failure is printed: the screens stay listed and the cause is named
beside them, never a « rien trouvé » that was really a network error.

A transaction hit lands on `/transactions?q=<libellé>`. The `q` is a HANDOFF,
not a mirror: the screen applies it, remounts its box with it, and takes it
back out of the URL -- a URL still claiming `?q=A` after the reader has typed
B would be a lie about the list under it.

## The reading lives in Réglages

`LedgerModeControl` sits in Réglages → Lecture des chiffres. What stays in the
header is `LedgerModeBadge`, and only when the mode is not « Réel »: a figure
mixing a relevé with a declaration and not saying so is a lie told in the right
font, but a permanent badge reading "Réel" is noise eleven months out of twelve.
`AppShell` still keys its `Outlet` on the mode, so changing it still refetches
every screen.

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

## When the parser gives up

A question `engines/intent` does not recognise is still answered by Yieldo'''s
own refusal — unless the household has configured a model in Réglages →
Connexions, in which case `api/chat.ask` hands the question to
`llm/agent.run_agent(read_only=True)`.

Four rules, and `tests/test_chat_llm_fallback.py` holds all four:

- **Reads only.** The model is offered `llm/tools.READ_TOOLS` and nothing else,
  so a sentence typed into a chat box can never leave a proposal behind. A
  write tool named anyway is answered, not run.
- **The model never calculates.** Every figure it cites came back from a tool,
  which called an engine. `amount_cents` stays null on a model answer: no
  number the model wrote reaches a field a screen renders as a measurement.
- **It is labelled.** `answered_by` travels to the wire and `AnswerProvenance`
  prints it. « Yieldo a mesuré ceci » and « votre modèle a écrit ceci » are two
  different claims.
- **It runs once.** The run is persisted and `ChatMessage.agent_run_id` points
  at it — the one thing about a chat message that is not re-executed on read,
  because a completion per message per page load would be both slow and
  non-deterministic. A GET never calls a model.

A model that fails leaves the parser'''s refusal standing with the cause named
beside it, never a silent degradation.

## The shibi

`design/shibi/sprite.ts` is the mascot: a small impersonal cube drawn pixel by
pixel on a 32x32 grid, and the visible face of the assistant. The module is
pure — given a state and a frame it returns 1024 colours — and `Shibi.tsx` is
the only thing that owns a canvas and a clock.

Four rules hold it together, and `design/shibi/sprite.test.ts` enforces the
first two:

- **A closed palette.** Thirteen named colours plus three brightness steps per
  diode hue. A frame that blended a new colour would still land on the grid and
  would still be wrong.
- **Whole pixels, whole scales.** Every coordinate is an integer on the grid,
  and `Shibi` rounds `scale` to a whole number. At 1.5x half the pixels are two
  device pixels wide and half are three.
- **He never says more than the assistant knows.** No mouth and no eyebrows:
  the state is carried by the diode's hue and the shape of two square eyes. The
  six states each carry a `note` saying which real situation they stand for,
  and that note is the contract.
- **He is a replay, not a progress report.** On the reasoning trace he walks
  from tool to tool — but `answer.steps` arrives whole with the answer, so
  everything he points at has already run. The only place he is live is
  `ThinkingIndicator`, where a request really is out.

He appears in the header and in the assistant drawer's head (in place of the
assistant's glyph in both), on the assistant's ask form, on the trace, and on
the landing page — where `ShibiShowcase` cycles his six states beside a
FABRICATED trace that says so in its caption, the way the dashboard preview
above it does. Réglages -> Apparence turns him off, and
`/reglages/shibi` is his model sheet — a screen rather than a document, because
it reads `sprite.ts` at run time and so cannot describe a character the
application no longer draws.

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
