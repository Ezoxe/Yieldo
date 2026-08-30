"""Constant-payment loans, in integer cents.

Every loan figure in Yieldo comes from here: the "emprunter Z EUR" lever of the
purchase-feasibility engine (design §6.3 item 5), the credit simulator and the
property simulator. Written once so the same loan quoted on three screens is
the same number.

**Fractional arithmetic without a float on a monetary value.** An annuity needs
powers and divisions that integers cannot express. Every interior computation
here runs in `decimal.Decimal` -- exact, base-10, no binary representation error
-- and is quantised back to an integer number of cents with `ROUND_HALF_UP` the
moment a cent is produced. Nothing crosses a function boundary as a float, and
a rate is an integer number of basis points, not a float, for the same reason:
a float rate multiplied into a cents value would smuggle a float into money.

**The rounding residue is absorbed by the final instalment.** Rounding each
month's interest to the cent leaves the level payment unable to clear the
capital exactly. The alternative -- leaving one cent outstanding, or silently
smearing the difference -- would break the invariant every consumer relies on:
the principal components sum to the capital borrowed, and total paid equals
capital plus interest, to the cent. `test_the_schedule_is_exact_to_the_cent`
pins it.

Pure: no session, no network, no clock.
"""

from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal

# The HCSF (Haut Conseil de stabilité financière) ceiling on a French
# household's debt-service ratio, in basis points: 35,00 %. Design §6.3 item 5
# names it explicitly ("alerte si le seuil de 35 % est franchi"). It is a
# published regulatory threshold, not a tuned constant.
HCSF_DEBT_RATIO_BPS = 3500

# Forty years. Past this a French bank does not lend, and a schedule that long
# is a table nobody reads. The bound exists so a mistyped horizon surfaces as a
# French error rather than as a 100 000-row response.
MAX_LOAN_MONTHS = 480

_BPS = Decimal(10_000)
_MONTHS_PER_YEAR = Decimal(12)
_ONE_CENT = Decimal(1)


def cents(value: Decimal) -> int:
    """A Decimal amount, rounded half away from zero, as an integer of cents.

    `ROUND_HALF_UP` in Python's `decimal` means *half away from zero*, so a
    negative half rounds to the larger magnitude too. Symmetry matters here for
    the same reason it does in `robust._half`: rounding expenses one way and
    incomes the other is a silent, directional bias on money.
    """
    return int(value.quantize(_ONE_CENT, rounding=ROUND_HALF_UP))


def monthly_rate(annual_rate_bps: int) -> Decimal:
    """The nominal annual rate, in basis points, as an exact monthly Decimal.

    Proportional division by twelve (taux nominal / 12), which is how a French
    *taux débiteur* is applied to a monthly instalment -- not the twelfth root
    of the annual factor, which would be an actuarial rate and would disagree
    with every bank's own amortisation table.
    """
    return Decimal(annual_rate_bps) / _BPS / _MONTHS_PER_YEAR


def _validate(principal_cents: int, annual_rate_bps: int, months: int) -> None:
    if principal_cents < 0:
        raise ValueError("Le capital emprunté ne peut pas être négatif.")
    if annual_rate_bps < 0:
        raise ValueError("Le taux d'un crédit ne peut pas être négatif.")
    if not 1 <= months <= MAX_LOAN_MONTHS:
        raise ValueError(
            f"La durée d'un crédit doit être comprise entre 1 et {MAX_LOAN_MONTHS} mois."
        )


def monthly_payment_cents(principal_cents: int, annual_rate_bps: int, months: int) -> int:
    """The level instalment: P * i / (1 - (1+i)^-n), rounded half up to the cent.

    Half up on BOTH branches -- the zero-rate one included -- so there is one
    rounding rule in this module rather than two that disagree. The residue
    this leaves, in either direction, lands on the final instalment, which
    `build_schedule` resizes: the last payment is therefore routinely a cent or
    two away from this figure, and that is where the schedule's exactness comes
    from. Callers printing "mensualité" print this number; callers printing a
    schedule print each row's own `payment_cents`.
    """
    _validate(principal_cents, annual_rate_bps, months)
    if principal_cents == 0:
        return 0
    rate = monthly_rate(annual_rate_bps)
    if rate == 0:
        return cents(Decimal(principal_cents) / Decimal(months))
    factor = (Decimal(1) + rate) ** months
    exact = Decimal(principal_cents) * rate * factor / (factor - Decimal(1))
    return cents(exact)


