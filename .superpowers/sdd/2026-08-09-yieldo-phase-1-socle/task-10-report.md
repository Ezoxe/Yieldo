# Task 10 report — Apprentissage des corrections manuelles

## What was implemented

Created `backend/app/categorization/learning.py` with:

- `STOPWORDS: frozenset[str]` — generic French bank-line words (payment verbs,
  legal-entity suffixes, prepositions/articles) that cannot form a safe rule alone.
- `extract_pattern(label_clean: str) -> str | None` — strips stopwords and pure-digit
  tokens from an already-normalized label, keeps at most 4 words, and returns `None`
  if nothing survives or the remaining core is under 3 characters. `None` is a
  deliberate refusal (not a swallowed error): a rule built from residual generic
  words would mislabel unrelated transactions.
- `learn_from_correction(db, user_id, transaction, category_id) -> CategoryRule | None`
  — derives the pattern from `transaction.label_clean`; returns `None` if no pattern.
  Otherwise looks up an existing `learned`-origin rule with the same
  `(user_id, pattern)`; if found, repoints its `category_id`/`direction` and
  increments `hit_count` (idempotent reinforcement); if not, creates one with
  `priority=200`, `origin="learned"`, `direction` derived from the transaction's
  sign (`amount_cents > 0` → `"credit"`, else `"debit"`), `hit_count=1`.
- `apply_learned_rule(db, user_id, rule, only_uncategorized=True) -> int` —
  compiles the single rule via `app.categorization.engine.compile_rules` and
  re-applies it to the user's existing transactions. When
  `only_uncategorized=True`, only touches transactions whose
  `category_source` is in `("uncategorized", "builtin", "rule", "csv")` —
  **`"builtin"` is included deliberately**, since `classify()` returns a matched
  rule's `origin` verbatim and built-in rules have `origin="builtin"`; omitting
  it from the tuple would make transactions auto-categorized by the built-in
  library permanently immune to correction by a learned rule. When
  `only_uncategorized=False`, touches anything except `category_source == "manual"`.
  In both modes, `"manual"` transactions are never touched — the user's explicit
  choice always outranks an inferred one. Matched transactions get
  `category_id = rule.category_id` and `category_source = "learned"`.

Created `backend/tests/test_learning.py` — 9 tests, transcribed verbatim from the
brief's Step 1 code block.

## Deviation from the brief, and why

The brief's Step 3 reference implementation for `STOPWORDS` includes `"du"`. That
directly contradicts the brief's own Step 1 tests:

- `test_extract_pattern_keeps_the_merchant_core` asserts
  `extract_pattern("boulangerie du coin") == "boulangerie du coin"` — i.e. "du"
  must be *kept*.
- `test_apply_learned_rule_updates_only_uncategorized_by_default` relies on the
  learned rule's pattern being a literal substring of `label_clean`
  ("boulangerie du coin"). With "du" stripped, the pattern becomes
  "boulangerie coin", which is not a substring of "boulangerie du coin"
  (the words are non-adjacent once "du" is removed), so the regex `.search()`
  never matches and `apply_learned_rule` returns 0 instead of updating the
  pending transaction.

Running the brief's implementation verbatim against the brief's own tests
confirmed both failures (`2 failed, 7 passed` — see test output below). The
fix: remove `"du"` from `STOPWORDS`, keeping every other entry (`"de"`,
`"des"`, `"le"`, `"la"`, `"les"`, `"et"`, `"au"`, `"aux"`, `"chez"`, `"pour"`,
`"par"`, `"sur"`, `"com"`, plus the payment/legal-entity words) exactly as
given. This is the minimal change: I verified by hand that no other test case
in the brief exercises `"du"` in a way that would be affected, and that the
`_MAX_PATTERN_WORDS` cap test (`"cb societe generale de distribution
alimentaire du nord est"`, expects `len(pattern.split()) <= 4`) still passes
regardless, since it only checks the word count of the truncated result, not
its exact content. No other line of the brief's reference code was changed.

## Test commands and output

Step 2 — confirm failing (module absent), from `backend/`:
```
.venv/Scripts/pytest.exe tests/test_learning.py -v
```
Result: `ModuleNotFoundError: No module named 'app.categorization.learning'`
(1 error during collection) — as expected.

After creating `learning.py` verbatim from the brief (before the STOPWORDS fix):
```
.venv/Scripts/pytest.exe tests/test_learning.py -v
```
Result: `2 failed, 7 passed` —
`test_extract_pattern_keeps_the_merchant_core` and
`test_apply_learned_rule_updates_only_uncategorized_by_default` failed, as
analyzed above.

After removing `"du"` from `STOPWORDS`:
```
.venv/Scripts/pytest.exe tests/test_learning.py -v
```
Result: `9 passed, 1 warning in 0.17s` (unrelated `StarletteDeprecationWarning`
about `httpx` already present pre-existing across the suite).

