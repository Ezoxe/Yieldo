"""What would have to change, and what borrowing actually costs.

Design §6.3 items 5 and 6.

**The levers are not ranked by one score, and that is a decision, not an
omission.** §6.3 asks for "leviers chiffrés et classés". The five are
incommensurable -- euros per month, months of delay, euros of target, a debt
ratio, a category's spend -- and collapsing them onto a common scale means
dividing by a quantity the data controls, which is exactly the failure phase 2A
task 16 ruled against after trying and rejecting two ranking metrics. What is
delivered instead: **feasible levers first, then the fixed order
`save_more, delay, reduce_target, borrow, cut_category`**, each carrying its own
figure and, when it cannot be offered, its own French reason. A screen can then
present five honest options rather than one confident ordering built on a
number nobody can defend.

**Every refusal has its own `_reason_*` function.** Ten of them live below, one
per branch, and no two share a wording: a sentence naming the wrong cause is
this project's most repeated defect. `test_each_distinct_cause_gets_its_own_
sentence` walks every branch these fixtures can reach and pins the count.

**The cash-versus-credit comparison holds INCOME constant, not capital.** Both
paths end owning the same asset and spending the same euros each month; the
only difference is where the money sits:

* *comptant* -- the capital is spent, and the instalment the buyer does not owe
  is invested every month instead;
* *crédit* -- only the down payment is spent, the rest of the capital stays
  invested untouched, and the instalment leaves the household's income.

Framed this way the credit path's end wealth does not depend on the loan rate
at all, while the cash path's does (a dearer loan means a bigger instalment to
invest). That makes §6.3's sentence -- "si l'épargne rapporte plus que le coût
du crédit, payer comptant détruit de la valeur" -- a computed figure rather
than a slogan. On a 3,00 % return the break-even lands within a basis point of
3,00 %, which is the check that the model is doing what it claims.

**What makes the break-even search correct.** `difference(rate)` is
`credit_wealth - cash_wealth(rate)`. `credit_wealth` is a constant;
`cash_wealth` is `project_savings` of `monthly_payment_cents(borrowed, rate,
months)`, and both of those are non-decreasing in their argument. So
`difference` is **non-increasing** in the rate -- *not* strictly decreasing, and
the distinction matters: on a small loan the instalment only moves a cent every
dozen basis points, so `difference` is flat across thousands of them. What the
binary search actually needs is weaker and does hold: the predicate
`difference(rate) >= 0` is true on a prefix of the range and false on the
suffix. The search returns the LAST rate at which borrowing is still at least
as good, `>=` and not `>`, so a rate at which the two paths tie is reported
rather than skipped. `test_the_searched_difference_is_monotone_over_the_whole_
range` walks all 3 001 rates and asserts both the monotonicity and the
prefix/suffix shape; two further tests pin the answer at each bound of the
search, where an off-by-one would give a different number.

**LOA is compared on cash figures only.** Whether the lessee owns anything at
the end depends on a choice the contract leaves open, and the terms come from a
dealer's quote. With no terms supplied the option says so; it never invents a
French average for one specific contract. It is also kept out of `better_kind`
entirely, so no screen can imply a three-way verdict.

Pure: no session, no network, no clock.
"""

from dataclasses import dataclass
from decimal import Decimal

from app.engines.amortization import (
    HCSF_DEBT_RATIO_BPS,
    build_schedule,
    debt_ratio_bps,
    monthly_rate,
)
from app.engines.feasibility import Assumptions, FeasibilityReport
from app.engines.robust import median_cents
from app.engines.savings import (
    months_to_target,
    project_savings,
    required_monthly_cents,
)

LEVER_KINDS = ("save_more", "delay", "reduce_target", "borrow", "cut_category")

