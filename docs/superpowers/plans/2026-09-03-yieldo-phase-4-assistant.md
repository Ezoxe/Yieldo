# Yieldo Phase 4 — Assistant : Implementation Plan

Design §8 and §12 phase 4: a deterministic chat, a filterable context export,
an optional LLM, PDF reports, alerts and notifications.

*Critère de réussite : l'utilisateur pose une question en français et obtient
une réponse exacte, ou exporte un contexte sur mesure vers l'IA de son choix.*

## Global constraints

Inherited whole from phases 2 and 3, non-negotiable:

- Integer cents on every monetary field, at every layer. `Decimal` interior
  only, through `engines/amortization.cents`. Rates as integer basis points.
  A quantity is not money: a `Decimal` at a fixed scale, carried as a string.
- Pure engines: no session, no network, no implicit clock — `today` is a
  parameter. Anything touching HTTP lives outside `engines/`.
- Every query on a business table filters `user_id` via `get_current_user`.
- No silent failures, no bare `except`, no fallback value standing in for real
  data. Every refusal names its own cause and its own remedy.
- French user-facing text; English code, identifiers, comments and commits.
- TDD, one commit per task, Conventional Commits.
- UI tasks are not done until opened in a browser at 375, 768 and 1440 px, in
  both themes, against the seeded fixture, with screenshots attached.

### The contract that governs this whole phase

**The model never calculates.** The deterministic engines produce every figure;
a language model may only comment on figures it was handed. A number shown to
the operator always comes from an engine — never from a completion, never
reformatted by one, never inferred by one.

Disabled, the application stays fully functional. No key ships with the code,
no key is logged, echoed in a response, or written to a report.

**The assistant never invents an answer.** When an intent is not recognised it
says so and offers the formulations it does understand. A plausible-looking
answer to a question it did not parse is the worst failure available to it.

### The defect classes this project keeps paying for

1. **A French sentence naming the wrong cause** — fixed in seventeen tasks.
2. **An invariant that holds by construction proves nothing.**
3. **A test that passes for the wrong reason.** A fixture of identical values
   cannot tell a median from a mean; one intent phrasing cannot tell a parser
   from a hardcoded answer.
4. **`None` is never a fallback.**
5. **A screen only tested on a healthy fixture.** The operator has 197
   transactions over 3 complete months, a savings capacity of **−746,19 €/month**,
   a **−2 209,63 €** balance, zero positions and no API key. Every screen in
   this phase must be at its best in exactly that state.

## Scope

Ten tasks in four lots. Nothing here requires a key or a network to run or to
test; the LLM path is exercised against recorded responses and one opt-in live
test that skips when unconfigured.

## Task order

### Lot A — the deterministic chat

- **Task 1: Intent parsing** — `engines/intent.py`, pure.
  French in, a structured query out: period, category, amount, horizon,
  entity. Covers the intents design §8.1 lists — totals and averages by period
  and category, period comparisons, the evolution of one line, purchase
  feasibility, a savings simulation, a goal's state, subscription cost,
  transaction search, patrimoine projection.
  **An unrecognised intent is a first-class answer**, carrying the formulations
  the parser does understand — never a guess, never the nearest match.
  Accents, elisions and French date forms ("l'an dernier", "en mars",
  "depuis janvier") are the input, not an edge case.

- **Task 2: Query execution** — `engines/answer.py`, pure.
  Maps a parsed intent onto the engines already shipped and returns the figure
  with **the query that produced it, in clear French** — design §8.1 requires
  the user to be able to check what was computed. An engine refusal travels
  through unchanged; the assistant never softens or rephrases it.

- **Task 3: `/api/chat`** — parse, execute, answer, with the chart the answer
  deserves. Isolation on every query. History stored per user, and a stored
  question is re-executed rather than replayed from a cached answer, for the
  reason phase 2B recorded on scenarios: a figure measured last winter must
  not read as current.

- **Task 4: `/assistant`** — the screen. The conversation, the executed query
  shown in clear beside each answer, and the chart. The unrecognised-intent
  state is a designed state, not an error banner.

### Lot B — context export

- **Task 5: The export builder** — `engines/context_export.py`, pure.
  Scope selection: period, accounts, categories, granularity (annual, monthly,
  per transaction), modules, optional anonymisation (relative amounts, masked
  merchants). Produces structured Markdown, plus a token estimate and a warning
  when the volume passes a target model's context window.
  **"Dépenses 2025 et 2026 seulement" must actually exclude 2024** — the filter
  is the feature, and a test proves each dimension excludes what it claims to.

- **Task 6: `/api/export` and the templates** — the five ready-made templates
  design §8.2 names (bilan annuel, faisabilité d'achat, revue de portefeuille,
  optimisation fiscale, diagnostic budgétaire), each pre-selecting its scope
  and carrying the question to ask the model. Download as `.md`, `.txt`,
  `.json`.

- **Task 7: `/export`** — the screen. Scope panel, live token estimate, the
  templates, copy in one click, download in three formats.

### Lot C — the optional model

- **Task 8: The LLM client and `/api/assistant/llm`** — `llm/client.py`.
  An OpenAI-compatible endpoint URL and a model name, entered in Réglages.
  Ollama, LM Studio, llama.cpp, vLLM locally; Gemini, Claude, OpenAI online
  with a key. The key is encrypted at rest like every other, and never leaves
  the server.
  **The model receives figures and returns prose.** It is handed the
  deterministic answer and asked to comment; anything numeric in its reply is
  ignored for display, and the figures rendered come from the engine. A
  disabled or unreachable model degrades to the deterministic answer alone,
  saying so.

### Lot D — reports and alerts

- **Task 9: PDF reports** — `reports/`. Rendered server-side from the same
  engines, with every assumption printed beside the result it produced. No
  figure in a report may come from anywhere but an engine.

- **Task 10: Alerts and notifications** — `engines/alert.py` plus the API and
  the screen. Conditions measured from the ledger: a projected balance below a
  threshold, a subscription price rise, a budget crossed, an anomaly, an
  expected debit that did not arrive. Each alert names what was measured, over
  what period, and what would clear it. No alert fires on data that was not
  measured.
