"""What the user's own basket costs now against twelve months ago.

Year-over-year and nothing else. "Inflation personnelle" means the same basket a
year apart; comparing a three-month window against the three months before it
measures seasonality wearing inflation's name.

Two decisions that carry the honesty of the whole module:

* the comparison is **per observed month**, never per window total. The
  operator's ledger holds three months of data inside one window and none
  inside the other, and comparing totals across windows with different coverage
  would report a collapse in every category that is an artefact of which
  statements were imported;
* a category is only compared when **both** windows hold at least
  `MIN_MONTHS_PER_WINDOW` months with data. Otherwise the line still appears,
  marked not comparable, with the reason -- never dropped silently, and never
  reported as -100 %. A category bought every month a year ago and never since
  is this case exactly: it has zero qualifying months in the current window,
  not a price that fell to zero.

Sign convention, module-local and deliberate: every `*_cost_cents` here is a
POSITIVE magnitude. A basket's price is a positive number, and the field names
carry `_cost_` so the departure from the codebase's negative-outflow convention
is visible at every call site. `delta_cents` is signed and positive when the
basket got more expensive.

Pure: no session, no network, no implicit clock.
"""

from dataclasses import dataclass
from datetime import date

from app.engines.robust import median_cents

# Three months with data in EACH window. Below that the "median month" is one or
# two numbers, and a percentage built on it is a decimal point pretending to be
# a measurement.
MIN_MONTHS_PER_WINDOW = 3


@dataclass(frozen=True)
class Window:
    start: date
    end: date


@dataclass(frozen=True)
class CategorySpend:
    on: date
    amount_cents: int
    category_id: int | None


@dataclass(frozen=True)
class CategoryInflation:
    category_id: int | None
    # Median monthly cost, positive. 0 when not comparable.
    current_cost_cents: int
    previous_cost_cents: int
    # Signed: positive when this category got more expensive.
    delta_cents: int
    # None whenever no honest ratio exists -- never 0, which would read as
    # "unchanged".
    ratio: float | None
    months_current: int
    months_previous: int
    comparable: bool
    # French. Non-null exactly when `comparable` is False.
    reason: str | None


@dataclass(frozen=True)
class InflationReport:
    current: Window
    previous: Window
    lines: list[CategoryInflation]
    basket_current_cost_cents: int
    basket_previous_cost_cents: int
    basket_ratio: float | None
    # From a user-supplied index only. None when none was entered or when the
    # series does not cover both windows. Never fetched from anywhere.
    reference_ratio: float | None
    comparable: bool
    reason: str | None


def _shift_back_one_year(day: date) -> date:
    try:
        return day.replace(year=day.year - 1)
    except ValueError:
        # 29 February in a year whose predecessor is not a leap year.
        return day.replace(year=day.year - 1, day=28)


def previous_year_window(current: Window) -> Window:
    return Window(start=_shift_back_one_year(current.start),
                  end=_shift_back_one_year(current.end))


def _monthly_costs(
    entries: list[CategorySpend], window: Window
) -> dict[int | None, list[int]]:
    """Per category, the monthly cost totals inside `window`, as magnitudes.

    Only spending contributes: a row with `amount_cents >= 0` is income or a
    refund, not a cost, and is excluded rather than netted in -- the same
    choice `aggregate.aggregate_by_category` makes, and the one task 4/5
    settled for budgets: coercing a net-positive category into a spend with
    `abs()` fabricates a number the ledger never stated.
    """
    per_month: dict[tuple[int | None, str], int] = {}
    for entry in entries:
        if entry.amount_cents >= 0:
            continue
        if entry.on < window.start or entry.on > window.end:
            continue
        key = (entry.category_id, f"{entry.on.year}-{entry.on.month:02d}")
        per_month[key] = per_month.get(key, 0) + abs(entry.amount_cents)

    grouped: dict[int | None, list[int]] = {}
    for (category_id, _month), total in per_month.items():
        grouped.setdefault(category_id, []).append(total)
    return grouped