# The ceiling on the HYPOTHETICAL rates the break-even search explores: 30 %/an.
# `amortization.py` deliberately carries no rate ceiling of its own -- it prices
# whatever it is handed -- and this is where the product knows which product it
# is pricing. Past 30 %/an a car loan or a mortgage is not a thing a French
# household is offered, and a break-even quoted up there would be a number
# nobody could act on.
#
# It is NOT a cap on the rate the user actually quotes. `_borrow` prices the
# user's own `loan_rate_bps` whatever it is, for the same reason the operator's
# 196 % debt ratio is printed as measured: a figure that came from the input is
# a verdict, not something to clamp.
MAX_SEARCHED_RATE_BPS = 3000

_ONE_CENT = Decimal(1)


@dataclass(frozen=True)
class CategoryHistory:
    """One category's measured monthly spend, as POSITIVE magnitudes, one entry
    per complete observed month. The caller builds these the way
    `aggregate.aggregate_by_category` does -- excluding income rows rather than
    netting them in -- and takes the magnitude."""

    category_id: int
    name: str
    monthly_cents: list[int]


@dataclass(frozen=True)
class Lever:
    """One way out, with its number.

    Every field below is populated on EXACTLY ONE kind and is None on the other
    four. That is the price of a flat wire shape; the alternative is five
    payload types the screen has to discriminate. `kind` decides which fields
    to read, and nothing else does.
    """

    kind: str
    feasible: bool
    # French. Set exactly when `feasible` is False, on every branch of all five
    # levers. Pinned by `test_a_refusal_carries_a_reason_and_a_feasible_lever_
    # never_does`.
    unavailable_reason: str | None
    # An extra remark on a FEASIBLE lever -- e.g. that the extra monthly saving
    # includes closing an existing deficit, or that no income was measured so
    # the debt ratio is absent. None when there is nothing to add. Never a
    # substitute for `unavailable_reason`, which only appears on a refusal.
    note: str | None

    # save_more
    # 0 on the one refusal branch, and that 0 is a measurement -- "nothing more
    # is needed each month" -- not a placeholder. `_cut_category` reads it as
    # such, which is why it is set rather than left None.
    extra_monthly_cents: int | None
    # The extra as a fraction of the MEASURED capacity. **None when the
    # capacity is not positive**: a ratio against a negative denominator is not
    # an effort, it is a sign error waiting to be rendered as "-540 % d'effort".
    effort_ratio: float | None

    # delay
    reached_in_months: int | None
    delay_months: int | None

    # reduce_target
    reduced_target_cents: int | None

    # borrow
    borrow_cents: int | None
    loan_payment_cents: int | None
    loan_total_interest_cents: int | None
    # None when no income could be measured. Never 0, which would render as
    # "0 % d'endettement" on a household whose income is simply unknown.
    debt_ratio_bps: int | None
    # False both when the ratio is comfortably under the threshold AND when
    # there is no ratio at all. A screen must read `debt_ratio_bps is None`
    # first; this flag alone cannot tell the two apart, and says so here.
    debt_ratio_exceeded: bool

    # cut_category
    category_id: int | None
    category_name: str | None
    category_median_cents: int | None
    cut_monthly_cents: int | None
    # How many of the observed months already sat at or below the post-cut
    # level -- the history that says whether the cut is realistic. None on every
    # branch that proposes no cut, including the ones that still name a
    # category: there is no post-cut level to count against.
    months_at_or_below: int | None
    months_observed: int | None


# --------------------------------------------------------------------------
# The refusals. One function per cause, one wording per function.
# --------------------------------------------------------------------------


def _reason_capacity_already_suffices() -> str:
    """save_more, and only it. Says nothing about the horizon: the horizon is
    `delay`'s subject, and `_reason_horizon_already_holds` words the same
    underlying comfort from that lever's angle."""
    return (
        "Votre capacité d'épargne mesurée suffit déjà : il n'y a rien de plus à "
        "mettre de côté chaque mois pour tenir cette échéance."
    )


def _reason_capacity_never_grows() -> str:
    """delay, on a capacity that is negative OR exactly zero.

    The branch is `<= 0`, and the wording says both. A `< 0` guard would send a
    zero capacity into `months_to_target`, which answers None, and the screen
    would then read `_reason_beyond_fifty_years` -- "pas avant cinquante ans" on
    a household that is not saving at all, which is a different, and false,
    statement about its situation.
    """
    return (
        "Votre capacité d'épargne mesurée est négative ou nulle : attendre n'y "
        "change rien, la somme mise de côté ne grandit pas avec le temps."
    )


