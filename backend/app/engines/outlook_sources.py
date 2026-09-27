"""What is known about the future of one perimeter, one euro one source.

The Avenir screen adds three kinds of future amount, and every euro of the
household's history may feed only one of them:

1. **detected recurrences** (`engines/recurrence`), projected on their own
   calendar;
2. **declarations** -- the recurrences the household declared
   (`engines/schedule`) and the one-off events it planned;
3. **the variable part** -- everything else in the history, measured as a
   median and a spread by `engines/forecast.residual_model`.

The rules that keep them disjoint, in order:

* a declared recurrence REPLACES the detected one it matches -- same label, or
  same sign, same rhythm, an amount within 15 % and a next due date within five
  days. The household's word wins over the detector's guess; the detected run's
  rows stay out of the variable part exactly as they would if it were
  projected itself;
* rows pointed on a declaration (its check-ins) or whose label matches it leave
  the variable part: their future is the declaration's;
* a declaration that began before the statements end, matched by nothing and
  linked to no row, is still projected -- the household said it pays it -- but
  carries a warning: its past payments may be inside the variable part already,
  and then it is counted twice.

The perimeter's own transfers cancel (`engines/transfer.paired_within`): the
two legs of a transfer from the current account to the livret are one movement
inside « Tout le disponible », while a transfer to a PEA leaves it.

Pure: no session, no network, no clock -- `as_of` is a parameter.
"""

from calendar import monthrange
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Literal

from app.engines.capacity import MonthlyEntry
from app.engines.forecast import (
    CALENDAR_MONTHS_PER_PERIOD,
    LedgerEntry,
    ResidualHistory,
    build_observations,
    is_projected,
    residual_entries,
)
from app.engines.recurrence import PERIOD_BOUNDS, Recurrence, RecurringTx, detect_recurrences
from app.engines.schedule import DeclaredSchedule, due_dates
from app.engines.transfer import TransferLeg, paired_within

Source = Literal["detected", "declared", "planned", "scenario"]

# Within this share of the declared amount a detection is the same charge.
# Fifteen per cent absorbs a tariff revision between the declaration and the
# statements; beyond it two charges of one rhythm are two charges.
MATCH_AMOUNT_TOLERANCE_PERCENT = 15
# A direct debit moves a few days with weekends and bank holidays.
MATCH_DAY_TOLERANCE = 5
# Below four characters a shared substring is a coincidence (« eau » in
# « bureau »), not the same payee.
MIN_LABEL_MATCH_LENGTH = 4
# How far ahead the next due date of a declaration is looked for when
# comparing it with a detection: past a year there is nothing to compare.
_LOOKAHEAD_DAYS = 400


@dataclass(frozen=True)
class FlowRow:
    """One ledger row of the perimeter, as the engines need it."""

    id: int
    on: date
    amount_cents: int
    account_id: int
    # `importers.dedup.normalize_label(label_raw)` -- the detection's own key.
    label_key: str
    label_raw: str
    category_id: int | None
    is_transfer: bool


@dataclass(frozen=True)
class Declared:
    """A declared recurrence, with what the caller already resolved: the amount
    to project (`schedule.observed_amount` once there are check-ins), its
    normalised label, and the ledger rows it was pointed on."""

    schedule: DeclaredSchedule
    amount_cents: int
    account_id: int | None
    category_id: int | None
    label_key: str
    checkin_transaction_ids: frozenset[int]


@dataclass(frozen=True)
class Planned:
    id: int
    label: str
    on: date
    amount_cents: int
    account_id: int | None
    category_id: int | None


@dataclass(frozen=True)
class KnownEvent:
    on: date
    amount_cents: int
    label: str
    source: Source
    # What a scenario targets: "detected:<label_key>", "declared:<id>",
    # "planned:<id>" or "scenario:<n>".
    series: str
    category_id: int | None


@dataclass(frozen=True)
class Series:
    """A projected recurrence a scenario can cancel or re-price."""

    id: str
    label: str
    source: Source
    amount_cents: int
    periodicity: str


