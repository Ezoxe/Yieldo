"""The forecast plan: what a household already knows about a month before the
statement for it exists.

A household knows its rent, its phone contract, its streaming subscriptions.
It does not know them because Yieldo detected them -- it knows them because it
signed them. Those declarations live in their own table, never in the ledger,
and this module turns them into dated amounts an engine can be fed.

**Two kinds of line, and the distinction is the whole design.**

* A `fixed` line is a known amount on a known date: rent, a subscription, an
  insurance premium. It is realised ALL OR NOTHING -- once a real transaction
  in that month matches it, the occurrence disappears entirely, because the
  real figure is the true one and adding the estimate beside it would count the
  rent twice.
* An `envelope` line is a monthly allowance for a category: groceries, fuel,
  going out. It is realised BY SUBTRACTION -- what remains of the envelope
  after what has actually been spent against it. All-or-nothing would be wrong
  here in both directions: the first 4 € coffee of the month would cancel a
  400 € grocery envelope, and ignoring the twenty purchases already made would
  count them twice.

**No clock.** Every function takes its window, and `unrealised` deliberately
does NOT ask what today is. An occurrence dated in the past with nothing matching it
is not a payment that failed to happen -- it is, in the situation this mode
exists for, a payment whose statement has not been imported yet. Treating the
two differently would need a fact the module does not have.

Pure, per CLAUDE.md: no session, no network, no implicit clock.
"""

from calendar import monthrange
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Literal

from app.engines.aggregate import TxPoint

PlanKind = Literal["fixed", "envelope"]
PlanPeriodicity = Literal["weekly", "biweekly", "monthly", "quarterly", "yearly", "one_off"]

# The modes the whole application can be read in. `real` is the ledger and
# nothing else -- every figure Yieldo has ever shown. The other two are stated
# on screen wherever they apply, because a figure that mixes a statement with a
# declaration and does not say so is a lie told in the right font.
LedgerMode = Literal["real", "estimated", "blended"]
LEDGER_MODES: tuple[LedgerMode, ...] = ("real", "estimated", "blended")

# Months between two occurrences, for the periodicities counted in months.
_MONTH_STEP: dict[str, int] = {"monthly": 1, "quarterly": 3, "yearly": 12}
# Days between two occurrences, for the ones counted in days.
_DAY_STEP: dict[str, int] = {"weekly": 7, "biweekly": 14}


@dataclass(frozen=True)
class PlanLine:
    """One declaration, in the engine's own shape. Deliberately not an ORM object.

    `label_key` is the normalised matching key, computed by the caller with
    `importers.dedup.normalize_label` -- never read from a stored column, for
    the reason `common.recurrence_points` gives about its own key: what is
    stored depends on which version wrote it.

    An empty `label_key` means the line matches on its category alone. An
    `envelope` line always has a `category_id`; a `fixed` line may have none,
    in which case only its label can realise it.
    """

    id: int
    label: str
    label_key: str
    amount_cents: int
    kind: PlanKind
    category_id: int | None
    account_id: int | None
    periodicity: PlanPeriodicity
    day_of_month: int
    start_on: date
    end_on: date | None
    active: bool


@dataclass(frozen=True)
class PlannedOccurrence:
    """One dated instance of a plan line."""

    line_id: int
    on: date
    amount_cents: int
    label: str
    category_id: int | None
    account_id: int | None


@dataclass(frozen=True)
class RealPoint:
    """A real transaction, reduced to what realisation matching needs."""

    on: date
    amount_cents: int
    label_key: str
    category_id: int | None


def _clamped(year: int, month: int, day: int) -> date:
    """The day-of-month asked for, or the last day of a month too short for it.

    A rent due on the 31st is due on the 28th of February, not on the 3rd of
    March. `monthrange` gives the length, so leap years need no special case.
    """
    return date(year, month, min(day, monthrange(year, month)[1]))


