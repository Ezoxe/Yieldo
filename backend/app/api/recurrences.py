from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.common import recurrence_points
from app.api.history import user_history
from app.db import get_db
from app.engines.recurrence import detect_recurrences
from app.engines.schedule import Checkin, DeclaredSchedule, build_calendar, due_dates
from app.models import (
    Account,
    Category,
    DeclaredRecurrence,
    RecurrenceCheckin,
    Transaction,
    User,
)
from app.schemas.declared_recurrences import (
    CalendarOut,
    CheckinIn,
    CheckinOut,
    DeclaredRecurrenceIn,
    DeclaredRecurrenceOut,
    DeclaredRecurrencePatch,
    OccurrenceOut,
    ScheduleCostOut,
)
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


# ---------------------------------------------------------------------------
# Declared recurrences: what the household says it has, and what it ticks off.
#
# The other half of this screen. The report above reads rhythms off statements;
# everything below is stated by the household, on a calendar, one due date at a
# time. The two never merge: a detection is a claim about the past that Yieldo
# makes and can be wrong about, a declaration is a claim the household makes
# and Yieldo has no business second-guessing.
# ---------------------------------------------------------------------------


def _owned_declaration(db: Session, user: User, declaration_id: int) -> DeclaredRecurrence:
    row = (
        db.query(DeclaredRecurrence)
        .filter(
            DeclaredRecurrence.id == declaration_id,
            DeclaredRecurrence.user_id == user.id,
        )
        .first()
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Récurrence déclarée introuvable")
    return row


def _check_references(
    db: Session, user: User, category_id: int | None, account_id: int | None
) -> None:
    """Both optional, both this user's own. Checked here rather than left to the
    foreign key: SQLite would answer a stranger's id with an IntegrityError and
    a 500, on a route that answers every other bad payload in French."""
    if category_id is not None and db.query(Category).filter(
        Category.id == category_id, Category.user_id == user.id
    ).first() is None:
        raise HTTPException(status_code=404, detail="Catégorie introuvable")
    if account_id is not None and db.query(Account).filter(
        Account.id == account_id, Account.user_id == user.id
    ).first() is None:
        raise HTTPException(status_code=404, detail="Compte introuvable")


def _declarations(db: Session, user_id: int) -> list[DeclaredRecurrence]:
    return (
        db.query(DeclaredRecurrence)
        .filter(DeclaredRecurrence.user_id == user_id)
        .order_by(DeclaredRecurrence.label, DeclaredRecurrence.id)
        .all()
    )


def _as_schedule(row: DeclaredRecurrence) -> DeclaredSchedule:
    return DeclaredSchedule(
        id=row.id,
        label=row.label,
        amount_cents=row.amount_cents,
        amount_is_variable=row.amount_is_variable,
        periodicity=row.periodicity,
        anchor_on=row.anchor_on,
        ends_on=row.ends_on,
        active=row.active,
    )


def _as_checkin(row: RecurrenceCheckin) -> Checkin:
    return Checkin(
        schedule_id=row.declared_recurrence_id,
        due_on=row.due_on,
        amount_cents=row.amount_cents,
        paid_on=row.paid_on,
        transaction_id=row.transaction_id,
    )


@router.get("/declared", response_model=list[DeclaredRecurrenceOut])
def list_declared(
    user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> list[DeclaredRecurrence]:
    return _declarations(db, user.id)


@router.post("/declared", response_model=DeclaredRecurrenceOut,
             status_code=status.HTTP_201_CREATED)
def create_declared(
    payload: DeclaredRecurrenceIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> DeclaredRecurrence:
    _check_references(db, user, payload.category_id, payload.account_id)
    row = DeclaredRecurrence(user_id=user.id, **payload.model_dump())
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.patch("/declared/{declaration_id}", response_model=DeclaredRecurrenceOut)
def patch_declared(
    declaration_id: int,
    payload: DeclaredRecurrencePatch,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> DeclaredRecurrence:
    row = _owned_declaration(db, user, declaration_id)
    changes = payload.model_dump(exclude_unset=True)
    _check_references(db, user, changes.get("category_id"), changes.get("account_id"))
    for field, value in changes.items():
        setattr(row, field, value)
    db.commit()
    db.refresh(row)
    return row


@router.delete("/declared/{declaration_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_declared(
    declaration_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    """Removed outright, check-ins and all.

    Not archived. `active = false` already exists for "I stopped paying this
    but the past was real", and it is the right answer for a cancelled
    subscription. A row created by mistake needs a way out that leaves nothing
    behind, or the list fills with corrections that can never be cleared.
    """
    db.delete(_owned_declaration(db, user, declaration_id))
    db.commit()


@router.get("/calendar", response_model=CalendarOut)
def calendar(
    date_from: date | None = None,
    date_to: date | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> CalendarOut:
    """The window's due dates, their state, and what the declarations commit to.

    The window defaults to the current month, and the clock is read HERE, at
    the boundary, never inside `engines/schedule`. `period_range` is
    deliberately not reused: it resolves an absent bound to the span of the
    imported LEDGER, which is the right default for every screen that reads
    statements and the wrong one here. A declared calendar is about what falls
    due, including in months no statement has ever been imported for -- that is
    the whole reason a household declares anything.
    """
    today = date.today()
    start = date_from or today.replace(day=1)
    end = date_to or (
        date(start.year + (start.month == 12), start.month % 12 + 1, 1)
        - timedelta(days=1)
    )
    if end < start:
        raise HTTPException(
            status_code=422, detail="La date de fin précède la date de début."
        )

    rows = _declarations(db, user.id)
    checkins = (
        db.query(RecurrenceCheckin)
        .filter(RecurrenceCheckin.user_id == user.id)
        .all()
    )
    report = build_calendar(
        [_as_schedule(row) for row in rows],
        [_as_checkin(row) for row in checkins],
        start, end, today,
    )
    return CalendarOut(
        date_from=start,
        date_to=end,
        occurrences=[
            OccurrenceOut(
                schedule_id=o.schedule_id, label=o.label, due_on=o.due_on,
                amount_cents=o.amount_cents, status=o.status,
                paid_on=o.paid_on, transaction_id=o.transaction_id,
            )
            for o in report.occurrences
        ],
        schedules=[
            ScheduleCostOut(
                schedule_id=s.schedule_id, label=s.label, amount_cents=s.amount_cents,
                amount_basis=s.amount_basis, annual_cents=s.annual_cents,
                observations=s.observations,
            )
            for s in report.schedules
        ],
        annual_charges_cents=report.annual_charges_cents,
        annual_income_cents=report.annual_income_cents,
        monthly_charges_cents=report.monthly_charges_cents,
        monthly_income_cents=report.monthly_income_cents,
        late_count=report.late_count,
        pointed_count=report.pointed_count,
        notice=report.notice,
    )


@router.post("/declared/{declaration_id}/checkins", response_model=CheckinOut,
             status_code=status.HTTP_201_CREATED)
def create_checkin(
    declaration_id: int,
    payload: CheckinIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> RecurrenceCheckin:
    """Tick off one due date.

    Idempotent on `(declaration, due_on)`: pointing the same due date twice is
    the same act, so a second call UPDATES the first rather than raising or
    creating a second row. A second row would double that month in every total,
    and the unique constraint makes it impossible anyway -- answering with a
    409 would only push the household into deleting and re-pointing to correct
    an amount they mistyped.

    A due date the declaration does not actually fall on is refused. Accepting
    it would put a phantom occurrence in the totals that no calendar could ever
    show, since `build_calendar` only ever renders real due dates.
    """
    declaration = _owned_declaration(db, user, declaration_id)
    if payload.due_on not in due_dates(
        _as_schedule(declaration), payload.due_on, payload.due_on
    ):
        raise HTTPException(
            status_code=422,
            detail=(
                f"« {declaration.label} » ne tombe pas à échéance le "
                f"{payload.due_on.isoformat()}."
            ),
        )
    if payload.transaction_id is not None and db.query(Transaction).filter(
        Transaction.id == payload.transaction_id, Transaction.user_id == user.id
    ).first() is None:
        raise HTTPException(status_code=404, detail="Opération introuvable")

    row = (
        db.query(RecurrenceCheckin)
        .filter(
            RecurrenceCheckin.user_id == user.id,
            RecurrenceCheckin.declared_recurrence_id == declaration.id,
            RecurrenceCheckin.due_on == payload.due_on,
        )
        .first()
    )
    if row is None:
        row = RecurrenceCheckin(
            user_id=user.id,
            declared_recurrence_id=declaration.id,
            due_on=payload.due_on,
        )
        db.add(row)
    # Omitted means "it cost what the declaration says", which is the common
    # case for a fixed subscription and the one nobody should have to retype.
    row.amount_cents = (
        payload.amount_cents if payload.amount_cents is not None
        else declaration.amount_cents
    )
    row.paid_on = payload.paid_on or payload.due_on
    row.transaction_id = payload.transaction_id
    db.commit()
    db.refresh(row)
    return row


@router.delete("/declared/{declaration_id}/checkins/{due_on}",
               status_code=status.HTTP_204_NO_CONTENT)
def delete_checkin(
    declaration_id: int,
    due_on: date,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    """Un-tick a due date, putting it back to late or upcoming."""
    declaration = _owned_declaration(db, user, declaration_id)
    row = (
        db.query(RecurrenceCheckin)
        .filter(
            RecurrenceCheckin.user_id == user.id,
            RecurrenceCheckin.declared_recurrence_id == declaration.id,
            RecurrenceCheckin.due_on == due_on,
        )
        .first()
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Cette échéance n'est pas pointée")
    db.delete(row)
    db.commit()
