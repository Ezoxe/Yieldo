"""« Puis-je m'offrir cette voiture ? » — the answer, with its provenance.

Design §6.3, "le cœur de la demande". This module covers items 1, 2, 4 and 7;
`engines/levers.py` covers 5 and 6, `engines/ownership.py` covers 3.

**The capacity is measured, never declared.** §6.3 item 1: "Capacité d'épargne
réelle, mesurée sur les transactions des douze derniers mois, pas déclarée.
Avec sa variabilité." It arrives here as `capacity.MeasuredRate`, built by
`capacity.measure_savings_capacity` over complete observed months. Read that
module's docstring: months with no imported statement are NOT counted as
zero-spend months, and the sign of a deficit is kept.

**The engine refuses exactly where its input refuses.** `measure_savings_
capacity` returns `None` below three complete observed months. On `None` there
is no verdict, no gap and no projection -- only a French reason naming the
month floor. A verdict manufactured from one or two months would be the single
most damaging number this application could print. That is the ONLY refusal
this engine has, and it is not contagious: the emergency-fund impact, the
opportunity cost and the horizon date do not depend on the capacity and are
still answered on that branch.

**A negative measured capacity is a VERDICT, not a refusal, and it is the
primary case.** The operator's measured capacity is -74 619 c per month and his
liquid balance is -220 963 c. The engine has a figure; the figure says the pot
shrinks. So it answers: `out_of_reach`, with `saved_at_horizon_cents` negative
(-895 428 c over twelve months) and a `gap_cents` of 4 895 428 c -- LARGER than
the 4 000 000 c purchase price. Three things are therefore forbidden here, each
of which would turn that truthful answer into a comfortable lie:

1. **No `abs()` and no clamp** anywhere on the capacity, on a band end, or on a
   projected balance. `abs()` would report his deficit as 8 954,28 EUR of
   savings; `max(0, ...)` would report 0,00 EUR, which reads as "you stood
   still". Pinned by `test_a_negative_capacity_is_never_flipped_positive`.
2. **No interest credited to a non-positive pot.** `savings.project_savings`
   refuses it at source, which is why every projection here goes through that
   function rather than through a local loop. Pinned by
   `test_no_interest_is_credited_to_a_shrinking_pot_while_a_growing_one_earns_it`,
   whose second half is the control proving interest is credited when a pot is
   in fact positive.
3. **No fallback verdict.** `out_of_reach` with a real figure is the answer,
   `None` is the refusal, and there is no third thing. `engines/levers.py` is
   where "what would have to change" is said. Pinned by
   `test_an_unmeasurable_capacity_refuses_rather_than_guessing`.

A negative capacity is also NOT the refusal `goal.evaluate_goals` makes on the
same input. A goal has no down payment; a purchase does, and money already set
aside can reach a target at a flat or negative rate. The two engines diverge
here on purpose.

**The three verdicts are defined by the measured band, not by an invented
margin.** §6.3 item 2 asks for "atteignable confortablement, atteignable en
serrant, hors de portée". Here:

* *comfortable* -- the horizon is reached even when every month runs at the
  band's LOW end (P10 of the observed variability);
* *tight* -- reached at the median, but not at the low end;
* *out_of_reach* -- not reached at the median.

Every threshold therefore comes from the household's own dispersion. A fixed
"10 % of headroom" rule would be exactly the arbitrary threshold design §6.2
forbids for anomaly detection, applied to a bigger decision.

`out_of_reach` is one verdict and not two. Whether the band's optimistic end
would have reached the target is a real distinction for the reader -- "dans un
bon mois c'est jouable" versus "même un bon mois n'y suffit pas", and the
operator's case is the second -- but it is read off
`saved_at_horizon_high_cents`, which is published for that purpose rather than
folded into a fourth verdict value.

**Two of design §6.3 item 7's three components are deliberately absent.** The
emergency-fund impact and a five-year *liquid* trajectory are built here. The
**patrimoine net à horizon cinq ans** needs the investment accounts phase 3
builds, and the **score de santé financière** needs an engine this codebase does
not have (§6.1 lists it among the FinVest engines not yet ported; phase 2C owns
its evolving form). `Impact` carries no field for either, so that no later task
can quietly fill one with a placeholder or a zero. Task 16's screen states both
absences in French instead.

Pure: no session, no network, no implicit clock -- `today` is a parameter.
"""

from dataclasses import dataclass
from datetime import date

from app.engines.capacity import MeasuredRate
from app.engines.ownership import DEFAULT_OWNERSHIP_YEARS, MAX_OWNERSHIP_YEARS
from app.engines.period import month_end
from app.engines.runway import months_of_runway
from app.engines.savings import (
    MAX_PROJECTION_MONTHS,
    opportunity_cost_cents,
    project_savings,
)

