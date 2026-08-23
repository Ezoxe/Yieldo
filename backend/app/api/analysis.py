"""GET /api/analysis/inflation, GET /api/analysis/anomalies, and the
GET/PUT pair for the user's own pasted reference price index.

Both read routes follow `api/common.py`'s two rules: every query filters on
`user_id`, and the clock is read here, at the boundary, never inside
`app.engines`.

`inflation` decides "today" differently depending on whether a range was
asked for. An EXPLICIT `date_from`/`date_to` (either one) still goes through
`period_range`, the same helper `analytics.py` builds its own windows from:
an absent bound resolves to the user's own ledger span, not the real
calendar date. But when BOTH bounds are absent, `period_range`'s own default
-- "as far as there is data" -- cannot be reused here the way `analytics.py`
reuses it: on any ledger longer than twelve months, `previous_year_window`
shifts that whole span back a year and the two windows OVERLAP, so the same
months get counted on both sides and the reported ratio is a blend neither
year actually stated (review finding, phase 2A: a 36-month ledger with a
true, constant 10 %/year rise reported 4.76 % by construction, flagged
`comparable: true`, `reason: null`). `_default_current_window` is the fix:
it defaults to the last twelve *complete calendar months* of the ledger --
the only default whose previous window cannot overlap it, per
`compute_inflation`'s own guard (see `inflation.py`'s module docstring). A
caller who explicitly widens a range past twelve months still hits that
guard and gets a French 422 rather than a blended figure; only the ABSENT-
bounds default is special-cased here.

`anomalies` does not call `period_range` for its *scoring* input -- see
`anomaly_points`'s and `detect_anomalies`'s own docstrings: the statistics
must read the whole ledger, never a window, or a category's baseline shrinks
to whatever the reader happens to have zoomed into. `period_range` is still
used to pick which window is *reported*, for the same "absent bound means the
user's own history" reason as `inflation`.
"""

import re
from calendar import monthrange
from datetime import date
from decimal import ROUND_HALF_UP, Decimal

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.common import anomaly_points, period_range, tx_points
from app.api.history import user_history
from app.db import get_db
from app.engines.anomaly import detect_anomalies
from app.engines.inflation import (
    CategorySpend,
    Window,
    compute_inflation,
    previous_year_window,
)
from app.models import Category, PriceIndexPoint, User
from app.schemas.analysis import (
    AnomalyOut,
    AnomalyReportOut,
    CategoryInflationOut,
    InflationOut,
    PriceIndexIn,
    PriceIndexPointOut,
    SkippedCategoryOut,
)
from app.schemas.history import HistoryOut
from app.security.deps import get_current_user

router = APIRouter(prefix="/analysis", tags=["analysis"])

_MONTH_KEY = re.compile(r"^(\d{4})-(\d{2})$")

UNCATEGORIZED_NAME = "Non catégorisé"
UNCATEGORIZED_COLOR = "#64748b"


def _parse_month(value: str) -> date:
    match = _MONTH_KEY.match(value)
    if match is None:
        raise HTTPException(status_code=422, detail="Mois invalide : format attendu AAAA-MM")
    year, month = int(match.group(1)), int(match.group(2))
    # As in `budgets.resolve_month`: `_MONTH_KEY` accepts any four digits,
    # including "0000", which reaches `date()`'s constructor and raises an
    # unhandled `ValueError` ("year 0 is out of range") rather than the French
    # 422 every other malformed-month path returns.
    if not 1 <= year <= 9999 or not 1 <= month <= 12:
        raise HTTPException(status_code=422, detail="Mois invalide : format attendu AAAA-MM")
    return date(year, month, 1)


def _index_points(db: Session, user_id: int) -> list[PriceIndexPoint]:
    return (
        db.query(PriceIndexPoint)
        .filter(PriceIndexPoint.user_id == user_id)
        .order_by(PriceIndexPoint.month)
        .all()
    )


def _category_names(db: Session, user_id: int) -> dict[int, Category]:
    return {c.id: c for c in db.query(Category).filter(Category.user_id == user_id).all()}


def _last_day_of_month(first_of_month: date) -> date:
    _, last_day = monthrange(first_of_month.year, first_of_month.month)
    return date(first_of_month.year, first_of_month.month, last_day)