def _reason_beyond_fifty_years() -> str:
    """delay, on a capacity that IS growing but too slowly.

    Deliberately distinct from `_reason_capacity_never_grows`: this household
    saves every month and is simply far away, and telling it that waiting
    "n'y change rien" would be untrue.
    """
    return (
        "Au rythme mesuré, cette somme ne serait pas réunie avant cinquante ans. "
        "Aucun report n'est proposé au-delà : il ne voudrait rien dire."
    )


def _reason_horizon_already_holds() -> str:
    return (
        "L'échéance que vous avez fixée est déjà tenable au rythme mesuré : il "
        "n'y a rien à reporter."
    )


def _reason_no_reachable_target() -> str:
    """reduce_target, when the horizon reaches a NEGATIVE amount.

    Not "your target is too big": the pot shrinks, so no smaller target is
    reachable either. Offering the figure would print "ramenez votre cible à
    -8 954,28 EUR", which is the operator's own case.
    """
    return (
        "Aucune cible n'est atteignable à l'échéance choisie : au rythme mesuré, "
        "la somme mise de côté diminue au lieu d'augmenter."
    )


def _reason_target_already_within_reach() -> str:
    return (
        "Votre cible est déjà dans ce que l'échéance permet : il n'y a rien à "
        "réduire."
    )


def _reason_nothing_to_borrow() -> str:
    """borrow, when the horizon already covers the price.

    A different cause from `_reason_nothing_borrowed` in the financing
    comparison, which is about an apport covering the price rather than about
    what the saving horizon reaches.
    """
    return "L'échéance couvre déjà le prix : il n'y a rien à emprunter."


def _reason_no_category_history() -> str:
    return (
        "Aucune catégorie de dépense n'a assez d'historique pour dire ce qu'elle "
        "coûte un mois normal. Importez davantage de relevés."
    )


def _reason_nothing_to_free() -> str:
    return (
        "Rien n'a besoin d'être libéré chaque mois : l'échéance est déjà tenable "
        "au rythme mesuré."
    )


def _reason_no_category_heavy_enough(name: str) -> str:
    """cut_category, when the heaviest category still could not cover the need.

    Names the category rather than saying "aucune catégorie ne suffit", so the
    reader can see the comparison being made instead of taking it on trust.
    """
    return (
        "Aucune catégorie ne pèse assez pour libérer la somme nécessaire chaque "
        f"mois. La plus lourde, « {name} », coûte moins que cela un mois normal : "
        "la supprimer entièrement ne suffirait pas."
    )


def _note_deficit_must_close_first() -> str:
    return (
        "Ce montant comprend le retour à l'équilibre : votre capacité d'épargne "
        "mesurée est actuellement un déficit, et il faut d'abord le combler avant "
        "de mettre quoi que ce soit de côté."
    )


def _note_no_measured_income() -> str:
    return (
        "Le taux d'endettement n'est pas calculé : vos revenus n'ont pas pu être "
        "mesurés sur au moins trois mois complets de relevés."
    )


# --------------------------------------------------------------------------
# The five levers
# --------------------------------------------------------------------------


def _lever(kind: str, **fields) -> Lever:
    """Build a lever with every unset field explicitly None, so adding a field
    to `Lever` later cannot silently leave four kinds carrying a stale value."""
    base = dict(
        feasible=True, unavailable_reason=None, note=None,
        extra_monthly_cents=None, effort_ratio=None,
        reached_in_months=None, delay_months=None, reduced_target_cents=None,
        borrow_cents=None, loan_payment_cents=None, loan_total_interest_cents=None,
        debt_ratio_bps=None, debt_ratio_exceeded=False,
        category_id=None, category_name=None, category_median_cents=None,
        cut_monthly_cents=None, months_at_or_below=None, months_observed=None,
    )
    base.update(fields)
    return Lever(kind=kind, **base)


