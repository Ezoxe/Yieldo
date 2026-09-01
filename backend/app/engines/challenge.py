"""Data-derived challenges: concrete proposals built only from measurements
four sibling engines already made -- never a decorative badge, never a claim
this module cannot back with a number.

Design §6.2, "défis dérivés des données": "trois abonnements à 34 €/mois
inutilisés depuis six mois", "ramener Restaurants au niveau de 2025 libère
87 €/mois", "acceptables ou rejetables, avec suivi du résultat réel le mois
suivant." Four proposers below, each reading one already-shipped engine's own
output and nothing else:

* `propose_subscription_challenges` -- `engines/recurrence.py`'s detected
  subscriptions;
* `propose_category_level_challenges` -- `engines/inflation.py`'s
  category-vs-a-year-ago comparison;
* `propose_anomaly_challenges` -- `engines/anomaly.py`'s flagged transactions;
* `propose_budget_overrun_challenges` -- `engines/budget.py`'s monthly
  outcomes, aggregated by the caller across several complete past months.

**"Inutilisé" is never claimed.** Yieldo has no usage signal for a
subscription -- no login log, no app-open event, only the bank charge itself.
Claiming a subscription is *unused* would be exactly the class-1 failure this
project keeps paying for: a sentence naming a cause that was never measured.
Every subscription proposal here states only what was measured -- that the
charge recurs, and what it costs -- and leaves "do you still want this" to the
household, not to a claim this module cannot support.

**Every proposal carries `target_cents` and a `detail` sentence naming what
was measured it over.** `target_cents` is never a formatted euro string inside
the sentence -- no engine in this codebase formats money into text (`CLAUDE.md`:
"convert to Decimal only at the display boundary"), so it is always a plain
integer field the caller/frontend renders. The sentence instead names the
*span* the figure rests on -- a month count, an occurrence count, a "N mois
sur M suivis" -- in the same style every other engine's French reasons already
use (`inflation.py`'s `_reason_line`, `health.py`'s `_reason_*`). A proposal
that cannot be given a positive, honestly-measured `target_cents` is never
built at all: no function below ever appends a `ChallengeProposal` carrying an
unmeasured or non-positive figure. Category names are looked up by the
caller and handed in as plain strings (`category_names: dict[int, str]`) --
this module never touches a session, exactly like `RunwayScenario`'s fixed
French labels or `CostItem.label` elsewhere in this codebase.

**`target_cents` and `measure_outcome`'s result are deliberately two
different figures, not one round-tripped number.** `target_cents` is the
figure that JUSTIFIES proposing the challenge (a subscription's monthly cost,
a category's freed amount, an anomaly's excess, a budget's typical overage) --
it is descriptive of the PAST. The outcome, once measurable, is a genuine
before/after comparison of the challenge's own category: what that category
spent in the complete month right before acceptance, against what it spent in
the complete month right after. This is symmetric across every kind, needs no
per-kind "did they actually cancel exactly this line" heuristic that this
module has no data to support, and is exactly as honest as everything else in
this codebase measures a category: at category granularity, the same
granularity `budget.py`, `inflation.py` and `runway.py` already work at.

**`measure_outcome` distinguishes four refusals, never a zero:**

1. the challenge carries no category at all (`category_id is None`) -- no
   scope exists to measure an outcome against, and this is structural, not a
   matter of elapsed time;
2. not enough time has elapsed since acceptance -- the month right after
   `decided_on` has not finished yet. This is checked from `decided_on` and
   `today` alone, never from whether the caller happened to supply data;
3. that month HAS finished, but no statement covers it yet (the caller's
   `after` is absent or names a different month) -- a "not imported yet"
   refusal, distinct from #2 even though both leave `measured_cents` unset;
4. the month right BEFORE acceptance was never observed either, so there is
   no baseline to compare against.

Only past refusal #2/#3/#4 does `measured_cents` become the caller-verifiable
`before.spent_cents - after.spent_cents`: positive when the category spent
less the month after acceptance than the month before, negative when it spent
more. Never a zero standing in for any of the four refusals above.

Pure: no session, no network, no implicit clock -- `today` is a parameter, and
every date this module touches is one the caller already measured.
"""

from dataclasses import dataclass
from datetime import date
from typing import Literal