def reference_ratio_from_index(
    points: list[tuple[date, int]], current: Window, previous: Window
) -> float | None:
    """The reference index's own change between the two windows.

    `points` are `(first day of month, index value in hundredths)` pairs, typed
    in by the user. Returns None -- never 0 -- when the series does not cover
    both windows: a missing comparison is not a comparison showing no change.
    """
    def _median_in(window: Window) -> int | None:
        values = [value for month, value in points if window.start <= month <= window.end]
        return median_cents(values) if values else None

    now = _median_in(current)
    before = _median_in(previous)
    if now is None or before is None or before == 0:
        return None
    return (now - before) / before


def _reason_line(months_current: int, months_previous: int) -> str:
    return (
        f"Pas assez de données pour conclure : il faut au moins "
        f"{MIN_MONTHS_PER_WINDOW} mois de dépenses dans chacune des deux "
        f"périodes, et cette catégorie en compte {months_current} "
        f"sur la période récente et {months_previous} un an plus tôt."
    )


def _reason_basket() -> str:
    return (
        "Pas assez de données pour conclure : aucune catégorie ne dispose de "
        f"{MIN_MONTHS_PER_WINDOW} mois de dépenses à la fois sur la période "
        "choisie et sur la même période un an plus tôt. Importez des relevés "
        "couvrant les deux périodes pour obtenir une comparaison."
    )


def compute_inflation(
    entries: list[CategorySpend],
    current: Window,
    index_points: list[tuple[date, int]],
) -> InflationReport:
    previous = previous_year_window(current)
    now = _monthly_costs(entries, current)
    before = _monthly_costs(entries, previous)

    lines: list[CategoryInflation] = []
    for category_id in sorted(set(now) | set(before), key=lambda value: (value is None, value)):
        current_months = now.get(category_id, [])
        previous_months = before.get(category_id, [])
        current_cost = median_cents(current_months) if current_months else 0
        previous_cost = median_cents(previous_months) if previous_months else 0

        # `previous_cost > 0` is defensive rather than reachable through this
        # module's own filtering: `_monthly_costs` only ever sums rows with
        # `amount_cents < 0`, so a month can only appear in `previous_months`
        # at all by holding at least one such row, which makes its total --
        # and therefore its median -- strictly positive. The guard is kept in
        # case that filtering is ever loosened to admit zero-amount rows; see
        # `test_a_previous_window_with_only_zero_amount_rows_is_not_comparable`.
        comparable = (
            len(current_months) >= MIN_MONTHS_PER_WINDOW
            and len(previous_months) >= MIN_MONTHS_PER_WINDOW
            and previous_cost > 0
        )
        reason: str | None = None
        ratio: float | None = None
        if comparable:
            ratio = (current_cost - previous_cost) / previous_cost
        else:
            reason = _reason_line(len(current_months), len(previous_months))

        lines.append(CategoryInflation(
            category_id=category_id,
            current_cost_cents=current_cost,
            previous_cost_cents=previous_cost,
            delta_cents=current_cost - previous_cost,
            ratio=ratio,
            months_current=len(current_months),
            months_previous=len(previous_months),
            comparable=comparable,
            reason=reason,
        ))

    # Steepest rise first among the comparable lines; everything that could not
    # be compared falls to the bottom rather than being interleaved as if it
    # were a zero.
    lines.sort(key=lambda line: (not line.comparable, -(line.ratio or 0.0)))

    comparable_lines = [line for line in lines if line.comparable]
    basket_now = sum(line.current_cost_cents for line in comparable_lines)
    basket_before = sum(line.previous_cost_cents for line in comparable_lines)
    basket_ratio = (
        (basket_now - basket_before) / basket_before if basket_before > 0 else None
    )

    report_reason: str | None = None
    if not comparable_lines:
        report_reason = _reason_basket()

    return InflationReport(
        current=current,
        previous=previous,
        lines=lines,
        basket_current_cost_cents=basket_now,
        basket_previous_cost_cents=basket_before,
        basket_ratio=basket_ratio,
        reference_ratio=reference_ratio_from_index(index_points, current, previous),
        comparable=bool(comparable_lines),
        reason=report_reason,
    )
