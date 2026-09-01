from app.engines.capacity import MeasuredRate
from app.engines.health import (
    BUDGET_ADHERENCE_WEIGHT,
    ESSENTIAL_SHARE_WEIGHT,
    RUNWAY_WEIGHT,
    SAVINGS_RATE_WEIGHT,
    compute_health_score,
)


def _rate(median_cents: int, months: int = 3) -> MeasuredRate:
    """A `MeasuredRate` with a nominal band -- only `median_cents` matters to
    this engine; `spread`/`low`/`high` are never read here."""
    return MeasuredRate(months=months, median_cents=median_cents, spread_cents=0,
                        low_cents=median_cents, high_cents=median_cents)


def _score(
    savings_capacity=None, income_rate=None, essential_expense_rate=None,
    essential_category_count=0, essential_months_observed=0,
    runway_normal_months=None, runway_unavailable_reason="raison de secours",
    budget_outcomes=None,
):
    return compute_health_score(
        savings_capacity=savings_capacity, income_rate=income_rate,
        essential_expense_rate=essential_expense_rate,
        essential_category_count=essential_category_count,
        essential_months_observed=essential_months_observed,
        runway_normal_months=runway_normal_months,
        runway_unavailable_reason=runway_unavailable_reason,
        budget_outcomes=budget_outcomes or [],
    )


# ---------------------------------------------------------------------------
# The fixed weights, never derived
# ---------------------------------------------------------------------------


def test_the_four_weights_are_fixed_and_sum_to_one_hundred():
    """A regression lock on the constants themselves: the plan requires fixed,
    documented weights, and this pins the exact split so a future edit cannot
    silently change it without a failing test naming the change."""
    assert SAVINGS_RATE_WEIGHT == 30
    assert ESSENTIAL_SHARE_WEIGHT == 25
    assert RUNWAY_WEIGHT == 25
    assert BUDGET_ADHERENCE_WEIGHT == 20
    total = SAVINGS_RATE_WEIGHT + ESSENTIAL_SHARE_WEIGHT + RUNWAY_WEIGHT + BUDGET_ADHERENCE_WEIGHT
    assert total == 100


def test_every_component_carries_its_fixed_weight_even_when_unmeasurable():
    """The weight is a property of the SCORE's design, not of what could be
    measured -- an unavailable component still reports what it WOULD have
    counted for, so a screen can explain why the blend moved."""
    report = _score()  # nothing measurable at all
    weights = {c.key: c.weight for c in report.components}
    assert weights == {
        "savings_rate": SAVINGS_RATE_WEIGHT,
        "essential_share": ESSENTIAL_SHARE_WEIGHT,
        "runway": RUNWAY_WEIGHT,
        "budget_adherence": BUDGET_ADHERENCE_WEIGHT,
    }


def test_component_order_and_keys_are_stable():
    report = _score()
    assert [c.key for c in report.components] == [
        "savings_rate", "essential_share", "runway", "budget_adherence",
    ]


# ---------------------------------------------------------------------------
# The blend itself
# ---------------------------------------------------------------------------


def test_all_four_components_blend_with_their_fixed_weights():
    """Savings rate 10 % (score 50), essential share 50 % (score 100), runway
    3 months (score 50), budget adherence 2/3 respected (score 67). The blend
    is the weighted average of exactly these four numbers against the fixed
    30/25/25/20 split -- 65,9 rounds to 66 -- not an unweighted mean (which
    would land on 66,75 -> 67, a different number a bug could hide behind)."""
    report = _score(
        savings_capacity=_rate(10_000), income_rate=_rate(100_000),
        essential_expense_rate=_rate(50_000), essential_category_count=1,
        essential_months_observed=3, runway_normal_months=3.0,
        budget_outcomes=[0.5, 0.8, 1.2],
    )
    by_key = {c.key: c for c in report.components}
    assert by_key["savings_rate"].score == 50
    assert by_key["essential_share"].score == 100
    assert by_key["runway"].score == 50
    assert by_key["budget_adherence"].score == 67
    # An unweighted mean of 50/100/50/67 is 66,75 -> 67: a different figure,
    # which is exactly what would come out of dropping the weights silently.
    assert report.score == 66
    assert report.score != round((50 + 100 + 50 + 67) / 4)
    assert report.unavailable_reason is None