from app.engines.aggregate import bucket_key
from app.engines.anomaly import Anomaly, AnomalyTx
from app.engines.inflation import CategoryInflation
from app.engines.period import month_end
from app.engines.recurrence import Recurrence
from app.engines.robust import median_cents

ChallengeKind = Literal[
    "unused_subscription", "category_above_past_level", "anomaly", "budget_overrun",
]

# Below three, a budget "repeatedly" over its ceiling cannot be told apart
# from one bad month -- the same floor `health.py`'s `MIN_BUDGET_OUTCOMES`
# sets for the identical reason, applied here per category instead of across
# the whole household.
MIN_OVERRUN_MONTHS = 3

_PERIODICITY_LABELS: dict[str, str] = {
    "weekly": "chaque semaine",
    "biweekly": "toutes les deux semaines",
    "monthly": "chaque mois",
    "quarterly": "chaque trimestre",
    "yearly": "chaque année",
}


@dataclass(frozen=True)
class ChallengeProposal:
    """Not yet persisted -- the caller decides whether an equivalent
    `Challenge` row already exists (`proposed`, `accepted` or `rejected`)
    before writing a new one. Every field here maps directly onto a column of
    `models.Challenge`."""

    kind: ChallengeKind
    title: str
    detail: str
    # Always a positive magnitude when set. Never `None` in practice here --
    # every proposer below only appends a proposal once it has a genuine,
    # positive figure to attach -- but stays optional to match the column's
    # own nullability (`models.Challenge.target_cents`), which some FUTURE
    # challenge kind may need to leave unset.
    target_cents: int | None
    category_id: int | None


@dataclass(frozen=True)
class ChallengeContext:
    """The minimal shape `measure_outcome` needs from a persisted, accepted
    `Challenge` row. Deliberately not the ORM object."""

    category_id: int | None
    decided_on: date


@dataclass(frozen=True)
class MonthSpend:
    """One category's total spend in one complete calendar month, as a
    positive magnitude -- the caller's own aggregation, built the same way
    `budgets.py`'s `spent_by_category` already is. Absence (`None`, not this
    dataclass with a zero) is how the caller tells `measure_outcome` that a
    month was never observed at all, exactly the distinction
    `capacity.complete_months` exists to preserve elsewhere in this codebase.
    """

    key: str  # "YYYY-MM"
    spent_cents: int


@dataclass(frozen=True)
class ChallengeOutcome:
    # Positive: the category spent less the month after acceptance than the
    # month before. Negative: it spent more. `None` exactly when
    # `unavailable_reason` is set -- see the module docstring's four causes.
    measured_cents: int | None
    measured_on: date | None
    unavailable_reason: str | None


def _months_span(first_on: date, last_on: date) -> int:
    """Inclusive whole-calendar-month count from `first_on`'s month through
    `last_on`'s -- the same arithmetic `api/cashflow.py`'s
    `_ledger_span_months` already uses for an identical purpose."""
    return (last_on.year - first_on.year) * 12 + (last_on.month - first_on.month) + 1


def propose_subscription_challenges(recurrences: list[Recurrence]) -> list[ChallengeProposal]:
    """One proposal per still-active, cost-quantified recurring expense.

    `status == "active"` only: a `missing` or `ended` recurrence has already
    stopped, or is already in enough doubt that proposing to cancel it says
    nothing new. `annualisable` only: `recurrence.py`'s own docstring is
    explicit that a run under a full billing quarter cannot honestly be
    projected into a yearly figure, and this module's `target_cents` is
    exactly such a figure (via the subscription's own monthly amount). Income
    recurrences (`amount_cents >= 0`, e.g. a salary paid on a fixed date) are
    never proposed -- there is nothing to "cancel" about being paid.
    """
    proposals = []
    for recurrence in recurrences:
        if (recurrence.status != "active" or not recurrence.annualisable
                or recurrence.amount_cents >= 0):
            continue
        months = _months_span(recurrence.first_on, recurrence.last_on)
        rhythm = _PERIODICITY_LABELS[recurrence.periodicity]
        proposals.append(ChallengeProposal(
            kind="unused_subscription",
            title=f"Abonnement « {recurrence.label} »",
            detail=(
                f"Prélèvement récurrent {rhythm}, mesuré sur "
                f"{recurrence.occurrences} occurrences en {months} mois."
            ),
            target_cents=abs(recurrence.amount_cents),
            category_id=recurrence.category_id,
        ))
    proposals.sort(key=lambda p: p.target_cents or 0, reverse=True)
    return proposals