Full backend suite, from `backend/`:
```
.venv/Scripts/pytest.exe -v
```
Result: `114 passed, 26 warnings in 3.78s` — no regressions in any other
module (auth, dedup, dialect, mapping, models, parser, security, seed
categories, categorization, health, db).

Lint:
```
.venv/Scripts/python.exe -m ruff check app/categorization/learning.py tests/test_learning.py
```
Result: `All checks passed!`

(`mypy` is not installed in this venv — skipped, consistent with earlier
tasks in this repo not running a type checker.)

## Commit

```
881804b feat(categorization): learn reusable rules from manual recategorizations
```
Files staged and committed (only these two — nothing else in the working
tree was touched or added):
- `backend/app/categorization/learning.py`
- `backend/tests/test_learning.py`

## Anything later tasks need to know

- `app.categorization.learning` exposes `STOPWORDS`, `extract_pattern`,
  `learn_from_correction`, `apply_learned_rule` — importable as
  `from app.categorization.learning import ...`.
- `learn_from_correction` does **not** itself update the corrected
  transaction's `category_id`/`category_source` — it only creates/reinforces
  the `CategoryRule`. Whatever endpoint/service calls it (a future "correct
  this transaction" API handler, not part of this task) must separately set
  the transaction's own `category_id`/`category_source` (presumably to
  `"manual"`, since it's a direct user action) before or after calling
  `learn_from_correction`, and should typically follow up with
  `apply_learned_rule(db, user_id, rule, only_uncategorized=True)` to backfill
  similar pending transactions.
- `apply_learned_rule`'s `only_uncategorized` default is `True`, matching the
  interface signature in the brief (`only_uncategorized: bool` with no
  default shown in the interface line, but the Step 1 test calls it with the
  keyword explicitly and the Step 3 reference gives it a `True` default — kept
  as-is).
- The `"builtin"` inclusion in `apply_learned_rule`'s `only_uncategorized`
  filter tuple is load-bearing per the coordinating session's explicit
  instruction and is preserved exactly: `("uncategorized", "builtin", "rule",
  "csv")`.
- No Alembic migration was needed or added — `CategoryRule` already existed
  from an earlier task.

---

# Fix round 1 report

## Critical issue

Reviewer finding, confirmed correct: `extract_pattern` filtered stopwords out
of the *whole* label (a global filter-and-rejoin), discarding the position of
every surviving word. `app.categorization.engine.compile_rules` compiles a
non-regex pattern with `re.escape(...)` and matches it with `.search()` —
i.e. the pattern must be a **contiguous substring** of the label, not merely
a subsequence. Dropping a stopword from the *middle* of a label (`"restaurant
de la gare"` → `"restaurant gare"`) produces a pattern that is a subsequence
but not a substring of the source label, so the resulting rule can never
match that label again — not even the exact transaction it was learned
from. My round-1 fix ("remove `du` from `STOPWORDS`") only patched the
brief's single worked example; every other French label with an interior
connector (`de`, `des`, `le`, `chez`, ...) was still silently broken. The
round-1 diagnosis of *what* symptom "du" caused was correct; the *cause* —
global mid-string filtering losing contiguity — was not previously
identified. This came from the plan, which the coordinator has since
corrected.

## Fix

`extract_pattern` (`backend/app/categorization/learning.py`) now trims
stopwords (and pure-digit tokens) from the **edges only**, via two `while`
loops walking a `start`/`end` index pair inward, then slices
`words[start:end]` as one contiguous block (truncated to
`_MAX_PATTERN_WORDS` from the front). Because the kept core is always a
contiguous slice of the original word list, the returned pattern is
structurally guaranteed to be a substring of the label — this no longer
depends on which words happen to be in `STOPWORDS`. `"du"` was restored to
`STOPWORDS` (matching the brief exactly) since edge-trimming no longer
conflicts with `test_extract_pattern_keeps_the_merchant_core` (`"du"` sits
in the interior of `"boulangerie du coin"`, so it's preserved either way).

### Trace of all 9 pre-existing tests against the new implementation

- `test_extract_pattern_keeps_the_merchant_core`: `"boulangerie du coin"` —
  no edge stopwords (`"boulangerie"`/`"coin"` aren't in `STOPWORDS`) → core
  unchanged → `"boulangerie du coin"`. Matches. `"cb boulangerie marie"` —
  leading `"cb"` trimmed (`start=1`), trailing `"marie"` kept (`end=3`) →
  `"boulangerie marie"`. Matches.
- `test_extract_pattern_drops_generic_payment_words`: `"paiement cb
  prelevement"` — all three words are stopwords; the start-loop walks
  `start` to `3` (== `end`), so `core_words` is empty → `None`. `"vir"` —
  single stopword, `start` reaches `end=1` → `None`. Both match.
- `test_extract_pattern_rejects_too_short_a_core`: `"ab"` — not a stopword,
  not trimmed, `core = "ab"`, length 2 `< _MIN_PATTERN_LENGTH(3)` → `None`.
  Matches.
- `test_extract_pattern_caps_length_to_stay_specific_but_reusable`: `"cb
  societe generale de distribution alimentaire du nord est"` — leading `"cb"`,
  `"societe"` trimmed (`start=2`); trailing `"est"` is not a stopword so
  `end` stays at `9`; `core_words = words[2:9]` (7 words), sliced to the
  first 4 → 4 words. `len(pattern.split()) <= 4` holds. Matches (test only
  checks the count, not content).
- `test_learning_creates_a_rule_with_learned_priority`,
  `test_learning_twice_reinforces_instead_of_duplicating`,
  `test_correcting_to_a_different_category_repoints_the_rule`: all use
  `"boulangerie du coin"` — pattern is `"boulangerie du coin"` (same value
  both times a given test calls it), so origin/priority/direction and
  reinforcement/repoint behavior are unaffected. All three match.
- `test_learning_returns_none_when_no_usable_pattern`: `"cb"` → `None`,
  unaffected. Matches.
- `test_apply_learned_rule_updates_only_uncategorized_by_default`: all three
  transactions share label `"boulangerie du coin"`; pattern is the full
  label (no edge stopwords), so the regex substring match against
  `label_clean` still succeeds exactly as before. Matches.

All 9 confirmed passing empirically (see below), not just traced.

## Covering tests added (`backend/tests/test_learning.py`)

1. `test_extract_pattern_never_drops_an_interior_word` — parametrized over
   `"restaurant de la gare"`, `"boucherie des halles"`, `"cafe le select"`,
   `"pizzeria chez mario"` (each has a stopword — `de`, `des`, `le`, `chez`
   — sandwiched between two merchant words). Asserts
   `extract_pattern(label) is not None` and `pattern in label`. This is the
   substring invariant the bug violated.
2. `test_learned_rule_can_reidentify_its_own_source_transaction` — creates a
   transaction with label `"restaurant de la gare"`, calls
   `learn_from_correction`, compiles the resulting rule with
   `compile_rules`, and asserts `classify(label, transaction.amount_cents,
   compiled)` matches it with the correct `category_id`. This is the
   end-to-end regression: a learned rule must be able to reclassify the very
   transaction it learned from.

### Verifying the new tests fail against the pre-fix implementation

Before restoring the fix, I temporarily reverted
`backend/app/categorization/learning.py` to the exact content of the prior
commit (`881804b`, the round-1 global-filter version) via `git show
HEAD:backend/app/categorization/learning.py`, then ran:

```
cd backend && .venv/Scripts/pytest.exe tests/test_learning.py -v -k "interior_word or reidentify"
```

Result: `5 failed, 9 deselected` — all 4 parametrized cases of
`test_extract_pattern_never_drops_an_interior_word` and
`test_learned_rule_can_reidentify_its_own_source_transaction` failed, e.g.:

```
AssertionError: assert 'cafe select' in 'cafe le select'
AssertionError: assert 'pizzeria mario' in 'pizzeria chez mario'
assert None is not None   # classify() found no match for the learned rule
```

This confirms the new tests actually exercise the reported bug rather than
being vacuously true. I then restored the fixed `extract_pattern`
(edge-trimming version) and re-ran.

## Full test run after the fix

```
cd backend && .venv/Scripts/pytest.exe tests/ -v
```

Result: `119 passed, 26 warnings in 3.78s` (114 previously-passing tests +
5 new: 4 parametrized `test_extract_pattern_never_drops_an_interior_word`
cases + `test_learned_rule_can_reidentify_its_own_source_transaction`). No
regressions anywhere else in the suite.

Lint:
```
cd backend && .venv/Scripts/python.exe -m ruff check app/categorization/learning.py tests/test_learning.py
```
Result: `All checks passed!`

## Commit

```
ed96672 fix(categorization): trim stopwords from label edges only, not the middle
```
Files staged and committed (only these two):
- `backend/app/categorization/learning.py`
- `backend/tests/test_learning.py`

(`docs/superpowers/plans/2026-08-09-yieldo-phase-1-socle.md` was modified by
the coordinating session, not by me, and was deliberately left unstaged per
the staging-discipline instruction.)

## Deferred per coordinator instruction — not touched

- The `amount_cents == 0` direction case in `learn_from_correction` (currently
  falls into `"debit"` since the check is `amount_cents > 0`).
- `_LEARNED_PRIORITY = 200` duplicating `RULE_PRIORITIES["learned"]` from
  `app/models/rule.py`.

Both are Minor and explicitly out of scope for this fix round.
