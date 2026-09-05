"""`/api/plan` — the forecast plan, and the reading the whole application is in.

Two things live here, and they are deliberately one router because they are one
feature: the declarations a household writes (`plan_lines`), and the choice of
which of the three readings every other screen answers in (`plan_settings`).
See `app/engines/plan.py` for what the readings mean and `app/api/common.py`
for the single place they are applied.

**Nothing here ever writes a transaction.** A plan line is not a movement, and
the moment a forecast could be written into the ledger, "how much did I spend"
would depend on which rows someone remembered to delete afterwards.

Every query filters on `user_id`, via `get_current_user` — an agent key opens
this ledger like any other, since a plan is data about the household's money
rather than a credential of the account.
"""

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.common import ledger_mode, period_range, plan_lines, real_points, recurrence_points
from app.api.history import user_history
from app.db import get_db
from app.engines.plan import occurrences, unrealised
from app.engines.recurrence import detect_recurrences
from app.importers.dedup import normalize_label
from app.models import Account, Category, PlanLine, PlanSettings, User
from app.schemas.plan import (
    LedgerModeIn,
    LedgerModeOut,
    PlanFromRecurrencesOut,
    PlanLineIn,
    PlanLineOut,
    PlanLinePatch,
    PlanOccurrenceOut,
    PlanPreviewOut,
)
from app.security.deps import get_current_user

router = APIRouter(prefix="/plan", tags=["plan"])

# A subscription is only worth pre-filling once it has actually settled into a
# rhythm. `detect_recurrences` already reports its own confidence; anything
# below "confirmed" is a guess, and a plan pre-filled with guesses is a plan
# nobody trusts enough to read.
_ACCEPTED_CONFIDENCE = "confirmed"

# Which detected rhythms become a plan line at all. A weekly or fortnightly
# charge is a real recurrence but rarely a declaration a household would make
# by hand, and `engines/plan` has no trouble with it — these are simply the
# rhythms the pre-fill offers, and every other one stays a manual decision.
_ACCEPTED_PERIODICITIES = ("monthly", "quarterly", "yearly")


def _owned_line(db: Session, user: User, line_id: int) -> PlanLine:
    line = (
        db.query(PlanLine)
        .filter(PlanLine.id == line_id, PlanLine.user_id == user.id)
        .first()
    )
    if line is None:
        raise HTTPException(status_code=404, detail="Ligne de plan introuvable")
    return line


def _check_references(db: Session, user: User, category_id: int | None, account_id: int | None):
    if category_id is not None:
        exists = (
            db.query(Category.id)
            .filter(Category.id == category_id, Category.user_id == user.id)
            .first()
        )
        if exists is None:
            raise HTTPException(status_code=404, detail="Catégorie introuvable")
    if account_id is not None:
        exists = (
            db.query(Account.id)
            .filter(Account.id == account_id, Account.user_id == user.id)
            .first()
        )
        if exists is None:
            raise HTTPException(status_code=404, detail="Compte introuvable")


