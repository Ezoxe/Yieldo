"""The financial health score: four measured components, one blended figure.

Design §6.2: "le score et ses composantes suivis dans le temps, avec ce qui
l'a fait bouger." This module builds ONE snapshot -- the score and its
components as they stand today. The history and the delta ("ce qui l'a fait
bouger") come from comparing two snapshots, which is `health_snapshots`
(Task 3) and the read path (Task 5)'s job, not this one's.

**Four components, each measured from the household's own ledger, never
declared:**

* *savings rate* -- `capacity.measure_savings_capacity` over
  `capacity.measure_income_rate`, both already requiring three complete
  observed months on their own account;
* *essential-expense share* -- `capacity.measure_expense_rate` restricted to
  essential-tagged spending, over the same income rate. The essential half is
  built by the caller exactly as `runway.py` documents: `complete_months`
  over the ledger's own bounds, filtered to `is_essential` categories;
* *runway* -- `runway.compute_runway(...).normal`, taken as already computed
  by the caller so this module never re-derives a measurement another engine
  owns;
* *budget adherence* -- the share of (category, complete past month) budget
  outcomes that did not go over. Each outcome is a `consumed_ratio` from
  `budget.evaluate_budgets`, called by the caller once per COMPLETE past
  month (never the live one, where almost everything reads "ok" for no
  better reason than the month having barely started).

**A component that could not be measured is not zero.** Each has its own
`unavailable_reason`, and the household's score is computed from whichever
components DID measure, never by treating an absent one as the worst possible
score. `HealthScore.score` is `None` below two measurable components: a
figure blended from a single measurement is one number wearing an average's
clothes, and the household is told plainly which components stood and why
the rest could not.

**No weight is a quantity the data controls.** `SAVINGS_RATE_WEIGHT`,
`ESSENTIAL_SHARE_WEIGHT`, `RUNWAY_WEIGHT` and `BUDGET_ADHERENCE_WEIGHT` are
fixed integers summing to 100, defined once below and never touched by how
much data exists, how many months are observed, or how many categories carry
a budget. That is precisely the failure two rankings in phase 2A shipped and
were fixed for -- a metric whose value moved with the SIZE of its own sample
rather than with what it was measuring (`git log --grep "not a metric with a
denominator"`). When fewer than four components measure, the blend
renormalises over the AVAILABLE components' fixed weights (their sum, whatever
subset is present) -- a deterministic function of which components succeeded,
never of a magnitude like sample size.

**Every per-component threshold is a published personal-finance benchmark,
not a tuned knob**, exactly like `robust.py`'s outlier constants are the
literature's, not this codebase's own invention:

* 20 % savings rate and a 50 % ceiling on essential expenses -- the "50/30/20"
  budgeting rule (50 % needs, 30 % wants, 20 % savings), the standard
  reference point in French and English personal-finance guidance alike;
* six months of runway -- the upper end of the "3 à 6 mois de dépenses"
  emergency-fund guideline, taken conservatively;
* budget adherence needs no external benchmark: 0 % and 100 % are its own
  natural ends, since it is already a share.

Pure: no session, no network, no implicit clock. This module reads no clock
at all -- every input it takes is already a measurement, made elsewhere at
whatever `today` the caller used.
"""

from dataclasses import dataclass

from app.engines.capacity import MeasuredRate

COMPONENT_KEYS = ("savings_rate", "essential_share", "runway", "budget_adherence")

# Fixed, documented, and summing to 100. Savings rate carries the most weight
# because it is the single most direct signal of trajectory -- whether the
# household is getting ahead or falling behind. Essential share and runway are
# the two "safety margin" measures and are weighted equally. Budget adherence
# is weighted lowest: it measures discipline against a DECLARED ceiling, not
# the household's underlying position, and a household with no budgets at all
# is not thereby unhealthy.
SAVINGS_RATE_WEIGHT = 30
ESSENTIAL_SHARE_WEIGHT = 25
RUNWAY_WEIGHT = 25
BUDGET_ADHERENCE_WEIGHT = 20

