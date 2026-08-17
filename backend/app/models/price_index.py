from datetime import date

from sqlalchemy import Date, ForeignKey, Integer, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class PriceIndexPoint(Base):
    """One month of a user-supplied reference price index (e.g. INSEE's IPC).

    Yieldo makes no outbound call by default, so this series is never fetched:
    the user pastes it in on the Analyse screen, or leaves it empty and the
    comparison column simply reads "—". Nothing here is ever invented.

    `value_hundredths` is an index level, not money: 118.42 is stored as 11842.
    An integer keeps it exact without pretending it is a number of cents.
    """

    __tablename__ = "price_index_points"
    __table_args__ = (
        UniqueConstraint("user_id", "month", name="uq_price_index_user_month"),
    )

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    # Always the first day of the month it stands for.
    month: Mapped[date] = mapped_column(Date, nullable=False)
    value_hundredths: Mapped[int] = mapped_column(Integer, nullable=False)
