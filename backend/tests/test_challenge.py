from datetime import date, timedelta

from app.engines.anomaly import Anomaly, AnomalyTx
from app.engines.challenge import (
    BudgetMonthOutcome,
    ChallengeContext,
    MonthSpend,
    measure_outcome,
    propose_anomaly_challenges,
    propose_budget_overrun_challenges,
    propose_category_level_challenges,
    propose_subscription_challenges,
)
from app.engines.inflation import CategoryInflation
from app.engines.recurrence import Recurrence

TODAY = date(2026, 1, 15)


def _recurrence(
    *, status="active", annualisable=True, amount_cents=-3_400, category_id=7,
    periodicity="monthly", occurrences=8, first_on=date(2025, 5, 5),
    last_on=date(2025, 12, 5), label="NETFLIX.COM",
) -> Recurrence:
    return Recurrence(
        label_key="netflix", label=label, category_id=category_id,
        periodicity=periodicity, occurrences=occurrences, first_on=first_on,
        last_on=last_on, median_interval_days=30, amount_cents=amount_cents,
        amount_spread_cents=0, annual_cents=amount_cents * 12,
        observed_span_days=(last_on - first_on).days, annualisable=annualisable,
        expected_next_on=date(2026, 1, 5), status=status, confidence="confirmed",
        price_change=None,
    )


def _inflation_line(
    *, category_id=7, current_cost_cents=30_000, previous_cost_cents=20_000,
    comparable=True, months_current=3, months_previous=3,
) -> CategoryInflation:
    delta = current_cost_cents - previous_cost_cents
    ratio = delta / previous_cost_cents if comparable and previous_cost_cents else None
    return CategoryInflation(
        category_id=category_id, current_cost_cents=current_cost_cents,
        previous_cost_cents=previous_cost_cents, delta_cents=delta, ratio=ratio,
        months_current=months_current, months_previous=months_previous,
        comparable=comparable, reason=None if comparable else "raison de secours",
    )


def _anomaly(
    *, category_id=9, amount_cents=-86_000, category_median_cents=12_000,
    direction="high", label="SUPERMARCHE XXL",
) -> Anomaly:
    return Anomaly(
        transaction_id=1, on=date(2026, 1, 10), amount_cents=amount_cents, label=label,
        category_id=category_id, category_median_cents=category_median_cents,
        modified_z=9.5, direction=direction,
    )


# ---------------------------------------------------------------------------
# propose_subscription_challenges
# ---------------------------------------------------------------------------


def test_an_active_annualisable_expense_recurrence_is_proposed():
    proposals = propose_subscription_challenges([_recurrence()])
    [proposal] = proposals
    assert proposal.kind == "unused_subscription"
    assert proposal.category_id == 7
    assert proposal.target_cents == 3_400
    assert "NETFLIX.COM" in proposal.title
    # The figure (occurrences) and the span (months) it was measured over are
    # both named in the sentence -- never the word "inutilisé", which Yieldo
    # has no data to support.
    assert "8 occurrences" in proposal.detail
    assert "8 mois" in proposal.detail
    assert "inutilisé" not in proposal.detail.lower()


def test_a_missing_or_ended_recurrence_is_never_proposed():
    """Already stopped or already in doubt -- proposing to cancel it says
    nothing new."""
    assert propose_subscription_challenges([_recurrence(status="missing")]) == []
    assert propose_subscription_challenges([_recurrence(status="ended")]) == []


def test_a_non_annualisable_recurrence_is_never_proposed():
    """Under a full billing quarter of history -- `target_cents` would be
    exactly the extrapolation `recurrence.py` itself refuses to make."""
    assert propose_subscription_challenges([_recurrence(annualisable=False)]) == []


def test_an_income_recurrence_is_never_proposed():
    """A salary is not a subscription to cancel."""
    assert propose_subscription_challenges([_recurrence(amount_cents=250_000)]) == []


def test_subscriptions_are_sorted_by_cost_descending():
    cheap = _recurrence(amount_cents=-500, label="SPOTIFY")
    expensive = _recurrence(amount_cents=-9_900, label="SALLE DE SPORT")
    proposals = propose_subscription_challenges([cheap, expensive])
    assert [p.title for p in proposals] == [
        "Abonnement « SALLE DE SPORT »", "Abonnement « SPOTIFY »",
    ]


# ---------------------------------------------------------------------------
# propose_category_level_challenges
# ---------------------------------------------------------------------------


def test_a_comparable_category_costing_more_than_a_year_ago_is_proposed():
    proposals = propose_category_level_challenges(
        [_inflation_line()], category_names={7: "Restaurants"},
    )
    [proposal] = proposals
    assert proposal.kind == "category_above_past_level"
    assert proposal.category_id == 7
    assert proposal.target_cents == 10_000  # 30 000 - 20 000
    assert "Restaurants" in proposal.title
    assert "3 mois récents" in proposal.detail
    assert "3 mois un an plus tôt" in proposal.detail


