"""How long the money lasts with no income at all, at the measured rate.

Two scenarios, both measured rather than assumed: what this household actually
spends, and what it spends on the categories it has marked essential. The gap
between them is the lever, and it is the user's own ledger on both sides.

`essential_months` is the caller's responsibility to build, and the contract
is fixed here: it must be `complete_months` called over the *same* ledger
bounds as `all_months`, but with the entries filtered to those whose category
carries `is_essential`. A transaction with no category at all
(`category_id IS NULL` -- the operator has 26 such rows) has no flag to read.
The decision this module assumes: an uncategorised row is **not** essential --
excluded from `essential_months` while still counted in `all_months`. That is
the conservative default: it can only shorten the essentials runway, never
inflate it on the strength of a row nobody has reviewed. Task 12, which builds
`essential_months` from the transactions table, must apply the join this way.

`months` is a `float` and that is deliberate: it is a duration, not a monetary
value. The integer-cents rule governs money; a count of months has no cents to
lose. Every amount in this module stays an integer.

Pure: no session, no network, no implicit clock -- `today` is a parameter.
"""

from dataclasses import dataclass
from datetime import date, timedelta

from app.engines.capacity import (
    MIN_MONTHS_FOR_RATE,
    MeasuredRate,
    MonthObservation,
    measure_expense_rate,
)

DAYS_PER_YEAR = 365

# Past fifty years a depletion date is noise, and `date` cannot represent one
# past year 9999 at all. The month count is still reported; only the calendar
# date is withheld.
MAX_DATED_MONTHS = 600


@dataclass(frozen=True)
class RunwayScenario:
    # "normal" or "essentials".
    name: str
    # Positive magnitude: what one month costs under this scenario. Equal to
    # `rate.median_cents` -- kept alongside it because it is what every caller
    # actually wants first.
    monthly_burn_cents: int
    # The full measured rate this scenario's burn was derived from: its band
    # (`low_cents` / `high_cents`) and, via `rate.months`, exactly how many
    # months it was measured over. That count is *not* the same thing as
    # `RunwayReport.months_observed` -- `essentials` is measured over its own,
    # self-selected set of months (only those carrying essential-tagged
    # spending), which can be narrower, wider, or simply different from
    # `normal`'s. A caller that wants to explain why `essentials.months` came
    # out shorter than `normal.months` needs this to tell the two samples
    # apart, rather than only seeing one combined count on the report.
    rate: MeasuredRate
    # A duration, not money. None never occurs on a returned scenario -- a
    # scenario that could not be computed is None itself.
    months: float | None
    depleted_on: date | None


@dataclass(frozen=True)
class RunwayReport:
    balance_cents: int
    # Months observed for `all_months` specifically -- the overall ledger
    # completeness, independent of whether `normal` or `essentials` could be
    # computed from it. Each scenario's own sample size lives on
    # `scenario.rate.months` instead (see `RunwayScenario`), since
    # `essentials` is measured over a different set of months than this one.
    months_observed: int
    normal: RunwayScenario | None
    essentials: RunwayScenario | None
    # French. Set exactly when `normal` is None, explaining which of the two
    # distinct causes applies: too few observed months, or a burn that is not
    # measurably positive (see `_scenario`). Never both at once, and never a
    # month-count complaint when the month count was in fact sufficient --
    # conflating the two produced a self-contradictory message ("il faut au
    # moins 3 mois ... et l'historique en compte 3") on exactly this branch.
    normal_unavailable_reason: str | None
    # Same contract as `normal_unavailable_reason`, but for `essentials`.
    # `essentials` is measured over its own set of months and can fail on its
    # own even when `normal` succeeds -- the screen needs a reason to show
    # next to it rather than a blank next to a working `normal` scenario.
    #
    # A third cause exists on this side and on this side only: no category is
    # marked essential at all, where nothing about the history is short (see
    # `_reason_no_essential_category`).
    essentials_unavailable_reason: str | None


