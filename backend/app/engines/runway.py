"""How long the money lasts with no income at all, at the measured rate.

Two scenarios, both measured rather than assumed: what this household actually
spends, and what it spends on the categories it has marked essential. The gap
between them is the lever, and it is the user's own ledger on both sides.

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
    # Positive magnitude: what one month costs under this scenario.
    monthly_burn_cents: int
    # A duration, not money. None never occurs on a returned scenario -- a
    # scenario that could not be computed is None itself.
    months: float | None
    depleted_on: date | None


@dataclass(frozen=True)
class RunwayReport:
    balance_cents: int
    months_observed: int
    normal: RunwayScenario | None
    essentials: RunwayScenario | None
    # French. Non-null exactly when neither scenario could be computed.
    insufficient_reason: str | None


def _scenario(
    name: str, rate: MeasuredRate | None, balance_cents: int, today: date
) -> RunwayScenario | None:
    if rate is None or rate.median_cents <= 0:
        # No measurable burn: dividing by it is infinity, and an infinity
        # rendered on screen reads as a promise. Nothing is returned instead.
        return None

    burn = rate.median_cents
    if balance_cents <= 0:
        # Already at or past zero. Not a negative runway -- there is simply none
        # left, starting today.
        return RunwayScenario(name=name, monthly_burn_cents=burn, months=0.0,
                              depleted_on=today)

    months = balance_cents / burn
    if months > MAX_DATED_MONTHS:
        return RunwayScenario(name=name, monthly_burn_cents=burn, months=months,
                              depleted_on=None)

    days = round(balance_cents * DAYS_PER_YEAR / (burn * 12))
    return RunwayScenario(name=name, monthly_burn_cents=burn, months=months,
                          depleted_on=today + timedelta(days=days))


def compute_runway(
    balance_cents: int,
    all_months: list[MonthObservation],
    essential_months: list[MonthObservation],
    today: date,
) -> RunwayReport:
    normal = _scenario("normal", measure_expense_rate(all_months), balance_cents, today)
    essentials = _scenario(
        "essentials", measure_expense_rate(essential_months), balance_cents, today
    )

    reason: str | None = None
    if normal is None and essentials is None:
        reason = (
            f"Pas assez de données pour conclure : il faut au moins "
            f"{MIN_MONTHS_FOR_RATE} mois complets de relevés portant des dépenses, "
            f"et l'historique en compte {len(all_months)}."
        )

    return RunwayReport(
        balance_cents=balance_cents,
        months_observed=len(all_months),
        normal=normal,
        essentials=essentials,
        insufficient_reason=reason,
    )
