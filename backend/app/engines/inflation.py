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
  not a price that fell to zero;
* `current` must not exceed twelve months. `previous_year_window` shifts the
  whole window back exactly one year, so any `current` longer than that
  overlaps its own comparison period -- the shared months get counted on both
  sides, blending two different years' prices into one ratio that neither
  year actually stated, while still LOOKING like an honest year-over-year
  figure. This is the same failure the first bullet above prevents, at the
  window's other edge -- a per-window total that mixes calendar periods -- so
  it is refused outright (`ValueError`, in French) rather than silently
  computed. The router's own default (last twelve complete months of the
  ledger, not its whole span) exists so an ordinary request never reaches
  this guard; it is here for whatever range a caller explicitly types in.

Sign convention, module-local and deliberate: every `*_cost_cents` here is a
POSITIVE magnitude. A basket's price is a positive number, and the field names
carry `_cost_` so the departure from the codebase's negative-outflow convention
is visible at every call site. `delta_cents` is signed and positive when the
basket got more expensive.

**Transfers are the caller's responsibility.** `CategorySpend` carries no
`is_transfer` flag, and `_monthly_costs` applies no such filter -- unlike
`aggregate.aggregate_by_category`, which this module is otherwise modelled on
and which excludes transfers by default via its own `include_transfers` flag.
Callers MUST filter transfers out before constructing `CategorySpend` rows,
the way `api/common.py`'s `user_history` already does for every other
cashflow engine here (`Transaction.is_transfer.is_(False)`). Fed in
unfiltered, a standing order into savings or a credit-card settlement becomes
a "cost" that repeats every month and can dominate the "où mon argent
part-il davantage qu'avant ?" ranking. See `CategorySpend`'s own docstring.

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
    """One row's date, amount and category. Deliberately minimal, like
    `capacity.MonthlyEntry` and `forecast.LedgerEntry` -- callers build these
    from whatever row shape they already hold.

    **No `is_transfer` field, and `_monthly_costs` applies no such filter.**
    Unlike `aggregate.aggregate_by_category`, which this module is otherwise
    modelled on and which excludes transfers by default via its own
    `include_transfers` flag, this engine has no way to tell a standing order
    into savings or a credit-card settlement from ordinary spending. Callers
    MUST exclude transfers before constructing these -- the same exclusion
    `api/common.py`'s `user_history` already applies for every other
    cashflow engine in this codebase (`Transaction.is_transfer.is_(False)`).
    Fed in unfiltered, an internal transfer enters the basket as a monthly
    cost that repeats every month and can dominate the ranking.
    """

    on: date
    amount_cents: int
    category_id: int | None


@dataclass(frozen=True)
class CategoryInflation:
    category_id: int | None
    # Median monthly cost over whichever months this category actually had
    # qualifying spend in, on this side -- positive, and OFTEN NON-ZERO even
    # when `comparable` is False: a category with six months of current
    # spend and none a year earlier still carries its real current-side
    # median here (see `test_a_window_with_too_few_months_is_not_comparable_
    # and_says_why`, which pins `current_cost_cents == 30_000` on a
    # `comparable=False` line). 0 means "no month with qualifying spend on
    # this side at all", never a measured cost of zero.
    current_cost_cents: int
    # Same rule as `current_cost_cents`, mirrored onto the previous window.
    previous_cost_cents: int
    # Signed, current minus previous: positive when this category got more
    # expensive. Computed and populated the same way on an incomparable
    # line as on a comparable one -- see `current_cost_cents` above.
    #
    # Neither this field nor `current_cost_cents` / `previous_cost_cents` may
    # be rendered as a change, a price, or a trend when `comparable` is
    # False. `ratio is None` is the only trustworthy signal that no honest
    # comparison exists; these three fields exist even then because a
    # screen may still want to show "vous avez dépensé X ce mois-ci" without
    # implying a rate of change came with it.
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
    # `previous.end >= current.start` is the exact overlap condition, not an
    # approximation: `previous_year_window` shifts both bounds back by the
    # SAME one-year rule (including its own leap-day handling), so comparing
    # the shifted end against the original start catches every window longer
    # than twelve months, calendar-aligned or not, without separately
    # reimplementing "twelve months" as day or month arithmetic that could
    # drift out of step with the shift it is checking.
    if previous.end >= current.start:
        raise ValueError(
            "La période demandée dépasse douze mois : la comparaison "
            "porterait alors sur la même période un an plus tôt, qui "
            "chevaucherait la période choisie et compterait certains mois "
            "deux fois."
        )
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