# A score needs at least this many measurable components to be a blend rather
# than a single figure wearing an average's clothes.
MIN_MEASURABLE_COMPONENTS = 2

# Three months is the floor at which a fraction of (category, month) budget
# outcomes means anything at all -- the same floor `capacity.MIN_MONTHS_FOR_RATE`
# sets for a median, applied here to a count instead.
MIN_BUDGET_OUTCOMES = 3

# 50/30/20: 20 % of income saved is full marks, 0 % or below is none.
SAVINGS_RATE_ZERO_AT = 0.0
SAVINGS_RATE_FULL_AT = 0.20

# 50/30/20's "needs" ceiling: half of income or less spent on essentials is
# full marks, all (or more) of it is none.
ESSENTIAL_SHARE_ZERO_AT = 1.0
ESSENTIAL_SHARE_FULL_AT = 0.5

# The conservative end of the standard 3-to-6-months emergency-fund guideline.
RUNWAY_ZERO_AT = 0.0
RUNWAY_FULL_AT = 6.0


@dataclass(frozen=True)
class HealthComponent:
    key: str
    label: str
    # Fixed percentage points out of 100 -- see the module docstring. Present
    # even when this component is unavailable, since it is a property of the
    # SCORE's design, not of what could be measured this time.
    weight: int
    # 0-100, this component's own contribution. `None` exactly when
    # `unavailable_reason` is set.
    score: int | None
    # The raw measured figure behind `score` -- a ratio for the first two, a
    # month count for runway, a share for budget adherence -- so a screen can
    # print "12,4 %" or "4,2 mois" rather than only a 0-100 index. `None`
    # exactly when `unavailable_reason` is set.
    measured_value: float | None
    # French. `None` exactly when `score` is not.
    unavailable_reason: str | None


@dataclass(frozen=True)
class HealthScore:
    # 0-100, or `None` below `MIN_MEASURABLE_COMPONENTS` measurable
    # components.
    score: int | None
    components: list[HealthComponent]
    # French. Set exactly when `score` is `None`, and names which components
    # DID measure (the rest have their own reason visible on `components`
    # already -- repeating each one here would be the same fact printed
    # twice).
    unavailable_reason: str | None


def _linear_score(value: float, value_for_zero: float, value_for_hundred: float) -> int:
    """0-100, linear between the two anchors, clamped beyond either.

    Works in both directions: `value_for_hundred` may be above OR below
    `value_for_zero` -- essential share scores DOWN as the ratio rises,
    savings rate and runway score UP. The caller's two anchors carry the
    direction; this function has no opinion of its own.
    """
    span = value_for_hundred - value_for_zero
    ratio = (value - value_for_zero) / span
    return round(max(0.0, min(1.0, ratio)) * 100)


def _reason_income_not_measured(subject_clause: str) -> str:
    """`subject_clause` carries its OWN gender agreement fully conjugated --
    "Votre taux d'épargne ne peut pas être exprimé..." is masculine, "La part
    de vos dépenses essentielles ne peut pas être exprimée..." is feminine,
    and a shared function guessing the ending from a bare noun would get one
    of the two wrong."""
    return (
        f"{subject_clause} : votre revenu n'a pas pu être mesuré, faute d'au moins "
        "trois mois complets de relevés."
    )


def _reason_income_not_positive(subject_clause: str) -> str:
    return f"{subject_clause} : le revenu médian mesuré sur vos relevés n'est pas positif."


def _reason_savings_capacity_unmeasurable() -> str:
    return (
        "Votre capacité d'épargne n'a pas pu être mesurée : il faut au moins trois "
        "mois complets de relevés pour en tirer une médiane."
    )


def _reason_no_essential_category() -> str:
    return (
        "La part de vos dépenses essentielles n'a aucune dépense à mesurer : aucune "
        "catégorie n'est marquée essentielle."
    )


