"""Savings goals: how far along, and when each step lands.

Design §4.1 gives the fields; §6.2's engagement section gives the milestones
their shape -- 25 %, 50 %, 75 %, "avec la date projetée d'atteinte".
**Phase 2C's "jalons d'objectifs" reads `Milestone` exactly as defined here.**

**Goals are funded one at a time, in priority order.** The household has one
measured savings capacity. Applying it in full to every goal independently
would report five goals all completing at the same date, which is
arithmetically impossible and is precisely the kind of confident-looking
falsehood every review in this project has been catching. The most urgent goal
(lowest `priority`, then lowest id) takes the whole capacity until it
completes; the next starts then. `funding_starts_in_months` says when each
goal's own clock begins, so a screen can explain a far-off date rather than
leaving the user to wonder.

**Four distinct refusals, mutually exclusive by construction**, because a
household told the wrong cause takes the wrong action:

* the capacity could not be measured at all (`None` -- fewer than three
  complete observed months). Remedy: import more statements;
* the measured capacity is negative or zero. **This is the operator's own
  state: -74 619 c per month.** The goal does not progress slowly; it does not
  progress. Remedy: spend less or earn more. Telling him "pas assez
  d'historique" here would send him to the import screen to fix something that
  is not broken;
* the projection runs past fifty years;
* a MORE URGENT goal is itself past fifty years, so this one never starts.
  Repeating the sentence above would blame this goal's own size, which can be
  a 1 000 EUR goal stuck behind a 10 000 000 EUR one. Remedy: re-prioritise.

Pure: no session, no network, no implicit clock -- `today` is a parameter.
"""

from dataclasses import dataclass
from datetime import date

from app.engines.period import month_end
from app.engines.savings import MAX_PROJECTION_MONTHS

# Design §6.2. 100 is included so the completion itself is a milestone with the
# same shape as the other three -- phase 2C renders one list, not three plus a
# special case.
MILESTONE_PERCENTS = (25, 50, 75, 100)


@dataclass(frozen=True)
class GoalInput:
    id: int
    name: str
    target_cents: int
    # Declared by the user, not measured: Yieldo cannot tell which euros in a
    # savings account belong to which goal.
    saved_cents: int
    due_on: date | None
    # Lower is more urgent. See the module docstring on sequential funding.
    priority: int


@dataclass(frozen=True)
class Milestone:
    """One step of a goal. **Phase 2C's engagement mechanics consume this
    exactly as built here** -- its shape is a commitment, not an internal
    detail: changing it later means changing it in two phases.

    `reached` and `projected_on` are not two views of one fact:

    * a reached milestone has `projected_on is None` and `months_away is None`,
      because `saved_cents` is a declared figure with no history behind it and
      Yieldo genuinely does not know when the threshold was crossed. `today`
      would claim it happened now;
    * an unreached milestone has a date exactly when a capacity was measurable
      and positive, and `None` otherwise -- in which case the goal's own
      `projection_unavailable_reason` says why, once, rather than four times.
    """

    percent: int
    # The ceiling of `percent`% of the target, so reaching a quarter means
    # holding at least a quarter and the milestone never fires a cent early.
    threshold_cents: int
    reached: bool
    months_away: int | None
    projected_on: date | None


@dataclass(frozen=True)
class GoalProgress:
    goal_id: int
    name: str
    target_cents: int
    saved_cents: int
    # Floored at 0: an overfunded goal needs nothing more. The overfunding
    # itself is still visible in `progress_ratio`, which is NOT clamped.
    remaining_cents: int
    progress_ratio: float
    milestones: list[Milestone]
    # How many months pass before this goal starts receiving anything, under
    # the one-at-a-time funding rule. 0 for the most urgent unfinished goal.
    funding_starts_in_months: int
    # Includes the wait above. None exactly when
    # `projection_unavailable_reason` is set. 0 on an already-completed goal.
    months_to_completion: int | None
    projected_completion_on: date | None
    # French. Set exactly when `months_to_completion` is None, and it names
    # WHICH of four causes applies. Never two at once.
    projection_unavailable_reason: str | None
    due_on: date | None
    # Whole calendar months from today's month to the deadline's; negative when
    # the deadline has passed. None when there is no deadline.
    months_until_due: int | None
    # Three states, deliberately. True/False are verdicts; None means no
    # verdict is possible -- no deadline, or no projection to compare with it.
    # Collapsing None into False puts an accusation on screen without a basis.
    on_track: bool | None