VERDICTS = ("comfortable", "tight", "out_of_reach")
NATURES = ("vehicle", "property", "other")

# A horizon this engine accepts must be one `project_savings` will project, so
# the bound is that module's, not a second number that could drift from it.
MAX_HORIZON_MONTHS = MAX_PROJECTION_MONTHS

# Design §6.3 item 7: "à horizon cinq ans". Fixed, and deliberately NOT
# `request.horizon_months` -- reusing the saving horizon would make the
# trajectory answer at a different date from the one the screen labels it with.
LIQUID_HORIZON_MONTHS = 60

# Re-exported: Task 13 builds `Assumptions` beside a `FeasibilityReport` and
# needs the same ownership default `ownership.py` prefills, without importing a
# second module for one screen.
__all__ = [
    "DEFAULT_OWNERSHIP_YEARS",
    "LIQUID_HORIZON_MONTHS",
    "MAX_HORIZON_MONTHS",
    "NATURES",
    "VERDICTS",
    "Assumptions",
    "EmergencyImpact",
    "FeasibilityReport",
    "Impact",
    "PurchaseRequest",
    "assess_feasibility",
]


@dataclass(frozen=True)
class PurchaseRequest:
    target_cents: int
    horizon_months: int
    # Money already set aside for this purchase, today. DECLARED by the user,
    # with no account behind it -- not the liquid balance, since a household
    # can have savings it does not intend to spend on a car, and Yieldo cannot
    # tell which euros in an account are earmarked. `_emergency` therefore does
    # not net it off the balance; see that function.
    down_payment_cents: int
    # One of NATURES. Decides which French cost defaults `ownership.py`
    # prefills, and nothing else here.
    nature: str


@dataclass(frozen=True)
class Assumptions:
    """Every hypothesis, in one place, so a screen can print them beside the
    result -- design §10: "Les hypothèses sont toujours affichées à côté du
    résultat." None of these is measured; all are editable."""

    annual_return_bps: int
    loan_rate_bps: int
    loan_months: int
    ownership_years: int
    # MEASURED, unlike the four above: `capacity.measure_income_rate(...)
    # .median_cents`, or None when it could not be measured. The debt ratio in
    # `engines/levers.py` divides by it and refuses when it is None.
    monthly_income_cents: int | None
    # What the household already pays every month on existing credits, from
    # the `debts` table.
    existing_debt_payments_cents: int


@dataclass(frozen=True)
class EmergencyImpact:
    """§6.3 item 7, the fonds d'urgence half.

    The comparison is made on the liquid balance AS IT STANDS TODAY, with and
    without the purchase price removed. Projecting the balance to the horizon
    first would need a second assumption on top of the capacity, and the
    question a buyer is asking -- "what does this purchase do to my safety
    net?" -- is answered by the simpler comparison. The screen states which one
    it is.

    The WHOLE price is removed, never `target - down_payment`: the down payment
    is a declared figure with no account behind it, so netting it off the
    liquid balance would assume it sits somewhere that balance does not already
    count. Removing the whole price can only understate the autonomy left,
    never inflate it -- the same conservative direction `runway.py` takes with
    uncategorised rows.
    """

    runway_months_before: float | None
    runway_months_after: float | None
    # The measured monthly burn both durations were divided by, republished so
    # the screen can name the rate beside the months (design §10) rather than
    # printing "4 mois" with no provenance. None exactly when the two durations
    # are, since there was then no burn to quote.
    monthly_burn_cents: int | None
    # Set exactly when all three fields above are None, and it names WHICH of
    # two causes applies: no measurable expense rate at all, or a measured rate
    # whose median month spends nothing.
    unavailable_reason: str | None


@dataclass(frozen=True)
class Impact:
    emergency: EmergencyImpact
    # The liquid balance in five years, with and without the purchase, at the
    # measured savings capacity. Both None exactly when the capacity could not
    # be measured. See the module docstring for why neither "le patrimoine net
    # à horizon cinq ans" nor "le score de santé financière" -- the other two
    # components §6.3 item 7 names -- has a field here.
    liquid_in_five_years_before_cents: int | None
    liquid_in_five_years_after_cents: int | None
    liquid_unavailable_reason: str | None