def _month_occurrences(line: PlanLine, date_from: date, date_to: date) -> list[date]:
    step = _MONTH_STEP[line.periodicity]
    # Anchored on the start month, so a quarterly line declared in February
    # falls in February, May, August, November -- not on the calendar quarters.
    index = (date_from.year - line.start_on.year) * 12 + (date_from.month - line.start_on.month)
    # Back up one step: the occurrence just before the window can still land
    # inside it once the day-of-month is applied.
    index = max(0, (index // step) * step - step)

    days: list[date] = []
    while True:
        months = index * step
        year = line.start_on.year + (line.start_on.month - 1 + months) // 12
        month = (line.start_on.month - 1 + months) % 12 + 1
        on = _clamped(year, month, line.day_of_month)
        if on > date_to:
            return days
        if on >= date_from and on >= line.start_on:
            days.append(on)
        index += 1


def _day_occurrences(line: PlanLine, date_from: date, date_to: date) -> list[date]:
    step = _DAY_STEP[line.periodicity]
    on = line.start_on
    if on < date_from:
        # Jump straight to the first occurrence inside the window rather than
        # walking a decade of weeks one at a time.
        skipped = ((date_from - on).days + step - 1) // step
        on += timedelta(days=skipped * step)
    days: list[date] = []
    while on <= date_to:
        days.append(on)
        on += timedelta(days=step)
    return days


def occurrences(lines: list[PlanLine], date_from: date, date_to: date) -> list[PlannedOccurrence]:
    """Every dated instance the plan produces inside the window, ordered by date.

    Inactive lines produce nothing, and neither does a line whose `end_on` has
    passed: a subscription that was cancelled is not a forecast, it is history.
    """
    produced: list[PlannedOccurrence] = []
    for line in lines:
        if not line.active:
            continue
        window_to = date_to if line.end_on is None else min(date_to, line.end_on)
        window_from = max(date_from, line.start_on)
        if window_from > window_to:
            continue

        if line.periodicity == "one_off":
            days = [line.start_on] if window_from <= line.start_on <= window_to else []
        elif line.periodicity in _DAY_STEP:
            days = _day_occurrences(line, window_from, window_to)
        else:
            days = _month_occurrences(line, window_from, window_to)

        produced.extend(
            PlannedOccurrence(
                line_id=line.id, on=on, amount_cents=line.amount_cents, label=line.label,
                category_id=line.category_id, account_id=line.account_id,
            )
            for on in days
        )
    produced.sort(key=lambda occurrence: (occurrence.on, occurrence.line_id))
    return produced


def _matches(line: PlanLine, point: RealPoint) -> bool:
    """Whether a real transaction is this line's payment.

    The label key first, as a substring in either direction: a line declared
    "Netflix" must recognise the statement's "PRLV NETFLIX INTERNATIONAL", and
    a line copied verbatim from a statement must still recognise a shorter
    variant of it. The category alone only when the line declares no label --
    otherwise a single "Loisirs" purchase would settle a named subscription.
    """
    if line.amount_cents < 0 <= point.amount_cents:
        return False
    if line.amount_cents > 0 > point.amount_cents:
        return False
    if line.label_key:
        return line.label_key in point.label_key or point.label_key in line.label_key
    return line.category_id is not None and line.category_id == point.category_id


def _same_month(left: date, right: date) -> bool:
    return (left.year, left.month) == (right.year, right.month)


def unrealised(
    lines: list[PlanLine], real: list[RealPoint], date_from: date, date_to: date
) -> list[PlannedOccurrence]:
    """The part of the plan the ledger does not already account for.

    A `fixed` occurrence drops out entirely as soon as one real transaction in
    its own calendar month matches it, and that transaction is then spent --
    two occurrences of the same line in one month (a fortnightly charge) need
    two real transactions to both disappear.

    An `envelope` line is not an occurrence to cancel but an allowance to draw
    down: what it contributes for a month is the envelope minus what was really
    spent against it that month, floored at zero. An envelope already overspent
    contributes nothing -- it does not contribute a negative correction, since
    the real transactions are already in the total and the household is not
    owed the difference back.
    """
    by_id = {line.id: line for line in lines}
    produced = occurrences(lines, date_from, date_to)

    consumed: set[int] = set()
    kept: list[PlannedOccurrence] = []
    envelope_months: dict[tuple[int, int, int], PlannedOccurrence] = {}

    for occurrence in produced:
        line = by_id[occurrence.line_id]
        if line.kind == "envelope":
            # One line contributes at most once per month; `occurrences` may
            # have produced several if the line is not monthly.
            envelope_months.setdefault(
                (line.id, occurrence.on.year, occurrence.on.month), occurrence
            )
            continue

        matched = next(
            (
                index
                for index, point in enumerate(real)
                if index not in consumed
                and _same_month(point.on, occurrence.on)
                and _matches(line, point)
            ),
            None,
        )
        if matched is None:
            kept.append(occurrence)
        else:
            consumed.add(matched)

    for (line_id, year, month), occurrence in envelope_months.items():
        line = by_id[line_id]
        planned = abs(line.amount_cents)
        spent = sum(
            abs(point.amount_cents)
            for point in real
            if point.on.year == year and point.on.month == month and _matches(line, point)
        )
        remaining = planned - spent
        if remaining <= 0:
            continue
        signed = -remaining if line.amount_cents < 0 else remaining
        kept.append(
            PlannedOccurrence(
                line_id=line_id, on=occurrence.on, amount_cents=signed, label=line.label,
                category_id=line.category_id, account_id=line.account_id,
            )
        )

    kept.sort(key=lambda occurrence: (occurrence.on, occurrence.line_id))
    return kept


def as_tx_points(produced: list[PlannedOccurrence], fallback_account_id: int) -> list[TxPoint]:
    """Plan occurrences in the shape every aggregation engine already reads.

    `fallback_account_id` stands in for a line that names no account: an engine
    that groups by account must still be able to place the amount somewhere,
    and the household's own main account is a better answer than dropping the
    line. Nothing here is ever a transfer -- a forecast of moving money between
    two of one's own accounts is not a forecast of spending it.
    """
    return [
        TxPoint(
            on=occurrence.on,
            amount_cents=occurrence.amount_cents,
            category_id=occurrence.category_id,
            account_id=occurrence.account_id or fallback_account_id,
            is_transfer=False,
        )
        for occurrence in produced
    ]

