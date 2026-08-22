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
    essentials_unavailable_reason: str | None


def _reason_insufficient_history(observed: int, label: str) -> str:
    return (
        f"Pas assez d'historique pour mesurer {label} : il faut au moins "
        f"{MIN_MONTHS_FOR_RATE} mois complets de relevés, et l'historique "
        f"n'en compte que {observed}."
    )


def _reason_no_measurable_burn(rate: MeasuredRate, label: str) -> str:
    return (
        f"Le solde net mesuré sur {label} n'est pas déficitaire "
        f"({rate.months} mois observés) : sans dépense nette à combler, "
        f"aucune autonomie ne peut être calculée."
    )


def _scenario(
    name: str, label: str, months: list[MonthObservation], balance_cents: int, today: date
) -> tuple[RunwayScenario | None, str | None]:
    rate = measure_expense_rate(months)
    if rate is None:
        # Too few observed months to measure anything at all.
        return None, _reason_insufficient_history(len(months), label)
    if rate.median_cents <= 0:
        # Enough months, but no measurable burn: dividing by it is infinity,
        # and an infinity rendered on screen reads as a promise. Nothing is
        # returned instead -- and the reason names *this* cause, not a
        # month-count shortfall that does not exist on this branch.
        return None, _reason_no_measurable_burn(rate, label)

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
) -> RunwayReport:
    normal, normal_reason = _scenario(
        "normal", "l'ensemble des dépenses", all_months, balance_cents, today
    )
    essentials, essentials_reason = _scenario(
        "essentials", "les dépenses essentielles", essential_months, balance_cents, today
    )

    return RunwayReport(
        balance_cents=balance_cents,
        months_observed=len(all_months),
        normal=normal,
        essentials=essentials,
        normal_unavailable_reason=normal_reason,
        essentials_unavailable_reason=essentials_reason,
    )
