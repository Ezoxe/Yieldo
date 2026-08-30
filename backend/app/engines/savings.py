"""What a savings plan becomes, month by month, in integer cents.

Consumed by the purchase-feasibility horizon, the opportunity cost of design
§6.3 item 4, the savings simulator, the goal projections, the renter's pot in
the property comparison, and the wealth comparison of §6.3 item 6.

Three conventions, each load-bearing:

* **End-of-month contributions** (annuité de fin de période). A contribution
  earns no interest in the month it is made. The other convention would report
  a month of growth that has not happened yet.
* **A non-positive balance earns nothing.** A savings pot that has gone
  negative is an overdraft, not an investment, and crediting it a return would
  manufacture money out of a debt. This is not a hypothetical branch: the
  operator's measured savings capacity is negative and his liquid balance is
  -220 963 c, so every projection run on his real data passes through it.
* **Nothing is clamped at zero.** A negative contribution is a withdrawal --
  which is exactly how "pay the loan out of the same income the cash buyer
  invests" is modelled -- and a pot that runs out keeps going negative. Phase
  2A's `capacity.measure_savings_capacity` keeps the sign of a deficit for the
  same reason: clamping it would let a feasibility verdict read "atteignable"
  for a household going backwards every month.

The inverses (`required_monthly_cents`, `months_to_target`) are computed
**against `project_savings` itself**, by search rather than by a closed form.
The closed form disagrees with the per-month rounding by a few cents, and a
"required contribution" that does not actually reach the target when fed back
into the projection on the same screen is the kind of internal contradiction
this project keeps finding in review.

**Rounding point:** interest is rounded to the cent every month, on the
opening balance of that month (`cents(Decimal(balance) * rate)`), not once at
the end. A single end-of-horizon rounding would disagree with the balance a
chart draws for any intermediate month, and `SavingsPoint` exists precisely so
a chart can plot the running balance -- an approximation that only becomes
exact at the last point would make every earlier point wrong. The identity
this buys, pinned by `test_the_projection_accounts_for_every_cent_it_moves`:
`final_cents == initial_cents + contributed_cents + interest_cents`, exactly,
on every projection, because both cumulative fields are literally accumulated
from the same rounded monthly figures that produced `final_cents`. There is no
separate "residue" to absorb, unlike `amortization.build_schedule`: nothing
here is solved for a target balance of zero, so there is no shortfall a final
row must be resized to cover.

Pure: no session, no network, no clock.
"""

from dataclasses import dataclass
from decimal import Decimal

from app.engines.amortization import cents, monthly_rate

# The default rate of return on savings, in basis points: 3,00 %/an. An
# assumption, not a measurement -- design §10 requires every assumption to be
# displayed beside the result it produced, and every screen in this phase does.
# The user can override it; Yieldo never fetches a market rate.
DEFAULT_ANNUAL_RETURN_BPS = 300

# Fifty years, matching `runway.MAX_DATED_MONTHS`. Past it a projection is
# noise and a date is meaningless.
MAX_PROJECTION_MONTHS = 600


@dataclass(frozen=True)
class SavingsPoint:
    month: int
    # Both cumulative from the start of the projection, not per-month, so a
    # chart can draw the contributed/earned split at any point without summing.
    contributed_cents: int
    interest_cents: int
    balance_cents: int


@dataclass(frozen=True)
class SavingsProjection:
    initial_cents: int
    # May be negative: a withdrawal plan, or a measured savings capacity that
    # is a deficit. See the module docstring.
    monthly_cents: int
    annual_rate_bps: int
    months: int
    final_cents: int
    contributed_cents: int
    # Always >= 0: interest accrues only on a positive balance.
    interest_cents: int
    points: list[SavingsPoint]


def _validate(annual_rate_bps: int, months: int) -> None:
    if annual_rate_bps < 0:
        raise ValueError("Le taux de rendement ne peut pas être négatif.")
    if not 1 <= months <= MAX_PROJECTION_MONTHS:
        raise ValueError(
            f"La durée d'une projection doit être comprise entre 1 et "
            f"{MAX_PROJECTION_MONTHS} mois."
        )


