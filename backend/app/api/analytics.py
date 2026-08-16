from datetime import date, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.history import user_history
from app.db import get_db
from app.engines.aggregate import (
    TxPoint,
    aggregate_by_category,
    aggregate_series,
    compare_periods,
    fill_missing_buckets,
)
from app.engines.period import resolve_range
from app.models import Category, Transaction, User
from app.schemas.analytics import (
    CalendarPointOut,
    CategoryBreakdownOut,
    ComparisonOut,
    PeriodTotalsOut,
    SeriesBucketOut,
    SummaryOut,
)
from app.schemas.history import HistoryOut
from app.security.deps import get_current_user

router = APIRouter(prefix="/analytics", tags=["analytics"])

Granularity = Literal["day", "week", "month", "quarter", "year"]


def _points(
    db: Session,
    user_id: int,
    date_from: date | None,
    date_to: date | None,
    account_id: int | None = None,
) -> list[TxPoint]:
    """Fetch this user's transactions and convert them into the engine's pure input
    shape. The aggregation engine never sees an ORM object."""
    query = db.query(Transaction).filter(Transaction.user_id == user_id)
    if date_from is not None:
        query = query.filter(Transaction.date >= date_from)
    if date_to is not None:
        query = query.filter(Transaction.date <= date_to)
    if account_id is not None:
        query = query.filter(Transaction.account_id == account_id)
    return [
        TxPoint(on=t.date, amount_cents=t.amount_cents, category_id=t.category_id,
                account_id=t.account_id, is_transfer=t.is_transfer)
        for t in query.all()
    ]


def _period(
    db: Session, user_id: int, date_from: date | None, date_to: date | None
) -> tuple[date, date, HistoryOut | None]:
    """The range this request actually covers, plus the user's whole history.

    An absent bound means all of *this user's* data, not the current calendar
    year -- which is what "Tout" was silently being answered with. The clock is
    read here, at the route boundary, and handed to `resolve_range` as a
    parameter: the engine stays pure and testable at any date.
    """
    history = user_history(db, user_id)
    start, end = resolve_range(
        date_from,
        date_to,
        history.date_from if history else None,
        history.date_to if history else None,
        date.today(),
    )
    return start, end, history


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
    start, end, _ = _period(db, user.id, date_from, date_to)
    points = _points(db, user.id, start, end, account_id)
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
    start, end, _ = _period(db, user.id, date_from, date_to)
    totals = aggregate_by_category(_points(db, user.id, start, end))
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
    points = _points(db, user_id, from_, to_)
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
    start, end, history = _period(db, user.id, date_from, date_to)
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
    year: int = Query(..., ge=1970, le=2200),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[CalendarPointOut]:
    points = _points(db, user.id, date(year, 1, 1), date(year, 12, 31))
    buckets = aggregate_series(points, "day")
    return [
        CalendarPointOut(date=b.key, inflow_cents=b.inflow_cents,
                         outflow_cents=b.outflow_cents, net_cents=b.net_cents, count=b.count)
        for b in buckets
    ]
