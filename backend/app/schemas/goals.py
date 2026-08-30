"""Wire shapes for /api/goals.

`GoalReportOut` carries the measured capacity beside the goals, never just the
dates it produced: a projected date quoted without the rate and the sample size
behind it invites the reader to treat it as a commitment. Same contract
`schemas/cashflow.py` established for the runway's two scenarios.
"""

from datetime import date

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.cashflow import MeasuredRateOut
from app.schemas.history import HistoryOut
from app.schemas.patching import not_nullable


class GoalIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    target_cents: int = Field(gt=0)
    saved_cents: int = Field(default=0, ge=0)
    due_on: date | None = None
    # Lower is more urgent; goals are funded one at a time in this order.
    priority: int = Field(default=100, ge=1, le=999)


class GoalPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    target_cents: int | None = Field(default=None, gt=0)
    saved_cents: int | None = Field(default=None, ge=0)
    due_on: date | None = None
    priority: int | None = Field(default=None, ge=1, le=999)
    archived: bool | None = None

    # `due_on` is the one nullable column on `models.Goal` -- clearing a
    # deadline is a legitimate edit, so it is deliberately excluded here.
    _no_null = not_nullable("name", "target_cents", "saved_cents", "priority", "archived")


class GoalOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    target_cents: int
    saved_cents: int
    due_on: date | None
    priority: int
    archived: bool


class MilestoneOut(BaseModel):
    """One step of a goal. **Phase 2C's "jalons d'objectifs" reads this shape.**

    A REACHED milestone carries `projected_on: null` and `months_away: null`,
    and that is not a gap: `saved_cents` is declared by the user with no history
    behind it, so Yieldo does not know when the threshold was crossed. Rendering
    today's date there would claim it happened now.
    """

    percent: int
    threshold_cents: int
    reached: bool
    months_away: int | None
    projected_on: date | None


class GoalProgressOut(BaseModel):
    goal_id: int
    name: str
    target_cents: int
    saved_cents: int
    # Floored at 0. `progress_ratio` is NOT clamped, so an overfunded goal
    # still reads above 1.0.
    remaining_cents: int
    progress_ratio: float
    milestones: list[MilestoneOut]
    # Months before this goal starts receiving anything: goals are funded one
    # at a time, in priority order, out of the household's single measured
    # capacity. The screen must state this, or a far-off date reads as a bug.
    funding_starts_in_months: int
    # null exactly when `projection_unavailable_reason` is set.
    months_to_completion: int | None
    projected_completion_on: date | None
    # French. Names WHICH of three causes applies: no measurable capacity, a
    # capacity that is negative or zero, or a projection past fifty years.
    # Print it verbatim.
    projection_unavailable_reason: str | None
    due_on: date | None
    months_until_due: int | None
    # THREE states. null is not false: it means no verdict is possible, either
    # because there is no deadline or because no date could be projected.
    on_track: bool | None


class GoalReportOut(BaseModel):
    # In funding order (priority, then id) -- not the order they were created.
    goals: list[GoalProgressOut]
    # The measured monthly savings capacity behind every date above, or null
    # when fewer than three complete months could be observed. **Signed**: a
    # household spending more than it earns has a negative median here, and the
    # screen must say so rather than showing an empty progress projection.
    capacity: MeasuredRateOut | None
    # Complete observed months -- the sample the capacity rests on. 0 on an
    # empty ledger.
    months_observed: int
    # The ledger's own span, so "3 complete months" can be told apart from
    # "3 complete months inside a thirteen-month ledger with a nine-month
    # import hole", which is the operator's actual situation.
    history: HistoryOut | None