@router.get("", response_model=list[PlanLineOut])
def list_plan_lines(
    user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> list[PlanLine]:
    """The whole plan, newest declaration last.

    Inactive and ended lines come back too: a household reviewing its plan
    needs to see the subscription it cancelled in order to believe it is
    cancelled, and a screen that hid them would answer "where did my line go"
    with silence.
    """
    return (
        db.query(PlanLine)
        .filter(PlanLine.user_id == user.id)
        .order_by(PlanLine.start_on, PlanLine.id)
        .all()
    )


@router.post("", response_model=PlanLineOut, status_code=status.HTTP_201_CREATED)
def create_plan_line(
    payload: PlanLineIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PlanLine:
    _check_references(db, user, payload.category_id, payload.account_id)
    line = PlanLine(user_id=user.id, origin="manual", **payload.model_dump())
    db.add(line)
    db.commit()
    db.refresh(line)
    return line


@router.patch("/{line_id}", response_model=PlanLineOut)
def patch_plan_line(
    line_id: int,
    payload: PlanLinePatch,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PlanLine:
    line = _owned_line(db, user, line_id)
    changes = payload.model_dump(exclude_unset=True)
    _check_references(db, user, changes.get("category_id"), changes.get("account_id"))

    for field, value in changes.items():
        setattr(line, field, value)

    # The two coherence rules `PlanLineIn` enforces on creation hold just as
    # much after an edit -- a patch that turned a fixed line into an envelope
    # without a category would produce a line that can never be drawn down.
    if line.kind == "envelope":
        if line.category_id is None:
            raise HTTPException(
                status_code=422, detail="Une enveloppe doit porter une catégorie")
        if line.periodicity != "monthly":
            raise HTTPException(status_code=422, detail="Une enveloppe est mensuelle")
    if line.end_on is not None and line.end_on < line.start_on:
        raise HTTPException(status_code=422, detail="La date de fin précède la date de début")

    db.commit()
    db.refresh(line)
    return line


@router.delete("/{line_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_plan_line(
    line_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    """Removes the declaration outright.

    Ending a subscription is `end_on`, not deletion: a line with an end date
    keeps forecasting the months it really covered. Deletion is for a line that
    should never have existed.
    """
    db.delete(_owned_line(db, user, line_id))
    db.commit()


@router.get("/preview", response_model=PlanPreviewOut)
def preview_plan(
    date_from: date | None = None,
    date_to: date | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PlanPreviewOut:
    """What the plan produces over a window, and what of it is still ahead.

    `planned` is every occurrence; `remaining` is the part the ledger does not
    already account for. The difference between the two totals is exactly what
    "Réel complété" adds to the real figures, which is the number the screen
    needs in order to say so out loud.
    """
    start, end, _ = period_range(db, user.id, date_from, date_to)
    lines = plan_lines(db, user.id)
    planned = occurrences(lines, start, end)
    remaining = unrealised(lines, real_points(db, user.id), start, end)

    def out(items):
        return [
            PlanOccurrenceOut(
                line_id=item.line_id, on=item.on, amount_cents=item.amount_cents,
                label=item.label, category_id=item.category_id, account_id=item.account_id,
            )
            for item in items
        ]

    return PlanPreviewOut(
        date_from=start,
        date_to=end,
        planned=out(planned),
        remaining=out(remaining),
        planned_total_cents=sum(item.amount_cents for item in planned),
        remaining_total_cents=sum(item.amount_cents for item in remaining),
    )


@router.post("/from-recurrences", response_model=PlanFromRecurrencesOut)
def plan_from_recurrences(
    user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> PlanFromRecurrencesOut:
    """Pre-fills the plan from the subscriptions Yieldo has already detected.

    A household should not have to type in the rent Yieldo has been watching
    leave its account every month for a year. Only *confirmed* recurrences are
    offered -- a probable one is a guess, and a plan seeded with guesses is a
    plan nobody reads.

    Accepting twice does not double the plan: a detected recurrence whose
    normalised label already matches an existing line is skipped and counted,
    so the answer says what was created AND what was already there.

    The lines it writes are `origin="recurrence"`, not `"manual"`: a household
    reviewing its plan is entitled to know which lines it did not write itself.
    Everything written here is editable and deletable like any other line --
    nothing is auto-committed beyond this one explicit request.
    """
    history = user_history(db, user.id)
    today = history.date_to if history is not None else date.today()
    report = detect_recurrences(recurrence_points(db, user.id), today)

    existing = {
        normalize_label(line.match_label)
        for line in db.query(PlanLine).filter(PlanLine.user_id == user.id).all()
        if line.match_label
    }

    created: list[PlanLine] = []
    skipped = 0
    for item in report.recurrences:
        if item.confidence != _ACCEPTED_CONFIDENCE:
            continue
        if item.periodicity not in _ACCEPTED_PERIODICITIES:
            continue
        if item.label_key in existing:
            skipped += 1
            continue

        line = PlanLine(
            user_id=user.id,
            label=item.label,
            amount_cents=item.amount_cents,
            kind="fixed",
            category_id=item.category_id,
            periodicity=item.periodicity,
            # The day the charge has actually been landing on, not the 1st: a
            # rent forecast on the 1st and paid on the 5th shows a month with
            # a hole in it for four days every single month.
            day_of_month=item.last_on.day,
            start_on=item.first_on,
            match_label=item.label,
            origin="recurrence",
        )
        db.add(line)
        created.append(line)
        existing.add(item.label_key)

    db.commit()
    for line in created:
        db.refresh(line)
    return PlanFromRecurrencesOut(
        created=[PlanLineOut.model_validate(line) for line in created], skipped=skipped
    )


@router.get("/mode", response_model=LedgerModeOut)
def get_ledger_mode(
    user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> LedgerModeOut:
    return LedgerModeOut(mode=ledger_mode(db, user.id))


@router.put("/mode", response_model=LedgerModeOut)
def set_ledger_mode(
    payload: LedgerModeIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> LedgerModeOut:
    """Changes what every figure in the application means, for this household.

    Stored rather than kept in the browser, for the reason `PlanSettings`
    gives: the export and the assistant both have to know which reading they
    are answering in, and a mode that lives in a tab is a mode neither can see.
    """
    row = db.query(PlanSettings).filter(PlanSettings.user_id == user.id).first()
    if row is None:
        row = PlanSettings(user_id=user.id, ledger_mode=payload.mode)
        db.add(row)
    else:
        row.ledger_mode = payload.mode
    db.commit()
    return LedgerModeOut(mode=payload.mode)
