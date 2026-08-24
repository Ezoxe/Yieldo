# Task 1 report: Robust statistics primitives

## Status: DONE

## What was implemented

- `backend/app/engines/robust.py` — pure module (no session, no network, no
  clock) providing the median/MAD primitives every phase 2A feature (budgets,
  récurrences, prévision de trésorerie, runway, inflation personnelle,
  détection d'anomalies) will build on:
  - `Spread` frozen dataclass: `median`, `mad`, `mean_ad`, `sigma`, `count`,
    all `int` cents (`sigma` is the MAD-derived normal-equivalent scale).
  - `median_cents(values: list[int]) -> int` — median of integer cents,
    half-away-from-zero rounding on even samples, raises `ValueError` on an
    empty list.
  - `describe(values: list[int]) -> Spread` — median, MAD, mean absolute
    deviation, and a normal-equivalent `sigma` (MAD-derived, falling back to
    mean-AD-derived when MAD is zero, and to 0 when the sample never moves).
    Raises `ValueError` on an empty list.
  - `modified_z(value: int, spread: Spread) -> float | None` — Iglewicz &
    Hoaglin's modified z-score; MAD-based primary form, mean-AD-based
    documented fallback when MAD is zero, `None` (never a manufactured 0 or
    NaN) when the sample has no dispersion at all.
  - `quantile_offset_cents(sigma: int, sigmas: float = P90_SIGMAS) -> int` —
    half-width in cents of a `sigmas`-wide band around the median.
  - Constants exactly as pinned in the brief: `OUTLIER_Z = 3.5`,
    `P90_SIGMAS = 1.281552`, `MAD_TO_SIGMA = 1.4826`,
    `MEAN_AD_TO_SIGMA = 1.2533`, `MODIFIED_Z_MAD_CONSTANT = 0.6745`,
    `MODIFIED_Z_MEAN_AD_CONSTANT = 1.253314`, each documented with its
    published source (Iglewicz & Hoaglin 1993; standard MAD/mean-AD
    consistency factors; standard normal 90th percentile).
- `backend/tests/test_robust.py` — the brief's 9 test cases verbatim, plus
  one I added during self-review (`test_describe_of_an_empty_sample_is_an_error_not_a_zero`)
  to cover `describe([])` raising `ValueError`, which the interface section
  promises but the brief's own test list only exercised via `median_cents([])`.

Implementation code matches the brief's Step 3 exactly — no invented
alternatives, no threshold changes.

## TDD evidence

**1. Failing test first** (`backend/` as cwd):

```
.venv/Scripts/pytest.exe tests/test_robust.py -v
```

Result: collection error, as expected before the module existed —

```
ImportError while importing test module 'tests/test_robust.py'.
tests\test_robust.py:3: in <module>
    from app.engines.robust import (
E   ModuleNotFoundError: No module named 'app.engines.robust'
1 error in 0.26s
```

This is the expected failure: the test imports a module that does not exist
yet. It fails for the right reason (missing implementation), not a typo or
fixture problem.

**2. Implementation written**, then:

```
.venv/Scripts/pytest.exe tests/test_robust.py -v
```

Result: `9 passed, 1 warning in 0.04s` — all brief test cases green, including
the odd/even median rounding-direction cases, the outlier-does-not-move-the-
median case, the MAD-zero fallback to mean-AD, and the no-dispersion `None`
case.

**3. Full backend suite**:

```
.venv/Scripts/pytest.exe -v --cov=app --cov-report=term-missing
```

Result before adding the 10th (empty-`describe`) test: `271 passed` (262
pre-existing + 9 new), matching the brief's Step 5 expectation exactly.
`app/engines/robust.py` coverage was 98% (1 line missed: the `describe([])`
raise).

After adding `test_describe_of_an_empty_sample_is_an_error_not_a_zero`:

```
=============================== tests coverage ================================
Name                             Stmts   Miss  Cover   Missing
--------------------------------------------------------------
app\engines\robust.py               50      0   100%
--------------------------------------------------------------
TOTAL                             1739     88    95%
===================== 272 passed, 168 warnings in 20.21s ======================
```

272 passed, 0 failed, `app/engines/robust.py` at 100% coverage. No test in
the repo was broken by this change (pre-existing 262 tests still pass
unchanged).

**4. Lint**: `.venv/Scripts/ruff.exe check app/engines/robust.py
tests/test_robust.py` → `All checks passed!` (project's configured rule set:
E, F, I, UP, B, SIM).

## Files changed

- `backend/app/engines/robust.py` (new, 125 lines)
- `backend/tests/test_robust.py` (new, 86 lines, 10 tests)

## Commit

`3c96e50` — `feat(engines): add robust median and MAD primitives in integer cents`

Staged and committed only these two files; a pre-existing untracked plan doc
(`docs/superpowers/plans/2026-08-16-yieldo-phase-2a-analyse.md`, present
before this task started) was left untouched and out of the commit.

## Self-review

- **Completeness against the brief**: every symbol in the "Produces" list is
  present with the exact signature and constant values pinned in the brief.
  Nothing extra was added to the public surface.
- **Naming/shape**: follows `app/engines/aggregate.py` and `period.py`
  conventions — module docstring explaining the *why*, frozen dataclass for
  the output, small top-level functions, leading-underscore private helpers
  (`_half`, `_mean_absolute`), French only in the user-facing `ValueError`
  messages (consistent with `period.py`'s `"Granularité inconnue"` pattern).
- **YAGNI**: no functions beyond what the brief and its stated consumers
  (tasks 4, 7, 10, 11, 15, 16) need. No premature generalization (e.g. no
  configurable rounding mode, no batch/vectorized variant) — those can be
  added when a consumer actually needs them.
- **Money rule**: every cents-denominated field (`median`, `mad`, `mean_ad`,
  `sigma`, the `quantile_offset_cents` return) is `int`. `modified_z`
  legitimately returns `float`/`None` because a z-score is a dimensionless
  statistic, not a monetary amount — consistent with the CLAUDE.md rule's
  actual scope.
- **No silent failures**: both `median_cents` and `describe` raise
  `ValueError` on empty input rather than returning 0; `modified_z` returns
  `None` (not 0.0, not NaN) when there is genuinely no scale to measure
  against, and its docstring tells callers to treat `None` as "cannot say."
- **Test quality**: the `describe()` example test
  (`test_describe_reports_median_mad_and_a_normal_equivalent_scale`)
  hand-computes the expected MAD from the deviation list in a comment rather
  than re-deriving it via the same formula under test, so it's a real
  independent check, not a restatement of the implementation. The
  outlier/fallback/no-dispersion tests each isolate one specific branch
  (MAD path, mean-AD fallback path, `None` path) with inputs chosen to make
  that branch unambiguous. I added one test the brief's own test list missed
  (`describe([])` raising) to close the coverage gap it left in the
  interface it documents.
- **Gap found and closed during self-review**: the brief's Step 2/4/5 test
  counts (9 → 271) don't include a test for `describe([])`, even though the
  "Produces" interface section explicitly states `describe` "raises
  ValueError on an empty list." I added the missing test rather than leaving
  that documented behavior unverified. This is the only deviation from the
  brief's literal step list; the constants, formulas, and all nine specified
  tests are otherwise verbatim.

## Concerns

None. No arbitrary values were introduced, the money/date/isolation/pure-
engine/no-silent-failure rules from `CLAUDE.md` all hold, and the module is
fully covered.