def _save_more(report: FeasibilityReport) -> Lever:
    capacity = report.capacity
    required = required_monthly_cents(
        report.request.target_cents, report.request.down_payment_cents,
        report.assumptions.annual_return_bps, report.request.horizon_months,
    )
    extra = required - capacity.median_cents
    if extra <= 0:
        return _lever("save_more", feasible=False, extra_monthly_cents=0,
                      unavailable_reason=_reason_capacity_already_suffices())
    if capacity.median_cents <= 0:
        return _lever("save_more", extra_monthly_cents=extra, effort_ratio=None,
                      note=_note_deficit_must_close_first())
    return _lever("save_more", extra_monthly_cents=extra,
                  effort_ratio=extra / capacity.median_cents)


def _delay(report: FeasibilityReport) -> Lever:
    capacity = report.capacity
    if capacity.median_cents <= 0:
        return _lever("delay", feasible=False,
                      unavailable_reason=_reason_capacity_never_grows())
    reached = months_to_target(
        report.request.target_cents, report.request.down_payment_cents,
        capacity.median_cents, report.assumptions.annual_return_bps,
    )
    if reached is None:
        return _lever("delay", feasible=False,
                      unavailable_reason=_reason_beyond_fifty_years())
    delay = reached - report.request.horizon_months
    if delay <= 0:
        return _lever("delay", feasible=False, reached_in_months=reached,
                      delay_months=0,
                      unavailable_reason=_reason_horizon_already_holds())
    return _lever("delay", reached_in_months=reached, delay_months=delay)


def _reduce_target(report: FeasibilityReport) -> Lever:
    reachable = report.saved_at_horizon_cents
    if reachable <= 0:
        return _lever("reduce_target", feasible=False,
                      unavailable_reason=_reason_no_reachable_target())
    if reachable >= report.request.target_cents:
        return _lever("reduce_target", feasible=False, reduced_target_cents=reachable,
                      unavailable_reason=_reason_target_already_within_reach())
    return _lever("reduce_target", reduced_target_cents=reachable)


def _reason_gap_too_small_to_borrow(months: int) -> str:
    """Names the AMOUNT and the term, never the household.

    Nothing is wrong with the borrower here: the sum left to cover is simply
    too small to be spread over that many months at that rate -- the monthly
    instalment would round to less than the interest it owes.
    """
    return (
        f"La somme qui reste à financer est trop faible pour être étalée sur "
        f"{months} mois à ce taux : la mensualité serait inférieure aux "
        "intérêts qu'elle doit couvrir, et le capital ne baisserait jamais. "
        "Raccourcissez la durée du prêt, ou réglez ce reliquat sans crédit."
    )


def _borrow(report: FeasibilityReport) -> Lever:
    gap = report.gap_cents
    if gap <= 0:
        return _lever("borrow", feasible=False,
                      unavailable_reason=_reason_nothing_to_borrow())
    assumptions = report.assumptions
    # One call, not `monthly_payment_cents` beside `build_schedule`: the
    # schedule computes the instalment itself, and reading it back off the
    # schedule is what makes the payment on screen the payment in the table.
    try:
        schedule = build_schedule(gap, assumptions.loan_rate_bps, assumptions.loan_months)
    except ValueError:
        # `amortization` refuses a loan whose instalment, rounded to the cent,
        # would not cover the first month's interest -- true of a small amount
        # spread over a long term at a high rate. Letting that raise out of
        # here cost the household its whole report: the router answers any
        # ValueError with a 422, so one unpriceable lever took the verdict, the
        # capacity and the other four levers with it. It refuses on its own
        # instead, naming the amount rather than the household.
        return _lever("borrow", feasible=False,
                      borrow_cents=gap,
                      unavailable_reason=_reason_gap_too_small_to_borrow(
                          assumptions.loan_months))
    # On ALL of the household's instalments, not only the new one: the HCSF
    # ratio is a debt-service ratio, and dropping what is already owed would
    # understate every ratio in the application.
    ratio = debt_ratio_bps(
        assumptions.existing_debt_payments_cents + schedule.monthly_payment_cents,
        assumptions.monthly_income_cents,
    )
    return _lever("borrow", borrow_cents=gap,
                  loan_payment_cents=schedule.monthly_payment_cents,
                  loan_total_interest_cents=schedule.total_interest_cents,
                  debt_ratio_bps=ratio,
                  debt_ratio_exceeded=ratio is not None and ratio > HCSF_DEBT_RATIO_BPS,
                  note=None if ratio is not None else _note_no_measured_income())