def test_missing_components_renormalise_over_the_available_weights():
    """Only savings rate (weight 30) and runway (weight 25) measure. The
    blend must divide by 55 -- the SUM OF THE AVAILABLE WEIGHTS -- not by
    100, which would silently treat the two missing components as scoring
    zero. 72,7 (over 55) rounds to 73; treating the missing pair as zero
    would instead give (1500+2500)/100 = 40, a starkly different number."""
    report = _score(
        savings_capacity=_rate(10_000), income_rate=_rate(100_000),  # ratio 0.10 -> 50
        runway_normal_months=6.0,  # -> 100
    )
    assert report.score == 73
    assert report.score != 40  # what a zero-substitution bug would produce


def test_an_unmeasured_component_does_not_drag_the_score_down_as_a_zero():
    """Three components score 100; the fourth (budget adherence) is
    unmeasurable. The correct blend renormalises to 100 -- the household is
    not penalised for never having declared a budget. A wrong implementation
    that folds a missing component in as a zero would instead compute 80."""
    report = _score(
        savings_capacity=_rate(50_000), income_rate=_rate(50_000),  # ratio 1.0 -> clamped 100
        essential_expense_rate=_rate(0), essential_category_count=1,
        essential_months_observed=3,  # ratio 0.0 -> 100
        runway_normal_months=12.0,  # clamped 100
    )
    by_key = {c.key: c for c in report.components}
    assert by_key["budget_adherence"].score is None
    assert by_key["budget_adherence"].measured_value is None  # not 0
    assert report.score == 100
    assert report.score != 80


def test_the_score_is_none_below_two_measurable_components():
    report = _score(savings_capacity=_rate(10_000), income_rate=_rate(100_000))
    assert report.score is None
    assert "Taux d'épargne" in report.unavailable_reason
    assert "2 sur 4" in report.unavailable_reason


def test_the_reason_says_no_component_at_all_when_none_measured():
    report = _score()
    assert report.score is None
    assert report.unavailable_reason == (
        "Le score de santé financière ne peut pas être calculé : aucune composante "
        "n'a pu être mesurée, et il en faut au moins 2 sur 4. Le détail de chaque "
        "composante ci-dessous explique pourquoi."
    )


# ---------------------------------------------------------------------------
# Savings rate
# ---------------------------------------------------------------------------


def test_savings_rate_is_never_zero_when_it_could_not_be_measured():
    report = _score()
    component = next(c for c in report.components if c.key == "savings_rate")
    assert component.score is None
    assert component.measured_value is None
    assert component.unavailable_reason == (
        "Votre capacité d'épargne n'a pas pu être mesurée : il faut au moins trois "
        "mois complets de relevés pour en tirer une médiane."
    )


def test_savings_rate_names_income_specifically_when_income_is_unmeasured():
    report = _score(savings_capacity=_rate(10_000))  # income_rate stays None
    component = next(c for c in report.components if c.key == "savings_rate")
    assert component.score is None
    assert component.unavailable_reason == (
        "Votre taux d'épargne ne peut pas être exprimé en part du revenu : votre "
        "revenu n'a pas pu être mesuré, faute d'au moins trois mois complets de "
        "relevés."
    )


def test_savings_rate_names_a_non_positive_income_distinctly():
    """A DIFFERENT cause from 'income never measured' -- income WAS measured,
    it simply is not positive. Conflating the two would claim a measurement
    was never made when it was."""
    report = _score(savings_capacity=_rate(10_000), income_rate=_rate(0))
    component = next(c for c in report.components if c.key == "savings_rate")
    assert component.unavailable_reason == (
        "Votre taux d'épargne ne peut pas être exprimé en part du revenu : le "
        "revenu médian mesuré sur vos relevés n'est pas positif."
    )