def _shift_months(first_of_month: date, delta_months: int) -> date:
    """`first_of_month`, moved `delta_months` calendar months (may be
    negative), landing on the 1st of the target month. Plain integer
    arithmetic on a zero-based month count rather than repeated
    `date.replace` calls, so there is no day-31-does-not-exist-in-February
    case to special-case at every step."""
    total = first_of_month.year * 12 + (first_of_month.month - 1) + delta_months
    year, month = divmod(total, 12)
    return date(year, month + 1, 1)


def _default_current_window(history: HistoryOut | None, today: date) -> Window:
    """The last twelve *complete calendar months* the ledger covers.

    `period_range`'s own absent-bound default -- "as far as there is data"
    -- is exactly the window `compute_inflation` now refuses on any ledger
    longer than a year (see that function's guard): shifted back a year by
    `previous_year_window`, it overlaps itself. A twelve-calendar-month
    window is the widest default that provably cannot: anchored on the
    ledger's own last transaction (never `today` -- a ledger that stopped
    months ago must not default to an empty window at the real calendar
    date), spanning from the 1st of the month eleven months earlier through
    the last day of the anchor month. An empty ledger (`history is None`)
    falls back to `today`'s own twelve-month window, which is moot: there is
    no data for `compute_inflation` to find inside it either way.
    """
    anchor = history.date_to if history is not None else today
    end_month_start = anchor.replace(day=1)
    return Window(
        start=_shift_months(end_month_start, -11),
        end=_last_day_of_month(end_month_start),
    )