def _cut_category(
    categories: list[CategoryHistory], needed_monthly_cents: int
) -> Lever:
    """Which single category could free `needed_monthly_cents` a month.

    `needed_monthly_cents` is `save_more.extra_monthly_cents`, which is always
    an int -- 0 when nothing more is needed. Categories with no observed month
    are dropped rather than passed to `median_cents`, which raises on an empty
    sample instead of returning a zero nobody measured.
    """
    usable = [category for category in categories if category.monthly_cents]
    if not usable:
        return _lever("cut_category", feasible=False,
                      unavailable_reason=_reason_no_category_history())
    if needed_monthly_cents <= 0:
        return _lever("cut_category", feasible=False,
                      unavailable_reason=_reason_nothing_to_free())

    medians = {category.category_id: median_cents(category.monthly_cents)
               for category in usable}
    # Heaviest first, then by name and id so two categories costing the same
    # never swap places between two renders of the same screen. `sorted` alone
    # would leave the choice to whatever order the caller happened to query in.
    best = sorted(usable,
                  key=lambda c: (-medians[c.category_id], c.name, c.category_id))[0]
    median = medians[best.category_id]
    if median < needed_monthly_cents:
        return _lever("cut_category", feasible=False, category_id=best.category_id,
                      category_name=best.name, category_median_cents=median,
                      months_observed=len(best.monthly_cents),
                      unavailable_reason=_reason_no_category_heavy_enough(best.name))

    after = median - needed_monthly_cents
    return _lever(
        "cut_category", category_id=best.category_id, category_name=best.name,
        category_median_cents=median, cut_monthly_cents=needed_monthly_cents,
        months_at_or_below=sum(1 for value in best.monthly_cents if value <= after),
        months_observed=len(best.monthly_cents),
    )


def build_levers(
    report: FeasibilityReport, categories: list[CategoryHistory]
) -> list[Lever]:
    """The five levers, feasible ones first, in the documented order otherwise.

    Returns an EMPTY list when `report.capacity` is None. Five refusals all
    saying "your capacity could not be measured" is five copies of one
    sentence; the screen prints `report.capacity_unavailable_reason` once
    instead.
    """
    if report.capacity is None:
        return []

    save_more = _save_more(report)
    levers = [
        save_more,
        _delay(report),
        _reduce_target(report),
        _borrow(report),
        _cut_category(categories, save_more.extra_monthly_cents),
    ]
    # Stable sort: feasible first, and the documented order preserved inside
    # each group. `sorted` is guaranteed stable in Python, which is what makes
    # "then the fixed order" true rather than incidental.
    return sorted(levers, key=lambda lever: 0 if lever.feasible else 1)


# --------------------------------------------------------------------------
# Comptant vs crédit vs LOA
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class LoaTerms:
    """A location avec option d'achat, as quoted by a dealer. Every figure comes
    from the user; Yieldo has no average for one specific contract."""

    deposit_cents: int
    monthly_cents: int
    months: int
    # The buy-out price at the end. The lessee may or may not pay it -- which
    # is exactly why no end-wealth figure is produced for this option.
    residual_cents: int


