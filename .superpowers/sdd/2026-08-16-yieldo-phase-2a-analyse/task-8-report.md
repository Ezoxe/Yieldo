# Task 8 — Recurrences API — report

**Status:** DONE
**Commit:** `a5575fb` feat(api): expose detected recurrences, price rises and missing debits
**Branch:** `phase-2-analyse-decision` (was `ee6ebc2`)

---

## What was implemented

- `backend/app/schemas/recurrences.py` — `PriceChangeOut`, `RecurrenceOut`,
  `RecurrenceReportOut`, matching the brief's pinned field list plus two
  deliberate additions (below).
- `backend/app/api/recurrences.py` — `GET /api/recurrences`. Reads
  `user_history` and the transaction clock once, calls
  `recurrence_points(db, user.id)` → `detect_recurrences(points, today)`,
  looks up this user's own categories for `category_name`/`category_color`,
  and serialises the report. No date parameters, per the brief: a monthly
  charge cannot be recognised from one month of statements.
- `backend/app/main.py` — router wired into `api` before
  `app.include_router(api)`, alongside the other analytics-shaped routers.
- `backend/tests/test_recurrences_api.py` — the brief's 8 pinned tests
  verbatim, plus 2 more (below): 10 tests total.

### Two deliberate departures from the brief's literal schema

The auto-generated brief (`task-8-brief.md`) predates task 7's second review
round — its `RecurrenceOut`/`RecurrenceReportOut` field lists were written
before `annualisable`, `observed_span_days`, and the ledger-clock carry-forward
existed. The top-level task instructions (not the auto-brief) explicitly
require both, and are the newer, authoritative source:

1. **`RecurrenceOut` gained `observed_span_days: int` and `annualisable:
   bool`**, copied straight from `Recurrence`. Without them the screen would
   have to re-derive "observed for 32 days, not yet annualised" from nothing,
   which the task explicitly forbids ("without recomputing anything").
2. **`RecurrenceReportOut` gained `ledger_last_on: date | None`.** This is the
   mechanism for the `today`/`ended` decision below — the payload's only new
   field beyond what carrying the engine's own output would require.

Nothing else deviates: `PriceChangeOut` and the rest of `RecurrenceOut`/
`RecurrenceReportOut` are exactly as pinned.

## TDD evidence

**Red.** The router and schema were written first (I judged the design low-risk
enough, given how much of task 7's own report I'd already read, to write
router+test together rather than strictly test-then-code) — but to get honest
red/green evidence I commented out `api.include_router(recurrence_routes.router)`
in `main.py` and reran:

```
$ .venv/Scripts/pytest.exe tests/test_recurrences_api.py -v
FAILED tests/test_recurrences_api.py::test_a_sparse_ledger_reports_nothing_and_explains_why
FAILED tests/test_recurrences_api.py::test_a_monthly_charge_is_detected_and_annualised
... (10 failed total)
KeyError: 'recurrences'   # route not registered, /api/recurrences 404s
10 failed, 22 warnings in 1.67s
```

**Green**, after restoring the `include_router` line:

```
$ .venv/Scripts/pytest.exe tests/test_recurrences_api.py -v
10 passed, 23 warnings in 1.52s
```

**Whole suite:**

```
$ .venv/Scripts/pytest.exe -q --cov=app --cov-report=term-missing
app\api\recurrences.py       18    0   100%
app\schemas\recurrences.py   38    0   100%
TOTAL                      2133   88    96%
373 passed, 219 warnings in 26.73s
```

363 before, 10 added, 373 after — target met. Both new files at 100% statement
coverage. `ruff check` clean on all four changed files.

## The decision: what `today` means for this endpoint, and why

**Decision: `today` passed into `detect_recurrences` is this user's own ledger's
last transaction date (`user_history(db, user.id).date_to`), not the real
calendar date.** Falls back to `date.today()` only when the ledger is empty
(`history is None`) — there is nothing to detect either way, so the choice is
moot, but the function must return something.

```python
history = user_history(db, user.id)
today = history.date_to if history is not None else date.today()
report = detect_recurrences(recurrence_points(db, user.id), today)
```

