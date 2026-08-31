"""Buying a home: what it really costs each month, and whether renting wins.

Design §6.1's "simulateur immobilier", rebuilt on the two Lot A engines so the
instalment quoted here is the same number `engines/levers.py` quotes for a
consumer loan.

Three things the French market makes non-optional:

* **the frais de notaire are borrowed too, unless the buyer pays them.** The
  loan is sized on price + fees - apport, not on the price. Sizing it on the
  price alone understates a 300 000 EUR purchase by 22 500 EUR;
* **the assurance emprunteur counts inside the taux d'endettement.** A French
  bank includes it; leaving it out understates the ratio on every loan and
  would put a plan the bank will refuse comfortably under the 35 % threshold;
* **the fees usually come out of the buyer's own money.** When the down payment
  is smaller than the fees, that is reported (`down_payment_short_cents`), not
  refused: it is a fact about the plan.

**The rent comparison is capped at the loan term.** Past the last instalment
the buyer's monthly effort drops by the instalment and the insurance, and the
renter's invested difference changes sign; modelling that silently would be a
second regime hidden inside one number. The cap is returned with a French
reason so a screen can say it.

Pure: no session, no network, no clock.
"""

from dataclasses import dataclass
from decimal import Decimal

from app.engines.amortization import (
    HCSF_DEBT_RATIO_BPS,
    LoanSchedule,
    build_schedule,
    cents,
    debt_ratio_bps,
)
from app.engines.savings import MAX_PROJECTION_MONTHS, project_savings

# Frais de notaire, in basis points of the price. ~7,5 % in the existing
# market, ~2,5 % on a new build. Ordres de grandeur, adjustable by the user.
NOTARY_BPS_EXISTING = 750
NOTARY_BPS_NEW = 250

# Assurance emprunteur, in basis points of the INITIAL capital per year --
# the common French convention (assurance sur capital initial), which keeps
# the premium flat over the loan rather than falling with the balance.
DEFAULT_INSURANCE_BPS_PER_YEAR = 36

# An assumption, displayed and editable, never a forecast. 1 %/an.
DEFAULT_APPRECIATION_BPS_PER_YEAR = 100

_BPS = Decimal(10_000)


@dataclass(frozen=True)
class PropertyRequest:
    price_cents: int
    down_payment_cents: int
    notary_bps: int
    loan_rate_bps: int
    loan_months: int
    insurance_bps_per_year: int
    monthly_charges_cents: int
    annual_property_tax_cents: int
    # Measured, or None. See `capacity.measure_income_rate`.
    monthly_income_cents: int | None
    existing_debt_payments_cents: int


@dataclass(frozen=True)
class PropertySimulation:
    price_cents: int
    notary_fees_cents: int
    acquisition_cost_cents: int
    down_payment_cents: int
    # How much of the frais de notaire the down payment does NOT cover. 0 when
    # it does. A French bank generally wants these paid from own funds, so a
    # positive figure here is a plan the bank may refuse -- reported, not
    # refused by this engine.
    down_payment_short_cents: int
    borrowed_cents: int
    # `rows` is empty when nothing was borrowed. See `amortization.LoanSchedule`.
    schedule: LoanSchedule
    monthly_insurance_cents: int
    monthly_charges_cents: int
    monthly_property_tax_cents: int
    # Instalment + insurance + charges + taxe foncière. Every recurring euro,
    # which is the figure a household actually has to find each month.
    monthly_effort_cents: int
    total_interest_cents: int
    # Acquisition + interest + insurance over the whole loan. Charges and taxe
    # foncière are NOT in here: they are the cost of living somewhere, paid by
    # an owner and a tenant alike, and folding them in would make buying look
    # worse than renting by an amount both parties pay.
    total_cost_cents: int
    debt_ratio_bps: int | None
    # False both under the threshold AND when there is no ratio at all. Read
    # `debt_ratio_bps is None` first.
    debt_ratio_exceeded: bool


@dataclass(frozen=True)
class RentComparison:
    horizon_months: int
    # French, set exactly when the requested horizon was cut back to the loan
    # term. See the module docstring.
    capped_reason: str | None
    monthly_rent_cents: int
    buyer_property_value_cents: int
    buyer_remaining_loan_cents: int
    # Value minus what is still owed.
    buyer_wealth_cents: int
    # The down payment and the fees, invested, plus the monthly difference
    # between the owner's effort and the rent -- which may be NEGATIVE, in
    # which case the renter is drawing the pot down, and `project_savings`
    # models that honestly rather than flooring it.
    renter_wealth_cents: int
    difference_cents: int
    # "buy" or "rent".
    better_kind: str