def test_a_non_comparable_line_is_never_proposed():
    proposals = propose_category_level_challenges(
        [_inflation_line(comparable=False)], category_names={7: "Restaurants"},
    )
    assert proposals == []


def test_a_category_that_got_cheaper_is_never_proposed():
    """A fall is a win, not a challenge."""
    proposals = propose_category_level_challenges(
        [_inflation_line(current_cost_cents=10_000, previous_cost_cents=20_000)],
        category_names={7: "Restaurants"},
    )
    assert proposals == []


def test_the_uncategorized_bucket_is_never_proposed():
    proposals = propose_category_level_challenges(
        [_inflation_line(category_id=None)], category_names={},
    )
    assert proposals == []


def test_a_category_with_no_resolvable_name_is_skipped():
    """Deleted since the comparison ran -- there is nothing left to name."""
    proposals = propose_category_level_challenges([_inflation_line()], category_names={})
    assert proposals == []


# ---------------------------------------------------------------------------
# propose_anomaly_challenges
# ---------------------------------------------------------------------------


def _history(category_id: int, sign_amount: int, count: int) -> list[AnomalyTx]:
    return [
        AnomalyTx(id=i, on=date(2025, 6, 1), amount_cents=sign_amount, label="X",
                  category_id=category_id)
        for i in range(count)
    ]


def test_a_high_expense_anomaly_is_proposed_with_its_real_observation_count():
    history = _history(category_id=9, sign_amount=-1_000, count=17)
    proposals = propose_anomaly_challenges([_anomaly()], history)
    [proposal] = proposals
    assert proposal.kind == "anomaly"
    assert proposal.category_id == 9
    assert proposal.target_cents == 86_000 - 12_000
    assert "SUPERMARCHE XXL" in proposal.title
    assert "17 opérations" in proposal.detail


def test_a_low_anomaly_is_never_proposed():
    """Spending LESS than usual is not a challenge."""
    proposals = propose_anomaly_challenges([_anomaly(direction="low")], [])
    assert proposals == []


def test_an_anomalous_income_is_never_proposed():
    proposals = propose_anomaly_challenges([_anomaly(amount_cents=250_000)], [])
    assert proposals == []


def test_observation_count_only_counts_the_same_category_and_sign():
    """A same-category INCOME row and a different-category expense row must
    not inflate the count named in the sentence."""
    history = [
        AnomalyTx(id=1, on=date(2025, 6, 1), amount_cents=-1_000, label="X", category_id=9),
        AnomalyTx(id=2, on=date(2025, 6, 2), amount_cents=-1_000, label="X", category_id=9),
        AnomalyTx(id=3, on=date(2025, 6, 3), amount_cents=1_000, label="X", category_id=9),
        AnomalyTx(id=4, on=date(2025, 6, 4), amount_cents=-1_000, label="X", category_id=1),
    ]
    [proposal] = propose_anomaly_challenges([_anomaly()], history)
    assert "2 opérations" in proposal.detail


# ---------------------------------------------------------------------------
# propose_budget_overrun_challenges
# ---------------------------------------------------------------------------


def _outcome(category_id: int, month: str, budget: int, spent: int) -> BudgetMonthOutcome:
    return BudgetMonthOutcome(category_id=category_id, month_key=month,
                              budget_cents=budget, spent_cents=spent)


def test_a_category_over_budget_in_three_months_is_proposed():
    outcomes = [
        _outcome(3, "2025-10", 20_000, 25_000),  # +5 000
        _outcome(3, "2025-11", 20_000, 21_000),  # +1 000
        _outcome(3, "2025-12", 20_000, 30_000),  # +10 000
    ]
    proposals = propose_budget_overrun_challenges(outcomes, category_names={3: "Loisirs"})
    [proposal] = proposals
    assert proposal.kind == "budget_overrun"
    assert proposal.category_id == 3
    # Median of [5 000, 1 000, 10 000] = 5 000.
    assert proposal.target_cents == 5_000
    assert "Loisirs" in proposal.title
    assert "3 mois sur 3 suivis" in proposal.detail


def test_fewer_than_three_overrun_months_is_never_proposed():
    outcomes = [
        _outcome(3, "2025-10", 20_000, 25_000),
        _outcome(3, "2025-11", 20_000, 19_000),  # respected
        _outcome(3, "2025-12", 20_000, 30_000),
    ]
    assert propose_budget_overrun_challenges(outcomes, category_names={3: "Loisirs"}) == []


def test_exactly_at_the_ceiling_counts_as_overrun():
    """Matches `budget.py`'s own convention: reaching the ceiling exactly
    already counts as breached."""
    outcomes = [_outcome(3, f"2025-{m:02d}", 20_000, 20_000) for m in (10, 11, 12)]
    proposals = propose_budget_overrun_challenges(outcomes, category_names={3: "Loisirs"})
    assert proposals[0].target_cents == 0


