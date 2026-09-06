from datetime import date

from sqlalchemy import (
    Boolean,
    Date,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.engines.recurrence import OCCURRENCES_PER_YEAR

# The rhythms a declaration may keep, taken from the detection engine rather
# than restated: a household that declares a quarterly charge and a household
# whose statements show one are describing the same thing, and the two halves of
# the recurrences screen have to speak the same vocabulary.
DECLARED_PERIODICITIES = tuple(OCCURRENCES_PER_YEAR)


class DeclaredRecurrence(Base):
    """A charge or income the household states it has.

    The counterpart to `engines/recurrence.py`, which can only describe what
    statements already show. That engine needs three occurrences before it will
    speak, and it refuses any charge whose amount wanders -- which is every
    water and electricity bill there is. Both refusals are right for a detector
    and both leave the household unable to say "I pay this, on this day, every
    month" about a bill it knows perfectly well it has.

    `amount_cents` is signed: negative is money leaving. For a variable charge
    it is the household's own ESTIMATE, and `engines/schedule.observed_amount`
    replaces it with the median of the check-ins once there are three -- never
    before, and the screen always says which of the two it is showing.

    `anchor_on` is the first due date, and every later one is arithmetic on it.
    Not on the previous occurrence: a rent anchored on the 31st would otherwise
    be pulled back to the 28th by February and stay there.
    """

    __tablename__ = "declared_recurrences"
    __table_args__ = (
        Index("ix_declared_recurrence_user", "user_id", "active"),
    )

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    label: Mapped[str] = mapped_column(String(120), nullable=False)
    category_id: Mapped[int | None] = mapped_column(
        ForeignKey("categories.id", ondelete="SET NULL"), nullable=True
    )
    # Which account it hits. Optional: a household can declare a charge before
    # it has imported the account it lands on.
    account_id: Mapped[int | None] = mapped_column(
        ForeignKey("accounts.id", ondelete="SET NULL"), nullable=True
    )
    amount_cents: Mapped[int] = mapped_column(Integer, nullable=False)
    # Water, electricity, anything billed on consumption. Decides whether
    # check-ins are allowed to replace `amount_cents` in every total.
    amount_is_variable: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=text("0"), nullable=False
    )
    periodicity: Mapped[str] = mapped_column(String(16), nullable=False)
    anchor_on: Mapped[date] = mapped_column(Date, nullable=False)
    # When the household stopped paying it. A declaration that has ended keeps
    # its past occurrences on the calendar -- they really did fall due -- and
    # takes no part in any forward-looking yearly cost.
    ends_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    active: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default=text("1"), nullable=False
    )
    notes: Mapped[str | None] = mapped_column(String(2000), nullable=True)

    checkins = relationship(
        "RecurrenceCheckin", back_populates="recurrence", cascade="all, delete-orphan"
    )


class RecurrenceCheckin(Base):
    """One due date the household ticked off, and what it really cost.

    Keyed on `(declared_recurrence_id, due_on)` rather than on a date alone:
    pointing the same due date twice is the same act, and a second row would
    double the month in every total. The unique constraint makes that a
    database fact rather than a rule the API has to remember.

    `amount_cents` is what was ACTUALLY billed, which for a water bill is
    exactly what the declaration could not know. `transaction_id` is the ledger
    line the household matched it to, when they named one -- optional, because
    a charge can be pointed from a paper bill before the statement arrives.
    """

    __tablename__ = "recurrence_checkins"
    __table_args__ = (
        UniqueConstraint(
            "declared_recurrence_id", "due_on", name="uq_checkin_recurrence_due"
        ),
    )

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    declared_recurrence_id: Mapped[int] = mapped_column(
        ForeignKey("declared_recurrences.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    due_on: Mapped[date] = mapped_column(Date, nullable=False)
    amount_cents: Mapped[int] = mapped_column(Integer, nullable=False)
    paid_on: Mapped[date] = mapped_column(Date, nullable=False)
    transaction_id: Mapped[int | None] = mapped_column(
        ForeignKey("transactions.id", ondelete="SET NULL"), nullable=True
    )

    recurrence = relationship("DeclaredRecurrence", back_populates="checkins")