def propose_category_level_challenges(
    lines: list[CategoryInflation], category_names: dict[int, str]
) -> list[ChallengeProposal]:
    """One proposal per category that genuinely costs more than its own level
    a year ago -- `compute_inflation`'s own per-observed-month, honestly-gated
    comparison (see that module's docstring), never a window total.

    Only `comparable` lines (both windows already cleared
    `inflation.MIN_MONTHS_PER_WINDOW`) and only a genuine rise
    (`delta_cents > 0`) -- a category that got CHEAPER is already a win, not a
    challenge. The "Non catégorisé" bucket (`category_id is None`) is never
    proposed: there is no single category to name or to track an outcome
    against. A category whose name could not be resolved by the caller (e.g.
    deleted since) is skipped for the identical reason.
    """
    proposals = []
    for line in lines:
        if not line.comparable or line.category_id is None or line.delta_cents <= 0:
            continue
        name = category_names.get(line.category_id)
        if name is None:
            continue
        proposals.append(ChallengeProposal(
            kind="category_above_past_level",
            title=f"« {name} » au-dessus de son niveau d'il y a un an",
            detail=(
                f"La catégorie « {name} » coûte plus cher que son propre "
                f"niveau d'il y a un an, comparée sur {line.months_current} "
                f"mois récents contre {line.months_previous} mois un an plus "
                "tôt."
            ),
            target_cents=line.delta_cents,
            category_id=line.category_id,
        ))
    proposals.sort(key=lambda p: p.target_cents or 0, reverse=True)
    return proposals


def _group_observation_counts(history: list[AnomalyTx]) -> dict[tuple[int, str], int]:
    """Recount each (category, sign) group's own observation total exactly as
    `detect_anomalies` did internally -- see `propose_anomaly_challenges`."""
    counts: dict[tuple[int, str], int] = {}
    for row in history:
        if row.category_id is None:
            continue
        sign = "expense" if row.amount_cents < 0 else "income"
        counts[(row.category_id, sign)] = counts.get((row.category_id, sign), 0) + 1
    return counts


def propose_anomaly_challenges(
    anomalies: list[Anomaly], history: list[AnomalyTx]
) -> list[ChallengeProposal]:
    """One proposal per unusually large EXPENSE `detect_anomalies` flagged.

    Only `direction == "high"` on an expense (`amount_cents < 0`): a `"low"`
    anomaly is spending LESS than usual, and an anomalous income is not
    something to challenge into spending less. `history` must be the SAME
    full ledger `detect_anomalies` was given -- this function recounts each
    (category, sign) group's own size from it (`_group_observation_counts`),
    exactly as that engine did internally, so the sentence can name a real
    observation count rather than only the `anomaly.MIN_HISTORY` floor every
    flagged row already cleared.
    """
    counts = _group_observation_counts(history)
    proposals = []
    for anomaly in anomalies:
        if anomaly.direction != "high" or anomaly.amount_cents >= 0:
            continue
        excess = abs(anomaly.amount_cents) - anomaly.category_median_cents
        if excess <= 0:
            continue
        observations = counts.get((anomaly.category_id, "expense"), 0)
        proposals.append(ChallengeProposal(
            kind="anomaly",
            title=f"Dépense inhabituelle : {anomaly.label}",
            detail=(
                "Cette opération s'écarte fortement de l'historique de sa "
                f"catégorie, mesuré sur {observations} opérations."
            ),
            target_cents=excess,
            category_id=anomaly.category_id,
        ))
    proposals.sort(key=lambda p: p.target_cents or 0, reverse=True)
    return proposals


@dataclass(frozen=True)
class BudgetMonthOutcome:
    """One category's declared budget against what it actually spent, in one
    complete PAST calendar month. The caller builds one of these per
    (budgeted category, complete past month) -- never the live month, see
    `propose_budget_overrun_challenges`'s own docstring."""

    category_id: int
    month_key: str
    budget_cents: int
    spent_cents: int  # positive magnitude