@dataclass(frozen=True)
class FinancingOption:
    kind: str
    # False only for `loa` with no terms supplied.
    available: bool
    unavailable_reason: str | None
    # Cash out of the household's own capital on day one.
    out_of_pocket_cents: int | None
    monthly_cents: int | None
    total_paid_cents: int | None
    interest_cents: int | None
    # Wealth at the end of the loan term, under the income-constant framing in
    # the module docstring. None on the LOA option, always.
    wealth_at_end_cents: int | None
    # Set exactly when `wealth_at_end_cents` is None on an AVAILABLE option. It
    # stays None on an unavailable one: there is no option there to refuse a
    # wealth figure for, and the two nulls mean different things.
    wealth_unavailable_reason: str | None


@dataclass(frozen=True)
class FinancingComparison:
    horizon_months: int
    options: list[FinancingOption]
    # The loan rate at which borrowing and paying cash leave the household
    # equally wealthy -- the LAST rate at which borrowing is still at least as
    # good. Below it, borrowing wins; above it, cash does. None when no crossing
    # was found in the searched range, with the reason saying which side, and
    # None too when the loan is too small for its term to be priced across that
    # range at all.
    break_even_rate_bps: int | None
    break_even_reason: str | None
    # "cash" or "credit". Compares ONLY the two options that carry a wealth
    # figure; the LOA line is deliberately not in the running, and the screen
    # must say so rather than implying a three-way verdict.
    #
    # "cash" ALSO when the two are exactly level -- at the break-even rate
    # itself, and always when there is nothing to borrow. This flag cannot tell
    # a tie from a win, and a screen printing "payer comptant est préférable" on
    # a tie would be naming a preference that does not exist: read
    # `wealth_gap_cents == 0` first.
    # None when the credit option could not be priced at all -- there is then
    # only one side carrying a wealth figure, and naming "cash" the better of
    # one is a preference nobody established.
    better_kind: str | None
    # Credit's end wealth minus cash's, in cents. Positive means borrowing
    # leaves the household ahead. Signed, never absolute. None exactly when
    # `better_kind` is None.
    wealth_gap_cents: int | None


def _reason_nothing_borrowed() -> str:
    """The apport covers the whole price, so there is no loan to compare.

    Distinct from `_reason_nothing_to_borrow`, which is a lever's answer about
    what the SAVING HORIZON already covers. Same word, different fact.
    """
    return (
        "L'apport couvre déjà la totalité du prix : il n'y a aucun crédit à "
        "comparer, donc aucun taux d'équilibre à calculer."
    )


def _reason_cash_wins_at_every_rate() -> str:
    return (
        "Emprunter coûte plus que ne rapporte votre épargne, quel que soit le "
        "taux : au rendement retenu, payer comptant est toujours préférable."
    )


def _reason_credit_wins_to_the_ceiling() -> str:
    return (
        f"Emprunter reste avantageux jusqu'à {MAX_SEARCHED_RATE_BPS // 100} %, la "
        "limite au-delà de laquelle ce calcul n'a plus de sens. Aucun taux "
        "d'équilibre n'a été trouvé en deçà."
    )


def _reason_loan_too_small_for_its_term() -> str:
    """The one refusal that is about the arithmetic rather than about the money.

    Without it the search would hand `amortization.monthly_payment_cents` a rate
    at the top of the range on a capital too small to amortise over that many
    months, and its ValueError -- "la mensualité ne couvrirait même pas les
    intérêts du premier mois" -- would surface to a user who never quoted that
    rate. A true sentence about the wrong input is still the wrong sentence.
    """
    return (
        "La somme à emprunter est trop faible pour cette durée : au-delà d'un "
        "certain taux, la mensualité ne couvrirait même pas les intérêts du mois, "
        "et la comparaison n'a plus de borne haute à explorer. Aucun taux "
        "d'équilibre n'est calculé."
    )


def _reason_no_loa_terms() -> str:
    return (
        "Aucun loyer de location avec option d'achat n'a été saisi. Ces montants "
        "viennent du devis du concessionnaire : Yieldo ne les invente pas."
    )


def _reason_loa_has_no_end_wealth() -> str:
    return (
        "Aucun patrimoine final n'est calculé pour la LOA : selon que l'option "
        "d'achat est levée ou non, vous finissez propriétaire du bien ou sans "
        "rien, et le contrat laisse ce choix ouvert."
    )