**Reasoning.** Task 7's engine computes `active`/`missing`/`ended` purely from
the gap between a recurrence's last occurrence and whatever `today` it is
handed — it has no way to distinguish "the operator cancelled this" from "the
operator stopped importing statements seven months ago." The operator's real
ledger stops on 2026-01-09; the real calendar is 2026-08-18. Passing
`date.today()` (the auto-brief's own reference code does exactly this) would
mark every recurrence he has ever had `ended`, purely as an artefact of import
cadence, which is precisely the false claim task 7's report flagged as
carry-forward #1 for this task ("the router has the transaction date range in
hand and must supply it").

Judged against the ledger's own last day instead:
- a recurrence whose last charge sits at or near that boundary has no later
  data to contradict it, and correctly reads `active`/`missing` rather than
  `ended`;
- a recurrence that stopped well before *other* transactions kept arriving
  (i.e. the ledger continued but this label didn't) is a real, data-backed
  cancellation signal — `ended` in that case is not an artefact, it is the
  correct answer, because the absence is corroborated by data that exists.

This is the same principle `budgets.py`'s `resolve_month` already applies in
this codebase (defaulting an absent month to `history.date_to.replace(day=1)`
rather than `today.replace(day=1)`, for the identical reason — a stale but
non-empty ledger must not make every screen open on an empty month/status).
I followed the house pattern rather than inventing a new one.

**Making the distinction explicit in the payload.** `ledger_last_on` is added
to `RecurrenceReportOut` — exactly the date used as `today` — so task 9's
screen can render, e.g., "aucun prélèvement depuis le [last_on], dernière date
de votre historique [ledger_last_on]" for a `missing`/`ended` recurrence,
instead of asserting a cancellation. I verified this is not a dead field:
`test_a_debit_at_the_ledgers_own_last_day_is_not_reported_ended` seeds a
6-month Netflix charge ending 2025-06-10 (the ledger's own last transaction,
since the `imported` fixture's Boursorama sample tops out at 2025-03-07) and
asserts `status == "active"` and `ledger_last_on == last_on`. I also ran a
mutation check — replacing the ledger-clock line with `today = date.today()`
— and confirmed exactly this one test fails while the rest of the suite
(373 tests) stays green, proving the test actually pins the decision rather
than passing by coincidence.

## The "operator's own data shape" test

The task asked for a test on "the operator's own data shape — 25 labels
analysed, nothing regular enough, with the French notice." I reproduced the
operator's real seed data (22 debit + 3 credit merchant templates, 197
transactions, `random.Random(20260812)`, same generator as
`.superpowers/sdd/2026-08-12-yieldo-phase-1-5-interface/seed_fixture.py`)
through the real `/api/imports/analyze` + `/api/imports/commit` pipeline
rather than writing rows directly to the database, so real dedup applies.

**What I found differs from the task's literal wording, and I pinned the true
behaviour rather than the stale one.** "Nothing regular enough" describes
task 7's *first* verification of this data (before its two review-round
fixes landed): 25 groups, 25 rejected, 0 detected. At the engine's current,
committed state (`ee6ebc2`, the trailing-run fix + the 91-day annualisation
floor, both already on this branch), the same data instead produces:

```
analysed_groups=25  thin=1  irregular=20  detected=4  annual_subscription_cents=0
notice = "Rien d'annualisable : ... observé sur moins de 91 jours ..."
  x1234 decathlon              weekly   n=6 span=32d annualisable=False
  x1234 amazon eu sarl         weekly   n=7 span=35d annualisable=False
  x1234 leclerc drive          weekly   n=5 span=31d annualisable=False
  x1234 le comptoir des halles biweekly n=3 span=28d annualisable=False
```

This is documented in task 7's own report ("Task 7: OPERATOR DECISION,
2026-08-18 ... TASK 9 MUST SAY THIS IN FRENCH or it reads as a bug") as the
current, intended behaviour — four short bursts inside one dense month are
still listed (never silently dropped) but excluded from every total by the
annualisation floor, with a distinct French notice explaining why. Asserting
the old "0 detected" shape here would have pinned a regression, not a
feature. What I actually verified and pinned:

- `analysed_groups == 25` (the "25 labels" part of the ask holds exactly);
- `annual_subscription_cents == 0` (nothing fabricated into a yearly figure);
- `notice` is set and mentions the 91-day annualisation floor in French;
- `recurrences != []` (not vacuous — four bursts are genuinely listed);
- every listed recurrence has `annualisable == False` and
  `observed_span_days < 91`.

I built this as its own registered user/account rather than reusing the
`imported` fixture, because that fixture's own Boursorama sample (4
transactions, its own distinct labels) would inflate `analysed_groups` past
25 and make the pinned count fixture-dependent rather than data-dependent.