def _threshold_cents(target_cents: int, percent: int) -> int:
    """Ceiling of `percent`% of the target, in integer cents."""
    return -(-target_cents * percent // 100)


def _months_for(remaining_cents: int, capacity_cents: int) -> int:
    """Whole months of `capacity_cents` needed to cover `remaining_cents`."""
    return -(-remaining_cents // capacity_cents)


def _reason_no_capacity() -> str:
    return (
        "Votre capacité d'épargne n'a pas pu être mesurée : il faut au moins "
        "trois mois complets de relevés. Aucune date ne peut être projetée "
        "tant qu'elle n'est pas connue."
    )


def _reason_capacity_not_positive() -> str:
    return (
        "Votre capacité d'épargne mesurée est négative ou nulle : au rythme "
        "constaté dans vos relevés, cet objectif ne progresse pas, et aucune "
        "date d'atteinte ne peut être avancée."
    )


def _reason_too_far() -> str:
    return (
        f"Au rythme mesuré, cet objectif ne serait pas atteint avant "
        f"{MAX_PROJECTION_MONTHS // 12} ans. Aucune date n'est avancée au-delà : "
        "elle ne voudrait rien dire."
    )


def _reason_blocked_by(name: str) -> str:
    """The queue, not this goal, is what refuses.

    Funding is sequential, so a goal that is itself unreachable inside fifty
    years absorbs the whole capacity for at least that long: nothing queued
    behind it can start inside the horizon either. Repeating `_reason_too_far`
    here would say this goal is too expensive, which may be false -- it can be
    a 1 000 EUR goal stuck behind a 10 000 000 EUR one. The sentence names the
    blocker so the user knows which goal to re-prioritise or drop.
    """
    return (
        f"Cet objectif ne peut pas commencer à être financé : « {name} », plus "
        f"urgent, n'est pas atteint dans les "
        f"{MAX_PROJECTION_MONTHS // 12} ans projetés et mobilise toute la "
        "capacité d'épargne d'ici là. Changez sa priorité pour le projeter."
    )


def _months_until(today: date, due_on: date | None) -> int | None:
    if due_on is None:
        return None
    return (due_on.year - today.year) * 12 + (due_on.month - today.month)


def evaluate_goals(
    goals: list[GoalInput], monthly_capacity_cents: int | None, today: date
) -> list[GoalProgress]:
    """Every goal, in funding order, with its milestones and its own reason.

    `monthly_capacity_cents` is `capacity.measure_savings_capacity(...)
    .median_cents`, or `None` when that function refused. The sign is kept: a
    household spending more than it earns has a negative capacity, and clamping
    it to zero here would let a goal read "en bonne voie" for someone going
    backwards every month.
    """
    ordered = sorted(goals, key=lambda goal: (goal.priority, goal.id))
    results: list[GoalProgress] = []
    offset_months = 0
    # Set by the first goal that consumes the capacity without ever completing.
    # Everything queued behind it inherits a refusal naming it.
    blocked_by: str | None = None

    for goal in ordered:
        remaining = max(0, goal.target_cents - goal.saved_cents)
        ratio = goal.saved_cents / goal.target_cents if goal.target_cents else 0.0
        months_until_due = _months_until(today, goal.due_on)

        if remaining == 0:
            # Already there. It consumes no capacity, so it does not push the
            # goals behind it back, and it needs no reason.
            results.append(GoalProgress(
                goal_id=goal.id, name=goal.name, target_cents=goal.target_cents,
                saved_cents=goal.saved_cents, remaining_cents=0, progress_ratio=ratio,
                milestones=[
                    Milestone(percent=percent,
                              threshold_cents=_threshold_cents(goal.target_cents, percent),
                              reached=True, months_away=None, projected_on=None)
                    for percent in MILESTONE_PERCENTS
                ],
                funding_starts_in_months=offset_months, months_to_completion=0,
                projected_completion_on=today, projection_unavailable_reason=None,
                due_on=goal.due_on, months_until_due=months_until_due,
                on_track=None if goal.due_on is None else today <= goal.due_on,
            ))
            continue

        reason: str | None = None
        own_months: int | None = None
        if monthly_capacity_cents is None:
            reason = _reason_no_capacity()
        elif monthly_capacity_cents <= 0:
            reason = _reason_capacity_not_positive()
        elif blocked_by is not None:
            reason = _reason_blocked_by(blocked_by)
        else:
            own_months = _months_for(remaining, monthly_capacity_cents)
            if offset_months + own_months > MAX_PROJECTION_MONTHS:
                reason = _reason_too_far()
                own_months = None
                blocked_by = goal.name

        milestones: list[Milestone] = []
        for percent in MILESTONE_PERCENTS:
            threshold = _threshold_cents(goal.target_cents, percent)
            if goal.saved_cents >= threshold:
                milestones.append(Milestone(percent=percent, threshold_cents=threshold,
                                            reached=True, months_away=None, projected_on=None))
                continue
            if own_months is None or monthly_capacity_cents is None:
                milestones.append(Milestone(percent=percent, threshold_cents=threshold,
                                            reached=False, months_away=None, projected_on=None))
                continue
            away = offset_months + _months_for(threshold - goal.saved_cents,
                                               monthly_capacity_cents)
            milestones.append(Milestone(percent=percent, threshold_cents=threshold,
                                        reached=False, months_away=away,
                                        projected_on=month_end(today, away)))

        total_months = None if own_months is None else offset_months + own_months
        completion = None if total_months is None else month_end(today, total_months)
        results.append(GoalProgress(
            goal_id=goal.id, name=goal.name, target_cents=goal.target_cents,
            saved_cents=goal.saved_cents, remaining_cents=remaining, progress_ratio=ratio,
            milestones=milestones, funding_starts_in_months=offset_months,
            months_to_completion=total_months, projected_completion_on=completion,
            projection_unavailable_reason=reason, due_on=goal.due_on,
            months_until_due=months_until_due,
            on_track=None if (goal.due_on is None or completion is None)
            else completion <= goal.due_on,
        ))
        if total_months is not None:
            offset_months = total_months

    return results