def propose_budget_overrun_challenges(
    outcomes: list[BudgetMonthOutcome], category_names: dict[int, str]
) -> list[ChallengeProposal]:
    """One proposal per category whose declared budget was exceeded in at
    least `MIN_OVERRUN_MONTHS` of its own observed complete past months.

    `outcomes` must already be scoped to complete PAST months only (never the
    live one, whose partial spend would read as "under budget" for no better
    reason than the month having barely started -- the identical trap
    `health.py`'s own `budget_outcomes` docstring names) and to budgeted
    categories only. This function does no clock arithmetic of its own and
    trusts the caller's scoping entirely -- the same contract
    `compute_health_score`'s `budget_outcomes` parameter carries.

    `target_cents` is the MEDIAN overage across the overrun months
    (`spent_cents - budget_cents`, always positive on those rows by
    definition) -- a typical excess, not the worst one, so a single very bad
    month cannot make an otherwise mild pattern look dramatic.
    """
    by_category: dict[int, list[BudgetMonthOutcome]] = {}
    for outcome in outcomes:
        by_category.setdefault(outcome.category_id, []).append(outcome)

    proposals = []
    for category_id, rows in by_category.items():
        overrun = [row for row in rows if row.spent_cents >= row.budget_cents]
        if len(overrun) < MIN_OVERRUN_MONTHS:
            continue
        name = category_names.get(category_id)
        if name is None:
            continue
        typical_overage = median_cents([row.spent_cents - row.budget_cents for row in overrun])
        proposals.append(ChallengeProposal(
            kind="budget_overrun",
            title=f"Budget « {name} » dépassé",
            detail=(
                f"Le budget de la catégorie « {name} » a été dépassé "
                f"{len(overrun)} mois sur {len(rows)} suivis."
            ),
            target_cents=typical_overage,
            category_id=category_id,
        ))
    proposals.sort(key=lambda p: p.target_cents or 0, reverse=True)
    return proposals


def _reason_no_category() -> str:
    return (
        "Le résultat de ce défi ne peut pas être mesuré : aucune catégorie "
        "n'y est associée."
    )


def _reason_not_enough_time_elapsed() -> str:
    return (
        "Pas assez de temps écoulé depuis l'acceptation de ce défi : le "
        "résultat n'est mesurable qu'une fois le mois suivant entièrement "
        "terminé."
    )


def _reason_month_not_imported() -> str:
    return (
        "Le mois suivant l'acceptation de ce défi est terminé, mais aucun "
        "relevé n'a encore été importé pour cette période : le résultat ne "
        "peut pas encore être mesuré."
    )


def _reason_no_baseline() -> str:
    return (
        "Le résultat de ce défi ne peut pas être mesuré : le mois précédant "
        "son acceptation n'a pas de relevé importé pour servir de "
        "comparaison."
    )


def measure_outcome(
    challenge: ChallengeContext,
    before: MonthSpend | None,
    after: MonthSpend | None,
    today: date,
) -> ChallengeOutcome:
    """What actually happened to `challenge`'s own category, the complete
    month after it was accepted, against the complete month right before.

    See the module docstring for the four distinct refusals and why "not
    enough time has elapsed" is never conflated with "the month elapsed but
    was never imported", nor either with a zero saving. `before` and `after`
    are validated against the month keys this function itself derives from
    `challenge.decided_on` -- a caller-supplied observation naming a
    different month is treated exactly like an absent one, never trusted at
    face value.
    """
    if challenge.category_id is None:
        return ChallengeOutcome(measured_cents=None, measured_on=None,
                                unavailable_reason=_reason_no_category())

    next_month_end = month_end(challenge.decided_on, 1)
    if today <= next_month_end:
        return ChallengeOutcome(measured_cents=None, measured_on=None,
                                unavailable_reason=_reason_not_enough_time_elapsed())

    after_key = bucket_key(next_month_end, "month")
    if after is None or after.key != after_key:
        return ChallengeOutcome(measured_cents=None, measured_on=None,
                                unavailable_reason=_reason_month_not_imported())

    before_key = bucket_key(month_end(challenge.decided_on, -1), "month")
    if before is None or before.key != before_key:
        return ChallengeOutcome(measured_cents=None, measured_on=None,
                                unavailable_reason=_reason_no_baseline())

    return ChallengeOutcome(
        measured_cents=before.spent_cents - after.spent_cents,
        measured_on=next_month_end,
        unavailable_reason=None,
    )
