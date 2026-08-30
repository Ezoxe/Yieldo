from datetime import date

from app.engines.goal import MILESTONE_PERCENTS, GoalInput, evaluate_goals

TODAY = date(2026, 8, 25)


def _goal(id_, target, saved=0, priority=100, due=None, name=None) -> GoalInput:
    return GoalInput(id=id_, name=name or f"Objectif {id_}", target_cents=target,
                     saved_cents=saved, due_on=due, priority=priority)


def test_progress_and_the_four_milestones():
    """600 000 c target, 100 000 c saved, 50 000 c/month measured capacity.
    Thresholds 150 000 / 300 000 / 450 000 / 600 000; months away 1 / 4 / 7 / 10."""
    [progress] = evaluate_goals([_goal(1, 600_000, saved=100_000)], 50_000, TODAY)
    assert progress.remaining_cents == 500_000
    assert progress.progress_ratio == 100_000 / 600_000
    assert [m.percent for m in progress.milestones] == list(MILESTONE_PERCENTS)
    assert [m.threshold_cents for m in progress.milestones] == [150_000, 300_000, 450_000, 600_000]
    assert [m.months_away for m in progress.milestones] == [1, 4, 7, 10]
    assert progress.months_to_completion == 10
    assert progress.projected_completion_on == date(2027, 6, 30)


def test_a_milestone_already_reached_carries_no_projected_date():
    """Yieldo has no history for `saved_cents` -- it is a figure the user
    declares -- so it cannot say WHEN a passed milestone was passed. `None`
    rather than a date, and never `today`, which would claim it happened now."""
    [progress] = evaluate_goals([_goal(1, 400_000, saved=250_000)], 50_000, TODAY)
    reached = [m for m in progress.milestones if m.reached]
    assert [m.percent for m in reached] == [25, 50]
    assert all(m.projected_on is None and m.months_away is None for m in reached)


def test_a_milestone_threshold_rounds_up_so_the_fraction_is_really_held():
    """25 % of 1 001 c is 250,25 c. Reaching the quarter means holding 251 c,
    not 250 -- the ceiling, so the milestone never fires a cent early."""
    [progress] = evaluate_goals([_goal(1, 1_001)], 100, TODAY)
    assert progress.milestones[0].threshold_cents == 251


def test_goals_are_funded_one_at_a_time_in_priority_order():
    """The household has ONE measured capacity. Applying it in full to every
    goal in parallel would report five goals all completing at once, which is
    arithmetically impossible. The most urgent goal takes the whole capacity
    until it completes; the next starts then."""
    goals = [_goal(2, 300_000, priority=200, name="Voyage"),
             _goal(1, 500_000, priority=1, name="Urgence")]
    urgence, voyage = evaluate_goals(goals, 50_000, TODAY)
    assert urgence.name == "Urgence"
    assert urgence.funding_starts_in_months == 0
    assert urgence.months_to_completion == 10
    assert voyage.name == "Voyage"
    assert voyage.funding_starts_in_months == 10
    assert voyage.months_to_completion == 16
    assert voyage.milestones[-1].months_away == 16


def test_a_completed_goal_does_not_hold_up_the_queue():
    goals = [_goal(1, 100_000, saved=100_000, priority=1),
             _goal(2, 300_000, priority=2)]
    done, next_up = evaluate_goals(goals, 50_000, TODAY)
    assert done.remaining_cents == 0
    assert done.months_to_completion == 0
    assert done.projected_completion_on == TODAY
    assert next_up.funding_starts_in_months == 0
    assert next_up.months_to_completion == 6


def test_an_unmeasurable_capacity_refuses_with_its_own_reason():
    """Below three complete observed months `capacity.measure_savings_capacity`
    returns None. No date can be projected from nothing."""
    [progress] = evaluate_goals([_goal(1, 600_000)], None, TODAY)
    assert progress.projected_completion_on is None
    assert progress.months_to_completion is None
    assert progress.projection_unavailable_reason is not None
    assert "mesurée" in progress.projection_unavailable_reason
    assert "négative" not in progress.projection_unavailable_reason
    assert all(m.projected_on is None for m in progress.milestones)


def test_a_negative_measured_capacity_refuses_with_a_DIFFERENT_reason():
    """THE OPERATOR'S OWN CASE: his measured savings capacity is -74 619 c per
    month. The goal does not merely progress slowly -- it does not progress at
    all, and the reason must say THAT and not "pas assez d'historique", which
    is a different cause with a different remedy. Naming the wrong cause is the
    single most expensive failure mode in this project's history."""
    [progress] = evaluate_goals([_goal(1, 600_000)], -74_619, TODAY)
    assert progress.projected_completion_on is None
    assert progress.projection_unavailable_reason is not None
    assert "négative" in progress.projection_unavailable_reason
    assert "historique" not in progress.projection_unavailable_reason
    assert progress.on_track is None


def test_a_zero_capacity_takes_the_same_branch_as_a_negative_one():
    [progress] = evaluate_goals([_goal(1, 600_000)], 0, TODAY)
    assert progress.projection_unavailable_reason is not None
    assert "négative" in progress.projection_unavailable_reason


def test_a_projection_past_fifty_years_refuses_with_a_third_reason():
    [progress] = evaluate_goals([_goal(1, 100_000_000)], 100, TODAY)
    assert progress.months_to_completion is None
    assert progress.projection_unavailable_reason is not None
    assert "ans" in progress.projection_unavailable_reason
    assert "négative" not in progress.projection_unavailable_reason


def test_on_track_compares_the_projection_with_the_deadline():
    on_time = evaluate_goals([_goal(1, 600_000, due=date(2027, 12, 31))], 50_000, TODAY)[0]
    late = evaluate_goals([_goal(1, 600_000, due=date(2026, 12, 31))], 50_000, TODAY)[0]
    assert on_time.on_track is True
    assert late.on_track is False
    assert on_time.months_until_due == 16
    assert late.months_until_due == 4


def test_on_track_is_none_without_a_deadline_and_without_a_projection():
    """Three states, not two. `False` means "vous n'y arriverez pas"; `None`
    means "on ne peut pas se prononcer". Collapsing them puts an accusation on
    a screen that has no basis for one."""
    no_due = evaluate_goals([_goal(1, 600_000)], 50_000, TODAY)[0]
    no_projection = evaluate_goals(
        [_goal(1, 600_000, due=date(2027, 1, 31))], -74_619, TODAY)[0]
    assert no_due.on_track is None
    assert no_projection.on_track is None
    assert no_projection.months_until_due == 5


def test_an_overfunded_goal_is_reported_as_it_is_not_clamped():
    [progress] = evaluate_goals([_goal(1, 100_000, saved=150_000)], 50_000, TODAY)
    assert progress.progress_ratio == 1.5
    assert progress.remaining_cents == 0
    assert all(m.reached for m in progress.milestones)