def _wealth_cash(borrowed_cents: int, rate_bps: int, assumptions: Assumptions) -> int:
    schedule = build_schedule(borrowed_cents, rate_bps, assumptions.loan_months)
    return project_savings(0, schedule.monthly_payment_cents,
                           assumptions.annual_return_bps,
                           assumptions.loan_months).final_cents


def _wealth_credit(borrowed_cents: int, assumptions: Assumptions) -> int:
    # Independent of the loan rate by construction: the instalment leaves the
    # household's income, not this pot. See the module docstring, and
    # `test_the_credit_paths_wealth_does_not_move_with_the_loan_rate`.
    return project_savings(borrowed_cents, 0, assumptions.annual_return_bps,
                           assumptions.loan_months).final_cents


def _priceable_across_the_searched_range(borrowed_cents: int, months: int) -> bool:
    """Whether every rate the search may visit yields a real instalment.

    `monthly_payment_cents` refuses a payment that would not cover the first
    month's interest. The exact instalment exceeds that interest by
    `g(i) = P*i / ((1+i)^n - 1)`, and rounding both to the cent can only close a
    gap smaller than one cent -- so `g >= 1` is a sufficient condition for the
    refusal not to fire. `g` is non-increasing in `i`, because
    `((1+i)^n - 1)/i = n + C(n,2)*i + ...` has only non-negative coefficients,
    so checking `g` at the TOP of the range clears the whole range at once.

    That is what makes this a proof rather than a spot check: one evaluation
    covers all 3 001 rates. `test_the_priceability_guard_really_does_clear_the_
    whole_range` walks every one of them either side of the threshold, on the
    term where it bites soonest.

    It is sufficient, not necessary, so it refuses a little more than it has
    to. The smallest capital it lets through is 1,36 EUR over 60 months and
    659,11 EUR over 300 -- negligible at any term a French lender offers -- and
    rises to 2 901,30 EUR over 360 months and 56 171,02 EUR over 480, where a
    level instalment at 30 %/an genuinely is interest and nothing else.
    """
    rate = monthly_rate(MAX_SEARCHED_RATE_BPS)
    growth = (Decimal(1) + rate) ** months - Decimal(1)
    return Decimal(borrowed_cents) * rate / growth >= _ONE_CENT


def _validate_loa(loa: LoaTerms) -> None:
    if loa.months < 1:
        raise ValueError("La durée d'une LOA doit être d'au moins un mois.")
    if min(loa.deposit_cents, loa.monthly_cents, loa.residual_cents) < 0:
        raise ValueError(
            "Les montants d'une LOA — apport, loyer, valeur de rachat — ne "
            "peuvent pas être négatifs."
        )