@router.get("/inflation", response_model=InflationOut)
def inflation(
    date_from: date | None = None,
    date_to: date | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> InflationOut:
    """The user's own basket, now against the same window twelve months ago.

    See the module docstring for why an absent range is not simply handed to
    `period_range` here the way every other read route in this file uses it.
    """
    if date_from is None and date_to is None:
        current = _default_current_window(user_history(db, user.id), date.today())
    else:
        start, end, _ = period_range(db, user.id, date_from, date_to)
        current = Window(start=start, end=end)
    previous = previous_year_window(current)

    # One fetch covering both windows. `tx_points` does not filter transfers
    # (unlike `user_history`'s callers elsewhere) -- `inflation.py`'s own
    # docstring makes that exclusion the caller's job, so it happens here,
    # before a `CategorySpend` is ever built: a standing order into savings or
    # a credit-card settlement is not a cost, and left in would repeat every
    # month and dominate the ranking.
    points = [
        CategorySpend(on=point.on, amount_cents=point.amount_cents,
                      category_id=point.category_id)
        for point in tx_points(db, user.id, previous.start, current.end)
        if not point.is_transfer
    ]
    try:
        report = compute_inflation(
            points,
            current,
            [(item.month, item.value_hundredths) for item in _index_points(db, user.id)],
        )
    except ValueError as exc:
        # `compute_inflation` raises in French already (see its own guard) --
        # the same catch-and-forward idiom `imports.py` uses for an engine
        # error that is already user-facing prose, not a stack trace to hide.
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    names = _category_names(db, user.id)
    return InflationOut(
        current_from=report.current.start,
        current_to=report.current.end,
        previous_from=report.previous.start,
        previous_to=report.previous.end,
        lines=[
            CategoryInflationOut(
                category_id=line.category_id,
                name=names[line.category_id].name
                if line.category_id in names else UNCATEGORIZED_NAME,
                color=names[line.category_id].color
                if line.category_id in names else UNCATEGORIZED_COLOR,
                current_cost_cents=line.current_cost_cents,
                previous_cost_cents=line.previous_cost_cents,
                delta_cents=line.delta_cents,
                ratio=line.ratio,
                months_current=line.months_current,
                months_previous=line.months_previous,
                comparable=line.comparable,
                reason=line.reason,
            )
            for line in report.lines
        ],
        basket_current_cost_cents=report.basket_current_cost_cents,
        basket_previous_cost_cents=report.basket_previous_cost_cents,
        basket_ratio=report.basket_ratio,
        reference_ratio=report.reference_ratio,
        comparable=report.comparable,
        reason=report.reason,
    )


@router.get("/anomalies", response_model=AnomalyReportOut)
def anomalies(
    date_from: date | None = None,
    date_to: date | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> AnomalyReportOut:
    """Transactions in the period that are unusual for their own category.

    The history handed to the engine is the whole ledger; only the reported
    window is narrowed. Rescoring a category against the fortnight on screen
    would turn ordinary spending into alerts whenever the reader zoomed in --
    see `anomaly_points` and `detect_anomalies`'s own docstrings for why
    `skipped`/`scored_groups` stay window-scoped while the statistics behind
    them do not: collapsing the two would either hide a genuine skip outside
    the window or score a group nobody asked about.
    """
    start, end, _ = period_range(db, user.id, date_from, date_to)
    report = detect_anomalies(anomaly_points(db, user.id), start, end)
    names = _category_names(db, user.id)

    return AnomalyReportOut(
        anomalies=[
            AnomalyOut(
                transaction_id=item.transaction_id,
                date=item.on,
                amount_cents=item.amount_cents,
                label=item.label,
                category_id=item.category_id,
                category_name=names[item.category_id].name
                if item.category_id in names else None,
                category_color=names[item.category_id].color
                if item.category_id in names else None,
                category_median_cents=item.category_median_cents,
                modified_z=item.modified_z,
                direction=item.direction,
            )
            for item in report.anomalies
        ],
        skipped=[
            SkippedCategoryOut(
                category_id=item.category_id,
                name=names[item.category_id].name
                if item.category_id in names else UNCATEGORIZED_NAME,
                direction=item.direction,
                observations=item.observations,
                reason=item.reason,
            )
            for item in report.skipped
        ],
        scored_groups=report.scored_groups,
        date_from=start,
        date_to=end,
    )


@router.get("/price-index", response_model=list[PriceIndexPointOut])
def read_price_index(
    user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> list[PriceIndexPointOut]:
    return [
        PriceIndexPointOut(
            month=f"{item.month.year}-{item.month.month:02d}",
            value_hundredths=item.value_hundredths,
        )
        for item in _index_points(db, user.id)
    ]


@router.put("/price-index", response_model=list[PriceIndexPointOut])
def replace_price_index(
    payload: PriceIndexIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[PriceIndexPointOut]:
    """Replace this user's reference index with the series supplied.

    Replace rather than merge, so pasting a corrected series fixes it outright
    and an empty list clears it. Yieldo never fetches this from anywhere: the
    app makes no outbound call by default, and an index nobody typed in is an
    index that does not exist.

    `PriceIndexPointIn` enforces the raw `Decimal`'s positivity (`gt=0`) and
    an upper bound (`le=1_000_000`) -- it does NOT enforce the positivity of
    `value_hundredths`, the rounded integer actually stored: a small enough
    positive value (review finding, phase 2A: `"0.004"`) rounds down to 0
    hundredths. A zero *current-side* median divided into a positive
    previous-side one in `reference_ratio_from_index` produces a fabricated
    `ratio = -1.0` -- a "-100 %" reference inflation nobody's pasted series
    actually stated. Guarded here, after rounding, because the schema cannot
    see the rounded value.

    This function also still has to refuse a month appearing twice in the
    same payload -- without that check, the second occurrence would silently
    overwrite the first in `parsed`, keeping whichever came last with no sign
    to the caller that a point was dropped.
    """
    parsed: dict[date, int] = {}
    for point in payload.points:
        month = _parse_month(point.month)
        if month in parsed:
            raise HTTPException(
                status_code=422,
                detail=f"Le mois {point.month} apparaît deux fois dans la série.",
            )
        # Exact: Decimal all the way to the integer. No float touches this.
        hundredths = int((point.value * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
        if hundredths <= 0:
            raise HTTPException(
                status_code=422,
                detail=(
                    f"La valeur de l'indice pour {point.month} est trop proche de "
                    "zéro : une fois arrondie au centième, elle doit rester "
                    "strictement positive."
                ),
            )
        parsed[month] = hundredths

    db.query(PriceIndexPoint).filter(PriceIndexPoint.user_id == user.id).delete(
        synchronize_session=False
    )
    for month, value in sorted(parsed.items()):
        db.add(PriceIndexPoint(user_id=user.id, month=month, value_hundredths=value))
    db.commit()

    return read_price_index(user=user, db=db)