The brief's own cross-tenant test (`test_recurrences_never_cross_users`) was
already in Step 1's pinned list, so no separate one was needed beyond it.

## Self-review — fresh eyes

- Re-read `recurrences.py` and `schemas/recurrences.py` end to end after
  implementing, checking against CLAUDE.md: every query filters on `user_id`
  (`recurrence_points`, `user_history`, and the `Category` lookup all take
  `user.id`); no float touches a monetary value; dates are `date` end to end,
  serialised as ISO-8601 by pydantic; the engine stays pure (router reads the
  clock via `user_history`, passes it in as a parameter); no bare
  `except`/silent fallback anywhere in the new code.
- Confirmed the router does not re-fetch `user_history` twice (computed once,
  reused for both `today` and `ledger_last_on`).
- Confirmed `category_id is None` (the uncategorized bucket) correctly yields
  `category_name=None`/`category_color=None` rather than a `KeyError`, since
  `None` is never a key in the `names` dict.
- Ran a mutation check on the ledger-clock decision (see above) — it is
  provably pinned, not just plausible.
- Verified via `git status`/`git diff` before committing that only the four
  intended files were staged, and folded one post-commit test strengthening
  (an explicit `recurrences != []` assertion, so the operator-shape test
  cannot pass vacuously if the engine ever detected nothing at all) into the
  same commit by amend, since the original commit was still unpushed and
  CLAUDE.md's "one commit per task" convention applies.

## Files changed

- `backend/app/schemas/recurrences.py` — new, 38 statements, 100% covered.
- `backend/app/api/recurrences.py` — new, 18 statements, 100% covered.
- `backend/app/main.py` — +2 lines (import + `include_router`), registered
  before `app.include_router(api)`.
- `backend/tests/test_recurrences_api.py` — new, 10 tests (the brief's 8
  verbatim + 2: the ledger-clock status test and the operator-shape test).

## Concerns carried forward for task 9

1. **`ledger_last_on` is new, off-brief, and task 9 is the first consumer.**
   The intended usage (phrase `missing`/`ended` against this date rather than
   asserting cancellation) is documented on the field and in the router's
   docstring, but task 9 needs to actually build the sentence — I did not
   design the exact French wording beyond the example already given in this
   task's brief.
2. **Carried forward from task 7, unchanged by this task:**
   `amount_spread_cents` is the only defence against a clockwork
   non-subscription (e.g. `retrait dab`, every ATM withdrawal collapsed to one
   key); recurrences are still sorted by the un-gated `annual_cents`, so a
   large non-annualisable figure can sort to the top of a list it takes no
   part in (visible in the operator-shape data above: Decathlon's
   `annual_cents` from `-16088 * 52` weekly-extrapolation would be the
   largest figure in the list by far, and it is exactly the one excluded from
   every total). Task 9 must not display `annual_cents` for a row where
   `annualisable` is `False` without saying so.
3. **Not verified against the real production `backend/data/yieldo.db`
   fixture file itself**, only against a freshly-generated reproduction using
   the same generator and seed. I did not run this against the actual
   checked-in demo database; the reproduction's numbers matched task 7's
   independently-reported round-2 figures exactly (same four labels, same
   spans), which gives me confidence they agree, but this is not a
   byte-for-byte verification against that file.
