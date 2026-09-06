"""The calendar a household declares, and what it commits them to.

`engines/recurrence.py` reads rhythms off the past: it can only ever describe
what statements already show, it needs three occurrences before it will speak,
and it refuses a charge whose amount wanders -- which is every water and
electricity bill there has ever been. All three refusals are right for what
that engine claims to do, and all three leave the household unable to say "I
pay this, on this day, every month" about a bill it knows perfectly well it
has.

This module is the other half. A DECLARATION is a fact the household states; an
OCCURRENCE is one due date it falls on; a CHECK-IN is the household ticking one
off, optionally with the amount actually billed. Nothing here is detected and
nothing here is guessed:

* a due date is arithmetic on the declared anchor, never an inference;
* a variable charge is costed on its check-ins once there are enough of them,
  on its declared estimate before that, and `amount_basis` says which -- an
  estimate presented as a measurement is the one thing this module must not do;
* charges and income are totalled apart, because a declared salary would
  otherwise hide a declared rent inside one comfortable net figure.

Pure: no session, no network, no clock -- `today` is a parameter.
"""

from calendar import monthrange
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Literal

from app.engines.recurrence import OCCURRENCES_PER_YEAR, Periodicity
from app.engines.robust import describe

OccurrenceStatus = Literal["pointed", "late", "due", "upcoming"]
AmountBasis = Literal["declared", "observed"]

# How many real amounts a variable charge needs before its own history replaces
# the declared estimate. Three, the same floor `engines/recurrence.py` uses to
# call anything a rhythm: two readings give one interval between them and no
# way to tell a level from a coincidence.
MIN_OBSERVATIONS_FOR_AVERAGE = 3

# How long after a due date a charge is merely due rather than late, per rhythm.
# Proportional, because a weekly charge two days late is nothing and a yearly
# one two days late is nothing either -- the same reasoning, and the same 20 %
# with a floor, as `recurrence.detect_recurrences`.
_GRACE_FLOOR_DAYS = 3
_GRACE_RATIO = 0.2

_NOMINAL_DAYS: dict[Periodicity, int] = {
    "weekly": 7, "biweekly": 14, "monthly": 30, "quarterly": 91, "yearly": 365,
}


@dataclass(frozen=True)
class DeclaredSchedule:
    """One charge or income the household has stated it has."""

    id: int
    label: str
    # Signed, like every amount in this codebase: negative is money leaving.
    # For a variable charge this is the household's own estimate, and
    # `observed_amount` may replace it once there are check-ins to replace it
    # with.
    amount_cents: int
    amount_is_variable: bool
    periodicity: Periodicity
    # The first due date. Every later one is arithmetic on THIS date, never on
    # the previous occurrence -- see `due_dates`.
    anchor_on: date
    ends_on: date | None
    active: bool


@dataclass(frozen=True)
class Checkin:
    """One due date the household ticked off, and what it really cost."""

    schedule_id: int
    due_on: date
    # What was actually billed. Signed. Not necessarily the declared amount --
    # that difference is the entire point for a water bill.
    amount_cents: int
    paid_on: date
    # The ledger line this was matched to, when the household named one.
    transaction_id: int | None


@dataclass(frozen=True)
class Occurrence:
    schedule_id: int
    label: str
    due_on: date
    # The check-in's real amount when there is one, the schedule's otherwise.
    amount_cents: int
    status: OccurrenceStatus
    paid_on: date | None
    transaction_id: int | None


@dataclass(frozen=True)
class ScheduleCost:
    """What one declaration costs a year, and on what authority."""

    schedule_id: int
    label: str
    amount_cents: int
    amount_basis: AmountBasis
    annual_cents: int
    # How many check-ins the figure rests on. Zero for a fixed charge that has
    # never been ticked off -- which is fine, its amount was declared -- and
    # the number that has to reach `MIN_OBSERVATIONS_FOR_AVERAGE` for a
    # variable one to stop being an estimate.
    observations: int


@dataclass(frozen=True)
class CalendarReport:
    occurrences: list[Occurrence]
    schedules: list[ScheduleCost]
    # Signed and separate, never netted: a declared salary must not be allowed
    # to hide a declared rent.
    annual_charges_cents: int
    annual_income_cents: int
    monthly_charges_cents: int
    monthly_income_cents: int
    late_count: int
    pointed_count: int
    # French, and non-null whenever there is nothing to show. An empty calendar
    # with no explanation reads as "you have no subscriptions", which is a
    # different claim from "you have not declared any yet".
    notice: str | None


def _divide(total: int, divisor: int) -> int:
    """Integer division rounded half away from zero. Money never goes float."""
    quotient, remainder = divmod(abs(total), divisor)
    magnitude = quotient + (1 if remainder * 2 >= divisor else 0)
    return magnitude if total >= 0 else -magnitude


def _shift_months(anchor: date, months: int) -> date:
    """`anchor` moved by whole months, its day clamped to the target month.

    Clamped, not skipped: a rent due on the 31st is due on the 28th of
    February, because the last day of the month is the day the household
    actually pays. And always computed from the ANCHOR, so the clamp cannot
    accumulate -- see `due_dates`.
    """
    total = anchor.month - 1 + months
    year = anchor.year + total // 12
    month = total % 12 + 1
    return date(year, month, min(anchor.day, monthrange(year, month)[1]))


