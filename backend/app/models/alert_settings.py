from datetime import UTC, datetime

from sqlalchemy import BigInteger, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class AlertSettings(Base):
    """One household's alert thresholds. Phase 4 plan Task 10.

    **At most one row per user** (`user_id` is unique), and it carries
    `user_id` for the same reason `ApiKey` and `LlmSettings` do: a threshold
    is a decision this household made, not a fact about the world, and
    CLAUDE.md's isolation rule applies to it exactly as to every other
    business table.

    **`balance_floor_cents` is nullable, and `NULL` is not 0.** A threshold
    the household never set means "Yieldo watches no floor" -- not "Yieldo
    watches for the balance going below zero". Storing 0 as a stand-in would
    make an unset threshold indistinguishable from a deliberate one at zero,
    and would raise a critical alert nobody asked for on the very first
    visit. `engines/alert.py` keeps the two apart on the strength of this
    column being genuinely `None`; see `BalanceFloorInput`'s own docstring.

    Integer cents, signed: a household with an authorised overdraft may
    legitimately set a floor at −500,00 € (`-50000`).

    `BigInteger` rather than `Integer`: a floor is a balance, not a monthly
    flow, and `Account.opening_balance_cents` already uses the wider type for
    the same reason.
    """

    __tablename__ = "alert_settings"
    __table_args__ = (UniqueConstraint("user_id", name="uq_alert_settings_user"),)

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    # None means no floor has ever been stored. Never coerced to 0 -- see the
    # class docstring for why that distinction is the whole point of the column.
    balance_floor_cents: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC), nullable=False,
    )