def _reason_essential_months_insufficient(observed: int) -> str:
    if observed == 0:
        carrying = "aucun mois complet ne porte ce type de dépense"
    elif observed == 1:
        carrying = "un seul mois complet porte ce type de dépense"
    else:
        carrying = f"seuls {observed} mois complets portent ce type de dépense"
    return (
        f"La part de vos dépenses essentielles n'a pas pu être mesurée : {carrying}, "
        "et il en faut au moins trois."
    )


def _reason_no_budget_outcomes() -> str:
    return (
        "Aucun budget n'a encore été suivi sur un mois complet : l'adhérence aux "
        "budgets ne peut pas être mesurée."
    )


def _reason_budget_outcomes_insufficient(observed: int) -> str:
    if observed == 1:
        span = "Un seul mois de suivi budgétaire a pu être mesuré"
    else:
        span = f"Seuls {observed} mois de suivi budgétaire ont pu être mesurés"
    return (
        f"{span} : il en faut au moins {MIN_BUDGET_OUTCOMES} pour que l'adhérence aux "
        "budgets veuille dire quelque chose."
    )


def _savings_rate_component(
    savings_capacity: MeasuredRate | None, income_rate: MeasuredRate | None
) -> HealthComponent:
    clause = "Votre taux d'épargne ne peut pas être exprimé en part du revenu"
    if savings_capacity is None:
        return HealthComponent(key="savings_rate", label="Taux d'épargne",
                               weight=SAVINGS_RATE_WEIGHT, score=None, measured_value=None,
                               unavailable_reason=_reason_savings_capacity_unmeasurable())
    if income_rate is None:
        return HealthComponent(key="savings_rate", label="Taux d'épargne",
                               weight=SAVINGS_RATE_WEIGHT, score=None, measured_value=None,
                               unavailable_reason=_reason_income_not_measured(clause))
    if income_rate.median_cents <= 0:
        return HealthComponent(key="savings_rate", label="Taux d'épargne",
                               weight=SAVINGS_RATE_WEIGHT, score=None, measured_value=None,
                               unavailable_reason=_reason_income_not_positive(clause))

    ratio = savings_capacity.median_cents / income_rate.median_cents
    score = _linear_score(ratio, SAVINGS_RATE_ZERO_AT, SAVINGS_RATE_FULL_AT)
    return HealthComponent(key="savings_rate", label="Taux d'épargne",
                           weight=SAVINGS_RATE_WEIGHT, score=score, measured_value=ratio,
                           unavailable_reason=None)


def _essential_share_component(
    essential_expense_rate: MeasuredRate | None,
    essential_category_count: int,
    essential_months_observed: int,
    income_rate: MeasuredRate | None,
) -> HealthComponent:
    clause = "La part de vos dépenses essentielles ne peut pas être exprimée en part du revenu"
    if essential_expense_rate is None:
        if essential_category_count == 0 and essential_months_observed == 0:
            reason = _reason_no_essential_category()
        else:
            reason = _reason_essential_months_insufficient(essential_months_observed)
        return HealthComponent(key="essential_share", label="Part des dépenses essentielles",
                               weight=ESSENTIAL_SHARE_WEIGHT, score=None, measured_value=None,
                               unavailable_reason=reason)
    if income_rate is None:
        return HealthComponent(key="essential_share", label="Part des dépenses essentielles",
                               weight=ESSENTIAL_SHARE_WEIGHT, score=None, measured_value=None,
                               unavailable_reason=_reason_income_not_measured(clause))
    if income_rate.median_cents <= 0:
        return HealthComponent(key="essential_share", label="Part des dépenses essentielles",
                               weight=ESSENTIAL_SHARE_WEIGHT, score=None, measured_value=None,
                               unavailable_reason=_reason_income_not_positive(clause))

    ratio = essential_expense_rate.median_cents / income_rate.median_cents
    score = _linear_score(ratio, ESSENTIAL_SHARE_ZERO_AT, ESSENTIAL_SHARE_FULL_AT)
    return HealthComponent(key="essential_share", label="Part des dépenses essentielles",
                           weight=ESSENTIAL_SHARE_WEIGHT, score=score, measured_value=ratio,
                           unavailable_reason=None)