def _ledger_span(ledger_months: int) -> str:
    """"sur les N mois complets de l'historique", singular-safe."""
    if ledger_months == 1:
        return "sur le seul mois complet de l'historique"
    return f"sur les {ledger_months} mois complets de l'historique"


def _reason_insufficient_history(observed: int, ledger_months: int, label: str) -> str:
    """Too few months to measure a rate -- quoting the count the reader can check.

    Two different shortfalls wear this refusal, and only one of them is about
    the ledger:

    * `observed == ledger_months` -- the ledger itself is short. This is
      `normal`'s only case, since `all_months` *is* the ledger.
    * `observed < ledger_months` -- the ledger is whatever length it is, and
      only `observed` of its complete months carry this scenario's kind of
      spending. `essential_months` is built by the caller from a *filtered*
      entry list, so `complete_months` never emits a month with no essential
      row in it: its length is a count of months carrying essential spending,
      never the ledger's complete-month count.

    Quoting `observed` as "l'historique n'en compte que N" in the second case
    is a false claim about the ledger, and the Trésorerie screen prints its
    own "dont N mois complets" six lines underneath: two numbers for one fact,
    on one screen. Exactly what `forecast._reason_short_ledger` documents on
    the sibling engine; it was still live here.
    """
    if observed == ledger_months:
        if ledger_months == 0:
            held = "n'en compte aucun"
        elif ledger_months == 1:
            held = "n'en compte qu'un seul"
        else:
            held = f"n'en compte que {ledger_months}"
        return (
            f"Pas assez d'historique pour mesurer {label} : il faut au moins "
            f"{MIN_MONTHS_FOR_RATE} mois complets de relevés, et l'historique "
            f"{held}."
        )

    if observed == 0:
        carrying = "aucun mois ne porte ce type de dépense"
    elif observed == 1:
        carrying = "un seul mois porte ce type de dépense"
    else:
        carrying = f"seuls {observed} mois portent ce type de dépense"
    return (
        f"Pas assez de mois pour mesurer {label} : {carrying} "
        f"{_ledger_span(ledger_months)}, et il en faut au moins "
        f"{MIN_MONTHS_FOR_RATE}."
    )


def _reason_no_essential_category() -> str:
    """Nothing is flagged essential, so the reduced scenario has no population.

    Its own sentence, because the cause is not a short history: with no
    category marked essential there is no essential spending to measure at any
    ledger length, and the refusal used to say "il faut au moins 3 mois
    complets de relevés, et l'historique n'en compte que 0" beside a screen
    announcing eleven complete months -- wrong number and wrong cause at once.

    It quotes no month count on purpose. None is relevant here, and a sentence
    carrying no number cannot contradict the scope note printed under it.

    Deliberately does not tell the reader to go and mark a category: nothing in
    the app edits `is_essential` yet (/categories is a placeholder), and the
    screen already says so in its own words.

    It leads with the scenario rather than with the category list because the
    Trésorerie cell's own note opens "Aucune catégorie n'est marquée
    essentielle" on this exact state. Two adjacent paragraphs opening on the
    same clause read as one sentence printed twice; this one answers "why is
    this panel empty", the note answers "what does the reduced scenario rest
    on".
    """
    return (
        "Ce scénario n'a aucune dépense à mesurer : aucune catégorie n'est "
        "marquée essentielle, et la longueur de l'historique n'y change rien."
    )


def _reason_no_measurable_burn(rate: MeasuredRate, ledger_months: int, label: str) -> str:
    """Enough months, but the median month spends nothing.

    The branch is `measure_expense_rate(...).median_cents <= 0` -- the median
    of `abs(outflow_cents)`, which is a GROSS expense rate and cannot be
    negative, so the condition is exactly "the median month's spending is nil".
    It is not a statement about a net balance, and this sentence used to make
    one ("Le solde net ... n'est pas déficitaire"): a household taking 3 000 EUR
    in and paying 2 000 EUR out has a healthy net *and* a perfectly measurable
    burn, so the stated cause was never the branch's condition. "Solde net" is
    also the name of a different, existing quantity in this product -- the
    third series of `CashflowChart`.

    `rate.months` is this scenario's OWN sample size, which for `essentials`
    can be smaller than the ledger's complete-month count, so it is described
    as the ledger's own count only when the two genuinely agree -- the same
    trap `_reason_insufficient_history` exists to avoid.
    """
    sample = (
        _ledger_span(rate.months)
        if rate.months == ledger_months
        else f"sur les {rate.months} mois de l'historique qui portent ce type de dépense"
    )
    return (
        f"Aucune autonomie mesurable pour {label} : {sample}, la dépense "
        f"médiane d'un mois est nulle, il n'y a donc aucune sortie d'argent "
        f"à couvrir."
    )