def due_dates(schedule: DeclaredSchedule, start: date, end: date) -> list[date]:
    """Every date this declaration falls due on inside [start, end].

    Each occurrence is `anchor + k periods`, computed from the anchor and never
    from the occurrence before it. Stepping from the previous occurrence would
    make February's clamp permanent: a rent anchored on the 31st would land on
    the 28th in February, then the 28th in March, and walk backwards through
    the year one short month at a time.

    Nothing falls before the anchor -- a declaration says nothing about the
    months before the household made it -- and nothing after `ends_on`. An
    inactive declaration falls nowhere at all.
    """
    if not schedule.active:
        return []

    horizon = end if schedule.ends_on is None else min(end, schedule.ends_on)
    if horizon < schedule.anchor_on:
        return []

    dates: list[date] = []
    step = 0
    while True:
        current = _step(schedule, step)
        if current > horizon:
            break
        if current >= start:
            dates.append(current)
        step += 1
    return dates


def _step(schedule: DeclaredSchedule, k: int) -> date:
    if schedule.periodicity == "weekly":
        return schedule.anchor_on + timedelta(days=7 * k)
    if schedule.periodicity == "biweekly":
        return schedule.anchor_on + timedelta(days=14 * k)
    if schedule.periodicity == "monthly":
        return _shift_months(schedule.anchor_on, k)
    if schedule.periodicity == "quarterly":
        return _shift_months(schedule.anchor_on, 3 * k)
    if schedule.periodicity == "yearly":
        return _shift_months(schedule.anchor_on, 12 * k)
    raise ValueError(f"Périodicité inconnue : {schedule.periodicity}")


def observed_amount(
    schedule: DeclaredSchedule, checkins: list[Checkin]
) -> tuple[int, AmountBasis]:
    """What this declaration actually costs, and whether that was measured.

    A VARIABLE charge -- water, electricity, anything billed on consumption --
    is declared as an estimate and billed as something else. Once
    `MIN_OBSERVATIONS_FOR_AVERAGE` real amounts have been ticked off, the
    median of them replaces the estimate. The median rather than the mean: one
    catch-up bill after a meter reading is exactly the kind of value that
    should not move a household's monthly figure.

    A FIXED charge keeps its declared amount however many check-ins exist. A
    single prorated month must not silently redefine what a subscription costs
    -- if the price really changed, the household changes the declaration.

    The basis is returned beside the figure, never inferred by the caller: an
    estimate and a measurement are different claims and the screen says which.
    """
    mine = [c.amount_cents for c in checkins if c.schedule_id == schedule.id]
    if not schedule.amount_is_variable or len(mine) < MIN_OBSERVATIONS_FOR_AVERAGE:
        return schedule.amount_cents, "declared"
    return describe(mine).median, "observed"


def _status(due_on: date, periodicity: Periodicity, today: date) -> OccurrenceStatus:
    grace = max(_GRACE_FLOOR_DAYS, round(_NOMINAL_DAYS[periodicity] * _GRACE_RATIO))
    if today < due_on:
        return "upcoming"
    if today <= due_on + timedelta(days=grace):
        return "due"
    return "late"


def build_calendar(
    schedules: list[DeclaredSchedule],
    checkins: list[Checkin],
    start: date,
    end: date,
    today: date,
) -> CalendarReport:
    """The window's due dates, their state, and what the declarations commit to.

    The totals answer a different question from the occurrences and are built
    from a different set. Occurrences are what falls in [start, end] --
    including declarations that have since ended, because they really did fall
    due there. The yearly figures are what the household is committed to going
    FORWARD, so a declaration that is inactive, or whose `ends_on` is behind
    `today`, takes no part in them: billing someone for a subscription they
    cancelled is the exact failure this screen exists to prevent.
    """
    by_key = {(c.schedule_id, c.due_on): c for c in checkins}

    occurrences: list[Occurrence] = []
    costs: list[ScheduleCost] = []
    annual_charges = annual_income = 0

    for schedule in sorted(schedules, key=lambda s: (s.label, s.id)):
        amount, basis = observed_amount(schedule, checkins)
        observations = sum(1 for c in checkins if c.schedule_id == schedule.id)

        for due_on in due_dates(schedule, start, end):
            checkin = by_key.get((schedule.id, due_on))
            occurrences.append(Occurrence(
                schedule_id=schedule.id,
                label=schedule.label,
                due_on=due_on,
                amount_cents=checkin.amount_cents if checkin else amount,
                status="pointed" if checkin
                else _status(due_on, schedule.periodicity, today),
                paid_on=checkin.paid_on if checkin else None,
                transaction_id=checkin.transaction_id if checkin else None,
            ))

        still_running = schedule.active and (
            schedule.ends_on is None or schedule.ends_on >= today
        )
        annual = amount * OCCURRENCES_PER_YEAR[schedule.periodicity]
        costs.append(ScheduleCost(
            schedule_id=schedule.id,
            label=schedule.label,
            amount_cents=amount,
            amount_basis=basis,
            annual_cents=annual if still_running else 0,
            observations=observations,
        ))
        if still_running:
            if annual < 0:
                annual_charges += annual
            else:
                annual_income += annual

    occurrences.sort(key=lambda o: (o.due_on, o.label, o.schedule_id))

    notice: str | None = None
    if not schedules:
        notice = (
            "Aucune récurrence déclarée pour l'instant. Déclarez vos abonnements, "
            "votre loyer, l'eau et l'électricité : Yieldo les posera sur ce "
            "calendrier et vous pourrez les pointer à chaque échéance."
        )
    elif not occurrences:
        notice = (
            "Aucune échéance sur cette période. Vos déclarations existent, elles "
            "ne tombent simplement pas dans cette fenêtre."
        )

    return CalendarReport(
        occurrences=occurrences,
        schedules=costs,
        annual_charges_cents=annual_charges,
        annual_income_cents=annual_income,
        monthly_charges_cents=_divide(annual_charges, 12),
        monthly_income_cents=_divide(annual_income, 12),
        late_count=sum(1 for o in occurrences if o.status == "late"),
        pointed_count=sum(1 for o in occurrences if o.status == "pointed"),
        notice=notice,
    )