@dataclass(frozen=True)
class ScheduleRow:
    # 1-based: month 1 is the first instalment, not the day the loan is signed.
    month: int
    payment_cents: int
    interest_cents: int
    principal_cents: int
    # Capital still owed AFTER this instalment. 0 on the last row, always.
    remaining_cents: int


@dataclass(frozen=True)
class LoanSchedule:
    principal_cents: int
    annual_rate_bps: int
    # The stated term. `rows` is empty when nothing was borrowed, but `months`
    # still reports what was asked for -- a caller printing "sur 240 mois"
    # beside a zero loan must not read 0 here.
    months: int
    monthly_payment_cents: int
    total_paid_cents: int
    total_interest_cents: int
    # Empty exactly when `principal_cents == 0`. Never truncated: a caller that
    # wants a yearly view aggregates these itself.
    rows: list[ScheduleRow]


def build_schedule(principal_cents: int, annual_rate_bps: int, months: int) -> LoanSchedule:
    """The full amortisation table, exact to the cent.

    Borrowing nothing returns an empty schedule rather than raising: a property
    bought outright, or a feasibility gap already covered, is a real answer.
    Every other invalid input raises in French -- there is no zero standing in
    for a capital that could not be computed.
    """
    _validate(principal_cents, annual_rate_bps, months)
    payment = monthly_payment_cents(principal_cents, annual_rate_bps, months)
    if principal_cents == 0:
        return LoanSchedule(
            principal_cents=0, annual_rate_bps=annual_rate_bps, months=months,
            monthly_payment_cents=0, total_paid_cents=0, total_interest_cents=0, rows=[],
        )

    rate = monthly_rate(annual_rate_bps)
    remaining = principal_cents
    rows: list[ScheduleRow] = []
    total_interest = 0
    total_paid = 0

    for month in range(1, months + 1):
        interest = cents(Decimal(remaining) * rate)
        principal = payment - interest
        # Two ways the level payment stops being right, both handled the same
        # way -- the instalment is resized so `remaining` lands exactly on zero:
        # the final month (where the rounding residue lives), and any month
        # where the level payment would overshoot what is left.
        if month == months or principal > remaining:
            principal = remaining
        this_payment = principal + interest
        remaining -= principal
        total_interest += interest
        total_paid += this_payment
        rows.append(ScheduleRow(
            month=month, payment_cents=this_payment, interest_cents=interest,
            principal_cents=principal, remaining_cents=remaining,
        ))
        if remaining == 0 and month < months:
            # Repaid early because the level payment overshot. Stop rather than
            # emitting zero-value rows a chart would draw as a flat tail.
            break

    return LoanSchedule(
        principal_cents=principal_cents, annual_rate_bps=annual_rate_bps, months=months,
        monthly_payment_cents=payment, total_paid_cents=total_paid,
        total_interest_cents=total_interest, rows=rows,
    )


def debt_ratio_bps(monthly_payments_cents: int, monthly_income_cents: int | None) -> int | None:
    """Taux d'endettement, in basis points. `None` when income is unmeasurable.

    `None`, never 0: a household whose income could not be measured has no debt
    ratio, and a zero here would render as "0 % d'endettement" -- a fallback
    value standing in for real data, which the no-silent-failures rule forbids.
    Callers get `None` and must say so on screen.

    Compare against `HCSF_DEBT_RATIO_BPS` to decide whether the 35 % threshold
    design §6.3 item 5 names has been crossed.
    """
    if monthly_income_cents is None or monthly_income_cents <= 0:
        return None
    return int(
        (Decimal(monthly_payments_cents) * _BPS / Decimal(monthly_income_cents))
        .quantize(_ONE_CENT, rounding=ROUND_HALF_UP)
    )