def _scenario(
    name: str,
    label: str,
    months: list[MonthObservation],
    ledger_months: int,
    balance_cents: int,
    today: date,
) -> tuple[RunwayScenario | None, str | None]:
    rate = measure_expense_rate(months)
    if rate is None:
        # Too few observed months to measure anything at all. `ledger_months`
        # rides along because this scenario's sample size is not necessarily
        # the ledger's, and the refusal must not confuse the two.
        return None, _reason_insufficient_history(len(months), ledger_months, label)
    if rate.median_cents <= 0:
        # Enough months, but no measurable burn: dividing by it is infinity,
        # and an infinity rendered on screen reads as a promise. Nothing is
        # returned instead -- and the reason names *this* cause, not a
        # month-count shortfall that does not exist on this branch.
        return None, _reason_no_measurable_burn(rate, ledger_months, label)

    burn = rate.median_cents
    if balance_cents <= 0:
        # Already at or past zero. Not a negative runway -- there is simply none
        # left, starting today.
        return RunwayScenario(name=name, monthly_burn_cents=burn, rate=rate, months=0.0,
                              depleted_on=today), None

    months_count = balance_cents / burn
    if months_count > MAX_DATED_MONTHS:
        return RunwayScenario(name=name, monthly_burn_cents=burn, rate=rate,
                              months=months_count, depleted_on=None), None

    days = round(balance_cents * DAYS_PER_YEAR / (burn * 12))
    return RunwayScenario(name=name, monthly_burn_cents=burn, rate=rate, months=months_count,
                          depleted_on=today + timedelta(days=days)), None


def compute_runway(
    balance_cents: int,
    all_months: list[MonthObservation],
    essential_months: list[MonthObservation],
    today: date,
    essential_category_count: int,
) -> RunwayReport:
    """Both scenarios, each with its own answer or its own reason.

    `essential_category_count` is how many of the user's categories carry
    `is_essential`. It is required rather than inferred because an empty
    `essential_months` has two very different causes that the month list alone
    cannot tell apart -- no category is flagged essential, or flagged
    categories simply carry no spending in any complete month -- and the two
    call for different sentences. A count is a plain fact about the caller's
    data; it keeps this module pure.

    The "no category" sentence is chosen only when `essential_months` is also
    empty, which is the only shape the two can honestly take together (a
    filtered-to-nothing entry list produces no months). Contradictory input
    therefore falls through to the measurement, which can only say something
    true about the months it was actually handed.
    """
    # The ledger's own complete-month count, and the only number either refusal
    # may attribute to "l'historique". `RunwayReport.months_observed` publishes
    # it and the screen prints it.
    ledger_months = len(all_months)

    normal, normal_reason = _scenario(
        "normal", "l'ensemble des dépenses", all_months, ledger_months, balance_cents, today
    )

    if essential_category_count == 0 and not essential_months:
        essentials, essentials_reason = None, _reason_no_essential_category()
    else:
        essentials, essentials_reason = _scenario(
            "essentials", "les dépenses essentielles", essential_months, ledger_months,
            balance_cents, today,
        )

    return RunwayReport(
        balance_cents=balance_cents,
        months_observed=len(all_months),
        normal=normal,
        essentials=essentials,
        normal_unavailable_reason=normal_reason,
        essentials_unavailable_reason=essentials_reason,
    )