def project_savings(
    initial_cents: int, monthly_cents: int, annual_rate_bps: int, months: int
) -> SavingsProjection:
    """Month-by-month growth. See the module docstring for the three conventions."""
    _validate(annual_rate_bps, months)
    rate = monthly_rate(annual_rate_bps)
    balance = initial_cents
    contributed = 0
    interest_total = 0
    points: list[SavingsPoint] = []

    for month in range(1, months + 1):
        # Interest first, on the opening balance, and only when there is a
        # positive balance to earn it.
        interest = cents(Decimal(balance) * rate) if balance > 0 else 0
        balance += interest + monthly_cents
        contributed += monthly_cents
        interest_total += interest
        points.append(SavingsPoint(
            month=month, contributed_cents=contributed,
            interest_cents=interest_total, balance_cents=balance,
        ))

    return SavingsProjection(
        initial_cents=initial_cents, monthly_cents=monthly_cents,
        annual_rate_bps=annual_rate_bps, months=months, final_cents=balance,
        contributed_cents=contributed, interest_cents=interest_total, points=points,
    )


def required_monthly_cents(
    target_cents: int, initial_cents: int, annual_rate_bps: int, months: int
) -> int:
    """The smallest whole-cent monthly contribution reaching `target_cents`.

    Binary search over `project_savings`, not a closed-form annuity: the final
    balance is strictly increasing in the contribution, so the search is exact,
    and the answer is guaranteed consistent with the projection the same screen
    draws beside it.

    Returns 0 -- never a negative "contribution" -- when the target is already
    covered by the initial amount and its own growth. The upper bound is
    `target - initial`, which always suffices: at `months == 1` the final
    balance is at least `initial + (target - initial) == target`, and interest
    is never negative.
    """
    _validate(annual_rate_bps, months)
    if project_savings(initial_cents, 0, annual_rate_bps, months).final_cents >= target_cents:
        return 0
    low, high = 1, max(1, target_cents - initial_cents)
    while low < high:
        middle = (low + high) // 2
        if project_savings(
            initial_cents, middle, annual_rate_bps, months
        ).final_cents >= target_cents:
            high = middle
        else:
            low = middle + 1
    return low


def months_to_target(
    target_cents: int, initial_cents: int, monthly_cents: int, annual_rate_bps: int
) -> int | None:
    """Whole months until the balance first reaches `target_cents`.

    `None` -- never a sentinel integer, never `MAX_PROJECTION_MONTHS` -- in the
    two cases where no month ever reaches it:

    * the balance stops growing (a non-positive contribution on a balance that
      earns nothing, which is the operator's own state: a measured capacity of
      -74 619 c/month on a negative pot). A "délai" quoted here would put a
      date on screen that will never arrive;
    * the target is past the fifty-year bound -- including a balance that IS
      growing (a positive contribution, or interest on a positive pot) but
      would only cross the target beyond month 600. Reachable in principle,
      unreachable within any horizon this engine will project.

    0 when the target is already met, which is a real answer.
    """
    if annual_rate_bps < 0:
        raise ValueError("Le taux de rendement ne peut pas être négatif.")
    if initial_cents >= target_cents:
        return 0

    rate = monthly_rate(annual_rate_bps)
    balance = initial_cents
    for month in range(1, MAX_PROJECTION_MONTHS + 1):
        previous = balance
        interest = cents(Decimal(balance) * rate) if balance > 0 else 0
        balance += interest + monthly_cents
        if balance >= target_cents:
            return month
        if balance <= previous and monthly_cents <= 0:
            # It did not grow this month and nothing is being added: it never
            # will. Refuse now rather than iterating six hundred times to the
            # same conclusion -- this is a performance short-circuit, not the
            # correctness path: deleting it still ends in the same None, from
            # the loop exhausting its range below.
            return None
    return None


def opportunity_cost_cents(amount_cents: int, annual_rate_bps: int, months: int) -> int:
    """What `amount_cents` would have EARNED over `months` -- the forgone gain.

    Design §6.3 item 4: "ce que la somme aurait produit si elle avait été
    investie". The gain alone, not the amount plus the gain: printing the
    latter under "coût d'opportunité" overstates it by the whole purchase price.

    0 for a non-positive amount: no capital was tied up, so nothing was forgone.
    """
    if amount_cents <= 0:
        return 0
    return project_savings(amount_cents, 0, annual_rate_bps, months).final_cents - amount_cents