@dataclass(frozen=True)
class FeasibilityReport:
    request: PurchaseRequest
    assumptions: Assumptions
    # The measured savings capacity this whole report rests on, republished so
    # a screen can show the band and the sample size beside the verdict without
    # re-measuring. Untouched: the sign and both band ends are the ones that
    # were measured. None when it could not be measured.
    capacity: MeasuredRate | None
    # French. Set exactly when `capacity` is None, and it is the ONLY reason
    # this engine refuses. A negative capacity is not a refusal: it produces a
    # verdict of `out_of_reach` with real figures.
    capacity_unavailable_reason: str | None
    # All five below are None exactly when `capacity_unavailable_reason` is set.
    verdict: str | None
    saved_at_horizon_cents: int | None
    saved_at_horizon_low_cents: int | None
    # Published so the screen can tell "dans un bon mois c'est jouable" from
    # "même un bon mois n'y suffit pas" WITHOUT a fourth verdict value. On the
    # operator's own figures this is 2 414 442 c against a 4 000 000 c target:
    # the second case.
    saved_at_horizon_high_cents: int | None
    # Target minus what is projected at the median. POSITIVE means short,
    # NEGATIVE means a surplus -- the screen must branch on the sign rather
    # than printing "il vous manque -866,55 EUR".
    gap_cents: int | None
    # §6.3 item 4, over `opportunity_horizon_months` -- the holding period, not
    # the saving horizon, because that is how long the money is tied up in the
    # asset. Never None: it depends on the price, the rate and the holding
    # period, none of which the capacity touches, so it survives the refusal
    # above. The horizon is published so the sentence can name it.
    opportunity_cost_cents: int
    opportunity_horizon_months: int
    impact: Impact
    # The last day of the month the horizon lands in, so the screen prints a
    # date rather than only a month count.
    horizon_end_on: date


def _reason_capacity_unmeasurable() -> str:
    """No verdict. Names the verdict specifically, because that is this
    field's panel -- `_reason_liquid_unmeasurable` says what the OTHER panel
    cannot show for the very same cause.

    States the requirement and quotes no month count, exactly like
    `goal._reason_no_capacity` on the identical cause. The count is the
    caller's fact, not this engine's: it receives a `None`, not a ledger, so
    "l'historique n'en compte que N" would be an unverifiable claim here --
    and the screen prints its own complete-month figure anyway, which is the
    two-numbers-for-one-fact trap `runway._reason_insufficient_history`
    documents.
    """
    return (
        "Votre capacité d'épargne n'a pas pu être mesurée : il faut au moins "
        "trois mois complets de relevés pour en tirer une médiane. Sans elle, "
        "aucun verdict ne peut être rendu sur cet achat — une médiane tirée de "
        "moins de trois mois serait une invention, pas une mesure."
    )


def _reason_liquid_unmeasurable() -> str:
    """The same cause, a different panel, and therefore a different sentence.

    Reusing `_reason_capacity_unmeasurable` here would print "aucun verdict ne
    peut être rendu sur cet achat" underneath a five-year trajectory that was
    never about a verdict. `runway.py` words its two `*_unavailable_reason`
    fields separately for the same reason.
    """
    return (
        "Votre capacité d'épargne n'a pas pu être mesurée : il faut au moins "
        "trois mois complets de relevés. La trajectoire de vos liquidités à "
        "cinq ans repose entièrement sur ce rythme, elle ne peut donc pas être "
        "tracée, ni avec cet achat ni sans lui."
    )


def _reason_no_expense_rate() -> str:
    return (
        "Votre rythme de dépenses n'a pas pu être mesuré : il faut au moins "
        "trois mois complets de relevés. L'effet de cet achat sur votre fonds "
        "d'urgence ne peut donc pas être chiffré."
    )


def _reason_burn_not_positive() -> str:
    """Enough months, and the median month simply spends nothing.

    The branch is `expense_rate.median_cents <= 0`, and
    `capacity.measure_expense_rate` is the median of `abs(outflow_cents)` -- a
    GROSS rate that cannot be negative. So this condition says exactly "the
    median month's spending is nil". It is NOT a statement about a net balance,
    and it must not be worded as one: a household taking 3 000 EUR in and
    paying 2 000 EUR out has a healthy net *and* a perfectly measurable burn.
    `runway._reason_no_measurable_burn` carries this same correction after the
    "solde net ... n'est pas déficitaire" wording shipped once in phase 2A.

    It quotes no month count on purpose: the history is long enough on this
    branch, and telling a household with twelve complete statements to import
    more is this project's most repeated defect.
    """
    return (
        "La dépense médiane d'un mois est nulle dans vos relevés : il n'y a "
        "aucune sortie d'argent à couvrir, donc aucune autonomie que cet achat "
        "puisse réduire."
    )


def _validate(request: PurchaseRequest, assumptions: Assumptions) -> None:
    if request.target_cents <= 0:
        raise ValueError("Le prix du bien doit être strictement positif.")
    if not 1 <= request.horizon_months <= MAX_HORIZON_MONTHS:
        raise ValueError(
            f"L'échéance doit être comprise entre 1 et {MAX_HORIZON_MONTHS} mois."
        )
    if request.down_payment_cents < 0:
        raise ValueError("L'apport ne peut pas être négatif.")
    if request.nature not in NATURES:
        raise ValueError(f"Nature de bien inconnue : {request.nature}")
    if not 1 <= assumptions.ownership_years <= MAX_OWNERSHIP_YEARS:
        raise ValueError(
            f"La durée de possession doit être comprise entre 1 et "
            f"{MAX_OWNERSHIP_YEARS} ans."
        )
    # `annual_return_bps` is deliberately NOT checked here. `savings.
    # _validate_rate` owns that refusal and its French wording; re-raising a
    # second sentence would give one cause two messages, and swallowing it
    # would be the silent failure the contract forbids. It propagates.