@dataclass(frozen=True)
class Sources:
    events: list[KnownEvent]
    series: list[Series]
    history: ResidualHistory
    # The variable part's own rows, after every subtraction: what the
    # intra-month profile is measured on.
    residual_rows: list[MonthlyEntry]
    warnings: list[str]
    detected_projected: int
    declared_projected: int
    planned_projected: int
    reconciled: int


def labels_match(left: str, right: str) -> bool:
    """One normalised label inside the other, the shorter at least four
    characters long -- the rule `engines/plan` realises a line by."""
    shorter, longer = sorted((left, right), key=len)
    return len(shorter) >= MIN_LABEL_MATCH_LENGTH and shorter in longer


def _month_index(on: date) -> int:
    return on.year * 12 + on.month - 1


def detected_dates(recurrence: Recurrence, after: date, until: date) -> list[date]:
    """The future charges of a detected recurrence, strictly after `after`.

    Calendar rhythms step in months from the month of `expected_next_on`, on
    the day the charge has been landing on (`last_on`), clamped to short months
    -- the same months `forecast._recurring_by_month` bins. Weekly and biweekly
    step in days. A charge due on or before `after` belongs to the present.
    """
    step_months = CALENDAR_MONTHS_PER_PERIOD.get(recurrence.periodicity)
    dates: list[date] = []
    if step_months is not None:
        anchor = _month_index(recurrence.expected_next_on)
        day = recurrence.last_on.day
        k = 0
        while True:
            year, month = divmod(anchor + k * step_months, 12)
            month += 1
            on = date(year, month, min(day, monthrange(year, month)[1]))
            if on > until:
                return dates
            if on > after:
                dates.append(on)
            k += 1
    step = timedelta(days=PERIOD_BOUNDS[recurrence.periodicity][0])
    on = recurrence.expected_next_on
    while on <= after:
        on += step
    while on <= until:
        dates.append(on)
        on += step
    return dates


def _next_declared(declared: Declared, after: date) -> date | None:
    upcoming = due_dates(declared.schedule, after + timedelta(days=1),
                         after + timedelta(days=_LOOKAHEAD_DAYS))
    return upcoming[0] if upcoming else None


def _same_charge(declared: Declared, recurrence: Recurrence, as_of: date) -> bool:
    if declared.amount_cents * recurrence.amount_cents <= 0:
        return False
    if labels_match(declared.label_key, recurrence.label_key):
        return True
    if declared.schedule.periodicity != recurrence.periodicity:
        return False
    gap = abs(recurrence.amount_cents - declared.amount_cents)
    if gap * 100 > MATCH_AMOUNT_TOLERANCE_PERCENT * abs(declared.amount_cents):
        return False
    declared_next = _next_declared(declared, as_of)
    detected_next = detected_dates(recurrence, as_of, as_of + timedelta(days=_LOOKAHEAD_DAYS))
    if declared_next is None or not detected_next:
        return False
    return abs((declared_next - detected_next[0]).days) <= MATCH_DAY_TOLERANCE


def _unlinked_warning(label: str) -> str:
    return (
        f"Aucune ligne de vos relevés ne correspond à « {label} » : si ce prélèvement "
        "figure déjà dans vos dépenses, il est compté deux fois. Donnez-lui le libellé "
        "du relevé."
    )


