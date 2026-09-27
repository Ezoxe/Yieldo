from datetime import UTC, date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class PlannedEvent(Base):
    """A one-off amount the household knows is coming: a tax balance, a
    holiday, a bonus, a car repair already quoted.

    The Avenir screen projects it on `due_on` like any other known event. Once
    the date has passed it is no longer projected -- the statement is the truth
    from then on -- and the screen offers to delete it.
    """

    __tablename__ = "planned_events"
    __table_args__ = (Index("ix_planned_event_user_due", "user_id", "due_on"),)

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    label: Mapped[str] = mapped_column(String(120), nullable=False)
    due_on: Mapped[date] = mapped_column(Date, nullable=False)
    # Signed, never zero: negative is money leaving.
    amount_cents: Mapped[int] = mapped_column(Integer, nullable=False)
    # Which account it lands on. None means the household's current account,
    # and the event belongs to every perimeter.
    account_id: Mapped[int | None] = mapped_column(
        ForeignKey("accounts.id", ondelete="SET NULL"), nullable=True
    )
    category_id: Mapped[int | None] = mapped_column(
        ForeignKey("categories.id", ondelete="SET NULL"), nullable=True
    )
    notes: Mapped[str | None] = mapped_column(String(2000), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False
    )
