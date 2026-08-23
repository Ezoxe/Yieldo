"""GET /api/analysis/inflation, GET /api/analysis/anomalies, and the
GET/PUT pair for the user's own pasted reference price index.

Both read routes follow `api/common.py`'s two rules: every query filters on
`user_id`, and the clock is read here, at the boundary, never inside
`app.engines`.

`inflation` decides "today" by re-using `period_range`, the same helper
`analytics.py` already builds its own windows from: an absent
`date_from`/`date_to` resolves to the user's own ledger span, not to the real
calendar date, so a stale ledger still gets a window with data in it rather
than an empty one anchored on `date.today()`. `budgets.py` and `cashflow.py`
make the same *kind* of choice (read the clock at the boundary, default to
where the data actually is rather than today) but through their own
month/ledger-bound resolvers, not through `period_range` itself.

`anomalies` does not call `period_range` for its *scoring* input -- see
`anomaly_points`'s and `detect_anomalies`'s own docstrings: the statistics
must read the whole ledger, never a window, or a category's baseline shrinks
to whatever the reader happens to have zoomed into. `period_range` is still
used to pick which window is *reported*, for the same "absent bound means the
user's own history" reason as `inflation`.
"""

import re
from datetime import date
from decimal import ROUND_HALF_UP, Decimal

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.common import anomaly_points, period_range, tx_points
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


@router.get("/inflation", response_model=InflationOut)
def inflation(
    date_from: date | None = None,
    date_to: date | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> InflationOut:
    """The user's own basket, now against the same window twelve months ago."""
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
        for point in tx_points(db, user.id, previous.start, end)
        if not point.is_transfer
    ]
    report = compute_inflation(
        points,
        current,
        [(item.month, item.value_hundredths) for item in _index_points(db, user.id)],
    )

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

    The value's positivity is already enforced by `PriceIndexPointIn` (schema
    boundary); this function only still has to refuse a month appearing twice
    in the same payload -- without this check, the second occurrence would
    silently overwrite the first in `parsed`, keeping whichever came last
    with no sign to the caller that a point was dropped.
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
        parsed[month] = int(
            (point.value * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
        )

    db.query(PriceIndexPoint).filter(PriceIndexPoint.user_id == user.id).delete(
        synchronize_session=False
    )
    for month, value in sorted(parsed.items()):
        db.add(PriceIndexPoint(user_id=user.id, month=month, value_hundredths=value))
    db.commit()

    return read_price_index(user=user, db=db)
