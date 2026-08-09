from datetime import date

from sqlalchemy import Boolean, Date, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base

ACCOUNT_KINDS = (
    "checking", "savings", "pea", "life_insurance", "per",
    "brokerage", "crypto", "real_estate", "loan", "cash",
)


class Account(Base):
    __tablename__ = "accounts"

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    currency: Mapped[str] = mapped_column(String(3), default="EUR", nullable=False)
    opening_balance_cents: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    opened_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    include_in_net_worth: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    archived: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    user = relationship("User", back_populates="accounts")