def _runway_component(
    runway_normal_months: float | None, runway_unavailable_reason: str | None
) -> HealthComponent:
    if runway_normal_months is None:
        return HealthComponent(key="runway", label="Autonomie financière",
                               weight=RUNWAY_WEIGHT, score=None, measured_value=None,
                               unavailable_reason=runway_unavailable_reason)
    score = _linear_score(runway_normal_months, RUNWAY_ZERO_AT, RUNWAY_FULL_AT)
    return HealthComponent(key="runway", label="Autonomie financière", weight=RUNWAY_WEIGHT,
                           score=score, measured_value=runway_normal_months,
                           unavailable_reason=None)


def _budget_adherence_component(budget_outcomes: list[float]) -> HealthComponent:
    if len(budget_outcomes) < MIN_BUDGET_OUTCOMES:
        reason = (
            _reason_no_budget_outcomes() if not budget_outcomes
            else _reason_budget_outcomes_insufficient(len(budget_outcomes))
        )
        return HealthComponent(key="budget_adherence", label="Adhérence aux budgets",
                               weight=BUDGET_ADHERENCE_WEIGHT, score=None, measured_value=None,
                               unavailable_reason=reason)

    respected = sum(1 for ratio in budget_outcomes if ratio < 1.0)
    share = respected / len(budget_outcomes)
    score = _linear_score(share, 0.0, 1.0)
    return HealthComponent(key="budget_adherence", label="Adhérence aux budgets",
                           weight=BUDGET_ADHERENCE_WEIGHT, score=score, measured_value=share,
                           unavailable_reason=None)


def _reason_too_few_components(components: list[HealthComponent]) -> str:
    """Called only when fewer than `MIN_MEASURABLE_COMPONENTS` (2) components
    measured -- `measured` below therefore holds 0 or 1 items, never more."""
    measured = [c.label for c in components if c.score is not None]
    named = (
        "aucune composante n'a pu être mesurée" if not measured
        else f"seule la composante « {measured[0]} » a pu être mesurée"
    )
    return (
        f"Le score de santé financière ne peut pas être calculé : {named}, et il en "
        f"faut au moins {MIN_MEASURABLE_COMPONENTS} sur {len(components)}. Le détail de "
        "chaque composante ci-dessous explique pourquoi."
    )


def compute_health_score(
    savings_capacity: MeasuredRate | None,
    income_rate: MeasuredRate | None,
    essential_expense_rate: MeasuredRate | None,
    essential_category_count: int,
    essential_months_observed: int,
    runway_normal_months: float | None,
    runway_unavailable_reason: str | None,
    budget_outcomes: list[float],
) -> HealthScore:
    """The score and its four components, exactly as measured.

    Every measurement above is taken as already computed by the caller --
    `capacity.measure_savings_capacity`, `capacity.measure_income_rate`,
    `capacity.measure_expense_rate` over essential-tagged months,
    `runway.compute_runway(...).normal`, and one `budget.evaluate_budgets`
    call per complete past month -- so this module never re-derives a
    measurement another engine owns, and never reads a clock of its own.
    """
    components = [
        _savings_rate_component(savings_capacity, income_rate),
        _essential_share_component(essential_expense_rate, essential_category_count,
                                   essential_months_observed, income_rate),
        _runway_component(runway_normal_months, runway_unavailable_reason),
        _budget_adherence_component(budget_outcomes),
    ]

    measured = [c for c in components if c.score is not None]
    if len(measured) < MIN_MEASURABLE_COMPONENTS:
        return HealthScore(score=None, components=components,
                           unavailable_reason=_reason_too_few_components(components))

    total_weight = sum(c.weight for c in measured)
    blended = sum(c.score * c.weight for c in measured) / total_weight
    score = max(0, min(100, round(blended)))
    return HealthScore(score=score, components=components, unavailable_reason=None)