def compare_financing(
    price_cents: int,
    down_payment_cents: int,
    assumptions: Assumptions,
    loa: LoaTerms | None,
) -> FinancingComparison:
    """Comptant, crédit and LOA, plus the rate at which borrowing starts to pay.

    See the module docstring for the framing, for what makes the break-even
    search correct, and for why the LOA line carries no wealth figure.
    """
    if price_cents <= 0:
        raise ValueError("Le prix du bien doit être strictement positif.")
    if not 0 <= down_payment_cents <= price_cents:
        raise ValueError("L'apport doit être compris entre zéro et le prix du bien.")
    if loa is not None:
        _validate_loa(loa)

    borrowed = price_cents - down_payment_cents
    # At the user's OWN rate. `amortization` refuses a loan whose instalment,
    # rounded to the cent, would not cover the first month's interest -- true
    # of a small remainder spread over a long term. That refusal is about the
    # input the user typed, but letting it raise cost them the whole
    # feasibility report: the router answers any ValueError with a 422, so an
    # unpriceable credit line took the verdict, the capacity and the levers
    # with it. The credit option comes back unavailable instead, exactly as the
    # LOA one does when no terms were supplied.
    try:
        schedule = build_schedule(
            borrowed, assumptions.loan_rate_bps, assumptions.loan_months)
    except ValueError:
        schedule = None
    # Under the income-constant framing the cash path invests exactly what the
    # instalment would have been, so an unpriceable loan leaves BOTH end-wealth
    # figures undefined. The cash option still answers on its cash figures --
    # what it costs on day one, and in total -- which is all the comparison had
    # to give up.
    cash_wealth = (None if schedule is None
                   else _wealth_cash(borrowed, assumptions.loan_rate_bps, assumptions))
    credit_wealth = None if schedule is None else _wealth_credit(borrowed, assumptions)

    options = [
        FinancingOption(
            kind="cash", available=True, unavailable_reason=None,
            out_of_pocket_cents=price_cents,
            monthly_cents=0, total_paid_cents=price_cents, interest_cents=0,
            wealth_at_end_cents=cash_wealth,
            wealth_unavailable_reason=None if cash_wealth is not None
            else _reason_loan_too_small_for_its_term(),
        ),
        FinancingOption(
            kind="credit", available=schedule is not None,
            unavailable_reason=None if schedule is not None
            else _reason_loan_too_small_for_its_term(),
            out_of_pocket_cents=down_payment_cents if schedule is not None else None,
            monthly_cents=None if schedule is None else schedule.monthly_payment_cents,
            total_paid_cents=None if schedule is None
            else down_payment_cents + schedule.total_paid_cents,
            interest_cents=None if schedule is None else schedule.total_interest_cents,
            wealth_at_end_cents=credit_wealth, wealth_unavailable_reason=None,
        ),
    ]

    if loa is None:
        options.append(FinancingOption(
            kind="loa", available=False,
            unavailable_reason=_reason_no_loa_terms(),
            out_of_pocket_cents=None, monthly_cents=None, total_paid_cents=None,
            interest_cents=None, wealth_at_end_cents=None,
            wealth_unavailable_reason=None,
        ))
    else:
        options.append(FinancingOption(
            kind="loa", available=True, unavailable_reason=None,
            out_of_pocket_cents=loa.deposit_cents, monthly_cents=loa.monthly_cents,
            total_paid_cents=loa.deposit_cents + loa.monthly_cents * loa.months
            + loa.residual_cents,
            interest_cents=None, wealth_at_end_cents=None,
            wealth_unavailable_reason=_reason_loa_has_no_end_wealth(),
        ))

    def difference(rate_bps: int) -> int:
        return credit_wealth - _wealth_cash(borrowed, rate_bps, assumptions)

    break_even: int | None = None
    reason: str | None = None
    if schedule is None:
        # No credit side to cross with: the same fact the option itself carries.
        reason = _reason_loan_too_small_for_its_term()
    elif borrowed <= 0:
        reason = _reason_nothing_borrowed()
    elif not _priceable_across_the_searched_range(borrowed, assumptions.loan_months):
        reason = _reason_loan_too_small_for_its_term()
    elif difference(0) < 0:
        reason = _reason_cash_wins_at_every_rate()
    elif difference(MAX_SEARCHED_RATE_BPS) > 0:
        reason = _reason_credit_wins_to_the_ceiling()
    else:
        # Last rate at which `difference >= 0`. The predicate is true on a
        # prefix and false on the suffix (module docstring), and both bounds are
        # inclusive: a crossing at 0 answers 0, one at the ceiling answers the
        # ceiling. `(low + high + 1) // 2` biases the midpoint upward, which is
        # what stops `low = middle` from looping for ever.
        low, high = 0, MAX_SEARCHED_RATE_BPS
        while low < high:
            middle = (low + high + 1) // 2
            if difference(middle) >= 0:
                low = middle
            else:
                high = middle - 1
        break_even = low

    return FinancingComparison(
        horizon_months=assumptions.loan_months, options=options,
        break_even_rate_bps=break_even, break_even_reason=reason,
        better_kind=None if credit_wealth is None
        else ("credit" if credit_wealth > cash_wealth else "cash"),
        wealth_gap_cents=None if credit_wealth is None else credit_wealth - cash_wealth,
    )
