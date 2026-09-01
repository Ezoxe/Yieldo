"""How many consecutive months the household has kept importing statements.

Design §6.2: "nombre de mois consécutifs où les relevés ont été importés.
Mesure une habitude réelle, pas un score artificiel." The measurement rests on
exactly the two sources already stored, and nothing else: `import_batches`
(which transactions came from which import) and the transactions' own dates.

**`ImportBatch` carries no statement period of its own** -- no
`statement_from` / `statement_to` field exists on the model. The only honest
proxy for "which calendar months this batch's statement actually covered" is
the batch's OWN transactions: the earliest and latest date among the rows
that came from it. A batch whose rows run from the 3rd to the 28th of a month
covers that whole month, even though the 1st and 2nd carry nothing; a batch
whose rows jump from January to March, with nothing dated in February,
genuinely covered February too -- the statement spanned it, even though
nothing happened that month. That is the "imported and empty" case. A month
untouched by any batch's own span, and holding no transaction of its own
either, was never imported at all. The operator's own ledger holds eight of
exactly this second kind -- his statements are one per month and never
straddle a gap, so none of his eight is the first kind.

A month holding at least one transaction (`covered`) is always `imported`: a
transaction can only exist inside SOME batch's span, by construction of that
span from the batch's own rows (or, for a manual entry with no batch at all,
`covered` is still true on the strength of the row itself). The distinction
this module exists to make only matters on the OTHER side, where `covered` is
False: `imported` still separates "the statement spanned this month, which
simply had nothing in it" from "no statement has ever reached this month at
all". `MonthCovered.imported` carries that; `covered` alone cannot.

**The current month never breaks a streak: it is not over.** An empty current
month is not evidence of anything yet, so it neither extends nor breaks the
count. The moment it does have activity, though, it counts immediately --
a fresh import today shows up today, not at month end.

Pure: no session, no network, no implicit clock -- `today` is a parameter.
"""

from dataclasses import dataclass
from datetime import date

from app.engines.aggregate import bucket_bounds, bucket_key
from app.engines.period import month_end


@dataclass(frozen=True)
class ImportedTx:
    """The minimal input: a transaction's date, and which batch (if any)
    produced it. A manual entry -- no CSV import behind it -- carries
    `batch_id=None`: it still makes its own month `covered`, but it
    establishes no import span of its own, because nothing was actually
    imported for it.
    """

    on: date
    batch_id: int | None


@dataclass(frozen=True)
class MonthCovered:
    key: str
    # Strictly: this month holds at least one transaction. See the module
    # docstring -- a month with none is never `covered`, even when a batch's
    # own span reaches across it.
    covered: bool
    transaction_count: int
    # False only when `covered` is False AND no batch's own span reaches this
    # month either -- "never imported", the operator's eight gap months. True
    # whenever `covered` is True, and also true on an empty month a batch's
    # own span still spans -- "imported and empty". This is the field the
    # streak count and `broken_reason` are built from, never `covered` alone.
    imported: bool


@dataclass(frozen=True)
class StreakReport:
    current: int
    longest: int
    # The most recent PAST (non-current) month that was imported. `None` when
    # no past month ever was -- either nothing has been imported yet, or the
    # ledger's whole history is inside the current month.
    last_complete_month: str | None
    months: list[MonthCovered]
    # French. Set exactly when `current == 0`, and it names which of two
    # distinct causes applies -- see `_reason_never_started` and
    # `_reason_broken`. Never both, and never set when `current > 0`: a live
    # streak needs no explanation for why it isn't broken.
    broken_reason: str | None


def _month_key(on: date) -> str:
    return bucket_key(on, "month")


def _next_month_key(key: str) -> str:
    start, _ = bucket_bounds(key, "month")
    return _month_key(month_end(start, 1))


def _reason_never_started() -> str:
    return "Aucun relevé n'a encore été importé : le suivi n'a pas commencé."


def _reason_broken(gap_months: int) -> str:
    span = "un mois" if gap_months == 1 else f"{gap_months} mois"
    return (
        f"Le suivi s'est interrompu : cela fait {span} qu'aucun relevé n'a été "
        "importé."
    )


def compute_streak(entries: list[ImportedTx], today: date) -> StreakReport:
    """Every month from the first evidence to `today`, and the streak it makes.

    "Evidence" is either a transaction's own date or a batch's own span. With
    no entries at all, `months` is empty: there is nothing to anchor a first
    month on, and inventing one from `today` alone would report a streak of
    zero for a household that has simply never used Yieldo -- `None` standing
    in for "unknown" rather than a manufactured empty history.
    """
    if not entries:
        return StreakReport(current=0, longest=0, last_complete_month=None,
                            months=[], broken_reason=_reason_never_started())

    today_key = _month_key(today)

    # Per-batch span: the earliest and latest date among ITS OWN rows.
    batch_bounds: dict[int, tuple[date, date]] = {}
    for entry in entries:
        if entry.batch_id is None:
            continue
        lo, hi = batch_bounds.get(entry.batch_id, (entry.on, entry.on))
        batch_bounds[entry.batch_id] = (min(lo, entry.on), max(hi, entry.on))

    spanned_months: set[str] = set()
    for lo, hi in batch_bounds.values():
        end_key = _month_key(hi)
        key = _month_key(lo)
        while True:
            spanned_months.add(key)
            if key == end_key:
                break
            key = _next_month_key(key)

    counts: dict[str, int] = {}
    for entry in entries:
        key = _month_key(entry.on)
        counts[key] = counts.get(key, 0) + 1

    all_keys = set(counts) | spanned_months
    start_key = min(all_keys)
    end_key = max(today_key, max(all_keys))

    months: list[MonthCovered] = []
    key = start_key
    while True:
        count = counts.get(key, 0)
        covered = count > 0
        imported = covered or key in spanned_months
        months.append(MonthCovered(key=key, covered=covered, transaction_count=count,
                                   imported=imported))
        if key == end_key:
            break
        key = _next_month_key(key)

    # The current month is excluded from the run when it is itself not (yet)
    # imported: it is not over, so its emptiness so far is not a break. It
    # stays in when it IS imported, so a fresh import today extends the
    # streak the same day rather than waiting for month end.
    effective = [m for m in months if not (m.key == today_key and not m.imported)]

    longest = 0
    run = 0
    for month in effective:
        if month.imported:
            run += 1
            longest = max(longest, run)
        else:
            run = 0
    current = run  # `run` at loop end is exactly the trailing streak: any
    # break resets it and nothing follows the last break in `effective`.

    last_complete_month = next(
        (m.key for m in reversed(months) if m.key != today_key and m.imported), None
    )

    broken_reason = None
    if current == 0:
        # How many consecutive complete months in a row went unimported,
        # counting backward from the most recent one. Zero exactly when there
        # is no past month at all -- the whole (non-empty) ledger sits inside
        # the current month -- which is the "never started" cause, not a
        # break of anything that existed.
        gap = 0
        for month in reversed(months):
            if month.key == today_key:
                continue
            if month.imported:
                break
            gap += 1
        broken_reason = _reason_broken(gap) if gap > 0 else _reason_never_started()

    return StreakReport(current=current, longest=longest,
                        last_complete_month=last_complete_month,
                        months=months, broken_reason=broken_reason)
