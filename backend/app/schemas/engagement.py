"""Wire shapes for /api/engagement.

Milestones reuse `schemas.goals.GoalProgressOut`/`MilestoneOut` verbatim, per
the plan's own instruction: "Milestone already ships from phase 2B task 7
(`engines/goal.py`) and is consumed **exactly as built**." Nothing here
redeclares that shape.
"""

from datetime import date

from pydantic import BaseModel

from app.schemas.goals import GoalProgressOut


class MonthCoveredOut(BaseModel):
    key: str
    covered: bool
    transaction_count: int
    imported: bool


class StreakOut(BaseModel):
    current: int
    longest: int
    last_complete_month: str | None
    months: list[MonthCoveredOut]
    # French. Set exactly when `current == 0`.
    broken_reason: str | None


class HealthComponentOut(BaseModel):
    key: str
    label: str
    weight: int
    score: int | None
    measured_value: float | None
    unavailable_reason: str | None
    # This component's score today minus the same component's score on the
    # previous STORED snapshot (never a recomputation at another date -- see
    # `HealthOut`'s own docstring). `None` when there is no previous snapshot,
    # or when either side could not be measured: a delta between one real
    # score and one absence is not a number, and printing one anyway would be
    # exactly the "None as a fallback" failure CLAUDE.md rules out.
    delta_score: int | None


class HealthSnapshotOut(BaseModel):
    """One stored day's score, for the history chart. Ascending by date."""

    taken_on: date
    score: int


class HealthOut(BaseModel):
    score: int | None
    components: list[HealthComponentOut]
    unavailable_reason: str | None
    # The most recent STORED snapshot strictly before today, or null when none
    # exists yet (the household's first day, or its first day with a
    # measurable score). "Ce qui l'a fait bouger" is this date's own row,
    # never a recomputation of today's inputs pretending to be that date.
    previous_taken_on: date | None
    # `score - previous snapshot's score`. Null under the same conditions as
    # `previous_taken_on is None`, or when today's own score could not be
    # measured.
    score_delta: int | None
    # Every stored snapshot for this user, ascending by date -- the chart
    # task 6 draws. Includes today's, once written.
    history: list[HealthSnapshotOut]


class ChallengeOut(BaseModel):
    id: int
    kind: str
    title: str
    detail: str
    target_cents: int | None
    category_id: int | None
    proposed_on: date
    state: str
    decided_on: date | None
    # Both null until `measure_outcome` produces a real figure -- see
    # `outcome_unavailable_reason` for why, while accepted.
    measured_cents: int | None
    measured_on: date | None
    # French. Set exactly when the challenge is `accepted` and `measured_cents`
    # is still null -- names which of `engines.challenge.measure_outcome`'s
    # causes applies (not enough time elapsed, the month was not imported yet,
    # no baseline, or no category at all). Always null on a `proposed` or
    # `rejected` challenge: there is nothing to measure an outcome against.
    outcome_unavailable_reason: str | None


class EngagementOut(BaseModel):
    streak: StreakOut
    # Milestones across every active goal, in funding order -- see the module
    # docstring.
    goals: list[GoalProgressOut]
    health: HealthOut
    # Every challenge this household has ever been shown -- proposed, then
    # accepted, then rejected, most valuable first within each group. A
    # challenge Yieldo could not quantify was never proposed (see
    # `engines/challenge.py`), so nothing here is a decorative row.
    challenges: list[ChallengeOut]