def test_a_negative_measured_capacity_clamps_to_zero_not_a_crash():
    """The operator's own shape: capacity roughly -74 619 c against income
    roughly 47 111 c/month -- a ratio around -158 %. The score floors at 0,
    never goes negative and never raises."""
    report = _score(savings_capacity=_rate(-74_619), income_rate=_rate(47_111))
    component = next(c for c in report.components if c.key == "savings_rate")
    assert component.score == 0
    assert component.measured_value < -1  # the true ratio is still published


def test_a_twenty_percent_savings_rate_is_full_marks_and_more_does_not_exceed_it():
    report = _score(savings_capacity=_rate(20_000), income_rate=_rate(100_000))
    assert next(c for c in report.components if c.key == "savings_rate").score == 100
    report_more = _score(savings_capacity=_rate(60_000), income_rate=_rate(100_000))
    assert next(c for c in report_more.components if c.key == "savings_rate").score == 100


# ---------------------------------------------------------------------------
# Essential-expense share
# ---------------------------------------------------------------------------


def test_no_essential_category_is_a_distinct_cause_from_a_short_history():
    """Mirrors `runway._reason_no_essential_category`: with nothing flagged
    essential, no length of history would ever produce a measurement, so the
    sentence must not blame the month count."""
    report = _score(essential_category_count=0, essential_months_observed=0)
    component = next(c for c in report.components if c.key == "essential_share")
    assert component.unavailable_reason == (
        "La part de vos dépenses essentielles n'a aucune dépense à mesurer : aucune "
        "catégorie n'est marquée essentielle."
    )
    assert not any(character.isdigit() for character in component.unavailable_reason)


def test_an_essential_category_with_too_little_history_is_worded_differently():
    """A category IS marked essential, but only one complete month carries
    that spending -- a genuinely different cause from no category at all, and
    it must count the ACTUAL observed months, singular here."""
    report = _score(essential_category_count=1, essential_months_observed=1)
    component = next(c for c in report.components if c.key == "essential_share")
    assert component.unavailable_reason == (
        "La part de vos dépenses essentielles n'a pas pu être mesurée : un seul "
        "mois complet porte ce type de dépense, et il en faut au moins trois."
    )


def test_essential_share_with_a_category_but_zero_observed_months():
    """The category IS marked essential, but it has never had a complete
    month with spending in it -- observed=0 with a category present, a
    different shape from 'no category at all' and worded accordingly."""
    report = _score(essential_category_count=1, essential_months_observed=0)
    component = next(c for c in report.components if c.key == "essential_share")
    assert component.unavailable_reason == (
        "La part de vos dépenses essentielles n'a pas pu être mesurée : aucun mois "
        "complet ne porte ce type de dépense, et il en faut au moins trois."
    )


def test_essential_share_insufficient_months_is_worded_in_the_plural():
    report = _score(essential_category_count=1, essential_months_observed=2)
    component = next(c for c in report.components if c.key == "essential_share")
    assert component.unavailable_reason == (
        "La part de vos dépenses essentielles n'a pas pu être mesurée : seuls 2 mois "
        "complets portent ce type de dépense, et il en faut au moins trois."
    )


def test_essential_share_names_a_non_positive_income_with_correct_agreement():
    """The essential-share clause is feminine ('La part ... exprimée'), unlike
    savings rate's masculine 'exprimé' -- both share the income-cause
    sentence-builder, so this pins that the agreement is not swapped."""
    report = _score(essential_expense_rate=_rate(20_000), essential_category_count=1,
                    essential_months_observed=3, income_rate=_rate(0))
    component = next(c for c in report.components if c.key == "essential_share")
    assert component.unavailable_reason == (
        "La part de vos dépenses essentielles ne peut pas être exprimée en part du "
        "revenu : le revenu médian mesuré sur vos relevés n'est pas positif."
    )


def test_essential_share_names_income_when_the_essential_rate_did_measure():
    """`essential_expense_rate` succeeded; `income_rate` did not. The reason
    must name the INCOME cause, not repeat the essential-months wording --
    the essential half of the measurement is not what failed here."""
    report = _score(essential_expense_rate=_rate(20_000), essential_category_count=1,
                    essential_months_observed=3)
    component = next(c for c in report.components if c.key == "essential_share")
    assert "revenu" in component.unavailable_reason
    assert "essentielle" not in component.unavailable_reason.split(":")[1]


