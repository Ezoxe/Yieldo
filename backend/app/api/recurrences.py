from datetime import date

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.common import recurrence_points
from app.api.history import user_history
from app.db import get_db
from app.engines.recurrence import detect_recurrences
from app.models import Category, User
from app.schemas.recurrences import PriceChangeOut, RecurrenceOut, RecurrenceReportOut
from app.security.deps import get_current_user

router = APIRouter(prefix="/recurrences", tags=["recurrences"])


@router.get("", response_model=RecurrenceReportOut)
def list_recurrences(
    user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> RecurrenceReportOut:
    """Every recurring charge in this user's whole ledger.

    Deliberately takes no date range. A monthly subscription cannot be
    recognised from one month of statements, and answering a filtered range
    would report a different set of subscriptions each time the reader
    changed the period -- which reads as the app changing its mind.

    `today`, for the engine, is this user's *ledger's own last date* --
    `user_history(...).date_to` -- not the real calendar date. Task 7's
    engine marks a recurrence `missing`/`ended` once its last occurrence is
    too old relative to whatever `today` it is handed, and it cannot tell
    "cancelled" apart from "no recent import": it only ever sees `today`.
    The operator's ledger stops on 2026-01-09; if this route passed
    `date.today()`, every subscription he has ever had would read `ended`
    from nothing more than seven months of not having imported a new
    statement. Judged instead against the ledger's own last day, a
    recurrence whose last charge sits at that boundary reads as still
    current -- there is simply no later data to contradict it -- while a
    recurrence that stopped well before other transactions kept arriving is
    a real, data-backed cancellation signal, not an artefact of the clock.
    `ledger_last_on` is carried on the report precisely so the screen can
    phrase a stale status honestly ("aucun prélèvement depuis le 9 janvier
    2026, dernière date de votre historique") instead of asserting a
    cancellation the data does not support. An empty ledger has no such
    date to anchor on, so it falls back to the real `date.today()` -- there
    is nothing to detect either way.
    """
    history = user_history(db, user.id)
    today = history.date_to if history is not None else date.today()
    report = detect_recurrences(recurrence_points(db, user.id), today)
    names = {c.id: c for c in db.query(Category).filter(Category.user_id == user.id).all()}

    return RecurrenceReportOut(
        recurrences=[
            RecurrenceOut(
                label=item.label,
                label_key=item.label_key,
                category_id=item.category_id,
                category_name=names[item.category_id].name
                if item.category_id in names else None,
                category_color=names[item.category_id].color
                if item.category_id in names else None,
                periodicity=item.periodicity,
                occurrences=item.occurrences,
                first_on=item.first_on,
                last_on=item.last_on,
                median_interval_days=item.median_interval_days,
                amount_cents=item.amount_cents,
                amount_spread_cents=item.amount_spread_cents,
                annual_cents=item.annual_cents,
                observed_span_days=item.observed_span_days,
                annualisable=item.annualisable,
                expected_next_on=item.expected_next_on,
                status=item.status,
                confidence=item.confidence,
                price_change=PriceChangeOut(
                    previous_cents=item.price_change.previous_cents,
                    current_cents=item.price_change.current_cents,
                    changed_on=item.price_change.changed_on,
                    ratio=item.price_change.ratio,
                ) if item.price_change is not None else None,
            )
            for item in report.recurrences
        ],
        annual_subscription_cents=report.annual_subscription_cents,
        monthly_subscription_cents=report.monthly_subscription_cents,
        analysed_groups=report.analysed_groups,
        rejected_thin=report.rejected_thin,
        rejected_irregular=report.rejected_irregular,
        notice=report.notice,
        missing_count=sum(1 for item in report.recurrences if item.status == "missing"),
        price_change_count=sum(
            1 for item in report.recurrences if item.price_change is not None
        ),
        ledger_last_on=history.date_to if history is not None else None,
    )