def _emergency(
    balance_cents: int, target_cents: int, expense_rate: MeasuredRate | None
) -> EmergencyImpact:
    """Two distinct causes of "cannot say", each with its own sentence.

    Neither depends on the savings capacity, so this is computed on the
    refusing branch too.
    """
    if expense_rate is None:
        return EmergencyImpact(None, None, None, _reason_no_expense_rate())
    if expense_rate.median_cents <= 0:
        return EmergencyImpact(None, None, None, _reason_burn_not_positive())

    burn = expense_rate.median_cents
    return EmergencyImpact(
        runway_months_before=months_of_runway(balance_cents, burn),
        # The whole price, not `target - down_payment`. See `EmergencyImpact`.
        runway_months_after=months_of_runway(balance_cents - target_cents, burn),
        monthly_burn_cents=burn,
        unavailable_reason=None,
    )


def assess_feasibility(
    request: PurchaseRequest,
    capacity: MeasuredRate | None,
    expense_rate: MeasuredRate | None,
    balance_cents: int,
    assumptions: Assumptions,
    today: date,
) -> FeasibilityReport:
    """The verdict, the gap, the opportunity cost and the impact.

    See the module docstring for the refusal contract, for the three things
    forbidden here, and for why a negative capacity produces an answer rather
    than a refusal.
    """
    _validate(request, assumptions)
    ownership_months = assumptions.ownership_years * 12
    horizon_end = month_end(today, request.horizon_months)
    opportunity = opportunity_cost_cents(
        request.target_cents, assumptions.annual_return_bps, ownership_months
    )
    emergency = _emergency(balance_cents, request.target_cents, expense_rate)

    if capacity is None:
        return FeasibilityReport(
            request=request, assumptions=assumptions, capacity=None,
            capacity_unavailable_reason=_reason_capacity_unmeasurable(),
            verdict=None, saved_at_horizon_cents=None, saved_at_horizon_low_cents=None,
            saved_at_horizon_high_cents=None, gap_cents=None,
            opportunity_cost_cents=opportunity,
            opportunity_horizon_months=ownership_months,
            impact=Impact(emergency=emergency, liquid_in_five_years_before_cents=None,
                          liquid_in_five_years_after_cents=None,
                          liquid_unavailable_reason=_reason_liquid_unmeasurable()),
            horizon_end_on=horizon_end,
        )

    def projected(monthly_cents: int) -> int:
        # Through `project_savings`, never a local loop: that function refuses
        # to credit interest to a non-positive balance, which is the whole
        # reason the operator's shrinking pot projects honestly. `monthly_cents`
        # is passed through with its sign -- no `abs()`, no `max(0, ...)`.
        return project_savings(
            request.down_payment_cents, monthly_cents,
            assumptions.annual_return_bps, request.horizon_months,
        ).final_cents

    at_median = projected(capacity.median_cents)
    at_low = projected(capacity.low_cents)
    at_high = projected(capacity.high_cents)

    # `>=`, not `>`: a target landing exactly on a projected figure is reached.
    # The ladder is read off `at_low` first -- the band, not a fixed margin, is
    # what separates "confortablement" from "en serrant".
    if at_low >= request.target_cents:
        verdict = "comfortable"
    elif at_median >= request.target_cents:
        verdict = "tight"
    else:
        verdict = "out_of_reach"

    liquid_before = project_savings(
        balance_cents, capacity.median_cents,
        assumptions.annual_return_bps, LIQUID_HORIZON_MONTHS,
    ).final_cents
    liquid_after = project_savings(
        balance_cents - request.target_cents, capacity.median_cents,
        assumptions.annual_return_bps, LIQUID_HORIZON_MONTHS,
    ).final_cents

    return FeasibilityReport(
        request=request, assumptions=assumptions, capacity=capacity,
        capacity_unavailable_reason=None, verdict=verdict,
        saved_at_horizon_cents=at_median, saved_at_horizon_low_cents=at_low,
        saved_at_horizon_high_cents=at_high,
        gap_cents=request.target_cents - at_median,
        opportunity_cost_cents=opportunity, opportunity_horizon_months=ownership_months,
        impact=Impact(emergency=emergency,
                      liquid_in_five_years_before_cents=liquid_before,
                      liquid_in_five_years_after_cents=liquid_after,
                      liquid_unavailable_reason=None),
        horizon_end_on=horizon_end,
    )