def test_essential_share_scores_down_as_the_ratio_rises():
    """The inverse direction from savings rate: half of income or less spent
    on essentials is full marks, all of it is none."""
    half = _score(essential_expense_rate=_rate(50_000), essential_category_count=1,
                  essential_months_observed=3, income_rate=_rate(100_000))
    all_of_it = _score(essential_expense_rate=_rate(100_000), essential_category_count=1,
                       essential_months_observed=3, income_rate=_rate(100_000))
    assert next(c for c in half.components if c.key == "essential_share").score == 100
    assert next(c for c in all_of_it.components if c.key == "essential_share").score == 0


# ---------------------------------------------------------------------------
# Runway
# ---------------------------------------------------------------------------


def test_runway_unavailable_reason_passes_through_verbatim():
    """`runway.py` already carries the correct, reviewed wording for its own
    refusal -- this component republishes it rather than writing a second,
    possibly drifting sentence for the identical fact."""
    report = _score(runway_normal_months=None,
                    runway_unavailable_reason="Pas assez d'historique, spécifiquement.")
    component = next(c for c in report.components if c.key == "runway")
    assert component.score is None
    assert component.unavailable_reason == "Pas assez d'historique, spécifiquement."


def test_runway_score_is_linear_up_to_six_months_and_clamped_beyond():
    zero = _score(runway_normal_months=0.0)
    six = _score(runway_normal_months=6.0)
    twenty = _score(runway_normal_months=20.0)
    assert next(c for c in zero.components if c.key == "runway").score == 0
    assert next(c for c in six.components if c.key == "runway").score == 100
    assert next(c for c in twenty.components if c.key == "runway").score == 100


# ---------------------------------------------------------------------------
# Budget adherence
# ---------------------------------------------------------------------------


def test_no_budget_outcomes_at_all_is_worded_as_never_tracked():
    report = _score(budget_outcomes=[])
    component = next(c for c in report.components if c.key == "budget_adherence")
    assert component.unavailable_reason == (
        "Aucun budget n'a encore été suivi sur un mois complet : l'adhérence aux "
        "budgets ne peut pas être mesurée."
    )


def test_one_budget_outcome_is_worded_in_the_singular():
    report = _score(budget_outcomes=[0.5])
    component = next(c for c in report.components if c.key == "budget_adherence")
    assert component.unavailable_reason == (
        "Un seul mois de suivi budgétaire a pu être mesuré : il en faut au moins 3 "
        "pour que l'adhérence aux budgets veuille dire quelque chose."
    )


def test_two_budget_outcomes_are_worded_in_the_plural():
    report = _score(budget_outcomes=[0.5, 1.1])
    component = next(c for c in report.components if c.key == "budget_adherence")
    assert component.unavailable_reason == (
        "Seuls 2 mois de suivi budgétaire ont pu être mesurés : il en faut au moins "
        "3 pour que l'adhérence aux budgets veuille dire quelque chose."
    )


def test_a_ratio_of_exactly_one_counts_as_over_not_respected():
    """Matches `budget.py`'s own convention: reaching the ceiling exactly
    already counts as breached ('remaining_cents' hits zero, `status`
    becomes 'over' at that same instant). Only 0,9 here is genuinely under;
    1,0 and 1,5 both count against the share, so 1 respected out of 3 is
    33 %, not 67 % (which is what a `<=` comparison would have produced)."""
    report = _score(budget_outcomes=[0.9, 1.0, 1.5])
    component = next(c for c in report.components if c.key == "budget_adherence")
    assert round(component.measured_value, 4) == round(1 / 3, 4)
    assert component.score == 33


def test_every_budget_within_ceiling_scores_full_marks():
    report = _score(budget_outcomes=[0.1, 0.5, 0.99])
    component = next(c for c in report.components if c.key == "budget_adherence")
    assert component.measured_value == 1.0
    assert component.score == 100