def assemble(
    rows: list[FlowRow],
    *,
    dismissed_keys: frozenset[str],
    declared: list[Declared],
    planned: list[Planned],
    as_of: date,
    horizon_end: date,
    ledger_start: date,
    ledger_end: date,
) -> Sources:
    """Everything the projection needs about one perimeter's future.

    `rows` are the perimeter's own rows; `declared` and `planned` are already
    filtered to the perimeter by the caller (no account, or one of its
    accounts). `ledger_start` / `ledger_end` are the statements' real extent
    -- see `forecast.build_observations` for why a display window must never
    stand in for them.
    """
    internal = paired_within([
        TransferLeg(id=row.id, on=row.on, amount_cents=row.amount_cents,
                    account_id=row.account_id)
        for row in rows if row.is_transfer
    ])
    flows = [row for row in rows if row.id not in internal]

    detection = detect_recurrences(
        [
            RecurringTx(on=row.on, amount_cents=row.amount_cents, label_key=row.label_key,
                        label_raw=row.label_raw, category_id=row.category_id)
            for row in flows if row.label_key not in dismissed_keys
        ],
        as_of,
    )
    projected = [item for item in detection.recurrences if is_projected(item)]

    active = [item for item in declared if item.schedule.active]
    replaced: dict[str, int] = {}
    reconciled_ids: set[int] = set()
    for item in active:
        candidates = [
            recurrence for recurrence in projected
            if recurrence.label_key not in replaced and _same_charge(item, recurrence, as_of)
        ]
        if not candidates:
            continue
        best = min(candidates, key=lambda r: (abs(r.amount_cents - item.amount_cents), r.label_key))
        replaced[best.label_key] = item.schedule.id
        reconciled_ids.add(item.schedule.id)

    linked: set[int] = set()
    warnings: list[str] = []
    for item in active:
        own = {
            row.id for row in flows
            if row.id in item.checkin_transaction_ids
            or (item.schedule.anchor_on <= row.on <= as_of
                and labels_match(item.label_key, row.label_key))
        }
        linked |= own
        started = item.schedule.anchor_on <= as_of
        if started and not own and item.schedule.id not in reconciled_ids:
            warnings.append(_unlinked_warning(item.schedule.label))

    entries = [
        LedgerEntry(on=row.on, amount_cents=row.amount_cents, label_key=row.label_key)
        for row in flows if row.id not in linked
    ]
    history = build_observations(entries=entries, recurrences=projected,
                                 ledger_start=ledger_start, ledger_end=ledger_end)
    residual_rows = residual_entries(entries, projected)

    events: list[KnownEvent] = []
    series: list[Series] = []
    for recurrence in projected:
        if recurrence.label_key in replaced:
            continue
        dates = detected_dates(recurrence, as_of, horizon_end)
        series_id = f"detected:{recurrence.label_key}"
        events.extend(
            KnownEvent(on=on, amount_cents=recurrence.amount_cents, label=recurrence.label,
                       source="detected", series=series_id,
                       category_id=recurrence.category_id)
            for on in dates
        )
        if dates:
            series.append(Series(id=series_id, label=recurrence.label, source="detected",
                                 amount_cents=recurrence.amount_cents,
                                 periodicity=recurrence.periodicity))
    declared_projected = 0
    for item in active:
        dates = due_dates(item.schedule, as_of + timedelta(days=1), horizon_end)
        series_id = f"declared:{item.schedule.id}"
        events.extend(
            KnownEvent(on=on, amount_cents=item.amount_cents, label=item.schedule.label,
                       source="declared", series=series_id, category_id=item.category_id)
            for on in dates
        )
        if dates:
            declared_projected += 1
            series.append(Series(id=series_id, label=item.schedule.label, source="declared",
                                 amount_cents=item.amount_cents,
                                 periodicity=item.schedule.periodicity))
    planned_in = [item for item in planned if as_of < item.on <= horizon_end]
    events.extend(
        KnownEvent(on=item.on, amount_cents=item.amount_cents, label=item.label,
                   source="planned", series=f"planned:{item.id}", category_id=item.category_id)
        for item in planned_in
    )

    order = {"declared": 0, "detected": 1, "planned": 2, "scenario": 3}
    events.sort(key=lambda event: (event.on, order[event.source], event.label))
    return Sources(
        events=events,
        series=sorted(series, key=lambda item: (item.source, item.label)),
        history=history,
        residual_rows=residual_rows,
        warnings=warnings,
        detected_projected=sum(1 for item in projected if item.label_key not in replaced),
        declared_projected=declared_projected,
        planned_projected=len(planned_in),
        reconciled=len(reconciled_ids),
    )