def test_categories_are_grouped_independently():
    outcomes = [
        _outcome(3, "2025-10", 20_000, 25_000), _outcome(3, "2025-11", 20_000, 25_000),
        _outcome(3, "2025-12", 20_000, 25_000),
        _outcome(4, "2025-10", 10_000, 11_000),  # only one overrun month: not proposed
    ]
    proposals = propose_budget_overrun_challenges(
        outcomes, category_names={3: "Loisirs", 4: "Santé"},
    )
    assert [p.category_id for p in proposals] == [3]


def test_an_unresolvable_category_name_is_skipped():
    outcomes = [_outcome(3, f"2025-{m:02d}", 20_000, 25_000) for m in (10, 11, 12)]
    assert propose_budget_overrun_challenges(outcomes, category_names={}) == []


# ---------------------------------------------------------------------------
# measure_outcome
# ---------------------------------------------------------------------------


DECIDED_ON = date(2026, 1, 10)  # accepted mid-January
NEXT_MONTH_END = date(2026, 2, 28)  # the month right after acceptance ends here


def test_no_category_is_its_own_refusal_not_a_zero():
    context = ChallengeContext(category_id=None, decided_on=DECIDED_ON)
    outcome = measure_outcome(context, before=None, after=None, today=date(2026, 6, 1))
    assert outcome.measured_cents is None
    assert outcome.unavailable_reason == (
        "Le résultat de ce défi ne peut pas être mesuré : aucune catégorie "
        "n'y est associée."
    )


def test_not_enough_time_elapsed_is_its_own_answer_never_a_zero():
    """On the very last day of the month right after acceptance, the month is
    not over yet -- this must not be conflated with a zero saving."""
    context = ChallengeContext(category_id=7, decided_on=DECIDED_ON)
    outcome = measure_outcome(context, before=None, after=None, today=NEXT_MONTH_END)
    assert outcome.measured_cents is None
    assert outcome.measured_on is None
    assert "Pas assez de temps écoulé" in outcome.unavailable_reason


def test_the_day_after_the_month_ends_time_has_elapsed():
    """One day later than the previous test -- the elapsed-time refusal must
    lift exactly then, not before."""
    context = ChallengeContext(category_id=7, decided_on=DECIDED_ON)
    outcome = measure_outcome(
        context, before=MonthSpend(key="2025-12", spent_cents=10_000),
        after=MonthSpend(key="2026-02", spent_cents=4_000),
        today=NEXT_MONTH_END + timedelta(days=1),
    )
    assert outcome.unavailable_reason is None
    assert outcome.measured_cents == 6_000


def test_time_elapsed_but_the_month_was_never_imported():
    """Distinct from 'not enough time elapsed': the month is calendar-over,
    but no statement exists for it yet."""
    context = ChallengeContext(category_id=7, decided_on=DECIDED_ON)
    outcome = measure_outcome(
        context, before=MonthSpend(key="2025-12", spent_cents=10_000),
        after=None, today=date(2026, 6, 1),
    )
    assert outcome.measured_cents is None
    assert "Le mois suivant" in outcome.unavailable_reason
    assert outcome.unavailable_reason != (
        "Pas assez de temps écoulé depuis l'acceptation de ce défi : le "
        "résultat n'est mesurable qu'une fois le mois suivant entièrement "
        "terminé."
    )


def test_an_after_observation_for_the_wrong_month_is_treated_as_absent():
    context = ChallengeContext(category_id=7, decided_on=DECIDED_ON)
    outcome = measure_outcome(
        context, before=MonthSpend(key="2025-12", spent_cents=10_000),
        after=MonthSpend(key="2026-03", spent_cents=4_000),  # wrong month
        today=date(2026, 6, 1),
    )
    assert outcome.measured_cents is None
    assert "Le mois suivant" in outcome.unavailable_reason


def test_no_baseline_before_acceptance_is_its_own_refusal():
    context = ChallengeContext(category_id=7, decided_on=DECIDED_ON)
    outcome = measure_outcome(
        context, before=None, after=MonthSpend(key="2026-02", spent_cents=4_000),
        today=date(2026, 6, 1),
    )
    assert outcome.measured_cents is None
    assert "avant" in outcome.unavailable_reason or "précédant" in outcome.unavailable_reason


def test_a_successful_reduction_measures_positive():
    context = ChallengeContext(category_id=7, decided_on=DECIDED_ON)
    outcome = measure_outcome(
        context, before=MonthSpend(key="2025-12", spent_cents=10_000),
        after=MonthSpend(key="2026-02", spent_cents=2_000),
        today=date(2026, 6, 1),
    )
    assert outcome.measured_cents == 8_000
    assert outcome.measured_on == NEXT_MONTH_END
    assert outcome.unavailable_reason is None


def test_spending_more_afterward_measures_negative_not_a_zero():
    context = ChallengeContext(category_id=7, decided_on=DECIDED_ON)
    outcome = measure_outcome(
        context, before=MonthSpend(key="2025-12", spent_cents=2_000),
        after=MonthSpend(key="2026-02", spent_cents=10_000),
        today=date(2026, 6, 1),
    )
    assert outcome.measured_cents == -8_000
