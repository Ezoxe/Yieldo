from datetime import date, timedelta
from typing import Literal

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.common import period_range, tx_points
from app.db import get_db
from app.engines.aggregate import (
    aggregate_by_category,
    aggregate_series,
    compare_periods,
    fill_missing_buckets,
)
from app.models import Category, User
from app.schemas.analytics import (
    CalendarPointOut,
    CategoryBreakdownOut,
    ComparisonOut,
    PeriodTotalsOut,
    SeriesBucketOut,
    SummaryOut,
)
from app.security.deps import get_current_user

router = APIRouter(prefix="/analytics", tags=["analytics"])

Granularity = Literal["day", "week", "month", "quarter", "year"]


@router.get("/series", response_model=list[SeriesBucketOut])
def series(
    granularity: Granularity = "month",
    date_from: date | None = None,
    date_to: date | None = None,
    account_id: int | None = None,
    include_transfers: bool = False,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[SeriesBucketOut]:
    start, end, _ = period_range(db, user.id, date_from, date_to)
    points = tx_points(db, user.id, start, end, account_id)
    buckets = aggregate_series(points, granularity, include_transfers)
    filled = fill_missing_buckets(buckets, granularity, start, end)
    return [
        SeriesBucketOut(
            key=b.key, start=b.start, end=b.end,
            inflow_cents=b.inflow_cents, outflow_cents=b.outflow_cents,
            net_cents=b.net_cents, count=b.count,
        )
        for b in filled
    ]


@router.get("/categories", response_model=list[CategoryBreakdownOut])
def categories_breakdown(
    date_from: date | None = None,
    date_to: date | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[CategoryBreakdownOut]:
    start, end, _ = period_range(db, user.id, date_from, date_to)
    totals = aggregate_by_category(tx_points(db, user.id, start, end))
    names = {c.id: c for c in db.query(Category).filter(Category.user_id == user.id).all()}
    return [
        CategoryBreakdownOut(
            category_id=total.category_id,
            name=names[total.category_id].name if total.category_id in names
            else "Non catégorisé",
            color=names[total.category_id].color if total.category_id in names
            else "#64748b",
            total_cents=total.total_cents,
            count=total.count,
            share=total.share,
        )
        for total in totals
    ]


def _period_totals(db: Session, user_id: int, from_: date, to_: date) -> PeriodTotalsOut:
    points = tx_points(db, user_id, from_, to_)
    inflow = sum(p.amount_cents for p in points if p.amount_cents > 0 and not p.is_transfer)
    outflow = sum(p.amount_cents for p in points if p.amount_cents < 0 and not p.is_transfer)
    net = inflow + outflow
    return PeriodTotalsOut(
        date_from=from_, date_to=to_,
        inflow_cents=inflow, outflow_cents=outflow, net_cents=net,
        transaction_count=len([p for p in points if not p.is_transfer]),
        # A savings rate without income is undefined, not zero.
        savings_rate=(net / inflow) if inflow > 0 else None,
    )


@router.get("/summary", response_model=SummaryOut)
def summary(
    date_from: date | None = None,
    date_to: date | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> SummaryOut:
    start, end, history = period_range(db, user.id, date_from, date_to)
    current = _period_totals(db, user.id, start, end)

    # Only a start the caller actually asked for has a period before it. A
    # defaulted one *is* the user's earliest transaction, so the window ahead of
    # it cannot hold data -- not because nothing was spent then, but because
    # nothing exists there by construction. Comparing against it reported the
    # whole net as a fall. Undefined, so null, the way savings_rate already is.
    #
    # A range the caller typed is answered as asked, even where nothing precedes
    # it: "nothing the month before" is a real answer to a question they posed.
    previous: PeriodTotalsOut | None = None
    comparison: ComparisonOut | None = None
    if date_from is not None:
        span = (end - start).days + 1
        previous_end = start - timedelta(days=1)
        previous_start = previous_end - timedelta(days=span - 1)
        previous = _period_totals(db, user.id, previous_start, previous_end)
        delta = compare_periods(current.net_cents, previous.net_cents)
        comparison = ComparisonOut(delta_cents=delta.delta_cents,
                                   delta_ratio=delta.delta_ratio)

    return SummaryOut(
        **current.model_dump(),
        previous=previous,
        comparison=comparison,
        history=history,
    )


@router.get("/calendar", response_model=list[CalendarPointOut])
def calendar_heatmap(
    date_from: date | None = None,
    date_to: date | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[CalendarPointOut]:
    """The day-by-day heat of the *period*, resolved exactly like its three
    siblings above. It used to take a single `year`, which is why the dashboard
    asked it for the current calendar year on every preset -- on "Tout" that is
    a full-width panel showing whatever happens to fall inside this year."""
    start, end, _ = period_range(db, user.id, date_from, date_to)
    points = tx_points(db, user.id, start, end)
    buckets = aggregate_series(points, "day")
    return [
        CalendarPointOut(date=b.key, inflow_cents=b.inflow_cents,
                         outflow_cents=b.outflow_cents, net_cents=b.net_cents, count=b.count)
        for b in buckets
    ]