def simulate_property(request: PropertyRequest) -> PropertySimulation:
    if request.price_cents <= 0:
        raise ValueError("Le prix du bien doit être strictement positif.")
    if request.down_payment_cents < 0:
        raise ValueError("L'apport ne peut pas être négatif.")

    notary = cents(Decimal(request.price_cents) * Decimal(request.notary_bps) / _BPS)
    acquisition = request.price_cents + notary
    borrowed = max(0, acquisition - request.down_payment_cents)
    schedule = build_schedule(borrowed, request.loan_rate_bps, request.loan_months)
    insurance = cents(
        Decimal(borrowed) * Decimal(request.insurance_bps_per_year) / _BPS / Decimal(12)
    )
    tax_monthly = cents(Decimal(request.annual_property_tax_cents) / Decimal(12))
    ratio = debt_ratio_bps(
        request.existing_debt_payments_cents + schedule.monthly_payment_cents + insurance,
        request.monthly_income_cents,
    )
    months = schedule.months if borrowed else 0
    return PropertySimulation(
        price_cents=request.price_cents, notary_fees_cents=notary,
        acquisition_cost_cents=acquisition, down_payment_cents=request.down_payment_cents,
        down_payment_short_cents=max(0, notary - request.down_payment_cents),
        borrowed_cents=borrowed, schedule=schedule,
        monthly_insurance_cents=insurance,
        monthly_charges_cents=request.monthly_charges_cents,
        monthly_property_tax_cents=tax_monthly,
        monthly_effort_cents=schedule.monthly_payment_cents + insurance
        + request.monthly_charges_cents + tax_monthly,
        total_interest_cents=schedule.total_interest_cents,
        total_cost_cents=acquisition + schedule.total_interest_cents + insurance * months,
        debt_ratio_bps=ratio,
        debt_ratio_exceeded=ratio is not None and ratio > HCSF_DEBT_RATIO_BPS,
    )


def rent_comparison(
    simulation: PropertySimulation,
    monthly_rent_cents: int,
    years: int,
    annual_return_bps: int,
    appreciation_bps_per_year: int,
) -> RentComparison:
    """Owner's net wealth against renter's, at the same date, from the same start.

    Both start with the same money: the owner spends the down payment and the
    fees on day one, the renter invests them. Both then spend the same amount
    each month -- the owner on the instalment, insurance, charges and taxe
    foncière, the renter on rent plus whatever is left over, invested.
    """
    if monthly_rent_cents < 0:
        raise ValueError("Le loyer ne peut pas être négatif.")
    if years < 1:
        raise ValueError("La durée de comparaison doit être d'au moins un an.")

    requested = years * 12
    horizon = requested
    capped: str | None = None
    if simulation.borrowed_cents > 0 and requested > simulation.schedule.months:
        horizon = simulation.schedule.months
        capped = (
            f"La comparaison s'arrête à la fin du crédit, soit "
            f"{simulation.schedule.months} mois : au-delà, la mensualité et "
            "l'assurance disparaissent et l'effort mensuel n'est plus le même. "
            "Prolonger le calcul sans le dire mélangerait deux situations "
            "différentes."
        )
    # A financed purchase is already bounded by the loan-term cap just above.
    # A CASH purchase has no loan to cap it, so nothing else stops `horizon`
    # from exceeding what `project_savings` will accept -- it would otherwise
    # raise its own "durée d'une projection" message, true but naming the
    # wrong thing: the user asked for a comparison, not a projection. Checked
    # AFTER the loan-term cap so a long horizon on a FINANCED purchase is
    # capped rather than refused -- the cap already brings it under the ceiling.
    elif horizon > MAX_PROJECTION_MONTHS:
        raise ValueError(
            "La durée de comparaison ne peut pas dépasser "
            f"{MAX_PROJECTION_MONTHS // 12} ans."
        )

    # Monthly compounding, like every other growth in this codebase, so a
    # horizon that is not a whole number of years is not lumpy.
    value = project_savings(simulation.price_cents, 0,
                            appreciation_bps_per_year, horizon).final_cents
    rows = simulation.schedule.rows
    remaining = rows[horizon - 1].remaining_cents if horizon <= len(rows) else 0
    buyer = value - remaining

    renter = project_savings(
        simulation.down_payment_cents + simulation.notary_fees_cents,
        simulation.monthly_effort_cents - monthly_rent_cents,
        annual_return_bps, horizon,
    ).final_cents

    return RentComparison(
        horizon_months=horizon, capped_reason=capped,
        monthly_rent_cents=monthly_rent_cents,
        buyer_property_value_cents=value, buyer_remaining_loan_cents=remaining,
        buyer_wealth_cents=buyer, renter_wealth_cents=renter,
        difference_cents=buyer - renter,
        better_kind="buy" if buyer >= renter else "rent",
    )
